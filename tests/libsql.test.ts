import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LibsqlStore} from '../src/db-libsql.ts';
import {fixture,key} from './helpers.ts';
import {cleanupTestDirectory} from './cleanup.ts';

test('libSQL preserves existing SQLite schema, accounts, immutable events and full backups',async()=>{
 const f=await fixture();const candidate=new LibsqlStore(f.store.path);
 try{
  const record=await f.execute({type:'record.create',kind:'lore',name:'Preserved lore',visibility:'creator'});
  await candidate.migrate();
  assert.equal((await candidate.get<{name:string}>('SELECT name FROM records WHERE id=?',record.id))!.name,'Preserved lore');
  assert.equal((await candidate.get<{n:number}>('SELECT count(*) n FROM users'))!.n,4);
  await assert.rejects(()=>candidate.run('DELETE FROM domain_events'),/immutable/);
  await candidate.backupTo(join(f.dir,'libsql-copy.sqlite'));
  const copy=new LibsqlStore(join(f.dir,'libsql-copy.sqlite'));
  try{await copy.migrate();
   const tables=await candidate.all<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
   for(const {name}of tables)assert.deepEqual(await copy.all('SELECT rowid,* FROM '+name+' ORDER BY rowid'),await candidate.all('SELECT rowid,* FROM '+name+' ORDER BY rowid'),name);
   await assert.rejects(()=>copy.run('DELETE FROM audit_log'),/immutable/);
   await assert.rejects(()=>candidate.copyToEmpty(copy),/must be empty/);
  }finally{copy.close();}
 }finally{candidate.close();await f.close();}
});
test('libSQL transaction awaits asynchronous work and isolates concurrent failures',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valor-libsql-')),store=new LibsqlStore(join(dir,'test.sqlite'));
 try{
  await store.exec('CREATE TABLE test_values (id TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT');
  const failed=store.transaction(async()=>{await store.run('INSERT INTO test_values VALUES (?,?)','rollback',1);await new Promise(r=>setTimeout(r,20));throw new Error('rollback test');});
  const successful=store.transaction(async()=>{await store.run('INSERT INTO test_values VALUES (?,?)','commit',2);return 7;});
  await assert.rejects(()=>failed,/rollback test/);assert.equal(await successful,7);
  assert.deepEqual(await store.all('SELECT * FROM test_values'),[{id:'commit',value:2}]);
  await store.transaction(async()=>{await store.transaction(async()=>{await store.run('UPDATE test_values SET value=3');});});
  assert.equal((await store.get<{value:number}>('SELECT value FROM test_values'))!.value,3);
 }finally{store.close();cleanupTestDirectory(dir);}
});
test('libSQL migrations and foreign key failures are transactional',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valor-libsql-')),store=new LibsqlStore(join(dir,'test.sqlite'));
 try{await store.migrate();
  assert.equal((await store.get<{n:number}>('SELECT count(*) n FROM schema_migrations'))!.n,47);
  await assert.rejects(()=>store.run('INSERT INTO sessions VALUES (?,?,?,?)',key(),key(),'now','later'),/FOREIGN KEY/);
  await store.run("UPDATE schema_migrations SET checksum='invalid' WHERE version=1");
  await assert.rejects(()=>store.migrate(),/checksum/);
 }finally{store.close();cleanupTestDirectory(dir);}
});
