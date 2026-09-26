import {randomUUID} from 'node:crypto';
import {data,getEntity} from './model.ts';
import type {Entity,State} from './model.ts';
import {calendarView} from './calendar.ts';
import {cosine,embedText} from './embedding.ts';
export function observe(s:State,observerId:string,factId:string,source:string) {
 getEntity(s,observerId,'character');
 if(!s.facts.some(f=>f.id===factId))throw new Error('fact_unavailable');
 if(!s.knowledge.some(k=>k.observerId===observerId&&k.factId===factId))s.knowledge.push({observerId,factId,source,at:s.clock});
}
export function fact(s:State,subjectId:string,predicate:string,value:unknown,eventId:string,observers:string[]=[]){
 const id=randomUUID();s.facts.push({id,subjectId,predicate,value,eventId,at:s.clock,retiredAt:null});
 for(const observer of observers)observe(s,observer,id,'witnessed:'+eventId);
 return id;
}
export function remember(s:State,observerId:string,text:string,eventId:string,salience=0.5){
 s.memories.push({id:randomUUID(),observerId,text,salience,decayPerDay:0.01,eventId,at:s.clock,private:true});
}
export function knows(s:State,observerId:string,subjectId:string){
 return s.knowledge.some(k=>k.observerId===observerId&&s.facts.some(f=>f.id===k.factId&&f.subjectId===subjectId&&!f.retiredAt));
}
export function visible(s:State,e:Entity,observerId:string):boolean{
 if(e.archived)return false;
 const observer=data(getEntity(s,observerId,'character'),'character');
 if(e.id===observerId)return true;
 if(e.kind==='location'&&e.id===observer.locationId)return true;
 if(e.visibility==='creator')return false;
 if(['transition','production','socialRule'].includes(e.kind))return false;
 if(e.kind==='dispatch')return e.data.requesterId===observerId||e.data.responderId===observerId||e.data.patientId===observerId;
 if(e.kind==='estate')return e.data.executorId===observerId||e.data.beneficiaryId===observerId;
 if(e.kind==='judgment')return e.data.characterId===observerId&&!!e.data.appliedAt;
 if(e.kind==='message'){const d=data(e,'message');return d.fromId===observerId||d.toId===observerId&&d.status!=='queued';}
 if(e.kind==='relationship'){const d=data(e,'relationship');return !d.secret&&(d.fromId===observerId||d.toId===observerId);}
 if(e.kind==='injury')return e.data.characterId===observerId;
 if(e.kind==='case')return e.data.investigatorId===observerId||(e.data.suspectIds as string[]).includes(observerId)&&['jail','bail','charged','trial','sentenced','probation','parole'].includes(String(e.data.stage));
 if(e.kind==='evidence')return (e.data.discoveredBy as string[]).includes(observerId);
 if(e.kind==='watcher')return false;
 if(e.kind==='character')return e.data.locationId===observer.locationId&&observer.locationId!==null||knows(s,observerId,e.id);
 if(e.kind==='item'){
  if(e.data.ownerId===observerId)return true;
  if(e.data.concealed)return false;
  if(e.data.containerId){const container=s.entities.find(c=>c.id===e.data.containerId&&!c.archived);if(container?.kind==='vehicle'&&(container.data.locationId!==observer.locationId||container.data.ownerId!==observerId&&!s.entities.some(key=>key.id===container.data.keyId&&!key.archived&&key.data.ownerId===observerId)))return false;return !!container&&!container.data.locked&&visible(s,container,observerId);}
  if(e.data.locationId===observer.locationId&&observer.locationId!==null)return true;
  return s.entities.some(b=>!b.archived&&b.data.locationId===observer.locationId&&observer.locationId!==null&&b.id===e.data.ownerId&&(b.kind==='business'&&(b.data.stock as string[]).includes(e.id)||b.kind==='character'&&e.data.equipped&&visible(s,b,observerId)));
 }
 if(e.visibility==='knowledge')return knows(s,observerId,e.id);
 if(e.visibility==='owner')return e.data.ownerId===observerId||e.data.characterId===observerId||e.data.employeeId===observerId||e.data.tenantId===observerId;
 return true;
}
export function project(s:State,e:Entity,observerId:string):Entity {
 const copy=structuredClone(e);
 if(e.kind==='media')delete copy.data.body;
 copy.data.mediaIds=((e.data.mediaIds??[]) as string[]).filter(id=>{const media=s.entities.find(e=>e.id===id&&e.kind==='media');return media&&visible(s,media,observerId);});
 if(e.kind==='case'&&e.data.investigatorId!==observerId){copy.name='Case notice';copy.data={stage:e.data.stage!,bailAmountCents:e.data.bailAmountCents??null};return copy;}
 const own=e.id===observerId||e.data.ownerId===observerId;
 if(e.kind==='character'&&!own){
  const d=data(e,'character'),actor=data(getEntity(s,observerId),'character');
  copy.data={description:d.description,appearance:d.appearance,identity:{pronouns:d.identity.pronouns??''},locationId:d.locationId===actor.locationId?d.locationId:null,condition:d.condition};
 }else{
  for(const k of ['secrets','instructions','hiddenSolution','embedding','pending','preferences','goals','fears','heat','forensicFindings'])delete copy.data[k];
  if(e.kind==='relationship'){for(const k of ['attraction','desire','affection','trust','respect','attachment','familiarity','jealousy','resentment','fear','loyalty','dependency'])delete copy.data[k];}
  if(!own)for(const k of ['cash','contacts','serial','registration','stock','suspectIds','custody','schedule','lastSimulated','mood'])delete copy.data[k];
  if(e.kind==='faction')for(const k of ['memberIds','reputation','treasuryCents','groupPolicy','lastGroupAt','dispatchPolicy'])delete copy.data[k];
  if(e.kind==='quest')delete copy.data.branches;
  if(e.kind==='character'&&!s.settings.reproductiveHealth)delete copy.data.reproductive;
  if(e.kind==='combat'){const allowed=new Set(s.entities.filter(entity=>visible(s,entity,observerId)).map(entity=>entity.id));copy.data.participants=(e.data.participants as string[]).filter(id=>allowed.has(id));copy.data.positions=Object.fromEntries(Object.entries(e.data.positions??{}).filter(([id])=>allowed.has(id))) as never;delete copy.data.blockedLines;}
  if(e.kind==='character')delete copy.data.plans;
  if(e.kind==='location')copy.data.exits=(copy.data.exits as {to:string;interruption?:unknown}[]).filter(exit=>s.entities.some(target=>target.id===exit.to&&visible(s,target,observerId))).map(({interruption,...route})=>route) as never;
 }
 const sections=(copy.data.sections??[]) as {id:string;parentId:string|null;visibility?:string;fields:{visibility:string}[]}[];
 // Custom section containers reveal only those fields explicitly allowed to this observer.
 const canSee=(v:string|undefined)=>v==='campaign'||v==='owner'&&own||v==='knowledge'&&knows(s,observerId,e.id);
 const sectionVisible=(section:typeof sections[number]):boolean=>!!canSee(section.visibility)&&(!section.parentId||!!sections.find(p=>p.id===section.parentId&&sectionVisible(p)));
 const allowed=new Set(sections.filter(section=>sectionVisible(section)&&section.fields.some(f=>canSee(f.visibility))).map(x=>x.id));
 copy.data.sections=sections.filter(section=>allowed.has(section.id)).map(section=>({...section,fields:section.fields.filter(f=>f.visibility==='campaign'||f.visibility==='owner'&&own||f.visibility==='knowledge'&&knows(s,observerId,e.id))})) as never;
 return copy;
}
export function observerView(s:State,observerId:string){
 const entities=s.entities.filter(e=>visible(s,e,observerId)).map(e=>project(s,e,observerId));
 const factIds=new Set(s.knowledge.filter(k=>k.observerId===observerId).map(k=>k.factId));
 return {clock:s.clock,calendar:calendarView(s),settings:{needs:s.settings.needs,fuel:s.settings.fuel,romance:s.settings.romance,intimacy:s.settings.intimacy,intensity:s.settings.intensity,weather:s.settings.weather,rulesConfigured:s.settings.rules!==null},
 entities,facts:s.facts.filter(f=>factIds.has(f.id)&&!f.retiredAt),
 beliefs:s.beliefs.filter(b=>b.observerId===observerId),
 memories:s.memories.filter(m=>m.observerId===observerId).map(m=>({...m,currentSalience:Math.max(0,m.salience-(Date.parse(s.clock)-Date.parse(m.at))/86400000*m.decayPerDay)}))};
}
export function retrieve(s:State,observerId:string,query:string,limit=12,queryEmbedding:number[]=[]){
 const view=observerView(s,observerId),terms=query.toLowerCase().split(/\W+/).filter(Boolean);
 const localQuery=queryEmbedding.length?queryEmbedding:embedText(query);
 const now=Date.parse(s.clock),location=data(getEntity(s,observerId),'character').locationId;
 const rows=view.entities.filter(e=>['lore','storycard'].includes(e.kind)).filter(e=>{
  const d=data(getEntity(s,e.id),e.kind as 'lore'|'storycard');
  return (!d.validFrom||Date.parse(d.validFrom)<=now)&&(!d.validUntil||Date.parse(d.validUntil)>now)&&
   (!d.activation||(!d.activation.locationId||d.activation.locationId===location)&&(!d.activation.characterId||d.activation.characterId===observerId)&&(!d.activation.keywords.length||d.activation.keywords.some(k=>query.toLowerCase().includes(k.toLowerCase()))));
 }).map(e=>{
  const source=data(getEntity(s,e.id),e.kind as 'lore'|'storycard');
  const candidateEmbedding=source.embedding.length===localQuery.length?source.embedding:embedText(source.description+' '+(source.tags as string[]).join(' '),localQuery.length);
  const semantic=cosine(localQuery,candidateEmbedding);
  const body=(e.name+' '+e.data.description+' '+(e.data.tags as string[]).join(' ')).toLowerCase();
  return {id:e.id,name:e.name,text:e.data.description,source:source.source,score:terms.filter(t=>body.includes(t)).length+Math.max(0,semantic)+source.priority};
 }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,Math.min(limit,50));
 return {sources:rows,beliefs:view.beliefs.filter(b=>terms.some(t=>b.proposition.toLowerCase().includes(t))).slice(0,limit),
 memories:view.memories.filter(m=>m.currentSalience>0).sort((a,b)=>b.currentSalience-a.currentSalience).slice(0,limit),
 contradictions:view.beliefs.filter(b=>b.correctedBy).map(b=>({beliefId:b.id,correctedBy:b.correctedBy}))};
}
