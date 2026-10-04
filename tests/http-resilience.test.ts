import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,login,password} from './helpers.ts';
import {chromium} from '@playwright/test';
const {readJsonResponse,requestJson}=await import(new URL('../public/http.js',import.meta.url).href);

test('JSON responses handle empty, truncated and non-JSON bodies without hiding valid API errors',async()=>{
 for(const [body,status] of [['',502],['',200],['{"ok":',200],['<html>Bad gateway</html>',503]] as const){
  await assert.rejects(readJsonResponse(new Response(body,{status}),{method:'POST'}),/empty or incomplete response.*Reload your life and check whether the action saved/);
 }
 await assert.rejects(readJsonResponse(new Response('',{status:504})),/HTTP 504.*Reload the page/);
 await assert.rejects(readJsonResponse(Response.json({error:'revision_conflict'},{status:409}),{labels:{revision_conflict:'Refresh your life.'}}),/^Error: Refresh your life\.$/);
 assert.deepEqual(await readJsonResponse(Response.json({ok:true})),{ok:true});
 assert.deepEqual(await readJsonResponse(Response.json([])),[]);
 assert.equal(await readJsonResponse(Response.json(null)),null);
 const broken=new Response(new ReadableStream({start(controller){controller.error(new Error('broken stream'));}}));
 await assert.rejects(readJsonResponse(broken,{method:'POST'}),/check whether the action saved/);
});

test('lost mutation responses are never automatically retried',async t=>{
 for(const mode of ['network','empty','abort']){
  let calls=0;
  const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;if(mode==='network')throw new TypeError('fetch failed');if(mode==='abort')throw new DOMException('Canceled','AbortError');return new Response('',{status:502});});
  await assert.rejects(requestJson('/turns',{method:'POST',body:'{}'}),mode==='abort'?{name:'AbortError'}:/check whether the action saved/);
  assert.equal(calls,1);mock.mock.restore();
 }
});

test('real HTTP keeps slow authenticated requests alive beyond the old ten-second cutoff',async()=>{
 const f=await fixture();let calls=0;
 f.app.post('/test/slow-json',async()=>{calls++;await delay(11000);return {ok:true};});
 try{
  const auth=await login(f),address=await f.app.listen({host:'127.0.0.1',port:0});
  assert.equal(f.app.server.timeout,60000);
  assert.equal(f.app.server.requestTimeout,15000,'request-upload protection remains enabled');
  const start=performance.now(),result=await requestJson(address+'/test/slow-json',{method:'POST',headers:{cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf,'content-type':'application/json'},body:'{}'});
  assert.deepEqual(result,{ok:true});assert.ok(performance.now()-start>=11000);assert.equal(calls,1);
  const asset=await fetch(address+'/http.js');assert.equal(asset.status,200);assert.match(await asset.text(),/export async function requestJson/);
 }finally{await f.close();}
});

test('browser shows a recovery message for an empty response and can sign in afterward',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true}),page=await browser.newPage();let attempts=0;
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;
  await page.route('**/auth/login',async route=>{attempts++;await route.fulfill({status:502,body:''});});
  await page.goto(address+'/app');
  await page.getByLabel('Email address').fill('creator@example.test');await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Enter Valor'}).click();
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent?.includes('empty or incomplete response'));
  assert.equal(attempts,1);assert.doesNotMatch(await page.locator('#notice').innerText(),/Unexpected end|execute 'json'/);
  await page.unroute('**/auth/login');await page.getByRole('button',{name:'Enter Valor'}).click();
  await page.getByRole('heading',{name:'VALOR',exact:true}).waitFor();assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
