import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {settingsSchema,validateEntity,type State} from '../src/game/model.ts';
import {information,recordObservation,addProposition,acquireInformation,transmitInformation,exposeTransmission,retconImpact,addInformationRecord,researchInformation,reviseActiveInformation} from '../src/game/information.ts';
import {retellMemory} from '../src/game/information-operations.ts';
import {formExperiencedMemory,formObservationMemory,recallMemories,memoryRecallState,consolidateMemories,mutateMemory,inspectMemories,rebuildMemories,bindMemoryTimeline,memoryEffectKind,maintainMemories} from '../src/game/memory.ts';
import {buildInformationContext,validateInformationOutput,rebuildInformationSummary} from '../src/game/information-context.ts';
import {observerView} from '../src/game/epistemics.ts';
import {encodeSnapshot,decodeSnapshot} from '../src/game/snapshots.ts';
import {Game} from '../src/game/engine.ts';
import {TurnKernel} from '../src/game/turn-kernel.ts';
import {fixture,key,login} from './helpers.ts';

function setup(){
 const room=validateEntity({id:randomUUID(),kind:'location',name:'Diner',visibility:'campaign',data:{category:'room'}}),people=['Player','Nia','Malik'].map((name,index)=>validateEntity({id:randomUUID(),kind:'character',name,visibility:'campaign',data:{playable:index===0,locationId:room.id}}));
 const s:State={clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities:[room,...people],facts:[],knowledge:[],beliefs:[],memories:[]};information(s).memoryTimelineId=randomUUID();
 return {s,room,pc:people[0]!,npc:people[1]!,other:people[2]!};
}
function observation(s:State,ownerId:string,text:string,kind='threat',extra:Record<string,unknown>={}){
 const result=recordObservation(s,{id:randomUUID(),observerId:ownerId,eventId:randomUUID(),at:s.clock,locationId:s.entities.find(e=>e.id===ownerId)!.data.locationId,channel:'hearing',targetId:null,raw:text,clarity:1,confidence:0.8,attention:'focused',conditions:{memoryKind:kind,exactFragment:text},recognition:'unidentified',recognizedAsId:null,salience:0.7,propositionIds:[],...extra});
 return {o:result.observation,m:s.memories.at(-1)!};
}
function episode(s:State,ownerId:string,text='Worked the ordinary night shift.',kind='shift',extra={}){return formExperiencedMemory(s,{ownerId,eventId:randomUUID(),text,kind,sourceKind:'event',salience:0.45,locationId:s.entities.find(e=>e.id===ownerId)!.data.locationId as string,...extra})!;}
function advance(s:State,days:number){s.clock=new Date(Date.parse(s.clock)+days*86400000).toISOString();}
function scope(s:State,viewerId:string){return {campaignId:randomUUID(),timelineId:s.information!.memoryTimelineId!,viewerId,stateVersion:1,eventCursor:randomUUID()};}

test('S04 threats persist immediately with provenance and significant exact wording; no source means no memory',()=>{
 const {s,pc}=setup(),{m,o}=observation(s,pc.id,'I will kill you if you return.');
 assert.equal(m.cognition!.formationReason,'immediate consequential experience');assert.deepEqual(m.cognition!.sourceObservationIds,[o.id]);assert.equal(recallMemories(s,pc.id)[0]!.exactFragments[0]!.text,o.raw);
 assert.throws(()=>formExperiencedMemory(s,{ownerId:pc.id,eventId:randomUUID(),text:'Invented childhood',kind:'memory',sourceKind:'observation',sourceId:randomUUID()}),/source_unavailable/);
 assert.equal(s.memories.length,1);assert.equal(memoryEffectKind('player.dialogue','I promise you I will return.'),'player.dialogue.promise');
});
test('S04 observers retain independent partial details without PC emotional inference',()=>{
 const {s,pc,npc}=setup(),eventId=randomUUID(),a=observation(s,pc.id,'Friday... warehouse','evidence',{eventId,clarity:0.3,confidence:0.3,conditions:{partial:true}}),b=observation(s,npc.id,'A raised voice behind the door','argument',{eventId,confidence:0.6});
 assert.equal(a.m.cognition!.detail,'fragmentary');assert.equal(a.m.cognition!.emotionalSalience,0);assert.equal(a.m.cognition!.emotionAuthority,'none');assert.notEqual(a.m.id,b.m.id);
 assert.doesNotMatch(JSON.stringify(recallMemories(s,pc.id)),/raised voice/);assert.equal(recallMemories(s,pc.id)[0]!.exactFragments.length,0);
 assert.throws(()=>episode(s,pc.id,'Saw violence','violence',{emotion:{salience:1,authority:'npc-state',sourceId:eventId}}),/pc_emotion_requires_authority/);
 const emotional=episode(s,npc.id,'Experienced betrayal','betrayal',{emotion:{salience:0.9,authority:'npc-state',sourceId:eventId}});assert.equal(emotional.cognition!.emotionalSalience,0.9);
});
test('S04 repeated routine consolidates reversibly while robbery remains a separate cornerstone',()=>{
 const {s,pc}=setup();for(let n=0;n<20;n++)episode(s,pc.id);const robbery=episode(s,pc.id,'A robbery interrupted the shift.','robbery');
 const summaries=consolidateMemories(s,pc.id);assert.equal(summaries.length,1);assert.equal(summaries[0]!.cognition!.consolidation!.sourceMemoryIds.length,20);assert.equal(robbery.cognition!.status,'active');assert.ok(summaries[0]!.cognition!.consolidation!.retainedExceptions.includes(robbery.id));assert.equal(recallMemories(s,pc.id).length,2);
 assert.equal(s.memories.length,22);assert.equal(consolidateMemories(s,pc.id)[0]!.id,summaries[0]!.id);const before=JSON.stringify(s.facts);rebuildMemories(s,pc.id);assert.equal(JSON.stringify(s.facts),before);assert.equal(recallMemories(s,pc.id).length,2);
});
test('S04 source forgetting is independent of claim retention and origin lineage',()=>{
 const {s,pc,npc}=setup(),p=addProposition(s,{id:randomUUID(),subjectId:npc.id,predicate:'late',value:'late',validFrom:s.clock,truth:'unknown'}),sourceId=randomUUID();
 acquireInformation(s,{characterId:npc.id,propositionId:p.id,type:'belief',confidence:0.7,acquisition:'testimony',sourceId,originIds:[sourceId],informationAt:s.clock,lastConfirmedAt:null,freshness:'current',secrecyAwareness:'unknown',text:'Malik is late.'});
 const t=transmitInformation(s,{id:randomUUID(),senderId:npc.id,intendedRecipientIds:[pc.id],propositionIds:[p.id],text:'Malik is late.',channel:'rumor',at:s.clock,secrecy:false,parentId:null,originIds:[],mutation:'',artifactId:null,recipients:[]});exposeTransmission(s,t.id,pc.id,{delivered:true,exposed:true,acceptance:0.5});
 assert.equal(recallMemories(s,pc.id)[0]!.source,npc.name);advance(s,500);const recall=recallMemories(s,pc.id,{query:'late',explicit:true})[0]!;assert.equal(recall.source,'Source not recalled');assert.match(recall.text,/late/);assert.deepEqual(t.originIds,[sourceId]);assert.ok(recall.confidence<=0.5);
});
test('S04 time decay drops exact quotes and detail without deleting the event or resetting age on inspection',()=>{
 const {s,pc}=setup(),{m}=observation(s,pc.id,'I promise to return Friday. Bring the red ledger.');const original=JSON.stringify(s.information!.observations);advance(s,180);
 const before=JSON.stringify(s),view=inspectMemories(s,pc.id);assert.equal(JSON.stringify(s),before);assert.equal(view.reinforces,false);const recall=recallMemories(s,pc.id,{query:'Friday',explicit:true})[0]!;assert.equal(recall.exactFragments.length,0);assert.doesNotMatch(recall.text,/"|“|”/);assert.ok(recall.confidence<=m.cognition!.confidence);assert.equal(JSON.stringify(s.information!.observations),original);
});
test('S04 anchors and reinforcement raise retention without confidence inflation or forced narration',()=>{
 const {s,pc}=setup(),m=episode(s,pc.id);advance(s,30);const before=memoryRecallState(s,m);mutateMemory(s,pc.id,m.id,'anchor',randomUUID());mutateMemory(s,pc.id,m.id,'reinforce',randomUUID());assert.ok(memoryRecallState(s,m).accessibility>before.accessibility);assert.equal(m.cognition!.confidence,1);assert.equal(m.cognition!.recallCount,1);
 assert.equal(recallMemories(s,pc.id,{query:'unrelated-secret'}).length,1,'current location is an actual stored cue');assert.equal(recallMemories(s,pc.id,{query:'unrelated-secret',locationId:randomUUID()}).length,0);assert.equal(m.cognition!.mutations.length,2);
});
test('S04 recognition, procedural and spatial repetition form familiarity without changing competence',()=>{
 for(const type of ['recognition','procedural','spatial'] as const){const {s,pc,npc}=setup(),before=JSON.stringify(pc.data.skills);for(let n=0;n<4;n++)episode(s,pc.id,'Repeated '+type,type,{type,entityIds:[npc.id]});const summary=consolidateMemories(s,pc.id)[0]!;assert.equal(summary.cognition!.type,type);assert.equal(summary.cognition!.reinforcementCount,3);assert.equal(JSON.stringify(pc.data.skills),before);assert.equal(recallMemories(s,pc.id).length,1);}
});
test('S04 contamination and reconciliation preserve observation and relationship history',()=>{
 const {s,pc}=setup(),{m,o}=observation(s,pc.id,'A person ran past.','evidence',{clarity:0.3,confidence:0.3}),original=JSON.stringify(o);
 assert.throws(()=>mutateMemory(s,pc.id,m.id,'contaminate',randomUUID(),{interpretation:'It was Malik.'}),/requires_experienced_cause/);
 const cause=observation(s,pc.id,'The report identifies Malik.','record');mutateMemory(s,pc.id,m.id,'contaminate',cause.o.eventId,{interpretation:'It might have been Malik.',confidence:0.6});assert.equal(JSON.stringify(o),original);assert.equal(m.text,'A person ran past.');assert.equal((m.cognition!.mutations[0]!.previous as {confidence:number}).confidence,0.3);
 const betrayal=episode(s,pc.id,'Nia broke her promise.','betrayal');mutateMemory(s,pc.id,betrayal.id,'reinterpret',cause.o.eventId,{interpretation:'There may have been an explanation.'});assert.match(betrayal.text,/broke her promise/);assert.equal(betrayal.cognition!.status,'active');
});
test('S04 false generated history is rejected before becoming memory',()=>{
 const {s}=setup(),before=JSON.stringify(s);for(const draft of ['She smiled, as she always did.','He remembered their old argument.','Remember when we robbed that bank?'])assert.equal(validateInformationOutput(s,draft,'She smiled.').accepted,false);assert.equal(JSON.stringify(s),before);
});
test('S04 six-month skip, offscreen events, linked cues, and recall failure preserve durable storage',()=>{
 const {s,pc,npc,room}=setup(),old=episode(s,pc.id,'Saw a green sedan.','observation',{salience:0.35}),arrest=episode(s,npc.id,'Was arrested at the station.','arrest');advance(s,1800);
 assert.equal(recallMemories(s,pc.id,{locationId:randomUUID()}).length,0);assert.equal(s.memories.includes(old),true);assert.equal(recallMemories(s,npc.id,{query:'arrest'}).some(m=>m.id===arrest.id),true);assert.equal(recallMemories(s,pc.id,{query:'sedan',locationId:room.id,explicit:true}).some(m=>m.id===old.id),true);assert.equal(recallMemories(s,pc.id,{query:'motel key',locationId:randomUUID()}).length,0);
});
test('S04 branch inheritance and rewind validity prevent sibling and future leakage',()=>{
 const {s,pc}=setup(),old=episode(s,pc.id,'Shared childhood event.','milestone'),parent=s.information!.memoryTimelineId!,branch=structuredClone(s),child=randomUUID();bindMemoryTimeline(branch,child,true);assert.equal(branch.memories[0]!.cognition!.inheritedFromTimelineId,parent);assert.equal(branch.memories[0]!.cognition!.timelineId,child);
 advance(s,1);const future=episode(s,pc.id,'Confession after divergence.','confession');branch.memories.push(structuredClone(future));assert.equal(recallMemories(branch,pc.id).some(m=>m.id===future.id),false);assert.throws(()=>bindMemoryTimeline(branch,child),/timeline_mismatch/);assert.equal(recallMemories(branch,pc.id).some(m=>m.id===old.id),true);
 const rewind=structuredClone(s);rewind.clock='2012-06-01T12:00:00.000Z';bindMemoryTimeline(rewind,randomUUID(),true);assert.equal(rewind.memories.find(m=>m.id===future.id)!.cognition!.status,'invalid');
});
test('S04 corrupt owner is rejected; invalidation traces summaries and preserves downstream committed history',()=>{
 const {s,pc,npc}=setup(),{m}=observation(s,pc.id,'Private evidence.','evidence');const corrupt=structuredClone(m);corrupt.id=randomUUID();corrupt.observerId=npc.id;s.memories.push(corrupt);assert.equal(recallMemories(s,npc.id).length,0);mutateMemory(s,npc.id,corrupt.id,'invalidate',randomUUID());assert.equal(corrupt.cognition!.status,'invalid');
 const summary=rebuildInformationSummary(s,pc.id,'scene','case',[m.id],randomUUID());assert.ok(retconImpact(s,[m.id]).summaries.includes(summary.id));const downstream=randomUUID(),mutation=mutateMemory(s,pc.id,m.id,'invalidate',randomUUID(),{committedEventIds:[downstream]});assert.deepEqual(mutation.committedEventIds,[downstream]);assert.equal(s.information!.summaries.length,0);assert.equal(recallMemories(s,pc.id).length,0);assert.equal(s.information!.observations.length,1);
});
test('S04 stale semantic knowledge remains historical; external records do not become unexperienced memories',()=>{
 const {s,pc,npc}=setup(),p=addProposition(s,{id:randomUUID(),subjectId:npc.id,predicate:'employer',value:'Diner',validFrom:s.clock,truth:'unknown'});
 const sourceId=randomUUID(),entry=acquireInformation(s,{characterId:pc.id,propositionId:p.id,type:'belief',confidence:0.7,acquisition:'research',sourceId,originIds:[sourceId],informationAt:s.clock,lastConfirmedAt:null,freshness:'current',secrecyAwareness:'unknown',text:'Nia works at the diner.'});entry.freshness='stale';maintainMemories(s);assert.equal(recallMemories(s,pc.id)[0]!.status,'stale');assert.equal(s.memories.length,1);assert.equal(recallMemories(s,npc.id).length,0);
});
test('S04 duplicates do not reinforce or corroborate; summaries do not raise confidence',()=>{
 const {s,pc}=setup(),{m,o}=observation(s,pc.id,'Fragment of testimony.','testimony',{confidence:0.25});assert.equal(formObservationMemory(s,o)!.id,m.id);assert.equal(s.memories.length,1);assert.equal(m.cognition!.reinforcementCount,0);
 for(let n=0;n<4;n++)episode(s,pc.id,'Malik arrived late.','late',{confidence:0.4});const summary=consolidateMemories(s,pc.id)[0]!;assert.equal(summary.cognition!.confidence,0.4);assert.equal(summary.cognition!.consolidation!.sourceMemoryIds.length,4);
});
test('S04 10,000 memories have bounded recall/context with cold direct-cue fallback',()=>{
 const {s,pc}=setup(),base=episode(s,pc.id,'A remembered case.','evidence');s.memories=[];for(let n=0;n<10000;n++){const m=structuredClone(base);m.id=randomUUID();m.eventId=randomUUID();m.text='Case detail '+n;m.cognition!.gist=m.text;s.memories.push(m);}advance(s,5*365);
 const start=performance.now(),recalled=recallMemories(s,pc.id,{query:'detail 9999',limit:8}),context=buildInformationContext(s,scope(s,pc.id),'npc-planner','detail 9999',{semanticScore:()=>{throw Error('index unavailable');}}),elapsed=performance.now()-start;
 assert.ok(recalled.length<=8);assert.ok(recalled.some(m=>m.text.includes('9999')));assert.ok(context.manifest.finalEstimatedTokens<=4000);assert.ok(elapsed<5000,JSON.stringify({elapsed}));console.log(JSON.stringify({system04Scaling:{memories:10000,elapsedMs:Math.round(elapsed),contextTokens:context.manifest.finalEstimatedTokens}}));
});
test('S04 context is owner-scoped, paraphrase-safe and inspection never reinforces',()=>{
 const {s,pc,npc}=setup();observation(s,npc.id,'NPC_PRIVATE_THREAT','threat');observation(s,pc.id,'Keep this promise.','promise');advance(s,200);const before=JSON.stringify(s),context=buildInformationContext(s,scope(s,pc.id),'narration','promise');assert.equal(JSON.stringify(s),before);assert.doesNotMatch(JSON.stringify(context.bundle),/NPC_PRIVATE/);assert.match(JSON.stringify(context.bundle),/paraphrase only/);assert.equal(observerView(s,pc.id).memories.some(m=>m.text==='NPC_PRIVATE_THREAT'),false);
});
test('S04 remembered retelling preserves original rumor roots and uses the current interpretation',()=>{
 const {s,pc,npc}=setup(),p=addProposition(s,{id:randomUUID(),subjectId:npc.id,predicate:'claim',value:'late',validFrom:s.clock,truth:'unknown'}),source=randomUUID(),entry=acquireInformation(s,{characterId:pc.id,propositionId:p.id,type:'rumor',confidence:0.4,acquisition:'rumor',sourceId:source,originIds:[source],informationAt:s.clock,lastConfirmedAt:null,freshness:'current',secrecyAwareness:'unknown',text:'Malik arrived late.'}),m=s.memories.find(m=>m.cognition?.sourceInformationIds.includes(entry.id))!,cause=observation(s,pc.id,'Someone suggested Malik never arrived.','testimony');
 mutateMemory(s,pc.id,m.id,'contaminate',cause.o.eventId,{interpretation:'Malik may never have arrived.',confidence:0.3});const t=retellMemory(s,pc.id,m.id,npc.id,randomUUID());assert.equal(t.text,'Malik may never have arrived.');assert.deepEqual(t.originIds,[source]);assert.equal(p.value,'late');assert.equal(entry.text,'Malik arrived late.');assert.ok(s.information!.entries.filter(e=>e.characterId===npc.id).every(e=>e.confidence<=0.3));
});
test('S04 external calendar recovers an exact appointment only through record acquisition',()=>{
 const {s,pc,npc}=setup(),p=addProposition(s,{id:randomUUID(),subjectId:npc.id,predicate:'appointment',value:'Friday 18:15',validFrom:s.clock,truth:'unknown'});addInformationRecord(s,{id:randomUUID(),title:'Calendar appointment',text:'Meet Nia Friday at 18:15.',propositionIds:[p.id],createdAt:s.clock,informationAt:s.clock,validUntil:null,scope:'private',allowedCharacterIds:[pc.id],requiredItemIds:[],requiredTags:[],locationId:null,supersedesId:null,sourceIds:[]});assert.equal(recallMemories(s,pc.id).length,0);
 researchInformation(s,pc.id,'appointment');const m=recallMemories(s,pc.id,{query:'Friday'})[0]!;assert.match(m.text,/18:15/);assert.equal(m.source,'Read in a record');assert.equal(recallMemories(s,npc.id).length,0);
});
test('S04 live transcript and open questions retain continuity; resolution releases elevated retention',()=>{
 const {s,pc}=setup(),{o,m}=observation(s,pc.id,'Will you return Friday?','question');const active={id:randomUUID(),characterId:pc.id,kind:'question' as const,text:o.raw,status:'open' as const,sourceIds:[o.id],contradictsIds:[],entityIds:[],confidence:0.8,at:s.clock,updatedAt:s.clock,exact:true};information(s).active.push(active);maintainMemories(s);assert.equal(m.cognition!.factors.pending,1);
 const context=buildInformationContext(s,scope(s,pc.id),'dialogue','Friday',{recentDialogue:[{id:randomUUID(),text:'Yes. Friday, at six.',required:true}]});assert.match(JSON.stringify(context.bundle),/Yes. Friday, at six/);assert.match(JSON.stringify(context.bundle),/Will you return Friday/);
 reviseActiveInformation(s,pc.id,active.id,{status:'resolved'});maintainMemories(s);assert.equal(m.cognition!.factors.pending,0);
});
test('S04 observation plus learned proposition creates one memory and quote fragments must be perceived',()=>{
 const {s,pc,npc}=setup(),p=addProposition(s,{id:randomUUID(),subjectId:npc.id,predicate:'evidence',value:'fragment',validFrom:s.clock,truth:'unknown'}),{m,o}=observation(s,pc.id,'Only Friday was audible.','evidence',{propositionIds:[p.id]});assert.equal(s.memories.length,1);assert.ok(m.cognition!.sourceInformationIds.length);assert.deepEqual(m.cognition!.sourceObservationIds,[o.id]);
 assert.throws(()=>episode(s,pc.id,'A threat was audible.','threat',{exactFragments:['I will kill you.']}),/quote_not_observed/);
});
test('S04 schema 50 persists cognition, read-only inspection, idempotent anchors, save and branch lineage',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
  const timeline=await game.initialize(f.creator,f.campaign.id),{s,pc}=setup();pc.data.controllerUserId=f.player.id;await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:s.entities},key());
  const created=await game.mutate(f.creator,timeline.id,2,key(),{},'creator.memory',true,(state,eventId)=>({result:{memoryId:formExperiencedMemory(state,{ownerId:pc.id,eventId,text:'Shared past rescue.',kind:'rescue',sourceKind:'authored-backstory'})!.id}}));
  let state=await game.load(timeline.id);const memory=state.memories.find(m=>m.id===created.memoryId)!;assert.equal(memory.cognition!.timelineId,timeline.id);
  const creator=await login(f,'creator@example.test'),player=await login(f,'player@example.test'),before=JSON.stringify(state),url='/game/timelines/'+timeline.id+'/memory/inspect?characterId='+pc.id;
  assert.equal((await f.app.inject({method:'GET',url,headers:{cookie:creator.cookie}})).statusCode,200);assert.equal(JSON.stringify(await game.load(timeline.id)),before);assert.equal((await f.app.inject({method:'GET',url,headers:{cookie:player.cookie}})).statusCode,403);
  const request={method:'POST' as const,url:'/game/timelines/'+timeline.id+'/memory/anchor',headers:{cookie:player.cookie,'x-csrf-token':player.csrf,origin:f.settings.origin,'idempotency-key':key()},payload:{revision:3,characterId:pc.id,memoryId:memory.id}};const response=await f.app.inject(request);assert.equal(response.statusCode,200,response.body);assert.deepEqual((await f.app.inject(request)).json(),response.json());state=await game.load(timeline.id);assert.equal(state.memories.find(m=>m.id===memory.id)!.cognition!.mutations.length,1);
  const save=await game.save(f.creator,timeline.id,'Shared memories'),branch=await game.branch(f.creator,timeline.id,save.id,'Memory branch'),child=await game.load(branch.id);assert.equal(child.memories.find(m=>m.id===memory.id)!.cognition!.inheritedFromTimelineId,timeline.id);assert.equal(child.memories.find(m=>m.id===memory.id)!.cognition!.timelineId,branch.id);assert.equal((await game.load(timeline.id)).memories.find(m=>m.id===memory.id)!.cognition!.timelineId,timeline.id);
  const kernel=new TurnKernel(game),command={commandId:randomUUID(),sessionId:timeline.id,expectedRevision:4,actorId:pc.id,mode:'STORY',input:{kind:'freeform',text:'Player never forgot that.'}},anchor=await kernel.execute(f.player,command);assert.equal(anchor.status,'PRESENTED');assert.equal(anchor.revision,5);assert.equal((await game.load(timeline.id)).clock,state.clock);assert.deepEqual(await kernel.execute(f.player,command),anchor);
  const query=await kernel.execute(f.player,{...command,commandId:randomUUID(),expectedRevision:5,input:{kind:'freeform',text:'What do I remember about rescue?'}});assert.equal(query.status,'PRESENTED');assert.match(JSON.stringify(query.recall),/rescue/);assert.equal(query.revision,5);
  const snapshot={version:1,state:await game.load(timeline.id),transcript:[]},encoded=await encodeSnapshot(f.store,snapshot),decoded=await decodeSnapshot(f.store,encoded);assert.deepEqual((decoded as typeof snapshot).state.memories,snapshot.state.memories);
 }finally{await f.close();}
});
