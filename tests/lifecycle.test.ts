import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key,login} from './helpers.ts';
import {Game,checksum} from '../src/game/engine.ts';
import {data,validateEntity,settingsSchema} from '../src/game/model.ts';
import type {Kind,Entity,Action} from '../src/game/model.ts';
import {advance} from '../src/game/simulation.ts';
import {IntentGateway,intentContext} from '../src/game/ai-intent.ts';
import {NarrativeGateway} from '../src/game/ai.ts';

async function setup(){
 const f=await fixture(),game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
 const revision=async()=>(await game.access(f.creator,timeline.id)).t.revision;
 const make=(kind:Kind,name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,data:raw,visibility});
 const room=make('location','Fixture room'),pc=make('character','Fixture player',{playable:true,controllerUserId:f.player.id,locationId:room.id,cash:10000}),npc=make('character','Fixture NPC',{locationId:room.id,cash:100});
 await game.bulkEdit(f.creator,timeline.id,{revision:await revision(),entities:[room,pc,npc]},key());
 const add=async(kind:Kind,name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>{const e=make(kind,name,raw,visibility);await game.edit(f.creator,timeline.id,{revision:await revision(),entity:e},key());return e.id;};
 const state=()=>game.load(timeline.id);
 const edit=async(id:string,raw:Record<string,unknown>)=>{const entity=(await state()).entities.find(e=>e.id===id)!;Object.assign(entity.data,raw);await game.edit(f.creator,timeline.id,{revision:await revision(),entity},key());};
 const turn=(action:Action)=>revision().then(revision=>game.turn(f.player,timeline.id,{revision,characterId:pc.id,action},key()));
 const configure=async(raw:Record<string,unknown>)=>game.configure(f.creator,timeline.id,await revision(),settingsSchema.parse({...((await state()).settings),...raw}),key());
 return {...f,game,timeline,room:room.id,pc:pc.id,npc:npc.id,revision,make,add,edit,state,turn,configure};
}
test('route-aware NPC schedules persist departure and arrival consistently across partial waits',async()=>{
 const f=await setup();try{
  const destination=await f.add('location','Fixture destination');await f.edit(f.room,{exits:[{to:destination,minutes:5}]});
  await f.edit(f.npc,{schedule:[{id:randomUUID(),minute:481,locationId:destination,activity:'shift'}]});await f.configure({npcRouteTravel:true});
  const initial=await f.state(),whole=structuredClone(initial),split=structuredClone(initial),event=key();
  advance(whole,6,event,[],f.pc);advance(split,4,event,[],f.pc);
  assert.equal(split.entities.find(e=>e.id===f.npc)!.data.locationId,null);assert.ok(split.entities.find(e=>e.id===f.npc)!.data.journey);
  advance(split,2,event,[],f.pc);assert.equal(split.entities.find(e=>e.id===f.npc)!.data.locationId,destination);
  assert.deepEqual(data(split.entities.find(e=>e.id===f.npc)!,'character'),data(whole.entities.find(e=>e.id===f.npc)!,'character'));
  await f.turn({type:'wait',minutes:4});const save=await f.game.save(f.player,f.timeline.id,'In transit');const child=await f.game.branch(f.player,f.timeline.id,save.id,'Transit branch');
  assert.ok((await f.game.load(child.id)).entities.find(e=>e.id===f.npc)!.data.journey);
 }finally{await f.close();}
});
test('production consumes bounded real stock and catches up identically without infinite output',async()=>{
 const f=await setup();try{
  const business=await f.add('business','Fixture factory',{locationId:f.room}),input=await f.add('item','Fixture input',{ownerId:business,quantity:7}),output=await f.add('item','Fixture output',{ownerId:business,quantity:0});
  await f.add('production','Fixture production',{businessId:business,inputs:[{itemId:input,quantity:2}],outputId:output,quantity:3,intervalMinutes:5,nextAt:'2012-06-01T12:05:00Z',enabled:true});
  const s=await f.state(),whole=structuredClone(s),split=structuredClone(s),event=key();advance(whole,60,event,[],f.pc);for(let i=0;i<6;i++)advance(split,10,event,[],f.pc);
  for(const id of [input,output])assert.deepEqual(split.entities.find(e=>e.id===id)!.data,whole.entities.find(e=>e.id===id)!.data);
  assert.equal(whole.entities.find(e=>e.id===input)!.data.quantity,1);assert.equal(whole.entities.find(e=>e.id===output)!.data.quantity,9);
  assert.equal((await f.game.view(f.player,f.timeline.id,f.pc)).entities.some(e=>e.kind==='production'),false);
 }finally{await f.close();}
});
test('quest branches arbitrate priorities, persist once, and reject manufactured player consent atomically',async()=>{
 const f=await setup();try{
  const quest=await f.add('quest','Fixture quest',{status:'active',characterId:f.pc}),conditions=[{kind:'time',at:'2012-06-01T12:01:00Z'}];
  const first=await f.add('transition','Fixture success',{questId:quest,from:'active',to:'succeeded',conditions,priority:10,outcomes:[{type:'notice',characterId:f.pc,text:'Authored success.'}]});
  await f.add('transition','SECRET_FAILURE',{questId:quest,from:'active',to:'failed',conditions,priority:1});
  const result=await f.turn({type:'wait',minutes:1});assert.match(result.narration,/Authored success/);assert.doesNotMatch(result.narration,/SECRET_FAILURE/);
  assert.ok((await f.state()).entities.find(e=>e.id===first)!.data.firedAt);assert.equal((await f.state()).entities.find(e=>e.id===quest)!.data.status,'succeeded');
  const relation=await f.add('relationship','Fixture relationship',{fromId:f.npc,toId:f.pc,labels:['friend']});
  await f.add('socialRule','Invalid consent',{relationshipId:relation,label:'friend',outcomes:[{type:'relationship',relationshipId:relation,label:'married',operation:'add'}]});
  const before=await f.state();await assert.rejects(()=>f.turn({type:'wait',minutes:1}),/player_relationship_consent_required/);assert.deepEqual(await f.state(),before);
 }finally{await f.close();}
});
test('dispatch delivers reports as beliefs, arrives on authored time and requires explicit transport consent',async()=>{
 const f=await setup();try{
  const hospital=await f.add('location','Fixture hospital'),agency=await f.add('faction','Fixture EMS',{memberIds:[f.npc],jurisdictionIds:[f.room],dispatchPolicy:{kind:'ems',responseMinutes:3,hospitalId:hospital}}),phone=await f.add('item','Fixture phone',{ownerId:f.pc,category:'phone'});
  await f.turn({type:'request-assistance',agencyId:agency,phoneId:phone,report:'Caller supplied report.',patientId:f.pc,transportConsent:false});
  const call=(await f.state()).entities.find(e=>e.kind==='dispatch')!;
  assert.ok((await f.state()).beliefs.some(b=>b.observerId===f.npc&&b.proposition==='Caller supplied report.'));
  assert.equal((await f.state()).facts.some(x=>x.predicate==='Caller supplied report.'),false);
  await assert.rejects(()=>f.turn({type:'dispatch-response',dispatchId:call.id,operation:'transport'}),/transport_unavailable/);
  await f.turn({type:'wait',minutes:3});assert.equal((await f.state()).entities.find(e=>e.id===f.pc)!.data.locationId,f.room);
  await f.turn({type:'dispatch-response',dispatchId:call.id,operation:'transport'});assert.equal((await f.state()).entities.find(e=>e.id===f.pc)!.data.locationId,hospital);
  assert.equal((await f.state()).entities.find(e=>e.id===call.id)!.data.status,'closed');
 }finally{await f.close();}
});
test('authored court judgments conserve fines, do not infer guilt, and finish probation once',async()=>{
 const f=await setup();try{
  const agency=await f.add('faction','Fixture court',{treasuryCents:0}),file=await f.add('case','Fixture case',{agencyId:agency,investigatorId:f.npc,suspectIds:[f.pc],stage:'trial'});
  await f.add('judgment','Authored disposition',{caseId:file,characterId:f.pc,authority:'Creator-authored fictional court',verdict:'convicted',fineCents:500,custodyUntil:'2012-06-01T12:02:00Z',probationUntil:'2012-06-01T12:04:00Z'});
  await f.turn({type:'wait',minutes:1});assert.equal((await f.state()).entities.find(e=>e.id===f.pc)!.data.cash,9500);
  await f.turn({type:'wait',minutes:1});assert.equal((await f.state()).entities.find(e=>e.id===file)!.data.stage,'probation');
  await f.turn({type:'wait',minutes:2});assert.equal((await f.state()).entities.find(e=>e.id===file)!.data.stage,'closed');assert.equal((await f.state()).entities.find(e=>e.id===agency)!.data.treasuryCents,500);
 }finally{await f.close();}
});
test('death keeps identified remains and authorized estate settlement transfers assets only once',async()=>{
 const f=await setup();try{
  const item=await f.add('item','Fixture belongings',{ownerId:f.npc}),estate=await f.add('estate','Fixture estate',{characterId:f.npc,executorId:f.pc,beneficiaryId:f.pc,authorized:true,funeralAt:'2012-06-01T12:01:00Z'});
  await assert.rejects(()=>f.turn({type:'settle-estate',estateId:estate}),/estate_not_available/);
  await f.edit(f.npc,{blood:0});await f.turn({type:'wait',minutes:1});const corpse=(await f.state()).entities.find(e=>e.data.deceasedId===f.npc)!;
  assert.ok(corpse);assert.equal((await f.state()).entities.find(e=>e.id===item)!.data.containerId,corpse.id);
  await f.turn({type:'settle-estate',estateId:estate});const state=await f.state();assert.equal(state.entities.find(e=>e.id===f.pc)!.data.cash,10100);assert.equal(state.entities.find(e=>e.id===item)!.data.ownerId,f.pc);
  await assert.rejects(()=>f.turn({type:'settle-estate',estateId:estate}),/estate_authority_required/);
 }finally{await f.close();}
});
test('optional reproductive calendar stays private and never infers conception or births',async()=>{
 const f=await setup();try{
  await f.edit(f.pc,{reproductive:{enabled:true,cycleStart:'2012-06-01T00:00:00Z',cycleDays:28,bleedingDays:5,pregnancyDays:280}});
  assert.equal((await f.game.view(f.player,f.timeline.id,f.pc)).entities.find(e=>e.id===f.pc)!.data.reproductive,undefined);
  await f.configure({reproductiveHealth:true,calendar:{hemisphere:'north',sunriseHour:6,sunsetHour:18},holidays:[{date:'2012-06-01',label:'Authored holiday'}]});
  await f.turn({type:'wait',minutes:1});const state=await f.state();assert.equal(data(state.entities.find(e=>e.id===f.pc)!,'character').reproductive!.phase,'menstruation');assert.equal(state.entities.filter(e=>e.kind==='character').length,2);
  const view=await f.game.view(f.player,f.timeline.id,f.pc);assert.equal(view.calendar.season,'summer');assert.equal(view.calendar.daylight,true);assert.deepEqual(view.calendar.holidays,['Authored holiday']);
 }finally{await f.close();}
});
test('deduplicated immutable saves support old formats, preserve branches and detect corrupt blocks',async()=>{
 const f=await setup();try{
  await f.game.save(f.creator,f.timeline.id,'First');const count=(await f.store.get<{n:number}>('SELECT count(*) n FROM snapshot_chunks'))!.n;
  const save=await f.game.save(f.creator,f.timeline.id,'Identical');assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM snapshot_chunks'))!.n,count);
  const row=(await f.store.get<{snapshot_json:string}>('SELECT snapshot_json FROM saves WHERE id=?',save.id))!;assert.equal(JSON.parse(row.snapshot_json).storageVersion,2);
  assert.equal((await f.game.saveCompatibility(f.creator,f.timeline.id,save.id)).valid,true);
  await assert.rejects(()=>f.store.run("UPDATE snapshot_chunks SET payload='broken'"),/immutable snapshot chunk/);
  const bundle=await f.game.export(f.creator,f.timeline.id);delete (bundle.payload.state.settings as Record<string,unknown>).npcRouteTravel;delete (bundle.payload.state.settings as Record<string,unknown>).calendar;bundle.checksum=checksum(bundle.payload);
  const report=await f.game.import(f.creator,f.timeline.id,'Legacy export',bundle,true);assert.ok('valid'in report&&report.valid);
  const legacy=key();await f.store.run('INSERT INTO saves VALUES (?,?,?,?,?,?,?,?,?)',legacy,f.timeline.id,'Legacy save',1,JSON.stringify(bundle.payload),bundle.checksum,f.creator.id,new Date().toISOString(),0);
  assert.ok((await f.game.branch(f.creator,f.timeline.id,legacy,'Legacy branch')).id);
  const bad=JSON.parse(row.snapshot_json);bad.blocks.entities[0]='0'.repeat(64);const corrupt=key();await f.store.run('INSERT INTO saves VALUES (?,?,?,?,?,?,?,?,?)',corrupt,f.timeline.id,'Corrupt save',1,JSON.stringify(bad),'0'.repeat(64),f.creator.id,new Date().toISOString(),0);
  await assert.rejects(()=>f.game.branch(f.creator,f.timeline.id,corrupt,'Rejected'),/missing_snapshot_chunk/);
 }finally{await f.close();}
});
test('Creator diagnostics and observer previews are read-only and role-restricted',async()=>{
 const f=await setup();try{
  await f.edit(f.npc,{secrets:'HIDDEN_ADMIN_SECRET'});const revision=await f.revision();
  assert.equal((await f.game.diagnostics(f.creator,f.timeline.id)).valid,true);assert.doesNotMatch(JSON.stringify(await f.game.preview(f.creator,f.timeline.id,f.pc)),/HIDDEN_ADMIN_SECRET/);
  await assert.rejects(()=>f.game.diagnostics(f.player,f.timeline.id),/forbidden/);await assert.rejects(()=>f.game.preview(f.player,f.timeline.id,f.npc),/forbidden/);assert.equal(await f.revision(),revision);
 }finally{await f.close();}
});
test('AI proposals cannot mutate state or invent arguments and share campaign narration budgets',async()=>{
 const f=await setup();try{
  await f.configure({tokenBudget:1000,userTokenBudget:1000,contextTokens:16000});await f.edit(f.npc,{secrets:'HIDDEN_INTENT_SECRET'});
  await f.add('location','HIDDEN_INTENT_PLACE',{},'creator');
  let calls=0;
  const provider={id:'mock-intent',estimateIntentTokens:()=>600,async interpret(context:ReturnType<typeof intentContext>){calls++;assert.doesNotMatch(JSON.stringify(context),/HIDDEN_INTENT/);return {choice:'0'};}};
  const gateway=new IntentGateway(f.game,[provider]),before=await f.state(),revision=await f.revision();
  const proposal=await gateway.propose(f.player,f.timeline.id,f.pc,'I want to see what is here.',provider.id);assert.deepEqual(proposal,{action:{type:'look'},requiresConfirmation:true});
  assert.deepEqual(await f.state(),before);assert.equal(await f.revision(),revision);
  await assert.rejects(()=>gateway.propose(f.player,f.timeline.id,f.pc,'Again',provider.id),/ai_budget_exceeded/);assert.equal(calls,1);
  const turn=await f.turn({type:'look'}),narrator=new NarrativeGateway(f.game,[{id:'mock-narration',estimateTokens:()=>250,async arrange(){throw new Error('must_not_call');}}]);
  await assert.rejects(()=>narrator.narrate(f.player,f.timeline.id,turn.eventId,'mock-narration'),/ai_budget_exceeded/);
  assert.equal((await f.store.get<{n:number}>('SELECT sum(reserved_tokens) n FROM ai_intent_usage'))!.n,600);
 }finally{await f.close();}
});
test('invalid or injected AI action selections fail closed without echoing model prose',async()=>{
 const f=await setup();try{
  await f.configure({tokenBudget:10000,userTokenBudget:10000,contextTokens:16000});const before=await f.state();
  const bad=new IntentGateway(f.game,[{id:'bad',estimateIntentTokens:()=>100,async interpret(){return {choice:'0',action:{type:'social',consent:true},text:'INJECTED_PLAYER_CONSENT'};}}]);
  const result=await bad.propose(f.player,f.timeline.id,f.pc,'Maybe', 'bad');assert.equal(result.action,null);assert.doesNotMatch(JSON.stringify(result),/INJECTED_PLAYER_CONSENT/);assert.deepEqual(await f.state(),before);
  const foreign=new IntentGateway(f.game,[{id:'foreign',estimateIntentTokens:()=>100,async interpret(){return {choice:'99999'};}}]);
  assert.equal((await foreign.propose(f.player,f.timeline.id,f.pc,'Choose hidden target','foreign')).action,null);
 }finally{await f.close();}
});
test('media stays database-backed, private, non-cacheable and portable without a Render disk',async()=>{
 const f=await setup();try{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5sAAAAASUVORK5CYII=';
  const privateId=await f.add('media','Private image',{mime:'image/png',body:png,alt:'PRIVATE_IMAGE'},'creator'),publicId=await f.add('media','Visible image',{mime:'image/png',body:png,alt:'Synthetic one pixel'});
  await f.edit(f.room,{mediaIds:[privateId,publicId]});const view=await f.game.view(f.player,f.timeline.id,f.pc);assert.doesNotMatch(JSON.stringify(view),/PRIVATE_IMAGE|iVBORw0/);assert.deepEqual(view.entities.find(e=>e.id===f.room)!.data.mediaIds,[publicId]);
  await assert.rejects(()=>f.game.media(f.player,f.timeline.id,privateId,f.pc),/media_unavailable/);assert.ok((await f.game.media(f.player,f.timeline.id,publicId,f.pc)).bytes.length);
  await assert.rejects(()=>f.add('media','Bad SVG',{mime:'image/png',body:Buffer.from('<svg onload="alert(1)"/>').toString('base64'),alt:'bad'}),/unsupported_media/);
  const session=await login(f,'player@example.test'),response=await f.app.inject({url:'/game/timelines/'+f.timeline.id+'/media/'+publicId+'?characterId='+f.pc,headers:{cookie:session.cookie}});assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');
  const bundle=await f.game.export(f.creator,f.timeline.id);const child=await f.game.import(f.creator,f.timeline.id,'Media portability',bundle,false);assert.ok('id'in child);assert.equal((await f.game.load(child.id)).entities.find(e=>e.id===publicId)!.data.body,png);
 }finally{await f.close();}
});
test('opt-in fixed-step catch-up preserves NPC wages, needs and production across time segmentation',async()=>{
 const f=await setup();try{
  const business=await f.add('business','Fixture employer',{locationId:f.room,cash:10000}),job=await f.add('job','Fixture job',{employerId:business,employeeId:f.npc,locationId:f.room,hourlyCents:100,minutesPerShift:60});
  await f.edit(f.npc,{plans:[{id:key(),type:'work',targetId:job,cooldownMinutes:60}]});await f.configure({deterministicCatchup:true,needs:true});
  const whole=await f.state(),split=structuredClone(whole),event=key();advance(whole,240,event,[],f.pc);for(let i=0;i<8;i++)advance(split,30,event,[],f.pc);
  for(const id of [f.npc,f.pc,business]){const a=whole.entities.find(e=>e.id===id)!,b=split.entities.find(e=>e.id===id)!;assert.deepEqual(a.data,b.data);}
  assert.equal(whole.entities.find(e=>e.id===f.npc)!.data.cash,500);
 }finally{await f.close();}
});
test('NPC messages respect contact ownership and conditions without supplying player dialogue',async()=>{
 const f=await setup();try{
  await f.add('item','NPC phone',{category:'phone',ownerId:f.npc,contacts:[{characterId:f.pc,label:'Known player'}]});await f.add('item','Player phone',{category:'phone',ownerId:f.pc});
  await f.edit(f.npc,{plans:[{id:key(),type:'message',targetId:f.pc,text:'Creator-authored NPC words.',cooldownMinutes:15,conditions:[{kind:'location',subjectId:f.npc,targetId:f.room}]}]});await f.configure({deterministicCatchup:true});
  await f.turn({type:'wait',minutes:30});const state=await f.state(),messages=state.entities.filter(e=>e.kind==='message');assert.equal(messages.length,2);assert.ok(messages.every(m=>m.data.fromId===f.npc&&m.data.body==='Creator-authored NPC words.'));assert.equal(state.beliefs.filter(b=>b.observerId===f.pc).length,2);
  await f.edit(f.npc,{preferences:{message:'off'}});await f.turn({type:'wait',minutes:30});assert.equal((await f.state()).entities.filter(e=>e.kind==='message').length,2);
 }finally{await f.close();}
});
test('expanded relationship choices require reciprocal adult consent and apply authored housing consequences',async()=>{
 const f=await setup();try{
  await f.edit(f.pc,{dob:'1980-01-01'});await f.edit(f.npc,{dob:'1980-01-01'});await f.configure({romance:true});
  const relationship=await f.add('relationship','Marriage offer',{fromId:f.npc,toId:f.pc,pending:'marry'}),housing=await f.add('housing','Authored shared home',{locationId:f.room,landlordId:f.npc,tenantId:f.pc,rentCents:100,dueAt:'2012-07-01T00:00:00Z',periodDays:30,access:false});
  await f.add('socialRule','Authored housing consequence',{relationshipId:relationship,label:'marry',outcomes:[{type:'housing',housingId:housing,access:true}]});
  await assert.rejects(()=>f.turn({type:'social',targetId:f.npc,intent:'marry',consent:false}),/explicit_consent_required/);
  const prior=data((await f.state()).entities.find(e=>e.id===f.pc)!,'character');await f.turn({type:'social',targetId:f.npc,intent:'marry',consent:true});const state=await f.state();assert.ok((state.entities.find(e=>e.id===relationship)!.data.labels as string[]).includes('marry'));assert.equal(state.entities.find(e=>e.id===housing)!.data.access,true);assert.equal(state.entities.find(e=>e.id===f.pc)!.data.mood,prior.mood);
 }finally{await f.close();}
});
test('tactical movement obeys authored distance and consumes the combat turn',async()=>{
 const f=await setup();try{
  await f.configure({rules:{dieSides:6,threshold:1,damage:5,treatmentMinutes:5,recoveryPerDay:5,unfamiliarPenalty:0,bleedPerMinute:0},tactics:{movementMeters:2,failedChaseVehicleDamage:5}});await f.edit(f.pc,{attributes:{Strength:50,Agility:100,Endurance:50,Intellect:50,Perception:50,Presence:50,Will:50}});
  await f.turn({type:'combat',targetId:f.npc});const combat=(await f.state()).entities.find(e=>e.kind==='combat')!;await f.edit(combat.id,{positions:{[f.pc]:0,[f.npc]:10}});
  const revision=await f.revision();await assert.rejects(()=>f.turn({type:'tactical-move',position:100}),/movement_out_of_range/);assert.equal(await f.revision(),revision);
  await f.turn({type:'tactical-move',position:2});const current=data((await f.state()).entities.find(e=>e.id===combat.id)!,'combat');assert.equal(current.positions[f.pc],2);assert.ok(current.round>1);assert.equal(current.defenses[f.npc],'dodge');
 }finally{await f.close();}
});
