import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {TurnKernel,turnAffordances} from '../src/game/turn-kernel.ts';
import {interpretTurn} from '../src/game/turn-input.ts';
import {resolveTurnPlan} from '../src/game/turn-resolution.ts';
import {NarrativeGateway,type NarrativeProvider} from '../src/game/ai.ts';
import {data,validateEntity} from '../src/game/model.ts';
import type {TurnCommand} from '../src/game/turn-contracts.ts';

async function setup(){
 const f=await fixture(),game=new Game(f.store),t=await game.initialize(f.creator,f.campaign.id);
 const room=validateEntity({id:key(),kind:'location',name:'Diner',visibility:'campaign',data:{description:'A quiet diner.'}});
 const pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:room.id,cash:1000}});
 const item=validateEntity({id:key(),kind:'item',name:'Envelope',visibility:'campaign',data:{locationId:room.id}});
 await game.bulkEdit(f.creator,t.id,{revision:1,entities:[room,pc,item]},key());
 const kernel=new TurnKernel(game);
 const command=async(input:TurnCommand['input'],mode:TurnCommand['mode']='STORY',commandId=key()):Promise<TurnCommand>=>({commandId,sessionId:t.id,expectedRevision:(await game.access(f.player,t.id)).t.revision,actorId:pc.id,mode,input});
 return {...f,game,t,room,pc,item,kernel,command};
}
test('AT-016/017/018/020/043/049: modes, inspection, clarification and duplicate commands share one world',async()=>{
 const f=await setup();try{
  const before=await f.game.load(f.t.id);
  for(const input of [{kind:'mode_switch',targetMode:'GAME'},{kind:'inspection',panel:'inventory'},{kind:'freeform',text:'Give it to him'}] as TurnCommand['input'][]){
   const cmd=await f.command(input),first=await f.kernel.execute(f.player,cmd);
   assert.deepEqual(await f.kernel.execute(f.player,cmd),first);
   assert.deepEqual(await f.game.load(f.t.id),before);
  }
  const view=await f.game.view(f.player,f.t.id,f.pc.id);assert.ok(view.pendingDecision);assert.equal(view.control.holder,'PLAYER');
  const answer=await f.command({kind:'clarification_answer',pendingDecisionId:view.pendingDecision.pendingDecisionId,answer:'Take Envelope'});
  const committed=await f.kernel.execute(f.player,answer);assert.equal(committed.status,'COMMITTED');
  assert.equal(data((await f.game.load(f.t.id)).entities.find(e=>e.id===f.item.id)!,'item').ownerId,f.pc.id);
  assert.deepEqual(await f.kernel.execute(f.player,answer),committed);
  await assert.rejects(()=>f.kernel.execute(f.player,{...answer,commandId:key()}),/revision_conflict/);
  await assert.rejects(()=>f.kernel.execute(f.player,{...answer,input:{kind:'action',action:{type:'look'}}}),/idempotency_conflict/);
  assert.equal((await f.store.get<{n:number}>("SELECT count(*) n FROM game_events WHERE timeline_id=? AND type='story.turn'",f.t.id))!.n,1);
 }finally{await f.close();}
});
test('AT-023/024/026/057: speech, corrections, dependencies and unknown references remain intent only',async()=>{
 const f=await setup();try{
  const state=await f.game.load(f.t.id);
  assert.deepEqual(interpretTurn(state,f.pc.id,'I tell Maya, “I will burn the letter tonight.”').clauses[0]?.action,{type:'say',text:'I will burn the letter tonight.'});
  assert.deepEqual(interpretTurn(state,f.pc.id,'I take Envelope—no, actually I look').clauses[0]?.action,{type:'look'});
  assert.ok(interpretTurn(state,f.pc.id,'Call Dr. Unknown').clarification);
  assert.ok(interpretTurn(state,f.pc.id,'Leave immediately and stay to hear the answer').clarification);
  const parsed=interpretTurn(state,f.pc.id,'Take Envelope and give Envelope to Nobody');assert.ok(parsed.clarification);assert.equal(parsed.clauses.length,0);
  const plan=interpretTurn(state,f.pc.id,'Take Envelope and look');assert.equal(plan.clauses.length,2);assert.equal(plan.clauses[1]?.dependency,'PREVIOUS_SUCCESS');
  const outcome=await f.kernel.execute(f.player,await f.command({kind:'freeform',text:'Take Envelope and look'}));assert.equal(outcome.completedClauses,2);
  assert.equal((await f.store.get<{n:number}>("SELECT count(*) n FROM game_events WHERE timeline_id=? AND type='story.turn'",f.t.id))!.n,1);
 }finally{await f.close();}
});
test('AT-016/027/037: explicit seeds reproduce mechanical outcomes across modes and entity order',async()=>{
 const f=await setup();try{
  const s=await f.game.load(f.t.id),a=structuredClone(s),b=structuredClone(s),eventId=key();
  const clauses=[{clauseId:'1',dependency:'NONE' as const,action:{type:'wait' as const,minutes:1}}];
  const left=resolveTurnPlan(a,f.pc.id,clauses,eventId,'ab'.repeat(32)),right=resolveTurnPlan(b,f.pc.id,clauses,eventId,'ab'.repeat(32));
  assert.equal(left.draws,0);assert.deepEqual(left.timeDelta,right.timeDelta);assert.deepEqual(left.steps,right.steps);
  assert.equal(data(a.entities.find(e=>e.id===f.pc.id)!,'character').cash,data(b.entities.find(e=>e.id===f.pc.id)!,'character').cash);
  const options=turnAffordances(s,f.pc.id,2),hidden=validateEntity({id:key(),kind:'item',name:'Hidden key',visibility:'creator',data:{locationId:f.room.id,concealed:true}});
  assert.deepEqual(turnAffordances({...s,entities:[...s.entities,hidden]},f.pc.id,2),options);
 }finally{await f.close();}
});
test('AT-033/035/037: compressed waits and work stop at authored mandatory interruptions',async()=>{
 const f=await setup();try{
  const initial=await f.game.load(f.t.id),due=new Date(Date.parse(initial.clock)+75*60000).toISOString();
  const employer=validateEntity({id:key(),kind:'business',name:'Employer',visibility:'campaign',data:{locationId:f.room.id,cash:100000}});
  const job=validateEntity({id:key(),kind:'job',name:'Diner shift',visibility:'campaign',data:{employeeId:f.pc.id,employerId:employer.id,locationId:f.room.id,hourlyCents:1200,minutesPerShift:480}});
  const alarm=validateEntity({id:key(),kind:'watcher',name:'Mandatory decision',visibility:'creator',data:{trigger:'time',dueAt:due,effect:'notify',requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id],description:'A call needs an answer.'}});
  await f.game.bulkEdit(f.creator,f.t.id,{revision:2,entities:[employer,job,alarm]},key());
  const worked=await f.kernel.execute(f.player,await f.command({kind:'action',action:{type:'work',jobId:job.id}}));
  assert.equal(worked.worldTime,due);assert.equal(worked.control.holder,'PLAYER');assert.equal(worked.interrupted,true);
  const after=await f.game.load(f.t.id);assert.equal(Number(after.entities.find(e=>e.id===f.pc.id)!.data.cash),2500);
  assert.equal(after.entities.find(e=>e.id===job.id)!.data.completedShifts,0);
  const resumed=await f.kernel.execute(f.player,await f.command({kind:'action',action:{type:'work',jobId:job.id}}));
  assert.equal(resumed.interrupted,false);const completed=await f.game.load(f.t.id);
  assert.equal(completed.entities.find(e=>e.id===job.id)!.data.completedShifts,1);
  assert.equal(Number(completed.entities.find(e=>e.id===f.pc.id)!.data.cash),10600);
 }finally{await f.close();}
});
test('AT-045/046/060: narration cannot create entities and regeneration freezes knowledge and mechanics',async()=>{
 const f=await setup();try{
  const settings=(await f.game.load(f.t.id)).settings;settings.tokenBudget=100000;settings.userTokenBudget=100000;settings.contextTokens=6000;
  await f.game.configure(f.creator,f.t.id,2,settings,key());
  const turn=await f.kernel.execute(f.player,await f.command({kind:'action',action:{type:'look'}}));
  const before=await f.game.load(f.t.id);const contexts:unknown[]=[];
  const provider:NarrativeProvider={id:'capture',arrange:async context=>{contexts.push(structuredClone(context));return {additions:[{kind:'npc',name:'Invented Stranger',description:'No canonical source.'}],paragraphs:[{sourceIds:context.fragments.map(f=>f.id),text:'Alex waited.'}]};}};
  const gateway=new NarrativeGateway(f.game,[provider]),failed=await gateway.narrate(f.player,f.t.id,turn.eventId,'capture',undefined,'story');
  assert.equal(failed.status,'grounded-fallback');assert.deepEqual(await f.game.load(f.t.id),before);
  const newPlace=structuredClone(f.room);newPlace.data.description='LATER SECRET MUST NOT ENTER OLD CONTEXT';
  await f.game.edit(f.creator,f.t.id,{revision:turn.revision,entity:newPlace},key());
  await gateway.narrate(f.player,f.t.id,turn.eventId,'capture',undefined,'story');
  assert.ok(!JSON.stringify(contexts).includes('LATER SECRET'));assert.ok(contexts.length>=2);
  const state=await f.game.load(f.t.id),event=await f.store.get('SELECT * FROM game_events WHERE id=?',turn.eventId);
  for(let i=0;i<5;i++)await f.kernel.execute(f.player,await f.command({kind:'regenerate_narration',turnId:turn.eventId}));
  assert.deepEqual(await f.game.load(f.t.id),state);assert.deepEqual(await f.store.get('SELECT * FROM game_events WHERE id=?',turn.eventId),event);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM narration_versions WHERE event_id=?',turn.eventId))!.n,6);
 }finally{await f.close();}
});
test('AT-047/048/050: cancellation preserves committed history and corrections branch',async()=>{
 const f=await setup();try{
  const pending=await f.kernel.execute(f.player,await f.command({kind:'freeform',text:'Give it to them'}));
  const canceled=await f.kernel.execute(f.player,await f.command({kind:'cancel_pending',pendingActionId:pending.pendingDecision.pendingDecisionId}));
  assert.equal(canceled.status,'CANCELED');assert.equal(canceled.revision,2);
  const action=await f.command({kind:'action',action:{type:'wait',minutes:2}}),turn=await f.kernel.execute(f.player,action);
  const cannotUndo=await f.kernel.execute(f.player,await f.command({kind:'cancel_pending',pendingActionId:turn.eventId}));assert.equal(cannotUndo.status,'ALREADY_COMMITTED');
  const save=await f.game.save(f.player,f.t.id,'Checkpoint'),before=await f.game.load(f.t.id);
  const branch=await f.kernel.execute(f.player,await f.command({kind:'edit_request',edit:{saveId:save.id,name:'Correction',reason:'Restore the chosen checkpoint'}}));
  assert.equal(branch.status,'BRANCHED');assert.deepEqual(await f.game.load(f.t.id),before);
  assert.ok(await f.store.get('SELECT id FROM game_events WHERE id=?',turn.eventId));
 }finally{await f.close();}
});
test('AT-043/044/049/059: HTTP authorization, concurrency and transaction failure preserve one commit',async()=>{
 const f=await setup();try{
  const auth=await login(f,'player@example.test'),cmd=await f.command({kind:'action',action:{type:'look'}});
  const response=await f.app.inject({method:'POST',url:'/game/timelines/'+f.t.id+'/commands',headers:{cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf},payload:cmd});
  assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status,'COMMITTED');
  await assert.rejects(()=>f.kernel.execute(f.other,cmd),/not_found/);
  const race=await f.command({kind:'action',action:{type:'wait',minutes:1}});
  const outcomes=await Promise.allSettled([f.kernel.execute(f.player,race),f.kernel.execute(f.player,{...race,commandId:key()})]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  const before=await f.game.load(f.t.id),revision=(await f.game.access(f.player,f.t.id)).t.revision,requestKey=key(),originalRun=f.store.run.bind(f.store);
  let failed=false;f.store.run=async(...args:Parameters<typeof f.store.run>)=>{if(!failed&&args[0].includes('INSERT INTO game_outbox')){failed=true;throw new Error('synthetic_outage');}return originalRun(...args);};
  const payload={revision,characterId:f.pc.id,action:{type:'wait' as const,minutes:2}};
  await assert.rejects(()=>f.game.turn(f.player,f.t.id,payload,requestKey),/synthetic_outage/);
  f.store.run=originalRun;assert.deepEqual(await f.game.load(f.t.id),before);
  const trace=await f.store.get<{rng_seed:string}>('SELECT rng_seed FROM turn_traces WHERE request_key=?',requestKey);
  const recovered=await f.game.turn(f.player,f.t.id,payload,requestKey),seed=await f.store.get<{seed:string}>('SELECT seed FROM game_events WHERE id=?',recovered.eventId);
  assert.equal(seed?.seed,trace?.rng_seed);
 }finally{await f.close();}
});

test('AT-024/059: registered provider outcomes stop dependencies and outages cannot mutate staged state',async()=>{
 const f=await setup();try{
  const {TurnRuleRegistry}=await import('../src/game/turn-rules.ts'),s=await f.game.load(f.t.id);
  let laterCalls=0;
  const registry=new TurnRuleRegistry().register('look',{id:'test-failing-provider',resolve(candidate){
   candidate.entities.find(e=>e.id===f.pc.id)!.data.cash=990;
   return {status:'FAILED',effects:[],checks:[],draws:0,time:{minutes:0,scale:'negligible'}};
  }},[{ownerSystem:'characters',kind:'character',fields:['data.cash']}]).register('wait',{id:'test-continuation',resolve(){
   laterCalls++;return {status:'SUCCEEDED',effects:[],checks:[],draws:0,time:{minutes:0,scale:'negligible'}};
  }});
  const plan=[{clauseId:'1',dependency:'NONE' as const,action:{type:'look' as const}},{clauseId:'2',dependency:'PREVIOUS_SUCCESS' as const,action:{type:'wait' as const,minutes:1}}];
  const outcome=resolveTurnPlan(s,f.pc.id,plan,key(),'ab'.repeat(32),registry);
  assert.equal(outcome.result.completedClauses,1);assert.equal(laterCalls,0);assert.equal(outcome.result.interrupted,true);
  const before=structuredClone(s),down=new TurnRuleRegistry().register('look',{id:'test-outage',resolve(candidate){candidate.clock='2012-06-01T15:00:00Z';throw new Error('provider_outage');}});
  assert.throws(()=>resolveTurnPlan(s,f.pc.id,[plan[0]!],key(),'ab'.repeat(32),down),/provider_outage/);assert.deepEqual(s,before);
  assert.throws(()=>resolveTurnPlan(s,f.pc.id,[plan[0]!],key(),'ab'.repeat(32),new TurnRuleRegistry()),/rule_provider_unavailable/);
 }finally{await f.close();}
});
test('AT-011/035/037: hidden checks stay private and clock handoffs preserve exact timestamps',async()=>{
 const f=await setup();try{
  const definition=validateEntity({id:key(),kind:'checkDefinition',name:'Hidden check',visibility:'campaign',data:{attribute:'Strength',difficulty:999,checkVisibility:'HIDDEN'}});
  const alarm=validateEntity({id:key(),kind:'watcher',name:'Alarm',visibility:'creator',data:{trigger:'time',dueAt:'2012-06-01T12:00:30Z',effect:'notify',requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id],description:'An alarm sounds.'}});
  await f.game.bulkEdit(f.creator,f.t.id,{revision:2,entities:[definition,alarm]},key());
  const settings=(await f.game.load(f.t.id)).settings;settings.rules={dieSides:20,threshold:10,damage:5,unfamiliarPenalty:2,treatmentMinutes:5,recoveryPerDay:1,bleedPerMinute:0} as typeof settings.rules;
  await f.game.configure(f.creator,f.t.id,3,settings,key());
  const check=await f.kernel.execute(f.player,await f.command({kind:'action',action:{type:'check',attribute:'Strength',skillId:null,checkId:definition.id,context:''}}));
  assert.deepEqual(check.checks,[]);assert.doesNotMatch(JSON.stringify(check.permitted),/999|Check:|dieValue/);
  assert.deepEqual(await f.game.checks(f.player,f.t.id,f.pc.id),[]);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM check_records'))!.n,1);
  const waited=await f.kernel.execute(f.player,await f.command({kind:'action',action:{type:'wait',minutes:10}}));
  assert.equal(waited.worldTime,'2012-06-01T12:00:30.000Z');assert.equal(waited.timeDelta.elapsedSeconds,30);assert.equal(waited.interrupted,true);
 }finally{await f.close();}
});
test('2012 capability and narration boundaries reject unsupported future technology',async()=>{
 const f=await setup();try{
  const {validateAnchoredNarration}=await import('../src/game/ai.ts'),id=key(),context={mode:'anchored-prose' as const,promptVersion:'test',instructions:'',fragments:[{id,text:'Alex waited in the diner.'}]};
  assert.throws(()=>validateAnchoredNarration({paragraphs:[{sourceIds:[id],text:'Alex used ChatGPT.'}]},context),/narrative_period_violation/);
  const future=validateEntity({id:key(),kind:'item',name:'Future device',visibility:'campaign',data:{locationId:f.room.id,introducedOn:'2022-01-01'}});
  await f.game.edit(f.creator,f.t.id,{revision:2,entity:future},key());
  const before=await f.game.load(f.t.id);
  const cmd=await f.command({kind:'action',action:{type:'take',itemId:future.id}});
  await assert.rejects(()=>f.kernel.execute(f.player,cmd),/technology_not_yet_available/);assert.deepEqual(await f.game.load(f.t.id),before);
 }finally{await f.close();}
});

test('fractional interrupted work carries sub-cent wages forward without creating zero-value transactions',async()=>{
 const f=await setup();try{
  const initial=await f.game.load(f.t.id),due=new Date(Date.parse(initial.clock)+30000).toISOString();
  const employer=validateEntity({id:key(),kind:'business',name:'Employer',visibility:'campaign',data:{locationId:f.room.id,cash:100}});
  const job=validateEntity({id:key(),kind:'job',name:'Fractional shift',visibility:'campaign',data:{employeeId:f.pc.id,employerId:employer.id,locationId:f.room.id,hourlyCents:1,minutesPerShift:60}});
  const alarm=validateEntity({id:key(),kind:'watcher',name:'Decision',visibility:'creator',data:{trigger:'time',dueAt:due,effect:'notify',requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id]}});
  await f.game.bulkEdit(f.creator,f.t.id,{revision:2,entities:[employer,job,alarm]},key());
  const first=await f.kernel.execute(f.player,await f.command({kind:'action',action:{type:'work',jobId:job.id}}));
  assert.equal(first.worldTime,due);assert.equal(first.interrupted,true);
  const partial=await f.game.load(f.t.id),partialJob=data(partial.entities.find(e=>e.id===job.id)!,'job');
  assert.equal(partialJob.attendance[0]!.minutes,0.5);assert.equal(partialJob.attendance[0]!.wageCents,0);
  assert.equal(partial.entities.filter(e=>e.kind==='transaction').length,0);
  await f.kernel.execute(f.player,await f.command({kind:'action',action:{type:'work',jobId:job.id}}));
  const completed=await f.game.load(f.t.id),transactions=completed.entities.filter(e=>e.kind==='transaction');
  assert.equal(transactions.length,1);assert.equal(transactions[0]!.data.amountCents,1);
  assert.equal(data(completed.entities.find(e=>e.id===f.pc.id)!,'character').cash,1001);
  assert.equal(data(completed.entities.find(e=>e.id===job.id)!,'job').completedShifts,1);
 }finally{await f.close();}
});
