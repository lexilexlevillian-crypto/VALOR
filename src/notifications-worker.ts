import {config} from './config.ts';
import {Store} from './db.ts';
import {deliverGameEvents} from './game/delivery.ts';
import type {GameDelivery} from './game/delivery.ts';

export type WebhookFetch=(input:string|URL,init?:RequestInit)=>Promise<Response>;
export type WebhookOptions={url:string;secret:string;fetcher?:WebhookFetch;timeoutMs?:number};

function endpoint(raw:string){
 const parsed=new URL(raw);
 if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('invalid_webhook_url');
 return parsed;
}

export async function sendGameDelivery(event:GameDelivery,options:WebhookOptions){
 const url=endpoint(options.url);if(options.secret.length<32)throw new Error('webhook_secret_too_short');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(100,Math.min(60000,options.timeoutMs??10000)));
 try{
  const response=await (options.fetcher??fetch)(url,{method:'POST',headers:{'content-type':'application/json','x-valor-event-id':event.id,authorization:'Bearer '+options.secret},body:JSON.stringify(event),signal:controller.signal});
  if(!response.ok)throw new Error('notification_webhook_failed');
 }finally{clearTimeout(timer);}
}

export type WorkerOptions={store:Store;url:string;secret:string;once?:boolean;intervalMs?:number;fetcher?:WebhookFetch};
export async function runDeliveryWorker(options:WorkerOptions){
 const interval=Math.max(1000,Math.min(300000,options.intervalMs??5000));let delivered=0;
 do{
  try{delivered+=await deliverGameEvents(options.store,event=>sendGameDelivery(event,{url:options.url,secret:options.secret,fetcher:options.fetcher}));}
  catch{if(options.once)throw new Error('notification_delivery_failed');}
  if(options.once)break;
  if(delivered===0)await new Promise(resolve=>setTimeout(resolve,interval));
 }while(true);
 return delivered;
}

export async function main(env:NodeJS.ProcessEnv=process.env){
 const url=env.VALOR_EVENT_WEBHOOK_URL,secret=env.VALOR_EVENT_WEBHOOK_SECRET;
 if(!url||!secret)throw new Error('notification_worker_requires_webhook_configuration');
 const store=Store.fromConfig(config(env));let stopping=false;
 const stop=()=>{stopping=true;};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  await store.migrate();
  if(env.VALOR_WORKER_ONCE==='1')return await runDeliveryWorker({store,url,secret,once:true,intervalMs:Number(env.VALOR_WORKER_INTERVAL_MS??5000)});
  while(!stopping){await runDeliveryWorker({store,url,secret,once:true});if(!stopping)await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Number(env.VALOR_WORKER_INTERVAL_MS??5000))));}
  return 0;
 }finally{store.close();}
}

if(import.meta.url===`file://${process.argv[1]}`)main().catch(()=>{console.error('notification_worker.failed');process.exitCode=1;});
