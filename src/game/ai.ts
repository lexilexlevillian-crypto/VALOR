import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Game} from './engine.ts';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import type {Effect} from './simulation.ts';
import {contextBrief} from './context.ts';
import {narrationPrompt} from './prompts.ts';
import {usageSql} from './ai-intent.ts';
export type NarrativeContext={promptVersion:string;instructions:string;fragments:{id:string;text:string}[];dossier?:ReturnType<typeof contextBrief>};
export interface NarrativeProvider {id:string; arrange(context:NarrativeContext,signal:AbortSignal):Promise<unknown>;estimateTokens?(context:NarrativeContext):number;}
export class GroundedProvider implements NarrativeProvider {
 id='grounded';
 async arrange(context:NarrativeContext){return {order:context.fragments.map(f=>f.id)};}
}
// Optional trusted JSON gateway; credentials are operator environment only, never campaign data.
export class JsonGatewayProvider implements NarrativeProvider {
 id='json-gateway';endpoint:string;secret:string;
 constructor(endpoint:string,secret:string){const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password)throw new Error('provider_requires_https');this.endpoint=endpoint;this.secret=secret;}
 async arrange(context:NarrativeContext,signal:AbortSignal){
  const response=await fetch(this.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+this.secret},body:JSON.stringify(context),signal});
  if(!response.ok)throw new Error('provider_failed');
  const reader=response.body?.getReader();if(!reader)throw new Error('provider_empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw new Error('provider_response_too_large');}chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
}
const output=z.strictObject({order:z.array(z.uuid()).max(200)});
export function validateNarration(raw:unknown,context:NarrativeContext){
 const result=output.parse(raw),allowed=new Set(context.fragments.map(f=>f.id));
 ensure(result.order.length===allowed.size&&new Set(result.order).size===allowed.size&&result.order.every(id=>allowed.has(id)),400,'invalid_narrative_sources');
 // Model strings are never accepted as facts, player dialogue or instructions.
 return result.order.map(id=>context.fragments.find(f=>f.id===id)!.text).join('\n\n');
}
export class NarrativeGateway {
 game:Game;providers:Map<string,NarrativeProvider>;inflight=new Set<string>();failures=new Map<string,{count:number;until:number}>();
 constructor(game:Game,providers:NarrativeProvider[]=[new GroundedProvider()]){this.game=game;this.providers=new Map(providers.map(p=>[p.id,p]));}
 async narrate(actor:Actor,timelineId:string,turnId:string,providerId='grounded'){
  const {t}=(await this.game.access(actor,timelineId));
  const turn=(await this.game.store.get<{user_id:string;character_id:string;permitted_json:string;narration:string}>('SELECT * FROM story_turns WHERE id=? AND timeline_id=?',turnId,timelineId));
  ensure(turn&&turn.user_id===actor.id,404,'turn_unavailable');
  (await this.game.authorizeCharacter(actor,timelineId,turn.character_id));
  const provider=this.providers.get(providerId);ensure(provider,400,'provider_unavailable');
  const s=(await this.game.load(timelineId));
  const context:NarrativeContext={promptVersion:narrationPrompt.version,instructions:narrationPrompt.instructions,fragments:(JSON.parse(turn.permitted_json) as Effect[]).map(f=>({id:f.id,text:f.text}))};
  const room=s.settings.contextTokens-Buffer.byteLength(JSON.stringify(context))-528;
  if(room>=256)context.dossier=contextBrief(s,turn.character_id,'',Math.min(room,2000));
  const contextSize=Buffer.byteLength(JSON.stringify(context))+512;
  ensure(contextSize<=s.settings.contextTokens,400,'context_limit');
  const estimated=provider.estimateTokens?.(context)??contextSize;
  ensure(!this.inflight.has(timelineId),409,'narration_busy');
  const failure=this.failures.get(providerId);ensure(!failure||failure.until<Date.now(),503,'provider_circuit_open');
  const reservationId=randomUUID();
  this.inflight.add(timelineId);
  try{
  (await this.game.store.transaction(async ()=>{
   await this.game.authorizeCharacter(actor,timelineId,turn.character_id);
   const current=await this.game.load(timelineId);
   const used=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON u.timeline_id=t.id WHERE t.campaign_id=?',t.campaign_id))!.n;
   const userUsed=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON u.timeline_id=t.id WHERE t.campaign_id=? AND u.user_id=?',t.campaign_id,actor.id))!.n;
   if(providerId!=='grounded'){ensure(used+estimated*2<=current.settings.tokenBudget,429,'ai_budget_exceeded');ensure(userUsed+estimated*2<=current.settings.userTokenBudget,429,'ai_user_budget_exceeded');}
   (await this.game.store.run('INSERT INTO ai_usage VALUES (?,?,?,?,?,?,?, ?,?)',reservationId,timelineId,actor.id,turnId,providerId,providerId==='grounded'?0:estimated*2,0,'pending',new Date().toISOString()));
  }));
  }catch(error){this.inflight.delete(timelineId);throw error;}
  try{
   let narration:string|undefined;
   for(let attempt=0;attempt<2;attempt++){
    try{const signal=AbortSignal.timeout(12000);let timeout:ReturnType<typeof setTimeout>|undefined;try{const raw=await Promise.race([provider.arrange(context,signal),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('provider_timeout')),12000);})]);narration=validateNarration(raw,context);break;}finally{clearTimeout(timeout);}}
    catch{if(attempt===1)throw new Error('narration_failed');}
   }
   (await this.game.store.transaction(async ()=>{
    await this.game.authorizeCharacter(actor,timelineId,turn.character_id);
    (await this.game.store.run('UPDATE story_turns SET narration=?,narration_status=?,prompt_version=? WHERE id=?',narration!,'validated',context.promptVersion,turnId));
    (await this.game.store.run('UPDATE ai_usage SET used_tokens=?,status=? WHERE id=?',providerId==='grounded'?0:estimated,'succeeded',reservationId));
   }));this.failures.delete(providerId);
   return {narration,status:'validated',promptVersion:context.promptVersion};
  }catch{
   const prior=this.failures.get(providerId)?.count??0;this.failures.set(providerId,{count:prior+1,until:prior>=2?Date.now()+60000:0});
   (await this.game.store.run('UPDATE ai_usage SET status=? WHERE id=?','failed',reservationId));
   (await this.game.authorizeCharacter(actor,timelineId,turn.character_id));
   return {narration:turn.narration,status:'grounded-fallback',promptVersion:context.promptVersion};
  }finally{this.inflight.delete(timelineId);}
 }
 async *stream(actor:Actor,timelineId:string,turnId:string,provider='grounded'){
  const result=await this.narrate(actor,timelineId,turnId,provider);
  for(const paragraph of result.narration!.split('\n\n'))yield {type:'paragraph',text:paragraph};
  yield {type:'complete',status:result.status};
 }
}
