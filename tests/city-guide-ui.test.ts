import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,password,key} from './helpers.ts';
import {themeIds} from '../src/theme.ts';
import {Game} from '../src/game/engine.ts';

test('city guide, themed map and player option pools work on phone, tablet and desktop',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 try{
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,timeline.id,1,key());
  await game.createStartPackage(f.creator,timeline.id,{name:'City arrival',slug:'city-arrival',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'Morgan',data:{}}}},key());
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;
  const context=await browser.newContext({viewport:{width:1536,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(address+'/app');await page.getByLabel('Email address').fill('player@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();
  assert.equal(await page.locator('.topbar .status').count(),0);
  await page.getByRole('button',{name:'About Valor',exact:true}).click();await page.getByRole('heading',{name:'ABOUT VALOR',exact:true}).waitFor();
  assert.equal(await page.locator('.city-prose p').count(),11);
  assert.equal(await page.locator('.city-guide-body').getByRole('heading',{name:'UNION',exact:true}).count(),0);
  for(const [width,theme]of [[390,'soft-baby-pink'],[820,'neon-red-heat'],[1536,'neon-blue-electric']] as const){
   await page.setViewportSize({width,height:1000});await page.evaluate(async id=>{const path='/theme.js';(await import(path)).applyTheme(id);},theme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('.city-map img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0),true);
   assert.equal(await page.locator('.city-map img').evaluate(img=>getComputedStyle(img).mixBlendMode),'luminosity');
   assert.equal(await page.locator('.city-map').evaluate(img=>getComputedStyle(img).backgroundColor),'rgba(0, 0, 0, 0)');
   await page.locator('.city-map').screenshot({path:'artifacts/valor-map-'+width+'.png'});await page.locator('.city-guide').screenshot({path:'artifacts/valor-city-guide-'+width+'.png'});
  }
  for(const theme of themeIds){await page.evaluate(async id=>{const path='/theme.js';(await import(path)).applyTheme(id);},theme);assert.equal(await page.locator('.city-map').evaluate(map=>getComputedStyle(map).backgroundColor),'rgba(0, 0, 0, 0)',theme);}
  assert.equal(await page.locator('.city-map img').evaluate((img:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);return ctx.getImageData(0,0,1,1).data[3];}),0);
  await page.getByRole('button',{name:'Holiday',exact:true}).click();await page.getByRole('heading',{name:'New Kingswell',exact:true}).waitFor();
  assert.match(await page.locator('.region-introduction').textContent()??'',/Holiday only grew wealthier/);
  for(const [region,opening] of [['Greater Running','industry first'],['Centennial','1930s'],['Union','Valor distilled']] as const){await page.getByRole('button',{name:region,exact:true}).click();assert.ok((await page.locator('.region-introduction').textContent())?.includes(opening));assert.equal(await page.locator('.city-guide-body').evaluate(body=>body.children[1]?.className),'region-introduction');}
  await page.getByRole('button',{name:'Places to visit',exact:true}).click();await page.getByLabel('Search city places').fill('Liberty Bank');await page.getByRole('heading',{name:'Liberty Bank',exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to main menu'}).click();await page.getByRole('button',{name:'New Life',exact:true}).click();await page.getByRole('button',{name:'Choose a start',exact:true}).click();
  await page.getByRole('button',{name:'Customize this life',exact:true}).click();await page.getByRole('heading',{name:'Create your life',exact:true}).waitFor();await page.getByLabel('Character name',{exact:true}).fill('Morgan');
  assert.equal(await page.locator('.player-start .oc-attributes input[type=number]').count(),0);assert.equal(await page.locator('.player-start .oc-attributes .rating-scale').count(),0);
  for(const name of ['Strength','Agility','Endurance'])await page.getByLabel(name+' visual scale',{exact:true}).fill('100');assert.equal(await page.getByLabel('Intellect visual scale',{exact:true}).getAttribute('max'),'50');await page.getByLabel('Intellect visual scale',{exact:true}).fill('50');
  const heights=page.getByLabel('Height (feet & inches)',{exact:true});assert.equal(await heights.locator('option').count(),47);await heights.selectOption('162.56');await page.getByLabel('Body build',{exact:true}).selectOption('Muscular');assert.match(await page.locator('.automatic-traits').innerText(),/Muscular/);await page.getByLabel('Body build',{exact:true}).selectOption('Slim');assert.match(await page.locator('.automatic-traits').innerText(),/Short/);assert.doesNotMatch(await page.locator('.automatic-traits').innerText(),/Muscular/);
  assert.equal(await page.locator('.choice-pool').getByRole('button',{name:'Short',exact:true}).count(),0);assert.equal(await page.locator('.choice-pool').getByRole('button',{name:'Slim',exact:true}).count(),0);
  await page.getByLabel('Eye color',{exact:true}).selectOption('Brown');await page.getByLabel('Skin color',{exact:true}).selectOption('Medium');await page.getByLabel('Ethnicity',{exact:true}).selectOption('Other / self-described');await page.getByLabel('Ethnicity · your description',{exact:true}).fill('My authored identity');await page.getByLabel('Nationality',{exact:true}).selectOption('American (United States)');
  await page.getByLabel('Place of birth',{exact:true}).selectOption('lookup');await page.getByLabel('Birth country',{exact:true}).selectOption('US');await page.getByLabel('Birth region / state',{exact:true}).selectOption('WA');await page.getByLabel('Find birth city',{exact:true}).fill('Seattle');await page.getByLabel('Birth city / town',{exact:true}).selectOption({label:'Seattle'});
  await page.getByLabel('Neighborhood',{exact:true}).selectOption('North Crowns');assert.equal(await page.getByLabel('Residence',{exact:true}).inputValue(),'The Sync');assert.equal(await page.getByLabel('Residence',{exact:true}).locator('option').count(),2);
  await page.getByLabel('Choose my own starting jobs',{exact:true}).check();await page.getByRole('button',{name:'Add job',exact:true}).click();await page.getByLabel('Place of work · job 1',{exact:true}).selectOption('Liberty Bank');await page.getByLabel('Occupation · job 1',{exact:true}).selectOption('Bank Teller');
  await page.getByLabel('Primary background',{exact:true}).selectOption('laborer');
  await page.getByRole('button',{name:'Strong',exact:true}).click();assert.equal(await page.locator('.choice-detail').getByText('Costs 4 trait points',{exact:true}).count(),1);await page.getByRole('button',{name:'Choose Strong',exact:true}).click();assert.match(await page.locator('.pool-points').innerText(),/0 trait points left/);await page.getByRole('button',{name:'Brave',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Choose Brave',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Driving',exact:true}).click();await page.getByRole('button',{name:'Choose Driving',exact:true}).click();await page.getByLabel('Driving exact value',{exact:true}).fill('60');
  assert.equal(await page.locator('.starting-budget').isHidden(),true);
  for(const width of [390,820,1536]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.creation-studio').screenshot({path:'artifacts/valor-player-pools-'+width+'.png'});}
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  await page.getByRole('button',{name:'Start this life',exact:true}).click();await page.getByRole('heading',{name:'Chronicle.',exact:true}).waitFor();
  const loaded=await game.load(timeline.id),pc=loaded.entities.find(e=>e.kind==='character'&&e.data.playable)!;assert.equal((pc.data.background as Record<string,string>).option1,'laborer');assert.equal(pc.data.heightCm,162.56);assert.equal(pc.data.build,'Slim');assert.equal(pc.data.ethnicityContext,'My authored identity');assert.match(String(pc.data.birthplace),/Seattle/);assert.ok(['201','301'].includes((pc.data.residence as {apartment:string}).apartment));assert.equal(pc.data.locationId,pc.data.homeId);assert.equal((pc.data.occupations as Array<{position:string}>)[0]!.position,'Bank Teller');
  const driving=loaded.entities.find(e=>e.kind==='skill'&&e.name==='Driving')!;assert.equal((pc.data.skills as Record<string,number>)[driving.id],60);await page.getByRole('button',{name:'Skills / Traits',exact:true}).click();await page.getByRole('heading',{name:'Active skill statuses',exact:true}).waitFor();assert.equal(await page.getByText('Driving · Trained: +2 on checks using this skill.',{exact:true}).count(),1);assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
