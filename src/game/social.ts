import {randomUUID} from 'node:crypto';
import {data,getEntity,relationshipMetrics,validateEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {campaignRelationshipSafety,effectiveContentMode} from './romance.ts';

type Disclosure=Data<'relationship'>['disclosure'];
type Metric=(typeof relationshipMetrics)[number];
const clamp=(value:number)=>Math.max(-100,Math.min(100,value));
const known=(disclosure:Disclosure,knownByIds:string[],observerId:string,participants:string[]=[])=>
 disclosure==='public'||knownByIds.includes(observerId)||(disclosure==='private'||disclosure==='disputed')&&participants.includes(observerId);

export function applyRelationshipMovement(s:State,entity:Entity,eventId:string,reason:string,deltas:Partial<Record<Metric,number>>,actorId:string|null=null,relatedEntityIds:string[]=[]){
 const relation=data(entity,'relationship'),now=Date.parse(s.clock);
 if(relation.lastMeaningfulAt&&now-Date.parse(relation.lastMeaningfulAt)<relation.cooldownMinutes*60000)return false;
 const changes:Partial<Record<Metric,number>>={};
 for(const metric of relationshipMetrics){
  const requested=deltas[metric]??0,effective=Math.round(requested*(1-relation.inertia)*100)/100;
  if(Math.abs(effective)<relation.movementThreshold)continue;
  const before=relation[metric],after=clamp(before+effective),actual=Math.round((after-before)*100)/100;
  if(actual){relation[metric]=after;changes[metric]=actual;}
 }
 if(!Object.keys(changes).length)return false;
 relation.lastMeaningfulAt=s.clock;
 relation.history.push({at:s.clock,eventId,label:reason,kind:'meaningful',reason,changes,actorId,relatedEntityIds:[...new Set(relatedEntityIds)],disclosure:'private',knownByIds:[]});
 if(relation.history.length>2000)relation.history.splice(0,relation.history.length-2000);
 entity.data=relation as Entity['data'];return true;
}

export function recordRelationshipHistory(s:State,entity:Entity,eventId:string,label:string,kind:Data<'relationship'>['history'][number]['kind']='system',actorId:string|null=null,disclosure:Disclosure='private'){
 const relation=data(entity,'relationship');relation.history.push({at:s.clock,eventId,label,kind,reason:label,changes:{},actorId,relatedEntityIds:[],disclosure,knownByIds:[]});
 if(relation.history.length>2000)relation.history.splice(0,relation.history.length-2000);entity.data=relation as Entity['data'];
}

export function relationshipBehaviorSignal(s:State,fromId:string,targetId:string,planType:string){
 const entity=s.entities.find(candidate=>candidate.kind==='relationship'&&!candidate.archived&&candidate.data.fromId===fromId&&candidate.data.toId===targetId);
 if(!entity)return 0;const relation=data(entity,'relationship');
 const positive=relation.trust+relation.affection+relation.respect+relation.loyalty+relation.familiarity,negative=relation.resentment+relation.fear+relation.jealousy;
 const raw=planType==='breakup'?negative-positive/2:planType==='crime'?-relation.fear:planType==='care'||planType==='share'||planType==='socialize'||planType==='offer'?positive-negative:0;
 return Math.max(-10,Math.min(10,Math.round(raw/50)));
}

const audienceType=(faction:Data<'faction'>):Data<'reputation'>['audience']['type']=>{
 const category=faction.category.toLowerCase();if(faction.dispatchPolicy?.kind==='police'||category.includes('police'))return 'police';if(category.includes('gang'))return 'gang';if(category.includes('family'))return 'family';return 'custom';
};
export function recordReputation(s:State,factionId:string,characterId:string,delta:number,eventId:string,reason:string,decayPerDay=0.1,disclosure:Data<'reputation'>['sourceEvents'][number]['disclosure']='private',contextEntityIds:string[]=[]){
 const factionEntity=getEntity(s,factionId,'faction'),faction=data(factionEntity,'faction'),memberIds=[...new Set(faction.memberIds)];
 let entity=s.entities.find(candidate=>candidate.kind==='reputation'&&!candidate.archived&&data(candidate,'reputation').subjectId===characterId&&data(candidate,'reputation').audience.entityId===factionId);
 if(!entity){entity=validateEntity({id:randomUUID(),kind:'reputation',name:factionEntity.name+' reputation',visibility:'creator',data:{subjectId:characterId,audience:{type:audienceType(faction),entityId:factionId,label:factionEntity.name},baseScore:faction.reputation[characterId]??0,score:faction.reputation[characterId]??0}});s.entities.push(entity);}
 const reputation=data(entity,'reputation');reputation.sourceEvents.push({id:randomUUID(),eventId,delta:clamp(delta),reason,at:s.clock,decayPerDay,expiresAt:null,disclosure,knownByIds:memberIds,contextEntityIds:[...new Set(contextEntityIds)]});
 reputation.score=clamp(reputation.score+delta);reputation.calculatedAt=s.clock;entity.data=reputation as Entity['data'];faction.reputation[characterId]=reputation.score;factionEntity.data=faction as Entity['data'];return entity;
}

export function decayReputations(s:State,at=s.clock){
 const now=Date.parse(at);
 for(const entity of s.entities.filter(candidate=>candidate.kind==='reputation'&&!candidate.archived)){
  const reputation=data(entity,'reputation');
  const score=reputation.sourceEvents.reduce((sum,source)=>{
   if(source.expiresAt&&Date.parse(source.expiresAt)<=now)return sum;
   const ageDays=Math.max(0,(now-Date.parse(source.at))/86400000),remaining=Math.max(0,Math.abs(source.delta)-source.decayPerDay*ageDays);
   return sum+Math.sign(source.delta)*remaining;
  },reputation.baseScore);
  reputation.score=clamp(Math.round(score*100)/100);reputation.calculatedAt=at;entity.data=reputation as Entity['data'];
  if(reputation.audience.entityId){const audience=s.entities.find(candidate=>candidate.id===reputation.audience.entityId&&candidate.kind==='faction'&&!candidate.archived);if(audience){const faction=data(audience,'faction');faction.reputation[reputation.subjectId]=reputation.score;audience.data=faction as Entity['data'];}}
 }
}

const labelRows=(relation:Data<'relationship'>,observerId?:string)=>{
 if(relation.labelRecords.length)return relation.labelRecords.filter(label=>label.status==='active'&&(!observerId||known(label.disclosure,label.knownByIds,observerId,[relation.fromId,relation.toId]))).map(label=>({label:label.label,category:label.category,disclosure:label.disclosure,status:label.status}));
 const disclosure=relation.secret?'secret':'public';return !observerId||known(disclosure,relation.knownByIds,observerId,[relation.fromId,relation.toId])?relation.labels.map(label=>({label,category:'other',disclosure,status:'active'})):[];
};
const node=(s:State,id:string)=>{const entity=s.entities.find(candidate=>candidate.id===id);return entity?{id:entity.id,name:entity.name,kind:entity.kind,archived:entity.archived}:{id,name:'Unavailable record',kind:'unknown',archived:true};};

export function developerSocialGraph(s:State){
 const nodes=s.entities.filter(entity=>!entity.archived&&['character','faction','business','location'].includes(entity.kind)).map(entity=>({id:entity.id,name:entity.name,kind:entity.kind,...(entity.kind==='character'?{playable:Boolean(entity.data.playable),condition:entity.data.condition}:{})}));
 const edges:Array<Record<string,unknown>>=[];
 for(const entity of s.entities.filter(candidate=>!candidate.archived)){
  if(entity.kind==='relationship'){const relation=data(entity,'relationship');edges.push({id:entity.id,type:'relationship',fromId:relation.fromId,toId:relation.toId,directional:true,labels:labelRows(relation),metrics:Object.fromEntries(relationshipMetrics.map(metric=>[metric,relation[metric]])),boundaries:relation.boundaries,inertia:relation.inertia,history:relation.history,consentRequests:relation.consentRequests,relationshipStyle:relation.relationshipStyle,exclusivityStatus:relation.exclusivityStatus,disclosure:relation.disclosure,knownByIds:relation.knownByIds});}
  if(entity.kind==='reputation'){const reputation=data(entity,'reputation');edges.push({id:entity.id,type:'reputation',fromId:reputation.subjectId,toId:reputation.audience.entityId??'public',audience:reputation.audience,score:reputation.score,baseScore:reputation.baseScore,sourceEvents:reputation.sourceEvents});}
  if(entity.kind==='obligation'){const obligation=data(entity,'obligation');edges.push({id:entity.id,type:obligation.kind,fromId:obligation.debtorId,toId:obligation.creditorId,directional:true,data:obligation});}
  if(entity.kind==='job')edges.push({id:entity.id,type:'employment',fromId:entity.data.employeeId,toId:entity.data.employerId,sourceId:entity.id});
  if(entity.kind==='housing')edges.push({id:entity.id,type:'housing',fromId:entity.data.tenantId,toId:entity.data.landlordId,sourceId:entity.id});
  if(entity.kind==='faction')for(const memberId of data(entity,'faction').memberIds)edges.push({id:entity.id+':'+memberId,type:'affiliation',fromId:memberId,toId:entity.id,sourceId:entity.id});
  if(entity.kind==='case'){const file=data(entity,'case');for(const suspectId of file.suspectIds)edges.push({id:entity.id+':'+suspectId,type:'crime-case',fromId:suspectId,toId:file.investigatorId,sourceId:entity.id,stage:file.stage});}
 }
 for(const knowledge of s.knowledge.filter(record=>record.source.startsWith('witnessed:'))){const proposition=s.facts.find(fact=>fact.id===knowledge.factId);if(proposition&&s.entities.some(entity=>entity.id===proposition.subjectId&&entity.kind==='character'))edges.push({id:knowledge.factId+':'+knowledge.observerId,type:'witness',fromId:knowledge.observerId,toId:proposition.subjectId,sourceEventId:proposition.eventId});}
 for(const belief of s.beliefs.filter(record=>record.source.startsWith('gossip-from:')||record.source.startsWith('group-rumor:'))){const match=belief.source.match(/^(?:gossip-from|group-rumor):([0-9a-f-]{36})/i);if(match)edges.push({id:belief.id,type:'rumor',fromId:match[1],toId:belief.observerId,confidence:belief.confidence,source:belief.source});}
 return {mode:'developer',directionality:'Every relationship edge is fromId → toId; reverse sentiment requires a separate edge.',nodes,edges,legend:{relationship:'directional internal state',reputation:'character to audience',favorOrDebt:'debtor to creditor',system:['employment','housing','affiliation','crime-case','witness','rumor']}};
}

export function playerRelationships(s:State,observerId:string){
 const observer=getEntity(s,observerId,'character'),relationships=[] as Record<string,unknown>[];
 for(const entity of s.entities.filter(candidate=>candidate.kind==='relationship'&&!candidate.archived&&(candidate.data.fromId===observerId||candidate.data.toId===observerId))){
  const relation=data(entity,'relationship'),participants=[relation.fromId,relation.toId];
  if(!known(relation.secret?'secret':relation.disclosure,relation.knownByIds,observerId,participants))continue;
  const fromObserver=relation.fromId===observerId,otherId=fromObserver?relation.toId:relation.fromId,labels=labelRows(relation,observerId);
  const history=relation.history.filter(entry=>known(entry.disclosure??'private',entry.knownByIds??[],observerId,participants)).map(entry=>({at:entry.at,label:entry.label,reason:entry.reason??entry.label,kind:entry.kind??'system'}));
  const consentRequests=relation.consentRequests.filter(request=>request.initiatorId===observerId||request.recipientId===observerId).map(request=>({id:request.id,intent:request.intent,direction:request.recipientId===observerId?'incoming':'outgoing',status:request.status,requestedAt:request.requestedAt,expiresAt:request.expiresAt,contentMode:request.contentMode}));
  relationships.push({id:entity.id,direction:fromObserver?'you → them':'them → you',from:node(s,relation.fromId),to:node(s,relation.toId),other:node(s,otherId),labels,history,consentRequests,relationshipStyle:relation.relationshipStyle,exclusivityStatus:relation.exclusivityStatus,disclosure:relation.disclosure});
 }
 const reputations=s.entities.filter(candidate=>candidate.kind==='reputation'&&!candidate.archived&&data(candidate,'reputation').subjectId===observerId).flatMap(entity=>{const reputation=data(entity,'reputation'),now=Date.parse(s.clock),sources=reputation.sourceEvents.filter(source=>known(source.disclosure,source.knownByIds,observerId,[observerId]));if(!sources.length)return [];const score=clamp(sources.reduce((sum,source)=>{if(source.expiresAt&&Date.parse(source.expiresAt)<=now)return sum;const age=Math.max(0,(now-Date.parse(source.at))/86400000),remaining=Math.max(0,Math.abs(source.delta)-source.decayPerDay*age);return sum+Math.sign(source.delta)*remaining;},0));return [{id:entity.id,audience:reputation.audience,score:Math.round(score*100)/100,sourceEvents:sources.map(source=>({at:source.at,reason:source.reason,delta:source.delta,expiresAt:source.expiresAt}))}];});
 const obligations=s.entities.filter(candidate=>candidate.kind==='obligation'&&!candidate.archived&&(candidate.data.creditorId===observerId||candidate.data.debtorId===observerId)).flatMap(entity=>{const obligation=data(entity,'obligation'),participants=[obligation.creditorId,obligation.debtorId];if(!known(obligation.disclosure,obligation.knownByIds,observerId,participants))return [];return [{id:entity.id,kind:obligation.kind,direction:obligation.debtorId===observerId?'you owe them':'they owe you',creditor:node(s,obligation.creditorId),debtor:node(s,obligation.debtorId),terms:obligation.terms,dueCondition:obligation.dueCondition,stakes:obligation.stakes,status:obligation.status,dueAt:obligation.dueAt,history:obligation.history.filter(entry=>known(entry.disclosure,entry.knownByIds,observerId,participants)).map(entry=>({at:entry.at,status:entry.status,reason:entry.reason}))}];});
 return {mode:'player',character:{id:observer.id,name:observer.name},directionality:'Each arrow is one direction. No reverse feeling or player emotion is inferred.',contentRules:{campaignMode:s.settings.campaign?.matureContent??s.settings.intimacy,effectiveMode:effectiveContentMode(s,observerId),safety:campaignRelationshipSafety(s),filters:data(observer,'character').contentFilters},relationships,reputations,obligations};
}
