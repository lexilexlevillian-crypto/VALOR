import {createHash} from 'node:crypto';
import {simulationId as randomUUID} from './turn-runtime.ts';
import {data,getEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {fact} from './epistemics.ts';
import {matchesCondition} from './conditions.ts';

type EventStatus=Data<'quest'>['status'];
type JournalClass=Data<'quest'>['journal'][number]['classification'];
export type EventEffect={id:string;text:string;observers:string[];type:string;subjectId:string};
const deterministicUuid=(seed:string):ReturnType<typeof randomUUID>=>{const hex=createHash('sha256').update(seed).digest('hex');return (hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-'+((parseInt(hex[16]!,16)&3)|8).toString(16)+hex.slice(17,20)+'-'+hex.slice(20,32)) as ReturnType<typeof randomUUID>;};
const unique=(values:(string|null|undefined)[])=>[...new Set(values.filter((value):value is string=>!!value))];
const terminal=(status:EventStatus)=>['succeeded','failed','expired'].includes(status);

export function learnEvent(s:State,eventId:string,observerIds:string[],input:{text:string;classification?:JournalClass;sourceId?:string|null;objectiveId?:string|null;branchId?:string;notifyPhone?:boolean;linkKind?:'event'|'message';linkId?:string;causeEventId?:string;entryId?:string}){
 const event=getEntity(s,eventId,'quest'),record=data(event,'quest'),observers=unique(observerIds);if(!observers.length)return null;
 for(const observerId of observers)getEntity(s,observerId,'character');
 const id=input.entryId??deterministicUuid([event.id,input.text,input.classification??'discovered',input.sourceId??'',input.branchId??'',...observers].join('|'));
 const existing=record.journal.find(entry=>entry.id===id);if(existing){existing.knownByIds=unique([...existing.knownByIds,...observers]);event.data=record as Entity['data'];return existing;}
 const entry:Data<'quest'>['journal'][number]={id,at:s.clock,text:input.text,classification:input.classification??'discovered',sourceId:input.sourceId??null,objectiveId:input.objectiveId??null,branchId:input.branchId??record.activeBranchId,knownByIds:observers,notifyPhone:input.notifyPhone??false,linkKind:input.linkKind??'event',linkId:input.linkId??event.id};
 record.knownByIds=unique([...record.knownByIds,...observers]);record.journal.push(entry);event.data=record as Entity['data'];
 fact(s,event.id,'event-update',{entryId:entry.id,classification:entry.classification,text:entry.text},input.causeEventId??deterministicUuid(entry.id+'|learned'),observers,{source:'event:'+event.id,eventIds:[event.id],audience:observers});return entry;
}

export function transitionEvent(s:State,eventId:string,input:{toStatus?:EventStatus;toState?:string;reason:string;watcherId?:string|null;outcomeId?:string|null;actorId?:string|null;branchId?:string;idempotencyKey:string;causeEventId:string;knownByIds?:string[];journalText?:string;notifyPhone?:boolean}){
 const event=getEntity(s,eventId,'quest'),record=data(event,'quest');if(record.trace.some(row=>row.idempotencyKey===input.idempotencyKey))return false;
 const fromStatus=record.status,fromState=record.state,toStatus=input.toStatus??fromStatus,toState=input.toState||toStatus;
 if(terminal(fromStatus)&&fromStatus!==toStatus)throw new Error('event_terminal_transition');
 const branchId=input.branchId??record.activeBranchId;if(branchId)record.activeBranchId=branchId;record.status=toStatus;record.state=toState;
 record.trace.push({id:deterministicUuid(event.id+'|trace|'+input.idempotencyKey),at:s.clock,eventId:input.causeEventId,fromState,toState,fromStatus,toStatus,reason:input.reason,watcherId:input.watcherId??null,outcomeId:input.outcomeId??null,actorId:input.actorId??null,branchId,idempotencyKey:input.idempotencyKey});event.data=record as Entity['data'];
 const observers=unique(input.knownByIds??record.knownByIds);if(observers.length&&input.journalText)learnEvent(s,event.id,observers,{text:input.journalText,classification:terminal(toStatus)?'outcome':'history',sourceId:input.watcherId??input.actorId??null,branchId,notifyPhone:input.notifyPhone,causeEventId:input.causeEventId,entryId:deterministicUuid(event.id+'|journal|'+input.idempotencyKey)});return true;
}

export function applyEventAction(s:State,eventId:string,actorId:string,input:{outcomeId?:string;actionTags?:string[];reason:string;causeEventId:string}){
 const event=getEntity(s,eventId,'quest'),record=data(event,'quest');getEntity(s,actorId,'character');if(terminal(record.status))throw new Error('event_already_terminal');
 const tags=new Set(input.actionTags??[]),outcome=input.outcomeId?record.possibleOutcomes.find(row=>row.id===input.outcomeId):record.possibleOutcomes.find(row=>(!row.branchId||row.branchId===record.activeBranchId)&&row.conditions.every(condition=>matchesCondition(s,condition))&&(!row.validActionTags.length||row.validActionTags.some(tag=>tags.has(tag))));
 if(!outcome)throw new Error('event_action_has_no_valid_outcome');if(input.outcomeId&&outcome.hidden&&!outcome.knownByIds.includes(actorId))throw new Error('event_outcome_unknown');if(outcome.branchId&&record.activeBranchId&&outcome.branchId!==record.activeBranchId)throw new Error('event_branch_isolated');if(!outcome.conditions.every(condition=>matchesCondition(s,condition)))throw new Error('event_outcome_conditions_unmet');if(outcome.validActionTags.length&&!outcome.validActionTags.some(tag=>tags.has(tag)))throw new Error('event_action_unsupported');
 const changed=transitionEvent(s,event.id,{toStatus:outcome.toStatus,toState:outcome.toState,reason:input.reason,outcomeId:outcome.id,actorId,branchId:outcome.branchId,idempotencyKey:[input.causeEventId,actorId,outcome.id].join('|'),causeEventId:input.causeEventId,knownByIds:[actorId],journalText:outcome.description||outcome.label,notifyPhone:false});for(const watcherId of outcome.followUpWatcherIds){const watcher=getEntity(s,watcherId,'watcher'),w=data(watcher,'watcher');w.suppressed=false;w.fired=false;watcher.data=w as Entity['data'];}return changed;
}

function primaryMatches(s:State,w:Data<'watcher'>,end:number){
 const subjectId=w.subjectId??w.eventId,subject=subjectId?s.entities.find(entity=>entity.id===subjectId&&!entity.archived):null;
 if(w.trigger==='time')return !!w.dueAt&&Date.parse(w.dueAt)<=end;
 if(w.trigger==='location')return subject?.data.locationId===w.targetId;
 if(w.trigger==='item')return subject?.kind==='item'&&(subject.data.ownerId===w.targetId||subject.data.possessorId===w.targetId)&&Number(subject.data.quantity)>0;
 if(w.trigger==='health')return subject?.kind==='character'&&Number(subject.data.blood)<=w.threshold;
 if(w.trigger==='relationship')return subject?.kind==='relationship'&&Number(subject.data.trust)>=w.threshold;
 if(w.trigger==='quest'||w.trigger==='event')return subject?.kind==='quest'&&subject.data.status==='active';
 if(w.trigger==='evidence')return subject?.kind==='evidence'&&!subject.data.destroyed&&(!w.targetId||data(subject,'evidence').discoveredBy.includes(w.targetId));
 if(w.trigger==='knowledge')return s.knowledge.some(row=>row.observerId===w.subjectId&&s.facts.some(proposition=>proposition.id===row.factId&&proposition.subjectId===w.targetId&&!proposition.retiredAt));
 if(w.trigger==='fact')return s.facts.some(proposition=>(!w.subjectId||proposition.subjectId===w.subjectId)&&(!w.targetId||proposition.objectId===w.targetId)&&!proposition.retiredAt);
 return true;
}

function eventForWatcher(s:State,w:Data<'watcher'>){const id=w.eventId??((w.effect.includes('quest')||w.effect.includes('event')||w.effect==='select-branch'||w.effect==='journal'||w.effect==='notify')?w.targetId:null);const entity=id?s.entities.find(row=>row.id===id&&row.kind==='quest'&&!row.archived):null;return entity??null;}

export function advanceEventDeadlines(s:State,end:number,causeEventId:string,effects:EventEffect[]){
 for(const event of s.entities.filter(row=>row.kind==='quest'&&!row.archived)){const record=data(event,'quest');if(record.status!=='active'||!record.deadline||Date.parse(record.deadline)>end)continue;const key='deadline|'+record.deadline;const changed=transitionEvent(s,event.id,{toStatus:'expired',toState:'expired',reason:'Authored deadline passed while unresolved.',idempotencyKey:key,causeEventId,knownByIds:record.knownByIds,journalText:'The situation expired unresolved.',notifyPhone:true});if(changed)effects.push({id:deterministicUuid(event.id+'|deadline-effect|'+record.deadline),text:'An unresolved situation expired: '+event.name,observers:[...record.knownByIds],type:'event.expired',subjectId:event.id});}
}

export function evaluateEventWatchers(s:State,end:number,causeEventId:string,effects:EventEffect[],changedKinds:string[]=['time']){
 const changed=new Set(changedKinds),watchers=s.entities.filter(row=>row.kind==='watcher'&&!row.archived).sort((left,right)=>Number(right.data.priority)-Number(left.data.priority)||left.id.localeCompare(right.id)),resolvedGroups=new Set<string>();let evaluated=0,fired=0;
 for(const watcher of watchers){if(evaluated>=10000)throw new Error('watcher_evaluation_budget_exceeded');const w=data(watcher,'watcher');
  if(w.suppressed||w.once&&w.fired||w.changeKinds.length&&!w.changeKinds.some(kind=>changed.has(kind)))continue;evaluated++;w.evaluationCount++;w.lastEvaluationAt=s.clock;
  const key=w.idempotencyKey||[watcher.id,w.eventId??w.targetId??'',w.branchId,w.dueAt??'',causeEventId].join('|');if(w.trace.some(row=>row.idempotencyKey===key)){watcher.data=w as Entity['data'];continue;}
  if(w.expiresAt&&Date.parse(w.expiresAt)<end){w.trace.push({id:deterministicUuid(watcher.id+'|expired|'+key),at:s.clock,eventId:causeEventId,idempotencyKey:key,result:'expired',reason:'watcher expired'});watcher.data=w as Entity['data'];continue;}
  if(w.lastFired&&end-Date.parse(w.lastFired)<w.cooldownMinutes*60000){watcher.data=w as Entity['data'];continue;}
  const event=eventForWatcher(s,w),eventRecord=event?data(event,'quest'):null;if(w.branchId&&eventRecord?.activeBranchId&&w.branchId!==eventRecord.activeBranchId){w.suppressed=true;w.trace.push({id:deterministicUuid(watcher.id+'|branch|'+key),at:s.clock,eventId:causeEventId,idempotencyKey:key,result:'conflicted',reason:'inactive branch'});watcher.data=w as Entity['data'];continue;}
  const groupKey=w.conflictGroup?(event?.id??'global')+'|'+w.conflictGroup:'';if(groupKey&&resolvedGroups.has(groupKey))continue;
  const compound=w.conditions.map(condition=>matchesCondition(s,condition)),matches=primaryMatches(s,w,end)&&(!compound.length||(w.conditionMode==='all'?compound.every(Boolean):compound.some(Boolean)));if(!matches){watcher.data=w as Entity['data'];continue;}
  if(eventRecord&&!eventRecord.allowOffscreenResolution&&!w.notifyCharacterIds.length&&['fail-quest','fail-event','resolve-event','transform-event','transition-event'].includes(w.effect)){watcher.data=w as Entity['data'];continue;}
  const observers=unique([...w.notifyCharacterIds,...(eventRecord?.knownByIds??[])]),journalText=w.journalText||w.description||watcher.name;let changedEvent=false;
  if(event){const outcome=w.outcomeId?eventRecord!.possibleOutcomes.find(row=>row.id===w.outcomeId):null,toStatus:EventStatus=outcome?.toStatus??(w.effect==='fail-quest'||w.effect==='fail-event'?'failed':w.effect==='resolve-event'?'succeeded':eventRecord!.status),toState=outcome?.toState||w.toState||(w.effect==='transform-event'?'transformed':toStatus),branch=w.branchId||outcome?.branchId||eventRecord!.activeBranchId;changedEvent=transitionEvent(s,event.id,{toStatus,toState,reason:'Watcher '+watcher.name+' fired.',watcherId:watcher.id,outcomeId:outcome?.id??w.outcomeId,branchId:branch,idempotencyKey:key,causeEventId,knownByIds:observers,journalText:['journal','notify'].includes(w.effect)||terminal(toStatus)?journalText:undefined,notifyPhone:w.effect==='notify'||w.notifyCharacterIds.length>0});}
  if(w.effect==='reveal-lore'&&w.targetId&&w.subjectId){getEntity(s,w.targetId);fact(s,w.targetId,'discovered',true,causeEventId,[w.subjectId],{source:'watcher:'+watcher.id});}
  if(w.effect==='npc-offer'&&w.subjectId)effects.push({id:deterministicUuid(watcher.id+'|offer|'+key),text:journalText,observers:[w.subjectId],type:'npc.offer',subjectId:watcher.id});
  w.fired=true;w.lastFired=s.clock;w.trace.push({id:deterministicUuid(watcher.id+'|fired|'+key),at:s.clock,eventId:causeEventId,idempotencyKey:key,result:'fired',reason:changedEvent?'event transitioned':'effect applied'});watcher.data=w as Entity['data'];fired++;
  if(groupKey){resolvedGroups.add(groupKey);for(const other of watchers){if(other.id===watcher.id)continue;const candidate=data(other,'watcher');if(candidate.conflictGroup===w.conflictGroup&&eventForWatcher(s,candidate)?.id===event?.id){candidate.suppressed=true;candidate.trace.push({id:deterministicUuid(other.id+'|conflict|'+key),at:s.clock,eventId:causeEventId,idempotencyKey:key,result:'conflicted',reason:'higher-priority conflicting watcher fired'});other.data=candidate as Entity['data'];}}}
  effects.push({id:deterministicUuid(watcher.id+'|effect|'+key),text:journalText,observers,type:'watcher.fired',subjectId:event?.id??watcher.id});
 }
 return {evaluated,fired};
}

export function journalView(s:State,observerId:string){
 getEntity(s,observerId,'character');return s.entities.filter(row=>row.kind==='quest'&&!row.archived).flatMap(event=>{const record=data(event,'quest'),entries=record.journal.filter(entry=>entry.knownByIds.includes(observerId)&&(!entry.branchId||!record.activeBranchId||entry.branchId===record.activeBranchId));if(!entries.length&&!record.knownByIds.includes(observerId))return [];return [{eventId:event.id,name:event.name,premise:record.premise||record.description,status:record.status,state:record.state,deadline:record.deadline,stakes:record.stakes,objectives:record.objectiveRecords.filter(objective=>(!objective.hidden||objective.knownByIds.includes(observerId))&&(!objective.branchId||!record.activeBranchId||objective.branchId===record.activeBranchId)).map(({knownByIds,...objective})=>objective),entries:entries.map(({knownByIds,...entry})=>entry),outcomes:record.possibleOutcomes.filter(outcome=>!outcome.hidden||outcome.knownByIds.includes(observerId)).map(({knownByIds,conditions,validActionTags,followUpWatcherIds,...outcome})=>outcome)}];}).sort((left,right)=>left.name.localeCompare(right.name));
}

export function caseFileView(s:State,caseId:string,observerId:string){
 const file=data(getEntity(s,caseId,'case'),'case');getEntity(s,observerId,'character');if(file.investigatorId!==observerId)throw new Error('case_file_forbidden');const knownFactIds=new Set(s.knowledge.filter(row=>row.observerId===observerId).map(row=>row.factId)),visibleEvidence=new Set(s.entities.filter(row=>row.kind==='evidence'&&!row.archived&&(data(row,'evidence').knownByIds.includes(observerId)||data(row,'evidence').discoveredBy.includes(observerId)||data(row,'evidence').custodianId===observerId)).map(row=>row.id));
 const proven=file.factIds.filter(id=>knownFactIds.has(id)).map(id=>s.facts.find(row=>row.id===id&&!row.retiredAt)).filter((row):row is NonNullable<typeof row>=>!!row&&(row.truthStatus==='verified'||(row.confidence??1)>=.8)).map(row=>({id:row.id,text:row.predicate+': '+String(row.value),sourceIds:row.evidenceIds??[],confidence:row.confidence??1}));
 const discovered=file.leadRecords.filter(row=>row.status!=='discarded'&&(!row.sourceEvidenceId||visibleEvidence.has(row.sourceEvidenceId))).map(row=>({id:row.id,text:row.summary,sourceIds:unique([row.sourceEvidenceId,row.sourceInformantId]),confidence:row.reliability/100}));
 const suspected=file.hypotheses.filter(row=>!['refuted','closed'].includes(row.status)).map(row=>({id:row.id,text:row.proposition,sourceIds:row.sourceEvidenceIds.filter(id=>visibleEvidence.has(id)),confidence:row.confidence/100,status:row.status}));
 const related=new Set(unique([...file.suspectIds,...file.crimeIds,...file.evidenceIds,...file.factIds,...file.hypotheses.map(row=>row.subjectId)]));const rumored=s.beliefs.filter(row=>row.observerId===observerId&&row.truthStatus!=='disproven'&&(row.predicate==='rumor'||row.source.startsWith('rumor:'))&&(!row.subjectId||related.has(row.subjectId))).map(row=>({id:row.id,text:row.proposition,sourceIds:row.eventIds??[],confidence:row.confidence}));return {caseId,name:getEntity(s,caseId,'case').name,stage:file.stage,proven,discovered,suspected,rumored};
}

export function eventNotifications(s:State,observerId:string){return journalView(s,observerId).flatMap(event=>event.entries.filter(entry=>entry.notifyPhone).map(entry=>({id:entry.id,at:entry.at,text:entry.text,classification:entry.classification,target:{kind:entry.linkKind,id:entry.linkId},eventId:event.eventId}))).sort((left,right)=>right.at.localeCompare(left.at));}
