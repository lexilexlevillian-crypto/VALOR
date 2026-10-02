import {randomUUID} from 'node:crypto';
import {data,getEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {fact} from './epistemics.ts';
import {emit} from './simulation.ts';
import type {Effect} from './simulation.ts';
import {matchesCondition} from './conditions.ts';
import {recordRelationshipHistory,recordReputation} from './social.ts';
import {itemPossessor} from './items.ts';
import {decayCriminalHeat,noticeHeatSignal} from './investigation.ts';
import {advanceFactions} from './factions.ts';
type Outcome=Data<'transition'>['outcomes'][number];
const set=(e:Entity,d:unknown)=>{e.data=d as Entity['data'];};
export function applyOutcomes(s:State,outcomes:Outcome[],eventId:string,effects:Effect[]){
 for(const o of outcomes){
  if(o.type==='quest')getEntity(s,o.questId,'quest').data.status=o.status;
  if(o.type==='reveal')fact(s,o.subjectId,'authored-revelation',true,eventId,[o.characterId]);
  if(o.type==='notice')emit(effects,o.text,[o.characterId],'authored.notice',o.characterId);
  if(o.type==='housing')getEntity(s,o.housingId,'housing').data.access=o.access;
  if(o.type==='reputation')recordReputation(s,o.factionId,o.characterId,o.delta,eventId,'Authored consequence');
  if(o.type==='obligation'){const entity=getEntity(s,o.obligationId,'obligation'),obligation=data(entity,'obligation');obligation.status=o.status;if(['fulfilled','forgiven','defaulted'].includes(o.status))obligation.settledAt=s.clock;obligation.history.push({at:s.clock,eventId,status:o.status,reason:'Authored consequence',disclosure:obligation.disclosure,knownByIds:obligation.knownByIds});set(entity,obligation);}
  if(o.type==='relationship'){
   const entity=getEntity(s,o.relationshipId,'relationship'),r=data(entity,'relationship');
   // Authored events may end a relationship, but cannot manufacture a player's assent.
   if(o.operation==='add'&&[r.fromId,r.toId].some(id=>getEntity(s,id,'character').data.playable))throw new Error('player_relationship_consent_required');
   r.labels=o.operation==='add'?[...new Set([...r.labels,o.label])]:r.labels.filter(x=>x!==o.label);
   if(o.operation==='add')r.labelRecords.push({id:randomUUID(),label:o.label,category:'other',disclosure:r.disclosure,knownByIds:r.knownByIds,status:'active',sourceEventId:eventId,at:s.clock,endedAt:null});
   else for(const label of r.labelRecords)if(label.label===o.label&&label.status==='active'){label.status='ended';label.endedAt=s.clock;}
   set(entity,r);recordRelationshipHistory(s,entity,eventId,'Authored consequence: '+o.operation+' '+o.label,'label');
  }
 }
}
export function startNpcJourney(s:State,entity:Entity,d:Data<'character'>,destinationId:string,at:number,activity:string){
 if(d.playable||d.condition!=='conscious'||d.journey||!d.locationId||d.locationId===destinationId)return false;
 const origin=getEntity(s,d.locationId,'location'),route=data(origin,'location').exits.find(e=>e.to===destinationId&&e.modes.includes('walk'));
 if(!route||d.cash<route.fare||route.locked&&!s.entities.some(e=>e.id===route.keyId&&!e.archived&&e.kind==='item'&&itemPossessor(s,e)===entity.id))return false;
 const arrival=route.interruption?.locationId??destinationId;
 // Weather-conditional encounters apply only when their authored condition matches.
 const interrupt=route.interruption&&(!route.interruption.whenWeather||route.interruption.whenWeather===s.settings.weather);
 d.cash-=route.fare;d.journey={originId:origin.id,destinationId:interrupt?arrival:destinationId,arrivesAt:new Date(at+(interrupt?route.interruption!.afterMinutes:route.minutes)*60000).toISOString(),activity};d.locationId=null;d.activity='travel';return true;
}
export function finishNpcJourney(s:State,entity:Entity,d:Data<'character'>,until:number,eventId:string,effects:Effect[]){
 if(!d.journey||Date.parse(d.journey.arrivesAt)>until||d.condition!=='conscious')return;
 const journey=d.journey;d.locationId=journey.destinationId;d.activity=journey.activity;d.journey=null;set(entity,d);
 const observers=s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.locationId===d.locationId).map(e=>e.id);
 const at=s.clock;s.clock=journey.arrivesAt;
 fact(s,entity.id,'location',d.locationId,eventId,observers);emit(effects,entity.name+' arrives.',observers,'npc.arrival',entity.id);s.clock=at;
}
export function advanceLifecycle(s:State,start:number,end:number,eventId:string,effects:Effect[]){
 const entities=s.entities.filter(e=>!e.archived);
 decayCriminalHeat(s,start,end);
 advanceFactions(s,start,end,eventId,effects);
 // Authored production consumes actual stock, never creates money or infinite inputs.
 const factories=entities.filter(e=>e.kind==='production').map(e=>({e,p:data(e,'production')})).filter(x=>x.p.enabled);
 let iterations=0;
 while(true){
  const next=factories.filter(x=>Date.parse(x.p.nextAt)<=end).sort((a,b)=>a.p.nextAt.localeCompare(b.p.nextAt)||a.e.id.localeCompare(b.e.id))[0];if(!next)break;
  if(++iterations>20000)throw new Error('production_catchup_budget_exceeded');
  const {e,p}=next,output=getEntity(s,p.outputId,'item');
  const inputs=p.inputs.map(i=>({i,e:getEntity(s,i.itemId,'item')}));
  if(output.data.ownerId===p.businessId&&Number(output.data.quantity)+p.quantity<=100000&&inputs.every(x=>x.e.data.ownerId===p.businessId&&Number(x.e.data.quantity)>=x.i.quantity)){
   for(const input of inputs)input.e.data.quantity=Number(input.e.data.quantity)-input.i.quantity;
   output.data.quantity=Number(output.data.quantity)+p.quantity;p.runs++;
  }
  p.nextAt=new Date(Date.parse(p.nextAt)+p.intervalMinutes*60000).toISOString();set(e,p);
 }
 // One branch per quest per advance, sorted by authored priority. No cascading loops.
 const branched=new Set<string>();
 for(const entity of entities.filter(e=>e.kind==='transition').sort((a,b)=>Number(b.data.priority)-Number(a.data.priority)||a.id.localeCompare(b.id))){
  const t=data(entity,'transition');if(t.firedAt||branched.has(t.questId))continue;
  const quest=getEntity(s,t.questId,'quest');
  if(quest.data.status!==t.from||!t.conditions.every(c=>matchesCondition(s,c)))continue;
  quest.data.status=t.to;t.firedAt=s.clock;set(entity,t);branched.add(t.questId);applyOutcomes(s,t.outcomes,eventId,effects);
  emit(effects,'Authored branch: '+entity.name,[],'quest.branch',entity.id);
 }
 for(const entity of entities.filter(e=>e.kind==='socialRule')){
  const rule=data(entity,'socialRule');if(rule.firedAt||!data(getEntity(s,rule.relationshipId,'relationship'),'relationship').labels.includes(rule.label)||!rule.conditions.every(c=>matchesCondition(s,c)))continue;
  applyOutcomes(s,rule.outcomes,eventId,effects);rule.firedAt=s.clock;set(entity,rule);
 }
 for(const entity of entities.filter(e=>e.kind==='dispatch')){
  const d=data(entity,'dispatch');if(d.status!=='enroute'||!d.dueAt||Date.parse(d.dueAt)>end||!d.responderId)continue;
  const responder=getEntity(s,d.responderId,'character');
  if(responder.data.condition!=='conscious')continue;
  if(!responder.data.playable)responder.data.locationId=d.locationId;
  // A player responder must actually travel; dispatch never moves them implicitly.
  if(responder.data.locationId!==d.locationId)continue;
  d.status='arrived';set(entity,d);fact(s,entity.id,'dispatch-arrived',true,eventId,[d.requesterId,d.responderId]);
  if(d.kind==='police'&&d.caseId){const file=s.entities.find(candidate=>candidate.id===d.caseId&&candidate.kind==='case'&&!candidate.archived);if(file)for(const suspectId of data(file,'case').suspectIds){const suspect=s.entities.find(candidate=>candidate.id===suspectId&&candidate.kind==='character'&&!candidate.archived);if(suspect?.data.locationId===d.locationId)noticeHeatSignal(s,{subjectId:suspectId,watcherId:d.agencyId,locationId:d.locationId,kind:'dispatch',description:'A police response connected to the reported incident became visible nearby.',noticedByIds:[suspectId]});}}
  emit(effects,'The requested responder has arrived.',[d.requesterId,d.responderId],'dispatch.arrived',entity.id);
 }
 for(const entity of entities.filter(e=>e.kind==='case')){
  const c=data(entity,'case');
  if(c.stage==='booking'&&c.bookingCompletesAt&&Date.parse(c.bookingCompletesAt)<=end)c.stage='jail';
  if(c.stage==='jail'&&c.holdingUntil&&Date.parse(c.holdingUntil)<=end&&c.releaseEligible){
   c.stage='bail';c.releasedAt=s.clock;
   for(const suspectId of c.suspectIds){const suspect=getEntity(s,suspectId,'character');if(suspect.data.restrainedBy===c.investigatorId)suspect.data.restrainedBy=null;suspect.data.arrested=false;c.suspectStatus[suspectId]='released';}
   c.history.push({at:s.clock,operation:'bail',actorId:null,targetId:null,authorized:true,knowledgeScore:c.evidenceScore,agencyScore:c.priority,reason:'posture-based release after authored detention period'});
  }
  set(entity,c);
 }
 for(const entity of entities.filter(e=>e.kind==='judgment')){
  const j=data(entity,'judgment');if(j.appliedAt)continue;
  const file=getEntity(s,j.caseId,'case'),c=data(file,'case');if(c.stage!=='trial'||!c.suspectIds.includes(j.characterId))continue;
  const person=getEntity(s,j.characterId,'character'),p=data(person,'character');
  if(j.verdict==='convicted'&&p.cash<j.fineCents)continue; // Unpaid disposition stays pending; no negative balances.
  if(j.verdict==='convicted'){p.cash-=j.fineCents;const agency=getEntity(s,c.agencyId,'faction');agency.data.treasuryCents=Number(agency.data.treasuryCents??0)+j.fineCents;c.stage='sentenced';c.suspectStatus[j.characterId]='convicted';}
  else{c.stage='closed';c.suspectStatus[j.characterId]='cleared';p.arrested=false;if(p.restrainedBy===c.investigatorId)p.restrainedBy=null;}
  j.appliedAt=s.clock;set(entity,j);set(person,p);set(file,c);
  fact(s,file.id,'authored-judgment',{verdict:j.verdict,authority:j.authority,fineCents:j.fineCents},eventId,[j.characterId,c.investigatorId]);
 }
 for(const entity of entities.filter(e=>e.kind==='judgment')){
  const j=data(entity,'judgment');if(!j.appliedAt||j.verdict!=='convicted')continue;
  const file=getEntity(s,j.caseId,'case'),p=getEntity(s,j.characterId,'character');
  if(file.data.stage==='sentenced'&&j.custodyUntil&&Date.parse(j.custodyUntil)<=end){if(p.data.restrainedBy===file.data.investigatorId)p.data.restrainedBy=null;file.data.stage=j.probationUntil&&Date.parse(j.probationUntil)>end?'probation':'closed';}
  if(file.data.stage==='probation'&&j.probationUntil&&Date.parse(j.probationUntil)<=end)file.data.stage='closed';
 }
 for(const entity of entities.filter(e=>e.kind==='estate')){
  const e=data(entity,'estate');if(e.notified||!e.authorized||!e.funeralAt||Date.parse(e.funeralAt)>end||getEntity(s,e.characterId,'character').data.condition!=='dead')continue;
  emit(effects,'Authored memorial notice: '+entity.name,[e.executorId,e.beneficiaryId],'estate.memorial',entity.id);e.notified=true;set(entity,e);
 }
 if(s.settings.reproductiveHealth)for(const entity of entities.filter(e=>e.kind==='character')){
  const c=data(entity,'character'),r=c.reproductive;if(!r?.enabled||c.condition==='dead')continue;
  // No inferred conception, miscarriage, birth, sex, symptoms or player feelings.
  r.phase=r.pregnancyStartedAt?(end-Date.parse(r.pregnancyStartedAt)>=r.pregnancyDays*86400000?'due':'pregnancy'):r.cycleStart&&end>=Date.parse(r.cycleStart)?Math.floor((end-Date.parse(r.cycleStart))/86400000)%r.cycleDays<r.bleedingDays?'menstruation':'cycle':'inactive';set(entity,c);
 }
}
