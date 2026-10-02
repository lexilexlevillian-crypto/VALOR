import {skillStatus} from '../../public/creation-rules.js';
import {createHash,randomUUID} from 'node:crypto';
import {data,getEntity,validateEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {fact,observe,remember} from './epistemics.ts';
import {matchesCondition} from './conditions.ts';
import {advanceLifecycle,startNpcJourney,finishNpcJourney} from './lifecycle.ts';
import {authoredCompatibility} from './compatibility.ts';
import {campaignRelationshipSafety,expireConsentRequests,isRomanceIntent,openConsentRequest,respondToConsentRequest,romanceEligibility} from './romance.ts';
import {acceptsCommunication,communicationDelayMinutes,conversationThread,phonePowered,recipientPhone} from './phone.ts';
import {injuryRate,needsRate} from './policy.ts';
import {resolveTraitEffects,socialPresentationDescriptors} from './traits.ts';
import {applyRelationshipMovement,decayReputations,recordRelationshipHistory,relationshipBehaviorSignal} from './social.ts';
import {carriedBy,itemPossessor} from './items.ts';
export type Effect={id:string;text:string;observers:string[];type:string;subjectId:string};
export const simulationTiers={
 active:{
  updateFrequencyMinutes:1,
  deterministicInputs:['scene location','current action/event','needs and injuries','schedule boundary','eligible goal plans','known facts and capabilities'],
  permittedOutputs:['state changes','witnessed effects','supported facts/memories/evidence','meaningful decision point'],
  escalationCondition:'Already in the player scene; request authored/AI reasoning only for a consequential ambiguous decision.'
 },
 relevant:{
  updateFrequencyMinutes:15,
  deterministicInputs:['nearby topology','active event references','phone contact','relationship/faction conflict','schedule','eligible goal plans','known facts and capabilities'],
  permittedOutputs:['bounded goal action','travel/message/call','relationship or faction interaction','supported event/memory/evidence','promotion to active'],
  escalationCondition:'Promote when entering the player scene; request authored/AI reasoning only when a material plan cannot be resolved deterministically.'
 },
 distant:{
  updateFrequencyMinutes:60,
  deterministicInputs:['schedule boundaries','goal priority/constraints/expiry/fallback','last simulated state','authored events'],
  permittedOutputs:['worked shift','traveled home','called friend','argument occurred','missed appointment','other explicitly supported goal outcomes'],
  escalationCondition:'Promote when near the player, named by an active event, contacted by phone, involved in a relationship/faction conflict, or otherwise materially relevant.'
 }
} as const;
export type SimulationTier=keyof typeof simulationTiers;
const deterministicUuid=(seed:string):ReturnType<typeof randomUUID>=>{
 const hex=createHash('sha256').update(seed).digest('hex').slice(0,32);
 return (hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20)) as ReturnType<typeof randomUUID>;
};
export function npcSimulationTier(s:State,npcId:string,playerId:string,effects:Effect[]=[]):{tier:SimulationTier;reason:string}{
 const npc=s.entities.find(entity=>entity.id===npcId&&entity.kind==='character'&&!entity.archived),player=s.entities.find(entity=>entity.id===playerId&&entity.kind==='character'&&!entity.archived);
 if(!npc||npc.data.playable||!player)return {tier:'distant',reason:'not currently material'};
 if(npc.data.locationId&&npc.data.locationId===player.data.locationId)return {tier:'active',reason:'in the player scene'};
 const playerLocation=player.data.locationId?s.entities.find(entity=>entity.id===player.data.locationId&&entity.kind==='location'&&!entity.archived):null;
 const npcLocation=npc.data.locationId?s.entities.find(entity=>entity.id===npc.data.locationId&&entity.kind==='location'&&!entity.archived):null;
 if((playerLocation&&data(playerLocation,'location').exits.some(exit=>exit.to===npc.data.locationId))||(npcLocation&&data(npcLocation,'location').exits.some(exit=>exit.to===player.data.locationId)))return {tier:'relevant',reason:'near the player'};
 if(effects.some(effect=>effect.subjectId===npc.id))return {tier:'relevant',reason:'named by an active event'};
 const recentContact=s.entities.some(entity=>entity.kind==='message'&&!entity.archived&&((entity.data.fromId===npc.id&&entity.data.toId===player.id)||(entity.data.toId===npc.id&&entity.data.fromId===player.id))&&(entity.data.callState==='ringing'||entity.data.callState==='active'||Date.parse(String(entity.data.at))>=Date.parse(s.clock)-2*60*60000));
 if(recentContact)return {tier:'relevant',reason:'contacted by phone'};
 const relationshipConflict=s.entities.some(entity=>entity.kind==='relationship'&&!entity.archived&&(entity.data.fromId===npc.id||entity.data.toId===npc.id)&&(entity.data.pending||Number(entity.data.resentment)>=50||Number(entity.data.fear)>=50||Number(entity.data.jealousy)>=50));
 if(relationshipConflict)return {tier:'relevant',reason:'involved in a relationship conflict'};
 const factionConflict=s.entities.some(entity=>entity.kind==='faction'&&!entity.archived&&(entity.data.memberIds as string[]).includes(npc.id)&&Object.values(entity.data.reputation as Record<string,number>).some(value=>value<0));
 if(factionConflict)return {tier:'relevant',reason:'involved in a faction conflict'};
 const materiallyReferenced=s.entities.some(entity=>!entity.archived&&(entity.kind==='quest'&&entity.data.status==='active'&&entity.data.characterId===npc.id||entity.kind==='watcher'&&!entity.data.fired&&(entity.data.subjectId===npc.id||entity.data.targetId===npc.id)));
 if(materiallyReferenced||(npc.data.plans as Array<{targetId:string;enabled:boolean}>).some(plan=>plan.enabled&&plan.targetId===player.id)||(npc.data.goals as string[]).length)return {tier:'relevant',reason:'materially relevant to an active goal or event'};
 return {tier:'distant',reason:'schedule-only catch-up'};
}
function recordNpcActivity(s:State,npc:Entity,d:Data<'character'>,eventId:string,outcome:Data<'character'>['activityTimeline'][number]['outcome'],source:Data<'character'>['activityTimeline'][number]['source'],sourceEntityId:string|null,summary:string,at=s.clock){
 const tier=d.simulationTier,id=deterministicUuid([eventId,npc.id,at,outcome,source,sourceEntityId??'',d.activityTimeline.length].join('|'));
 if(d.activityTimeline.some(entry=>entry.id===id))return;
 d.activityTimeline.push({id,at,tier,outcome,source,sourceEntityId,summary,eventId});
 if(d.activityTimeline.length>s.settings.npcTimelineLimit)d.activityTimeline.splice(0,d.activityTimeline.length-s.settings.npcTimelineLimit);
}
export function emit(effects:Effect[],text:string,observers:string[],type:string,subjectId:string){effects.push({id:randomUUID(),text,observers:[...new Set(observers)],type,subjectId});}
export function atLocation(s:State,locationId:string|null){return s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.locationId===locationId&&locationId&&e.data.condition==='conscious');}
export function add(s:State,kind:Entity['kind'],name:string,raw:Record<string,unknown>,visibility:Entity['visibility']='knowledge'){
 const entity=validateEntity({id:randomUUID(),kind,name,visibility,data:raw});s.entities.push(entity);return entity;
}
const traitTrace=(character:Data<'character'>,rows:Array<{traitId:string;effectId:string;type:string;value:number}>,target:string,decision:string,at:string)=>{
 for(const row of rows)character.traitEffectTrace.push({at,traitId:row.traitId,effectId:row.effectId,type:row.type as 'schedule-priority'|'ai-priority'|'need-rate'|'first-impression',target,value:row.value,decision});
 if(character.traitEffectTrace.length>500)character.traitEffectTrace.splice(0,character.traitEffectTrace.length-500);
};
const timeFormatters=new Map<string,Intl.DateTimeFormat>();
export function timeParts(at:string,timezone:string){
 let formatter=timeFormatters.get(timezone);
 if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'});if(timeFormatters.size>32)timeFormatters.clear();timeFormatters.set(timezone,formatter);}
 const p=formatter.formatToParts(new Date(at));
 const val=(key:string)=>p.find(x=>x.type===key)!.value;
 return {minute:Number(val('hour'))*60+Number(val('minute')),day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(val('weekday')),date:val('year')+'-'+val('month')+'-'+val('day')};
}
export function isOpen(hours:{opens:number;closes:number}|null,s:State){
 if(!hours)return true;const h=Math.floor(timeParts(s.clock,s.settings.timezone).minute/60);
 if(hours.opens===hours.closes)return true;
 return hours.closes>hours.opens?h>=hours.opens&&h<hours.closes:h>=hours.opens||h<hours.closes;
}
export function advance(s:State,minutes:number,eventId:string,effects:Effect[],playerId:string){
 if(s.settings.deterministicCatchup&&minutes>1){
  const cost=minutes*Math.max(1,s.entities.filter(e=>!e.archived&&['character','watcher','production','transition','socialRule'].includes(e.kind)).length);
  if(cost>s.settings.npcCatchupWorkBudget)throw new Error('catchup_work_budget_exceeded_use_shorter_wait');
  for(let minute=0;minute<minutes;minute++)advanceStep(s,1,eventId,effects,playerId);
 }else advanceStep(s,minutes,eventId,effects,playerId);
}
function advanceStep(s:State,minutes:number,eventId:string,effects:Effect[],playerId:string){
 const start=Date.parse(s.clock),end=start+minutes*60000,npcs=s.entities.filter(e=>e.kind==='character'&&!e.archived&&!e.data.playable);
 if(npcs.length>s.settings.npcBudget)throw new Error('npc_budget_exceeded');
 const slots:{at:number;minute:number;day:number}[]=[];
 if(npcs.some(n=>Array.isArray(n.data.schedule)&&n.data.schedule.length))for(let t=start+60000;t<=end;t+=60000){const p=timeParts(new Date(t).toISOString(),s.settings.timezone);slots.push({at:t,minute:p.minute,day:p.day});}
 // Exact schedule boundary catch-up. No AI calls; a near/active NPC produces more observable detail.
 for(const npc of npcs){
  const d=data(npc,'character'),classification=npcSimulationTier(s,npc.id,playerId,effects);d.simulationTier=classification.tier;d.simulationTierReason=classification.reason;
  if(d.condition==='dead')continue;
  let previousLocation=d.locationId;
  for(const parts of slots){
   if(!d.schedule.length)break;
   if(s.settings.npcRouteTravel)finishNpcJourney(s,npc,d,parts.at,eventId,effects);
   const due=d.schedule.filter(x=>x.minute===parts.minute&&x.days.includes(parts.day)).map(entry=>{const resolution=resolveTraitEffects(s,npc.id,'schedule-priority',{planType:entry.activity,context:entry.activity});return {entry,resolution,priority:resolution.applied.reduce((sum,effect)=>sum+effect.value,0)};}).sort((a,b)=>b.priority-a.priority||a.entry.id.localeCompare(b.entry.id));
   for(const scheduled of due){const entry=scheduled.entry,location=getEntity(s,entry.locationId,'location');
    traitTrace(d,scheduled.resolution.applied,entry.activity,'schedule selected at priority '+scheduled.priority,new Date(parts.at).toISOString());
    if(d.condition!=='conscious'){if(entry.required)recordNpcActivity(s,npc,d,eventId,'missed-appointment','schedule',location.id,'Missed '+entry.activity+' because the NPC could not attend.',new Date(parts.at).toISOString());continue;}
    if(s.settings.npcRouteTravel){if(d.locationId===location.id)d.activity=entry.activity;else startNpcJourney(s,npc,d,location.id,parts.at,entry.activity);continue;}
    d.locationId=location.id;d.activity=entry.activity;
    if(entry.kind==='travel-home'&&location.id===d.homeId&&previousLocation!==location.id)recordNpcActivity(s,npc,d,eventId,'traveled-home','schedule',location.id,'Traveled home according to schedule.',new Date(parts.at).toISOString());
    const observers=atLocation(s,location.id).filter(e=>e.data.playable).map(e=>e.id);
    if(observers.length)emit(effects,npc.name+' arrives and begins '+entry.activity+'.',observers,'npc.schedule',npc.id);
   }
  }
  if(s.settings.npcRouteTravel)finishNpcJourney(s,npc,d,end,eventId,effects);
  d.lastSimulated=new Date(end).toISOString();npc.data=d as Entity['data'];npc.revision++;
  if(previousLocation!==d.locationId)fact(s,npc.id,'location',d.locationId,eventId,atLocation(s,d.locationId).map(e=>e.id));
 }
 s.clock=new Date(end).toISOString();
 decayReputations(s);
 for(const relation of s.entities.filter(entity=>entity.kind==='relationship'&&!entity.archived))expireConsentRequests(s,relation);
 const weather=s.settings.weatherSchedule.filter(w=>Date.parse(w.at)<=end).sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
 if(weather)s.settings.weather=weather.weather;
 for(const entity of s.entities.filter(e=>e.kind==='message'&&!e.archived&&e.data.callState==='ringing')){
  if(end-Date.parse(String(entity.data.at))>=s.settings.communications.ringSeconds*1000){entity.data.callState='missed';entity.data.endedAt=s.clock;}
 }
 for(const entity of s.entities.filter(e=>e.kind==='message'&&!e.archived&&['queued','sent'].includes(String(e.data.status)))){
  const message=data(entity,'message');
  if(!message.toId)continue;const receiver=message.recipientPhoneId?s.entities.find(candidate=>candidate.id===message.recipientPhoneId&&!candidate.archived)??null:recipientPhone(s,message.toId,message.toNumber,message.medium);
  if(receiver&&receiver.kind==='item'){
   if(!acceptsCommunication(receiver,message.fromId,message.medium)){message.status='failed';message.failureReason='blocked';entity.data=message as Entity['data'];continue;}
   message.recipientPhoneId=receiver.id;if(!message.availableAt)message.availableAt=new Date(Date.parse(message.sentAt??message.at)+communicationDelayMinutes(s,getEntity(s,message.phoneId,'item'),receiver)*60000).toISOString();message.status='sent';
   if(Date.parse(message.availableAt)>end){entity.data=message as Entity['data'];continue;}
   message.status='delivered';message.deliveredAt=s.clock;message.receivedAt=s.clock;entity.data=message as Entity['data'];
   for(const f of s.facts.filter(f=>f.subjectId===entity.id&&f.predicate==='communication'))observe(s,message.toId,f.id,'delivered:'+entity.id);
   if(message.body)s.beliefs.push({id:randomUUID(),observerId:message.toId,proposition:message.body,confidence:0.5,source:'message:'+entity.id,at:s.clock,correctedBy:null});
  }
 }
 const needsMultiplier=needsRate(s),injuryMultiplier=injuryRate(s);
 for(const character of s.entities.filter(e=>e.kind==='character'&&!e.archived)){
  const d=data(character,'character'),priorCondition=d.condition;if(d.condition==='dead')continue;
  if(s.settings.healthRules){const rules=s.settings.healthRules;
   d.intoxication=Math.max(0,d.intoxication-rules.soberingPerHour*minutes/60);
   if(d.dependence>0&&d.lastDoseAt)d.withdrawal=Math.min(100,d.withdrawal+rules.withdrawalPerDay*minutes/1440*d.dependence/100);
  }
  if(s.settings.needs&&needsMultiplier>0){
   const rate=(need:'hunger'|'thirst'|'fatigue'|'hygiene')=>{const resolution=resolveTraitEffects(s,character.id,'need-rate',{need,context:'time-passage'});traitTrace(d,resolution.applied,need,'need rate applied',s.clock);const skillRate=need==='fatigue'?Math.min(0,...s.entities.filter(e=>e.kind==='skill'&&!e.archived&&Object.hasOwn(d.skills,e.id)).map(e=>skillStatus(e,d.skills[e.id]!).fatigueRate)):0;return Math.max(0,1+skillRate+resolution.applied.reduce((sum,effect)=>sum+effect.value,0));};
   d.hunger=Math.min(100,d.hunger+minutes/60*needsMultiplier*rate('hunger'));d.thirst=Math.min(100,d.thirst+minutes/30*needsMultiplier*rate('thirst'));d.fatigue=Math.min(100,d.fatigue+minutes/120*needsMultiplier*rate('fatigue'));d.hygiene=Math.max(0,d.hygiene-minutes/240*needsMultiplier*rate('hygiene'));
  }
  const wounds=s.entities.filter(e=>e.kind==='injury'&&!e.archived&&e.data.characterId===character.id);
  for(const wound of wounds){
   const injury=data(wound,'injury');
   if(s.settings.healthRules&&!injury.treated&&!injury.permanent){
    injury.infection=Math.min(100,injury.infection+s.settings.healthRules.infectionPerDay*minutes/1440*injuryMultiplier);
    injury.severity=Math.min(100,injury.severity+s.settings.healthRules.untreatedSeverityPerDay*minutes/1440*injuryMultiplier);
   }
   if(s.settings.rules){
    d.blood=Math.max(0,d.blood-injury.bleeding*s.settings.rules.bleedPerMinute*minutes*injuryMultiplier);
    if(injury.treated&&!injury.permanent){injury.severity=Math.max(0,injury.severity-s.settings.rules.recoveryPerDay*minutes/1440);if(injury.severity===0)wound.archived=true;}
   }
   wound.data=injury as Entity['data'];
  }
  if(d.blood<=0){d.condition='dead';const observers=atLocation(s,d.locationId).map(e=>e.id);fact(s,character.id,'death',{at:s.clock},eventId,observers);emit(effects,character.name+' has died.',observers,'death',character.id);
   const remains=add(s,'item','Remains of '+character.name,{category:'container',locationId:d.locationId,capacity:100000,provenance:eventId,deceasedId:character.id},'campaign');
   for(const item of s.entities.filter(e=>e.kind==='item'&&!e.archived&&itemPossessor(s,e)===character.id)){item.data.possessorId=null;item.data.locationId=null;item.data.containerId=remains.id;item.data.equipped=false;item.data.wearState='stowed';}
  }else if(d.blood<20)d.condition='unconscious';
  if(!d.playable&&priorCondition!==d.condition){if(d.condition==='dead')recordNpcActivity(s,character,d,eventId,'killed','health',wounds[0]?.id??null,'Died from simulated injuries.');else if(d.condition==='unconscious')recordNpcActivity(s,character,d,eventId,'injured','health',wounds[0]?.id??null,'Became unconscious from simulated injuries.');}
  character.data=d as Entity['data'];
 }
 for(const q of s.entities.filter(e=>e.kind==='quest'&&!e.archived&&e.data.status==='active')){const d=data(q,'quest');if(d.deadline&&Date.parse(d.deadline)<=end){d.status='expired';q.data=d as Entity['data'];emit(effects,'An unresolved situation has expired: '+q.name,d.characterId?[d.characterId]:[],'quest.expired',q.id);}}
 const watchers=s.entities.filter(e=>e.kind==='watcher'&&!e.archived).sort((a,b)=>Number(b.data.priority)-Number(a.data.priority)||a.id.localeCompare(b.id));
 const firedGroups=new Set<string>();
 for(const watcher of watchers){
  const w=data(watcher,'watcher');
  if(w.conflictGroup&&firedGroups.has(w.conflictGroup))continue;
  if(w.once&&w.fired||w.expiresAt&&Date.parse(w.expiresAt)<end||w.lastFired&&end-Date.parse(w.lastFired)<w.cooldownMinutes*60000)continue;
  const subject=w.subjectId?s.entities.find(e=>e.id===w.subjectId&&!e.archived):null;
  const matches=w.trigger==='time'?!!w.dueAt&&Date.parse(w.dueAt)<=end:
   w.trigger==='location'?subject?.data.locationId===w.targetId:
   w.trigger==='item'?subject?.data.ownerId===w.targetId:
   w.trigger==='health'?Number(subject?.data.blood)<=w.threshold:
   w.trigger==='relationship'?Number(subject?.data.trust)>=w.threshold:
   w.trigger==='quest'?subject?.data.status==='active':
   s.knowledge.some(k=>k.observerId===w.subjectId&&s.facts.some(f=>f.id===k.factId&&f.subjectId===w.targetId));
  const compound=w.conditions.map(c=>matchesCondition(s,c));
  if(!matches||compound.length&&!(w.conditionMode==='all'?compound.every(Boolean):compound.some(Boolean)))continue;
  const target=w.targetId?s.entities.find(e=>e.id===w.targetId&&!e.archived):null;
  if(w.effect==='activate-quest'||w.effect==='fail-quest'){if(target?.kind!=='quest')throw new Error('watcher_target_invalid');target.data.status=w.effect==='activate-quest'?'active':'failed';}
  if(w.effect==='reveal-lore'){if(!target||!w.subjectId)throw new Error('watcher_target_invalid');const id=fact(s,target.id,'discovered',true,eventId,[w.subjectId]);observe(s,w.subjectId,id,'watcher:'+watcher.id);}
  if(w.effect==='npc-offer'&&w.subjectId){emit(effects,watcher.name+': '+w.description,[w.subjectId],'npc.offer',watcher.id);remember(s,w.subjectId,w.description,eventId);}
  w.fired=true;w.lastFired=s.clock;watcher.data=w as Entity['data'];
  if(w.conflictGroup)firedGroups.add(w.conflictGroup);
  emit(effects,'Watcher fired: '+watcher.name,[],'watcher.fired',watcher.id);
 }
 // Offscreen NPC interaction records remain directional and private unless explicitly revealed.
 for(const entity of s.entities.filter(e=>e.kind==='faction'&&!e.archived)){
  const f=data(entity,'faction');if(!f.groupPolicy||!f.leaderId)continue;
  const previous=f.lastGroupAt?Date.parse(f.lastGroupAt):start,steps=Math.floor((end-previous)/(f.groupPolicy.intervalMinutes*60000));
  if(!f.lastGroupAt){f.lastGroupAt=new Date(start).toISOString();entity.data=f as Entity['data'];}
  if(steps<1)continue;
  const leader=getEntity(s,f.leaderId,'character');
  if(leader.data.playable||leader.data.condition!=='conscious'||!leader.data.locationId)continue;
  const present=f.memberIds.map(id=>getEntity(s,id,'character')).filter(member=>member.id!==leader.id&&!member.data.playable&&member.data.condition==='conscious'&&member.data.locationId===leader.data.locationId).sort((a,b)=>a.id.localeCompare(b.id));
  if(!present.length)continue;
  f.cohesion=Math.max(0,Math.min(100,f.cohesion+steps*f.groupPolicy.cohesionStep));
  const known=s.knowledge.filter(k=>k.observerId===leader.id&&s.facts.some(fact=>fact.id===k.factId&&!fact.retiredAt));
  const rumors=s.beliefs.filter(belief=>belief.observerId===leader.id&&belief.truthStatus!=='disproven').sort((a,b)=>a.id.localeCompare(b.id)).slice(0,f.groupPolicy.rumorLimit);
  for(const member of present){
   if(f.groupPolicy.shareMood)member.data.mood=leader.data.mood!;
   if(f.groupPolicy.shareKnowledge)for(const k of known)observe(s,member.id,k.factId,'group-contact:'+entity.id);
   if(f.groupPolicy.shareRumors)for(const rumor of rumors)if(!s.beliefs.some(belief=>belief.observerId===member.id&&belief.proposition===rumor.proposition&&belief.source==='group-rumor:'+entity.id))s.beliefs.push({...rumor,id:deterministicUuid(entity.id+'|'+member.id+'|'+rumor.id+'|'+s.clock),observerId:member.id,confidence:Math.max(0,rumor.confidence*0.8),source:'group-rumor:'+entity.id,at:s.clock,correctedBy:null});
  }
  if(f.cohesion<=f.groupPolicy.conflictThreshold){
   const member=present[0]!,leaderData=data(leader,'character'),memberData=data(member,'character');
   let relation=s.entities.find(candidate=>candidate.kind==='relationship'&&!candidate.archived&&candidate.data.fromId===leader.id&&candidate.data.toId===member.id);
   if(!relation)relation=add(s,'relationship',leader.name+' → '+member.name,{fromId:leader.id,toId:member.id,secret:true,disclosure:'secret',knownByIds:[leader.id]},'knowledge');
   const relationship=data(relation,'relationship');
   if(!relationship.history.some(entry=>entry.label==='faction argument'&&entry.at.slice(0,10)===s.clock.slice(0,10))){applyRelationshipMovement(s,relation,eventId,'faction argument',{resentment:25},leader.id,[entity.id]);recordNpcActivity(s,leader,leaderData,eventId,'argument-occurred','faction',entity.id,'Argued during low-cohesion faction contact.');recordNpcActivity(s,member,memberData,eventId,'argument-occurred','faction',entity.id,'Argued during low-cohesion faction contact.');}
  }
  f.lastGroupAt=new Date(previous+steps*f.groupPolicy.intervalMinutes*60000).toISOString();entity.data=f as Entity['data'];
  emit(effects,'Authored group contact: '+entity.name,[],'npc.group',entity.id);
 }
 for(const r of s.entities.filter(e=>e.kind==='relationship'&&!e.archived)){
  const d=data(r,'relationship'),from=getEntity(s,d.fromId,'character'),to=getEntity(s,d.toId,'character');
  if(from.data.playable||to.data.playable||from.data.locationId!==to.data.locationId||!from.data.locationId||from.data.condition!=='conscious'||to.data.condition!=='conscious')continue;
  if(!d.history.some(h=>h.label==='routine contact'&&h.at.slice(0,10)===s.clock.slice(0,10)))recordRelationshipHistory(s,r,eventId,'routine contact','routine',d.fromId,'private');
 }
 // Bounded deterministic planning; all voluntary actions belong to NPCs.
 let initiatives=0;
 for(const npc of npcs){
  if(initiatives>=s.settings.npcInitiativeBudget)break;
  const d=data(npc,'character');if(d.condition!=='conscious')continue;
  const classification=npcSimulationTier(s,npc.id,playerId,effects),tier=classification.tier;d.simulationTier=tier;d.simulationTierReason=classification.reason;
  const minInterval=simulationTiers[tier].updateFrequencyMinutes;
  const plans=[...d.plans].filter(p=>p.enabled).map(plan=>{const resolution=resolveTraitEffects(s,npc.id,'ai-priority',{planType:plan.type,context:plan.type}),target=s.entities.find(entity=>entity.id===plan.targetId&&!entity.archived),socialTarget=target?.kind==='character'?target.id:target?.kind==='relationship'&&target.data.fromId===npc.id?String(target.data.toId):null;return {plan,resolution,priority:plan.priority+resolution.applied.reduce((sum,effect)=>sum+effect.value,0)+(socialTarget?relationshipBehaviorSignal(s,npc.id,socialTarget,plan.type):0)};}).sort((a,b)=>b.priority-a.priority||a.plan.id.localeCompare(b.plan.id));
  for(const candidate of plans){const plan=candidate.plan;
   if(d.preferences[plan.type]==='off')continue;
   if(!plan.conditions.every(c=>matchesCondition(s,c)))continue;
   if(!plan.lastRun)plan.lastRun=new Date(start).toISOString();
   const interval=Math.max(minInterval,plan.cooldownMinutes),previous=Date.parse(plan.lastRun);
   const due=Math.floor((end-previous)/(interval*60000));if(due<1)continue;
   const date=timeParts(s.clock,s.settings.timezone).date;if(plan.runDate!==date){plan.runDate=date;plan.runsToday=0;}
   const fail=(outcome:'blocked'|'expired')=>{plan.failedAttempts++;plan.lastOutcome=outcome;plan.lastRun=s.clock;if(plan.fallback==='disable'||outcome==='expired')plan.enabled=false;};
   if(plan.expiresAt&&Date.parse(plan.expiresAt)<=end){fail('expired');if(plan.fallback==='next-plan')continue;break;}
   if(plan.runsToday>=plan.maxRunsPerDay)continue;
   if(!plan.constraints.every(c=>matchesCondition(s,c))){fail('blocked');if(plan.fallback==='next-plan')continue;break;}
   const target=s.entities.find(e=>e.id===plan.targetId&&!e.archived);if(!target){fail('blocked');if(plan.fallback==='next-plan')continue;break;}
   const observers=atLocation(s,d.locationId).filter(e=>e.data.playable).map(e=>e.id);
   let performed=false,activityOutcome:Data<'character'>['activityTimeline'][number]['outcome']|null=null,activitySummary='',secondaryOutcome:Data<'character'>['activityTimeline'][number]['outcome']|null=null,secondarySummary='';
   if(plan.type==='message'&&target.kind==='character'&&plan.text){
    const device=s.entities.find(e=>e.kind==='item'&&!e.archived&&carriedBy(s,e,npc.id)&&phonePowered(e)&&(e.data.contacts as {characterId:string|null;blocked?:boolean}[]).some(c=>c.characterId===target.id&&!c.blocked));
    if(device){const receiver=recipientPhone(s,target.id,'','sms'),delay=communicationDelayMinutes(s,device,receiver);
     const message=add(s,'message','Message from '+npc.name,{fromId:npc.id,toId:target.id,phoneId:device.id,recipientPhoneId:receiver?.id??null,fromNumber:String(device.data.phoneNumber??''),toNumber:String(receiver?.data.phoneNumber??''),participants:[npc.id,target.id],threadId:conversationThread(s,npc.id,target.id,String(receiver?.data.phoneNumber??'')),medium:'sms',body:plan.text,at:s.clock,sentAt:s.clock,availableAt:new Date(Date.parse(s.clock)+delay*60000).toISOString(),status:receiver?'sent':'queued',sourceEventId:eventId},'owner');
     if(device.data.batteryRequired)device.data.battery=Math.max(0,Number(device.data.battery)-1);fact(s,message.id,'communication',{fromId:npc.id,toId:target.id,medium:'sms'},eventId,[npc.id]);performed=true;activityOutcome='message-sent';activitySummary='Queued a supported phone message to '+target.name+'.';
    }
   }
   if(plan.type==='call'&&target.kind==='character'){
    const device=s.entities.find(e=>e.kind==='item'&&!e.archived&&carriedBy(s,e,npc.id)&&phonePowered(e)&&(e.data.contacts as {characterId:string|null;blocked?:boolean}[]).some(c=>c.characterId===target.id&&!c.blocked));
    const receiver=recipientPhone(s,target.id,'','call');
    if(device){const accepted=receiver&&acceptsCommunication(receiver,npc.id,'call'),call=add(s,'message','Call from '+npc.name,{fromId:npc.id,toId:target.id,phoneId:device.id,recipientPhoneId:receiver?.id??null,fromNumber:String(device.data.phoneNumber??''),toNumber:String(receiver?.data.phoneNumber??''),participants:[npc.id,target.id],threadId:conversationThread(s,npc.id,target.id,String(receiver?.data.phoneNumber??'')),medium:'call',body:'',at:s.clock,sentAt:s.clock,deliveredAt:accepted?s.clock:null,receivedAt:accepted?s.clock:null,status:accepted?'delivered':'failed',callState:accepted?'ringing':'missed',endedAt:accepted?null:s.clock,sourceEventId:eventId,failureReason:accepted?'':'recipient-unavailable'},'owner');if(device.data.batteryRequired)device.data.battery=Math.max(0,Number(device.data.battery)-1);fact(s,call.id,'call-started',{fromId:npc.id,toId:target.id},eventId,accepted?[npc.id,target.id]:[npc.id]);if(accepted)emit(effects,npc.name+' is calling. No answer has been supplied.',target.data.playable?[target.id]:observers,'npc.call',call.id);performed=true;activityOutcome='called-friend';activitySummary='Placed an authored call without supplying the recipient response.';}
   }
   if(plan.type==='breakup'&&target.kind==='relationship'&&target.data.fromId===npc.id){
    const r=data(target,'relationship');if(r.labels.some(label=>['date','commit','cohabit','marry','intimacy'].includes(label))){r.labels=r.labels.filter(label=>!['date','commit','cohabit','marry','intimacy'].includes(label));for(const label of r.labelRecords)if(label.category==='romantic'&&label.status==='active'){label.status='ended';label.endedAt=s.clock;}r.pending='';target.data=r as Entity['data'];recordRelationshipHistory(s,target,eventId,'NPC ended relationship','label',npc.id,'private');
     const recipient=getEntity(s,r.toId,'character');if(recipient.data.locationId===d.locationId&&d.locationId){fact(s,target.id,'relationship-ended',true,eventId,[npc.id,recipient.id]);emit(effects,npc.name+' ends the relationship.',[recipient.id],'npc.relationship',npc.id);}performed=true;activityOutcome='relationship-changed';activitySummary='Ended an authored relationship.';
    }
   }
   if(plan.type==='work'&&target.kind==='job'){
    const job=data(target,'job'),employer=getEntity(s,job.employerId,'business'),business=data(employer,'business');
    const elapsed=Math.floor(due*interval/job.minutesPerShift)*job.minutesPerShift;
    const pay=Math.floor(job.hourlyCents*elapsed/60);
    if(job.employeeId===npc.id&&job.locationId===d.locationId&&isOpen(business.hours,s)&&pay>0&&business.cash>=pay){business.cash-=pay;d.cash+=pay;job.lastWorked=s.clock;target.data=job as Entity['data'];employer.data=business as Entity['data'];performed=true;activityOutcome='worked-shift';activitySummary='Worked '+elapsed+' minutes and received authored wages.';}
   }
   if(plan.type==='socialize'&&target.kind==='character'&&target.data.locationId===d.locationId&&target.id!==npc.id){
    let relation=s.entities.find(e=>e.kind==='relationship'&&!e.archived&&e.data.fromId===npc.id&&e.data.toId===target.id);
    const first=!relation;if(!relation)relation=add(s,'relationship',npc.name+' → '+target.name,{fromId:npc.id,toId:target.id,secret:false,disclosure:'private',knownByIds:[npc.id,target.id]},'knowledge');
    const r=data(relation,'relationship'),argument=r.resentment>=50||r.fear>=50||r.jealousy>=50;recordRelationshipHistory(s,relation,eventId,argument?'NPC argument':'NPC initiated conversation',argument?'meaningful':'routine',npc.id,'private');if(argument)applyRelationshipMovement(s,relation,eventId,'argument',{resentment:25},npc.id,[target.id]);
    if(first)for(const descriptor of socialPresentationDescriptors(s,target.id,'socialize')){recordRelationshipHistory(s,relation,eventId,'First impression: '+descriptor.descriptor,'system',npc.id,'private');traitTrace(d,[{...descriptor,type:'first-impression',value:0}],target.id,'contextual descriptor observed',s.clock);}
    emit(effects,npc.name+(argument?' has an argument.':' begins a conversation.'),observers,'npc.social',npc.id);performed=true;activityOutcome=argument?'argument-occurred':'socialized';activitySummary=argument?'An existing relationship conflict produced an argument.':'Socialized with '+target.name+'.';
   }
   if(plan.type==='offer'&&target.kind==='relationship'){
    const r=data(target,'relationship'),intent=r.tags.find(isRomanceIntent),safety=campaignRelationshipSafety(s);
    if(intent&&safety.allowNpcInitiative&&d.contentFilters.allowNpcInitiative){
     if(r.fromId===npc.id){
      const recipient=getEntity(s,r.toId,'character'),recipientData=data(recipient,'character'),pending=r.consentRequests.some(request=>request.status==='pending'&&request.intent===intent&&request.initiatorId===npc.id&&request.recipientId===recipient.id),eligibility=romanceEligibility(s,npc.id,recipient.id,intent);
      if(!pending&&recipientData.contentFilters.allowNpcInitiative&&eligibility.allowed&&authoredCompatibility(s,npc.id,recipient.id)>=d.compatibility.minimum){
       openConsentRequest(s,target,intent,npc.id,recipient.id,deterministicUuid(eventId+'|consent|'+target.id+'|'+intent+'|'+s.clock));
       emit(effects,npc.name+' presents a '+intent+' advance. The recipient chooses whether to respond.',recipient.data.playable?[recipient.id]:observers,'npc.offer',npc.id);performed=true;activityOutcome='relationship-changed';activitySummary='Presented one authored advance and waited for a response.';
      }
     }else if(r.toId===npc.id){
      const request=r.consentRequests.find(candidate=>candidate.status==='pending'&&candidate.recipientId===npc.id&&candidate.intent===intent),initiator=request?getEntity(s,request.initiatorId,'character'):null,eligibility=request?romanceEligibility(s,request.initiatorId,npc.id,intent):{allowed:false};
      if(request&&initiator&&eligibility.allowed&&authoredCompatibility(s,npc.id,initiator.id)>=d.compatibility.minimum){
       respondToConsentRequest(s,target,request.id,npc.id,intent,eventId,'accept',true);const accepted=data(target,'relationship');accepted.labels=[...new Set([...accepted.labels,intent])];if(intent==='exclusive')accepted.exclusivityStatus='exclusive';if(!accepted.labelRecords.some(label=>label.label===intent&&label.status==='active'))accepted.labelRecords.push({id:deterministicUuid(eventId+'|label|'+target.id+'|'+intent+'|'+s.clock),label:intent,category:'romantic',disclosure:accepted.disclosure,knownByIds:[initiator.id,npc.id],status:'active',sourceEventId:eventId,at:s.clock,endedAt:null});target.data=accepted as Entity['data'];recordRelationshipHistory(s,target,eventId,'NPC accepted '+intent,'label',npc.id,'private');fact(s,target.id,'relationship-changed',intent,eventId,[initiator.id,npc.id]);emit(effects,npc.name+' accepts the '+intent+' advance.',initiator.data.playable?[initiator.id]:observers,'npc.offer-response',npc.id);performed=true;activityOutcome='relationship-changed';activitySummary='Voluntarily accepted a current contextual advance.';
      }
     }
    }
   }
   if(plan.type==='share'&&target.kind==='character'&&target.data.locationId===d.locationId&&plan.auxiliaryId){
    const known=s.knowledge.filter(k=>k.observerId===npc.id).map(k=>s.facts.find(f=>f.id===k.factId)!).filter(f=>f.subjectId===plan.auxiliaryId&&!f.retiredAt);
    for(const f of known)observe(s,target.id,f.id,'npc-told:'+npc.id+':'+eventId);performed=known.length>0;if(performed){activityOutcome='shared-information';activitySummary='Shared only information the NPC actually knew.';}
   }
   if(plan.type==='travel'&&target.kind==='location'&&d.locationId&&target.id!==d.locationId){
    const current=data(getEntity(s,d.locationId,'location'),'location'),route=current.exits.find(e=>e.to===target.id&&e.modes.includes('walk')&&!e.locked);
    if(s.settings.npcRouteTravel){performed=startNpcJourney(s,npc,d,target.id,Math.max(start,previous+interval*60000),'travel');finishNpcJourney(s,npc,d,end,eventId,effects);}
    else if(route&&route.minutes<=minutes&&isOpen(data(target,'location').hours,s)){d.locationId=target.id;fact(s,npc.id,'location',target.id,eventId,atLocation(s,target.id).map(e=>e.id));performed=true;}
    if(performed&&d.locationId===target.id){activityOutcome=target.id===d.homeId?'traveled-home':'traveled';activitySummary=target.id===d.homeId?'Traveled home through a supported route.':'Traveled through a supported route.';}
   }
   if(plan.type==='crime'&&target.kind==='law'&&d.locationId){
    const law=data(target,'law');if(law.jurisdictionIds.includes(d.locationId)){const witnesses=atLocation(s,d.locationId).map(e=>e.id);fact(s,npc.id,'alleged-act',{lawId:target.id},eventId,witnesses);performed=true;activityOutcome='crime-committed';activitySummary='Committed an authored offense under applicable law.';
     const police=s.entities.filter(entity=>entity.kind==='faction'&&!entity.archived).find(entity=>{const faction=data(entity,'faction');return faction.dispatchPolicy?.kind==='police'&&faction.memberIds.some(memberId=>memberId!==npc.id&&witnesses.includes(memberId));});
     if(police){d.arrested=true;fact(s,npc.id,'arrested',{lawId:target.id,agencyId:police.id},eventId,witnesses);secondaryOutcome='arrested';secondarySummary='Arrested by a present, witnessing police-capable faction.';}
     emit(effects,'A witnessed incident involving '+npc.name+' is recorded.',observers,'npc.crime',npc.id);
    }
   }
   if(plan.type==='care'&&target.kind==='injury'&&s.settings.rules){
    const injury=data(target,'injury'),patient=getEntity(s,injury.characterId,'character'),medicine=plan.auxiliaryId?s.entities.find(e=>e.id===plan.auxiliaryId):null;
    if(!injury.treated&&patient.data.condition!=='dead'&&patient.data.locationId===d.locationId&&medicine?.kind==='item'&&carriedBy(s,medicine,npc.id)&&medicine.data.category==='medicine'&&Number(medicine.data.quantity)>0&&due*interval>=s.settings.rules.treatmentMinutes){
     medicine.data.quantity=Number(medicine.data.quantity)-1;injury.treated=true;injury.bleeding=0;target.data=injury as Entity['data'];performed=true;activityOutcome='care-provided';activitySummary='Provided care with available medicine and capability.';emit(effects,npc.name+' provides first aid.',observers,'npc.care',npc.id);
    }
   }
   if(plan.type==='scene'&&target.kind==='quest'&&target.data.status==='active'&&tier==='active'&&(target.data.characterId===playerId||!target.data.characterId)){emit(effects,npc.name+' initiates: '+(plan.text||target.name),observers,'npc.scene',npc.id);performed=true;activityOutcome='scene-initiated';activitySummary='Initiated an authored active-quest scene at the player location.';}
   if(performed){plan.lastRun=new Date(previous+due*interval*60000).toISOString();plan.runsToday++;plan.failedAttempts=0;plan.lastOutcome='performed';initiatives++;traitTrace(d,candidate.resolution.applied,plan.type,'plan selected at effective priority '+candidate.priority,s.clock);remember(s,npc.id,'Pursued goal: '+plan.type,eventId,0.4);if(activityOutcome)recordNpcActivity(s,npc,d,eventId,activityOutcome,'goal',target.id,activitySummary);if(secondaryOutcome)recordNpcActivity(s,npc,d,eventId,secondaryOutcome,'justice',target.id,secondarySummary);break;}
   fail('blocked');if(plan.fallback==='next-plan')continue;break;
  }
  npc.data=d as Entity['data'];
 }
 advanceLifecycle(s,start,end,eventId,effects);
}
