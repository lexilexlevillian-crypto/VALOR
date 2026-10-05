import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {ensure,type Actor} from '../contracts.ts';
import {AiGateway} from '../ai/gateway.ts';
import {SqlAiAuditSink} from '../ai/audit.ts';
import {makeAiRequest,responseContract,untrustedDataInstruction} from '../ai/contracts.ts';
import {usageSql,type IntentProvider} from './ai-intent.ts';
import {actionSchema,type State} from './model.ts';
import {turnClauseSchema,type TurnClause} from './turn-contracts.ts';
import {observerView} from './epistemics.ts';
import type {Game} from './engine.ts';
const evidenceSchema=z.strictObject({clauseId:z.string(),start:z.number().int().nonnegative(),end:z.number().int().positive(),text:z.string().min(1).max(1000)});
const proposalSchema=z.strictObject({clauses:z.array(turnClauseSchema).max(8),evidence:z.array(evidenceSchema).max(16),clarification:z.string().max(1000).nullable()});
export type CreativeProposal=z.infer<typeof proposalSchema>;
export interface TurnPlanner {propose(actor:Actor,timelineId:string,characterId:string,revision:number,text:string):Promise<CreativeProposal|null>;}
// IDs nested in arrays or conditions need the same visibility guard as scalar IDs.
export function validatePlanReferences(clauses:TurnClause[],visibleIds:Set<string>){
 const walk=(value:unknown,field='')=>{if(Array.isArray(value)){for(const item of value)walk(item,field.endsWith('Ids')?field.slice(0,-1):field);return;}if(value&&typeof value==='object'){for(const [key,item] of Object.entries(value))walk(item,key);return;}if(typeof value==='string'&&field.endsWith('Id')&&field!=='clauseId')ensure(visibleIds.has(value),400,'target_unavailable');};
 for(const clause of clauses)walk(clause);
}
export function observerReferenceIds(s:State,characterId:string){
 const ids=new Set<string>(),walk=(value:unknown,field='')=>{if(Array.isArray(value)){for(const item of value)walk(item,field.endsWith('Ids')?field.slice(0,-1):field);}else if(value&&typeof value==='object'){for(const [key,item] of Object.entries(value))walk(item,key);}else if(typeof value==='string'&&(field==='id'||field.endsWith('Id')))ids.add(value);};
 walk(observerView(s,characterId).entities);return ids;
}
export function describeCreativePlan(clauses:TurnClause[],s:State,characterId:string){
 const entities=observerView(s,characterId).entities,names=new Map(entities.map(e=>[e.id,e.name]));
 const words=(name:string)=>name.replace(/Ids?$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('-',' ').toLowerCase();
 const show=(value:unknown):string=>Array.isArray(value)?value.map(show).join(', '):value&&typeof value==='object'?Object.entries(value).map(([k,v])=>words(k)+': '+show(v)).join(', '):typeof value==='string'?names.get(value)??value:String(value);
 return clauses.map((clause,index)=>{const action=clause.action,details=Object.entries(action).filter(([key,value])=>key!=='type'&&value!==null&&value!=='').map(([key,value])=>key==='amountCents'?'amount: $'+(Number(value)/100).toFixed(2):words(key)+': '+show(value)).join('; ');const condition=clause.condition?'If '+(names.get(clause.condition.targetId)??'the selected object')+' is '+(clause.condition.equals?'':'not ')+clause.condition.field+', ':clause.dependency==='PREVIOUS_SUCCESS'?'If step '+index+' succeeds, ':clause.dependency==='PREVIOUS_ATTEMPT'?'After attempting step '+index+', ':'';return String(index+1)+'. '+condition+words(action.type)+(details?' ('+details+')':'');}).join('\n');
}
export function validateCreativeProposal(raw:unknown,s:State,characterId:string,text:string):CreativeProposal{
 const parsed=proposalSchema.parse(raw),ids=observerReferenceIds(s,characterId);
 validatePlanReferences(parsed.clauses,ids);
 ensure(new Set(parsed.clauses.map(c=>c.clauseId)).size===parsed.clauses.length,400,'invalid_turn_plan');
 if(parsed.clauses.length)ensure(['NONE','CONDITIONAL'].includes(parsed.clauses[0]!.dependency),400,'invalid_turn_plan');
 for(const clause of parsed.clauses){ensure(parsed.evidence.some(e=>e.clauseId===clause.clauseId&&e.start<e.end&&text.slice(e.start,e.end)===e.text),400,'ungrounded_proposal');ensure(clause.action.type!=='story'&&!(clause.action.type==='physical'&&clause.action.operation==='attempt'),400,'unsupported_proposal');if(clause.dependency==='CONDITIONAL')ensure(clause.condition,400,'condition_required');}
 return parsed;
}
// General schema composition, not selection from the UI's affordance list.
// Domain owners retain all capability, cost, visibility and outcome decisions.
export class CreativeTurnPlanner implements TurnPlanner {
 private runtime:AiGateway;private inflight=new Set<string>();
 private game:Game;private provider:IntentProvider;
 constructor(game:Game,provider:IntentProvider){this.game=game;this.provider=provider;
  this.runtime=new AiGateway([{id:provider.id,complete:(request,signal)=>{if(!provider.complete)throw new Error('planner_unavailable');return provider.complete(request,signal);}}],{audit:new SqlAiAuditSink(game.store)});
 }
 async propose(actor:Actor,timelineId:string,characterId:string,revision:number,text:string):Promise<CreativeProposal|null>{
  await this.game.authorizeCharacter(actor,timelineId,characterId);const {t}=await this.game.access(actor,timelineId),s=await this.game.load(timelineId);
  ensure(t.revision===revision,409,'revision_conflict');if(!s.settings.tokenBudget||!s.settings.userTokenBudget||this.inflight.has(timelineId))return null;
  const view=observerView(s,characterId),traceId=randomUUID();
  const instructions='Interpret the current declared attempt as at most eight ordered clauses using the supplied action contracts. Compose actions beyond suggested menus. Never declare success or create entities, facts, tools, consent or dialogue. Preserve explicit constraints and dependency ordering. Each clause needs an exact player-input evidence span. Quoted, negated and hypothetical actions are not commands. Return an empty plan and a clarification for missing targets, capabilities or material choices. The player must confirm every proposed plan. '+untrustedDataInstruction;
  // All action contracts are available. Context overflow falls back to clarification;
  // it never silently drops targets or trims away a constraint.
  const contracts=actionSchema.options.map(schema=>{const json=z.toJSONSchema(schema);return Object.fromEntries(Object.entries(json.properties as Record<string,any>).map(([key,value])=>[key,value.const??value.enum??(value.anyOf?value.anyOf.map((v:any)=>v.type??v.enum??'object'):value.type)]));});
  const context={text,actorId:characterId,entities:view.entities.map(e=>({id:e.id,kind:e.kind,name:e.name,locationId:e.data.locationId,ownerId:e.data.ownerId,category:e.data.category,tags:e.data.tags,mechanism:e.data.mechanism})),contracts};
  const outputSchema={type:'object',additionalProperties:false,required:['clauses','evidence','clarification'],properties:{clauses:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['clauseId','dependency','action'],properties:{clauseId:{type:'string',maxLength:128},dependency:{type:'string',enum:['NONE','PREVIOUS_SUCCESS','PREVIOUS_ATTEMPT','CONDITIONAL']},condition:{type:'object',additionalProperties:false,required:['targetId','field','equals'],properties:{targetId:{type:'string'},field:{type:'string',enum:['open','locked']},equals:{type:'boolean'}}},action:{type:'object'}}}},evidence:{type:'array',maxItems:16,items:z.toJSONSchema(evidenceSchema)},clarification:{type:['string','null']}}};
  // Bytes are a conservative upper bound for input token reservation, including schemas.
  const inputTokens=1024+Buffer.byteLength(JSON.stringify(context)+instructions+JSON.stringify(outputSchema)),outputTokens=2048;
  if(inputTokens>s.settings.contextTokens)return null;
  const request=makeAiRequest({traceId,purpose:'extraction',model:this.provider.identity?.('extraction')??{provider:this.provider.id,model:this.provider.id,configurationId:'creative-plan-v1'},budget:{maxInputTokens:inputTokens,maxOutputTokens:outputTokens,maxTotalTokens:inputTokens+outputTokens,timeoutMs:12000,maxAttempts:2},allowedTools:[],response:responseContract('creative-turn-plan','1',outputSchema),prompt:{id:'creative-turn-plan',version:'1',instructions},context:{provenance:[{id:'observer-plan-input',source:'player-input',trust:'untrusted',privacy:'private',revision:String(revision),content:context}]},cache:{kind:'none'}});
  const reserved=(inputTokens+outputTokens)*2;this.inflight.add(timelineId);
  try{
   await this.game.store.transaction(async()=>{
    await this.game.authorizeCharacter(actor,timelineId,characterId);const current=await this.game.access(actor,timelineId);ensure(current.t.revision===revision,409,'revision_conflict');
    const used=await this.game.store.get<{total:number;personal:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) total,COALESCE(sum(CASE WHEN u.user_id=? THEN u.reserved_tokens ELSE 0 END),0) personal FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=?',actor.id,t.campaign_id);
    ensure(used!.total+reserved<=s.settings.tokenBudget&&used!.personal+reserved<=s.settings.userTokenBudget,429,'ai_budget_exceeded');
    await this.game.store.run('INSERT INTO ai_intent_usage (id,timeline_id,user_id,provider,reserved_tokens,status,created_at) VALUES (?,?,?,?,?,?,?)',traceId,timelineId,actor.id,this.provider.id,reserved,'pending',new Date().toISOString());
   });
   const result=await this.runtime.execute({request,validate:raw=>validateCreativeProposal(raw,s,characterId,text),fallback:()=>({clauses:[],evidence:[],clarification:'Describe your intended action and target. Nothing has happened.'})});
   await this.game.store.run('UPDATE ai_intent_usage SET status=? WHERE id=?',result.status==='fallback'?'failed':'succeeded',traceId);
   await this.game.authorizeCharacter(actor,timelineId,characterId);return result.output;
  }finally{this.inflight.delete(timelineId);}
 }
}
