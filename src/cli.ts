import { config } from './config.ts';
import { Store } from './db.ts';
import { provisionUser } from './auth.ts';
import { z } from 'zod';
// Provisioning is an operator-only local command. Never expose it as an API.
process.umask(0o077);
const settings=config(),store=new Store(settings.databasePath);
try {
  store.migrate();
  const action=process.argv[2];
  if(action==='migrate')console.log('Migrations verified and applied.');
  else if(action==='backup') {
    const destination=process.argv[3];
    if(!destination)throw new Error('Usage: npm run backup -- <new-destination.sqlite>');
    await store.backupTo(destination);console.log('Backup created and integrity verified.');
  } else if(action==='user:create') {
    const email=process.env.VALOR_BOOTSTRAP_EMAIL, password=process.env.VALOR_BOOTSTRAP_PASSWORD;
    const role=z.enum(['admin','creator','player']).parse(process.env.VALOR_BOOTSTRAP_ROLE??'creator');
    delete process.env.VALOR_BOOTSTRAP_PASSWORD;
    if(!email || !password)throw new Error('Set VALOR_BOOTSTRAP_EMAIL and VALOR_BOOTSTRAP_PASSWORD in the process environment.');
    const user=await provisionUser(store,{email,password,role});
    console.log(JSON.stringify({id:user.id,role:user.role}));
  } else throw new Error('Supported commands: migrate, backup, user:create');
} catch {
  console.error('Operation failed. Check arguments, environment, account uniqueness, and database permissions. No secrets logged.');
  process.exitCode=1;
} finally {store.close();}
