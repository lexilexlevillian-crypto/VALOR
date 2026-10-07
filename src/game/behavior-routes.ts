import {releaseBehaviorLeases} from './behavior-extensions.ts';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {Fault,type Actor} from '../contracts.ts';
import type {Game} from './engine.ts';
import {data,getEntity,validateEntity} from './model.ts';
import {npcProfileSchema,behaviorGoalSchema,traitNames} from './behavior-contracts.ts';
import {behaviorState,behaviorActor,behaviorProfile,behaviorId,behaviorHash,publishBehaviorProfile,validateBehaviorProfile,decideNpcBehavior,addBehaviorGoal,wakeBehavior,promoteBehavior,adaptBehavior,setBehaviorTier,transitionBehaviorAttempt,bindBehaviorTimeline,validateBehaviorProposal} from './behavior.ts';

export function behaviorRoutes(app:FastifyInstance,game:Game,actor:(r:object)=>Actor,key:(headers:Record<string,unknown>)=>string){
 const id=z.uuid(),revision=z.number().int().positive(),params=z.strictObject({id}),base='/game/timelines/:id/npc-behavior';
 const safe=async(fn:()=>unknown)=>{try{return await fn();}catch(e){if(e instanceof Fault||e instanceof z.ZodError)throw e;if(e instanceof Error&&/^[a-z_]+$/.test(e.message))throw new Fault(400,e.message);throw e;}};
 const command=z.discriminatedUnion('operation',[
  z.strictObject({operation:z.literal('publish'),profile:npcProfileSchema,reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('goal'),goal:behaviorGoalSchema.omit({createdByEventId:true})}),
  z.strictObject({operation:z.literal('freeze'),actorId:id,frozen:z.boolean(),reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('reevaluate'),actorId:id,reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('promote'),actorId:id,reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('tier'),actorId:id,tier:z.enum(['ACTIVE','NEARBY','BACKGROUND','DORMANT']),reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('repair'),actorId:id,attemptId:id,reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('adapt'),actorId:id,trait:z.enum(traitNames),delta:z.number().int().min(-1000).max(1000),sourceIds:z.array(id).min(2).max(100),reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('template'),templateId:z.string().min(1).max(160),version:z.string().min(1).max(160),status:z.enum(['draft','validated','published','retired']),profile:npcProfileSchema,reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('instantiate'),templateId:z.string().min(1).max(160),version:z.string().min(1).max(160),actorId:id,reason:z.string().min(1).max(2000)}),
  z.strictObject({operation:z.literal('materialize'),seed:z.string().min(1).max(160),name:z.string().min(1).max(160),locationId:id,reason:z.string().min(1).max(2000)}),
 ]);
 app.get(base+'/schema',async r=>safe(async()=>{const {id:tid}=params.parse(r.params);await game.access(actor(r),tid,true);return {profile:z.toJSONSchema(npcProfileSchema),commands:z.toJSONSchema(command),planner:{enabled:true,reason:'Opt-in per profile; direct provider credentials and campaign budgets required. Emergency decisions always use the deterministic controller.'}};}));
 app.get(base+'/inspect',async r=>safe(async()=>{
  const {id:tid}=params.parse(r.params),q=z.strictObject({actorId:id,offset:z.coerce.number().int().nonnegative().default(0)}).parse(r.query);await game.access(actor(r),tid,true);const s=await game.load(tid),e=getEntity(s,q.actorId,'character');if(e.data.playable)throw new Error('npc_required');
  return {actorId:e.id,profile:behaviorProfile(s,e.id)??null,defaultProfile:npcProfileSchema.parse({actorId:e.id,version:'custom-v1'}),state:s.npcBehavior?.actors.find(a=>a.actorId===e.id)??null,profiles:s.npcBehavior?.profiles.filter(p=>p.actorId===e.id)??[],decisions:(s.npcBehavior?.decisions.filter(d=>d.actorId===e.id)??[]).slice().reverse().slice(q.offset,q.offset+50),interventions:s.npcBehavior?.interventions.filter(i=>i.actorId===e.id)??[],templates:s.npcBehavior?.templates??[],voice:data(e,'character').voiceProfile,authority:'CREATOR_ONLY',revision:(await game.access(actor(r),tid)).t.revision};
 }));
 app.post(base+'/preview',async r=>safe(async()=>{
  const {id:tid}=params.parse(r.params),body=z.strictObject({profile:npcProfileSchema}).parse(r.body);await game.access(actor(r),tid,true);const s=await game.load(tid),p=validateBehaviorProfile(s,body.profile),eventId=behaviorId('preview',tid,p.actorId,p.version);
  // All preview mutations are confined to this disposable snapshot.
  const previewProfile={...p,version:'preview-'+behaviorHash(p).slice(0,20)};publishBehaviorProfile(s,previewProfile,eventId,'Creator preview');bindBehaviorTimeline(s,tid);
  const first=decideNpcBehavior(s,p.actorId,eventId),c=data(getEntity(s,p.actorId,'character'),'character');
  const due=structuredClone(s);due.clock=new Date(Date.parse(s.clock)+Math.max(1,...c.plans.map(p=>p.cooldownMinutes))*60000).toISOString();
  const next=decideNpcBehavior(due,p.actorId,behaviorId(eventId,'due'));
  return {valid:true,persisted:false,clock:s.clock,scenarios:[{name:'current-state',decision:first},{name:'after-authored-cooldowns',decision:next}],profile:p};
 }));
 app.post(base+'/validate-proposal',async r=>safe(async()=>{
  const {id:tid}=params.parse(r.params),body=z.strictObject({actorId:id,decisionId:id,proposal:z.unknown()}).parse(r.body);await game.access(actor(r),tid,true);const s=await game.load(tid),a=behaviorActor(s,body.actorId),d=s.npcBehavior?.decisions.find(d=>d.id===body.decisionId&&d.actorId===a.actorId&&d.branchId===tid);if(!d)throw new Error('behavior_decision_unavailable');
  // Validation tooling never executes a model proposal or supplies a commit capability.
  const proposal=validateBehaviorProposal(body.proposal,d,a,new Set(d.candidates.filter(c=>c.eligible).flatMap(c=>c.planId?[c.planId]:[])));return {valid:true,executed:false,proposal};
 }));
 app.post(base+'/command',async r=>safe(async()=>{
  const {id:tid}=params.parse(r.params),body=z.strictObject({revision,command}).parse(r.body);
  return game.mutate(actor(r),tid,body.revision,key(r.headers),body,'creator.npc-behavior',true,async(s,eventId)=>{
   const c=body.command;let result:unknown;const b=behaviorState(s);bindBehaviorTimeline(s,tid);const scoped=await game.access(actor(r),tid);b.scope={campaignId:scoped.t.campaign_id,stateVersion:body.revision,eventCursor:eventId};
   if(c.operation==='publish')result=publishBehaviorProfile(s,c.profile,eventId,c.reason);
   else if(c.operation==='goal')result=addBehaviorGoal(s,{...c.goal,createdByEventId:eventId});
   else if(c.operation==='template'){
    if(c.status!=='draft')validateBehaviorProfile(s,c.profile);const prior=b.templates.find(t=>t.id===c.templateId&&t.version===c.version);
    if(prior&&['published','retired'].includes(prior.status)&&!(c.status==='retired'&&prior.status==='published'&&behaviorHash(prior.profile)===behaviorHash(c.profile)))throw new Error('immutable_behavior_template');
    const template={id:c.templateId,version:c.version,status:c.status,profile:c.profile,eventId};if(prior)b.templates[b.templates.indexOf(prior)]=template;else b.templates.push(template);result=template;
   }else if(c.operation==='instantiate'){
    const template=b.templates.find(t=>t.id===c.templateId&&t.version===c.version&&t.status==='published');if(!template)throw new Error('behavior_template_unavailable');
    // Plans remain owned by the target character; explicit migration must match them.
    result=publishBehaviorProfile(s,{...template.profile,actorId:c.actorId,version:c.templateId+'-'+c.version,templateRef:c.templateId},eventId,c.reason);
   }else if(c.operation==='materialize'){
    getEntity(s,c.locationId,'location');const actorId=behaviorId(tid,'crowd',c.seed),prior=s.entities.find(e=>e.id===actorId);
    if(prior){if(prior.kind!=='character'||prior.data.playable)throw new Error('behavior_identity_collision');result={actorId,persisted:true};}
    else{const entity=validateEntity({id:actorId,kind:'character',name:c.name,visibility:'knowledge',data:{locationId:c.locationId}});s.entities.push(entity);publishBehaviorProfile(s,{actorId,version:'generated-v1',origin:'GENERATED',generationSeed:c.seed},eventId,c.reason);result={actorId,persisted:true};}
   }else{
    const a=behaviorActor(s,c.actorId);
    if(c.operation==='freeze'){a.frozen=c.frozen;a.generation++;a.nextEvaluationAt=s.clock;result=a;}
    if(c.operation==='reevaluate'){wakeBehavior(s,a.actorId,eventId,'developer',true);const entity=getEntity(s,a.actorId,'character'),character=data(entity,'character');for(const plan of character.plans)if(plan.failedAttempts>=3)plan.failedAttempts=0;entity.data=character;result={queued:true,nextEvaluationAt:a.nextEvaluationAt};}
    if(c.operation==='promote')result=promoteBehavior(s,a.actorId,eventId,c.reason);
    if(c.operation==='tier'){const pending=await game.store.get("SELECT 1 FROM turn_input_state WHERE timeline_id=? AND pending_json IS NOT NULL",tid);result=setBehaviorTier(s,a.actorId,c.tier,!!pending);}
    if(c.operation==='repair'){const attempt=a.attempts.find(t=>t.id===c.attemptId);if(!attempt)throw new Error('behavior_attempt_unavailable');transitionBehaviorAttempt(attempt,'CANCELED',s.clock,'DEVELOPER_COMPENSATION');releaseBehaviorLeases(s,attempt.id);a.pendingDomain=null;a.continuation=null;a.currentActionId=null;a.nextEvaluationAt=s.clock;result=attempt;}
    if(c.operation==='adapt')result=adaptBehavior(s,a.actorId,c.trait,c.delta,c.sourceIds,eventId);
   }
   const actorId='actorId' in c?c.actorId:'profile' in c?c.profile.actorId:c.operation==='goal'?c.goal.actorId:(result as {actorId:string}).actorId;
   b.interventions.push({eventId,actorId,at:s.clock,operation:c.operation,reason:'reason' in c?c.reason:'Creator goal authoring'});return {result:{behavior:result}};
  });
 }));
}
