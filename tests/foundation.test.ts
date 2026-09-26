import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Store } from '../src/db.ts';
import { Domain, dispatchNotifications } from '../src/domain.ts';
import { randomSource } from '../src/random.ts';
import { fixture, key } from './helpers.ts';
import { Auth, hash, provisionUser } from '../src/auth.ts';
import type { Scope } from '../src/contracts.ts';

test('fresh migrations, checksum enforcement, forward migration and real process restart preserve authored values',async()=>{
  const f=await fixture();
  try {
    const path=join(f.dir,'forward.sqlite');
    let store=new Store(path);(await store.migrate(1));
    const creator=await provisionUser(store,{email:'migrate@example.test',password:'migration test password',role:'creator'});
    let domain=new Domain(store);
    const world=(await domain.createWorld(creator,'Persist me',key())),scope:Scope={type:'world',id:world.id};
    const record=(await domain.execute(creator,scope,{type:'record.create',kind:'authored',name:'Original',visibility:'creator'},key()));
    const section=(await domain.execute(creator,scope,{type:'section.add',recordId:record.id,expectedRevision:1,name:'Original section',position:0,visibility:'creator',parentId:null},key()));
    const field=(await domain.execute(creator,scope,{type:'field.add',recordId:record.id,expectedRevision:2,sectionId:section.sectionId!,name:'Original field',position:0,valueType:'text',visibility:'creator'},key()));
    (await domain.execute(creator,scope,{type:'field.set',recordId:record.id,expectedRevision:3,fieldId:field.fieldId!,value:'Authored durable value'},key()));
    store.close();store=new Store(path);(await store.migrate());domain=new Domain(store);
    (await domain.execute(creator,scope,{type:'section.update',recordId:record.id,expectedRevision:4,sectionId:section.sectionId!,name:'Renamed section',position:9,visibility:'creator'},key()));
    (await domain.execute(creator,scope,{type:'field.update',recordId:record.id,expectedRevision:5,fieldId:field.fieldId!,name:'Renamed field',position:8,visibility:'creator'},key()));
    const read=(await domain.read(creator,scope,record.id));
    assert.equal(read.sections[0]!.id,section.sectionId);
    assert.equal(read.sections[0]!.fields[0]!.id,field.fieldId);
    assert.equal(read.sections[0]!.fields[0]!.value,'Authored durable value');
    assert.equal((await store.get<{n:number}>('SELECT count(*) AS n FROM schema_migrations'))!.n,4);
    store.close();
    const child=spawnSync(process.execPath,['--input-type=module','-e',
      "import {Store} from './src/db.ts'; const s=new Store(process.env.TEST_DATABASE); await s.migrate(); console.log((await s.get('SELECT value_json FROM field_values')).value_json); s.close();"],
      {cwd:process.cwd(),env:{...process.env,TEST_DATABASE:path},encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/Authored durable value/);
    store=new Store(path);
    (await store.run("UPDATE schema_migrations SET checksum='tampered' WHERE version=1"));
    (await assert.rejects(async ()=>(await store.migrate()),/checksum/));store.close();
  } finally {await f.close();}
});

test('tenant isolation, global admin least privilege, role restrictions and field/ancestor visibility',async()=>{
  const f=await fixture();
  try {
    const rec=(await f.execute({type:'record.create',kind:'npc-test',name:'Permitted label',visibility:'campaign'}));
    const sec=(await f.execute({type:'section.add',recordId:rec.id,expectedRevision:1,name:'Visible',position:0,visibility:'campaign',parentId:null}));
    const field=(await f.execute({type:'field.add',recordId:rec.id,expectedRevision:2,sectionId:sec.sectionId!,name:'Hidden NPC secret',position:0,valueType:'text',visibility:'creator'}));
    (await f.execute({type:'field.set',recordId:rec.id,expectedRevision:3,fieldId:field.fieldId!,value:'DO NOT LEAK'}));
    const hidden=(await f.execute({type:'section.add',recordId:rec.id,expectedRevision:4,name:'Secret section',position:1,visibility:'creator',parentId:null}));
    (await f.execute({type:'section.add',recordId:rec.id,expectedRevision:5,name:'Child hidden by ancestor',position:0,visibility:'campaign',parentId:hidden.sectionId!}));
    assert.match(JSON.stringify((await f.domain.read(f.creator,f.scope,rec.id))),/DO NOT LEAK/);
    const view=JSON.stringify((await f.domain.list(f.player,f.scope)));
    assert.doesNotMatch(view,/DO NOT LEAK|Hidden NPC|Secret section|Child hidden/);
    (await assert.rejects(async ()=>(await f.domain.read(f.other,f.scope,rec.id)),/not_found/));
    (await assert.rejects(async ()=>(await f.domain.execute(f.player,f.scope,{type:'record.archive',recordId:rec.id,expectedRevision:6},key())),/forbidden/));
    (await assert.rejects(async ()=>(await f.domain.history(f.player,f.scope)),/forbidden/));
    (await assert.rejects(async ()=>(await f.domain.audits(f.player,f.scope)),/forbidden/));
    assert.equal((await f.domain.list(f.observer,f.scope)).items.length,0);
    const privateRecord=(await f.execute({type:'record.create',kind:'fact-test',name:'Knowledge gated',visibility:'knowledge'}));
    (await assert.rejects(async ()=>(await f.domain.read(f.player,f.scope,privateRecord.id)),/not_found/));
    (await f.execute({type:'visibility.grant',recordId:privateRecord.id,expectedRevision:1,userId:f.observer.id}));
    assert.equal((await f.domain.read(f.observer,f.scope,privateRecord.id)).name,'Knowledge gated');
    (await f.execute({type:'visibility.revoke',recordId:privateRecord.id,expectedRevision:2,userId:f.observer.id}));
    (await assert.rejects(async ()=>(await f.domain.read(f.observer,f.scope,privateRecord.id)),/not_found/));
  } finally {await f.close();}
});

test('independent template instances retain source revision and never follow later edits',async()=>{
  const f=await fixture();
  try {
    const scope:Scope={type:'world',id:f.world.id};
    const rec=(await f.domain.execute(f.creator,scope,{type:'record.create',kind:'template',name:'Authored template',visibility:'creator'},key()));
    const sec=(await f.domain.execute(f.creator,scope,{type:'section.add',recordId:rec.id,expectedRevision:1,name:'Details',position:0,parentId:null,visibility:'campaign'},key()));
    const field=(await f.domain.execute(f.creator,scope,{type:'field.add',recordId:rec.id,expectedRevision:2,sectionId:sec.sectionId!,name:'Value',position:0,valueType:'number',visibility:'campaign'},key()));
    (await f.domain.execute(f.creator,scope,{type:'field.set',recordId:rec.id,expectedRevision:3,fieldId:field.fieldId!,value:12},key()));
    const copy=(await f.execute({type:'record.instantiate',sourceRecordId:rec.id,sourceRevision:4,visibility:'campaign'}));
    (await f.domain.execute(f.creator,scope,{type:'field.set',recordId:rec.id,expectedRevision:4,fieldId:field.fieldId!,value:99},key()));
    const copied=(await f.domain.read(f.player,f.scope,copy.id));
    assert.equal(copied.sections[0]!.fields[0]!.value,12);
    assert.notEqual(copied.sections[0]!.fields[0]!.id,field.fieldId);
    assert.equal((await f.store.get<{source_revision:number}>('SELECT source_revision FROM records WHERE id=?',copy.id))!.source_revision,4);
    (await assert.rejects(async ()=>(await f.execute({type:'record.instantiate',sourceRecordId:rec.id,sourceRevision:4,visibility:'campaign'})),/revision_conflict/));
  } finally {await f.close();}
});

test('idempotent retries, conflicting keys, optimistic concurrency and revoked actor retries',async()=>{
  const f=await fixture();
  try {
    const command={type:'record.create' as const,kind:'test',name:'Once',visibility:'campaign' as const},cmdKey=key();
    const a=(await f.execute(command,cmdKey)),b=(await f.execute(command,cmdKey));
    assert.deepEqual(a,b);
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM domain_events WHERE aggregate_id=?',a.id))!.n,1);
    (await assert.rejects(async ()=>(await f.execute({...command,name:'Different'},cmdKey)),/idempotency_conflict/));
    const change={type:'record.update' as const,recordId:a.id,expectedRevision:1,name:'Edited',visibility:'campaign' as const};
    (await f.execute(change));(await assert.rejects(async ()=>(await f.execute(change)),/revision_conflict/));
    (await f.store.run('UPDATE users SET archived_at=? WHERE id=?',new Date().toISOString(),f.creator.id));
    (await assert.rejects(async ()=>(await f.execute(command,cmdKey)),/unauthenticated/));
  } finally {await f.close();}
});

test('failed event append rolls back projection, receipt, audit and outbox together',async()=>{
  const f=await fixture();
  try {
    const before=(await f.store.get<{n:number}>('SELECT count(*) n FROM audit_log'))!.n;
    (await f.store.exec("CREATE TRIGGER fail_events BEFORE INSERT ON domain_events BEGIN SELECT RAISE(ABORT,'test forced failure'); END;"));
    (await assert.rejects(async ()=>(await f.execute({type:'record.create',kind:'test',name:'Must roll back',visibility:'campaign'})),/test forced failure/));
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM records'))!.n,0);
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM audit_log'))!.n,before);
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM outbox'))!.n,4);
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM command_receipts'))!.n,4);
  } finally {await f.close();}
});

test('immutable histories, foreign keys, type validation and archived content remain protected',async()=>{
  const f=await fixture();
  try {
    (await assert.rejects(async ()=>(await f.store.run("UPDATE domain_events SET type='tampered'")),/immutable/));
    (await assert.rejects(async ()=>(await f.store.run('DELETE FROM domain_events')),/immutable/));
    (await assert.rejects(async ()=>(await f.store.run('DELETE FROM audit_log')),/immutable/));
    (await assert.rejects(async ()=>(await f.store.run('DELETE FROM command_receipts')),/immutable/));
    (await assert.rejects(async ()=>(await f.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)',key(),f.player.id,'player','now','now')),/FOREIGN KEY/));
    const rec=(await f.execute({type:'record.create',kind:'test',name:'Archive me',visibility:'campaign'}));
    const sec=(await f.execute({type:'section.add',recordId:rec.id,expectedRevision:1,name:'Section',position:0,parentId:null,visibility:'campaign'}));
    const fld=(await f.execute({type:'field.add',recordId:rec.id,expectedRevision:2,sectionId:sec.sectionId!,name:'Number',position:0,valueType:'number',visibility:'campaign'}));
    (await assert.rejects(async ()=>(await f.execute({type:'field.set',recordId:rec.id,expectedRevision:3,fieldId:fld.fieldId!,value:'wrong type'})),/field_type_mismatch/));
    const rec2=(await f.execute({type:'record.create',kind:'test',name:'Other record',visibility:'campaign'}));
    (await assert.rejects(async ()=>(await f.execute({type:'field.add',recordId:rec2.id,expectedRevision:1,sectionId:sec.sectionId!,name:'Cross reference',position:0,valueType:'text',visibility:'campaign'})),/not_found/));
    (await f.execute({type:'record.archive',recordId:rec.id,expectedRevision:3}));
    (await assert.rejects(async ()=>(await f.domain.read(f.creator,f.scope,rec.id)),/not_found/));
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM records WHERE id=?',rec.id))!.n,1);
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM domain_events WHERE aggregate_id=?',rec.id))!.n,4);
  } finally {await f.close();}
});

test('backup restores committed data and sessions into an independently openable database',async()=>{
  const f=await fixture();
  try {
    const rec=(await f.execute({type:'record.create',kind:'test',name:'Backup record',visibility:'campaign'}));
    const session=await new Auth(f.store,f.settings).login('creator@example.test','Test-only passphrase 123!');
    const destination=join(f.dir,'restored.sqlite');
    await f.store.backupTo(destination);
    const restored=new Store(destination);(await restored.migrate());
    try {
      assert.equal((await new Domain(restored).read(f.player,f.scope,rec.id)).name,'Backup record');
      assert.equal((await new Auth(restored,f.settings).authenticate(session.token)).id,f.creator.id);
      assert.ok((await restored.get('SELECT token_hash FROM sessions WHERE token_hash=?',hash(session.token))));
      assert.deepEqual((await restored.all('PRAGMA foreign_key_check')),[]);
      assert.equal((await restored.get<{integrity_check:string}>('PRAGMA integrity_check'))!.integrity_check,'ok');
    } finally {restored.close();}
    await assert.rejects(async ()=>(await f.store.backupTo(destination)),/must be new/);
  } finally {await f.close();}
});

test('deterministic unbiased RNG contract and durable at-least-once notification delivery',async()=>{
  const f=await fixture();
  try {
    const seed='ab'.repeat(32),a=randomSource(seed),b=randomSource(seed);
    const draws=Array.from({length:100},()=>a.integer(7));
    assert.deepEqual(draws,Array.from({length:100},()=>b.integer(7)));
    assert.ok(draws.every(n=>n>=0 && n<7));
    assert.throws(()=>a.integer(0),/Invalid random range/);
    await assert.rejects(async ()=>(await dispatchNotifications(f.store,async()=>{throw new Error('delivery failed');})),/delivery failed/);
    assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM outbox WHERE delivered_at IS NULL'))!.n,4);
    const seen=new Set<string>();
    await dispatchNotifications(f.store,async event=>{seen.add(event.id);assert.match(event.seed,/^[a-f0-9]{64}$/);});
    assert.equal(seen.size,4);
    await dispatchNotifications(f.store,async()=>{assert.fail('already delivered');});
  } finally {await f.close();}
});

test('event and audit cursors follow commit order, not random UUID order',async()=>{
  const f=await fixture();
  try {
    const first=(await f.execute({type:'record.create',kind:'test',name:'Chronology',visibility:'campaign'}));
    const second=(await f.execute({type:'record.update',recordId:first.id,expectedRevision:1,name:'Second',visibility:'campaign'}));
    const third=(await f.execute({type:'record.update',recordId:first.id,expectedRevision:2,name:'Third',visibility:'campaign'}));
    const events=(await f.domain.history(f.creator,f.scope,first.eventId)) as {id:string}[];
    assert.deepEqual(events.map(e=>e.id),[second.eventId,third.eventId]);
    const audits=(await f.domain.audits(f.creator,f.scope)) as {id:string;event_id:string}[];
    const firstAudit=audits.find(a=>a.event_id===first.eventId)!;
    const after=(await f.domain.audits(f.creator,f.scope,firstAudit.id)) as {event_id:string}[];
    assert.deepEqual(after.map(a=>a.event_id),[second.eventId,third.eventId]);
  }finally{await f.close();}
});

test('knowledge grants never open Creator-only children, and archived ancestors suppress descendants',async()=>{
  const f=await fixture();
  try {
    const rec=(await f.execute({type:'record.create',kind:'test',name:'Granted record',visibility:'knowledge'}));
    const sec=(await f.execute({type:'section.add',recordId:rec.id,expectedRevision:1,name:'Granted section',position:0,visibility:'knowledge',parentId:null}));
    const field=(await f.execute({type:'field.add',recordId:rec.id,expectedRevision:2,sectionId:sec.sectionId!,name:'Creator-only fact',position:0,valueType:'text',visibility:'creator'}));
    (await f.execute({type:'field.set',recordId:rec.id,expectedRevision:3,fieldId:field.fieldId!,value:'Never reveal this'}));
    const grantKey=key();
    (await f.execute({type:'visibility.grant',recordId:rec.id,expectedRevision:4,userId:f.player.id},grantKey));
    const read=(await f.domain.read(f.player,f.scope,rec.id));
    assert.equal(read.sections.length,1);assert.equal(read.sections[0]!.fields.length,0);
    const reopened=new Store(f.store.path);
    try {
      (await reopened.migrate());
      const response=(await new Domain(reopened).execute(f.creator,f.scope,{type:'visibility.grant',recordId:rec.id,expectedRevision:4,userId:f.player.id},grantKey));
      assert.equal(response.revision,5);
    }finally{reopened.close();}
    (await f.execute({type:'section.archive',recordId:rec.id,expectedRevision:5,sectionId:sec.sectionId!}));
    assert.equal((await f.domain.read(f.creator,f.scope,rec.id)).sections.length,0);
    assert.equal((await f.store.get<{value_json:string}>('SELECT value_json FROM field_values WHERE field_id=?',field.fieldId!))!.value_json,JSON.stringify('Never reveal this'));
  }finally{await f.close();}
});
