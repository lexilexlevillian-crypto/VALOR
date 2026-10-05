import type {FastifyInstance} from 'fastify';
// Release classes depend only on the requested public operation, never on entity
// existence, visibility, dice, or response status. Overshoots are operational
// faults to monitor, not a claim of constant-time execution on a shared host.
export function responseLatencyClass(method:string,url:string){
 const path=url.split('?')[0]??'';
 if(!/^\/game\/timelines\/[^/]+\//.test(path)||/\/(?:developer|creator|export|media)(?:\/|$)/.test(path))return null;
 if(method==='GET'||method==='HEAD')return {name:'observer-read',milliseconds:250};
 if(/\/(?:commands|turns|parse|story\/resolve)$/.test(path))return {name:'player-command',milliseconds:500};
 return null;
}
export async function holdResponse(start:number,budget:number,now:()=>number=()=>performance.now(),sleep:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const elapsed=now()-start,overrun=elapsed>budget;
 while(now()-start<budget)await sleep(budget-(now()-start));
 return {overrun,processingMs:elapsed};
}
export function installResponseTiming(app:FastifyInstance){
 const starts=new WeakMap<object,number>();
 app.addHook('onRequest',async request=>{if(responseLatencyClass(request.method,request.url))starts.set(request,performance.now());});
 app.addHook('onSend',async(request,_reply,payload)=>{
  const policy=responseLatencyClass(request.method,request.url),start=starts.get(request);
  if(policy&&start!==undefined){const result=await holdResponse(start,policy.milliseconds);if(result.overrun)app.log.warn({requestId:request.id,latencyClass:policy.name,processingMs:Math.round(result.processingMs)},'privacy.response_latency_overrun');}
  return payload;
 });
}
