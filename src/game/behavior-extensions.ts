import {actionSchema,data,getEntity,type State,type Action} from './model.ts';
import {behaviorActor,behaviorProfile,behaviorHash,behaviorId,publishBehaviorProfile,adaptBehavior,behaviorContinuationGate} from './behavior.ts';
import type {NpcProfile,BehaviorDecision,BehaviorActor} from './behavior-contracts.ts';
import {recordObservation} from './information.ts';
import {resolveAction} from './actions.ts';
import type {Effect} from './simulation.ts';

const registered=new Set(['look','inspect','physical','take','drop','give','buy','sell','consume','read-message','combat','attack','defend','flee','cover','tactical-move','restrain','escape-restraint','disarm','shove','surrender','ready-weapon','reload','phone-call','text','call-response','call-speak','chase','chase-action']);
const ownerBlockers=new Set(['entity_unavailable','target_not_present','item_not_possessed','insufficient_funds','character_restrained','character_cannot_act','target_not_observable','target_unavailable','matching_key_required','lockpick_required','tool_broken','object_has_no_opening','object_not_movable','throwable_item_required','object_too_heavy','container_required','invalid_container','container_locked','container_capacity','trait_choice_restricted','journey_in_progress','not_your_turn','combat_not_active','combat_action_unavailable','invalid_target','weapon_unavailable','parry_weapon_required','block_equipment_required','not_restrained','route_unavailable','route_locked','destination_unknown','destination_access_denied','destination_closed','technology_unavailable','system_disabled','phone_unavailable','contact_unknown','contact_blocked','line_busy','message_unavailable','call_unavailable','call_phone_mismatch','call_not_active','call_not_ringing','target_not_visible','line_of_fire_blocked','target_out_of_range','combat_unavailable','business_closed_or_unreachable','item_unavailable','item_not_owned','out_of_stock','payment_unavailable']);
const violent=new Set(['combat','attack','restrain','disarm','shove','chase']);
export function validateProviderActions(s:State,p:NpcProfile){
 const plans=data(getEntity(s,p.actorId,'character'),'character').plans,ids=new Set(plans.map(p=>p.id));
 for(const binding of p.providerActions){const action=actionSchema.parse(binding.action);if(!registered.has(action.type)||!plans.some(plan=>plan.id===binding.planId&&plan.type==='domain'))throw new Error('unregistered_npc_provider_action');if(violent.has(action.type)&&(binding.violence==='none'||!binding.causeKinds.length))throw new Error('behavior_violence_policy_required');for(const ref of actionReferences(action))getEntity(s,ref);for(const id of binding.resourceIds)getEntity(s,id);}
 for(const collection of [p.providerActions.map(x=>({id:x.planId})),p.routines,p.biases,p.cooldownBypasses,p.milestones,p.developments])if(new Set(collection.map(x=>x.id)).size!==collection.length)throw new Error('duplicate_behavior_rule');
 for(const routine of p.routines)if(new Set(routine.planIds).size!==routine.planIds.length||routine.planIds.some(id=>!ids.has(id)))throw new Error('invalid_behavior_routine');
 for(const bypass of p.cooldownBypasses)if(!ids.has(bypass.planId))throw new Error('behavior_plan_unavailable');
 for(const milestone of p.milestones)if(milestone.requiredGoalIds.some(id=>!s.npcBehavior?.actors.find(a=>a.actorId===p.actorId)?.goals.some(g=>g.id===id)))throw new Error('behavior_milestone_goal_unavailable');
 for(const development of p.developments)if(!p.adaptation.unlocked.includes(development.trait))throw new Error('behavior_trait_locked');
}
export function actionReferences(action:Action){return Object.entries(action).flatMap(([key,value])=>key.endsWith('Id')&&typeof value==='string'?[value]:key.endsWith('Ids')&&Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'):[]);}
export function recognizedBehaviorTarget(s:State,actorId:string,targetId:string){const target=s.entities.find(e=>e.id===targetId),identity=target?.kind==='character'?data(target,'character').identityDisclosure:null;return !identity?.concealed||identity.knownByIds.includes(actorId);}
export function providerCandidateGate(s:State,p:NpcProfile,planId:string,known:Set<string>){
 const binding=p.providerActions.find(b=>b.planId===planId);if(!binding)return 'PROVIDER_BINDING_MISSING';const action=actionSchema.parse(binding.action);
 if(p.boundaryPolicies.some(b=>b.action==='domain'&&b.permission==='refuse'&&(!b.targetId||actionReferences(action).includes(b.targetId))&&(!b.expiresAt||Date.parse(b.expiresAt)>Date.parse(s.clock))))return 'BOUNDARY_REFUSED';
 if([...actionReferences(action),...binding.resourceIds].some(id=>!known.has(id)))return 'REFERENCE_NOT_KNOWN';
 const combat=s.entities.find(e=>e.kind==='combat'&&e.data.active&&(e.data.participants as string[]).includes(p.actorId));if(combat&&['attack','defend','cover','tactical-move','restrain','escape-restraint','disarm','shove','ready-weapon','reload'].includes(action.type)){const c=data(combat,'combat');if((c.turnOrder.length?c.turnOrder:c.participants)[c.turnIndex]!==p.actorId)return 'NOT_YOUR_TURN';}
 if(violent.has(action.type)&&!s.information?.observations.some(o=>o.observerId===p.actorId&&Date.parse(o.at)<=Date.parse(s.clock)&&Date.parse(s.clock)-Date.parse(o.at)<=300000&&binding.causeKinds.includes(String(o.conditions.memoryKind??o.conditions.kind??''))))return 'PERCEIVED_VIOLENCE_CAUSE_REQUIRED';
 if('targetId' in action&&typeof action.targetId==='string'&&!recognizedBehaviorTarget(s,p.actorId,action.targetId)&&violent.has(action.type))return 'TARGET_IDENTIFICATION_REQUIRED';
 return 'ELIGIBLE';
}
export function expireBehaviorLeases(s:State){for(const lease of s.npcBehavior?.leases??[])if(lease.status==='ACTIVE'&&Date.parse(lease.expiresAt)<=Date.parse(s.clock))lease.status='EXPIRED';}
export function releaseBehaviorLeases(s:State,attemptId:string){for(const lease of s.npcBehavior?.leases??[])if(lease.attemptId===attemptId&&lease.status==='ACTIVE')lease.status='RELEASED';}
export function reserveBehaviorResources(s:State,actorId:string,attemptId:string,resourceIds:string[],seconds:number,eventId:string){
 expireBehaviorLeases(s);const leases=s.npcBehavior!.leases;
 for(const id of resourceIds){getEntity(s,id);if(leases.some(l=>l.resourceId===id&&l.attemptId!==attemptId&&l.status==='ACTIVE'))return false;}
 for(const resourceId of [...new Set(resourceIds)].sort())if(!leases.some(l=>l.attemptId===attemptId&&l.resourceId===resourceId&&l.status==='ACTIVE'))leases.push({id:behaviorId(attemptId,resourceId),actorId,attemptId,resourceId,expiresAt:new Date(Date.parse(s.clock)+seconds*1000).toISOString(),status:'ACTIVE',eventId});return true;
}
export function stageBehaviorDomain(s:State,d:BehaviorDecision,eventId:string){
 const a=behaviorActor(s,d.actorId),p=behaviorProfile(s,a.actorId)!,binding=p.providerActions.find(b=>b.planId===d.selectedPlanId)!;
 if(!binding||!d.attemptId)throw new Error('behavior_domain_binding_required');
 if(!reserveBehaviorResources(s,a.actorId,d.attemptId,binding.resourceIds,binding.reservationSeconds,eventId))return false;
 a.pendingDomain={decisionId:d.id,planId:binding.planId,resolveAt:new Date(Date.parse(s.clock)+binding.durationSeconds*1000).toISOString(),actionHash:behaviorHash(binding)};a.nextEvaluationAt=a.pendingDomain.resolveAt;return true;
}
export function resolveBehaviorDomain(s:State,a:BehaviorActor,eventId:string):{decision:BehaviorDecision;performed:boolean;effects:Effect[]}|null{
 const pending=a.pendingDomain;if(a.frozen||!pending||Date.parse(pending.resolveAt)>Date.parse(s.clock))return null;
 const decision=s.npcBehavior!.decisions.find(d=>d.id===pending.decisionId)!,p=behaviorProfile(s,a.actorId)!,binding=p.providerActions.find(b=>b.planId===pending.planId),attempt=a.attempts.find(t=>t.id===decision.attemptId)!;
 expireBehaviorLeases(s);
 const invalid=!binding||p.version!==attempt.profileVersion||behaviorHash(binding)!==pending.actionHash||data(getEntity(s,a.actorId,'character'),'character').condition!=='conscious'||p.boundaryPolicies.some(b=>b.action==='domain'&&b.permission==='refuse'&&(!b.targetId||!!binding&&actionReferences(actionSchema.parse(binding.action)).includes(b.targetId))&&(!b.expiresAt||Date.parse(b.expiresAt)>Date.parse(s.clock)));
 const continuation=invalid?'INVALIDATED':behaviorContinuationGate(s,a.actorId,pending.planId,eventId);
 if(continuation!=='ELIGIBLE'||s.npcBehavior!.leases.some(l=>l.attemptId===attempt.id&&l.status==='EXPIRED')){decision.providerReceipt={status:'BLOCKED',reason:continuation!=='ELIGIBLE'?continuation:'RESERVATION_EXPIRED'};releaseBehaviorLeases(s,attempt.id);a.pendingDomain=null;return {decision,performed:false,effects:[]};}
 const staged=structuredClone(s),clock=s.clock;
 let result:ReturnType<typeof resolveAction>;
 try{result=resolveAction(staged,a.actorId,actionSchema.parse(binding!.action),eventId,behaviorHash([decision.id,'provider']),{coordinatedNpc:true});if(staged.clock!==clock||result.time.minutes>binding!.durationSeconds/60)throw new Error('behavior_duration_insufficient');}
 catch(error){if(error instanceof Error&&ownerBlockers.has(error.message)){decision.providerReceipt={status:'BLOCKED',reason:error.message,seed:behaviorHash([decision.id,'provider']),draws:0};releaseBehaviorLeases(s,attempt.id);a.pendingDomain=null;return {decision,performed:false,effects:[]};}throw error;}
 decision.providerReceipt={status:result.status??'SUCCEEDED',seed:behaviorHash([decision.id,'provider']),draws:result.draws,checks:JSON.parse(JSON.stringify(result.checks)),resolvedAt:s.clock};
 // Copy owner roots back, retaining this transaction's behavioral object references.
 for(const entity of staged.entities){const old=s.entities.find(e=>e.id===entity.id);if(old)Object.assign(old,entity);else s.entities.push(entity);}
 const plan=data(getEntity(s,a.actorId,'character'),'character').plans.find(p=>p.id===pending.planId)!;const live=getEntity(s,a.actorId,'character');const character=data(live,'character');const updated=character.plans.find(p=>p.id===plan.id)!;updated.lastRun=s.clock;updated.runsToday++;if(result.status!=='FAILED')updated.failedAttempts=0;updated.lastOutcome=result.status==='FAILED'?'blocked':'performed';live.data=character;
 for(const key of ['facts','knowledge','beliefs','memories','information','canon'] as const)if(staged[key]!==undefined)(s as any)[key]=staged[key];
 // Handoffs follow actual owner-resolved initiative and ringing state.
 for(const e of s.entities){if(e.kind==='combat'&&e.data.active){const c=data(e,'combat'),next=(c.turnOrder.length?c.turnOrder:c.participants)[c.turnIndex],player=s.entities.find(e=>e.id===next&&e.data.playable);if(player&&c.participants.includes(a.actorId))result.effects.push({id:behaviorId(attempt.id,'combat-handoff'),type:'npc.combat.handoff',subjectId:e.id,text:'It is your turn in the conflict.',observers:[player.id],requiresPlayerResponse:true});}if(e.kind==='chase'&&e.data.status==='active'){const c=data(e,'chase'),next=c.turnOrder[c.turnIndex],player=s.entities.find(e=>e.id===next&&e.data.playable);if(player&&c.participants.includes(a.actorId))result.effects.push({id:behaviorId(attempt.id,'chase-handoff'),type:'npc.chase.handoff',subjectId:e.id,text:'You can respond to the pursuit.',observers:[player.id],requiresPlayerResponse:true});}if(e.kind==='message'&&e.data.sourceEventId===eventId&&e.data.fromId===a.actorId&&e.data.callState==='ringing'){const recipient=s.entities.find(r=>r.id===e.data.toId&&r.data.playable);if(recipient)result.effects.push({id:behaviorId(attempt.id,'call-handoff',e.id),type:'npc.call',subjectId:e.id,text:'Your phone is ringing. No answer has been supplied.',observers:[recipient.id],requiresPlayerResponse:true});}}
 for(const effect of result.effects)if(effect.observers.includes(a.actorId))recordObservation(s,{id:behaviorId(attempt.id,effect.id,'observed'),observerId:a.actorId,eventId,at:s.clock,locationId:data(getEntity(s,a.actorId,'character'),'character').locationId,channel:'vision',targetId:null,raw:effect.text,clarity:1,confidence:1,attention:'focused',conditions:{resolver:'npc-domain',outcome:result.status??'SUCCEEDED'},recognition:'unidentified',recognizedAsId:null,salience:0.7,propositionIds:[]});
 releaseBehaviorLeases(s,attempt.id);a.pendingDomain=null;return {decision,performed:result.status!=='FAILED',effects:result.effects};
}
export function bypassBehaviorCooldown(s:State,p:NpcProfile,a:BehaviorActor,planId:string,startedAt:string){
 for(const rule of p.cooldownBypasses.filter(b=>b.planId===planId)){const o=s.information?.observations.find(o=>o.observerId===a.actorId&&Date.parse(o.at)>Date.parse(startedAt)&&Date.parse(o.at)<=Date.parse(s.clock)&&String(o.conditions.memoryKind??o.conditions.kind??'')===rule.observationKind&&!a.bypasses.some(b=>b.sourceId===o.id&&b.ruleId===rule.id));if(o){a.bypasses.push({ruleId:rule.id,sourceId:o.id,at:s.clock});return true;}}return false;
}
export function applyBehaviorDevelopments(s:State,actorId:string,eventId:string){
 const a=behaviorActor(s,actorId),p=behaviorProfile(s,actorId)!;
 for(const rule of p.developments){const sources=(s.information?.observations??[]).filter(o=>o.observerId===actorId&&String(o.conditions.memoryKind??o.conditions.kind??'')===rule.observationKind&&!a.adaptations.some(r=>r.sourceIds.includes(o.id))).map(o=>o.id);if(sources.length>=Math.max(rule.minimumEvidence,p.adaptation.minimumEvidence))adaptBehavior(s,actorId,rule.trait,rule.delta,sources.slice(0,100),behaviorId(eventId,rule.id));}
 for(const milestone of p.milestones){if(a.milestoneHistory.some(m=>m.id===milestone.id))continue;const goals=milestone.requiredGoalIds.map(id=>a.goals.find(g=>g.id===id)),sources=[...new Set(goals.flatMap(g=>g?.evidenceEventIds??[]))];if(goals.some(g=>g?.status!=='SATISFIED')||sources.length<milestone.minimumEvidence)continue;
 const current=behaviorProfile(s,actorId)!,from=current.traits[milestone.trait]??500,to=Math.max(0,Math.min(1000,from+milestone.delta)),version='milestone-'+behaviorId(actorId,milestone.id);publishBehaviorProfile(s,{...current,version,traits:{...current.traits,[milestone.trait]:to}},eventId,'Published development milestone '+milestone.id);a.baseline[milestone.trait]=to;a.milestoneHistory.push({id:milestone.id,eventId,profileVersion:version,sourceIds:sources});}
}
