/**
 * Isolated System 18. Node.js 22+, no packages or external services.
 *
 * All timestamps are canonical UTC ISO-8601 strings. Ref values are either
 * "Table/id" references or embedded JSON; neither reference form executes code.
 * State contains only the record/payload types declared by the architecture.
 * Event payloads hold audit data, command fingerprints, and idempotent results.
 *
 * Unspecified rules MUST be supplied in ModelConfiguration records. The embedded
 * deterministic_prerequisites_ref has this declarative shape:
 *   { templates, objectives, methods, actions, transitions, era_refs,
 *     encounter_statuses, care_statuses, ordering, terminal_projection,
 *     terminal_states, resolved_states, allowed_mechanisms }
 * A template supplies { kind, initial_state, truth, payloads, effects,
 *   boundary_after_ms, exposure_profile?, exposure_payload?, module? }.
 * Effects supply { channel, action_class, value_ref: { magnitude, restriction,
 *   reason, alternatives }, composition_group, duration_ms }.
 * A transition supplies { from, to, when, after_ms, end_effects, effects,
 *   truth_patch, payload_patches, terminal_eligible, stop, uncertainty_ref? }.
 * Predicates support all/any/not, eq/ne/lt/lte/gt/gte/includes/exists against
 * the explicitly provided health context; there is no eval or arbitrary code.
 * "none" is an explicit uncertainty-free milestone; no probabilities or medical
 * thresholds are invented. Missing rules fail closed.
 *
 * Dependencies are stateless fixture functions. They NEVER implement another
 * system and NEVER claim a real-world/external commit. For isolated testing,
 * a fixture may declare { fixture_outcome: "committed", data: {...} }.
 * Default fixtures are pending. Every API response is labeled isolated/mock.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** @typedef {null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue}} JSONValue */
/** @typedef {{[key:string]:JSONValue}} JSONObject */
/** @typedef {{command:string, actor_ref:string, target:string, canonical_time:string,
 * expected_revision:number, correlation_id:string, idempotency_key:string,
 * authority_ref:JSONValue, cause_ref:JSONValue, rules_version:string,
 * payload:JSONObject}} Command */

const SCHEMAS = Object.freeze({
  health_record: 'character_id:s baseline_version:s baseline_ref:r function_projection:FunctionalProjection terminal_event_id:s?',
  episode: 'id:s character_id:s kind:s incident_id:s region_ref:r onset_at:t state:s model_version:s truth_ref:r next_boundary_at:t? revision:i',
  effect: 'id:s episode_id:s channel:s action_class:s value_ref:r starts_at:t expires_at:t? composition_group:s',
  exposure: 'id:s character_id:s source_item_id:s profile_version:s abstract_band:s route_kind:s occurred_at:t event_id:s',
  encounter: 'id:s facility_id:s patient_ref:r identity_confidence:s started_at:t status:s responsible_role_ref:r',
  assessment: 'id:s encounter_id:s author_id:s method_ref:r findings_ref:r confidence:j supersedes_id:s?',
  care_action: 'id:s encounter_id:s objective_ref:r actor_id:s authority_ref:r resource_refs:a status:s starts_at:t completes_at:t outcome_event_id:s?',
  plan: 'id:s patient_ref:r source_assessment_id:s instructions_ref:r review_at:t visibility_policy:r version:s',
  record_access: 'id:s record_ref:r actor_id:s purpose_ref:r policy_version:s occurred_at:t outcome:s',
  health_event: 'id:s correlation_id:s idempotency_key:s occurred_at:t processed_at:t actor_ref:r cause_ref:r rules_version:s payload_ref:r',
  Baseline: 'anatomy_ref:r baseline_function_ref:r usual_stamina:j established_condition_refs:a allergy_sensitivity_history:j prescribed_support_refs:a injury_history_refs:a long_term_transition_event_refs:a',
  FunctionalProjection: 'consciousness:s breathing_concern:j circulation_concern:j mobility:j hand_use:j pain_burden:j stamina:j fatigue:j exertion_tolerance:j immediate_danger:j source_effect_refs:a',
  EpisodeModelPayload: 'cause_event_ref:r mechanism:s severity:s exposure_context_ref:r resolved_extent_ref:r current_flags:a treatment_refs:a visibility_policy_ref:r resolution_state:s recovery_phase:s milestone_refs:a monitoring_refs:a complication_refs:a lasting_effect_refs:a',
  WoundPayload: 'depth_category:s contamination_context_ref:r closure_status:s healing_phase:s bleeding_source_refs:a',
  BleedingSource: 'episode_id:s state:s cumulative_loss:n progression_model_ref:r internal_loss:j',
  MusculoskeletalPayload: 'stability:s supported_function_ref:r support_item_refs:a structural_recovery_milestone_refs:a functional_recovery_milestone_refs:a',
  HeadInjuryPayload: 'awareness_effect_refs:a memory_formation_effect_refs:a recall_limitation_refs:a balance_effect_refs:a concentration_effect_refs:a',
  BurnPayload: 'affected_region_refs:a extent_band:s depth_band:s source_ref:r ongoing_exposure:b systemic_concern:j recovery_phase:s',
  DiseasePayload: 'family:s exposure_event_ref:r? incubation_state:j symptomatic_course_ref:r transmission_model_ref:r?',
  SubstanceProfile: 'era_metadata_ref:r effect_categories:a onset_model_ref:r duration_decay_model_ref:r interaction_groups:a dependence_potential:j content_visibility_policy_ref:r',
  ExposurePayload: 'source_ref:r actor_ref:r exposure_context:s intent_visibility:j plan_ref:r? administration_units:j consumption_commit_ref:r? cumulative_exposure:j active_timing_ref:r supported_modifier_refs:a applied_interaction_refs:a',
  SubstanceHistory: 'supporting_event_refs:a established_background_ref:r? tolerance_by_category:o dependence_by_category:o withdrawal_episode_refs:a',
  PlanPayload: 'purpose_ref:r prescriber_or_source_ref:r abstract_schedule_ref:r duration:j review_conditions_ref:r interaction_refs:a intended_effect_refs:a activity_restriction_refs:a warning_condition_refs:a follow_up_refs:a',
  ClinicalRecordPayload: 'encounter_ref:r author_ref:r occurred_at:t entered_at:t entry_type:s content_refs:a amendment_refs:a access_policy_ref:r',
  CareDecisionPayload: 'offer_ref:r actor_ref:r occurred_at:t information_offered_ref:r response:s conditions_ref:r? scope_ref:r standing_preference_ref:r? incapacity_reason_ref:r? authority_policy_ref:r?',
  PendingWorkflowPayload: 'workflow_ref:r step_ref:r status:s external_commit_refs:a outstanding_order_refs:a unopened_result_refs:a scheduled_review_refs:a',
  StoredResolution: 'event_ref:r seeded_input_ref:r resolved_outcome_ref:r rules_version:s',
  TerminalPayload: 'cause_chain_refs:a policy_ref:r terminal_capability_state_ref:r body_entity_ref:r campaign_lineage_ref:r',
  CampaignConfiguration: 'detailed_needs_enabled:b communicable_disease_enabled:b withdrawal_enabled:b finality_policy:s default_grounded_finality:s content_settings_ref:r care_authority_policy_ref:r privacy_policy_ref:r era_manifest_ref:r enabled_template_refs:a numeric_manifest_version:s event_ordering_policy_version:s migration_policy_ref:r',
  ModelConfiguration: 'transition_windows:j deterministic_prerequisites_ref:r uncertain_milestone_refs:a stop_conditions_ref:r composition_rules:o numeric_units:j numeric_bounds:j tuning_purpose:s affected_template_refs:a'
});
const TYPES = Object.keys(SCHEMAS);
const STATES = new Set(['alert', 'impaired', 'unresponsive', 'recovering']);
const COMMANDS = new Set(['CreateInjury', 'RecordExposure', 'RequestAssessment', 'OfferCare',
  'RespondToCare', 'CompleteCare', 'AdvanceEpisode', 'AmendAssessment', 'AuthorizeDisclosure', 'CommitDeath']);
const QUERIES = new Set(['GetKnownHealth', 'GetObservedFunction', 'GetEncounterView',
  'GetAvailableCare', 'GetRecoverySummary', 'GetAuthorizedRecord', 'EvaluateAction']);
const DEPS = Object.freeze({
  character: 'System 9', resolution: 'System 10', time: 'System 11', location: 'System 12',
  work: 'System 13', economy: 'System 14', objects: 'System 15', communication: 'System 16',
  vehicles: 'System 17', hazard: 'Conflict/hazard', knowledge: 'Knowledge/memory',
  consent: 'Consent/authority', relationships: 'Relationships', evidence: 'Evidence/institutions',
  campaign: 'Campaign/content', presentation: 'Player/UI/narration'
});
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const clone = value => structuredClone(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function json(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(json); return; }
  if (isObject(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) {
      need(!FORBIDDEN_KEYS.has(key), 'invalid_input'); json(item);
    }
    return;
  }
  fail('invalid_input');
}
function canonical(value) {
  json(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const stableID = (...parts) => hash(parts);
function fail(code) { throw new HealthError(code); }
function need(test, code = 'missing_configuration') { if (!test) fail(code); }
class HealthError extends Error { constructor(code) { super(code); this.code = code; } }
class Pending extends Error { constructor(receipt) { super('unresolved_workflow'); this.receipt = receipt; } }
function time(value) {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), 'invalid_time');
  const ms = Date.parse(value);
  need(Number.isFinite(ms) && new Date(ms).toISOString() === value, 'invalid_time');
  return ms;
}
function after(at, ms) {
  need(Number.isSafeInteger(ms) && ms > 0, 'missing_configuration');
  return new Date(time(at) + ms).toISOString();
}
function exact(value, names) {
  need(isObject(value), 'invalid_input');
  need(Object.keys(value).every(k => names.includes(k)) && names.every(k => Object.hasOwn(value, k)), 'invalid_input');
}
function validate(type, value) {
  need(Object.hasOwn(SCHEMAS, type), 'invalid_input'); json(value);
  const fields = SCHEMAS[type].split(' ').map(f => f.split(':'));
  exact(value, fields.map(([k]) => k));
  for (const [field, spec] of fields) {
    const v = value[field], optional = spec.endsWith('?'), t = spec.replace('?', '');
    if (optional && v === null) continue;
    if (t === 'j') continue;
    if (t === 'r') { need(v !== null, 'invalid_input'); continue; }
    if (t === 's') need(typeof v === 'string' && v.length > 0, 'invalid_input');
    else if (t === 't') time(v);
    else if (t === 'i') need(Number.isSafeInteger(v) && v >= 0, 'invalid_input');
    else if (t === 'n') need(typeof v === 'number' && Number.isFinite(v), 'invalid_input');
    else if (t === 'b') need(typeof v === 'boolean', 'invalid_input');
    else if (t === 'a') need(Array.isArray(v), 'invalid_input');
    else if (t === 'o') need(isObject(v), 'invalid_input');
    else validate(t, v);
  }
  if (type === 'FunctionalProjection') need(STATES.has(value.consciousness), 'invalid_input');
  if (type === 'EpisodeModelPayload') need(['minor', 'moderate', 'serious', 'critical'].includes(value.severity), 'invalid_input');
  if (type === 'BleedingSource') need(value.cumulative_loss >= 0 && ['active', 'reduced', 'controlled', 'recurrent'].includes(value.state), 'invalid_input');
  if (type === 'encounter') need(['confirmed', 'uncertain', 'withheld'].includes(value.identity_confidence), 'invalid_input');
  if (type === 'CampaignConfiguration') {
    need(['permanent death', 'explicit checkpoint recovery', 'lower-lethality scenario'].includes(value.finality_policy), 'invalid_input');
    need(value.default_grounded_finality === 'permanent death', 'invalid_input');
  }
}

/** Only the declared state tables are stored; callers receive defensive copies. */
export class HealthState {
  constructor(snapshot = {}) {
    json(snapshot);
    need(Object.keys(snapshot).every(k => TYPES.includes(k)), 'invalid_input');
    for (const type of TYPES) {
      const table = snapshot[type] ?? {};
      need(isObject(table), 'invalid_input');
      this[type] = Object.create(null);
      for (const [id, value] of Object.entries(table)) {
        need(id.length > 0 && !FORBIDDEN_KEYS.has(id), 'invalid_input');
        validate(type, value); this[type][id] = clone(value);
        if (Object.hasOwn(value, 'id')) need(value.id === id, 'invalid_input');
      }
    }
    const keys = new Set();
    for (const e of Object.values(this.health_event)) {
      need(!keys.has(e.idempotency_key), 'invalid_input'); keys.add(e.idempotency_key);
    }
    for (const e of Object.values(this.episode)) {
      need(this.health_record[e.character_id] && this.ModelConfiguration[e.model_version], 'invalid_input');
      validate('EpisodeModelPayload', resolve(this, e.truth_ref));
    }
    for (const e of Object.values(this.effect)) need(this.episode[e.episode_id], 'invalid_input');
    for (const e of Object.values(this.exposure)) need(this.health_record[e.character_id] && this.health_event[e.event_id] && this.SubstanceProfile[e.profile_version], 'invalid_input');
    for (const a of Object.values(this.assessment)) {
      need(this.encounter[a.encounter_id], 'invalid_input');
      if (a.supersedes_id !== null) need(this.assessment[a.supersedes_id], 'invalid_input');
    }
    for (const a of Object.values(this.care_action)) {
      need(this.encounter[a.encounter_id], 'invalid_input');
      if (a.outcome_event_id !== null) need(this.health_event[a.outcome_event_id], 'invalid_input');
    }
    for (const p of Object.values(this.plan)) need(this.assessment[p.source_assessment_id], 'invalid_input');
    for (const r of Object.values(this.StoredResolution)) need(this.health_event[r.event_ref], 'invalid_input');
    for (const h of Object.values(this.health_record)) {
      if (h.terminal_event_id !== null) need(this.health_event[h.terminal_event_id] && this.TerminalPayload[h.terminal_event_id], 'invalid_input');
      validate('Baseline', resolve(this, h.baseline_ref));
    }
    Object.seal(this);
  }
  toJSON() { return Object.fromEntries(TYPES.map(t => [t, clone(this[t])])); }
}

/** Create a stateless dummy JSON adapter. Fixture keys are operation names. */
export function dependencyStub(system, fixtures = {}) {
  need(Object.hasOwn(DEPS, system), 'invalid_input');
  return async request => {
    json(request);
    const fixture = clone(fixtures[request.operation] ?? { fixture_outcome: 'pending', data: {} });
    json(fixture);
    return {
      system: DEPS[system], mock: true, operation: request.operation,
      correlation_id: request.correlation_id, idempotency_key: request.idempotency_key,
      fixture_outcome: fixture.fixture_outcome, data: fixture.data
    };
  };
}
export const requestSystem9 = dependencyStub('character');
export const requestSystem10 = dependencyStub('resolution');
export const requestSystem11 = dependencyStub('time');
export const requestSystem12 = dependencyStub('location');
export const requestSystem13 = dependencyStub('work');
export const requestSystem14 = dependencyStub('economy');
export const requestSystem15 = dependencyStub('objects');
export const requestSystem16 = dependencyStub('communication');
export const requestSystem17 = dependencyStub('vehicles');
export const requestHazard = dependencyStub('hazard');
export const requestKnowledge = dependencyStub('knowledge');
export const requestConsent = dependencyStub('consent');
export const requestRelationships = dependencyStub('relationships');
export const requestEvidence = dependencyStub('evidence');
export const requestCampaign = dependencyStub('campaign');
export const requestPresentation = dependencyStub('presentation');

function resolve(s, reference) {
  if (typeof reference !== 'string') return clone(reference);
  const slash = reference.indexOf('/');
  if (slash < 0 || !TYPES.includes(reference.slice(0, slash))) return reference;
  const value = s[reference.slice(0, slash)][reference.slice(slash + 1)];
  need(value !== undefined, 'missing_configuration'); return clone(value);
}
function publicData(value) {
  json(value);
  const hidden = new Set(['truth_ref', 'resolved_extent_ref', 'seeded_input_ref', 'resolved_outcome_ref', 'source_effect_refs']);
  const visit = v => {
    if (typeof v === 'string') need(!/^(EpisodeModelPayload|StoredResolution|health_event|TerminalPayload|BleedingSource)\//.test(v), 'missing_access');
    else if (Array.isArray(v)) v.forEach(visit);
    else if (isObject(v)) for (const [k, item] of Object.entries(v)) { need(!hidden.has(k), 'missing_access'); visit(item); }
  };
  visit(value); return clone(value);
}
function put(s, type, id, value) { validate(type, value); s[type][id] = clone(value); return `${type}/${id}`; }
function model(s, version) {
  const value = s.ModelConfiguration[version]; need(value, 'missing_configuration');
  need(value.numeric_units === 'fictional; milliseconds', 'missing_configuration');
  const rules = resolve(s, value.deterministic_prerequisites_ref);
  need(isObject(rules), 'missing_configuration');
  for (const key of ['templates', 'objectives', 'methods', 'actions', 'transitions', 'care_statuses', 'ordering', 'death_state_by_kind']) need(isObject(rules[key]), 'missing_configuration');
  for (const key of ['era_refs', 'terminal_states', 'resolved_states', 'allowed_mechanisms']) need(Array.isArray(rules[key]), 'missing_configuration');
  return { ...value, rules };
}
function campaign(s) {
  const entries = Object.values(s.CampaignConfiguration);
  need(entries.length === 1, 'missing_configuration'); return entries[0];
}
const events = s => Object.values(s.health_event);
function revision(s, target) { return events(s).filter(e => e.payload_ref.target === target && e.payload_ref.mutation === true).length; }
function path(object, dotted) {
  need(typeof dotted === 'string' && !dotted.split('.').some(k => FORBIDDEN_KEYS.has(k)), 'missing_configuration');
  return dotted.split('.').reduce((v, k) => isObject(v) || Array.isArray(v) ? v[k] : undefined, object);
}
function predicate(rule, context) {
  if (rule === true || rule === false) return rule;
  need(isObject(rule), 'missing_configuration');
  if (Object.hasOwn(rule, 'all')) return rule.all.every(r => predicate(r, context));
  if (Object.hasOwn(rule, 'any')) return rule.any.some(r => predicate(r, context));
  if (Object.hasOwn(rule, 'not')) return !predicate(rule.not, context);
  const actual = path(context, rule.path);
  switch (rule.op) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'eq': return actual !== undefined && canonical(actual) === canonical(rule.value);
    case 'ne': return actual !== undefined && canonical(actual) !== canonical(rule.value);
    case 'includes': return Array.isArray(actual) && actual.some(v => canonical(v) === canonical(rule.value));
    case 'lt': case 'lte': case 'gt': case 'gte': {
      need(typeof actual === 'number' && typeof rule.value === 'number', 'missing_configuration');
      return ({ lt: actual < rule.value, lte: actual <= rule.value, gt: actual > rule.value, gte: actual >= rule.value })[rule.op];
    }
    default: fail('missing_configuration');
  }
}
function substitute(value, context) {
  if (typeof value === 'string' && value.startsWith('$')) {
    const found = path(context, value.slice(1)); need(found !== undefined, 'missing_configuration'); return clone(found);
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, context));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, context)]));
  return value;
}
function activeEffects(s, target, at, action = null) {
  return Object.values(s.effect).filter(e => s.episode[e.episode_id]?.character_id === target &&
    time(e.starts_at) <= time(at) && (e.expires_at === null || time(at) < time(e.expires_at)) &&
    (action === null || e.action_class === '*' || e.action_class === action));
}
function compose(s, target, at, action = null) {
  const h = s.health_record[target]; need(h, 'incompatible_state');
  const baseline = resolve(s, h.baseline_ref);
  validate('Baseline', baseline);
  const result = resolve(s, baseline.baseline_function_ref);
  validate('FunctionalProjection', result);
  const effects = activeEffects(s, target, at, action), groups = new Map(), restrictions = [];
  for (const effect of effects) {
    const m = model(s, s.episode[effect.episode_id].model_version);
    const rule = m.composition_rules[effect.composition_group]; need(rule, 'missing_configuration');
    const v = resolve(s, effect.value_ref);
    need(isObject(v) && Number.isFinite(v.magnitude), 'missing_configuration');
    need(v.magnitude >= rule.minimum && v.magnitude <= rule.maximum, 'missing_configuration');
    const old = groups.get(effect.composition_group);
    if (old) need(canonical(old.rule) === canonical(rule), 'incompatible_state');
    const group = old ?? { rule, sources: new Map() };
    // Multiple channels/child sources from one injury contribute once per group.
    group.sources.set(effect.episode_id, Math.max(group.sources.get(effect.episode_id) ?? -Infinity, v.magnitude));
    groups.set(effect.composition_group, group);
    if (v.restriction !== null) {
      need(typeof v.restriction === 'string' && typeof v.reason === 'string' && Array.isArray(v.alternatives), 'missing_configuration');
      restrictions.push({ requirement: v.restriction, reason: v.reason, alternatives: clone(v.alternatives) });
    }
  }
  const modifiers = {}, written = new Set();
  for (const [name, { rule, sources }] of groups) {
    need(Number.isFinite(rule.minimum) && Number.isFinite(rule.maximum) && rule.minimum <= rule.maximum, 'missing_configuration');
    const values = [...sources.values()];
    need(['strongest-effect', 'bounded-combination'].includes(rule.kind), 'missing_configuration');
    const raw = rule.kind === 'strongest-effect' ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
    const magnitude = Math.max(rule.minimum, Math.min(rule.maximum, raw));
    modifiers[name] = magnitude;
    if (rule.field !== null) {
      need(Object.hasOwn(result, rule.field) && rule.field !== 'source_effect_refs' && !written.has(rule.field), 'missing_configuration');
      written.add(rule.field);
      need(Array.isArray(rule.bands) && rule.bands.length > 0, 'missing_configuration');
      const bands = [...rule.bands].sort((a, b) => a.minimum - b.minimum);
      const band = bands.filter(b => magnitude >= b.minimum).at(-1); need(band, 'missing_configuration');
      result[rule.field] = clone(band.value);
    }
  }
  result.source_effect_refs = effects.map(e => `effect/${e.id}`).sort();
  validate('FunctionalProjection', result);
  return { projection: result, modifiers, restrictions };
}

/** JSON-in/JSON-out state machine. Mutations are serialized and copy-on-write. */
export class HealthSystem {
  #state; #ports; #tail = Promise.resolve();
  constructor(snapshot, fixtures = {}) {
    this.#state = new HealthState(snapshot);
    this.#ports = Object.fromEntries(Object.keys(DEPS).map(k => [k, dependencyStub(k, fixtures[k] ?? {})]));
    campaign(this.#state);
  }
  /** Trusted-host persistence/debug API; never expose this method as a player RPC. */
  snapshot() { return this.#state.toJSON(); }
  async save(filename) {
    return this.#serial(async () => {
      const data = canonical(this.snapshot());
      await mkdir(dirname(filename), { recursive: true });
      const temporary = `${filename}.${hash(data)}.tmp`;
      await writeFile(temporary, data, { encoding: 'utf8', flag: 'w' });
      await rename(temporary, filename);
    });
  }
  static async load(filename, fixtures = {}) {
    return new HealthSystem(JSON.parse(await readFile(filename, 'utf8')), fixtures);
  }
  #serial(work) {
    const result = this.#tail.then(work); this.#tail = result.catch(() => {}); return result;
  }
  /** @param {Command} command @returns {Promise<JSONObject>} */
  async step(command) { return this.#serial(() => this.#step(command)); }
  async #call(context, system, operation, payload, required = true) {
    const receipt = await this.#ports[system]({ operation, payload: clone(payload),
      correlation_id: context.c.correlation_id,
      idempotency_key: stableID(context.c.idempotency_key, system, operation, payload) });
    need(receipt.mock === true, 'invalid_dependency'); context.receipts.push(receipt);
    if (required && receipt.fixture_outcome !== 'committed') throw new Pending(receipt);
    return receipt.data;
  }
  #audit(s, c, response, receipts, mutation, suffix = '') {
    const id = stableID('event', c.idempotency_key, suffix);
    const key = suffix ? `${c.idempotency_key}:${suffix}` : c.idempotency_key;
    if (events(s).some(e => e.idempotency_key === key)) return id;
    put(s, 'health_event', id, { id, correlation_id: c.correlation_id, idempotency_key: key,
      occurred_at: c.canonical_time,
      processed_at: receipts.find(r => r.operation === 'canonical_context')?.data.canonical_time ?? c.canonical_time,
      actor_ref: c.actor_ref, cause_ref: c.cause_ref, rules_version: c.rules_version,
      payload_ref: { target: c.target, mutation, fingerprint: hash(c), command: clone(c),
        result: clone(response), external_outputs: clone(receipts) } });
    return id;
  }
  async #step(input) {
    let c, tx, ctx;
    try {
      json(input); c = clone(input);
      exact(c, ['command', 'actor_ref', 'target', 'canonical_time', 'expected_revision', 'correlation_id', 'idempotency_key', 'authority_ref', 'cause_ref', 'rules_version', 'payload']);
      for (const k of ['command', 'actor_ref', 'target', 'correlation_id', 'idempotency_key', 'rules_version']) need(typeof c[k] === 'string' && c[k].length > 0, 'invalid_input');
      need(c.authority_ref !== null && c.cause_ref !== null && isObject(c.payload), 'invalid_input');
      need(Number.isSafeInteger(c.expected_revision) && c.expected_revision >= 0, 'invalid_input'); time(c.canonical_time);
      need(COMMANDS.has(c.command) || QUERIES.has(c.command), 'unknown_command');
      tx = new HealthState(this.snapshot()); ctx = { c, s: tx, receipts: [], event: stableID('event', c.idempotency_key, '') };
      const authority = await this.#call(ctx, 'consent', 'validate_command', c);
      need(authority.authorized === true, 'missing_access');
      const existing = events(tx).find(e => e.idempotency_key === c.idempotency_key);
      if (existing) {
        need(existing.payload_ref.fingerprint === hash(c), 'idempotency_conflict');
        if (QUERIES.has(c.command)) {
          const current = await this.#call(ctx, 'evidence', 'query_access', { actor: c.actor_ref, target: c.target, query: c.command, payload: c.payload });
          const old = existing.payload_ref.external_outputs.find(r => r.operation === 'query_access')?.data;
          need(current.allowed === true && canonical(current) === canonical(old ?? null), 'missing_access');
        }
        return clone(existing.payload_ref.result);
      }
      const clock = await this.#call(ctx, 'time', 'canonical_context', { target: c.target, at: c.canonical_time });
      const validClock = c.command === 'AdvanceEpisode' ? time(clock.canonical_time) >= time(c.canonical_time) : clock.canonical_time === c.canonical_time;
      need(validClock && clock.ordering_version === campaign(tx).event_ordering_policy_version, 'invalid_time');
      ctx.clock = clock;
      need(c.expected_revision === revision(tx, c.target), 'stale_revision');
      ctx.m = model(tx, c.rules_version); ctx.rules = ctx.m.rules;
      need(ctx.rules.ordering?.version === clock.ordering_version, 'missing_configuration');
      const last = events(tx).filter(e => e.payload_ref.target === c.target && e.payload_ref.mutation).map(e => time(e.occurred_at));
      need(last.length === 0 || time(c.canonical_time) >= Math.max(...last), 'invalid_time');
      if (clock.paused === true) need(QUERIES.has(c.command), 'paused');
      if (!tx.health_record[c.target]) await this.#initialize(ctx);
      if (QUERIES.has(c.command)) return await this.#query(ctx);
      need(!tx.health_record[c.target].terminal_event_id || c.command === 'AmendAssessment' || c.command === 'AuthorizeDisclosure', 'incompatible_state');
      const due = this.#due(tx, c.target, c.canonical_time, ctx.rules);
      if (c.command !== 'AdvanceEpisode') {
        const allowedEqual = c.command === 'CompleteCare' && ctx.rules.ordering.care_before_boundary === true;
        need(due.every(e => allowedEqual && e.next_boundary_at === c.canonical_time), 'catch_up_required');
      }
      this.#integrate(ctx);
      let result = await this[`_${c.command}`](ctx);
      if (!tx.health_record[c.target].terminal_event_id) tx.health_record[c.target].function_projection = compose(tx, c.target, c.canonical_time).projection;
      const workflow = tx.PendingWorkflowPayload[c.idempotency_key];
      if (workflow) workflow.status = 'completed';
      result = { mode: 'isolated', mock: true, status: 'committed', event_id: ctx.event,
        revision: revision(tx, c.target) + 1, ...result };
      this.#audit(tx, c, result, ctx.receipts, true);
      this.#state = new HealthState(tx.toJSON());
      return clone(result);
    } catch (error) {
      if (error instanceof Pending && c && ctx) {
        // Roll back physiological work; persist only the auditable pending step.
        const s = new HealthState(this.snapshot());
        const response = { mode: 'isolated', mock: true, status: 'pending', code: 'unresolved_workflow',
          dependency: error.receipt.system, operation: error.receipt.operation };
        const pending = { workflow_ref: c.idempotency_key, step_ref: error.receipt.operation,
          status: error.receipt.fixture_outcome === 'failed' ? 'failed' : 'pending',
          external_commit_refs: ctx.receipts.filter(r => r.fixture_outcome === 'committed'),
          outstanding_order_refs: [clone(c)], unopened_result_refs: [], scheduled_review_refs: [] };
        put(s, 'PendingWorkflowPayload', c.idempotency_key, pending);
        this.#audit(s, c, response, ctx.receipts, false, `pending-${hash(pending)}`);
        this.#state = s; return response;
      }
      if (error instanceof HealthError) {
        const response = { mode: 'isolated', mock: true, status: 'rejected', code: error.code };
        if (ctx) {
          const s = new HealthState(this.snapshot());
          if (QUERIES.has(c.command) && error.code === 'missing_access') {
            const id = stableID(ctx.event, 'denied', revision(s, c.target));
            put(s, 'record_access', id, { id, record_ref: c.payload.record_ref ?? c.target,
              actor_id: c.actor_ref, purpose_ref: c.command, policy_version: c.rules_version,
              occurred_at: c.canonical_time, outcome: 'denied' });
          }
          this.#audit(s, c, response, ctx.receipts, false, `rejected-${hash([error.code, revision(s, c.target)])}`);
          this.#state = s;
        }
        return response;
      }
      // The RPC boundary never exposes exceptions containing private state.
      return { mode: 'isolated', mock: true, status: 'rejected', code: 'operation_failed' };
    }
  }
  async #initialize(ctx) {
    const { s, c } = ctx;
    const data = await this.#call(ctx, 'character', 'health_baseline', { target: c.target });
    need(data.character_id === c.target, 'incompatible_state'); validate('Baseline', data.baseline);
    validate('FunctionalProjection', data.function_projection);
    const baseline = clone(data.baseline); baseline.baseline_function_ref = clone(data.function_projection);
    put(s, 'Baseline', c.target, baseline);
    put(s, 'health_record', c.target, { character_id: c.target, baseline_version: data.baseline_version,
      baseline_ref: `Baseline/${c.target}`, function_projection: data.function_projection, terminal_event_id: null });
  }
  #due(s, target, at, rules) {
    need(isObject(rules.ordering?.kind_priority), 'missing_configuration');
    return Object.values(s.episode).filter(e => e.character_id === target && e.next_boundary_at !== null && time(e.next_boundary_at) <= time(at))
      .sort((a, b) => {
        need(Number.isFinite(rules.ordering.kind_priority[a.kind]) && Number.isFinite(rules.ordering.kind_priority[b.kind]), 'missing_configuration');
        return time(a.next_boundary_at) - time(b.next_boundary_at) || rules.ordering.kind_priority[a.kind] - rules.ordering.kind_priority[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
  }
  #context(ctx, episode = null) {
    const { s, c } = ctx;
    return { now: c.canonical_time, target: c.target, event: ctx.event,
      episode, truth: episode ? resolve(s, episode.truth_ref) : null,
      function: s.health_record[c.target].function_projection,
      care: Object.values(s.care_action).filter(a => s.encounter[a.encounter_id]?.patient_ref === c.target && a.outcome_event_id !== null),
      exposures: Object.values(s.exposure).filter(e => e.character_id === c.target),
      substance_history: s.SubstanceHistory[c.target] ?? null,
      bleeding_sources: Object.values(s.BleedingSource).filter(b => s.episode[b.episode_id]?.character_id === c.target) };
  }
  #integrate(ctx) {
    const { s, c } = ctx;
    const prior = events(s).filter(e => e.payload_ref.target === c.target && e.payload_ref.mutation).at(-1)?.occurred_at;
    for (const source of Object.values(s.BleedingSource).filter(b => s.episode[b.episode_id]?.character_id === c.target)) {
      const profile = resolve(s, source.progression_model_ref);
      need(profile.unit === 'fictional burden per millisecond', 'missing_configuration');
      const rate = profile.rates[source.state];
      need(Number.isFinite(rate) && rate >= 0 && Number.isFinite(profile.maximum) && profile.maximum >= 0, 'missing_configuration');
      const elapsed = time(c.canonical_time) - time(prior ?? s.episode[source.episode_id].onset_at);
      need(elapsed >= 0, 'invalid_time');
      source.cumulative_loss = Math.min(profile.maximum, source.cumulative_loss + rate * elapsed);
    }
  }
  async #enabled(ctx, templateRef, template) {
    const cfg = campaign(ctx.s);
    need(cfg.enabled_template_refs.includes(templateRef), 'disabled_template');
    need(ctx.m.affected_template_refs.includes(templateRef), 'missing_configuration');
    if (template.module === 'withdrawal') {
      need(cfg.withdrawal_enabled, 'disabled_template');
      const history = ctx.s.SubstanceHistory[ctx.c.target];
      need(history && (history.supporting_event_refs.length > 1 || history.established_background_ref !== null), 'unsupported_cause');
    }
    if (template.module === 'communicable_disease') need(cfg.communicable_disease_enabled, 'disabled_template');
    const era = await this.#call(ctx, 'campaign', 'validate_era', { era_manifest_ref: cfg.era_manifest_ref,
      template_ref: templateRef, required_refs: template.era_refs });
    need(era.supported === true && (era.year === 2012 || era.explicit_fictional_designation === true), 'unavailable_resource');
  }
  async #workflow(ctx, steps, extra = {}) {
    need(Array.isArray(steps), 'missing_configuration');
    for (const step of steps) {
      need(Object.hasOwn(DEPS, step.system) && typeof step.operation === 'string', 'missing_configuration');
      const result = await this.#call(ctx, step.system, step.operation, substitute(step.payload, { ...this.#context(ctx), ...extra }));
      need(predicate(step.require, { result }), 'unresolved_workflow');
    }
  }
  #effects(ctx, episode, definitions, at, source) {
    need(Array.isArray(definitions), 'missing_configuration');
    definitions.forEach((d, index) => {
      const id = stableID(episode.id, source, index);
      need(!ctx.s.effect[id], 'duplicate_source');
      put(ctx.s, 'effect', id, { id, episode_id: episode.id, channel: d.channel, action_class: d.action_class,
        value_ref: d.value_ref, starts_at: at, expires_at: d.duration_ms === null ? null : after(at, d.duration_ms),
        composition_group: d.composition_group });
    });
  }
  #spawn(ctx, template, incident, region, cause, index) {
    const { s, c } = ctx, id = stableID('episode', c.target, incident, index);
    need(!s.episode[id], 'duplicate_source');
    const bindings = { episode: id, target: c.target, event: ctx.event, now: c.canonical_time, cause, incident, region };
    const truth = substitute(template.truth, bindings);
    truth.cause_event_ref = cause;
    put(s, 'EpisodeModelPayload', id, truth);
    need(Array.isArray(template.payloads), 'missing_configuration');
    for (const entry of template.payloads) {
      need(['WoundPayload', 'BleedingSource', 'MusculoskeletalPayload', 'HeadInjuryPayload', 'BurnPayload', 'DiseasePayload'].includes(entry.type), 'missing_configuration');
      put(s, entry.type, `${id}:${entry.name}`, substitute(entry.value, bindings));
    }
    const episode = { id, character_id: c.target, kind: template.kind, incident_id: incident, region_ref: region,
      onset_at: c.canonical_time, state: template.initial_state, model_version: c.rules_version,
      truth_ref: `EpisodeModelPayload/${id}`, next_boundary_at: template.boundary_after_ms === null ? null : after(c.canonical_time, template.boundary_after_ms), revision: 0 };
    put(s, 'episode', id, episode); this.#effects(ctx, episode, template.effects, c.canonical_time, 'initial');
    return s.episode[id];
  }
  async _CreateInjury(ctx) {
    const { c, s } = ctx, p = c.payload;
    exact(p, ['incident_id', 'mechanism', 'region_ref', 'context_ref', 'template_refs']);
    need(Array.isArray(p.template_refs) && p.template_refs.length > 0, 'invalid_input');
    need(ctx.rules.allowed_mechanisms.includes(p.mechanism), 'unsupported_cause');
    need(!Object.values(s.episode).some(e => e.character_id === c.target && e.incident_id === p.incident_id), 'duplicate_source');
    const cause = await this.#call(ctx, 'hazard', 'resolved_cause', { target: c.target, cause_ref: c.cause_ref, ...p });
    need(cause.supported === true && cause.incident_id === p.incident_id && cause.target === c.target &&
      cause.mechanism === p.mechanism && canonical(cause.region_ref) === canonical(p.region_ref) &&
      cause.occurred_at === c.canonical_time, 'unsupported_cause');
    need(Array.isArray(cause.allowed_template_refs) && p.template_refs.every(r => cause.allowed_template_refs.includes(r)), 'unsupported_cause');
    const anatomy = await this.#call(ctx, 'character', 'validate_anatomy', { target: c.target, region_ref: p.region_ref });
    need(anatomy.plausible === true, 'incompatible_state');
    const ids = [];
    for (const [index, ref] of p.template_refs.entries()) {
      const template = ctx.rules.templates[ref]; need(template, 'missing_configuration');
      await this.#enabled(ctx, ref, template);
      need(template.mechanism === p.mechanism && predicate(template.when, { cause }), 'unsupported_cause');
      const selected = await this.#uncertain(ctx, template, `extent:${p.incident_id}:${index}`, { cause });
      const e = this.#spawn(ctx, selected, p.incident_id, p.region_ref, c.cause_ref, index);
      s.EpisodeModelPayload[e.id].exposure_context_ref = clone(p.context_ref); ids.push(e.id);
    }
    return { incident_id: p.incident_id, episode_ids: ids };
  }
  async #uncertain(ctx, definition, key, context) {
    need(Object.hasOwn(definition, 'uncertainty_ref'), 'missing_configuration');
    if (definition.uncertainty_ref === 'none') return definition;
    const id = stableID('resolution', ctx.c.target, key, ctx.c.rules_version);
    const old = ctx.s.StoredResolution[id];
    if (old) return { ...definition, ...resolve(ctx.s, old.resolved_outcome_ref) };
    need(ctx.m.uncertain_milestone_refs.includes(definition.uncertainty_ref), 'missing_configuration');
    const seed = stableID(ctx.c.target, ctx.c.cause_ref, key, ctx.c.rules_version);
    const resolved = await this.#call(ctx, 'resolution', 'resolve', { milestone_ref: definition.uncertainty_ref,
      seeded_input_ref: seed, context });
    need(typeof resolved.outcome === 'string' && Object.hasOwn(definition.outcomes, resolved.outcome), 'invalid_dependency');
    const outcome = definition.outcomes[resolved.outcome];
    put(ctx.s, 'StoredResolution', id, { event_ref: ctx.event, seeded_input_ref: seed,
      resolved_outcome_ref: outcome, rules_version: ctx.c.rules_version });
    return { ...definition, ...clone(outcome) };
  }
  async _RecordExposure(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['source_item_id', 'profile_version', 'abstract_band', 'route_kind', 'plan_ref', 'source_event_ref', 'template_ref']);
    need(!Object.values(s.exposure).some(e => s.health_event[e.event_id]?.cause_ref === p.source_event_ref && e.character_id === c.target), 'duplicate_source');
    need(canonical(c.cause_ref) === canonical(p.source_event_ref), 'unsupported_cause');
    const template = ctx.rules.templates[p.template_ref]; need(template, 'missing_configuration');
    await this.#enabled(ctx, p.template_ref, template);
    const profile = s.SubstanceProfile[p.profile_version]; need(profile, 'missing_configuration');
    need(template.exposure_profile === p.profile_version && template.abstract_bands.includes(p.abstract_band) && template.routes.includes(p.route_kind), 'incompatible_state');
    let authority;
    if (['accidental', 'covert'].includes(template.exposure_payload.exposure_context)) {
      authority = await this.#call(ctx, 'hazard', 'supported_exposure', { target: c.target, source_event_ref: p.source_event_ref, source_item_id: p.source_item_id });
      need(authority.supported === true && authority.source_event_ref === p.source_event_ref, 'unsupported_cause');
    } else authority = await this.#careAuthority(ctx, 'administration', p.plan_ref);
    const item = await this.#call(ctx, 'objects', 'validate_administration', p);
    need(item.available === true && item.source_item_id === p.source_item_id && item.profile_version === p.profile_version && item.plan_matches === true, 'unavailable_resource');
    need(predicate(template.when, { item, authority }), 'incompatible_state');
    const id = stableID('exposure', c.target, p.source_event_ref);
    const e = this.#spawn(ctx, template, p.source_event_ref, template.region_ref, p.source_event_ref, 0);
    const exposurePayload = substitute(template.exposure_payload, { target: c.target, event: ctx.event, now: c.canonical_time, episode: e.id });
    exposurePayload.source_ref = p.source_item_id; exposurePayload.actor_ref = c.actor_ref;
    exposurePayload.plan_ref = p.plan_ref; exposurePayload.consumption_commit_ref = null;
    put(s, 'ExposurePayload', id, exposurePayload);
    put(s, 'exposure', id, { id, character_id: c.target, source_item_id: p.source_item_id,
      profile_version: p.profile_version, abstract_band: p.abstract_band, route_kind: p.route_kind,
      occurred_at: c.canonical_time, event_id: ctx.event });
    // Validate all local effects/interactions before requesting any consumption.
    await this.#interactions(ctx, id); compose(s, c.target, c.canonical_time);
    const consumed = await this.#call(ctx, 'objects', 'consume', { ...p, administration_units: exposurePayload.administration_units });
    need(consumed.consumed === true && consumed.source_item_id === p.source_item_id && typeof consumed.commit_ref === 'string', 'resource_commit_failed');
    s.ExposurePayload[id].consumption_commit_ref = { mock: true, ref: consumed.commit_ref };
    return { exposure_id: id };
  }
  async #interactions(ctx, incoming) {
    const { s, c } = ctx, current = s.exposure[incoming];
    const policy = resolve(s, s.SubstanceProfile[current.profile_version].duration_decay_model_ref);
    need(Array.isArray(policy.interactions), 'missing_configuration');
    for (const other of Object.values(s.exposure)) {
      if (other.id === incoming || other.character_id !== c.target) continue;
      const timing = resolve(s, s.ExposurePayload[other.id].active_timing_ref);
      need(typeof timing.starts_at === 'string' && (timing.ends_at === null || typeof timing.ends_at === 'string'), 'missing_configuration');
      if (time(timing.starts_at) > time(c.canonical_time) || (timing.ends_at !== null && time(timing.ends_at) <= time(c.canonical_time))) continue;
      const groups = s.SubstanceProfile[other.profile_version].interaction_groups;
      for (const rule of policy.interactions.filter(r => groups.includes(r.other_group))) {
        const key = stableID('interaction', ...[incoming, other.id].sort(), rule.version);
        if (s.ExposurePayload[incoming].applied_interaction_refs.includes(key)) continue;
        const template = ctx.rules.templates[rule.template_ref]; need(template, 'missing_configuration');
        await this.#enabled(ctx, rule.template_ref, template);
        this.#spawn(ctx, template, key, template.region_ref, [incoming, other.id], 0);
        s.ExposurePayload[incoming].applied_interaction_refs.push(key);
        s.ExposurePayload[other.id].applied_interaction_refs.push(key);
      }
    }
  }
  async #careAuthority(ctx, scope, offer) {
    const data = await this.#call(ctx, 'consent', 'care_authority', { target: ctx.c.target, actor: ctx.c.actor_ref,
      scope, offer_ref: offer, authority_ref: ctx.c.authority_ref });
    need(data.authorized === true && data.scope === scope, 'missing_access');
    const unconscious = ctx.s.health_record[ctx.c.target].function_projection.consciousness === 'unresponsive';
    if (unconscious) need(data.kind === 'emergency' && data.reason_ref != null && data.policy_ref != null, 'missing_access');
    else need(['choice', 'standing_preference', 'representative', 'emergency'].includes(data.kind), 'missing_access');
    if (data.kind === 'emergency') need(data.reason_ref != null && data.policy_ref != null, 'missing_access');
    if (data.kind === 'standing_preference') need(data.preference_ref != null && data.revoked === false, 'missing_access');
    return data;
  }
  async #encounter(ctx, id) {
    let encounter = ctx.s.encounter[id];
    if (!encounter) {
      const arrival = await this.#call(ctx, 'location', 'encounter_arrival', { encounter_id: id, target: ctx.c.target });
      need(arrival.arrived === true, 'missing_access'); validate('encounter', arrival.encounter);
      need(arrival.encounter.id === id && arrival.encounter.patient_ref === ctx.c.target && time(arrival.encounter.started_at) <= time(ctx.c.canonical_time), 'incompatible_state');
      put(ctx.s, 'encounter', id, arrival.encounter); encounter = ctx.s.encounter[id];
    }
    need(encounter.patient_ref === ctx.c.target, 'missing_access'); return encounter;
  }
  async _RequestAssessment(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['encounter_id', 'method_ref', 'question_ref', 'circumstances_ref', 'started_at']);
    await this.#encounter(ctx, p.encounter_id);
    const method = ctx.rules.methods[p.method_ref]; need(method, 'missing_configuration');
    need(Number.isSafeInteger(method.duration_ms) && method.duration_ms >= 0, 'missing_configuration');
    await this.#careAuthority(ctx, `assessment:${p.method_ref}`, p.question_ref);
    const access = await this.#call(ctx, 'location', 'patient_access', { target: c.target, actor: c.actor_ref, encounter_id: p.encounter_id });
    need(access.present === true && access.accessible === true && access.attention_supported === true, 'missing_access');
    const task = await this.#call(ctx, 'work', 'assessment_task', { ...p, actor_ref: c.actor_ref, requirements: method.requirements });
    need(task.completed === true && task.provider_qualified === true && task.tools_available === true &&
      task.actual_duration_ms >= method.duration_ms, 'unavailable_resource');
    need(time(c.canonical_time) - time(p.started_at) >= method.duration_ms, 'duration_not_elapsed');
    const retryKey = stableID('assessment', c.target, p.method_ref, p.question_ref, p.circumstances_ref);
    const prior = events(s).find(e => e.payload_ref.command.command === 'RequestAssessment' &&
      e.payload_ref.result.assessment_key === retryKey);
    need(!prior, 'unchanged_circumstances');
    const observation = await this.#call(ctx, 'knowledge', 'assessment_evidence', { ...p, actor_ref: c.actor_ref, target: c.target });
    need(observation.supported === true, 'insufficient_known_method');
    const resolved = await this.#uncertain(ctx, method, retryKey, { task, observation });
    const id = stableID('assessment', ctx.event), record = {
      encounter_ref: p.encounter_id, author_ref: c.actor_ref, occurred_at: c.canonical_time,
      entered_at: c.canonical_time, entry_type: resolved.entry_type,
      content_refs: publicData(observation.content_refs), amendment_refs: [], access_policy_ref: campaign(s).privacy_policy_ref
    };
    put(s, 'ClinicalRecordPayload', id, record);
    put(s, 'assessment', id, { id, encounter_id: p.encounter_id, author_id: c.actor_ref,
      method_ref: p.method_ref, findings_ref: `ClinicalRecordPayload/${id}`, confidence: resolved.confidence, supersedes_id: null });
    return { assessment_id: id, assessment_key: retryKey };
  }
  async _OfferCare(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['encounter_id', 'objective_ref', 'resource_refs', 'information_offered_ref', 'source_assessment_id']);
    await this.#encounter(ctx, p.encounter_id);
    const objective = ctx.rules.objectives[p.objective_ref]; need(objective, 'missing_configuration');
    const era = await this.#call(ctx, 'campaign', 'validate_era', { era_manifest_ref: campaign(s).era_manifest_ref, objective_ref: p.objective_ref });
    need(era.supported === true && (era.year === 2012 || era.explicit_fictional_designation === true), 'unavailable_resource');
    const availability = await this.#call(ctx, 'work', 'offer_care', { target: c.target, actor_ref: c.actor_ref, ...p });
    need(availability.provider_available === true && availability.qualified === true, 'unavailable_resource');
    need(ctx.rules.era_refs.includes(p.objective_ref), 'unavailable_resource');
    const id = stableID('care', ctx.event);
    put(s, 'care_action', id, { id, encounter_id: p.encounter_id, objective_ref: p.objective_ref, actor_id: c.actor_ref,
      authority_ref: c.authority_ref, resource_refs: p.resource_refs, status: ctx.rules.care_statuses.offered,
      starts_at: c.canonical_time, completes_at: after(c.canonical_time, objective.duration_ms), outcome_event_id: null });
    return { care_action_id: id };
  }
  async _RespondToCare(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['offer_ref', 'response', 'conditions_ref', 'scope_ref', 'information_offered_ref']);
    const action = s.care_action[p.offer_ref]; need(action && s.encounter[action.encounter_id].patient_ref === c.target, 'missing_access');
    need(c.actor_ref === c.target && s.health_record[c.target].function_projection.consciousness !== 'unresponsive', 'incompatible_state');
    need(action.outcome_event_id === null, 'incompatible_state');
    need(['accept', 'decline', 'ask', 'defer'].includes(p.response), 'invalid_input');
    need(p.scope_ref === action.id, 'missing_access');
    const originalOffer = events(s).find(e => e.payload_ref.command.command === 'OfferCare' && e.payload_ref.result.care_action_id === action.id);
    need(originalOffer && canonical(originalOffer.payload_ref.command.payload.information_offered_ref) === canonical(p.information_offered_ref), 'missing_access');
    const decision = { offer_ref: p.offer_ref, actor_ref: c.actor_ref, occurred_at: c.canonical_time,
      information_offered_ref: p.information_offered_ref, response: p.response, conditions_ref: p.conditions_ref,
      scope_ref: p.scope_ref, standing_preference_ref: null, incapacity_reason_ref: null, authority_policy_ref: null };
    put(s, 'CareDecisionPayload', ctx.event, decision);
    action.status = ctx.rules.care_statuses[p.response]; need(typeof action.status === 'string', 'missing_configuration');
    if (p.response === 'accept') {
      action.starts_at = c.canonical_time;
      action.completes_at = after(c.canonical_time, model(s, originalOffer.rules_version).rules.objectives[action.objective_ref].duration_ms);
    }
    return { care_action_id: action.id, response: p.response };
  }
  async _CompleteCare(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['care_action_id', 'episode_ids', 'resolved_result_ref']);
    const action = s.care_action[p.care_action_id]; need(action && s.encounter[action.encounter_id].patient_ref === c.target, 'missing_access');
    need(action.outcome_event_id === null && c.actor_ref === action.actor_id, 'incompatible_state');
    const originalOffer = events(s).find(e => e.payload_ref.command.command === 'OfferCare' && e.payload_ref.result.care_action_id === action.id);
    need(originalOffer, 'incompatible_state');
    const careRules = model(s, originalOffer.rules_version).rules;
    const objective = careRules.objectives[action.objective_ref]; need(objective, 'missing_configuration');
    const decision = Object.values(s.CareDecisionPayload).filter(d => d.offer_ref === action.id).at(-1);
    if (decision) need(decision.response === 'accept', 'missing_access');
    const authority = await this.#careAuthority(ctx, `care:${action.id}`, action.id);
    if (!decision) need(authority.kind !== 'choice', 'missing_access');
    if (decision?.conditions_ref !== null && decision?.conditions_ref !== undefined) need(authority.conditions_satisfied === true, 'missing_access');
    need(time(c.canonical_time) >= time(action.completes_at), 'duration_not_elapsed');
    const task = await this.#call(ctx, 'work', 'complete_care', { care_action_id: action.id, starts_at: action.starts_at, completes_at: action.completes_at });
    need(task.completed === true && task.actor_id === action.actor_id && task.actual_duration_ms >= objective.duration_ms, 'unavailable_resource');
    const access = await this.#call(ctx, 'location', 'care_presence', { action_id: action.id, actor_id: action.actor_id, target: c.target });
    need(access.requirements_satisfied === true, 'missing_access');
    const resources = await this.#call(ctx, 'objects', 'care_resources', { action_id: action.id, resource_refs: action.resource_refs });
    need(resources.committed === true, 'resource_commit_failed');
    // EMS/transfer stages are authored contracts, never simulated external state.
    await this.#workflow(ctx, objective.external_steps, { action });
    const result = await this.#call(ctx, 'resolution', 'committed_care_result', { result_ref: p.resolved_result_ref, action_id: action.id });
    const outcome = objective.outcomes[result.outcome]; need(outcome, 'invalid_dependency');
    need(Array.isArray(p.episode_ids) && new Set(p.episode_ids).size === p.episode_ids.length, 'invalid_input');
    for (const id of p.episode_ids) {
      const episode = s.episode[id]; need(episode?.character_id === c.target && objective.target_kinds.includes(episode.kind), 'incompatible_state');
      this.#apply(ctx, episode, outcome, `care:${action.id}`);
      s.EpisodeModelPayload[id].treatment_refs.push(`care_action/${action.id}`);
    }
    action.outcome_event_id = ctx.event; action.status = careRules.care_statuses.completed;
    if (outcome.plan) {
      const origin = events(s).find(e => e.payload_ref.result.care_action_id === action.id && e.payload_ref.command.command === 'OfferCare');
      const assessmentId = origin?.payload_ref.command.payload.source_assessment_id;
      need(s.assessment[assessmentId]?.encounter_id === action.encounter_id, 'incompatible_state');
      const planId = stableID('plan', action.id);
      const instructions = substitute(outcome.plan.instructions, this.#context(ctx));
      put(s, 'PlanPayload', planId, instructions);
      put(s, 'plan', planId, { id: planId, patient_ref: c.target, source_assessment_id: assessmentId,
        instructions_ref: `PlanPayload/${planId}`, review_at: after(c.canonical_time, outcome.plan.review_after_ms),
        visibility_policy: campaign(s).privacy_policy_ref, version: c.rules_version });
    }
    const bill = await this.#call(ctx, 'economy', 'bill_performed_care', { action_id: action.id, service_event_ref: ctx.event }, false);
    const receipt = ctx.receipts.at(-1);
    if (receipt.fixture_outcome !== 'committed') put(s, 'PendingWorkflowPayload', `billing:${action.id}`, {
      workflow_ref: action.id, step_ref: 'billing', status: receipt.fixture_outcome === 'failed' ? 'failed' : 'pending',
      external_commit_refs: [], outstanding_order_refs: [{ action_id: action.id, event_ref: ctx.event }],
      unopened_result_refs: [], scheduled_review_refs: [] });
    return { care_action_id: action.id, billing_status: receipt.fixture_outcome, billing_ref: bill.bill_ref ?? null };
  }
  #apply(ctx, episode, transition, source) {
    const { s, c } = ctx;
    need(transition.end_effects === 'all' || Array.isArray(transition.end_effects), 'missing_configuration');
    for (const e of Object.values(s.effect).filter(e => e.episode_id === episode.id)) {
      if (transition.end_effects === 'all' || transition.end_effects.includes(e.channel)) {
        if (e.expires_at === null || time(e.expires_at) > time(c.canonical_time)) e.expires_at = c.canonical_time;
      }
    }
    const truth = s.EpisodeModelPayload[episode.id];
    need(isObject(transition.truth_patch) && !Object.keys(transition.truth_patch).some(k => ['cause_event_ref', 'resolved_extent_ref', 'mechanism', 'severity'].includes(k)), 'missing_configuration');
    Object.assign(truth, clone(transition.truth_patch)); validate('EpisodeModelPayload', truth);
    if (Object.hasOwn(transition, 'terminal_eligible')) {
      need(typeof transition.terminal_eligible === 'boolean', 'missing_configuration');
      truth.current_flags = truth.current_flags.filter(f => f !== 'terminal_eligible');
      if (transition.terminal_eligible) truth.current_flags.push('terminal_eligible');
    }
    need(Array.isArray(transition.payload_patches), 'missing_configuration');
    for (const patch of transition.payload_patches) {
      need(['WoundPayload', 'BleedingSource', 'MusculoskeletalPayload', 'HeadInjuryPayload', 'BurnPayload', 'DiseasePayload', 'ExposurePayload'].includes(patch.type), 'missing_configuration');
      const exposure = patch.type === 'ExposurePayload' ? Object.values(s.exposure).find(e => e.character_id === c.target &&
        canonical(s.health_event[e.event_id]?.cause_ref ?? null) === canonical(episode.incident_id)) : null;
      const id = patch.type === 'ExposurePayload' ? exposure?.id : `${episode.id}:${patch.name}`;
      const record = s[patch.type][id]; need(record, 'incompatible_state');
      put(s, patch.type, id, { ...record, ...substitute(patch.values, this.#context(ctx, episode)) });
    }
    if (transition.to !== null) episode.state = transition.to;
    episode.next_boundary_at = transition.after_ms === null ? null : after(c.canonical_time, transition.after_ms);
    episode.revision += 1;
    this.#effects(ctx, episode, transition.effects, c.canonical_time, source);
    if (transition.baseline_transition) {
      need(model(s, episode.model_version).rules.resolved_states.includes(episode.state), 'incompatible_state');
      const change = transition.baseline_transition, baseline = resolve(s, s.health_record[c.target].baseline_ref);
      need(isObject(change.patch) && typeof change.version === 'string', 'missing_configuration');
      const next = { ...baseline, ...clone(change.patch) };
      next.long_term_transition_event_refs = [...baseline.long_term_transition_event_refs, ctx.event];
      validate('Baseline', next); validate('FunctionalProjection', resolve(s, next.baseline_function_ref));
      const baselineId = stableID('baseline', c.target, ctx.event);
      put(s, 'Baseline', baselineId, next);
      s.health_record[c.target].baseline_ref = `Baseline/${baselineId}`;
      s.health_record[c.target].baseline_version = change.version;
    }
    if (transition.substance_history) {
      const history = clone(transition.substance_history);
      const evidence = Object.values(s.exposure).filter(e => e.character_id === c.target).map(e => e.event_id);
      need(evidence.length > 1 || s.SubstanceHistory[c.target]?.established_background_ref != null, 'unsupported_cause');
      history.supporting_event_refs = [...new Set([...(s.SubstanceHistory[c.target]?.supporting_event_refs ?? []), ...evidence])];
      history.established_background_ref = s.SubstanceHistory[c.target]?.established_background_ref ?? null;
      for (const [category, value] of Object.entries(history.tolerance_by_category)) {
        const bounds = model(s, episode.model_version).numeric_bounds.tolerance?.[category];
        need(bounds && Number.isFinite(value) && value >= bounds.minimum && value <= bounds.maximum, 'numeric_bounds');
      }
      put(s, 'SubstanceHistory', c.target, history);
    }
  }
  async _AdvanceEpisode(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['episode_id', 'boundary_time', 'scheduler_token']);
    const episode = s.episode[p.episode_id]; need(episode?.character_id === c.target, 'incompatible_state');
    need(c.canonical_time === p.boundary_time && episode.next_boundary_at === p.boundary_time, 'invalid_time');
    const due = this.#due(s, c.target, c.canonical_time, ctx.rules); need(due[0]?.id === episode.id, 'ordering_conflict');
    const token = await this.#call(ctx, 'time', 'validate_boundary', p);
    need(token.valid === true && token.earlier_care_settled === true && token.equal_time_care_settled === true, 'ordering_conflict');
    const m = model(s, episode.model_version), rules = m.rules;
    const template = Object.values(rules.templates).find(t => t.kind === episode.kind);
    need(template, 'missing_configuration');
    if (template.module === 'withdrawal') need(campaign(s).withdrawal_enabled, 'migration_required');
    if (template.module === 'communicable_disease') need(campaign(s).communicable_disease_enabled, 'migration_required');
    const options = rules.transitions[episode.kind]; need(Array.isArray(options), 'missing_configuration');
    const context = this.#context(ctx, episode);
    const candidates = options.filter(t => t.from === episode.state && predicate(t.when, context));
    need(candidates.length === 1, 'ambiguous_transition');
    const transition = await this.#uncertain({ ...ctx, m, c: { ...c, rules_version: episode.model_version } }, candidates[0], `boundary:${episode.id}:${episode.revision}:${p.boundary_time}`, context);
    this.#apply(ctx, episode, transition, `boundary:${episode.revision}`);
    if (rules.resolved_states.includes(episode.state)) {
      const ref = s.health_record[c.target].baseline_ref;
      need(typeof ref === 'string' && ref.startsWith('Baseline/'), 'incompatible_state');
      const baseline = s.Baseline[ref.slice('Baseline/'.length)];
      if (!baseline.injury_history_refs.includes(`episode/${episode.id}`)) baseline.injury_history_refs.push(`episode/${episode.id}`);
    }
    const projection = compose(s, c.target, c.canonical_time).projection;
    const before = s.health_record[c.target].function_projection.consciousness;
    if (projection.consciousness === 'unresponsive' && before !== 'unresponsive') {
      put(s, 'PendingWorkflowPayload', `actions:${c.target}`, { workflow_ref: c.target, step_ref: 'conscious_actions', status: 'paused',
        external_commit_refs: [], outstanding_order_refs: [], unopened_result_refs: [], scheduled_review_refs: [] });
    } else if (before === 'unresponsive' && projection.consciousness !== 'unresponsive') {
      const queue = s.PendingWorkflowPayload[`actions:${c.target}`]; if (queue) queue.status = 'requires_revalidation';
    }
    return { episode_id: episode.id, stop: transition.stop === true };
  }
  async _AmendAssessment(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['prior_entry_id', 'evidence_ref', 'replacement_ref']);
    const old = s.assessment[p.prior_entry_id]; need(old && s.encounter[old.encounter_id].patient_ref === c.target, 'missing_access');
    const evidence = await this.#call(ctx, 'knowledge', 'amendment_evidence', p);
    need(evidence.supported === true && evidence.authorized === true, 'missing_access');
    const id = stableID('assessment', ctx.event), original = resolve(s, old.findings_ref);
    const record = { ...original, author_ref: c.actor_ref, occurred_at: evidence.occurred_at,
      entered_at: c.canonical_time, entry_type: evidence.entry_type,
      content_refs: publicData(evidence.content_refs),
      amendment_refs: [`assessment/${old.id}`, p.evidence_ref] };
    need(time(record.occurred_at) <= time(record.entered_at), 'invalid_time');
    put(s, 'ClinicalRecordPayload', id, record);
    put(s, 'assessment', id, { ...old, id, author_id: c.actor_ref, findings_ref: `ClinicalRecordPayload/${id}`,
      confidence: evidence.confidence, supersedes_id: old.id });
    return { assessment_id: id };
  }
  async _AuthorizeDisclosure(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['record_scope', 'recipient', 'method_ref']);
    need(Array.isArray(p.record_scope) && p.record_scope.length > 0, 'invalid_input');
    need(p.record_scope.every(id => s.ClinicalRecordPayload[id] &&
      s.encounter[s.ClinicalRecordPayload[id].encounter_ref]?.patient_ref === c.target), 'missing_access');
    const permission = await this.#call(ctx, 'consent', 'authorize_disclosure', { ...p, patient: c.target, actor: c.actor_ref });
    need(permission.authorized === true, 'missing_access');
    const access = await this.#call(ctx, 'evidence', 'disclosure_route', p);
    need(access.permitted === true && Array.isArray(access.record_ids) && p.record_scope.every(id => access.record_ids.includes(id)), 'missing_access');
    // Authorization is not delivery. The communication stub cannot confer knowledge.
    await this.#call(ctx, 'communication', 'deliver_disclosure', p, false);
    const receipt = ctx.receipts.at(-1);
    if (receipt.fixture_outcome !== 'committed' || receipt.data.delivered !== true) {
      put(ctx.s, 'PendingWorkflowPayload', `disclosure:${ctx.event}`, { workflow_ref: ctx.event,
        step_ref: 'delivery', status: receipt.fixture_outcome === 'failed' ? 'failed' : 'pending',
        external_commit_refs: [], outstanding_order_refs: [p], unopened_result_refs: [], scheduled_review_refs: [] });
    }
    return { authorized: true, delivered: receipt.fixture_outcome === 'committed' && receipt.data.delivered === true };
  }
  async _CommitDeath(ctx) {
    const { s, c } = ctx, p = c.payload;
    exact(p, ['cause_chain_refs', 'policy_ref', 'body_entity_ref', 'campaign_lineage_ref']);
    const cfg = campaign(s);
    need(canonical(p.policy_ref) === canonical(cfg.finality_policy), 'incompatible_state');
    need(Array.isArray(p.cause_chain_refs) && p.cause_chain_refs.length > 0, 'unsupported_cause');
    const episodes = p.cause_chain_refs.map(id => s.episode[id]);
    need(episodes.every(e => e?.character_id === c.target && model(s, e.model_version).rules.terminal_states.includes(e.state) &&
      resolve(s, e.truth_ref).current_flags.includes('terminal_eligible')), 'unsupported_cause');
    const competingCare = Object.values(s.care_action).filter(a => s.encounter[a.encounter_id]?.patient_ref === c.target && a.outcome_event_id === null && time(a.completes_at) <= time(c.canonical_time));
    need(competingCare.every(a => {
      const d = Object.values(s.CareDecisionPayload).filter(x => x.offer_ref === a.id).at(-1);
      return d?.response !== 'accept';
    }), 'ordering_conflict');
    const ordering = await this.#call(ctx, 'time', 'terminal_barrier', { target: c.target, at: c.canonical_time, expected_revision: c.expected_revision });
    need(ordering.concurrent_care_settled === true && ordering.timely_interventions_included === true, 'ordering_conflict');
    const policy = await this.#call(ctx, 'campaign', 'finality_validation', { policy: cfg.finality_policy, cause_chain_refs: p.cause_chain_refs });
    need(policy.allowed === true, 'incompatible_state');
    const body = await this.#call(ctx, 'location', 'body_continuity', { target: c.target, body_entity_ref: p.body_entity_ref });
    need(body.present === true && body.possessions_preserved === true, 'incompatible_state');
    validate('FunctionalProjection', ctx.rules.terminal_projection);
    put(s, 'TerminalPayload', ctx.event, { ...p, terminal_capability_state_ref: ctx.rules.terminal_projection });
    s.health_record[c.target].terminal_event_id = ctx.event;
    s.health_record[c.target].function_projection = clone(ctx.rules.terminal_projection);
    for (const e of Object.values(s.episode).filter(e => e.character_id === c.target)) {
      const terminalState = model(s, e.model_version).rules.death_state_by_kind[e.kind];
      need(typeof terminalState === 'string', 'missing_configuration');
      e.state = terminalState; e.next_boundary_at = null; e.revision += 1;
    }
    for (const system of ['character', 'work', 'relationships', 'evidence', 'communication', 'vehicles']) {
      await this.#call(ctx, system, 'terminal_event', { target: c.target, event_ref: ctx.event }, false);
      const receipt = ctx.receipts.at(-1);
      put(s, 'PendingWorkflowPayload', `death:${ctx.event}:${system}`, { workflow_ref: ctx.event,
        step_ref: system, status: receipt.fixture_outcome === 'committed' ? 'completed' : 'pending',
        external_commit_refs: [receipt], outstanding_order_refs: [], unopened_result_refs: [], scheduled_review_refs: [] });
    }
    return { terminal_event_id: ctx.event };
  }
  async #query(ctx) {
    const { s, c } = ctx, p = c.payload;
    need(this.#due(s, c.target, c.canonical_time, ctx.rules).length === 0, 'catch_up_required');
    const access = await this.#call(ctx, 'evidence', 'query_access', { actor: c.actor_ref, target: c.target, query: c.command, payload: p });
    const id = stableID('access', ctx.event);
    put(s, 'record_access', id, { id, record_ref: p.record_ref ?? c.target, actor_id: c.actor_ref,
      purpose_ref: c.command, policy_version: access.policy_version ?? 'unresolved', occurred_at: c.canonical_time,
      outcome: access.allowed === true ? 'allowed' : 'denied' });
    let result;
    if (access.allowed !== true) result = { status: 'rejected', code: 'missing_access' };
    else if (c.command === 'EvaluateAction') {
      result = await this.#evaluate(ctx);
    } else if (['GetKnownHealth', 'GetObservedFunction', 'GetRecoverySummary'].includes(c.command)) {
      const knowledge = await this.#call(ctx, 'knowledge', 'visible_health', { actor: c.actor_ref, target: c.target, query: c.command });
      need(knowledge.supported_acquisition === true && Array.isArray(knowledge.function_fields), 'missing_access');
      const projection = s.health_record[c.target].terminal_event_id ? s.health_record[c.target].function_projection : compose(s, c.target, c.canonical_time).projection;
      const fields = knowledge.function_fields.filter(f => f !== 'source_effect_refs' && Object.hasOwn(projection, f));
      result = { status: 'ok', function: Object.fromEntries(fields.map(f => [f, clone(projection[f])])),
        statements: publicData(knowledge.statements ?? []) };
    } else if (c.command === 'GetAvailableCare') {
      const data = await this.#call(ctx, 'work', 'available_care', { target: c.target, actor: c.actor_ref });
      result = { status: 'ok', offers: publicData(data.offers ?? []) };
    } else if (c.command === 'GetEncounterView') {
      const encounter = s.encounter[p.encounter_id]; need(encounter?.patient_ref === c.target, 'missing_access');
      need(access.record_ids?.includes(encounter.id), 'missing_access');
      result = { status: 'ok', encounter: { id: encounter.id, status: encounter.status, started_at: encounter.started_at,
        identity_confidence: encounter.identity_confidence } };
    } else {
      const record = s.ClinicalRecordPayload[p.record_ref];
      need(record && s.encounter[record.encounter_ref]?.patient_ref === c.target && access.record_ids?.includes(p.record_ref) && Array.isArray(access.fields), 'missing_access');
      const safe = ['author_ref', 'occurred_at', 'entered_at', 'entry_type', 'content_refs', 'amendment_refs'];
      result = { status: 'ok', record: publicData(Object.fromEntries(access.fields.filter(f => safe.includes(f)).map(f => [f, clone(record[f])]))) };
    }
    const response = publicData({ mode: 'isolated', mock: true, ...result, revision: revision(s, c.target) });
    this.#audit(s, c, response, ctx.receipts, false);
    this.#state = new HealthState(s.toJSON()); return response;
  }
  async #evaluate(ctx) {
    const { s, c } = ctx, action = ctx.rules.actions[c.payload.action_ref]; need(action, 'missing_configuration');
    need(Array.isArray(action.requirements), 'missing_configuration');
    const health = s.health_record[c.target], composition = compose(s, c.target, c.canonical_time, action.action_class);
    if (health.terminal_event_id || (action.conscious === true && composition.projection.consciousness === 'unresponsive')) {
      return { status: 'ok', feasible: false, reason: 'Action is currently unavailable.', alternatives: [] };
    }
    const blocked = composition.restrictions.filter(r => action.requirements.includes(r.requirement));
    if (blocked.length) return { status: 'ok', feasible: false, reason: 'A required physical capability is unavailable.', alternatives: publicData(blocked[0].alternatives) };
    if (!predicate(action.when, { function: composition.projection })) return { status: 'ok', feasible: false, reason: action.reason, alternatives: action.alternatives };
    if (action.uncertainty_ref === 'none') return { status: 'ok', feasible: true, resolution_required: false };
    const seed = stableID(c.target, c.cause_ref, c.payload.action_ref);
    if (s.StoredResolution[seed]) return clone(s.StoredResolution[seed].resolved_outcome_ref);
    const result = await this.#call(ctx, 'resolution', 'action_check', { target: c.target,
      action_ref: c.payload.action_ref, requirements: action.requirements, modifiers: composition.modifiers,
      uncertainty_ref: action.uncertainty_ref, seed });
    const response = { status: 'ok', feasible: true, resolution_required: true, result: publicData(result) };
    put(s, 'StoredResolution', seed, { event_ref: ctx.event, seeded_input_ref: seed, resolved_outcome_ref: response, rules_version: c.rules_version });
    return response;
  }
}
