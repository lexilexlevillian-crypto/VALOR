import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game,checksum} from '../src/game/engine.ts';
import {validateEntity,data} from '../src/game/model.ts';

async function setup(){
 const f=await fixture(),game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
 const revision=async()=>(await game.access(f.creator,timeline.id)).t.revision;
 const room=validateEntity({id:randomUUID(),kind:'location',name:'Recovery room',visibility:'campaign',data:{}});
 const pc=validateEntity({id:randomUUID(),kind:'character',name:'Recovery player',visibility:'campaign',data:{playable:true,controllerUserId:f.player.id,locationId:room.id}});
 await game.bulkEdit(f.creator,timeline.id,{revision:await revision(),entities:[room,pc]},key());
 const turn=()=>revision().then(value=>game.turn(f.player,timeline.id,{revision:value,characterId:pc.id,action:{type:'look'}},key()));
 const editDescription=async(description:string)=>{const entity=structuredClone((await game.load(timeline.id)).entities.find(row=>row.id===pc.id)!);entity.data.description=description;return game.edit(f.creator,timeline.id,{revision:await revision(),entity},key());};
 return {...f,game,timeline,pc:pc.id,revision,turn,editDescription};
}

test('long history branches from a committed cursor without changing its parent',async()=>{
 const f=await setup();try{
  let origin:{turnCursor:string;eventId:string}|null=null;
  for(let index=0;index<25;index++){const result=await f.turn();if(index===4)origin=result;}
  assert.ok(origin);const parentBefore=await f.game.export(f.creator,f.timeline.id),parentRevision=await f.revision();
  const child=await f.game.branchFromHere(f.creator,f.timeline.id,{name:'Turn five future',cursor:origin.turnCursor});
  assert.equal(await f.revision(),parentRevision);assert.deepEqual(await f.game.export(f.creator,f.timeline.id),parentBefore);
  assert.equal((await f.game.transcript(child.id)).length,5);
  const lineage=await f.store.get<{parent_id:string;parent_save_id:string}>('SELECT parent_id,parent_save_id FROM timelines WHERE id=?',child.id);
  assert.equal(lineage?.parent_id,f.timeline.id);assert.ok(lineage?.parent_save_id);
  const commits=await f.store.get<{n:number}>('SELECT count(*) n FROM timeline_commit_history WHERE timeline_id=?',f.timeline.id);
  assert.equal(commits?.n,parentRevision);
 }finally{await f.close();}
});

test('safe-commit autosaves restore exact state and record integrity metadata',async()=>{
 const f=await setup();try{
  const first=await f.editDescription('Known checkpoint value');await f.editDescription('Later parent value');
  const restored=await f.game.branchFromHere(f.creator,f.timeline.id,{name:'Restored checkpoint',eventId:first.eventId});
  assert.equal((await f.game.load(restored.id)).entities.find(entity=>entity.id===f.pc)!.data.description,'Known checkpoint value');
  assert.equal((await f.game.load(f.timeline.id)).entities.find(entity=>entity.id===f.pc)!.data.description,'Later parent value');
  const save=await f.store.get<{save_id:string;state_checksum:string}>('SELECT save_id,state_checksum FROM timeline_commit_history WHERE timeline_id=? AND event_id=?',f.timeline.id,first.eventId);
  assert.ok(save?.save_id);assert.equal(save?.state_checksum.length,64);
  const compatibility=await f.game.saveCompatibility(f.creator,f.timeline.id,save!.save_id);
  assert.equal(compatibility.projectionRebuild,'validated');assert.equal(compatibility.metadata?.eventCursor,first.turnCursor);
 }finally{await f.close();}
});

test('import dry-run reports collisions and requires an unchanged confirmation token at the API boundary',async()=>{
 const f=await setup();try{
  await f.turn();const bundle=await f.game.export(f.creator,f.timeline.id),before=(await f.store.get<{n:number}>('SELECT count(*) n FROM timelines WHERE campaign_id=?',f.campaign.id))!.n;
  const malformed=structuredClone(bundle);malformed.payload.state.clock='2012-07-01T00:00:00Z';
  await assert.rejects(()=>f.game.import(f.creator,f.timeline.id,'Malformed',malformed,true),/checksum/);
  const preview=await f.game.import(f.creator,f.timeline.id,'Recovered copy',bundle,true) as {valid:true;confirmationToken:string;idCollisions:string[];changes:string[];overwritesLiveCampaign:boolean};
  assert.equal(preview.valid,true);assert.ok(preview.idCollisions.length>0);assert.equal(preview.overwritesLiveCampaign,false);assert.ok(preview.changes.includes('create-child-timeline'));
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM timelines WHERE campaign_id=?',f.campaign.id))!.n,before);
  const imported=await f.game.import(f.creator,f.timeline.id,'Recovered copy',bundle,false,preview.confirmationToken) as {id:string};
  assert.ok(imported.id);assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM timelines WHERE campaign_id=?',f.campaign.id))!.n,before+1);
  await assert.rejects(()=>f.game.import(f.creator,f.timeline.id,'Replay',bundle,false,preview.confirmationToken),/confirmation_used/);
 }finally{await f.close();}
});

test('legacy upgraded saves remain readable and versioned exports expose compatibility dependencies',async()=>{
 const f=await setup();try{
  const manual=await f.game.save(f.creator,f.timeline.id,{name:'Versioned checkpoint'});
  const compatibility=await f.game.saveCompatibility(f.creator,f.timeline.id,manual.id);assert.equal(compatibility.metadata?.schemaVersion,1);assert.deepEqual(compatibility.migrations,[]);
  const bundle=await f.game.export(f.creator,f.timeline.id,{mediaStrategy:'references'});
  assert.equal(bundle.manifest.formatVersion,2);assert.equal(bundle.manifest.schemaVersion,49);assert.equal(bundle.manifest.mediaStrategy,'references');assert.equal(bundle.manifest.visibility,'preserved');assert.equal(bundle.manifest.payloadChecksum,checksum(bundle.payload));
  const legacy={payload:structuredClone(bundle.payload),checksum:checksum(bundle.payload)};
  const preview=await f.game.import(f.creator,f.timeline.id,'Upgraded legacy export',legacy,true) as {migrations:string[]};
  assert.ok(preview.migrations.includes('legacy-export-envelope'));assert.ok(preview.migrations.includes('legacy-snapshot-metadata-defaults'));
  const legacyId=randomUUID();await f.store.run('INSERT INTO saves VALUES (?,?,?,?,?,?,?,?,?)',legacyId,f.timeline.id,'Legacy checkpoint',1,JSON.stringify(legacy.payload),legacy.checksum,f.creator.id,new Date().toISOString(),0);
  const legacyCompatibility=await f.game.saveCompatibility(f.creator,f.timeline.id,legacyId);assert.ok(legacyCompatibility.migrations.includes('legacy-v1-metadata-defaults'));
  // Schema-47 saves with metadata must be verified before adding new defaults.
  const historicalCore=structuredClone(legacy.payload);delete historicalCore.state.settings.narrationAttempts;
  for(const entity of historicalCore.state.entities)if(entity.kind==='character')delete entity.data.perception;
  const historical={...historicalCore,metadata:{...compatibility.metadata!,contentChecksum:checksum(historicalCore)}},historicalId=randomUUID();
  await f.store.run('INSERT INTO saves VALUES (?,?,?,?,?,?,?,?,?)',historicalId,f.timeline.id,'Pre-System-2 metadata',historical.metadata.revision,JSON.stringify(historical),checksum(historical),f.creator.id,new Date().toISOString(),0);
  assert.equal((await f.game.saveCompatibility(f.creator,f.timeline.id,historicalId)).projectionRebuild,'validated');
  const restored=await f.game.branch(f.creator,f.timeline.id,historicalId,'Older metadata restored');
  assert.equal(data((await f.game.load(restored.id)).entities.find(entity=>entity.id===f.pc)!,'character').perception.hearing,100);
 }finally{await f.close();}
});

test('campaign duplication copies settings and state while recording independent lineage',async()=>{
 const f=await setup();try{
  await f.editDescription('Duplicated state');const source=await f.game.export(f.creator,f.timeline.id);
  const duplicate=await f.game.duplicateCampaign(f.creator,f.timeline.id,'Recovery copy');
  assert.deepEqual(await f.game.export(f.creator,f.timeline.id),source);
  assert.equal((await f.game.load(duplicate.timelineId)).entities.find(entity=>entity.id===f.pc)!.data.description,'Duplicated state');
  const lineage=await f.store.get<{parent_campaign_id:string;source_timeline_id:string}>('SELECT parent_campaign_id,source_timeline_id FROM campaign_duplicate_lineage WHERE child_campaign_id=?',duplicate.campaignId);
  assert.deepEqual(lineage,{parent_campaign_id:f.campaign.id,source_timeline_id:f.timeline.id});
 }finally{await f.close();}
});
