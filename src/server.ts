import { config } from './config.ts';
import { Store } from './db.ts';
import { buildApp } from './app.ts';
process.umask(0o077);
const settings=config(),store=Store.fromConfig(settings);
try {
  // Never accept traffic until every schema migration has committed.
  await store.migrate();
  const app=buildApp(store,settings);
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{
    await app.close();store.close();process.exit(0);
  });
  await app.listen({host:settings.host,port:settings.port});
} catch {
  // Connection errors may include database URLs; do not log credentials.
  console.error('startup.failed: check database configuration and migrations');
  store.close();process.exitCode=1;
}
