/** System 24 JSON contracts. No foreign-domain state is stored here.
 * Encoding profile: references/versions are nonempty strings; revisions and
 * canonical times are nonnegative safe integers supplied by their owners.
 * Optional reference/time fields use null. These are explicit implementation
 * encodings, not additional world rules.
 */
import { z } from 'zod';
import { createHash } from 'node:crypto';

export const Ref = z.string().min(1).max(131072)
  .refine(value => !Object.hasOwn(Object.prototype, value) && value !== 'prototype');
export const Integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Value = z.union([z.boolean(), z.literal('unknown')]);
const refs = z.array(Ref);
const optional = Ref.nullable();
const time = Integer.nullable();
const record = (fields) => z.strictObject(fields);
export const States = z.enum(['proposed', 'active', 'contained', 'resolving',
  'resolved', 'transformed', 'unavailable', 'archived']);
export const Owners = Object.freeze(['agency', 'system10', 'system11', 'system12',
  'system13', 'system14', 'system15', 'system16', 'system17', 'system18', 'system19',
  'system20', 'system21', 'system22', 'system23', 'relationships', 'consent',
  'knowledge', 'authoring', 'ui']);
export const Owner = z.enum(Owners);
export const RevisionRef = record({ owner: Owner, entity_ref: Ref, revision: Integer });
export const Context = z.union([z.literal('simulation'), record({ actor_id: Ref })]);
export const Subscription = record({ owner: Owner, entity_ref: Ref, event_type: Ref });
export const Predicate = record({
  op: z.literal('predicate'), predicate_ref: Ref, owner: Owner, entity_ref: Ref,
  scope_ref: Ref, access_ref: Ref, dependency_events: z.array(Subscription).min(1),
  joins: refs.max(8)
});
export const Condition = z.lazy(() => z.union([
  Predicate,
  record({ op: z.enum(['all', 'any']), args: z.array(Condition).min(1) }),
  record({ op: z.literal('not'), arg: Condition })
]));
export const Schemas = Object.freeze({
  situation_template: record({ id: Ref, version: Ref, premise_ref: Ref, roles_ref: Ref,
    prerequisites_ref: Ref, pressures_ref: Ref, outcomes_ref: Ref, watchers_ref: Ref,
    visibility: Ref, content_policy: Ref }),
  situation: record({ id: Ref, template_version: Ref, origin_ref: Ref, bindings_ref: Ref,
    state: States, pressure_refs: refs, owner_commitments: refs, revision: Integer }),
  watcher: record({ id: Ref, situation_id: Ref, version: Ref, scope_ref: Ref,
    read_context: Context, subscriptions: z.array(Subscription), condition_ast: Condition,
    trigger_policy: z.enum(['single_fire', 'rising_edge', 'due_time', 'cadenced_level']),
    last_value: Value, last_revision: optional, edge_ordinal: Integer,
    pending_workflow: optional,
    status: z.enum(['dormant', 'armed', 'fired', 'waiting_on_workflow', 'disarmed', 'retired']) }),
  story_offer: record({ id: Ref, issuer_ref: Ref, recipient_ref: Ref, terms_ref: Ref,
    channel_ref: Ref, delivered_refs: refs, available_until: time,
    status: z.enum(['available', 'delivered', 'response', 'accepted', 'expired', 'withdrawn']) }),
  outcome_assessment: record({ id: Ref, situation_id: Ref, scope_ref: Ref,
    predicate_version: Ref, owner_event_refs: refs, conclusion: Ref,
    limitations_ref: optional, occurred_at: Integer }),
  journal_projection: record({ id: Ref, situation_id: Ref, actor_id: Ref,
    acquired_source_refs: refs, known_questions: refs, known_terms: refs,
    communicated_deadlines: refs, last_update_at: Integer }),
  story_event: record({ id: Ref, situation_id: optional, watcher_ref: optional,
    cause_refs: refs, occurred_at: Integer, processed_at: Integer, policy_version: Ref,
    idempotency_key: Ref, payload_ref: Ref }),
  instance_metadata: record({
    origin_kind: z.enum(['authored', 'emergent', 'npc_generated', 'player_generated', 'hybrid']),
    creation_cause_refs: refs, initial_snapshot_refs: z.array(RevisionRef),
    activation_policy_version: Ref, lineage_refs: refs, migration_event_refs: refs,
    outcome_history_refs: refs, restricted_fact_refs: refs, pending_choice_ref: optional }),
  participant_binding: record({ role_ref: Ref, participant_ref: Ref,
    suitability_evidence_refs: refs, invalidation_dependencies: refs,
    actor_visible_description_refs: refs, rebind_event_refs: refs }),
  pressure_and_outcome_definitions: record({ scope_ref: Ref, cause_refs: refs,
    owner_refs: z.array(Owner), predicate_ref: Ref, timing_requirements_ref: optional,
    confidence_requirements_ref: optional, exclusions_ref: optional,
    transition_rules_ref: Ref, next_review_at: time }),
  deadline: record({ id: Ref, version: Ref,
    kind: z.enum(['accepted_obligation', 'scheduled_opportunity', 'resource_pressure',
      'npc_intention', 'hazard_progression']), cause_refs: refs, starts_at: Integer,
    due_at: Integer, owner_ref: Owner, scope_ref: Ref, known_notice_refs: refs,
    review_policy_ref: Ref, possible_effect_refs: refs }),
  watcher_metadata: record({ kind: z.enum(['outcome', 'pressure', 'deadline',
    'opportunity', 'acquisition']), dependency_refs: refs, visibility: Ref,
    allowed_output_categories: refs, last_evaluated_at: time,
    snapshot_revision_refs: z.array(RevisionRef), fired_cause_ids: refs,
    edge_history_refs: refs, trigger_key: optional, next_review_at: time,
    rearm_policy_ref: Ref, suspension_reason_ref: optional, retirement_reason_ref: optional }),
  offer_metadata: record({ objective_ref: Ref, availability_window_ref: optional,
    visibility: Ref, explicit_response_ref: optional, accepted_terms_ref: optional,
    expiry_or_withdrawal_cause_ref: optional }),
  durable_workflow: record({ id: Ref, situation_id: Ref, watcher_ref: optional,
    cause_refs: refs, authority_ref: Ref, knowledge_basis_refs: refs,
    expected_revision_refs: z.array(RevisionRef), canonical_time: Integer,
    correlation_id: Ref, idempotency_key: Ref, effect_keys: refs,
    reservation_refs: refs, completed_stage_refs: refs, pending_stage_ref: Ref,
    committed_owner_result_refs: refs, pending_delivery_refs: refs,
    terminal_cleanup_state_ref: optional }),
  presentation_and_runtime: record({ journal_hidden_by_actor: z.boolean(),
    optional_notes: z.array(z.string()), player_preferences_ref: optional,
    game_day_ref: optional, ordinary_scene_ref: optional,
    unsolicited_major_offers_surfaced: Integer, low_urgency_updates_surfaced: Integer,
    active_watchers_per_situation: Integer, active_watchers_per_partition: Integer,
    follow_on_rounds_at_boundary: Integer, deferred_review_refs: refs,
    dependency_and_reservation_graph_refs: refs })
});

export const DEFAULT_LIMITS = Object.freeze({ max_predicate_nodes_per_watcher: 20,
  max_joins_per_watcher: 8, max_active_watchers_per_situation: 64,
  max_active_watchers_per_loaded_partition: 512, max_follow_on_rounds_per_boundary: 8,
  max_new_unsolicited_major_offers_per_game_day: 1,
  max_low_urgency_surfaced_updates_per_ordinary_scene: 3 });
export const Limits = record(Object.fromEntries(Object.keys(DEFAULT_LIMITS)
  .map((key) => [key, Integer.positive()])));
export const StateSchema = record({
  ...Object.fromEntries(Object.entries(Schemas).map(([name, schema]) =>
    [name, z.record(Ref, schema)])), versioned_policy_defaults: Limits
});

/** Only the state variables listed in the architecture are own properties.
 * Record collections are keyed by stable IDs; supplemental records by their
 * owning ID or reference. A state object represents one loaded partition.
 */
export class System24State {
  constructor(saved = null) {
    const initial = saved ?? { ...Object.fromEntries(Object.keys(Schemas).map(k => [k, {}])),
      versioned_policy_defaults: { ...DEFAULT_LIMITS } };
    Object.assign(this, StateSchema.parse(json(initial)));
  }
  toJSON() { return json({ ...this }); }
}

export const Event = record({ id: Ref, owner: Owner, entity_ref: Ref, event_type: Ref,
  revision: Integer, occurred_at: Integer, cause_refs: refs, committed: z.literal(true) });
export const Boundary = record({ status: z.literal('ok'), boundary_ref: Ref,
  snapshot_ref: Ref, canonical_time: Integer, game_day_ref: Ref,
  paused: z.boolean(), events: z.array(Event), revisions: z.array(RevisionRef),
  choice_required: z.boolean(), material_interruption: z.boolean() });
export const Command = record({ type: Ref, authority_ref: Ref, expected_revision: Integer.nullable(),
  canonical_time: Integer, correlation_id: Ref, idempotency_key: Ref,
  payload: z.record(z.string(), z.json()) });
export const Fact = record({ status: z.literal('ok'), owner: Owner, entity_ref: Ref,
  predicate_ref: Ref, scope_ref: Ref, read_context: Context, snapshot_ref: Ref,
  revision: Integer, canonical_time: Integer, value: Value, exists: z.boolean(),
  acquired_source_refs: refs });

const Table = z.record(z.string(), Value);
export const Manifest = record({ version: Ref, policy_version: Ref,
  enabled: z.boolean(), supported: z.boolean(), predicate_types: z.record(Ref,
    record({ owner: Owner, event_types: refs })),
  truth_tables: record({ all: Table, any: Table, not: Table }),
  activation_condition: Condition, required_roles: refs,
  transition_rules: z.array(record({ from: States, to: States, condition: Condition,
    outcome_scope: optional, remaining_scopes: refs })),
  outcomes: z.record(Ref, record({ predicate_version: Ref, condition: Condition,
    conclusion: Ref, limitations_ref: optional })),
  watcher_rules: z.record(Ref, record({ kind: Schemas.watcher_metadata.shape.kind,
    condition: Condition, trigger_policy: Schemas.watcher.shape.trigger_policy,
    output_category: z.enum(['review_outcome', 'review_pressure', 'review_deadline',
      'review_opportunity', 'review_acquisition']), outcome_scope: optional,
    action_ref: optional, deadline_ref: optional, cadence: Integer.positive().nullable(),
    rearm_policy_ref: Ref })), allowed_action_refs: refs,
  offer_refs: refs, deadline_policy_refs: refs });

export const Action = record({ action_ref: Ref, owner: Owner, operation: Ref,
  category: z.enum(['review', 'ordinary', 'romance', 'testimony', 'crime', 'affiliation']),
  actor_id: optional, player_action: z.boolean(), actor_action: z.boolean(),
  requires_choice: z.boolean(), explicit_response_ref: optional, delegation_ref: optional,
  scope_expanded: z.boolean(), knowledge_basis_refs: refs, terms_ref: optional,
  effect_scope_ref: Ref, resource_refs: refs, notification_ref: optional });

export class GateError extends Error {
  constructor(reason = 'unsupported_method') { super(reason); this.reason = reason; }
}
export function requireThat(condition, reason = 'unsupported_method') {
  if (!condition) throw new GateError(reason);
}
export function json(value) {
  // Reject non-JSON values instead of allowing JSON.stringify to silently drop them.
  return z.json().parse(JSON.parse(JSON.stringify(z.json().parse(value))));
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function key(prefix, ...parts) {
  return `${prefix}:${createHash('sha256').update(canonical(parts)).digest('hex')}`;
}
export function unique(values) { return [...new Set(values)]; }
export function runtime() {
  return { journal_hidden_by_actor: false, optional_notes: [], player_preferences_ref: null,
    game_day_ref: null, ordinary_scene_ref: null, unsolicited_major_offers_surfaced: 0,
    low_urgency_updates_surfaced: 0, active_watchers_per_situation: 0,
    active_watchers_per_partition: 0, follow_on_rounds_at_boundary: 0,
    deferred_review_refs: [], dependency_and_reservation_graph_refs: [] };
}

/** No inferred operator semantics: all entries must come from a versioned manifest. */
export function validateTables(tables) {
  for (const op of ['all', 'any']) for (const a of ['true', 'false', 'unknown'])
    for (const b of ['true', 'false', 'unknown']) Value.parse(tables[op][`${a},${b}`]);
  for (const a of ['true', 'false', 'unknown']) Value.parse(tables.not[a]);
  requireThat(tables.not.unknown === 'unknown');
  requireThat(tables.all['unknown,unknown'] !== true && tables.any['unknown,unknown'] !== true);
  for (const op of ['all', 'any']) for (const a of ['true', 'false', 'unknown'])
    for (const b of ['true', 'false', 'unknown']) {
      const result = tables[op][`${a},${b}`];
      if (a === 'unknown' || b === 'unknown') {
        if (result === true) requireThat(op === 'any' && (a === 'true' || b === 'true'));
        if (result === false) requireThat(op === 'all' && (a === 'false' || b === 'false'));
      }
    }
}

export function validateCondition(raw, manifest, limits) {
  // Bound raw depth/size before recursive schema parsing (including cyclic JS input).
  const stack = [raw]; let nodes = 0; let joins = 0;
  while (stack.length) {
    const n = stack.pop(); nodes++;
    requireThat(nodes <= limits.max_predicate_nodes_per_watcher, 'scope_limit');
    requireThat(n && typeof n === 'object');
    if (n.op === 'all' || n.op === 'any') {
      requireThat(Array.isArray(n.args)); stack.push(...n.args);
    } else if (n.op === 'not') stack.push(n.arg);
    else {
      requireThat(n.op === 'predicate');
      joins += Array.isArray(n.joins) ? n.joins.length : 0;
      requireThat(joins <= limits.max_joins_per_watcher, 'scope_limit');
    }
  }
  const ast = Condition.parse(raw);
  for (const leaf of leaves(ast)) {
    const type = manifest.predicate_types[leaf.predicate_ref];
    requireThat(type && type.owner === leaf.owner);
    requireThat(leaf.entity_ref !== '*' && leaf.scope_ref !== '*', 'scope_limit');
    requireThat(leaf.dependency_events.every(e => e.owner === leaf.owner &&
      e.entity_ref === leaf.entity_ref && type.event_types.includes(e.event_type)));
  }
  return ast;
}
export function leaves(ast) {
  if (ast.op === 'predicate') return [ast];
  return (ast.op === 'not' ? [ast.arg] : ast.args).flatMap(leaves);
}
