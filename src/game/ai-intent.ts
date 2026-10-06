import {captureInformationScope,assertInformationScope} from './information-context.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import type {Game} from './engine.ts';
import type {Action,State} from './model.ts';
import {observerView} from './epistemics.ts';
import type {IntentProposal} from './intent.ts';
import {AiGateway,localAdapter} from '../ai/gateway.ts';
import {SqlAiAuditSink} from '../ai/audit.ts';
import {makeAiRequest,responseContract,untrustedDataInstruction,type AiProviderAdapter,type AiPurpose,type AiRequest,type ModelIdentity} from '../ai/contracts.ts';

export type IntentContext={version:'intent-v1';text:string;candidates:{id:string;label:string;action:Action}[]};
export interface IntentProvider{id:string;interpret?(context:IntentContext,signal:AbortSignal):Promise<unknown>;complete?(request:AiRequest,signal:AbortSignal):Promise<unknown>;identity?(purpose:AiPurpose):ModelIdentity;estimateIntentTokens(context:IntentContext):number;}
export const usageSql='SELECT reserved_tokens,timeline_id,user_id FROM ai_usage UNION ALL SELECT reserved_tokens,timeline_id,user_id FROM ai_intent_usage';
export function intentContext(s:State,characterId:string,text:string):IntentContext{
 const view=observerView(s,characterId),self=view.entities.find(e=>e.id===characterId)!;
 const choices:{label:string;action:Action}[]=[{label:'Look around',action:{type:'look'}},{label:'Search current place',action:{type:'search'}},{label:'Wait ten minutes',action:{type:'wait',minutes:10}},{label:'Rest for one hour',action:{type:'sleep',minutes:60}}];
 const location=view.entities.find(e=>e.id===self.data.locationId),exits=new Set((location?.data.exits as Array<{to:string}>??[]).map(e=>e.to));
 const ordered=[...view.entities].sort((a,b)=>Number(b.data.locationId===self.data.locationId)-Number(a.data.locationId===self.data.locationId));
 const combat=view.entities.find(e=>e.kind==='combat'&&e.data.active&&(e.data.participants as string[]).includes(characterId));
 if(combat){choices.push({label:'Raise a guard and block',action:{type:'defend',defense:'block'}},{label:'Dodge the attack',action:{type:'defend',defense:'dodge'}},{label:'Surrender',action:{type:'surrender'}});}
 for(const e of ordered){
  if(e.kind==='character'&&e.id!==characterId&&e.data.locationId===self.data.locationId)choices.push({label:'Punch '+e.name,action:{type:'attack',targetId:e.id,weaponId:null,bodyPart:'torso'}});
  if(combat&&e.kind==='location'&&exits.has(e.id))choices.push({label:'Flee to '+e.name,action:{type:'flee',destinationId:e.id}});
  if(e.kind==='location'&&exits.has(e.id))choices.push({label:'Walk to '+e.name,action:{type:'travel',destinationId:e.id,mode:'walk',vehicleId:null}});
  if(e.kind==='recipe')choices.push({label:'Prepare '+e.name,action:{type:'cook',recipeId:e.id}});
  if(e.kind==='item'){if((e.data.possessorId??e.data.ownerId)===characterId){if(['food','drink','medicine','substance'].includes(String(e.data.category)))choices.push({label:'Consume one '+e.name,action:{type:'consume',itemId:e.id}});choices.push({label:(e.data.equipped?'Unequip ':'Equip ')+e.name,action:{type:'equip',itemId:e.id,equipped:!e.data.equipped}});}else if(!e.data.possessorId&&!e.data.ownerId&&e.data.locationId===self.data.locationId)choices.push({label:'Take '+e.name,action:{type:'take',itemId:e.id}});}
 }
 const context:IntentContext={version:'intent-v1',text,candidates:[]};
 for(const choice of choices.slice(0,100)){context.candidates.push({id:String(context.candidates.length),...choice});if(Buffer.byteLength(JSON.stringify(context))>s.settings.contextTokens-512){context.candidates.pop();break;}}
 return context;
}
const intentResult=z.strictObject({choice:z.string().max(10).nullable()});
const intentJsonSchema:Record<string,unknown>={type:'object',properties:{choice:{type:['string','null'],maxLength:10}},required:['choice'],additionalProperties:false};
const intentInstructions='Select one supplied candidate ID only when it matches the player text; otherwise choose null. Only select an unambiguous action the player is taking now. Quoted, remembered, negated, hypothetical, conditional, or merely considered actions must return null. This proposes an interpretation only. Never execute an action, invent consent, or add player speech.';

export class IntentGateway{
 private game:Game;private providers:Map<string,IntentProvider>;private inflight:Set<string>;private failures=new Map<string,{count:number;until:number}>();private contexts=new Map<string,IntentContext>();private runtime:AiGateway;
 constructor(game:Game,providers:IntentProvider[],inflight=new Set<string>()){
  this.game=game;this.providers=new Map(providers.map(p=>[p.id,p]));this.inflight=inflight;
  const adapters:AiProviderAdapter[]=providers.map(provider=>provider.complete?{id:provider.id,complete:(request,signal)=>provider.complete!(request,signal)}:localAdapter(provider.id,async(request,signal)=>{const context=this.contexts.get(request.traceId);if(!context||!provider.interpret)throw new Error('intent_context_unavailable');return provider.interpret(context,signal);}));
  this.runtime=new AiGateway(adapters,{audit:new SqlAiAuditSink(game.store)});
 }
 async propose(actor:Actor,timelineId:string,characterId:string,text:string,providerId:string):Promise<IntentProposal>{
  await this.game.authorizeCharacter(actor,timelineId,characterId);const {t}=await this.game.access(actor,timelineId),s=await this.game.load(timelineId),provider=this.providers.get(providerId);ensure(provider,400,'provider_unavailable');
  const context=intentContext(s,characterId,text);ensure(context.candidates.length&&Buffer.byteLength(JSON.stringify(context))+512<=s.settings.contextTokens,400,'context_limit');
  const prior=this.failures.get(providerId);ensure(!prior||prior.until<Date.now(),503,'provider_circuit_open');ensure(!this.inflight.has(timelineId),409,'narration_busy');
  const tokens=provider.estimateIntentTokens(context);ensure(Number.isSafeInteger(tokens)&&tokens>0,400,'invalid_provider_estimate');const traceId=randomUUID(),identity=provider.identity?.('classification')??{provider:provider.id,model:provider.id,configurationId:'classification-'+provider.id+'-v1'};
  const informationScope=await captureInformationScope(this.game,timelineId,characterId);ensure(informationScope.stateVersion===t.revision,409,'stale_information_context');
  const request=makeAiRequest({traceId,purpose:'classification',model:identity,budget:{maxInputTokens:s.settings.contextTokens,maxOutputTokens:256,maxTotalTokens:s.settings.contextTokens+256,timeoutMs:12000,maxAttempts:2},allowedTools:['interpretation.propose'],response:responseContract('intent-choice','1',intentJsonSchema),prompt:{id:'intent-classification',version:context.version,instructions:intentInstructions+' '+untrustedDataInstruction},context:{snapshot:{...informationScope,purpose:'input-parser'},provenance:[
   {id:'player-input',source:'player-input',trust:'untrusted',privacy:'private',revision:String(t.revision),content:text},
   {id:'candidate-set',source:'lore',trust:'untrusted',privacy:'private',revision:String(t.revision),content:context.candidates}
  ]},cache:{kind:'none'}});
  this.inflight.add(timelineId);this.contexts.set(traceId,context);
  try{
   await this.game.store.transaction(async()=>{
    await this.game.authorizeCharacter(actor,timelineId,characterId);const current=await this.game.load(timelineId);
    const used=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=?',t.campaign_id))!.n;
    const userUsed=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=? AND u.user_id=?',t.campaign_id,actor.id))!.n;
    ensure(used+tokens<=current.settings.tokenBudget,429,'ai_budget_exceeded');ensure(userUsed+tokens<=current.settings.userTokenBudget,429,'ai_user_budget_exceeded');
    await this.game.store.run('INSERT INTO ai_intent_usage (id,timeline_id,user_id,provider,reserved_tokens,status,created_at) VALUES (?,?,?,?,?,?,?)',traceId,timelineId,actor.id,providerId,tokens,'pending',new Date().toISOString());
   });
   const result=await this.runtime.execute({request,validate:raw=>{const parsed=intentResult.parse(raw);if(parsed.choice!==null&&!context.candidates.some(candidate=>candidate.id===parsed.choice))throw new Error('invalid_proposal_choice');return parsed;},fallback:()=>({choice:null}),toolAuthorization:{interpretationCandidates:new Set(context.candidates.map(candidate=>candidate.id))}});
   await assertInformationScope(this.game,informationScope);
   if(result.status==='fallback'){
    this.failures.set(providerId,{count:(prior?.count??0)+1,until:(prior?.count??0)>=2?Date.now()+60000:0});await this.game.store.run('UPDATE ai_intent_usage SET status=? WHERE id=?','failed',traceId);await this.game.authorizeCharacter(actor,timelineId,characterId);
    return {action:null,requiresConfirmation:true,originalText:text,classification:'clarification',clarification:result.fallbackMessage};
   }
   const choice=context.candidates.find(candidate=>candidate.id===result.output.choice);ensure(result.output.choice===null||choice,400,'invalid_proposal_choice');
   await this.game.authorizeCharacter(actor,timelineId,characterId);await this.game.store.run('UPDATE ai_intent_usage SET status=? WHERE id=?','succeeded',traceId);this.failures.delete(providerId);
   return choice?{action:choice.action,requiresConfirmation:true,originalText:text,classification:'proposal'}:{action:null,requiresConfirmation:true,originalText:text,classification:'clarification',clarification:'Choose an explicit action or provide a clearer target. Nothing has happened.'};
  }finally{this.contexts.delete(traceId);this.inflight.delete(timelineId);}
 }
}
