import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity,settingsSchema} from '../src/game/model.ts';
import {NarrativeGateway} from '../src/game/ai.ts';

async function scenario(){
 const f=await fixture(),game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
 const revision=async()=>(await game.access(f.creator,timeline.id)).t.revision;
 const room=validateEntity({id:randomUUID(),kind:'location',name:'Trace room',visibility:'campaign',data:{}});
 await game.edit(f.creator,timeline.id,{revision:await revision(),entity:room},key());
 const character=validateEntity({id:randomUUID(),kind:'character',name:'Trace player',visibility:'campaign',data:{playable:true,controllerUserId:f.player.id,locationId:room.id,dob:'1990-01-01'}});
 await game.edit(f.creator,timeline.id,{revision:await revision(),entity:character},key());
 return {...f,game,timeline,room,character,revision};
}

test('System 13 preserves original input and clarifies incompatible interpretations without advancing state',async()=>{
 const f=await scenario();try{
  const before=await f.revision(),text='look and wait 5 minutes',proposal=await f.game.parse(f.player,f.timeline.id,f.character.id,text);
  assert.equal(proposal.originalText,text);assert.equal(proposal.classification,'clarification');assert.equal(proposal.action,null);assert.deepEqual(proposal.alternatives?.map(action=>action.type),['look','wait']);assert.match(proposal.clarification!,/several incompatible actions/);assert.equal(await f.revision(),before);
 }finally{await f.close();}
});

test('System 13 cursor compare-and-swap permits one tab, replays duplicates, and traces rollback failures',async()=>{
 const f=await scenario();try{
  const view=await f.game.view(f.player,f.timeline.id,f.character.id),base={revision:view.timeline.revision,cursor:view.timeline.turnCursor,characterId:f.character.id,action:{type:'look'} as const,text:'look'};
  const traceCount=(await f.store.get<{n:number}>('SELECT count(*) n FROM turn_traces WHERE timeline_id=?',f.timeline.id))!.n;await assert.rejects(()=>f.game.turn(f.other,f.timeline.id,base,key()),/not_found/);assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM turn_traces WHERE timeline_id=?',f.timeline.id))!.n,traceCount);
  const raced=await Promise.allSettled([f.game.turn(f.player,f.timeline.id,base,key()),f.game.turn(f.player,f.timeline.id,base,key())]);
  assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);assert.equal(raced.filter(result=>result.status==='rejected').length,1);assert.match(String((raced.find(result=>result.status==='rejected') as PromiseRejectedResult).reason),/revision_conflict|turn_cursor_conflict/);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM game_events WHERE timeline_id=? AND type=\'story.turn\'',f.timeline.id))!.n,1);
  const failedRace=await f.store.get<{failure_reason:string}>("SELECT failure_reason FROM turn_traces WHERE timeline_id=? AND status='failed' ORDER BY created_at DESC LIMIT 1",f.timeline.id);assert.match(failedRace!.failure_reason,/revision_conflict|turn_cursor_conflict/);

  const fresh=await f.game.view(f.player,f.timeline.id,f.character.id),requestKey=key(),payload={revision:fresh.timeline.revision,cursor:fresh.timeline.turnCursor,characterId:f.character.id,action:{type:'look'} as const,text:'look again'};
  const first=await f.game.turn(f.player,f.timeline.id,payload,requestKey),duplicate=await f.game.turn(f.player,f.timeline.id,payload,requestKey);assert.deepEqual(duplicate,first);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM game_events WHERE id=?',first.eventId))!.n,1);
  assert.equal((await f.store.get<{n:number}>("SELECT count(*) n FROM turn_trace_steps WHERE trace_id=? AND status='replayed'",first.traceId))!.n,1);

  const beforeFailure=await f.game.view(f.player,f.timeline.id,f.character.id),failedKey=key();
  await assert.rejects(()=>f.game.turn(f.player,f.timeline.id,{revision:beforeFailure.timeline.revision,cursor:beforeFailure.timeline.turnCursor,characterId:f.character.id,action:{type:'inspect',targetId:randomUUID()},text:'inspect missing target'},failedKey),/entity_unavailable/);
  const afterFailure=await f.game.view(f.player,f.timeline.id,f.character.id);assert.equal(afterFailure.timeline.revision,beforeFailure.timeline.revision);assert.equal(afterFailure.timeline.turnCursor,beforeFailure.timeline.turnCursor);
  const trace=await f.store.get<{status:string;failure_reason:string;original_text:string}>('SELECT status,failure_reason,original_text FROM turn_traces WHERE timeline_id=? AND request_key=?',f.timeline.id,failedKey);assert.deepEqual(trace,{status:'failed',failure_reason:'entity_unavailable',original_text:'inspect missing target'});
  const failedStep=await f.store.get<{duration_ms:number;failure_reason:string}>("SELECT duration_ms,failure_reason FROM turn_trace_steps WHERE trace_id=(SELECT trace_id FROM turn_traces WHERE request_key=?) AND status='failed' ORDER BY sequence DESC LIMIT 1",failedKey);assert.ok(failedStep!.duration_ms>=0);assert.equal(failedStep!.failure_reason,'entity_unavailable');
  const playerSession=await login(f,'player@example.test'),traceUrl='/game/timelines/'+f.timeline.id+'/developer/turn-traces';assert.equal((await f.app.inject({url:traceUrl,headers:{cookie:playerSession.cookie}})).statusCode,403);const creatorSession=await login(f),inspection=await f.app.inject({url:traceUrl,headers:{cookie:creatorSession.cookie}});assert.equal(inspection.statusCode,200,inspection.body);assert.equal(typeof inspection.json()[0].steps[0].details,'object');
 }finally{await f.close();}
});

test('System 13 retries narration against one immutable event bundle and falls back without rerolling',async()=>{
 const f=await scenario();try{
  const current=(await f.game.load(f.timeline.id)).settings;
  await f.game.configure(f.creator,f.timeline.id,await f.revision(),settingsSchema.parse({...current,tokenBudget:100000,userTokenBudget:100000,contextTokens:4000,narrationMode:'anchored-prose'}),key());
  const takeTurn=async(text:string)=>{const view=await f.game.view(f.player,f.timeline.id,f.character.id);return f.game.turn(f.player,f.timeline.id,{revision:view.timeline.revision,cursor:view.timeline.turnCursor,characterId:f.character.id,action:{type:'look'},text},key());};
  const turn=await takeTurn('look for retry evidence'),before=await f.store.get<{seed:string;rng_draws:number;effects_json:string}>('SELECT seed,rng_draws,effects_json FROM game_events WHERE id=?',turn.eventId);let calls=0;
  const retrying={id:'retry-provider',estimateTokens:()=>100,async arrange(context:{fragments:Array<{id:string;text:string}>}){calls++;return {paragraphs:context.fragments.map(fragment=>({sourceIds:[fragment.id],text:calls===1?'You decide to invent an uncommitted action.':fragment.text}))};}};
  const result=await new NarrativeGateway(f.game,[retrying]).narrate(f.player,f.timeline.id,turn.eventId,retrying.id),after=await f.store.get<{seed:string;rng_draws:number;effects_json:string}>('SELECT seed,rng_draws,effects_json FROM game_events WHERE id=?',turn.eventId);
  assert.equal(calls,2);assert.equal(result.status,'validated');assert.deepEqual(after,before);assert.equal(result.recovery.rerolled,false);
  const request=await f.store.get<{attempt_count:number}>('SELECT attempt_count FROM ai_requests WHERE trace_id=?',result.traceId);assert.equal(request!.attempt_count,2);
  const trace=await f.store.get<{status:string}>('SELECT status FROM turn_traces WHERE event_id=?',turn.eventId);assert.equal(trace!.status,'validated');
  const stages=(await f.store.all<{stage:string}>('SELECT stage FROM turn_trace_steps WHERE trace_id=(SELECT trace_id FROM turn_traces WHERE event_id=?) ORDER BY sequence',turn.eventId)).map(row=>row.stage);assert.ok(stages.includes('narration-attempts'));assert.ok(stages.includes('output-validation'));assert.ok(stages.includes('narration-commit'));

  const outageTurn=await takeTurn('look during outage'),grounded=await f.store.get<{narration:string}>('SELECT narration FROM story_turns WHERE id=?',outageTurn.eventId),down={id:'down-provider',estimateTokens:()=>100,async arrange(){throw new Error('provider_outage');}};
  const fallback=await new NarrativeGateway(f.game,[down]).narrate(f.player,f.timeline.id,outageTurn.eventId,down.id);
  assert.equal(fallback.status,'grounded-fallback');assert.equal(fallback.narration,grounded!.narration);assert.deepEqual(fallback.recovery,{mechanicsPreserved:true,rerolled:false,message:'Narration assistance failed. The committed deterministic result is unchanged.'});
  const fallbackTrace=await f.store.get<{status:string;failure_reason:string}>('SELECT status,failure_reason FROM turn_traces WHERE event_id=?',outageTurn.eventId);assert.deepEqual(fallbackTrace,{status:'fallback',failure_reason:'ai_provider_failed'});assert.equal(fallback.failureCode,'ai_provider_failed');
  const outageEvent=await f.store.get<{seed:string;rng_draws:number;effects_json:string}>('SELECT seed,rng_draws,effects_json FROM game_events WHERE id=?',outageTurn.eventId);assert.ok(outageEvent);assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM game_events WHERE id=?',outageTurn.eventId))!.n,1);
  const recoveredProvider={id:'recovered-provider',estimateTokens:()=>100,async arrange(context:{fragments:Array<{id:string;text:string}>}){return {paragraphs:context.fragments.map(fragment=>({sourceIds:[fragment.id],text:fragment.text}))};}},recovered=await new NarrativeGateway(f.game,[recoveredProvider]).narrate(f.player,f.timeline.id,outageTurn.eventId,recoveredProvider.id);assert.equal(recovered.status,'validated');assert.deepEqual(await f.store.get('SELECT seed,rng_draws,effects_json FROM game_events WHERE id=?',outageTurn.eventId),outageEvent);
 }finally{await f.close();}
});
