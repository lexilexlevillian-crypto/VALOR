import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fixture,key} from './helpers.ts';
import {Store} from '../src/db.ts';
import {Game} from '../src/game/engine.ts';
import {foundationCommandSchema,foundationCommandTypes,foundationEventTypes} from '../src/foundation-vocabulary.ts';
import {FoundationAuthority} from '../src/foundation-authority.ts';

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
 const command=foundationCommandSchema.parse({commandId:key(),type:'CreateCharacter',aggregateId:key(),expectedRevision:1,idempotencyKey:key(),payload:{timelineId:key(),definition:{character:{name:'Fixture'}}}});
 assert.equal(command.type,'CreateCharacter');
 assert.throws(()=>foundationCommandSchema.parse({...command,unexpected:true}),/unrecognized|invalid/i);
 assert.throws(()=>foundationCommandSchema.parse({...command,payload:{...command.payload,clientSeed:'not-authoritative'}}),/unrecognized|invalid/i);
});

test('System 01 command authority validates, authorizes, records outcomes, replays, and builds every read projection',async()=>{
 const f=await fixture(),game=new Game(f.store),authority=new FoundationAuthority(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);
  const command={
   commandId:key(),type:'CreateCharacter' as const,aggregateId:timeline.id,expectedRevision:1,idempotencyKey:key(),
   payload:{timelineId:timeline.id,definition:{character:{name:'Command character',description:'Server-owned character',data:{}}}}
  };
  const created=await authority.execute(f.creator,command);
  assert.equal(created.type,'CharacterCreated');
  assert.deepEqual(await authority.execute(f.creator,command),created);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM foundation_commands WHERE id=?',command.commandId))!.n,1);
  const event=await f.store.get<{type:string;seed:string;source_event_id:string;schema_version:number}>('SELECT type,seed,source_event_id,schema_version FROM foundation_events WHERE command_id=?',command.commandId);
  assert.equal(event!.type,'CharacterCreated');assert.equal(event!.schema_version,1);
  assert.equal(event!.seed,(await f.store.get<{seed:string}>('SELECT seed FROM game_events WHERE id=?',event!.source_event_id))!.seed);
  await assert.rejects(()=>f.store.run("UPDATE foundation_events SET type='CharacterEdited' WHERE command_id=?",command.commandId),/immutable/);

  const characterId=String((created.outcome as {characterId:string}).characterId);
  const projections=await game.projections(f.creator,timeline.id,characterId);
  assert.deepEqual(Object.keys(projections).sort(),['caseFile','chronicle','inventory','map','npcProfile','phoneInbox','roster','schemaVersion','timeline'].sort());
  assert.equal(projections.roster.characters[0]?.id,characterId);

  const controlled=structuredClone((await game.load(timeline.id)).entities.find(item=>item.id===characterId)!);
  controlled.data.controllerUserId=f.player.id;
  await game.edit(f.creator,timeline.id,{revision:(await game.access(f.creator,timeline.id)).t.revision,entity:controlled},key());
  const playerCommand={commandId:key(),type:'AdvanceWorldTime' as const,aggregateId:timeline.id,expectedRevision:(await game.access(f.player,timeline.id)).t.revision,idempotencyKey:key(),payload:{timelineId:timeline.id,characterId,minutes:1}};
  await authority.execute(f.player,playerCommand);
  const revoked=structuredClone((await game.load(timeline.id)).entities.find(item=>item.id===characterId)!);
  revoked.data.controllerUserId=f.creator.id;
  await game.edit(f.creator,timeline.id,{revision:(await game.access(f.creator,timeline.id)).t.revision,entity:revoked},key());
  await assert.rejects(()=>authority.execute(f.player,playerCommand),/character_not_controlled/);

  const current=(await game.access(f.creator,timeline.id)).t.revision;
  const saveCommand={commandId:key(),type:'CreateSave' as const,aggregateId:timeline.id,expectedRevision:current,idempotencyKey:key(),payload:{timelineId:timeline.id,name:'Foundation checkpoint'}};
  const saved=await authority.execute(f.creator,saveCommand);
  assert.equal(saved.type,'SaveCreated');
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM foundation_events'))!.n,3);
  assert.ok((await f.store.get<{n:number}>('SELECT count(*) n FROM artifact_schema_versions WHERE artifact_type IN (?,?,?)','foundation_command','foundation_event','foundation_command_receipt'))!.n>=6);
  const registered=new Set((await f.store.all<{artifact_type:string}>('SELECT DISTINCT artifact_type FROM artifact_schema_versions WHERE scope_type=? AND scope_id=?','campaign',f.campaign.id)).map(row=>row.artifact_type));
  for(const type of ['campaign','membership','timeline','game_entity','character_profile_schema','game_event','story_turn','save','game_receipt','game_outbox','foundation_command','foundation_event','foundation_command_receipt'])assert.ok(registered.has(type),'missing artifact schema: '+type);

  const entity=(await game.load(timeline.id)).entities.find(item=>item.id===characterId)!;
  const denied={commandId:key(),type:'EditCharacter' as const,aggregateId:timeline.id,expectedRevision:current,idempotencyKey:key(),payload:{timelineId:timeline.id,entity}};
  await assert.rejects(()=>authority.execute(f.player,denied),/forbidden/);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM foundation_commands WHERE id=?',denied.commandId))!.n,0);
 }finally{await f.close();}
});
