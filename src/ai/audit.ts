import type {AiAuditEvent,AiAuditSink} from './gateway.ts';
import type {Store} from '../db.ts';

export class SqlAiAuditSink implements AiAuditSink {
 private readonly store:Store;
 constructor(store:Store){this.store=store;}
 async record(event:AiAuditEvent){
  if(event.request){
   const request=event.request;
   await this.store.run(`INSERT INTO ai_requests (trace_id,purpose,provider,model,configuration_id,budget_json,allowed_tools_json,response_schema_id,response_schema_version,response_schema_digest,prompt_id,prompt_version,context_provenance_json,cache_policy,status,attempt_count,input_tokens,output_tokens,failure_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    event.traceId,request.purpose,request.model.provider,request.model.model,request.model.configurationId,JSON.stringify(request.budget),JSON.stringify(request.allowedTools),request.response.id,request.response.version,request.response.digest,request.prompt.id,request.prompt.version,JSON.stringify(request.context),request.cache.kind,event.status,event.attempts,event.inputTokens,event.outputTokens,event.reason??null,event.at,event.at);
   return;
  }
  await this.store.run('UPDATE ai_requests SET status=?,attempt_count=?,input_tokens=?,output_tokens=?,failure_code=?,updated_at=? WHERE trace_id=?',event.status,event.attempts,event.inputTokens,event.outputTokens,event.reason??null,event.at,event.traceId);
 }
}
