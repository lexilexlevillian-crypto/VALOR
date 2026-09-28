import {z} from 'zod';
import {aiProviderResponseSchema,aiRequestSchema,redactedRequestLog,safeCacheKey,type AiProviderAdapter,type AiProviderResponse,type AiRequest} from './contracts.ts';
import {validateToolCalls,type ToolAuthorization} from './tools.ts';

export const fallbackMessages={
 narration:'Narration assistance is temporarily unavailable. The grounded result remains unchanged.',
 interpretation:'AI interpretation is temporarily unavailable. Use the explicit action controls; nothing has happened.',
 creator:'Creator assistance is temporarily unavailable. No changes were made.',
 extraction:'Automated extraction is temporarily unavailable. The source remains unchanged.'
} as const;

export type AiAuditStatus='queued'|'running'|'succeeded'|'cached'|'fallback'|'failed'|'canceled'|'timed-out'|'queue-rejected';
export type AiAuditEvent={traceId:string;status:AiAuditStatus;attempts:number;inputTokens:number;outputTokens:number;reason?:string;request?:ReturnType<typeof redactedRequestLog>;at:string};
export interface AiAuditSink {record(event:AiAuditEvent):Promise<void>|void;}
export class MemoryAuditSink implements AiAuditSink {readonly events:AiAuditEvent[]=[];record(event:AiAuditEvent){this.events.push(structuredClone(event));}}

class GatewayQueue {
 private active=0;
 private readonly pending:Array<{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>=[];
 private readonly maxConcurrent:number;private readonly maxQueued:number;private readonly waitMs:number;
 constructor(maxConcurrent:number,maxQueued:number,waitMs:number){this.maxConcurrent=maxConcurrent;this.maxQueued=maxQueued;this.waitMs=waitMs;}
 async enter(){
  if(this.active<this.maxConcurrent){this.active++;return;}
  if(this.pending.length>=this.maxQueued)throw new Error('ai_queue_full');
  await new Promise<void>((resolve,reject)=>{
   const entry={resolve,reject,timer:setTimeout(()=>{const index=this.pending.indexOf(entry);if(index>=0)this.pending.splice(index,1);reject(new Error('ai_queue_timeout'));},this.waitMs)};
   this.pending.push(entry);
  });
 }
 leave(){const next=this.pending.shift();if(next){clearTimeout(next.timer);next.resolve();}else this.active--;}
}

type CacheEntry={expires:number;response:AiProviderResponse};
export type GatewayOptions={maxConcurrent?:number;maxQueued?:number;maxQueueWaitMs?:number;audit?:AiAuditSink;now?:()=>number;};
export type ExecuteOptions<T>={request:AiRequest;validate:(output:unknown)=>T;toolAuthorization?:ToolAuthorization;fallback?:(reason:string)=>T;signal?:AbortSignal;};
export type GatewayResult<T>={traceId:string;status:'succeeded'|'cached'|'fallback';output:T;usage:{inputTokens:number;outputTokens:number};attempts:number;toolResults:unknown[];fallbackMessage?:string;failureReason?:string;};

export class AiGateway {
 private readonly providers:Map<string,AiProviderAdapter>;
 private readonly queue:GatewayQueue;
 private readonly audit:AiAuditSink;
 private readonly cache=new Map<string,CacheEntry>();
 private readonly now:()=>number;
 constructor(providers:AiProviderAdapter[],options:GatewayOptions={}){
  this.providers=new Map(providers.map(provider=>[provider.id,provider]));
  if(this.providers.size!==providers.length)throw new Error('duplicate_ai_provider');
  this.queue=new GatewayQueue(options.maxConcurrent??4,options.maxQueued??32,options.maxQueueWaitMs??2000);
  this.audit=options.audit??new MemoryAuditSink();this.now=options.now??Date.now;
 }
 async execute<T>(options:ExecuteOptions<T>):Promise<GatewayResult<T>>{
  const request=aiRequestSchema.parse(options.request),provider=this.providers.get(request.model.provider);
  if(!provider)throw new Error('ai_provider_unavailable');
  const log=redactedRequestLog(request);await this.audit.record({traceId:request.traceId,status:'queued',attempts:0,inputTokens:0,outputTokens:0,request:log,at:new Date(this.now()).toISOString()});
  const key=safeCacheKey(request),cached=key&&this.cache.get(key);
  if(cached&&cached.expires>this.now()){
   const output=options.validate(cached.response.output);await this.audit.record({traceId:request.traceId,status:'cached',attempts:0,...cached.response.usage,at:new Date(this.now()).toISOString()});
   return {traceId:request.traceId,status:'cached',output,usage:cached.response.usage,attempts:0,toolResults:[]};
  }
  try{await this.queue.enter();}catch(error){return this.useFallback(options,error instanceof Error?error.message:'ai_queue_rejected',0,'queue-rejected');}
  let attempts=0,lastReason='ai_provider_failed';
  try{
   await this.audit.record({traceId:request.traceId,status:'running',attempts:0,inputTokens:0,outputTokens:0,at:new Date(this.now()).toISOString()});
   for(;attempts<request.budget.maxAttempts;attempts++){
    if(options.signal?.aborted){await this.audit.record({traceId:request.traceId,status:'canceled',attempts,inputTokens:0,outputTokens:0,reason:'ai_canceled',at:new Date(this.now()).toISOString()});throw new Error('ai_canceled');}
    try{
     const response=await this.invoke(provider,request,options.signal),toolResults=validateToolCalls(response.toolCalls,request.allowedTools,options.toolAuthorization??{}),output=options.validate(response.output);
     if(response.usage.inputTokens>request.budget.maxInputTokens||response.usage.outputTokens>request.budget.maxOutputTokens||response.usage.inputTokens+response.usage.outputTokens>request.budget.maxTotalTokens)throw new Error('ai_usage_exceeded_budget');
     if(key&&request.cache.kind==='reproducible')this.cache.set(key,{response,expires:this.now()+request.cache.ttlSeconds*1000});
     await this.audit.record({traceId:request.traceId,status:'succeeded',attempts:attempts+1,...response.usage,at:new Date(this.now()).toISOString()});
     return {traceId:request.traceId,status:'succeeded',output,usage:response.usage,attempts:attempts+1,toolResults};
    }catch(error){
     if(options.signal?.aborted){await this.audit.record({traceId:request.traceId,status:'canceled',attempts:attempts+1,inputTokens:0,outputTokens:0,reason:'ai_canceled',at:new Date(this.now()).toISOString()});throw new Error('ai_canceled',{cause:error});}
     lastReason=error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:'ai_provider_failed';
    }
   }
   return this.useFallback(options,lastReason,attempts,lastReason==='ai_timeout'?'timed-out':'failed');
  }finally{this.queue.leave();}
 }
 async *stream<T>(options:ExecuteOptions<T>):AsyncGenerator<{type:'complete';result:GatewayResult<T>}>{
  // Provider chunks are deliberately withheld until a complete response validates; callers never see partial untrusted JSON.
  yield {type:'complete',result:await this.execute(options)};
 }
 private async invoke(provider:AiProviderAdapter,request:AiRequest,external?:AbortSignal){
  const timeout=AbortSignal.timeout(request.budget.timeoutMs),signal=external?AbortSignal.any([external,timeout]):timeout;
  let timer:ReturnType<typeof setTimeout>|undefined,abort:undefined|(()=>void);
  try{
   const canceled=new Promise((_,reject)=>{if(!external)return;abort=()=>reject(new Error('ai_canceled'));if(external.aborted)abort();else external.addEventListener('abort',abort,{once:true});});
   const raw=await Promise.race([provider.complete(request,signal),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('ai_timeout')),request.budget.timeoutMs);}),canceled]);
   const response=aiProviderResponseSchema.parse(raw);
   if(response.traceId!==request.traceId)throw new Error('ai_trace_mismatch');
   return response;
  }catch(error){if(timeout.aborted&&!external?.aborted)throw new Error('ai_timeout',{cause:error});throw error;}finally{clearTimeout(timer);if(abort)external?.removeEventListener('abort',abort);}
 }
 private async useFallback<T>(options:ExecuteOptions<T>,reason:string,attempts:number,status:Extract<AiAuditStatus,'failed'|'timed-out'|'queue-rejected'>):Promise<GatewayResult<T>>{
  const fallbackMessage=options.request.purpose==='narration'?fallbackMessages.narration:options.request.purpose==='classification'?fallbackMessages.interpretation:options.request.purpose==='creator-assistance'?fallbackMessages.creator:fallbackMessages.extraction;
  await this.audit.record({traceId:options.request.traceId,status:options.fallback?'fallback':status,attempts,inputTokens:0,outputTokens:0,reason,at:new Date(this.now()).toISOString()});
  if(!options.fallback)throw new Error(reason);
  return {traceId:options.request.traceId,status:'fallback',output:options.fallback(reason),usage:{inputTokens:0,outputTokens:0},attempts,toolResults:[],fallbackMessage,failureReason:reason};
 }
}

// Adapts deterministic and legacy test providers without weakening the provider-facing response contract.
export function localAdapter(id:string,run:(request:AiRequest,signal:AbortSignal)=>Promise<unknown>|unknown):AiProviderAdapter{return {id,async complete(request,signal){const output=await run(request,signal);return {traceId:request.traceId,output,usage:{inputTokens:0,outputTokens:0},toolCalls:[]};}};}
