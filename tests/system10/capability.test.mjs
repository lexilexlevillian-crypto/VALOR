import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {System10,CapabilityState,evaluateDice,digest,OWNERS} from '../../src/system10/index.mjs';
import {SKILLS,ATTRIBUTES,FIELDS} from '../../src/system10/schema.mjs';

const time='2012-10-08T12:00:00Z', principal='developer', branch='branch-001';
const response=(owner,payload,receipt='fixture-receipt')=>({owner,revision:1,available:true,receipt,payload});
const request=(suffix='',actor='actor-001')=>({request_id:'request'+suffix,branch_id:branch,action_id:'action'+suffix,actor_id:actor,task_profile:'repair@v1',target_refs:['object-001'],method_id:'repair',intent_ref:'intent'+suffix,opportunity_id:'opportunity'+suffix,expected_revisions:{actor:0,inventory:1},requested_at:time,audience_context:'pc'});
const definition=skill_id=>({skill_id,version:'v1',display_label:skill_id,task_tags:[],attribute_pairing_defaults:{},untrained_eligibility:'allowed',allowed_specialization_families:['fixture'],practice_categories:['solo','supervised','work','brief_incident'],training_milestones:Array.from({length:10},(_,r)=>({criteria:r===3?['independent_work']:r===4?['varied_technique']:r===5?['advanced_assessment']:r===6?['advanced_assessment','varied_evidence']:r===7?['expert_assessment']:r===8?['exceptional_specialty']:r===9?['exceptional_assessment']:[]})),migration_aliases:[],related_skill_task_mappings:[],overlap_declarations:[],eligible_task_examples:[],ineligible_task_examples:[]});
const profile=()=>({task_profile_id:'repair',profile_version:'v1',owner:'inventory',method_id:'repair',method_family:'repair',task_tags:['repair'],primary_skill_id:'HouseholdRepair',primary_attribute_id:'Coordination',resolution_kind:'active_fixed',prerequisites:[],untrained_policy:{mode:'allowed'},reference_conditions:{tools:['tool'],time_budget:1800,physical_access:true,environment:{},sensory_channels:['vision']},difficulty:16,difficulty_reason:{category:'complexity',sources:[]},content_revision:'v1',partial_policy:{options:[]},critical_policy:false,quality_bands:{full:{quality:'complete'},partial:{quality:'temporary'},failure:{quality:'inconclusive'},initiator_win:{quality:'initiator'},responder_win:{quality:'responder'},tie:{quality:'unchanged'},exceptional:{quality:'exceptional'},complication:{quality:'complication'}},information_caps:{max_observations:0},effect_contracts:[],retry_policy:'changed_conditions',retry_horizon_and_coverage:{},opposed_tie_policy:'preserve_existing_state',opposed_narrow_win_policy:false,group_policy:'lead',helper_capacity:2,duration:1800,milestones:[],invalidation_policy:'abort',choice_expiry_policy:'resume_only'});
const effect=(binding_id,value,group='fixture')=>({binding_id,effect_id:binding_id,character_id:'actor-001',definition_ref:'fixture@v1',source_id:binding_id,source_owner:'inventory',source_revision:1,source_event_id:'effect-source-'+binding_id,task_predicate:{op:'tag',value:'repair'},effect_kind:'numeric',value,stacking_group:group,visibility:'private',starts_at:'2012-01-01T00:00:00Z',ends_at:null,counterfactual_explanation:{reason:'fixture'}});
function fixtures(requests,options={}) {
  const f={};
  const put=(owner,operation,payload,key='default')=>{ f[owner]??={}; f[owner][operation]??={}; f[owner][operation][key]=response(owner,payload); };
  for(const owner of OWNERS) put(owner,'deliver',{accepted:true});
  const auth={authorized:true,principal_id:principal,branch_id:branch,actor_ids:['actor-001','actor-002'],operations:['register','initialize','resolve','view','resume','practice','advance','attribute_program','correct','aggregate','flush','export','fork','diagnostics'],developer:true};
  put('creator','authorize',auth); put('core_turn','authorize',auth);
  put('core_turn','reserve',{accepted:true}); put('core_turn','complete',{accepted:true}); put('core_turn','release',{accepted:true});
  put('inventory','validate_commit',{accepted:true,revisions_changed:false});
  put('inventory','lookup_receipt',{found:false}); put('inventory','command',{accepted:true});
  put('randomness','sample',{algorithm_version:'fixed-test-fixture/v1',nonce:'fixture-only',dice:options.dice??[5,7]});
  put('knowledge','project',{public_projection:{}}); put('knowledge','project_event',{public_projection:{observations:[]}});
  for(const actor of ['actor-001','actor-002']) {
    const command={operation:'initialize',character_id:actor,simulation_time:time};
    const skills=Object.fromEntries(SKILLS.map(k=>[k,['HouseholdRepair','Cooking','Athletics','Mechanics','Conversation','Observation'].includes(k)?4:0]));
    put('identity_creation','initial_profile',{authorized:true,character_id:actor,branch_id:branch,history_ref:'history-'+actor,authority:'fixture-creator',profile_version:'v1',source_event_id:'initial-'+actor,attributes:Object.fromEntries(ATTRIBUTES.map(k=>[k,4])),skills,evidence:Object.fromEntries(Object.keys(skills).map(k=>[k,['experience-'+k]]))},digest(command));
  }
  for(const r of requests) {
    put('core_turn','projection',{authorized:true,actor_id:r.actor_id,action_id:r.action_id,intent_ref:r.intent_ref,opportunity_id:r.opportunity_id,simulation_time:r.requested_at,method_id:r.method_id,choice_required:false},digest(r));
    put('inventory','projection',{objective:'repair-object',target_refs:r.target_refs,setting_available:true,feasible:true,access:true,prerequisites_met:true,meaningful_uncertainty:true,meaningful_stakes:true,helpers:[],facts:{},...options.domain},digest(r));
    put('knowledge','projection',{opportunity_id:r.opportunity_id,registered:true,actor_id:r.actor_id,...options.knowledge},digest(r));
  }
  return {f,put};
}
function setup(requests=[request()],options={}) {
  const fixture=fixtures(requests,options); options.configure?.(fixture);
  const engine=new System10({database:options.database??':memory:',fixtures:fixture.f});
  for(const skill of SKILLS) engine.register({operation:'register',kind:'skill_definition',record:definition(skill)},principal);
  const p={...profile(),...options.profile}; engine.register({operation:'register',kind:'task_profile',record:p},principal);
  for(const actor of ['actor-001','actor-002']) engine.initialize({operation:'initialize',character_id:actor,simulation_time:time},principal);
  for(const e of options.effects??[]) engine.register({operation:'register',kind:'mechanical_effect_binding',record:e},principal);
  return {engine,...fixture};
}
const state=engine=>engine.dispatch({operation:'export'},principal);

test('state contains only declared architecture variables',()=> {
  assert.deepEqual(Object.keys(new CapabilityState()).sort(),[...Object.keys(FIELDS),'attribute_registry','mandatory_skill_registry'].sort());
});
test('enumerates every normal/advantage/disadvantage outcome',()=> {
  for(const [mode,expected] of [['normal',[45,27,28]],['advantage',[710,184,106]],['disadvantage',[215,259,526]]]) {
    const counts={full:0,partial:0,failure:0};
    for(let a=1;a<=10;a++) for(let b=1;b<=10;b++) for(let c=1;c<=(mode==='normal'?1:10);c++) {
      const dice=mode==='normal'?[a,b]:[a,b,c]; const result=evaluateDice(dice,mode,4,16,true);
      counts[result.outcome_band]++;
      assert.ok(evaluateDice(dice,mode,5,16,true).total>=result.total);
    }
    assert.deepEqual(Object.values(counts),expected);
  }
});
test('kept dice alone determine criticals and partial policy',()=> {
  assert.equal(evaluateDice([1,10,10],'advantage',4,16,true,true).critical_label,'exceptional');
  assert.equal(evaluateDice([1,1,10],'disadvantage',4,16,true,true).critical_label,'complication');
  assert.equal(evaluateDice([4,5],'normal',4,16,false).outcome_band,'failure');
});
test('active result, replay, payload conflict and durable reload',()=> {
  const r=request(),database=join(mkdtempSync(join(tmpdir(),'valor-system10-')),'state.sqlite');
  const {engine,f}=setup([r],{database});
  const first=engine.resolve(r,principal); assert.equal(first.total,16); assert.equal(first.margin,0); assert.equal(first.status,'COMMITTED');
  assert.deepEqual(engine.resolve(r,principal),first); assert.equal(state(engine).random_sample.length,1);
  assert.throws(()=>engine.resolve({...r,method_id:'different'},principal),/Conflicting request/);
  engine.close(); const resumed=new System10({database,fixtures:f}); assert.deepEqual(resumed.resolve(r,principal),first); resumed.close();
});
test('equivalent opportunity cannot be rerolled under a fresh request identity',()=> {
  const a=request(), b={...request('-alias'),opportunity_id:a.opportunity_id}; const {engine}=setup([a,b]);
  assert.deepEqual(engine.resolve(b,principal),engine.resolve(a,principal)); assert.equal(state(engine).random_sample.length,1); engine.close();
});
test('impossible and routine tasks suppress samples',()=> {
  for(const [domain,band] of [[{feasible:false},'failure'],[{routine:true},'full']]) {
    const {engine}=setup([request()],{domain}); const result=engine.resolve(request(),principal);
    assert.equal(result.outcome_band,band); assert.equal(state(engine).random_sample.length,0); engine.close();
  }
});
test('passive uses 11+B and never samples',()=> {
  const {engine}=setup([request()],{profile:{resolution_kind:'passive'}}); const result=engine.resolve(request(),principal);
  assert.equal(result.total,15); assert.equal(result.outcome_band,'partial'); assert.equal(state(engine).random_sample.length,0); engine.close();
});
test('strongest effect of each sign, final clamp, duplicate effect pair',()=> {
  const bindings=[effect('a',1),effect('b',3),effect('c',-2),effect('d',-1)];
  const duplicate={...bindings[1],binding_id:'duplicate'};
  const {engine}=setup([request()],{effects:[...bindings,duplicate]}); engine.resolve(request(),principal);
  const projection=state(engine).resolution_snapshot[0].participant_projections[0];
  assert.equal(projection.circumstance_raw,1); assert.ok(projection.excluded_effects.some(x=>x.reason==='duplicate_source_effect')); engine.close();
  const other=setup([request()],{effects:[effect('a',3,'a'),effect('b',3,'b'),effect('c',3,'c')]}); other.engine.resolve(request(),principal);
  const projected=state(other.engine).resolution_snapshot[0].participant_projections[0]; assert.equal(projected.circumstance_raw,9); assert.equal(projected.circumstance,5); other.engine.close();
});
test('partial choice survives reload and does not resample',()=> {
  const r=request(),database=join(mkdtempSync(join(tmpdir(),'valor-system10-choice-')),'state.sqlite');
  const {engine,f}=setup([r],{database,dice:[4,5],profile:{partial_policy:{options:[{id:'accept-cost'}]}},configure:({put})=>put('core_turn','choice',{authorized:true,actor_id:r.actor_id,resolution_id:digest([branch,r.action_id,r.opportunity_id]),option_id:'accept-cost'})});
  assert.equal(engine.resolve(r,principal).status,'AWAITING_CHOICE'); engine.close();
  const resumed=new System10({database,fixtures:f}); assert.equal(resumed.resume(r,principal).status,'COMMITTED'); assert.equal(state(resumed).random_sample.length,1); resumed.close();
});
test('lost downstream availability retains durable sample',()=> {
  const r=request(),database=join(mkdtempSync(join(tmpdir(),'valor-system10-outage-')),'state.sqlite');
  const {engine,f}=setup([r],{database,configure:({f})=>{f.inventory.validate_commit.default.available=false;}});
  assert.throws(()=>engine.resolve(r,principal),/inventory:validate_commit/); assert.equal(state(engine).random_sample.length,1); engine.close();
  f.inventory.validate_commit.default.available=true;
  const resumed=new System10({database,fixtures:f}); assert.equal(resumed.resolve(r,principal).status,'COMMITTED'); assert.equal(state(resumed).random_sample.length,1); resumed.close();
});
test('opposed tie preserves state with both participant samples',()=> {
  const r=request(),op={...r,actor_id:'actor-002'};
  const {engine}=setup([r,op],{profile:{resolution_kind:'opposed',difficulty:null},domain:{opponent:{actor_id:'actor-002',task_profile:'repair@v1'}}});
  const result=engine.resolve(r,principal); assert.equal(result.outcome_band,'tie'); assert.equal(result.margin,0); assert.equal(state(engine).random_sample.length,2); engine.close();
});
test('public hidden projections contain no internal result fields',()=> {
  const r=request(); const {engine}=setup([r],{configure:({f})=> { f.core_turn.authorize.default.payload.developer=false; }});
  assert.deepEqual(engine.resolve(r,principal),{}); engine.close();
});
test('strict client fields reject supplied dice',()=> {
  const {engine}=setup(); assert.throws(()=>engine.resolve({...request(),dice:[10,10]},principal),/Unknown contract field/); engine.close();
});
test('seven practice blocks credit six, dedupe, and preserve bounded escrow',()=> {
  const commands=Array.from({length:7},(_,i)=>({operation:'practice',source_event_id:'practice-'+i,character_id:'actor-001',simulation_time:'2012-10-08T20:00:00Z'}));
  const {engine}=setup([],{configure:({put})=> {
    put('inventory','verify_practice_receipt',{accepted:true,completed:true});
    commands.forEach((command,i)=> {
      const interval={start:`2012-10-08T${String(8+Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}:00Z`,end:`2012-10-08T${String(8+Math.floor((i+1)/2)).padStart(2,'0')}:${(i+1)%2?'30':'00'}:00Z`};
      put('npc_autonomy','practice_evidence',{source_event_id:command.source_event_id,character_id:command.character_id,branch_id:branch,completed:true,authorized:true,learning_potential:true,accepted_domain_receipt_ref:'receipt-'+i,learning_objective_ref:'learn-repair',allocations:[{skill_id:'HouseholdRepair',units:1}],simulation_interval:interval,owner:'inventory',simulation_day_ref:'day-001',event_sequence:i+1,effort_block_ref:'effort-'+i,kind:'solo',task_context_refs:['context-1']},digest(command));
      put('core_turn','learning_day',{simulation_day_ref:'day-001',within_single_day:true,event_sequence:i+1},digest({character_id:command.character_id,interval}));
    });
  }});
  for(const c of commands) engine.practice(c,principal);
  const before=state(engine); assert.equal(before.practice_receipt.reduce((n,r)=>n+r.units,0),6); assert.equal(before.practice_receipt.at(-1).units,0);
  engine.practice(commands[0],principal); assert.equal(state(engine).practice_receipt.length,7); engine.close();
});

function addPractice(put,command,{index=0,day='day-001',allocations=[{skill_id:'HouseholdRepair',units:1}],kind='solo',instructor_ref=null,...extra}={}) {
  const start=new Date(Date.UTC(2012,9,8,8)+index*1800000).toISOString();
  const end=new Date(Date.parse(start)+1800000).toISOString(); const interval={start,end};
  put('inventory','verify_practice_receipt',{accepted:true,completed:true});
  put('npc_autonomy','practice_evidence',{source_event_id:command.source_event_id,character_id:command.character_id,branch_id:branch,completed:true,authorized:true,learning_potential:true,accepted_domain_receipt_ref:'receipt-'+index,learning_objective_ref:'learn-'+index,allocations,simulation_interval:interval,owner:'inventory',simulation_day_ref:day,event_sequence:index+1,effort_block_ref:'effort-'+index,kind,instructor_ref,task_context_refs:['context-'+index],...extra},digest(command));
  put('core_turn','learning_day',{simulation_day_ref:day,within_single_day:true,event_sequence:index+1},digest({character_id:command.character_id,interval}));
}
test('concurrent workers cannot double-award one practice source',async()=> {
  const {Worker}=await import('node:worker_threads');
  const command={operation:'practice',source_event_id:'concurrent-source',character_id:'actor-001',simulation_time:'2012-10-08T20:00:00Z'};
  const database=join(mkdtempSync(join(tmpdir(),'valor-system10-concurrent-')),'state.sqlite');
  const {engine,f}=setup([],{database,configure:({put})=>addPractice(put,command)}); engine.close();
  const run=()=>new Promise((resolve,reject)=> {
    const worker=new Worker(new URL('./practice-worker.mjs',import.meta.url),{workerData:{database,fixtures:f,command}});
    worker.once('message',resolve); worker.once('error',reject); worker.once('exit',code=>{if(code) reject(new Error('Worker failed'));});
  });
  const results=await Promise.all([run(),run()]); assert.deepEqual(results[0],results[1]);
  const reopened=new System10({database,fixtures:f}); assert.equal(state(reopened).practice_receipt.length,1); assert.equal(state(reopened).practice_receipt[0].units,1); reopened.close();
});
test('blocked milestone escrows units and later promotion consumes them exactly once',()=> {
  const command={operation:'practice',source_event_id:'escrow-source',character_id:'actor-001',simulation_time:'2012-10-08T20:00:00Z'};
  const advancement={operation:'advance',character_id:'actor-001',skill_id:'HouseholdRepair',source_event_id:'assessment-001',simulation_time:command.simulation_time};
  const {engine}=setup([],{configure:({put})=> {
    addPractice(put,command);
    put('npc_autonomy','assessment',{accepted:true,character_id:'actor-001',skill_id:'HouseholdRepair',source_event_id:advancement.source_event_id,branch_id:branch,criteria:['varied_technique']});
  }});
  const saved=state(engine), before=saved.skill_rating.find(x=>x.character_id==='actor-001'&&x.skill_id==='HouseholdRepair');
  engine.correct({operation:'correct',simulation_time:time,record:{supersedes_event_id:saved.event_envelope[0].event_id,before,after:{...before,practice_units:99,revision:before.revision+1},reason:'test precondition',authority:'fixture-creator',branch}},principal);
  engine.practice(command,principal); let rating=state(engine).skill_rating.find(x=>x.character_id==='actor-001'&&x.skill_id==='HouseholdRepair'); assert.equal(rating.rank,4); assert.equal(rating.practice_units,100);
  engine.advance(advancement,principal); rating=state(engine).skill_rating.find(x=>x.character_id==='actor-001'&&x.skill_id==='HouseholdRepair'); assert.equal(rating.rank,5); assert.equal(rating.practice_units,0);
  engine.advance(advancement,principal); assert.equal(state(engine).development_ledger.advancement_events.length,1); engine.close();
});
test('13 units across skills cap at 12 in event order',()=> {
  const commands=Array.from({length:13},(_,i)=>({operation:'practice',source_event_id:'total-source-'+i,character_id:'actor-001',simulation_time:'2012-10-08T20:00:00Z'}));
  const {engine}=setup([],{configure:({put})=>commands.forEach((c,i)=>addPractice(put,c,{index:i,allocations:[{skill_id:['HouseholdRepair','Cooking','Mechanics'][Math.floor(i/6)],units:1}]}))});
  for(const c of commands) engine.practice(c,principal);
  assert.equal(state(engine).practice_receipt.reduce((n,x)=>n+x.units,0),12); assert.equal(state(engine).practice_receipt.at(-1).units,0); engine.close();
});
test('supervisor below learner+2 cannot double the award',()=> {
  const command={operation:'practice',source_event_id:'bad-supervision',character_id:'actor-001',simulation_time:'2012-10-08T20:00:00Z'};
  const {engine}=setup([],{configure:({put})=>addPractice(put,command,{kind:'supervised',instructor_ref:'actor-002',training_profile_valid:true,allocations:[{skill_id:'HouseholdRepair',units:2}]})});
  assert.throws(()=>engine.practice(command,principal),/conserve the block award/); assert.equal(state(engine).practice_receipt.length,0); engine.close();
});
test('missing source is an operational error, never a failed gameplay sample',()=> {
  const {engine}=setup([request()],{configure:({f})=>{f.inventory.projection[digest(request())].available=false;}});
  assert.throws(()=>engine.resolve(request(),principal),/inventory:projection/); assert.equal(state(engine).random_sample.length,0); assert.equal(state(engine).resolution_result.length,0); engine.close();
});
test('owner rejection invokes an authored fallback without rerolling',()=> {
  const repair={owner:'inventory',command_type:'repair',parameters:{object:'object-001'},preconditions:[],bands:['full'],rejection_policy:'fallback',fallback:{owner:'inventory',command_type:'bounded_failure',parameters:{object:'object-001'},preconditions:[],rejection_policy:'ignore'}};
  const {engine}=setup([request()],{profile:{effect_contracts:[repair]},configure:({put})=>put('inventory','command',{accepted:false})});
  const result=engine.resolve(request(),principal); assert.equal(result.status,'COMMITTED'); assert.equal(result.effect_proposals.length,2); assert.equal(result.domain_receipts.filter(x=>x.owner==='inventory').length,2); assert.equal(state(engine).random_sample.length,1); engine.close();
});
test('a partial owner commit is quarantined instead of falsely completed',()=> {
  const a={owner:'inventory',command_type:'repair',parameters:{step:1},preconditions:[],bands:['full'],rejection_policy:'abort'};
  const b={owner:'health',command_type:'proposal',parameters:{step:2},preconditions:[],bands:['full'],rejection_policy:'abort'};
  const {engine}=setup([request()],{profile:{effect_contracts:[a,b]},configure:({put})=> {
    put('health','projection',{}); put('health','lookup_receipt',{found:false}); put('health','command',{accepted:false});
  }});
  const result=engine.resolve(request(),principal); assert.equal(result.status,'COMMITTING'); assert.equal(result.blocked_reason,'owner_compensation_or_repair_required'); assert.equal(state(engine).random_sample.length,1); engine.close();
});
test('immutable definitions reject in-place edits',()=> {
  const {engine}=setup(); assert.throws(()=>engine.register({operation:'register',kind:'task_profile',record:{...profile(),difficulty:12}},principal),/Immutable/); engine.close();
});
test('caller-supplied audience cannot grant developer access',()=> {
  const r={...request(),audience_context:'developer'};
  const {engine}=setup([r],{configure:({f})=>{f.core_turn.authorize.default.payload.developer=false;}});
  assert.deepEqual(engine.resolve(r,principal),{}); engine.close();
});

test('physical attribute program requires real sessions spanning 120 days',()=> {
  const sessions=Array.from({length:90},(_,i)=>({ref:'session-'+i,start:new Date(Date.UTC(2012,0,1)+i*2*86400000).toISOString(),end:new Date(Date.UTC(2012,0,1)+i*2*86400000+45*60000).toISOString(),completed:true}));
  const program={character_id:'actor-001',attribute_id:'Strength',policy_ref:'physical/v1',validated_session_refs:sessions.map(x=>x.ref),program_start_time:sessions[0].start,last_increase_time:null,health_feasibility_receipt:'health-program',assessment_receipt:'assessment-program'};
  const command={operation:'attribute_program',record:program,simulation_time:time};
  const {engine}=setup([],{configure:({put})=>put('health','attribute_program',{accepted:true,assessment_receipt:program.assessment_receipt,health_feasibility_receipt:program.health_feasibility_receipt,sessions})});
  engine.attributeProgram(command,principal); engine.attributeProgram(command,principal);
  assert.equal(state(engine).attribute_rating.find(x=>x.character_id==='actor-001'&&x.attribute_id==='Strength').value,5); assert.equal(state(engine).development_ledger.attribute_programs.length,1); engine.close();
});
test('owner-validated restore preserves exact sampled result and receipts',()=> {
  const r=request(); const original=setup([r]); const result=original.engine.resolve(r,principal); const saved=state(original.engine); original.engine.close();
  const fixture=fixtures([r]); fixture.f.creator.authorize.default.payload.operations.push('restore');
  fixture.put('persistence','restore',{validated:true,branch_id:branch,state:saved});
  const restored=new System10({fixtures:fixture.f}); assert.deepEqual(restored.dispatch({operation:'restore',source_event_id:saved.event_envelope.at(-1).event_id},principal),{restored:true});
  assert.deepEqual(restored.resolve(r,principal),result); assert.equal(state(restored).random_sample.length,1); restored.close();
});
test('malformed JSON contract returns typed diagnostics without sampling',()=> {
  const {engine}=setup(); const result=engine.dispatch({operation:'resolve',request:[]},principal);
  assert.equal(result.error.code,'INVALID_INTENT'); assert.equal(result.error.sample_exists,false); assert.equal(state(engine).random_sample.length,0); engine.close();
});


test('classification is System 10 while stable IDs remain unchanged',()=> {
  const saved=new CapabilityState();
  assert.equal(saved.system.display_number,10);
  assert.equal(saved.system.stable_domain_id,'capability_resolution');
  assert.equal(saved.system.ruleset_id,'capability_resolution/v1');
});

test('legacy classification migrates without changing committed results',async()=> {
  const {DatabaseSync}=await import('node:sqlite');
  const r=request(), database=join(mkdtempSync(join(tmpdir(),'valor-system10-legacy-')),'state.sqlite');
  const {engine,f}=setup([r],{database});
  const result=engine.resolve(r,principal); const before=state(engine); engine.close();
  const db=new DatabaseSync(database);
  const legacy=JSON.parse(db.prepare('SELECT state FROM capability_state WHERE singleton=1').get().state);
  legacy.system.display_number=9;
  db.prepare('UPDATE capability_state SET state=? WHERE singleton=1').run(JSON.stringify(legacy)); db.close();
  const reopened=new System10({database,fixtures:f});
  const after=state(reopened);
  assert.equal(after.system.display_number,10);
  assert.deepEqual(after.random_sample,before.random_sample);
  assert.deepEqual(after.event_envelope,before.event_envelope);
  assert.deepEqual(reopened.resolve(r,principal),result);
  reopened.close();
});
