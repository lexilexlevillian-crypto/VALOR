import {withTurnRuntime,simulationId} from './turn-runtime.ts';
import {buildDeltas,validateDeltas,authorizeDeltas} from './turn-audit.ts';
import {observerEffects} from './turn-visibility.ts';
import {existingTurnRules,type TurnRuleRegistry,type RuleResolution} from './turn-rules.ts';
import {actionTime} from './calendar.ts';
import {createHash} from 'node:crypto';
import {ensure} from '../contracts.ts';
import {validateState,type State} from './model.ts';
import {observerView,visible} from './epistemics.ts';
import type {CheckRecord} from './actions.ts';
import type {Effect} from './simulation.ts';

import {turnClauseSchema,type ControlState,type TurnClause,type TurnTime} from './turn-contracts.ts';

export function controlState(s:State,actorId:string):ControlState{
 const overlay=s.entities.find(e=>!e.archived&&(e.kind==='combat'&&e.data.active||e.kind==='chase'&&e.data.status==='active')&&(e.data.participants as string[]).includes(actorId)&&visible(s,e,actorId));
 if(overlay){
  const order=(overlay.data.turnOrder as string[]).length?overlay.data.turnOrder as string[]:overlay.data.participants as string[];
  const acting=order[Number(overlay.data.turnIndex)];
  return {holder:acting===actorId?'PLAYER':'WORLD',reasonCode:overlay.kind.toUpperCase()+'_TURN',...(acting&&s.entities.some(e=>e.id===acting&&visible(s,e,actorId))?{actingEntityId:acting}:{})};
 }
 return {holder:'PLAYER',reasonCode:'AWAITING_INPUT',actingEntityId:actorId};
}
export function publicChecks(s:State,actorId:string,checks:CheckRecord[]){
 if(!checks.length)return [];
 const visibleIds=new Set(observerView(s,actorId).entities.map(e=>e.id));
 return checks.filter(check=>check.characterId===actorId&&check.provenance.visibility!=='HIDDEN').map(check=>{
  if(check.provenance.visibility==='PARTIAL')return {id:check.id,eventId:check.eventId,outcome:check.outcome};
  const {provenance,...fields}=check;
  return {...fields,modifiers:check.modifiers.filter(m=>!m.sourceId||visibleIds.has(m.sourceId)),provenance:{formula:provenance.formula,resolutionReason:provenance.resolutionReason,attribute:provenance.attribute,skill:provenance.skill&&visibleIds.has(String((provenance.skill as {id:string}).id))?provenance.skill:null}};
 });
}
const expectedBlockers=new Set(['entity_unavailable','target_not_present','item_not_possessed','insufficient_funds','vehicle_unavailable','vehicle_access_denied','character_restrained','character_cannot_act','use_combat_action_or_flee','shift_unavailable','target_not_observable','target_unavailable','matching_key_required','lockpick_required','tool_broken','object_has_no_opening','object_not_movable','throwable_item_required','object_too_heavy','container_required','invalid_container','container_locked','container_capacity','route_unavailable','route_locked','destination_unknown','destination_access_denied','destination_closed','vehicle_not_present','vehicle_disabled','vehicle_capacity','insufficient_fuel']);
export function resolveTurnPlan(s:State,actorId:string,rawClauses:TurnClause[],eventId:string,seed:string,registry:TurnRuleRegistry=existingTurnRules(),deferFinalValidation=false){
 ensure(rawClauses.length>0&&rawClauses.length<=8,400,'invalid_turn_plan');
 const clauses=rawClauses.map(clause=>turnClauseSchema.parse(clause));
 ensure(new Set(clauses.map(c=>c.clauseId)).size===clauses.length&&['NONE','CONDITIONAL'].includes(clauses[0]!.dependency),400,'invalid_turn_plan');
 const startClock=s.clock,effects:Effect[]=[],checks:CheckRecord[]=[],steps:Array<{clauseId:string;actionType:string;status:string;start:string;end:string;draws:number;seedRef:string;ownerSystem:string;stateDeltas?:unknown}>=[];
 let draws=0,previousSucceeded=true,interrupted=false;
 for(const [index,clause] of clauses.entries()){
  if(clause.dependency==='CONDITIONAL'){const condition=clause.condition;ensure(condition,400,'condition_required');const target=s.entities.find(e=>e.id===condition.targetId&&!e.archived&&visible(s,e,actorId));ensure(target,400,'target_unavailable');const value=condition.field==='open'?(target.data.mechanism as {open?:boolean}|null)?.open:target.data.locked;if(value!==condition.equals){interrupted=true;break;}}
  if(clause.dependency==='PREVIOUS_SUCCESS'&&!previousSucceeded){interrupted=true;break;}
  if(index&&controlState(s,actorId).reasonCode!=='AWAITING_INPUT'){interrupted=true;break;}
  // Each provider works on an isolated candidate. Only validated results reach the
  // transaction's staged state; exceptions cannot leave half a clause behind.
  // Game's persistence boundary validates the final candidate in the same transaction.
  const candidate=structuredClone(s),start=s.clock;
  const stepSeed=index?createHash('sha256').update(seed+':clause:'+index).digest('hex'):seed;
  const provider=registry.owner(clause.action.type);let result:RuleResolution;
  try{result=withTurnRuntime(stepSeed,eventId,candidate,provider.id,()=>provider.resolve(candidate,actorId,clause.action,eventId,stepSeed));if(!deferFinalValidation||index<clauses.length-1)validateState(candidate);}
  catch(error){
   if(index&&error instanceof Error&&expectedBlockers.has(error.message)){interrupted=true;break;}
   throw error;
  }
  if(!result.effects.length)result.effects.push({id:withTurnRuntime(stepSeed,eventId,candidate,provider.id,()=>simulationId()),text:'The attempt resolved.',observers:[],type:'resolution.applied',subjectId:actorId});
  for(const effect of result.effects){effect.occurredAt??=candidate.clock;effect.sourceSystem??=provider.id;effect.causeRefs??=[eventId];ensure(Date.parse(effect.occurredAt)>=Date.parse(start)&&Date.parse(effect.occurredAt)<=Date.parse(candidate.clock),500,'invalid_event_time');}
  const deltas=buildDeltas(s,candidate,0);validateDeltas(s,candidate,deltas,result.effects,deltas);authorizeDeltas(s,candidate,deltas,registry.permissions(clause.action.type));
  // Persist indexes into the batch's flattened event list, not each clause's local list.
  for(const delta of deltas)delta.causeEventIndex+=effects.length;
  Object.assign(s,candidate);effects.push(...result.effects);checks.push(...result.checks);draws+=result.draws;
  previousSucceeded=result.status==='SUCCEEDED';
  steps.push({clauseId:clause.clauseId,actionType:clause.action.type,status:result.status,ownerSystem:provider.id,stateDeltas:deltas,start,end:s.clock,draws:result.draws,seedRef:createHash('sha256').update(stepSeed).digest('hex')});
  if(result.status==='INTERRUPTED'||Boolean(s.npcBehavior?.actors.length)&&result.effects.some(e=>e.observers.includes(actorId)&&(e.dialogue?.requiresResponse&&e.dialogue.targetId===actorId||e.type==='npc.call'||e.requiresPlayerResponse===true))||result.effects.some(effect=>effect.type==='turn.interrupted'&&effect.observers.includes(actorId))){interrupted=true;break;}
 }
 const elapsedSeconds=(Date.parse(s.clock)-Date.parse(startClock))/1000;
 ensure(Number.isFinite(elapsedSeconds)&&elapsedSeconds>=0,500,'invalid_resolved_time');
 const timeDelta:TurnTime={kind:elapsedSeconds===0?'NONE':elapsedSeconds>=900?'COMPRESSED':'EXACT',start:startClock,end:s.clock,elapsedSeconds,policyRef:'existing-domain-duration-v1'};
 const permitted=observerEffects(s,effects,actorId);

 const control=interrupted?{holder:'PLAYER' as const,reasonCode:'PLAN_INTERRUPTED',actingEntityId:actorId}:controlState(s,actorId);
 const narration=permitted.map(effect=>effect.text).join('\n\n')||'The action resolved. No observer-visible change was recorded.';
 return {effects,checks,draws,steps,timeDelta,result:{narration,permitted,checks:publicChecks(s,actorId,checks),time:actionTime(clauses[0]!.action,elapsedSeconds/60),timeDelta,control,interrupted,completedClauses:steps.length}};
}
