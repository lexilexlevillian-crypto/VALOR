import { config } from './config.ts';
import { Store } from './db.ts';
import { provisionUser } from './auth.ts';
import { z } from 'zod';
import {existsSync} from 'node:fs';
// Provisioning is an operator-only local command. Never expose it as an API.
process.umask(0o077);
const settings=config(),store=Store.fromConfig(settings);
const action=process.argv[2];
try {
  if(action==='backup') {
    const destination=process.argv[3];
    if(!destination)throw new Error('Usage: npm run backup -- <new-destination.sqlite>');
    await store.backupTo(destination);console.log('Backup created and integrity verified.');
  } else if(action==='release:rehearse') {
    const destination=process.argv[3];
    if(!destination)throw new Error('Usage: npm run release:rehearse -- <new-rehearsal.sqlite>');
    await store.migrate();
    const tables=['users','campaigns','timelines','game_events','saves','creator_content_versions','audit_log'];
    const sourceCounts=Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await store.get<{count:number}>('SELECT count(*) AS count FROM '+table))!.count])));
    await store.backupTo(destination);
    const restored=new Store(destination);
    try{
      await restored.migrate();
      const integrity=(await restored.get<{integrity_check:string}>('PRAGMA integrity_check'))?.integrity_check,foreignKeys=(await restored.all('PRAGMA foreign_key_check')).length,schema=(await restored.get<{version:number}>('SELECT max(version) AS version FROM schema_migrations'))?.version??0;
      const restoredCounts=Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await restored.get<{count:number}>('SELECT count(*) AS count FROM '+table))!.count])));
      if(integrity!=='ok'||foreignKeys!==0||schema!==52||JSON.stringify(sourceCounts)!==JSON.stringify(restoredCounts))throw new Error('Release rehearsal verification failed');
      console.log(JSON.stringify({status:'ready',schemaVersion:schema,integrity,foreignKeyViolations:foreignKeys,sourceCounts,restoredCounts,destination}));
    }finally{restored.close();}
  } else {
    if(action==='import-sqlite'){
      const sourcePath=process.argv[3];
      if(!store.remote||!sourcePath||!existsSync(sourcePath))throw new Error('Import requires Turso and an existing local SQLite database');
      const source=new Store(sourcePath);
      try{await source.copyToEmpty(store);}finally{source.close();}
    }
    await store.migrate();
    if(action==='migrate')console.log('Migrations verified and applied.');
    else if(action==='import-sqlite')console.log('Complete SQLite database imported into empty Turso database and migrations verified.');
    else if(action==='user:create') {
      const email=process.env.VALOR_BOOTSTRAP_EMAIL, password=process.env.VALOR_BOOTSTRAP_PASSWORD;
      const role=z.enum(['admin','creator','player']).parse(process.env.VALOR_BOOTSTRAP_ROLE??'creator');
      delete process.env.VALOR_BOOTSTRAP_PASSWORD;
      if(!email || !password)throw new Error('Set VALOR_BOOTSTRAP_EMAIL and VALOR_BOOTSTRAP_PASSWORD in the process environment.');
      const user=await provisionUser(store,{email,password,role});
      console.log(JSON.stringify({id:user.id,role:user.role}));
    } else throw new Error('Supported commands: migrate, backup, release:rehearse, user:create, import-sqlite');
  }
} catch {
  if(['migrate','release:rehearse','import-sqlite'].includes(action??''))try{await store.run('INSERT INTO operational_metric_events(metric,value,status,dimensions_json,created_at) VALUES (?,?,?,?,?)','migration_failure',1,'failed',JSON.stringify({action:action??'unknown'}),new Date().toISOString());}catch{}
  console.error('Operation failed. Check arguments, environment, account uniqueness, and database permissions. No secrets logged.');
  process.exitCode=1;
} finally {store.close();}
