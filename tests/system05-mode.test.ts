import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {buildApp} from '../src/app.ts';

test('System 05 mode preference is revisioned, role-gated, audited, and persisted',async()=>{
 const f=await fixture();
 try{const timeline=await new Game(f.store).initialize(f.creator,f.campaign.id);
  const creator=await login(f),player=await login(f,'player@example.test');
  const creatorHeaders={cookie:creator.cookie,origin:f.settings.origin,'x-csrf-token':creator.csrf,'idempotency-key':key()};
  const playerHeaders={cookie:player.cookie,origin:f.settings.origin,'x-csrf-token':player.csrf,'idempotency-key':key()};
  const initial=await f.app.inject({url:'/me/mode',headers:{cookie:creator.cookie}});
  assert.equal(initial.statusCode,200);assert.deepEqual(initial.json(),{mode:'player',revision:0,developerAllowed:true});
  const playerInitial=await f.app.inject({url:'/me/mode',headers:{cookie:player.cookie}});
  assert.equal(playerInitial.json().developerAllowed,false);
  const entered=await f.app.inject({method:'POST',url:'/me/mode',headers:creatorHeaders,payload:{mode:'developer',expectedRevision:0}});
  assert.equal(entered.statusCode,200);assert.equal(entered.json().mode,'developer');assert.equal(entered.json().revision,1);
  const denied=await f.app.inject({method:'POST',url:'/me/mode',headers:playerHeaders,payload:{mode:'developer',expectedRevision:0}});
  assert.equal(denied.statusCode,403);
  const overview=await f.app.inject({url:'/game/timelines/'+timeline.id+'/developer/overview',headers:{cookie:creator.cookie}});
  assert.equal(overview.statusCode,200);assert.ok(Array.isArray(overview.json().entities));
  const hiddenForPlayer=await f.app.inject({url:'/game/timelines/'+timeline.id+'/developer/overview',headers:{cookie:player.cookie}});
  assert.equal(hiddenForPlayer.statusCode,403);
  const oldCreatorEndpoint=await f.app.inject({url:'/game/timelines/'+timeline.id+'/creator',headers:{cookie:player.cookie}});
  assert.equal(oldCreatorEndpoint.statusCode,403);
  const exited=await f.app.inject({method:'POST',url:'/me/mode',headers:{...creatorHeaders,'idempotency-key':key()},payload:{mode:'player',expectedRevision:1}});
  assert.equal(exited.statusCode,200);assert.equal(exited.json().mode,'player');assert.equal(exited.json().revision,2);
  const audit=await f.store.get<{n:number}>("SELECT count(*) n FROM audit_log WHERE actor_id=? AND action='user.mode.updated'",f.creator.id);
  assert.equal(audit!.n,2);
 }finally{await f.close();}
});

test('System 05 access key grants audited Developer Mode only to the authenticated account and its existing campaigns',async()=>{
 const f=await fixture(),accessKey='developer-test-key-'.repeat(3),app=buildApp(f.store,{...f.settings,developerAccessKey:accessKey},false);
 try{
  const player=await login({...f,app},'player@example.test'),headers={cookie:player.cookie,origin:f.settings.origin,'x-csrf-token':player.csrf};
  const wrong=await app.inject({method:'POST',url:'/me/developer-access',headers,payload:{accessKey:'wrong-key',expectedRevision:0}});
  assert.equal(wrong.statusCode,403);assert.equal((await f.store.get<{role:string}>('SELECT role FROM users WHERE id=?',f.player.id))!.role,'player');
  const granted=await app.inject({method:'POST',url:'/me/developer-access',headers,payload:{accessKey,expectedRevision:0}});
  assert.equal(granted.statusCode,200,granted.body);assert.equal(granted.json().user.role,'creator');assert.equal(granted.json().mode,'developer');
  assert.equal((await f.store.get<{role:string}>('SELECT role FROM memberships WHERE campaign_id=? AND user_id=?',f.campaign.id,f.player.id))!.role,'creator');
  const overview=await app.inject({url:'/game/timelines/'+(await new Game(f.store).initialize(f.creator,f.campaign.id)).id+'/developer/overview',headers:{cookie:player.cookie}});
  assert.equal(overview.statusCode,200,overview.body);
  assert.equal((await f.store.get<{role:string}>('SELECT role FROM users WHERE id=?',f.other.id))!.role,'admin');
  const audits=JSON.stringify(await f.store.all('SELECT action,reason,before_json,after_json FROM audit_log WHERE actor_id=? AND action LIKE ?',f.player.id,'developer.access.%'));
  assert.match(audits,/developer.access.denied/);assert.match(audits,/developer.access.granted/);assert.doesNotMatch(audits,new RegExp(accessKey));
 }finally{await app.close();await f.close();}
});

test('System 05 static shell exposes safe-area switch styling and does not cache game state',()=>{
 const css=readFileSync('public/style.css','utf8'),sw=readFileSync('public/sw.js','utf8'),app=readFileSync('public/app.js','utf8');
 assert.match(css,/env\(safe-area-inset-bottom\)/);assert.match(css,/mode-switch/);assert.match(css,/mode-dialog/);
 assert.match(app,/Developer Mode/);assert.match(app,/clearDeveloperState/);assert.match(app,/\/me\/developer-access/);
 assert.match(sw,/valor-shell-v4/);assert.match(sw,/theme\.js/);assert.doesNotMatch(sw,/game\/timelines|\/me\/mode|creator/);
});
