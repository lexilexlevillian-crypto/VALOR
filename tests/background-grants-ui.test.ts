import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {ORIGINS} from '../public/creation-rules.js';

// Serve the real creation modules while keeping other numbered systems closed.
async function openCreationPage(page:Page){
 await page.route('https://creation.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/app')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Character creation</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/studio.css"></head><body><main id="app"></main></body></html>'});
  if(path.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:'{}'});
  if(!/^\/[\w.-]+\.(js|css)$/.test(path))return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(new URL('../public'+path,import.meta.url),'utf8')});
 });
 await page.goto('https://creation.test/app');
}

test('every background adds its actual skills in the browser without installing a catalog',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 try{
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
  const {entities}=await game.creationOptions(f.player,timeline.id);
  const page=await browser.newPage();
  await openCreationPage(page);
  await page.evaluate(async serialized=>{
   const entities=JSON.parse(serialized);
   const path='/creation-pools.js',pools=await import(path),character={playable:true,background:{},traits:[],skills:{},attributes:{}};
   document.querySelector('#app')!.replaceChildren(pools.backgroundPicker(character,entities,()=>{}),pools.selectionPool('skills',character,entities,()=>{}));
  },JSON.stringify(entities));
  for(const background of ORIGINS){
   await page.getByLabel('Primary background',{exact:true}).selectOption(background.id);
   for(const [name,fraction] of Object.entries(background.skills)){
    assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true',background.name+' / '+name);
    assert.equal(await page.getByLabel(name+' exact value',{exact:true}).inputValue(),String(fraction*100));
   }
   assert.equal(await page.getByText(/training unavailable/).count(),0);
   await page.getByLabel('Primary background',{exact:true}).selectOption('');
   assert.equal(await page.locator('.selected-choice').count(),0);
  }
 }finally{await browser.close();await f.close();}
});
test('background dropdowns and trait grants update skill floors and budgets without banking free points',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 try{
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,timeline.id,1,key());
  const entities=(await game.load(timeline.id)).entities;
  const context=await browser.newContext({viewport:{width:820,height:1180}}),page=await context.newPage();
  await openCreationPage(page);
  await page.evaluate(async serialized=>{
   const entities=JSON.parse(serialized);
   const path='/creation-pools.js',pools=await import(path),character={playable:true,background:{},traits:[],skills:{},attributes:{}};
   const budget=pools.budgetPanel(character,entities),emit=()=>budget.refresh(),root=document.querySelector('#app')!;
   Object.assign(window,{testCharacter:character,refreshCreationControls:pools.refreshCreationControls});
   root.replaceChildren();root.className='creation-studio';
   const heading=document.createElement('h3');heading.textContent='Choices';root.append(budget.root,heading,pools.backgroundPicker(character,entities,emit),pools.selectionPool('traits',character,entities,emit),pools.selectionPool('skills',character,entities,emit));
  },JSON.stringify(entities));
  assert.equal(await page.locator('.starting-budget').isHidden(),true);assert.match(await page.locator('.pool-points').innerText(),/6 trait points left/);
  await page.getByLabel('Primary background',{exact:true}).selectOption('marine');
  assert.equal(await page.getByLabel('Athletics exact value',{exact:true}).inputValue(),'50');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'50');
  await page.getByLabel('Background 2 (optional)',{exact:true}).selectOption('veteran');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'50');
  await page.getByLabel('Firearms: rifles exact value',{exact:true}).fill('70');
  await page.getByLabel('Primary background',{exact:true}).selectOption('');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'70');
  await page.getByLabel('Background 2 (optional)',{exact:true}).selectOption('');
  assert.equal(await page.getByLabel('Firearms: rifles exact value',{exact:true}).inputValue(),'20');
  assert.equal(await page.getByLabel('Athletics exact value',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Medic',exact:true}).click();await page.getByRole('button',{name:'Choose Medic',exact:true}).click();
  assert.equal(await page.getByLabel('First aid exact value',{exact:true}).inputValue(),'50');assert.match(await page.locator('.pool-points').innerText(),/4 trait points left/);
  assert.match(await page.locator('.choice-detail').filter({has:page.getByRole('heading',{name:'Medic',exact:true})}).innerText(),/Costs 2 trait points/);
  await page.getByRole('button',{name:'Remove Medic',exact:true}).first().click();assert.equal(await page.getByLabel('First aid exact value',{exact:true}).count(),0);
  for(const name of ['Driving','Mechanics','Criminal knowledge']){await page.getByRole('button',{name,exact:true}).click();await page.getByRole('button',{name:'Choose '+name,exact:true}).click();}
  await page.getByLabel('Driving exact value',{exact:true}).fill('100');await page.getByLabel('Mechanics exact value',{exact:true}).fill('100');assert.equal(await page.getByLabel('Criminal knowledge visual scale',{exact:true}).getAttribute('max'),'20');await page.getByLabel('Criminal knowledge exact value',{exact:true}).fill('100');assert.equal(await page.getByLabel('Criminal knowledge exact value',{exact:true}).inputValue(),'20');
  await page.evaluate(()=>{const state=window as typeof window&{testCharacter:{playable:boolean};refreshCreationControls:(character:unknown)=>void};state.testCharacter.playable=false;state.refreshCreationControls(state.testCharacter);});assert.equal(await page.getByLabel('Criminal knowledge visual scale',{exact:true}).getAttribute('max'),'100');assert.match(await page.locator('.pool-points').innerText(),/Unlimited trait points for NPCs/);
  for(const width of [390,820,1536]){
   await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'artifacts/valor-background-grants-'+width+'.png',fullPage:true});
  }
  assert.deepEqual((await new AxeBuilder({page}).include('.creation-studio').analyze()).violations.map(row=>row.id),[]);
 }finally{await browser.close();await f.close();}
});
