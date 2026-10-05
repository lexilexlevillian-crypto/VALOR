import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {NarrativeGateway,type NarrativeProvider} from '../src/game/ai.ts';
import {applyStoryAdditions} from '../src/game/story-world.ts';
import {data,validateEntity} from '../src/game/model.ts';
import {observerView} from '../src/game/epistemics.ts';

async function setup(){
 const f=await fixture(),game=new Game(f.store),t=await game.initialize(f.creator,f.campaign.id);
 const place=validateEntity({id:key(),kind:'location',name:'North Crowns',visibility:'campaign',data:{category:'neighborhood'}}),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:place.id}});
 await game.bulkEdit(f.creator,t.id,{revision:1,entities:[place,pc]},key());
 const settings=(await game.load(t.id)).settings;settings.tokenBudget=100000;settings.userTokenBudget=100000;settings.contextTokens=6000;await game.configure(f.creator,t.id,2,settings,key());
 const turn=await game.turn(f.player,t.id,{revision:3,characterId:pc.id,action:{type:'story',text:'Alex watched the street.'}},key());
 return {f,game,t,place,pc,turn};
}

test('source-preserving prose narrates; invalid schemas and invented shots produce safe diagnostics',async()=>{
 const {f,game,t,pc,turn}=await setup();
 try{
  let mode='ordinary';
  const provider:NarrativeProvider={id:'diagnostic-story',arrange:async c=>mode==='schema'?{paragraphs:[{sourceIds:c.fragments.map(f=>f.id),text:42}],private_field:'DO NOT EXPOSE'}:{additions:[],paragraphs:[{sourceIds:c.fragments.map(f=>f.id),text:mode==='shot'?'Alex fired the pistol.':c.fragments.map(f=>f.text).join(' ')}]}};
  const gateway=new NarrativeGateway(game,[provider]),before=(await game.access(f.player,t.id)).t.revision;
  assert.equal((await gateway.narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story')).status,'validated');
  for(const [next,code] of [['schema','ai_output_schema_invalid_text'],['shot','narrative_unsupported_claim']]){
   mode=next!;const result=await gateway.narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story');
   assert.equal(result.status,'grounded-fallback');assert.equal('failureCode' in result?result.failureCode:null,code);
   assert.doesNotMatch(JSON.stringify(result),/DO NOT EXPOSE|private_field/);
   const saved=await f.store.get<{failure_code:string}>('SELECT failure_code FROM ai_requests WHERE trace_id=?',result.traceId);assert.equal(saved?.failure_code,code);
  }
  assert.equal((await game.access(f.player,t.id)).t.revision,before);
  assert.equal((await game.view(f.player,t.id,pc.id)).turns.at(-1)?.narration,turn.narration);
 }finally{await f.close();}
});
test('narration additions are rejected and cannot change entities, facts, time or revision',async()=>{
 const {f,game,t,pc,turn}=await setup();
 try{
  const before=await game.load(t.id),revision=(await game.access(f.player,t.id)).t.revision;
  const provider:NarrativeProvider={id:'test-story',arrange:async context=>({additions:[{kind:'npc',name:'Mara Bell',description:'An adult clerk.'}],paragraphs:[{sourceIds:context.fragments.map(f=>f.id),text:'Mara Bell waited nearby.'}]})};
  const result=await new NarrativeGateway(game,[provider]).narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story');
  assert.equal(result.status,'grounded-fallback');assert.equal(result.failureCode,'narration_cannot_mutate_world');
  assert.deepEqual(await game.load(t.id),before);assert.equal((await game.access(f.player,t.id)).t.revision,revision);
 }finally{await f.close();}
});
test('unsafe, duplicate, indoor and retry additions cannot mutate the world',async()=>{
 const {f,game,t,pc,place,turn}=await setup();
 try{
  const state=await game.load(t.id);
  assert.throws(()=>applyStoryAdditions(structuredClone(state),pc.id,turn.eventId,[{kind:'npc',name:'Admin',description:'No',data:{controllerUserId:f.player.id}}]));
  assert.throws(()=>applyStoryAdditions(structuredClone(state),pc.id,turn.eventId,[{kind:'npc',name:'Alex',description:'Duplicate'}]),/already_exists/);
  const privateHome=structuredClone(state);privateHome.entities.find(e=>e.id===place.id)!.data.ownerId=pc.id;assert.throws(()=>applyStoryAdditions(privateHome,pc.id,turn.eventId,[{kind:'npc',name:'Stranger',description:'An unexpected adult.'}]),/public_scene/);
  const indoor=structuredClone(state);indoor.entities.find(e=>e.id===place.id)!.data.category='room';assert.throws(()=>applyStoryAdditions(indoor,pc.id,turn.eventId,[{kind:'street',name:'Shortcut',description:'Outdoors'}]),/public_outdoors/);
  await f.store.run("UPDATE story_turns SET narration_status='validated' WHERE id=?",turn.eventId);
  const provider:NarrativeProvider={id:'retry-invention',arrange:async c=>({additions:[{kind:'npc',name:'New person',description:'Unexpected'}],paragraphs:[{sourceIds:c.fragments.map(f=>f.id),text:'A new person appeared.'}]})};
  const response=await new NarrativeGateway(game,[provider]).narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story');assert.equal(response.status,'grounded-fallback');assert.equal((await game.load(t.id)).entities.length,state.entities.length);
 }finally{await f.close();}
});

test('failed private-scene narration retries are prose-only and cannot propose a new NPC',async()=>{
 const {f,game,t,pc,place,turn}=await setup();
 try{
  const state=await game.load(t.id),privatePlace=state.entities.find(e=>e.id===place.id)!;privatePlace.data.ownerId=pc.id;
  await game.edit(f.creator,t.id,{revision:4,entity:privatePlace},key());const expansionStates:boolean[]=[];
  const provider:NarrativeProvider={id:'private-retry',arrange:async context=>{expansionStates.push(Boolean(context.allowExpansion));return context.allowExpansion?{additions:[{kind:'npc',name:'Uninvited stranger',description:'An adult stranger.'}],paragraphs:[{sourceIds:context.fragments.map(f=>f.id),text:'Alex remained in the private room.'}]}:{additions:[],paragraphs:[{sourceIds:context.fragments.map(f=>f.id),text:context.fragments.map(f=>f.text).join(' ')}]};}};
  const gateway=new NarrativeGateway(game,[provider]),first=await gateway.narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story');
  assert.equal(first.status,'validated');assert.deepEqual(expansionStates,[false]);
  const retried=await gateway.narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story');assert.equal(retried.status,'validated');assert.deepEqual(expansionStates,[false,false]);
  assert.ok(!(await game.load(t.id)).entities.some(e=>e.name==='Uninvited stranger'));
 }finally{await f.close();}
});
test('a stale narration cannot add entities after another turn commits',async()=>{
 const {f,game,t,pc,turn}=await setup();
 try{
  const provider:NarrativeProvider={id:'slow-story',arrange:async c=>{await game.turn(f.player,t.id,{revision:4,characterId:pc.id,action:{type:'wait',minutes:1}},key());return {additions:[{kind:'npc',name:'Late visitor',description:'An adult passerby.'}],paragraphs:[{sourceIds:c.fragments.map(f=>f.id),text:'A visitor stood nearby.'}]};}};
  const response=await new NarrativeGateway(game,[provider]).narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story');assert.equal(response.status,'grounded-fallback');
  assert.ok(!(await game.load(t.id)).entities.some(e=>e.name==='Late visitor'));
 }finally{await f.close();}
});
