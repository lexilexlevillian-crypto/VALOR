/**
 * Isolated System 7: Relationship and Social Dynamics (Node.js, no dependencies).
 *
 * All numbered-system integrations below are JSON-only, stateless placeholders.
 * Adapters are trusted authority boundaries, never AI or player-supplied state.
 * No other system's logic, clock, knowledge, balances, actions, or consent is run.
 *
 * Storage choices: complete records; finite fractional numbers; nullable dates;
 * integer versions; one timeline per snapshot. These are implementation choices,
 * not requirements inferred from the source. No missing dimension defaults to 0.
 * Callers explicitly supply Policy, including initial values and delta formulas.
 * Rich fidelity retains the same sparse graph and never fabricates history.
 * Opaque JSON fields store beliefs/descriptions, never executable rights/actions.
 *
 * Public entry point: relationshipStateMachine(request, adapters?).
 * Save the returned snapshot only on success. Rejections preserve the input.
 * The persistence stub accepts a snapshot plus an outbox as ONE commit request;
 * production delivery/retries and durable transactions belong to System 25.
 * Adapter implementations must preserve that atomic contract and revision check.
 * All functions are synchronous; asynchronous transports need a separate adapter.
 */

/** @typedef {null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue}} JSONValue */
/** @typedef {{[key:string]:JSONValue}} JSONObject */
/** @typedef {{timeline_id:string,state:JSONObject}} Snapshot */
/** @typedef {(request:JSONObject)=>JSONObject} ExternalCall */
/** @typedef {{[key:string]:ExternalCall}} Adapters */
/**
 * @typedef {object} StateMachineRequest
 * @property {'ingest'|'inspect'|'restore'|'branch'|'rewind'|'retcon'} operation
 * @property {Snapshot} snapshot
 * @property {JSONObject} policy Explicit numeric policy, e.g. examplePolicy().
 * @property {string=} source_event_id Canonical event to ingest.
 * @property {string=} target_timeline_id Fresh branch ID.
 * @property {string[]=} invalidated_source_event_ids Rewind/retcon roots.
 * @property {string=} creator_source_event_id Required for retcons.
 * @property {string[]=} replacement_source_event_ids Retcon replacements.
 * @property {string=} observer_id Inspection scope.
 * @property {string=} target_id Inspection scope.
 * @property {'Lightweight'|'Structured'|'Rich'=} detail Processing detail only.
 */
/**
 * @typedef {object} StateMachineResult
 * @property {'committed'|'unchanged'|'inspected'|'restored'|'rejected'} status
 * @property {Snapshot} snapshot
 * @property {JSONObject[]} outbox
 * @property {JSONObject=} inspection
 * @property {JSONObject=} receipt
 * @property {{code:string,message:string}=} error
 */

export const DIMENSIONS = Object.freeze([
  'familiarity', 'trust', 'respect', 'affection', 'attachment', 'loyalty',
  'fear', 'resentment', 'dependency', 'tension', 'jealousy',
]);
const FIDELITIES = ['Minimal', 'Standard', 'Rich'];
const MAGNITUDES = ['trivial', 'minor', 'moderate', 'major', 'severe', 'life-changing'];
const DOMAINS = ['physical', 'sexual', 'conversational', 'financial', 'spatial',
  'communication', 'privacy', 'family', 'workplace'];
const CONFLICT_STATUSES = ['brewing', 'active', 'cooling', 'unresolved',
  'partially repaired', 'reconciled', 'estranged', 'ended'];
const DEBT_STATUSES = ['acknowledged', 'disputed', 'partial', 'repaid', 'forgiven', 'defaulted'];
const EXPECTATION_SOURCES = ['explicit agreement', 'role norms', 'repeated behavior',
  'family/group norms', 'unilateral assumptions'];
const CREATOR_KINDS = ['backstory_anchor', 'explicit_override', 'retcon'];

// Exactly the supplied persistence field names; no extensible state bag.
const SCHEMAS = Object.freeze({
  relationship_edges: ['relationship_id', 'timeline_id', 'observer_id', 'target_id',
    ...DIMENSIONS, 'subjective_label', 'fidelity_level', 'state_version'],
  relationship_roles: ['role_id', 'relationship_id', 'role_type', 'structural_truth',
    'subjective_claim', 'public_visibility', 'started_at', 'ended_at', 'source_event_id'],
  relationship_events: ['relationship_event_id', 'source_event_id', 'observer_id',
    'target_id', 'event_type', 'magnitude', 'perceived_intent', 'interpretation_confidence',
    'public_private', 'applied_at', 'update_version'],
  relationship_deltas: ['delta_id', 'relationship_event_id', 'dimension', 'before_value',
    'delta_value', 'after_value', 'modifier_tags', 'pattern_contribution'],
  relationship_expectations: ['expectation_id', 'owner_id', 'target_id', 'expectation_type',
    'source_type', 'strength', 'explicitness', 'status', 'created_at', 'expires_at', 'source_event_id'],
  relationship_promises: ['promise_id', 'promisor_id', 'promisee_id', 'content',
    'explicitness', 'significance', 'conditions', 'due_at', 'status', 'source_event_id'],
  social_obligations: ['obligation_id', 'perceived_by_id', 'toward_id', 'obligation_type',
    'legitimacy_belief', 'magnitude', 'status', 'source_event_id'],
  social_debts: ['debt_id', 'creditor_id', 'debtor_id', 'type', 'objective_source_event_id',
    'creditor_expected_value', 'debtor_acknowledged_value', 'status', 'repayment_terms',
    'created_at', 'closed_at'],
  relationship_boundaries: ['boundary_id', 'owner_id', 'target_id', 'domain', 'description',
    'explicitness', 'severity', 'known_by_target', 'exceptions', 'status', 'source_event_id'],
  relationship_conflicts: ['conflict_id', 'participant_ids', 'topics', 'intensity', 'status',
    'trigger_event_ids', 'unresolved_points', 'started_at', 'cooling_since', 'resolved_at'],
  relationship_patterns: ['pattern_id', 'observer_id', 'target_id', 'pattern_type', 'strength',
    'supporting_event_ids', 'last_updated_at'],
  relationship_cornerstones: ['cornerstone_id', 'observer_id', 'target_id', 'source_event_id',
    'category', 'salience', 'persistent_reason'],
  RelationshipInterpretationProposal: ['observer_id', 'target_id', 'source_event_id',
    'perceived_event_type', 'perceived_intent', 'confidence', 'relevant_dimensions',
    'magnitude_modifier', 'expectation_modifier', 'boundary_context', 'conflict_topics', 'reason_tags'],
  SocialGroup: ['group_id', 'type', 'members', 'explicit_norms', 'known_hierarchies',
    'shared_history_events', 'current_conflicts'],
});
const TABLES = Object.keys(SCHEMAS);
const ARRAY_FIELDS = new Set(['conditions', 'exceptions', 'participant_ids', 'topics',
  'trigger_event_ids', 'unresolved_points', 'supporting_event_ids', 'modifier_tags',
  'relevant_dimensions', 'boundary_context', 'conflict_topics', 'reason_tags', 'members',
  'explicit_norms', 'known_hierarchies', 'shared_history_events', 'current_conflicts']);
const DATES = new Set(['started_at', 'ended_at', 'applied_at', 'created_at', 'expires_at',
  'due_at', 'closed_at', 'cooling_since', 'resolved_at', 'last_updated_at']);
const NUMBERS = new Set([...DIMENSIONS, 'interpretation_confidence', 'before_value',
  'delta_value', 'after_value', 'strength', 'intensity', 'salience', 'confidence',
  'magnitude_modifier', 'expectation_modifier']);

class Rejected extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function requireThat(condition, code, message) {
  if (!condition) throw new Rejected(code, message);
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function id(value) { return typeof value === 'string' && value.trim().length > 0; }
function same(a, b) { return canonicalJSON(a) === canonicalJSON(b); }
function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k =>
    `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function assertJSON(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return;
  requireThat(typeof value === 'object' && !seen.has(value), 'invalid_json', 'Expected finite, acyclic JSON.');
  requireThat(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null, 'invalid_json', 'Expected plain JSON objects.');
  seen.add(value);
  for (const item of Object.values(value)) assertJSON(item, seen);
  seen.delete(value);
}
function clone(value) { assertJSON(value); return JSON.parse(JSON.stringify(value)); }
function exact(value, keys, name) {
  requireThat(object(value) && same(Object.keys(value).sort(), [...keys].sort()),
    'invalid_contract', `${name} must contain exactly its declared fields.`);
}
function stableId(...parts) { return JSON.stringify(parts); }
function unique(values) { return [...new Set(values)]; }
function subset(values, allowed) { return values.every(v => allowed.includes(v)); }
function timestamp(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)), 'invalid_time', 'Use an ISO timestamp with an explicit zone.');
  return Date.parse(value);
}

/** The instance owns ONLY the state collections named in the supplied contract. */
export class RelationshipState {
  constructor(records) {
    exact(records, TABLES, 'RelationshipState');
    for (const table of TABLES) {
      requireThat(Array.isArray(records[table]), 'invalid_state', `${table} must be an array.`);
      this[table] = clone(records[table]);
    }
  }
  toJSON() { return Object.fromEntries(TABLES.map(table => [table, clone(this[table])])); }
}

/** @returns {Snapshot} */
export function emptySnapshot(timeline_id) {
  requireThat(id(timeline_id), 'invalid_timeline', 'A timeline ID is required.');
  return { timeline_id, state: Object.fromEntries(TABLES.map(table => [table, []])) };
}

/**
 * Explicit DEMONSTRATION tuning, not authoritative source formulas.
 * Production callers may replace every coefficient/threshold. Numeric ranges are
 * adopted here as configured bounds, never inferred mandatory integer scales.
 */
export function examplePolicy() {
  const bounds = Object.fromEntries(DIMENSIONS.map(d => [d,
    ['trust', 'respect', 'affection'].includes(d) ? [-100, 100] : [0, 100]]));
  return {
    bounds, initial_values: Object.fromEntries(DIMENSIONS.map(d => [d, 0])),
    initial_label: 'unformed', initial_fidelity: 'Minimal', max_delta: 15,
    max_modifier: 2, max_pattern_strength: 100, pattern_step: 1,
    meaningful_threshold: 1, cheap_repeat_limit: 3, cheap_repeat_factor: 0.5,
    confidence_bounds: [0, 1], first_impression_confidence_cap: 0.35,
    first_impression_delta_cap: 3, cornerstone_threshold: 6,
    magnitude_weights: { trivial: 0, minor: 1, moderate: 2, major: 4, severe: 6, 'life-changing': 8 },
    templates: {
      reliability: { trust: 2, familiarity: 1 }, honesty: { trust: 2 },
      care: { affection: 2, familiarity: 1 }, protection: { trust: 2, attachment: 1 },
      harm: { trust: -2, resentment: 3, fear: 1 }, competence: { respect: 2 },
      loyalty: { loyalty: 1, trust: 1 }, boundary_respect: { trust: 1, tension: -1 },
      boundary: {}, 'social debt': {},
      boundary_violation: { trust: -2, resentment: 2, tension: 2 },
      favor: { affection: 1 }, gift: { affection: 1 }, compliment: { affection: 1 },
      disclosure: { familiarity: 1, trust: 1 }, exposure: { familiarity: 1 },
      promise_kept: { trust: 2 }, promise_failed: { trust: -2, resentment: 1 },
      refusal: {}, compliance: {}, dependency: { dependency: 1 },
      repair: { tension: -1, resentment: -1, trust: 1 },
      forgiveness: { resentment: -1 }, reconciliation: { tension: -1 },
      cooling: { tension: -1 }, conflict: { tension: 2, respect: 1, affection: -1 },
      jealousy: { jealousy: 1 }, correction: { tension: -1 },
      first_impression: { familiarity: 1, respect: 0.5 },
      structural: {}, player_stance: {}, creator_change: {}, elapsed_time: {},
    },
    positive_trust_evidence: ['reliability', 'honesty', 'protection', 'loyalty',
      'boundary_respect', 'disclosure', 'promise_kept', 'repair'],
    cheap_events: ['compliment', 'gift', 'favor'],
    conflict_transitions: Object.fromEntries(CONFLICT_STATUSES.map(s => [s, [...CONFLICT_STATUSES]])),
    failed_promise_statuses: ['failed', 'defaulted', 'missed'],
  };
}

function validatePolicy(p) {
  exact(p, Object.keys(examplePolicy()), 'Policy');
  exact(p.bounds, DIMENSIONS, 'Policy.bounds');
  exact(p.initial_values, DIMENSIONS, 'Policy.initial_values');
  exact(p.magnitude_weights, MAGNITUDES, 'Policy.magnitude_weights');
  for (const d of DIMENSIONS) {
    const b = p.bounds[d];
    requireThat(Array.isArray(b) && b.length === 2 && b.every(finite) && b[0] < b[1]
      && finite(p.initial_values[d]) && p.initial_values[d] >= b[0] && p.initial_values[d] <= b[1],
    'invalid_policy', `Invalid bounds/explicit initial value for ${d}.`);
  }
  for (const key of ['max_delta', 'max_modifier', 'max_pattern_strength', 'pattern_step',
    'meaningful_threshold', 'first_impression_delta_cap', 'cornerstone_threshold'])
    requireThat(finite(p[key]) && p[key] > 0, 'invalid_policy', `${key} must be positive.`);
  requireThat(Number.isSafeInteger(p.cheap_repeat_limit) && p.cheap_repeat_limit >= 0
    && finite(p.cheap_repeat_factor) && p.cheap_repeat_factor >= 0 && p.cheap_repeat_factor <= 1,
  'invalid_policy', 'Invalid anti-farming policy.');
  requireThat(Array.isArray(p.confidence_bounds) && p.confidence_bounds.length === 2
    && p.confidence_bounds.every(finite) && p.confidence_bounds[0] < p.confidence_bounds[1]
    && finite(p.first_impression_confidence_cap) && p.first_impression_confidence_cap >= p.confidence_bounds[0]
    && p.first_impression_confidence_cap <= p.confidence_bounds[1], 'invalid_policy', 'Invalid confidence policy.');
  requireThat(FIDELITIES.includes(p.initial_fidelity) && p.initial_fidelity !== 'Rich'
    && typeof p.initial_label === 'string', 'invalid_policy', 'New edges must be Minimal or Standard.');
  requireThat(Object.values(p.magnitude_weights).every(v => finite(v) && v >= 0),
    'invalid_policy', 'Magnitude weights must be nonnegative.');
  requireThat(object(p.templates), 'invalid_policy', 'Templates are required.');
  for (const template of Object.values(p.templates)) {
    requireThat(object(template) && subset(Object.keys(template), DIMENSIONS)
      && Object.values(template).every(finite), 'invalid_policy', 'Invalid dimension template.');
  }
  // Hard ownership/agency gates cannot be disabled by a tuning file.
  for (const type of ['structural', 'elapsed_time', 'compliance', 'refusal', 'player_stance', 'creator_change'])
    requireThat(object(p.templates[type]) && Object.values(p.templates[type]).every(v => v === 0),
      'invalid_policy', `${type} cannot automatically assign feelings.`);
  requireThat(object(p.templates.cooling) && Object.keys(p.templates.cooling).every(d => d === 'tension')
    && Object.values(p.templates.cooling).every(v => v <= 0), 'invalid_policy', 'Cooling only reduces tension.');
  requireThat(object(p.templates.dependency) && Object.keys(p.templates.dependency).every(d => d === 'dependency'),
    'invalid_policy', 'Dependency cannot be converted into love, trust, or loyalty.');
  for (const key of ['positive_trust_evidence', 'cheap_events', 'failed_promise_statuses'])
    requireThat(Array.isArray(p[key]) && p[key].every(id), 'invalid_policy', `Invalid ${key}.`);
  exact(p.conflict_transitions, CONFLICT_STATUSES, 'Policy.conflict_transitions');
  for (const transitions of Object.values(p.conflict_transitions))
    requireThat(Array.isArray(transitions) && subset(transitions, CONFLICT_STATUSES),
      'invalid_policy', 'Unknown conflict status.');
}

function validateRow(table, row) {
  exact(row, SCHEMAS[table], table);
  for (const [field, value] of Object.entries(row)) {
    if (field.endsWith('_id')) requireThat(id(value), 'invalid_record', `${field} must be an ID.`);
    if (ARRAY_FIELDS.has(field)) requireThat(Array.isArray(value), 'invalid_record', `${field} must be an array.`);
    if (NUMBERS.has(field)) requireThat(finite(value), 'invalid_record', `${field} must be finite.`);
    if (DATES.has(field) && value !== null) timestamp(value);
    if (['state_version', 'update_version'].includes(field))
      requireThat(Number.isSafeInteger(value) && value >= 0, 'invalid_record', 'Invalid version.');
  }
  if (table === 'relationship_edges') {
    requireThat(row.observer_id !== row.target_id && FIDELITIES.includes(row.fidelity_level)
      && typeof row.subjective_label === 'string', 'invalid_edge', 'Invalid directional edge.');
  }
  if (table === 'relationship_events')
    requireThat(MAGNITUDES.includes(row.magnitude) && row.applied_at !== null,
      'invalid_record', 'Invalid event magnitude/date.');
  if (table === 'relationship_deltas')
    requireThat(DIMENSIONS.includes(row.dimension) && row.modifier_tags.every(id),
      'invalid_record', 'Invalid dimension or modifier tags.');
  if (table === 'relationship_boundaries')
    requireThat(DOMAINS.includes(row.domain) && typeof row.known_by_target === 'boolean',
      'invalid_boundary', 'Invalid boundary domain or communication flag.');
  if (table === 'relationship_expectations')
    requireThat(EXPECTATION_SOURCES.includes(row.source_type), 'invalid_expectation', 'Unknown expectation source.');
  if (table === 'relationship_conflicts')
    requireThat(CONFLICT_STATUSES.includes(row.status) && row.participant_ids.length >= 2
      && row.participant_ids.every(id) && unique(row.participant_ids).length === row.participant_ids.length,
    'invalid_conflict', 'Invalid conflict status/participants.');
  if (table === 'social_debts')
    requireThat(DEBT_STATUSES.includes(row.status) && row.creditor_id !== row.debtor_id,
      'invalid_debt', 'Invalid social debt.');
}

function validateSnapshot(snapshot, policy) {
  exact(snapshot, ['timeline_id', 'state'], 'Snapshot');
  requireThat(id(snapshot.timeline_id), 'invalid_timeline', 'Missing timeline.');
  const s = new RelationshipState(snapshot.state);
  for (const table of TABLES) {
    const keys = new Set();
    for (const row of s[table]) {
      validateRow(table, row);
      const key = table === 'RelationshipInterpretationProposal'
        ? stableId(row.source_event_id, row.observer_id, row.target_id) : row[SCHEMAS[table][0]];
      requireThat(!keys.has(key), 'duplicate_record', `Duplicate ${table} ID.`);
      keys.add(key);
    }
  }
  const pairs = new Set();
  for (const edge of s.relationship_edges) {
    const key = stableId(edge.observer_id, edge.target_id);
    requireThat(edge.timeline_id === snapshot.timeline_id && !pairs.has(key),
      'branch_isolation', 'An edge has a duplicate pair or wrong timeline.');
    pairs.add(key);
    for (const d of DIMENSIONS) requireThat(edge[d] >= policy.bounds[d][0] && edge[d] <= policy.bounds[d][1],
      'out_of_bounds', `Stored ${d} violates configured bounds.`);
  }
  const applied = new Set();
  const eventIds = new Set(s.relationship_events.map(e => e.relationship_event_id));
  for (const event of s.relationship_events) {
    const key = stableId(event.source_event_id, event.observer_id, event.target_id);
    const edge = findEdge(s, event.observer_id, event.target_id);
    requireThat(edge && !applied.has(key) && event.update_version <= edge.state_version,
      'invalid_history', 'Duplicate event effect, missing edge, or invalid event version.');
    requireThat(event.interpretation_confidence >= policy.confidence_bounds[0]
      && event.interpretation_confidence <= policy.confidence_bounds[1], 'invalid_history', 'Invalid confidence.');
    applied.add(key);
  }
  const accounting = new Set();
  for (const delta of s.relationship_deltas) {
    const key = stableId(delta.relationship_event_id, delta.dimension);
    requireThat(eventIds.has(delta.relationship_event_id) && !accounting.has(key)
      && Math.abs(delta.before_value + delta.delta_value - delta.after_value) < 1e-9,
    'invalid_accounting', 'Orphan/duplicate delta or inconsistent accounting.');
    accounting.add(key);
    const creator = delta.modifier_tags.some(t => CREATOR_KINDS.some(k => t === `creator:${k}`));
    requireThat(creator || Math.abs(delta.delta_value) <= policy.max_delta + 1e-9,
      'out_of_bounds', 'Stored ordinary delta exceeds configured bounds.');
    for (const value of [delta.before_value, delta.after_value])
      requireThat(value >= policy.bounds[delta.dimension][0] && value <= policy.bounds[delta.dimension][1],
        'out_of_bounds', 'Stored accounting value exceeds configured bounds.');
    if (delta.dimension === 'jealousy' && delta.delta_value !== 0)
      requireThat(delta.modifier_tags.some(t => t.startsWith('jealousy_context:')),
        'missing_jealousy_context', 'Jealousy needs explicit context and source.');
  }
  for (const edge of s.relationship_edges) {
    const history = s.relationship_events.filter(e => e.observer_id === edge.observer_id && e.target_id === edge.target_id)
      .sort((a, b) => a.update_version - b.update_version);
    requireThat(history.length === edge.state_version && history.every((e, i) => e.update_version === i + 1),
      'invalid_history', 'Each edge version must have a unique event.');
    for (const dimension of DIMENSIONS) {
      let previous;
      for (const event of history) {
        const delta = s.relationship_deltas.find(d => d.relationship_event_id === event.relationship_event_id && d.dimension === dimension);
        requireThat(delta, 'invalid_accounting', 'Every event must account for all dimensions, including unchanged values.');
        requireThat(previous === undefined || Math.abs(previous - delta.before_value) < 1e-9,
          'invalid_accounting', 'Broken dimension history.');
        previous = delta.after_value;
      }
      requireThat(previous === undefined || Math.abs(previous - edge[dimension]) < 1e-9,
        'invalid_accounting', 'Edge does not match its latest accounting.');
    }
  }
  for (const role of s.relationship_roles)
    requireThat(s.relationship_edges.some(e => e.relationship_id === role.relationship_id),
      'invalid_role', 'Role references a missing edge.');
  const sourceIds = new Set(s.relationship_events.map(e => e.source_event_id));
  for (const table of TABLES) for (const row of s[table]) {
    const source = row.source_event_id ?? row.objective_source_event_id;
    if (source) requireThat(sourceIds.has(source), 'unsupported_history', 'Stored record lacks a linked source event.');
  }
  for (const pattern of s.relationship_patterns) {
    requireThat(findEdge(s, pattern.observer_id, pattern.target_id)
      && unique(pattern.supporting_event_ids).length === pattern.supporting_event_ids.length
      && pattern.strength >= 0 && pattern.strength <= policy.max_pattern_strength
      && pattern.supporting_event_ids.every(eventId =>
      s.relationship_events.some(e => e.relationship_event_id === eventId && e.observer_id === pattern.observer_id
        && e.target_id === pattern.target_id)), 'invalid_pattern', 'Pattern evidence must belong to its directional edge.');
  }
  for (const cornerstone of s.relationship_cornerstones)
    requireThat(s.relationship_events.some(e => e.source_event_id === cornerstone.source_event_id
      && e.observer_id === cornerstone.observer_id && e.target_id === cornerstone.target_id),
    'invalid_cornerstone', 'Cornerstone lacks perceived event provenance.');
  for (const proposal of s.RelationshipInterpretationProposal)
    requireThat(applied.has(stableId(proposal.source_event_id, proposal.observer_id, proposal.target_id)),
      'invalid_interpretation', 'Stored proposal lacks a committed event.');
  return s;
}

// ---------------------------------------------------------------------------
// Black-box placeholders. No external system is implemented or simulated here.
// IDs echoed into a dummy payload are correlation data, not external state.
// ---------------------------------------------------------------------------

/** @type {ExternalCall} */
export function requestCanonicalEvent(request) {
  return {
    source_event_id: request.source_event_id, timeline_id: request.timeline_id,
    applied_at: '2026-01-01T12:00:00Z',
    entities: [{ entity_id: 'npc-observer', kind: 'npc' }, { entity_id: 'npc-target', kind: 'npc' }],
    pairs: [{ observer_id: 'npc-observer', target_id: 'npc-target' }],
    creation_basis: 'meaningful_contact', derived_from_event_ids: [],
    structural_changes: [], promise_conditions: {}, accepted_renegotiations: {},
  };
}
/** @type {ExternalCall} */
export function requestSystem3Knowledge(request) {
  return {
    timeline_id: request.timeline_id, source_event_id: request.source_event_id,
    observer_id: request.observer_id, target_id: request.target_id, known: true,
    view: {
      event_type: 'reliability', magnitude: 'minor', perceived_intent: 'helpful',
      confidence: 0.5, public_private: 'private', meaningful: true,
      allowed_event_types: ['reliability'], reason_tags: ['observed:follow_through'],
      known_source_event_ids: [request.source_event_id], domain: 'professional',
      jealousy_context: [], novelty_key: 'routine-follow-through', low_novelty: false,
      boundary_context: [], conflict_topics: [], record_changes: [],
      supported_dimensions: ['trust', 'familiarity'],
      magnitude_modifier: 1, expectation_modifier: 1,
      desired_fidelity: null, subjective_label: null,
      repair_evidence: [], communication_provenance: null,
    },
  };
}
export function requestSystem4Memory() { return { memories: [], cornerstone_references: [] }; }
export function requestSystem5Personality() { return { dimension_modifiers: {}, reason_tags: [] }; }
export function requestSystem6Autonomy() { return { actual_interactions: [], outcomes: [] }; }
export function requestSystem8Romance() { return { bridge_events: [], attraction_authority: 'System 8' }; }
export function requestSystem11Time() { return { now: '2026-01-01T12:00:00Z', elapsed_seconds: 0 }; }
export function requestSystem13Jobs() { return { workplace_events: [], known_hierarchies: [] }; }
export function requestSystem14EconomyHousing() { return { known_transactions: [], housing_context: [] }; }
export function requestSystem16Communications() { return { delivered_message_events: [] }; }
export function requestSystem18HealthSubstance() { return { known_context: [] }; }
export function requestSystem20CrimeLaw() { return { canonical_coercion_events: [] }; }
export function requestSystem22Factions() { return { formal_roles: [], known_obligations: [] }; }
export function requestSystem23LivingCity() { return { observed_public_events: [] }; }
export function requestSystem24Storylines() { return { canonical_situations: [] }; }
export function requestReputation() { return { known_reputation: [] }; }
export function requestSystem2Narrative() { return { audience: 'observer', include_hidden_metrics: false }; }
export function requestAIInterpretation() { return { proposal: null }; }
export function requestPlayerCreatorControls() {
  return { delegations: [], player_stances: [], creator_changes: [], inspection_authorized: false };
}
export function requestSystem25ReplayPlan(request) {
  return { anchor_snapshot: emptySnapshot(request.timeline_id), ordered_source_event_ids: [],
    dependency_graph: {}, preserved_creator_anchor_source_event_ids: [], complete: true };
}
/** The production implementation must atomically compare expected_snapshot and store snapshot + outbox. */
export function commitSystem25Persistence() { return { accepted: true, receipt_id: 'dummy-atomic-commit' }; }

// Outbound calls are also placeholders. They may be used by the outbox consumer;
// the state machine never invokes them before the persistence commit succeeds.
export function publishCanonicalUpdates() { return { accepted: true, destination: 'canonical_authority' }; }
export function publishSystem2Narrative() { return { accepted: true, destination: 'System 2' }; }
export function publishSystem3Context() { return { accepted: true, destination: 'System 3' }; }
export function publishSystem4Memory() { return { accepted: true, destination: 'System 4' }; }
export function publishSystem5Behavior() { return { accepted: true, destination: 'System 5' }; }
export function publishSystem6Pressures() { return { accepted: true, destination: 'System 6' }; }
export function publishSystem8Bridge() { return { accepted: true, destination: 'System 8' }; }
export function publishSystem11Evaluations() { return { accepted: true, destination: 'System 11' }; }
export function publishSystem13Workplace() { return { accepted: true, destination: 'System 13' }; }
export function publishSystem14SocialDebt() { return { accepted: true, destination: 'System 14' }; }
export function publishSystem16RelationshipMeaning() { return { accepted: true, destination: 'System 16' }; }
export function publishSystem18KnownContext() { return { accepted: true, destination: 'System 18' }; }
export function publishSystem20SocialConsequences() { return { accepted: true, destination: 'System 20' }; }
export function publishSystem22InterpersonalContext() { return { accepted: true, destination: 'System 22' }; }
export function publishSystem23ObservedEvents() { return { accepted: true, destination: 'System 23' }; }
export function publishSystem24Milestones() { return { accepted: true, destination: 'System 24' }; }
export function publishReputationInputs() { return { accepted: true, destination: 'reputation_authority' }; }
export function publishPlayerCreatorAudit() { return { accepted: true, destination: 'player_creator_controls' }; }

export const DEFAULT_ADAPTERS = Object.freeze({
  canonical: requestCanonicalEvent, knowledge: requestSystem3Knowledge, memory: requestSystem4Memory,
  personality: requestSystem5Personality, controls: requestPlayerCreatorControls,
  time: requestSystem11Time, ai: requestAIInterpretation,
  replay: requestSystem25ReplayPlan, commit: commitSystem25Persistence,
});
function call(adapters, name, request) {
  const result = adapters[name](clone(request));
  requireThat(object(result), 'invalid_dependency', `${name} must return a JSON object synchronously.`);
  return clone(result);
}
function findEdge(s, observer_id, target_id) {
  return s.relationship_edges.find(e => e.observer_id === observer_id && e.target_id === target_id);
}
function pairHistory(s, pair) {
  return s.relationship_events.filter(e => e.observer_id === pair.observer_id && e.target_id === pair.target_id);
}
function pairRecords(s, edge) {
  const o = edge.observer_id, t = edge.target_id;
  return {
    expectations: s.relationship_expectations.filter(r => r.owner_id === o && r.target_id === t),
    boundaries: s.relationship_boundaries.filter(r => r.owner_id === o && r.target_id === t),
    obligations: s.social_obligations.filter(r => r.perceived_by_id === o && r.toward_id === t),
    roles: s.relationship_roles.filter(r => r.relationship_id === edge.relationship_id),
    debts: s.social_debts.filter(r => (r.creditor_id === o && r.debtor_id === t) || (r.creditor_id === t && r.debtor_id === o)),
    promises: s.relationship_promises.filter(r => (r.promisor_id === o && r.promisee_id === t) || (r.promisor_id === t && r.promisee_id === o)),
    conflicts: s.relationship_conflicts.filter(r => r.participant_ids.includes(o) && r.participant_ids.includes(t)),
    patterns: s.relationship_patterns.filter(r => r.observer_id === o && r.target_id === t),
  };
}

function validateEvent(event, timeline_id, source_event_id) {
  requireThat(event.timeline_id === timeline_id && event.source_event_id === source_event_id,
    'source_mismatch', 'Canonical event identity/timeline mismatch.');
  timestamp(event.applied_at);
  requireThat(Array.isArray(event.entities) && event.entities.every(e => id(e.entity_id) && ['npc', 'player'].includes(e.kind))
    && unique(event.entities.map(e => e.entity_id)).length === event.entities.length,
  'invalid_entities', 'Canonical entity identities and control kinds are required.');
  requireThat(Array.isArray(event.pairs) && event.pairs.length > 0 && Array.isArray(event.derived_from_event_ids)
    && event.derived_from_event_ids.every(id) && !event.derived_from_event_ids.includes(source_event_id),
  'invalid_event', 'Canonical affected pairs and causal dependencies are required.');
  const keys = new Set();
  for (const pair of event.pairs) {
    exact(pair, ['observer_id', 'target_id'], 'Directional pair');
    const key = stableId(pair.observer_id, pair.target_id);
    requireThat(pair.observer_id !== pair.target_id && !keys.has(key)
      && [pair.observer_id, pair.target_id].every(x => event.entities.some(e => e.entity_id === x)),
    'invalid_pair', 'Invalid or duplicate canonical directional pair.');
    keys.add(key);
  }
  requireThat(Array.isArray(event.structural_changes) && object(event.promise_conditions)
    && object(event.accepted_renegotiations), 'invalid_event', 'Canonical structural/conditional facts are required.');
}

function validateView(view, policy) {
  requireThat(object(view) && Object.hasOwn(policy.templates, view.event_type)
    && MAGNITUDES.includes(view.magnitude) && typeof view.meaningful === 'boolean'
    && ['public', 'private'].includes(view.public_private) && typeof view.perceived_intent === 'string'
    && finite(view.confidence), 'invalid_view', 'Incomplete observer-safe interpretation context.');
  for (const key of ['allowed_event_types', 'reason_tags', 'known_source_event_ids', 'jealousy_context',
    'boundary_context', 'conflict_topics', 'record_changes', 'supported_dimensions', 'repair_evidence'])
    requireThat(Array.isArray(view[key]), 'invalid_view', `Missing ${key}.`);
  requireThat(view.allowed_event_types.includes(view.event_type)
    && view.allowed_event_types.every(t => Object.hasOwn(policy.templates, t))
    && subset(view.supported_dimensions, DIMENSIONS) && view.reason_tags.every(id)
    && view.known_source_event_ids.every(id) && view.jealousy_context.every(id)
    && (view.domain === null || id(view.domain)) && (view.novelty_key === null || id(view.novelty_key))
    && typeof view.low_novelty === 'boolean', 'invalid_view', 'Invalid observer-safe evidence.');
  for (const k of ['magnitude_modifier', 'expectation_modifier'])
    requireThat(finite(view[k]) && view[k] >= 0 && view[k] <= policy.max_modifier,
      'invalid_view', 'Context modifier outside configured bounds.');
  requireThat(view.confidence >= policy.confidence_bounds[0] && view.confidence <= policy.confidence_bounds[1],
    'invalid_view', 'Confidence outside configured bounds.');
  if (view.event_type === 'rumor' || view.reason_tags.includes('received:rumor'))
    requireThat(object(view.communication_provenance) && id(view.communication_provenance.source_event_id)
      && view.known_source_event_ids.includes(view.communication_provenance.source_event_id),
    'missing_communication_path', 'Gossip needs a known communication source.');
}

function authoredChange(controls, event, pair) {
  for (const key of ['delegations', 'player_stances', 'creator_changes'])
    requireThat(Array.isArray(controls[key]), 'invalid_controls', `Missing ${key}.`);
  const matches = row => row.source_event_id === event.source_event_id
    && row.observer_id === pair.observer_id && row.target_id === pair.target_id;
  const creator = controls.creator_changes.filter(matches);
  const stance = controls.player_stances.filter(matches);
  requireThat(creator.length + stance.length <= 1, 'ambiguous_authorship', 'An effect has multiple authors.');
  if (creator.length) requireThat(CREATOR_KINDS.includes(creator[0].kind),
    'invalid_creator_provenance', 'Creator changes must be labeled anchor, override, or retcon.');
  const result = creator[0] ?? stance[0] ?? null;
  if (result) {
    requireThat(object(result.values) && subset(Object.keys(result.values), DIMENSIONS)
      && Object.values(result.values).every(finite)
      && (result.subjective_label === null || typeof result.subjective_label === 'string')
      && Array.isArray(result.jealousy_context) && result.jealousy_context.every(id),
    'invalid_authorship', 'Authored changes require explicit values, label, and jealousy context.');
  }
  return result ? { ...result, kind: creator.length ? result.kind : 'player_stance' } : null;
}

function fallbackProposal(pair, event, view, policy, first) {
  return {
    ...pair, source_event_id: event.source_event_id, perceived_event_type: view.event_type,
    perceived_intent: view.perceived_intent,
    confidence: first ? Math.min(view.confidence, policy.first_impression_confidence_cap) : view.confidence,
    relevant_dimensions: Object.keys(policy.templates[view.event_type]).filter(d => view.supported_dimensions.includes(d)),
    magnitude_modifier: view.magnitude_modifier, expectation_modifier: view.expectation_modifier,
    boundary_context: clone(view.boundary_context), conflict_topics: clone(view.conflict_topics),
    reason_tags: clone(view.reason_tags),
  };
}

function interpret(adapters, safeContext, fallback, policy) {
  try {
    const proposal = call(adapters, 'ai', safeContext).proposal;
    if (proposal === null) return { proposal: fallback, mode: 'deterministic' };
    validateRow('RelationshipInterpretationProposal', proposal);
    const view = safeContext.view;
    requireThat(proposal.observer_id === fallback.observer_id && proposal.target_id === fallback.target_id
      && proposal.source_event_id === fallback.source_event_id
      && view.allowed_event_types.includes(proposal.perceived_event_type),
    'unsafe_interpretation', 'AI changed source, pair, or unsupported classification.');
    requireThat(subset(proposal.relevant_dimensions, Object.keys(policy.templates[proposal.perceived_event_type]))
      && subset(proposal.relevant_dimensions, view.supported_dimensions)
      && unique(proposal.relevant_dimensions).length === proposal.relevant_dimensions.length
      && subset(proposal.reason_tags, view.reason_tags)
      && same(proposal.boundary_context, view.boundary_context)
      && subset(proposal.conflict_topics, view.conflict_topics)
      && proposal.perceived_intent === view.perceived_intent,
    'unsafe_interpretation', 'AI used unsupported knowledge, history, intent, or dimensions.');
    // AI may select supported dimensions/classifications; it cannot invent numeric evidence.
    requireThat(proposal.magnitude_modifier === fallback.magnitude_modifier
      && proposal.expectation_modifier === fallback.expectation_modifier
      && proposal.confidence >= policy.confidence_bounds[0] && proposal.confidence <= fallback.confidence,
    'unsafe_interpretation', 'AI changed bounded evidence or overstated certainty.');
    return { proposal, mode: 'ai_validated' };
  } catch {
    return { proposal: fallback, mode: 'deterministic_fallback' };
  }
}

function allowedDimensions(event, pair, controls, authored) {
  if (authored?.kind && CREATOR_KINDS.includes(authored.kind)) return [...DIMENSIONS];
  const player = event.entities.find(e => e.entity_id === pair.observer_id).kind === 'player';
  if (!player) return [...DIMENSIONS];
  if (authored?.kind === 'player_stance') return Object.keys(authored.values);
  const delegated = controls.delegations.filter(d => d.observer_id === pair.observer_id
    && d.target_id === pair.target_id && d.active === true && Array.isArray(d.dimensions)
    && subset(d.dimensions, DIMENSIONS)).flatMap(d => d.dimensions);
  return unique(['familiarity', ...delegated]);
}

function processRecordChanges(s, edge, event, view, policy, now, authored) {
  const histories = pairHistory(s, edge).map(e => e.source_event_id);
  const known = unique([...view.known_source_event_ids, ...histories, event.source_event_id]);
  const immutable = ['source_event_id', 'objective_source_event_id', 'owner_id', 'target_id',
    'promisor_id', 'promisee_id', 'creditor_id', 'debtor_id', 'perceived_by_id', 'toward_id',
    'relationship_id', 'created_at', 'started_at'];
  const changeable = ['relationship_roles', 'relationship_expectations', 'relationship_promises',
    'social_obligations', 'social_debts', 'relationship_boundaries', 'relationship_conflicts', 'SocialGroup'];
  const touched = new Set();
  for (const change of view.record_changes) {
    exact(change, ['table', 'record'], 'Record change');
    const { table, record } = change;
    requireThat(changeable.includes(table), 'unauthorized_change', 'This collection cannot be directly changed.');
    validateRow(table, record);
    const keyField = SCHEMAS[table][0];
    const key = stableId(table, record[keyField]);
    requireThat(!touched.has(key), 'duplicate_change', 'A record may change only once per directional effect.');
    touched.add(key);
    const old = s[table].find(r => r[keyField] === record[keyField]);
    if (old) for (const field of immutable.filter(k => Object.hasOwn(old, k)))
      requireThat(same(old[field], record[field]), 'history_preservation', `Cannot rewrite ${field}.`);
    const source = record.source_event_id ?? record.objective_source_event_id;
    if (source) requireThat(known.includes(source) && (old || source === event.source_event_id),
      'unsupported_history', 'New records must cite the current source.');
    const o = edge.observer_id, t = edge.target_id;
    if (['relationship_expectations', 'relationship_boundaries'].includes(table))
      requireThat(record.owner_id === o && record.target_id === t, 'invalid_owner', 'Record is outside the directional scope.');
    if (table === 'social_obligations')
      requireThat(record.perceived_by_id === o && record.toward_id === t,
        'invalid_owner', 'An obligation is a directional belief, not a right.');
    if (table === 'relationship_roles' || table === 'SocialGroup') {
      requireThat(event.structural_changes.some(c => same(c, change)),
        'unauthorized_structure', 'Structural roles/groups require exact canonical authorization.');
      if (table === 'relationship_roles') requireThat(record.relationship_id === edge.relationship_id,
        'invalid_role', 'Structural role must reference this edge.');
      if (old && table === 'SocialGroup') requireThat(old.shared_history_events.every(x =>
        record.shared_history_events.some(y => same(x, y))), 'history_preservation', 'Group history cannot be erased.');
    }
    if (table === 'social_debts') {
      requireThat([record.creditor_id, record.debtor_id].includes(o)
        && [record.creditor_id, record.debtor_id].includes(t), 'invalid_debt', 'Debt parties must match the edge.');
      // A canonical/view payload must explicitly support BOTH perceptions. No derivation from value paid.
      requireThat(view.reason_tags.includes('debt:independent_perceptions'),
        'unsupported_debt', 'Creditor expectation and debtor acknowledgment need separate supplied evidence.');
      if (['repaid', 'forgiven'].includes(record.status))
        requireThat(record.closed_at !== null, 'invalid_debt', 'Closing a debt requires a date.');
    }
    if (table === 'relationship_boundaries' && old && !old.known_by_target && record.known_by_target)
      requireThat(view.reason_tags.includes('boundary:communicated'),
        'unsupported_communication', 'A target can learn a boundary only through evidenced communication.');
    if (table === 'relationship_promises') {
      requireThat([record.promisor_id, record.promisee_id].includes(o)
        && [record.promisor_id, record.promisee_id].includes(t), 'invalid_promise', 'Promise parties must match the edge.');
      if (policy.failed_promise_statuses.includes(record.status)) {
        const conditions = (old ?? record).conditions;
        const facts = event.promise_conditions[record.promise_id];
        requireThat(conditions.length === 0 || (Array.isArray(facts) && facts.length === conditions.length
          && facts.every(x => x === true)), 'conditional_promise', 'Unsatisfied/unknown conditions cannot cause failure.');
        if (record.status === 'missed') requireThat(record.due_at !== null && timestamp(now) >= timestamp(record.due_at),
          'premature_failure', 'A deadline cannot be missed before canonical time reaches it.');
      }
      const terms = ['content', 'conditions', 'due_at', 'explicitness', 'significance'];
      if (record.status === 'renegotiated' || (old && terms.some(k => !same(old[k], record[k])))) {
        const accepted = event.accepted_renegotiations[record.promise_id];
        requireThat(Array.isArray(accepted) && accepted.includes(record.promisor_id) && accepted.includes(record.promisee_id),
          'unaccepted_renegotiation', 'Both affected parties must accept changed promise terms.');
      }
    }
    if (table === 'relationship_conflicts') {
      requireThat(record.participant_ids.includes(o) && record.participant_ids.includes(t)
        && record.trigger_event_ids.every(x => known.includes(x))
        && record.trigger_event_ids.includes(event.source_event_id),
      'invalid_conflict', 'Conflict requires known current provenance and both participants.');
      if (old) {
        requireThat(policy.conflict_transitions[old.status].includes(record.status)
          && old.trigger_event_ids.every(x => record.trigger_event_ids.includes(x))
          && old.topics.every(x => record.topics.some(y => same(x, y)))
          && old.participant_ids.every(x => record.participant_ids.includes(x)),
        'history_preservation', 'Invalid conflict transition or erased history.');
        if (old.unresolved_points.some(x => !record.unresolved_points.some(y => same(x, y))))
          requireThat(view.reason_tags.includes('conflict:resolved_points'),
            'unsupported_repair', 'Removing unresolved points requires perceived resolution evidence.');
      }
      if (record.status === 'reconciled') requireThat(view.event_type === 'reconciliation'
        && view.reason_tags.includes('reconciliation:mutual'), 'unsupported_reconciliation', 'Reconciliation must be an actual mutual outcome.');
    }
    const playerOwner = event.entities.find(e => e.entity_id === o).kind === 'player';
    if (playerOwner && ['relationship_expectations', 'social_obligations', 'relationship_boundaries'].includes(table))
      requireThat(authored || view.reason_tags.includes('player:explicit_authorship'),
        'player_agency', 'Player expectations, boundaries, and perceived obligations must be authored.');
    if (table === 'social_debts' && event.entities.some(e => e.entity_id === record.debtor_id && e.kind === 'player')
      && (!old || !same(old.debtor_acknowledged_value, record.debtor_acknowledged_value)))
      requireThat(view.reason_tags.includes('player:explicit_authorship'),
        'player_agency', 'Player acknowledgment of a debt cannot be inferred.');
    if (old) s[table][s[table].indexOf(old)] = clone(record);
    else s[table].push(clone(record));
  }
}

/**
 * Optional boundary_context entries use this implementation contract:
 * {boundary_id, known_by_target, intent: 'accidental'|'intentional'|'unknown',
 *  exception_applies: boolean, modifier: number}.
 * Knowledge supplies these perceptions. System 7 only checks owned records and
 * computes their supplied bounded modifier; it never deduces another mind.
 */
function boundaryModifier(s, pair, view, policy) {
  let multiplier = 1;
  for (const context of view.boundary_context) {
    exact(context, ['boundary_id', 'known_by_target', 'intent', 'exception_applies', 'modifier'], 'Boundary context');
    const boundary = s.relationship_boundaries.find(b => b.boundary_id === context.boundary_id
      && b.owner_id === pair.observer_id && b.target_id === pair.target_id);
    requireThat(boundary && context.known_by_target === boundary.known_by_target
      && ['accidental', 'intentional', 'unknown'].includes(context.intent)
      && typeof context.exception_applies === 'boolean' && finite(context.modifier)
      && context.modifier >= 0 && context.modifier <= policy.max_modifier,
    'unsupported_boundary', 'Boundary context needs an owned record, matching awareness, and a bounded modifier.');
    if (view.event_type === 'boundary_violation')
      requireThat(!context.exception_applies, 'boundary_exception', 'An applicable exception cannot be classified as a violation.');
    multiplier *= context.modifier;
  }
  return Math.min(policy.max_modifier, multiplier);
}

/** Domain evidence is directional history, not an extra authoritative trust meter. */
export function domainTrustEvidence(snapshot, observer_id, target_id, domain) {
  const events = snapshot.state.relationship_events.filter(e => e.observer_id === observer_id && e.target_id === target_id);
  return clone(snapshot.state.relationship_deltas.filter(d => d.dimension === 'trust'
    && d.modifier_tags.includes(`domain:${domain}`)
    && events.some(e => e.relationship_event_id === d.relationship_event_id)));
}

function applySource(snapshot, source_event_id, adapters, policy, outbox, options = {}) {
  const sourceTimeline = options.source_timeline_id ?? snapshot.timeline_id;
  const query = { timeline_id: sourceTimeline, source_event_id,
    as_of_source_event_id: options.replay ? source_event_id : null };
  const event = call(adapters, 'canonical', query);
  validateEvent(event, sourceTimeline, source_event_id);
  const controls = call(adapters, 'controls', query);
  const now = call(adapters, 'time', query).now;
  requireThat(timestamp(now) >= timestamp(event.applied_at), 'future_event', 'Event lies after canonical time.');
  const s = new RelationshipState(snapshot.state);
  let changed = false;
  for (const pair of event.pairs) {
    // Source + directional pair is the idempotence key, regardless of interpretation.
    if (pairHistory(s, pair).some(e => e.source_event_id === source_event_id)) continue;
    const authored = authoredChange(controls, event, pair);
    const knowledge = call(adapters, 'knowledge', { ...query, ...pair });
    requireThat(knowledge.timeline_id === sourceTimeline && knowledge.source_event_id === source_event_id
      && knowledge.observer_id === pair.observer_id && knowledge.target_id === pair.target_id
      && typeof knowledge.known === 'boolean', 'knowledge_mismatch', 'Observer knowledge must match the source and pair.');
    const creator = authored && CREATOR_KINDS.includes(authored.kind);
    if (!knowledge.known && !creator) continue;
    // Creator provenance can author state without fabricating an observer perception.
    const view = creator ? {
      event_type: 'creator_change', magnitude: 'minor', perceived_intent: 'explicit Creator authorship',
      confidence: policy.confidence_bounds[0], public_private: 'private', meaningful: true,
      allowed_event_types: ['creator_change'], reason_tags: [`creator:${authored.kind}`],
      known_source_event_ids: [source_event_id], domain: null, jealousy_context: authored.jealousy_context,
      novelty_key: null, low_novelty: false, boundary_context: [], conflict_topics: [], record_changes: [],
      supported_dimensions: [], magnitude_modifier: 1, expectation_modifier: 1,
      desired_fidelity: null, subjective_label: null, repair_evidence: [], communication_provenance: null,
    } : clone(knowledge.view);
    validateView(view, policy);
    requireThat(view.known_source_event_ids.includes(source_event_id),
      'unknown_source', 'The event itself must be known, including a rumor receipt rather than its alleged incident.');
    const factual = view.record_changes.length > 0 || authored !== null;
    const weight = policy.magnitude_weights[view.magnitude];
    if ((!view.meaningful || weight < policy.meaningful_threshold) && !factual) continue;
    let edge = findEdge(s, pair.observer_id, pair.target_id);
    const first = !edge;
    if (!edge) {
      requireThat(['meaningful_contact', 'structural_tie', 'repeated_interaction', 'authored_backstory'].includes(event.creation_basis),
        'sparse_graph', 'An edge requires meaningful contact, structural ties, repeated interaction, or authorship.');
      if (event.creation_basis === 'authored_backstory') requireThat(creator,
        'unsupported_backstory', 'Backstory requires explicit Creator provenance.');
      edge = { relationship_id: stableId('edge', snapshot.timeline_id, pair.observer_id, pair.target_id),
        timeline_id: snapshot.timeline_id, ...pair, ...clone(policy.initial_values),
        subjective_label: policy.initial_label, fidelity_level: policy.initial_fidelity, state_version: 0 };
      s.relationship_edges.push(edge);
    }
    const previousEdge = clone(edge);
    const history = pairHistory(s, pair);
    const rawMemory = call(adapters, 'memory', { ...query, ...pair });
    requireThat(Array.isArray(rawMemory.memories), 'invalid_memory', 'Memory stub must return a memories array.');
    // Only ID references are sent to AI; free-form external memory text may contain hidden truths.
    const memories = rawMemory.memories.filter(m => id(m.source_event_id)
      && view.known_source_event_ids.includes(m.source_event_id)).map(m => ({ source_event_id: m.source_event_id }));
    const personality = call(adapters, 'personality', { ...query, ...pair });
    requireThat(object(personality.dimension_modifiers) && subset(Object.keys(personality.dimension_modifiers), DIMENSIONS)
      && Object.values(personality.dimension_modifiers).every(v => finite(v) && v >= 0 && v <= policy.max_modifier),
    'invalid_personality', 'Personality modifiers must be bounded, nonnegative supplied values.');
    const fallback = fallbackProposal(pair, event, view, policy, first);
    const { proposal, mode } = creator ? { proposal: fallback, mode: 'authored' } : interpret(adapters, {
      ...query, ...pair, view, memories,
      history: history.map(e => ({ source_event_id: e.source_event_id, event_type: e.event_type })),
      relationship: clone(edge), personality: { dimension_modifiers: personality.dimension_modifiers },
      // Shared records can contain the other party's private perceptions; AI receives
      // only the observer-safe context supplied by knowledge, never raw shared rows.
      detail: options.detail ?? 'Structured',
    }, fallback, policy);
    const permitted = allowedDimensions(event, pair, controls, authored);
    if (authored && authored.kind === 'player_stance') requireThat(event.entities.some(e =>
      e.entity_id === pair.observer_id && e.kind === 'player'), 'invalid_authorship', 'Player stance owner is not a player.');
    const knownPriorSources = unique([...view.known_source_event_ids, ...history.map(e => e.source_event_id)]);
    requireThat(event.derived_from_event_ids.every(x => knownPriorSources.includes(x) || creator),
      'unsupported_history', 'Observer cannot reason from unknown causal history.');
    if (proposal.perceived_event_type === 'promise_failed') {
      const changes = view.record_changes.filter(c => c.table === 'relationship_promises'
        && policy.failed_promise_statuses.includes(c.record.status));
      requireThat(changes.length > 0, 'conditional_promise', 'Promise-failure effects require a validated promise failure.');
    }
    if (proposal.perceived_event_type === 'forgiveness') requireThat(view.reason_tags.includes('forgiveness:explicit_decision'),
      'unsupported_forgiveness', 'An apology is not a forgiveness decision.');
    if (proposal.perceived_event_type === 'reconciliation') requireThat(view.reason_tags.includes('reconciliation:mutual'),
      'unsupported_reconciliation', 'An apology is not mutual reconciliation.');
    if (['forgiveness', 'reconciliation'].includes(proposal.perceived_event_type)
      && event.entities.find(e => e.entity_id === pair.observer_id).kind === 'player')
      requireThat(view.reason_tags.includes('player:explicit_authorship'),
        'player_agency', 'Delegated emotions cannot select forgiveness or reconciliation.');
    processRecordChanges(s, edge, event, view, policy, now, authored);
    const boundaryScale = boundaryModifier(s, pair, view, policy);
    const repetitionType = stableId('observed_pattern', view.event_type, view.novelty_key);
    let pattern = s.relationship_patterns.find(p => p.observer_id === pair.observer_id
      && p.target_id === pair.target_id && p.pattern_type === repetitionType);
    const repeats = pattern?.supporting_event_ids.length ?? 0;
    const cheap = policy.cheap_events.includes(proposal.perceived_event_type) && (view.low_novelty || repeats > 0);
    const novelty = cheap ? (repeats >= policy.cheap_repeat_limit ? 0 : policy.cheap_repeat_factor ** repeats) : 1;
    const eventId = stableId('effect', snapshot.timeline_id, source_event_id, pair.observer_id, pair.target_id);
    const tags = unique([...proposal.reason_tags, `interpretation:${mode}`, `source:${source_event_id}`,
      `detail:${options.detail ?? 'Structured'}`, ...(view.domain ? [`domain:${view.domain}`] : []),
      ...view.jealousy_context.map(t => `jealousy_context:${t}`),
      ...view.boundary_context.flatMap(c => [`boundary:${c.boundary_id}`, `boundary_known:${c.known_by_target}`,
        `boundary_intent:${c.intent}`, `boundary_repeat:${repeats}`]),
      ...(authored ? [creator ? `creator:${authored.kind}` : 'player:explicit_authorship',
        ...authored.jealousy_context.map(t => `jealousy_context:${t}`)] : []),
      ...(cheap ? [`novelty:${novelty}`] : []), ...(first ? ['first_impression:revisable'] : [])]);
    const trustHistory = domainTrustEvidence({ timeline_id: snapshot.timeline_id, state: s.toJSON() },
      pair.observer_id, pair.target_id, view.domain);
    for (const dimension of DIMENSIONS) {
      const before = edge[dimension];
      let amount = 0;
      if (proposal.relevant_dimensions.includes(dimension) && permitted.includes(dimension)
        && view.meaningful && weight >= policy.meaningful_threshold) {
        amount = policy.templates[proposal.perceived_event_type][dimension] * weight
          * proposal.magnitude_modifier * proposal.expectation_modifier
          * (personality.dimension_modifiers[dimension] ?? 1) * boundaryScale;
        // Only positive, inexpensive gains are diminished. Harm never receives this discount.
        if (amount > 0 && dimension !== 'familiarity') amount *= novelty;
        if (dimension === 'trust' && amount > 0
          && !policy.positive_trust_evidence.includes(proposal.perceived_event_type)) amount = 0;
        if (proposal.perceived_event_type === 'repair' && dimension === 'trust') {
          const damaged = view.domain !== null && trustHistory.some(d => d.delta_value < 0);
          const supported = view.repair_evidence.some(x => ['restitution', 'changed_behavior'].includes(x));
          if (!damaged || !supported) amount = 0;
        }
        if (proposal.perceived_event_type === 'repair' && view.repair_evidence.length === 0) amount = 0;
        if (dimension === 'jealousy' && view.jealousy_context.length === 0) amount = 0;
        if (first) amount = Math.max(-policy.first_impression_delta_cap, Math.min(policy.first_impression_delta_cap, amount));
        amount = Math.max(-policy.max_delta, Math.min(policy.max_delta, amount));
      }
      let after = Math.max(policy.bounds[dimension][0], Math.min(policy.bounds[dimension][1], before + amount));
      if (authored && Object.hasOwn(authored.values, dimension)) {
        requireThat(permitted.includes(dimension), 'player_agency', 'Authored value is outside the authorized scope.');
        after = authored.values[dimension];
        requireThat(after >= policy.bounds[dimension][0] && after <= policy.bounds[dimension][1],
          'out_of_bounds', 'Authored values must respect configured dimension bounds.');
        requireThat(creator || Math.abs(after - before) <= policy.max_delta,
          'out_of_bounds', 'Player stance change exceeds configured per-event bound.');
      }
      if (dimension === 'jealousy' && after !== before)
        requireThat(tags.some(t => t.startsWith('jealousy_context:')), 'missing_jealousy_context', 'Jealousy needs a perceived source/context.');
      edge[dimension] = after;
      s.relationship_deltas.push({ delta_id: stableId(eventId, dimension), relationship_event_id: eventId,
        dimension, before_value: before, delta_value: after - before, after_value: after,
        modifier_tags: [...tags, ...(permitted.includes(dimension) ? [] : ['player:undelegated'])],
        pattern_contribution: { pattern_id: creator ? null : stableId('pattern', snapshot.timeline_id, pair.observer_id, pair.target_id, repetitionType),
          prior_occurrences: repeats, weight, novelty, magnitude_modifier: proposal.magnitude_modifier,
          expectation_modifier: proposal.expectation_modifier,
          personality_modifier: personality.dimension_modifiers[dimension] ?? 1,
          boundary_modifier: boundaryScale,
          authorized: permitted.includes(dimension), confidence: proposal.confidence,
          // Snapshot the actual perceived record changes for replay/audit without creating new state fields.
          record_changes: dimension === 'familiarity' ? clone(view.record_changes) : [],
          derived_from_event_ids: clone(event.derived_from_event_ids),
          previous_label: previousEdge.subjective_label, previous_fidelity: previousEdge.fidelity_level },
      });
    }
    if (authored?.subjective_label !== null && authored?.subjective_label !== undefined)
      edge.subjective_label = authored.subjective_label;
    else if (view.subjective_label !== null) {
      requireThat(typeof view.subjective_label === 'string', 'invalid_label', 'Subjective label must be text.');
      const player = event.entities.find(e => e.entity_id === pair.observer_id).kind === 'player';
      requireThat(!player || view.reason_tags.includes('player:explicit_authorship'),
        'player_agency', 'Player labels require explicit authorship.');
      edge.subjective_label = view.subjective_label;
    }
    if (view.desired_fidelity !== null) {
      requireThat(FIDELITIES.includes(view.desired_fidelity)
        && FIDELITIES.indexOf(view.desired_fidelity) >= FIDELITIES.indexOf(edge.fidelity_level),
      'invalid_fidelity', 'Promotion must preserve existing detail/history.');
      requireThat(!first || view.desired_fidelity !== 'Rich', 'sparse_graph', 'A first impression cannot create a Rich edge.');
      edge.fidelity_level = view.desired_fidelity;
    }
    edge.state_version += 1;
    s.relationship_events.push({ relationship_event_id: eventId, source_event_id,
      ...pair, event_type: proposal.perceived_event_type, magnitude: view.magnitude,
      perceived_intent: proposal.perceived_intent, interpretation_confidence: proposal.confidence,
      public_private: view.public_private, applied_at: event.applied_at, update_version: edge.state_version });
    s.RelationshipInterpretationProposal.push(clone(proposal));
    if (!creator) {
      if (!pattern) {
        pattern = { pattern_id: stableId('pattern', snapshot.timeline_id, pair.observer_id, pair.target_id, repetitionType),
          ...pair, pattern_type: repetitionType, strength: 0, supporting_event_ids: [], last_updated_at: event.applied_at };
        s.relationship_patterns.push(pattern);
      }
      pattern.strength = Math.min(policy.max_pattern_strength, pattern.strength + policy.pattern_step);
      pattern.supporting_event_ids.push(eventId);
      pattern.last_updated_at = event.applied_at;
      if (weight >= policy.cornerstone_threshold) s.relationship_cornerstones.push({
        cornerstone_id: stableId('cornerstone', eventId), ...pair, source_event_id,
        category: proposal.perceived_event_type, salience: weight,
        persistent_reason: { reason_tags: proposal.reason_tags, perceived_intent: proposal.perceived_intent },
      });
    }
    const publicContext = { ...pair, source_event_id, timeline_id: snapshot.timeline_id,
      known_event_type: proposal.perceived_event_type, public_private: view.public_private,
      callbacks: [source_event_id], observable_context: clone(view.conflict_topics) };
    const ownContext = pairRecords(s, edge);
    // Never disclose the other party's private debt valuation to a behavior system.
    // Other shared records are exposed only through observer-safe knowledge views.
    const internal = { ...publicContext, relationship: clone(edge),
      context: { expectations: ownContext.expectations, boundaries: ownContext.boundaries,
        patterns: ownContext.patterns, known_conflict_topics: clone(view.conflict_topics),
        debts: ownContext.debts.filter(d => knownPriorSources.includes(d.objective_source_event_id)).map(d => ({
          debt_id: d.debt_id, creditor_id: d.creditor_id, debtor_id: d.debtor_id,
          own_perceived_value: d.creditor_id === pair.observer_id ? d.creditor_expected_value : d.debtor_acknowledged_value,
          source_event_id: d.objective_source_event_id,
        })) },
      pressure_only: true, forgiveness_context: view.event_type === 'repair' ? clone(view.repair_evidence) : [],
      obligation_stakes: ownContext.obligations };
    const destinations = creator
      ? ['canonical_authority', 'System 5', 'System 6', 'player_creator_controls']
      : ['canonical_authority', 'System 2', 'System 3', 'System 4', 'System 5',
      'System 6', 'System 8', 'System 11', 'System 13', 'System 14', 'System 16', 'System 18',
        'System 20', 'System 22', 'System 23', 'System 24', 'reputation_authority', 'player_creator_controls'];
    for (const destination of destinations) {
      const privileged = ['canonical_authority', 'System 5', 'System 6', 'System 8', 'player_creator_controls'].includes(destination);
      // Public output carries no metrics or hidden subjective labels. System 3 is
      // responsible for any subsequent communication/third-party knowledge.
      const payload = privileged ? internal : publicContext;
      if (['reputation_authority', 'System 23'].includes(destination) && view.public_private !== 'public') continue;
      outbox.push({ message_id: stableId('context', eventId, destination), destination, payload: clone(payload) });
    }
    changed = true;
  }
  snapshot.state = s.toJSON();
  return changed;
}

function branchSnapshot(snapshot, target) {
  requireThat(id(target) && target !== snapshot.timeline_id, 'branch_isolation', 'Branch requires a different timeline ID.');
  const result = clone(snapshot);
  result.timeline_id = target;
  for (const edge of result.state.relationship_edges) edge.timeline_id = target;
  return result;
}

function replayBranch(request, adapters, policy, outbox) {
  const original = request.snapshot;
  const roots = request.invalidated_source_event_ids ?? [];
  requireThat(Array.isArray(roots) && roots.every(id), 'invalid_rewind', 'Invalidated event IDs must be an array.');
  if (request.operation === 'retcon') {
    requireThat(id(request.creator_source_event_id), 'invalid_creator_provenance', 'Retcons require Creator provenance.');
    const controls = call(adapters, 'controls', { timeline_id: original.timeline_id, source_event_id: request.creator_source_event_id });
    requireThat(Array.isArray(controls.creator_changes) && controls.creator_changes.some(c =>
      c.source_event_id === request.creator_source_event_id && c.kind === 'retcon'),
    'invalid_creator_provenance', 'Retcon is not authorized by Creator controls.');
  }
  const plan = call(adapters, 'replay', { timeline_id: original.timeline_id,
    target_timeline_id: request.target_timeline_id, invalidated_source_event_ids: roots,
    creator_source_event_id: request.creator_source_event_id ?? null });
  requireThat(plan.complete === true && Array.isArray(plan.ordered_source_event_ids)
    && plan.ordered_source_event_ids.every(id) && unique(plan.ordered_source_event_ids).length === plan.ordered_source_event_ids.length
    && object(plan.dependency_graph) && Array.isArray(plan.preserved_creator_anchor_source_event_ids),
  'incomplete_replay', 'Persistence must supply a complete, ordered replay plan and dependencies.');
  validateSnapshot(plan.anchor_snapshot, policy);
  requireThat(plan.anchor_snapshot.timeline_id === original.timeline_id, 'branch_isolation', 'Anchor timeline mismatch.');
  const preserved = new Set(plan.preserved_creator_anchor_source_event_ids);
  for (const delta of original.state.relationship_deltas) {
    if (delta.modifier_tags.includes('creator:backstory_anchor')) {
      const source = original.state.relationship_events.find(e => e.relationship_event_id === delta.relationship_event_id).source_event_id;
      requireThat(preserved.has(source), 'anchor_preservation', 'Replay plan omitted an explicit Creator anchor.');
    }
  }
  requireThat(!roots.some(x => preserved.has(x)), 'anchor_preservation', 'Cannot invalidate a preserved Creator anchor.');
  const invalid = new Set(roots);
  let progress = true;
  while (progress) {
    progress = false;
    for (const [eventId, parents] of Object.entries(plan.dependency_graph)) {
      requireThat(Array.isArray(parents) && parents.every(id), 'invalid_replay', 'Invalid dependency graph.');
      if (!invalid.has(eventId) && !preserved.has(eventId) && parents.some(p => invalid.has(p))) {
        invalid.add(eventId); progress = true;
      }
    }
  }
  // Cross-check dependencies recorded at commit: an external plan cannot silently
  // hide causal links already known to this module.
  for (const delta of original.state.relationship_deltas) {
    const source = original.state.relationship_events.find(e => e.relationship_event_id === delta.relationship_event_id).source_event_id;
    const parents = delta.pattern_contribution?.derived_from_event_ids ?? [];
    requireThat(parents.every(p => (plan.dependency_graph[source] ?? []).includes(p)),
      'incomplete_replay', 'Replay plan omitted committed causal dependencies.');
  }
  const anchorSources = unique(plan.anchor_snapshot.state.relationship_events.map(e => e.source_event_id));
  requireThat(anchorSources.every(x => !invalid.has(x)), 'invalid_anchor', 'Anchor contains invalidated history.');
  const survivors = plan.ordered_source_event_ids.filter(x => !invalid.has(x));
  const originalSources = unique(original.state.relationship_events.map(e => e.source_event_id));
  requireThat(originalSources.filter(x => !invalid.has(x)).every(x => anchorSources.includes(x) || survivors.includes(x))
    && [...preserved].every(x => anchorSources.includes(x) || survivors.includes(x)),
  'incomplete_replay', 'Replay plan dropped surviving history or anchors.');
  const result = branchSnapshot(plan.anchor_snapshot, request.target_timeline_id);
  const seen = new Set(anchorSources);
  const replacements = request.operation === 'retcon' ? request.replacement_source_event_ids ?? [] : [];
  requireThat(Array.isArray(replacements) && replacements.every(id) && !replacements.some(x => invalid.has(x)),
    'invalid_retcon', 'Replacement events must have fresh surviving source IDs.');
  const ordered = unique([...survivors, ...replacements,
    ...(request.operation === 'retcon' ? [request.creator_source_event_id] : [])]);
  for (const source_event_id of ordered) {
    if (seen.has(source_event_id)) continue;
    const event = call(adapters, 'canonical', { timeline_id: original.timeline_id, source_event_id });
    validateEvent(event, original.timeline_id, source_event_id);
    requireThat(!event.derived_from_event_ids.some(x => invalid.has(x)) || preserved.has(source_event_id),
      'invalid_replay', 'Surviving event still depends on invalidated history.');
    requireThat(event.derived_from_event_ids.every(x => seen.has(x) || preserved.has(source_event_id)),
      'invalid_replay_order', 'Replay must follow causal order.');
    // Replay accepted interpretations, never ask a stochastic interpreter to invent
    // new history. Revalidation may select a deterministic fallback in a new branch.
    const replayAdapters = { ...adapters, ai: query => ({ proposal:
      original.state.RelationshipInterpretationProposal.find(p => p.source_event_id === query.source_event_id
        && p.observer_id === query.observer_id && p.target_id === query.target_id) ?? null }) };
    applySource(result, source_event_id, replayAdapters, policy, [], {
      source_timeline_id: original.timeline_id, detail: request.detail, replay: true });
    seen.add(source_event_id);
  }
  // Rebuilding history must not redeliver historical social messages.
  outbox.push({ message_id: stableId(request.operation, result.timeline_id), destination: 'canonical_authority',
    payload: { timeline_id: result.timeline_id, source_timeline_id: original.timeline_id,
      invalidated_source_event_ids: [...invalid], preserved_creator_anchor_source_event_ids: [...preserved],
      creator_source_event_id: request.creator_source_event_id ?? null, recomputed: true } });
  return result;
}

/**
 * Executes one transactional, JSON-in/JSON-out state-machine command.
 * Invalid AI proposals fall back safely. Invalid canonical facts/records reject
 * the whole command, including all directional pairs and queued notifications.
 * 'inspect' requires explicit Creator inspection authority for hidden metrics.
 * 'restore' validates without replaying or re-emitting historical effects.
 * A timeline fork clones records; rewind/retcon reconstruct from external anchors.
 * No elapsed-time operation invents interactions or applies low-contact decay.
 *
 * @param {StateMachineRequest} request
 * @param {Adapters} [overrides]
 * @returns {StateMachineResult}
 */
export function relationshipStateMachine(request, overrides = {}) {
  let original = emptySnapshot('invalid-request');
  try {
    const input = clone(request);
    original = clone(input.snapshot);
    const policy = input.policy;
    validatePolicy(policy);
    validateSnapshot(original, policy);
    requireThat(['ingest', 'inspect', 'restore', 'branch', 'rewind', 'retcon'].includes(input.operation),
      'invalid_operation', 'Unknown state-machine operation.');
    requireThat(input.detail === undefined || ['Lightweight', 'Structured', 'Rich'].includes(input.detail),
      'invalid_detail', 'Unknown event-processing detail.');
    const adapters = { ...DEFAULT_ADAPTERS, ...overrides };
    for (const name of Object.keys(DEFAULT_ADAPTERS))
      requireThat(typeof adapters[name] === 'function', 'invalid_adapter', `${name} must be callable.`);
    if (input.operation === 'restore') return { status: 'restored', snapshot: original, outbox: [] };
    if (input.operation === 'inspect') {
      const controls = call(adapters, 'controls', { timeline_id: original.timeline_id, operation: 'inspect' });
      requireThat(controls.inspection_authorized === true, 'inspection_denied', 'Hidden metrics require explicit inspection authority.');
      const s = new RelationshipState(original.state);
      const edge = findEdge(s, input.observer_id, input.target_id);
      return { status: 'inspected', snapshot: original, outbox: [], inspection: edge ? {
        edge: clone(edge), history: pairHistory(s, edge), context: pairRecords(s, edge),
        deltas: s.relationship_deltas.filter(d => pairHistory(s, edge).some(e => e.relationship_event_id === d.relationship_event_id)),
      } : { edge: null, history: [], context: {}, deltas: [] } };
    }
    const outbox = [];
    let candidate = clone(original);
    if (input.operation === 'ingest') {
      requireThat(id(input.source_event_id), 'invalid_source', 'Source event ID is required.');
      if (!applySource(candidate, input.source_event_id, adapters, policy, outbox, { detail: input.detail }))
        return { status: 'unchanged', snapshot: original, outbox: [] };
    } else if (input.operation === 'branch') candidate = branchSnapshot(original, input.target_timeline_id);
    else candidate = replayBranch(input, adapters, policy, outbox);
    validateSnapshot(candidate, policy);
    const receipt = call(adapters, 'commit', {
      operation: input.operation, expected_snapshot: original, snapshot: candidate, outbox,
      create_timeline: candidate.timeline_id !== original.timeline_id,
    });
    requireThat(receipt.accepted === true, 'commit_rejected', 'Persistence rejected the atomic snapshot/outbox commit.');
    return { status: 'committed', snapshot: candidate, outbox, receipt };
  } catch (error) {
    return { status: 'rejected', snapshot: original, outbox: [], error: {
      code: error instanceof Rejected ? error.code : 'dependency_or_contract_failure',
      message: error instanceof Rejected ? error.message : 'An external adapter or JSON contract failed.',
    } };
  }
}
