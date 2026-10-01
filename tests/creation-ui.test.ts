import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {randomUUID} from 'node:crypto';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
import {fixture,password,key} from './helpers.ts';
import {themeIds} from '../src/theme.ts';

test('Creation Studio preserves exact ratings, hidden notes and jobs across themes and reviewed saves',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1536,height:1100},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id),id=randomUUID(),skillId=randomUUID();
  await game.configure(f.creator,timeline.id,1,{attributeScale:{min:-10,max:200,step:.25}},key());
  await game.edit(f.creator,timeline.id,{revision:2,entity:validateEntity({id:skillId,kind:'skill',name:'Driving',visibility:'campaign',data:{category:'skill',scale:{min:0,max:30,step:.25,unit:'rating'}}})},key());
  await game.edit(f.creator,timeline.id,{revision:3,entity:validateEntity({id,kind:'character',name:'UI preservation subject',visibility:'creator',data:{legalName:'Alex Morgan',ageYears:26,pronouns:'They / them',nationality:'Canadian',originNeighborhood:'Downtown',background:{option1:'Former art student',option2:'Preserved optional history'},attributes:{Strength:125.5,Agility:-2,Endurance:30,Intellect:45,Perception:50,Presence:20,Will:60},skills:{[skillId]:22.5},secrets:'Keep this private',instructions:'Never replace this instruction',occupations:[{id:randomUUID(),placeOfWork:'Cafe',position:'Barista',days:['Monday'],shift:'day'}]}})},key());
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;
  await page.goto(address+'/app');await page.getByLabel('Email address').fill('creator@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();await page.getByRole('heading',{name:'Choose your story.'}).waitFor();
  await page.getByRole('button',{name:'Customize style',exact:true}).click();await page.getByRole('button',{name:/Neon Purple Night/}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.screenshot({path:'artifacts/valor-menu-neon.png',fullPage:true});
  await page.getByRole('button',{name:'Open roster'}).click();await page.getByRole('button',{name:'Switch to Developer Mode'}).click();await page.getByRole('button',{name:'Confirm Developer Mode'}).click();await page.getByRole('button',{name:'Open Developer Studio'}).click();
  await page.getByRole('button',{name:'UI preservation subject character',exact:true}).click();
  assert.equal(await page.getByLabel('Strength exact value',{exact:true}).inputValue(),'125.5');assert.equal(await page.getByLabel('Agility exact value',{exact:true}).inputValue(),'-2');
  assert.equal(await page.getByLabel('Driving exact value',{exact:true}).inputValue(),'22.5');
  const advanced=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^More details · simulation/})}).first();assert.equal(await advanced.getAttribute('open'),null);
  const help=page.getByRole('button',{name:'Help: Overview',exact:true});await help.hover();assert.equal(await page.getByRole('tooltip').filter({hasText:'Authored identity'}).isVisible(),true);await help.focus();await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').filter({hasText:'Authored identity'}).isVisible(),false);
  await page.getByLabel('Strength visual scale',{exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');assert.equal(await page.getByLabel('Strength exact value',{exact:true}).inputValue(),'-9.75');await page.getByLabel('Strength exact value',{exact:true}).fill('125.5');
  await page.getByLabel('Driving exact value',{exact:true}).fill('23.75');await page.getByLabel('Place of work',{exact:true}).fill('Updated cafe');
  await page.locator('.creation-studio').screenshot({path:'artifacts/valor-creation-neon.png'});
  await page.getByRole('button',{name:'Style',exact:true}).click();await page.getByRole('button',{name:/Soft Baby Pink/}).click();await page.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.getByLabel('Driving exact value',{exact:true}).inputValue(),'23.75','theme selection does not discard the draft');
  await page.locator('.creation-studio').screenshot({path:'artifacts/valor-creation-soft.png'});
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  for(const themeId of themeIds){await page.evaluate(async id=>{const path='/theme.js';const theme=await import(path);theme.applyTheme(id);},themeId);assert.deepEqual((await new AxeBuilder({page}).include('.creation-studio').analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],themeId);}
  await page.evaluate(async()=>{const path='/theme.js';(await import(path)).applyTheme('soft-baby-pink');});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page fits');
  await help.click();assert.equal(await help.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
  await page.locator('.creation-studio').screenshot({path:'artifacts/valor-creation-mobile.png'});
  await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm audited save',exact:true}).click();await page.getByRole('heading',{name:'Developer studio',exact:true}).waitFor();
  const saved=(await game.load(timeline.id)).entities.find(row=>row.id===id)!;
  assert.equal((saved.data.attributes as Record<string,number>).Strength,125.5);assert.equal((saved.data.attributes as Record<string,number>).Agility,-2);assert.equal((saved.data.skills as Record<string,number>)[skillId],23.75);assert.equal(saved.data.secrets,'Keep this private');assert.equal(saved.data.instructions,'Never replace this instruction');assert.equal((saved.data.background as Record<string,string>).option2,'Preserved optional history');assert.equal((saved.data.occupations as Array<{placeOfWork:string}>)[0]!.placeOfWork,'Updated cafe');
  await page.reload();await page.getByRole('heading',{name:'Choose your story.'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'soft-baby-pink');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
