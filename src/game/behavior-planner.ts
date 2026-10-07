import {data,getEntity} from './model.ts';
import {z} from 'zod';
import {AiGateway} from '../ai/gateway.ts';
import {SqlAiAuditSink} from '../ai/audit.ts';
import {makeAiRequest,responseContract,untrustedDataInstruction} from '../ai/contracts.ts';
import type {NarrativeProvider} from './ai.ts';
import type {Game} from './engine.ts';
import type {Actor} from '../contracts.ts';
import {ensure} from '../contracts.ts';
import {behaviorActor,behaviorProfile,behaviorId,behaviorHash,buildNpcBehaviorContext,decideNpcBehavior} from './behavior.ts';
import type {NpcBehavior} from './behavior-contracts.ts';
import {usageSql} from './ai-intent.ts';
const resultSchema=z.strictObject({planIds:z.array(z.uuid()).min(1).max(3)});
export type NpcPlannerInput=NpcBehavior['plannerInputs'][number];
export class NpcBehaviorPlanner {
 readonly game:Game;readonly providers:NarrativeProvider[];
 constructor(game:Game,providers:NarrativeProvider[]){this.game=game;this.providers=providers;}
 async prepare(user:Actor,timelineId:string,playerId:string,revision:number,commandId:string):Promise<NpcPlannerInput[]>{
  await this.game.authorizeCharacter(user,timelineId,playerId);const {t}=await this.game.access(user,timelineId);ensure(t.revision===revision,409,'revision_conflict');const s=await this.game.load(timelineId),root=s.npcBehavior;if(!root)return [];
  if(root.actors.some(a=>a.wakes.some(w=>w.mandatory)||a.pendingDomain||Object.values(a.conflicts).some(c=>c.stage==='THREATENED'))||s.entities.some(e=>e.kind==='combat'&&e.data.active))return [];
  const a=[...root.actors].sort((a,b)=>a.actorId.localeCompare(b.actorId)).find(a=>!a.frozen&&!a.currentActionId&&!a.continuation&&behaviorProfile(s,a.actorId)?.planner.enabled&&a.tier!=='DORMANT');if(!a)return [];
  const p=behaviorProfile(s,a.actorId)!,provider=this.providers.find(provider=>provider.id===p.planner.provider&&provider.complete);if(!provider)return [];
  const requestId=behaviorId(commandId,a.actorId,'npc-planner'),prior=await this.game.store.get<{result_json:string}>('SELECT result_json FROM npc_planner_requests WHERE id=? AND timeline_id=?',requestId,timelineId);if(prior)return JSON.parse(prior.result_json);
  const context=buildNpcBehaviorContext(s,a.actorId,commandId);if(!context.manifest.ready)return [];
  const sandbox=structuredClone(s),d=decideNpcBehavior(sandbox,a.actorId,commandId),offered=d.candidates.filter(c=>c.planId&&(c.eligible||c.reasonCode==='NOT_DUE')).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,a.stress>=700?4:p.policy.optionalCandidateCap).map(c=>c.planId!);if(!offered.length)return [];
  const offeredPlans=data(getEntity(s,a.actorId,'character'),'character').plans.filter(plan=>offered.includes(plan.id)).map(plan=>({planId:plan.id,action:plan.type,targetId:plan.targetId,targetName:context.projection.entities.find(e=>e.id===plan.targetId)?.name??'',text:plan.text,goalRefs:a.goals.filter(g=>g.planId===plan.id&&g.status==='ACTIVE').map(g=>g.id),providerAction:p.providerActions.find(b=>b.planId===plan.id)?.action??null}));
  const tokens=Math.ceil(Buffer.byteLength(JSON.stringify({bundle:context.bundle,offeredPlans}))/3)+1024,scope=root.scope!,identity=provider.identity?.('classification')??{provider:provider.id,model:provider.id,configurationId:'npc-planner-v1'};
  if(!s.settings.tokenBudget||!s.settings.userTokenBudget)return [];
  const claimed=await this.game.store.transaction(async()=>{if(await this.game.store.get('SELECT 1 FROM npc_planner_requests WHERE id=?',requestId))return false;const used=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=?',scope.campaignId))!.n,userUsed=(await this.game.store.get<{n:number}>('SELECT COALESCE(sum(u.reserved_tokens),0) n FROM ('+usageSql+') u JOIN timelines t ON t.id=u.timeline_id WHERE t.campaign_id=? AND u.user_id=?',scope.campaignId,user.id))!.n;ensure(used+tokens*2<=s.settings.tokenBudget&&userUsed+tokens*2<=s.settings.userTokenBudget,429,'ai_budget_exceeded');await this.game.store.run('INSERT OR IGNORE INTO ai_intent_usage VALUES (?,?,?,?,?,?,?)',requestId,timelineId,user.id,provider.id,tokens*2,'pending',new Date().toISOString());await this.game.store.run('INSERT INTO npc_planner_requests VALUES (?,?,?,?,?,?)',requestId,timelineId,a.actorId,revision,'[]',new Date().toISOString());return true;});if(!claimed)return [];
  const request=makeAiRequest({traceId:requestId,purpose:'classification',model:identity,budget:{maxInputTokens:Math.max(1024,s.settings.contextTokens),maxOutputTokens:256,maxTotalTokens:Math.max(1024,s.settings.contextTokens)+256,timeoutMs:2000,maxAttempts:2},allowedTools:[],response:responseContract('npc-plan','1',z.toJSONSchema(resultSchema)),prompt:{id:'npc-plan',version:'1',instructions:'Select one to three distinct offered plan IDs in execution order. Return only {planIds:[...]}. Never add facts, actions, outcomes, dialogue or parameters. '+untrustedDataInstruction},context:{snapshot:{campaignId:scope.campaignId,timelineId,viewerId:a.actorId,stateVersion:revision,eventCursor:scope.eventCursor,purpose:'npc-planner'},provenance:[{id:'npc-context',source:'npc-text',trust:'untrusted',privacy:'private',revision:String(revision),content:{...context.bundle,offeredPlanIds:offered,offeredPlans}}]},cache:{kind:'reproducible',ttlSeconds:3600}});
  const gateway=new AiGateway([{id:provider.id,complete:(request,signal)=>provider.complete!(request,signal)}],{audit:new SqlAiAuditSink(this.game.store)}),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);
  let inputs:NpcPlannerInput[]=[];
  try{const result=await gateway.execute({request,signal:controller.signal,validate:raw=>{if(Buffer.byteLength(JSON.stringify(raw))>16384)throw new Error('behavior_proposal_too_large');const r=resultSchema.parse(raw);if(new Set(r.planIds).size!==r.planIds.length||r.planIds.some(id=>!offered.includes(id)))throw new Error('invalid_behavior_plan');return r;},fallback:()=>null});if(result.output)inputs=[{id:requestId,actorId:a.actorId,branchId:timelineId,profileVersion:p.version,baseRevision:revision,generation:a.generation,contextHash:context.contextHash,planIds:result.output.planIds,status:'ACCEPTED',proposal:result.output,eventId:commandId}];}
  catch(error){if(!controller.signal.aborted)throw error;}
  finally{clearTimeout(timer);await this.game.store.run('UPDATE ai_intent_usage SET status=? WHERE id=?',inputs.length?'succeeded':'failed',requestId);}
  await this.game.store.run('UPDATE npc_planner_requests SET result_json=? WHERE id=?',JSON.stringify(inputs),requestId);return inputs;
 }
}
