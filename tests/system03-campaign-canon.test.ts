import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {defaultCampaignConfig} from '../src/campaign-config.ts';
import {enforceActionPolicy,injuryRate,lawResponseMinutes,needsRate} from '../src/game/policy.ts';
import type {Action,State} from '../src/game/model.ts';

const revId=(value:unknown)=>String((value as {canonRevisionId:string}).canonRevisionId);

test('campaign configuration keeps defaults separate from explicit overrides and drives new timeline start',async()=>{
 const f=await fixture();
 try{
  const initial=await f.domain.campaignConfig(f.creator,f.campaign.id);
  assert.equal(initial.defaults.startAt,'2012-06-01T12:00:00Z');
  assert.equal(initial.overrides.needsIntensity,undefined);
  const updated=await f.domain.setCampaignConfig(f.creator,f.campaign.id,{
   expectedRevision:initial.revision,
   overrides:{startAt:'2012-06-02T04:30:00.000Z',needsIntensity:'grounded',lawEnforcement:{posture:'lax'},technology:{features:{sms:true}}},
   reason:'System 03 acceptance'
  },key());
  assert.equal((updated as {configRevision:number}).configRevision,2);
  const config=await f.domain.campaignConfig(f.creator,f.campaign.id);
  assert.equal(config.resolved.startAt,'2012-06-02T04:30:00.000Z');
  assert.equal(config.resolved.needsIntensity,'grounded');
  assert.equal(config.resolved.lawEnforcement.posture,'lax');
  assert.equal(config.resolved.technology.features.sms,true);
  const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
  assert.equal((await game.load(timeline.id)).clock,'2012-06-02T04:30:00.000Z');
  await assert.rejects(async()=>f.domain.setCampaignConfig(f.player,f.campaign.id,{expectedRevision:2,overrides:{difficulty:'strict'}},key()),/forbidden/);
 }finally{await f.close();}
});

test('conflicting worlds remain isolated and published canon revisions preserve historical snapshots',async()=>{
 const f=await fixture();
 try{
  const worldTwo=await f.domain.createWorld(f.creator,'Second authored world',key());
  const campaignTwo=await f.domain.createCampaign(f.creator,{worldId:worldTwo.id,name:'Second campaign',startingAt:'2012-06-01T12:00:00Z',timezone:'America/Los_Angeles'},key());
  const cityOne=await f.domain.execute(f.creator,{type:'world',id:f.world.id},{type:'record.create',kind:'city',name:'Harbor City',visibility:'campaign'},key());
  const cityTwo=await f.domain.execute(f.creator,{type:'world',id:worldTwo.id},{type:'record.create',kind:'city',name:'Northpoint',visibility:'campaign'},key());
  await f.domain.setCanonRecord(f.creator,f.world.id,{recordId:cityOne.id,slug:'city.core',aliases:['Harbor'],sourceStatus:'published',validFrom:null,validUntil:null},key());
  await f.domain.setCanonRecord(f.creator,worldTwo.id,{recordId:cityTwo.id,slug:'city.core',aliases:['Northpoint'],sourceStatus:'published',validFrom:null,validUntil:null},key());
  const first=await f.domain.createCanonRevision(f.creator,f.world.id,{recordIds:[],note:'first world revision'},key());
  const second=await f.domain.createCanonRevision(f.creator,worldTwo.id,{recordIds:[],note:'second world revision'},key());
  await f.domain.setCanonRevisionStatus(f.creator,f.world.id,revId(first),'published',key());
  await f.domain.setCanonRevisionStatus(f.creator,worldTwo.id,revId(second),'published',key());
  await f.domain.bindCampaignCanon(f.creator,f.campaign.id,revId(first),key());
  await f.domain.bindCampaignCanon(f.creator,campaignTwo.id,revId(second),key());
  const game=new Game(f.store),timelineOne=await game.initialize(f.creator,f.campaign.id),timelineTwo=await game.initialize(f.creator,campaignTwo.id);
  assert.equal((await f.store.get<{canon_revision_id:string}>('SELECT canon_revision_id FROM timeline_canon_bindings WHERE timeline_id=?',timelineOne.id))!.canon_revision_id,revId(first));
  assert.equal((await f.store.get<{canon_revision_id:string}>('SELECT canon_revision_id FROM timeline_canon_bindings WHERE timeline_id=?',timelineTwo.id))!.canon_revision_id,revId(second));
  const changed={...cityOne, name:'Harbor City Revised'};
  await f.domain.execute(f.creator,{type:'world',id:f.world.id},{type:'record.update',recordId:cityOne.id,expectedRevision:1,name:changed.name,visibility:'campaign'},key());
  const revised=await f.domain.createCanonRevision(f.creator,f.world.id,{recordIds:[cityOne.id],note:'revised city'},key());
  await f.domain.setCanonRevisionStatus(f.creator,f.world.id,revId(revised),'published',key());
  await f.domain.setCanonRevisionStatus(f.creator,f.world.id,revId(first),'archived',key());
  await assert.rejects(()=>f.domain.setCanonRevisionStatus(f.creator,f.world.id,revId(first),'published',key()),/invalid_canon_revision_transition/);
  const oldSnapshot=await f.store.get<{snapshot_json:string}>('SELECT snapshot_json FROM canon_revision_records WHERE revision_id=? AND record_id=?',revId(first),cityOne.id);
  assert.match(oldSnapshot!.snapshot_json,/Harbor City/);
  assert.equal((await f.store.get<{status:string}>('SELECT status FROM canon_revisions WHERE id=?',revId(first)))!.status,'archived');
  assert.equal((await f.domain.canonRecords(f.creator,f.world.id)).items[0]!.slug,'city.core');
  const eventEntity=validateEntity({id:randomUUID(),kind:'location',name:'Revision test place',visibility:'campaign',data:{category:'city'}});
  const edit=await game.edit(f.creator,timelineOne.id,{revision:(await game.access(f.creator,timelineOne.id)).t.revision,entity:eventEntity},key());
  assert.equal((await f.store.get<{canon_revision_id:string}>('SELECT canon_revision_id FROM event_canon_bindings WHERE event_id=?',edit.eventId))!.canon_revision_id,revId(first));
  const context=await f.store.get<{canon_revision_id:string;configuration_json:string}>('SELECT canon_revision_id,configuration_json FROM event_world_context WHERE event_id=?',edit.eventId);
  assert.equal(context!.canon_revision_id,revId(first));
  assert.equal(JSON.parse(context!.configuration_json).timezone,'America/New_York');
 }finally{await f.close();}
});

test('campaign runtime policy is data-driven and Creator controls expose configuration boundaries',()=>{
 const campaign=defaultCampaignConfig('2012-06-01T12:00:00.000Z','America/New_York');
 campaign.enabledSystems.combat=false;campaign.technology.features.sms=false;campaign.needsIntensity='intense';campaign.injuryIntensity='restrained';campaign.lawEnforcement.posture='strict';
 const state={settings:{campaign}} as unknown as State;
 assert.throws(()=>enforceActionPolicy(state,{type:'combat'} as unknown as Action),/system_disabled/);
 assert.throws(()=>enforceActionPolicy(state,{type:'message',medium:'sms'} as unknown as Action),/technology_disabled/);
 assert.equal(needsRate(state),2);assert.equal(injuryRate(state),0.5);assert.equal(lawResponseMinutes(state,'authored-agency',10),5);
 const app=readFileSync('public/app.js','utf8'),engine=readFileSync('src/game/policy.ts','utf8')+readFileSync('src/game/actions.ts','utf8');
 assert.match(app,/system03Controls/);assert.match(app,/Explicit overrides \(JSON\)/);assert.match(app,/Snapshot current canon/);
 assert.doesNotMatch(engine,/Harbor City|Northpoint/);
});
