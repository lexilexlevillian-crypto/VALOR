import {randomUUID} from 'node:crypto';
import {data,getEntity,validateEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {fact,observe,remember} from './epistemics.ts';
import {matchesCondition} from './conditions.ts';
import {advanceLifecycle,startNpcJourney,finishNpcJourney} from './lifecycle.ts';
import {authoredCompatibility} from './compatibility.ts';
import {injuryRate,needsRate} from './policy.ts';
import {resolveTraitEffects,socialPresentationDescriptors} from './traits.ts';
export type Effect={id:string;text:string;observers:string[];type:string;subjectId:string};
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
  if(cost>200000)throw new Error('catchup_work_budget_exceeded_use_shorter_wait');
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
  const d=data(npc,'character');if(d.condition==='dead')continue;
  let previousLocation=d.locationId;
  for(const parts of slots){
   if(!d.schedule.length)break;
   if(s.settings.npcRouteTravel)finishNpcJourney(s,npc,d,parts.at,eventId,effects);
   const due=d.schedule.filter(x=>x.minute===parts.minute&&x.days.includes(parts.day)).map(entry=>{const resolution=resolveTraitEffects(s,npc.id,'schedule-priority',{planType:entry.activity,context:entry.activity});return {entry,resolution,priority:resolution.applied.reduce((sum,effect)=>sum+effect.value,0)};}).sort((a,b)=>b.priority-a.priority||a.entry.id.localeCompare(b.entry.id));
   for(const scheduled of due){const entry=scheduled.entry,location=getEntity(s,entry.locationId,'location');
    traitTrace(d,scheduled.resolution.applied,entry.activity,'schedule selected at priority '+scheduled.priority,new Date(parts.at).toISOString());
    if(s.settings.npcRouteTravel){if(d.locationId===location.id)d.activity=entry.activity;else startNpcJourney(s,npc,d,location.id,parts.at,entry.activity);continue;}
    d.locationId=location.id;d.activity=entry.activity;
    const observers=atLocation(s,location.id).filter(e=>e.data.playable).map(e=>e.id);
    if(observers.length)emit(effects,npc.name+' arrives and begins '+entry.activity+'.',observers,'npc.schedule',npc.id);
   }
  }
  if(s.settings.npcRouteTravel)finishNpcJourney(s,npc,d,end,eventId,effects);
  d.lastSimulated=new Date(end).toISOString();npc.data=d as Entity['data'];npc.revision++;
  if(previousLocation!==d.locationId)fact(s,npc.id,'location',d.locationId,eventId,atLocation(s,d.locationId).map(e=>e.id));
 }
 s.clock=new Date(end).toISOString();
 const weather=s.settings.weatherSchedule.filter(w=>Date.parse(w.at)<=end).sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
 if(weather)s.settings.weather=weather.weather;
 for(const entity of s.entities.filter(e=>e.kind==='message'&&!e.archived&&e.data.callState==='ringing')){
  if(end-Date.parse(String(entity.data.at))>=60000){entity.data.callState='missed';entity.data.endedAt=s.clock;}
 }
 for(const entity of s.entities.filter(e=>e.kind==='message'&&!e.archived&&e.data.status==='queued')){
  const message=data(entity,'message');
  if(s.entities.some(e=>e.kind==='item'&&!e.archived&&e.data.category==='phone'&&e.data.ownerId===message.toId&&Number(e.data.battery)>0)){
   message.status='delivered';entity.data=message as Entity['data'];
   for(const f of s.facts.filter(f=>f.subjectId===entity.id&&f.predicate==='communication'))observe(s,message.toId,f.id,'delivered:'+entity.id);
   if(message.body)s.beliefs.push({id:randomUUID(),observerId:message.toId,proposition:message.body,confidence:0.5,source:'message:'+entity.id,at:s.clock,correctedBy:null});
  }
 }
 const needsMultiplier=needsRate(s),injuryMultiplier=injuryRate(s);
 for(const character of s.entities.filter(e=>e.kind==='character'&&!e.archived)){
  const d=data(character,'character');if(d.condition==='dead')continue;
  if(s.settings.healthRules){const rules=s.settings.healthRules;
   d.intoxication=Math.max(0,d.intoxication-rules.soberingPerHour*minutes/60);
   if(d.dependence>0&&d.lastDoseAt)d.withdrawal=Math.min(100,d.withdrawal+rules.withdrawalPerDay*minutes/1440*d.dependence/100);
  }
  if(s.settings.needs&&needsMultiplier>0){
   const rate=(need:'hunger'|'thirst'|'fatigue'|'hygiene')=>{const resolution=resolveTraitEffects(s,character.id,'need-rate',{need,context:'time-passage'});traitTrace(d,resolution.applied,need,'need rate applied',s.clock);return Math.max(0,1+resolution.applied.reduce((sum,effect)=>sum+effect.value,0));};
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
   for(const item of s.entities.filter(e=>e.kind==='item'&&!e.archived&&e.data.ownerId===character.id)){item.data.ownerId=null;item.data.containerId=remains.id;item.data.equipped=false;}
  }else if(d.blood<20)d.condition='unconscious';
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
  const present=f.memberIds.map(id=>getEntity(s,id,'character')).filter(member=>!member.data.playable&&member.data.condition==='conscious'&&member.data.locationId===leader.data.locationId);
  if(!present.length)continue;
  f.cohesion=Math.max(0,Math.min(100,f.cohesion+steps*f.groupPolicy.cohesionStep));
  const known=s.knowledge.filter(k=>k.observerId===leader.id&&s.facts.some(fact=>fact.id===k.factId&&!fact.retiredAt));
  for(const member of present){
   if(f.groupPolicy.shareMood)member.data.mood=leader.data.mood!;
   if(f.groupPolicy.shareKnowledge)for(const k of known)observe(s,member.id,k.factId,'group-contact:'+entity.id);
  }
  f.lastGroupAt=new Date(previous+steps*f.groupPolicy.intervalMinutes*60000).toISOString();entity.data=f as Entity['data'];
  emit(effects,'Authored group contact: '+entity.name,[],'npc.group',entity.id);
 }
 for(const r of s.entities.filter(e=>e.kind==='relationship'&&!e.archived)){
  const d=data(r,'relationship'),from=getEntity(s,d.fromId,'character'),to=getEntity(s,d.toId,'character');
  if(from.data.playable||to.data.playable||from.data.locationId!==to.data.locationId||!from.data.locationId||from.data.condition!=='conscious'||to.data.condition!=='conscious')continue;
  if(!d.history.some(h=>h.label==='routine contact'&&h.at.slice(0,10)===s.clock.slice(0,10))){d.familiarity=Math.min(100,d.familiarity+(1-d.inertia));d.history.push({at:s.clock,eventId,label:'routine contact'});r.data=d as Entity['data'];}
 }
 // Bounded deterministic planning; all voluntary actions belong to NPCs.
 for(const npc of npcs){
  const d=data(npc,'character');if(d.condition!=='conscious')continue;
  const player=s.entities.find(e=>e.id===playerId);
  const tier=d.locationId===player?.data.locationId?'active':d.goals.length?'relevant':'distant';
  const minInterval=tier==='active'?15:tier==='relevant'?30:60;
  const plans=[...d.plans].filter(p=>p.enabled).map(plan=>{const resolution=resolveTraitEffects(s,npc.id,'ai-priority',{planType:plan.type,context:plan.type});return {plan,resolution,priority:plan.priority+resolution.applied.reduce((sum,effect)=>sum+effect.value,0)};}).sort((a,b)=>b.priority-a.priority||a.plan.id.localeCompare(b.plan.id));
  for(const candidate of plans){const plan=candidate.plan;
   if(d.preferences[plan.type]==='off')continue;
   if(!plan.conditions.every(c=>matchesCondition(s,c)))continue;
   if(!plan.lastRun)plan.lastRun=new Date(start).toISOString();
   const interval=Math.max(minInterval,plan.cooldownMinutes),previous=Date.parse(plan.lastRun);
   const due=Math.floor((end-previous)/(interval*60000));if(due<1)continue;
   const target=s.entities.find(e=>e.id===plan.targetId&&!e.archived);if(!target)continue;
   const observers=atLocation(s,d.locationId).filter(e=>e.data.playable).map(e=>e.id);
   let performed=false;
   if(plan.type==='message'&&target.kind==='character'&&plan.text){
    const device=s.entities.find(e=>e.kind==='item'&&!e.archived&&e.data.ownerId===npc.id&&e.data.category==='phone'&&!e.data.locked&&Number(e.data.battery)>0&&(e.data.contacts as {characterId:string}[]).some(c=>c.characterId===target.id));
    if(device){const delivered=s.entities.some(e=>e.kind==='item'&&!e.archived&&e.data.ownerId===target.id&&e.data.category==='phone'&&Number(e.data.battery)>0);
     const message=add(s,'message','Message from '+npc.name,{fromId:npc.id,toId:target.id,phoneId:device.id,medium:'sms',body:plan.text,at:s.clock,status:delivered?'delivered':'queued'},'owner');
     device.data.battery=Number(device.data.battery)-1;fact(s,message.id,'communication',{fromId:npc.id,toId:target.id,medium:'sms'},eventId,delivered?[npc.id,target.id]:[npc.id]);
     if(delivered){s.beliefs.push({id:randomUUID(),observerId:target.id,proposition:plan.text,confidence:0.5,source:'message:'+message.id,at:s.clock,correctedBy:null});emit(effects,npc.name+': '+plan.text,[target.id],'npc.message',message.id);}performed=true;
    }
   }
   if(plan.type==='breakup'&&target.kind==='relationship'&&target.data.fromId===npc.id){
    const r=data(target,'relationship');if(r.labels.some(label=>['date','commit','cohabit','marry','intimacy'].includes(label))){r.labels=r.labels.filter(label=>!['date','commit','cohabit','marry','intimacy'].includes(label));r.pending='';r.history.push({at:s.clock,eventId,label:'NPC ended relationship'});target.data=r as Entity['data'];
     const recipient=getEntity(s,r.toId,'character');if(recipient.data.locationId===d.locationId&&d.locationId){fact(s,target.id,'relationship-ended',true,eventId,[npc.id,recipient.id]);emit(effects,npc.name+' ends the relationship.',[recipient.id],'npc.relationship',npc.id);}performed=true;
    }
   }
   if(plan.type==='work'&&target.kind==='job'){
    const job=data(target,'job'),employer=getEntity(s,job.employerId,'business'),business=data(employer,'business');
    const elapsed=Math.floor(due*interval/job.minutesPerShift)*job.minutesPerShift;
    const pay=Math.floor(job.hourlyCents*elapsed/60);
    if(job.employeeId===npc.id&&job.locationId===d.locationId&&isOpen(business.hours,s)&&pay>0&&business.cash>=pay){business.cash-=pay;d.cash+=pay;job.lastWorked=s.clock;target.data=job as Entity['data'];employer.data=business as Entity['data'];performed=true;}
   }
   if(plan.type==='socialize'&&target.kind==='character'&&target.data.locationId===d.locationId&&target.id!==npc.id){
    let relation=s.entities.find(e=>e.kind==='relationship'&&!e.archived&&e.data.fromId===npc.id&&e.data.toId===target.id);
    const first=!relation;if(!relation)relation=add(s,'relationship',npc.name+' → '+target.name,{fromId:npc.id,toId:target.id,secret:true},'knowledge');
    const r=data(relation,'relationship');r.familiarity=Math.min(100,r.familiarity+due*(1-r.inertia));r.history.push({at:s.clock,eventId,label:'NPC initiated conversation'});relation.data=r as Entity['data'];
    if(first)for(const descriptor of socialPresentationDescriptors(s,target.id,'socialize')){r.history.push({at:s.clock,eventId,label:'First impression: '+descriptor.descriptor});traitTrace(d,[{...descriptor,type:'first-impression',value:0}],target.id,'contextual descriptor observed',s.clock);}
    emit(effects,npc.name+' begins a conversation.',observers,'npc.social',npc.id);performed=true;
   }
   if(plan.type==='offer'&&target.kind==='relationship'&&target.data.fromId===npc.id){
    const r=data(target,'relationship'),recipient=getEntity(s,r.toId,'character'),intent=r.tags.find(t=>['date','commit','cohabit','marry','reconcile','intimacy'].includes(t));
    const adult=(dob:unknown)=>typeof dob==='string'&&(end-Date.parse(dob))/31557600000>=18;
    if(intent&&s.settings.romance&&adult(d.dob)&&adult(recipient.data.dob)&&recipient.data.locationId===d.locationId&&!r.pending&&!r.boundaries.includes(intent)&&!d.boundaries.includes(intent)&&!(recipient.data.boundaries as string[]).includes(intent)&&d.preferences.romance!=='off'&&(recipient.data.preferences as Record<string,string>).romance!=='off'&&authoredCompatibility(s,npc.id,recipient.id)>=d.compatibility.minimum&&(intent!=='intimacy'||s.settings.intimacy==='fade-to-black')){
     r.pending=intent;target.data=r as Entity['data'];
     const reciprocal=s.entities.find(e=>e.kind==='relationship'&&!e.archived&&e.data.fromId===recipient.id&&e.data.toId===npc.id);
     if(!recipient.data.playable&&reciprocal?.data.pending===intent&&!(reciprocal.data.boundaries as string[]).includes(intent)){
      const reverse=data(reciprocal,'relationship');r.labels=[...new Set([...r.labels,intent])];reverse.labels=[...new Set([...reverse.labels,intent])];r.pending='';reverse.pending='';
      r.history.push({at:s.clock,eventId,label:'Mutually accepted '+intent});reverse.history.push({at:s.clock,eventId,label:'Mutually accepted '+intent});
      target.data=r as Entity['data'];reciprocal.data=reverse as Entity['data'];
      fact(s,target.id,'relationship-changed',intent,eventId,[npc.id,recipient.id]);
     }else emit(effects,npc.name+' offers '+intent+'. A response is yours to choose.',[recipient.id],'npc.offer',npc.id);
     performed=true;
    }
   }
   if(plan.type==='share'&&target.kind==='character'&&target.data.locationId===d.locationId&&plan.auxiliaryId){
    const known=s.knowledge.filter(k=>k.observerId===npc.id).map(k=>s.facts.find(f=>f.id===k.factId)!).filter(f=>f.subjectId===plan.auxiliaryId&&!f.retiredAt);
    for(const f of known)observe(s,target.id,f.id,'npc-told:'+npc.id+':'+eventId);performed=known.length>0;
   }
   if(plan.type==='travel'&&target.kind==='location'&&d.locationId&&target.id!==d.locationId){
    const current=data(getEntity(s,d.locationId,'location'),'location'),route=current.exits.find(e=>e.to===target.id&&e.modes.includes('walk')&&!e.locked);
    if(s.settings.npcRouteTravel){performed=startNpcJourney(s,npc,d,target.id,Math.max(start,previous+interval*60000),'travel');finishNpcJourney(s,npc,d,end,eventId,effects);}
    else if(route&&route.minutes<=minutes&&isOpen(data(target,'location').hours,s)){d.locationId=target.id;fact(s,npc.id,'location',target.id,eventId,atLocation(s,target.id).map(e=>e.id));performed=true;}
   }
   if(plan.type==='crime'&&target.kind==='law'&&d.locationId){
    const law=data(target,'law');if(law.jurisdictionIds.includes(d.locationId)){const witnesses=atLocation(s,d.locationId).map(e=>e.id);fact(s,npc.id,'alleged-act',{lawId:target.id},eventId,witnesses);performed=true;emit(effects,'A witnessed incident involving '+npc.name+' is recorded.',observers,'npc.crime',npc.id);}
   }
   if(plan.type==='care'&&target.kind==='injury'&&s.settings.rules){
    const injury=data(target,'injury'),patient=getEntity(s,injury.characterId,'character'),medicine=plan.auxiliaryId?s.entities.find(e=>e.id===plan.auxiliaryId):null;
    if(!injury.treated&&patient.data.condition!=='dead'&&patient.data.locationId===d.locationId&&medicine?.kind==='item'&&medicine.data.ownerId===npc.id&&medicine.data.category==='medicine'&&Number(medicine.data.quantity)>0&&due*interval>=s.settings.rules.treatmentMinutes){
     medicine.data.quantity=Number(medicine.data.quantity)-1;injury.treated=true;injury.bleeding=0;target.data=injury as Entity['data'];performed=true;emit(effects,npc.name+' provides first aid.',observers,'npc.care',npc.id);
    }
   }
   if(performed){const original=d.plans.find(p=>p.id===plan.id)!;original.lastRun=new Date(previous+due*interval*60000).toISOString();traitTrace(d,candidate.resolution.applied,plan.type,'plan selected at effective priority '+candidate.priority,s.clock);remember(s,npc.id,'Pursued goal: '+plan.type,eventId,0.4);break;}
  }
  npc.data=d as Entity['data'];
 }
 advanceLifecycle(s,start,end,eventId,effects);
}
