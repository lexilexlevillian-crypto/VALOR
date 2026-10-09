import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,login} from './helpers.ts';

test('System 11 is authenticated, creator-only, isolated, revision checked and idempotent',async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.app.inject({url:'/system11'})).statusCode,401);
    const player=await login(f,'player@example.test');
    assert.equal((await f.app.inject({url:'/system11',headers:{cookie:player.cookie}})).statusCode,403);
    const creator=await login(f),headers={cookie:creator.cookie,origin:f.settings.origin,'x-csrf-token':creator.csrf};
    const before=await f.app.inject({url:'/system11',headers});assert.equal(before.statusCode,200,before.body);
    const state=before.json();assert.equal(state.adapterMode,'mocked');assert.equal(state.isolated,true);
    const body={commandId:randomUUID(),branchId:state.clock.branch_id,expectedClockRevision:0,durationMs:300000};
    const first=await f.app.inject({method:'POST',url:'/system11/advance',headers,payload:body});
    assert.equal(first.statusCode,200,first.body);assert.equal(first.json().result.elapsed_ms,300000);
    const retry=await f.app.inject({method:'POST',url:'/system11/advance',headers,payload:body});assert.deepEqual(retry.json(),first.json());
    const stale=await f.app.inject({method:'POST',url:'/system11/advance',headers,payload:{...body,commandId:randomUUID()}});
    assert.equal(stale.statusCode,409);assert.equal(stale.json().result.error.code,'STALE_CLOCK');
    const forged=await f.app.inject({method:'POST',url:'/system11/advance',headers,payload:{...body,snapshot:{world_clock:{instant_ms:999}}}});assert.equal(forged.statusCode,400);
    const noCsrf=await f.app.inject({method:'POST',url:'/system11/advance',headers:{cookie:creator.cookie,origin:f.settings.origin},payload:body});assert.equal(noCsrf.statusCode,403);
    const other=await login(f,'other@example.test');
    const separate=await f.app.inject({url:'/system11',headers:{cookie:other.cookie}});assert.equal(separate.statusCode,200);
    assert.notEqual(separate.json().clock.branch_id,state.clock.branch_id);assert.equal(separate.json().clock.revision,0);
    const consolePage=await f.app.inject({url:'/system11/console',headers});assert.equal(consolePage.statusCode,200);assert.match(consolePage.body,/does not advance saved lives/);
    const health=await f.app.inject({url:'/healthz'});assert.equal(health.headers['x-valor-system11'],'system11/1');
  }finally{await f.close();}
});
