import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ensure,type Actor} from '../contracts.ts';
import {AiGateway,localAdapter} from '../ai/gateway.ts';
import {SqlAiAuditSink} from '../ai/audit.ts';
import {aiRequestSchema,type AiProviderAdapter,type ModelIdentity} from '../ai/contracts.ts';
import type {Game} from './engine.ts';
import {usageSql} from './ai-intent.ts';
import {informationHash} from './information.ts';

const groundedReplay=localAdapter('grounded',request=>{
 const fragments=request.context.provenance.flatMap(row=>{const parsed=z.object({id:z.uuid(),text:z.string()}).safeParse(row.content);return parsed.success?[parsed.data]:[];});
 if(request.response.id==='ordered-narration')return {order:fragments.map(fragment=>fragment.id)};
 if(request.response.id==='anchored-narration')return {paragraphs:fragments.map(fragment=>({sourceIds:[fragment.id],text:fragment.text}))};
 throw new Error('grounded_replay_contract_unavailable');
});

// Diagnostic execution has no command executor, narration writer, or acquisition path.
export async function executeInformationReplay(game:Game,actor:Actor,timelineId:string,key:string,replay:any,providers:AiProviderAdapter[],model?:ModelIdentity){
 providers=[groundedReplay,...providers.filter(provider=>provider.id!=='grounded')];
 const {t}=await game.access(actor,timelineId,true);ensure(replay.request,400,'recorded_request_unavailable');ensure(replay.manifest.ready,400,'incomplete_replay_context');
 const original=aiRequestSchema.parse(replay.request);ensure(original.context.snapshot?.timelineId===timelineId,400,'replay_scope_mismatch');
 const request=aiRequestSchema.parse({...original,traceId:randomUUID(),queuedAt:new Date().toISOString(),model:model??original.model,allowedTools:[],cache:{kind:'none'},budget:{...original.budget,maxAttempts:1,timeoutMs:Math.min(12000,original.budget.timeoutMs),maxInputTokens:replay.manifest.totalTokenBudget,maxTotalTokens:replay.manifest.totalTokenBudget+original.budget.maxOutputTokens},context:{...original.context,provenance:original.context.provenance.filter(row=>replay.manifest.includedRecordIds.includes(row.id))}});
 ensure(providers.some(provider=>provider.id===request.model.provider),400,'ai_provider_unavailable');
 const responseValidator=z.fromJSONSchema(request.response.jsonSchema),estimated=Math.ceil(Buffer.byteLength(JSON.stringify(request))/3);ensure(estimated<=request.budget.maxInputTokens,400,'replay_context_limit');
 const digest=createHash('sha256').update(actor.id+':'+timelineId+':'+key).digest('hex');request.traceId=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-8'+digest.slice(17,20)+'-'+digest.slice(20,32);
 const fingerprint=informationHash({replayedFrom:replay.manifest.replayedFrom,context:request.context,model:request.model,budget:request.budget}),reserved=request.model.provider==='grounded'?0:estimated+request.budget.maxOutputTokens;
 const cached=await game.store.transaction(async()=>{
  await game.access(actor,timelineId,true);
  const prior=await game.store.get<{manifest_json:string}>('SELECT manifest_json FROM information_context_manifests WHERE id=? AND timeline_id=?',request.traceId,timelineId);
  if(prior){const saved=JSON.parse(prior.manifest_json);ensure(saved.replayFingerprint===fingerprint,409,'idempotency_conflict');ensure(saved.replayResult,409,'replay_in_progress');return saved.replayResult;}
  const current=await game.load(timelineId),used=(await game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=?',t.campaign_id))!.n,userUsed=(await game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=? AND u.user_id=?',t.campaign_id,actor.id))!.n;
  if(request.model.provider!=='grounded'){ensure(used+reserved<=current.settings.tokenBudget,429,'ai_budget_exceeded');ensure(userUsed+reserved<=current.settings.userTokenBudget,429,'ai_user_budget_exceeded');}
  const saved={...replay,request,replayFingerprint:fingerprint,manifest:{...replay.manifest,callId:request.traceId,noncanonical:true}};
  await game.store.run('INSERT INTO information_context_manifests VALUES (?,?,?,?,?,?,?,?)',request.traceId,timelineId,original.context.snapshot!.viewerId,replay.manifest.purpose,original.context.snapshot!.stateVersion,original.context.snapshot!.eventCursor,JSON.stringify(saved),new Date().toISOString());
  await game.store.run('INSERT INTO ai_intent_usage (id,timeline_id,user_id,provider,reserved_tokens,status,created_at) VALUES (?,?,?,?,?,?,?)',request.traceId,timelineId,actor.id,request.model.provider,reserved,'pending',new Date().toISOString());return null;
 });
 if(cached)return cached;
 const runtime=new AiGateway(providers,{audit:new SqlAiAuditSink(game.store)});let result:unknown;
 try{const generated=await runtime.execute({request,validate:raw=>responseValidator.parse(raw),fallback:()=>null});result={...generated,noncanonical:true,committed:false,replayedFrom:replay.manifest.replayedFrom,snapshot:request.context.snapshot,model:request.model,validation:'response-schema-only; diagnostic output cannot be committed'};}
 catch{result={traceId:request.traceId,status:'failed',noncanonical:true,committed:false,replayedFrom:replay.manifest.replayedFrom,output:null};}
 await game.store.transaction(async()=>{const row=await game.store.get<{manifest_json:string}>('SELECT manifest_json FROM information_context_manifests WHERE id=?',request.traceId);await game.store.run('UPDATE information_context_manifests SET manifest_json=? WHERE id=?',JSON.stringify({...JSON.parse(row!.manifest_json),replayResult:result}),request.traceId);await game.store.run('UPDATE ai_intent_usage SET status=? WHERE id=?',(result as {status:string}).status==='succeeded'?'succeeded':'failed',request.traceId);});
 await game.access(actor,timelineId,true);return result;
}
