import test from 'node:test';
import assert from 'node:assert/strict';
import { System22, System22State, createMockAdapters, emptyConfiguration, reference } from './index.mjs';

const NOW='2012-01-01T12:00:00.000Z';
const actor='person:leader', organization='organization:001', version='v1';
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture() {
  const configuration=emptyConfiguration();
  const permissions=['manage','IssueOrder'].map(action=>({domain:'factions_gangs_institutions',organization_id:organization,action,conditions:[]}));
  const role={id:'role:leader',organization_id:organization,mandate_ref:'mandate:001',permissions_ref:reference(permissions),reporting_scope:{organization_id:organization},appointment_policy:'appointment:v1'};
  const charter={version,organization_id:organization,supporter_refs:[actor],role_definitions:[role]};
  configuration.charters=[charter]; configuration.type_profiles=[{type:'company',version}];
  configuration.appointment_removal_procedures=[{id:'appointment:v1',version,max_active_holders:1}];
  const organizationRecord={id:organization,names_ref:'names:001',type:'company',charter_version:version,active_status:'active',founded_event:'$event',visibility_policy:'visibility:001'};
  const assignment={id:'assignment:leader',role_id:role.id,holder_id:actor,appointment_event:'$event',effective_from:NOW,effective_to:null,status:'active'};
  const makeRule=(operation,actions,extra={})=>({id:operation,version,operation,organization_id:organization,permission:'manage',actions,requirements:[],choice_requirements:[],effects:[],...extra});
  const action=(table,record,mode='create')=>({table,mode,fields:Object.keys(record)});
  const unit={id:'unit:001',organization_id:organization,parent_unit_id:null,purpose_ref:'purpose:001',active_from:NOW,active_to:null,governance_ref:'governance:001'};
  configuration.governance_procedures=[
    makeRule('FoundOrganization',[action('organization',organizationRecord),action('role_definition',role),action('role_assignment',assignment)],{bootstrap:true}),
    makeRule('CreateUnit',[action('unit',unit)]),
    makeRule('ReassignUnit',[action('unit',unit,'update')]),
    makeRule('RebrandOrganization',[{table:'organization',mode:'update',fields:['names_ref']}]),
    makeRule('RemoveRole',[{table:'role_assignment',mode:'update',fields:['status','effective_to']}]),
  ];
  const decision=(subject,terms)=>({status:'ok',data:{actor_ref:actor,subject_ref:subject,terms_ref:terms,explicit:true,choice:'accept',decision_ref:`decision:${subject}`}});
  const fixtures={
    player:{authenticate:{status:'ok',data:{actor_ref:actor,kind:'player'}},
      [`decision:${organization}`]:decision(organization,reference(charter).id),
      [`decision:${role.id}`]:decision(role.id,reference({effective_from:NOW,effective_to:null}).id)},
    system9:{identity:{status:'ok',data:{exists:true,is_player:true}}},
    system11:{clock:{status:'ok',data:{now:NOW}}}
  };
  const command=(operation,changes=[],extra={})=>({operation,actor_or_system_authority_ref:actor,expected_revision:0,canonical_timestamp:NOW,correlation_id:'correlation:001',idempotency_key:operation,policy_version:version,causal_refs:['cause:001'],procedure_ref:operation,changes,effects:[],...extra});
  const founding=command('FoundOrganization',[{table:'organization',record:organizationRecord},{table:'role_definition',record:role},{table:'role_assignment',record:assignment}]);
  const engine=()=>new System22({configuration,adapters:createMockAdapters(fixtures)});
  return {configuration,fixtures,command,founding,engine,unit,role,assignment,makeRule,action};
}
function founded(f) { const e=f.engine(); const result=e.step(f.founding); assert.equal(result.status,'committed',JSON.stringify(result)); return e; }

test('schema admits only the distilled collections and fields',()=>{
  const state=new System22State();
  assert.equal(Object.keys(state).length,26);
  const f=fixture(); f.founding.changes[0].record.wallet=100;
  const e=f.engine(); assert.equal(e.step(f.founding).ok,false); assert.equal(e.revision,0);
});
test('founding, save/reload and idempotency preserve the same events',()=>{
  const f=fixture(),e=founded(f),saved=e.snapshot();
  const loaded=System22.restore(saved,createMockAdapters(f.fixtures));
  assert.deepEqual(loaded.snapshot(),saved);
  assert.equal(loaded.step(f.founding).status,'committed'); assert.equal(loaded.revision,1);
  const changed=clone(f.founding); changed.changes[0].record.names_ref='different';
  assert.equal(loaded.step(changed).error,'idempotency_conflict');
  assert.deepEqual(loaded.snapshot(),saved);
});
test('missing supporter consent is pending, never fabricated membership',()=>{
  const f=fixture(); delete f.fixtures.player[`decision:${organization}`];
  const e=f.engine(),result=e.step(f.founding);
  assert.equal(result.status,'pending'); assert.equal(e.snapshot().organization.length,0);
  assert.equal(e.snapshot().command_and_durable_workflow[0].pending_step_refs.length,1);
  const restored=System22.restore(e.snapshot(),createMockAdapters(fixture().fixtures));
  const resumed=restored.step(f.command('ResumeWorkflow',[],{expected_revision:1,workflow_index:0,idempotency_key:'resume:1'}));
  assert.equal(resumed.status,'committed',JSON.stringify(resumed));
  assert.equal(restored.snapshot().organization.length,1);
});
test('hierarchy cycle fails atomically',()=>{
  const f=fixture(),e=founded(f);
  assert.equal(e.step(f.command('CreateUnit',[{table:'unit',record:f.unit}],{expected_revision:1,idempotency_key:'unit:1'})).status,'committed');
  const saved=e.snapshot();
  const response=e.step(f.command('ReassignUnit',[{table:'unit',index:0,record:{...f.unit,parent_unit_id:f.unit.id}}],{expected_revision:2}));
  assert.equal(response.ok,false); assert.deepEqual(e.snapshot(),saved);
});
test('stale revisions and revoked offices cannot mutate state',()=>{
  const f=fixture(),e=founded(f);
  assert.equal(e.step(f.command('CreateUnit',[{table:'unit',record:f.unit}])).error,'stale_revision');
  const current=e.snapshot().role_assignment[0];
  assert.equal(e.step(f.command('RemoveRole',[{table:'role_assignment',index:0,record:{...current,status:'removed',effective_to:NOW}}],{expected_revision:1})).status,'committed');
  assert.equal(e.step(f.command('CreateUnit',[{table:'unit',record:f.unit}],{expected_revision:2})).ok,false);
  assert.equal(e.snapshot().unit.length,0);
});
test('undisclosed identities produce the same empty query as absent identities',()=>{
  const f=fixture(),e=founded(f),query=f.command('GetKnownOrganization');
  assert.deepEqual(e.query({...query,subject_ref:organization}),{ok:true,records:[]});
  assert.deepEqual(e.query({...query,subject_ref:'absent'}),{ok:true,records:[]});
});
test('queries return acquired versions and never unpack private reference payloads',()=>{
  const f=fixture(); f.fixtures.knowledge={visible_fields:{status:'ok',data:{holder_ref:actor,permitted:true,acquired:true,fields:['names_ref','active_status'],values:{names_ref:reference({private:'secret'}),active_status:'forming'}}}};
  const e=founded(f),query=e.query(f.command('GetKnownOrganization'));
  assert.equal(query.records[0].active_status,'forming');
  assert.equal(typeof query.records[0].names_ref,'string');
  assert.equal(JSON.stringify(query).includes('secret'),false);
});
test('queued outgoing effects survive failures with one stable idempotency key',()=>{
  const f=fixture();
  f.configuration.governance_procedures.find(p=>p.operation==='CreateUnit').effects=[{domain:'system16',operation:'send_notice',organization_id:organization}];
  const e=founded(f);
  const queued=e.step(f.command('CreateUnit',[{table:'unit',record:f.unit}],{expected_revision:1,effects:[{domain:'system16',operation:'send_notice',subject_ref:f.unit.id,payload:{content_ref:'notice:001'}}]}));
  assert.equal(queued.status,'pending');
  const firstRequest=e.snapshot().command_and_durable_workflow[1].pending_step_refs[0].data.request;
  const retry=e.step(f.command('ResumeWorkflow',[],{expected_revision:2,idempotency_key:'retry:1',workflow_index:1}));
  assert.equal(retry.status,'pending');
  assert.deepEqual(e.snapshot().command_and_durable_workflow[1].pending_step_refs[0].data.request,firstRequest);
  f.fixtures.system16={send_notice:{status:'ok',data:{receipt_ref:'receipt:001',committed:true}}};
  const loaded=System22.restore(e.snapshot(),createMockAdapters(f.fixtures));
  assert.equal(loaded.step(f.command('ResumeWorkflow',[],{expected_revision:3,idempotency_key:'retry:2',workflow_index:1})).status,'committed');
  assert.equal(loaded.snapshot().command_and_durable_workflow[1].completed_step_refs.length,1);
  assert.equal(loaded.step(f.command('ResumeWorkflow',[],{expected_revision:4,idempotency_key:'retry:3',workflow_index:1})).ok,false);
});
test('unknown assessments cannot become a numeric score or invented favorable state',()=>{
  const f=fixture();
  const assessment={id:'assessment:001',holder_ref:actor,target_ref:'person:target',scope_ref:reference({organization_id:organization}),dimension:'competence',state:'favorable',source_refs:[],reasons_ref:'reason:001',reviewed_at:NOW,supersedes_id:null};
  f.configuration.governance_procedures.push(f.makeRule('AssessReputation',[f.action('reputation_assessment',assessment)]));
  const e=founded(f);
  assert.equal(e.step(f.command('AssessReputation',[{table:'reputation_assessment',record:assessment}],{expected_revision:1})).ok,false);
  assessment.state='unknown';
  assert.equal(e.step(f.command('AssessReputation',[{table:'reputation_assessment',record:assessment}],{expected_revision:1,idempotency_key:'unknown'})).status,'committed');
});
test('copied reports cannot count as independent reputation support',()=>{
  const f=fixture();
  const assessment={id:'assessment:001',holder_ref:actor,target_ref:'person:target',scope_ref:reference({organization_id:organization}),dimension:'competence',state:'favorable',source_refs:['source:1','source:2'],reasons_ref:'reason:001',reviewed_at:NOW,supersedes_id:null};
  f.configuration.governance_procedures.push(f.makeRule('AssessReputation',[f.action('reputation_assessment',assessment)],{assessment:{kind:'review',cases:[{dimension:'competence',facts:['performed','performed'],state:'favorable'}]}}));
  f.fixtures.knowledge={acquisition:{status:'ok',data:{holder_ref:actor,acquired:true,source_lineage_ref:'origin:1',acquisition_ref:'acquisition:1',acquired_at:NOW,assessment_fact:'performed'}}};
  const e=founded(f);
  assert.equal(e.step(f.command('AssessReputation',[{table:'reputation_assessment',record:assessment}],{expected_revision:1})).ok,false);
  assert.equal(e.snapshot().reputation_assessment.length,0);
});
test('a modified saved projection cannot overwrite event history',()=>{
  const f=fixture(),snapshot=founded(f).snapshot(); snapshot.organization[0].names_ref='changed';
  assert.throws(()=>System22.restore(snapshot,createMockAdapters(f.fixtures)),/snapshot_projection_mismatch/);
});

function orderFixture() {
  const f=fixture();
  const objective=reference({organization_id:organization,task:'ordinary_task'});
  const commitment={id:'order:001',issuer_ref:actor,recipients_ref:reference([actor]),objective_ref:objective,authority_ref:reference({organization_id:organization}),resources_ref:'resources:001',due_at:null,delivery_refs:[],status:'draft_or_preview'};
  const recipient={recipient_ref:actor,delivery_refs:[],acquired_instruction_version:null,decision_ref:null,task_ref:null,reservation_refs:[],outcome_ref:null,cancellation_delivery_refs:[]};
  const details={commitment_ref:commitment.id,scope:{organization_id:organization},priority:'ordinary',constraints:[],authority_validity_ref:reference({valid:true}),recipient_states:[recipient]};
  const rules=[
    f.makeRule('DraftOrder',[f.action('commitment',commitment),f.action('order_details',details)]),
    f.makeRule('IssueOrder',[f.action('commitment',commitment,'update')]),
    f.makeRule('RecordDelivery',[f.action('commitment',commitment,'update'),f.action('order_details',details,'update')]),
    f.makeRule('RecordRecipientDecision',[f.action('order_details',details,'update')]),
    f.makeRule('ReviewOrder',[f.action('commitment',commitment,'update')]),
    f.makeRule('ActivateOrder',[f.action('commitment',commitment,'update'),f.action('order_details',details,'update')]),
    f.makeRule('CompleteOrder',[f.action('commitment',commitment,'update'),f.action('order_details',details,'update')])
  ];
  f.configuration.governance_procedures.push(...rules);
  f.fixtures.system16={delivery:{status:'ok',data:{recipient_ref:actor,content_ref:objective,delivered:true,instruction_version:'v1'}}};
  f.fixtures.player[`decision:${commitment.id}`]={status:'ok',data:{actor_ref:actor,subject_ref:commitment.id,terms_ref:objective,explicit:true,choice:'accept',decision_ref:'decision:order'}};
  f.fixtures.knowledge={decision_record:{status:'ok',data:{actor_ref:actor,subject_ref:commitment.id,terms_ref:objective,choice:'accept',explicit:true}}};
  f.fixtures.system13={task:{status:'ok',data:{actor_ref:actor,commitment_ref:commitment.id,capacity_reserved:true,prerequisites_satisfied:true}},task_outcome:{status:'ok',data:{task_ref:'task:001',committed:true,outcome:'completed'}}};
  return {...f,commitment,details};
}
test('order delivery, decision, task activation, and completion are separate transitions',()=>{
  const f=orderFixture(),e=founded(f);
  const run=(operation,changes)=>e.step(f.command(operation,changes,{expected_revision:e.revision,idempotency_key:`${operation}:${e.revision}`}));
  assert.equal(run('DraftOrder',[{table:'commitment',record:f.commitment},{table:'order_details',record:f.details}]).status,'committed');
  assert.equal(run('IssueOrder',[{table:'commitment',index:0,record:{...f.commitment,status:'issued'}}]).status,'committed');
  const premature=clone(f.details); premature.recipient_states[0].decision_ref='decision:order';
  assert.equal(run('RecordRecipientDecision',[{table:'order_details',index:0,record:premature}]).ok,false);
  const delivered=clone(f.details); delivered.recipient_states[0].delivery_refs=['delivery:001']; delivered.recipient_states[0].acquired_instruction_version='v1';
  assert.equal(run('RecordDelivery',[{table:'order_details',index:0,record:delivered},{table:'commitment',index:0,record:{...f.commitment,status:'delivered',delivery_refs:['delivery:001']}}]).status,'committed');
  const accepted=clone(delivered); accepted.recipient_states[0].decision_ref='decision:order';
  assert.equal(run('RecordRecipientDecision',[{table:'order_details',index:0,record:accepted}]).status,'committed');
  let commitment=e.snapshot().commitment[0];
  assert.equal(run('ReviewOrder',[{table:'commitment',index:0,record:{...commitment,status:'accepted'}}]).status,'committed');
  const active=clone(accepted); active.recipient_states[0].task_ref='task:001';
  commitment=e.snapshot().commitment[0];
  assert.equal(run('ActivateOrder',[{table:'order_details',index:0,record:active},{table:'commitment',index:0,record:{...commitment,status:'active'}}]).status,'committed');
  const completed=clone(active); completed.recipient_states[0].outcome_ref='outcome:001';
  commitment=e.snapshot().commitment[0];
  assert.equal(run('CompleteOrder',[{table:'order_details',index:0,record:completed},{table:'commitment',index:0,record:{...commitment,status:'completed'}}]).status,'committed');
  assert.equal(e.snapshot().order_details[0].recipient_states[0].outcome_ref,'outcome:001');
  assert.deepEqual(System22.restore(e.snapshot(),createMockAdapters(f.fixtures)).snapshot(),e.snapshot());
});

test('an unaffiliated player can respond to an offer, and silence cannot approve it',()=>{
  const f=fixture(),applicant='person:applicant';
  const recruitment={applicant_ref:applicant,organization_scope:{organization_id:organization},contact_or_application_route_ref:'contact:001',stage:'invitation_application',delivery_refs:[],qualification_source_refs:[],assessment_result_refs:[],offered_terms_ref:'terms:001',response_ref:null,approval_ref:null,pending_handoff_refs:[],outcome:'pending'};
  for (const operation of ['InviteMember','AssessApplicant','OfferTerms','RespondToOffer','ApproveAffiliation']) f.configuration.governance_procedures.push(f.makeRule(operation,[f.action('recruitment',recruitment,operation==='InviteMember'?'create':'update')]));
  f.fixtures.knowledge={contact_route:{status:'ok',data:{available:true}}};
  f.fixtures.system16={delivery:{status:'ok',data:{recipient_ref:applicant,content_ref:'terms:001',delivered:true}}};
  const e=founded(f);
  let result=e.step(f.command('InviteMember',[{table:'recruitment',record:recruitment}],{expected_revision:1}));
  assert.equal(result.status,'committed');
  recruitment.stage='assessment'; recruitment.delivery_refs=['delivery:offer'];
  assert.equal(e.step(f.command('AssessApplicant',[{table:'recruitment',index:0,record:clone(recruitment)}],{expected_revision:2})).status,'committed');
  recruitment.stage='terms_offered';
  assert.equal(e.step(f.command('OfferTerms',[{table:'recruitment',index:0,record:clone(recruitment)}],{expected_revision:3})).status,'committed');
  assert.equal(e.step(f.command('ApproveAffiliation',[{table:'recruitment',index:0,record:{...recruitment,stage:'approval',approval_ref:'approval:001'}}],{expected_revision:4})).ok,false);
  f.fixtures.player.authenticate={status:'ok',data:{actor_ref:applicant,kind:'player'}};
  f.fixtures.player['decision:recruitment/0']={status:'ok',data:{actor_ref:applicant,subject_ref:'recruitment/0',terms_ref:'terms:001',explicit:true,choice:'decline',decision_ref:'decision:decline'}};
  const loaded=System22.restore(e.snapshot(),createMockAdapters(f.fixtures));
  result=loaded.step(f.command('RespondToOffer',[{table:'recruitment',index:0,record:{...recruitment,stage:'response',response_ref:'decision:decline',outcome:'decline'}}],{actor_or_system_authority_ref:applicant,expected_revision:4}));
  assert.equal(result.status,'committed',JSON.stringify(result));
  assert.equal(loaded.snapshot().affiliation.length,0);
});

test('a successful-looking response without a committed receipt stays pending',()=>{
  const f=fixture();
  f.configuration.governance_procedures.find(p=>p.operation==='CreateUnit').effects=[{domain:'system14',operation:'reserve',organization_id:organization}];
  f.fixtures.system14={reserve:{status:'ok',data:{}}};
  const e=founded(f);
  assert.equal(e.step(f.command('CreateUnit',[{table:'unit',record:f.unit}],{expected_revision:1,effects:[{domain:'system14',operation:'reserve',subject_ref:'account:001',payload:{}}]})).status,'pending');
  const result=e.step(f.command('ResumeWorkflow',[],{expected_revision:2,idempotency_key:'resume:unconfirmed',workflow_index:1}));
  assert.equal(result.status,'pending'); assert.equal(e.snapshot().command_and_durable_workflow[1].completed_step_refs.length,0);
});

test('governance requires actual attendance, supplied votes, and authored quorum',()=>{
  const f=fixture();
  const rules={quorum:1,approval_count:1,eligible_refs:[actor],required_voter_refs:[actor]};
  const governance={procedure_ref:'RecordGovernance',proposal_ref:'proposal:001',amendment_refs:[],agenda_scope:{organization_id:organization},eligible_participant_refs:[actor],actual_participant_refs:[actor],notice_delivery_refs:['notice:001'],location_or_channel_ref:'room:001',scheduled_interval:{start:NOW,end:NOW},quorum_approval_counting_rules:reference(rules),participant_decision_refs:['vote:001'],outcome_ref:reference({proposal_ref:'proposal:001',approved:true}),procedural_validity_ref:'validity:001',record_refs:[],review_appeal_refs:[],implementation_refs:[]};
  f.configuration.governance_procedures.push(f.makeRule('RecordGovernance',[f.action('governance',governance)],{governance:rules}));
  f.fixtures.system16={meeting_notice:{status:'ok',data:{recipient_ref:actor,delivered:true}}};
  f.fixtures.system11.attendance={status:'ok',data:{participant_ref:actor,attended:true,interval:governance.scheduled_interval}};
  f.fixtures.player['decision:proposal:001']={status:'ok',data:{actor_ref:actor,subject_ref:'proposal:001',terms_ref:reference([]).id,explicit:true,choice:'approve',decision_ref:'vote:001'}};
  const e=founded(f);
  const invalid={...governance,actual_participant_refs:[]};
  assert.equal(e.step(f.command('RecordGovernance',[{table:'governance',record:invalid}],{expected_revision:1,idempotency_key:'missing-attendance'})).ok,false);
  const valid=e.step(f.command('RecordGovernance',[{table:'governance',record:governance}],{expected_revision:1}));
  assert.equal(valid.status,'committed',JSON.stringify(valid));
});

test('delegated spending cannot exceed its explicitly authored per-command limit',()=>{
  const f=fixture(),delegate='person:delegate';
  const grant={issuer_ref:actor,recipient_ref:delegate,purpose_ref:'delegation:001',scope:{organization_id:organization,actions:['manage'],subject_refs:[f.unit.id,'account:001']},expiry:'2012-01-02T12:00:00.000Z',resource_limits:{'account:001':5},further_delegation_policy:reference({allowed:false,limit_basis:'per_command'}),revocation_ref:null,interrupt_conditions:[]};
  f.configuration.governance_procedures.push(f.makeRule('DelegateAuthority',[f.action('delegation',grant)]));
  f.configuration.governance_procedures.find(p=>p.operation==='CreateUnit').effects=[{domain:'system14',operation:'reserve',organization_id:organization}];
  f.fixtures.player['decision:delegation:001']={status:'ok',data:{actor_ref:delegate,subject_ref:grant.purpose_ref,terms_ref:reference({scope:grant.scope,expiry:grant.expiry,resource_limits:grant.resource_limits}).id,explicit:true,choice:'accept',decision_ref:'decision:grant'}};
  const e=founded(f);
  assert.equal(e.step(f.command('DelegateAuthority',[{table:'delegation',record:grant}],{expected_revision:1})).status,'committed');
  f.fixtures.player.authenticate={status:'ok',data:{actor_ref:delegate,kind:'player'}};
  const delegated=System22.restore(e.snapshot(),createMockAdapters(f.fixtures));
  const build=quantity=>f.command('CreateUnit',[{table:'unit',record:f.unit}],{actor_or_system_authority_ref:delegate,expected_revision:2,idempotency_key:`spend:${quantity}`,effects:[{domain:'system14',operation:'reserve',subject_ref:'account:001',payload:{allocations:[{resource_ref:'account:001',quantity}]}}]});
  assert.equal(delegated.step(build(6)).ok,false);
  assert.equal(delegated.snapshot().unit.length,0);
  assert.equal(delegated.step(build(4)).status,'pending');
});

test('two active holders cannot exceed the charter appointment capacity',()=>{
  const f=fixture();
  f.configuration.governance_procedures.push(f.makeRule('AppointRole',[f.action('role_assignment',f.assignment)]));
  const e=founded(f),record={...f.assignment,id:'assignment:other',holder_id:'person:other'};
  assert.equal(e.step(f.command('AppointRole',[{table:'role_assignment',record}],{expected_revision:1})).ok,false);
  assert.equal(e.snapshot().role_assignment.length,1);
});
