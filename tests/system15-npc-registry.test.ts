import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
import type {Entity,Kind} from '../src/game/model.ts';
import {Store} from '../src/db.ts';
import {Domain} from '../src/domain.ts';
import {provisionUser} from '../src/auth.ts';
import {cleanupTestDirectory} from './cleanup.ts';

async function scenario(){
 const f=await fixture(),game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id);
 const revision=async()=>(await game.access(f.creator,timeline.id)).t.revision;
 async function add(kind:Kind,name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign'){
  const entity=validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
  await game.edit(f.creator,timeline.id,{revision:await revision(),entity},key());return entity;
 }
 const room=await add('location','Registry room',{category:'room'}),faction=await add('faction','Night staff',{category:'crew'});
 const pc=await add('character','Player',{playable:true,controllerUserId:f.player.id,locationId:room.id,condition:'conscious'});
 return {...f,game,timeline,revision,add,room,faction,pc};
}

test('System 15 Creator registry supports the complete NPC filter surface and durable dossier media references',async()=>{
 const f=await scenario();try{
  const portrait=await f.add('media','Portrait',{mime:'image/png',body:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',alt:'A registry portrait'});
  const npc=await f.add('character','Morgan Vale',{legalName:'Morgan Vale',aliases:['Mo','Night Clerk'],locationId:f.room.id,factionIds:[f.faction.id],condition:'conscious',registryStatus:'active',arrested:true,lastActiveAt:'2012-06-01T13:00:00.000Z',tags:['witness','night'],employerOccupation:'Night clerk',
   occupations:[{id:randomUUID(),businessId:null,placeOfWork:'Corner Market',position:'Night clerk',days:['Monday'],shift:'night',startMinute:1320,endMinute:360,notes:'Closes alone'}],
   schedule:[{id:randomUUID(),minute:1320,locationId:f.room.id,activity:'Close the market',days:[1]}],portraitMediaId:portrait.id,mediaIds:[]});
  const relationship=await f.add('relationship','Player contact',{fromId:f.pc.id,toId:npc.id,labels:['trusted contact'],secret:false});
  await f.add('injury','Bandaged arm',{characterId:npc.id,bodyPart:'arm',category:'cut',severity:5,startedAt:'2012-06-01T12:30:00.000Z'});
  const filters=[
   {query:'night clerk'},{status:'active' as const},{locationId:f.room.id},{factionId:f.faction.id},{relationship:'trusted'},
   {job:'corner market'},{schedule:'close the market'},{scheduled:true},{tags:['witness','night']},{visibility:'campaign' as const},
   {alive:true},{injured:true},{arrested:true},{lastActiveFrom:'2012-06-01T12:59:00.000Z'},{lastActiveUntil:'2012-06-01T13:01:00.000Z'},{archive:'all' as const}
  ];
  for(const filter of filters)assert.deepEqual((await f.game.npcRegistry(f.creator,f.timeline.id,filter)).items.map(row=>row.id),[npc.id],JSON.stringify(filter));
  await assert.rejects(()=>f.game.npcRegistry(f.player,f.timeline.id,{}),error=>(error as Error).message==='forbidden');
  const dossier=await f.game.creatorNpcProfile(f.creator,f.timeline.id,npc.id);
  assert.equal(dossier.kind,'creator-dossier');assert.equal(dossier.canonicalSource,'authored-record');assert.equal(dossier.mediaReferences.portrait?.id,portrait.id);assert.equal(dossier.mediaReferences.media.length,0);
  assert.ok(dossier.references.some(reference=>reference.id===relationship.id));assert.equal((await f.store.get<{schema_version:number}>('SELECT schema_version FROM character_profile_schema_versions WHERE character_id=?',npc.id))!.schema_version,6);
  const reloaded=(await new Game(f.store).npcRegistry(f.creator,f.timeline.id,{query:'Mo'})).items[0]!;assert.equal(reloaded.id,npc.id);
 }finally{await f.close();}
});

test('System 15 player profile is generated only from authored-permitted and learned fields',async()=>{
 const f=await scenario();try{
  const knowledgeSection=randomUUID(),npc=await f.add('character','Visible stranger',{legalName:'Secret Legal Name',aliases:['Whisper'],appearanceDescription:'A red coat.',secrets:'Never expose',locationId:f.room.id,condition:'conscious',
   profileVisibility:{legalName:'creator',aliases:'knowledge',appearanceDescription:'campaign'},sections:[{id:knowledgeSection,name:'Learned details',kind:'identity',parentId:null,position:0,visibility:'knowledge',helpText:'',editable:true,repeatable:false,archived:false,fields:[
    {id:randomUUID(),name:'Known habit',position:0,type:'text',visibility:'knowledge',value:'Counts exits',helpText:'',editable:true,repeatable:false,classification:'biographical',archived:false},
    {id:randomUUID(),name:'Creator secret',position:1,type:'text',visibility:'creator',value:'Hidden',helpText:'',editable:true,repeatable:false,classification:'subjective',archived:false}
   ]}]});
  let profile=await f.game.playerNpcProfile(f.player,f.timeline.id,npc.id,f.pc.id);
  assert.equal(profile.kind,'player-presentation');assert.equal(profile.canonicalSource,'authored-and-learned-fields');assert.equal(profile.entity.data.appearanceDescription,'A red coat.');
  assert.equal('legalName' in profile.entity.data,false);assert.equal('aliases' in profile.entity.data,false);assert.equal('secrets' in profile.entity.data,false);assert.deepEqual(profile.entity.data.sections,[]);
  const truth=await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'truth',subjectId:npc.id,text:'The player learned an alias.',predicate:'alias',value:'Whisper',audience:[f.pc.id]},key());
  await f.game.epistemic(f.creator,f.timeline.id,await f.revision(),{layer:'knowledge',subjectId:f.pc.id,text:'Learn alias',factId:String(truth.recordId)},key());
  profile=await f.game.playerNpcProfile(f.player,f.timeline.id,npc.id,f.pc.id);
  assert.deepEqual(profile.entity.data.aliases,['Whisper']);assert.equal('legalName' in profile.entity.data,false);
  const fields=(profile.entity.data.sections as Array<{fields:Array<{name:string}>}>).flatMap(section=>section.fields);assert.deepEqual(fields.map(field=>field.name),['Known habit']);
  const dossier=await f.game.creatorNpcProfile(f.creator,f.timeline.id,npc.id);assert.equal(dossier.entity.data.legalName,'Secret Legal Name');assert.equal(dossier.entity.data.secrets,'Never expose');
 }finally{await f.close();}
});

test('System 15 merge previews conflicts, remaps live references, preserves events, archives the source, and reverses safely',async()=>{
 const f=await scenario();try{
  const source=await f.add('character','Morgan duplicate',{legalName:'Morgan A',aliases:['Mo'],notes:'Source dossier',locationId:f.room.id,condition:'conscious'});
  const target=await f.add('character','Morgan canonical',{legalName:'Morgan B',aliases:['Vale'],notes:'Target dossier',locationId:f.room.id,condition:'conscious'});
  const relationship=await f.add('relationship','Duplicate contact',{fromId:f.pc.id,toId:source.id,labels:['contact'],secret:false});
  const eventBefore=await f.store.get<{id:string}>('SELECT id FROM game_events WHERE timeline_id=? AND instr(input_json,?)>0 ORDER BY rowid LIMIT 1',f.timeline.id,source.id);assert.ok(eventBefore);
  const preview=await f.game.previewNpcMerge(f.creator,f.timeline.id,source.id,target.id);assert.ok(preview.conflicts.some(conflict=>conflict.path==='name'));assert.ok(preview.references.source.some(reference=>reference.id===relationship.id));assert.equal(preview.eventPolicy,'immutable-events-retain-original-character-id');
  const resolution=Object.fromEntries(preview.conflicts.map(conflict=>[conflict.path,conflict.path==='data.notes'?'source':'target'])) as Record<string,'source'|'target'>;
  const merged=await f.game.mergeNpcs(f.creator,f.timeline.id,{revision:await f.revision(),sourceNpcId:source.id,targetNpcId:target.id,resolution},key());
  let state=await f.game.load(f.timeline.id),archived=state.entities.find(entity=>entity.id===source.id)!,canonical=state.entities.find(entity=>entity.id===target.id)!,relation=state.entities.find(entity=>entity.id===relationship.id)!;
  assert.equal(archived.archived,true);assert.equal(archived.data.mergedIntoId,target.id);assert.equal(archived.data.mergeRecordId,merged.mergeId);assert.equal(canonical.data.notes,'Source dossier');assert.ok((canonical.data.aliases as string[]).includes('Morgan duplicate'));assert.equal(relation.data.toId,target.id);
  assert.ok(await f.store.get('SELECT id FROM game_events WHERE id=? AND instr(input_json,?)>0',eventBefore.id,source.id),'immutable source event remains attached');
  const mergeRow=await f.store.get<{reversed_at:string|null}>('SELECT reversed_at FROM npc_merge_records WHERE id=?',merged.mergeId);assert.equal(mergeRow!.reversed_at,null);
  await f.game.reverseNpcMerge(f.creator,f.timeline.id,{revision:await f.revision(),mergeId:merged.mergeId},key());
  state=await f.game.load(f.timeline.id);archived=state.entities.find(entity=>entity.id===source.id)!;relation=state.entities.find(entity=>entity.id===relationship.id)!;
  assert.equal(archived.archived,false);assert.equal(relation.data.toId,source.id);assert.ok((await f.store.get<{reversed_at:string|null}>('SELECT reversed_at FROM npc_merge_records WHERE id=?',merged.mergeId))!.reversed_at);
 }finally{await f.close();}
});

test('System 15 blocks generic deletion of a living referenced NPC and requires an explicit narrative strategy',async()=>{
 const f=await scenario();try{
  const npc=await f.add('character','Referenced witness',{legalName:'Referenced Witness',locationId:f.room.id,condition:'conscious'});
  const relationship=await f.add('relationship','Witness link',{fromId:f.pc.id,toId:npc.id,labels:['witness'],secret:false});
  const archived=structuredClone(npc);archived.archived=true;
  const archiveRevision=await f.revision();await assert.rejects(()=>f.game.edit(f.creator,f.timeline.id,{revision:archiveRevision,entity:archived},key()),error=>(error as Error).message==='entity_has_active_references');
  await f.game.retireNpc(f.creator,f.timeline.id,{revision:await f.revision(),npcId:npc.id,strategy:'retirement',narrative:'The witness leaves the city under protection.'},key());
  const state=await f.game.load(f.timeline.id),saved=state.entities.find(entity=>entity.id===npc.id)!,link=state.entities.find(entity=>entity.id===relationship.id)!;
  assert.equal(saved.archived,true);assert.equal(saved.data.registryStatus,'retired');assert.equal(saved.data.retirementNarrative,'The witness leaves the city under protection.');assert.equal(link.data.toId,npc.id);
  const record=await f.store.get<{strategy:string;narrative:string}>('SELECT strategy,narrative FROM npc_retirement_records WHERE npc_id=?',npc.id);assert.deepEqual(record,{strategy:'retirement',narrative:'The witness leaves the city under protection.'});
 }finally{await f.close();}
});

test('System 15 renames do not break ID-based NPC links',async()=>{
 const f=await scenario();try{
  const npc=await f.add('character','Old Name',{aliases:['Earlier Name'],locationId:f.room.id,condition:'conscious'}),relationship=await f.add('relationship','Stable link',{fromId:f.pc.id,toId:npc.id,labels:['contact'],secret:false});
  const renamed=structuredClone(npc);renamed.name='New Name';renamed.data.aliases=['Old Name','Earlier Name'];
  await f.game.edit(f.creator,f.timeline.id,{revision:await f.revision(),entity:renamed},key());
  const state=await f.game.load(f.timeline.id);assert.equal(state.entities.find(entity=>entity.id===relationship.id)!.data.toId,npc.id);
  assert.deepEqual((await f.game.npcRegistry(f.creator,f.timeline.id,{query:'Old Name'})).items.map(row=>row.id),[npc.id]);assert.deepEqual((await f.game.npcRegistry(f.creator,f.timeline.id,{query:'New Name'})).items.map(row=>row.id),[npc.id]);
 }finally{await f.close();}
});

test('System 15 migrates persisted schema-v4 NPCs without losing authored identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valor-system15-migration-')),store=new Store(join(dir,'legacy.sqlite'));
 try{
  await store.migrate(25);const creator=await provisionUser(store,{email:'migration@example.test',password:'Migration passphrase 123!',role:'creator'}),domain=new Domain(store),world=await domain.createWorld(creator,'Legacy world',key()),campaign=await domain.createCampaign(creator,{worldId:world.id,name:'Legacy campaign',startingAt:'2012-06-01T12:00:00Z',timezone:'America/New_York'},key()),game=new Game(store),timeline=await game.initialize(creator,campaign.id);
  const npc=validateEntity({id:randomUUID(),kind:'character',name:'Durable legacy NPC',visibility:'campaign',data:{legalName:'Authored Legacy Name',aliases:['Legacy'],condition:'conscious'}});
  await game.edit(creator,timeline.id,{revision:1,entity:npc},key());
  await store.run("UPDATE game_entities SET data_json=json_remove(json_set(data_json,'$.characterSchemaVersion',4),'$.registryStatus','$.profileVisibility','$.lastActiveAt','$.arrested','$.retirementNarrative','$.mergedIntoId','$.mergeRecordId','$.portraitMediaId'),updated_at=? WHERE timeline_id=? AND id=?",new Date().toISOString(),timeline.id,npc.id);
  assert.equal((await store.get<{schema_version:number}>('SELECT schema_version FROM character_profile_schema_versions WHERE character_id=?',npc.id))!.schema_version,4);
  await store.migrate();const loaded=(await new Game(store).load(timeline.id)).entities.find(entity=>entity.id===npc.id)!;
  assert.equal(loaded.data.characterSchemaVersion,6);assert.equal(loaded.data.registryStatus,'active');assert.equal(loaded.data.legalName,'Authored Legacy Name');assert.deepEqual(loaded.data.aliases,['Legacy']);assert.equal((loaded.data.profileVisibility as Record<string,string>).legalName,'campaign');
  assert.equal((await store.get<{schema_version:number}>('SELECT schema_version FROM character_profile_schema_versions WHERE character_id=?',npc.id))!.schema_version,6);
 }finally{store.close();cleanupTestDirectory(dir);}
});
