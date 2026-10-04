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
test('story additions persist in the life, support interaction and survive saves; retry only changes prose',async()=>{
 const {f,game,t,place,pc,turn}=await setup();
 try{
  let retry=false;
  const provider:NarrativeProvider={id:'test-story',arrange:async context=>({additions:retry?[]:[{kind:'npc',name:'Mara Bell',description:'An adult clerk carrying a folded newspaper.'},{kind:'street',name:'Bell Street',description:'A narrow public street beside the market.'},{kind:'detail',name:'Blue awning',description:'A faded blue awning hung over the corner.'}],paragraphs:[{sourceIds:context.fragments.map(f=>f.id),text:retry?'Mara Bell stood beneath the blue awning on Bell Street.':'Mara Bell waited beside Bell Street beneath a blue awning. “Can I help you?” she asked.'}]})};
  const gateway=new NarrativeGateway(game,[provider]),result=await gateway.narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story');assert.equal(result.status,'validated');
  let s=await game.load(t.id);const npc=s.entities.find(e=>e.name==='Mara Bell')!,street=s.entities.find(e=>e.name==='Bell Street')!;
  assert.ok(npc&&street);assert.equal(npc.data.locationId,place.id);assert.equal(npc.data.playable,false);assert.equal(npc.data.controllerUserId,null);
  assert.ok(data(s.entities.find(e=>e.id===place.id)!,'location').exits.some(e=>e.to===street.id));
  assert.ok(observerView(s,pc.id).entities.some(e=>e.id===npc.id));assert.ok(s.facts.some(f=>f.predicate==='scene-detail'));
  const revision=(await game.access(f.player,t.id)).t.revision;retry=true;
  assert.equal((await gateway.narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story')).status,'validated');
  assert.equal((await game.access(f.player,t.id)).t.revision,revision);assert.equal((await game.load(t.id)).entities.length,s.entities.length);
  const save=await game.save(f.player,t.id,'Story memory'),branch=await game.branch(f.player,t.id,save.id,'Story branch');assert.ok((await game.load(branch.id)).entities.some(e=>e.id===npc.id));
  const moved=await game.turn(f.player,t.id,{revision,characterId:pc.id,action:{type:'travel',destinationId:street.id,mode:'walk',vehicleId:null}},key());assert.ok(moved.eventId);assert.equal((await game.load(t.id)).entities.find(e=>e.id===pc.id)!.data.locationId,street.id);
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
test('a stale narration cannot add entities after another turn commits',async()=>{
 const {f,game,t,pc,turn}=await setup();
 try{
  const provider:NarrativeProvider={id:'slow-story',arrange:async c=>{await game.turn(f.player,t.id,{revision:4,characterId:pc.id,action:{type:'wait',minutes:1}},key());return {additions:[{kind:'npc',name:'Late visitor',description:'An adult passerby.'}],paragraphs:[{sourceIds:c.fragments.map(f=>f.id),text:'A visitor stood nearby.'}]};}};
  await assert.rejects(new NarrativeGateway(game,[provider]).narrate(f.player,t.id,turn.eventId,provider.id,undefined,'story'),/revision_conflict|stale/);
  assert.ok(!(await game.load(t.id)).entities.some(e=>e.name==='Late visitor'));
 }finally{await f.close();}
});
