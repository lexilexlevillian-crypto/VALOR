import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {observerView,retrieve} from '../src/game/epistemics.ts';
import {validateEntity,type Entity,type Kind} from '../src/game/model.ts';

async function scenario(){
 const f=await fixture(),game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
 const revision=async()=>(await game.access(f.creator,timeline.id)).t.revision;
 async function add(kind:Kind,name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign'){
  const entity=validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
  await game.edit(f.creator,timeline.id,{revision:await revision(),entity},key());return entity.id;
 }
 async function edit(id:string,changes:Record<string,unknown>){
  const entity=structuredClone((await game.load(timeline.id)).entities.find(row=>row.id===id)!);Object.assign(entity.data,changes);
  await game.edit(f.creator,timeline.id,{revision:await revision(),entity},key());return entity;
 }
 const room=await add('location','Archive room',{category:'room'}),elsewhere=await add('location','Elsewhere',{category:'room'});
 const pc=await add('character','Player witness',{playable:true,controllerUserId:f.player.id,locationId:room,condition:'conscious'});
 const witness=await add('character','Witness',{playable:false,locationId:room,condition:'conscious'});
 const absent=await add('character','Absent NPC',{playable:false,locationId:elsewhere,condition:'conscious'});
 return {...f,game,timeline,revision,add,edit,room,elsewhere,pc,witness,absent};
}

test('System 14 keeps unwitnessed truth out of knowledge and preserves a false rumor as belief',async()=>{
 const f=await scenario();try{
  const evidence=await f.add('evidence','Security photograph',{locationId:f.room,discoveredBy:[f.pc],custody:[]});
  const truth=await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'truth',subjectId:f.pc,text:'The player opened the sealed door.',predicate:'opened',objectId:evidence,value:{door:'sealed'},qualifiers:{method:'key'},source:'deterministic-simulation',truthStatus:'verified',audience:['campaign'],confidence:1,observedAt:'2012-06-01T12:00:00.000Z',learnedAt:null,validFrom:'2012-06-01T12:00:00.000Z',validUntil:null,evidenceIds:[evidence],tags:['door']},key());
  const factId=truth.recordId as string;
  await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'knowledge',subjectId:f.witness,text:'Witnessed it',factId,confidence:0.95,source:'direct observation',evidenceIds:[evidence]},key());
  let state=await f.game.load(f.timeline.id);
  assert.ok(state.knowledge.some(row=>row.observerId===f.witness&&row.factId===factId));
  assert.ok(!state.knowledge.some(row=>row.observerId===f.absent&&row.factId===factId),'an absent NPC must not learn unwitnessed truth');
  const authored=await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'belief',subjectId:f.witness,propositionSubjectId:f.pc,text:'The player burned the archive.',predicate:'burned',value:false,qualifiers:{certainty:'hearsay'},confidence:0.8,source:'unverified rumor',truthStatus:'believed',audience:[f.witness],tags:['rumor']},key());
  const beliefId=authored.recordId as string;
  const relayed=await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'gossip',subjectId:f.witness,targetId:f.absent,recordId:beliefId,text:'Relay rumor',confidence:0.7},key());
  state=await f.game.load(f.timeline.id);const rumor=state.beliefs.find(row=>row.id===relayed.recordId)!;
  assert.equal(rumor.observerId,f.absent);assert.equal(rumor.subjectId,f.pc);assert.equal(rumor.predicate,'burned');assert.equal(rumor.truthStatus,'believed');assert.equal(rumor.value,false);assert.ok(Math.abs(rumor.confidence-0.56)<1e-9);
  assert.match(rumor.source,new RegExp('^gossip-from:'+f.witness));assert.ok(!state.knowledge.some(row=>row.observerId===f.absent&&row.factId===factId));
  assert.equal(state.facts.length,1,'gossip must not manufacture canon');assert.ok(retrieve(state,f.absent,'burned rumor').beliefs.some(row=>row.id===rumor.id));
  await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'correct-belief',subjectId:f.absent,recordId:rumor.id,factId,text:'Correct the rumor'},key());
  state=await f.game.load(f.timeline.id);assert.equal(state.beliefs.find(row=>row.id===rumor.id)!.truthStatus,'disproven');assert.ok(state.knowledge.some(row=>row.observerId===f.absent&&row.factId===factId));
 }finally{await f.close();}
});

test('System 14 decays, conditionally recalls, and refreshes episodic memory',async()=>{
 const f=await scenario();try{
  const created=await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'memory',subjectId:f.pc,text:'Rain hammered the archive windows.',interpretation:'The storm made the witness uneasy.',salience:1,decayPerDay:1,privacy:'private',recallConditions:{entityIds:[f.room],tags:['rain'],locationId:f.room},tags:['storm']},key());
  const memoryId=created.recordId as string;
  await f.game.turn(f.player,f.timeline.id,{revision:await f.revision(),characterId:f.pc,action:{type:'wait',minutes:1440}},key());
  let state=await f.game.load(f.timeline.id),view=observerView(state,f.pc),memory=view.memories.find(row=>row.id===memoryId)!;
  assert.equal(memory.currentSalience,0);assert.equal(retrieve(state,f.pc,'rain',12,[],{placeIds:[f.room],tags:['storm']}).memories.some(row=>row.id===memoryId),false);
  await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'refresh-memory',subjectId:f.pc,recordId:memoryId,text:'',salience:0.9},key());
  state=await f.game.load(f.timeline.id);view=observerView(state,f.pc);memory=view.memories.find(row=>row.id===memoryId)!;
  assert.equal(memory.currentSalience,0.9);assert.equal(memory.refreshCount,1);assert.equal(memory.lastRefreshedAt,state.clock);
  assert.ok(retrieve(state,f.pc,'rain',12,[],{placeIds:[f.room],tags:['storm']}).memories.some(row=>row.id===memoryId));
  assert.ok(!retrieve(state,f.pc,'rain',12,[],{placeIds:[f.elsewhere],tags:['storm']}).memories.some(row=>row.id===memoryId),'recall conditions must be honored');
 }finally{await f.close();}
});

test('System 14 filters before semantic ranking and reports Story Card lifecycle provenance',async()=>{
 const f=await scenario();try{
  const evidence=await f.add('evidence','Bell ledger',{locationId:f.room,discoveredBy:[f.pc],custody:[]});
  const common={description:'A brass bell marked the old archive hours.',source:'Curator',sourceRefs:['catalog:bell-1'],tags:['history','bell'],priority:4,scope:{placeIds:[f.room]},links:[evidence],linkDetails:[{targetId:evidence,type:'evidence',note:'Catalog ledger'}],validFrom:'2012-01-01T00:00:00.000Z',validUntil:'2013-01-01T00:00:00.000Z'};
  const first=await f.add('lore','Bell account A',common),second=await f.add('lore','Bell account B',common);
  const secret=await f.add('lore','Restricted bell account',{...common,description:'SYSTEM14_SECRET_MARKER',priority:100},'creator');
  const active=await f.add('storycard','Bell scene directive',{...common,description:'Let the bell interrupt once.',activation:{mode:'all',keywords:['bell']},deactivation:{mode:'any',keywords:['silence'],reason:'The bell has been silenced.'}});
  const misplaced=await f.add('storycard','Elsewhere directive',{description:'Only elsewhere.',source:'Creator',tags:['history'],scope:{placeIds:[f.elsewhere]},activation:{mode:'always'}});
  const filters={placeIds:[f.room],tags:['history'],evidenceIds:[evidence],kinds:['lore','storycard'] as Array<'lore'|'storycard'>};
  const result=await f.game.semanticRetrieval(f.player,f.timeline.id,f.pc,'bell',filters,false),serialized=JSON.stringify(result);
  assert.ok(result.sources.some(row=>row.id===active));assert.ok(result.sources.some(row=>row.id===first));assert.ok(result.sources.some(row=>row.id===second));assert.ok(!result.sources.some(row=>row.id===secret));assert.doesNotMatch(serialized,/SYSTEM14_SECRET_MARKER/);
  const tied=result.sources.filter(row=>row.id===first||row.id===second).map(row=>row.id);assert.deepEqual(tied,[first,second].sort(),'equal scores must use stable ID ordering');
  const provenance=result.sources.find(row=>row.id===active)!.provenance as {activation:{reason:string};sourceRefs:string[];links:Array<{targetId:string}>};assert.equal(provenance.activation.reason,'active');assert.deepEqual(provenance.sourceRefs,['catalog:bell-1']);assert.equal(provenance.links[0]!.targetId,evidence);
  const developer=await f.game.semanticRetrieval(f.creator,f.timeline.id,f.pc,'bell',filters,true);assert.ok(developer.rejected.some(row=>row.id===secret&&row.reason==='permission-filtered'));assert.equal((await f.game.semanticRetrieval(f.player,f.timeline.id,f.pc,'bell',{...filters,from:'2014-01-01T00:00:00.000Z'},false)).sources.some(row=>row.id===first),false);
  const stopped=await f.game.semanticRetrieval(f.creator,f.timeline.id,f.pc,'bell silence',filters,true);assert.ok(stopped.rejected.some(row=>row.id===active&&row.reason==='deactivated'));
  const scopeInspection=await f.game.semanticRetrieval(f.creator,f.timeline.id,f.pc,'',{},true);assert.ok(scopeInspection.rejected.some(row=>row.id===misplaced&&row.reason==='scope-mismatch'));
  await f.edit(first,{description:'The restored brass bell marked every archive hour.'});
  const versions=await f.store.all<{revision:number;data_json:string}>('SELECT revision,data_json FROM lore_versions WHERE timeline_id=? AND entity_id=? ORDER BY revision',f.timeline.id,first);
  assert.equal(versions.length,2);assert.deepEqual(versions.map(row=>row.revision),[1,2]);assert.match(versions[0]!.data_json,/old archive hours/);assert.match(versions[1]!.data_json,/restored brass bell/);
  await assert.rejects(()=>f.store.run('UPDATE lore_versions SET name=? WHERE timeline_id=? AND entity_id=? AND revision=?','tampered',f.timeline.id,first,1),/immutable lore version/);
  await assert.rejects(()=>f.store.run('DELETE FROM lore_versions WHERE timeline_id=? AND entity_id=? AND revision=?',f.timeline.id,first,1),/immutable lore version/);
 }finally{await f.close();}
});
