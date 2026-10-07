import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {fixture,password} from './helpers.ts';
import {themeIds} from '../src/theme.ts';

test('pastel wallpapers, integrated title menu, motion controls and device preferences',async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1536,height:1000},reducedMotion:'no-preference'}),page=await context.newPage(),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const animation=()=>page.locator('.wallpaper-layer').evaluate(node=>getComputedStyle(node).animationName);
 const style=async()=>{await page.getByRole('button',{name:'Toggle navigation'}).click();await page.locator('.rail').getByRole('button',{name:'Style',exact:true}).click();await page.getByRole('dialog',{name:'Make it yours'}).waitFor();};
 try{
  const address=await f.app.listen({host:'127.0.0.1',port:0});f.settings.origin=address;
  await page.goto(address+'/app');
  assert.equal(await page.locator('html').getAttribute('data-background'),'hearts');
  assert.equal(await animation(),'wallpaper-drift');
  assert.equal(await page.locator('#valor-wallpaper').getAttribute('aria-hidden'),'true');
  assert.equal(await page.locator('#valor-wallpaper').getAttribute('inert'),'');
  await page.getByLabel('Email address').fill('creator@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter Valor'}).click();await page.getByRole('heading',{name:'VALOR',exact:true}).waitFor();
  assert.deepEqual(await page.locator('.topbar button').allTextContents(),['☰']);
  assert.deepEqual(await page.locator('.game-menu-hero .title-menu button').allTextContents(),['New Life','Load Life','About Valor']);
  assert.equal(await page.locator('.game-menu > .title-menu').count(),0);
  await page.getByRole('button',{name:'Toggle navigation'}).click();assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('.rail-utilities').evaluate(node=>node.nextElementSibling?.tagName),'FOOTER');
  const dock=await page.locator('.rail').evaluate(node=>{const tools=node.querySelector('.rail-utilities')!.getBoundingClientRect(),footer=node.querySelector('footer')!.getBoundingClientRect();return {toolsBottom:tools.bottom,footerTop:footer.top,footerBottom:footer.bottom,height:innerHeight};});assert.ok(dock.toolsBottom<=dock.footerTop&&dock.footerBottom<=dock.height);
  await page.screenshot({path:'artifacts/valor-bottom-navigation.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.mobile-menu').evaluate(node=>node===document.activeElement),true);
  await style();
  assert.deepEqual(await page.locator('.theme-family').allTextContents(),['Neons · dark backgrounds','Pastels · soft colors']);
  assert.equal(await page.locator('.theme-choice').count(),15);
  await page.getByRole('button',{name:/^Soft Baby Pink/}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='soft-baby-pink');
  assert.deepEqual(await page.evaluate(()=>['base','raised','selected','pattern'].map(key=>getComputedStyle(document.documentElement).getPropertyValue('--theme-'+key).trim())),['#ffebef','#ffd1dc','#ffb6c1','#ff99aa']);
  assert.equal(await page.getByRole('button',{name:'Hearts',exact:true}).getAttribute('aria-pressed'),'true');
  for(const pattern of ['Stars','Checkerboard','Leopard print','Hearts']){
   await page.getByRole('button',{name:pattern,exact:true}).click();
   assert.equal(await page.getByRole('button',{name:pattern,exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await animation(),['Hearts','Stars'].includes(pattern)?'wallpaper-drift':'none');
  }
  await page.getByLabel('Animate hearts & stars',{exact:true}).uncheck();assert.equal(await animation(),'none');
  await page.getByRole('button',{name:'Stars',exact:true}).click();assert.equal(await animation(),'none');
  await page.getByRole('button',{name:'Done',exact:true}).click();await page.reload();await page.getByRole('heading',{name:'VALOR',exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-background'),'stars');assert.equal(await animation(),'none');assert.equal(await page.locator('html').getAttribute('data-theme'),'soft-baby-pink');
  await style();assert.equal(await page.getByLabel('Animate hearts & stars',{exact:true}).isChecked(),false);
  await page.getByLabel('Animate hearts & stars',{exact:true}).check();assert.equal(await animation(),'wallpaper-drift');
  await page.getByLabel('Reduce motion',{exact:true}).check();assert.equal(await animation(),'none');
  await page.getByLabel('Reduce motion',{exact:true}).uncheck();assert.equal(await animation(),'wallpaper-drift');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await animation(),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await animation(),'wallpaper-drift');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  for(const themeId of themeIds){
   for(const pattern of ['hearts','stars','checkerboard','leopard']){
    const state=await page.evaluate(async({themeId,pattern})=>{const themePath='/theme.js',backgroundPath='/backgrounds.js';(await import(themePath)).applyTheme(themeId);(await import(backgroundPath)).applyBackground(pattern);const node=document.querySelector('.wallpaper-layer')!,css=getComputedStyle(node);return {theme:document.documentElement.dataset.theme,pattern:document.documentElement.dataset.background,mask:css.maskImage,scheme:getComputedStyle(document.documentElement).colorScheme,animation:css.animationName,pointer:getComputedStyle(document.querySelector('#valor-wallpaper')!).pointerEvents};},{themeId,pattern});
    assert.equal(state.theme,themeId);assert.equal(state.pattern,pattern);assert.match(state.mask,/data:image\/svg\+xml/);assert.equal(state.scheme,themeId.startsWith('soft-')?'light':'dark');assert.equal(state.pointer,'none');assert.equal(state.animation,['hearts','stars'].includes(pattern)?'wallpaper-drift':'none');
   }
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],themeId);
   if(themeId==='neon-red-heat'){assert.deepEqual(await page.evaluate(()=>['base','glow','pattern'].map(key=>document.documentElement.style.getPropertyValue('--theme-'+key))),['#000000','#ff0000','#ff0000']);await page.screenshot({path:'artifacts/valor-neon-red-menu.png',fullPage:true});}
  }
  await page.evaluate(async()=>{const path='/theme.js',background='/backgrounds.js';(await import(path)).applyTheme('soft-baby-pink');(await import(background)).applyBackground('hearts');});
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [390,820,1536]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'artifacts/valor-pastel-menu-'+width+'.png',fullPage:true});
   await style();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
   await page.screenshot({path:'artifacts/valor-style-'+width+'.png'});
   await page.getByRole('button',{name:'Done',exact:true}).click();
  }
  for(const pattern of ['stars','checkerboard','leopard']){
   await page.evaluate(async pattern=>{const path='/backgrounds.js';(await import(path)).applyBackground(pattern);},pattern);
   await page.screenshot({path:'artifacts/valor-background-'+pattern+'.png',fullPage:true});
  }
  await page.evaluate(async()=>{const path='/theme.js';(await import(path)).applyAccessibilityMode('emergency');});
  assert.equal(await page.locator('#valor-wallpaper').isVisible(),false);assert.equal(await page.locator('html').getAttribute('data-background'),'leopard');
  await page.evaluate(async()=>{const path='/theme.js';(await import(path)).applyAccessibilityMode('theme');});
  assert.equal(await page.locator('#valor-wallpaper').isVisible(),true);
  await page.emulateMedia({forcedColors:'active'});assert.equal(await page.locator('#valor-wallpaper').isVisible(),false);await page.emulateMedia({forcedColors:'none'});
  await page.evaluate(()=>localStorage.setItem('valor.background','unexpected-value'));await page.reload();await page.getByRole('heading',{name:'VALOR',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('data-background'),'hearts');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  assert.equal(await page.evaluate(async()=>Boolean(await caches.match('/backgrounds.js'))),true);
  assert.equal(await page.evaluate(async()=>Boolean(await caches.match('/app'))),true);
  assert.equal(await page.evaluate(async()=>Boolean(await caches.match('/city-guide.js'))),true);
  await context.setOffline(true);await page.reload();await page.getByRole('button',{name:'Customize style'}).click();await page.getByRole('button',{name:'Stars',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-background'),'stars');await context.setOffline(false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.close();}
});
