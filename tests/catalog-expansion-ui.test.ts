import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {fixture} from './helpers.ts';

test('selection details expose Medicine effects and exact paid refunds while free training remains nonrefundable',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const address=await f.app.listen({host:'127.0.0.1',port:0});
  await page.goto(address+'/app');
  await page.evaluate(async()=>{
   const poolsPath='/creation-pools.js',rulesPath='/creation-rules.js';
   const {selectionPool}=await import(poolsPath),{stockSkill,stockTrait}=await import(rulesPath);
   const medicine={id:'medicine',kind:'skill',name:'Medicine',visibility:'campaign',data:{description:stockSkill('Medicine').legacyDescription}};
   const weak={id:'low-stamina',kind:'trait',name:'Low stamina',data:{mode:'costed',...stockTrait('Low stamina')}};
   document.body.replaceChildren(selectionPool('skills',{playable:true,skills:{medicine:70},background:{option1:'doctor'}},[medicine],()=>{}),selectionPool('traits',{playable:true,traits:[]},[weak],()=>{}));
  });
  await page.getByRole('button',{name:'Medicine',exact:true}).click();
  const detail=page.locator('.choice-detail').first();
  assert.match(await detail.innerText(),/Clinical knowledge/);
  assert.match(await detail.innerText(),/Allocated: 1 skill points/);
  assert.match(await detail.innerText(),/returns 1 skill points/);
  assert.match(await detail.innerText(),/Trained threshold cost: 0/);
  await page.getByLabel('Medicine exact value',{exact:true}).fill('50');
  assert.match(await detail.innerText(),/Allocated: 0 skill points/);
  assert.match(await detail.innerText(),/returns 0 skill points/);
  await page.getByRole('button',{name:'Low stamina',exact:true}).click();
  const trait=page.locator('.choice-detail').last();
  assert.match(await trait.innerText(),/Refunds 4 trait points/);
  assert.match(await trait.innerText(),/-2 Endurance checks/);
 }finally{await browser.close();await f.close();}
});
