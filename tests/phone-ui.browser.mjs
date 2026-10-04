import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><html lang="en"><head><title>VALOR phone test</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/play-ui.css"></head><body></body></html>');}
 if(!/^\/[a-z0-9-]+\.(?:js|css|png)$/.test(path)){res.statusCode=404;return res.end();}
 try{const content=await readFile(new URL('../public'+path,import.meta.url));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'image/png');res.end(content);}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {nativePhoneApp}=await import('/phone-apps.js'),{phoneOverlay}=await import('/play-ui.js'),{applyTheme}=await import('/theme.js');applyTheme('soft-baby-pink');
  const $=(tag,attrs={},...children)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k.startsWith('on'))e.addEventListener(k.slice(2).toLowerCase(),v);else if(k==='class')e.className=v;else if(k==='value')e.value=v;else if(v!==false&&v!=null)e.setAttribute(k,v===true?'':v);}for(const c of children.flat())if(c!=null)e.append(c instanceof Node?c:document.createTextNode(String(c)));return e;};
  const self={id:'me',kind:'character',name:'Alex Morgan',data:{originNeighborhood:'North Crowns',locationId:'here',condition:'healthy',cash:14550,description:'A new arrival in Valor.',attributes:{strength:40,perception:60},skills:{skill:3},traits:['trait'],healthSummary:{symptoms:'No known symptoms'},residence:{name:'The Sync',apartment:'301'}}};
  const view={clock:'2012-10-03T18:00:00Z',settings:{weather:'rain',needs:false},weather:{actual:'rain',forecast:[{at:'2012-10-03T21:00:00Z',weather:'overcast'}]},entities:[self,{id:'sam',kind:'character',name:'Sam',data:{}},{id:'maya',kind:'character',name:'Maya',data:{}},{id:'here',kind:'location',name:'The Sync',data:{exits:[{to:'street'}]}},{id:'street',kind:'location',name:'North Crowns',data:{description:'A busy street.'}},{id:'skill',kind:'skill',name:'Athletics',data:{description:'Movement and endurance.'}},{id:'trait',kind:'trait',name:'Patient',data:{description:'Takes time to listen.'}},{id:'coat',kind:'item',name:'Coat',data:{ownerId:'me'}},{id:'job',kind:'job',name:'Evening shift',data:{description:'Your next shift.'}}],facts:[{id:'fact',subjectId:'maya',predicate:'phone-number-shared',value:{number:'555-0102'}}],turns:[],journal:[],caseFiles:[],memories:[],beliefs:[]};
  const device={id:'phone',name:'Personal phone',number:'555-0100',apps:Object.fromEntries(['contacts','messages','calls','voicemail','email','photos','gps','social'].map(k=>[k,true])),contacts:[{characterId:'sam',savedName:'Sam',number:'555-0101',favorite:true}],photoIds:[]};
  const phone={clock:view.clock,phones:[device],messages:[{id:'m1',medium:'sms',phoneId:'phone',fromId:'me',toId:'sam',toNumber:'555-0101',body:'Meet me outside?',at:view.clock,status:'delivered'},{id:'m2',medium:'sms',recipientPhoneId:'phone',fromId:'sam',toId:'me',fromNumber:'555-0101',body:'On my way.',at:view.clock,status:'received'},{id:'call',medium:'call',recipientPhoneId:'phone',fromId:'sam',toId:'me',fromNumber:'555-0101',body:'',at:view.clock,status:'received',callState:'ringing'}],notifications:[{classification:'learned',text:'A neighborhood meeting was announced.',at:view.clock,target:{kind:'quest',id:'q'}}],socialFeed:[],map:{locations:[],currentLocationId:'here'}};
  const S={page:'Weather',view,character:{id:'me'},user:{id:'u'},timeline:{id:'t',name:'My life'},campaign:{name:'Alex’s life',timezone:'America/Los_Angeles',role:'creator'},catalog:{providers:['grounded','deepinfra']},narrator:'grounded',mode:'player',developerAllowed:true};
  window.phoneState=S;window.phoneActions=[];
  view.locationBrowser={currentLocationId:'here',locations:[{id:'here',name:'The Sync',current:true,open:true,accessible:true,mapPresentation:{x:687,y:1059},routes:[]},{id:'street',name:'North Crowns',open:true,accessible:true,mapPresentation:{x:670,y:1060},routes:[{mode:['walk'],minutes:2,distanceKm:.15,estimated:true,points:[{x:687,y:1059},{x:670,y:1060}]}]}]};
  window.renderStory=async()=>{document.querySelector('dialog')?.remove();const {chronicleSurface}=await import('/play-ui.js');S.online=true;S.page='Chronicle';view.turns=[{id:'one',input_text:'Alex looked around.',narration_status:'validated',narration:'Rain shimmered on the pavement.\n\nPhone call.'},{id:'two',input_text:'Alex took the notebook.',narration_status:'grounded',narration:'Picked up: notebook.',notices:[{label:'Items acquired',detail:'Notebook'}]}];document.body.replaceChildren(chronicleSurface({$,button:(label,fn)=>$('button',{type:'button',onclick:fn},label),S,formatMoment:value=>value,draft:()=>'',saveDraft:()=>{},submit:async text=>{window.submittedText=text;window.submissionCount=(window.submissionCount??0)+1;},rebuild:async(turn,node)=>{window.retriedTurn=turn.id;node.textContent='Alex tucked the notebook away.';},openRoster:()=>{},loadDeathBranch:()=>{},developerCommand:async command=>{window.developerCommand=command;}}));};
  const api=async path=>path.includes('/phone')?phone:path.includes('/inventory')?{items:[{id:'coat',name:'Coat',description:'A warm coat.',category:'clothing',quantity:1,condition:90,wearState:'carried',stackability:{mode:'unique'}}]}:path.includes('/relationships')?{relationships:[],obligations:[],reputations:[]}:path.includes('/saves')?[{id:'s',name:'Checkpoint',created_at:view.clock}]:{};
  const render=async page=>{S.page=page;document.querySelector('dialog')?.remove();const content=await nativePhoneApp({$,S,api,endpoint:suffix=>'/game/timelines/t/'+suffix,act:async action=>window.phoneActions.push(action),run:async fn=>{try{return await fn();}catch(e){window.testFailure=e.message;throw e;}},navigate:render,formatMoment:value=>new Date(value).toLocaleString('en-US'),entityActions:()=>[],openStyle:()=>{},openDeveloperSettings:()=>{},loadBranch:()=>{}});const dialog=phoneOverlay({$,S,content,navigate:render,close:()=>dialog.close()});document.body.append(dialog);dialog.showModal();};window.renderPhone=render;
 });
 const pages=['Weather','News','Messages','Contacts','Phone','Mail','Photos','Social','Character','Health','Inventory','Equipment','Journal / Cases','Jobs / Money','Relationships','Skills / Traits','Vehicles','Map','Lore','Save / Load','Search / Loot','Settings'];
 for(const viewport of [{width:390,height:844},{width:810,height:1080},{width:1280,height:900}]){
  await page.setViewportSize(viewport);
  for(const name of pages){
   await page.evaluate(name=>window.renderPhone(name),name);
   assert.equal(await page.locator('.native-app').getAttribute('data-native-app'),name);
   assert.ok(await page.locator('.pocket-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),name+' overflows at '+viewport.width);
  }
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.renderPhone('Contacts'));
 await page.getByRole('button',{name:'+',exact:true}).click();await page.getByLabel('Known phone number').selectOption('maya');
 await page.getByRole('button',{name:'Save contact',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.phoneActions.at(-1).type),'add-contact');
 assert.equal(await page.evaluate(()=>window.phoneActions.at(-1).contactId),'maya');
 await page.evaluate(()=>window.renderPhone('Messages'));await page.getByRole('button',{name:/Sam On my way/}).click();
 assert.equal(await page.locator('.sms.outgoing').count(),1);assert.equal(await page.locator('.sms.incoming').count(),1);
 await page.getByRole('textbox',{name:'Text message',exact:true}).fill('See you soon.');await page.getByRole('button',{name:'Send',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.phoneActions.at(-1).text),'See you soon.');
 await page.evaluate(()=>window.renderPhone('Phone'));await page.getByRole('button',{name:'Answer',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.phoneActions.at(-1)),{type:'call-response',messageId:'call',phoneId:'phone',response:'answer'});
 await page.evaluate(()=>window.renderPhone('Messages'));
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
 await page.screenshot({path:new URL('../artifacts/phone-messages.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 await page.evaluate(()=>window.renderPhone('Weather'));
 await page.screenshot({path:new URL('../artifacts/phone-weather.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 await page.evaluate(()=>window.renderPhone('News'));
 await page.screenshot({path:new URL('../artifacts/phone-news.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 const themes=await page.evaluate(async()=>Object.keys((await import('/theme.js')).THEMES));
 for(const theme of themes){await page.evaluate(async theme=>{(await import('/theme.js')).applyTheme(theme);},theme);await page.evaluate(()=>window.renderPhone('Weather'));assert.ok(await page.locator('.pocket-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Theme '+theme+' overflow');}
 await page.evaluate(async()=>{(await import('/theme.js')).applyTheme('soft-baby-pink');});
 for(const name of ['Weather','News','Messages','Contacts']){await page.evaluate(name=>window.renderPhone(name),name);assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],name+' accessibility');}
 await page.evaluate(()=>window.renderPhone('Map'));const actionCount=await page.evaluate(()=>window.phoneActions.length);await page.getByLabel('Map destination').selectOption('street');assert.equal(await page.evaluate(()=>window.phoneActions.length),actionCount);await page.getByRole('button',{name:'Zoom +',exact:true}).click();assert.equal(await page.locator('.city-map-layer').evaluate(e=>e.style.width),'150%');assert.equal(await page.locator('.city-route-line').count(),1);await page.getByRole('button',{name:'Travel · Walk',exact:true}).click();assert.equal(await page.evaluate(()=>window.phoneActions.at(-1).destinationId),'street');
 await page.locator('.pocket-content').evaluate(e=>e.scrollTop=0);
 await page.screenshot({path:fileURLToPath(new URL('../artifacts/phone-map.png',import.meta.url))});
 assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],'Map accessibility');
 await page.evaluate(()=>window.renderStory());assert.equal(await page.locator('.story-tools').count(),0);assert.ok(!(await page.locator('.story-text').innerText()).includes('Picked up'));assert.ok(!(await page.locator('.story-text').innerText()).includes('Phone call'));assert.equal(await page.locator('.story-system-log').evaluate(e=>e.open),false);assert.equal(await page.getByText('Action keywords',{exact:true}).count(),1);assert.equal(await page.getByText('Developer test commands',{exact:true}).count(),0);await page.locator('.story-system-log summary').click();assert.ok((await page.locator('.story-system-log').innerText()).includes('Picked up'));await page.getByRole('button',{name:'Retry',exact:true}).click();assert.equal(await page.evaluate(()=>window.retriedTurn),'two');assert.ok((await page.locator('.story-text').innerText()).includes('tucked the notebook'));
 await page.evaluate(()=>{window.phoneState.mode='developer';return window.renderStory();});await page.getByText('Developer test commands',{exact:true}).click();await page.getByRole('button',{name:'/dev combat',exact:true}).click();assert.equal(await page.evaluate(()=>window.developerCommand),'combat');await page.evaluate(()=>{window.phoneState.mode='player';return window.renderStory();});
 await page.getByLabel('Continue the story',{exact:true}).fill('Alex waited beside the window.');await page.evaluate(()=>{window.phoneState.busy=true;setTimeout(()=>{window.phoneState.busy=false;},200);});await page.getByRole('button',{name:'Continue ↗',exact:true}).click();await page.waitForFunction(()=>window.submittedText==='Alex waited beside the window.');assert.equal(await page.evaluate(()=>window.submissionCount),1);
 assert.deepEqual(errors,[]);console.log('PASS: 22 native apps at phone, tablet and desktop sizes; add contact and SMS flows; no horizontal overflow.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
