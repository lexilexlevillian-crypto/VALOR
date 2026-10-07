import {createHash} from 'node:crypto';
import {simulationId as randomUUID} from './turn-runtime.ts';
import {cognitionSchema,type Cognition,type MemoryType} from './memory-contracts.ts';
import {getEntity,type Memory,type State} from './model.ts';
import type {InformationEntry,InformationState} from './information-contracts.ts';

const unique=(ids:string[])=>[...new Set(ids)];
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const days=(clock:string,at:string)=>Math.max(0,(Date.parse(clock)-Date.parse(at))/86400000);
const critical=/threat|violence|gunshot|weapon\.shot|injur|confess|secret|promise|arrest|death|died|betray|rescue|robbery|milestone|humiliat|reconcil|breakup|evidence/;
const quoteSensitive=/threat|promise|confess|testimony|password|code|instruction|declaration|insult|legal.statement/;
// Disposable lookup projections. Source objects remain authoritative and mutations remain visible.
const sourceIndexes=new WeakMap<State,{observations:InformationState['observations'];entries:InformationState['entries'];observationCount:number;entryCount:number;byObservation:Map<string,InformationState['observations'][number]>;byEntry:Map<string,InformationEntry>}>();
function sources(s:State){
 const observations=s.information?.observations??[],entries=s.information?.entries??[],cached=sourceIndexes.get(s);
 if(cached&&cached.observations===observations&&cached.entries===entries&&cached.observationCount===observations.length&&cached.entryCount===entries.length)return cached;
 const index={observations,entries,observationCount:observations.length,entryCount:entries.length,byObservation:new Map(observations.map(o=>[o.id,o])),byEntry:new Map(entries.map(e=>[e.id,e]))};sourceIndexes.set(s,index);return index;
}
export type Formation={ownerId:string;eventId:string;text:string;kind:string;sourceKind:Cognition['sourceKind'];sourceId?:string;at?:string;locationId?:string|null;entityIds?:string[];topics?:string[];confidence?:number;salience?:number;detail?:Cognition['detail'];exactFragments?:string[];type?:MemoryType;sceneId?:string|null;sourceLabel?:string;emotion?:{salience:number;authority:Cognition['emotionAuthority'];sourceId:string}};

/** Trusted resolver boundary. The text must already be observer-filtered, never a narrator draft. */
export function formExperiencedMemory(s:State,input:Formation){
 const significant=critical.test(input.kind),salience=clamp(Math.max(input.salience??0.4,significant?0.85:0));if(salience<0.35)return null;
 const owner=getEntity(s,input.ownerId,'character'),at=input.at??s.clock;
 if(input.sourceKind==='observation'&&!s.information?.observations.some(o=>o.id===input.sourceId&&o.observerId===input.ownerId&&o.raw===input.text&&o.eventId===input.eventId))throw new Error('memory_source_unavailable');
 if(input.sourceKind==='information'&&!s.information?.entries.some(e=>e.id===input.sourceId&&e.characterId===input.ownerId&&e.text===input.text&&e.status==='active'))throw new Error('memory_source_unavailable');
 if(at>s.clock)throw new Error('memory_future_source');
 const sourceId=input.sourceId??input.eventId;
 const prior=s.memories.find(m=>m.observerId===input.ownerId&&m.eventId===input.eventId&&m.text===input.text);
 if(prior){if(prior.cognition){if(input.sourceKind==='observation')prior.cognition.sourceObservationIds=unique([...prior.cognition.sourceObservationIds,sourceId]);if(input.sourceKind==='information')prior.cognition.sourceInformationIds=unique([...prior.cognition.sourceInformationIds,sourceId]);}return prior;}

 if(input.emotion&&(input.emotion.authority==='none'||owner.data.playable&&input.emotion.authority==='npc-state'))throw new Error('pc_emotion_requires_authority');
 const exact=quoteSensitive.test(input.kind)?(input.exactFragments??[]):[];
 if(exact.some(fragment=>!input.text.includes(fragment)))throw new Error('memory_quote_not_observed');
 const entities=unique(input.entityIds??[]);for(const id of entities)getEntity(s,id);
 const confidence=clamp(input.confidence??1),detail=input.detail??(confidence<0.5?'fragmentary':exact.length?'high':'moderate');
 // The durable gist never pretends to be a retained quote. Partial perception stays partial.
 const gist=input.text.replace(/[“”"«»]/g,'').slice(0,2000);
 const cognition:Cognition={version:1,type:input.type??(/relationship|betray|rescue|milestone|reconcil/.test(input.kind)?'relationship':/route|travel/.test(input.kind)?'spatial':/recognition|meeting/.test(input.kind)?'recognition':'episodic'),timelineId:s.information?.memoryTimelineId??null,inheritedFromTimelineId:null,branchValidFrom:at,branchValidTo:null,
 sourceKind:input.sourceKind,sourceObservationIds:input.sourceKind==='observation'?[sourceId]:[],sourceInformationIds:input.sourceKind==='information'?[sourceId]:[],sceneId:input.sceneId??null,formedAt:s.clock,locationId:input.locationId??null,entities,topics:unique(input.topics??[input.kind]),exactFragments:exact.map(text=>({text,confidence})),gist,detail,confidence,accessibility:1,sourceMemoryStrength:1,informationalSalience:salience,emotionalSalience:clamp(input.emotion?.salience??0),emotionAuthority:input.emotion?.authority??'none',formationReason:significant?'immediate consequential experience':input.sourceKind==='authored-backstory'?'explicit Creator-authored backstory':'attended or learned experience',factors:{consequence:significant?1:0,attention:salience},sourceLabel:input.sourceLabel??(input.sourceKind==='observation'?'Observed personally':input.sourceKind==='information'?'Learned claim':'Experienced personally'),interpretation:'',anchor:false,status:'active',lastRecalledAt:null,recallCount:0,reinforcementCount:0,
 links:[...entities.map(entityId=>({entityId,relation:'entity' as const,weight:1,createdFrom:sourceId})),...(input.locationId?[{entityId:input.locationId,relation:'location' as const,weight:1,createdFrom:sourceId}]:[])],consolidation:null,consolidationParentId:null,mutations:[]};
 const memory:Memory={id:randomUUID(),observerId:input.ownerId,text:input.text,interpretation:'',salience,decayPerDay:0.01,eventId:input.eventId,eventRefs:[input.eventId],at,private:true,privacy:'private',tags:input.topics??[input.kind],lastRefreshedAt:at,refreshCount:0,cognition:cognitionSchema.parse(cognition)};
 s.memories.push(memory);return memory;
}

export function formObservationMemory(s:State,o:InformationState['observations'][number]){
 return formExperiencedMemory(s,{ownerId:o.observerId,eventId:o.eventId,sourceId:o.id,sourceKind:'observation',text:o.raw,kind:String(o.conditions.resolver??o.conditions.memoryKind??'observation'),at:o.at,locationId:o.locationId,entityIds:o.targetId?[o.targetId]:[],confidence:o.confidence,salience:o.salience,detail:o.clarity<0.5||o.conditions.partial===true?'fragmentary':undefined,exactFragments:typeof o.conditions.exactFragment==='string'?[o.conditions.exactFragment]:[]});
}
export function formInformationMemory(s:State,e:InformationEntry){
 if(['player-belief','inference'].includes(e.acquisition))return null;
 if(e.acquisition==='observation'){const o=s.information?.observations.find(o=>o.id===e.sourceId&&o.observerId===e.characterId);if(o){const m=formObservationMemory(s,o);if(m?.cognition)m.cognition.sourceInformationIds=unique([...m.cognition.sourceInformationIds,e.id]);return m;}}
 const transmission=s.information?.transmissions.find(t=>t.id===e.sourceId),p=s.information?.propositions.find(p=>p.id===e.propositionId);
 return formExperiencedMemory(s,{ownerId:e.characterId,eventId:transmission?.id??e.sourceId,sourceId:e.id,sourceKind:'information',text:e.text,kind:memoryEffectKind(p?.predicate??'learned-claim',e.text),at:e.acquiredAt,confidence:e.confidence,salience:0.55,type:e.acquisition==='recognition'?'recognition':'semantic',sourceLabel:transmission?.senderId?getEntity(s,transmission.senderId,'character').name:(['record','research'].includes(e.acquisition)?'Read in a record':'Learned claim'),entityIds:p?.subjectId?[p.subjectId]:[],exactFragments:transmission?[transmission.text]:[]});
}

export function memoryValid(s:State,m:Memory,ownerId=m.observerId){
 const c=m.cognition,invalid=s.information?.invalidatedNodeIds??[];
 if(c){const index=sources(s);if(c.sourceObservationIds.some(id=>index.byObservation.get(id)?.observerId!==ownerId)||c.sourceInformationIds.some(id=>{const e=index.byEntry.get(id);return !e||e.characterId!==ownerId||e.status==='invalidated';}))return false;}
 return m.observerId===ownerId&&m.at<=s.clock&&(!m.expiresAt||m.expiresAt>s.clock)&&!invalid.includes(m.id)&&!invalid.includes(m.eventId)&&(!c||c.status!=='invalid'&&c.formedAt<=s.clock&&c.branchValidFrom<=s.clock&&(!c.branchValidTo||c.branchValidTo>s.clock)&&(!c.timelineId||!s.information?.memoryTimelineId||c.timelineId===s.information.memoryTimelineId)&&![...c.sourceObservationIds,...c.sourceInformationIds].some(id=>invalid.includes(id)));
}
export function memoryRecallState(s:State,m:Memory,cueMatch=0){
 const c=m.cognition,age=days(s.clock,c?.lastRecalledAt??m.lastRefreshedAt??m.at);
 if(!c){const accessibility=Math.max(0,m.salience-age*m.decayPerDay);return {accessibility,confidence:1,sourceStrength:1,detail:'moderate' as Cognition['detail'],quoteAvailable:false,tier:age<=3?'hot':age<=31?'warm':'cold',ageDays:age,cueMatch,reason:accessibility?'legacy retention':'decayed accessibility'};}
 const stable=['semantic','procedural','spatial','recognition','routine','relationship'].includes(c.type),halfLife=(stable?180:30)*(1+c.informationalSalience*8+c.emotionalSalience*4+Math.min(c.reinforcementCount,20))*(c.anchor?8:1),retention=2**(-age/halfLife),floor=c.factors.pending?0.5:c.anchor||c.informationalSalience>=0.8?0.3:0;
 const accessibility=clamp(Math.max(floor,c.accessibility*retention)+Math.min(0.35,cueMatch*0.15)),detailRetention=2**(-days(s.clock,m.at)/(halfLife*0.5)),sourceStrength=c.sourceMemoryStrength*2**(-days(s.clock,m.at)/(halfLife*0.25));
 const detail=c.detail==='fragmentary'?'fragmentary':detailRetention<0.2?'fragmentary':detailRetention<0.55?'low':c.detail;
 return {accessibility,confidence:c.confidence*(0.6+0.4*retention),sourceStrength,detail,quoteAvailable:c.exactFragments.length>0&&detail==='high'&&detailRetention>=0.55,tier:age<=3?'hot':age<=31?'warm':'cold',ageDays:age,cueMatch,reason:accessibility<0.2?'decayed accessibility; stronger stored cues may help':cueMatch?'matched stored cue':'retained accessibility'};
}
export type MemoryCues={query?:string;entityIds?:string[];locationId?:string|null;topics?:string[];eventIds?:string[];explicit?:boolean;limit?:number};
export function recallMemories(s:State,ownerId:string,cues:MemoryCues={}){
 getEntity(s,ownerId,'character');const words=(cues.query??'').toLowerCase().split(/\W+/).filter(w=>w.length>2),location=cues.locationId??s.entities.find(e=>e.id===ownerId)?.data.locationId;
 const rows=s.memories.filter(m=>memoryValid(s,m,ownerId)&&m.cognition?.status!=='consolidated').flatMap(m=>{
  const c=m.cognition,body=[c?.gist??m.text,c?.interpretation??m.interpretation,...(c?.topics??m.tags??[])].join(' ').toLowerCase(),lexical=words.filter(w=>body.includes(w)).length,entity=(c?.entities??[]).some(id=>cues.entityIds?.includes(id)),place=!!location&&c?.locationId===location,topic=c?.topics.some(t=>cues.topics?.includes(t)),event=cues.eventIds?.some(id=>m.eventId===id||m.eventRefs?.includes(id)),match=lexical+Number(entity)+Number(place)+Number(Boolean(topic))+Number(Boolean(event)),state=memoryRecallState(s,m,match);
  const conditions=m.recallConditions;
  if(conditions&&((conditions.from&&conditions.from>s.clock)||(conditions.until&&conditions.until<=s.clock)||(conditions.locationId&&conditions.locationId!==location)||(conditions.entityIds.length&&!conditions.entityIds.some(id=>cues.entityIds?.includes(id)))||(conditions.tags.length&&!conditions.tags.some(t=>words.includes(t.toLowerCase())))))return [];
  if((words.length||cues.entityIds?.length||cues.topics?.length||cues.eventIds?.length)&&!match||state.accessibility<(cues.explicit?0.15:0.2))return [];
  const gist=c?.gist??m.text,availableText=c&&state.detail==='fragmentary'?gist.slice(0,80)+(gist.length>80?'…':''):c&&state.detail==='low'?gist.split(/(?<=[.!?])\s/)[0]!.slice(0,240):gist;
  return [{id:m.id,ownerId,at:m.at,text:availableText,interpretation:c?.interpretation??m.interpretation??'',confidence:state.confidence,detail:state.detail,exactFragments:state.quoteAvailable?c!.exactFragments:[],source:state.sourceStrength>=0.35?c?.sourceLabel??'Remembered experience':'Source not recalled',status:c?.status??'active',type:c?.type??'episodic',sourceEventId:m.eventId,temperature:state.tier,score:match*10+state.accessibility+(c?.anchor?2:0),recall:state}];
 });return rows.sort((a,b)=>b.score-a.score||b.at.localeCompare(a.at)||a.id.localeCompare(b.id)).slice(0,Math.min(50,Math.max(1,cues.limit??12)));
}

export function consolidateMemories(s:State,ownerId:string,locationId?:string|null){
 const groups=new Map<string,Memory[]>();
 for(const m of s.memories){const c=m.cognition;if(!memoryValid(s,m,ownerId)||!c||c.sourceKind==='consolidation'||c.anchor||c.informationalSalience>=0.8||c.emotionalSalience>=0.6||c.exactFragments.length||locationId!==undefined&&c.locationId!==locationId)continue;
  const key=hash([c.type,c.locationId,[...c.entities].sort(),c.topics,c.gist]);const group=groups.get(key)??[];group.push(m);groups.set(key,group);
 }
 const results:Memory[]=[];
 for(const [key,group] of groups){if(group.length<3)continue;const first=group[0]!,c=first.cognition!,sources=group.map(m=>m.id).sort(),sourceHash=hash(group.map(m=>[m.id,m.text,m.cognition!.confidence]));
  let summary=s.memories.find(m=>m.observerId===ownerId&&m.cognition?.sourceKind==='consolidation'&&m.cognition.status!=='invalid'&&m.tags?.includes(key));
  if(summary?.cognition?.consolidation?.sourceHash===sourceHash){results.push(summary);continue;}
  const summaryText='Repeated experience ('+group.length+' occasions): '+c.gist;
  if(!summary){summary=formExperiencedMemory(s,{ownerId,eventId:first.eventId,text:summaryText,kind:'routine',sourceKind:'consolidation',salience:0.6,confidence:Math.min(...group.map(m=>m.cognition!.confidence)),type:['spatial','procedural','recognition'].includes(c.type)?c.type:'routine',locationId:c.locationId,entityIds:c.entities,topics:[key,...c.topics]})!;}
  summary.text=summaryText;summary.cognition!.status='active';summary.cognition!.gist=summaryText;summary.cognition!.confidence=Math.min(...group.map(m=>m.cognition!.confidence));summary.cognition!.reinforcementCount=group.length-1;summary.cognition!.consolidation={sourceMemoryIds:sources,retainedExceptions:s.memories.filter(m=>m.observerId===ownerId&&m.cognition?.locationId===c.locationId&&m.salience>=0.8).map(m=>m.id),sourceHash,createdAt:s.clock};
  for(const m of group){m.cognition!.status='consolidated';m.cognition!.consolidationParentId=summary.id;}results.push(summary);
 }return results;
}

export function mutateMemory(s:State,ownerId:string,id:string,type:Cognition['mutations'][number]['type'],causeId:string,patch:{interpretation?:string;confidence?:number;emotionalSalience?:number;emotionAuthority?:Cognition['emotionAuthority'];reason?:string;committedEventIds?:string[]}={}){
 const m=s.memories.find(m=>m.id===id&&m.observerId===ownerId);if(!m||type!=='invalidate'&&!memoryValid(s,m,ownerId))throw new Error('memory_unavailable');
 if(!m.cognition){const migrated=formExperiencedMemory({...s,memories:[]},{ownerId,eventId:m.eventId,text:m.text,kind:'legacy-experience',sourceKind:'legacy',salience:Math.max(0.35,m.salience),confidence:0.5,at:m.at});m.cognition=migrated!.cognition!;m.cognition.formationReason='Existing event-backed legacy memory';m.cognition.interpretation=m.interpretation??'';}
 const c=m.cognition;if(['reinterpret','contaminate','correct','source_confuse'].includes(type)&&!s.information?.observations.some(o=>o.observerId===ownerId&&(o.id===causeId||o.eventId===causeId))&&!s.information?.entries.some(e=>e.characterId===ownerId&&e.status==='active'&&(e.id===causeId||e.sourceId===causeId)))throw new Error('memory_mutation_requires_experienced_cause');
 if(patch.confidence!==undefined&&(patch.confidence<0||patch.confidence>1))throw new Error('invalid_memory_confidence');
 if(patch.emotionalSalience!==undefined&&(!patch.emotionAuthority||patch.emotionAuthority==='none'||getEntity(s,ownerId,'character').data.playable&&patch.emotionAuthority==='npc-state'))throw new Error('pc_emotion_requires_authority');
 const state=()=>({status:c.status,accessibility:c.accessibility,confidence:c.confidence,interpretation:c.interpretation,sourceMemoryStrength:c.sourceMemoryStrength,anchor:c.anchor,emotionalSalience:c.emotionalSalience,recallCount:c.recallCount,reinforcementCount:c.reinforcementCount,lastRecalledAt:c.lastRecalledAt});const previous=state();
 if(type==='reinforce'){c.accessibility=clamp(memoryRecallState(s,m).accessibility+0.1);c.lastRecalledAt=s.clock;c.recallCount++;c.reinforcementCount++;}
 if(type==='weaken')c.accessibility*=0.5;
 if(type==='source_confuse')c.sourceMemoryStrength*=0.2;
 if(type==='anchor')c.anchor=true;
 if(type==='stale')c.status='stale';
 if(type==='invalidate')c.status='invalid';
 if(['reinterpret','contaminate','correct'].includes(type)){if(patch.interpretation!==undefined)c.interpretation=patch.interpretation;if(patch.confidence!==undefined)c.confidence=patch.confidence;}
 if(patch.emotionalSalience!==undefined){c.emotionalSalience=clamp(patch.emotionalSalience);c.emotionAuthority=patch.emotionAuthority!;}
 const affectedIds:string[]=[];
 if(type==='invalidate'){
  const invalid=new Set([id]);let changed=true;
  while(changed){changed=false;for(const row of s.memories)if(!invalid.has(row.id)&&row.cognition?.consolidation?.sourceMemoryIds.some(source=>invalid.has(source))){invalid.add(row.id);row.cognition.status='invalid';changed=true;}}
  affectedIds.push(...invalid);
  if(s.information){const i=s.information;for(const entry of i.entries)if(invalid.has(entry.sourceId)){entry.status='invalidated';affectedIds.push(entry.id);}for(const summary of i.summaries)if(summary.sourceIds.some(source=>invalid.has(source)))affectedIds.push(summary.id);i.summaries=i.summaries.filter(summary=>!affectedIds.includes(summary.id));i.invalidatedNodeIds=unique([...i.invalidatedNodeIds,...affectedIds]);}
 }
 if(s.information){s.information.summaries=s.information.summaries.filter(summary=>!summary.sourceIds.includes(id));s.information.generation++;}
 const mutation={id:randomUUID(),type,causedByEventId:causeId,at:s.clock,previous,next:state(),reason:patch.reason??type,affectedIds,committedEventIds:patch.committedEventIds??[]};c.mutations.push(mutation);return mutation;
}

export function bindMemoryTimeline(s:State,timelineId:string,inherit=false){
 for(const m of s.memories){const c=m.cognition;if(!c)continue;if(c.timelineId&&c.timelineId!==timelineId){if(!inherit)throw new Error('memory_timeline_mismatch');c.inheritedFromTimelineId=c.timelineId;}c.timelineId=timelineId;if(c.formedAt>s.clock||m.at>s.clock){c.status='invalid';c.branchValidTo=s.clock;}}
 if(s.information)s.information.memoryTimelineId=timelineId;
}
export function inspectMemories(s:State,ownerId:string,offset=0,limit=50){
 getEntity(s,ownerId,'character');return {memories:s.memories.filter(m=>m.observerId===ownerId).slice(offset,offset+Math.min(100,limit)).map(m=>({...structuredClone(m),recallState:memoryRecallState(s,m),valid:memoryValid(s,m)})),preview:recallMemories(s,ownerId),advancesTime:false,reinforces:false};
}
export function rebuildMemories(s:State,ownerId:string){
 sourceIndexes.delete(s);
 // Only derivative patterns are rebuilt; mutations and original experiences are retained.
 for(const m of s.memories)if(m.observerId===ownerId&&m.cognition?.status==='consolidated'){const parent=s.memories.find(p=>p.id===m.cognition!.consolidationParentId);if(parent?.cognition?.sourceKind==='consolidation'){m.cognition.status='active';m.cognition.consolidationParentId=null;}}
 const old=s.memories.filter(m=>m.observerId===ownerId&&m.cognition?.sourceKind==='consolidation');for(const m of old)if(m.cognition!.consolidation)m.cognition!.consolidation.sourceHash='';
 const summaries=consolidateMemories(s,ownerId),rebuilt=new Set(summaries.map(m=>m.id));for(const m of old)if(!rebuilt.has(m.id))m.cognition!.status='invalid';
 if(s.information){s.information.summaries=s.information.summaries.filter(row=>row.viewerId!==ownerId);s.information.generation++;}return {summaryIds:summaries.map(m=>m.id),canonicalEventsChanged:false};
}

/** Salience classification only; these words never establish a canonical crime or PC emotion. */
export function memoryEffectKind(kind:string,dialogue?:string){
 if(!dialogue)return kind;
 if(/\b(?:i(?:'ll| will) (?:kill|hurt|shoot)|you(?:'re| are) dead|threaten)\b/i.test(dialogue))return kind+'.threat';
 if(/\b(?:i promise|i swear|my word|promise you)\b/i.test(dialogue))return kind+'.promise';
 if(/\b(?:i confess|i killed|i stole|my secret)\b/i.test(dialogue))return kind+'.confession';
 return kind;
}
export function maintainMemories(s:State){
 const entries=new Map(s.information?.entries.map(e=>[e.id,e])??[]);
 for(const active of s.information?.active??[]){if(!['promise','question','threat'].includes(active.kind)||!active.sourceIds.length)continue;const o=s.information?.observations.find(o=>o.observerId===active.characterId&&active.sourceIds.some(id=>id===o.id||id===o.eventId)),e=s.information?.entries.find(e=>e.characterId===active.characterId&&active.sourceIds.some(id=>id===e.id||id===e.sourceId));if(!o&&!e)continue;
  // The open thread raises retention of its grounded experience; it does not invent one.
  for(const m of s.memories)if(m.observerId===active.characterId&&m.cognition&&(o&&m.cognition.sourceObservationIds.includes(o.id)||e&&m.cognition.sourceInformationIds.includes(e.id)))m.cognition.factors.pending=['open','pending','waiting'].includes(active.status)?1:0;
 }
 for(const m of s.memories){const c=m.cognition;if(!c||c.status!=='active'||!c.sourceInformationIds.length)continue;const sources=c.sourceInformationIds.map(id=>entries.get(id));if(sources.every(e=>e&&(['stale','superseded','historical','last_known'].includes(e.freshness)||e.status==='superseded')))c.status='stale';}
}
