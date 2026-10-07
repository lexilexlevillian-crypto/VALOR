import {acquisitionUsable,informationSanitizer,spatialMarkers} from './information-access.ts';
import {createHash} from 'node:crypto';
import {simulationId as randomUUID} from './turn-runtime.ts';
import {informationStateSchema,propositionSchema,informationRecordSchema,transmissionSchema,observationSchema,activeInformationSchema,type InformationEntry,type InformationState} from './information-contracts.ts';
import {getEntity,data,type State} from './model.ts';
import {carriedBy} from './items.ts';

export const informationHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function information(s:State):InformationState{return s.information??=informationStateSchema.parse({});}
const requireThat=(test:unknown,message='information_unavailable')=>{if(!test)throw new Error(message);};
const unique=(rows:string[])=>[...new Set(rows)];
export function addProposition(s:State,input:unknown){const p=propositionSchema.parse(input),i=information(s);requireThat(!i.propositions.some(row=>row.id===p.id),'duplicate_information');if(p.subjectId)getEntity(s,p.subjectId);i.propositions.push(p);detectConflicts(s);return p;}
export function acquireInformation(s:State,input:Omit<InformationEntry,'id'|'acquiredAt'|'status'|'supersedesId'> & {supersedesId?:string|null}){
 const i=information(s);getEntity(s,input.characterId,'character');requireThat(i.propositions.some(p=>p.id===input.propositionId));
 const prior=input.supersedesId?i.entries.find(e=>e.id===input.supersedesId&&e.characterId===input.characterId):null;
 if(input.supersedesId)requireThat(prior);if(prior)prior.status='superseded';
 // Repeated exposure to the same origin is retained in transmission history, not counted as independent evidence.
 const duplicate=i.entries.find(e=>e.characterId===input.characterId&&e.propositionId===input.propositionId&&e.sourceId===input.sourceId&&e.status==='active');if(duplicate)return duplicate;
 const entry:InformationEntry={...input,id:randomUUID(),originIds:unique(input.originIds),acquiredAt:s.clock,status:'active',supersedesId:input.supersedesId??null};i.entries.push(entry);if(!i.sources.some(source=>source.id===input.sourceId))i.sources.push({id:input.sourceId,type:input.acquisition==='observation'?'observation':['record','research'].includes(input.acquisition)?'record':input.acquisition==='rumor'?'rumor':input.acquisition==='background'?'background':input.acquisition==='creator'?'creator':input.acquisition==='inference'||input.acquisition==='player-belief'?'inference':'testimony',entityId:input.characterId,recordId:['record','research'].includes(input.acquisition)?input.sourceId:null,originalClaim:input.text,reliability:input.confidence,createdAt:s.clock,eventId:input.sourceId});i.generation++;return entry;
}
export function recordObservation(s:State,input:unknown){
 const o=observationSchema.parse(input),i=information(s);getEntity(s,o.observerId,'character');if(o.targetId)getEntity(s,o.targetId);
 requireThat(!i.observations.some(row=>row.id===o.id),'immutable_observation');
 for(const p of o.propositionIds)requireThat(i.propositions.some(row=>row.id===p));
 if(o.salience<0.4&&o.attention!=='focused'&&!o.propositionIds.length)return {durable:false,observation:o};
 i.observations.push(o);
 for(const propositionId of o.propositionIds)acquireInformation(s,{characterId:o.observerId,propositionId,type:'knowledge',confidence:o.confidence,acquisition:'observation',sourceId:o.id,originIds:[o.id],informationAt:o.at,lastConfirmedAt:o.at,freshness:'current',secrecyAwareness:'unknown',text:o.raw});
 return {durable:true,observation:o};
}
// Called by sensory resolvers: only the supplied perceived fragment enters an observation.
export function perceiveInformation(s:State,input:{observerId:string;targetId:string;eventId:string;channel:'vision'|'hearing'|'reading';raw:string;propositionIds?:string[];method:string;salience?:number;languageUnderstood?:boolean;hidden?:boolean;recognition?:'unidentified'|'likely'|'recognized';recognizedAsId?:string}){
 const observer=data(getEntity(s,input.observerId,'character'),'character'),target=getEntity(s,input.targetId),p=observer.perception;
 const location=observer.locationId?s.entities.find(e=>e.id===observer.locationId):null;
 const conditions={position:p.position,partition:p.partition,attention:p.attention,vision:p.vision,hearing:p.hearing,locationId:observer.locationId,targetLocationId:target.data.locationId??target.id,lighting:location?.data.lighting??null,noise:location?.data.noise??0,weather:s.settings.weather,method:input.method,targetRevision:target.revision,targetPerception:target.data.perception??null};
 const key=informationHash([input.observerId,input.targetId,input.channel,conditions]),i=information(s);
 if(i.attempts.some(row=>row.key===key))return {observed:false};
 i.attempts.push({key,observerId:input.observerId,eventId:input.eventId,at:s.clock});
 const colocated=target.id===observer.locationId||target.data.locationId===observer.locationId,other=target.kind==='character'?data(target,'character').perception:null;
 const wall=!!other&&p.partition!==other.partition,distance=other?Math.abs(p.position-other.position):0;
 const quality=observer.condition!=='conscious'||!colocated?0:input.channel==='hearing'?Math.max(0,(p.hearing-Number(location?.data.noise??0)-distance*2-(wall?60:0))/100):wall||p.attention==='unaware'?0:Math.max(0,(p.vision-distance*2)/100);
 if(!quality||input.hidden)return {observed:false};
 const understood=input.languageUnderstood!==false,raw=understood?input.raw:'Speech was audible; its content was not understood.';
 const result=recordObservation(s,{id:randomUUID(),observerId:input.observerId,eventId:input.eventId,at:s.clock,locationId:observer.locationId,channel:input.channel,targetId:input.targetId,raw,clarity:quality,confidence:quality,attention:input.method==='passive'?'normal':'focused',conditions,recognition:input.recognition??'unidentified',recognizedAsId:input.recognizedAsId??null,salience:input.salience??0.5,propositionIds:understood?input.propositionIds??[]:[]});
 return {observed:true,...result};
}
export function transmitInformation(s:State,input:unknown){
 const t=transmissionSchema.parse(input),i=information(s);requireThat(!i.transmissions.some(row=>row.id===t.id),'duplicate_information');
 if(t.senderId){getEntity(s,t.senderId,'character');for(const id of t.propositionIds)requireThat(i.entries.some(e=>e.characterId===t.senderId&&e.propositionId===id&&e.status==='active'),'sender_information_unavailable');}
 for(const id of t.intendedRecipientIds)getEntity(s,id,'character');for(const id of t.propositionIds)requireThat(i.propositions.some(p=>p.id===id));
 t.sourceEntryIds=t.senderId?i.entries.filter(e=>e.characterId===t.senderId&&t.propositionIds.includes(e.propositionId)&&acquisitionUsable(s,e)).map(e=>e.id):[];
 if(t.parentId){const parent=i.transmissions.find(row=>row.id===t.parentId);requireThat(parent&&t.senderId&&parent.recipients.some(r=>r.characterId===t.senderId&&r.exposedAt&&r.comprehension>0),'transmission_parent_unavailable');t.originIds=parent!.originIds;}
 else t.originIds=t.senderId?unique(i.entries.filter(e=>e.characterId===t.senderId&&t.propositionIds.includes(e.propositionId)&&e.status==='active').flatMap(e=>e.originIds)):[t.id];
 // Exposure is a separate operation even when callers provide a delivery envelope.
 t.recipients=t.intendedRecipientIds.map(characterId=>({characterId,deliveredAt:null,exposedAt:null,comprehension:0,acceptance:0}));i.transmissions.push(t);return t;
}
export function exposeTransmission(s:State,id:string,characterId:string,input:{delivered?:boolean;exposed?:boolean;comprehension?:number;acceptance?:number;fragment?:string}){
 const i=information(s),t=i.transmissions.find(row=>row.id===id),r=t?.recipients.find(row=>row.characterId===characterId);requireThat(t&&r);if(input.delivered)r!.deliveredAt??=s.clock;
 if(!input.exposed)return r;requireThat(r!.deliveredAt,'message_not_delivered');
 const comprehension=Math.max(0,Math.min(input.fragment===undefined?1:0.99,input.comprehension??(input.fragment===undefined?1:0.5)));
 if(r!.exposedAt&&r!.comprehension>=comprehension)return r;
 r!.exposedAt=s.clock;r!.comprehension=comprehension;r!.acceptance=Math.max(0,Math.min(1,input.acceptance??0.5));
 if(!r!.comprehension)return r;
 // Partial previews never grant the propositions in the full message.
 if(input.fragment!==undefined||r!.comprehension<1){recordObservation(s,{id:randomUUID(),observerId:characterId,eventId:t!.id,at:s.clock,locationId:data(getEntity(s,characterId,'character'),'character').locationId,channel:'reading',targetId:null,raw:input.fragment??'Only part of the communication was understood.',clarity:r!.comprehension,confidence:r!.comprehension,attention:'normal',conditions:{partial:true},recognition:'unidentified',recognizedAsId:null,salience:0.5,propositionIds:[]});return r;}
 for(const propositionId of t!.propositionIds)acquireInformation(s,{characterId,propositionId,type:t!.channel==='rumor'?'rumor':'belief',confidence:r!.acceptance,acquisition:t!.channel==='rumor'?'rumor':t!.channel==='briefing'?'briefing':'testimony',sourceId:t!.id,originIds:t!.originIds,informationAt:t!.at,lastConfirmedAt:null,freshness:'recent',secrecyAwareness:t!.secrecy?'sensitive':'unknown',text:t!.text});return r;
}
export function addInformationRecord(s:State,input:unknown){const r=informationRecordSchema.parse(input),i=information(s);requireThat(!i.records.some(row=>row.id===r.id),'immutable_record');for(const id of r.propositionIds)requireThat(i.propositions.some(p=>p.id===id));if(r.supersedesId)requireThat(i.records.some(row=>row.id===r.supersedesId));i.records.push(r);return r;}
export function accessibleRecords(s:State,characterId:string){
 const c=data(getEntity(s,characterId,'character'),'character'),items=s.entities.filter(e=>e.kind==='item'&&!e.archived&&carriedBy(s,e,characterId));
 return information(s).records.filter(r=>!r.sealed&&(r.custodyItemId?items.some(item=>item.id===r.custodyItemId&&!item.data.locked&&Number(item.data.condition)>0&&(item.data.category!=='phone'||item.data.phoneState==='active'&&(!item.data.batteryRequired||Number(item.data.battery)>0))):r.scope==='public'||r.allowedCharacterIds.includes(characterId)||['institution','faction'].includes(r.scope)&&r.audienceFactionIds.some(id=>c.factionIds.includes(id)))&&(!r.locationId||r.locationId===c.locationId)&&r.requiredItemIds.every(id=>items.some(e=>e.id===id&&e.data.condition!==0&&!e.data.locked))&&r.requiredTags.every(tag=>c.tags.includes(tag)||items.some(e=>(e.data.tags as string[]).includes(tag))));
}
export function researchInformation(s:State,characterId:string,query:string,depth:'quick'|'standard'|'thorough'='standard'){
 const corpus=accessibleRecords(s,characterId),words=query.toLowerCase().split(/\W+/).filter(w=>w.length>2&&!['the','for','find','prior','calls','address','about','records','search'].includes(w));
 const scored=corpus.map(record=>({record,score:words.filter(w=>(record.title+' '+record.text).toLowerCase().includes(w)).length})).filter(row=>row.score>0||!words.length).sort((a,b)=>b.score-a.score||b.record.createdAt.localeCompare(a.record.createdAt));
 const rows=scored.slice(0,depth==='quick'?3:depth==='standard'?10:30).map(row=>row.record),minutes=depth==='quick'?1:depth==='standard'?10:30,i=information(s);
 for(const r of rows)for(const propositionId of r.propositionIds)acquireInformation(s,{characterId,propositionId,type:'belief',confidence:0.7,acquisition:'research',sourceId:r.id,originIds:r.sourceIds.length?r.sourceIds:[r.id],informationAt:r.informationAt,lastConfirmedAt:null,freshness:r.validUntil&&Date.parse(r.validUntil)<=Date.parse(s.clock)?'stale':Date.parse(r.informationAt)<Date.parse(s.clock)?'last_known':'current',secrecyAwareness:'unknown',text:r.text});
 i.accessLog.push({id:randomUUID(),characterId,recordIds:rows.map(r=>r.id),query,at:s.clock,unauthorized:rows.some(r=>r.misuseCharacterIds.includes(characterId)),minutes});
 return {records:rows.map(r=>({id:r.id,title:r.title,text:r.text,informationAt:r.informationAt,acquiredAt:s.clock,label:r.validUntil&&Date.parse(r.validUntil)<=Date.parse(s.clock)?'Stale':'Unverified'})),minutes,outcome:rows.length?'accessible-matches':'no-accessible-match',meaning:rows.length?'Source claims require interpretation.':'No accessible match was found; this does not establish nonexistence.'};
}
export function authorInformation(s:State,characterId:string,input:{kind:'belief'|'note'|'ooc-note'|'hypothesis'|'lead';text:string;sourceIds?:string[];confidence?:number;custodyItemId?:string|null},eventId:string){
 getEntity(s,characterId,'character');const i=information(s),known=new Set([...i.entries.filter(e=>e.characterId===characterId).flatMap(e=>[e.id,e.propositionId,e.sourceId]),...i.observations.filter(o=>o.observerId===characterId).map(o=>o.id),...i.accessLog.filter(a=>a.characterId===characterId).flatMap(a=>a.recordIds),...i.active.filter(a=>a.characterId===characterId&&a.kind!=='ooc-note').map(a=>a.id)]);for(const id of input.sourceIds??[])requireThat(known.has(id),'source_unavailable');
 if(input.kind==='belief'){const p=addProposition(s,{id:randomUUID(),subjectId:characterId,predicate:'player-belief',value:input.text,validFrom:s.clock,truth:'unknown',sourceIds:[eventId]});return acquireInformation(s,{characterId,propositionId:p.id,type:'belief',confidence:input.confidence??0.5,acquisition:'player-belief',sourceId:eventId,originIds:[eventId],informationAt:s.clock,lastConfirmedAt:null,freshness:'current',secrecyAwareness:'unknown',text:input.text});}
 const row=activeInformationSchema.parse({id:randomUUID(),characterId,kind:input.kind,text:input.text,status:'open',sourceIds:input.sourceIds??[],contradictsIds:[],entityIds:[],confidence:input.confidence??0.5,at:s.clock,updatedAt:s.clock,exact:true});
 if(input.kind==='note'){const carrier=input.custodyItemId??s.entities.find(e=>e.kind==='item'&&e.data.category==='phone'&&carriedBy(s,e,characterId)&&!e.data.locked)?.id??null;if(carrier)requireThat(s.entities.some(e=>e.id===carrier&&e.kind==='item'&&carriedBy(s,e,characterId)&&!e.data.locked),'note_carrier_unavailable');const record=addInformationRecord(s,{id:randomUUID(),title:'Character note',custodyItemId:carrier,text:input.text,propositionIds:[],createdAt:s.clock,informationAt:s.clock,validUntil:null,scope:'private',allowedCharacterIds:[characterId],requiredItemIds:[],requiredTags:[],locationId:null,supersedesId:null,sourceIds:[eventId,...(input.sourceIds??[])]});row.sourceIds=[record.id];i.accessLog.push({id:randomUUID(),characterId,recordIds:[record.id],query:'character-note',at:s.clock,unauthorized:false,minutes:0});}
 i.active.push(row);i.generation++;return row;
}
export function informationProjection(s:State,characterId:string){
 const i=information(s),entries=i.entries.filter(e=>e.characterId===characterId&&e.acquiredAt<=s.clock&&e.status!=='invalidated'&&!i.invalidatedNodeIds.includes(e.sourceId)),knownIds=new Set(entries.map(e=>e.propositionId)),accessibleIds=new Set(accessibleRecords(s,characterId).map(r=>r.id)),readIds=new Set(i.accessLog.filter(a=>a.characterId===characterId).flatMap(a=>a.recordIds));
 // No truth flags, hidden identifiers, source corpus counts, or creator conflict edges.
 const result={entries:entries.map(e=>({...e,label:e.status!=='active'||['historical','superseded'].includes(e.freshness)?'Historical':e.freshness==='stale'?'Stale':e.freshness==='last_known'?'Last Known':e.type==='knowledge'?'Known':e.type==='rumor'?'Rumored':e.type==='suspicion'?'Suspected':'Unverified'})),observations:i.observations.filter(o=>o.observerId===characterId&&o.at<=s.clock&&!i.invalidatedNodeIds.includes(o.id)),active:i.active.filter(a=>a.characterId===characterId&&!i.invalidatedNodeIds.includes(a.id)&&(a.kind!=='note'||a.sourceIds.some(id=>accessibleIds.has(id)))),conflicts:i.conflicts.filter(c=>knownIds.has(c.a)&&knownIds.has(c.b)).map(({id,a,b,status})=>({id,a,b,status})),records:i.records.filter(r=>readIds.has(r.id)&&accessibleIds.has(r.id)).map(r=>({id:r.id,title:r.title,text:r.text,informationAt:r.informationAt})),locations:spatialMarkers(s,characterId),interpretations:i.interpretations.filter(r=>r.viewerId===characterId&&r.at<=s.clock),unknownMeaning:'Not observed or established; not confirmed absent.'};
 const sanitize=informationSanitizer(s,characterId);return sanitize.needed?JSON.parse(JSON.stringify(result,(_key,value)=>typeof value==='string'?sanitize(value):value)) as typeof result:result;
}
export function playerInformationProjection(s:State,characterId:string,query='',offset=0,limit=100){
 const view=informationProjection(s,characterId),matches=view.entries.filter(e=>e.text.toLowerCase().includes(query.toLowerCase())).reverse(),pageSize=Math.min(100,Math.max(1,limit));
 return {...view,entries:matches.slice(offset,offset+pageSize),observations:view.observations.slice(-50),active:view.active.slice(-100),records:view.records.slice(-50),nextOffset:offset+pageSize<matches.length?offset+pageSize:null};
}
export function reviseActiveInformation(s:State,characterId:string,id:string,patch:{status?:InformationState['active'][number]['status'];confidence?:number;sourceIds?:string[];contradictsIds?:string[]}){
 const i=information(s),row=i.active.find(a=>a.id===id&&a.characterId===characterId);requireThat(row);
 const view=informationProjection(s,characterId),allowed=new Set([...view.entries.flatMap(e=>[e.id,e.propositionId,e.sourceId]),...view.observations.map(o=>o.id),...view.records.map(r=>r.id),...view.active.filter(a=>a.kind!=='ooc-note').map(a=>a.id)]);
 for(const id of [...(patch.sourceIds??[]),...(patch.contradictsIds??[])])requireThat(allowed.has(id),'source_unavailable');
 (row!.history??=[]).push({at:s.clock,status:row!.status,confidence:row!.confidence,sourceIds:[...row!.sourceIds],contradictsIds:[...row!.contradictsIds]});Object.assign(row!,patch,{updatedAt:s.clock});i.generation++;return row!;
}
export function detectConflicts(s:State){
 const i=information(s),groups=new Map<string,typeof i.propositions>();for(const p of i.propositions){if(p.qualifiers.exclusive===false||['communicated','observed','visited','said','transferred','player-belief'].includes(p.predicate))continue;const key=p.subjectId+':'+p.predicate,group=groups.get(key)??[];group.push(p);groups.set(key,group);}
 for(const group of groups.values())for(let a=0;a<group.length;a++)for(let b=a+1;b<group.length;b++){const x=group[a]!,y=group[b]!;if(JSON.stringify(x.value)===JSON.stringify(y.value)||x.validTo&&x.validTo<=y.validFrom||y.validTo&&y.validTo<=x.validFrom)continue;if(i.conflicts.some(c=>c.a===x.id&&c.b===y.id))continue;i.conflicts.push({id:randomUUID(),a:x.id,b:y.id,type:x.authority===y.authority&&x.authority>0?'canon':'source',status:x.intentionallyDisputed||y.intentionallyDisputed?'disputed':'open',at:s.clock,resolutionSourceId:null});}
}
export function informationDiagnostics(s:State){const i=information(s);return {whoKnows:i.propositions.map(p=>({propositionId:p.id,holders:i.entries.filter(e=>e.propositionId===p.id).map(e=>({characterId:e.characterId,type:e.type,confidence:e.confidence,status:e.status,sourceId:e.sourceId,originIds:e.originIds,independentOrigins:unique(e.originIds).length}))})),observerMatrix:i.observations,propagationGraph:i.transmissions,conflictGraph:i.conflicts,truth:i.propositions,beliefHistory:i.entries,active:i.active,accessLog:i.accessLog,cache:{generation:i.generation,summaries:i.summaries},integrityWarnings:i.conflicts.filter(c=>c.type==='canon'&&c.status==='open')};}
export function retconImpact(s:State,sourceIds:string[]){
 const i=information(s),ids=new Set(sourceIds),nodes=[
  ...i.propositions.map(p=>({id:p.id,kind:'propositions',sources:[...p.sourceIds,...(p.subjectId?[p.subjectId]:[])]})),
  ...i.entries.map(e=>({id:e.id,kind:'entries',sources:[e.propositionId,e.sourceId,...e.originIds]})),
  ...i.records.map(r=>({id:r.id,kind:'records',sources:[...r.sourceIds,...r.propositionIds]})),
  ...i.observations.map(o=>({id:o.id,kind:'observations',sources:[o.eventId,...o.propositionIds]})),
  ...i.transmissions.map(t=>({id:t.id,kind:'transmissions',sources:[...t.sourceEntryIds,...t.propositionIds,...t.originIds,...(t.parentId?[t.parentId]:[])]})),
  ...s.memories.map(m=>({id:m.id,kind:'memories',sources:[m.eventId,...(m.eventRefs??[])]})),
  ...s.entities.filter(e=>e.kind==='relationship').map(e=>({id:e.id,kind:'relationships',sources:(e.data.history as {eventId:string}[]).map(h=>h.eventId)})),
  ...i.active.map(a=>({id:a.id,kind:'hypotheses',sources:a.sourceIds})),...i.summaries.map(a=>({id:a.id,kind:'summaries',sources:a.sourceIds}))
 ];
 let changed=true;while(changed){changed=false;for(const node of nodes)if(!ids.has(node.id)&&node.sources.some(id=>ids.has(id))){ids.add(node.id);changed=true;}}
 const kinds=['propositions','entries','records','observations','transmissions','memories','relationships','hypotheses','summaries'] as const;return Object.fromEntries(kinds.map(kind=>[kind,nodes.filter(n=>n.kind===kind&&ids.has(n.id)).map(n=>n.id)])) as Record<typeof kinds[number],string[]>;
}
export function cohortAwareness(s:State,input:{id:string;label:string;transmissionIds:string[];exposure:number}){
 const i=information(s);requireThat(input.exposure>=0&&input.exposure<=1);for(const id of input.transmissionIds)requireThat(i.transmissions.some(t=>t.id===id));const prior=i.cohorts.find(c=>c.id===input.id);if(prior)Object.assign(prior,input);else i.cohorts.push(input);return input;
}
export function instantiateCohortAwareness(s:State,cohortId:string,characterId:string){
 getEntity(s,characterId,'character');const i=information(s),cohort=i.cohorts.find(c=>c.id===cohortId);requireThat(cohort);const acquired:string[]=[];
 for(const id of cohort!.transmissionIds){const t=i.transmissions.find(t=>t.id===id)!;const roll=parseInt(informationHash([cohortId,characterId,id]).slice(0,8),16)/0x100000000;if(roll>=cohort!.exposure)continue;
  if(!t.intendedRecipientIds.includes(characterId)){t.intendedRecipientIds.push(characterId);t.recipients.push({characterId,deliveredAt:null,exposedAt:null,comprehension:0,acceptance:0});}exposeTransmission(s,id,characterId,{delivered:true,exposed:true,acceptance:0.5});acquired.push(id);
 }return {characterId,acquiredTransmissionIds:acquired};
}
export function informationCorroboration(s:State,characterId:string,propositionId:string){const rows=information(s).entries.filter(e=>e.characterId===characterId&&e.propositionId===propositionId&&e.status==='active');return {reportCount:rows.length,independentOrigins:unique(rows.flatMap(e=>e.originIds)).length,confidence:rows.reduce((max,e)=>Math.max(max,e.confidence),0)};}
// Bridge existing canonical acquisition paths into the richer model. It never learns unobserved truth.
export function syncInformation(s:State){
 const i=information(s),propositions=new Set(i.propositions.map(p=>p.id)),entries=new Set(i.entries.map(e=>e.characterId+':'+e.propositionId)),facts=new Map(s.facts.map(f=>[f.id,f]));
 const existingPropositions=new Map(i.propositions.map(p=>[p.id,p]));
 for(const f of s.facts){const truth=f.truthStatus==='false'?'false':f.truthStatus==='disputed'?'disputed':f.truthStatus==='asserted'?'unknown':f.truthStatus==='superseded'?'historical':'true',old=existingPropositions.get(f.id);if(old){old.truth=truth;old.validTo=f.retiredAt??f.validUntil??null;continue;}i.propositions.push(propositionSchema.parse({id:f.id,subjectId:f.subjectId,predicate:f.predicate,value:f.value,qualifiers:f.qualifiers??{},validFrom:f.validFrom??f.at,validTo:f.retiredAt??f.validUntil??null,truth,sourceIds:[f.eventId,...(f.eventIds??[])]}));propositions.add(f.id);}
 for(const k of s.knowledge){const f=facts.get(k.factId);if(!f)continue;if(!propositions.has(f.id)){i.propositions.push(propositionSchema.parse({id:f.id,subjectId:f.subjectId,predicate:f.predicate,value:f.value,validFrom:f.validFrom??f.at,truth:f.truthStatus==='false'?'false':f.truthStatus==='disputed'?'disputed':f.truthStatus==='asserted'?'unknown':f.truthStatus==='superseded'?'historical':'true',sourceIds:[f.eventId]}));propositions.add(f.id);}if(entries.has(k.observerId+':'+k.factId))continue;i.entries.push({id:randomUUID(),characterId:k.observerId,propositionId:k.factId,type:'knowledge',confidence:k.confidence??1,acquisition:k.source.startsWith('read:')?'record':k.source.startsWith('witnessed:')?'observation':'creator',sourceId:k.source.startsWith('read:')?k.source.slice(5):f.eventId,originIds:[k.source.startsWith('read:')?k.source.slice(5):f.eventId],acquiredAt:k.at,informationAt:k.observedAt??f.at,lastConfirmedAt:k.observedAt??k.at,freshness:k.expiresAt&&Date.parse(k.expiresAt)<=Date.parse(s.clock)?'stale':'current',status:'active',secrecyAwareness:'unknown',supersedesId:null,text:f.predicate+': '+JSON.stringify(f.value)});entries.add(k.observerId+':'+k.factId);i.generation++;}
 const byBelief=new Map<string,InformationEntry[]>();for(const e of i.entries){const key=e.characterId+':'+e.propositionId,rows=byBelief.get(key)??[];rows.push(e);byBelief.set(key,rows);}
 for(const b of s.beliefs){
  const propositionId=typeof b.qualifiers?.informationPropositionId==='string'?b.qualifiers.informationPropositionId:b.id,sourceId=typeof b.qualifiers?.informationRecordId==='string'?b.qualifiers.informationRecordId:typeof b.qualifiers?.informationTransmissionId==='string'?b.qualifiers.informationTransmissionId:b.id;
  const existing=byBelief.get(b.observerId+':'+propositionId)??[];
  if(b.correctedBy||b.truthStatus==='disproven'){for(const e of existing){if(e.status==='invalidated')continue;e.status='superseded';e.freshness='superseded';}continue;}
  if(!propositions.has(propositionId)){i.propositions.push(propositionSchema.parse({id:propositionId,subjectId:b.subjectId??b.observerId,predicate:b.predicate??'believes',value:b.value??b.proposition,validFrom:b.validFrom??b.at,truth:'unknown',sourceIds:b.eventIds??[]}));propositions.add(propositionId);}
  if(existing.length)continue;const entry:InformationEntry={id:randomUUID(),acquiredAt:b.at,status:'active',supersedesId:null,characterId:b.observerId,propositionId,type:/gossip|rumor/.test(b.source)?'rumor':'belief',confidence:b.confidence,acquisition:typeof b.qualifiers?.informationRecordId==='string'?'record':'testimony',sourceId,originIds:[sourceId],informationAt:b.observedAt??b.at,lastConfirmedAt:null,freshness:'recent',secrecyAwareness:'unknown',text:b.proposition};i.entries.push(entry);byBelief.set(b.observerId+':'+propositionId,[entry]);i.generation++;
 }
 const sourceIds=new Set(i.sources.map(source=>source.id));for(const e of i.entries)if(!sourceIds.has(e.sourceId)){i.sources.push({id:e.sourceId,type:e.acquisition==='observation'?'observation':e.acquisition==='rumor'?'rumor':e.acquisition==='background'?'background':e.acquisition==='creator'?'creator':['record','research'].includes(e.acquisition)?'record':'testimony',entityId:e.characterId,recordId:['record','research'].includes(e.acquisition)?e.sourceId:null,originalClaim:e.text,reliability:e.confidence,createdAt:e.acquiredAt,eventId:e.sourceId});sourceIds.add(e.sourceId);}
 const byProposition=new Map(i.propositions.map(p=>[p.id,p]));
 for(const entry of i.entries)if(entry.freshness==='current'&&Date.parse(entry.informationAt)<Date.parse(s.clock)&&/location|address|schedule|employer|ownership|phone/.test(byProposition.get(entry.propositionId)?.predicate??''))entry.freshness='last_known';
}
