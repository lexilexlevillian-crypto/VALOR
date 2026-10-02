import {data,getEntity} from './model.ts';
import type {State} from './model.ts';

export type CompatibilityFactor={source:'identity'|'preferences'|'appearance'|'personality'|'behavior'|'familiarity'|'reputation'|'history'|'circumstance'|'traits';key:string,value:number};
const preferenceValue=(value:string,match:boolean)=>value==='prefer'?(match?5:-2):value==='avoid'?(match?-5:1):match?3:-1;
export function compatibilityAssessment(s:State,fromId:string,toId:string){
 const from=data(getEntity(s,fromId,'character'),'character'),to=data(getEntity(s,toId,'character'),'character');
 const factors:CompatibilityFactor[]=[];
 if(from.compatibility.requiredTraits.some(traitId=>!to.traits.includes(traitId)))return {score:-100,eligible:false,factors:[{source:'traits',key:'required trait absent',value:-100}]};
 for(const [traitId,weight] of Object.entries(from.compatibility.traitWeights))if(to.traits.includes(traitId))factors.push({source:'traits',key:traitId,value:weight});
 for(const [key,value] of Object.entries(from.preferences)){
  const [group,...path]=key.split('.'),field=path.join('.');let actual:unknown;
  if(group==='identity')actual=to.identity[field];
  else if(group==='appearance')actual=to.appearance[field]??(to as unknown as Record<string,unknown>)[field];
  else if(group==='personality')actual=(to.personalityProfile as unknown as Record<string,unknown>)[field];
  else if(group==='behavior')actual=[...to.goals,...to.traits,...to.boundaries].map(String).includes(field);
  else continue;
  const match=typeof actual==='boolean'?actual:String(actual??'').toLowerCase()===value.toLowerCase(),delta=preferenceValue(value,match);
  if(delta)factors.push({source:group as 'identity'|'appearance'|'personality'|'behavior',key,value:delta});
 }
 const relation=s.entities.find(entity=>entity.kind==='relationship'&&!entity.archived&&entity.data.fromId===fromId&&entity.data.toId===toId);
 if(relation){const r=data(relation,'relationship'),familiarity=Math.round(r.familiarity/20);if(familiarity)factors.push({source:'familiarity',key:relation.id,value:familiarity});const history=Math.max(-5,Math.min(5,r.history.filter(entry=>entry.kind==='meaningful').reduce((sum,entry)=>sum+Object.values(entry.changes??{}).reduce((a,b)=>a+Math.sign(b),0),0)));if(history)factors.push({source:'history',key:relation.id,value:history});}
 const reputations=s.entities.filter(entity=>entity.kind==='reputation'&&!entity.archived&&entity.data.subjectId===toId).map(entity=>data(entity,'reputation')).filter(reputation=>reputation.audience.type==='public'||Boolean(reputation.audience.entityId&&from.factionIds.includes(reputation.audience.entityId))||reputation.sourceEvents.some(source=>source.knownByIds.includes(fromId)));
 if(reputations.length){const reputation=Math.round(reputations.reduce((sum,row)=>sum+row.score,0)/reputations.length/20);if(reputation)factors.push({source:'reputation',key:'known audiences',value:reputation});}
 if(from.locationId&&from.locationId===to.locationId)factors.push({source:'circumstance',key:'same location',value:2});
 const score=Math.max(-100,Math.min(100,factors.reduce((sum,factor)=>sum+factor.value,0)));
 return {score,eligible:score>=from.compatibility.minimum,factors};
}
export function authoredCompatibility(s:State,fromId:string,toId:string){return compatibilityAssessment(s,fromId,toId).score;}
