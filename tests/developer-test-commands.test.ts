import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {data,validateEntity,validateState} from '../src/game/model.ts';

test('Developer test commands force combat and searchable body fixtures without normal prerequisites',async()=>{
 const f=await fixture();try{
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id),character=validateEntity({id:randomUUID(),kind:'character',name:'Command tester',visibility:'campaign',data:{playable:true,controllerUserId:f.creator.id}});
  await game.edit(f.creator,timeline.id,{revision:1,entity:character},key());
  const combat=await game.developerTestCommand(f.creator,timeline.id,{revision:2,characterId:character.id,command:'combat'},key());
  assert.match(combat.summary,/Combat started with Test opponent/);assert.equal(combat.createdEntityIds.length,3,'a missing location, opponent, and encounter are created');
  let state=await game.load(timeline.id),player=data(state.entities.find(entity=>entity.id===character.id)!,'character'),encounter=state.entities.find(entity=>entity.kind==='combat'&&entity.data.active===true)!;
  assert.ok(player.locationId);assert.deepEqual(data(encounter,'combat').turnOrder.slice(0,1),[character.id]);assert.ok(state.entities.some(entity=>entity.name==='Test opponent 1'&&entity.data.locationId===player.locationId));validateState(state);

  const loot=await game.developerTestCommand(f.creator,timeline.id,{revision:combat.revision,characterId:character.id,command:'loot'},key());
  assert.match(loot.summary,/searchable test body and visible loot/);state=await game.load(timeline.id);
  const body=state.entities.find(entity=>entity.name==='Test victim 1')!,remains=state.entities.find(entity=>entity.name==='Test body 1')!,item=state.entities.find(entity=>entity.name==='Test loot 1')!,death=state.entities.find(entity=>entity.kind==='deathRecord'&&entity.data.characterId===body.id)!;
  assert.equal(body.data.condition,'dead');assert.equal(remains.data.deceasedId,body.id);assert.equal(item.data.locationId,player.locationId);assert.equal(death.data.remainsId,remains.id);assert.ok((death.data.witnessIds as string[]).includes(character.id));
  const view=await game.view(f.creator,timeline.id,character.id);assert.ok(view.entities.some(entity=>entity.id===body.id));assert.ok(view.entities.some(entity=>entity.id===item.id));validateState(state);

  const ended=await game.developerTestCommand(f.creator,timeline.id,{revision:loot.revision,characterId:character.id,command:'end-combat'},key());assert.match(ended.summary,/Ended 1 active encounter/);state=await game.load(timeline.id);assert.equal(data(state.entities.find(entity=>entity.id===encounter.id)!,'combat').active,false);
  await f.domain.setUserMode(f.creator,{mode:'player',expectedRevision:1});await assert.rejects(()=>game.developerTestCommand(f.creator,timeline.id,{revision:ended.revision,characterId:character.id,command:'combat'},key()),/developer_mode_required/);
 }finally{await f.close();}
});
