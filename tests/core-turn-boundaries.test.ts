import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {TurnKernel} from '../src/game/turn-kernel.ts';
import {TurnRuleRegistry} from '../src/game/turn-rules.ts';
import {resolveTurnPlan} from '../src/game/turn-resolution.ts';
import {buildDeltas,validateDeltas,authorizeDeltas,type WriteGrant} from '../src/game/turn-audit.ts';
import {CreativeTurnPlanner,validateCreativeProposal,validatePlanReferences} from '../src/game/turn-planner.ts';
import {responseLatencyClass,holdResponse} from '../src/game/response-timing.ts';
import {validateEntity,type State} from '../src/game/model.ts';
import type {TurnCommand} from '../src/game/turn-contracts.ts';
async function setup(){
 const f=await fixture(),game=new Game(f.store),t=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:key(),kind:'location',name:'Workshop',visibility:'campaign',data:{}}),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:room.id,cash:1000}}),box=validateEntity({id:key(),kind:'item',name:'Box',visibility:'campaign',data:{locationId:room.id,mechanism:{kind:'container',open:false}}});
 await game.bulkEdit(f.creator,t.id,{revision:1,entities:[room,pc,box]},key());
 const command=async(input:TurnCommand['input']):Promise<TurnCommand>=>({commandId:key(),sessionId:t.id,actorId:pc.id,expectedRevision:(await game.access(f.player,t.id)).t.revision,mode:'STORY',input});
 return {...f,game,t,room,pc,box,command};
}
const result=()=>({status:'SUCCEEDED' as const,effects:[],checks:[],draws:0,time:{minutes:0,scale:'negligible' as const}});
test('providers require explicit write grants; owner-name spoofing and unrelated field writes roll back',async()=>{
 const f=await setup();try{const state=await f.game.load(f.t.id),before=structuredClone(state),plan=[{clauseId:'1',dependency:'NONE' as const,action:{type:'look' as const}}];
  const malicious={id:'characters',resolve(s:State){s.entities.find(e=>e.id===f.pc.id)!.data.cash=999999;return result();}};
  assert.throws(()=>resolveTurnPlan(state,f.pc.id,plan,key(),'aa',new TurnRuleRegistry().register('look',malicious)),/unauthorized_state_delta/);assert.deepEqual(state,before);
  const grants:WriteGrant[]=[{ownerSystem:'characters',kind:'character',fields:['data.fatigue']}],registry=new TurnRuleRegistry().register('look',malicious,grants);grants[0]!.fields=['data.cash'];
  assert.throws(()=>resolveTurnPlan(state,f.pc.id,plan,key(),'aa',registry),/unauthorized_state_delta/);assert.deepEqual(state,before);
  const configured=new TurnRuleRegistry().register('look',{id:'spacetime',resolve(s){s.settings.tokenBudget=999999;return result();}},[{ownerSystem:'spacetime',root:'settings',fields:['weather']}]);
  assert.throws(()=>resolveTurnPlan(state,f.pc.id,plan,key(),'aa',configured),/unauthorized_state_delta/);assert.deepEqual(state,before);
 }finally{await f.close();}
});
test('audit covers clock and knowledge roots, detects omitted, duplicated and forged deltas',async()=>{
 const f=await setup();try{const before=await f.game.load(f.t.id),after=structuredClone(before);after.clock=new Date(Date.parse(after.clock)+60000).toISOString();after.entities.find(e=>e.id===f.pc.id)!.data.cash=900;
  const sequence=resolveTurnPlan(structuredClone(before),f.pc.id,[{clauseId:'1',dependency:'NONE',action:{type:'look'}},{clauseId:'2',dependency:'PREVIOUS_SUCCESS',action:{type:'wait',minutes:1}}],key(),'ca'.repeat(32));
  const second=sequence.steps[1]!.stateDeltas as Array<{causeEventIndex:number}>;assert.ok(second.length);for(const delta of second){assert.ok(delta.causeEventIndex>0);assert.ok(sequence.effects[delta.causeEventIndex]);}
  const deltas=buildDeltas(before,after,0),events=[{id:key(),text:'Resolved',observers:[],type:'resolution.applied',subjectId:f.pc.id}];assert.ok(deltas.some(d=>d.entityId==='$clock'));
  validateDeltas(before,after,deltas,events);
  for(const changed of [deltas.slice(1),[deltas[0]!,deltas[0]!],deltas.map(d=>({...d,value:{forged:true}}))])assert.throws(()=>validateDeltas(before,after,changed,events),/invalid_owned_delta/);
  assert.throws(()=>authorizeDeltas(before,after,deltas,[{ownerSystem:'characters',kind:'character',fields:['data.cash']}]),/unauthorized_state_delta/);
  after.canon={revisionId:key()} as any;assert.throws(()=>buildDeltas(before,after,0),/immutable_state_metadata/);
 }finally{await f.close();}
});
test('creative proposal is grounded, remains pending, commits only on confirmation and replays without another provider call',async()=>{
 const f=await setup();try{
  const settings=(await f.game.load(f.t.id)).settings;settings.contextTokens=16000;settings.tokenBudget=500000;settings.userTokenBudget=500000;await f.game.configure(f.creator,f.t.id,2,settings,key());
  const text='Lift the lid of Box, then pick up Box',clauses=[{clauseId:'1',dependency:'NONE' as const,action:{type:'physical' as const,operation:'open' as const,targetId:f.box.id,instrumentId:null,destinationId:null,quiet:false,goal:'open the box',approach:'lift the lid'}},{clauseId:'2',dependency:'PREVIOUS_SUCCESS' as const,action:{type:'take' as const,itemId:f.box.id}}];
  let calls=0;const planner=new CreativeTurnPlanner(f.game,{id:'mock-planner',estimateIntentTokens:()=>1,complete:async request=>{calls++;return {traceId:request.traceId,output:{clauses,evidence:clauses.map(c=>({clauseId:c.clauseId,start:0,end:text.length,text})),clarification:null},usage:{inputTokens:1,outputTokens:1},toolCalls:[]};}});
  const kernel=new TurnKernel(f.game,planner),cmd=await f.command({kind:'freeform',text}),before=await f.game.load(f.t.id),proposal=await kernel.execute(f.player,cmd);
  assert.equal(calls,1);assert.equal(proposal.status,'NEEDS_CLARIFICATION');assert.equal(proposal.pendingDecision.proposedClauses.length,2);assert.match(proposal.pendingDecision.prompt,/If step 1 succeeds/);assert.match(proposal.pendingDecision.prompt,/Box/);assert.deepEqual(await f.game.load(f.t.id),before);
  assert.deepEqual(await kernel.execute(f.player,cmd),proposal);assert.equal(calls,1);
  const accepted=await kernel.execute(f.player,await f.command({kind:'clarification_answer',pendingDecisionId:proposal.pendingDecision.pendingDecisionId,answer:'confirm_plan'}));assert.equal(accepted.status,'COMMITTED');assert.equal(accepted.completedClauses,2);const batch=await f.store.get<{batch_json:string}>('SELECT batch_json FROM turn_resolution_batches WHERE event_id=?',accepted.eventId);assert.equal(JSON.parse(batch!.batch_json).rulesetVersion,'core-turn-v3');const attempt=await f.store.get<{record_json:string}>('SELECT record_json FROM turn_attempt_records WHERE command_id=?',accepted.commandId);assert.equal(JSON.parse(attempt!.record_json).rulesetVersion,'core-turn-v3');assert.equal((await f.game.load(f.t.id)).entities.find(e=>e.id===f.box.id)!.data.ownerId,f.pc.id);
 }finally{await f.close();}
});
test('creative proposals reject fabricated IDs, hidden array references, invented evidence and unsupported no-op outcomes',async()=>{
 const f=await setup();try{const state=await f.game.load(f.t.id),text='Open Box',base={clauses:[{clauseId:'1',dependency:'NONE',action:{type:'physical',operation:'open',targetId:f.box.id}}],evidence:[{clauseId:'1',start:0,end:text.length,text}],clarification:null};
  assert.equal(validateCreativeProposal(base,state,f.pc.id,text).clauses.length,1);
  assert.throws(()=>validateCreativeProposal({...base,evidence:[{...base.evidence[0],text:'Invented'}]},state,f.pc.id,text),/ungrounded_proposal/);
  assert.throws(()=>validateCreativeProposal({...base,clauses:[{...base.clauses[0],action:{type:'take',itemId:key()}}]},state,f.pc.id,text),/target_unavailable/);
  assert.throws(()=>validatePlanReferences([{clauseId:'1',dependency:'NONE',action:{type:'combat',targetId:f.pc.id,opponentIds:[key()]}} as any],new Set([f.pc.id])),/target_unavailable/);
  const kernel=new TurnKernel(f.game),before=structuredClone(state),pending=await kernel.execute(f.player,await f.command({kind:'freeform',text:'Telekinetically levitate Box'}));assert.equal(pending.status,'NEEDS_CLARIFICATION');assert.deepEqual(await f.game.load(f.t.id),before);
 }finally{await f.close();}
});
test('response release class is independent of hidden work duration and detects budget overruns',async()=>{
 for(const elapsed of [1,80,230]){let clock=elapsed;const waits:number[]=[];const result=await holdResponse(0,250,()=>clock,async ms=>{waits.push(ms);clock+=ms;});assert.equal(clock,250);assert.equal(result.overrun,false);assert.equal(waits.length,1);}
 let clock=600;assert.equal((await holdResponse(0,500,()=>clock,async ms=>{clock+=ms;})).overrun,true);
 assert.deepEqual(responseLatencyClass('HEAD','/game/timelines/abc/view'),responseLatencyClass('GET','/game/timelines/abc/view'));
 assert.deepEqual(responseLatencyClass('GET','/game/timelines/abc/view?characterId=hidden'),responseLatencyClass('GET','/game/timelines/abc/view?characterId=missing'));
});
test('HTTP inspection of hidden and nonexistent targets returns the same status, error and release class',async()=>{
 const f=await setup();try{const hidden=validateEntity({id:key(),kind:'item',name:'Secret item',visibility:'creator',data:{locationId:f.room.id}});await f.game.edit(f.creator,f.t.id,{revision:2,entity:hidden},key());const auth=await login(f,'player@example.test');const outputs=[];
  for(const targetId of [hidden.id,key()]){const start=performance.now(),response=await f.app.inject({method:'POST',url:'/game/timelines/'+f.t.id+'/commands',headers:{cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf},payload:await f.command({kind:'inspection',panel:'scene',targetId})});assert.ok(performance.now()-start>=490);outputs.push({status:response.statusCode,error:response.json().error});}
  assert.deepEqual(outputs[0],outputs[1]);assert.equal(outputs[0]!.error,'target_unavailable');
 }finally{await f.close();}
});

test('all 32 canonical interfaces and every action/entity authority key have a reconciled source',async()=>{
 const {systemInterfaces,systemForOwner}=await import('../src/game/system-interfaces.ts'),{kinds,actionSchema}=await import('../src/game/model.ts'),{authorityFor}=await import('../src/game/turn-audit.ts'),{existingTurnRules}=await import('../src/game/turn-rules.ts'),{existsSync}=await import('node:fs');
 assert.deepEqual(systemInterfaces.map(s=>s.id),Array.from({length:32},(_,i)=>i+1));
 for(const system of systemInterfaces)assert.ok(existsSync(system.source),system.source);
 for(const kind of kinds)assert.ok(systemForOwner(authorityFor(kind)),kind);
 const registry=existingTurnRules();for(const schema of actionSchema.options){const type=schema.shape.type.value;assert.ok(systemForOwner(registry.owner(type).id),type);for(const grant of registry.permissions(type))assert.ok(systemForOwner(grant.ownerSystem));}
});


test('canonical action precedence names the specialist owner and rejects unknown actions',async()=>{
 const {ruleOwner}=await import('../src/game/turn-rules.ts'),{systemForOwner}=await import('../src/game/system-interfaces.ts');
 const cases={'reload':21,'clear-malfunction':21,'check':8,'train':8,'safety-exit':18,'pay-bail':27,'forensic-test':28,'custody':28,'cover':24,'flee':24,'event-action':30,'spread-rumor':29};
 for(const [action,systemId] of Object.entries(cases))assert.equal(systemForOwner(ruleOwner(action as any))?.id,systemId,action);
 assert.throws(()=>ruleOwner('unregistered-future-action' as any),/rule_provider_unavailable/);
 assert.throws(()=>ruleOwner('toString' as any),/rule_provider_unavailable/);
});

test('dispatch request and acceptance replay identical beliefs, effects and audit deltas',async()=>{
 const f=await setup();try{
  const initial=await f.game.load(f.t.id),responder=validateEntity({id:key(),kind:'character',name:'Medic',visibility:'campaign',data:{locationId:f.room.id}}),agency=validateEntity({id:key(),kind:'faction',name:'EMS',visibility:'campaign',data:{memberIds:[responder.id],jurisdictionIds:[f.room.id],dispatchPolicy:{kind:'ems',responseMinutes:3,hospitalId:f.room.id}}}),phone=validateEntity({id:key(),kind:'item',name:'Phone',visibility:'owner',data:{ownerId:f.pc.id,category:'phone'}});
  initial.entities.push(responder,agency,phone);const eventId=key();
  const run=(state:State,actorId:string,action:any)=>resolveTurnPlan(state,actorId,[{clauseId:'1',dependency:'NONE',action}],eventId,'a1'.repeat(32));
  const a=structuredClone(initial),b=structuredClone(initial),request={type:'request-assistance',agencyId:agency.id,phoneId:phone.id,report:'Caller report',patientId:f.pc.id,transportConsent:false};
  assert.deepEqual(run(a,f.pc.id,request),run(b,f.pc.id,request));assert.deepEqual(a,b);assert.ok(a.beliefs.some(b=>b.observerId===responder.id&&b.proposition==='Caller report'));
  const queued=structuredClone(initial),call=validateEntity({id:key(),kind:'dispatch',name:'Queued call',visibility:'campaign',data:{agencyId:agency.id,requesterId:f.pc.id,locationId:f.room.id,patientId:f.pc.id,destinationId:f.room.id,report:'Queued report',kind:'ems',status:'queued',createdAt:initial.clock}});queued.entities.push(call);
  const c=structuredClone(queued),d=structuredClone(queued),accept={type:'dispatch-response',dispatchId:call.id,operation:'accept'};
  assert.deepEqual(run(c,responder.id,accept),run(d,responder.id,accept));assert.deepEqual(c,d);assert.ok(c.beliefs.some(b=>b.observerId===responder.id&&b.proposition==='Queued report'));
 }finally{await f.close();}
});

test('clinical care replay preserves treatment and assessment IDs with conserved supplies and payment',async()=>{
 const f=await setup();try{
  const initial=await f.game.load(f.t.id),business=validateEntity({id:key(),kind:'business',name:'Clinic',visibility:'campaign',data:{locationId:f.room.id}}),medicine=validateEntity({id:key(),kind:'item',name:'Clinic supply',visibility:'campaign',data:{ownerId:business.id,category:'medicine',quantity:5}}),service=validateEntity({id:key(),kind:'service',name:'Treatment',visibility:'campaign',data:{businessId:business.id,category:'clinical',medicineId:medicine.id,costCents:100,minutes:5,treatmentQuality:90,severityReduction:5}}),injury=validateEntity({id:key(),kind:'injury',name:'Wound',visibility:'owner',data:{characterId:f.pc.id,severity:30,bodyPart:'arm',category:'cut',startedAt:initial.clock}});
  initial.entities.push(business,medicine,service,injury);const eventId=key(),plan=[{clauseId:'1',dependency:'NONE' as const,action:{type:'clinical-care' as const,serviceId:service.id,injuryId:injury.id}}],a=structuredClone(initial),b=structuredClone(initial);
  assert.deepEqual(resolveTurnPlan(a,f.pc.id,plan,eventId,'b2'.repeat(32)),resolveTurnPlan(b,f.pc.id,plan,eventId,'b2'.repeat(32)));assert.deepEqual(a,b);
  const wound=a.entities.find(e=>e.id===injury.id)!;assert.equal((wound.data.treatments as any[]).length,1);assert.equal((wound.data.assessments as any[]).length,1);
  assert.equal(a.entities.find(e=>e.id===medicine.id)!.data.quantity,4);assert.equal(a.entities.find(e=>e.id===f.pc.id)!.data.cash,900);assert.equal(a.entities.find(e=>e.id===business.id)!.data.cash,100);
 }finally{await f.close();}
});
