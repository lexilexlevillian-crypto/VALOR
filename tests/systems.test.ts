import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {data,validateEntity,settingsSchema} from '../src/game/model.ts';
import type {Kind,Action,Entity} from '../src/game/model.ts';
import {deliverGameEvents} from '../src/game/delivery.ts';
import {contextBrief} from '../src/game/context.ts';

async function setup(){
 const f=await fixture(),game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
 const revision=async()=>(await game.access(f.creator,timeline.id)).t.revision;
 const create=(kind:Kind,name:string,data:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,data,visibility});
 const location=create('location','Synthetic room',{tags:['washing-facilities','laundry-facilities']});
 const pc=create('character','Synthetic player',{playable:true,controllerUserId:f.player.id,locationId:location.id,cash:10000,attributes:{Strength:50,Agility:50,Endurance:50,Intellect:50,Perception:50,Presence:50,Will:50}});
 const npc=create('character','Synthetic contact',{playable:true,controllerUserId:f.creator.id,locationId:location.id,secrets:'PRIVATE_NPC_SECRET'});
 await game.bulkEdit(f.creator,timeline.id,{revision:await revision(),entities:[pc,npc,location]},key());
 const add=async(kind:Kind,name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>{const entity=create(kind,name,raw,visibility);await game.edit(f.creator,timeline.id,{revision:await revision(),entity},key());return entity.id;};
 const edit=async(id:string,changes:Record<string,unknown>)=>{const entity=(await game.load(timeline.id)).entities.find(e=>e.id===id)!;Object.assign(entity.data,changes);return game.edit(f.creator,timeline.id,{revision:await revision(),entity},key());};
 const state=()=>game.load(timeline.id);
 const turn=async(action:Action)=>game.turn(f.player,timeline.id,{revision:await revision(),characterId:pc.id,action},key());
 const configure=async(raw:Record<string,unknown>)=>game.configure(f.creator,timeline.id,await revision(),settingsSchema.parse({...((await state()).settings),...raw}),key());
 return {...f,game,timeline,pc:pc.id,npc:npc.id,location:location.id,revision,create,add,edit,state,turn,configure};
}
test('Creator batches resolve cross-references, reject invalid data atomically and preserve recovery history',async()=>{
 const f=await setup();try{
  const before=await f.state(),revision=await f.revision();
  const broken=f.create('item','Broken',{ownerId:randomUUID()});
  await assert.rejects(()=>f.game.bulkEdit(f.creator,f.timeline.id,{revision,entities:[broken]},key()),/broken_reference/);
  assert.deepEqual(await f.state(),before);assert.equal(await f.revision(),revision);
  const save=await f.game.save(f.creator,f.timeline.id,'Before change');await f.edit(f.location,{description:'Changed'});
  const diff=await f.game.compareSave(f.creator,f.timeline.id,save.id);assert.ok(diff.changed.some(e=>e.id===f.location));
  await assert.rejects(()=>f.game.compareSave(f.player,f.timeline.id,save.id),/forbidden/);
  const request={revision:await f.revision(),saveId:save.id,entityId:f.location},retry=key();
  const restored=await f.game.restoreEntity(f.creator,f.timeline.id,request,retry);
  assert.deepEqual(await f.game.restoreEntity(f.creator,f.timeline.id,request,retry),restored);
  assert.equal((await f.state()).entities.find(e=>e.id===f.location)!.data.description,'');
  assert.ok((await f.store.get<{n:number}>('SELECT count(*) n FROM saves'))!.n>1);
 }finally{await f.close();}
});
test('game outbox commits with turns, retries failed delivery and prevents concurrent duplicate leasing',async()=>{
 const f=await setup();try{
  await f.turn({type:'look'});
  await assert.rejects(()=>deliverGameEvents(f.store,async()=>{throw new Error('offline');}),/offline/);
  const seen:string[]=[];
  const results=await Promise.all([deliverGameEvents(f.store,async e=>{seen.push(e.id);await new Promise(r=>setTimeout(r,5));}),deliverGameEvents(f.store,async e=>{seen.push(e.id);})]);
  assert.equal(new Set(seen).size,seen.length);assert.equal(results.reduce((a,b)=>a+b),seen.length);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM game_outbox WHERE delivered_at IS NULL'))!.n,0);
  const revision=await f.revision();await f.store.exec("CREATE TRIGGER fail_game_delivery BEFORE INSERT ON game_outbox BEGIN SELECT RAISE(ABORT,'delivery_failure'); END;");
  await assert.rejects(()=>f.turn({type:'wait',minutes:1}),/delivery_failure/);
  assert.equal(await f.revision(),revision);
 }finally{await f.close();}
});
test('phone calls require receiver choice, enforce ownership and retain missed/read lifecycle',async()=>{
 const f=await setup();try{
  const outgoing=await f.add('item','Player phone',{category:'phone',ownerId:f.pc,contacts:[{characterId:f.npc,label:'Known contact'}]});
  const incoming=await f.add('item','Contact phone',{category:'phone',ownerId:f.npc});
  await f.turn({type:'phone-call',phoneId:outgoing,toId:f.npc});
  let call=(await f.state()).entities.find(e=>e.kind==='message')!;assert.equal(call.data.callState,'ringing');
  await assert.rejects(()=>f.turn({type:'call-response',messageId:call.id,phoneId:outgoing,response:'answer'}),/call_not_ringing/);
  await f.game.turn(f.creator,f.timeline.id,{revision:await f.revision(),characterId:f.npc,action:{type:'call-response',messageId:call.id,phoneId:incoming,response:'answer'}},key());
  assert.equal((await f.state()).entities.find(e=>e.id===call.id)!.data.callState,'active');
  await f.turn({type:'call-speak',messageId:call.id,phoneId:outgoing,text:'Only the words I supplied.'});
  assert.match(String((await f.state()).entities.find(e=>e.id===call.id)!.data.body),/Only the words I supplied/);
  await f.turn({type:'call-response',messageId:call.id,phoneId:outgoing,response:'end'});
  await f.turn({type:'phone-call',phoneId:outgoing,toId:f.npc});await f.turn({type:'wait',minutes:1});
  assert.ok((await f.state()).entities.some(e=>e.data.callState==='missed'));
  await assert.rejects(()=>f.turn({type:'phone-call',phoneId:incoming,toId:f.npc}),/phone_unavailable/);
 }finally{await f.close();}
});
test('vehicle trunks conserve items, reject overflow and never silently board another player',async()=>{
 const f=await setup();try{
  const vehicle=await f.add('vehicle','Synthetic car',{ownerId:f.pc,locationId:f.location,trunkCapacity:2});
  const bag=await f.add('item','Synthetic cargo',{ownerId:f.pc,weight:2});
  await assert.rejects(()=>f.turn({type:'store',itemId:bag,containerId:vehicle}),/container_unavailable/);
  await f.turn({type:'vehicle-access',vehicleId:vehicle,operation:'unlock'});
  await f.turn({type:'store',itemId:bag,containerId:vehicle});
  const extra=await f.add('item','Extra cargo',{ownerId:f.pc,weight:1});
  await assert.rejects(()=>f.turn({type:'store',itemId:extra,containerId:vehicle}),/container_capacity/);
  await f.turn({type:'retrieve',itemId:bag,containerId:vehicle});
  await f.turn({type:'vehicle-access',vehicleId:vehicle,operation:'enter'});
  const state=await f.state();assert.deepEqual(state.entities.find(e=>e.id===vehicle)!.data.occupants,[f.pc]);assert.equal(state.entities.find(e=>e.id===bag)!.data.ownerId,f.pc);
 }finally{await f.close();}
});
test('authored cooking, hygiene, weather and health rules persist without default survival requirements',async()=>{
 const f=await setup();try{
  const flour=await f.add('item','Test ingredient',{ownerId:f.pc,category:'food',quantity:2});
  const recipe=await f.add('recipe','Test recipe',{minutes:5,inputs:[{itemId:flour,quantity:2}],outputName:'Test meal',outputCategory:'food',outputQuantity:1,outputDose:10,outputWeight:1});
  await f.turn({type:'cook',recipeId:recipe});
  assert.equal((await f.state()).entities.find(e=>e.id===flour)!.data.quantity,0);
  const revision=await f.revision();await assert.rejects(()=>f.turn({type:'cook',recipeId:recipe}),/recipe_ingredients_required/);assert.equal(await f.revision(),revision);
  await assert.rejects(()=>f.turn({type:'hygiene',operation:'wash',itemId:null}),/configure_daily_life/);
  const at=(await f.state()).clock;
  await f.configure({dailyLife:{minutes:5,hygieneGain:20},weatherSchedule:[{at:new Date(Date.parse(at)+60000).toISOString(),weather:'rain'}],healthRules:{infectionPerDay:24,untreatedSeverityPerDay:24,withdrawalPerDay:24,soberingPerHour:10},rules:{dieSides:6,threshold:1,damage:10,treatmentMinutes:5,recoveryPerDay:5,unfamiliarPenalty:0,bleedPerMinute:0}});
  // Health progression must not depend on enabling unrelated combat rules.
  await f.configure({rules:null});
  await f.edit(f.pc,{hygiene:10,dependence:100,lastDoseAt:at,intoxication:20});
  const wound=await f.add('injury','Test wound',{characterId:f.pc,category:'cut',bodyPart:'arm',severity:10,startedAt:at});
  await f.turn({type:'hygiene',operation:'wash',itemId:null});await f.turn({type:'wait',minutes:60});
  const state=await f.state();assert.equal(state.settings.weather,'rain');assert.equal(state.entities.find(e=>e.id===f.pc)!.data.hygiene,10);assert.ok(Number(state.entities.find(e=>e.id===wound)!.data.infection)>0);
 }finally{await f.close();}
});
test('compound Watchers arbitrate conflicts and do not expose hidden traces',async()=>{
 const f=await setup();try{
  const at=(await f.state()).clock;
  const common={trigger:'time',dueAt:at,effect:'npc-offer',subjectId:f.pc,conflictGroup:'offer',once:true,conditions:[{kind:'location',subjectId:f.pc,targetId:f.location}]};
  const first=await f.add('watcher','Priority offer',{...common,priority:10,description:'Visible high-priority offer'},'creator');
  const second=await f.add('watcher','Private competitor',{...common,priority:1,description:'HIDDEN_COMPETING_OFFER'},'creator');
  const turn=await f.turn({type:'wait',minutes:1}),state=await f.state();
  assert.equal(state.entities.find(e=>e.id===first)!.data.fired,true);assert.equal(state.entities.find(e=>e.id===second)!.data.fired,false);
  assert.match(turn.narration,/Visible high-priority/);assert.doesNotMatch(turn.narration,/HIDDEN_COMPETING|Watcher fired/);
 }finally{await f.close();}
});
test('context and intent proposals remain bounded, knowledge-filtered and non-mutating',async()=>{
 const f=await setup();try{
  await f.add('lore','Hidden fact',{description:'HIDDEN_LORE'},'creator');
  await f.add('lore','Public reference',{description:'Public prose'},'campaign');
  const before=await f.state(),revision=await f.revision();
  const proposal=await f.game.parse(f.player,f.timeline.id,f.pc,'go to Synthetic room');assert.equal(proposal.requiresConfirmation,true);assert.equal(proposal.action?.type,'travel');
  assert.equal((await f.game.parse(f.player,f.timeline.id,f.pc,'maybe attack Synthetic contact')).action,null);
  const context=contextBrief(before,f.pc,'prose',512);assert.ok(Buffer.byteLength(JSON.stringify(context))<=512);assert.doesNotMatch(JSON.stringify(context),/HIDDEN_LORE|PRIVATE_NPC_SECRET/);
  assert.equal(await f.revision(),revision);assert.deepEqual(await f.state(),before);
 }finally{await f.close();}
});
test('bail payments require authored authorization and conserve funds without exposing case secrets',async()=>{
 const f=await setup();try{
  const agency=await f.add('faction','Test agency',{treasuryCents:100});
  const file=await f.add('case','HIDDEN_CASE_TITLE',{agencyId:agency,investigatorId:f.npc,suspectIds:[f.pc],stage:'jail',leads:['HIDDEN_CASE_LEAD']},'knowledge');
  await f.edit(f.pc,{restrainedBy:f.npc});
  await assert.rejects(()=>f.turn({type:'pay-bail',caseId:file}),/bail_not_authorized/);
  await f.edit(file,{bailAmountCents:2500});
  const view=await f.game.view(f.player,f.timeline.id,f.pc);assert.doesNotMatch(JSON.stringify(view),/HIDDEN_CASE_TITLE|HIDDEN_CASE_LEAD/);
  await f.turn({type:'pay-bail',caseId:file});const state=await f.state();
  assert.equal(data(state.entities.find(e=>e.id===f.pc)!,'character').cash,7500);assert.equal(data(state.entities.find(e=>e.id===agency)!,'faction').treasuryCents,2600);
  await assert.rejects(()=>f.turn({type:'pay-bail',caseId:file}),/bail_not_authorized/);
 }finally{await f.close();}
});
test('validated narration HTTP stream preserves event correlation and requires ownership',async()=>{
 const f=await setup();try{
  const result=await f.turn({type:'look'}),revision=await f.revision(),session=await login(f,'player@example.test');
  const response=await f.app.inject({method:'POST',url:'/game/timelines/'+f.timeline.id+'/narrate/stream',headers:{cookie:session.cookie,origin:f.settings.origin,'x-csrf-token':session.csrf},payload:{turnId:result.eventId}});
  assert.equal(response.statusCode,200,response.body);assert.match(String(response.headers['content-type']),/ndjson/);
  const lines=response.body.trim().split('\n').map(line=>JSON.parse(line));assert.equal(lines.at(-1).type,'complete');assert.equal(lines.at(-1).promptVersion,'narrative-v1');assert.equal(await f.revision(),revision);
 }finally{await f.close();}
});

test('tactical range and blocked lines reject attacks without consuming ammunition',async()=>{
 const f=await setup();try{
  assert.equal(data(f.create('item','Legacy armor',{category:'armor'}),'item').protection,1);
  await f.configure({rules:{dieSides:6,threshold:1,damage:10,treatmentMinutes:5,recoveryPerDay:5,unfamiliarPenalty:0,bleedPerMinute:0}});
  const weapon=await f.add('item','Test ranged weapon',{category:'firearm',ownerId:f.pc,magazine:5,loaded:3,rangeMeters:2});
  await f.turn({type:'combat',targetId:f.npc});
  const combat=(await f.state()).entities.find(e=>e.kind==='combat')!;
  await f.edit(combat.id,{positions:{[f.pc]:0,[f.npc]:10}});
  await assert.rejects(()=>f.turn({type:'attack',targetId:f.npc,weaponId:weapon,bodyPart:'torso'}),/target_out_of_range/);
  await f.edit(combat.id,{positions:{[f.pc]:0,[f.npc]:1},blockedLines:[{fromId:f.pc,toId:f.npc}]});
  await assert.rejects(()=>f.turn({type:'attack',targetId:f.npc,weaponId:weapon,bodyPart:'torso'}),/line_of_fire_blocked/);
  assert.equal((await f.state()).entities.find(e=>e.id===weapon)!.data.loaded,3);
 }finally{await f.close();}
});
test('authored services conserve payments and supplies and disclose forensic results only after testing',async()=>{
 const f=await setup();try{
  const business=await f.add('business','Test clinic/lab',{locationId:f.location,cash:100});
  const medicine=await f.add('item','Clinic dressing',{category:'medicine',ownerId:business,quantity:1});
  const care=await f.add('service','Authored care',{businessId:business,category:'clinical',minutes:15,costCents:500,medicineId:medicine,severityReduction:5});
  const wound=await f.add('injury','Test injury',{characterId:f.pc,category:'cut',bodyPart:'arm',severity:10,bleeding:2,startedAt:(await f.state()).clock});
  await f.turn({type:'clinical-care',serviceId:care,injuryId:wound});
  let state=await f.state();assert.equal(state.entities.find(e=>e.id===medicine)!.data.quantity,0);assert.equal(state.entities.find(e=>e.id===wound)!.data.severity,5);
  assert.equal(state.entities.find(e=>e.id===business)!.data.cash,600);assert.equal(state.entities.find(e=>e.id===f.pc)!.data.cash,9500);
  const agency=await f.add('faction','Test agency',{memberIds:[f.pc]});
  const file=await f.add('case','Test case',{agencyId:agency,investigatorId:f.pc});
  const evidence=await f.add('evidence','Test sample',{caseId:file,custodianId:f.pc,discoveredBy:[f.pc],forensicFindings:[{testName:'Authored analysis',result:'PRIVATE_UNTESTED_RESULT'}]});
  await f.edit(file,{evidenceIds:[evidence]});
  const lab=await f.add('service','Lab service',{businessId:business,category:'forensic',minutes:60,costCents:100,testName:'Authored analysis'});
  assert.doesNotMatch(JSON.stringify(await f.game.view(f.player,f.timeline.id,f.pc)),/PRIVATE_UNTESTED_RESULT/);
  await f.turn({type:'forensic-test',serviceId:lab,evidenceId:evidence,caseId:file});
  assert.match(JSON.stringify(await f.game.view(f.player,f.timeline.id,f.pc)),/PRIVATE_UNTESTED_RESULT/);
  assert.doesNotMatch(JSON.stringify(await f.game.view(f.creator,f.timeline.id,f.npc)),/PRIVATE_UNTESTED_RESULT/);
  await assert.rejects(()=>f.turn({type:'forensic-test',serviceId:lab,evidenceId:evidence,caseId:file}),/forensic_result_not_authored_or_completed/);
 }finally{await f.close();}
});
test('authored travel interruptions stop at an encounter without leaking it before departure',async()=>{
 const f=await setup();try{
  const destination=await f.add('location','Known destination'),interrupt=await f.add('location','HIDDEN_ENCOUNTER',{description:'Encounter scene'},'knowledge');
  await f.edit(f.location,{exits:[{to:destination,minutes:20,modes:['walk'],interruption:{locationId:interrupt,afterMinutes:5}}]});
  assert.doesNotMatch(JSON.stringify(await f.game.view(f.player,f.timeline.id,f.pc)),/HIDDEN_ENCOUNTER/);
  const before=Date.parse((await f.state()).clock);await f.turn({type:'travel',destinationId:destination,mode:'walk',vehicleId:null});
  const state=await f.state();assert.equal(state.entities.find(e=>e.id===f.pc)!.data.locationId,interrupt);assert.equal(Date.parse(state.clock)-before,5*60000);
  assert.match(JSON.stringify(await f.game.view(f.player,f.timeline.id,f.pc)),/HIDDEN_ENCOUNTER/);
 }finally{await f.close();}
});
test('NPC group policy shares only known facts locally and never changes player mood or knowledge',async()=>{
 const f=await setup();try{
  const leader=await f.add('character','Group leader',{locationId:f.location,mood:'authored mood'}),member=await f.add('character','Group member',{locationId:f.location});
  const remote=await f.add('location','Other room'),absent=await f.add('character','Absent member',{locationId:remote});
  const group=await f.add('faction','Authored group',{leaderId:leader,memberIds:[member,absent,f.pc],groupPolicy:{intervalMinutes:15,cohesionStep:1,shareKnowledge:true,shareMood:true}});
  await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'truth',subjectId:group,text:'Known group fact'},key());
  const fact=(await f.state()).facts.at(-1)!;
  await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'knowledge',subjectId:leader,text:'',factId:fact.id},key());
  await f.turn({type:'wait',minutes:30});
  const state=await f.state();assert.ok(state.knowledge.some(k=>k.observerId===member&&k.factId===fact.id));assert.ok(!state.knowledge.some(k=>[f.pc,absent].includes(k.observerId)&&k.factId===fact.id));
  assert.equal(state.entities.find(e=>e.id===f.pc)!.data.mood,'');assert.equal(state.entities.find(e=>e.id===member)!.data.mood,'authored mood');
 }finally{await f.close();}
});
