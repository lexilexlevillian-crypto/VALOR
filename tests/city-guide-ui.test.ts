import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,password,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';

test('city guide, themed map and player option pools work on phone, tablet and desktop',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 try{
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,timeline.id,1,key());
  await game.createStartPackage(f.creator,timeline.id,{name:'City arrival',slug:'city-arrival',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'Morgan',data:{}}}},key());
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;
  const context=await browser.newContext({viewport:{width:1536,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(address+'/app');await page.getByLabel('Email address').fill('player@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();
  await page.getByRole('button',{name:'About Valor',exact:true}).click();await page.getByRole('heading',{name:'ABOUT VALOR',exact:true}).waitFor();
  for(const [width,theme]of [[390,'soft-baby-pink'],[820,'neon-red-heat'],[1536,'neon-blue-electric']] as const){
   await page.setViewportSize({width,height:1000});await page.evaluate(async id=>{const path='/theme.js';(await import(path)).applyTheme(id);},theme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('.city-map img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0),true);
   assert.equal(await page.locator('.city-map img').evaluate(img=>getComputedStyle(img).mixBlendMode),'luminosity');
   await page.locator('.city-map').screenshot({path:'artifacts/valor-map-'+width+'.png'});await page.locator('.city-guide').screenshot({path:'artifacts/valor-city-guide-'+width+'.png'});
  }
  await page.getByRole('button',{name:'Holiday',exact:true}).click();await page.getByRole('heading',{name:'New Kingswell',exact:true}).waitFor();
  await page.getByRole('button',{name:'Places to visit',exact:true}).click();await page.getByLabel('Search city places').fill('Liberty Bank');await page.getByRole('heading',{name:'Liberty Bank',exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to main menu'}).click();await page.getByRole('button',{name:'New Life',exact:true}).click();await page.getByRole('button',{name:'Choose a start',exact:true}).click();
  await page.getByRole('button',{name:'Customize this life',exact:true}).click();await page.getByRole('heading',{name:'Create your life',exact:true}).waitFor();
  await page.getByLabel('Choose my own starting jobs',{exact:true}).check();await page.getByRole('button',{name:'Add job',exact:true}).click();await page.getByLabel('Place of work · job 1',{exact:true}).selectOption('Liberty Bank');await page.getByLabel('Occupation · job 1',{exact:true}).selectOption('Bank Teller');
  await page.getByRole('button',{name:'Manual laborer',exact:true}).click();await page.getByRole('button',{name:'Choose Manual laborer',exact:true}).click();
  await page.getByRole('button',{name:'Strong',exact:true}).click();assert.equal(await page.getByText('Costs 4 trait points',{exact:true}).count(),1);await page.getByRole('button',{name:'Choose Strong',exact:true}).click();
  await page.getByRole('button',{name:'Driving',exact:true}).click();await page.getByRole('button',{name:'Choose Driving',exact:true}).click();await page.getByLabel('Driving exact value',{exact:true}).fill('60');
  assert.match(await page.locator('[data-budget=skills]').textContent()??'',/9 points left/);
  for(const width of [390,820,1536]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.creation-studio').screenshot({path:'artifacts/valor-player-pools-'+width+'.png'});}
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  await page.getByRole('button',{name:'Start this life',exact:true}).click();await page.getByRole('heading',{name:'Chronicle.',exact:true}).waitFor();
  const loaded=await game.load(timeline.id),pc=loaded.entities.find(e=>e.kind==='character'&&e.data.playable)!;assert.equal((pc.data.background as Record<string,string>).originChoice,'laborer');assert.equal((pc.data.occupations as Array<{position:string}>)[0]!.position,'Bank Teller');
  const driving=loaded.entities.find(e=>e.kind==='skill'&&e.name==='Driving')!;assert.equal((pc.data.skills as Record<string,number>)[driving.id],60);assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
