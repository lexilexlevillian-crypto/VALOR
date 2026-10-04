import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {fixture,password} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {SharedWorld} from '../src/game/shared-world.ts';
import {PLAYER_NEIGHBORHOODS} from '../public/profile-rules.js';

test('player uses Union creation, native phone apps, and recoverable delete life from the real UI',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true}),game=new Game(f.store),world=new SharedWorld(game);
 try{
  await world.setup(f.creator);
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(address+'/app');await page.getByLabel('Email address').fill('player@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();
  await page.getByRole('button',{name:'New Life',exact:true}).click();await page.getByRole('heading',{name:'Create your life',exact:true}).waitFor();
  const neighborhoods=page.getByLabel('Neighborhood',{exact:true});
  assert.deepEqual(await neighborhoods.locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value).filter(Boolean)),PLAYER_NEIGHBORHOODS);
  await neighborhoods.selectOption('North Crowns');await page.getByLabel('Character name',{exact:true}).fill('Phone test resident');
  await page.getByRole('button',{name:'Start this life',exact:true}).click();await page.getByRole('heading',{name:'Chronicle',exact:true}).waitFor();
  const life=(await world.lives(f.player))[0]!;
  await page.getByRole('button',{name:'Open phone',exact:true}).click();
  for(const app of ['Weather','News','Messages','Contacts','My character','Health','Inventory','Journal','Jobs & money','Map','Save / load','Settings']){
   await page.locator('.pocket-home').getByRole('button',{name:app,exact:true}).click();
   await page.locator('.native-app').waitFor();
   assert.equal(await page.locator('.pocket-content .card').count(),0,app+' must not embed desktop cards');
   await page.getByRole('button',{name:'Phone home',exact:true}).click();
  }
  await page.getByRole('button',{name:'Put away',exact:false}).click();
  await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
  await page.getByRole('button',{name:'Main menu',exact:true}).click();
  await page.locator('.title-menu').getByRole('button',{name:'Load Life',exact:true}).click();
  await page.locator('.campaign-card').getByRole('button',{name:'Delete life',exact:true}).click();
  await page.getByRole('dialog',{name:'Delete life'}).getByRole('button',{name:'Delete life',exact:true}).click();
  await page.getByRole('dialog',{name:'Delete life'}).waitFor({state:'detached'});
  await page.getByText('Deleted lives (1)',{exact:true}).click();
  assert.ok((await world.lives(f.player))[0]!.archivedAt);
  await page.getByRole('button',{name:'Restore life',exact:true}).click();
  await page.locator('.campaign-card').getByRole('button',{name:'Delete life',exact:true}).waitFor();
  assert.equal((await world.lives(f.player)).find(l=>l.id===life.id)!.archivedAt,null);
  const timeline=await f.store.get<{id:string}>('SELECT id FROM timelines WHERE campaign_id=?',life.id);
  assert.equal((await game.roster(f.player,timeline!.id))[0]!.name,'Phone test resident');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
