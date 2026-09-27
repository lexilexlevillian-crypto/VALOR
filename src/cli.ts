import { config } from './config.ts';
import { Store } from './db.ts';
import { provisionUser } from './auth.ts';
import { z } from 'zod';
import {existsSync} from 'node:fs';
// Provisioning is an operator-only local command. Never expose it as an API.
process.umask(0o077);
const settings=config(),store=Store.fromConfig(settings);
try {
  const action=process.argv[2];
  if(action==='backup') {
    const destination=process.argv[3];
    if(!destination)throw new Error('Usage: npm run backup -- <new-destination.sqlite>');
    await store.backupTo(destination);console.log('Backup created and integrity verified.');
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
    } else throw new Error('Supported commands: migrate, backup, user:create, import-sqlite');
  }
} catch {
  console.error('Operation failed. Check arguments, environment, account uniqueness, and database permissions. No secrets logged.');
  process.exitCode=1;
} finally {store.close();}
