import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key,login} from './helpers.ts';
import {Game,checksum} from '../src/game/engine.ts';
import {TurnKernel} from '../src/game/turn-kernel.ts';
import {validateEntity} from '../src/game/model.ts';
import {parseDirectorText,splitDirectorInput} from '../src/game/narrative-directives.ts';
import {narrativeProfileSchema} from '../src/game/narrative-profile.ts';
import {narrativeStyleMemory,narrativeRepairInstruction} from '../src/game/narrative-style.ts';
import {buildNarrativeBundle,deterministicDraft,validateNarrativeDraft,narrativeChoices} from '../src/game/narrative-runtime.ts';
import {communicate} from '../src/game/communication.ts';
import type {Effect} from '../src/game/simulation.ts';
import {NarrativePreferences} from '../src/game/narrative-preferences.ts';
import {NarrativeGateway,type NarrativeProvider} from '../src/game/ai.ts';
import {narrativeReviewChecks,guardFlexibleParagraph,acceptNarrativeReview} from '../src/game/narrative-review.ts';
import {perceptionSchema,reception} from '../src/game/narrative-perception.ts';
import {observerView} from '../src/game/epistemics.ts';

const entity=(kind:'location'|'character',name:string,data:Record<string,unknown>={})=>validateEntity({id:key(),kind,name,visibility:'campaign',data});
async function setup(){
 const f=await fixture(),game=new Game(f.store),t=await game.initialize(f.creator,f.campaign.id),room=entity('location','Diner',{description:'The counter was scuffed.'}),next=entity('location','Street'),pc=entity('character','Alex',{playable:true,controllerUserId:f.player.id,locationId:room.id}),npc=entity('character','Malik',{locationId:room.id});
 room.data.exits=[{to:next.id,minutes:1,modes:['walk']}];await game.bulkEdit(f.creator,t.id,{revision:1,entities:[room,next,pc,npc]},key());
 const kernel=new TurnKernel(game);
 const command=async(input:unknown,mode:'GAME'|'STORY'='GAME',commandId=key())=>kernel.execute(f.player,{commandId,sessionId:t.id,expectedRevision:(await game.access(f.player,t.id)).t.revision,actorId:pc.id,mode,input});
 const frozen=async(eventId:string)=>JSON.parse((await f.store.get<{context_json:string}>('SELECT context_json FROM turn_narrative_contexts WHERE event_id=?',eventId))!.context_json).narrative;
 return {...f,game,t,room,next,pc,npc,command,frozen};
}
test('Master S02 OOC markers stay outside quoted speech and reject partial truth overrides',()=>{
 assert.equal(splitDirectorInput('I say “OOC: make it rain.”'),null);
 assert.deepEqual(splitDirectorInput('I wait one minute. [OOC] short'),{canonical:'I wait one minute.',director:'short'});
 assert.equal(parseDirectorText('keep the next reply short').directive?.patch.responseLength,'short');
 assert.equal(parseDirectorText('use first-person present from now on').directive?.scope,'character');
 assert.equal(parseDirectorText('short and make it rain').directive,undefined);
 assert.equal(parseDirectorText('make Malik love me').directive,undefined);
 assert.equal(parseDirectorText("he's jealous but hiding it").directive?.interior,"he's jealous but hiding it");
 for(const field of ['narratorTone','profanity','professionalDetail','graphicness','antiClicheStrength','dreams'])assert.ok(field in narrativeProfileSchema.parse({}));
 assert.equal(narrativeProfileSchema.parse({}).expositionDensity,'minimal');
});
test('Master S02 one-response OOC is idempotent, mode-specific, survives inspection and expires on commit',async()=>{
 const f=await setup();try{
  const before=checksum(await f.game.load(f.t.id)),revision=(await f.game.access(f.player,f.t.id)).t.revision,commandId=key();
  const input={kind:'freeform',text:'OOC: use first-person present and keep the next reply short'};
  const first=await f.command(input,'GAME',commandId),replay=await f.command(input,'GAME',commandId);
  assert.deepEqual(first,replay);assert.equal(first.status,'PRESENTED');assert.equal(first.revision,revision);assert.equal(checksum(await f.game.load(f.t.id)),before);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM narrative_directives'))!.n,1);
  await f.command({kind:'inspection',panel:'scene'});
  const story=await f.command({kind:'action',action:{type:'look'}},'STORY');assert.equal((await f.frozen(story.eventId)).profile.perspective,'third');
  const turn=await f.command({kind:'action',action:{type:'look'}}),bundle=await f.frozen(turn.eventId);
  assert.equal(bundle.profile.perspective,'first');assert.equal(bundle.profile.responseLength,'short');assert.match(turn.narration,/I am/);
  const next=await f.command({kind:'action',action:{type:'look'}});assert.equal((await f.frozen(next.eventId)).profile.perspective,'third');
  assert.equal((await f.store.get<{consumed_event_id:string}>('SELECT consumed_event_id FROM narrative_directives'))!.consumed_event_id,turn.eventId);
 }finally{await f.close();}
});
test('Master S02 mixed input strips director instructions; private PC interior never becomes speech or NPC knowledge',async()=>{
 const f=await setup();try{
  const result=await f.command({kind:'freeform',text:'I wait one minute. OOC: PC interior: I am jealous but hiding it.'},'STORY');
  assert.equal(result.status,'COMMITTED');const b=await f.frozen(result.eventId);assert.equal(b.playerAuthorship.text,'I wait one minute.');
  assert.match(result.narration,/private account: “I am jealous but hiding it”/);
  const state=await f.game.load(f.t.id);assert.doesNotMatch(JSON.stringify({facts:state.facts,knowledge:state.knowledge,memories:state.memories}),/jealous|OOC/);
  const stored=await f.store.get<{input_text:string}>('SELECT input_text FROM story_turns WHERE id=?',result.eventId);assert.equal(stored!.input_text,'I wait one minute.');
  assert.equal(b.facts.some((fact:{source:string})=>fact.source==='player:interior'),true);
  const external={...b,profile:narrativeProfileSchema.parse({...b.profile,narrativeDistance:'external'})};assert.doesNotMatch(JSON.stringify(deterministicDraft(external)),/jealous/);
  const hash=checksum(state),knowledge=await f.command({kind:'freeform',text:'/ooc where is an unknown NPC?'});
  assert.equal(knowledge.status,'PRESENTED');assert.match(knowledge.presentation.text,/remain unknown/);assert.equal(checksum(await f.game.load(f.t.id)),hash);
 }finally{await f.close();}
});
test('Master S02 scene directives expire at a transition; persistent settings merge and campaign writes are authorized',async()=>{
 const f=await setup();try{
  await f.command({kind:'action',action:{type:'look'}});
  await f.command({kind:'narrative_directive',directive:{scope:'scene',patch:{narratorTone:'warm'},focusId:f.npc.id}});
  const local=await f.command({kind:'action',action:{type:'look'}});assert.equal((await f.frozen(local.eventId)).profile.narratorTone,'warm');
  const moved=await f.command({kind:'action',action:{type:'travel',destinationId:f.next.id,mode:'walk'}});assert.equal((await f.frozen(moved.eventId)).profile.narratorTone,'neutral');
  await f.command({kind:'freeform',text:'OOC: use first-person from now on'});
  await f.command({kind:'freeform',text:'OOC: use present tense from now on'});
  const prefs=await new NarrativePreferences(f.game).read(f.player,f.t.id,f.pc.id,'GAME');assert.equal(prefs.profile.perspective,'first');assert.equal(prefs.profile.tense,'present');
  await assert.rejects(()=>f.command({kind:'narrative_directive',directive:{scope:'campaign',patch:{tense:'past'}}}));
  await assert.rejects(()=>f.command({kind:'narrative_directive',directive:{focusId:key()}}),/focus_unavailable/);
 }finally{await f.close();}
});
test('Master S02 regeneration installs new prose but preserves frozen events, world time and earlier versions',async()=>{
 const f=await setup();try{
  const turn=await f.command({kind:'action',action:{type:'look'}}),original=await f.frozen(turn.eventId),before=checksum(await f.game.load(f.t.id));
  const regenerate=await f.command({kind:'regenerate_narration',turnId:turn.eventId,patch:{perspective:'second',tense:'present',descriptionDensity:'sparse'}});
  assert.match(regenerate.narration,/You are/);assert.equal(regenerate.rerolled,false);assert.equal(checksum(await f.game.load(f.t.id)),before);
  assert.deepEqual(await f.frozen(turn.eventId),original);
  const versions=await f.store.all<{narration:string}>('SELECT narration FROM narration_versions WHERE event_id=? ORDER BY rowid',turn.eventId);assert.equal(versions.length,2);assert.equal(versions[0]!.narration,turn.narration);assert.equal(versions[1]!.narration,regenerate.narration);
  assert.equal((await f.game.view(f.player,f.t.id,f.pc.id)).turns.at(-1)!.narration,regenerate.narration);
  const recap=await f.command({kind:'freeform',text:'OOC: recap'});assert.equal(recap.status,'PRESENTED');assert.equal(checksum(await f.game.load(f.t.id)),before);
 }finally{await f.close();}
});
test('Master S02 private diagnostics and malformed directives remain server-enforced',async()=>{
 const f=await setup();try{
  const auth=await login(f,'player@example.test'),headers={cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf},turn=await f.command({kind:'action',action:{type:'look'}});
  const denied=await f.app.inject({method:'GET',url:'/game/timelines/'+f.t.id+'/narrative/diagnostics/'+turn.eventId,headers});assert.equal(denied.statusCode,403);
  const before=checksum(await f.game.load(f.t.id)),bad=await f.command({kind:'freeform',text:'OOC: short and make it rain'});
  assert.match(bad.presentation.text,/not applied/);assert.equal(checksum(await f.game.load(f.t.id)),before);assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM narrative_directives'))!.n,0);
  await assert.rejects(()=>f.command({kind:'narrative_directive',directive:{patch:{money:10000}}}));
 }finally{await f.close();}
});
test('Master S02 loud-room whisper does not grant listener knowledge and normal quiet-room speech does',async()=>{
 const f=await setup();try{
  const state=await f.game.load(f.t.id),room=state.entities.find(e=>e.id===f.room.id)!;room.data.noise=90;assert.equal(validateEntity(room).data.noise,90);let effects:Effect[]=[];
  communicate(state,f.pc.id,{method:'say',language:'en',targetId:f.npc.id,text:'The code is 1234.',volume:'whisper'},key(),effects);
  assert.equal(effects.some(e=>e.observers.includes(f.npc.id)),false);assert.equal(state.facts.at(-1)!.audience?.includes(f.npc.id),false);
  room.data.noise=0;effects=[];communicate(state,f.pc.id,{method:'say',language:'en',targetId:f.npc.id,text:'Hello.',volume:'normal'},key(),effects);assert.ok(effects.some(e=>e.observers.includes(f.npc.id)));
 }finally{await f.close();}
});
test('Master S02 private authorship stays untrusted at provider boundary; diagnostics retain drafts and targeted repair',async()=>{
 const f=await setup();try{
  const settings=(await f.game.load(f.t.id)).settings;settings.tokenBudget=100000;settings.userTokenBudget=100000;await f.game.configure(f.creator,f.t.id,2,settings,key());
  await f.command({kind:'freeform',text:'OOC: PC interior: I am furious but hiding it.'});
  const turn=await f.command({kind:'action',action:{type:'look'}}),before=checksum(await f.game.load(f.t.id));let attempts=0;
  const provider:NarrativeProvider={id:'master-trace',complete:async request=>{
   attempts++;const sources=request.context.provenance.filter(entry=>entry.id!=='narrative-guidance'&&entry.id!=='original-story-input'),privateEntry=sources.find(entry=>JSON.stringify(entry.content).includes('private account'));
   assert.equal(privateEntry?.trust,'untrusted');assert.equal(privateEntry?.source,'player-input');assert.equal(privateEntry?.privacy,'private');
   if(attempts===2)assert.match(request.prompt.instructions,/Remove unsupported claims/);
   return {traceId:request.traceId,usage:{inputTokens:100,outputTokens:100},toolCalls:[],output:{paragraphs:sources.map(entry=>{const fact=entry.content as {id:string;text:string};return {sourceIds:[fact.id],text:fact.text+(attempts===1?' Alex decided to attack Malik.':'')};})}};
  }};
  const result=await new NarrativeGateway(f.game,[provider]).narrate(f.player,f.t.id,turn.eventId,provider.id);
  assert.equal(result.status,'validated');assert.equal(attempts,2);assert.equal(checksum(await f.game.load(f.t.id)),before);
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});
  const diagnostics=await new NarrativePreferences(f.game).diagnostics(f.creator,f.t.id,turn.eventId),render=diagnostics.renders[0];
  assert.equal(render.drafts.length,2);assert.equal(render.drafts[0].failure,'narrative_unsupported_claim');assert.ok(render.validation.stateFidelityPass);assert.equal(render.validation.noNewCanonicalEvents,true);assert.equal(render.finalAcceptedDraft,result.narration);assert.equal(render.usage.outputTokens,200);assert.ok(render.latencyMs>=0);
 }finally{await f.close();}
});
test('Master S02 mode bloat repair preserves event fidelity and drift needs a sustained trend',async()=>{
 const f=await setup();try{
  const state=await f.game.load(f.t.id),effects:Effect[]=Array.from({length:6},(_,i)=>({id:key(),type:'resolved.action',subjectId:f.pc.id,text:'The light number '+i+' went out.',observers:[f.pc.id]}));
  const b=buildNarrativeBundle({state,before:structuredClone(state),actorId:f.pc.id,turnId:key(),effects,profile:narrativeProfileSchema.parse({responseLength:'short'}),layers:[],mode:'GAME',control:{holder:'PLAYER'},playerText:'',recent:[]});
  const choices=narrativeChoices(b),raw={paragraphs:choices.map(c=>({sourceIds:[c.id],text:c.variants[0]}))},result=validateNarrativeDraft(raw,b);
  assert.ok(result.repairs.some(r=>r.kind==='paragraph-pacing'));assert.ok(result.validation.stateFidelityPass);assert.equal(result.validation.renderedEventIds.length,6);
  for(const effect of effects)assert.ok(result.text.includes(effect.text));
  assert.deepEqual(validateNarrativeDraft(deterministicDraft(b),b).validation.hardFailures,[]);
  const profile=narrativeProfileSchema.parse({responseLength:'short'}),long=Array.from({length:6},()=> 'A full sentence remained here.').join('\n\n');
  assert.deepEqual(narrativeStyleMemory([long],profile).drift,[]);assert.ok(narrativeStyleMemory(Array(8).fill(long),profile).drift.includes('response-length'));
  assert.match(narrativeRepairInstruction('narrative_missing_required_fact'),/missing required source/);
 }finally{await f.close();}
});

for(const mode of ['GAME','STORY'] as const)test('Master S02 '+mode+' flexible prose requires independent review and preserves committed state',async()=>{
 const f=await setup();try{
  const settings=(await f.game.load(f.t.id)).settings;Object.assign(settings,{tokenBudget:200000,userTokenBudget:200000,contextTokens:8000});await f.game.configure(f.creator,f.t.id,2,settings,key());
  const turn=await f.command({kind:'action',action:{type:'wait',minutes:1}},mode),before=checksum(await f.game.load(f.t.id));let calls=0,reviews=0;
  const provider:NarrativeProvider={id:'prose-test',async complete(request){
   calls++;let output:unknown;
   if(request.prompt.id==='narrative-review'){reviews++;const candidate=request.context.provenance.find(p=>p.id==='candidate')!.content as {paragraphs:Array<{sourceIds:string[];text:string}>};output={checks:Object.fromEntries(narrativeReviewChecks.map(k=>[k,true])),paragraphs:candidate.paragraphs.map((p,index)=>({index,sourceIds:p.sourceIds,entailed:true})),defects:[]};}
   else output={paragraphs:request.context.provenance.flatMap(p=>{const c=p.content as {id?:string;text?:string};return c.id&&c.text?[{sourceIds:[c.id],text:c.text==='The counter was scuffed.'?'Scuffs marked the counter.':c.text}]:[]})};
   return {traceId:request.traceId,output,usage:{inputTokens:100,outputTokens:100},toolCalls:[]};
  }};
  const result=await new NarrativeGateway(f.game,[provider]).narrate(f.player,f.t.id,turn.eventId,provider.id);
  assert.equal(result.status,'validated');assert.match(result.narration,/Scuffs marked the counter/);assert.equal(reviews,1);assert.equal(calls,2);assert.equal(checksum(await f.game.load(f.t.id)),before);
 }finally{await f.close();}
});

for(const mode of ['GAME','STORY'] as const)test('Master S02 '+mode+' semantic rejection cannot be overridden by self-citations or retry',async()=>{
 const f=await setup();try{
  const settings=(await f.game.load(f.t.id)).settings;Object.assign(settings,{tokenBudget:200000,userTokenBudget:200000,contextTokens:8000});await f.game.configure(f.creator,f.t.id,2,settings,key());
  const turn=await f.command({kind:'action',action:{type:'wait',minutes:1}},mode),before=checksum(await f.game.load(f.t.id));let reviews=0;
  const provider:NarrativeProvider={id:'bad-prose',async complete(request){
   let output:unknown;
   if(request.prompt.id==='narrative-review'){reviews++;const candidate=request.context.provenance.find(p=>p.id==='candidate')!.content as {paragraphs:Array<{sourceIds:string[];text:string}>};output={checks:Object.fromEntries(narrativeReviewChecks.map(k=>[k,k!=='agency'])),paragraphs:candidate.paragraphs.map((p,index)=>({index,sourceIds:p.sourceIds,entailed:true})),defects:[{check:'agency',reason:'Invented PC emotion.'}]};}
   else output={paragraphs:request.context.provenance.flatMap(p=>{const c=p.content as {id?:string;text?:string};return c.id&&c.text?[{sourceIds:[c.id],text:c.text+' Fury rose in Alex.'}]:[]})};
   return {traceId:request.traceId,output,usage:{inputTokens:100,outputTokens:100},toolCalls:[]};
  }};
  const result=await new NarrativeGateway(f.game,[provider]).narrate(f.player,f.t.id,turn.eventId,provider.id);
  assert.equal(result.status,'grounded-fallback');assert.doesNotMatch(result.narration,/Fury/);assert.equal(reviews,2);assert.equal(checksum(await f.game.load(f.t.id)),before);
 }finally{await f.close();}
});

test('Master S02 scene history and phrase ownership remain separate through long play',()=>{
 const profile=narrativeProfileSchema.parse({responseLength:'short'}),history=Array.from({length:50},(_,i)=>({sceneId:i<47?'old':'current',narration:i<47?'A long earlier scene.\n\nMore of it.\n\nStill more.\n\nAnother paragraph.':'The door stayed shut.',dialogue:[{speakerId:i%2?'nia':'malik',text:i%2?'Certainly, sir.':'Nope.'}]}));
 const memory=narrativeStyleMemory(history,profile,'current');assert.equal(memory.windows.scene.turns,3);assert.equal(memory.windows.long.turns,50);assert.deepEqual(memory.drift,[]);assert.ok(memory.perNpc.nia!.phrases.every(p=>p==='Certainly, sir.'));assert.ok(memory.perNpc.malik!.phrases.every(p=>p==='Nope.'));
});

test('Master S02 communication respects distance, walls, attention, hearing and visual channels',async()=>{
 const f=await setup();try{const state=await f.game.load(f.t.id),npc=state.entities.find(e=>e.id===f.npc.id)!;
  const set=(patch:Record<string,unknown>)=>npc.data.perception=perceptionSchema.parse(patch);
  set({});assert.equal(reception(state,f.pc.id,f.npc.id,'say'),100);
  set({position:40});assert.equal(reception(state,f.pc.id,f.npc.id,'say'),0);
  set({partition:'kitchen',position:10});assert.equal(reception(state,f.pc.id,f.npc.id,'say'),0);assert.equal(reception(state,f.pc.id,f.npc.id,'sign'),0);
  set({hearing:0});assert.equal(reception(state,f.pc.id,f.npc.id,'say','shout'),0);
  set({attention:'distracted'});assert.equal(reception(state,f.pc.id,f.npc.id,'say','whisper'),0);
  set({attention:'feigning'});assert.equal(reception(state,f.pc.id,f.npc.id,'say'),100);
  set({vision:0});assert.equal(reception(state,f.pc.id,f.npc.id,'sign'),0);
  assert.equal(observerView(state,f.pc.id).entities.find(e=>e.id===f.npc.id)!.data.perception,undefined);
 }finally{await f.close();}
});

test('Master S02 subjective experiences are private, noncanonical, bounded and disabled by dream control',async()=>{
 const f=await setup();try{
  const state=await f.game.load(f.t.id),pc=state.entities.find(e=>e.id===f.pc.id)!;pc.data.condition='unconscious';
  pc.data.perception=perceptionSchema.parse({subjective:[{id:'dream',kind:'dream',text:'Malik said, “I love you.”',cause:'established sleep',severity:20,from:'2010-01-01T00:00:00.000Z',until:'2020-01-01T00:00:00.000Z'}]});
  assert.equal(observerView(state,f.pc.id).entities.find(e=>e.id===f.pc.id)!.data.perception,undefined);
  const before=checksum(state),input={state,before:structuredClone(state),actorId:f.pc.id,turnId:key(),effects:[{id:key(),subjectId:f.npc.id,type:'npc.action',text:'Malik loaded a pistol.',observers:[f.pc.id]}],layers:[],mode:'STORY' as const,control:{holder:'PLAYER'},playerText:'',recent:[]};
  const bundle=buildNarrativeBundle({...input,profile:narrativeProfileSchema.parse({})}),text=validateNarrativeDraft(deterministicDraft(bundle),bundle).text;
  assert.match(text,/In a dream/);assert.doesNotMatch(text,/loaded a pistol|counter/);assert.match(text,/unconscious/);assert.equal(checksum(state),before);
  const disabled=buildNarrativeBundle({...input,profile:narrativeProfileSchema.parse({dreams:'off'})});assert.doesNotMatch(validateNarrativeDraft(deterministicDraft(disabled),disabled).text,/I love you/);
 }finally{await f.close();}
});

test('Master S02 changed location details and professional density avoid baseline repetition',async()=>{
 const f=await setup();try{
  const state=await f.game.load(f.t.id),room=state.entities.find(e=>e.id===f.room.id)!;
  room.data.narrative={interiorPolicy:'strict',details:[{id:'tool',text:'The pump bearing showed lateral play.',sense:'visual',category:'professional',minimumDetail:'technical',visibility:'public',layer:'current'}]};
  const input={state,before:structuredClone(state),actorId:f.pc.id,turnId:key(),effects:[],layers:[],mode:'STORY' as const,control:{holder:'PLAYER'},playerText:'',recent:[]};
  const first=buildNarrativeBundle({...input,profile:narrativeProfileSchema.parse({professionalDetail:'light'})});assert.doesNotMatch(validateNarrativeDraft(deterministicDraft(first),first).text,/bearing/);
  const technical=buildNarrativeBundle({...input,profile:narrativeProfileSchema.parse({professionalDetail:'technical'})});assert.match(validateNarrativeDraft(deterministicDraft(technical),technical).text,/bearing/);
  const repeat=buildNarrativeBundle({...input,previousLocationFingerprint:first.locationFingerprint,previousLocationDetails:first.locationDetails,profile:narrativeProfileSchema.parse({professionalDetail:'technical'})});assert.doesNotMatch(validateNarrativeDraft(deterministicDraft(repeat),repeat).text,/counter|bearing/);
 }finally{await f.close();}
});


test('Master S02 flexible voice rejects therapy drift, changed literals and incomplete review',async()=>{
 const f=await setup();try{
  const state=await f.game.load(f.t.id),npc=state.entities.find(e=>e.id===f.npc.id)!;npc.data.voiceProfile={sentenceLength:'terse',forbiddenTendencies:['hold space']};
  const effect:Effect={id:key(),subjectId:npc.id,type:'npc.dialogue',text:'Hi.',observers:[f.pc.id],dialogue:{speakerId:npc.id,method:'say',language:'en',exact:false,text:'Hi.',comprehension:'full',register:'stranger'}};
  const bundle=buildNarrativeBundle({state,before:structuredClone(state),actorId:f.pc.id,turnId:key(),effects:[effect],layers:[],mode:'STORY',control:{holder:'PLAYER'},playerText:'',recent:[],profile:narrativeProfileSchema.parse({})});
  const fact=bundle.facts.find(f=>f.id===effect.id)!;assert.ok(fact.flexibleDialogue);
  assert.throws(()=>guardFlexibleParagraph('Malik said, “Let me hold space for your pain while you process everything.”',[fact],bundle),/narrative_voice_drift/);
  assert.throws(()=>guardFlexibleParagraph('Malik said, “Yes.”',[{...fact,flexibleDialogue:false}],bundle),/narrative_literal_changed/);
  const paragraphs=[{sourceIds:[effect.id],text:'Malik said, “Hello.”'}],checks=Object.fromEntries(narrativeReviewChecks.map(k=>[k,true]));
  assert.throws(()=>acceptNarrativeReview({checks,paragraphs:[],defects:[]},paragraphs),/narrative_review_incomplete/);
  assert.throws(()=>acceptNarrativeReview({checks,paragraphs:[{index:0,sourceIds:[key()],entailed:true}],defects:[]},paragraphs),/narrative_unsupported_claim/);
 }finally{await f.close();}
});

test('Master S02 cancellation during semantic review never installs unreviewed text',async()=>{
 const f=await setup();try{
  const settings=(await f.game.load(f.t.id)).settings;Object.assign(settings,{tokenBudget:200000,userTokenBudget:200000,contextTokens:8000});await f.game.configure(f.creator,f.t.id,2,settings,key());
  const turn=await f.command({kind:'action',action:{type:'wait',minutes:1}}),initial=await f.store.get<{narration:string}>('SELECT narration FROM story_turns WHERE id=?',turn.eventId),controller=new AbortController();let ready!:()=>void;const reviewing=new Promise<void>(resolve=>ready=resolve);
  const provider:NarrativeProvider={id:'cancel-review',async complete(request,signal){
   if(request.prompt.id==='narrative-review'){ready();return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}
   return {traceId:request.traceId,toolCalls:[],usage:{inputTokens:100,outputTokens:100},output:{paragraphs:request.context.provenance.flatMap(p=>{const c=p.content as {id?:string;text?:string};return c.id&&c.text?[{sourceIds:[c.id],text:c.text==='The counter was scuffed.'?'Scuffs marked the counter.':c.text}]:[]})}};
  }};
  const rendering=new NarrativeGateway(f.game,[provider]).narrate(f.player,f.t.id,turn.eventId,provider.id,controller.signal),rejected=assert.rejects(rendering,/narration_canceled/);
  await reviewing;controller.abort();await rejected;assert.equal((await f.store.get<{narration:string}>('SELECT narration FROM story_turns WHERE id=?',turn.eventId))!.narration,initial!.narration);
 }finally{await f.close();}
});

test('Master S02 OOC focus and contextual style phrases do not advance time',async()=>{
 const f=await setup();try{
  const before=checksum(await f.game.load(f.t.id)),result=await f.command({kind:'freeform',text:'OOC: focus on Malik'});
  assert.match(result.presentation.text,/saved/);assert.equal(checksum(await f.game.load(f.t.id)),before);
  assert.equal(parseDirectorText('balanced dialogue').directive?.patch.dialogueDensity,'balanced');
  assert.equal(parseDirectorText('balanced description').directive?.patch.descriptionDensity,'balanced');
  const unknown=await f.command({kind:'freeform',text:'OOC: focus on Missing Person'});assert.match(unknown.presentation.text,/not changed/);
 }finally{await f.close();}
});
