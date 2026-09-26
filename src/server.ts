import { config } from './config.ts';
import { Store } from './db.ts';
import { buildApp } from './app.ts';
process.umask(0o077);
const settings=config(),store=new Store(settings.databasePath);
store.migrate();
const app=buildApp(store,settings);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{
  await app.close();store.close();process.exit(0);
});
try { await app.listen({host:settings.host,port:settings.port}); }
catch { app.log.error('startup.failed');store.close();process.exitCode=1; }
