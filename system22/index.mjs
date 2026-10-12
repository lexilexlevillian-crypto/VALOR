/**
 * Isolated System 22. Node.js 22+; no third-party dependencies.
 *
 * All integrations are fixed JSON fixture adapters, never simulations. Supply
 * authored versioned policies and receipts explicitly; absent policy/data waits
 * or denies. No numerical governance, reputation, or compliance defaults exist.
 *
 * Ref = a string identifier, or an immutable content-addressed {id, data} value.
 * Inline references keep event payloads and durable requests self-contained.
 * Collection addresses are "table/index"; records are never physically deleted.
 * State contains exactly the architecture's named collections and configuration.
 *
 * step({operation, actor_or_system_authority_ref, expected_revision,
 *   canonical_timestamp, correlation_id, idempotency_key, policy_version,
 *   causal_refs, procedure_ref, changes:[{table,index?,record}], effects:[]})
 *
 * Authored procedure contract (versioned_configuration.governance_procedures):
 * {id,version,operation,organization_id,permission,actions,requirements,
 *  choice_requirements,governance?,assessment?,effects,review?,bootstrap?}
 * actions: [{table,mode:"create"|"update",fields:[...],from?,to?}]
 * requirements: [{domain,operation,subject_ref,equals:{field:value}}]
 * choice_requirements: [{actor_ref,subject_ref,terms_ref,choices:[...]}]
 * effects: [{domain,operation,organization_id}]
 * permission names an exact scoped role permission; bootstrap is restricted to
 * FoundOrganization. State transitions are proposals, never privileged setters.
 */
import { createHash } from 'node:crypto';

/** @typedef {null|boolean|number|string|Json[]|{[key:string]:Json}} Json */
/** @typedef {{[key:string]:Json}} JsonObject */
/**
 * @typedef {Object} TransitionCommand
 * @property {string} operation
 * @property {string} actor_or_system_authority_ref
 * @property {number} expected_revision
 * @property {string} canonical_timestamp
 * @property {string} correlation_id
 * @property {string} idempotency_key
 * @property {string} policy_version
 * @property {Json[]} causal_refs
 * @property {string} [procedure_ref]
 * @property {{table:string,index?:number,record:JsonObject}[]} [changes]
 * @property {JsonObject[]} [effects]
 * @property {number} [workflow_index]
 */

const DOMAIN = 'factions_gangs_institutions';
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  throw new Gate('invalid_json');
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (a, b) => canonical(a) === canonical(b);
export const reference = data => ({ id: `sha256:${digest(data)}`, data: clone(data) });
const refId = value => typeof value === 'string' ? value : value?.id;
const isRef = value => typeof value === 'string' ? value.length > 0 :
  plain(value) && Object.keys(value).length === 2 && typeof value.id === 'string' &&
  Object.hasOwn(value, 'data') && value.id === `sha256:${digest(value.data)}`;
const unpack = value => plain(value) && isRef(value) ? value.data : null;
const time = value => {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'invalid_time');
  const result = Date.parse(value);
  check(Number.isFinite(result) && new Date(result).toISOString() === value, 'invalid_time');
  return result;
};
class Gate extends Error {
  constructor(code, waiting = false) { super(code); this.code = code; this.waiting = waiting; }
}
function check(condition, code = 'unsupported_transition') { if (!condition) throw new Gate(code); }
const unique = values => [...new Set(values)];

// ? = nullable; [] = array; unmarked fields are opaque, non-null JSON values.
const SPEC = {
  organization: 'id names_ref type charter_version active_status founded_event visibility_policy',
  unit: 'id organization_id parent_unit_id? purpose_ref active_from active_to? governance_ref',
  affiliation: 'id character_id organization_id unit_ref? category status starts_at ends_at? visibility',
  role_definition: 'id organization_id mandate_ref permissions_ref reporting_scope appointment_policy',
  role_assignment: 'id role_id holder_id appointment_event effective_from effective_to? status',
  commitment: 'id issuer_ref recipients_ref objective_ref authority_ref resources_ref due_at? delivery_refs[] status',
  claim: 'id claimant_ref location_scope type basis_ref audience_assessments[] active_status',
  agreement: 'id parties_ref terms_ref approval_refs[] effective_at review_at? status',
  reputation_assessment: 'id holder_ref target_ref scope_ref dimension state source_refs[] reasons_ref reviewed_at supersedes_id?',
  organization_event: 'id occurred_at processed_at actor_ref cause_ref policy_version payload_ref idempotency_key',
  versioned_configuration: 'type_profiles[] charters[] membership_terms[] role_scopes[] appointment_removal_procedures[] governance_procedures[] service_definitions[] agreement_templates[] claim_categories[] reputation_review_decay_policy active_dormant_review_policy routine_delegation_policy records_retention_privacy_policy content_policy',
  affiliation_details: 'affiliation_ref sponsor_or_admission_process_ref participation_event_refs[] public_claim_refs[] personal_allegiance_refs[] obligation_refs[] privilege_refs[]',
  recruitment: 'applicant_ref organization_scope contact_or_application_route_ref stage delivery_refs[] qualification_source_refs[] assessment_result_refs[] offered_terms_ref response_ref? approval_ref? pending_handoff_refs[] outcome',
  authority_details: 'role_ref rank_within_structure permission_domain subject_scope conditions[] access_scope delegation_policy claimed_title_refs[] authority_evaluation_refs[] issue_specific_influence_refs[] audience_legitimacy_assessment_refs[]',
  delegation: 'issuer_ref recipient_ref purpose_ref scope expiry resource_limits further_delegation_policy revocation_ref? interrupt_conditions[]',
  governance: 'procedure_ref proposal_ref amendment_refs[] agenda_scope eligible_participant_refs[] actual_participant_refs[] notice_delivery_refs[] location_or_channel_ref scheduled_interval quorum_approval_counting_rules participant_decision_refs[] outcome_ref? procedural_validity_ref record_refs[] review_appeal_refs[] implementation_refs[]',
  order_details: 'commitment_ref scope priority constraints[] authority_validity_ref recipient_states[]',
  resource_coordination: 'budget_scope authorized_controller_refs[] planned_allocation owner_account_asset_worker_service_refs[] use_permission_refs[] availability_projection_refs[] reservation_refs[] transfer_consumption_release_refs[] pending_effect_refs[]',
  premises_services: 'organization_scope place_room_refs[] use_agreement_refs[] access_permission_refs[] service_definition_refs[] staff_schedule_provider_refs[] storage_container_refs[]',
  agreement_details: 'agreement_ref representative_refs[] representative_mandate_refs[] objective_refs[] commitment_refs[] acceptance_delivery_refs[] information_sharing_scope noninterference_scope expiry_or_renewal_policy visibility_policy performance_breach_review_refs[]',
  dispute_response: 'participant_refs[] originating_event_refs[] claimed_responsibility_refs[] known_loss_refs[] attempted_remedy_refs[] actor_stance_refs[] conflict_state decision_maker_ref known_cause_ref target_basis_refs[] target_confidence objective_ref alternative_refs[] resource_refs[] constraints[] timing review_refs[] external_interest_refs[]',
  discipline: 'allegation_source_refs[] applicable_rule_ref reviewer_ref acquired_material_refs[] response_ref? decision_scope decision_reason_refs[] procedural_validity_ref review_option_refs[] implementation_refs[] notice_delivery_refs[]',
  succession_transition: 'trigger_ref trigger_acquisition_refs[] interim_authority_refs[] candidate_eligibility_participation_refs[] approval_refs[] competing_claim_refs[] transition_kind source_successor_ids[] lineage_id_mapping_refs[] individual_affiliation_decision_refs[] authority_access_resource_transfer_refs[] unresolved_commitment_refs[] status',
  crew_details: 'organization_or_unit_ref objective_ref completion_stop_conditions[] participation_decision_refs[] task_role_skill_requirement_refs[] time_window resource_reservation_refs[] communication_scope exit_expiry_policy',
  assessment_information_provenance: 'assessment_or_record_ref holder_audience_scope recorded_content_ref source_lineage_refs[] acquisition_delivery_refs[] acquisition_times[] confidence_relevance correction_supersession_refs[]',
  command_and_durable_workflow: 'actor_or_system_authority_ref expected_revision canonical_timestamp correlation_id idempotency_key current_revision causal_refs[] policy_version completed_step_refs[] pending_step_refs[] stored_resolution_refs[] reservation_refs[] choice_or_dependency_wait_ref? next_review_at? failure_reason?'
};
const RECIPIENT = 'recipient_ref delivery_refs[] acquired_instruction_version? decision_ref? task_ref? reservation_refs[] outcome_ref? cancellation_delivery_refs[]';
const fields = spec => spec.split(' ').map(token => ({ name: token.replace(/\?|\[\]/g, ''), nullable: token.includes('?'), array: token.includes('[]') }));
const TYPES = ['gang','criminal_enterprise','police_or_civic_unit','company','school','religious_organization','family_or_household','crew'];
const CATEGORIES = ['applicant','participant','associate','formal_member','employee','student','office_holder','former_member','other_authored_category'];
const DIMENSIONS = ['competence','reliability','discretion_confidentiality','contribution','affinity','perceived_threat','alignment_on_named_issue'];
const ASSESSMENTS = ['unknown','favorable','mixed','unfavorable','contested'];
const ORDER = ['draft_or_preview','issued','delivered','accepted','declined','active','completed','failed','cancelled'];
const CONFLICT = ['competition','grievance','hostility','active_dispute','truce_or_resolution'];
const TRANSITIONS = ['split','merger','dormancy','dissolution','reformation'];
const RECRUITMENT = ['invitation_application','assessment','terms_offered','response','approval'];
const OWNERS = ['player','manifest',...Array.from({length:13},(_,i)=>`system${i+9}`),'relationships','knowledge','npc','persistence','presentation'];
const RESOURCE_OWNERS = ['system12','system13','system14','system15','system17'];

function shape(record, spec) {
  check(plain(record), 'invalid_record');
  const declared = fields(spec);
  check(same(Object.keys(record).sort(), declared.map(f => f.name).sort()), 'invalid_record_fields');
  for (const f of declared) {
    const value = record[f.name];
    if (value === null) { check(f.nullable, 'invalid_null'); continue; }
    if (f.array) check(Array.isArray(value), 'invalid_array');
    if (f.name.endsWith('_at') || f.name.endsWith('_from') || f.name.endsWith('_to') ||
        ['canonical_timestamp','expiry','active_from','active_to'].includes(f.name)) time(value);
    if (f.name === 'id' || f.name.endsWith('_id')) check(typeof value === 'string' && value.length > 0, 'invalid_id');
    if (f.name.endsWith('_ref')) check(isRef(value), 'invalid_reference');
    if (f.name.endsWith('_refs')) check(value.every(isRef), 'invalid_reference');
    if (f.name.endsWith('_ids')) check(value.every(id=>typeof id==='string' && id.length>0),'invalid_id');
    if (['status','active_status','stage','outcome','state','type','category','dimension'].includes(f.name)) check(typeof value==='string' && value.length>0,'invalid_state');
    if (f.name.endsWith('_revision')) check(Number.isSafeInteger(value) && value>=0,'invalid_revision');
  }
  canonical(record);
}

export function emptyConfiguration() {
  return Object.fromEntries(fields(SPEC.versioned_configuration).map(f => [f.name, f.array ? [] : reference({ configured: false })]));
}

/**
 * Exact, static fixtures only. Keys: SHA256(request), then operation:subject_ref,
 * then operation. Missing fixtures return pending; no dependency logic runs.
 * Both reads and outgoing writes use these placeholder functions.
 */
export function createMockAdapters(fixtures = {}) {
  canonical(fixtures);
  const fixed = clone(fixtures);
  return Object.freeze(Object.fromEntries(OWNERS.map(owner => [owner, request => {
    const entries = fixed[owner] ?? {};
    const key = [digest(request), `${request.operation}:${refId(request.subject_ref) ?? ''}`, request.operation]
      .find(candidate => Object.hasOwn(entries, candidate));
    const result = key === undefined ? { status: 'pending', data: {} } : clone(entries[key]);
    return { ...result, owner, request_ref: reference(request).id };
  }])));
}

/** State variables only; service adapters and execution machinery live outside it. */
export class System22State {
  constructor(configuration = emptyConfiguration()) {
    shape(configuration, SPEC.versioned_configuration);
    for (const table of Object.keys(SPEC)) this[table] = table === 'versioned_configuration' ? clone(configuration) : [];
  }
  toJSON() { return Object.fromEntries(Object.keys(SPEC).map(key => [key, clone(this[key])])); }
}

const OPERATIONS = {
  FoundOrganization: ['organization','role_definition','authority_details','role_assignment','affiliation','affiliation_details'],
  RebrandOrganization: ['organization'],
  CreateUnit: ['unit'], ReassignUnit: ['unit'], CloseUnit: ['unit'],
  InviteMember: ['recruitment'], AssessApplicant: ['recruitment'], OfferTerms: ['recruitment'],
  RespondToOffer: ['recruitment'], ApproveAffiliation: ['recruitment','affiliation','affiliation_details'],
  EndAffiliation: ['affiliation','affiliation_details'], RecordAffiliationDetails: ['affiliation_details'],
  DefineRole: ['role_definition','authority_details'], AppointRole: ['role_assignment'], RemoveRole: ['role_assignment'],
  DelegateAuthority: ['delegation'], RevokeDelegation: ['delegation'],
  RecordGovernance: ['governance'], DecideGovernance: ['governance'],
  DraftOrder: ['commitment','order_details'], IssueOrder: ['commitment','order_details'],
  RecordRecipientDecision: ['order_details','commitment'], ActivateOrder: ['commitment','order_details'],
  ReviewOrder: ['commitment','order_details'],
  CompleteOrder: ['commitment','order_details'], FailOrder: ['commitment','order_details'], CancelOrder: ['commitment','order_details'],
  AllocateResources: ['resource_coordination'], ReleaseResources: ['resource_coordination'],
  RegisterPremises: ['premises_services'], RequestService: ['premises_services','commitment','order_details'],
  RecordClaim: ['claim'], ReviewClaim: ['claim'],
  ProposeAgreement: ['agreement','agreement_details'], ApproveAgreement: ['agreement','agreement_details'],
  ActivateAgreement: ['agreement','agreement_details'], ReviewAgreement: ['agreement','agreement_details'], ExpireAgreement: ['agreement'],
  OpenDispute: ['dispute_response'], ChooseResponse: ['dispute_response','commitment','order_details'], ReviewDispute: ['dispute_response'],
  OpenDiscipline: ['discipline'], RespondToDiscipline: ['discipline'], DecideDiscipline: ['discipline','role_assignment','affiliation'],
  BeginSuccession: ['succession_transition'], CompleteSuccession: ['succession_transition','role_assignment'],
  TransitionOrganization: ['succession_transition','organization','affiliation','affiliation_details','role_definition','role_assignment','authority_details'],
  CreateCrew: ['crew_details','organization','unit','affiliation'], ChangeCrew: ['crew_details'], CloseCrew: ['crew_details','affiliation'],
  AssessReputation: ['reputation_assessment','assessment_information_provenance'], ReviewReputation: ['reputation_assessment','assessment_information_provenance'],
  AcquireInformation: ['assessment_information_provenance'], RecordDelivery: ['recruitment','order_details','commitment','agreement_details','governance','discipline','succession_transition'],
  AdministrativeCorrection: ['organization','unit','affiliation_details','role_definition','authority_details','claim','reputation_assessment','assessment_information_provenance']
};
const IMMUTABLE = {
  organization: ['id','founded_event','type'], unit: ['id','organization_id','active_from'],
  affiliation: ['id','character_id','organization_id','starts_at','category'],
  role_definition: ['id','organization_id'], role_assignment: ['id','role_id','holder_id','appointment_event','effective_from'],
  commitment: ['id','issuer_ref'], claim: ['id','claimant_ref'], agreement: ['id','parties_ref'],
  recruitment: ['applicant_ref','organization_scope'], order_details: ['commitment_ref'],
  delegation: ['issuer_ref','recipient_ref','purpose_ref','scope','expiry','resource_limits','further_delegation_policy'],
  assessment_information_provenance: ['assessment_or_record_ref','holder_audience_scope','recorded_content_ref','source_lineage_refs','acquisition_delivery_refs','acquisition_times']
};

export class System22 {
  #state;
  #adapters;
  #busy = false;
  constructor({ configuration = emptyConfiguration(), adapters = createMockAdapters() } = {}) {
    this.#state = new System22State(configuration);
    this.#adapters = adapters;
  }
  get revision() { return this.#state.organization_event.length; }
  /** Trusted persistence boundary, not a player-facing query. */
  snapshot() { return clone(this.#state.toJSON()); }
  static restore(snapshot, adapters = createMockAdapters()) {
    canonical(snapshot);
    check(same(Object.keys(snapshot).sort(), Object.keys(SPEC).sort()), 'invalid_snapshot');
    const engine = new System22({configuration:snapshot.versioned_configuration, adapters});
    for (const event of snapshot.organization_event) {
      shape(event, SPEC.organization_event);
      const payload = unpack(event.payload_ref);
      check(payload && payload.revision === engine.revision + 1, 'invalid_event_log');
      check(event.id === `event:${digest({previous:engine.#state.organization_event.at(-1)?.id ?? null, command:payload.command})}`, 'invalid_event_log');
      for (const change of payload.changes) {
        check(change.table !== 'organization_event' && change.table !== 'versioned_configuration' && Object.hasOwn(SPEC,change.table), 'invalid_event_log');
        check(Number.isSafeInteger(change.index) && change.index >= 0 && change.index <= engine.#state[change.table].length, 'invalid_event_log');
        shape(change.record, SPEC[change.table]);
        engine.#state[change.table][change.index] = clone(change.record);
      }
      engine.#state.organization_event.push(clone(event));
    }
    check(same(engine.snapshot(), snapshot), 'snapshot_projection_mismatch');
    engine.#validateGraph(engine.#state);
    return engine;
  }
  #request(owner, operation, subject_ref, command, extra = {}) {
    check(OWNERS.includes(owner), 'unsupported_dependency');
    return {
      domain: DOMAIN, operation, subject_ref, actor_ref: command.actor_or_system_authority_ref,
      occurred_at: command.canonical_timestamp, correlation_id: command.correlation_id,
      idempotency_key: command.idempotency_key, expected_revision: command.expected_revision,
      policy_version: command.policy_version, cause_refs: command.causal_refs ?? [], ...clone(extra)
    };
  }
  #call(owner, request) {
    try {
      const response = this.#adapters[owner]?.(clone(request));
      check(plain(response) && response.owner === owner && response.request_ref === reference(request).id, 'invalid_dependency_receipt');
      check(['ok','pending','failed'].includes(response.status) && plain(response.data), 'invalid_dependency_receipt');
      canonical(response);
      return response;
    } catch { return {owner,request_ref:reference(request).id,status:'pending',data:{}}; }
  }
  #read(owner, operation, subject, command, expected = {}) {
    const response = this.#call(owner, this.#request(owner,operation,subject,command,{expectation:expected}));
    if (response.status !== 'ok') throw new Gate('dependency_pending', true);
    for (const [field,value] of Object.entries(expected)) check(same(response.data[field] ?? null,value), 'not_available');
    return response.data;
  }
  #actor(command) {
    const actor = this.#read('player','authenticate',command.actor_or_system_authority_ref,command);
    check(actor.actor_ref === command.actor_or_system_authority_ref && ['player','npc','system','administrator'].includes(actor.kind),'not_available');
    return actor;
  }
  #lookup(state, table, ref) {
    const id = refId(ref);
    const byId = state[table].find(record => record.id === id);
    if (byId) return byId;
    const match = typeof id === 'string' && id.match(/^([a-z_]+)\/(\d+)$/);
    return match && match[1] === table ? state[table][Number(match[2])] : undefined;
  }
  #policy(command) {
    const policy = this.#state.versioned_configuration.governance_procedures.find(item => item.id === command.procedure_ref && item.version === command.policy_version);
    check(policy && policy.operation === command.operation && Array.isArray(policy.actions) && Array.isArray(policy.requirements) && Array.isArray(policy.choice_requirements) && Array.isArray(policy.effects), 'policy_not_configured');
    return policy;
  }
  #scopeOf(state, table, record) {
    if (table === 'organization') return record.id;
    if (record.organization_id) return record.organization_id;
    if (table === 'role_assignment') return this.#lookup(state,'role_definition',record.role_id)?.organization_id;
    if (table === 'authority_details') return this.#lookup(state,'role_definition',record.role_ref)?.organization_id;
    if (table === 'affiliation_details') return this.#lookup(state,'affiliation',record.affiliation_ref)?.organization_id;
    if (table === 'agreement_details') {
      const agreement=this.#lookup(state,'agreement',record.agreement_ref);
      return agreement ? this.#scopeOf(state,'agreement',agreement) : undefined;
    }
    if (table === 'order_details') return this.#lookup(state,'commitment',record.commitment_ref) ? record.scope?.organization_id : undefined;
    for (const key of ['organization_scope','subject_scope','budget_scope','agenda_scope','decision_scope','scope','location_scope','holder_audience_scope']) {
      if (plain(record[key]) && record[key].organization_id) return record[key].organization_id;
    }
    const scoped = unpack(record.scope_ref) ?? unpack(record.authority_ref) ?? unpack(record.terms_ref) ?? unpack(record.objective_ref) ?? unpack(record.trigger_ref);
    if (scoped?.organization_id) return scoped.organization_id;
    if (table === 'crew_details') {
      return this.#lookup(state,'organization',record.organization_or_unit_ref)?.id ?? this.#lookup(state,'unit',record.organization_or_unit_ref)?.organization_id;
    }
    return undefined;
  }
  #directAuthority(state, actor, organization, permission, now) {
    for (const assignment of state.role_assignment) {
      if (assignment.holder_id !== actor || assignment.status !== 'active' || time(assignment.effective_from) > now ||
          (assignment.effective_to !== null && time(assignment.effective_to) <= now)) continue;
      const role = this.#lookup(state,'role_definition',assignment.role_id);
      if (role?.organization_id !== organization) continue;
      const permissions = unpack(role.permissions_ref);
      if (!Array.isArray(permissions)) continue;
      if (permissions.some(p => p.domain === DOMAIN && p.organization_id === organization && p.action === permission && Array.isArray(p.conditions) && p.conditions.length === 0)) return true;
    }
    return false;
  }
  #authority(state, actor, organization, permission, now, visited = new Set()) {
    if (visited.has(actor)) return false;
    const path = new Set([...visited,actor]);
    if (this.#directAuthority(state,actor,organization,permission,now)) return true;
    for (const grant of state.delegation) {
      if (grant.recipient_ref !== actor || grant.revocation_ref !== null || time(grant.expiry) <= now ||
          grant.scope.organization_id !== organization || !grant.scope.actions?.includes(permission) || grant.interrupt_conditions.length!==0) continue;
      if (this.#authority(state,grant.issuer_ref,organization,permission,now,path)) return true;
    }
    return false;
  }
  #choice(actor, subject, terms, choices, command) {
    const identity = this.#read('system9','identity',actor,command,{exists:true});
    check(typeof identity.is_player==='boolean','invalid_dependency_receipt');
    const owner = identity.is_player === true ? 'player' : 'npc';
    check(isRef(subject) && isRef(terms) && Array.isArray(choices) && choices.length>0,'policy_not_configured');
    let decision;
    try { decision=this.#read(owner,'decision',subject,command,{actor_ref:actor,subject_ref:subject,terms_ref:terms,explicit:true}); }
    catch (error) {
      if (!(error instanceof Gate) || !error.waiting || owner!=='player') throw error;
      const grant=this.#routineGrant(actor,subject,terms,command);
      if (!grant) throw error;
      decision=this.#read('npc','delegated_decision',subject,command,{
        actor_ref:actor,delegate_ref:command.actor_or_system_authority_ref,
        subject_ref:subject,terms_ref:terms,delegation_ref:reference(grant).id,explicit:true
      });
    }
    check(choices.includes(decision.choice),'choice_required');
    check(isRef(decision.decision_ref),'invalid_dependency_receipt');
    return decision;
  }
  #routineGrant(principal, subject, terms, command) {
    const policy=unpack(this.#state.versioned_configuration.routine_delegation_policy);
    if (command.operation!=='RecordRecipientDecision' || policy?.version!==command.policy_version || !policy.allowed_operations?.includes(command.operation)) return null;
    return this.#state.delegation.find(grant=>grant.issuer_ref===principal && grant.recipient_ref===command.actor_or_system_authority_ref && grant.revocation_ref===null &&
      time(grant.expiry)>time(command.canonical_timestamp) && grant.interrupt_conditions.length===0 &&
      grant.scope.actions.includes(command.operation) && grant.scope.subject_refs?.includes(refId(subject)) && grant.scope.terms_refs?.includes(refId(terms))) ?? null;
  }
  #acquired(holder, source, command) {
    const fact = this.#read('knowledge','acquisition',source,command,{holder_ref:holder,acquired:true});
    check(isRef(fact.source_lineage_ref) && isRef(fact.acquisition_ref),'invalid_dependency_receipt');
    time(fact.acquired_at);
    check(time(fact.acquired_at) <= time(command.canonical_timestamp),'not_available');
    return fact;
  }
  #validateGraph(state) {
    for (const [table,records] of Object.entries(state)) {
      if (table === 'versioned_configuration') continue;
      const ids = records.filter(r=>r.id).map(r=>r.id);
      check(ids.length === unique(ids).length,'duplicate_id');
      for (const record of records) shape(record,SPEC[table]);
    }
    for (const unit of state.unit) {
      check(this.#lookup(state,'organization',unit.organization_id),'invalid_reference');
      const seen = new Set([unit.id]);
      let parent = unit.parent_unit_id;
      while (parent !== null) {
        check(!seen.has(parent),'hierarchy_cycle'); seen.add(parent);
        const next = this.#lookup(state,'unit',parent);
        check(next && next.organization_id === unit.organization_id,'invalid_reference'); parent = next.parent_unit_id;
      }
    }
    for (const affiliation of state.affiliation) {
      check(this.#lookup(state,'organization',affiliation.organization_id),'invalid_reference');
      if (affiliation.unit_ref !== null) check(this.#lookup(state,'unit',affiliation.unit_ref)?.organization_id === affiliation.organization_id,'invalid_reference');
    }
    const currentAffiliations=state.affiliation.filter(a=>a.ends_at===null).map(a=>canonical([a.character_id,a.organization_id,a.unit_ref,a.category]));
    check(unique(currentAffiliations).length===currentAffiliations.length,'duplicate_affiliation');
    for (const role of state.role_definition) check(this.#lookup(state,'organization',role.organization_id),'invalid_reference');
    for (const assignment of state.role_assignment) check(this.#lookup(state,'role_definition',assignment.role_id),'invalid_reference');
    for (const details of state.order_details) check(this.#lookup(state,'commitment',details.commitment_ref),'invalid_reference');
  }
  #validateRecord(state, table, record, before, command, policy) {
    shape(record,SPEC[table]);
    const changed = field => !before || !same(before[field],record[field]);
    for (const field of IMMUTABLE[table] ?? []) if (before) check(!changed(field),'immutable_field');
    if (before && table === 'reputation_assessment') throw new Gate('append_only_assessment');
    for (const [start,end] of [['active_from','active_to'],['starts_at','ends_at'],['effective_from','effective_to']]) {
      if (record[start] !== undefined && record[end] !== null) check(time(record[end]) >= time(record[start]),'invalid_interval');
    }
    const organization = this.#scopeOf(state,table,record);
    const transitionScope=command.operation==='TransitionOrganization' ? policy.transition_scope ?? [policy.organization_id] : [policy.organization_id];
    check(transitionScope.includes(organization),'missing_mandate');
    if (table === 'organization') {
      check(TYPES.includes(record.type) && ['forming','active','dormant','dissolved'].includes(record.active_status),'invalid_state');
      const charter = state.versioned_configuration.charters.find(c=>c.version === record.charter_version && c.organization_id === record.id);
      check(charter && Array.isArray(charter.supporter_refs) && charter.supporter_refs.length > 0,'policy_not_configured');
      check(state.versioned_configuration.type_profiles.some(p=>p.type === record.type && p.version === command.policy_version),'policy_not_configured');
      if (!before) {
        check(['FoundOrganization','TransitionOrganization','CreateCrew'].includes(command.operation),'unsupported_transition');
        check(record.founded_event === command.event_ref,'invalid_provenance');
        for (const supporter of charter.supporter_refs) this.#choice(supporter,record.id,reference(charter).id,['accept'],command);
      } else if (changed('active_status')) {
        check(command.operation === 'TransitionOrganization','unsupported_transition');
        check(state.succession_transition.some(t=>t.source_successor_ids.includes(record.id) && t.approval_refs.length > 0),'unsupported_transition');
      }
      if (command.operation === 'RebrandOrganization') check(Object.keys(record).filter(changed).every(k=>k==='names_ref'),'unsupported_transition');
    }
    if (table === 'unit') {
      check(['CreateUnit','ReassignUnit','CloseUnit','CreateCrew'].includes(command.operation),'unsupported_transition');
      if (!before) check(record.active_to === null,'unsupported_transition');
    }
    if (table === 'affiliation') {
      check(CATEGORIES.includes(record.category),'invalid_state');
      this.#read('system9','identity',record.character_id,command,{exists:true});
      if (!before) {
        this.#choice(record.character_id,record.organization_id,policy.membership_terms_ref,['accept'],command);
        if (!['FoundOrganization','TransitionOrganization','CreateCrew'].includes(command.operation)) {
          check(state.recruitment.some(r=>r.applicant_ref === record.character_id && r.organization_scope.organization_id === record.organization_id && r.stage === 'approval' && r.approval_ref !== null),'approval_required');
        }
        if (record.category === 'employee') this.#read('system13','employment',record.character_id,command,{organization_id:record.organization_id,employed:true});
      }
    }
    if (table === 'affiliation_details') {
      const affiliation = this.#lookup(state,'affiliation',record.affiliation_ref); check(affiliation,'invalid_reference');
      for (const field of ['personal_allegiance_refs','obligation_refs']) {
        if (changed(field)) for (const ref of record[field].filter(r=>!before?.[field].some(old=>same(old,r)))) this.#choice(affiliation.character_id,ref,ref,['accept'],command);
      }
    }
    if (table === 'recruitment') {
      check(RECRUITMENT.includes(record.stage),'invalid_state');
      this.#read('system9','identity',record.applicant_ref,command,{exists:true});
      this.#read('knowledge','contact_route',record.contact_or_application_route_ref,command,{available:true});
      const step = RECRUITMENT.indexOf(record.stage), previous = before ? RECRUITMENT.indexOf(before.stage) : -1;
      check(step === previous || step === previous+1 || policy.recruitment_transitions?.some(t=>t.from===before?.stage && t.to===record.stage),'unsupported_transition');
      if (step > 0) check(record.delivery_refs.length > 0,'pending_delivery');
      const deliveries=record.delivery_refs.map(ref=>this.#read('system16','delivery',ref,command,{recipient_ref:record.applicant_ref,delivered:true}));
      if (step>=RECRUITMENT.indexOf('response')) check(deliveries.some(d=>same(d.content_ref,record.offered_terms_ref)),'pending_delivery');
      if (record.response_ref !== null && changed('response_ref')) {
        const decision = this.#choice(record.applicant_ref,`${table}/${state[table].indexOf(record)}`,record.offered_terms_ref,['accept','decline','defer'],command);
        check(same(decision.decision_ref,record.response_ref),'invalid_dependency_receipt');
        check(record.outcome === decision.choice,'invalid_state');
      }
      if (record.stage === 'approval') check(record.response_ref !== null && before?.outcome === 'accept' && record.approval_ref !== null,'choice_required');
      if (before?.response_ref !== null && before?.response_ref !== undefined && changed('offered_terms_ref')) throw new Gate('new_offer_required');
      for (const source of record.qualification_source_refs) this.#acquired(command.actor_or_system_authority_ref,source,command);
      for (const resolution of record.assessment_result_refs) this.#read('system10','resolution',resolution,command,{stored:true,subject_ref:record.applicant_ref});
    }
    if (table === 'role_definition') {
      const permissions = unpack(record.permissions_ref);
      check(Array.isArray(permissions) && permissions.every(p=>p.domain === DOMAIN && p.organization_id === organization && typeof p.action === 'string' && Array.isArray(p.conditions)),'invalid_permission');
      const charter = state.versioned_configuration.charters.find(c=>c.organization_id === organization && c.version === command.policy_version);
      check(charter && Array.isArray(charter.role_definitions) && charter.role_definitions.some(r=>same(r,record)),'policy_not_configured');
    }
    if (table === 'role_assignment') {
      const role=this.#lookup(state,'role_definition',record.role_id);
      const appointment=state.versioned_configuration.appointment_removal_procedures.find(p=>p.id===refId(role?.appointment_policy) && p.version===command.policy_version);
      check(appointment && Number.isSafeInteger(appointment.max_active_holders) && appointment.max_active_holders>0,'policy_not_configured');
      if (record.status==='active') {
        const overlaps=state.role_assignment.filter(a=>a.role_id===record.role_id && a.status==='active' && time(a.effective_from)<(record.effective_to===null?Infinity:time(record.effective_to)) && time(record.effective_from)<(a.effective_to===null?Infinity:time(a.effective_to)));
        check(overlaps.length<=appointment.max_active_holders && overlaps.filter(a=>a.holder_id===record.holder_id).length===1,'appointment_conflict');
      }
      this.#read('system9','identity',record.holder_id,command,{exists:true});
      if (!before) {
        check(record.status === 'active' && record.appointment_event === command.event_ref,'invalid_provenance');
        this.#choice(record.holder_id,record.role_id,reference({effective_from:record.effective_from,effective_to:record.effective_to}).id,['accept'],command);
      }
      if (before && before.status !== 'active') check(record.status === before.status,'new_appointment_required');
    }
    if (table === 'delegation') {
      check(record.scope.organization_id === organization && Array.isArray(record.scope.actions) && record.scope.actions.length > 0,'invalid_permission');
      check(time(record.expiry) > time(command.canonical_timestamp) || record.revocation_ref !== null,'expired_delegation');
      if (!before) {
        check(record.issuer_ref === command.actor_or_system_authority_ref,'missing_mandate');
        for (const action of record.scope.actions) check(this.#authority(this.#state,record.issuer_ref,organization,action,time(command.canonical_timestamp)),'missing_mandate');
        // Chained delegation requires the issuer's existing grant to allow it.
        const direct = record.scope.actions.every(action=>this.#directAuthority(this.#state,record.issuer_ref,organization,action,time(command.canonical_timestamp)));
        if (!direct) {
          const parent = this.#state.delegation.find(d=>d.recipient_ref === record.issuer_ref && d.scope.organization_id === organization && d.revocation_ref === null && time(d.expiry)>=time(record.expiry) && unpack(d.further_delegation_policy)?.allowed === true && record.scope.actions.every(a=>d.scope.actions.includes(a)));
          check(parent,'missing_mandate');
          for (const [resource,limit] of Object.entries(record.resource_limits)) check(Number.isFinite(limit) && limit>=0 && Number.isFinite(parent.resource_limits[resource]) && limit<=parent.resource_limits[resource],'missing_mandate');
        }
        this.#choice(record.recipient_ref,record.purpose_ref,reference({scope:record.scope,expiry:record.expiry,resource_limits:record.resource_limits}).id,['accept'],command);
      } else if (before.revocation_ref !== null) check(same(before,record),'revocation_is_final');
    }
    if (table === 'governance') this.#governance(record,before,command);
    if (table === 'commitment') this.#commitment(state,record,before,command);
    if (table === 'order_details') this.#orders(state,record,before,command);
    if (table === 'resource_coordination') {
      check(record.authorized_controller_refs.includes(command.actor_or_system_authority_ref),'missing_mandate');
      for (const ref of record.owner_account_asset_worker_service_refs) this.#read('knowledge','resource_reference',ref,command,{known:true});
      for (const ref of record.reservation_refs) this.#reservation(ref,command);
      for (const ref of record.transfer_consumption_release_refs) this.#ownerReceipt(ref,command);
    }
    if (table === 'premises_services') {
      for (const place of record.place_room_refs) this.#read('system12','place',place,command,{exists:true});
      if (command.operation === 'RequestService') this.#read('system13','service_feasibility',reference(record).id,command,{feasible:true,actual_provider:true,capacity_reserved:true});
    }
    if (table === 'claim') {
      check(state.versioned_configuration.claim_categories.some(c=>c.type===record.type && c.version===command.policy_version),'policy_not_configured');
      this.#read('system12','place_scope',reference(record.location_scope).id,command,{exists:true});
      this.#acquired(command.actor_or_system_authority_ref,record.basis_ref,command);
    }
    if (table === 'agreement') {
      const parties = unpack(record.parties_ref); check(Array.isArray(parties) && parties.length>=2,'invalid_parties');
      if (before && changed('terms_ref')) check(record.status !== 'active','new_acceptance_required');
      if (record.status === 'active') {
        const details = state.agreement_details.find(d=>same(d.agreement_ref,record.id));
        check(details && details.acceptance_delivery_refs.length>=parties.length,'pending_delivery');
        for (const party of parties) {
          const acceptance = this.#read('system16','agreement_acceptance',record.id,command,{party_ref:party,terms_ref:record.terms_ref,delivered:true});
          check(record.approval_refs.some(ref=>same(ref,acceptance.approval_ref)),'approval_required');
          check(this.#authority(this.#state,acceptance.representative_ref,party,'ApproveAgreement',time(command.canonical_timestamp)),'missing_mandate');
        }
      }
    }
    if (table === 'dispute_response') {
      check(CONFLICT.includes(record.conflict_state),'invalid_state');
      check(record.originating_event_refs.length>0,'invalid_provenance');
      for (const source of [...record.originating_event_refs,...record.target_basis_refs]) this.#acquired(record.decision_maker_ref,source,command);
      if (command.operation === 'ChooseResponse') {
        this.#choice(record.decision_maker_ref,record.objective_ref,record.objective_ref,['accept'],command);
        const objective = unpack(record.objective_ref);
        check(objective && ['clarify','negotiate','withhold_cooperation','support','physical_conflict'].includes(objective.kind),'unsupported_transition');
        if (objective.kind === 'physical_conflict') {
          check(unpack(state.versioned_configuration.content_policy)?.physical_conflict === true,'content_policy_denied');
          check(record.target_basis_refs.length>0,'not_available');
          this.#read('system19','feasibility',record.objective_ref,command,{feasible:true,actual_actors:true,access:true});
        }
      }
    }
    if (table === 'discipline') {
      check(record.reviewer_ref===command.actor_or_system_authority_ref || this.#authority(this.#state,record.reviewer_ref,organization,policy.permission,time(command.canonical_timestamp)),'missing_mandate');
      check(record.allegation_source_refs.length>0,'invalid_provenance');
      for (const source of [...record.allegation_source_refs,...record.acquired_material_refs]) this.#acquired(record.reviewer_ref,source,command);
      if (record.response_ref !== null && changed('response_ref')) this.#read('player','supplied_response',record.response_ref,command,{explicit:true});
      if (command.operation === 'DecideDiscipline') {
        check(policy.discipline && typeof policy.discipline.requires_response==='boolean' && policy.discipline.rule_refs?.some(ref=>same(ref,record.applicable_rule_ref)),'policy_not_configured');
        this.#read('system16','response_opportunity',record.applicable_rule_ref,command,{delivered:true});
        if (policy.discipline.requires_response && record.response_ref===null) throw new Gate('choice_required',true);
        check(record.decision_reason_refs.length>0,'reason_required');
      }
    }
    if (table === 'succession_transition') {
      check(TRANSITIONS.includes(record.transition_kind) || ['succession','absence','vacancy','interim','unresolved'].includes(record.transition_kind),'invalid_state');
      check(record.trigger_acquisition_refs.length>0,'pending_delivery');
      this.#acquired(command.actor_or_system_authority_ref,record.trigger_ref,command);
      if (['split','merger','reformation'].includes(record.transition_kind)) check(record.lineage_id_mapping_refs.length>0,'lineage_required');
      for (const mapping of record.lineage_id_mapping_refs) {
        const entry=unpack(mapping);
        check(entry && record.source_successor_ids.includes(entry.source_id) && record.source_successor_ids.includes(entry.successor_id) && this.#lookup(this.#state,'organization',entry.source_id) && this.#lookup(state,'organization',entry.successor_id),'lineage_required');
      }
      if (before) check(before.unresolved_commitment_refs.every(ref=>record.unresolved_commitment_refs.some(r=>same(r,ref))),'history_is_immutable');
      for (const ref of record.authority_access_resource_transfer_refs) this.#ownerReceipt(ref,command);
      if (record.status === 'completed') check(record.approval_refs.length>0,'approval_required');
    }
    if (table === 'crew_details') {
      check(record.completion_stop_conditions.length>0,'policy_not_configured');
      check(time(record.time_window.end)>=time(record.time_window.start),'invalid_interval');
      const materialFields=['objective_ref','completion_stop_conditions','task_role_skill_requirement_refs','time_window','communication_scope','exit_expiry_policy'];
      if (!before || materialFields.some(changed)) {
        check(record.participation_decision_refs.length>0,'choice_required');
        const terms=reference(Object.fromEntries(materialFields.map(field=>[field,record[field]]))).id;
        for (const decision of record.participation_decision_refs) {
          const facts = this.#read('npc','participation',decision,command,{objective_ref:record.objective_ref,explicit:true});
          this.#choice(facts.actor_ref,record.organization_or_unit_ref,terms,['accept'],command);
        }
      }
      for (const ref of record.resource_reservation_refs) this.#reservation(ref,command);
    }
    if (table === 'reputation_assessment') this.#assessment(state,record,command,policy);
    if (table === 'assessment_information_provenance') {
      check(record.source_lineage_refs.length === unique(record.source_lineage_refs.map(refId)).length,'duplicate_source_lineage');
      check(record.acquisition_delivery_refs.length===record.acquisition_times.length,'invalid_provenance');
      for (const at of record.acquisition_times) check(time(at)<=time(command.canonical_timestamp),'invalid_provenance');
      const holder = record.holder_audience_scope.holder_ref;
      check(typeof holder==='string','invalid_scope');
      const facts = this.#acquired(holder,record.recorded_content_ref,command);
      check(record.source_lineage_refs.some(ref=>same(ref,facts.source_lineage_ref)),'invalid_provenance');
    }
  }

  #governance(record, before, command) {
    const procedure = this.#state.versioned_configuration.governance_procedures.find(p=>p.id===refId(record.procedure_ref) && p.version===command.policy_version);
    const rules = procedure?.governance;
    check(rules && Number.isSafeInteger(rules.quorum) && rules.quorum>0 && Number.isSafeInteger(rules.approval_count) && rules.approval_count>0 && Array.isArray(rules.eligible_refs) && Array.isArray(rules.required_voter_refs),'policy_not_configured');
    check(same(record.quorum_approval_counting_rules,reference(rules)),'policy_not_configured');
    check(same(record.eligible_participant_refs,rules.eligible_refs),'invalid_participants');
    check(unique(record.actual_participant_refs).length===record.actual_participant_refs.length,'duplicate_participant');
    const votes = new Map();
    for (const participant of record.actual_participant_refs) {
      check(record.eligible_participant_refs.includes(participant),'invalid_participants');
      this.#read('system16','meeting_notice',record.proposal_ref,command,{recipient_ref:participant,delivered:true});
      this.#read('system11','attendance',record.proposal_ref,command,{participant_ref:participant,attended:true,interval:record.scheduled_interval});
      if (record.outcome_ref !== null) {
        const vote = this.#choice(participant,record.proposal_ref,reference(record.amendment_refs).id,['approve','reject','abstain'],command);
        check(record.participant_decision_refs.some(ref=>same(ref,vote.decision_ref)),'choice_required');
        votes.set(participant,vote.choice);
      }
    }
    if (record.outcome_ref !== null && (!before || !same(before.outcome_ref,record.outcome_ref))) {
      check(record.actual_participant_refs.length>=rules.quorum,'quorum_not_met');
      check(rules.required_voter_refs.every(actor=>votes.has(actor)),'choice_required');
      const approved = [...votes.values()].filter(v=>v==='approve').length>=rules.approval_count;
      check(same(record.outcome_ref,reference({proposal_ref:record.proposal_ref,approved})),'invalid_governance_outcome');
    }
  }
  #reservation(ref, command) {
    const descriptor = unpack(ref);
    check(descriptor && RESOURCE_OWNERS.includes(descriptor.owner) && isRef(descriptor.reservation_ref),'invalid_reference');
    this.#read(descriptor.owner,'reservation',descriptor.reservation_ref,command,{valid:true,compatible:true});
  }
  #ownerReceipt(ref, command) {
    const descriptor = unpack(ref);
    check(descriptor && OWNERS.includes(descriptor.owner) && isRef(descriptor.receipt_ref),'invalid_reference');
    this.#read(descriptor.owner,'effect_receipt',descriptor.receipt_ref,command,{committed:true});
  }
  #orders(state, record, before, command) {
    const commitment = this.#lookup(state,'commitment',record.commitment_ref);
    check(commitment,'invalid_reference');
    const recipients = unpack(commitment.recipients_ref);
    check(Array.isArray(recipients) && recipients.length>0 && unique(recipients).length===recipients.length,'invalid_recipients');
    check(same(record.recipient_states.map(r=>r.recipient_ref).sort(),[...recipients].sort()),'invalid_recipients');
    for (const recipient of record.recipient_states) {
      shape(recipient,RECIPIENT);
      const previous = before?.recipient_states.find(r=>r.recipient_ref===recipient.recipient_ref);
      this.#read('system9','identity',recipient.recipient_ref,command,{exists:true});
      for (const delivery of recipient.delivery_refs) {
        this.#read('system16','delivery',delivery,command,{recipient_ref:recipient.recipient_ref,content_ref:commitment.objective_ref,delivered:true,instruction_version:recipient.acquired_instruction_version});
      }
      if (recipient.delivery_refs.length===0) check(recipient.acquired_instruction_version===null && recipient.decision_ref===null && recipient.task_ref===null && recipient.outcome_ref===null,'pending_delivery');
      if (recipient.decision_ref!==null && (!previous || !same(recipient.decision_ref,previous.decision_ref))) {
        check(recipient.delivery_refs.length>0,'pending_delivery');
        const decision = this.#choice(recipient.recipient_ref,commitment.id,commitment.objective_ref,['accept','decline','defer'],command);
        check(same(decision.decision_ref,recipient.decision_ref),'choice_required');
      }
      if (recipient.task_ref!==null) {
        const decision = this.#read('knowledge','decision_record',recipient.decision_ref,command,{actor_ref:recipient.recipient_ref,subject_ref:commitment.id,terms_ref:commitment.objective_ref,choice:'accept',explicit:true});
        check(decision,'choice_required');
        this.#read('system13','task',recipient.task_ref,command,{actor_ref:recipient.recipient_ref,commitment_ref:commitment.id,capacity_reserved:true,prerequisites_satisfied:true});
        for (const reservation of recipient.reservation_refs) this.#reservation(reservation,command);
      }
      if (recipient.outcome_ref!==null) {
        check(recipient.task_ref!==null,'unsupported_transition');
        this.#read('system13','task_outcome',recipient.outcome_ref,command,{task_ref:recipient.task_ref,committed:true});
      }
      for (const cancellation of recipient.cancellation_delivery_refs) this.#read('system16','cancellation_delivery',cancellation,command,{recipient_ref:recipient.recipient_ref,commitment_ref:commitment.id,delivered:true});
      if (previous) {
        for (const field of ['delivery_refs','cancellation_delivery_refs']) check(previous[field].every(ref=>recipient[field].some(r=>same(r,ref))),'history_is_immutable');
        if (previous.outcome_ref!==null) check(same(previous.outcome_ref,recipient.outcome_ref),'history_is_immutable');
        if (previous.task_ref!==null) check(same(previous.task_ref,recipient.task_ref),'history_is_immutable');
      }
    }
    if (before && !same(record.scope,before.scope)) throw new Gate('new_order_required');
    if (commitment.status==='draft_or_preview') check(record.recipient_states.every(r=>r.delivery_refs.length===0 && r.reservation_refs.length===0),'draft_has_no_effects');
  }
  #commitment(state, record, before, command) {
    check(ORDER.includes(record.status),'invalid_state');
    const transitions = {
      draft_or_preview:['issued','cancelled'], issued:['delivered','cancelled'],
      delivered:['accepted','declined','cancelled'], accepted:['active','cancelled'],
      active:['completed','failed','cancelled'], declined:[], completed:[], failed:[], cancelled:[]
    };
    if (!before) check(record.status==='draft_or_preview','unsupported_transition');
    else if (before.status!==record.status) check(transitions[before.status].includes(record.status),'unsupported_transition');
    if (before) for (const field of ['objective_ref','recipients_ref','resources_ref','due_at']) {
      if (!same(record[field],before[field])) check(before.status==='draft_or_preview' && record.status==='draft_or_preview','new_order_required');
    }
    const details = state.order_details.find(r=>r.commitment_ref===record.id);
    check(details,'order_details_required');
    if (record.status==='issued' && before?.status!==record.status) {
      check(record.issuer_ref===command.actor_or_system_authority_ref,'missing_mandate');
      const validity = unpack(details.authority_validity_ref);
      check(validity && typeof validity.valid==='boolean','invalid_authority_evaluation');
      const valid = this.#authority(this.#state,record.issuer_ref,details.scope.organization_id,'IssueOrder',time(command.canonical_timestamp));
      check(validity.valid===valid,'invalid_authority_evaluation');
      if (!valid) check(validity.violation_recorded===true,'missing_mandate');
    }
    if (['delivered','accepted','declined','active','completed','failed'].includes(record.status)) check(details.recipient_states.some(r=>r.delivery_refs.length>0),'pending_delivery');
    if (['accepted','declined'].includes(record.status)) {
      const decisions = details.recipient_states.filter(r=>r.decision_ref!==null);
      check(decisions.length>0,'choice_required');
      for (const recipient of decisions) this.#read('knowledge','decision_record',recipient.decision_ref,command,{actor_ref:recipient.recipient_ref,subject_ref:record.id,terms_ref:record.objective_ref,choice:record.status==='accepted'?'accept':'decline',explicit:true});
    }
    if (record.status==='active') check(details.recipient_states.some(r=>r.task_ref!==null),'task_required');
    if (['completed','failed'].includes(record.status)) {
      check(details.recipient_states.every(r=>r.outcome_ref!==null),'task_result_required');
      const outcomes = details.recipient_states.map(r=>this.#read('system13','task_outcome',r.outcome_ref,command,{task_ref:r.task_ref,committed:true}).outcome);
      check(outcomes.every(v=>['completed','failed'].includes(v)),'invalid_task_outcome');
      check(record.status===(outcomes.every(v=>v==='completed')?'completed':'failed'),'invalid_task_outcome');
    }
  }
  #assessment(state, record, command, policy) {
    check(DIMENSIONS.includes(record.dimension) && ASSESSMENTS.includes(record.state),'invalid_state');
    if (record.dimension==='alignment_on_named_issue') check(typeof unpack(record.scope_ref)?.issue_ref==='string','issue_scope_required');
    const sources = record.source_refs.map(source=>this.#acquired(record.holder_ref,source,command));
    check(unique(sources.map(s=>refId(s.source_lineage_ref))).length===sources.length,'duplicate_source_lineage');
    if (sources.length===0) check(record.state==='unknown','unknown_is_unknown');
    else {
      const rule = policy.assessment;
      check(rule && ['review','correction','decay'].includes(rule.kind),'policy_not_configured');
      const facts = sources.map(source=>source.assessment_fact).filter(Boolean);
      // Exact authored cases, no hidden score, weighting, random roll or fallback.
      const matching = rule.cases?.filter(item=>same(item.facts,[...facts].sort()) && item.dimension===record.dimension);
      check(matching?.length===1 && ASSESSMENTS.includes(matching[0].state),'policy_not_configured');
      check(record.state===matching[0].state,'invalid_assessment');
      if (rule.kind==='decay') check(rule.version===command.policy_version,'policy_not_configured');
    }
    const prior = state.reputation_assessment.filter(r=>r!==record && r.holder_ref===record.holder_ref && r.target_ref===record.target_ref && same(r.scope_ref,record.scope_ref) && r.dimension===record.dimension);
    if (prior.length) {
      const previous = this.#lookup(state,'reputation_assessment',record.supersedes_id);
      check(previous && prior.includes(previous) && !prior.some(r=>r.supersedes_id===previous.id),'invalid_supersession');
    } else check(record.supersedes_id===null,'invalid_supersession');
    check(record.reviewed_at===command.canonical_timestamp,'invalid_provenance');
  }
  #plan(command, eventRef) {
    const policy = this.#policy(command);
    const actor = command.actor_or_system_authority_ref;
    const active = this.#lookup(this.#state,'organization',policy.organization_id);
    const permitted = OPERATIONS[command.operation];
    check(Array.isArray(permitted),'unsupported_transition');
    if (command.operation==='FoundOrganization') {
      check(policy.bootstrap===true && !active,'unsupported_transition');
      const charter = this.#state.versioned_configuration.charters.find(c=>c.organization_id===policy.organization_id && c.version===command.policy_version);
      check(charter?.supporter_refs.includes(actor),'missing_mandate');
    } else {
      check(active && ['forming','active'].includes(active.active_status) || (active && command.operation==='TransitionOrganization'),'not_available');
      const selfService=['RespondToOffer','RecordRecipientDecision','RespondToDiscipline','AcquireInformation','AssessReputation','ReviewReputation'].includes(command.operation);
      const receivingSystem=['RecordDelivery','CompleteOrder','FailOrder'].includes(command.operation) && policy.system_actor_refs?.includes(actor);
      if (!selfService && !receivingSystem) check(this.#authority(this.#state,actor,policy.organization_id,policy.permission,time(command.canonical_timestamp)),'missing_mandate');
      if (receivingSystem) check(command.effects?.length===0,'missing_mandate');
      if (!selfService && !receivingSystem && !this.#directAuthority(this.#state,actor,policy.organization_id,policy.permission,time(command.canonical_timestamp))) {
        const subjects=(command.changes??[]).map(c=>c.record.id??`${c.table}/${c.index??this.#state[c.table]?.length}`);
        check(this.#state.delegation.some(d=>d.recipient_ref===actor && d.revocation_ref===null && time(d.expiry)>time(command.canonical_timestamp) && d.interrupt_conditions.length===0 && d.scope.organization_id===policy.organization_id && d.scope.actions.includes(policy.permission) && (!d.scope.subject_refs || subjects.every(subject=>d.scope.subject_refs.includes(subject)))),'missing_mandate');
      }
      if (selfService) {
        check(command.effects?.length===0 && command.changes?.length>0,'unsupported_transition');
        for (const change of command.changes) {
          const old=Number.isSafeInteger(change.index)?this.#state[change.table]?.[change.index]:null;
          if (command.operation==='RespondToOffer') {
            check(change.table==='recruitment' && old?.applicant_ref===actor,'not_available');
            check(Object.keys(change.record).filter(k=>!same(old[k],change.record[k])).every(k=>['response_ref','outcome','stage'].includes(k)),'missing_mandate');
            check(change.record.stage==='response','unsupported_transition');
          } else if (command.operation==='RecordRecipientDecision') {
            check(change.table==='order_details' && old,'not_available');
            check(Object.keys(change.record).filter(k=>!same(old[k],change.record[k])).every(k=>k==='recipient_states'),'missing_mandate');
            for (const recipient of change.record.recipient_states) {
              const prior=old.recipient_states.find(r=>r.recipient_ref===recipient.recipient_ref);
              check(prior,'not_available');
              const order=this.#lookup(this.#state,'commitment',old.commitment_ref);
              const authorized=recipient.recipient_ref===actor || this.#routineGrant(recipient.recipient_ref,order.id,order.objective_ref,command);
              check(authorized?Object.keys(recipient).filter(k=>!same(prior[k],recipient[k])).every(k=>k==='decision_ref'):same(prior,recipient),'missing_mandate');
            }
          } else if (command.operation==='RespondToDiscipline') {
            check(change.table==='discipline' && old && unpack(old.applicable_rule_ref)?.subject_ref===actor,'not_available');
            check(Object.keys(change.record).filter(k=>!same(old[k],change.record[k])).every(k=>k==='response_ref'),'missing_mandate');
          } else {
            check(change.table==='reputation_assessment'?change.record.holder_ref===actor:change.table==='assessment_information_provenance' && change.record.holder_audience_scope.holder_ref===actor,'missing_mandate');
          }
        }
      }
    }
    if (command.operation==='AdministrativeCorrection') {
      check(command.correction?.scope===policy.organization_id && typeof command.correction.reason==='string' && command.correction.reason.trim().length>0 && command.causal_refs.length>0,'reason_required');
    }
    if (command.operation==='TransitionOrganization') {
      check(Array.isArray(policy.transition_scope) && policy.transition_scope.includes(policy.organization_id),'policy_not_configured');
      for (const id of policy.transition_scope) if (this.#lookup(this.#state,'organization',id)) check(this.#authority(this.#state,actor,id,policy.permission,time(command.canonical_timestamp)),'missing_mandate');
      const transition=command.changes?.find(c=>c.table==='succession_transition')?.record;
      check(transition && same([...transition.source_successor_ids].sort(),[...policy.transition_scope].sort()),'lineage_required');
    }
    for (const requirement of policy.requirements) {
      check(OWNERS.includes(requirement.domain) && plain(requirement.equals),'policy_not_configured');
      this.#read(requirement.domain,requirement.operation,requirement.subject_ref,command,requirement.equals);
    }
    for (const requirement of policy.choice_requirements) this.#choice(requirement.actor_ref,requirement.subject_ref,requirement.terms_ref,requirement.choices,command);
    check(Array.isArray(command.changes) && Array.isArray(command.effects),'invalid_command');
    const draft = new System22State(this.#state.versioned_configuration);
    Object.assign(draft,this.snapshot());
    const changes = [], seen = new Set();
    for (const proposal of command.changes) {
      check(plain(proposal) && Object.keys(proposal).every(k=>['table','index','record'].includes(k)),'invalid_command');
      const {table} = proposal;
      check(permitted.includes(table),'unsupported_transition');
      const index = proposal.index ?? draft[table].length;
      check(Number.isSafeInteger(index) && index>=0 && index<=draft[table].length,'not_available');
      const before = draft[table][index];
      check(!seen.has(`${table}/${index}`),'duplicate_change'); seen.add(`${table}/${index}`);
      const record = clone(proposal.record);
      for (const field of ['founded_event','appointment_event']) if (record[field]==='$event') record[field]=eventRef;
      shape(record,SPEC[table]);
      const changed = Object.keys(record).filter(key=>!before || !same(record[key],before[key]));
      const action = policy.actions.find(a=>a.table===table && a.mode===(before?'update':'create') && changed.every(field=>a.fields.includes(field)));
      check(action,'unsupported_transition');
      for (const [field,value] of Object.entries(action.from ?? {})) check(before && same(before[field],value),'unsupported_transition');
      for (const [field,value] of Object.entries(action.to ?? {})) check(same(record[field],value),'unsupported_transition');
      draft[table][index]=record;
      changes.push({table,index,record,before});
    }
    const contextual = {...command,event_ref:eventRef};
    for (const change of changes) this.#validateRecord(draft,change.table,change.record,change.before,contextual,policy);
    this.#validateGraph(draft);
    // A reservation reference cannot be independently consumed by two tasks.
    const reservationTasks = new Map();
    for (const details of draft.order_details) for (const recipient of details.recipient_states) {
      if (recipient.task_ref===null || recipient.outcome_ref!==null) continue;
      for (const reservation of recipient.reservation_refs) {
        const id = refId(reservation), task = refId(recipient.task_ref);
        check(!reservationTasks.has(id) || reservationTasks.get(id)===task,'incompatible_reservation');
        reservationTasks.set(id,task);
      }
    }
    const effects = command.effects.map((effect,index)=>{
      check(plain(effect) && Object.keys(effect).every(k=>['domain','operation','subject_ref','payload'].includes(k)),'invalid_effect');
      check(policy.effects.some(e=>e.domain===effect.domain && e.operation===effect.operation && e.organization_id===policy.organization_id),'missing_mandate');
      check(OWNERS.includes(effect.domain) && isRef(effect.subject_ref) && plain(effect.payload),'invalid_effect');
      if (command.operation==='DraftOrder') throw new Gate('draft_has_no_effects');
      if (!this.#directAuthority(this.#state,actor,policy.organization_id,policy.permission,time(command.canonical_timestamp))) {
        const grant=this.#state.delegation.find(d=>d.recipient_ref===actor && d.scope.organization_id===policy.organization_id && d.scope.actions.includes(policy.permission) && d.revocation_ref===null && time(d.expiry)>time(command.canonical_timestamp) && (!d.scope.subject_refs || d.scope.subject_refs.includes(effect.subject_ref)));
        check(grant,'missing_mandate');
        if (RESOURCE_OWNERS.includes(effect.domain)) {
          check(unpack(grant.further_delegation_policy)?.limit_basis==='per_command' && Array.isArray(effect.payload.allocations),'policy_not_configured');
          const totals=new Map();
          for (const pendingEffect of command.effects.filter(e=>RESOURCE_OWNERS.includes(e.domain))) {
            check(Array.isArray(pendingEffect.payload.allocations),'invalid_effect');
            for (const allocation of pendingEffect.payload.allocations) {
              check(typeof allocation.resource_ref==='string' && Number.isFinite(allocation.quantity) && allocation.quantity>=0,'invalid_effect');
              totals.set(allocation.resource_ref,(totals.get(allocation.resource_ref)??0)+allocation.quantity);
            }
          }
          for (const [resource,total] of totals) check(Object.hasOwn(grant.resource_limits,resource) && Number.isFinite(grant.resource_limits[resource]) && total<=grant.resource_limits[resource],'resource_limit_exceeded');
        }
      }
      // Owner authorization, feasibility, and exclusive reservations are never
      // replaced by a local balance, inventory or scheduling simulation.
      return reference({kind:'effect',owner:effect.domain,permission:policy.permission,organization_id:policy.organization_id,request:this.#request(effect.domain,effect.operation,effect.subject_ref,command,{
        payload:effect.payload,organization_id:policy.organization_id,
        idempotency_key:`${command.idempotency_key}:effect:${index}`
      })});
    });
    return {changes:changes.map(({before,...change})=>change),effects,policy};
  }
  #workflow(command, pending = [], reason = null) {
    return {
      actor_or_system_authority_ref:command.actor_or_system_authority_ref,
      expected_revision:command.expected_revision,canonical_timestamp:command.canonical_timestamp,
      correlation_id:command.correlation_id,idempotency_key:command.idempotency_key,
      current_revision:this.revision+1,causal_refs:clone(command.causal_refs),policy_version:command.policy_version,
      completed_step_refs:[],pending_step_refs:clone(pending),stored_resolution_refs:[],reservation_refs:[],
      choice_or_dependency_wait_ref:reason ? reference({reason}) : null,next_review_at:null,failure_reason:reason
    };
  }
  #commit(command, changes, status) {
    const payload = {revision:this.revision+1,command:clone(command),changes:clone(changes),status};
    const event = {
      id:`event:${digest({previous:this.#state.organization_event.at(-1)?.id ?? null,command})}`,
      occurred_at:command.canonical_timestamp,processed_at:command.canonical_timestamp,
      actor_ref:command.actor_or_system_authority_ref,cause_ref:reference(command.causal_refs),
      policy_version:command.policy_version,payload_ref:reference(payload),idempotency_key:command.idempotency_key
    };
    for (const change of changes) this.#state[change.table][change.index]=clone(change.record);
    this.#state.organization_event.push(event);
    return {ok:true,status,revision:this.revision,event_ref:event.id};
  }
  #resume(command) {
    check(Number.isSafeInteger(command.workflow_index),'invalid_command');
    const previous = this.#state.command_and_durable_workflow[command.workflow_index];
    check(previous && previous.actor_or_system_authority_ref===command.actor_or_system_authority_ref,'not_available');
    const workflow = clone(previous), pending = workflow.pending_step_refs[0];
    check(pending,'unsupported_transition');
    const item = unpack(pending); check(item,'invalid_reference');
    const changes = [];
    if (item.kind==='proposal') {
      const resumed = {...item.command,expected_revision:command.expected_revision,canonical_timestamp:command.canonical_timestamp};
      const eventRef = `event:${digest({previous:this.#state.organization_event.at(-1)?.id ?? null,command})}`;
      try {
        const plan = this.#plan(resumed,eventRef);
        changes.push(...plan.changes);
        workflow.pending_step_refs=[...plan.effects,...workflow.pending_step_refs.slice(1)];
        workflow.completed_step_refs.push(reference({proposal_ref:pending.id,event_ref:eventRef}));
        workflow.failure_reason=null;
      } catch (error) {
        if (!(error instanceof Gate)) throw error;
        workflow.failure_reason=error.waiting ? error.code : 'not_available';
      }
    } else if (item.kind==='effect') {
      // The exact original request and key survive retries. The adapter contract
      // owns idempotent execution. Never undo a confirmed external effect.
      const organization=this.#lookup(this.#state,'organization',item.organization_id);
      const original=this.#state.organization_event.find(e=>e.idempotency_key===workflow.idempotency_key);
      const disposition=unpack(original?.payload_ref)?.command.operation==='TransitionOrganization';
      const authorized=(['forming','active'].includes(organization?.active_status)||disposition) && this.#authority(this.#state,command.actor_or_system_authority_ref,item.organization_id,item.permission,time(command.canonical_timestamp));
      const response = authorized ? this.#call(item.owner,item.request) : {status:'failed'};
      if (response.status==='ok' && response.data.committed===true && isRef(response.data.receipt_ref)) {
        const receipt = reference({request_ref:pending.id,response});
        workflow.completed_step_refs.push(receipt);
        workflow.stored_resolution_refs.push(receipt);
        workflow.pending_step_refs.shift();
        workflow.failure_reason=null;
      } else workflow.failure_reason=response.status==='failed'?'dependency_failed':'dependency_pending';
    } else throw new Gate('unsupported_transition');
    workflow.current_revision=this.revision+1;
    workflow.choice_or_dependency_wait_ref=workflow.pending_step_refs.length ? reference({reason:workflow.failure_reason ?? 'dependency_pending'}) : null;
    changes.push({table:'command_and_durable_workflow',index:command.workflow_index,record:workflow});
    return {...this.#commit(command,changes,workflow.pending_step_refs.length?'pending':'committed'),workflow_ref:`command_and_durable_workflow/${command.workflow_index}`};
  }
  /** @param {TransitionCommand} input @returns {JsonObject} */
  step(input) {
    if (this.#busy) return {ok:false,error:'busy'};
    this.#busy=true;
    try {
      canonical(input); check(plain(input),'invalid_command');
      const command = clone(input);
      for (const key of ['operation','actor_or_system_authority_ref','correlation_id','idempotency_key','policy_version']) check(typeof command[key]==='string' && command[key].length>0,'invalid_command');
      check(Number.isSafeInteger(command.expected_revision) && command.expected_revision>=0 && Array.isArray(command.causal_refs) && command.causal_refs.length>0 && command.causal_refs.every(isRef),'invalid_command');
      time(command.canonical_timestamp);
      this.#actor(command);
      const prior = this.#state.organization_event.find(event=>event.idempotency_key===command.idempotency_key);
      if (prior) {
        check(same(unpack(prior.payload_ref).command,command),'idempotency_conflict');
        const workflow=unpack(prior.payload_ref).changes.find(change=>change.table==='command_and_durable_workflow');
        return {ok:true,status:unpack(prior.payload_ref).status,revision:unpack(prior.payload_ref).revision,event_ref:prior.id,workflow_ref:`command_and_durable_workflow/${workflow.index}`};
      }
      check(command.expected_revision===this.revision,'stale_revision');
      this.#read('system11','clock','canonical_time',command,{now:command.canonical_timestamp});
      if (this.#state.organization_event.length) check(time(command.canonical_timestamp)>=time(this.#state.organization_event.at(-1).occurred_at),'invalid_time');
      if (command.operation==='ResumeWorkflow') return this.#resume(command);
      const eventRef = `event:${digest({previous:this.#state.organization_event.at(-1)?.id ?? null,command})}`;
      let plan;
      try { plan=this.#plan(command,eventRef); }
      catch (error) {
        if (!(error instanceof Gate) || !error.waiting) throw error;
        // Only authenticated, revision-checked commands become pending proposals.
        const workflow=this.#workflow(command,[reference({kind:'proposal',command})],error.code);
        const index=this.#state.command_and_durable_workflow.length;
        return {...this.#commit(command,[{table:'command_and_durable_workflow',index,record:workflow}],'pending'),workflow_ref:`command_and_durable_workflow/${index}`};
      }
      const index=this.#state.command_and_durable_workflow.length;
      const workflow=this.#workflow(command,plan.effects,plan.effects.length?'dependency_pending':null);
      if (plan.policy.review) {
        check(typeof plan.policy.review.next_review_at==='string','policy_not_configured');
        check(time(plan.policy.review.next_review_at)>=time(command.canonical_timestamp),'invalid_time');
        workflow.next_review_at=plan.policy.review.next_review_at;
      }
      plan.changes.push({table:'command_and_durable_workflow',index,record:workflow});
      return {...this.#commit(command,plan.changes,plan.effects.length?'pending':'committed'),workflow_ref:`command_and_durable_workflow/${index}`};
    } catch (error) {
      // Validation failures cannot reveal whether a hidden target exists.
      const exposed=['invalid_json','invalid_command','invalid_time','stale_revision','idempotency_conflict','policy_not_configured'];
      return {ok:false,error:error instanceof Gate && exposed.includes(error.code)?error.code:'not_available'};
    } finally { this.#busy=false; }
  }
  /** Actor-visible fields require BOTH current permission and actual acquisition. */
  query(input) {
    try {
      canonical(input); const command=clone(input); this.#actor(command);
      const tables={GetKnownOrganization:'organization',GetKnownAffiliations:'affiliation',GetAvailableRoleActions:'role_definition',GetDeliveredOrders:'commitment',GetKnownClaims:'claim',GetKnownReputation:'reputation_assessment'};
      const table=tables[command.operation]; check(table,'not_available');
      const results=[];
      for (let index=0;index<this.#state[table].length;index++) {
        const record=this.#state[table][index], ref=record.id ?? `${table}/${index}`;
        if (command.subject_ref!==undefined && command.subject_ref!==ref) continue;
        const reply=this.#call('knowledge',this.#request('knowledge','visible_fields',ref,command));
        if (reply.status!=='ok' || reply.data.holder_ref!==command.actor_or_system_authority_ref || reply.data.permitted!==true || reply.data.acquired!==true || !Array.isArray(reply.data.fields)) continue;
        if (table==='role_definition' && !this.#state.role_assignment.some(a=>a.role_id===record.id && a.holder_id===command.actor_or_system_authority_ref && a.status==='active' && time(a.effective_from)<=time(command.canonical_timestamp) && (a.effective_to===null || time(a.effective_to)>time(command.canonical_timestamp)))) continue;
        if (table==='commitment') {
          const recipient=this.#state.order_details.find(d=>d.commitment_ref===record.id)?.recipient_states.find(r=>r.recipient_ref===command.actor_or_system_authority_ref);
          if (!recipient?.delivery_refs.length) continue;
        }
        // The dependency supplies the acquired version, which can be stale. Reading
        // the current canonical row here would silently disclose later changes.
        if (!plain(reply.data.values)) continue;
        const visible=Object.fromEntries(reply.data.fields.filter(field=>Object.hasOwn(record,field) && Object.hasOwn(reply.data.values,field)).map(field=>[field,clone(reply.data.values[field])]));
        if (table==='role_definition') {
          visible.actions=reply.data.values.permissions_ref!==undefined && same(reply.data.values.permissions_ref,record.permissions_ref)
            ? (unpack(record.permissions_ref)??[]).filter(p=>p.domain===DOMAIN && p.organization_id===record.organization_id && p.conditions.length===0).map(p=>p.action)
            : [];
        }
        // Resolve opaque references only through the knowledge boundary; an inline
        // reference must never expose its embedded private event or terms payload.
        const redact=value=>Array.isArray(value)?value.map(redact):plain(value)?(isRef(value)?value.id:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v)]))):value;
        results.push(redact(visible));
      }
      return {ok:true,records:results};
    } catch { return {ok:false,error:'not_available'}; }
  }
  /**
   * Bounded scheduler input is a supplied sequence of ordinary commands. It never
   * manufactures NPC choices, player responses, workers, or events. Equal-time
   * ordering must be supplied explicitly by the canonical scheduling adapter.
   */
  catchUp(commands) {
    try {
      check(Array.isArray(commands),'invalid_command');
      for (let i=1;i<commands.length;i++) check(time(commands[i-1].canonical_timestamp)<=time(commands[i].canonical_timestamp),'invalid_time');
      const results=[];
      for (const command of commands) {
        const authorization=this.#read('system11','due_command',command.idempotency_key,command,{due:true,sequence_authorized:true});
        check(authorization,'not_available');
        const result=this.step(command); results.push(result);
        if (!result.ok || result.status==='pending') return {ok:true,status:'stopped',results};
      }
      return {ok:true,status:'caught_up',results};
    } catch { return {ok:false,error:'not_available'}; }
  }
}

/** Stateless hosting contract; adapters remain fixed dummy-JSON placeholders. */
export function main({snapshot=null,configuration=emptyConfiguration(),command,fixtures={}}) {
  try {
    const adapters=createMockAdapters(fixtures);
    const engine=snapshot===null?new System22({configuration,adapters}):System22.restore(snapshot,adapters);
    const result=typeof command?.operation==='string' && command.operation.startsWith('Get')?engine.query(command):engine.step(command);
    // snapshot is for the trusted host/persistence boundary, never player narration.
    return {result,snapshot:engine.snapshot()};
  } catch { return {result:{ok:false,error:'invalid_host_input'},snapshot:null}; }
}
