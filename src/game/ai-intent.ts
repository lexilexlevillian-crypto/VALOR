import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import type {Game} from './engine.ts';
import type {Action,State} from './model.ts';
import {observerView} from './epistemics.ts';
import type {IntentProposal} from './intent.ts';
export type IntentContext={version:'intent-v1';text:string;candidates:{id:string;label:string;action:Action}[]};
export interface IntentProvider{id:string;interpret(context:IntentContext,signal:AbortSignal):Promise<unknown>;estimateIntentTokens(context:IntentContext):number;}
export const usageSql='SELECT reserved_tokens,timeline_id,user_id FROM ai_usage UNION ALL SELECT reserved_tokens,timeline_id,user_id FROM ai_intent_usage';
export function intentContext(s:State,characterId:string,text:string):IntentContext{
 const view=observerView(s,characterId),self=view.entities.find(e=>e.id===characterId)!;
 const choices:{label:string;action:Action}[]=[{label:'Look around',action:{type:'look'}},{label:'Search current place',action:{type:'search'}},{label:'Wait ten minutes',action:{type:'wait',minutes:10}},{label:'Rest for one hour',action:{type:'sleep',minutes:60}}];
 for(const e of view.entities){
  if(e.kind==='location'&&e.id!==self.data.locationId)choices.push({label:'Walk to '+e.name,action:{type:'travel',destinationId:e.id,mode:'walk',vehicleId:null}});
  if(e.kind==='recipe')choices.push({label:'Prepare '+e.name,action:{type:'cook',recipeId:e.id}});
  if(e.kind==='item'){
   if(e.data.ownerId===characterId){if(['food','drink','medicine','substance'].includes(String(e.data.category)))choices.push({label:'Consume one '+e.name,action:{type:'consume',itemId:e.id}});choices.push({label:(e.data.equipped?'Unequip ':'Equip ')+e.name,action:{type:'equip',itemId:e.id,equipped:!e.data.equipped}});}
   else if(!e.data.ownerId)choices.push({label:'Take '+e.name,action:{type:'take',itemId:e.id}});
  }
 }
 const context:IntentContext={version:'intent-v1',text,candidates:[]};
 for(const choice of choices.slice(0,100)){context.candidates.push({id:String(context.candidates.length),...choice});if(Buffer.byteLength(JSON.stringify(context))>s.settings.contextTokens-512){context.candidates.pop();break;}}
 return context;
}
export class IntentGateway{
 private game:Game;private providers:Map<string,IntentProvider>;private inflight:Set<string>;private failures=new Map<string,{count:number;until:number}>();
 constructor(game:Game,providers:IntentProvider[],inflight=new Set<string>()){this.game=game;this.providers=new Map(providers.map(p=>[p.id,p]));this.inflight=inflight;}
 async propose(actor:Actor,timelineId:string,characterId:string,text:string,providerId:string):Promise<IntentProposal>{
  await this.game.authorizeCharacter(actor,timelineId,characterId);const {t}=await this.game.access(actor,timelineId),s=await this.game.load(timelineId),provider=this.providers.get(providerId);ensure(provider,400,'provider_unavailable');
  const context=intentContext(s,characterId,text);ensure(context.candidates.length&&Buffer.byteLength(JSON.stringify(context))+512<=s.settings.contextTokens,400,'context_limit');
  const prior=this.failures.get(providerId);ensure(!prior||prior.until<Date.now(),503,'provider_circuit_open');ensure(!this.inflight.has(timelineId),409,'narration_busy');
  const tokens=provider.estimateIntentTokens(context);ensure(Number.isSafeInteger(tokens)&&tokens>0,400,'invalid_provider_estimate');const requestId=randomUUID();this.inflight.add(timelineId);
  try{
   await this.game.store.transaction(async()=>{
    await this.game.authorizeCharacter(actor,timelineId,characterId);const current=await this.game.load(timelineId);
    const used=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=?',t.campaign_id))!.n;
    const userUsed=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=? AND u.user_id=?',t.campaign_id,actor.id))!.n;
    ensure(used+tokens<=current.settings.tokenBudget,429,'ai_budget_exceeded');ensure(userUsed+tokens<=current.settings.userTokenBudget,429,'ai_user_budget_exceeded');
    await this.game.store.run('INSERT INTO ai_intent_usage VALUES (?,?,?,?,?,?,?)',requestId,timelineId,actor.id,providerId,tokens,'pending',new Date().toISOString());
   });
   try{
    const signal=AbortSignal.timeout(12000);let timer:ReturnType<typeof setTimeout>|undefined;let raw:unknown;
    try{raw=await Promise.race([provider.interpret(context,signal),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('provider_timeout')),12000);})]);}finally{clearTimeout(timer);}
    const parsed=z.strictObject({choice:z.string().max(10).nullable()}).parse(raw),choice=context.candidates.find(c=>c.id===parsed.choice);ensure(parsed.choice===null||choice,400,'invalid_proposal_choice');
    await this.game.authorizeCharacter(actor,timelineId,characterId);await this.game.store.run('UPDATE ai_intent_usage SET status=? WHERE id=?','succeeded',requestId);this.failures.delete(providerId);
    return choice?{action:choice.action,requiresConfirmation:true}:{action:null,requiresConfirmation:true,clarification:'Choose an explicit action or provide a clearer target. Nothing has happened.'};
   }catch{
    this.failures.set(providerId,{count:(prior?.count??0)+1,until:(prior?.count??0)>=2?Date.now()+60000:0});await this.game.store.run('UPDATE ai_intent_usage SET status=? WHERE id=?','failed',requestId);
    await this.game.authorizeCharacter(actor,timelineId,characterId);return {action:null,requiresConfirmation:true,clarification:'AI interpretation is unavailable. Use the explicit action panel. Nothing has happened.'};
   }
  }finally{this.inflight.delete(timelineId);}
 }
}
