import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,key} from './helpers.ts';
import {cleanupTestDirectory} from './cleanup.ts';
import {Store} from '../src/db.ts';
import {Game,checksum} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';

async function setup(){
 const f=await fixture();await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});
 const game=new Game(f.store),timeline=await game.initialize(f.creator,f.campaign.id),revision=async()=>(await game.access(f.creator,timeline.id)).t.revision;
 return {...f,game,timeline,revision};
}

test('Creator Studio drafts validate both perspectives, publish atomically, retain versions, and produce templates',async()=>{
 const f=await setup();try{
  const player=validateEntity({id:randomUUID(),kind:'character',name:'Preview player',visibility:'campaign',data:{playable:true,controllerUserId:f.player.id}});
  await f.game.edit(f.creator,f.timeline.id,{revision:await f.revision(),entity:player},key());
  const entity=validateEntity({id:randomUUID(),kind:'location',name:'Draft district',visibility:'campaign',data:{description:'First authored version'}});
  const first=await f.game.saveStudioDraft(f.creator,f.timeline.id,{entity,reason:'Initial Creator draft'});
  assert.equal(first.version,1);assert.equal((await f.game.load(f.timeline.id)).entities.some(row=>row.id===entity.id),false);
  entity.name='Draft district revised';entity.data.description='Second authored version';
  const second=await f.game.saveStudioDraft(f.creator,f.timeline.id,{draftId:first.draftId,expectedVersion:first.version,entity,reason:'Second Creator draft'});
  const validation=await f.game.validateStudioDraft(f.creator,f.timeline.id,first.draftId,player.id);
  assert.equal(validation.valid,true);assert.equal(validation.version,2);assert.ok(validation.developerPreview);assert.ok(validation.playerPreview);
  const rejectedRevision=await f.revision();await assert.rejects(()=>f.game.publishStudioDraft(f.creator,f.timeline.id,{drafts:[{id:first.draftId,version:2}],revision:rejectedRevision,reason:'Missing confirmation',confirmed:false},key()),/publish_confirmation_required/);
  const restored=await f.game.restoreStudioVersion(f.creator,f.timeline.id,first.draftId,1,'Restore the approved first draft');assert.equal(restored.version,3);
  const detail=await f.game.studioDraft(f.creator,f.timeline.id,first.draftId) as unknown as {versions:Array<{action:string}>};assert.deepEqual(detail.versions.map(row=>row.action),['restored','drafted','drafted']);
  const published=await f.game.publishStudioDraft(f.creator,f.timeline.id,{drafts:[{id:first.draftId,version:3}],revision:await f.revision(),reason:'Approved content release',confirmed:true},key());
  assert.deepEqual(published.entityIds,[entity.id]);assert.equal((await f.game.load(f.timeline.id)).entities.find(row=>row.id===entity.id)?.name,'Draft district');
  const template=await f.game.createStudioTemplate(f.creator,f.timeline.id,{draftId:first.draftId,name:'District template'}),copy=await f.game.instantiateStudioTemplate(f.creator,f.timeline.id,{templateId:template.id,name:'Another district',reason:'Reuse approved authored structure'});
  assert.equal(copy.status,'draft');assert.notEqual(((await f.game.studioDraft(f.creator,f.timeline.id,copy.draftId)) as unknown as {entityId:string}).entityId,entity.id);
  const event=await f.store.get<{type:string}>('SELECT type FROM game_events WHERE id=?',published.publishedEventId);assert.equal(event?.type,'creator.content.published');
  await assert.rejects(()=>f.store.run('UPDATE creator_content_versions SET reason=? WHERE draft_id=?','rewrite',first.draftId),/immutable/);
  await f.domain.setUserMode(f.creator,{mode:'player',expectedRevision:1});
  await assert.rejects(()=>f.game.studioDrafts(f.creator,f.timeline.id),/developer_mode_required/);
 }finally{await f.close();}
});

test('deterministic fixtures and projection repair require fresh exact previews and preserve source history',async()=>{
 const f=await setup();try{
  const one=await f.game.previewDeveloperFixture(f.creator,f.timeline.id,'qa-seed'),two=await f.game.previewDeveloperFixture(f.creator,f.timeline.id,'qa-seed');
  assert.deepEqual(one.plan.entities.map(row=>row.id),two.plan.entities.map(row=>row.id));assert.notEqual(one.token,two.token);assert.equal(one.persisted,false);
  await assert.rejects(()=>f.game.applyDeveloperFixture(f.creator,f.timeline.id,{token:one.token,revision:one.expectedRevision,confirmation:'APPLY wrong'},key()),/developer_confirmation_mismatch/);
  const applied=await f.game.applyDeveloperFixture(f.creator,f.timeline.id,{token:one.token,revision:one.expectedRevision,confirmation:one.confirmation},key());assert.equal(applied.fixtureEntityIds.length,3);
  await assert.rejects(()=>f.game.applyDeveloperFixture(f.creator,f.timeline.id,{token:one.token,revision:one.expectedRevision,confirmation:one.confirmation},key()),/developer_preview_used|revision_conflict/);
  const link=await f.store.get<{entity_id:string;target_id:string}>('SELECT entity_id,target_id FROM entity_links WHERE timeline_id=? LIMIT 1',f.timeline.id);assert.ok(link);await f.store.run('DELETE FROM entity_links WHERE timeline_id=? AND entity_id=? AND target_id=?',f.timeline.id,link!.entity_id,link!.target_id);
  const before=checksum(await f.game.load(f.timeline.id)),repair=await f.game.previewDeveloperRepair(f.creator,f.timeline.id);assert.ok(repair.issues.missingLinks.includes(link!.entity_id+':'+link!.target_id));
  await assert.rejects(()=>f.game.applyDeveloperRepair(f.creator,f.timeline.id,{token:repair.token,revision:repair.expectedRevision,confirmation:'REPAIR wrong'}),/developer_confirmation_mismatch/);
  const result=await f.game.applyDeveloperRepair(f.creator,f.timeline.id,{token:repair.token,revision:repair.expectedRevision,confirmation:repair.confirmation});assert.equal(result.sourceStateUnchanged,true);assert.equal(checksum(await f.game.load(f.timeline.id)),before);
  assert.ok(await f.store.get('SELECT 1 FROM entity_links WHERE timeline_id=? AND entity_id=? AND target_id=?',f.timeline.id,link!.entity_id,link!.target_id));
  assert.ok(await f.store.get('SELECT 1 FROM audit_log WHERE action=? AND target_id=?','developer.state.repaired',result.repairId));
 }finally{await f.close();}
});

test('read-first debug and operational views identify their sources and readiness requires schema 48',async()=>{
 const f=await setup();try{
  await f.store.run('INSERT INTO operational_metric_events(campaign_id,timeline_id,metric,value,status,dimensions_json,created_at) VALUES (?,?,?,?,?,?,?)',f.campaign.id,f.timeline.id,'api_latency_ms',12,'succeeded','{}',new Date().toISOString());
  const debug=await f.game.developerDebugSnapshot(f.creator,f.timeline.id),operations=await f.game.operationalMetrics(f.creator,f.timeline.id);
  assert.match(debug.sourceOfTruth.events,/immutable/);assert.equal(debug.timeline.id,f.timeline.id);assert.equal(operations.schemaVersion,48);assert.equal(operations.sourceOfTruth.queue,'game_outbox');assert.equal(operations.sourceOfTruth.simulation,'turn_trace_steps deterministic-simulation');assert.ok(operations.api.some(row=>row.metric==='api_latency_ms'));
  const ready=await f.app.inject({method:'GET',url:'/readyz'});assert.equal(ready.statusCode,200);assert.deepEqual(ready.json(),{status:'ready',schemaVersion:48});
  assert.ok(await f.store.get('SELECT 1 FROM operational_metric_events WHERE metric=?','api_latency_ms'));
 }finally{await f.close();}
});

test('release rehearsal creates and independently verifies a schema-48 recovery database',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valor-release-')),source=join(dir,'source.sqlite'),destination=join(dir,'restored.sqlite');
 try{
  const result=spawnSync(process.execPath,['src/cli.ts','release:rehearse',destination],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,DATABASE_PATH:source,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',NODE_ENV:'test'}});
  assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout.trim());assert.equal(report.status,'ready');assert.equal(report.schemaVersion,48);assert.equal(report.integrity,'ok');assert.deepEqual(report.sourceCounts,report.restoredCounts);
  const restored=new Store(destination);try{assert.equal((await restored.get<{version:number}>('SELECT max(version) AS version FROM schema_migrations'))?.version,48);assert.deepEqual(await restored.all('PRAGMA foreign_key_check'),[]);}finally{restored.close();}
 }finally{cleanupTestDirectory(dir);}
});
