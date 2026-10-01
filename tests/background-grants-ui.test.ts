import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
test('background dropdowns and trait grants update skill floors and budgets without banking free points',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 try{
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,timeline.id,1,key());
  const entities=(await game.load(timeline.id)).entities;
  const address=await f.app.listen({host:'127.0.0.1',port:0}),context=await browser.newContext({viewport:{width:820,height:1180}}),page=await context.newPage();
  await page.goto(address+'/app');
  await page.evaluate(async serialized=>{
   const entities=JSON.parse(serialized);
   const path='/creation-pools.js',pools=await import(path),character={playable:true,background:{},traits:[],skills:{},attributes:{}};
   const budget=pools.budgetPanel(character,entities),emit=()=>budget.refresh(),root=document.querySelector('#app')!;
   root.replaceChildren();root.className='creation-studio';
   const heading=document.createElement('h3');heading.textContent='Choices';root.append(budget.root,heading,pools.backgroundPicker(character,entities,emit),pools.selectionPool('traits',character,entities,emit),pools.selectionPool('skills',character,entities,emit));
  },JSON.stringify(entities));
  const budget=page.locator('[data-budget=skills]');
  await page.getByLabel('Primary background',{exact:true}).selectOption('marine');
  assert.equal(await page.getByLabel('Athletics exact value',{exact:true}).inputValue(),'50');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'50');
  assert.match(await budget.innerText(),/12 points left/);
  await page.getByLabel('Background 2 (optional)',{exact:true}).selectOption('veteran');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'50');
  await page.getByLabel('Firearms: rifles exact value',{exact:true}).fill('70');assert.match(await budget.innerText(),/11 points left/);
  await page.getByLabel('Primary background',{exact:true}).selectOption('');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'70');
  await page.getByLabel('Background 2 (optional)',{exact:true}).selectOption('');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'20');
  assert.equal(await page.getByLabel('Athletics exact value',{exact:true}).count(),0);assert.match(await budget.innerText(),/11 points left/);
  await page.getByRole('button',{name:'Medic',exact:true}).click();await page.getByRole('button',{name:'Choose Medic',exact:true}).click();
  assert.equal(await page.getByLabel('First aid exact value',{exact:true}).inputValue(),'50');assert.match(await budget.innerText(),/11 points left/);
  assert.match(await page.locator('.choice-detail').filter({has:page.getByRole('heading',{name:'Medic',exact:true})}).innerText(),/Costs 2 trait points/);
  await page.getByRole('button',{name:'Remove Medic',exact:true}).first().click();assert.equal(await page.getByLabel('First aid exact value',{exact:true}).count(),0);
  for(const width of [390,820,1536]){
   await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'artifacts/valor-background-grants-'+width+'.png',fullPage:true});
  }
  assert.deepEqual((await new AxeBuilder({page}).include('.creation-studio').analyze()).violations.map(row=>row.id),[]);
 }finally{await browser.close();await f.close();}
});
