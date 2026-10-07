import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,key,password} from './helpers.ts';
import {formExperiencedMemory} from '../src/game/memory.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
test('System 4 mobile recall and anchor are accessible and persist without advancing time',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});try{
  const game=new Game(f.store),t=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:key(),kind:'location',name:'Diner',visibility:'campaign',data:{}}),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:room.id}});await game.bulkEdit(f.creator,t.id,{revision:1,entities:[room,pc]},key());
  await game.mutate(f.creator,t.id,2,key(),{},'creator.memory',true,(state,eventId)=>({result:{memoryId:formExperiencedMemory(state,{ownerId:pc.id,eventId,text:'Nia rescued Alex at the diner.',kind:'rescue',sourceKind:'authored-backstory'})!.id}}));
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(address+'/app');await page.getByLabel('Email address').fill('player@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();await page.getByRole('button',{name:'Load Life',exact:true}).click();await page.getByRole('button',{name:'Open lives',exact:true}).click();await page.getByRole('button',{name:'Open roster',exact:true}).click();await page.getByRole('button',{name:'Continue as Alex',exact:true}).click();await page.getByRole('heading',{name:'Chronicle',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));await page.getByRole('button',{name:'Open phone',exact:true}).click();await page.locator('[data-pocket-app="Journal / Cases"]').click();await page.getByRole('heading',{name:'What I know',exact:true}).waitFor();
  await page.getByLabel('Recall a memory').fill('rescued');await page.getByRole('button',{name:'Try to remember',exact:true}).click();await expect(page.getByRole('button',{name:'Remember this',exact:true})).toBeVisible();const priorClock=(await game.load(t.id)).clock;await page.getByRole('button',{name:'Remember this',exact:true}).click();await expect(page.getByRole('button',{name:'Remember this',exact:true})).toHaveCount(0);await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));assert.equal((await game.load(t.id)).memories.find(m=>m.text==='Nia rescued Alex at the diner.')!.cognition!.anchor,true);assert.equal((await game.load(t.id)).clock,priorClock);
  assert.equal(await page.locator('.pocket-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id),[]);await page.screenshot({path:'artifacts/system04-memory-mobile.png',fullPage:true});await page.setViewportSize({width:820,height:1180});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'artifacts/system04-memory-ipad.png',fullPage:true});
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
