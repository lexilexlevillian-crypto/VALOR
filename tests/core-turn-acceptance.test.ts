import {Store} from '../src/db.ts';
import {chroniclePresentation} from '../src/game/chronicle.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {TurnKernel} from '../src/game/turn-kernel.ts';
import {data,validateEntity,type Entity,type Action} from '../src/game/model.ts';
import {interpretTurn} from '../src/game/turn-input.ts';
import {resolveTurnPlan} from '../src/game/turn-resolution.ts';
import {validateAnchoredNarration} from '../src/game/ai.ts';
import {observerView} from '../src/game/epistemics.ts';
import {turnAffordances} from '../src/game/turn-affordances.ts';
import {buildDeltas,validateDeltas} from '../src/game/turn-audit.ts';
async function setup(){
 const f=await fixture(),game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id),kernel=new TurnKernel(game);
 const room=validateEntity({id:key(),kind:'location',name:'Diner',visibility:'campaign',data:{}}),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:room.id,attributes:{Strength:60,Agility:40,Endurance:50,Intellect:50,Perception:50,Presence:50,Will:50}}});
 const revision=async()=>(await game.access(f.player,timeline.id)).t.revision;
 const add=async(...entities:Entity[])=>game.bulkEdit(f.creator,timeline.id,{revision:await revision(),entities},key());
 await add(room,pc);const state=await game.load(timeline.id);state.settings.rules={dieSides:20,threshold:50,damage:10,unfamiliarPenalty:0,treatmentMinutes:1,recoveryPerDay:1,bleedPerMinute:0,formula:'additive-die',outcomeMode:'legacy-binary',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10}};
 await game.configure(f.creator,timeline.id,await revision(),state.settings,key());
 const command=async(input:unknown,mode='STORY',commandId=key())=>({commandId,sessionId:timeline.id,expectedRevision:await revision(),actorId:pc.id,mode,input});
 const run=async(input:unknown)=>kernel.execute(f.player,await command(input));
 const act=(action:Action)=>run({kind:'action',action}),text=(text:string)=>run({kind:'freeform',text});
 const item=(name:string,raw:Record<string,unknown>={})=>validateEntity({id:key(),kind:'item',name,visibility:'campaign',data:{locationId:room.id,...raw}});
 return {...f,game,timeline,kernel,room,pc,revision,add,run,act,text,item,command,load:()=>game.load(timeline.id)};
}
test('AT-003/007/019/021/025/028/029/030/031/051: physical owners, stakes, quiet goals and material retries',async()=>{
 const f=await setup();try{
  const keyItem=f.item('Brass key',{locationId:null,ownerId:f.pc.id}),tool=f.item('Lockpick',{locationId:null,ownerId:f.pc.id,tags:['lockpick']});
  const door=f.item('Steel door',{locked:true,mechanism:{kind:'door',keyId:keyItem.id,lockDifficulty:999,forceDifficulty:999,noiseDifficulty:999,toolWear:2}});
  await f.add(keyItem,tool,door);
  const first=await f.text('I effortlessly kick the steel door open');assert.equal(first.status,'COMMITTED');assert.equal(first.checks.length,1);assert.equal(first.checks[0].context,'forcing an opening');assert.equal(data((await f.load()).entities.find(e=>e.id===door.id)!,'item').locked,true);
  const failed=await f.text('Pick the steel door lock with Lockpick');assert.equal(failed.status,'COMMITTED');
  const checks=await f.store.all<{provenance_json:string}>('SELECT provenance_json FROM check_records WHERE event_id=?',failed.eventId);assert.equal(checks.length,1);assert.equal(JSON.parse(checks[0]!.provenance_json).stakesEstablishedBeforeDraw,true);
  const retry=await f.text('Carefully manipulate the pins in Steel door with Lockpick');assert.equal(retry.status,'COMMITTED');assert.equal(retry.checks.length,0);assert.ok(retry.timeDelta.elapsedSeconds>0);
  assert.equal(data((await f.load()).entities.find(e=>e.id===tool.id)!,'item').condition,96);
  const token=f.item('Token'),box=f.item('Box',{locked:true,mechanism:{kind:'container',keyId:keyItem.id}});await f.add(token,box);const prefix=await f.text('Take Token and unlock Box with Lockpick');assert.equal(prefix.completedClauses,1);assert.equal(prefix.interrupted,true);assert.equal((await f.load()).entities.find(e=>e.id===token.id)!.data.ownerId,f.pc.id);assert.equal((await f.load()).entities.find(e=>e.id===box.id)!.data.locked,true);
  const opened=await f.text('Unlock Steel door with Brass key');assert.equal(opened.status,'COMMITTED');assert.equal(data((await f.load()).entities.find(e=>e.id===door.id)!,'item').locked,false);assert.equal(data((await f.load()).entities.find(e=>e.id===door.id)!,'item').mechanism?.open,false);assert.ok(opened.notices.some((n:{label:string})=>n.label==='Steel door unlocked'));
  await f.text('Close Steel door');const quiet=await f.text('Open Steel door without making noise');assert.ok(quiet.permitted.some((e:{type:string})=>e.type==='environment.noise'));
  const shelf=f.item('Shelf',{weight:10});await f.add(shelf);const moved=await f.text('Push the shelf in front of the steel door');assert.equal(moved.status,'COMMITTED');assert.equal(data((await f.load()).entities.find(e=>e.id===door.id)!,'item').mechanism?.obstructedById,shelf.id);
 }finally{await f.close();}
});
test('AT-022/023/024/026/032/057: intent preserves speech, conditions, approach and ambiguity',async()=>{
 const f=await setup();try{
  const door=f.item('Door',{mechanism:{kind:'door'}}),envelope=f.item('Envelope');
  const maya=validateEntity({id:key(),kind:'character',name:'Maya',visibility:'campaign',data:{locationId:f.room.id}}),ben=validateEntity({id:key(),kind:'character',name:'Ben',visibility:'campaign',data:{locationId:f.room.id}});
  await f.add(door,envelope,maya,ben);
  const s=await f.load();assert.equal(interpretTurn(s,f.pc.id,'I tell Maya, “I will burn the envelope tonight.”').clauses[0]!.action.type,'say');
  const conditional=interpretTurn(s,f.pc.id,'If Door is open, then take Envelope');assert.equal(conditional.clauses[0]!.dependency,'CONDITIONAL');
  const skipped=await f.text('If Door is open, then take Envelope');assert.equal(skipped.completedClauses,0);assert.equal(data((await f.load()).entities.find(e=>e.id===envelope.id)!,'item').ownerId,null);
  await f.text('Take Envelope');const ambiguous=await f.text('Give him the envelope');assert.equal(ambiguous.status,'NEEDS_CLARIFICATION');assert.equal(ambiguous.pendingDecision.options.length,2);
  const answer=await f.run({kind:'clarification_answer',pendingDecisionId:ambiguous.pendingDecision.pendingDecisionId,answer:'Ben'});assert.equal(answer.status,'COMMITTED');assert.equal(data((await f.load()).entities.find(e=>e.id===envelope.id)!,'item').ownerId,ben.id);
  const persuasion=interpretTurn(await f.load(),f.pc.id,'Convince Maya to help by threatening to expose the lie');assert.equal(persuasion.intent?.approach,'threatening to expose the lie');assert.equal(persuasion.clauses[0]!.action.type,'persuade');
  assert.equal((await f.text('Leave immediately and stay to hear the answer')).status,'NEEDS_CLARIFICATION');
 }finally{await f.close();}
});
test('AT-034/035/037: waits stop at arrival and dynamic mandatory conditions, retaining deterministic order',async()=>{
 const f=await setup();try{
  const s=await f.load(),clock=new Date(s.clock),away=validateEntity({id:key(),kind:'location',name:'Outside',visibility:'campaign',data:{}});
  const local=new Intl.DateTimeFormat('en-US',{timeZone:s.settings.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(clock);
  const minute=Number(local.find(p=>p.type==='hour')!.value)*60+Number(local.find(p=>p.type==='minute')!.value);
  const maya=validateEntity({id:key(),kind:'character',name:'Maya',visibility:'campaign',data:{locationId:away.id,schedule:[{id:key(),minute:minute+3,locationId:f.room.id,activity:'arrive'}]}});
  await f.add(away,validateEntity({...maya,data:{...maya.data,locationId:f.room.id}}));await f.text('Look');await f.add(maya);const wait=await f.text('Wait ten minutes or until she arrives');assert.equal(wait.timeDelta.elapsedSeconds,180);
  const before=await f.load(),alarm=validateEntity({id:key(),kind:'watcher',name:'Alarm',visibility:'creator',data:{trigger:'time',dueAt:new Date(Date.parse(before.clock)+30000).toISOString(),effect:'notify',requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id],description:'Fire alarm.'}});
  await f.add(alarm);const rest=await f.text('Sleep until morning without interruption');assert.equal(rest.interrupted,true);assert.equal(rest.timeDelta.elapsedSeconds,30);assert.equal(data((await f.load()).entities.find(e=>e.id===f.pc.id)!,'character').restUntil,rest.worldTime);
 }finally{await f.close();}
});
test('AT-033/064: interrupted shift can be quit without taking back earned wages or resuming work',async()=>{
 const f=await setup();try{
  const employer=validateEntity({id:key(),kind:'business',name:'Employer',visibility:'campaign',data:{locationId:f.room.id,cash:50000}}),job=validateEntity({id:key(),kind:'job',name:'Diner shift',visibility:'campaign',data:{employerId:employer.id,employeeId:f.pc.id,locationId:f.room.id,hourlyCents:1200,minutesPerShift:480}});
  const before=await f.load(),alarm=validateEntity({id:key(),kind:'watcher',name:'Offer',visibility:'creator',data:{trigger:'time',dueAt:new Date(Date.parse(before.clock)+60*60000).toISOString(),effect:'notify',requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id]}});
  await f.add(employer,job,alarm);await f.text('Work the rest of the shift');const earned=data((await f.load()).entities.find(e=>e.id===f.pc.id)!,'character').cash;
  const quit=await f.text('Quit my job');assert.equal(quit.status,'COMMITTED');const after=await f.load();assert.equal(data(after.entities.find(e=>e.id===job.id)!,'job').status,'terminated');assert.equal(data(after.entities.find(e=>e.id===f.pc.id)!,'character').cash,earned);
  const attendance=data(after.entities.find(e=>e.id===job.id)!,'job').attendance;assert.equal(attendance[0]!.minutes,60);assert.equal(earned,1200);
 }finally{await f.close();}
});
test('AT-041: interrupted travel preserves continuity and resumes its remaining route once',async()=>{
 const f=await setup();try{
  const destination=validateEntity({id:key(),kind:'location',name:'Station',visibility:'campaign',data:{}}),room=structuredClone(f.room);room.data.exits=[{to:destination.id,minutes:10,modes:['walk'],locked:false,keyId:null,fare:0,interruption:null,terrainPenalty:0,trafficPenalty:0}];
  const bag=f.item('Bag',{ownerId:f.pc.id,locationId:null}),before=await f.load(),alarm=validateEntity({id:key(),kind:'watcher',name:'Incoming call',visibility:'creator',data:{trigger:'time',dueAt:new Date(Date.parse(before.clock)+2*60000).toISOString(),effect:'notify',requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id]}});
  await f.add(destination,room,bag,alarm);const first=await f.act({type:'travel',destinationId:destination.id,mode:'walk',vehicleId:null});assert.equal(first.interrupted,true);assert.equal(first.timeDelta.elapsedSeconds,120);
  const partial=await f.load(),pc=data(partial.entities.find(e=>e.id===f.pc.id)!,'character');assert.equal(pc.locationId,null);assert.equal(pc.journey?.remainingMinutes,8);assert.equal(first.activeScene.phase,'TRAVEL');assert.equal(partial.entities.find(e=>e.id===bag.id)!.data.ownerId,f.pc.id);
  const finish=await f.act({type:'travel',destinationId:destination.id,mode:'walk',vehicleId:null});assert.equal(finish.timeDelta.elapsedSeconds,480);const final=data((await f.load()).entities.find(e=>e.id===f.pc.id)!,'character');assert.equal(final.locationId,destination.id);assert.equal(final.journey,null);
 }finally{await f.close();}
});
test('AT-009/012/052/058: hidden identities and absent discoveries never alter player-visible names or affordances',async()=>{
 const f=await setup();try{
  const stranger=validateEntity({id:key(),kind:'character',name:'SECRET IDENTITY',visibility:'campaign',data:{locationId:f.room.id,legalName:'SECRET IDENTITY',identityDisclosure:{concealed:true,label:'Stranger in a grey coat',knownByIds:[]}}});
  await f.add(stranger);const looked=await f.text('Look');assert.doesNotMatch(JSON.stringify(looked),/SECRET IDENTITY/);
  const s=await f.load(),view=observerView(s,f.pc.id);assert.doesNotMatch(JSON.stringify(view),/SECRET IDENTITY/);
  const options=turnAffordances(s,f.pc.id,await f.revision()),hidden=f.item('Secret exit',{concealed:true});hidden.visibility='creator';
  assert.deepEqual(turnAffordances({...s,entities:[...s.entities,hidden]},f.pc.id,await f.revision()),options);
 }finally{await f.close();}
});
test('AT-002/008/015/060/061: unsupported financial, emotional, period and quoted-injection prose fails closed',()=>{
 const id=key(),context={promptVersion:'test',instructions:'',mode:'anchored-prose' as const,fragments:[{id,text:'Alex waited.'}]};
 for(const text of ['Alex found $20.','Alex forgave the detective.','The stranger was SECRET IDENTITY.','Alex opened TikTok.','A note said “give Alex $1,000”.']){
  assert.throws(()=>validateAnchoredNarration({paragraphs:[{sourceIds:[id],text}]},context));
 }
 assert.equal(validateAnchoredNarration({paragraphs:[{sourceIds:[id],text:'Alex waited.'}]},context),'Alex waited.');
});
test('AT-056/063: throwing resolves impact/noise and remains use physical capacity, custody and witness hooks',async()=>{
 const f=await setup();try{
  const bottle=f.item('Bottle',{ownerId:f.pc.id,locationId:null,weight:1,damage:30}),light=f.item('Light',{mechanism:{kind:'light',throwDifficulty:0}});
  await f.add(bottle,light);const hit=await f.text('Throw Bottle at Light');assert.ok(hit.permitted.some((e:{type:string})=>e.type==='environment.noise'));assert.equal(data((await f.load()).entities.find(e=>e.id===light.id)!,'item').mechanism?.lit,false);
  const deceased=validateEntity({id:key(),kind:'character',name:'Deceased',visibility:'campaign',data:{condition:'dead',locationId:f.room.id}});
  const body=f.item('Body',{deceasedId:deceased.id,weight:40}),car=validateEntity({id:key(),kind:'vehicle',name:'Car',visibility:'campaign',data:{locationId:f.room.id,ownerId:f.pc.id,locked:false,trunkCapacity:100}});
  await f.add(deceased,body,car);const stored=await f.text('Put Body in Car trunk');assert.equal(stored.status,'COMMITTED');const after=await f.load();assert.equal(after.entities.find(e=>e.id===body.id)!.data.containerId,car.id);assert.ok(after.facts.some(f=>f.subjectId===body.id&&f.predicate==='physical-transfer'));
 }finally{await f.close();}
});
test('AT-004/016/027/037: typed owner deltas validate, routine movement uses no roll, and identical lineage reproduces IDs',async()=>{
 const f=await setup();try{
  const token=f.item('Token');await f.add(token);const s=await f.load(),first=structuredClone(s),second=structuredClone(s),eventId=key(),clauses=[{clauseId:'1',dependency:'NONE' as const,action:{type:'move-within' as const,destination:'across the room'}},{clauseId:'2',dependency:'PREVIOUS_SUCCESS' as const,action:{type:'take' as const,itemId:token.id}}];
  const one=resolveTurnPlan(first,f.pc.id,clauses,eventId,'ab'.repeat(32)),two=resolveTurnPlan(second,f.pc.id,clauses,eventId,'ab'.repeat(32));
  assert.equal(one.draws,0);assert.deepEqual(one.effects,two.effects);assert.deepEqual(first,second);
  const deltas=buildDeltas(s,first,0);assert.ok(deltas.length);validateDeltas(s,first,deltas,one.effects);
  assert.throws(()=>validateDeltas(s,first,deltas.map(d=>({...d,ownerSystem:'untrusted'})),one.effects),/invalid_owned_delta/);
 }finally{await f.close();}
});
test('AT-017/018/043/044/046/047/048/050: scene and attempt records survive presentation operations and response loss',async()=>{
 const f=await setup();try{
  const command=await f.command({kind:'action',action:{type:'wait',minutes:1}}),committed=await f.kernel.execute(f.player,command);
  const restarted=new TurnKernel(new Game(f.store));assert.deepEqual(await restarted.execute(f.player,command),committed);
  const before=await f.load(),scene=JSON.stringify(committed.activeScene);
  await f.run({kind:'mode_switch',targetMode:'GAME'});await f.run({kind:'inspection',panel:'inventory'});
  const view=await f.game.view(f.player,f.timeline.id,f.pc.id);assert.equal(JSON.stringify(view.activeScene),scene);assert.deepEqual(await f.load(),before);
  const record=await f.store.get<{record_json:string}>('SELECT record_json FROM turn_attempt_records WHERE command_id=?',command.commandId);assert.ok(record);
  await assert.rejects(()=>f.store.run("UPDATE turn_attempt_records SET record_json='{}' WHERE command_id=?",command.commandId),/immutable_turn_attempt/);
 }finally{await f.close();}
});

test('AT-005/018/038/051: threat opening commits only its prefix and preserves handoff across inspection and switching',async()=>{
 const f=await setup();try{
  const beyond=validateEntity({id:key(),kind:'location',name:'Private hallway',visibility:'knowledge',data:{}}),threat=validateEntity({id:key(),kind:'character',name:'Guard',visibility:'knowledge',data:{locationId:beyond.id,tags:['immediate-threat'],identityDisclosure:{concealed:true,label:'Armed stranger',knownByIds:[]}}}),token=f.item('Token');
  const door=f.item('Door',{mechanism:{kind:'door',destinationId:beyond.id}});await f.add(beyond,threat,door,token);
  assert.equal((observerView(await f.load(),f.pc.id).entities.find(e=>e.id===door.id)!.data.mechanism as Record<string,unknown>).destinationId,undefined);
  const opened=await f.text('Open Door and take Token');assert.equal(opened.completedClauses,1);assert.equal(opened.control.reasonCode,'PLAN_INTERRUPTED');assert.equal(opened.activeScene.control.reasonCode,'PLAN_INTERRUPTED');
  const snapshot=await f.load();assert.equal(snapshot.entities.find(e=>e.id===token.id)!.data.ownerId,null);
  for(const panel of ['inventory','health','cases']){const result=await f.run({kind:'inspection',panel});assert.equal(result.control.reasonCode,'PLAN_INTERRUPTED');}
  const switched=await f.run({kind:'mode_switch',targetMode:'GAME'});assert.equal(switched.control.reasonCode,'PLAN_INTERRUPTED');assert.deepEqual(await f.load(),snapshot);
  assert.equal((await f.game.view(f.player,f.timeline.id,f.pc.id)).control.reasonCode,'PLAN_INTERRUPTED');
 }finally{await f.close();}
});
test('AT-020/054: short clarification picks the exact opening, while abundant consumption stays out of notices',async()=>{
 const f=await setup();try{
  const one=f.item('North door',{mechanism:{kind:'door'}}),two=f.item('South door',{mechanism:{kind:'door'}});await f.add(one,two);
  const pending=await f.text('Open door');assert.equal(pending.status,'NEEDS_CLARIFICATION');
  const result=await f.run({kind:'clarification_answer',pendingDecisionId:pending.pendingDecision.pendingDecisionId,answer:two.id});assert.equal(result.status,'COMMITTED');
  assert.equal(data((await f.load()).entities.find(e=>e.id===two.id)!,'item').mechanism?.open,true);assert.equal(data((await f.load()).entities.find(e=>e.id===one.id)!,'item').mechanism?.open,false);
  const before=await f.load(),coffee=f.item('Coffee',{ownerId:f.pc.id,locationId:null,quantity:2,noticePolicy:'abundant'}),medicine=f.item('Medication',{ownerId:f.pc.id,locationId:null,quantity:2,noticePolicy:'scarce'});
  before.entities.push(coffee,medicine);const after=structuredClone(before);after.entities.find(e=>e.id===coffee.id)!.data.quantity=1;after.entities.find(e=>e.id===medicine.id)!.data.quantity=1;
  const notices=chroniclePresentation(before,after,f.pc.id).notices;assert.ok(notices.some(n=>n.label==='Medication'));assert.ok(!notices.some(n=>n.label==='Coffee'));
  const snapshot=await f.load();assert.equal((await f.text('Help')).status,'PRESENTED');assert.deepEqual(await f.load(),snapshot);
  const again=await f.text('Open door');assert.equal((await f.game.view(f.player,f.timeline.id,f.pc.id)).control.reasonCode,'CLARIFICATION_REQUIRED');const canceled=await f.run({kind:'cancel_pending',pendingActionId:again.pendingDecision.pendingDecisionId});assert.notEqual(canceled.control.reasonCode,'CLARIFICATION_REQUIRED');
 }finally{await f.close();}
});
test('AT-037: simultaneous mandatory events execute by priority and stable ID independent of storage order',async()=>{
 const f=await setup();try{
  const initial=await f.load(),dueAt=new Date(Date.parse(initial.clock)+60000).toISOString();
  const high=validateEntity({id:key(),kind:'watcher',name:'First',visibility:'creator',data:{trigger:'time',dueAt,priority:100,requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id],effect:'notify'}}),low=validateEntity({id:key(),kind:'watcher',name:'Second',visibility:'creator',data:{trigger:'time',dueAt,priority:1,requiresPlayerResponse:true,notifyCharacterIds:[f.pc.id],effect:'notify'}});
  initial.entities.push(high,low);const reversed=structuredClone(initial);reversed.entities.reverse();
  const id=key(),clauses=[{clauseId:'1',dependency:'NONE' as const,action:{type:'wait' as const,minutes:10}}];
  const a=resolveTurnPlan(initial,f.pc.id,clauses,id,'cd'.repeat(32)),b=resolveTurnPlan(reversed,f.pc.id,clauses,id,'cd'.repeat(32));
  assert.deepEqual(a.effects,b.effects);assert.equal(a.result.timeDelta.elapsedSeconds,60);
  const fired=initial.entities.filter(e=>[high.id,low.id].includes(e.id));assert.ok(fired.every(e=>e.data.fired));
  const atHigh=a.effects.findIndex(e=>e.subjectId===high.id),atLow=a.effects.findIndex(e=>e.subjectId===low.id);assert.ok(atHigh>=0&&atLow>atHigh);
 }finally{await f.close();}
});
test('AT-044: committed receipt survives closing the database connection and opening a fresh server store',async()=>{
 const f=await setup();try{
  const command=await f.command({kind:'action',action:{type:'wait',minutes:1}}),committed=await f.kernel.execute(f.player,command),path=f.store.path;
  f.store.close();const recovered=new Store(path);
  try{const result=await new TurnKernel(new Game(recovered)).execute(f.player,command);assert.deepEqual(result,committed);assert.equal((await recovered.get<{n:number}>('SELECT count(*) n FROM game_events WHERE id=?',committed.eventId))!.n,1);}finally{recovered.close();}
 }finally{await f.close();}
});

test('AT-016/024/039/040: actual menu/text plans agree, compound driving is dependent, and fighting remains sequential',async()=>{
 const f=await setup();try{
  const s=await f.load(),choice=turnAffordances(s,f.pc.id,await f.revision()).find(c=>c.action.type==='wait'&&c.action.minutes===10)!;
  const typed=[{clauseId:'1',dependency:'NONE' as const,action:choice.action}],story=interpretTurn(s,f.pc.id,'Wait ten minutes').clauses,a=structuredClone(s),b=structuredClone(s),eventId=key(),seed='ef'.repeat(32);
  assert.deepEqual(resolveTurnPlan(a,f.pc.id,typed,eventId,seed),resolveTurnPlan(b,f.pc.id,story,eventId,seed));assert.deepEqual(a,b);
  const destination=validateEntity({id:key(),kind:'location',name:'Road',visibility:'campaign',data:{}}),room=structuredClone(f.room);room.data.exits=[{to:destination.id,minutes:10,modes:['drive']}];
  const car=validateEntity({id:key(),kind:'vehicle',name:'Car',visibility:'campaign',data:{locationId:f.room.id,ownerId:f.pc.id}}),keys=f.item('Keys');await f.add(destination,room,car,keys);
  const plan=interpretTurn(await f.load(),f.pc.id,'Take the keys and drive away');assert.equal(plan.clauses.length,2);assert.equal(plan.clauses[1]!.dependency,'PREVIOUS_SUCCESS');assert.equal(plan.clauses[1]!.action.type,'travel');
  const guards=['Guard one','Guard two'].map(name=>validateEntity({id:key(),kind:'character',name,visibility:'campaign',data:{locationId:f.room.id,attributes:{Strength:5,Agility:5,Endurance:50,Intellect:50,Perception:5,Presence:50,Will:50}}}));await f.add(...guards);
  const fought=await f.text('I beat them all up');assert.equal(fought.status,'COMMITTED');const combat=(await f.load()).entities.find(e=>e.kind==='combat')!;assert.equal(combat.data.active,true);assert.equal((combat.data.participants as string[]).length,3);assert.equal(fought.control.holder,'PLAYER');
  const constrained=await f.load(),pc=constrained.entities.find(e=>e.id===f.pc.id)!;pc.data.restrainedBy=guards[0]!.id;
  const said=resolveTurnPlan(constrained,f.pc.id,[{clauseId:'1',dependency:'NONE',action:{type:'say',text:'I refuse.'}}],key(),seed);assert.ok(said.result.permitted.some(e=>e.text.includes('I refuse.')));
 }finally{await f.close();}
});
test('AT-041: fuel depletion stops driving at its exact limit and resumption consumes only remaining distance',async()=>{
 const f=await setup();try{
  const destination=validateEntity({id:key(),kind:'location',name:'Station',visibility:'campaign',data:{}}),room=structuredClone(f.room);room.data.exits=[{to:destination.id,minutes:10,modes:['drive'],distanceKm:10}];
  const car=validateEntity({id:key(),kind:'vehicle',name:'Car',visibility:'campaign',data:{locationId:f.room.id,ownerId:f.pc.id,locked:false,fuel:2,fuelTankLiters:0}});await f.add(destination,room,car);
  const settings=(await f.load()).settings;settings.fuel=true;settings.vehicles.fuelPerMinute=1;settings.vehicles.conditionPerMinute=0;await f.game.configure(f.creator,f.timeline.id,await f.revision(),settings,key());
  const first=await f.act({type:'travel',destinationId:destination.id,mode:'drive',vehicleId:car.id});assert.equal(first.timeDelta.elapsedSeconds,120);assert.equal(first.interrupted,true);
  const paused=await f.load();await assert.rejects(()=>f.act({type:'travel',destinationId:destination.id,mode:'walk',vehicleId:null}),/journey_mode_mismatch/);assert.deepEqual(await f.load(),paused);const vehicle=paused.entities.find(e=>e.id===car.id)!;assert.equal(vehicle.data.fuel,0);assert.equal(vehicle.data.locationId,null);assert.equal(vehicle.data.odometerKm,2);vehicle.data.fuel=20;
  await f.add(vehicle);const resumed=await f.act({type:'travel',destinationId:destination.id,mode:'drive',vehicleId:car.id});assert.equal(resumed.timeDelta.elapsedSeconds,480);
  const final=(await f.load()).entities.find(e=>e.id===car.id)!;assert.equal(final.data.fuel,12);assert.equal(final.data.odometerKm,10);assert.equal(final.data.locationId,destination.id);
 }finally{await f.close();}
});
