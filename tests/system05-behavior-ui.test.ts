import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,key,password} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';

test('System 5 Creator previews and publishes a versioned NPC profile without advancing time',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});try{
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});
  const game=new Game(f.store),t=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:key(),kind:'location',name:'Diner',visibility:'campaign',data:{}}),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'campaign',data:{playable:true,controllerUserId:f.creator.id,locationId:room.id}}),npc=validateEntity({id:key(),kind:'character',name:'Nia',visibility:'campaign',data:{locationId:room.id}});
  await game.bulkEdit(f.creator,t.id,{revision:1,entities:[room,pc,npc]},key());const initialClock=(await game.load(t.id)).clock;
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;const context=await browser.newContext({viewport:{width:1536,height:1100},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(address+'/app');await page.getByLabel('Email address').fill('creator@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();await page.getByRole('button',{name:'Load Life',exact:true}).click();await page.getByRole('button',{name:'Open lives',exact:true}).click();await page.getByRole('button',{name:'Open roster',exact:true}).click();await page.getByRole('button',{name:'Continue as Alex',exact:true}).click();await page.getByRole('heading',{name:'Chronicle',exact:true}).waitFor();
  await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'NPC Registry',exact:true}).click();await page.getByRole('button',{name:/^Nia/}).click();await page.getByText('Behavior and decisions',{exact:true}).click();await page.getByRole('button',{name:'Open behavior editor',exact:true}).click();await page.getByRole('heading',{name:'NPC behavior',exact:true}).waitFor();
  await page.getByRole('button',{name:'Preview decisions',exact:true}).click();await expect(page.getByText('current-state',{exact:true})).toBeVisible();assert.equal((await game.load(t.id)).npcBehavior,undefined);
  await page.getByRole('button',{name:'Publish profile',exact:true}).click();await expect(page.getByRole('button',{name:'Freeze behavior',exact:true})).toBeVisible();assert.equal((await game.load(t.id)).npcBehavior!.actors[0]!.actorId,npc.id);assert.equal((await game.load(t.id)).clock,initialClock);
  for(const width of [390,820,1536]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(-12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,text:e.textContent?.slice(0,80)})))));}
  const violations=(await new AxeBuilder({page}).include('.npc-profile-preview').analyze()).violations;assert.deepEqual(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);await page.screenshot({path:'artifacts/system05-creator.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
