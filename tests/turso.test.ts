import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {config} from '../src/config.ts';
import {Store} from '../src/db.ts';
import {cleanupTestDirectory} from './cleanup.ts';

const production={NODE_ENV:'production',APP_ORIGIN:'https://valor.example',RATE_LIMIT_SECRET:'test-only-'.repeat(4),TURSO_DATABASE_URL:'libsql://test-only.turso.io',TURSO_AUTH_TOKEN:'test-only-not-a-real-token'};

test('production requires paired secure Turso settings, HTTPS origin and a long rate secret, not a local disk',()=>{
 for(const DATABASE_PATH of [undefined,'./ignored.sqlite',':memory:']){
  const settings=config({...production,DATABASE_PATH});
  assert.equal(settings.tursoDatabaseUrl,production.TURSO_DATABASE_URL);
  const store=Store.fromConfig(settings);try{assert.equal(store.remote,true);assert.equal(store.path,production.TURSO_DATABASE_URL);}finally{store.close();}
 }
 for(const overrides of [{TURSO_DATABASE_URL:''},{TURSO_AUTH_TOKEN:''},{APP_ORIGIN:'http://valor.example'},{RATE_LIMIT_SECRET:'short'}])
  assert.throws(()=>config({...production,...overrides}),/Production requires/);
 for(const url of ['file:./data.sqlite',':memory:','http://example.test','libsql://example.test?tls=0','https://user:password@example.test','https://example.test/path','not-a-url'])
  assert.throws(()=>config({...production,TURSO_DATABASE_URL:url}),/secure libsql/);
 assert.throws(()=>config({TURSO_DATABASE_URL:production.TURSO_DATABASE_URL}),/both/);
 assert.throws(()=>config({TURSO_AUTH_TOKEN:production.TURSO_AUTH_TOKEN}),/both/);
 assert.equal(config({}).databasePath,'./data/valor.sqlite');
 assert.equal(config({}).tursoDatabaseUrl,undefined);
});

test('unavailable Turso fails closed without creating a local fallback database',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valor-remote-')),path=join(dir,'must-not-exist','fallback.sqlite');
 const store=Store.fromConfig(config({...production,TURSO_DATABASE_URL:'https://127.0.0.1:1',DATABASE_PATH:path}));
 try{await assert.rejects(()=>store.migrate());assert.equal(existsSync(path),false);assert.equal(existsSync(join(dir,'must-not-exist')),false);}
 finally{store.close();cleanupTestDirectory(dir);}
});

test('native node:sqlite accounts and session hashes survive the libSQL forward migration unchanged',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valor-legacy-')),path=join(dir,'legacy.sqlite');
 const legacy=new DatabaseSync(path);
 try{
  const name='001_foundation.sql',sql=readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
  legacy.exec(sql);
  legacy.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?)').run(1,name,createHash('sha256').update(sql).digest('hex'),'2012-01-01');
  legacy.prepare('INSERT INTO users(id,email,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('legacy-user','legacy@example.test','unchanged-password-hash','creator','2012','2012');
  legacy.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('unchanged-session-hash','legacy-user','2012','2099');
 }finally{legacy.close();}
 const store=new Store(path);
 try{
  await store.migrate();
  assert.equal((await store.get<{password_hash:string}>('SELECT password_hash FROM users'))!.password_hash,'unchanged-password-hash');
  assert.equal((await store.get<{token_hash:string}>('SELECT token_hash FROM sessions'))!.token_hash,'unchanged-session-hash');
  assert.equal((await store.get<{n:number}>('SELECT count(*) n FROM schema_migrations'))!.n,46);
  assert.deepEqual(await store.all('PRAGMA foreign_key_check'),[]);
 }finally{store.close();cleanupTestDirectory(dir);}
});
test('server refuses to listen when awaited migration verification fails',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valor-startup-')),path=join(dir,'invalid.sqlite'),store=new Store(path);
 try{
  await store.migrate();
  await store.run("UPDATE schema_migrations SET checksum='invalid' WHERE version=1");
  store.close();
  const child=spawnSync(process.execPath,['src/server.ts'],{cwd:process.cwd(),encoding:'utf8',timeout:15000,env:{...process.env,NODE_ENV:'development',APP_ORIGIN:'http://localhost:3000',HOST:'127.0.0.1',PORT:'0',DATABASE_PATH:path,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:''}});
  assert.equal(child.status,1,child.stderr);
  assert.match(child.stderr,/startup.failed/);
  assert.doesNotMatch(child.stdout,/Server listening/);
 }finally{store.close();cleanupTestDirectory(dir);}
});
