import {applyStoryAdditions,storyAdditionsSchema,storyScene,type StoryAddition} from './story-world.ts';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {Game} from './engine.ts';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import type {Effect} from './simulation.ts';
import {buildContextManifest,contextBrief,RepetitionTracker,reviewNarrativeOutput} from './context.ts';
import {anchoredNarrationPrompt,narrationPrompt} from './prompts.ts';
import {usageSql} from './ai-intent.ts';
import {AiGateway,localAdapter} from '../ai/gateway.ts';
import {SqlAiAuditSink} from '../ai/audit.ts';
import {HttpAiProvider} from '../ai/http.ts';
import {makeAiRequest,responseContract,untrustedDataInstruction,type AiProviderAdapter,type AiPurpose,type AiRequest,type ModelIdentity} from '../ai/contracts.ts';
import {TurnTraceRecorder,failureReason,persistTurnTrace} from './turn-pipeline.ts';

export type NarrativeMode='grounded'|'anchored-prose';
export type NarrativeContext={promptVersion:string;instructions:string;mode?:NarrativeMode;allowExpansion?:boolean;protectedIds?:string[];fragments:{id:string;text:string}[];dossier?:ReturnType<typeof contextBrief>};
export interface NarrativeProvider {id:string;estimateInputTokens?(request:AiRequest):number;arrange?(context:NarrativeContext,signal:AbortSignal):Promise<unknown>;complete?(request:AiRequest,signal:AbortSignal):Promise<unknown>;identity?(purpose:AiPurpose):ModelIdentity;estimateTokens?(context:NarrativeContext):number;}
export class GroundedProvider implements NarrativeProvider {
 id='grounded';
 identity():ModelIdentity{return {provider:this.id,model:'deterministic-v1',configurationId:'narration-grounded-v1'};}
 async arrange(context:NarrativeContext){return context.mode==='anchored-prose'?{paragraphs:context.fragments.map(f=>({sourceIds:[f.id],text:f.text}))}:{order:context.fragments.map(f=>f.id)};}
}
// Optional trusted JSON gateway; credentials are operator environment only, never campaign data.
export class JsonGatewayProvider implements NarrativeProvider {
 id='json-gateway';private readonly adapter:HttpAiProvider;
 constructor(endpoint:string,secret:string){this.adapter=new HttpAiProvider(this.id,endpoint,secret);}
 identity():ModelIdentity{return {provider:this.id,model:'gateway-managed-v1',configurationId:'narration-gateway-v1'};}
 complete(request:AiRequest,signal:AbortSignal){return this.adapter.complete(request,signal);}
}
const output=z.strictObject({order:z.array(z.uuid()).max(200)});
const anchoredOutput=z.strictObject({additions:storyAdditionsSchema.optional(),paragraphs:z.array(z.strictObject({sourceIds:z.array(z.uuid()).min(1).max(50),text:z.string().min(1).max(4000)})).max(200)});
export function validateAnchoredNarration(raw:unknown,context:NarrativeContext){
 const result=anchoredOutput.parse(raw),allowed=new Map(context.fragments.map(f=>[f.id,f.text])),used=new Set<string>();
 const paragraphs=result.paragraphs.map(paragraph=>{for(const id of paragraph.sourceIds){ensure(allowed.has(id),400,'invalid_narrative_sources');used.add(id);}return paragraph.text.trim();});
 ensure(used.size===allowed.size&&[...allowed.keys()].every(id=>used.has(id)),400,'incomplete_narrative_sources');
 const narration=paragraphs.join('\n\n');
 for(const id of context.protectedIds??[]){const text=allowed.get(id);ensure(text!==undefined&&narration.includes(text),400,'player_dialogue_not_preserved');}
 let connective=narration;for(const text of allowed.values())connective=connective.replaceAll(text,'');
 connective=connective.replace(/["“][^"”]*["”]/g,'');
 ensure(!/\b(?:you|your|yourself|i|we|our)\b/i.test(connective),400,'player_agency_violation');
 ensure(Buffer.byteLength(narration)<=24000,400,'narration_too_large');return narration;
}
export function validateStoryVoice(narration:string,context:NarrativeContext){
 let prose=narration;
 for(const id of context.protectedIds??[]){const fragment=context.fragments.find(f=>f.id===id);if(fragment)prose=prose.replaceAll(fragment.text,'');}
 prose=prose.replace(/["“][^"”]*["”]/g,'');
 ensure(!/\b(?:you|your|yourself|i|we|our|my)\b/i.test(prose),400,'story_requires_third_person');
 ensure(!/\b(?:is|are|am|has|have|does|do|will)\b/i.test(prose),400,'story_requires_past_tense');
}
export function validateNarration(raw:unknown,context:NarrativeContext){
 if(context.mode==='anchored-prose')return validateAnchoredNarration(raw,context);
 const result=output.parse(raw),allowed=new Set(context.fragments.map(f=>f.id));
 ensure(result.order.length===allowed.size&&new Set(result.order).size===allowed.size&&result.order.every(id=>allowed.has(id)),400,'invalid_narrative_sources');
 return result.order.map(id=>context.fragments.find(f=>f.id===id)!.text).join('\n\n');
}
// All provider paths use the same field limits and the actual permitted event IDs.
export function narrativeJsonSchema(context:NarrativeContext):Record<string,unknown>{
 const ids=context.fragments.map(fragment=>fragment.id),source={type:'string',...(ids.length?{enum:ids}:{format:'uuid'})};
 return context.mode==='anchored-prose'?{
  type:'object',properties:{additions:{type:'array',maxItems:context.allowExpansion?3:0,items:{type:'object',properties:{kind:{type:'string',enum:['npc','street','place','detail']},name:{type:'string',minLength:2,maxLength:80},description:{type:'string',minLength:1,maxLength:600}},required:['kind','name','description'],additionalProperties:false}},paragraphs:{type:'array',maxItems:ids.length?200:0,items:{type:'object',properties:{sourceIds:{type:'array',items:source,minItems:1,maxItems:50},text:{type:'string',minLength:1,maxLength:4000}},required:['sourceIds','text'],additionalProperties:false}}},required:['paragraphs'],additionalProperties:false
 }:{type:'object',properties:{order:{type:'array',items:source,minItems:ids.length,maxItems:Math.min(ids.length,200)}},required:['order'],additionalProperties:false};
}

// Exercise the production complete() path, including non-citable background, with synthetic text only.
export function narrationProbe(model:ModelIdentity){
 const id='00000000-0000-4000-8000-000000000001',context:NarrativeContext={mode:'anchored-prose',allowExpansion:false,promptVersion:anchoredNarrationPrompt.version,instructions:anchoredNarrationPrompt.instructions,fragments:[{id,text:'Alex waited by the door.'}]};
 const request=makeAiRequest({purpose:'narration',model,budget:{maxInputTokens:2000,maxOutputTokens:256,maxTotalTokens:2256,timeoutMs:12000,maxAttempts:1},allowedTools:['narration.compose'],response:responseContract('anchored-narration','2',narrativeJsonSchema(context)),prompt:{id:'narration-probe',version:context.promptVersion,instructions:context.instructions+' For this connection check, write one brief sentence only; additions must be [].'},context:{provenance:[{id,source:'simulation',trust:'trusted',privacy:'public',revision:'1',content:context.fragments[0]},{id:'original-story-input',source:'player-input',trust:'untrusted',privacy:'private',revision:'1',content:'I waited by the door.'},{id:'dossier',source:'lore',trust:'untrusted',privacy:'public',revision:'1',content:'Alex lived in Valor.'}]},cache:{kind:'none'}});
 return {context,request};
}

export class NarrativeGateway {
 game:Game;providers:Map<string,NarrativeProvider>;inflight=new Set<string>();failures=new Map<string,{count:number;until:number}>();
 private contexts=new Map<string,NarrativeContext>();private runtime:AiGateway;
 constructor(game:Game,providers:NarrativeProvider[]=[new GroundedProvider()]){
  this.game=game;this.providers=new Map(providers.map(p=>[p.id,p]));
  const adapters:AiProviderAdapter[]=providers.map(provider=>provider.complete?{id:provider.id,complete:(request,signal)=>provider.complete!(request,signal)}:localAdapter(provider.id,async(request,signal)=>{
   const context=this.contexts.get(request.traceId);if(!context||!provider.arrange)throw new Error('narrative_context_unavailable');return provider.arrange(context,signal);
  }));
  this.runtime=new AiGateway(adapters,{audit:new SqlAiAuditSink(game.store)});
 }
 async narrate(actor:Actor,timelineId:string,turnId:string,providerId='grounded',externalSignal?:AbortSignal,style?:'story'){
  if(externalSignal?.aborted)throw new Error('narration_canceled');
  const {t}=await this.game.access(actor,timelineId);
  const turn=await this.game.store.get<{user_id:string;character_id:string;input_text:string;permitted_json:string;narration:string;narration_status:string}>('SELECT * FROM story_turns WHERE id=? AND timeline_id=?',turnId,timelineId);
  ensure(turn&&turn.user_id===actor.id,404,'turn_unavailable');await this.game.authorizeCharacter(actor,timelineId,turn.character_id);
  const parentTrace=await this.game.store.get<{trace_id:string}>('SELECT trace_id FROM turn_traces WHERE event_id=? AND timeline_id=?',turnId,timelineId),turnTrace=parentTrace?new TurnTraceRecorder(parentTrace.trace_id):undefined,contextStarted=performance.now();
  const provider=this.providers.get(providerId);ensure(provider,400,'provider_unavailable');const s=await this.game.load(timelineId),effects=JSON.parse(turn.permitted_json) as Effect[],mode=style==='story'?'anchored-prose':s.settings.narrationMode,prompt=mode==='anchored-prose'?anchoredNarrationPrompt:narrationPrompt;
  const latest=await this.game.store.get<{id:string}>('SELECT id FROM story_turns WHERE timeline_id=? ORDER BY rowid DESC LIMIT 1',timelineId);
  const allowExpansion=style==='story'&&providerId!=='grounded'&&latest?.id===turnId&&turn.narration_status!=='validated'&&!await this.game.store.get('SELECT timeline_id FROM shared_world WHERE timeline_id=?',timelineId);
  let additions:StoryAddition[]=[];
  const context:NarrativeContext={allowExpansion,promptVersion:prompt.version,instructions:prompt.instructions,mode,protectedIds:effects.filter(f=>f.type==='player.dialogue'&&f.subjectId===turn.character_id).map(f=>f.id),fragments:effects.map(f=>({id:f.id,text:f.text}))};
  const recent=(await this.game.store.all<{id:string;input_text:string;narration:string}>('SELECT id,input_text,narration FROM story_turns WHERE timeline_id=? AND character_id=? AND id<>? ORDER BY rowid DESC LIMIT 8',timelineId,turn.character_id,turnId)).reverse().map(row=>({id:row.id,input:row.input_text,narration:row.narration}));
  const scene=storyScene(s,turn.character_id),sceneText=JSON.stringify(scene),compactSceneText=JSON.stringify({...scene,people:scene.people.map(p=>({name:p.name})),details:[],knownNames:[],place:scene.place?{...scene.place,description:''}:null});
  if(style==='story')context.instructions+=' '+(allowExpansion?'Up to 3 additions {kind,name,description}: npc (adult bystander here only if allowNewPeople), street/place (public outdoors only), detail (mundane lasting scene fact). Register every new named person/place or lasting fact; reuse existing ones. No invented grants, money, injuries, permissions or major canon.':'additions must be []; rewrite only, no new lasting facts.')+' Untrusted scene: '+sceneText;
  const contextBytes=s.settings.contextTokens*(style==='story'?2:1),envelopeBytes=style==='story'?1536+Buffer.byteLength(turn.input_text):528;
  const preliminaryRoom=contextBytes-Buffer.byteLength(JSON.stringify(context))-envelopeBytes,manifest=buildContextManifest(s,turn.character_id,'',{maxTokens:Math.max(64,Math.floor(Math.max(preliminaryRoom,256)/4)),currentEvents:effects,recentConversation:recent});
  if(style==='story')manifest.controls.pov='third-person-limited';
  context.instructions+=' Validated narrative controls: POV '+manifest.controls.pov+'; pacing '+manifest.controls.pacing+'; tone '+manifest.controls.tone+'; tension '+manifest.controls.tension+'; spotlight '+manifest.controls.spotlightId+'; excluded content '+JSON.stringify(manifest.controls.safety.excludedContent)+'. Server truth, player agency, and consent remain mandatory.';
  const room=contextBytes-Buffer.byteLength(JSON.stringify(context))-envelopeBytes;if(room>=256)context.dossier=contextBrief(s,turn.character_id,'',Math.min(room,2000),{currentEvents:effects,recentConversation:recent});
  if(style==='story'&&Math.ceil(Buffer.byteLength(JSON.stringify(context))/2)+512>s.settings.contextTokens){delete context.dossier;context.instructions=context.instructions.replace(sceneText,compactSceneText);}
  const contextSize=Math.ceil(Buffer.byteLength(JSON.stringify(context))/(style==='story'?2:1))+512;ensure(contextSize<=s.settings.contextTokens,400,'context_limit');
  let estimated=provider.estimateTokens?.(context)??contextSize;ensure(!this.inflight.has(timelineId),409,'narration_busy');
  const failure=this.failures.get(providerId);ensure(!failure||failure.until<Date.now(),503,'provider_circuit_open');
  const traceId=randomUUID(),identity=provider.identity?.('narration')??{provider:provider.id,model:provider.id,configurationId:'narration-'+provider.id+'-v1'};
  const fragmentProvenance=context.fragments.map(fragment=>{const effect=effects.find(value=>value.id===fragment.id),player=context.protectedIds?.includes(fragment.id),npc=effect?.type.startsWith('npc.');return {id:fragment.id,source:player?'player-input' as const:npc?'npc-text' as const:'simulation' as const,trust:player||npc?'untrusted' as const:'trusted' as const,privacy:player?'private' as const:'campaign' as const,revision:String(t.revision),content:fragment};});
  const request=makeAiRequest({traceId,purpose:'narration',model:identity,budget:{maxInputTokens:s.settings.contextTokens,maxOutputTokens:style==='story'?1024:2048,maxTotalTokens:s.settings.contextTokens+2048,timeoutMs:12000,maxAttempts:style==='story'?1:2},allowedTools:['narration.compose'],response:responseContract(mode==='anchored-prose'?'anchored-narration':'ordered-narration','2',narrativeJsonSchema(context)),prompt:{id:'game-narration',version:context.promptVersion,instructions:context.instructions+' '+untrustedDataInstruction},context:{provenance:[
   ...fragmentProvenance,
   ...(style==='story'?[{id:'original-story-input',source:'player-input' as const,trust:'untrusted' as const,privacy:'private' as const,revision:String(t.revision),content:turn.input_text}]:[]),
   ...(context.dossier?[{id:'dossier',source:'lore' as const,trust:'untrusted' as const,privacy:'campaign' as const,revision:String(t.revision),content:context.dossier}]:[])
  ]},cache:{kind:'none'}});
  if(style==='story'&&provider.estimateInputTokens){
   // Trim optional background before sacrificing required event sources or exceeding the allowance.
   if(provider.estimateInputTokens(request)>request.budget.maxInputTokens&&context.dossier){delete context.dossier;request.context.provenance=request.context.provenance.filter(entry=>entry.id!=='dossier');}
   if(provider.estimateInputTokens(request)>request.budget.maxInputTokens)request.prompt.instructions=request.prompt.instructions.replace(sceneText,compactSceneText);
   const inputTokens=provider.estimateInputTokens(request);ensure(inputTokens<=request.budget.maxInputTokens,400,'context_limit');estimated=request.budget.maxInputTokens+request.budget.maxOutputTokens;
  }
  turnTrace?.mark('context-build','succeeded',{eventId:turnId,manifestIncluded:context.dossier!==undefined},undefined,performance.now()-contextStarted);
  this.inflight.add(timelineId);this.contexts.set(traceId,context);
  try{
   await this.game.store.transaction(async()=>{
    await this.game.authorizeCharacter(actor,timelineId,turn.character_id);const current=await this.game.load(timelineId);
    const used=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON u.timeline_id=t.id WHERE t.campaign_id=?',t.campaign_id))!.n;
    const userUsed=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON u.timeline_id=t.id WHERE t.campaign_id=? AND u.user_id=?',t.campaign_id,actor.id))!.n;
    if(providerId!=='grounded'){ensure(used+estimated*request.budget.maxAttempts<=current.settings.tokenBudget,429,'ai_budget_exceeded');ensure(userUsed+estimated*request.budget.maxAttempts<=current.settings.userTokenBudget,429,'ai_user_budget_exceeded');}
    await this.game.store.run('INSERT INTO ai_usage (id,timeline_id,user_id,turn_id,provider,reserved_tokens,used_tokens,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',traceId,timelineId,actor.id,turnId,providerId,providerId==='grounded'?0:estimated*request.budget.maxAttempts,0,'pending',new Date().toISOString());
   });
   const repetition=new RepetitionTracker(recent.map(row=>row.narration)),execute=()=>this.runtime.execute({request,validate:raw=>{const narration=validateNarration(raw,context);additions=mode==='anchored-prose'?anchoredOutput.parse(raw).additions??[]:[];ensure(allowExpansion||additions.length===0,400,'story_retry_cannot_expand');if(additions.length)applyStoryAdditions(structuredClone(s),turn.character_id,turnId,additions);if(style==='story')validateStoryVoice(narration,context);const review=reviewNarrativeOutput(narration,manifest.controls,repetition,context.fragments.map(fragment=>fragment.text),effects);ensure(review.accepted,400,review.flags.some(flag=>flag.kind==='safety')?'narrative_content_rejected':review.flags.some(flag=>flag.kind==='unsupported-mechanical-claim')?'narrative_mechanical_claim_rejected':'narrative_repetition_rejected');return narration;},fallback:()=>turn.narration,signal:externalSignal,toolAuthorization:{narrativeSourceIds:new Set(context.fragments.map(fragment=>fragment.id))}}),result=turnTrace?await turnTrace.run('narration-attempts',execute,{eventId:turnId,retryScope:'narration-only',mechanicsRerolled:false}):await execute();
   turnTrace?.mark('output-validation',result.status==='fallback'?'fallback':'succeeded',{eventId:turnId,attempts:result.attempts,sameEventBundle:true,mechanicsRerolled:false},result.failureReason);
   if(result.status==='fallback'){
    const prior=this.failures.get(providerId)?.count??0;this.failures.set(providerId,{count:prior+1,until:prior>=2?Date.now()+60000:0});await this.game.store.run('UPDATE ai_usage SET status=? WHERE id=?','failed',traceId);
    if(turnTrace)await persistTurnTrace(this.game.store,turnTrace.traceId,turnTrace.steps,'fallback',turnId,result.failureReason);
    return {narration:turn.narration,status:'grounded-fallback',promptVersion:context.promptVersion,traceId,failureCode:result.failureReason,fallbackMessage:result.fallbackMessage,recovery:{mechanicsPreserved:true,rerolled:false,message:'Narration assistance failed. The committed deterministic result is unchanged.'}};
   }
   const commitNarration=()=>this.game.store.transaction(async()=>{await this.game.authorizeCharacter(actor,timelineId,turn.character_id);ensure(!externalSignal?.aborted,409,'narration_canceled');if(additions.length)await this.game.expandStory(actor,timelineId,t.revision,turnId,turn.character_id,additions,result.output,context.promptVersion);await this.game.store.run('UPDATE story_turns SET narration=?,narration_status=?,prompt_version=? WHERE id=?',result.output,providerId==='grounded'?'grounded':'validated',context.promptVersion,turnId);await this.game.store.run('UPDATE ai_usage SET used_tokens=?,status=? WHERE id=?',providerId==='grounded'?0:result.usage.inputTokens+result.usage.outputTokens,'succeeded',traceId);});
   if(turnTrace)await turnTrace.run('narration-commit',commitNarration,{eventId:turnId,mechanicsChanged:false});else await commitNarration();
   if(turnTrace)await persistTurnTrace(this.game.store,turnTrace.traceId,turnTrace.steps,'validated',turnId);
   this.failures.delete(providerId);return {narration:result.output,status:'validated',promptVersion:context.promptVersion,traceId,recovery:{mechanicsPreserved:true,rerolled:false}};
  }catch(error){
   if(externalSignal?.aborted||error instanceof Error&&error.message==='ai_canceled'){await this.game.store.run('UPDATE ai_usage SET status=? WHERE id=?','canceled',traceId);turnTrace?.mark('narration-pipeline','canceled',{eventId:turnId,mechanicsPreserved:true},'narration_canceled');if(turnTrace)await persistTurnTrace(this.game.store,turnTrace.traceId,turnTrace.steps,'canceled',turnId,'narration_canceled').catch(()=>{});await this.game.authorizeCharacter(actor,timelineId,turn.character_id);throw new Error('narration_canceled',{cause:error});}
   await this.game.store.run('UPDATE ai_usage SET status=? WHERE id=?','failed',traceId).catch(()=>{});turnTrace?.mark('narration-pipeline','failed',{eventId:turnId,mechanicsPreserved:true},failureReason(error));if(turnTrace)await persistTurnTrace(this.game.store,turnTrace.traceId,turnTrace.steps,'committed',turnId,failureReason(error)).catch(()=>{});throw error;
  }finally{this.contexts.delete(traceId);this.inflight.delete(timelineId);}
 }
 async *stream(actor:Actor,timelineId:string,turnId:string,provider='grounded'){
  const result=await this.narrate(actor,timelineId,turnId,provider);for(const paragraph of result.narration!.split('\n\n'))yield {type:'paragraph',text:paragraph};yield {type:'complete',status:result.status};
 }
}
