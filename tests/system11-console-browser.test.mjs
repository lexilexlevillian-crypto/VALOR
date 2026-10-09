import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {fixture,login} from './helpers.ts';

test('Creator console opens in the browser and commits a bounded mocked wait',async()=>{
  const f=await fixture();let browser;
  try{
    const origin=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=origin;
    const auth=await login(f);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:800,height:700}});
    const split=auth.cookie.indexOf('=');
    await page.context().addCookies([{name:auth.cookie.slice(0,split),value:auth.cookie.slice(split+1),url:origin}]);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/system11/console');
    await page.waitForFunction(()=>document.getElementById('clock')?.textContent?.startsWith('2012-'));
    await page.getByRole('button',{name:'Wait 5 minutes',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('status')?.textContent==='Complete');
    const result=JSON.parse(await page.locator('#result').textContent());
    assert.equal(result.elapsed_ms,300000);assert.equal(result.status,'COMPLETED');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});
