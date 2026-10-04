import {randomUUID} from 'node:crypto';
import type {Effect} from './simulation.ts';
import type {Entity,State} from './model.ts';
import {validateEntity} from './model.ts';

type Candidate={key:string;anchor:Entity|null;importance:number;reason:string;summaries:string[];observers:string[];links:string[];category:'event'|'object'};
export type StoryCardLifecycleResult={created:string[];refreshed:string[];resolved:string[];archived:string[]};

const terminalQuests=new Set(['succeeded','failed','expired']);
const importantCaseStages=new Set(['arrest','charged','trial','sentenced','closed']);
const terminalChases=new Set(['caught','escaped','abandoned','crashed']);
const unique=<T>(values:T[])=>[...new Set(values)];
const millisecondsPerDay=86_400_000;
const addDays=(iso:string,value:number)=>new Date(Date.parse(iso)+value*millisecondsPerDay).toISOString();
const clean=(value:unknown,limit=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit);
const record=(entity:Entity)=>entity.data as Record<string,any>;

function effectImportance(type:string){
 const value=type.toLowerCase();
 if(value==='death'||value.startsWith('death.'))return 100;
 if(/^event\.(succeeded|failed|expired)$/.test(value))return 95;
 if(/^chase\.(caught|escaped|abandoned|crashed)$/.test(value))return 90;
 if(/^combat\.(surrendered|fled|ended)$/.test(value))return 90;
 if(value==='injury'||value.startsWith('injury.'))return 85;
 if(value==='crime'||value.startsWith('crime.'))return 85;
 if(/^vehicle\.(recovered|stolen|theft-report|collision|forced-entry)$/.test(value))return 82;
 if(/^weapon\.(disarmed|recovered)$/.test(value))return 78;
 if(value==='watcher.fired'||value==='watcher.triggered')return 76;
 if(value==='event.action')return 72;
 if(value==='weapon.shot')return 55;
 return 0;
}

function terminalReason(entity:Entity|undefined){
 if(!entity)return '';
 if(entity.archived)return `The linked ${entity.kind} has been archived.`;
 const value=record(entity);
 if(entity.kind==='quest'&&terminalQuests.has(value.status))return `Quest ${value.status}.`;
 if(entity.kind==='case'&&value.stage==='closed')return 'Case closed.';
 if(entity.kind==='combat'&&value.active===false)return 'Combat ended.';
 if(entity.kind==='chase'&&terminalChases.has(value.status))return `Chase ${value.status}.`;
 if(entity.kind==='injury'&&value.course?.status==='resolved')return 'Injury resolved.';
 return '';
}

function statusTags(tags:string[],status:string){return unique([...tags.filter(tag=>!tag.startsWith('status:')),`status:${status}`]);}

function retire(card:Entity,status:'resolved'|'stale',reason:string,now:string,archiveAfterDays:number){
 const value=record(card),lifecycle=value.lifecycle;
 if(lifecycle.status===status&&lifecycle.resolvedAt)return false;
 lifecycle.status=status;lifecycle.resolvedAt=now;lifecycle.archiveAt=addDays(now,archiveAfterDays);lifecycle.reason=reason;
 value.validUntil=now;value.deactivation={mode:'any',at:now,eventIds:[],keywords:[],tags:[],reason};
 value.tags=statusTags(value.tags,status);card.revision+=1;
 return true;
}

function addCandidate(map:Map<string,Candidate>,candidate:Candidate){
 const current=map.get(candidate.key);
 if(!current){map.set(candidate.key,candidate);return;}
 const replacesReason=candidate.importance>=current.importance;
 current.importance=Math.max(current.importance,candidate.importance);
 current.summaries=unique([...current.summaries,...candidate.summaries]);
 current.observers=unique([...current.observers,...candidate.observers]);
 current.links=unique([...current.links,...candidate.links]);
 if(replacesReason)current.reason=candidate.reason;
}

function collectCandidates(beforeState:State,state:State,eventId:string,effects:Effect[]){
 if(!effects.length)return new Map<string,Candidate>();
 const settings=state.settings.storyCards,prior=new Map(beforeState.entities.map(entity=>[entity.id,entity])),candidates=new Map<string,Candidate>();
 const effectScore=Math.max(0,...effects.map(effect=>effectImportance(effect.type)));
 const summaries=effects.filter(effect=>effectImportance(effect.type)>=55).map(effect=>effect.text);
 const observers=unique(effects.flatMap(effect=>effect.observers).filter(id=>state.entities.some(entity=>entity.id===id&&!entity.archived)));
 const effectLinks=unique(effects.map(effect=>effect.subjectId).filter(id=>state.entities.some(entity=>entity.id===id&&!entity.archived)));
 const addEntity=(entity:Entity,importance:number,reason:string,category:'event'|'object'='event',extra:string[]=[])=>addCandidate(candidates,{key:`entity:${entity.id}`,anchor:entity,importance,reason,summaries:unique([...summaries,...extra]),observers,links:unique([entity.id,...effectLinks]),category});

 for(const entity of state.entities){
  if(entity.archived||entity.kind==='storycard'||entity.kind==='lore')continue;
  const value=record(entity),previous=prior.get(entity.id),old=previous?record(previous):null;
  if(entity.kind==='deathRecord'&&!previous)addEntity(entity,100,'A death became part of the campaign record.');
  else if(entity.kind==='crime'&&!previous)addEntity(entity,88,'A consequential crime was recorded.');
  else if(entity.kind==='injury'&&(!previous||old!.severity!==value.severity)&&(Number(value.severity??0)>=25||['gunshot','puncture','burn','overdose'].includes(value.category)))addEntity(entity,Math.max(78,Math.min(95,Math.round(Number(value.severity??0)))),'A serious injury changed the situation.');
  else if(entity.kind==='quest'&&(!previous||old!.status!==value.status))addEntity(entity,terminalQuests.has(value.status)?95:78,terminalQuests.has(value.status)?`Quest ${value.status}.`:'A quest reached a significant new state.');
  else if(entity.kind==='case'&&(!previous||old!.stage!==value.stage)&&importantCaseStages.has(value.stage))addEntity(entity,value.stage==='closed'?95:82,`Case advanced to ${value.stage}.`);
  else if(entity.kind==='combat'&&(!previous||old!.active!==value.active))addEntity(entity,value.active===false?90:75,value.active===false?'Combat ended.':'Combat began.');
  else if(entity.kind==='chase'&&(!previous||old!.status!==value.status))addEntity(entity,terminalChases.has(value.status)?90:75,terminalChases.has(value.status)?`Chase ${value.status}.`:'A chase began.');
 }

 const evidenceObjectIds=unique<string>(state.entities.filter(entity=>entity.kind==='evidence'&&!entity.archived&&record(entity).sourceEventId===eventId).flatMap(entity=>(record(entity).objectIds??[]) as string[]));
 for(const entity of state.entities.filter(entity=>entity.kind==='item'&&!entity.archived)){
  const value=record(entity),history=(value.eventHistory??[]).filter((entry:any)=>entry.eventId===eventId);
  if(!history.length&&!evidenceObjectIds.includes(entity.id))continue;
  const actions=unique<string>(history.map((entry:any)=>String(entry.action).toLowerCase())),tags=new Set<string>(((value.tags??[]) as string[]).map(tag=>tag.toLowerCase()));
  const explicit=['story-important','quest-item','unique','artifact'].some(tag=>tags.has(tag));
  const consequential=actions.some(action=>['stolen','damaged','recovered','disarmed','discarded'].includes(action));
  const causal=actions.some(action=>['shot','damaged','disarmed'].includes(action))&&effectScore>=70;
  const valuable=Number(value.price??0)>=settings.importantItemPriceCents;
  const importance=explicit?88:evidenceObjectIds.includes(entity.id)?84:causal?82:consequential?80:valuable?74:0;
  if(importance)addEntity(entity,importance,`Important item event: ${actions.join(', ')||'linked to evidence'}.`,'object',history.map((entry:any)=>entry.note));
 }
 for(const entity of state.entities.filter(entity=>entity.kind==='vehicle'&&!entity.archived)){
  const value=record(entity),history=(value.history??[]).filter((entry:any)=>entry.eventId===eventId),damage=(value.damageRecords??[]).filter((entry:any)=>entry.eventId===eventId);
  if(!history.length&&!damage.length&&!evidenceObjectIds.includes(entity.id))continue;
  const actions=unique([...history.map((entry:any)=>String(entry.action).toLowerCase()),...damage.map((entry:any)=>String(entry.kind).toLowerCase())]);
  const consequential=actions.some(action=>/stolen|recovered|collision|damage|forced|theft|destroy/.test(action));
  const importance=evidenceObjectIds.includes(entity.id)?86:consequential?84:Number(value.price??0)>=settings.importantItemPriceCents?75:0;
  if(importance)addEntity(entity,importance,`Important vehicle event: ${actions.join(', ')||'linked to evidence'}.`,'object',[...history,...damage].map((entry:any)=>entry.note??entry.description));
 }
 if(effectScore>=settings.minimumImportance&&candidates.size===0)addCandidate(candidates,{key:`event:${eventId}`,anchor:null,importance:effectScore,reason:'A consequential event changed the campaign.',summaries,observers,links:effectLinks,category:'event'});
 return candidates;
}

function upsertCard(state:State,eventId:string,candidate:Candidate,result:StoryCardLifecycleResult){
 const settings=state.settings.storyCards,now=state.clock,summary=clean(unique(candidate.summaries.map(value=>clean(value)).filter(Boolean)).slice(0,5).join(' ')||candidate.reason);
 let card=state.entities.find(entity=>entity.kind==='storycard'&&!entity.archived&&record(entity).lifecycle?.mode==='automatic'&&record(entity).lifecycle.key===candidate.key);
 const links=candidate.links.filter(id=>state.entities.some(entity=>entity.id===id&&!entity.archived)),resolvedReason=terminalReason(candidate.anchor??undefined);
 if(card){
  const value=record(card),lifecycle=value.lifecycle;
  lifecycle.importance=Math.max(lifecycle.importance,candidate.importance);lifecycle.lastRelevantAt=now;lifecycle.reason=resolvedReason||candidate.reason;
  lifecycle.sourceEventIds=unique([...lifecycle.sourceEventIds,eventId]).slice(-1000);lifecycle.updates=[...lifecycle.updates,{at:now,eventId,summary,importance:candidate.importance}].slice(-100);
  value.sourceRefs=unique([...value.sourceRefs,eventId]).slice(-100);value.links=unique([...value.links,...links]);value.linkDetails=value.links.slice(0,500).map((targetId:string)=>({targetId,type:targetId===candidate.anchor?.id?'subject':'source',note:''}));
  value.priority=Math.max(value.priority,candidate.importance);value.description=lifecycle.updates.slice(-5).map((update:any)=>`${update.at.slice(0,10)} — ${update.summary}`).join('\n');
  value.scope.peopleIds=unique([...value.scope.peopleIds,...candidate.observers]);value.activation.peopleIds=value.scope.peopleIds;
  if(candidate.observers.length)card.visibility='campaign';
  if(!resolvedReason){lifecycle.status='active';lifecycle.resolvedAt=null;lifecycle.archiveAt=null;value.validUntil=null;value.deactivation={mode:'never',at:null,eventIds:[],keywords:[],tags:[],reason:''};value.tags=statusTags(value.tags,'active');}
  card.revision+=1;result.refreshed.push(card.id);
 }else{
  const name=candidate.anchor?(candidate.category==='object'?`${candidate.anchor.name} — significant history`:candidate.anchor.name):`Significant event — ${now.slice(0,16).replace('T',' ')}`;
  card=validateEntity({id:randomUUID(),kind:'storycard',name,visibility:candidate.observers.length?'campaign':'creator',archived:false,revision:1,data:{description:`${now.slice(0,10)} — ${summary}`,tags:['automatic-story-card',candidate.category==='object'?'story-object':'story-event',`status:${resolvedReason?'resolved':'active'}`,`anchor:${candidate.anchor?.kind??'event'}`],sections:[],mediaIds:[],schemaVersion:2,subjectId:candidate.anchor?.id??null,source:'Automatic story-card lifecycle',sourceRefs:[eventId],validFrom:now,validUntil:resolvedReason?now:null,links,linkDetails:links.slice(0,500).map(targetId=>({targetId,type:targetId===candidate.anchor?.id?'subject':'source',note:''})),priority:candidate.importance,scope:{campaign:false,placeIds:[],peopleIds:candidate.observers,relationshipIds:[],eventIds:[],factionIds:[]},activation:{mode:'all',locationId:null,characterId:null,keywords:[],requiredTags:[],placeIds:[],peopleIds:candidate.observers,relationshipIds:[],eventIds:[],factionIds:[],from:null,until:null},deactivation:resolvedReason?{mode:'any',at:now,eventIds:[],keywords:[],tags:[],reason:resolvedReason}:{mode:'never',at:null,eventIds:[],keywords:[],tags:[],reason:''},lifecycle:{mode:'automatic',key:candidate.key,status:resolvedReason?'resolved':'active',importance:candidate.importance,createdAt:now,lastRelevantAt:now,resolvedAt:resolvedReason?now:null,archiveAt:resolvedReason?addDays(now,settings.archiveAfterDays):null,reason:resolvedReason||candidate.reason,sourceEventIds:[eventId],updates:[{at:now,eventId,summary,importance:candidate.importance}]},embedding:[]}});
  state.entities.push(card);result.created.push(card.id);
 }
 if(resolvedReason&&record(card).lifecycle.status!=='resolved'&&retire(card,'resolved',resolvedReason,now,settings.archiveAfterDays))result.resolved.push(card.id);
 state.entities[state.entities.findIndex(entity=>entity.id===card!.id)]=validateEntity(card);
}

export function maintainAutomaticStoryCards(beforeState:State,state:State,eventId:string,effects:Effect[]):StoryCardLifecycleResult{
 const result:StoryCardLifecycleResult={created:[],refreshed:[],resolved:[],archived:[]},settings=state.settings.storyCards,now=state.clock;
 const candidates=settings.automatic?collectCandidates(beforeState,state,eventId,effects):new Map<string,Candidate>();
 for(const candidate of candidates.values())if(candidate.importance>=settings.minimumImportance)upsertCard(state,eventId,candidate,result);
 const refreshed=new Set([...result.created,...result.refreshed]);
 for(const card of state.entities.filter(entity=>entity.kind==='storycard'&&!entity.archived&&record(entity).lifecycle?.mode==='automatic')){
  const value=record(card),lifecycle=value.lifecycle;
  if((lifecycle.status==='resolved'||lifecycle.status==='stale')&&lifecycle.archiveAt&&Date.parse(lifecycle.archiveAt)<=Date.parse(now)){lifecycle.status='archived';lifecycle.reason=lifecycle.reason||'Retention period elapsed.';card.archived=true;value.tags=statusTags(value.tags,'archived');card.revision+=1;result.archived.push(card.id);continue;}
  if(lifecycle.status!=='active'||refreshed.has(card.id))continue;
  const anchor=value.subjectId?state.entities.find(entity=>entity.id===value.subjectId):undefined,reason=value.subjectId&&!anchor?'The linked record no longer exists.':terminalReason(anchor);
  if(reason){if(retire(card,'resolved',reason,now,settings.archiveAfterDays))result.resolved.push(card.id);continue;}
  if(lifecycle.lastRelevantAt&&Date.parse(now)-Date.parse(lifecycle.lastRelevantAt)>=settings.staleAfterDays*millisecondsPerDay&&retire(card,'stale',`No material event refreshed this card for ${settings.staleAfterDays} days.`,now,settings.archiveAfterDays))result.resolved.push(card.id);
 }
 const active=state.entities.filter(entity=>entity.kind==='storycard'&&!entity.archived&&record(entity).lifecycle?.mode==='automatic'&&record(entity).lifecycle.status==='active').sort((a,b)=>Date.parse(record(a).lifecycle.lastRelevantAt)-Date.parse(record(b).lifecycle.lastRelevantAt));
 while(active.length>settings.maxAutomaticActive){const card=active.shift()!;if(retire(card,'stale','Automatic story-card active limit reached; oldest card retired.',now,settings.archiveAfterDays))result.resolved.push(card.id);}
 return result;
}
