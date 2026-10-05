import {performance} from 'node:perf_hooks';
import {randomUUID,randomBytes} from 'node:crypto';
import {Fault,ensure} from '../contracts.ts';
import type {Store} from '../db.ts';

export type TurnTraceStatus='running'|'committed'|'validated'|'fallback'|'failed'|'canceled';
export type TurnStepStatus='succeeded'|'failed'|'replayed'|'fallback'|'canceled';
export type TurnTraceStep={stage:string;durationMs:number;status:TurnStepStatus;failureReason?:string;details?:Record<string,unknown>};

export function failureReason(error:unknown){
 if(error instanceof Fault)return error.code;
 if(error instanceof Error&&/^[a-z0-9_]+$/.test(error.message))return error.message;
 return 'internal_error';
}

export class TurnTraceRecorder {
 readonly traceId:string;
 readonly steps:TurnTraceStep[]=[];
 constructor(traceId:string){this.traceId=traceId;}
 mark(stage:string,status:TurnStepStatus='succeeded',details:Record<string,unknown>={},reason?:string,durationMs=0){this.steps.push({stage,status,details,...(reason?{failureReason:reason}:{}),durationMs:Math.max(0,durationMs)});}
 async run<T>(stage:string,task:()=>T|Promise<T>,details:Record<string,unknown>={}):Promise<T>{
  const started=performance.now();
  try{const result=await task();this.mark(stage,'succeeded',details,undefined,performance.now()-started);return result;}
  catch(error){this.mark(stage,'failed',details,failureReason(error),performance.now()-started);throw error;}
 }
}

type TraceRow={trace_id:string;body_hash:string;status:TurnTraceStatus;event_id:string|null;rng_seed:string|null};
export async function beginTurnTrace(store:Store,input:{timelineId:string;actorId:string;requestKey:string;bodyHash:string;originalText:string;expectedRevision:number;expectedCursor?:string;seed?:string}){
 return store.transaction(async()=>{
  const existing=await store.get<TraceRow>('SELECT trace_id,body_hash,status,event_id,rng_seed FROM turn_traces WHERE timeline_id=? AND actor_id=? AND request_key=?',input.timelineId,input.actorId,input.requestKey);
  if(existing){ensure(existing.body_hash===input.bodyHash,409,'idempotency_conflict');const seed=existing.rng_seed??input.seed??randomBytes(32).toString('hex');if(!existing.rng_seed)await store.run('UPDATE turn_traces SET rng_seed=? WHERE trace_id=?',seed,existing.trace_id);return {traceId:existing.trace_id,existing,seed};}
  const traceId=randomUUID(),at=new Date().toISOString();
  await store.run("INSERT INTO turn_traces(trace_id,timeline_id,actor_id,request_key,body_hash,original_text,expected_revision,expected_cursor,event_id,status,failure_reason,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,'running',NULL,?,NULL)",traceId,input.timelineId,input.actorId,input.requestKey,input.bodyHash,input.originalText,input.expectedRevision,input.expectedCursor??null,null,at);
  const seed=input.seed??randomBytes(32).toString('hex');await store.run('UPDATE turn_traces SET rng_seed=? WHERE trace_id=?',seed,traceId);return {traceId,existing:null,seed};
 });
}

export async function persistTurnTrace(store:Store,traceId:string,steps:TurnTraceStep[],status?:TurnTraceStatus,eventId?:string,failure?:string){
 if(!steps.length&&!status)return;
 await store.transaction(async()=>{
  const row=await store.get<{n:number}>('SELECT COALESCE(max(sequence),0) n FROM turn_trace_steps WHERE trace_id=?',traceId);let sequence=row?.n??0,at=new Date().toISOString();
  for(const step of steps)await store.run('INSERT INTO turn_trace_steps(trace_id,sequence,stage,duration_ms,status,failure_reason,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)',traceId,++sequence,step.stage,step.durationMs,step.status,step.failureReason??null,JSON.stringify(step.details??{}),at);
  if(status)await store.run('UPDATE turn_traces SET event_id=COALESCE(?,event_id),status=?,failure_reason=?,completed_at=? WHERE trace_id=?',eventId??null,status,failure??null,status==='running'?null:at,traceId);
 });
}
