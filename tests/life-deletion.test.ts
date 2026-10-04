import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {SharedWorld} from '../src/game/shared-world.ts';

test('life deletion is owner-only, recoverable, idempotent and preserves checkpoints and other lives',async()=>{
 const f=await fixture(),game=new Game(f.store),world=new SharedWorld(game);
 try{
  const source=(await world.setup(f.creator)).editor!,life=await world.enter(f.player,key()),other=await world.enter(f.observer,key()),tid=String(life.timeline!.id),cid=life.campaign!.id;
  const starts=await game.startPackages(f.player,tid);await game.start(f.player,tid,{revision:1,packageId:starts[0]!.id},key());await game.save(f.player,tid,'Keep this checkpoint');
  const before=await game.load(tid),saves=await game.saves(f.player,tid);
  await assert.rejects(()=>world.setLifeDeleted(f.observer,cid,true),/life_not_found/);
  await assert.rejects(()=>world.setLifeDeleted(f.creator,source.campaignId,true),/life_not_found/);
  assert.equal((await world.setLifeDeleted(f.player,cid,true)).recoverable,true);
  await world.setLifeDeleted(f.player,cid,true);
  await assert.rejects(()=>game.access(f.player,tid),/not_found/);
  assert.ok((await world.lives(f.player)).find(l=>l.id===cid)?.archivedAt);
  assert.equal((await world.describe(f.player)).ready,true);
  await game.access(f.observer,String(other.timeline!.id));
  const replacement=await world.enter(f.player,key());assert.notEqual(replacement.campaign!.id,cid);
  await world.setLifeDeleted(f.player,cid,false);
  assert.deepEqual(await game.load(tid),before);assert.deepEqual(await game.saves(f.player,tid),saves);
  assert.equal((await f.store.get<{n:number}>("SELECT count(*) n FROM audit_log WHERE target_id=? AND action='player-life.deleted'",cid))!.n,1);
 }finally{await f.close();}
});

test('life API requires session, CSRF, explicit confirmation and owner scope',async()=>{
 const f=await fixture(),world=new SharedWorld(new Game(f.store));
 try{
  await world.setup(f.creator);const life=await world.enter(f.player,key()),cid=life.campaign!.id;
  assert.equal((await f.app.inject({url:'/game/lives'})).statusCode,401);
  const session=await login(f,'player@example.test'),headers={origin:f.settings.origin,cookie:session.cookie,'x-csrf-token':session.csrf};
  const url='/game/lives/'+cid+'/delete';
  assert.equal((await f.app.inject({method:'POST',url,headers,payload:{}})).statusCode,400);
  assert.equal((await f.app.inject({method:'POST',url,headers:{origin:f.settings.origin,cookie:session.cookie},payload:{confirmed:true}})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url,headers,payload:{confirmed:true}})).statusCode,200);
  assert.ok((await f.app.inject({url:'/game/lives',headers})).json().some((l:{id:string;archivedAt:string})=>l.id===cid&&l.archivedAt));
  assert.equal((await f.app.inject({url:'/campaigns',headers})).json().items.some((c:{id:string})=>c.id===cid),false);
  assert.equal((await f.app.inject({method:'POST',url:'/game/lives/'+cid+'/restore',headers,payload:{}})).statusCode,200);
 }finally{await f.close();}
});
