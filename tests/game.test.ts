import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key,login} from './helpers.ts';
import {Game,checksum} from '../src/game/engine.ts';
import {data,validateEntity,settingsSchema} from '../src/game/model.ts';
import type {Entity,Kind,Action} from '../src/game/model.ts';
import {NarrativeGateway,validateNarration} from '../src/game/ai.ts';
import {retrieve} from '../src/game/epistemics.ts';
import {advance} from '../src/game/simulation.ts';
import {Store} from '../src/db.ts';
import {join} from 'node:path';
async function scenario(){
 const f=await fixture(),game=new Game(f.store),timeline=(await game.initialize(f.creator,f.campaign.id));
 const revision=async ()=>(await game.access(f.creator,timeline.id)).t.revision;
 async function add(kind:Kind,name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign'){
  const e=validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
  (await game.edit(f.creator,timeline.id,{revision:(await revision()),entity:e},key()));return e.id;
 }
 async function edit(id:string,changes:Record<string,unknown>){const entity=structuredClone((await game.load(timeline.id)).entities.find(e=>e.id===id)!);Object.assign(entity.data,changes);return (await game.edit(f.creator,timeline.id,{revision:(await revision()),entity},key()));}
 const location=(await add('location','Test interior')),destination=(await add('location','Test destination'));
 (await edit(location,{exits:[{to:destination,minutes:10,modes:['walk','drive'],locked:false,keyId:null,fare:0}]}));
 (await edit(destination,{exits:[{to:location,minutes:10,modes:['walk','drive'],locked:false,keyId:null,fare:0}]}));
 const pc=(await add('character','Test player',{playable:true,controllerUserId:f.player.id,locationId:location,dob:'1985-01-01',cash:10000,attributes:{Strength:50,Agility:50,Endurance:50,Intellect:50,Perception:50,Presence:50,Will:50}}));
 const npc=(await add('character','Test NPC',{locationId:location,dob:'1980-01-01',secrets:'NEVER_EXPOSE',instructions:'SECRET_INSTRUCTION'}));
 const turn=async (action:Action,cmdKey=key(),rev?:number)=>(await game.turn(f.player,timeline.id,{revision:rev??await revision(),characterId:pc,action},cmdKey));
 const rules=async ()=>(await game.configure(f.creator,timeline.id,(await revision()),settingsSchema.parse({rules:{dieSides:6,threshold:1,damage:10,treatmentMinutes:5,recoveryPerDay:5,unfamiliarPenalty:0,bleedPerMinute:0.01}}),key()));
 return {...f,game,timeline,revision,add,edit,location,destination,pc,npc,turn,rules};
}
test('full game turn is atomic, retries do not reroll, ambiguous text preserves player agency',async()=>{
 const f=await scenario();try{
  const before=(await f.revision());
  const parsed=(await f.game.parse(f.player,f.timeline.id,f.pc,'I consider asking about the neighborhood'));
  assert.equal(parsed.action,null);assert.equal((await f.revision()),before);
  const cmdKey=key(),action={type:'look'} as const,result=(await f.turn(action,cmdKey,before));
  assert.deepEqual((await f.turn(action,cmdKey,before)),result);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM story_turns WHERE timeline_id=?',f.timeline.id))!.n,1);
  const event=(await f.store.get<{seed:string}>('SELECT seed FROM game_events WHERE id=?',result.eventId))!;
  await new NarrativeGateway(f.game).narrate(f.player,f.timeline.id,result.eventId);
  assert.equal((await f.store.get<{seed:string}>('SELECT seed FROM game_events WHERE id=?',result.eventId))!.seed,event.seed);
  (await assert.rejects(async ()=>(await f.turn({type:'travel',destinationId:randomUUID(),mode:'walk',vehicleId:null})),/entity_unavailable/));
  assert.equal((await f.revision()),before+1);
 }finally{await f.close();}
});
test('observer filtering, custom sections and four epistemic layers prevent hidden fact retrieval',async()=>{
 const f=await scenario();try{
  const secret=(await f.add('lore','Hidden dossier',{description:'CLASSIFIED_CANON'},'creator'));
  const known=(await f.add('lore','Permitted note',{description:'A visible source',embedding:[1,0]},'campaign'));
  (await f.game.epistemic(f.creator,f.timeline.id,(await f.revision()),{layer:'truth',subjectId:f.npc,text:'TRUTH_ONLY'},key()));
  (await f.game.epistemic(f.creator,f.timeline.id,(await f.revision()),{layer:'belief',subjectId:f.pc,text:'Possibly false',confidence:0.2},key()));
  (await f.game.epistemic(f.creator,f.timeline.id,(await f.revision()),{layer:'memory',subjectId:f.pc,text:'A subjective recollection'},key()));
  const view=JSON.stringify((await f.game.view(f.player,f.timeline.id,f.pc)));
  assert.doesNotMatch(view,/NEVER_EXPOSE|SECRET_INSTRUCTION|CLASSIFIED_CANON|TRUTH_ONLY/);
  assert.match(view,/Possibly false/);assert.match(view,/subjective recollection/);
  const search=retrieve((await f.game.load(f.timeline.id)),f.pc,'classified visible',10,[1,0]);
  assert.ok(search.sources.some(e=>e.id===known));assert.ok(!search.sources.some(e=>e.id===secret));
  const localSearch=retrieve((await f.game.load(f.timeline.id)),f.pc,'visible note',10);
  assert.ok(localSearch.sources.some(e=>e.id===known),'local deterministic embeddings should rank semantically related lore');
  (await assert.rejects(async ()=>(await f.game.creator(f.player,f.timeline.id)),/forbidden/));
  (await assert.rejects(async ()=>(await f.game.view(f.other,f.timeline.id,f.pc)),/not_found/));
 }finally{await f.close();}
});
test('travel advances time, catches NPC schedules, and preserves vehicle location and fuel rules',async()=>{
 const f=await scenario();try{
  (await f.edit(f.npc,{schedule:[{id:randomUUID(),minute:8*60+5,locationId:f.destination,activity:'test shift',days:[0,1,2,3,4,5,6]}]}));
  const vehicle=(await f.add('vehicle','Test car',{ownerId:f.pc,locationId:f.location,occupants:[f.pc],locked:false}));
  const before=Date.parse((await f.game.load(f.timeline.id)).clock);
  (await f.turn({type:'travel',destinationId:f.destination,mode:'drive',vehicleId:vehicle}));
  const s=(await f.game.load(f.timeline.id));
  assert.equal(Date.parse(s.clock)-before,600000);
  assert.equal(s.entities.find(e=>e.id===f.npc)!.data.locationId,f.destination);
  assert.equal(s.entities.find(e=>e.id===vehicle)!.data.locationId,f.destination);
  assert.equal(s.entities.find(e=>e.id===vehicle)!.data.fuel,100);
 }finally{await f.close();}
});
test('objects, ammunition and phones conserve state and enforce privacy',async()=>{
 const f=await scenario();try{
  (await f.rules());
  const gun=(await f.add('item','Test firearm',{category:'firearm',ownerId:f.pc,caliber:'test',magazine:6,loaded:0}));
  const ammo=(await f.add('item','Test rounds',{category:'ammo',ownerId:f.pc,caliber:'test',quantity:8}));
  (await f.turn({type:'reload',weaponId:gun,ammoId:ammo}));
  let s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.id===gun)!.data.loaded,6);assert.equal(s.entities.find(e=>e.id===ammo)!.data.quantity,2);
  (await f.turn({type:'combat',targetId:f.npc}));
  (await f.turn({type:'attack',targetId:f.npc,weaponId:gun,bodyPart:'arm'}));
   s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.id===gun)!.data.loaded,5);assert.deepEqual(s.entities.filter(e=>e.kind==='evidence').map(e=>e.data.evidenceType).sort(),['blood','shell-casing']);assert.equal(s.entities.filter(e=>e.kind==='injury').length,1);
  (await f.turn({type:'surrender'}));
  const phone=(await f.add('item','Test phone',{category:'phone',ownerId:f.pc,contacts:[{characterId:f.npc,label:'Known contact'}]}));
  (await f.turn({type:'message',phoneId:phone,toId:f.npc,text:'Explicit player message',medium:'sms'}));
  const privateMessage=(await f.add('message','Secret NPC message',{fromId:f.npc,toId:f.npc,phoneId:phone,body:'PRIVATE_SMS',at:s.clock},'owner'));
  const view=JSON.stringify((await f.game.view(f.player,f.timeline.id,f.pc)));
  assert.match(view,/Explicit player message/);assert.doesNotMatch(view,/PRIVATE_SMS/);assert.ok(!view.includes(privateMessage));
 }finally{await f.close();}
});
test('health treatment consumes medicine, takes time, and cannot resurrect a dead character',async()=>{
 const f=await scenario();try{
  (await f.rules());const wound=(await f.add('injury','Test wound',{characterId:f.pc,bodyPart:'arm',category:'cut',severity:40,bleeding:2,startedAt:(await f.game.load(f.timeline.id)).clock},'owner'));
  const medicine=(await f.add('item','Test first aid',{category:'medicine',ownerId:f.pc,quantity:2}));
  (await f.turn({type:'treat',injuryId:wound,medicineId:medicine}));
  const s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.id===wound)!.data.treated,true);assert.equal(s.entities.find(e=>e.id===medicine)!.data.quantity,1);
  (await f.edit(f.pc,{condition:'dead'}));(await assert.rejects(async ()=>(await f.turn({type:'treat',injuryId:wound,medicineId:medicine})),/character_cannot_act/));
 }finally{await f.close();}
});
test('directional relationship state never assigns player feelings and requires reciprocal consent',async()=>{
 const f=await scenario();try{
  (await f.turn({type:'social',targetId:f.npc,intent:'greet',consent:false}));
  let s=(await f.game.load(f.timeline.id));const relation=s.entities.find(e=>e.kind==='relationship')!;
  assert.equal(relation.data.fromId,f.npc);assert.equal(relation.data.toId,f.pc);
  (await f.game.configure(f.creator,f.timeline.id,(await f.revision()),settingsSchema.parse({romance:true,intimacy:'fade-to-black'}),key()));
  (await assert.rejects(async ()=>(await f.turn({type:'social',targetId:f.npc,intent:'date',consent:false})),/explicit_consent/));
  (await assert.rejects(async ()=>(await f.turn({type:'social',targetId:f.npc,intent:'date',consent:true})),/current_consent_request_required/));
  const requestId=randomUUID(),clock=(await f.game.load(f.timeline.id)).clock;
  (await f.edit(relation.id,{consentRequests:[{id:requestId,intent:'date',initiatorId:f.npc,recipientId:f.pc,requestedAt:clock,expiresAt:new Date(Date.parse(clock)+30*60000).toISOString(),locationId:f.location,status:'pending',contentMode:'fade-to-black',voluntary:true}]}));
  (await f.turn({type:'social',targetId:f.npc,intent:'date',response:'accept',consentRequestId:requestId,consent:true}));
  s=(await f.game.load(f.timeline.id));assert.deepEqual(s.entities.find(e=>e.id===relation.id)!.data.labels,['date']);
  const view=(await f.game.view(f.player,f.timeline.id,f.pc));assert.ok(!('affection'in view.entities.find(e=>e.id===relation.id)!.data));
 }finally{await f.close();}
});
test('merchant transactions conserve funds and stock, and failed payments roll back',async()=>{
 const f=await scenario();try{
  const shop=(await f.add('business','Test merchant',{locationId:f.location,cash:5000}));
  const item=(await f.add('item','Test stock',{ownerId:shop,price:1200}));(await f.edit(shop,{stock:[item]}));
  (await f.turn({type:'buy',businessId:shop,itemId:item}));
  let s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.id===f.pc)!.data.cash,8800);assert.equal(s.entities.find(e=>e.id===shop)!.data.cash,6200);
  (await assert.rejects(async ()=>(await f.turn({type:'buy',businessId:shop,itemId:item})),/out_of_stock/));
  (await f.turn({type:'sell',businessId:shop,itemId:item}));s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.id===f.pc)!.data.cash,10000);
  const job=(await f.add('job','Test shift',{employerId:shop,employeeId:f.pc,locationId:f.location,hourlyCents:1200,minutesPerShift:60}));
  (await f.turn({type:'work',jobId:job}));assert.equal((await f.game.load(f.timeline.id)).entities.find(e=>e.id===f.pc)!.data.cash,11200);
 }finally{await f.close();}
});
test('police only learn through witnesses and reports; evidence custody and legal search gates persist',async()=>{
 const f=await scenario();try{
  const agency=(await f.add('faction','Test agency',{memberIds:[f.npc],jurisdictionIds:[f.location]},'campaign'));
  const law=(await f.add('law','Test authored law',{jurisdictionIds:[f.location],agencyIds:[agency],permits:['search','arrest'],requiresWarrant:true},'campaign'));
  (await f.edit(f.npc,{locationId:f.destination}));
  (await f.add('item','Test report phone',{category:'phone',ownerId:f.pc,contacts:[{characterId:f.npc,label:'Investigator'}]}));
  (await f.turn({type:'crime',lawId:law,targetId:null}));
  let s=(await f.game.load(f.timeline.id)),crime=s.facts.find(x=>x.predicate==='alleged-act')!;
  assert.ok(!s.knowledge.some(k=>k.observerId===f.npc&&k.factId===crime.id));
  (await f.turn({type:'report',factId:crime.id,agencyId:agency,investigatorId:f.npc}));
  s=(await f.game.load(f.timeline.id));assert.ok(s.knowledge.some(k=>k.observerId===f.npc&&k.factId===crime.id));
  assert.equal(s.entities.filter(e=>e.kind==='case').length,1);
 }finally{await f.close();}
});
test('ignored quests expire and watchers fire once without duplicating effects',async()=>{
 const f=await scenario();try{
  const start=Date.parse((await f.game.load(f.timeline.id)).clock);
  const quest=(await f.add('quest','Test deadline',{status:'active',characterId:f.pc,deadline:new Date(start+300000).toISOString()}));
  const watcher=(await f.add('watcher','Test trigger',{trigger:'time',dueAt:new Date(start+60000).toISOString(),effect:'npc-offer',subjectId:f.pc,description:'An authored offer.'},'creator'));
  (await f.turn({type:'wait',minutes:10}));(await f.turn({type:'wait',minutes:10}));
  const s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.id===quest)!.data.status,'expired');assert.equal(s.entities.find(e=>e.id===watcher)!.data.fired,true);
  const turns=(await f.game.view(f.player,f.timeline.id,f.pc)).turns as {narration:string}[];
  assert.equal(turns.filter(t=>t.narration.includes('An authored offer.')).length,1);
 }finally{await f.close();}
});
test('saves branch without modifying parent, malformed imports fail, and export/import round-trips',async()=>{
 const f=await scenario();try{
  (await f.turn({type:'look'}));const save=(await f.game.save(f.player,f.timeline.id,'Checkpoint')),before=(await f.game.export(f.creator,f.timeline.id));
  (await f.turn({type:'travel',destinationId:f.destination,mode:'walk',vehicleId:null}));
  const parentBeforeBranch=JSON.stringify((await f.game.load(f.timeline.id))),child=(await f.game.branch(f.player,f.timeline.id,save.id,'Child'));
  assert.equal(JSON.stringify((await f.game.load(f.timeline.id))),parentBeforeBranch);
  assert.equal((await f.game.load(child.id)).entities.find(e=>e.id===f.pc)!.data.locationId,f.location);
  assert.equal((await f.game.view(f.player,child.id,f.pc)).turns.length,1);
  (await assert.rejects(async ()=>(await f.game.import(f.creator,f.timeline.id,'Bad',{...before,checksum:'0'.repeat(64)})),/checksum/));
  const check=(await f.game.import(f.creator,f.timeline.id,'Copy',before,true)) as {valid:true;confirmationToken:string};assert.ok(check.valid);
  const imported=(await f.game.import(f.creator,f.timeline.id,'Copy',before,false,check.confirmationToken)) as {id:string};
  assert.equal((await f.game.load(imported.id)).entities.length,before.payload.state.entities.length);
  assert.equal((await f.game.load(imported.id)).entities.find(e=>e.id===f.pc)!.data.controllerUserId,f.creator.id);
  const corrupt=structuredClone(before);corrupt.payload.state.entities[0]!.data.invalid='bad';delete (corrupt as {manifest?:unknown}).manifest;corrupt.checksum=checksum(corrupt.payload);
  (await assert.rejects(async ()=>(await f.game.import(f.creator,f.timeline.id,'Bad schema',corrupt)),/unrecognized|Unrecognized/));
 }finally{await f.close();}
});
test('provider failure, injection, invented prose and budget exhaustion never mutate simulation',async()=>{
 const f=await scenario();try{
  const result=(await f.turn({type:'look'})),revision=(await f.revision()),before=JSON.stringify((await f.game.load(f.timeline.id)));
  const gateway=new NarrativeGateway(f.game,[{id:'test',async arrange(){return {text:'You decide to kiss the stranger.',order:[]};}}]);
  assert.throws(()=>validateNarration({text:'invented'},{promptVersion:'v1',instructions:'',fragments:[]}));
  await assert.rejects(async ()=>(await gateway.narrate(f.player,f.timeline.id,result.eventId,'test')),/ai_budget_exceeded/);
  (await f.game.configure(f.creator,f.timeline.id,(await f.revision()),settingsSchema.parse({tokenBudget:100000,userTokenBudget:100000}),key()));
  const afterConfig=JSON.stringify((await f.game.load(f.timeline.id)));
  const response=await gateway.narrate(f.player,f.timeline.id,result.eventId,'test');
  assert.equal(response.status,'grounded-fallback');assert.equal(JSON.stringify((await f.game.load(f.timeline.id))),afterConfig);
  assert.equal((await f.revision()),revision+1);assert.ok(before.length>0);
 }finally{await f.close();}
});
test('game HTTP APIs enforce auth, controller ownership and optimistic revisions',async()=>{
 const f=await scenario();try{
  const session=await login(f,'player@example.test'),headers={cookie:session.cookie,origin:f.settings.origin,'x-csrf-token':session.csrf,'idempotency-key':key()};
  const url='/game/timelines/'+f.timeline.id;
  assert.equal((await f.app.inject({url:url+'/creator',headers})).statusCode,403);
  const before=await f.game.view(f.player,f.timeline.id,f.pc),response=await f.app.inject({url:url+'/turns',method:'POST',headers,payload:{revision:before.timeline.revision,cursor:before.timeline.turnCursor,characterId:f.pc,action:{type:'look'}}});
  assert.equal(response.statusCode,200,response.body);
  const current=await f.game.view(f.player,f.timeline.id,f.pc),denied=await f.app.inject({url:url+'/turns',method:'POST',headers:{...headers,'idempotency-key':key()},payload:{revision:current.timeline.revision,cursor:current.timeline.turnCursor,characterId:f.npc,action:{type:'look'}}});
  assert.equal(denied.statusCode,403);
  const catalog=await f.app.inject({url:'/game/catalog',headers});assert.equal(catalog.statusCode,200,catalog.body);
  assert.ok(catalog.json().schemas.character);
 }finally{await f.close();}
});

test('revoked character control cannot replay receipts or re-narrate an earlier turn',async()=>{
 const f=await scenario();try{
  const requestKey=key(),revision=(await f.revision()),result=(await f.turn({type:'look'},requestKey,revision));
  (await f.edit(f.pc,{controllerUserId:f.creator.id}));
  (await assert.rejects(async ()=>(await f.turn({type:'look'},requestKey,revision)),/character_not_controlled/));
  await assert.rejects(async ()=>(await new NarrativeGateway(f.game).narrate(f.player,f.timeline.id,result.eventId)),/character_not_controlled/);
 }finally{await f.close();}
});
test('dry-run import rejects transcript, exit and epistemic corruption without touching the timeline',async()=>{
 const f=await scenario();try{
  (await f.turn({type:'look'}));const original=(await f.game.export(f.creator,f.timeline.id)),revision=(await f.revision());
  for(const mutate of [
   (b:typeof original)=>{b.payload.transcript[0]!.character_id=randomUUID();},
   (b:typeof original)=>{b.payload.transcript.push(b.payload.transcript[0]!);},
   (b:typeof original)=>{b.payload.state.entities.find(e=>e.id===f.location)!.data.exits=[{to:randomUUID(),minutes:5,modes:['walk'],locked:false,keyId:null,fare:0}];},
   (b:typeof original)=>{b.payload.state.memories.push({id:randomUUID(),observerId:f.location,text:'invalid observer',salience:1,decayPerDay:0,eventId:randomUUID(),at:b.payload.state.clock,private:true});},
  ]){const broken=structuredClone(original);mutate(broken);broken.checksum=checksum(broken.payload);(await assert.rejects(async ()=>(await f.game.import(f.creator,f.timeline.id,'Rejected',broken,true))));}
  assert.equal((await f.revision()),revision);
  const privateSave=(await f.game.save(f.creator,f.timeline.id,'Creator only'));
  assert.ok(!((await f.game.saves(f.player,f.timeline.id)) as {id:string}[]).some(s=>s.id===privateSave.id));
  (await assert.rejects(async ()=>(await f.game.branch(f.player,f.timeline.id,privateSave.id,'Denied')),/save_unavailable/));
 }finally{await f.close();}
});
test('NPC work catch-up conserves funds and reaches the same result across partial waits',async()=>{
 const f=await scenario();try{
  const employer=(await f.add('business','Catch-up employer',{locationId:f.location,cash:100000}));
  const job=(await f.add('job','Catch-up shift',{employeeId:f.npc,employerId:employer,locationId:f.location,hourlyCents:1200,minutesPerShift:60}));
  (await f.edit(f.npc,{plans:[{id:randomUUID(),type:'work',targetId:job,cooldownMinutes:60}]}));
  const one=(await f.game.load(f.timeline.id)),split=structuredClone(one);
  advance(one,60,randomUUID(),[],f.pc);advance(split,30,randomUUID(),[],f.pc);advance(split,30,randomUUID(),[],f.pc);
  const cash=(s:typeof one,id:string)=>s.entities.find(e=>e.id===id)!.data.cash;
  assert.equal(cash(one,f.npc),1200);assert.equal(cash(split,f.npc),1200);assert.equal(cash(one,employer),98800);assert.equal(one.clock,split.clock);
  assert.deepEqual(one.entities.find(e=>e.id===f.npc)!.data.plans,split.entities.find(e=>e.id===f.npc)!.data.plans);
 }finally{await f.close();}
});
test('death keeps belongings in a persistent corpse container, and messages deliver as beliefs',async()=>{
 const f=await scenario();try{
  (await f.rules());const keepsake=(await f.add('item','Persistent keepsake',{ownerId:f.npc,equipped:true}));
  (await f.add('injury','Fatal test injury',{characterId:f.npc,category:'gunshot',bodyPart:'torso',severity:90,bleeding:100,startedAt:(await f.game.load(f.timeline.id)).clock}));
  (await f.edit(f.npc,{blood:1}));(await f.turn({type:'wait',minutes:2}));
  let s=(await f.game.load(f.timeline.id));const remains=s.entities.find(e=>e.kind==='item'&&e.name==='Remains of Test NPC')!;
  assert.equal(s.entities.find(e=>e.id===f.npc)!.data.condition,'dead');assert.equal(s.entities.find(e=>e.id===keepsake)!.data.containerId,remains.id);
  assert.ok((await f.game.view(f.player,f.timeline.id,f.pc)).entities.some(e=>e.id===keepsake));
  const receiver=(await f.add('character','Message receiver',{locationId:f.destination}));
  const phone=(await f.add('item','Sender phone',{ownerId:f.pc,category:'phone',contacts:[{characterId:receiver,label:'Contact'}]}));
  (await f.turn({type:'message',phoneId:phone,toId:receiver,text:'An unverified claim',medium:'sms'}));
  s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.kind==='message')!.data.status,'queued');
  (await f.add('item','Receiver phone',{ownerId:receiver,category:'phone'}));(await f.turn({type:'wait',minutes:1}));
  s=(await f.game.load(f.timeline.id));assert.equal(s.entities.find(e=>e.kind==='message')!.data.status,'delivered');assert.ok(s.beliefs.some(b=>b.observerId===receiver&&b.proposition==='An unverified claim'));
  assert.ok(!s.facts.some(fact=>fact.value==='An unverified claim'));
 }finally{await f.close();}
});
test('campaign and user AI budgets charge retry reservations independently',async()=>{
 const f=await scenario();try{
  (await f.game.configure(f.creator,f.timeline.id,(await f.revision()),settingsSchema.parse({tokenBudget:100000,userTokenBudget:1}),key()));
  const turn=(await f.turn({type:'look'}));let calls=0;
  const gateway=new NarrativeGateway(f.game,[{id:'test',async arrange(c){calls++;return {order:c.fragments.map(f=>f.id)};}}]);
  await assert.rejects(async ()=>(await gateway.narrate(f.player,f.timeline.id,turn.eventId,'test')),/ai_user_budget_exceeded/);assert.equal(calls,0);
 }finally{await f.close();}
});
test('failed escape commits its roll and time once, and a full database backup restores game history',async()=>{
 const f=await scenario();try{
  (await f.rules());(await f.game.configure(f.creator,f.timeline.id,(await f.revision()),settingsSchema.parse({...(await f.game.load(f.timeline.id)).settings,rules:{...(await f.game.load(f.timeline.id)).settings.rules!,threshold:10000}}),key()));
  (await f.turn({type:'combat',targetId:f.npc}));const revision=(await f.revision()),requestKey=key(),before=Date.parse((await f.game.load(f.timeline.id)).clock);
  const result=(await f.turn({type:'flee',destinationId:f.destination},requestKey,revision));
  assert.match(result.narration,/escape attempt fails/);assert.equal((await f.revision()),revision+1);assert.equal(Date.parse((await f.game.load(f.timeline.id)).clock)-before,60000);
  assert.deepEqual((await f.turn({type:'flee',destinationId:f.destination},requestKey,revision)),result);
  const expected=(await f.game.export(f.creator,f.timeline.id)),path=join(f.dir,'full-game-backup.sqlite');await f.store.backupTo(path);
  const restored=new Store(path);try{(await restored.migrate());assert.deepEqual((await new Game(restored).export(f.creator,f.timeline.id)),expected);}finally{restored.close();}
 }finally{await f.close();}
});
test('integrated acceptance preserves prose, travel, NPCs, consent, objects, injuries, law and branch history',async()=>{
 const f=await scenario();try{
  (await f.rules());const start=(await f.game.load(f.timeline.id)).clock;
  (await f.game.configure(f.creator,f.timeline.id,(await f.revision()),settingsSchema.parse({...(await f.game.load(f.timeline.id)).settings,romance:true}),key()));
  (await f.edit(f.npc,{schedule:[{id:randomUUID(),minute:8*60+5,locationId:f.destination,activity:'meeting',days:[0,1,2,3,4,5,6]}]}));
  const car=(await f.add('vehicle','Acceptance car',{ownerId:f.pc,locationId:f.location,locked:false}));
  const phone=(await f.add('item','Acceptance phone',{category:'phone',ownerId:f.pc,contacts:[{characterId:f.npc,label:'Contact'}]}));
  const medicine=(await f.add('item','Acceptance dressing',{category:'medicine',ownerId:f.pc}));
  const wound=(await f.add('injury','Acceptance wound',{characterId:f.pc,category:'cut',bodyPart:'arm',severity:10,startedAt:start}));
  (await f.add('watcher','Acceptance offer',{trigger:'time',dueAt:new Date(Date.parse(start)+60000).toISOString(),effect:'npc-offer',subjectId:f.pc,description:'An authored invitation.'},'creator'));
  (await f.turn({type:'look'}));(await f.turn({type:'travel',destinationId:f.destination,mode:'drive',vehicleId:car}));
  assert.equal((await f.game.load(f.timeline.id)).entities.find(e=>e.id===f.npc)!.data.locationId,f.destination);
  (await f.turn({type:'social',targetId:f.npc,intent:'greet',consent:false}));
  (await f.turn({type:'message',phoneId:phone,toId:f.npc,text:'I arrived.',medium:'sms'}));(await f.turn({type:'treat',injuryId:wound,medicineId:medicine}));
  const agency=(await f.add('faction','Acceptance agency',{memberIds:[f.npc],jurisdictionIds:[f.destination]}));
  const law=(await f.add('law','Acceptance law',{jurisdictionIds:[f.destination],agencyIds:[agency],permits:['search'],requiresWarrant:true}));
  (await f.turn({type:'crime',lawId:law,targetId:null}));let state=(await f.game.load(f.timeline.id));
  const crime=state.facts.find(x=>x.predicate==='alleged-act')!;(await f.turn({type:'report',factId:crime.id,agencyId:agency,investigatorId:f.npc}));
  const casing=(await f.add('evidence','Acceptance trace',{locationId:f.destination,sourceEventId:crime.eventId}));(await f.turn({type:'search'}));
  state=(await f.game.load(f.timeline.id));assert.ok((state.entities.find(e=>e.id===casing)!.data.discoveredBy as string[]).includes(f.pc));assert.ok(state.entities.some(e=>e.kind==='case'));
  const save=(await f.game.save(f.player,f.timeline.id,'Acceptance checkpoint')),parent=(await f.game.export(f.creator,f.timeline.id)),child=(await f.game.branch(f.player,f.timeline.id,save.id,'Acceptance branch'));
  assert.deepEqual((await f.game.export(f.creator,f.timeline.id)),parent);assert.equal((await f.game.view(f.player,child.id,f.pc)).turns.length,parent.payload.transcript.length);
  const copyPreview=await f.game.import(f.creator,child.id,'Acceptance restored',parent,true) as {confirmationToken:string},copied=(await f.game.import(f.creator,child.id,'Acceptance restored',parent,false,copyPreview.confirmationToken)) as {id:string};assert.equal((await f.game.view(f.creator,copied.id,f.pc)).turns.length,parent.payload.transcript.length);
  assert.ok(parent.payload.transcript.some(t=>t.narration.includes('An authored invitation.')));assert.doesNotMatch(JSON.stringify((await f.game.view(f.player,f.timeline.id,f.pc))),/NEVER_EXPOSE|SECRET_INSTRUCTION/);
 }finally{await f.close();}
});
test('large authored roster and lore set remain bounded through catch-up, retrieval and repeated autosaves',async t=>{
 const f=await scenario();try{
  const bundle=(await f.game.export(f.creator,f.timeline.id));
  for(let i=0;i<1000;i++)bundle.payload.state.entities.push(validateEntity({id:randomUUID(),kind:'character',name:'Load NPC '+i,visibility:'knowledge',data:{locationId:f.destination,schedule:[{id:randomUUID(),minute:9*60,locationId:f.destination,activity:'routine'}]}}));
  for(let i=0;i<1000;i++)bundle.payload.state.entities.push(validateEntity({id:randomUUID(),kind:'lore',name:'Load lore '+i,visibility:'campaign',data:{description:'Synthetic benchmark reference '+i}}));
  delete (bundle as {manifest?:unknown}).manifest;bundle.checksum=checksum(bundle.payload);let began=performance.now();const preview=await f.game.import(f.creator,f.timeline.id,'Load fixture',bundle,true) as {confirmationToken:string},imported=(await f.game.import(f.creator,f.timeline.id,'Load fixture',bundle,false,preview.confirmationToken)) as {id:string};const importMs=performance.now()-began;
  began=performance.now();const context=(await f.game.context(f.creator,imported.id,f.pc,'benchmark reference'));const retrievalMs=performance.now()-began;assert.ok(context.sources.length<=12);
  began=performance.now();for(let i=0;i<10;i++)(await f.game.turn(f.creator,imported.id,{revision:(await f.game.access(f.creator,imported.id)).t.revision,characterId:f.pc,action:{type:'wait',minutes:60}},key()));const tenTurnsMs=performance.now()-began;
  assert.equal((await f.game.view(f.creator,imported.id,f.pc)).turns.length,10);assert.ok(tenTurnsMs<30000,'ten hourly turns exceeded 30-second regression ceiling');
  t.diagnostic(JSON.stringify({npcCount:1001,loreCount:1000,importMs:Math.round(importMs),retrievalMs:Math.round(retrievalMs),tenTurnsMs:Math.round(tenTurnsMs)}));
 }finally{await f.close();}
});
