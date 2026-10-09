/**
 * Isolated System 9. All gameplay state uses the supplied architecture's names.
 *
 * Interface: await system.execute({ command: CommandEnvelope, payload: JSON }).
 * Dependencies are trusted constructor configuration; request JSON cannot replace
 * authorization, fabricate receipts, access snapshots, or call another system.
 *
 * The persistence boundary is deliberately a stub. A host must durably save the
 * supplied checkpoint before acknowledging it, and serialize instances for the
 * same lineage. Within one instance commands are serialized automatically.
 */
import {
  DOMAIN, VERSION, DEFAULTS, EVENTS, FIELDS, APPEARANCE_FIELDS, MULTIPLE_FIELDS,
  BIOGRAPHY_KINDS, Command, Request, State, Field, Scope, Claim, Kinship, Biography,
  GrantInput, Receipt, Development, Hook, Household, Generation, Definition,
  z, Json, Id, Interval, emptyState, clone, hash, stableId, canonical, parse,
  requireRule, IdentityError, bounds, intervalBounds, contains, overlaps,
  ageRange, topologicalOrder, manifestHash, ownerRequest, inWorldTimezone,
} from './contracts.mjs';
import { createMockDependencies } from './dependencies.mjs';
import {
  normalizeField, validateField, acceptedFields, birthFrom, validateSingleValues,
  validateBiography, validateClaim, validateKinship, validateGrantRequest,
  validateDefinition, validateDescriptor, definitionRef, requireDelegation,
  safeObject, inertText, ageEligibility,
} from './validation.mjs';

export * from './contracts.mjs';
export * from './dependencies.mjs';
export { ageEligibility } from './validation.mjs';

const instances = new WeakMap();
const commandTimes = new WeakMap();
const READ_OPERATIONS = new Set(['project', 'preview', 'export_card', 'inspect', 'snapshot', 'age_eligibility']);
const EDITABLE = ['DRAFT', 'READY'];
const EMPTY = z.object({}).strict();
const FactCorrection = z.object({ fact_id: Id, field: Field, reason: z.string().min(1).max(2000), effective_time: z.string() }).strict();
const SNAPSHOT_KEYS = Object.keys(emptyState());
const CREATION_INPUT = z.object({
  target_class: z.enum(['PC', 'NPC']), scenario: Json, start_time: z.string(), start_placement: Json,
  control_principal: Id, selected_templates: z.array(Json), fields: z.array(Field), delegation_scopes: z.array(Scope),
  baseline_capability_preset: Json,
}).strict();
const VALIDATION_INPUT = z.object({
  grant_lines: z.array(GrantInput), dependencies: z.record(z.string(), z.array(Id)),
  reviewed_claims: z.array(Claim), reviewed_kinship: z.array(Kinship), reviewed_disclosure: Json,
  biography: z.array(Biography), household_references: z.array(Household),
}).strict();

function revision(state) { return state.creation_draft?.revision ?? 0; }
function privileged(authority) { return ['creator', 'developer'].includes(authority.role); }
function requirePrivileged(authority) { requireRule(privileged(authority), 'INVALID_SCOPE', 'Privileged command required'); }
function lifecycle(state, allowed) { requireRule(allowed.includes(state.creation_draft?.lifecycle_state), 'INVALID_SCOPE', 'Operation is unavailable in this lifecycle'); }
function bump(state) { state.creation_draft.revision++; if (state.character_core) state.character_core.revision = state.creation_draft.revision; }
function stage(state, next) { state.creation_draft.lifecycle_state = next; if (state.character_core) state.character_core.lifecycle_state = next; state.durable_recovery_state.coordinator_stage = next; }
function issue(error) { return { code: error instanceof IdentityError ? error.code : 'OWNER_UNAVAILABLE', message: error instanceof IdentityError ? error.message : 'External boundary unavailable', refs: error instanceof IdentityError ? error.refs : [] }; }
function active(state) {
  lifecycle(state, ['ACTIVE']);
  requireRule(!state.durable_recovery_state.outbox_entries.some(event => event.kind === 'CharacterArchived'), 'INVALID_SCOPE', 'Character is archived');
}
function eventId(command, kind, discriminator = '') { return stableId('event', command.world_id, command.branch_id, command.command_id, kind, discriminator); }
function appendEvent(state, command, kind, payload, keys = []) {
  requireRule(EVENTS.includes(kind), 'INVALID_FIELD', 'Unknown identity event');
  const id = eventId(command, kind, hash(payload));
  if (state.durable_recovery_state.outbox_entries.some(event => event.id === id)) return id;
  const journal = state.durable_recovery_state.outbox_entries;
  journal.push({
    id, kind, envelope: {
      world_id: command.world_id, branch_id: command.branch_id, sequence: journal.length + 1,
      simulation_time: commandTimes.get(command) ?? state.creation_draft.start_time, schema_version: VERSION,
      ruleset_version: payload.ruleset_version ?? journal.findLast(entry => entry.payload?.versioned_defaults)?.payload.ruleset_version ?? VERSION,
      actor_authority: command.principal_id, command_ref: command.command_id,
      correlation_ref: state.character_core.creation_lineage_id, causation_ref: command.causation_id,
      disclosure_refs: ['developer'],
    },
    payload: clone(payload),
    // Rebuildable local projections; these patches are never sent to public consumers.
    accepted_effects: Object.fromEntries(keys.map(key => [key, clone(state[key])])),
  });
  return id;
}
function trace(state, command, blockers = [], effects = [], evaluated = []) {
  const result = {
    trace_id: stableId('trace', command.world_id, command.branch_id, command.command_id),
    rule_id: command.operation, rule_version: VERSION, command: command.command_id,
    input_refs_and_revisions: [{ draft_id: command.draft_id, expected_revision: command.expected_revision }],
    evaluated_predicates: [{ predicate: 'authorized_command', result: true }, { predicate: 'operation_completed', result: blockers.length === 0 }, ...evaluated],
    blockers, accepted_effects: effects, rejected_effects: [], source_events: [], sample_refs: [], disclosure_policy: 'developer',
  };
  state.decision_trace.push(result); return result.trace_id;
}
async function call(runtime, name, input = {}) {
  try {
    const result = await runtime.ports[name](clone(input));
    // A null response is an unresolved external request, never a rejection.
    requireRule(result !== undefined && result !== null, 'OWNER_UNAVAILABLE', 'External response unresolved');
    canonical(result);
    if (result.available === false) throw new IdentityError(result.code === 'DOMAIN_UNAVAILABLE' ? 'DOMAIN_UNAVAILABLE' : 'OWNER_UNAVAILABLE', 'External boundary unavailable');
    return clone(result);
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('OWNER_UNAVAILABLE', 'External boundary unavailable');
  }
}
async function checkpoint(runtime) {
  parse(State, runtime.state);
  const snapshot = clone(runtime.state);
  const result = await call(runtime, 'persistIdentitySnapshot', { snapshot, snapshot_hash: hash(snapshot) });
  requireRule(result.saved === true, 'OWNER_UNAVAILABLE', 'Checkpoint not acknowledged');
  runtime.rollback = clone(runtime.state);
}
async function authenticate(runtime, command) {
  const authority = await call(runtime, 'readPlayerAuthority', {});
  requireRule(authority.authorized === true && authority.principal_id === command.principal_id && authority.world_id === command.world_id && authority.branch_id === command.branch_id, 'INVALID_SCOPE', 'Not authorized');
  const state = runtime.state;
  if (state.creation_draft) {
    const draft = state.creation_draft;
    requireRule(command.world_id === draft.world_id && command.branch_id === draft.branch_id && command.draft_id === draft.draft_id, 'INVALID_SCOPE', 'Not authorized');
    requireRule(privileged(authority) || draft.creator_principal === authority.principal_id || (READ_OPERATIONS.has(command.operation) && (draft.control_principal === authority.principal_id || authority.can_read === true)), 'INVALID_SCOPE', 'Not authorized');
  }
  return authority;
}
function requireHash(state, command) {
  requireRule(state.creation_manifest && command.manifest_hash === state.creation_manifest.manifest_hash && manifestHash(state.creation_manifest) === command.manifest_hash, 'STALE_REVISION', 'Manifest changed');
}
function makeLine(state, input) {
  const namespace = state.creation_draft.lifecycle_state === 'ACTIVE' ? [state.creation_draft.branch_id] : [];
  const line = { ...clone(input), reservation_ref: null, idempotency_key: stableId('grant', input.owner_domain, state.character_core.creation_lineage_id, ...namespace, input.line_id), status: 'pending', receipt_refs: [] };
  validateGrantRequest(line, state); return line;
}
function sourceFacts(state, at) {
  const time = bounds(at)[0];
  return state.identity_fact.filter(fact => {
    const [start, end] = intervalBounds({ start: fact.valid_from, end: fact.valid_to });
    if (time < start || time > end) return false;
    return !state.identity_fact.some(next => next.supersedes_fact_id === fact.fact_id && bounds(next.valid_from)[0] <= time);
  });
}
async function audienceProjection(runtime, authority, options = {}) {
  const state = runtime.state;
  if (!state.creation_draft) return {};
  const audience = await call(runtime, 'readAudience', { principal_id: authority.principal_id });
  requireRule(audience.authorized === true && audience.viewer === authority.principal_id, 'INVALID_SCOPE', 'Audience unavailable');
  const author = audience.audience_entitlement === 'author' && [state.creation_draft.creator_principal, state.creation_draft.control_principal].includes(authority.principal_id);
  const developer = audience.audience_entitlement === 'developer' && authority.role === 'developer';
  const creator = audience.audience_entitlement === 'creator' && privileged(authority);
  const elevated = author || developer || creator;
  if (state.creation_draft.lifecycle_state !== 'ACTIVE' && !elevated) return {};
  const [world, knowledge, perception] = await Promise.all([
    call(runtime, 'readWorldConfiguration'), call(runtime, 'readSystem3Knowledge', { viewer: authority.principal_id }), call(runtime, 'readPerception', { viewer: authority.principal_id }),
  ]);
  const at = options.time ?? world.simulation_time;
  const visible = (policy, id, key, kind = 'fact') => {
    if (developer || creator) return true;
    if (author && policy !== 'developer') return true;
    if (policy === 'developer' || policy === 'author') return false;
    const acquired = (kind === 'claim' ? knowledge.known_claim_refs : kind === 'event' ? knowledge.known_event_refs : knowledge.known_fact_ids) ?? [];
    if (APPEARANCE_FIELDS.has(key)) return (perception.visible_field_keys ?? []).includes(key) && (policy === 'public' || acquired.includes(id));
    return acquired.includes(id) || policy === 'public' && (perception.visible_field_keys ?? []).includes(key);
  };
  const facts = sourceFacts(state, at).filter(fact => visible(fact.disclosure_policy_id, fact.fact_id, fact.field_key));
  const result = {
    character_id: state.character_core.character_id, revision: elevated ? state.character_core.revision : knowledge.revision,
    lifecycle_state: state.character_core.lifecycle_state,
    identity_fact: clone(facts),
    identity_claim: state.identity_claim.filter(claim => visible(claim.disclosure, hash(claim), claim.field_key, 'claim')).map(clone),
    biography_entry: state.biography_entry.filter(entry => visible(JSON.parse(entry.payload_json).disclosure, entry.source_event_id, '', 'event')).map(clone),
    kinship_edge: state.kinship_edge.filter(edge => visible(edge.visibility, hash(edge), '', 'fact')).map(clone),
    descriptor_value: state.descriptor_value.filter(value => visible(value.disclosure, hash(value), '', 'fact')).map(clone),
  };
  // Draft details and author-only facts are intentionally separate from character knowledge.
  if (elevated) {
    result.creation_draft = clone(state.creation_draft);
    result.creation_draft.fields = result.creation_draft.fields.filter(field => visible(field.visibility, hash(field), field.field_key));
    result.creation_draft.accepted_proposals = result.creation_draft.accepted_proposals.filter(proposal => visible(proposal.disclosure ?? proposal.visibility ?? 'author', hash(proposal), proposal.field_key ?? ''));
    result.creation_draft.accepted_samples = [];
    result.creation_draft.issues = state.creation_draft.issues.map(item => ({ code: item.code }));
  }
  if (facts.some(fact => fact.field_key === 'birth_date_or_interval')) {
    const birth = JSON.parse(facts.findLast(fact => fact.field_key === 'birth_date_or_interval').value_json).value;
    if (birth) result.age = ageRange(birth, inWorldTimezone(at, world.timezone));
  }
  return result;
}
async function response(runtime, authority, base) {
  if (!runtime.state.creation_draft) return { ...clone(base), audience_projection: {} };
  let projection = {};
  try { projection = await audienceProjection(runtime, authority); } catch { /* Fail closed on projection-boundary outages. */ }
  const audience = await call(runtime, 'readAudience').catch(() => null);
  const entitled = audience?.viewer === authority.principal_id && (
    audience.audience_entitlement === 'author' && [runtime.state.creation_draft?.creator_principal, runtime.state.creation_draft?.control_principal].includes(authority.principal_id)
    || audience.audience_entitlement === 'developer' && authority.role === 'developer'
    || audience.audience_entitlement === 'creator' && privileged(authority));
  if (!entitled) {
    return { status: base.status === 'rejected' ? 'rejected' : 'ok', revision: projection.revision ?? null, event_refs: [], owner_request_statuses: [], pending_choices: [], trace_id: null, issues: base.status === 'rejected' ? [{ code: 'INVALID_SCOPE', message: 'Request unavailable', refs: [] }] : [], ...(base.card ? { card: base.card } : {}), audience_projection: projection };
  }
  return { ...clone(base), audience_projection: projection };
}

async function createDraft(runtime, command, input, authority) {
  const state = runtime.state, data = parse(CREATION_INPUT, input);
  requireRule(!state.creation_draft, 'INVALID_SCOPE', 'One creation lineage per instance');
  requireRule(data.target_class === 'PC' || privileged(authority), 'INVALID_SCOPE', 'NPC creation requires Creator scope');
  requireRule(data.control_principal === authority.principal_id || privileged(authority), 'INVALID_SCOPE', 'Invalid control principal');
  bounds(data.start_time);
  data.start_time = inWorldTimezone(data.start_time, (await call(runtime, 'readWorldConfiguration')).timezone);
  const lineage = stableId('lineage', command.world_id, command.branch_id, command.draft_id);
  state.character_core = { character_id: stableId('person', lineage), world_id: command.world_id, creation_lineage_id: lineage, control_kind: data.target_class, lifecycle_state: 'DRAFT', revision: 0 };
  state.creation_draft = {
    draft_id: command.draft_id, creator_principal: authority.principal_id, control_principal: data.control_principal,
    target_class: data.target_class, world_id: command.world_id, branch_id: command.branch_id,
    scenario: data.scenario, start_time: data.start_time, start_placement: data.start_placement,
    schema_version: VERSION, revision: 0, lifecycle_state: 'DRAFT', selected_templates: data.selected_templates,
    fields: [], delegation_scopes: data.delegation_scopes, issues: [], pending_choices: [],
    accepted_proposals: [], accepted_samples: [], baseline_capability_preset: data.baseline_capability_preset,
  };
  for (const scope of data.delegation_scopes) { intervalBounds(scope.permitted_interval); requireRule(scope.principal === data.control_principal, 'INVALID_SCOPE', 'Delegation principal mismatch'); }
  state.creation_draft.fields = data.fields.map(field => normalizeField(field, state.creation_draft));
  state.creation_draft.fields.forEach(field => validateField(field, state, authority));
  validateSingleValues(acceptedFields(state)); bump(state);
  const event = appendEvent(state, command, 'CreationDraftEdited', { draft_id: command.draft_id }, ['creation_draft', 'character_core']);
  return { event_refs: [event] };
}
async function editDraft(runtime, command, input, authority) {
  const state = runtime.state; lifecycle(state, EDITABLE);
  const data = parse(z.object({ fields: z.array(Field).optional(), start_placement: Json.optional(), baseline_capability_preset: Json.optional(), delegation_scopes: z.array(Scope).optional(), selected_templates: z.array(Json).optional() }).strict(), input);
  if (data.delegation_scopes) {
    data.delegation_scopes.forEach(scope => { intervalBounds(scope.permitted_interval); requireRule(scope.principal === state.creation_draft.control_principal, 'INVALID_SCOPE', 'Invalid delegation principal'); });
    state.creation_draft.delegation_scopes = data.delegation_scopes;
  }
  if (data.fields) {
    const updates = data.fields.map(field => normalizeField(field, state.creation_draft));
    updates.forEach(field => validateField(field, state, authority));
    state.creation_draft.fields = [...state.creation_draft.fields.filter(old => !updates.some(field => field.field_key === old.field_key)), ...updates];
  }
  for (const key of ['start_placement', 'baseline_capability_preset', 'selected_templates']) if (key in data) state.creation_draft[key] = data[key];
  validateSingleValues(acceptedFields(state));
  state.creation_manifest = null; state.creation_draft.issues = []; state.creation_draft.pending_choices = [];
  stage(state, 'DRAFT'); bump(state);
  return { event_refs: [appendEvent(state, command, 'CreationDraftEdited', { changed_fields: Object.keys(data) }, ['creation_draft', 'character_core', 'creation_manifest'])] };
}

async function validateCreation(runtime, command, input, authority) {
  const state = runtime.state; lifecycle(state, EDITABLE);
  const data = parse(VALIDATION_INPUT, input);
  stage(state, 'VALIDATING');
  try {
    const world = await call(runtime, 'readWorldConfiguration', { scenario: state.creation_draft.scenario });
    requireRule(world.compatible && world.budgets_valid && world.placement_valid, 'BUDGET_EXCEEDED', 'Scenario validation rejected');
    state.creation_draft.fields.forEach(field => validateField(field, state, authority));
    const facts = acceptedFields(state); validateSingleValues(facts);
    for (const key of new Set([...(state.creation_draft.target_class === 'PC' ? ['preferred_name', 'birth_date_or_interval'] : []), ...(world.required_fields ?? [])])) {
      requireRule(facts.some(field => field.field_key === key && field.field_state === 'CONFIRMED' && contains(field.effective_interval, { start: state.creation_draft.start_time, end: state.creation_draft.start_time })), 'NEEDS_CHOICE', 'Required identity field unresolved at scenario start', [key]);
    }
    requireRule(state.creation_draft.start_placement !== null && state.creation_draft.baseline_capability_preset !== null, 'NEEDS_CHOICE', 'Placement and baseline preset are required');
    requireRule(!state.creation_draft.fields.some(field => field.review_disposition === 'needs_owner_validation' || field.review_disposition === 'accepted' && ['PROPOSED', 'DISPUTED', 'UNSPECIFIED'].includes(field.field_state)), 'NEEDS_CHOICE', 'Unresolved field review');
    requireRule(data.biography.length <= state.versioned_defaults.max_biography_entries_per_creation_manifest && data.grant_lines.length + 1 <= state.versioned_defaults.max_provisioning_lines, 'INVALID_FIELD', 'Creation request limit exceeded');
    const subject = state.character_core.character_id;
    for (const event of data.biography) {
      requireRule(event.subject === subject && event.authority === authority.principal_id, 'INVALID_SCOPE', 'Initial biography requires explicit subject authorship');
      validateBiography(event, state, { initial: true });
      requireRule(!['capability_milestone', 'health', 'death'].includes(event.event_kind), 'INVALID_SCOPE', 'Owner-authoritative milestone requires owner event intake');
    }
    const chronology = await call(runtime, 'readPerception', { biography_intervals: data.biography.map(event => ({ source_event: event.source_event, interval: event.interval, location_ref: event.location_ref, precision: event.precision })) });
    requireRule(chronology.location_compatible === true, 'CHRONOLOGY_CONFLICT', 'Incompatible biography locations');
    for (const claim of data.reviewed_claims) { validateClaim(claim); requireRule(claim.subject === subject, 'INVALID_SCOPE', 'Wrong claim subject'); }
    validateKinship(data.reviewed_kinship, [...state.kinship_edge, ...(world.ancestry_edges ?? [])]);
    for (const edge of data.reviewed_kinship) for (const id of [edge.source_person, edge.target_person]) {
      if (id === subject) continue;
      const person = await call(runtime, 'resolvePerson', { character_id: id });
      requireRule(person.exists && person.compatible, 'INCOMPATIBLE_EXISTING_PERSON', 'Referenced person is incompatible');
      if (edge.relationship_type === 'marital') requireRule(person.age_constraint?.min >= 18 && birthFrom(state) && ageRange(birthFrom(state), state.creation_draft.start_time).min >= 18, 'INVALID_SCOPE', 'Marital generation requires adult constraints');
    }
    for (const household of data.household_references) { intervalBounds(household.effective_interval); requireRule(household.person_refs.includes(subject) && household.housing_refs.length > 0 && household.support_arrangement_refs.length > 0, 'NEEDS_CHOICE', 'Household requires explicit housing and support references'); }
    const capability = await call(runtime, 'readSystem10Capabilities', { preset_ref: state.creation_draft.baseline_capability_preset });
    requireRule(!data.grant_lines.some(line => line.command_type === 'initialize_capabilities'), 'INVALID_FIELD', 'Baseline capability grant is created once by the coordinator');
    const initial = makeLine(state, {
      line_id: 'baseline-capabilities', owner_domain: 'system10', command_type: 'initialize_capabilities',
      payload: { preset_ref: state.creation_draft.baseline_capability_preset, preset_contract: capability.preset }, required: true,
      constraints: [], provenance: [{ kind: 'accepted_preset', ref: state.creation_draft.baseline_capability_preset }],
      expected_owner_revision: capability.revision, compensation_policy: 'owner_defined', fallback: null,
    });
    const lines = [initial, ...data.grant_lines.map(line => makeLine(state, line))];
    const graph = clone(data.dependencies);
    for (const line of lines) graph[line.line_id] ??= [];
    topologicalOrder(graph, lines.map(line => line.line_id));
    for (const line of lines) if (line.fallback?.kind === 'specific_eligible_substitute') {
      const alternative = lines.find(other => other.line_id === line.fallback.line_id);
      requireRule(alternative && !alternative.required && alternative.owner_domain === line.owner_domain && alternative.line_id !== line.line_id, 'INVALID_FIELD', 'Invalid declared substitute');
    }
    topologicalOrder(Object.fromEntries(lines.map(line => [line.line_id, [...graph[line.line_id], ...(line.fallback?.kind === 'specific_eligible_substitute' ? [line.fallback.line_id] : [])]])), lines.map(line => line.line_id));
    const containment = lines.filter(line => line.payload?.parent_line_id);
    for (const line of containment) requireRule(graph[line.line_id].includes(line.payload.parent_line_id), 'INVALID_FIELD', 'Container parent must be a provisioning dependency');
    for (const line of lines) {
      if (line.payload?.credential_line_id) requireRule(graph[line.line_id].includes(line.payload.credential_line_id), 'INVALID_FIELD', 'Credential must precede employment');
      if (line.payload?.household_line_id) requireRule(graph[line.line_id].includes(line.payload.household_line_id), 'INVALID_FIELD', 'Household must precede access');
      if (line.owner_domain === 'system8') for (const participant of [line.payload.source_person, line.payload.target_person]) {
        if (participant === subject) continue;
        const person = await call(runtime, 'resolvePerson', { character_id: participant });
        requireRule(person.exists && person.age_constraint?.min >= 18, 'INVALID_SCOPE', 'Romantic seeds cannot target a minor or unresolved age');
      }
      const result = await call(runtime, 'validateOwnerRequest', ownerRequest(line));
      requireRule(result.accepted === true && result.validated === true, 'GRANT_REJECTED', 'Owner rejected proposal', [line.line_id]);
    }
    bump(state); stage(state, 'READY');
    state.creation_draft.accepted_proposals = [...state.creation_draft.accepted_proposals.filter(item => !item.event_kind), ...data.biography];
    state.household_reference = data.household_references;
    state.creation_manifest = {
      creation_lineage_id: state.character_core.creation_lineage_id, draft_revision: revision(state), manifest_hash: 'pending', validation_revision: revision(state),
      grant_policy: world.grant_policy, reviewed_facts: facts, reviewed_claims: data.reviewed_claims,
      reviewed_kinship: data.reviewed_kinship, reviewed_disclosure: { ...data.reviewed_disclosure, biography_hash: hash(data.biography), household_hash: hash(data.household_references), descriptor_hash: hash([state.descriptor_definition, state.descriptor_value]) },
      grant_lines: lines, dependencies: graph, owner_availability_snapshot: { world_revision: world.revision, capability_revision: capability.revision },
      idempotency_key: stableId('manifest', state.character_core.creation_lineage_id),
    };
    state.creation_manifest.manifest_hash = manifestHash(state.creation_manifest);
    state.creation_draft.issues = []; state.creation_draft.pending_choices = [];
    return { manifest_ref: state.creation_manifest.manifest_hash, event_refs: [appendEvent(state, command, 'CreationValidated', { manifest_hash: state.creation_manifest.manifest_hash }, ['creation_draft', 'creation_manifest', 'character_core', 'household_reference'])] };
  } catch (error) {
    stage(state, 'DRAFT'); state.creation_manifest = null; bump(state);
    const errorIssue = issue(error); state.creation_draft.issues = [errorIssue];
    state.creation_draft.pending_choices = errorIssue.code === 'NEEDS_CHOICE' ? [errorIssue] : [];
    appendEvent(state, command, 'CreationValidated', { issues: [errorIssue] }, ['creation_draft', 'creation_manifest', 'character_core']);
    return { status: 'rejected', issues: [errorIssue] };
  }
}

async function prepare(runtime, command) {
  const state = runtime.state; lifecycle(state, ['READY', 'PREPARING', 'RECOVERY_REQUIRED']); requireHash(state, command);
  requireRule(!state.creation_manifest.grant_lines.some(line => line.status === 'compensated'), 'RECOVERY_PENDING', 'Compensated creation must complete cancellation');
  const world = await call(runtime, 'readWorldConfiguration');
  requireRule(canonical(world.grant_policy) === canonical(state.creation_manifest.grant_policy), 'STALE_REVISION', 'Grant policy changed');
  stage(state, 'PREPARING'); bump(state);
  appendEvent(state, command, 'CreationReserved', { stage: 'PREPARING' }, ['creation_draft', 'character_core']);
  await checkpoint(runtime);
  for (const line of state.creation_manifest.grant_lines) {
    if (line.status === 'accepted') continue;
    const accepted = await obtainReceipt(runtime, command, line, { lookupOnly: true });
    if (accepted?.status === 'accepted' || line.status === 'rejected') continue;
    const result = await call(runtime, 'reserveOwnerRequest', ownerRequest(line));
    requireRule(result.valid === true && typeof result.reservation_ref === 'string' && canonical(result.expected_owner_revision) === canonical(line.expected_owner_revision), 'GRANT_REJECTED', 'Reservation invalid', [line.line_id]);
    line.reservation_ref = result.reservation_ref; line.status = 'reserved';
    if (!state.durable_recovery_state.reservations.some(record => record.line_id === line.line_id)) state.durable_recovery_state.reservations.push({ line_id: line.line_id, reservation_ref: line.reservation_ref });
    appendEvent(state, command, 'CreationReserved', { line_id: line.line_id, reservation_ref: line.reservation_ref }, ['creation_manifest']);
    await checkpoint(runtime);
  }
  return { manifest_ref: state.creation_manifest.manifest_hash };
}
async function verifyReceipt(runtime, request, input) {
  const receipt = parse(Receipt, input);
  requireRule(receipt.owner_domain === request.owner_domain && receipt.command_hash === hash(request), 'INVALID_SCOPE', 'Receipt command mismatch');
  const auth = await call(runtime, 'authenticateOwnerReceipt', { receipt, request });
  requireRule(auth.authenticated === true && auth.revision_valid === true, 'INVALID_SCOPE', 'Untrusted receipt');
  requireRule(receipt.status !== 'accepted' || receipt.canonical_event_refs.length > 0, 'INVALID_FIELD', 'Accepted receipt requires canonical event references');
  return receipt;
}
function storeReceipt(state, receipt) {
  const reference = hash(receipt);
  if (!state.domain_receipt.some(item => hash(item) === reference)) state.domain_receipt.push(receipt);
  if (!state.durable_recovery_state.owner_acknowledgments.includes(reference)) state.durable_recovery_state.owner_acknowledgments.push(reference);
  return reference;
}
async function obtainReceipt(runtime, command, line, { lookupOnly = false } = {}) {
  const state = runtime.state, request = ownerRequest(line);
  const existing = state.domain_receipt.find(receipt => receipt.command_hash === hash(request));
  if (existing) return existing;
  const found = await call(runtime, 'lookupOwnerRequest', request);
  let receipt;
  if (found.found) receipt = await verifyReceipt(runtime, request, found.receipt);
  else {
    if (lookupOnly) return null;
    if (state.creation_manifest?.grant_lines.includes(line)) {
      const reservation = await call(runtime, 'checkReservation', { reservation_ref: line.reservation_ref, request });
      requireRule(line.reservation_ref && reservation.valid === true, 'RECOVERY_PENDING', 'Reservation expired; prepare with the original grant keys');
    }
    // Persist the original request before any external side effect.
    appendEvent(state, command, 'CreationCommitStarted', { request }, ['creation_manifest']);
    await checkpoint(runtime);
    receipt = await verifyReceipt(runtime, request, await call(runtime, 'submitOwnerRequest', request));
  }
  const ref = storeReceipt(state, receipt); line.receipt_refs = [ref]; line.status = receipt.status;
  appendEvent(state, command, 'OwnerGrantAcknowledged', { line_id: line.line_id, receipt_ref: ref }, ['domain_receipt', 'creation_manifest']);
  await checkpoint(runtime); return receipt;
}
function fallbackTargets(manifest) { return new Set(manifest.grant_lines.filter(line => line.fallback?.kind === 'specific_eligible_substitute').map(line => line.fallback.line_id)); }
function lineSatisfied(manifest, line, seen = new Set()) {
  if (!line) return false;
  if (line.status === 'accepted') return true;
  if (seen.has(line.line_id)) return false; seen.add(line.line_id);
  if (line.status !== 'rejected') return false;
  if (!line.required && line.fallback?.kind === 'omit') return true;
  if (line.fallback?.kind === 'specific_eligible_substitute') return lineSatisfied(manifest, manifest.grant_lines.find(other => other.line_id === line.fallback.line_id), seen);
  return false;
}
function dependencySatisfied(manifest, line) {
  if (line?.status === 'accepted') return true;
  if (line?.status === 'rejected' && line.fallback?.kind === 'specific_eligible_substitute') return dependencySatisfied(manifest, manifest.grant_lines.find(other => other.line_id === line.fallback.line_id));
  return false;
}
async function commit(runtime, command) {
  const state = runtime.state;
  if (state.creation_draft.lifecycle_state === 'ACTIVE') { requireHash(state, command); return { status: 'committed', character_ref: state.character_core.character_id }; }
  lifecycle(state, ['PREPARING', 'COMMITTING', 'RECOVERY_REQUIRED']); requireHash(state, command);
  const manifest = state.creation_manifest;
  if (state.creation_draft.lifecycle_state === 'PREPARING') {
    for (const line of manifest.grant_lines) {
      if (line.status === 'accepted' || line.status === 'rejected') continue;
      const reservation = await call(runtime, 'checkReservation', { reservation_ref: line.reservation_ref, request: ownerRequest(line) });
      requireRule(line.reservation_ref && reservation.valid === true, 'RECOVERY_PENDING', 'Reservation expired; reconciliation required', [line.line_id]);
    }
  }
  stage(state, 'COMMITTING'); bump(state);
  appendEvent(state, command, 'CreationCommitStarted', { manifest_hash: manifest.manifest_hash }, ['creation_draft', 'character_core']);
  await checkpoint(runtime);
  try {
    const targets = fallbackTargets(manifest);
    const order = topologicalOrder(manifest.dependencies, manifest.grant_lines.map(line => line.line_id));
    const dispatch = async (line, visiting = new Set()) => {
      requireRule(line && !visiting.has(line.line_id), 'INVALID_FIELD', 'Fallback cycle'); visiting.add(line.line_id);
      if (line.status === 'accepted') return;
      for (const id of manifest.dependencies[line.line_id] ?? []) {
        const dependency = manifest.grant_lines.find(item => item.line_id === id);
        await dispatch(dependency, new Set(visiting));
        requireRule(dependencySatisfied(manifest, dependency), 'RECOVERY_PENDING', 'Required dependency unresolved', [id]);
      }
      if (line.status !== 'rejected') await obtainReceipt(runtime, command, line);
      if (line.status === 'rejected' && line.fallback?.kind === 'specific_eligible_substitute') await dispatch(manifest.grant_lines.find(item => item.line_id === line.fallback.line_id), visiting);
      requireRule(lineSatisfied(manifest, line), line.fallback?.kind === 'return_to_choice' ? 'NEEDS_CHOICE' : 'GRANT_REJECTED', 'Grant requires reconciliation or choice', [line.line_id]);
    };
    for (const id of order) if (!targets.has(id)) await dispatch(manifest.grant_lines.find(line => line.line_id === id));
    requireRule(manifest.grant_lines.filter(line => line.required).every(line => lineSatisfied(manifest, line)), 'RECOVERY_PENDING', 'Required receipts incomplete');
    for (const line of manifest.grant_lines.filter(line => targets.has(line.line_id) && line.status === 'reserved')) {
      const released = await call(runtime, 'releaseReservation', { reservation_ref: line.reservation_ref });
      requireRule(released.released === true, 'RECOVERY_PENDING', 'Unused substitute reservation release unresolved');
      const record = state.durable_recovery_state.reservations.find(item => item.line_id === line.line_id);
      if (record) record.released = true;
    }
    await activate(runtime, command);
    return { status: 'committed', character_ref: state.character_core.character_id, event_refs: state.durable_recovery_state.outbox_entries.filter(event => event.kind === 'CharacterActivated').map(event => event.id) };
  } catch (error) {
    stage(state, 'RECOVERY_REQUIRED');
    state.creation_draft.issues = [issue(error)];
    if (error.code === 'NEEDS_CHOICE') state.creation_draft.pending_choices = [issue(error)];
    appendEvent(state, command, 'CreationRecoveryRequired', { issues: [issue(error)] }, ['creation_draft', 'character_core', 'creation_manifest']);
    await checkpoint(runtime);
    return { status: 'pending', issues: [issue(error)] };
  }
}
function writeFact(state, command, field, supersedes = null, eventKind = supersedes ? 'FactCorrected' : 'IdentityFactRecorded') {
  const id = stableId('fact', state.character_core.character_id, command.branch_id, command.command_id, field.field_key, hash(field));
  if (state.identity_fact.some(fact => fact.fact_id === id)) return id;
  const source = eventId(command, eventKind, id);
  state.identity_fact.push({ fact_id: id, character_id: state.character_core.character_id, field_key: field.field_key,
    value_json: canonical({ field_state: field.field_state, ...(field.value === undefined ? {} : { value: field.value }), origin: field.origin }),
    valid_from: field.effective_interval.start, valid_to: field.effective_interval.end,
    source_event_id: source, authority_kind: field.authority, supersedes_fact_id: supersedes, disclosure_policy_id: field.visibility,
  });
  const event = appendEvent(state, command, eventKind, { fact_id: id, supersedes_fact_id: supersedes }, ['identity_fact']);
  state.identity_fact.at(-1).source_event_id = event;
  state.durable_recovery_state.outbox_entries.at(-1).accepted_effects.identity_fact = clone(state.identity_fact);
  return id;
}
function writeBiography(state, command, event) {
  const existing = state.biography_entry.find(entry => entry.character_id === event.subject && entry.source_event_id === event.source_event && entry.kind === event.event_kind);
  if (existing) return existing.entry_id;
  const entry = { entry_id: stableId('bio', event.subject, event.source_event, event.event_kind), character_id: event.subject, kind: event.event_kind, interval_json: canonical(event.interval), payload_json: canonical(event), source_event_id: event.source_event };
  state.biography_entry.push(entry);
  appendEvent(state, command, 'BiographyEventRecorded', { entry_id: entry.entry_id, source_event: event.source_event }, ['biography_entry']);
  return entry.entry_id;
}
async function activate(runtime, command) {
  const state = runtime.state, manifest = state.creation_manifest;
  requireRule(hash(state.creation_draft.accepted_proposals.filter(item => item.event_kind)) === manifest.reviewed_disclosure.biography_hash && hash(state.household_reference) === manifest.reviewed_disclosure.household_hash && hash([state.descriptor_definition, state.descriptor_value]) === manifest.reviewed_disclosure.descriptor_hash, 'STALE_REVISION', 'Reviewed history changed');
  for (const field of manifest.reviewed_facts) writeFact(state, command, field);
  for (const claim of manifest.reviewed_claims) {
    if (!state.identity_claim.some(item => hash(item) === hash(claim))) state.identity_claim.push(claim);
    appendEvent(state, command, 'IdentityClaimRecorded', { claim_ref: hash(claim) }, ['identity_claim']);
  }
  for (const edge of manifest.reviewed_kinship) {
    if (!state.kinship_edge.some(item => hash(item) === hash(edge))) state.kinship_edge.push(edge);
    appendEvent(state, command, 'KinshipEstablished', { kinship_ref: hash(edge) }, ['kinship_edge']);
  }
  for (const event of state.creation_draft.accepted_proposals.filter(item => item.event_kind)) writeBiography(state, command, event);
  stage(state, 'ACTIVE'); state.creation_draft.issues = []; state.creation_draft.pending_choices = [];
  appendEvent(state, command, 'CharacterActivated', { character_id: state.character_core.character_id, placement: state.creation_draft.start_placement }, ['character_core', 'creation_draft', 'creation_manifest']);
  await checkpoint(runtime);
}

async function cancel(runtime, command) {
  const state = runtime.state; lifecycle(state, ['DRAFT', 'READY', 'PREPARING', 'COMMITTING', 'RECOVERY_REQUIRED', 'CANCELLED']);
  if (state.creation_draft.lifecycle_state === 'CANCELLED') return {};
  if (state.creation_manifest) {
    for (const line of state.creation_manifest.grant_lines) {
      // Lost acknowledgments must be looked up even when the local line is pending.
      const receipt = await obtainReceipt(runtime, command, line, { lookupOnly: true });
      if (receipt?.status === 'accepted' && line.status !== 'compensated') {
        const result = await call(runtime, 'compensateOwnerRequest', { request: ownerRequest(line), receipt, compensation_policy: line.compensation_policy, idempotency_key: stableId('compensation', line.idempotency_key) });
        if (!result.compensated || !result.current_revision_valid) {
          stage(state, 'RECOVERY_REQUIRED'); bump(state);
          appendEvent(state, command, 'CreationRecoveryRequired', { line_id: line.line_id, reason: 'compensation_blocked' }, ['creation_draft', 'character_core', 'creation_manifest']);
          return { status: 'pending', issues: [{ code: 'RECOVERY_PENDING', message: 'Owner compensation required', refs: [] }] };
        }
        line.status = 'compensated';
        appendEvent(state, command, 'OwnerGrantAcknowledged', { line_id: line.line_id, compensated: true }, ['creation_manifest']);
        await checkpoint(runtime);
      }
      if (line.reservation_ref) {
        const released = await call(runtime, 'releaseReservation', { reservation_ref: line.reservation_ref });
        requireRule(released.released === true, 'RECOVERY_PENDING', 'Reservation release unresolved');
      }
    }
  }
  stage(state, 'CANCELLED'); bump(state);
  appendEvent(state, command, 'CreationDraftEdited', { lifecycle_state: 'CANCELLED' }, ['creation_draft', 'character_core', 'creation_manifest']);
  return {};
}

async function ownerEvent(runtime, command, input) {
  const state = runtime.state; active(state);
  const data = parse(z.object({ owner_domain: Id, source_event: Id }).strict(), input);
  const incoming = await call(runtime, 'fetchOwnerEvent', data);
  requireRule(incoming.authenticated === true && incoming.event && incoming.event.source_event === data.source_event, 'INVALID_SCOPE', 'Unauthenticated owner event');
  const event = parse(Biography, incoming.event);
  requireRule(event.subject === state.character_core.character_id && event.authority === data.owner_domain, 'INVALID_SCOPE', 'Owner event subject/authority mismatch');
  const ownerKinds = {
    system3: ['significant_event'], system4: ['significant_event'], system5: ['significant_event'], system6: ['caregiving', 'employment', 'schooling', 'significant_event'],
    system7: ['relationship', 'caregiving'], system8: ['relationship'], system10: ['capability_milestone'],
    jobs: ['employment'], institutions: ['schooling', 'significant_event'], legal: ['incarceration', 'significant_event', 'relationship'], licensing: ['schooling', 'significant_event'],
    economy: ['significant_event'], inventory: ['significant_event', 'appearance'], housing: ['relocation', 'caregiving'], vehicles: ['significant_event'], property: ['significant_event', 'relocation'],
    health: ['health', 'death', 'appearance'], physiology: ['health', 'appearance'], grooming: ['appearance'], environment: ['appearance', 'significant_event'], perception: ['disappearance', 'significant_event'], location: ['relocation', 'disappearance'], travel: ['relocation', 'significant_event'],
  };
  if (!BIOGRAPHY_KINDS.includes(event.event_kind)) {
    if (!state.durable_recovery_state.quarantined_inputs.some(item => item.source_event === event.source_event)) state.durable_recovery_state.quarantined_inputs.push({ source_event: event.source_event, event, reason: 'unknown_event_kind' });
    return { status: 'quarantined', issues: [{ code: 'INVALID_FIELD', message: 'Unknown event kind', refs: [] }] };
  }
  requireRule(ownerKinds[data.owner_domain]?.includes(event.event_kind), 'INVALID_SCOPE', 'Event kind is outside owner authority');
  requireRule(!(state.creation_draft.target_class === 'PC' && data.owner_domain === 'system5'), 'INVALID_SCOPE', 'NPC personality events cannot author PC development');
  const prior = state.biography_entry.find(entry => entry.source_event_id === event.source_event && entry.character_id === event.subject);
  if (prior) {
    requireRule(prior.payload_json === canonical(event), 'IDEMPOTENCY_CONFLICT', 'Owner event source changed payload');
    return { event_refs: [event.source_event] };
  }
  validateBiography(event, state);
  const location = await call(runtime, 'readPerception', { event_ref: event.source_event });
  requireRule(location.location_compatible, 'CHRONOLOGY_CONFLICT', 'Owner event location conflict');
  const ref = writeBiography(state, command, event); bump(state);
  if (incoming.field) {
    const field = parse(Field, incoming.field);
    requireRule(APPEARANCE_FIELDS.has(field.field_key) && ['grooming', 'health', 'environment', 'physiology'].includes(data.owner_domain), 'INVALID_SCOPE', 'Owner cannot overwrite identity');
    // Foreign health/equipment state remains an event reference, not a copied fact.
    if (data.owner_domain === 'grooming') {
      const prior = sourceFacts(state, field.effective_interval.start).find(fact => fact.field_key === field.field_key);
      const checked = { ...field, authority: command.principal_id, origin: { kind: 'player_authored' } };
      validateField(checked, state, { principal_id: command.principal_id, role: 'player' });
      requireRule(field.field_state === 'CONFIRMED' && field.authority === data.owner_domain, 'INVALID_SCOPE', 'Grooming fact must be owner-confirmed');
      writeFact(state, command, field, prior?.fact_id ?? null, 'AppearanceChanged');
      appendEvent(state, command, 'AppearanceChanged', { source_event: event.source_event }, ['identity_fact']);
    }
  }
  appendEvent(state, command, 'BiographyEventRecorded', { revision: revision(state), source_event: event.source_event }, ['character_core', 'creation_draft']);
  return { event_refs: [ref] };
}

async function correctFact(runtime, command, input, authority) {
  const state = runtime.state; active(state); requirePrivileged(authority);
  const data = parse(FactCorrection, input);
  const old = state.identity_fact.find(fact => fact.fact_id === data.fact_id);
  requireRule(old && old.field_key === data.field.field_key, 'INVALID_FIELD', 'Correction target unavailable');
  validateField(data.field, state, authority); bounds(data.effective_time);
  requireRule(['CONFIRMED', 'EXPLICIT_NONE'].includes(data.field.field_state), 'NEEDS_CHOICE', 'Correction must be accepted');
  requireRule(data.field.effective_interval.start === data.effective_time, 'INVALID_FIELD', 'Correction effective time mismatch');
  requireRule(!state.identity_fact.some(fact => fact.supersedes_fact_id === old.fact_id), 'STALE_REVISION', 'Fact already superseded');
  const ref = writeFact(state, command, data.field, old.fact_id); bump(state);
  appendEvent(state, command, 'FactCorrected', { before: old.fact_id, after: ref, reason: data.reason, effective_time: data.effective_time }, ['character_core', 'creation_draft']);
  // Repair is asynchronous; a failure cannot silently undo the recorded correction.
  state.durable_recovery_state.outbox_entries.push({ id: stableId('repair', ref), kind: 'dependency_repair_request', payload: { fact_id: ref, supersedes_fact_id: old.fact_id, effective_time: data.effective_time }, accepted_effects: {} });
  return { event_refs: [ref] };
}

async function develop(runtime, command, input, authority) {
  const state = runtime.state; active(state);
  const data = parse(Development, input);
  requireRule(data.subject === state.character_core.character_id && data.status === 'proposed' && data.owner_receipt_refs.length === 0, 'INVALID_SCOPE', 'Development must be an uncommitted proposal');
  requireRule(data.target_owner === 'system5' && state.creation_draft.target_class === 'NPC', 'INVALID_SCOPE', 'NPC development requires NPC behavior owner');
  requirePrivileged(authority);
  const change = data.requested_change;
  requireRule(change && ['propose_tendency', 'propose_contextual_response', 'propose_value'].includes(change.command_type), 'INVALID_FIELD', 'Invalid development request');
  const refs = [...new Set(data.evidence_event_refs)];
  const evidence = refs.map(ref => state.biography_entry.find(entry => entry.source_event_id === ref));
  requireRule(evidence.every(Boolean), 'INVALID_FIELD', 'Development evidence must reference committed events');
  const [start, end] = intervalBounds(data.evidence_interval);
  requireRule(Number.isFinite(end), 'INVALID_FIELD', 'Development evidence window must end');
  const dates = evidence.map(entry => intervalBounds(JSON.parse(entry.interval_json)));
  requireRule(dates.every(([a, b]) => start <= a && b <= end), 'INVALID_FIELD', 'Evidence lies outside declared interval');
  if (change.command_type !== 'propose_contextual_response') {
    requireRule(refs.length >= state.versioned_defaults.durable_npc_tendency_min_independent_events && Math.max(...dates.map(([a]) => a)) - Math.min(...dates.map(([a]) => a)) >= state.versioned_defaults.durable_npc_tendency_min_simulation_days * 86400000, 'NEEDS_CHOICE', 'Insufficient independent development evidence');
  } else requireRule(refs.length > 0 && change.scope === 'contextual', 'INVALID_FIELD', 'Major-event response must remain contextual');
  const proposalRef = hash(data);
  const existing = state.development_proposal.find(proposal => hash({ ...proposal, status: 'proposed', owner_receipt_refs: [] }) === proposalRef);
  if (existing?.status !== undefined && existing.status !== 'proposed') return { status: existing.status, event_refs: existing.owner_receipt_refs };
  if (!existing) state.development_proposal.push(data);
  const proposal = existing ?? data;
  appendEvent(state, command, 'DevelopmentProposed', { proposal_ref: proposalRef }, ['development_proposal']); await checkpoint(runtime);
  const line = makeLine(state, { line_id: `development-${proposalRef.slice(0, 32)}`, owner_domain: 'system5', command_type: change.command_type, payload: change, required: true, constraints: [], provenance: refs.map(ref => ({ kind: 'owner_event', ref })), expected_owner_revision: (await call(runtime, 'readSystem5Personality')).revision, compensation_policy: 'owner_defined', fallback: null });
  const receipt = await obtainReceipt(runtime, command, line);
  proposal.status = receipt.status; proposal.owner_receipt_refs = [hash(receipt)]; bump(state);
  appendEvent(state, command, receipt.status === 'accepted' ? 'DevelopmentAccepted' : 'DevelopmentRejected', { proposal_ref: proposalRef, receipt_ref: hash(receipt) }, ['development_proposal', 'character_core', 'creation_draft']);
  return { status: receipt.status, event_refs: [hash(receipt)] };
}

async function generate(runtime, command, input, authority) {
  const state = runtime.state;
  const data = parse(z.object({ fields: z.array(Id), tier: z.enum(['Ambient', 'Supporting', 'Major', 'Historical']), world_seed: Json, generation_version: Id, scope_ref: Id.nullable() }).strict(), input);
  lifecycle(state, ['DRAFT', 'READY', 'ACTIVE']);
  if (state.creation_draft.target_class === 'NPC') requirePrivileged(authority);
  requireRule(data.fields.length <= state.versioned_defaults.max_custom_fields_per_character && data.fields.every(key => FIELDS.includes(key)), 'INVALID_FIELD', 'Unrecognized generation field');
  const world = await call(runtime, 'readWorldConfiguration');
  const generated = [];
  for (const key of data.fields) {
    const old = state.creation_draft.fields.find(field => field.field_key === key);
    if (old && old.field_state !== 'UNSPECIFIED' || state.identity_fact.some(fact => fact.field_key === key)) continue;
    const options = world.generation_templates?.[key];
    if (!Array.isArray(options) || options.length === 0) continue;
    // Each field has an independent slot; unrelated fields never perturb samples.
    const sampleId = stableId('sample', data.world_seed, state.character_core.character_id, data.generation_version, key);
    const previous = state.creation_draft.accepted_samples.find(sample => sample.field_sample_identity === sampleId);
    const sample = previous ?? { field_sample_identity: sampleId, field_key: key, value: options[Number.parseInt(hash(sampleId).slice(0, 8), 16) % options.length], random_algorithm_version: 'sha256-field-slot-v1' };
    const field = { field_key: key, field_state: 'PROPOSED', value: sample.value, origin: { kind: 'generated', scope_ref: data.scope_ref, category: 'minor_detail', field_sample_identity: sampleId }, effective_interval: { start: state.creation_draft.start_time, end: null }, authority: authority.principal_id, visibility: 'author', review_disposition: 'disputed' };
    validateField(field, state, authority, { generated: true });
    if (!previous) state.creation_draft.accepted_samples.push(sample);
    state.creation_draft.accepted_proposals.push(field); generated.push(key);
  }
  state.npc_generation = parse(Generation, { tier: data.tier, world_seed: data.world_seed, character_id: state.character_core.character_id, generation_version: data.generation_version, random_algorithm_version: 'sha256-field-slot-v1', field_sample_slots: Object.fromEntries(state.creation_draft.accepted_samples.map(sample => [sample.field_key, sample.field_sample_identity])), accepted_samples: clone(state.creation_draft.accepted_samples), role_constraints: { scenario: state.creation_draft.scenario, placement: state.creation_draft.start_placement }, frozen_fact_refs: state.identity_fact.map(fact => fact.fact_id), unresolved_fields: data.fields.filter(key => !generated.includes(key)) });
  if (state.creation_draft.lifecycle_state === 'READY') { state.creation_manifest = null; stage(state, 'DRAFT'); }
  bump(state); appendEvent(state, command, 'CreationDraftEdited', { proposed_fields: generated }, ['creation_draft', 'creation_manifest', 'character_core', 'npc_generation']);
  return {};
}

async function importBiography(runtime, command, input, authority) {
  const state = runtime.state; lifecycle(state, EDITABLE);
  const data = parse(z.object({ text: z.string(), use_ai: z.boolean() }).strict(), input);
  inertText(data.text, state.versioned_defaults.max_imported_biography_characters);
  let proposals = [];
  if (data.use_ai) {
    try { proposals = (await call(runtime, 'readAiProposals', { text: data.text, allowed_fields: FIELDS })).proposals; } catch { proposals = []; }
  }
  if (!data.use_ai || !proposals.length) {
    // Deliberately conservative deterministic parser. Unparsed prose needs manual review.
    for (const line of data.text.split(/\r?\n/)) {
      const match = /^([a-z_]+)\s*:\s*(.+)$/.exec(line);
      if (!match || !FIELDS.includes(match[1]) || match[1] === 'birth_date_or_interval') continue;
      proposals.push({ field_key: match[1], field_state: 'PROPOSED', value: match[2], origin: { kind: 'imported', source_span: line }, effective_interval: { start: state.creation_draft.start_time, end: null }, authority: authority.principal_id, visibility: 'author', review_disposition: 'disputed' });
    }
  }
  requireRule(Array.isArray(proposals) && proposals.length <= 200, 'INVALID_FIELD', 'Extraction limit exceeded');
  for (const proposal of proposals) {
    const field = parse(Field, proposal);
    requireRule(field.field_state === 'PROPOSED' && field.origin.kind === 'imported' && data.text.includes(field.origin.source_span), 'INVALID_FIELD', 'Extraction must preserve source evidence');
    validateField(field, state, authority); state.creation_draft.accepted_proposals.push(field);
  }
  state.creation_draft.pending_choices = [{ code: 'NEEDS_CHOICE', reason: 'Review extracted proposals and any unparsed biography', source_hash: hash(data.text) }];
  state.creation_manifest = null; stage(state, 'DRAFT'); bump(state);
  appendEvent(state, command, 'CreationDraftEdited', { source_hash: hash(data.text), proposed_count: proposals.length }, ['creation_draft', 'creation_manifest', 'character_core']);
  return { status: 'needs_choice' };
}

async function descriptorOperation(runtime, command, input, authority) {
  const state = runtime.state;
  lifecycle(state, ['DRAFT', 'READY', 'ACTIVE']);
  if (command.operation === 'register_descriptor') {
    requirePrivileged(authority); const definition = validateDefinition(input, state);
    requireRule(state.descriptor_definition.length < state.versioned_defaults.max_custom_fields_per_character, 'INVALID_FIELD', 'Descriptor definition limit exceeded');
    requireRule(!state.descriptor_definition.some(def => definitionRef(def) === definitionRef(definition)), 'INVALID_FIELD', 'Definition version already exists');
    state.descriptor_definition.push(definition);
  } else if (command.operation === 'retire_descriptor') {
    requirePrivileged(authority); const data = parse(z.object({ definition_ref: Id }).strict(), input);
    state.descriptor_definition = state.descriptor_definition.filter(def => definitionRef(def) !== data.definition_ref);
    state.descriptor_value.filter(value => value.definition_ref === data.definition_ref).forEach(value => { value.archived_or_inert = true; });
  } else {
    const descriptor = validateDescriptor(input, state);
    requireRule(descriptor.provenance.some(source => source?.kind === 'player_authored' && source.principal === authority.principal_id) || privileged(authority), 'INVALID_SCOPE', 'Descriptor authorship required');
    const definition = state.descriptor_definition.find(def => definitionRef(def) === descriptor.definition_ref);
    if (definition?.type === 'entity_reference') for (const id of definition.cardinality === 'multiple' ? descriptor.value : [descriptor.value]) {
      requireRule((await call(runtime, 'resolvePerson', { character_id: id })).exists === true, 'INVALID_FIELD', 'Entity reference unavailable');
    }
    requireRule(!state.descriptor_value.some(value => !value.archived_or_inert && !descriptor.archived_or_inert && value.definition_ref === descriptor.definition_ref && overlaps(value.effective_interval, descriptor.effective_interval)), 'CHRONOLOGY_CONFLICT', 'Descriptor overlaps an existing value; use explicit migration');
    requireRule(new Set([...state.descriptor_value.map(value => value.definition_ref), descriptor.definition_ref]).size <= state.versioned_defaults.max_custom_fields_per_character, 'INVALID_FIELD', 'Custom field limit exceeded');
    state.descriptor_value.push(descriptor);
  }
  if (state.creation_draft.lifecycle_state === 'READY') { state.creation_manifest = null; stage(state, 'DRAFT'); }
  bump(state); appendEvent(state, command, 'DescriptorChanged', { operation: command.operation }, ['descriptor_definition', 'descriptor_value', 'character_core', 'creation_draft', 'creation_manifest']);
  return {};
}

async function descriptorAdapter(runtime, command, input, authority) {
  const state = runtime.state; active(state);
  const data = parse(z.object({ descriptor_ref: Id, adapter_ref: Id }).strict(), input);
  const value = state.descriptor_value.find(item => hash(item) === data.descriptor_ref);
  requireRule(value && !value.archived_or_inert, 'INVALID_FIELD', 'Descriptor is unavailable or inert');
  const definition = state.descriptor_definition.find(item => definitionRef(item) === value.definition_ref);
  requireRule(definition?.permitted_adapters.includes(data.adapter_ref), 'INVALID_SCOPE', 'Adapter is not registered for this definition');
  const adapted = await call(runtime, 'validateAdapter', { input_field: value, definition, adapter_ref: data.adapter_ref });
  if (!adapted.accepted) return { status: 'rejected', issues: [{ code: 'GRANT_REJECTED', message: 'Adapter rejected', refs: [] }] };
  const line = makeLine(state, parse(GrantInput, adapted.requested_command));
  requireRule(['system3', 'system5', 'system6', 'system10'].includes(line.owner_domain), 'INVALID_SCOPE', 'Descriptor adapter cannot provision arbitrary resources');
  if (state.creation_draft.target_class === 'PC' && line.owner_domain === 'system5') throw new IdentityError('INVALID_SCOPE', 'PC descriptions cannot become NPC behavioral commands');
  line.idempotency_key = stableId('adapter', state.creation_draft.branch_id, state.character_core.creation_lineage_id, data.descriptor_ref, data.adapter_ref);
  const receipt = await obtainReceipt(runtime, command, line); bump(state);
  appendEvent(state, command, 'DescriptorChanged', { input_field: data.descriptor_ref, adapter_ref: data.adapter_ref, predicate: adapted.predicate ?? null, reason: adapted.reason ?? null, receipt_ref: hash(receipt) }, ['domain_receipt', 'character_core', 'creation_draft']);
  return { status: receipt.status };
}

async function migrateDescriptor(runtime, command, input, authority) {
  requirePrivileged(authority); const state = runtime.state;
  lifecycle(state, ['DRAFT', 'READY', 'ACTIVE']);
  const data = parse(z.object({ from_definition_ref: Id, to_definition_ref: Id, mapping: z.array(z.object({ before: Json, after: Json }).strict()) }).strict(), input);
  requireRule(state.descriptor_definition.some(def => definitionRef(def) === data.to_definition_ref), 'INVALID_FIELD', 'Destination definition unavailable');
  const originals = state.descriptor_value.filter(value => value.definition_ref === data.from_definition_ref);
  for (const value of originals) {
    const mapping = data.mapping.filter(item => canonical(item.before) === canonical(value.value));
    value.archived_or_inert = true;
    if (mapping.length !== 1) {
      state.durable_recovery_state.quarantined_inputs.push({ descriptor_ref: hash(value), reason: 'unmapped_descriptor_value', definition_ref: data.to_definition_ref }); continue;
    }
    try {
      const mapped = validateDescriptor({ ...value, definition_ref: data.to_definition_ref, value: mapping[0].after, archived_or_inert: false, provenance: [...value.provenance, { kind: 'deterministic_migration', source_definition: data.from_definition_ref, command_ref: command.command_id }] }, state);
      state.descriptor_value.push(mapped);
    } catch (error) {
      state.durable_recovery_state.quarantined_inputs.push({ descriptor_ref: hash(value), reason: issue(error).code, definition_ref: data.to_definition_ref });
    }
  }
  if (state.creation_draft.lifecycle_state === 'READY') { state.creation_manifest = null; stage(state, 'DRAFT'); }
  bump(state); appendEvent(state, command, 'DescriptorChanged', { migration: data }, ['descriptor_value', 'character_core', 'creation_draft', 'creation_manifest']); return {};
}

async function migrateLegacy(runtime, command, input, authority) {
  requirePrivileged(authority); const state = runtime.state; active(state);
  const data = parse(z.object({ source_refs: z.array(Id) }).strict(), input);
  const receipts = [];
  for (const source of [...new Set(data.source_refs)]) {
    const key = stableId('legacy-handoff', state.character_core.creation_lineage_id, source);
    const prior = state.durable_recovery_state.outbox_entries.find(event => event.payload?.legacy_source === source && event.kind === 'OwnerGrantAcknowledged');
    if (prior) { receipts.push(prior.payload.receipt_ref); continue; }
    const mapped = await call(runtime, 'mapLegacyReceipt', { source_ref: source, subject: state.character_core.character_id });
    if (!mapped.mapped) {
      if (!state.durable_recovery_state.quarantined_inputs.some(item => item.legacy_source === source)) state.durable_recovery_state.quarantined_inputs.push({ legacy_source: source, reason: 'unmapped_legacy_receipt' });
      continue;
    }
    const line = makeLine(state, parse(GrantInput, mapped.request));
    requireRule(line.owner_domain === 'system10' && line.command_type === 'handoff_legacy_receipt', 'INVALID_SCOPE', 'Legacy mapping must target capability owner');
    line.idempotency_key = key;
    const receipt = await obtainReceipt(runtime, command, line); receipts.push(hash(receipt));
    appendEvent(state, command, 'OwnerGrantAcknowledged', { legacy_source: source, receipt_ref: hash(receipt) }, ['domain_receipt']); await checkpoint(runtime);
  }
  bump(state); appendEvent(state, command, 'DescriptorChanged', { migrated_receipt_refs: receipts }, ['character_core', 'creation_draft']);
  return { event_refs: receipts };
}

async function forkBranch(runtime, command, input, authority) {
  requirePrivileged(authority); const state = runtime.state; active(state);
  const data = parse(z.object({ branch_id: Id }).strict(), input);
  requireRule(data.branch_id !== command.branch_id, 'INVALID_FIELD', 'Fork needs a distinct branch');
  const branch = clone(state);
  branch.creation_draft.branch_id = data.branch_id;
  // Every inherited owner grant is already accepted. Delivery of inherited
  // creation events cannot cause a second opening or grant in the new branch.
  branch.durable_recovery_state.outbox_cursors = branch.durable_recovery_state.outbox_entries.map(event => event.id);
  branch.durable_recovery_state.prior_command_results = [];
  const branchCommand = { ...command, branch_id: data.branch_id };
  commandTimes.set(branchCommand, commandTimes.get(command));
  appendEvent(branch, branchCommand, 'DescriptorChanged', { branch_source: command.branch_id }, ['creation_draft', 'character_core']);
  const result = await call(runtime, 'persistIdentitySnapshot', { snapshot: branch, snapshot_hash: hash(branch) });
  requireRule(result.saved === true, 'OWNER_UNAVAILABLE', 'Branch checkpoint unresolved');
  return { branch_ref: data.branch_id, character_ref: branch.character_core.character_id };
}

async function importCard(runtime, command, input, authority) {
  const data = parse(z.object({ card: z.object({ schema_version: Id, audience: Id, projection: Json }).strict(), creation: CREATION_INPUT }).strict(), input);
  requireRule(data.card.schema_version === VERSION, 'INVALID_FIELD', 'Unsupported card schema; explicit migration required');
  const projection = data.card.projection;
  requireRule(projection && typeof projection === 'object' && !('domain_receipt' in projection) && !('creation_manifest' in projection) && !('grant_lines' in projection), 'INVALID_FIELD', 'Cards cannot import live grant state');
  const fields = [];
  for (const source of projection.identity_fact ?? []) {
    const fact = parse(State.shape.identity_fact.element, source);
    const stored = JSON.parse(fact.value_json);
    requireRule(['CONFIRMED', 'EXPLICIT_NONE'].includes(stored.field_state), 'INVALID_FIELD', 'Invalid exported fact');
    fields.push({ field_key: fact.field_key, field_state: 'PROPOSED', ...(stored.value === undefined ? {} : { value: stored.value }), origin: { kind: 'imported', source_span: fact.value_json }, effective_interval: { start: data.creation.start_time, end: null }, authority: authority.principal_id, visibility: fact.disclosure_policy_id, review_disposition: 'disputed' });
  }
  // The authored new draft is independent of the old person and all old receipts.
  const result = await createDraft(runtime, command, data.creation, authority);
  runtime.state.creation_draft.accepted_proposals.push(...fields);
  runtime.state.creation_draft.pending_choices = fields.length ? [{ code: 'NEEDS_CHOICE', reason: 'Review imported identity proposals; grants require new validation' }] : [];
  appendEvent(runtime.state, command, 'CreationDraftEdited', { imported_card_hash: hash(data.card) }, ['creation_draft']);
  return result;
}

async function endKinship(runtime, command, input, authority) {
  const state = runtime.state; active(state); requirePrivileged(authority);
  const data = parse(z.object({ kinship_ref: Id, effective_time: z.string(), source_event: Id, owner_domain: Id }).strict(), input);
  const edge = state.kinship_edge.find(item => hash(item) === data.kinship_ref);
  requireRule(edge && edge.relationship_type !== 'biological_parent', 'INVALID_SCOPE', 'Biological parentage cannot end through a lifecycle event');
  const evidence = await call(runtime, 'fetchOwnerEvent', { owner_domain: data.owner_domain, source_event: data.source_event });
  requireRule(evidence.authenticated && evidence.event?.source_event === data.source_event && evidence.event?.subject === state.character_core.character_id, 'INVALID_SCOPE', 'Kinship ending requires committed source');
  const ended = { ...edge, effective_interval: { ...edge.effective_interval, end: data.effective_time }, evidence: [...edge.evidence, data.source_event] };
  intervalBounds(ended.effective_interval);
  // Projection changes; the establishing event retains the original interval.
  state.kinship_edge[state.kinship_edge.indexOf(edge)] = ended; bump(state);
  appendEvent(state, command, 'KinshipIntervalEnded', { before: data.kinship_ref, after: hash(ended), source_event: data.source_event }, ['kinship_edge', 'character_core', 'creation_draft']); return {};
}

function hookReference(hook) { return hash({ ...hook, active_interval: { start: hook.active_interval.start, end: null }, activation_source_refs: [], resolution_receipts: [] }); }
async function hookOperation(runtime, command, input, authority) {
  const state = runtime.state; active(state);
  if (command.operation === 'register_hook') {
    const hook = parse(Hook, input);
    requireRule(hook.underlying_record_refs.length > 0 && hook.activation_source_refs.length === 0 && hook.resolution_receipts.length === 0, 'INVALID_FIELD', 'Hook requires existing records and no fabricated receipts');
    intervalBounds(hook.active_interval); hook.allowed_response_windows.forEach(intervalBounds); safeObject(hook.activation_predicates);
    const accepted = state.domain_receipt.flatMap(receipt => receipt.status === 'accepted' && receipt.owner_domain === hook.owner ? receipt.canonical_event_refs : []);
    requireRule(hook.underlying_record_refs.every(ref => accepted.includes(ref)), 'INVALID_SCOPE', 'Hook record is not backed by an accepted receipt');
    const hookRef = hookReference(hook);
    if (!state.starting_hook.some(item => hookReference(item) === hookRef)) state.starting_hook.push(hook);
    bump(state); appendEvent(state, command, 'DescriptorChanged', { hook_ref: hookRef }, ['starting_hook', 'character_core', 'creation_draft']); return { hook_ref: hookRef };
  }
  const data = parse(z.object({ hook_ref: Id, source_event: Id }).strict(), input);
  const hook = state.starting_hook.find(item => hookReference(item) === data.hook_ref);
  requireRule(hook, 'INVALID_FIELD', 'Unknown hook');
  if (hook.activation_source_refs.includes(data.source_event)) return {};
  const event = await call(runtime, 'fetchOwnerEvent', { owner_domain: hook.owner, source_event: data.source_event });
  requireRule(event.authenticated === true && event.event?.source_event === data.source_event, 'INVALID_SCOPE', 'Hook trigger requires authenticated event');
  const predicates = await call(runtime, 'evaluateHookPredicates', { hook, event: event.event });
  if (!(predicates.satisfied && predicates.knowledge_valid && predicates.opportunity_valid)) return { status: 'dormant', evaluated_predicates: predicates.evaluated_predicates ?? [] };
  requireRule(contains(hook.active_interval, event.event.interval) && hook.allowed_response_windows.some(window => contains(window, event.event.interval)), 'INVALID_SCOPE', 'Hook trigger outside approved interval');
  requireRule(predicates.request && predicates.request.owner_domain === hook.owner, 'INVALID_FIELD', 'Hook owner omitted a typed request');
  const line = makeLine(state, parse(GrantInput, predicates.request));
  line.idempotency_key = stableId('hook', state.creation_draft.branch_id, state.character_core.creation_lineage_id, data.hook_ref, data.source_event);
  const receipt = await obtainReceipt(runtime, command, line);
  if (receipt.status === 'accepted') {
    hook.activation_source_refs.push(data.source_event); hook.resolution_receipts.push(hash(receipt));
    if (predicates.resolved === true) { hook.active_interval.end = event.event.interval.end ?? event.event.interval.start; intervalBounds(hook.active_interval); }
  }
  bump(state); appendEvent(state, command, 'DescriptorChanged', { hook_ref: data.hook_ref, receipt_ref: hash(receipt) }, ['starting_hook', 'character_core', 'creation_draft']); return { status: receipt.status };
}

async function flushOutbox(runtime, command) {
  const state = runtime.state;
  for (const entry of state.durable_recovery_state.outbox_entries) {
    if (state.durable_recovery_state.outbox_cursors.includes(entry.id)) continue;
    let result;
    if (entry.kind === 'dependency_repair_request') result = await call(runtime, 'requestDependencyRepair', { ...entry.payload, idempotency_key: entry.id });
    else if (entry.kind === 'CharacterActivated') result = await call(runtime, 'publishOpening', { character_id: state.character_core.character_id, placement: state.creation_draft.start_placement, source_event: entry.id });
    else result = await call(runtime, 'publishIdentityEvent', { event_ref: entry.id, kind: entry.kind, world_id: command.world_id, branch_id: command.branch_id });
    requireRule(result.delivered === true || result.accepted === true, 'OWNER_UNAVAILABLE', 'Outbox not acknowledged');
    state.durable_recovery_state.outbox_cursors.push(entry.id); await checkpoint(runtime);
  }
  return {};
}

async function dispatch(runtime, command, payload, authority) {
  const state = runtime.state;
  switch (command.operation) {
    case 'create_draft': return createDraft(runtime, command, payload, authority);
    case 'import_card': return importCard(runtime, command, payload, authority);
    case 'edit_draft': return editDraft(runtime, command, payload, authority);
    case 'validate_creation': return validateCreation(runtime, command, payload, authority);
    case 'prepare_creation': parse(EMPTY, payload); return prepare(runtime, command);
    case 'commit_creation': case 'recover_creation': parse(EMPTY, payload); return commit(runtime, command);
    case 'cancel_creation': parse(EMPTY, payload); return cancel(runtime, command);
    case 'ingest_owner_event': return ownerEvent(runtime, command, payload);
    case 'record_claim': {
      active(state); const claim = validateClaim(payload);
      requireRule(claim.subject === state.character_core.character_id && claim.authority === command.principal_id, 'INVALID_SCOPE', 'Claim author/subject mismatch');
      if (!state.identity_claim.some(item => hash(item) === hash(claim))) {
        state.identity_claim.push(claim); bump(state);
        appendEvent(state, command, 'IdentityClaimRecorded', { claim_ref: hash(claim) }, ['identity_claim', 'character_core', 'creation_draft']);
      }
      return {};
    }
    case 'establish_kinship': {
      active(state); const data = parse(z.object({ edge: Kinship, owner_domain: Id, source_event: Id }).strict(), payload);
      requireRule([data.edge.source_person, data.edge.target_person].includes(state.character_core.character_id), 'INVALID_SCOPE', 'Kinship must involve this identity');
      const evidence = await call(runtime, 'fetchOwnerEvent', { owner_domain: data.owner_domain, source_event: data.source_event });
      requireRule(evidence.authenticated === true && evidence.event?.source_event === data.source_event && data.edge.evidence.includes(data.source_event), 'INVALID_SCOPE', 'Kinship requires authenticated source evidence');
      const world = await call(runtime, 'readWorldConfiguration'); validateKinship([data.edge], [...state.kinship_edge, ...(world.ancestry_edges ?? [])]);
      for (const id of [data.edge.source_person, data.edge.target_person]) {
        if (id === state.character_core.character_id) continue;
        const person = await call(runtime, 'resolvePerson', { character_id: id, proposed_kinship: data.edge });
        requireRule(person.exists && person.compatible, 'INCOMPATIBLE_EXISTING_PERSON', 'Kinship compatibility rejected');
      }
      if (!state.kinship_edge.some(edge => hash(edge) === hash(data.edge))) {
        state.kinship_edge.push(data.edge); bump(state);
        appendEvent(state, command, 'KinshipEstablished', { edge_ref: hash(data.edge), source_event: data.source_event }, ['kinship_edge', 'character_core', 'creation_draft']);
      }
      return {};
    }
    case 'correct_fact': return correctFact(runtime, command, payload, authority);
    case 'propose_development': return develop(runtime, command, payload, authority);
    case 'generate_fields': return generate(runtime, command, payload, authority);
    case 'import_biography': return importBiography(runtime, command, payload, authority);
    case 'register_descriptor': case 'retire_descriptor': case 'set_descriptor': return descriptorOperation(runtime, command, payload, authority);
    case 'apply_descriptor_adapter': return descriptorAdapter(runtime, command, payload, authority);
    case 'migrate_descriptor': return migrateDescriptor(runtime, command, payload, authority);
    case 'migrate_legacy_receipts': return migrateLegacy(runtime, command, payload, authority);
    case 'fork_branch': return forkBranch(runtime, command, payload, authority);
    case 'end_kinship': return endKinship(runtime, command, payload, authority);
    case 'register_hook': case 'evaluate_hook': return hookOperation(runtime, command, payload, authority);
    case 'flush_outbox': parse(EMPTY, payload); return flushOutbox(runtime, command);
    case 'project': parse(EMPTY, payload); return {};
    case 'preview': {
      parse(EMPTY, payload); lifecycle(state, ['READY']); requireHash(state, command);
      const audience = await call(runtime, 'readAudience');
      requireRule(['author', 'creator', 'developer'].includes(audience.audience_entitlement) && (privileged(authority) || authority.principal_id === state.creation_draft.creator_principal), 'INVALID_SCOPE', 'Author review is required');
      return { manifest_ref: state.creation_manifest.manifest_hash, preview: { reviewed_facts: clone(state.creation_manifest.reviewed_facts.filter(field => field.visibility !== 'developer' || authority.role === 'developer')), grant_lines: state.creation_manifest.grant_lines.map(line => ({ line_id: line.line_id, required: line.required, owner_domain: line.owner_domain, quantity_or_amount: line.quantity_or_amount ?? null, fallback: line.fallback })), owner_availability_snapshot: clone(state.creation_manifest.owner_availability_snapshot) } };
    }
    case 'inspect': parse(EMPTY, payload); requireRule(authority.role === 'developer', 'INVALID_SCOPE', 'Developer scope required'); return { traces: clone(state.decision_trace), receipts: clone(state.domain_receipt) };
    case 'snapshot': parse(EMPTY, payload); requireRule(authority.role === 'developer', 'INVALID_SCOPE', 'Privileged backup required'); return { snapshot: clone(state), snapshot_hash: hash(state) };
    case 'export_card': parse(EMPTY, payload); return { card: { schema_version: VERSION, audience: (await call(runtime, 'readAudience')).selected_export_audience, projection: await audienceProjection(runtime, authority) } };
    case 'age_eligibility': {
      const data = parse(z.object({ minimum: z.number().int().nonnegative() }).strict(), payload);
      const projection = await audienceProjection(runtime, authority);
      const fact = projection.identity_fact?.find(item => item.field_key === 'birth_date_or_interval');
      const birth = projection.creation_draft ? birthFrom(state) : fact ? JSON.parse(fact.value_json).value : null;
      requireRule(birth, 'NEEDS_CHOICE', 'Birth constraint unresolved');
      const world = await call(runtime, 'readWorldConfiguration');
      const result = ageEligibility(birth, inWorldTimezone(world.simulation_time, world.timezone), data.minimum);
      return { status: result === 'needs_choice' ? 'needs_choice' : 'ok', eligibility: result };
    }
    case 'revoke_delegation': {
      lifecycle(state, ['DRAFT', 'READY', 'PREPARING', 'COMMITTING', 'RECOVERY_REQUIRED', 'ACTIVE']);
      const data = parse(z.object({ scope_ref: Id }).strict(), payload);
      const scope = state.creation_draft.delegation_scopes.find(item => hash(item) === data.scope_ref);
      requireRule(scope, 'INVALID_SCOPE', 'Delegation not found'); scope.revoked = true;
      if (state.creation_draft.lifecycle_state === 'READY') { state.creation_manifest = null; stage(state, 'DRAFT'); }
      bump(state); appendEvent(state, command, 'CreationDraftEdited', { revoked_scope: data.scope_ref }, ['creation_draft', 'creation_manifest', 'character_core']); return {};
    }
    case 'author_identity_change': case 'author_self_description': {
      active(state); const field = parse(Field, payload);
      const allowed = command.operation === 'author_self_description' ? ['personality_descriptors', 'values', 'boundaries', 'authored_practices'] : ['preferred_name', 'aliases', 'pronouns', 'gender_identity', 'cultural_affiliations', 'authored_use_preferences', 'preferred_communication_channels'];
      requireRule(allowed.includes(field.field_key) && field.origin.kind === 'player_authored' && command.principal_id === state.creation_draft.control_principal, 'INVALID_SCOPE', 'Explicit player identity authorship required');
      validateField(field, state, authority); requireRule(field.field_state === 'CONFIRMED' && field.review_disposition === 'accepted', 'NEEDS_CHOICE', 'Identity change requires confirmation');
      requireRule(bounds(field.effective_interval.start)[0] === bounds(commandTimes.get(command))[0], 'INVALID_SCOPE', 'In-world changes use current simulation time; backdating requires a correction');
      const old = sourceFacts(state, field.effective_interval.start).find(fact => fact.field_key === field.field_key);
      writeFact(state, command, field, old?.fact_id ?? null, 'IdentityFactRecorded'); bump(state);
      appendEvent(state, command, 'DescriptorChanged', { field_key: field.field_key }, ['character_core', 'creation_draft']); return {};
    }
    case 'accept_promotion': {
      active(state); requirePrivileged(authority); requireRule(state.creation_draft.target_class === 'NPC', 'INVALID_SCOPE', 'Only NPCs can be promoted');
      const data = parse(z.object({ proposal_refs: z.array(Id) }).strict(), payload);
      for (const ref of data.proposal_refs) {
        const proposal = state.creation_draft.accepted_proposals.find(item => hash(item) === ref);
        requireRule(proposal && !state.identity_fact.some(fact => fact.field_key === proposal.field_key) && !state.creation_draft.fields.some(field => field.field_key === proposal.field_key && field.field_state !== 'UNSPECIFIED'), 'INCOMPATIBLE_EXISTING_PERSON', 'Promotion cannot rewrite established facts');
        const field = { ...proposal, field_state: 'CONFIRMED', review_disposition: 'accepted' };
        validateField(field, state, authority); writeFact(state, command, field); state.creation_draft.fields.push(field);
      }
      bump(state); appendEvent(state, command, 'DescriptorChanged', { promotion_refs: data.proposal_refs }, ['creation_draft', 'character_core']); return {};
    }
    case 'archive': {
      active(state); requirePrivileged(authority); const data = parse(z.object({ source_event: Id }).strict(), payload);
      requireRule(state.biography_entry.some(entry => entry.source_event_id === data.source_event && ['death', 'incarceration', 'disappearance'].includes(entry.kind)), 'INVALID_SCOPE', 'Archiving requires authoritative lifecycle evidence');
      bump(state); appendEvent(state, command, 'CharacterArchived', data, ['character_core', 'creation_draft']); return {};
    }
    case 'set_defaults': {
      lifecycle(state, ['DRAFT', 'READY', 'ACTIVE']);
      requirePrivileged(authority); const data = parse(z.object({ versioned_defaults: State.shape.versioned_defaults, ruleset_version: Id }).strict(), payload);
      const result = await call(runtime, 'validateConfigurationChange', data);
      requireRule(result.accepted && result.storage_performance_tests_passed, 'INVALID_FIELD', 'Configuration change not validated');
      state.versioned_defaults = data.versioned_defaults;
      if (state.creation_draft.lifecycle_state === 'READY') { state.creation_manifest = null; stage(state, 'DRAFT'); }
      bump(state);
      appendEvent(state, command, 'DescriptorChanged', data, ['versioned_defaults', 'character_core', 'creation_draft', 'creation_manifest']); return {};
    }
    default: throw new IdentityError('INVALID_FIELD', 'Unknown operation');
  }
}

async function run(runtime, input) {
  let request, authority;
  try { request = parse(Request, input); authority = await authenticate(runtime, request.command); }
  catch (error) { return { status: 'rejected', revision: null, issues: [{ code: error.code === 'INVALID_FIELD' ? 'INVALID_FIELD' : 'INVALID_SCOPE', message: 'Request unavailable', refs: [] }], event_refs: [], owner_request_statuses: [], pending_choices: [], trace_id: null, audience_projection: {} }; }
  const { command, payload } = request, requestHash = hash(request);
  const previous = runtime.state.durable_recovery_state.prior_command_results.find(item => item.command_id === command.command_id && item.branch_id === command.branch_id);
  if (previous) {
    if (previous.request_hash !== requestHash) return response(runtime, authority, { status: 'rejected', revision: revision(runtime.state), issues: [{ code: 'IDEMPOTENCY_CONFLICT', message: 'Command payload changed', refs: [] }], event_refs: [], owner_request_statuses: [], pending_choices: [], trace_id: null });
    if (previous.result && previous.result.status !== 'pending') return response(runtime, authority, previous.result);
  }
  runtime.rollback = clone(runtime.state);
  let details = {}, blockers = [];
  try {
    commandTimes.set(command, (await call(runtime, 'readWorldConfiguration')).simulation_time);
    requireRule(previous || command.expected_revision === revision(runtime.state), 'STALE_REVISION', 'Draft revision changed');
    requireRule(['create_draft', 'import_card'].includes(command.operation) || runtime.state.creation_draft, 'INVALID_SCOPE', 'No draft available');
    if (!READ_OPERATIONS.has(command.operation) && runtime.state.creation_draft && !previous) {
      runtime.state.durable_recovery_state.prior_command_results.push({ command_id: command.command_id, branch_id: command.branch_id, request_hash: requestHash, result: null });
      // A durable command binding precedes all side effects, including reservations.
      await checkpoint(runtime);
    }
    details = await dispatch(runtime, command, payload, authority);
    blockers = details.issues ?? [];
  } catch (error) {
    runtime.state = clone(runtime.rollback);
    blockers = [issue(error)]; details = { status: 'rejected' };
    if (['COMMITTING', 'RECOVERY_REQUIRED'].includes(runtime.state.creation_draft?.lifecycle_state)) {
      stage(runtime.state, 'RECOVERY_REQUIRED'); details.status = 'pending';
      appendEvent(runtime.state, command, 'CreationRecoveryRequired', { issues: blockers }, ['creation_draft', 'character_core']);
    }
  }
  const state = runtime.state;
  const traceId = state.creation_draft && !READ_OPERATIONS.has(command.operation) ? trace(state, command, blockers, details.event_refs ?? [], details.evaluated_predicates ?? []) : null;
  const result = {
    status: details.status ?? 'ok', revision: revision(state), event_refs: details.event_refs ?? [],
    owner_request_statuses: (state.creation_manifest?.grant_lines ?? []).map(line => ({ line_id: line.line_id, status: line.status })),
    pending_choices: clone(state.creation_draft?.pending_choices ?? []), trace_id: traceId,
    ...details, issues: blockers.map(item => ({ code: item.code, message: item.code, refs: [] })),
  };
  if (blockers.some(item => ['OWNER_UNAVAILABLE', 'DOMAIN_UNAVAILABLE', 'RECOVERY_PENDING'].includes(item.code))) result.status = 'pending';
  if (blockers.some(item => item.code === 'STALE_REVISION')) result.field_diff = (state.creation_draft?.fields ?? []).filter(field => field.visibility !== 'developer' || authority.role === 'developer').map(field => ({ field_key: field.field_key, current_hash: hash(field) }));
  // Reads are pure. Pending command bindings remain resumable with the same payload.
  if (!READ_OPERATIONS.has(command.operation) && state.creation_draft) {
    const bound = state.durable_recovery_state.prior_command_results.find(item => item.command_id === command.command_id && item.branch_id === command.branch_id);
    if (bound) bound.result = clone(result);
    else state.durable_recovery_state.prior_command_results.push({ command_id: command.command_id, branch_id: command.branch_id, request_hash: requestHash, result: clone(result) });
    try { await checkpoint(runtime); }
    catch { return response(runtime, authority, { ...result, status: 'pending', issues: [{ code: 'RECOVERY_PENDING', message: 'Checkpoint acknowledgment pending', refs: [] }] }); }
  }
  return response(runtime, authority, result);
}

export class CharacterIdentityDevelopment {
  constructor(dependencies = {}) {
    instances.set(this, { state: emptyState(), ports: createMockDependencies(dependencies), queue: Promise.resolve(), rollback: emptyState() });
    // Read-only copies of exactly the architecture's state structures.
    for (const key of SNAPSHOT_KEYS) Object.defineProperty(this, key, { enumerable: true, get: () => clone(instances.get(this).state[key]) });
    Object.freeze(this);
  }

  /** @param {{command: object, payload: object}} request @returns {Promise<object>} JSON response */
  execute(request) {
    const runtime = instances.get(this);
    let copied;
    try { canonical(request); copied = clone(request); } catch { return Promise.resolve({ status: 'rejected', issues: [{ code: 'INVALID_FIELD' }], audience_projection: {} }); }
    const pending = runtime.queue.then(() => run(runtime, copied));
    runtime.queue = pending.catch(() => {}); return pending;
  }

  /** Restore accepts only the trusted persistence stub's response, never client JSON. */
  async restore() {
    const runtime = instances.get(this);
    const pending = runtime.queue.then(async () => {
      const loaded = await call(runtime, 'loadIdentitySnapshot');
      if (!loaded.found) return { status: 'not_found' };
      const state = parse(State, loaded.snapshot);
      requireRule(loaded.snapshot_hash === hash(state), 'INVALID_FIELD', 'Snapshot hash mismatch');
      if (state.creation_manifest) requireRule(manifestHash(state.creation_manifest) === state.creation_manifest.manifest_hash, 'INVALID_FIELD', 'Corrupt manifest');
      if (state.creation_draft?.lifecycle_state === 'ACTIVE') requireRule(state.creation_manifest && state.creation_manifest.grant_lines.filter(line => line.required).every(line => lineSatisfied(state.creation_manifest, line)), 'RECOVERY_PENDING', 'Active snapshot lacks required receipts');
      for (const line of state.creation_manifest?.grant_lines ?? []) if (line.status === 'accepted') {
        requireRule(line.receipt_refs.length > 0, 'RECOVERY_PENDING', 'Accepted line lacks receipt');
        for (const ref of line.receipt_refs) {
          const receipt = state.domain_receipt.find(item => hash(item) === ref); requireRule(receipt, 'RECOVERY_PENDING', 'Missing receipt'); await verifyReceipt(runtime, ownerRequest(line), receipt);
        }
      }
      validateKinship(state.kinship_edge); runtime.state = state; runtime.rollback = clone(state);
      return { status: 'restored', revision: revision(state) };
    });
    runtime.queue = pending.catch(() => {}); return pending;
  }
}

/** Pure event-order projection rebuild for trusted persistence/recovery tooling. */
export function rebuildIdentityProjections(snapshot) {
  const original = parse(State, snapshot), rebuilt = emptyState();
  for (const event of original.durable_recovery_state.outbox_entries) {
    for (const [key, value] of Object.entries(event.accepted_effects ?? {})) {
      requireRule(SNAPSHOT_KEYS.includes(key) && key !== 'durable_recovery_state', 'INVALID_FIELD', 'Invalid projection patch');
      rebuilt[key] = clone(value);
    }
  }
  rebuilt.durable_recovery_state = clone(original.durable_recovery_state);
  rebuilt.decision_trace = clone(original.decision_trace);
  return parse(State, rebuilt);
}
