import {memoryValid,memoryRecallState} from './memory.ts';
import type {State,Memory} from './model.ts';

export function acquisitionUsable(s:State,e:NonNullable<State['information']>['entries'][number]){
 return e.status==='active'&&e.acquiredAt<=s.clock&&!s.information?.invalidatedNodeIds?.includes(e.id)&&!s.information?.invalidatedNodeIds?.includes(e.sourceId);
}
export function legacyAcquisitionUsable(s:State,viewerId:string,propositionId:string){if(!s.information?.invalidatedNodeIds.length)return true;const rows=s.information?.entries.filter(e=>e.characterId===viewerId&&e.propositionId===propositionId)??[];return !rows.length||rows.some(e=>acquisitionUsable(s,e));}
export function knownIdentity(s:State,viewerId:string,subjectId:string){
 return s.information?.identities?.filter(r=>r.viewerId===viewerId&&r.subjectId===subjectId&&r.at<=s.clock&&!s.information?.invalidatedNodeIds?.includes(r.sourceId)).at(-1);
}
export function informationLabel(s:State,viewerId:string,subjectId:string){
 const entity=s.entities.find(e=>e.id===subjectId);if(!entity)return 'Unknown';if(viewerId===subjectId)return entity.name;
 const learned=knownIdentity(s,viewerId,subjectId);if(learned)return learned.label;
 const identity=entity.data.identityDisclosure as {concealed:boolean;knownByIds:string[];label:string}|undefined;
 return identity?.concealed&&!identity.knownByIds.includes(viewerId)?identity.label:entity.name;
}
export function safeInformationText(s:State,viewerId:string,text:string){
 return informationSanitizer(s,viewerId)(text);
}
export function informationSanitizer(s:State,viewerId:string){
 const substitutions:Array<{name:string;label:string}>=[];
 const identities=new Map((s.information?.identities??[]).filter(r=>r.viewerId===viewerId&&r.at<=s.clock&&!s.information?.invalidatedNodeIds?.includes(r.sourceId)).map(r=>[r.subjectId,r]));
 for(const entity of s.entities.filter(e=>e.kind==='character'&&e.id!==viewerId)){
  const learned=identities.get(entity.id),identity=entity.data.identityDisclosure as {concealed:boolean;knownByIds:string[];label:string}|undefined,label=learned?.label??(identity?.concealed&&!identity.knownByIds.includes(viewerId)?identity.label:entity.name);if(label===entity.name&&!learned)continue;
  const names=[entity.name,String(entity.data.legalName??''),...((entity.data.aliases??[]) as string[])].filter(name=>name&&name!==label).sort((a,b)=>b.length-a.length);
  for(const name of names)substitutions.push({name,label});
 }
 const sanitize=(text:string)=>{let result=text;for(const {name,label} of substitutions)result=result.replaceAll(name,label);return result;};
 return Object.assign(sanitize,{needed:substitutions.length>0});
}
export type ProfileKnowledgeIndex=Map<string,Map<string,{value:unknown;at:string;status:string;sourceId:string}>>;
export function profileKnowledgeIndex(s:State,viewerId:string):ProfileKnowledgeIndex{
 const legacyValues=new Map(s.facts.map(f=>[f.id,f.value]));const result:ProfileKnowledgeIndex=new Map(),i=s.information,propositions=new Map(i?.propositions.map(p=>[p.id,p])??[]),facts=new Set(s.knowledge.filter(k=>k.observerId===viewerId&&k.at<=s.clock&&legacyAcquisitionUsable(s,viewerId,k.factId)).map(k=>k.factId));
 const put=(subjectId:string,field:string,row:{value:unknown;at:string;status:string;sourceId:string})=>{const fields=result.get(subjectId)??new Map();if(field==='alias'){field='aliases';row={...row,value:[row.value]};}if((fields.get(field)?.at??'')>row.at)return;fields.set(field,row);result.set(subjectId,fields);};
 for(const f of s.facts)if(facts.has(f.id))put(f.subjectId,f.predicate,{value:f.value,at:f.at,status:f.retiredAt?'last_known':'reported',sourceId:f.id});
 for(const e of i?.entries??[]){if(e.characterId!==viewerId||!acquisitionUsable(s,e))continue;const p=propositions.get(e.propositionId);if(p?.subjectId)put(p.subjectId,String(p.qualifiers.profileField??p.predicate),{value:p.qualifiers.profileValue??legacyValues.get(e.propositionId)??e.text,at:e.informationAt,status:e.freshness,sourceId:e.id});}
 return result;
}
export function knownProfileField(s:State,viewerId:string,subjectId:string,field:string,index?:ProfileKnowledgeIndex){return (index??profileKnowledgeIndex(s,viewerId)).get(subjectId)?.get(field)??null;}
export function knownSpatial(s:State,viewerId:string,subjectId:string){return s.information?.spatial?.filter(r=>r.viewerId===viewerId&&r.subjectId===subjectId&&r.at<=s.clock&&!s.information?.invalidatedNodeIds?.includes(r.sourceId)).at(-1);}
export function spatialMarkers(s:State,viewerId:string){
 const rows=s.information?.spatial?.filter(r=>r.viewerId===viewerId&&r.at<=s.clock&&!s.information?.invalidatedNodeIds?.includes(r.sourceId))??[];
 return [...new Map(rows.map(r=>[r.subjectId,r])).values()].map(r=>({id:r.id,label:safeInformationText(s,viewerId,r.label),precision:r.precision,areaId:r.areaId,locationId:r.precision==='exact'||r.precision==='last_known'?r.locationId:null,at:r.at,sourceId:r.sourceId}));
}
export function recallEligible(s:State,memory:Memory,viewerId:string,query='',entityIds:string[]=[]){
 if(memory.cognition&&(!memoryValid(s,memory,viewerId)||memory.cognition.status==='consolidated'||memoryRecallState(s,memory).accessibility<0.2))return false;
 if(memory.observerId!==viewerId||memory.at>s.clock||memory.expiresAt&&memory.expiresAt<=s.clock||s.information?.invalidatedNodeIds?.includes(memory.id)||s.information?.invalidatedNodeIds?.includes(memory.eventId))return false;
 const conditions=memory.recallConditions,observer=s.entities.find(e=>e.id===viewerId),words=query.toLowerCase().split(/\W+/),age=(Date.parse(s.clock)-Date.parse(memory.lastRefreshedAt??memory.at))/86400000;
 if(!memory.cognition&&memory.salience-age*memory.decayPerDay<=0)return false;
 return !conditions||(!conditions.from||conditions.from<=s.clock)&&(!conditions.until||conditions.until>s.clock)&&(!conditions.locationId||conditions.locationId===observer?.data.locationId)&&(!conditions.entityIds.length||conditions.entityIds.some(id=>entityIds.includes(id)))&&(!conditions.tags.length||conditions.tags.some(tag=>words.includes(tag.toLowerCase())));
}
export function informationTemperature(clock:string,at:string,active=false):'hot'|'warm'|'cold'{const days=(Date.parse(clock)-Date.parse(at))/86400000;return days<=3?'hot':active||days<=31?'warm':'cold';}
