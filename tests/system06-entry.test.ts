import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
import type {Entity} from '../src/game/model.ts';

const locationEntity=(id:string,name:string):Entity=>validateEntity({id,kind:'location',name,visibility:'campaign',data:{}});
const definition=(name:string,locationId:string|null)=>({character:{name,description:'Authored start',data:{locationId:locationId||null,cash:2500,attributes:{Strength:40,Agility:40,Endurance:40,Intellect:40,Perception:40,Presence:40,Will:40}}},grantEntityIds:[],relationshipTemplates:[],reputation:[],plotHookIds:[]});

test('System 06 authored start packages are validated, permission-filtered, and applied transactionally',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);
  const location=locationEntity(randomUUID(),'Starting room');
  await game.edit(f.creator,timeline.id,{revision:(await game.access(f.creator,timeline.id)).t.revision,entity:location},key());
  const packageResult=await game.createStartPackage(f.creator,timeline.id,{name:'Night shift',slug:'night-shift',description:'A grounded beginning',kind:'guided',visibility:'campaign',status:'published',definition:definition('Riley',location.id)},key());
  const playerPackages=await game.startPackages(f.player,timeline.id),creatorPlayerModePackages=await game.startPackages(f.creator,timeline.id);
  assert.equal(playerPackages.length,1);assert.equal('definition' in playerPackages[0]!,false);assert.equal('definition' in creatorPlayerModePackages[0]!,false);
  const revision=(await game.access(f.player,timeline.id)).t.revision;
  const started=await game.start(f.player,timeline.id,{revision,packageId:packageResult.id},key());
  const state=await game.load(timeline.id),character=state.entities.find(e=>e.id===started.characterId)!;
  assert.equal(character.name,'Riley');assert.equal(character.data.locationId,location.id);assert.equal(character.data.cash,2500);
  assert.equal((await game.roster(f.player,timeline.id)).length,1);
  assert.equal((await f.store.get<{n:number}>("SELECT count(*) n FROM game_events WHERE timeline_id=? AND type='start.character'",timeline.id))!.n,1);
  const secondRevision=(await game.access(f.player,timeline.id)).t.revision; await assert.rejects(()=>game.start(f.player,timeline.id,{revision:secondRevision,packageId:packageResult.id},key()),/timeline_already_started/);
  const continueRow=await f.app.inject({url:'/continue',headers:{cookie:(await login(f,'player@example.test')).cookie}});
  assert.equal(continueRow.statusCode,200);assert.equal(continueRow.json().character_name,'Riley');
 }finally{await f.close();}
});

test('System 06 rejects invalid grants and keeps freeform creation Creator-only',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=locationEntity(randomUUID(),'Invalid grant room');
  await game.edit(f.creator,timeline.id,{revision:1,entity:location},key());
  await assert.rejects(()=>game.createStartPackage(f.creator,timeline.id,{name:'Bad',slug:'bad',description:'',kind:'guided',visibility:'campaign',status:'published',definition:{...definition('Bad',location.id),grantEntityIds:[location.id]}},key()),/invalid_start_grant/);
  const second=await f.domain.createCampaign(f.creator,{worldId:f.world.id,name:'Freeform boundary',startingAt:'2012-06-01T12:00:00Z',timezone:'America/New_York'},key());
  await f.domain.setMember(f.creator,second.id,{userId:f.player.id,role:'player',expectedRevision:1},key());
  const secondTimeline=await game.initialize(f.creator,second.id);
  await assert.rejects(()=>game.start(f.player,secondTimeline.id,{revision:1,definition:definition('Player freeform',null)},key()),/freeform_start_creator_only/);
  const created=await game.start(f.creator,secondTimeline.id,{revision:1,definition:definition('Creator freeform',null)},key());
  assert.equal((await game.roster(f.creator,secondTimeline.id)).find(x=>x.id===created.characterId)?.name,'Creator freeform');
 }finally{await f.close();}
});

test('System 06 roster remains usable for large authored sets and separates player visibility',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});
  const timeline=await game.initialize(f.creator,f.campaign.id),entities=Array.from({length:120},(_,i)=>validateEntity({id:randomUUID(),kind:'character',name:'Roster '+i,visibility:'campaign',data:{playable:true,controllerUserId:null}}));
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:entities.slice(0,100)},key());
  await game.bulkEdit(f.creator,timeline.id,{revision:2,entities:entities.slice(100)},key());
  assert.equal((await game.roster(f.creator,timeline.id)).length,120);
  assert.equal((await game.roster(f.player,timeline.id)).length,0);
 }finally{await f.close();}
});
test('System 06 roster exposes permitted continuity metadata and package summaries without hidden definitions',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=locationEntity(randomUUID(),'Visible station');
  await game.edit(f.creator,timeline.id,{revision:1,entity:location},key());
  const created=await game.createStartPackage(f.creator,timeline.id,{name:'Minimal',slug:'minimal',description:'No assumed equipment',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'Morgan',description:'A blank ledger',data:{locationId:location.id}},grantEntityIds:[],relationshipTemplates:[],reputation:[],plotHookIds:[],requiresSystems:[]}},key());
  const packages=await game.startPackages(f.player,timeline.id);
  assert.deepEqual(packages[0]!.summary.includes,['wallet','clothing','phone']);assert.equal(packages[0]!.summary.characterName,'Morgan');assert.equal('definition' in packages[0]!,false);
  const started=await game.start(f.player,timeline.id,{revision:2,packageId:created.id},key());
  await game.save(f.player,timeline.id,'Arrival');
  const card=(await game.roster(f.player,timeline.id))[0]!;
  assert.equal(card.id,started.characterId);assert.equal(card.campaign.name,'Test instance');assert.equal(card.location?.name,'Visible station');assert.equal(card.locationTime,card.timeline.clock);assert.ok(card.lastPlayed);assert.ok(card.saveSummary.count>=1);assert.equal(card.saveSummary.latest?.name,'Arrival');assert.equal(card.portraitMediaId,null);
  const state=await game.load(timeline.id);assert.equal(state.entities.some(e=>['vehicle','relationship','job'].includes(e.kind)&&!e.archived),false);
 }finally{await f.close();}
});

test('System 06 checks disabled systems at authoring and launch and duplicates starts as draft templates',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),base={character:{name:'Casey',description:'Fuel-dependent start',data:{}},grantEntityIds:[],relationshipTemplates:[],reputation:[],plotHookIds:[],requiresSystems:['fuel']};
  await assert.rejects(()=>game.createStartPackage(f.creator,timeline.id,{name:'Blocked',slug:'blocked',description:'',kind:'guided',visibility:'campaign',status:'published',definition:base},key()),/start_package_requires_disabled_system/);
  const enabled=(await game.load(timeline.id)).settings;enabled.fuel=true;await game.configure(f.creator,timeline.id,1,enabled,key());
  const source=await game.createStartPackage(f.creator,timeline.id,{name:'Road start',slug:'road-start',description:'Needs fuel simulation',kind:'guided',visibility:'campaign',status:'published',definition:base},key());
  const copy=await game.duplicateStartPackage(f.creator,timeline.id,source.id,{name:'Road template',slug:'road-template'},key());
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});
  const creatorPackages=await game.startPackages(f.creator,timeline.id),template=creatorPackages.find(row=>row.id===copy.id)!;
  assert.equal(template.kind,'template');assert.equal(template.status,'draft');assert.equal(template.visibility,'creator');
  enabled.fuel=false;await game.configure(f.creator,timeline.id,2,enabled,key());
  await assert.rejects(()=>game.start(f.player,timeline.id,{revision:3,packageId:source.id},key()),/start_package_requires_disabled_system/);
  assert.equal((await game.roster(f.player,timeline.id)).length,0);
 }finally{await f.close();}
});
