import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fixture,key} from './helpers.ts';
import {Store} from '../src/db.ts';
import {Game} from '../src/game/engine.ts';
import {foundationCommandSchema,foundationCommandTypes,foundationEventTypes} from '../src/foundation-vocabulary.ts';

test('System 01 registers durable artifact schema versions and survives backup recovery',async()=>{
 const f=await fixture();
 try{
  const record=await f.execute({type:'record.create',kind:'system01',name:'Versioned artifact',visibility:'campaign'});
  const timeline=await new Game(f.store).initialize(f.creator,f.campaign.id);
  const recordVersion=await f.store.get<{schema_version:number;scope_type:string;scope_id:string}>(
   'SELECT schema_version,scope_type,scope_id FROM artifact_schema_versions WHERE artifact_type=? AND artifact_id=?','record',record.id);
  assert.deepEqual(recordVersion,{schema_version:1,scope_type:'campaign',scope_id:f.campaign.id});
  const timelineVersion=await f.store.get<{schema_version:number;scope_id:string}>(
   'SELECT schema_version,scope_id FROM artifact_schema_versions WHERE artifact_type=? AND artifact_id=?','timeline',timeline.id);
  assert.deepEqual(timelineVersion,{schema_version:1,scope_id:f.campaign.id});
  const destination=join(f.dir,'system01-recovery.sqlite');
  await f.store.backupTo(destination);

  const restored=new Store(destination);
  try{
   await restored.migrate();
   assert.ok((await restored.get<{n:number}>('SELECT count(*) n FROM artifact_schema_versions WHERE scope_id=?',f.campaign.id))!.n>0);
   assert.equal((await restored.get<{schema_version:number}>('SELECT schema_version FROM artifact_schema_versions WHERE artifact_type=? AND artifact_id=?','record',record.id))!.schema_version,1);
  }finally{restored.close();}
 }finally{await f.close();}
});

test('System 01 migration is additive and failed transactions leave artifact metadata unchanged',async()=>{
 const f=await fixture();
 try{
  const before=(await f.store.get<{n:number}>('SELECT count(*) n FROM artifact_schema_versions'))!.n;
  await assert.rejects(()=>f.store.transaction(async()=>{
   await f.store.run('INSERT INTO records(id,world_id,owner_id,kind,name,visibility,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)',key(),f.world.id,f.creator.id,'rollback','Never committed','creator','now','now',f.creator.id,f.creator.id);
   throw new Error('forced_system01_rollback');
  }),/forced_system01_rollback/);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM artifact_schema_versions'))!.n,before);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM records WHERE kind=?','rollback'))!.n,0);
 }finally{await f.close();}
});

test('System 01 exposes the stable command/event vocabulary with strict envelopes',()=>{
 assert.equal(foundationCommandTypes.length,15);
 assert.equal(foundationEventTypes.length,15);
 const command=foundationCommandSchema.parse({commandId:key(),type:'CreateCharacter',aggregateId:null,expectedRevision:null,idempotencyKey:key(),payload:{name:'Fixture'}});
 assert.equal(command.type,'CreateCharacter');
 assert.throws(()=>foundationCommandSchema.parse({...command,unexpected:true}),/unrecognized|invalid/i);
});