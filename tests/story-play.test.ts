import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity,data} from '../src/game/model.ts';
import {storyIntent} from '../src/game/story-intent.ts';
import {grantStarterEssentials} from '../src/game/starter-items.ts';
import {NarrativeGateway,validateStoryVoice} from '../src/game/ai.ts';
import {GeminiProvider} from '../src/game/gemini.ts';

test('story mode persists starter essentials once, respects authored equipment and keeps real pickup ownership',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:key(),kind:'location',name:'Apartment',visibility:'campaign',data:{}}),phone=validateEntity({id:key(),kind:'item',name:'Authored phone',visibility:'campaign',data:{category:'phone'}}),loose=validateEntity({id:key(),kind:'item',name:'Notebook',visibility:'campaign',data:{locationId:room.id}});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,phone,loose]},key());
  const definition={character:{name:'Alex',data:{locationId:room.id,homeId:room.id}},grantEntityIds:[phone.id]};
  const pkg=await game.createStartPackage(f.creator,timeline.id,{name:'Arrival',slug:'arrival',kind:'guided',visibility:'campaign',status:'published',definition},key());
  const requestKey=key(),started=await game.start(f.player,timeline.id,{revision:2,packageId:pkg.id},requestKey);
  assert.equal((await game.start(f.player,timeline.id,{revision:2,packageId:pkg.id},requestKey)).eventId,started.eventId);
  let state=await game.load(timeline.id),pc=state.entities.find(e=>e.id===started.characterId)!;
  const owned=state.entities.filter(e=>e.kind==='item'&&e.data.ownerId===pc.id);
  assert.deepEqual(owned.map(e=>e.data.category).sort(),['clothing','key','phone','wallet']);assert.equal(owned.filter(e=>e.data.category==='phone')[0]!.name,'Authored phone');
  assert.equal(grantStarterEssentials(state,pc).length,0);assert.equal((await game.phone(f.player,timeline.id,pc.id)).phones.length,1);
  const auth=await login(f,'player@example.test'),post=async(url:string,payload:Record<string,unknown>)=>f.app.inject({method:'POST',url:'/game/timelines/'+timeline.id+'/'+url,headers:{cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf,'idempotency-key':key()},payload});
  const before=(await game.access(f.player,timeline.id)).t.revision;
  const parsed=await post('story/resolve',{characterId:pc.id,text:'Alex took Notebook.',provider:'grounded'});assert.equal(parsed.statusCode,200);assert.deepEqual(parsed.json().action,{type:'take',itemId:loose.id});assert.equal((await game.access(f.player,timeline.id)).t.revision,before);
  const view=await game.view(f.player,timeline.id,pc.id);
  const turn=await post('turns',{characterId:pc.id,revision:before,cursor:view.timeline.turnCursor,action:parsed.json().action,text:'Alex took Notebook.'});assert.equal(turn.statusCode,200,turn.body);
  assert.ok((await game.inventory(f.player,timeline.id,pc.id,{})).items.some(i=>i.id===loose.id));
  for(const text of ["I didn't attack Alex.",'I take a million dollars.']){const result=await post('story/resolve',{characterId:pc.id,text,provider:'grounded'});assert.equal(result.json().action,null);}
  const story=await post('story/resolve',{characterId:pc.id,text:'Rain tapped against the window.',provider:'grounded'});assert.equal(story.json().action.type,'story');
  const noProvider=await post('story/resolve',{characterId:pc.id,text:'Rain tapped against the window.',provider:'gemini'});assert.equal(noProvider.statusCode,200);assert.equal(noProvider.json().action.type,'story');assert.match(noProvider.json().interpretationWarning,/unavailable/);
  const stateSettings=(await game.load(timeline.id)).settings;stateSettings.tokenBudget=100000;stateSettings.userTokenBudget=100000;await game.configure(f.creator,timeline.id,(await game.access(f.creator,timeline.id)).t.revision,stateSettings,key());
  const openingProvider=new GeminiProvider('test-secret','gemini-3.8-flash',async(_url,options)=>{
   const body=JSON.parse(String(options?.body)),request=JSON.parse(body.contents[0].parts[0].text),fragments=request.context.provenance.filter((p:{source:string})=>p.source==='simulation');
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({paragraphs:[{sourceIds:fragments.map((p:{id:string})=>p.id),text:fragments.map((p:{content:{text:string}})=>p.content.text).join(' ')}]})}]}}],usageMetadata:{promptTokenCount:900,candidatesTokenCount:100}});
  });
  const opening=await new NarrativeGateway(game,[openingProvider]).narrate(f.player,timeline.id,started.eventId,'gemini',undefined,'story');assert.equal(opening.status,'validated','new-life opening: '+JSON.stringify(await f.store.get('SELECT failure_code FROM ai_requests WHERE trace_id=?',opening.traceId)));
  const unauthorized=await post('story/resolve',{characterId:randomUUID(),text:'look',provider:'grounded'});assert.ok(unauthorized.statusCode>=400);
  state=await game.load(timeline.id);pc=state.entities.find(e=>e.id===pc.id)!;const clothing=state.entities.find(e=>e.data.ownerId===pc.id&&e.data.category==='clothing')!;clothing.archived=true;assert.deepEqual(grantStarterEssentials(state,pc),[],'no infinite item replenishment');
 }finally{await f.close();}
});

test('roleplay parser understands enacted prose without treating quotes, guesses or negation as attacks',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const t=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:key(),kind:'location',name:'Room',visibility:'campaign',data:{}}),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:room.id}}),npc=validateEntity({id:key(),kind:'character',name:'Maya',visibility:'campaign',data:{locationId:room.id}});
  await game.bulkEdit(f.creator,t.id,{revision:1,entities:[room,pc,npc]},key());const state=await game.load(t.id);
  for(const text of ['I looked around.','Alex looked around.','Look around'])assert.deepEqual(storyIntent(state,pc.id,text),{type:'look'});
  assert.deepEqual(storyIntent(state,pc.id,'Alex greeted Maya.'),{type:'social',targetId:npc.id,intent:'greet',consent:false});
  assert.deepEqual(storyIntent(state,pc.id,'Alex punched Maya.'),{type:'attack',targetId:npc.id,weaponId:null,bodyPart:'torso'});
  assert.deepEqual(storyIntent(state,pc.id,'Alex said "Hello."'),{type:'say',text:'Hello.'});
  assert.deepEqual(storyIntent(state,pc.id,`Alex said "I don't want to leave."`),{type:'say',text:"I don't want to leave."});
  for(const text of ["I didn't attack Maya.",'I might attack Maya.','I remember punching Maya.','What if I attack Maya?','I attack someone unknown.'])assert.equal(storyIntent(state,pc.id,text),null);
 }finally{await f.close();}
});

test('story narration uses the real Gemini adapter contract within a 2000-token context and keeps mechanics fixed',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const t=await game.initialize(f.creator,f.campaign.id),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id}});
  await game.edit(f.creator,t.id,{revision:1,entity:pc},key());const settings=(await game.load(t.id)).settings;settings.contextTokens=2000;settings.tokenBudget=100000;settings.userTokenBudget=100000;await game.configure(f.creator,t.id,2,settings,key());
  const turn=await game.turn(f.player,t.id,{revision:3,characterId:pc.id,action:{type:'wait',minutes:1},text:'Alex waited a minute.'},key());
  let calls=0;
  const provider=new GeminiProvider('synthetic-test-key','gemini-3.8-flash',async(_url,options)=>{
   calls++;const body=JSON.parse(String(options?.body)),request=JSON.parse(body.contents[0].parts[0].text);
   assert.match(body.systemInstruction.parts[0].text,/PAST-TENSE/);assert.ok(Math.ceil(Buffer.byteLength(JSON.stringify(body))/2)<=2000);
   const fragments=request.context.provenance.filter((p:{source:string})=>p.source==='simulation');
   const sourceIds=fragments.map((p:{id:string})=>p.id);
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({paragraphs:[{sourceIds,text:'Alex waited as the minute passed.'}]})}]}}],usageMetadata:{promptTokenCount:600,candidatesTokenCount:30}});
  });
  const gateway=new NarrativeGateway(game,[provider]),result=await gateway.narrate(f.player,t.id,turn.eventId,'gemini',undefined,'story');
  assert.equal(result.status,'validated');assert.equal(result.narration,'Alex waited as the minute passed.');assert.equal(calls,1);assert.equal((await game.access(f.player,t.id)).t.revision,4);
  const context={promptVersion:'test',instructions:'',fragments:[],protectedIds:[]};
  assert.throws(()=>validateStoryVoice('You waited.',context),/third_person/);assert.throws(()=>validateStoryVoice('Alex is waiting.',context),/past_tense/);validateStoryVoice('Alex waited.',context);
 }finally{await f.close();}
});

test('Gemini health endpoint is authenticated, role checked, and secret-free',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.app.inject({method:'POST',url:'/game/ai/health',headers:{origin:f.settings.origin},payload:{}})).statusCode,401);
  const player=await login(f,'player@example.test'),creator=await login(f);
  const request=(auth:typeof player)=>f.app.inject({method:'POST',url:'/game/ai/health',headers:{origin:f.settings.origin,cookie:auth.cookie,'x-csrf-token':auth.csrf},payload:{}});
  assert.equal((await request(player)).statusCode,403);assert.deepEqual((await request(creator)).json(),{status:'unconfigured',provider:'gemini'});
 }finally{await f.close();}
});
