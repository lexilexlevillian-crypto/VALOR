import { config } from './config.ts';
import { Store } from './db.ts';
import { buildApp } from './app.ts';
import {directProvidersFromEnvironment,preferredDirectProvider} from './game/direct-provider.ts';
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
  // One tiny synthetic probe per process, never player content or a saved-life mutation.
  // Runs after readiness; provider failure does not take the game offline.
  const provider=preferredDirectProvider(directProvidersFromEnvironment());
  if(provider&&process.env.AI_STARTUP_CHECK!=='off'){
   const started=performance.now();
   void provider.healthCheck(AbortSignal.timeout(12000)).then(result=>app.log.info({...result,latencyMs:Math.round(performance.now()-started)},provider.id+'.startup_check')).catch((error:unknown)=>app.log.warn({provider:provider.id,status:'unavailable',reason:error instanceof Error&&/^(?:gemini|deepinfra)_[a-z_]+$/.test(error.message)?error.message:'provider_check_failed',httpStatus:typeof (error as {httpStatus?:unknown})?.httpStatus==='number'?(error as {httpStatus:number}).httpStatus:undefined,latencyMs:Math.round(performance.now()-started)},provider.id+'.startup_check'));
  }
} catch {
  // Connection errors may include database URLs; do not log credentials.
  console.error('startup.failed: check database configuration and migrations');
  store.close();process.exitCode=1;
}
