import {validateProviderActions,providerCandidateGate,recognizedBehaviorTarget,bypassBehaviorCooldown,applyBehaviorDevelopments,releaseBehaviorLeases} from './behavior-extensions.ts';
import {createHash} from 'node:crypto';
import {data,getEntity,type State,type Data} from './model.ts';
import {observerView} from './epistemics.ts';
import {buildInformationContext} from './information-context.ts';
import {conversationState} from './communication.ts';
import {matchesCondition} from './conditions.ts';
import {relationshipBehaviorSignal} from './social.ts';
import {resolveTraitEffects} from './traits.ts';
import {localTime} from './calendar.ts';
import {enabled,technology} from './policy.ts';
import {transmitInformation,exposeTransmission} from './information.ts';
import type {Effect} from './simulation.ts';
import {npcBehaviorSchema,npcProfileSchema,behaviorFeaturesSchema,behaviorWeightsSchema,behaviorGoalSchema,behaviorProposalSchema,behaviorRulesVersion,featureNames,type NpcProfile,type BehaviorActor,type BehaviorGoal,type BehaviorCandidate,type BehaviorDecision,type BehaviorAttempt} from './behavior-contracts.ts';

type Plan=Data<'character'>['plans'][number];
const planHash=({lastRun,runsToday,runDate,failedAttempts,lastOutcome,...semantic}:Plan)=>behaviorHash(semantic);
const clamp=(n:number)=>Math.max(0,Math.min(1000,Math.round(n)));
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>order(a,b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
export const behaviorHash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export function behaviorId(...parts:string[]){const h=behaviorHash(parts);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
const plus=(at:string,seconds:number)=>new Date(Date.parse(at)+seconds*1000).toISOString();
const neutral=()=>({G:0,N:0,V:0,O:0,S:0,R:0,E:0,P:0});
export const behaviorState=(s:State)=>s.npcBehavior??=npcBehaviorSchema.parse({});
export function behaviorProfile(s:State,actorId:string){const b=s.npcBehavior,a=b?.actors.find(a=>a.actorId===actorId);return a?b!.profiles.find(p=>p.actorId===actorId&&p.version===a.profileVersion):undefined;}
export function behaviorActor(s:State,actorId:string){const a=s.npcBehavior?.actors.find(a=>a.actorId===actorId);if(!a)throw new Error('npc_behavior_unavailable');return a;}
function assertNpc(s:State,actorId:string){const e=getEntity(s,actorId,'character');if(e.data.playable)throw new Error('npc_required');return e;}
export function utilityScore(features:BehaviorCandidate['features'],weights:NpcProfile['policy']['weights']){
 behaviorFeaturesSchema.parse(features);behaviorWeightsSchema.parse(weights);
 const n=featureNames.reduce((sum,key)=>sum+weights[key]*features[key],0);return Math.sign(n)*Math.floor(Math.abs(n)/1000+0.5);
}
export function selectBehavior(candidates:BehaviorCandidate[],currentId:string|null,margin=50){
 const rows=candidates.filter(c=>c.eligible).sort((a,b)=>Number(b.mandatory)-Number(a.mandatory)||b.score-a.score||Number(b.id===currentId)-Number(a.id===currentId)||order(a.id,b.id)),best=rows[0],current=rows.find(c=>c.id===currentId);
 return best&&current&&!best.mandatory&&best.score-current.score<=margin?current:best??null;
}
function validateProfileLocks(p:NpcProfile){
 if(p.anchors.some(a=>a.kind==='HARD'&&!a.action))throw new Error('behavior_anchor_action_required');
 for(const action of p.allowedActions){const rules=p.anchors.filter(a=>a.kind==='HARD'&&a.action===action),top=Math.max(-1,...rules.map(a=>a.priority));if(new Set(rules.filter(a=>a.priority===top).map(a=>a.allow)).size>1)throw new Error('conflicting_behavior_anchors');}
}
export function validateBehaviorProfile(s:State,raw:unknown){
 const p=npcProfileSchema.parse(raw),c=data(assertNpc(s,p.actorId),'character'),planIds=new Set(c.plans.map(p=>p.id));
 for(const collection of [p.anchors,p.motives,p.fears,p.habits,p.loyalties,p.boundaryPolicies,p.appraisals])if(new Set(collection.map(x=>x.id)).size!==collection.length)throw new Error('duplicate_behavior_rule');
 validateProfileLocks(p);
 if(p.preferences.some(r=>!planIds.has(r.planId))||p.habits.some(r=>!planIds.has(r.planId)))throw new Error('behavior_plan_unavailable');
 if(p.needResponses.some(r=>!planIds.has(r.planId)))throw new Error('behavior_plan_unavailable');
 for(const loyalty of p.loyalties){if(Boolean(loyalty.targetId)===Boolean(loyalty.motiveRef))throw new Error('behavior_loyalty_target_required');if(loyalty.targetId)getEntity(s,loyalty.targetId);if(loyalty.motiveRef&&!p.motives.some(m=>m.id===loyalty.motiveRef))throw new Error('behavior_motive_unavailable');}
 for(const boundary of p.boundaryPolicies){if(boundary.targetId)getEntity(s,boundary.targetId);if(p.boundaryPolicies.some(other=>other!==boundary&&other.action===boundary.action&&other.targetId===boundary.targetId&&other.permission!==boundary.permission))throw new Error('conflicting_behavior_boundaries');}
 if(new Set(p.preferences.map(r=>r.planId)).size!==p.preferences.length)throw new Error('duplicate_behavior_preference');
 if(new Set(p.speechActs.map(r=>r.planId)).size!==p.speechActs.length)throw new Error('duplicate_behavior_speech_act');
 for(const act of p.speechActs){const plan=c.plans.find(plan=>plan.id===act.planId&&plan.type==='speak');if(!plan)throw new Error('behavior_speech_plan_required');for(const id of act.claimEntryIds)if(!s.information?.entries.some(e=>e.id===id&&e.characterId===p.actorId&&e.status==='active'))throw new Error('behavior_claim_unavailable');for(const id of act.commitmentIds)if(!s.information?.active.some(t=>t.id===id&&t.characterId===p.actorId&&t.kind==='promise'))throw new Error('behavior_commitment_unavailable');}
 for(const ref of p.disclosureLocks)if(!s.facts.some(f=>f.id===ref)&&!s.information?.propositions.some(f=>f.id===ref))throw new Error('behavior_disclosure_reference_unavailable');
 for(const preference of p.preferences){if(preference.goalId&&!s.npcBehavior?.actors.find(a=>a.actorId===p.actorId)?.goals.some(g=>g.id===preference.goalId))throw new Error('behavior_goal_unavailable');for(const source of preference.sourceIds)if(!s.facts.some(f=>f.id===source&&s.knowledge.some(k=>k.observerId===p.actorId&&k.factId===source))&&!s.information?.observations.some(o=>o.id===source&&o.observerId===p.actorId))throw new Error('behavior_evidence_unavailable');}
 validateProviderActions(s,p);
 // No arbitrary bias predicates, executable free text, combat shortcuts or missing policy references.
 return p;
}
export function publishBehaviorProfile(s:State,raw:unknown,eventId:string,reason='Creator profile publication'){
 const p=validateBehaviorProfile(s,raw),b=behaviorState(s),prior=b.profiles.find(r=>r.actorId===p.actorId&&r.version===p.version);
 if(prior){if(behaviorHash(prior)!==behaviorHash(p))throw new Error('immutable_behavior_profile_version');return prior;}
 let a=b.actors.find(a=>a.actorId===p.actorId);
 if(a){for(const attempt of a.attempts)if(!terminal(attempt.status)){attempt.status='STALE';attempt.updatedAt=s.clock;attempt.reasonCode='PROFILE_MIGRATED';}a.generation++;a.profileVersion=p.version;a.currentActionId=null;a.currentPlanId=null;a.pendingDomain=null;a.continuation=null;a.nextEvaluationAt=s.clock;for(const lease of b.leases)if(lease.actorId===a.actorId&&lease.status==='ACTIVE')lease.status='RELEASED';}
 else{a={continuation:null,pendingDomain:null,milestoneHistory:[],bypasses:[],actorId:p.actorId,profileVersion:p.version,revision:0,lastEvaluatedAt:s.clock,recoveredAt:s.clock,nextEvaluationAt:s.clock,tier:'BACKGROUND',frozen:false,persistent:p.origin!=='GENERATED',generation:0,currentPlanId:null,currentActionId:null,emotion:{},mood:0,stress:0,recoveryRemainders:{},conflicts:{},cooldowns:[],goals:[],attempts:[],appraisals:[],adaptations:[],baseline:{...p.traits},wakes:[],promotions:[],blockedReason:''};b.actors.push(a);}
 const entity=assertNpc(s,p.actorId),character=data(entity,'character');for(const plan of character.plans)plan.lastRun??=s.clock;entity.data=character;
 b.profiles.push(p);b.interventions.push({eventId,actorId:p.actorId,at:s.clock,operation:'publish-profile',reason});return p;
}
export function bindBehaviorTimeline(s:State,branchId:string){
 if(!s.npcBehavior)return;const b=s.npcBehavior;
 if(b.branchId&&b.branchId!==branchId){b.scope=null;for(const a of b.actors){a.generation++;a.pendingDomain=null;for(const input of b.plannerInputs)if(input.status==='ACCEPTED')input.status='STALE';for(const lease of b.leases)if(lease.actorId===a.actorId&&lease.status==='ACTIVE')lease.status='RELEASED';for(const attempt of a.attempts)if(!terminal(attempt.status)&&attempt.status!=='INTERRUPTED'){attempt.status='STALE';attempt.reasonCode='BRANCH_INVALIDATED';attempt.updatedAt=s.clock;}a.currentActionId=a.attempts.some(t=>t.id===a.currentActionId&&t.status==='INTERRUPTED')?a.currentActionId:null;}}
 b.branchId=branchId;
}
export function validateBehaviorState(s:State){
 if(!s.npcBehavior)return;const b=npcBehaviorSchema.parse(s.npcBehavior);
 if(new Set(b.actors.map(a=>a.actorId)).size!==b.actors.length||new Set(b.profiles.map(p=>p.actorId+':'+p.version)).size!==b.profiles.length||new Set(b.decisions.map(d=>d.id)).size!==b.decisions.length)throw new Error('duplicate_behavior_identity');
 for(const a of b.actors){const entity=s.entities.find(e=>e.id===a.actorId&&e.kind==='character');if(!entity||entity.data.playable||!b.profiles.some(p=>p.actorId===a.actorId&&p.version===a.profileVersion))throw new Error('invalid_behavior_actor');validateProfileLocks(b.profiles.find(p=>p.actorId===a.actorId&&p.version===a.profileVersion)!);if(a.currentActionId&&!a.attempts.some(t=>t.id===a.currentActionId))throw new Error('invalid_behavior_continuation');for(const g of a.goals)if(g.actorId!==a.actorId)throw new Error('invalid_behavior_goal_owner');validateGoalGraph(a.goals);}
}
export function recoverBehavior(a:BehaviorActor,p:NpcProfile,at:string){
 const elapsed=Date.parse(at)-Date.parse(a.recoveredAt);if(elapsed<0)throw new Error('behavior_time_reversed');
 const recover=(key:string,value:number,rate:number)=>{const total=elapsed*rate+(a.recoveryRemainders[key]??0),loss=Math.floor(total/1000);a.recoveryRemainders[key]=loss>=value?0:total%1000;return Math.max(0,value-loss);};
 a.stress=recover('stress',a.stress,p.policy.recoveryPerSecond.stress);a.mood=recover('mood',a.mood,p.policy.recoveryPerSecond.mood);
 for(const key of Object.keys(a.emotion))a.emotion[key]=recover('emotion:'+key,a.emotion[key]!,p.policy.recoveryPerSecond.emotion);a.recoveredAt=at;
}
export function applyBehaviorAppraisal(s:State,actorId:string,observationId:string){
 const a=behaviorActor(s,actorId),p=behaviorProfile(s,actorId)!;
 if(a.appraisals.some(x=>x.causeId===observationId))return false;
 const o=s.information?.observations.find(o=>o.id===observationId&&o.observerId===actorId&&Date.parse(o.at)<=Date.parse(s.clock));if(!o)throw new Error('behavior_observation_unavailable');
 const kind=String(o.conditions.memoryKind??o.conditions.kind??o.conditions.resolver??''),rule=p.appraisals.find(r=>r.observationKind===kind),fear=p.fears.find(f=>f.observationKind===kind),intensity=rule?.intensity??fear?.intensity??(/threat|violence|injur/.test(kind)?700:0);
 if(!intensity)return false;
 recoverBehavior(a,p,s.clock);const value=clamp(intensity*o.confidence),stress=clamp((rule?.stress??intensity)*o.confidence),emotion=rule?.emotion??'fear';a.stress=clamp(a.stress+stress);a.emotion[emotion]=clamp((a.emotion[emotion]??0)+value);a.mood=clamp(a.mood+(rule?.mood??0)*o.confidence);
 a.appraisals.push({causeId:o.id,at:s.clock,stress,emotion,intensity:value,profileVersion:p.version});
 if(emotion==='fear')updateBehaviorConflict(a,p,o.targetId??o.id,value,[o.id],s.clock);return true;
}
export function updateBehaviorConflict(a:BehaviorActor,p:NpcProfile,key:string,threat:number,sourceIds:string[],at:string){
 if(!Number.isInteger(threat)||threat<0||threat>1000||!sourceIds.length)throw new Error('behavior_conflict_evidence_required');
 const old=a.conflicts[key],emergency=threat>=p.policy.threatEnter;
 if(old&&!emergency&&Date.parse(at)-Date.parse(old.changedAt)<p.policy.conflictDwellSeconds*1000)return old;
 const stage=emergency?'THREATENED':old?.stage==='THREATENED'&&threat>p.policy.threatExit?'THREATENED':threat>p.policy.threatExit?'WARY':old&&old.stage!=='CALM'&&old.stage!=='RECOVERING'?'RECOVERING':threat===0?'CALM':'WARY';
 return a.conflicts[key]={stage,threat,changedAt:old?.stage===stage?old.changedAt:at,sourceIds};
}
export function validateGoalGraph(goals:BehaviorGoal[]){
 const rows=new Map(goals.map(g=>[g.id,g])),visiting=new Set<string>(),done=new Set<string>();if(rows.size!==goals.length)throw new Error('duplicate_behavior_goal');
 const visit=(id:string)=>{if(visiting.has(id))throw new Error('behavior_goal_cycle');if(done.has(id))return;const g=rows.get(id);if(!g)throw new Error('behavior_goal_dependency_unavailable');visiting.add(id);g.dependencyGoalIds.forEach(visit);visiting.delete(id);done.add(id);};goals.forEach(g=>visit(g.id));
}
export function addBehaviorGoal(s:State,raw:unknown){
 const g=behaviorGoalSchema.parse(raw),a=behaviorActor(s,g.actorId),p=behaviorProfile(s,g.actorId)!;
 if(g.status!=='PROPOSED'||g.evidenceEventIds.length)throw new Error('behavior_goal_outcome_requires_provider');
 if(a.goals.some(old=>old.id===g.id))throw new Error('duplicate_behavior_goal');
 if(!p.motives.some(m=>m.id===g.motiveRef)||!data(assertNpc(s,g.actorId),'character').plans.some(t=>t.id===g.planId&&t.enabled))throw new Error('behavior_goal_unavailable');
 const goals=[...a.goals,g];validateGoalGraph(goals);a.goals=goals;prioritizeBehaviorGoals(a,s.clock);a.nextEvaluationAt=s.clock;return g;
}
function prioritizeBehaviorGoals(a:BehaviorActor,at:string){
 for(const g of a.goals)if(['PROPOSED','ACTIVE','SUSPENDED'].includes(g.status)&&g.deadline&&Date.parse(g.deadline)<=Date.parse(at))g.status='EXPIRED';
 const eligible=a.goals.filter(g=>['PROPOSED','ACTIVE','SUSPENDED'].includes(g.status)).sort((a,b)=>Number(!!b.deadline)-Number(!!a.deadline)||(a.deadline&&b.deadline?order(a.deadline,b.deadline):0)||b.priority-a.priority||order(a.id,b.id));
 let active=0,suspended=0;for(const g of eligible){if(g.dependencyGoalIds.some(id=>a.goals.find(x=>x.id===id)?.status!=='SATISFIED')){g.status=++suspended<=12||g.deadline?'SUSPENDED':'ABANDONED';g.suspensionReason=g.status==='ABANDONED'?'GOAL_BUDGET':'DEPENDENCY_PENDING';continue;}if(active++<4){g.status='ACTIVE';g.suspensionReason='';}else{g.status=++suspended<=12||g.deadline?'SUSPENDED':'ABANDONED';g.suspensionReason='GOAL_BUDGET';}}
}
export function behaviorAwake(s:State,a:BehaviorActor){return a.tier!=='DORMANT'||a.wakes.some(w=>Date.parse(w.dueAt)<=Date.parse(s.clock))||a.goals.some(g=>['PROPOSED','ACTIVE','SUSPENDED'].includes(g.status)&&g.deadline&&Date.parse(g.deadline)<=Date.parse(s.clock));}
export function wakeBehavior(s:State,actorId:string,causeId:string,kind:string,mandatory=false,dueAt=s.clock){
 const a=behaviorActor(s,actorId),key=behaviorHash([actorId,causeId,kind]);if(a.wakes.some(w=>w.key===key))return;
 if(a.wakes.length>=1000)throw new Error('behavior_wake_queue_full');a.wakes.push({key,causeId,dueAt,kind,mandatory});if(Date.parse(dueAt)<Date.parse(a.nextEvaluationAt))a.nextEvaluationAt=dueAt;
}
export function buildNpcBehaviorContext(s:State,actorId:string,eventId:string){
 const p=behaviorProfile(s,actorId),a=behaviorActor(s,actorId),branchId=s.npcBehavior!.branchId??s.information?.memoryTimelineId??behaviorId('unbound-fixture'),dialogue=conversationState(s,actorId);
 const projection=observerView(s,actorId),requiredSceneIds=data(assertNpc(s,actorId),'character').plans.filter(p=>p.enabled).flatMap(p=>[p.targetId,...(p.auxiliaryId?[p.auxiliaryId]:[])]);
 const scope=s.npcBehavior!.scope,context=buildInformationContext(s,{campaignId:scope?.campaignId??branchId,timelineId:branchId,viewerId:actorId,stateVersion:scope?.stateVersion??a.revision,eventCursor:scope?.eventCursor??eventId},'npc-planner','',{projection,requiredSceneIds,callId:behaviorId('npc-context',branchId,actorId,eventId,s.clock,String(a.generation)),tokenBudget:s.settings.contextTokens,recentDialogue:dialogue.utterances.slice(-8).map(d=>({id:d.id,text:d.text,required:true})),profile:{maxRecords:80,memoryLimit:8}});
 // Only the broker's accepted sections cross the reasoning boundary. Its exclusion manifest stays private.
 const bundle={purpose:'NPC_PLANNER' as const,actorId,branchId,baseRevision:scope?.stateVersion??a.revision,profileVersion:p!.version,rulesVersion:behaviorRulesVersion,at:s.clock,sections:context.bundle.sections,traits:p!.traits,values:p!.values,goals:a.goals.filter(g=>g.status==='ACTIVE').map(g=>({id:g.id,priority:g.priority,deadline:g.deadline})),stress:a.stress,emotion:{...a.emotion},limits:{optionalCandidates:p!.policy.optionalCandidateCap,planDepth:3,recallItems:8,responseBytes:16384},hardConstraints:context.bundle.hardConstraints};
 return {bundle,manifest:context.manifest,contextHash:behaviorHash(bundle),projection};
}
function knownReferences(s:State,actorId:string,included?:Set<string>,view=observerView(s,actorId)){
 const ids=new Set(view.entities.map(e=>e.id)),c=data(getEntity(s,actorId,'character'),'character');ids.add(actorId);
 if(c.locationId){ids.add(c.locationId);const location=s.entities.find(e=>e.id===c.locationId);if(location?.kind==='location')for(const exit of data(location,'location').exits)ids.add(exit.to);}
 for(const entity of s.entities)if(!entity.archived&&(entity.kind==='job'&&entity.data.employeeId===actorId||entity.kind==='relationship'&&entity.data.fromId===actorId))ids.add(entity.id);
 for(const f of view.facts.filter(f=>!included||included.has(f.id))){ids.add(f.subjectId);if(f.objectId)ids.add(f.objectId);}return {ids,view,included};
}
function perceivedCondition(s:State,actorId:string,condition:Plan['conditions'][number],known:ReturnType<typeof knownReferences>){
 if(condition.kind==='world')return false;
 if(condition.kind==='knowledge'&&condition.subjectId!==actorId)return false;
 if(condition.subjectId&&!known.ids.has(condition.subjectId)||condition.targetId&&!known.ids.has(condition.targetId))return false;
 const scoped:State={...s,entities:known.view.entities as State['entities'],facts:known.view.facts.filter(f=>!known.included||known.included.has(f.id)),knowledge:s.knowledge.filter(k=>k.observerId===actorId),beliefs:s.beliefs.filter(b=>b.observerId===actorId&&(!known.included||known.included.has(b.id)))};
 // Self state is perceivable; directional relationship and role records are owner inputs.
 scoped.entities=[...scoped.entities.filter(e=>e.id!==actorId),getEntity(s,actorId,'character')];
 for(const e of s.entities)if((e.kind==='relationship'&&e.data.fromId===actorId||e.kind==='job'&&e.data.employeeId===actorId)&&!scoped.entities.some(x=>x.id===e.id))scoped.entities.push(e);
 if(condition.kind==='fact'){
  const claims=s.information?.entries.filter(e=>e.characterId===actorId&&e.status==='active'&&(!known.included||known.included.has(e.id)))??[];
  if(claims.length){const matched=claims.some(e=>{const f=s.information!.propositions.find(p=>p.id===e.propositionId);return f&&(!condition.subjectId||f.subjectId===condition.subjectId)&&(!condition.predicate||f.predicate===condition.predicate)&&(condition.value===null||canonical(f.value)===canonical(condition.value));});return condition.negate?!matched:matched;}
 }
 return matchesCondition(scoped,condition);
}
function candidateGate(s:State,p:NpcProfile,a:BehaviorActor,plan:Plan,known:ReturnType<typeof knownReferences>,start:string){
 const c=data(assertNpc(s,a.actorId),'character');
 if(c.condition!=='conscious')return 'LIFECYCLE_INCAPACITY';if(a.frozen)return 'DEVELOPER_FROZEN';
 if(plan.type==='crime'&&!plan.conditions.length)return 'PERCEIVED_CRIME_CAUSE_REQUIRED';
 if(!p.allowedActions.includes(plan.type as NpcProfile['allowedActions'][number]))return 'ACTION_NOT_REGISTERED';
 const rules=p.anchors.filter(r=>r.kind==='HARD'&&r.action===plan.type).sort((a,b)=>b.priority-a.priority);if(rules[0]&&!rules[0].allow)return 'HARD_ANCHOR';
 if(p.boundaryPolicies.some(b=>b.action===plan.type&&(!b.targetId||b.targetId===plan.targetId)&&b.permission==='refuse'&&(!b.expiresAt||Date.parse(b.expiresAt)>Date.parse(s.clock))))return 'BEHAVIORAL_BOUNDARY';
 if(!plan.enabled||c.preferences[plan.type]==='off')return 'DISABLED';
 if(plan.expiresAt&&Date.parse(plan.expiresAt)<=Date.parse(s.clock))return 'EXPIRED';
 if(plan.failedAttempts>=3)return 'UNCHANGED_FAILURE_LIMIT';
 if(plan.runsToday>=plan.maxRunsPerDay&&plan.runDate===localTime(s.clock,s.settings.timezone).date)return 'DAILY_LIMIT';
 const cooldown=a.cooldowns.find(cd=>cd.key===plan.type+':'+plan.targetId&&Date.parse(cd.expiresAt)>Date.parse(s.clock));if(cooldown&&!bypassBehaviorCooldown(s,p,a,plan.id,cooldown.startedAt))return 'COOLDOWN';
 if(!known.ids.has(plan.targetId)||plan.auxiliaryId&&!known.ids.has(plan.auxiliaryId))return 'REFERENCE_NOT_KNOWN';
 if(!plan.conditions.every(cond=>perceivedCondition(s,a.actorId,cond,known))||!plan.constraints.every(cond=>perceivedCondition(s,a.actorId,cond,known)))return 'PERCEIVED_CONDITION_UNMET';
 if(plan.speechFactIds.some(id=>p.disclosureLocks.includes(id)))return 'DISCLOSURE_LOCK';
 if(plan.type==='share'&&p.disclosureLocks.some(id=>s.facts.some(f=>f.id===id&&f.subjectId===plan.auxiliaryId)))return 'DISCLOSURE_LOCK';
 if(plan.speechFactIds.some(id=>!known.view.facts.some(f=>f.id===id)))return 'CLAIM_NOT_KNOWN';
 if(['speak','message','share'].includes(plan.type)&&p.disclosureLocks.length&&!plan.speechFactIds.length)return 'DISCLOSURE_SCOPE_REQUIRED';
 const speechAct=p.speechActs.find(a=>a.planId===plan.id);
 if(speechAct?.claimEntryIds.some(id=>{const entry=s.information?.entries.find(e=>e.id===id&&e.characterId===a.actorId&&e.status==='active');return !entry||p.disclosureLocks.includes(entry.propositionId);}))return 'DISCLOSURE_LOCK';
 const topicCooldown=speechAct&&a.cooldowns.find(c=>c.scope==='topic-interaction'&&c.key===behaviorHash([plan.targetId,speechAct.topic])&&Date.parse(c.expiresAt)>Date.parse(s.clock));if(topicCooldown&&!bypassBehaviorCooldown(s,p,a,plan.id,topicCooldown.startedAt))return 'TOPIC_REFUSED';
 const system={speak:'communications',message:'communications',call:'communications',share:'communications',travel:'travel',work:'economy',care:'health',offer:'relationships',breakup:'relationships',withdraw:'relationships',socialize:'relationships',domain:null,crime:'law',scene:'events'}[plan.type as NpcProfile['allowedActions'][number]];
 if(system&&!enabled(s,system))return 'OWNER_DISABLED';
 if(['message','call'].includes(plan.type)&&(!technology(s,'phone')||!technology(s,plan.type==='call'?'calls':'sms')))return 'TECHNOLOGY_UNAVAILABLE';
 if(plan.type==='travel'&&!technology(s,'walk'))return 'TECHNOLOGY_UNAVAILABLE';
 if(['speak','message'].includes(plan.type)&&/\b(?:TikTok|ChatGPT|AirPods|Apple Pay)\b/i.test(plan.text)&&s.clock<'2013-01-01')return 'PERIOD_EXPRESSION_UNAVAILABLE';
 if(plan.type==='speak'){
  const target=s.entities.find(e=>e.id===plan.targetId&&!e.archived),channel=plan.speechMethod==='say'?'spoken':plan.speechMethod==='sign'?'signed':'written';
  if(!target||target.kind!=='character'||!c.locationId||target.data.locationId!==c.locationId)return 'TARGET_NOT_PRESENT';
  if(plan.speechMethod==='say'&&c.communication?.canSpeak===false||(c.communication?.languages?.[plan.speechLanguage]?.[channel]??(plan.speechLanguage==='en'&&channel!=='signed'?100:0))<=0)return 'COMMUNICATION_UNAVAILABLE';
  const conversation=conversationState(s,a.actorId,plan.targetId);if(plan.text.endsWith('?')&&conversation.utterances.some(u=>u.speakerId===a.actorId&&u.text===plan.text&&conversation.previousAnswers.some(reply=>reply.replyToFactId===u.id)))return 'QUESTION_ALREADY_ANSWERED';
 }
 if(plan.type==='travel'&&c.restrainedBy)return 'RESTRAINED';
 if(plan.type==='work'&&!s.entities.some(e=>e.id===plan.targetId&&e.kind==='job'&&e.data.employeeId===a.actorId&&e.data.status==='active'))return 'ROLE_PERMISSION_MISSING';
 if(plan.type==='domain'){const gate=providerCandidateGate(s,p,plan.id,known.ids);if(gate!=='ELIGIBLE')return gate;}
 if(Date.parse(s.clock)-Date.parse(plan.lastRun??start)<plan.cooldownMinutes*60000)return 'NOT_DUE';
 return 'ELIGIBLE';
}
export function behaviorContinuationGate(s:State,actorId:string,planId:string,eventId:string){
 const p=behaviorProfile(s,actorId)!,a=behaviorActor(s,actorId),plan=data(assertNpc(s,actorId),'character').plans.find(p=>p.id===planId);if(!plan)return 'PLAN_UNAVAILABLE';const context=buildNpcBehaviorContext(s,actorId,eventId);if(!context.manifest.ready)return 'CONTEXT_UNAVAILABLE';return candidateGate(s,p,a,plan,knownReferences(s,actorId,new Set(context.bundle.sections.map(r=>r.id)),context.projection),s.clock);
}
export function decideNpcBehavior(s:State,actorId:string,eventId:string,start=s.clock):BehaviorDecision{
 let p=behaviorProfile(s,actorId);if(!p)throw new Error('npc_behavior_unavailable');const b=behaviorState(s),a=behaviorActor(s,actorId),id=behaviorId(b.branchId??'',actorId,eventId,s.clock,String(a.generation));
 const receipt=b.decisions.find(d=>d.id===id);if(receipt)return receipt;
 if(b.decisions.length>=10000)throw new Error('behavior_history_capacity_reached');
 recoverBehavior(a,p,s.clock);applyBehaviorDevelopments(s,actorId,eventId);p=behaviorProfile(s,actorId)!;prioritizeBehaviorGoals(a,s.clock);
 const context=buildNpcBehaviorContext(s,actorId,eventId),included=new Set(context.bundle.sections.map(r=>r.id));
 for(const o of s.information?.observations.filter(o=>o.observerId===actorId&&included.has(o.id))??[])applyBehaviorAppraisal(s,actorId,o.id);
 context.bundle.stress=a.stress;context.bundle.emotion={...a.emotion};context.contextHash=behaviorHash(context.bundle);
 const c=data(assertNpc(s,actorId),'character'),known=knownReferences(s,actorId,included,context.projection),candidates:BehaviorCandidate[]=[];
 for(const plan of [...c.plans].sort((a,b)=>order(a.id,b.id))){
  const preference=p.preferences.find(r=>r.planId===plan.id),goal=a.goals.find(g=>g.planId===plan.id&&g.status==='ACTIVE'),relationship=recognizedBehaviorTarget(s,actorId,plan.targetId)?relationshipBehaviorSignal(s,actorId,plan.targetId,plan.type):0,trait=resolveTraitEffects(s,actorId,'ai-priority',{planType:plan.type,context:plan.type}).applied.reduce((n,r)=>n+r.value,0);
  const f=preference?{...preference.features}:{G:clamp(500+plan.priority+trait),N:plan.type==='care'?clamp(Number(c.pain)*10):0,V:clamp(plan.type==='work'?(p.values.duty??500):p.values.autonomy??500),O:goal?.priority??0,S:clamp(500+relationship*5+(p.traits.sociability??500)-500),R:p.policy.unknownRisk,E:100,P:a.currentPlanId===plan.id?100:0};
  if(goal)f.G=clamp(f.G+goal.priority/2);if(preference?.value)f.V=p.values[preference.value]??f.V;
  for(const anchor of p.anchors.filter(r=>r.kind==='SOFT'&&r.action===plan.type))f.V=clamp(f.V+(anchor.allow?1:-1)*anchor.priority*5);
  for(const response of p.needResponses.filter(r=>r.planId===plan.id)){const pressure=response.need==='hygiene'?100-c.hygiene:c[response.need];f.N=clamp(f.N+pressure*response.sensitivity/100);}
  for(const loyalty of p.loyalties)if(loyalty.targetId===plan.targetId&&known.ids.has(plan.targetId)&&recognizedBehaviorTarget(s,actorId,plan.targetId)||goal&&loyalty.motiveRef===goal.motiveRef)f.O=clamp(f.O+loyalty.importance/2);
  for(const habit of p.habits.filter(h=>h.planId===plan.id))if(habit.cue==='routine'||context.bundle.sections.some(section=>section.text.startsWith(habit.cue.toUpperCase())))f.G=clamp(f.G+habit.fit/4);
  const perceived=known.view.entities.find(e=>e.id===plan.targetId);if(perceived&&recognizedBehaviorTarget(s,actorId,plan.targetId))for(const bias of p.biases.filter(b=>b.action===plan.type)){const parts=bias.attribute.split('.');let value:unknown=perceived.data;for(const part of parts)value=value&&typeof value==='object'?(value as Record<string,unknown>)[part]:undefined;if(Array.isArray(value)?value.includes(bias.equals):value===bias.equals)f[bias.feature]=clamp(f[bias.feature]+bias.delta);}
  f.R=clamp(f.R+(p.traits.caution??500)-500+a.stress/4);
  const completed=a.continuation?.planIds.slice(0,a.continuation.next).includes(plan.id);const gate=completed?'COMPLETED_CHECKPOINT':context.manifest.ready?candidateGate(s,p,a,plan,known,start):'CONTEXT_UNAVAILABLE';
  const act=p.speechActs.find(a=>a.planId===plan.id),claimsIncluded=!act||act.claimEntryIds.every(id=>included.has(id));
  const emergency=Object.values(a.conflicts).some(conflict=>conflict.stage==='THREATENED'),mandatory=!!preference?.mandatory&&emergency;
  candidates.push({id:plan.id,planId:plan.id,eligible:gate==='ELIGIBLE'&&claimsIncluded,reasonCode:claimsIncluded?gate:'CLAIM_EXCLUDED_BY_CONTEXT',mandatory,features:f,score:utilityScore(f,p.policy.weights),evidenceRefs:[...(preference?.sourceIds??[]),...(goal?[goal.id]:[]),...context.bundle.sections.filter(r=>['observation','relationship'].includes(r.category)).map(r=>r.id)].slice(0,100)});
 }
 const cap=a.stress>=700?Math.min(4,p.policy.optionalCandidateCap):p.policy.optionalCandidateCap;
 let optional=0;for(const candidate of [...candidates].sort((a,b)=>b.score-a.score||order(a.id,b.id)))if(candidate.eligible&&!candidate.mandatory&&++optional>cap){candidate.eligible=false;candidate.reasonCode='OPTIONAL_BUDGET';}
 // A bounded wait has its own feasibility gate and is never trimmed as an optional candidate.
 candidates.push({id:'wait',planId:null,eligible:c.condition==='conscious'&&context.manifest.ready&&!a.frozen,reasonCode:a.frozen?'DEVELOPER_FROZEN':context.manifest.ready?'VALID_WAIT':'CONTEXT_UNAVAILABLE',mandatory:false,features:neutral(),score:-1001,evidenceRefs:[]});
 let selected=selectBehavior(candidates,a.currentPlanId,p.policy.switchMargin),draw:BehaviorDecision['draw']=null;
 const planned=b.plannerInputs.find(input=>input.actorId===actorId&&input.status==='ACCEPTED'&&input.branchId===b.branchId&&input.generation===a.generation&&input.profileVersion===p.version&&input.baseRevision===(b.scope?.stateVersion??a.revision));
 if(planned){const choice=candidates.find(c=>c.planId===planned.planIds[0]&&c.eligible);if(choice&&!selected?.mandatory){selected=choice;a.continuation={profileVersion:p.version,planIds:planned.planIds,next:0,waitingForPlayer:false,eventId};planned.status='CONSUMED';}else if(!candidates.some(c=>c.planId===planned.planIds[0]&&c.reasonCode==='NOT_DUE'))planned.status='STALE';}
 if(a.continuation&&!a.continuation.waitingForPlayer){const next=candidates.find(c=>c.planId===a.continuation!.planIds[a.continuation!.next]&&c.eligible);if(next&&!selected?.mandatory)selected=next;}
 if(p.policy.variation.enabled&&selected&&!selected.mandatory&&!planned&&!a.continuation){const ties=candidates.filter(c=>c.eligible&&c.planId&&selected!.score-c.score<=p.policy.variation.band).sort((a,b)=>order(a.id,b.id)),value=parseInt(behaviorHash([id,'variation']).slice(0,8),16)%1001;if(ties.length){draw={lineage:behaviorHash([id,'variation']),value,candidateIds:ties.map(c=>c.id)};const weights=ties.map(c=>Math.max(1,p!.policy.variation.band+1-(selected!.score-c.score))),total=weights.reduce((n,w)=>n+w,0);let threshold=value*total/1001;for(let n=0;n<ties.length;n++){threshold-=weights[n]!;if(threshold<0){selected=ties[n]!;break;}}}}
 const result=!selected?'BLOCKED':selected.planId?'SELECTED':'WAIT',next=plus(s.clock,p.policy.waitSeconds);
 const decision:BehaviorDecision={id,actorId,branchId:context.bundle.branchId,baseRevision:context.bundle.baseRevision,at:s.clock,profileVersion:p.version,rulesVersion:behaviorRulesVersion,causeEventIds:[eventId],draw,contextHash:context.contextHash,contextManifest:JSON.parse(JSON.stringify(context.manifest)),dependencyVersions:{context:String(context.manifest.profileVersion),information:String(s.information?.version??1),characterSchema:String(data(assertNpc(s,actorId),'character').characterSchemaVersion),profile:p.version,rules:behaviorRulesVersion},contextSections:context.bundle.sections.map(({id,category,sourceIds})=>({id,category,sourceIds})),candidates,selectedPlanId:selected?.planId??null,result,reasonCode:selected?.reasonCode??'NO_VALID_FALLBACK',attemptId:null,committedEventIds:[],nextControl:'WORLD',nextEvaluationAt:next,source:planned?.status==='CONSUMED'?'RECORDED_AI':'DETERMINISTIC',acceptedProposal:planned?.status==='CONSUMED'?planned.proposal:null,providerReceipt:null,eventHash:null};
 if(selected?.planId){const attemptId=behaviorId(id,'attempt'),attempt:BehaviorAttempt={id:attemptId,actorId,planId:selected.planId,profileVersion:p.version,decisionId:id,status:'READY',startedAt:s.clock,updatedAt:s.clock,causeEventIds:[eventId],completedEventIds:[],remainingPlanHash:planHash(c.plans.find(plan=>plan.id===selected.planId)!),failures:0,reasonCode:'VALIDATED'};a.attempts.push(attempt);a.currentActionId=attemptId;decision.attemptId=attemptId;}
 a.lastEvaluatedAt=s.clock;a.nextEvaluationAt=next;a.revision++;a.blockedReason=result==='BLOCKED'?decision.reasonCode:'';a.wakes=a.wakes.filter(w=>Date.parse(w.dueAt)>Date.parse(s.clock));b.decisions.push(decision);return decision;
}
const terminal=(status:BehaviorAttempt['status'])=>['SUCCEEDED','FAILED','CANCELED','REJECTED','EXPIRED','STALE'].includes(status);
const transitions:Record<BehaviorAttempt['status'],BehaviorAttempt['status'][]>={PROPOSED:['VALIDATED','REJECTED'],VALIDATED:['RESERVED','READY','REJECTED'],RESERVED:['READY','CANCELED','EXPIRED'],READY:['EXECUTING','CANCELED','STALE'],EXECUTING:['SUCCEEDED','FAILED','INTERRUPTED'],INTERRUPTED:['READY','CANCELED','FAILED'],SUCCEEDED:[],FAILED:[],CANCELED:[],REJECTED:[],EXPIRED:[],STALE:[]};
export function transitionBehaviorAttempt(attempt:BehaviorAttempt,status:BehaviorAttempt['status'],at:string,reason:string){if(!transitions[attempt.status].includes(status))throw new Error('invalid_behavior_transition');attempt.status=status;attempt.updatedAt=at;attempt.reasonCode=reason;}
export function finishNpcBehavior(s:State,decision:BehaviorDecision,performed:boolean,effects:Effect[],eventId:string,playerId:string){
 const a=behaviorActor(s,decision.actorId),p=behaviorProfile(s,a.actorId)!,attempt=a.attempts.find(t=>t.id===decision.attemptId);if(!attempt||terminal(attempt.status))return;
 if(attempt.profileVersion!==p.version)throw new Error('stale_behavior_profile');transitionBehaviorAttempt(attempt,'EXECUTING',s.clock,'PROVIDER_ATTEMPT');
 const handoff=effects.some(e=>e.observers.includes(playerId)&&e.dialogue?.requiresResponse&&e.dialogue.targetId===playerId)||effects.some(e=>(e.type==='npc.call'||e.requiresPlayerResponse===true)&&e.observers.includes(playerId));
 const journey=data(assertNpc(s,a.actorId),'character').journey;
 transitionBehaviorAttempt(attempt,performed&&journey?'INTERRUPTED':performed?'SUCCEEDED':'FAILED',s.clock,performed&&journey?'JOURNEY_PENDING':performed?'PROVIDER_COMMITTED':'PROVIDER_BLOCKED');
 attempt.completedEventIds=effects.map(e=>e.id).slice(0,100);if(!performed){attempt.failures++;const entity=getEntity(s,a.actorId,'character'),character=data(entity,'character'),plan=character.plans.find(p=>p.id===decision.selectedPlanId);if(plan?.type==='domain'){plan.failedAttempts++;plan.lastRun=s.clock;plan.lastOutcome='blocked';entity.data=character;}}
 decision.committedEventIds=[eventId,...attempt.completedEventIds].slice(0,100);decision.nextControl=handoff?'PLAYER':'WORLD';decision.eventHash=behaviorHash(effects);
 releaseBehaviorLeases(s,attempt.id);a.currentPlanId=performed?decision.selectedPlanId:null;if(terminal(attempt.status))a.currentActionId=null;
 if(performed){const plan=data(getEntity(s,a.actorId,'character'),'character').plans.find(p=>p.id===decision.selectedPlanId)!;const key=plan.type+':'+plan.targetId;a.cooldowns=a.cooldowns.filter(c=>c.key!==key);a.cooldowns.push({key,scope:'actor-target-action',startedAt:s.clock,expiresAt:plus(s.clock,p.policy.socialCooldownSeconds),causeId:eventId,policyVersion:p.policy.version});
  const act=p.speechActs.find(a=>a.planId===plan.id);
  if(act?.intent==='refuse'){const topicKey=behaviorHash([plan.targetId,act.topic]);a.cooldowns=a.cooldowns.filter(c=>c.key!==topicKey);a.cooldowns.push({key:topicKey,scope:'topic-interaction',startedAt:s.clock,expiresAt:plus(s.clock,p.policy.refusalCooldownSeconds),causeId:eventId,policyVersion:p.policy.version});}
  if(act?.claimEntryIds.length){const heard=[...new Set(effects.filter(e=>e.dialogue?.comprehension==='full').flatMap(e=>e.observers))].filter(id=>id!==a.actorId),entries=act.claimEntryIds.map(id=>s.information!.entries.find(e=>e.id===id&&e.characterId===a.actorId)!);
   const transmission=transmitInformation(s,{id:behaviorId(decision.id,'claim'),senderId:a.actorId,intendedRecipientIds:heard,propositionIds:entries.map(e=>e.propositionId),text:plan.text,channel:'speech',at:s.clock,secrecy:entries.some(e=>e.secrecyAwareness==='secret'),parentId:null,originIds:[],mutation:'',artifactId:null,recipients:[]});
   for(const recipientId of heard)exposeTransmission(s,transmission.id,recipientId,{delivered:true,exposed:true,comprehension:1});
  }
  if(!journey)for(const goal of a.goals.filter(g=>g.status==='ACTIVE'&&g.planId===plan.id&&(g.predicate==='attempt-completed'||g.predicate==='arrived'&&plan.type==='travel'||g.predicate==='task-completed'&&plan.type==='work'||g.predicate==='delivered'&&plan.type==='speak'&&effects.some(e=>e.dialogue?.comprehension==='full'&&e.observers.includes(plan.targetId))))){goal.status='SATISFIED';goal.evidenceEventIds.push(eventId);}
  if(!a.continuation){const routine=p.routines.find(r=>r.planIds[0]===plan.id);if(routine)a.continuation={profileVersion:p.version,planIds:routine.planIds,next:0,waitingForPlayer:false,eventId};}if(a.continuation&&a.continuation.planIds[a.continuation.next]===plan.id&&!journey){a.continuation.next++;a.continuation.waitingForPlayer=handoff;if(a.continuation.next>=a.continuation.planIds.length)a.continuation=null;}
  if(!a.persistent)promoteBehavior(s,a.actorId,eventId,'consequential-action');
 }
}
export function resumeBehaviorAttempt(s:State,actorId:string,eventId:string){
 const a=behaviorActor(s,actorId),attempt=a.attempts.find(t=>t.id===a.currentActionId);if(!attempt||attempt.status!=='INTERRUPTED')throw new Error('behavior_continuation_unavailable');
 const p=behaviorProfile(s,actorId)!,c=data(assertNpc(s,actorId),'character'),plan=c.plans.find(p=>p.id===attempt.planId);
 if(!plan||!plan.enabled||attempt.profileVersion!==p.version||attempt.remainingPlanHash!==planHash(plan)||c.condition!=='conscious'||c.restrainedBy){transitionBehaviorAttempt(attempt,'CANCELED',s.clock,'RESUME_INVALIDATED');a.currentActionId=null;return attempt;}
 if(c.journey)return attempt;
 transitionBehaviorAttempt(attempt,'READY',s.clock,'REVALIDATED');transitionBehaviorAttempt(attempt,'EXECUTING',s.clock,'PROVIDER_RECONCILED');transitionBehaviorAttempt(attempt,c.locationId===plan.targetId?'SUCCEEDED':'FAILED',s.clock,'JOURNEY_RECONCILED');a.currentActionId=null;
 if(c.locationId===plan.targetId&&a.continuation?.planIds[a.continuation.next]===plan.id){a.continuation.next++;if(a.continuation.next>=a.continuation.planIds.length)a.continuation=null;}
 if(c.locationId===plan.targetId)for(const goal of a.goals.filter(g=>g.status==='ACTIVE'&&g.planId===plan.id&&['arrived','attempt-completed'].includes(g.predicate))){goal.status='SATISFIED';goal.evidenceEventIds.push(eventId);}return attempt;
}
export function promoteBehavior(s:State,actorId:string,eventId:string,reason:string){const a=behaviorActor(s,actorId);if(a.persistent)return a;a.persistent=true;a.promotions.push({eventId,at:s.clock,reason});return a;}
export function setBehaviorTier(s:State,actorId:string,tier:BehaviorActor['tier'],pendingReaction=false){const a=behaviorActor(s,actorId);if((tier==='BACKGROUND'||tier==='DORMANT')&&(pendingReaction||a.currentActionId))throw new Error('behavior_tier_continuation_required');a.tier=tier;return a;}
export function adaptBehavior(s:State,actorId:string,trait:keyof BehaviorActor['baseline'],delta:number,sourceIds:string[],eventId:string){
 const a=behaviorActor(s,actorId),p=behaviorProfile(s,actorId)!;if(a.adaptations.some(r=>r.eventId===eventId))return p;
 if(!p.adaptation.unlocked.includes(trait))throw new Error('behavior_trait_locked');if(!Number.isInteger(delta)||Math.abs(delta)>1000)throw new Error('invalid_behavior_adaptation');
 const sources=[...new Set(sourceIds)];if(sources.length<p.adaptation.minimumEvidence||sources.some(id=>!s.information?.observations.some(o=>o.observerId===actorId&&o.id===id)||a.adaptations.some(r=>r.trait===trait&&r.sourceIds.includes(id))))throw new Error('behavior_adaptation_evidence_required');
 const day=s.clock.slice(0,10),used=a.adaptations.filter(r=>r.trait===trait&&r.day===day).reduce((n,r)=>n+Math.abs(r.to-r.from),0),from=p.traits[trait]??500,baseline=a.baseline[trait]??500;
 const change=Math.sign(delta)*Math.min(Math.abs(delta),Math.max(0,p.adaptation.dailyCap-used)),to=clamp(Math.max(baseline-p.adaptation.baselineCap,Math.min(baseline+p.adaptation.baselineCap,from+change)));
 if(to===from)return p;const version='adapt-'+behaviorHash([p.version,eventId]).slice(0,20),next=publishBehaviorProfile(s,{...p,version,traits:{...p.traits,[trait]:to}},eventId,'Causal trait development');
 a.adaptations.push({eventId,trait,day,from,to,profileVersion:version,sourceIds:sources});return next;
}
export function validateBehaviorProposal(raw:unknown,decision:BehaviorDecision,a:BehaviorActor,offeredTokens:ReadonlySet<string>){
 const encoded=typeof raw==='string'?raw:JSON.stringify(raw);if(Buffer.byteLength(encoded)>16384)throw new Error('behavior_proposal_too_large');
 const p=behaviorProposalSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);
 if(p.decisionId!==decision.id||p.actorId!==decision.actorId||p.branchId!==decision.branchId||p.baseRevision!==decision.baseRevision||p.profileVersion!==decision.profileVersion||p.contextHash!==decision.contextHash||p.requestGeneration!==a.generation||p.profileVersion!==a.profileVersion||a.currentActionId!==decision.attemptId)throw new Error('stale_behavior_proposal');
 const seen=new Set<string>();for(const step of p.steps){if(seen.has(step.stepId)||step.afterStepIds.some(id=>!seen.has(id))||!decision.candidates.some(c=>c.id===step.templateId&&c.eligible)||Object.values(step.parameterTokens).some(t=>!offeredTokens.has(t))||step.goalRefs.some(id=>!a.goals.some(g=>g.id===id&&g.status==='ACTIVE'))||step.abortPredicateRefs.some(ref=>!['actor-incapacitated','target-unavailable','player-handoff'].includes(ref)))throw new Error('invalid_behavior_plan');seen.add(step.stepId);}return p;
}
