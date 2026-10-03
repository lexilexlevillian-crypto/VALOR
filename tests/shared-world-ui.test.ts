import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,password} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {SharedWorld} from '../src/game/shared-world.ts';

test('owner configures one world and a new player starts a private life without campaign setup',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 try{
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;
  const context=await browser.newContext({viewport:{width:1536,height:1100},reducedMotion:'reduce'}),page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(address+'/app');await page.getByLabel('Email address').fill('creator@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();
  await page.getByRole('heading',{name:'VALOR',exact:true}).waitFor({timeout:5000}).catch(async e=>{throw new Error(String(e)+' '+JSON.stringify(errors)+' '+await page.locator('body').innerText());});
  await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'Creation Studio',exact:true}).click();await page.getByRole('button',{name:'Set up a fresh Valor world',exact:true}).click();
  await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'World settings',exact:true}).click();
  const controls=page.locator('.friendly-world-settings');await controls.getByLabel('Vehicles use fuel',{exact:true}).check();await controls.getByLabel('Total AI token allowance',{exact:true}).fill('2500');await controls.getByLabel('AI token allowance per player',{exact:true}).fill('2000');
  assert.equal(await controls.getByLabel('Timezone',{exact:true}).inputValue(),'America/Los_Angeles');
  assert.equal(await page.getByText('Advanced simulation settings (optional)',{exact:true}).evaluate(el=>el.parentElement?.hasAttribute('open')),false);
  await controls.getByRole('button',{name:'Use starter action rules'}).click();
  for(const width of [390,820,1536]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await controls.screenshot({path:'artifacts/valor-world-settings-'+width+'.png'});}
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
  await page.getByRole('button',{name:'Review and save world settings'}).click();await page.getByRole('button',{name:'Confirm audited settings',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  const game=new Game(f.store),world=new SharedWorld(game),source=(await world.describe(f.creator)).editor!;
  assert.equal((await game.load(source.timelineId)).settings.fuel,true);
  await context.close();
  const playerContext=await browser.newContext({viewport:{width:390,height:844}}),player=await playerContext.newPage();player.on('pageerror',e=>errors.push(e.message));
  await player.goto(address+'/app');await player.getByLabel('Email address').fill('player@example.test');await player.getByLabel('Password',{exact:true}).fill(password);await player.getByRole('button',{name:'Enter Valor'}).click();
  await player.getByRole('button',{name:'New Life',exact:true}).click();await player.getByRole('heading',{name:'Create your life',exact:true}).waitFor();
  assert.equal(await player.getByRole('button',{name:'Choose a start',exact:true}).count(),0);
  await player.getByLabel('Character name',{exact:true}).fill('Pacific arrival');
  await player.getByRole('button',{name:'Start this life',exact:true}).click();await player.getByRole('heading',{name:'Chronicle',exact:true}).waitFor();
  const life=await f.store.get<{id:string}>('SELECT t.id FROM player_lives p JOIN timelines t ON t.campaign_id=p.campaign_id WHERE p.user_id=?',f.player.id);
  assert.ok(life);assert.equal((await game.load(life.id)).settings.fuel,true);
  assert.equal((await game.load(source.timelineId)).entities.some(e=>e.data.playable),false);
  assert.deepEqual(errors,[]);await playerContext.close();
 }finally{await browser.close();await f.close();}
});
