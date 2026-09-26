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
 const f=await fixture(),game=new Game(f.store),timeline=game.initialize(f.creator,f.campaign.id);
 const revision=()=>game.access(f.creator,timeline.id).t.revision;
 function add(kind:Kind,name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign'){
  const e=validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
  game.edit(f.creator,timeline.id,{revision:revision(),entity:e},key());return e.id;
 }
 function edit(id:string,changes:Record<string,unknown>){const entity=structuredClone(game.load(timeline.id).entities.find(e=>e.id===id)!);Object.assign(entity.data,changes);return game.edit(f.creator,timeline.id,{revision:revision(),entity},key());}
 const location=add('location','Test interior'),destination=add('location','Test destination');
 edit(location,{exits:[{to:destination,minutes:10,modes:['walk','drive'],locked:false,keyId:null,fare:0}]});
 edit(destination,{exits:[{to:location,minutes:10,modes:['walk','drive'],locked:false,keyId:null,fare:0}]});
 const pc=add('character','Test player',{playable:true,controllerUserId:f.player.id,locationId:location,dob:'1985-01-01',cash:10000,attributes:{Strength:50,Agility:50,Endurance:50,Intellect:50,Perception:50,Presence:50,Will:50}});
 const npc=add('character','Test NPC',{locationId:location,dob:'1980-01-01',secrets:'NEVER_EXPOSE',instructions:'SECRET_INSTRUCTION'});
 const turn=(action:Action,cmdKey=key(),rev=revision())=>game.turn(f.player,timeline.id,{revision:rev,characterId:pc,action},cmdKey);
 const rules=()=>game.configure(f.creator,timeline.id,revision(),settingsSchema.parse({rules:{dieSides:6,threshold:1,damage:10,treatmentMinutes:5,recoveryPerDay:5,unfamiliarPenalty:0,bleedPerMinute:0.01}}),key());
 return {...f,game,timeline,revision,add,edit,location,destination,pc,npc,turn,rules};
}
test('full game turn is atomic, retries do not reroll, ambiguous text preserves player agency',async()=>{
 const f=await scenario();try{
  const before=f.revision();
  const parsed=f.game.parse(f.player,f.timeline.id,f.pc,'I consider asking about the neighborhood');
  assert.equal(parsed.action,null);assert.equal(f.revision(),before);
  const cmdKey=key(),action={type:'look'} as const,result=f.turn(action,cmdKey,before);
  assert.deepEqual(f.turn(action,cmdKey,before),result);
  assert.equal(f.store.get<{n:number}>('SELECT count(*) n FROM story_turns WHERE timeline_id=?',f.timeline.id)!.n,1);
  const event=f.store.get<{seed:string}>('SELECT seed FROM game_events WHERE id=?',result.eventId)!;
  await new NarrativeGateway(f.game).narrate(f.player,f.timeline.id,result.eventId);
  assert.equal(f.store.get<{seed:string}>('SELECT seed FROM game_events WHERE id=?',result.eventId)!.seed,event.seed);
  assert.throws(()=>f.turn({type:'travel',destinationId:randomUUID(),mode:'walk',vehicleId:null}),/entity_unavailable/);
  assert.equal(f.revision(),before+1);
 }finally{await f.close();}
});
test('observer filtering, custom sections and four epistemic layers prevent hidden fact retrieval',async()=>{
 const f=await scenario();try{
  const secret=f.add('lore','Hidden dossier',{description:'CLASSIFIED_CANON'},'creator');
  const known=f.add('lore','Permitted note',{description:'A visible source',embedding:[1,0]},'campaign');
  f.game.epistemic(f.creator,f.timeline.id,f.revision(),{layer:'truth',subjectId:f.npc,text:'TRUTH_ONLY'},key());
  f.game.epistemic(f.creator,f.timeline.id,f.revision(),{layer:'belief',subjectId:f.pc,text:'Possibly false',confidence:0.2},key());
  f.game.epistemic(f.creator,f.timeline.id,f.revision(),{layer:'memory',subjectId:f.pc,text:'A subjective recollection'},key());
  const view=JSON.stringify(f.game.view(f.player,f.timeline.id,f.pc));
  assert.doesNotMatch(view,/NEVER_EXPOSE|SECRET_INSTRUCTION|CLASSIFIED_CANON|TRUTH_ONLY/);
  assert.match(view,/Possibly false/);assert.match(view,/subjective recollection/);
  const search=retrieve(f.game.load(f.timeline.id),f.pc,'classified visible',10,[1,0]);
  assert.ok(search.sources.some(e=>e.id===known));assert.ok(!search.sources.some(e=>e.id===secret));
  assert.throws(()=>f.game.creator(f.player,f.timeline.id),/forbidden/);
  assert.throws(()=>f.game.view(f.other,f.timeline.id,f.pc),/not_found/);
 }finally{await f.close();}
});
test('travel advances time, catches NPC schedules, and preserves vehicle location and fuel rules',async()=>{
 const f=await scenario();try{
  f.edit(f.npc,{schedule:[{id:randomUUID(),minute:8*60+5,locationId:f.destination,activity:'test shift',days:[0,1,2,3,4,5,6]}]});
  const vehicle=f.add('vehicle','Test car',{ownerId:f.pc,locationId:f.location,occupants:[f.pc],locked:false});
  const before=Date.parse(f.game.load(f.timeline.id).clock);
  f.turn({type:'travel',destinationId:f.destination,mode:'drive',vehicleId:vehicle});
  const s=f.game.load(f.timeline.id);
  assert.equal(Date.parse(s.clock)-before,600000);
  assert.equal(s.entities.find(e=>e.id===f.npc)!.data.locationId,f.destination);
  assert.equal(s.entities.find(e=>e.id===vehicle)!.data.locationId,f.destination);
  assert.equal(s.entities.find(e=>e.id===vehicle)!.data.fuel,100);
 }finally{await f.close();}
});
test('objects, ammunition and phones conserve state and enforce privacy',async()=>{
 const f=await scenario();try{
  f.rules();
  const gun=f.add('item','Test firearm',{category:'firearm',ownerId:f.pc,caliber:'test',magazine:6,loaded:0});
  const ammo=f.add('item','Test rounds',{category:'ammo',ownerId:f.pc,caliber:'test',quantity:8});
  f.turn({type:'reload',weaponId:gun,ammoId:ammo});
  let s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.id===gun)!.data.loaded,6);assert.equal(s.entities.find(e=>e.id===ammo)!.data.quantity,2);
  f.turn({type:'combat',targetId:f.npc});
  f.turn({type:'attack',targetId:f.npc,weaponId:gun,bodyPart:'arm'});
  s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.id===gun)!.data.loaded,5);assert.equal(s.entities.filter(e=>e.kind==='evidence').length,1);assert.equal(s.entities.filter(e=>e.kind==='injury').length,1);
  f.turn({type:'surrender'});
  const phone=f.add('item','Test phone',{category:'phone',ownerId:f.pc,contacts:[{characterId:f.npc,label:'Known contact'}]});
  f.turn({type:'message',phoneId:phone,toId:f.npc,text:'Explicit player message',medium:'sms'});
  const privateMessage=f.add('message','Secret NPC message',{fromId:f.npc,toId:f.npc,phoneId:phone,body:'PRIVATE_SMS',at:s.clock},'owner');
  const view=JSON.stringify(f.game.view(f.player,f.timeline.id,f.pc));
  assert.match(view,/Explicit player message/);assert.doesNotMatch(view,/PRIVATE_SMS/);assert.ok(!view.includes(privateMessage));
 }finally{await f.close();}
});
test('health treatment consumes medicine, takes time, and cannot resurrect a dead character',async()=>{
 const f=await scenario();try{
  f.rules();const wound=f.add('injury','Test wound',{characterId:f.pc,bodyPart:'arm',category:'cut',severity:40,bleeding:2,startedAt:f.game.load(f.timeline.id).clock},'owner');
  const medicine=f.add('item','Test first aid',{category:'medicine',ownerId:f.pc,quantity:2});
  f.turn({type:'treat',injuryId:wound,medicineId:medicine});
  const s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.id===wound)!.data.treated,true);assert.equal(s.entities.find(e=>e.id===medicine)!.data.quantity,1);
  f.edit(f.pc,{condition:'dead'});assert.throws(()=>f.turn({type:'treat',injuryId:wound,medicineId:medicine}),/character_cannot_act/);
 }finally{await f.close();}
});
test('directional relationship state never assigns player feelings and requires reciprocal consent',async()=>{
 const f=await scenario();try{
  f.turn({type:'social',targetId:f.npc,intent:'greet',consent:false});
  let s=f.game.load(f.timeline.id);const relation=s.entities.find(e=>e.kind==='relationship')!;
  assert.equal(relation.data.fromId,f.npc);assert.equal(relation.data.toId,f.pc);
  f.game.configure(f.creator,f.timeline.id,f.revision(),settingsSchema.parse({romance:true,intimacy:'fade-to-black'}),key());
  assert.throws(()=>f.turn({type:'social',targetId:f.npc,intent:'date',consent:false}),/explicit_consent/);
  assert.throws(()=>f.turn({type:'social',targetId:f.npc,intent:'date',consent:true}),/reciprocal_consent/);
  f.edit(relation.id,{pending:'date'});
  f.turn({type:'social',targetId:f.npc,intent:'date',consent:true});
  s=f.game.load(f.timeline.id);assert.deepEqual(s.entities.find(e=>e.id===relation.id)!.data.labels,['date']);
  const view=f.game.view(f.player,f.timeline.id,f.pc);assert.ok(!('affection'in view.entities.find(e=>e.id===relation.id)!.data));
 }finally{await f.close();}
});
test('merchant transactions conserve funds and stock, and failed payments roll back',async()=>{
 const f=await scenario();try{
  const shop=f.add('business','Test merchant',{locationId:f.location,cash:5000});
  const item=f.add('item','Test stock',{ownerId:shop,price:1200});f.edit(shop,{stock:[item]});
  f.turn({type:'buy',businessId:shop,itemId:item});
  let s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.id===f.pc)!.data.cash,8800);assert.equal(s.entities.find(e=>e.id===shop)!.data.cash,6200);
  assert.throws(()=>f.turn({type:'buy',businessId:shop,itemId:item}),/out_of_stock/);
  f.turn({type:'sell',businessId:shop,itemId:item});s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.id===f.pc)!.data.cash,10000);
  const job=f.add('job','Test shift',{employerId:shop,employeeId:f.pc,locationId:f.location,hourlyCents:1200,minutesPerShift:60});
  f.turn({type:'work',jobId:job});assert.equal(f.game.load(f.timeline.id).entities.find(e=>e.id===f.pc)!.data.cash,11200);
 }finally{await f.close();}
});
test('police only learn through witnesses and reports; evidence custody and legal search gates persist',async()=>{
 const f=await scenario();try{
  const agency=f.add('faction','Test agency',{memberIds:[f.npc],jurisdictionIds:[f.location]},'campaign');
  const law=f.add('law','Test authored law',{jurisdictionIds:[f.location],agencyIds:[agency],permits:['search','arrest'],requiresWarrant:true},'campaign');
  f.edit(f.npc,{locationId:f.destination});
  f.add('item','Test report phone',{category:'phone',ownerId:f.pc,contacts:[{characterId:f.npc,label:'Investigator'}]});
  f.turn({type:'crime',lawId:law,targetId:null});
  let s=f.game.load(f.timeline.id),crime=s.facts.find(x=>x.predicate==='alleged-act')!;
  assert.ok(!s.knowledge.some(k=>k.observerId===f.npc&&k.factId===crime.id));
  f.turn({type:'report',factId:crime.id,agencyId:agency,investigatorId:f.npc});
  s=f.game.load(f.timeline.id);assert.ok(s.knowledge.some(k=>k.observerId===f.npc&&k.factId===crime.id));
  assert.equal(s.entities.filter(e=>e.kind==='case').length,1);
 }finally{await f.close();}
});
test('ignored quests expire and watchers fire once without duplicating effects',async()=>{
 const f=await scenario();try{
  const start=Date.parse(f.game.load(f.timeline.id).clock);
  const quest=f.add('quest','Test deadline',{status:'active',characterId:f.pc,deadline:new Date(start+300000).toISOString()});
  const watcher=f.add('watcher','Test trigger',{trigger:'time',dueAt:new Date(start+60000).toISOString(),effect:'npc-offer',subjectId:f.pc,description:'An authored offer.'},'creator');
  f.turn({type:'wait',minutes:10});f.turn({type:'wait',minutes:10});
  const s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.id===quest)!.data.status,'expired');assert.equal(s.entities.find(e=>e.id===watcher)!.data.fired,true);
  const turns=f.game.view(f.player,f.timeline.id,f.pc).turns as {narration:string}[];
  assert.equal(turns.filter(t=>t.narration.includes('An authored offer.')).length,1);
 }finally{await f.close();}
});
test('saves branch without modifying parent, malformed imports fail, and export/import round-trips',async()=>{
 const f=await scenario();try{
  f.turn({type:'look'});const save=f.game.save(f.player,f.timeline.id,'Checkpoint'),before=f.game.export(f.creator,f.timeline.id);
  f.turn({type:'travel',destinationId:f.destination,mode:'walk',vehicleId:null});
  const parentBeforeBranch=JSON.stringify(f.game.load(f.timeline.id)),child=f.game.branch(f.player,f.timeline.id,save.id,'Child');
  assert.equal(JSON.stringify(f.game.load(f.timeline.id)),parentBeforeBranch);
  assert.equal(f.game.load(child.id).entities.find(e=>e.id===f.pc)!.data.locationId,f.location);
  assert.equal(f.game.view(f.player,child.id,f.pc).turns.length,1);
  assert.throws(()=>f.game.import(f.creator,f.timeline.id,'Bad',{...before,checksum:'0'.repeat(64)}),/checksum/);
  const check=f.game.import(f.creator,f.timeline.id,'Copy',before,true);assert.ok('valid'in check);
  const imported=f.game.import(f.creator,f.timeline.id,'Copy',before,false) as {id:string};
  assert.equal(f.game.load(imported.id).entities.length,before.payload.state.entities.length);
  assert.equal(f.game.load(imported.id).entities.find(e=>e.id===f.pc)!.data.controllerUserId,f.creator.id);
  const corrupt=structuredClone(before);corrupt.payload.state.entities[0]!.data.invalid='bad';corrupt.checksum=checksum(corrupt.payload);
  assert.throws(()=>f.game.import(f.creator,f.timeline.id,'Bad schema',corrupt),/unrecognized|Unrecognized/);
 }finally{await f.close();}
});
test('provider failure, injection, invented prose and budget exhaustion never mutate simulation',async()=>{
 const f=await scenario();try{
  const result=f.turn({type:'look'}),revision=f.revision(),before=JSON.stringify(f.game.load(f.timeline.id));
  const gateway=new NarrativeGateway(f.game,[{id:'test',async arrange(){return {text:'You decide to kiss the stranger.',order:[]};}}]);
  assert.throws(()=>validateNarration({text:'invented'},{promptVersion:'v1',instructions:'',fragments:[]}));
  await assert.rejects(()=>gateway.narrate(f.player,f.timeline.id,result.eventId,'test'),/ai_budget_exceeded/);
  f.game.configure(f.creator,f.timeline.id,f.revision(),settingsSchema.parse({tokenBudget:100000,userTokenBudget:100000}),key());
  const afterConfig=JSON.stringify(f.game.load(f.timeline.id));
  const response=await gateway.narrate(f.player,f.timeline.id,result.eventId,'test');
  assert.equal(response.status,'grounded-fallback');assert.equal(JSON.stringify(f.game.load(f.timeline.id)),afterConfig);
  assert.equal(f.revision(),revision+1);assert.ok(before.length>0);
 }finally{await f.close();}
});
test('game HTTP APIs enforce auth, controller ownership and optimistic revisions',async()=>{
 const f=await scenario();try{
  const session=await login(f,'player@example.test'),headers={cookie:session.cookie,origin:f.settings.origin,'x-csrf-token':session.csrf,'idempotency-key':key()};
  const url='/game/timelines/'+f.timeline.id;
  assert.equal((await f.app.inject({url:url+'/creator',headers})).statusCode,403);
  const response=await f.app.inject({url:url+'/turns',method:'POST',headers,payload:{revision:f.revision(),characterId:f.pc,action:{type:'look'}}});
  assert.equal(response.statusCode,200,response.body);
  const denied=await f.app.inject({url:url+'/turns',method:'POST',headers:{...headers,'idempotency-key':key()},payload:{revision:f.revision(),characterId:f.npc,action:{type:'look'}}});
  assert.equal(denied.statusCode,403);
  const catalog=await f.app.inject({url:'/game/catalog',headers});assert.equal(catalog.statusCode,200,catalog.body);
  assert.ok(catalog.json().schemas.character);
 }finally{await f.close();}
});

test('revoked character control cannot replay receipts or re-narrate an earlier turn',async()=>{
 const f=await scenario();try{
  const requestKey=key(),revision=f.revision(),result=f.turn({type:'look'},requestKey,revision);
  f.edit(f.pc,{controllerUserId:f.creator.id});
  assert.throws(()=>f.turn({type:'look'},requestKey,revision),/character_not_controlled/);
  await assert.rejects(()=>new NarrativeGateway(f.game).narrate(f.player,f.timeline.id,result.eventId),/character_not_controlled/);
 }finally{await f.close();}
});
test('dry-run import rejects transcript, exit and epistemic corruption without touching the timeline',async()=>{
 const f=await scenario();try{
  f.turn({type:'look'});const original=f.game.export(f.creator,f.timeline.id),revision=f.revision();
  for(const mutate of [
   (b:typeof original)=>{b.payload.transcript[0]!.character_id=randomUUID();},
   (b:typeof original)=>{b.payload.transcript.push(b.payload.transcript[0]!);},
   (b:typeof original)=>{b.payload.state.entities.find(e=>e.id===f.location)!.data.exits=[{to:randomUUID(),minutes:5,modes:['walk'],locked:false,keyId:null,fare:0}];},
   (b:typeof original)=>{b.payload.state.memories.push({id:randomUUID(),observerId:f.location,text:'invalid observer',salience:1,decayPerDay:0,eventId:randomUUID(),at:b.payload.state.clock,private:true});},
  ]){const broken=structuredClone(original);mutate(broken);broken.checksum=checksum(broken.payload);assert.throws(()=>f.game.import(f.creator,f.timeline.id,'Rejected',broken,true));}
  assert.equal(f.revision(),revision);
  const privateSave=f.game.save(f.creator,f.timeline.id,'Creator only');
  assert.ok(!(f.game.saves(f.player,f.timeline.id) as {id:string}[]).some(s=>s.id===privateSave.id));
  assert.throws(()=>f.game.branch(f.player,f.timeline.id,privateSave.id,'Denied'),/save_unavailable/);
 }finally{await f.close();}
});
test('NPC work catch-up conserves funds and reaches the same result across partial waits',async()=>{
 const f=await scenario();try{
  const employer=f.add('business','Catch-up employer',{locationId:f.location,cash:100000});
  const job=f.add('job','Catch-up shift',{employeeId:f.npc,employerId:employer,locationId:f.location,hourlyCents:1200,minutesPerShift:60});
  f.edit(f.npc,{plans:[{id:randomUUID(),type:'work',targetId:job,cooldownMinutes:60}]});
  const one=f.game.load(f.timeline.id),split=structuredClone(one);
  advance(one,60,randomUUID(),[],f.pc);advance(split,30,randomUUID(),[],f.pc);advance(split,30,randomUUID(),[],f.pc);
  const cash=(s:typeof one,id:string)=>s.entities.find(e=>e.id===id)!.data.cash;
  assert.equal(cash(one,f.npc),1200);assert.equal(cash(split,f.npc),1200);assert.equal(cash(one,employer),98800);assert.equal(one.clock,split.clock);
  assert.deepEqual(one.entities.find(e=>e.id===f.npc)!.data.plans,split.entities.find(e=>e.id===f.npc)!.data.plans);
 }finally{await f.close();}
});
test('death keeps belongings in a persistent corpse container, and messages deliver as beliefs',async()=>{
 const f=await scenario();try{
  f.rules();const keepsake=f.add('item','Persistent keepsake',{ownerId:f.npc,equipped:true});
  f.add('injury','Fatal test injury',{characterId:f.npc,category:'gunshot',bodyPart:'torso',severity:90,bleeding:100,startedAt:f.game.load(f.timeline.id).clock});
  f.edit(f.npc,{blood:1});f.turn({type:'wait',minutes:2});
  let s=f.game.load(f.timeline.id);const remains=s.entities.find(e=>e.kind==='item'&&e.name==='Remains of Test NPC')!;
  assert.equal(s.entities.find(e=>e.id===f.npc)!.data.condition,'dead');assert.equal(s.entities.find(e=>e.id===keepsake)!.data.containerId,remains.id);
  assert.ok(f.game.view(f.player,f.timeline.id,f.pc).entities.some(e=>e.id===keepsake));
  const receiver=f.add('character','Message receiver',{locationId:f.destination});
  const phone=f.add('item','Sender phone',{ownerId:f.pc,category:'phone',contacts:[{characterId:receiver,label:'Contact'}]});
  f.turn({type:'message',phoneId:phone,toId:receiver,text:'An unverified claim',medium:'sms'});
  s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.kind==='message')!.data.status,'queued');
  f.add('item','Receiver phone',{ownerId:receiver,category:'phone'});f.turn({type:'wait',minutes:1});
  s=f.game.load(f.timeline.id);assert.equal(s.entities.find(e=>e.kind==='message')!.data.status,'delivered');assert.ok(s.beliefs.some(b=>b.observerId===receiver&&b.proposition==='An unverified claim'));
  assert.ok(!s.facts.some(fact=>fact.value==='An unverified claim'));
 }finally{await f.close();}
});
test('campaign and user AI budgets charge retry reservations independently',async()=>{
 const f=await scenario();try{
  f.game.configure(f.creator,f.timeline.id,f.revision(),settingsSchema.parse({tokenBudget:100000,userTokenBudget:1}),key());
  const turn=f.turn({type:'look'});let calls=0;
  const gateway=new NarrativeGateway(f.game,[{id:'test',async arrange(c){calls++;return {order:c.fragments.map(f=>f.id)};}}]);
  await assert.rejects(()=>gateway.narrate(f.player,f.timeline.id,turn.eventId,'test'),/ai_user_budget_exceeded/);assert.equal(calls,0);
 }finally{await f.close();}
});
test('failed escape commits its roll and time once, and a full database backup restores game history',async()=>{
 const f=await scenario();try{
  f.rules();f.game.configure(f.creator,f.timeline.id,f.revision(),settingsSchema.parse({...f.game.load(f.timeline.id).settings,rules:{...f.game.load(f.timeline.id).settings.rules!,threshold:10000}}),key());
  f.turn({type:'combat',targetId:f.npc});const revision=f.revision(),requestKey=key(),before=Date.parse(f.game.load(f.timeline.id).clock);
  const result=f.turn({type:'flee',destinationId:f.destination},requestKey,revision);
  assert.match(result.narration,/escape attempt fails/);assert.equal(f.revision(),revision+1);assert.equal(Date.parse(f.game.load(f.timeline.id).clock)-before,60000);
  assert.deepEqual(f.turn({type:'flee',destinationId:f.destination},requestKey,revision),result);
  const expected=f.game.export(f.creator,f.timeline.id),path=join(f.dir,'full-game-backup.sqlite');await f.store.backupTo(path);
  const restored=new Store(path);try{restored.migrate();assert.deepEqual(new Game(restored).export(f.creator,f.timeline.id),expected);}finally{restored.close();}
 }finally{await f.close();}
});
test('integrated acceptance preserves prose, travel, NPCs, consent, objects, injuries, law and branch history',async()=>{
 const f=await scenario();try{
  f.rules();const start=f.game.load(f.timeline.id).clock;
  f.game.configure(f.creator,f.timeline.id,f.revision(),settingsSchema.parse({...f.game.load(f.timeline.id).settings,romance:true}),key());
  f.edit(f.npc,{schedule:[{id:randomUUID(),minute:8*60+5,locationId:f.destination,activity:'meeting',days:[0,1,2,3,4,5,6]}]});
  const car=f.add('vehicle','Acceptance car',{ownerId:f.pc,locationId:f.location,locked:false});
  const phone=f.add('item','Acceptance phone',{category:'phone',ownerId:f.pc,contacts:[{characterId:f.npc,label:'Contact'}]});
  const medicine=f.add('item','Acceptance dressing',{category:'medicine',ownerId:f.pc});
  const wound=f.add('injury','Acceptance wound',{characterId:f.pc,category:'cut',bodyPart:'arm',severity:10,startedAt:start});
  f.add('watcher','Acceptance offer',{trigger:'time',dueAt:new Date(Date.parse(start)+60000).toISOString(),effect:'npc-offer',subjectId:f.pc,description:'An authored invitation.'},'creator');
  f.turn({type:'look'});f.turn({type:'travel',destinationId:f.destination,mode:'drive',vehicleId:car});
  assert.equal(f.game.load(f.timeline.id).entities.find(e=>e.id===f.npc)!.data.locationId,f.destination);
  f.turn({type:'social',targetId:f.npc,intent:'greet',consent:false});
  f.turn({type:'message',phoneId:phone,toId:f.npc,text:'I arrived.',medium:'sms'});f.turn({type:'treat',injuryId:wound,medicineId:medicine});
  const agency=f.add('faction','Acceptance agency',{memberIds:[f.npc],jurisdictionIds:[f.destination]});
  const law=f.add('law','Acceptance law',{jurisdictionIds:[f.destination],agencyIds:[agency],permits:['search'],requiresWarrant:true});
  f.turn({type:'crime',lawId:law,targetId:null});let state=f.game.load(f.timeline.id);
  const crime=state.facts.find(x=>x.predicate==='alleged-act')!;f.turn({type:'report',factId:crime.id,agencyId:agency,investigatorId:f.npc});
  const casing=f.add('evidence','Acceptance trace',{locationId:f.destination,sourceEventId:crime.eventId});f.turn({type:'search'});
  state=f.game.load(f.timeline.id);assert.ok((state.entities.find(e=>e.id===casing)!.data.discoveredBy as string[]).includes(f.pc));assert.ok(state.entities.some(e=>e.kind==='case'));
  const save=f.game.save(f.player,f.timeline.id,'Acceptance checkpoint'),parent=f.game.export(f.creator,f.timeline.id),child=f.game.branch(f.player,f.timeline.id,save.id,'Acceptance branch');
  assert.deepEqual(f.game.export(f.creator,f.timeline.id),parent);assert.equal(f.game.view(f.player,child.id,f.pc).turns.length,parent.payload.transcript.length);
  const copied=f.game.import(f.creator,child.id,'Acceptance restored',parent,false) as {id:string};assert.equal(f.game.view(f.creator,copied.id,f.pc).turns.length,parent.payload.transcript.length);
  assert.ok(parent.payload.transcript.some(t=>t.narration.includes('An authored invitation.')));assert.doesNotMatch(JSON.stringify(f.game.view(f.player,f.timeline.id,f.pc)),/NEVER_EXPOSE|SECRET_INSTRUCTION/);
 }finally{await f.close();}
});
test('large authored roster and lore set remain bounded through catch-up, retrieval and repeated autosaves',async t=>{
 const f=await scenario();try{
  const bundle=f.game.export(f.creator,f.timeline.id);
  for(let i=0;i<1000;i++)bundle.payload.state.entities.push(validateEntity({id:randomUUID(),kind:'character',name:'Load NPC '+i,visibility:'knowledge',data:{locationId:f.destination,schedule:[{id:randomUUID(),minute:9*60,locationId:f.destination,activity:'routine'}]}}));
  for(let i=0;i<1000;i++)bundle.payload.state.entities.push(validateEntity({id:randomUUID(),kind:'lore',name:'Load lore '+i,visibility:'campaign',data:{description:'Synthetic benchmark reference '+i}}));
  bundle.checksum=checksum(bundle.payload);let began=performance.now();const imported=f.game.import(f.creator,f.timeline.id,'Load fixture',bundle,false) as {id:string};const importMs=performance.now()-began;
  began=performance.now();const context=f.game.context(f.creator,imported.id,f.pc,'benchmark reference');const retrievalMs=performance.now()-began;assert.ok(context.sources.length<=12);
  began=performance.now();for(let i=0;i<10;i++)f.game.turn(f.creator,imported.id,{revision:f.game.access(f.creator,imported.id).t.revision,characterId:f.pc,action:{type:'wait',minutes:60}},key());const tenTurnsMs=performance.now()-began;
  assert.equal(f.game.view(f.creator,imported.id,f.pc).turns.length,10);assert.ok(tenTurnsMs<30000,'ten hourly turns exceeded 30-second regression ceiling');
  t.diagnostic(JSON.stringify({npcCount:1001,loreCount:1000,importMs:Math.round(importMs),retrievalMs:Math.round(retrievalMs),tenTurnsMs:Math.round(tenTurnsMs)}));
 }finally{await f.close();}
});
