import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, key, login, password } from './helpers.ts';
import { buildApp } from '../src/app.ts';
import { Auth, hash } from '../src/auth.ts';
import { config } from '../src/config.ts';

test('authentication, HttpOnly sessions, CSRF, expiry, logout and persistence across app restart',async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.app.inject('/campaigns')).statusCode,401);
    const bad=await f.app.inject({method:'POST',url:'/auth/login',headers:{origin:f.settings.origin},payload:{email:'missing@example.test',password}});
    assert.equal(bad.statusCode,401);assert.equal(bad.json().error,'invalid_credentials');
    const auth=await login(f);
    const session=await f.app.inject({url:'/auth/session',headers:{cookie:auth.cookie}});
    assert.equal(session.statusCode,200);
    assert.equal(session.headers['cache-control'],'no-store');
    assert.equal(session.json().csrfToken,auth.csrf);
    const rawToken=auth.cookie.split('=')[1]!;
    assert.equal(f.store.get<{token_hash:string}>('SELECT token_hash FROM sessions')!.token_hash,hash(rawToken));
    assert.doesNotMatch(JSON.stringify(f.store.all('SELECT * FROM users')),new RegExp(password.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')));
    const secondApp=buildApp(f.store,f.settings,false);
    try {assert.equal((await secondApp.inject({url:'/auth/session',headers:{cookie:auth.cookie}})).statusCode,200);}
    finally {await secondApp.close();}
    assert.equal((await f.app.inject({method:'POST',url:'/worlds',headers:{cookie:auth.cookie,origin:f.settings.origin},payload:{name:'No CSRF'}})).statusCode,403);
    assert.equal((await f.app.inject({method:'POST',url:'/worlds',headers:{cookie:auth.cookie,origin:'https://attacker.example','x-csrf-token':auth.csrf},payload:{name:'Wrong origin'}})).statusCode,403);
    const response=await f.app.inject({method:'POST',url:'/auth/logout',headers:{cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf}});
    assert.equal(response.statusCode,200);assert.match(String(response.headers['set-cookie']),/Max-Age=0/);
    assert.equal((await f.app.inject({url:'/auth/session',headers:{cookie:auth.cookie}})).statusCode,401);
    const fresh=await login(f);f.store.run("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'");
    assert.equal((await f.app.inject({url:'/auth/session',headers:{cookie:fresh.cookie}})).statusCode,401);
  }finally{await f.close();}
});

test('production refuses unsafe environment and uses host-only secure cookies',async()=>{
  assert.throws(()=>config({NODE_ENV:'production'}),/Production requires/);
  assert.throws(()=>config({APP_ORIGIN:'https://example.com/path'}),/origin/);
  const f=await fixture();
  const app=buildApp(f.store,{...f.settings,production:true,origin:'https://valor.example'},false);
  try {
    const response=await app.inject({method:'POST',url:'/auth/login',headers:{origin:'https://valor.example'},payload:{email:'creator@example.test',password}});
    assert.equal(response.statusCode,200);
    const cookie=String(response.headers['set-cookie']);
    assert.match(cookie,/^__Host-valor_session=/);assert.match(cookie,/HttpOnly/);
    assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);
    assert.doesNotMatch(cookie,/Domain=/);
    assert.ok(response.headers['strict-transport-security']);
    assert.doesNotMatch(response.body,/scrypt|password_hash|token_hash/);
  }finally{await app.close();await f.close();}
});

test('API rejects extra authority claims, oversized and malformed bodies, client seeds and SQL injection',async()=>{
  const f=await fixture();
  try {
    const auth=await login(f);
    const headers={cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf,'idempotency-key':key()};
    const command={type:'record.create',kind:'test',name:"'); DROP TABLE users; --",visibility:'campaign'};
    const send=(payload:unknown)=>f.app.inject({method:'POST',url:'/commands',headers,payload:payload as Record<string,unknown>});
    assert.equal((await send({scope:f.scope,command:{...command,actorId:f.other.id}})).statusCode,400);
    assert.equal((await send({scope:f.scope,command:{...command,seed:'client-roll'}})).statusCode,400);
    assert.equal((await send({scope:f.scope,command:{...command,time:'2099-01-01'}})).statusCode,400);
    assert.equal((await send({scope:f.scope,command:{...command,name:'x'.repeat(40000)}})).statusCode,413);
    const malformed=await f.app.inject({method:'POST',url:'/commands',headers:{...headers,'content-type':'application/json'},payload:'{broken'});
    assert.equal(malformed.statusCode,400);
    const valid=await send({scope:f.scope,command});
    assert.equal(valid.statusCode,200,valid.body);
    assert.equal(f.store.get<{n:number}>('SELECT count(*) n FROM users')!.n,4);
    const read=await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/records/'+valid.json().id,headers:{cookie:auth.cookie}});
    assert.equal(read.json().name,command.name);
  }finally{await f.close();}
});

test('HTTP campaign queries, commands and privileged histories enforce role and tenant boundaries',async()=>{
  const f=await fixture();
  try {
    const other=await login(f,'other@example.test'),player=await login(f,'player@example.test');
    assert.deepEqual((await f.app.inject({url:'/campaigns',headers:{cookie:other.cookie}})).json().items,[]);
    assert.equal((await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/records',headers:{cookie:other.cookie}})).statusCode,404);
    for(const path of ['events','audits'])assert.equal((await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/'+path,headers:{cookie:player.cookie}})).statusCode,403);
    const response=await f.app.inject({method:'POST',url:'/commands',headers:{cookie:player.cookie,origin:f.settings.origin,'x-csrf-token':player.csrf,'idempotency-key':key()},payload:{scope:f.scope,command:{type:'record.create',name:'Unauthorized',kind:'test',visibility:'campaign'}}});
    assert.equal(response.statusCode,403);
    const creator=await login(f);
    const headers={cookie:creator.cookie,origin:f.settings.origin,'x-csrf-token':creator.csrf,'idempotency-key':key()};
    const removal=await f.app.inject({method:'POST',url:'/campaigns/'+f.campaign.id+'/members',headers,payload:{userId:f.player.id,role:null,expectedRevision:3}});
    assert.equal(removal.statusCode,200,removal.body);
    assert.equal((await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/records',headers:{cookie:player.cookie}})).statusCode,404);
  }finally{await f.close();}
});

test('simultaneous HTTP commands with the same revision commit once, and duplicate delivery returns the receipt',async()=>{
  const f=await fixture();
  try {
    const auth=await login(f),rec=f.execute({type:'record.create',name:'Concurrency',kind:'test',visibility:'campaign'});
    const command={type:'record.update',recordId:rec.id,expectedRevision:1,name:'Changed',visibility:'campaign'};
    const request=(idempotencyKey:string)=>f.app.inject({method:'POST',url:'/commands',headers:{cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf,'idempotency-key':idempotencyKey},payload:{scope:f.scope,command}});
    const firstKey=key(),secondKey=key();
    const results=await Promise.all([request(firstKey),request(secondKey)]);
    assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
    const success=results.findIndex(r=>r.statusCode===200);
    const replay=await request(success===0?firstKey:secondKey);
    assert.deepEqual(replay.json(),results[success]!.json());
    assert.equal(f.store.get<{n:number}>('SELECT count(*) n FROM domain_events WHERE aggregate_id=?',rec.id)!.n,2);
  }finally{await f.close();}
});

test('login rate limit is durable, per-account and immune to spoofed forwarded headers',async()=>{
  const f=await fixture();
  const app=buildApp(f.store,{...f.settings,loginLimit:2},false);
  try {
    const attempt=(forwarded:string)=>app.inject({method:'POST',url:'/auth/login',headers:{origin:f.settings.origin,'x-forwarded-for':forwarded},payload:{email:'nonexistent@example.test',password}});
    assert.equal((await attempt('1.1.1.1')).statusCode,401);
    assert.equal((await attempt('2.2.2.2')).statusCode,401);
    const limited=await attempt('3.3.3.3');
    assert.equal(limited.statusCode,429);assert.ok(limited.headers['retry-after']);
    const auth=new Auth(f.store,{...f.settings,loginLimit:2});
    assert.throws(()=>auth.limit('login-account','nonexistent@example.test',2,900000),/rate_limited/);
    assert.doesNotMatch(JSON.stringify(f.store.all('SELECT * FROM rate_limits')),/nonexistent|1\.1\.1\.1/);
  }finally{await app.close();await f.close();}
});

test('logs and internal errors exclude cookies, passwords, raw bodies, query strings and hidden data',async()=>{
  const f=await fixture();
  let output='';
  const app=buildApp(f.store,f.settings,{write(chunk:string){output+=chunk;}});
  try {
    const response=await app.inject({method:'POST',url:'/auth/login',headers:{origin:f.settings.origin},payload:{email:'creator@example.test',password}});
    assert.equal(response.statusCode,200);
    const cookie=String(response.headers['set-cookie']).split(';')[0]!;
    const csrf=response.json().csrfToken;
    await app.inject({url:'/not-a-route?secret=SECRET_QUERY',headers:{cookie,authorization:'Bearer SECRET_AUTH'}});
    f.store.db.exec("CREATE TRIGGER fail_events BEFORE INSERT ON domain_events BEGIN SELECT RAISE(ABORT,'SECRET_INTERNAL'); END;");
    const error=await app.inject({method:'POST',url:'/commands',headers:{cookie,origin:f.settings.origin,'x-csrf-token':csrf,'idempotency-key':key()},payload:{scope:f.scope,command:{type:'record.create',name:'SECRET_BODY',kind:'test',visibility:'creator'}}});
    assert.equal(error.statusCode,500);
    assert.doesNotMatch(error.body,/SECRET_INTERNAL|SECRET_BODY/);
    app.log.info({password:'SECRET_LOG_PASSWORD',token:'SECRET_LOG_TOKEN',csrfToken:'SECRET_LOG_CSRF'},'redaction.test');
    assert.ok(output.includes('request.complete'));assert.ok(output.includes('[REDACTED]'));
    for(const secret of [password,cookie,csrf,'SECRET_QUERY','SECRET_AUTH','SECRET_INTERNAL','SECRET_BODY','SECRET_LOG_PASSWORD','SECRET_LOG_TOKEN','SECRET_LOG_CSRF'])assert.ok(!output.includes(secret),secret);
  }finally{await app.close();await f.close();}
});

test('service serves a real HTTP health request and shuts down cleanly',async()=>{
  const f=await fixture();
  try {
    const address=await f.app.listen({host:'127.0.0.1',port:0});
    const response=await fetch(address+'/healthz');
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok'});
    const root=await fetch(address);assert.equal((await root.json()).playable,false);
  }finally{await f.close();}
});
