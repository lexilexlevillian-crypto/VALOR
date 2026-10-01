import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {SharedWorld} from '../src/game/shared-world.ts';
import {validateEntity} from '../src/game/model.ts';

test('life entry is atomic and concurrent retries create only one private world',async()=>{
 const f=await fixture(),world=new SharedWorld(new Game(f.store));
 try{
  await world.setup(f.creator);
  const before=(await f.store.get<{n:number}>('SELECT count(*) n FROM campaigns'))!.n;
  await f.store.exec("CREATE TRIGGER fail_life_audit BEFORE INSERT ON audit_log WHEN NEW.action='player-life.created' BEGIN SELECT RAISE(ABORT,'test_life_rollback'); END;");
  await assert.rejects(()=>world.enter(f.player,key()),/test_life_rollback/);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM campaigns'))!.n,before);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM player_lives'))!.n,0);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM life_entry_receipts'))!.n,0);
  await f.store.exec('DROP TRIGGER fail_life_audit;');
  const request=key(),results=await Promise.all([world.enter(f.player,request),world.enter(f.player,request)]);
  assert.deepEqual(results[0],results[1]);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM player_lives'))!.n,1);
 }finally{await f.close();}
});

test('shared world gives players identical starting content but isolated lives, saves and permissions',async()=>{
 const f=await fixture(),game=new Game(f.store),world=new SharedWorld(game);
 try{
  await assert.rejects(()=>world.setup(f.player),/forbidden/);
  const configured=await world.setup(f.creator),source=configured.editor!;
  assert.equal((await world.setup(f.creator)).editor?.timelineId,source.timelineId);
  await assert.rejects(()=>world.setup(f.other),/world_owner_only/);
  assert.deepEqual(await world.describe(f.player),{ready:true,name:'Valor'});
  const npc=validateEntity({id:key(),kind:'character',name:'Hidden NPC',visibility:'creator',data:{description:'Secret source notes'}});
  const revision=(await game.access(f.creator,source.timelineId)).t.revision;
  await game.edit(f.creator,source.timelineId,{revision,entity:npc},key());
  const request=key(),a=await world.enter(f.player,request),again=await world.enter(f.player,request),draft=await world.enter(f.player,key()),b=await world.enter(f.observer,key());
  assert.deepEqual(a,again);assert.deepEqual(a,draft);
  const at=String(a.timeline!.id),bt=String(b.timeline!.id);
  assert.notEqual(at,bt);assert.equal(a.campaign!.role,'player');
  assert.equal((await game.load(at)).settings.timezone,'America/Los_Angeles');
  assert.deepEqual((await game.load(at)).entities,(await game.load(bt)).entities);
  assert.deepEqual((await game.roster(f.player,at)),[]);
  await assert.rejects(()=>game.creator(f.player,at),/forbidden/);
  await assert.rejects(()=>game.access(f.player,bt),/not_found/);
  await assert.rejects(()=>game.access(f.player,source.timelineId),/not_found/);
  const starts=await game.startPackages(f.player,at);
  assert.ok(starts.length);assert.equal('definition' in starts[0]!,false);
  const started=await game.start(f.player,at,{revision:1,packageId:starts[0]!.id,choices:{name:'My private life'}},key());
  assert.equal((await game.roster(f.player,at))[0]!.name,'My private life');
  await assert.rejects(()=>game.view(f.observer,at,started.characterId),/not_found/);
  const view=await game.view(f.player,at,started.characterId);assert.equal(JSON.stringify(view).includes('Secret source notes'),false);
  await assert.rejects(()=>game.start(f.player,at,{revision:(2),packageId:starts[0]!.id},key()),/life_already_started/);
  await game.save(f.player,at,'Private checkpoint');
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM saves WHERE timeline_id=?',bt))!.n,0);
  assert.equal((await game.load(source.timelineId)).entities.some(e=>e.data.playable),false);
  npc.name='Updated source NPC';await game.edit(f.creator,source.timelineId,{revision:(await game.access(f.creator,source.timelineId)).t.revision,entity:npc},key());
  assert.equal((await game.load(at)).entities.find(e=>e.id===npc.id)!.name,'Hidden NPC');
  const c=await world.enter(f.player,key());assert.notEqual(c.timeline!.id,at);
  assert.equal((await game.load(String(c.timeline!.id))).entities.find(e=>e.id===npc.id)!.name,'Updated source NPC');
  assert.deepEqual(await game.worldHistory(String(c.timeline!.id)),await game.worldHistory(source.timelineId));
  await f.store.run('DELETE FROM memberships WHERE campaign_id=? AND user_id=?',a.campaign!.id,f.player.id);
  await assert.rejects(()=>world.enter(f.player,request),/not_found/);
  const sourceStarts=await game.startPackages(f.creator,source.timelineId);
  await assert.rejects(async()=>game.start(f.creator,source.timelineId,{revision:(await game.access(f.creator,source.timelineId)).t.revision,packageId:sourceStarts[0]!.id},key()),/world_authoring_only/);
 }finally{await f.close();}
});

test('world entry API requires authentication and cannot select another user’s source',async()=>{
 const f=await fixture(),game=new Game(f.store),world=new SharedWorld(game);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);
  await assert.rejects(()=>world.setup(f.other,timeline.id),/not_found/);
  const pc=validateEntity({id:key(),kind:'character',name:'Existing life',visibility:'campaign',data:{playable:true,controllerUserId:f.player.id}});
  await game.edit(f.creator,timeline.id,{revision:1,entity:pc},key());
  await assert.rejects(()=>world.setup(f.creator,timeline.id),/world_source_contains_player_lives/);
  assert.equal((await world.describe(f.creator)).ready,false);
  await world.setup(f.creator);
  assert.equal((await f.app.inject({url:'/game/world'})).statusCode,401);
  const session=await login(f,'player@example.test'),headers={origin:f.settings.origin,cookie:session.cookie,'x-csrf-token':session.csrf,'idempotency-key':key()};
  assert.equal((await f.app.inject({method:'POST',url:'/game/world/setup',headers,payload:{}})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/game/world/life',headers,payload:{timelineId:timeline.id}})).statusCode,400);
  const response=await f.app.inject({method:'POST',url:'/game/world/life',headers,payload:{}});
  assert.equal(response.statusCode,200,response.body);assert.equal(response.json().campaign.role,'player');
 }finally{await f.close();}
});
