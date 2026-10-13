/** System 25 wire types, exact state fields, and bounded deterministic JSON encoding. */
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

/** @typedef {null | boolean | number | string | Json[] | {[key: string]: Json}} Json */
/** @typedef {{[key: string]: Json}} JsonObject */
/** @typedef {{timeline_id: string, sequence: number}} Cut */
/** @typedef {{command: string, context?: JsonObject, args?: JsonObject, now?: string}} Request */

export const LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, nodes: 250_000, depth: 80 });
export class ContractError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireThat(condition, code = 'INVALID_REQUEST') {
  if (!condition) throw new ContractError(code);
}
export const copy = value => structuredClone(value);
export const equal = (a, b) => canonical(a) === canonical(b);
export const hash = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
export function canonical(value) {
  let nodes = 0;
  function visit(v, depth) {
    requireThat(++nodes <= LIMITS.nodes && depth <= LIMITS.depth, 'SIZE_LIMIT');
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
      requireThat(Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)), 'INEXACT_NUMBER');
      requireThat(!Object.is(v, -0), 'INEXACT_NUMBER');
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      requireThat(Object.keys(v).length === v.length, 'INVALID_JSON');
      return `[${v.map(x => visit(x, depth + 1)).join(',')}]`;
    }
    requireThat(v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)), 'INVALID_JSON');
    requireThat(Object.getOwnPropertySymbols(v).length === 0, 'INVALID_JSON');
    return `{${Object.keys(v).sort().map(k => {
      requireThat(!['__proto__', 'prototype', 'constructor'].includes(k), 'UNSAFE_KEY');
      const descriptor = Object.getOwnPropertyDescriptor(v, k);
      requireThat(descriptor && 'value' in descriptor, 'INVALID_JSON');
      return `${JSON.stringify(k)}:${visit(descriptor.value, depth + 1)}`;
    }).join(',')}}`;
  }
  const encoded = visit(value, 0);
  requireThat(Buffer.byteLength(encoded) <= LIMITS.bytes, 'SIZE_LIMIT');
  return encoded;
}
export function object(value) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value;
}
export function id(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 2048, 'INVALID_ID');
  requireThat(!['__proto__', 'constructor', 'prototype'].includes(value), 'INVALID_ID');
  return value;
}
export function integer(value) {
  requireThat(Number.isSafeInteger(value) && value >= 0, 'INVALID_INTEGER');
  return value;
}
export function timestamp(value) {
  requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'INVALID_TIMESTAMP');
  return new Date(value).toISOString();
}
export function cut(value) {
  exact(value, ['timeline_id', 'sequence']);
  id(value.timeline_id); integer(value.sequence);
  return copy(value);
}
export const cutRef = value => `cut:${Buffer.from(canonical(cut(value))).toString('base64url')}`;
export function readCut(ref) {
  requireThat(typeof ref === 'string' && ref.startsWith('cut:'), 'INVALID_CUT');
  try { return cut(JSON.parse(Buffer.from(ref.slice(4), 'base64url').toString('utf8'))); }
  catch { throw new ContractError('INVALID_CUT'); }
}
export function exact(value, fields) {
  object(value);
  requireThat(equal(Object.keys(value).sort(), [...fields].sort()), 'INVALID_FIELDS');
  canonical(value);
  return value;
}

export const FIELDS = Object.freeze(Object.fromEntries(Object.entries({
  campaign: 'id content_policy created_at status',
  timeline: 'id campaign_id parent_id fork_cut_ref head_sequence head_revision rules_policy status',
  canonical_event: 'id timeline_id sequence command_key cause_refs occurred_at schema_version rules_version resolved_payload_ref resulting_revisions',
  checkpoint: 'id timeline_id cut_ref canonical_time manifest_ref digest_ref status created_at',
  save_entry: 'id checkpoint_id kind label retention_class',
  workflow: 'id timeline_id cause_ref stage effect_keys reservations_ref pending_tasks status',
  task_outbox: 'id timeline_id workflow_ref target_ref payload_ref idempotency_key fence status',
  creation_ledger: 'request_key timeline_scope entity_id accepted_content_ref status',
  artifact: 'id content_digest content_ref required_kind visibility_policy lineage_refs',
  migration: 'id source_ref target_ref versions_ref validation_ref status',
  manifest: 'format_version campaign_id timeline_id ancestry_and_fork_cuts checkpoint_id event_cut canonical_time schema_versions rules_and_content_versions required_state_families event_segment_refs artifact_refs_and_digests visibility_and_privacy_policy completeness_status',
  command_context: 'campaign_id timeline_id authority operation_id idempotency_key expected_head_revision expected_entity_revisions session_fence',
  command_result_ledger: 'scoped_command_key committed_result_ref',
  operation_tracking: 'operation_id requested_cut captured_cut status validation_results failure_diagnosis',
  owner_state_registry: 'family schema_version owner_revision state_ref serialization_contract_ref reconstruction_adapter_ref invariant_contract_ref scheduled_work_refs migration_policy_ref validation_result required rebuildable',
  turn_anchor: 'input_event_interval known_view_ref supported_before_cut supported_after_cut',
  timeline_metadata: 'label fork_reason created_at',
  writer_coordination: 'active_timeline_id writer_owner writer_lease fencing_token session_mode',
  durable_task_metadata: 'causal_event_ref stage attempts acknowledgment retry_policy',
  generation_task: 'task_id original_timeline_session_context model_content_constraints source_cut staged_candidate_ref validation_status status accepted_output_refs fencing_token',
  preserved_scheduler_state: 'canonical_clock calendar_version due_event_queue processed_cursors equal_time_ordering_policy task_ids deadline_versions start_completion_elapsed_intervals periodic_series_last_occurrence_next_due occurrence_and_processing_times',
  preserved_resolution_state: 'resolved_checks_and_selected_outcomes committed_decision_and_generation_results versioned_random_stream_state pending_random_allocations_by_command_event',
  preserved_choice_and_workflow_state: 'prompt_anchor known_view_ref accepted_scope_and_commitments unanswered_status action_timing_targets_budgets_eligibility completed_and_pending_stages reservations_and_consumed_resources communication_content_and_delivery_state watcher_values_edge_ordinals_and_versions',
  portability_and_maintenance: 'export_mode declared_scope omitted_families namespace_mapping_and_provenance compatibility_status reachability_and_pinned_dependencies verified_recovery_anchor valid_journal_prefix migration_and_repair_provenance',
  durability_reporting: 'last_durable_commit_cut last_valid_checkpoint_cut later_acknowledged_journal_progress unavailable_extent checkpoint_availability sync_status acknowledged_remote_revision backup_status backup_destination_and_policy',
  versioned_baseline_policy: 'autosave_coalescing_real_seconds periodic_checkpoint_real_seconds ordinary_autosave_retention_minimum hourly_checkpoints_per_active_play_hour hourly_retention_active_play_hours offline_progression_enabled automatic_branch_merge_supported manual_saves_retained_until_explicit_removal',
  noncanonical_optional_state: 'unsubmitted_player_drafts narration_and_summaries retrieval_indexes_embeddings_and_visual_caches'
}).map(([name, fields]) => [name, Object.freeze(fields.split(' '))])));

export const FRAME_FIELDS = Object.freeze([
  'owner_state_registry', 'workflow', 'task_outbox', 'creation_ledger',
  'durable_task_metadata', 'generation_task', 'preserved_scheduler_state',
  'preserved_resolution_state', 'preserved_choice_and_workflow_state'
]);
export const FRAME_TABLES = new Set(FRAME_FIELDS.slice(0, 6));
export const BASELINE = Object.freeze({
  autosave_coalescing_real_seconds: 5, periodic_checkpoint_real_seconds: 60,
  ordinary_autosave_retention_minimum: 20, hourly_checkpoints_per_active_play_hour: 1,
  hourly_retention_active_play_hours: 24, offline_progression_enabled: false,
  automatic_branch_merge_supported: false, manual_saves_retained_until_explicit_removal: true
});

/** Every own property is a field from the supplied State Variables section.
 * Repeated records are tables. Owner/task/frame tables are timeline-qualified.
 * Artifact content_ref uses a self-contained inline reference; no external URL is read.
 */
export class PersistenceState {
  constructor(serialized) {
    for (const name of Object.keys(FIELDS)) this[name] = {};
    this.versioned_baseline_policy = copy(BASELINE);
    if (serialized !== undefined) {
      exact(serialized, Object.keys(FIELDS));
      for (const name of Object.keys(FIELDS)) this[name] = copy(serialized[name]);
    }
  }
  toJSON() { return Object.fromEntries(Object.keys(FIELDS).map(k => [k, copy(this[k])])); }
}

export function record(name, value) {
  exact(value, FIELDS[name]);
  for (const key of ['id', 'timeline_id', 'campaign_id', 'schema_version', 'rules_version']) {
    if (key in value) id(value[key]);
  }
  for (const key of ['sequence', 'head_sequence', 'head_revision', 'attempts', 'fence', 'fencing_token']) {
    if (key in value) integer(value[key]);
  }
  for (const key of ['cause_refs', 'effect_keys', 'pending_tasks', 'scheduled_work_refs', 'accepted_output_refs', 'lineage_refs']) {
    if (key in value) requireThat(Array.isArray(value[key]), 'INVALID_FIELDS');
  }
  for (const field of ['status', 'label', 'kind', 'family', 'command_key', 'request_key', 'idempotency_key']) {
    if (field in value) requireThat(typeof value[field] === 'string', 'INVALID_FIELDS');
  }
  for (const field of ['owner_revision', 'resulting_revisions', 'expected_entity_revisions']) {
    if (field in value && field !== 'owner_revision') object(value[field]);
  }
  if (name === 'owner_state_registry') {
    requireThat(typeof value.required === 'boolean' && typeof value.rebuildable === 'boolean');
    requireThat(!(value.required && value.rebuildable), 'REQUIRED_CACHE_CONFLICT');
  }
  if (name === 'checkpoint') requireThat(['building', 'validating', 'valid', 'failed', 'quarantined'].includes(value.status));
  if (name === 'preserved_choice_and_workflow_state') requireThat(typeof value.unanswered_status === 'boolean');
  return value;
}

export function inline(value, compressed = false) {
  const bytes = Buffer.from(canonical(value));
  return compressed ? `inline:gzip:${gzipSync(bytes).toString('base64url')}` : `inline:json:${bytes.toString('base64url')}`;
}
export function dereference(ref) {
  requireThat(typeof ref === 'string' && Buffer.byteLength(ref) <= LIMITS.bytes * 2, 'SIZE_LIMIT');
  try {
    const compressed = ref.startsWith('inline:gzip:');
    requireThat(compressed || ref.startsWith('inline:json:'), 'UNSUPPORTED_REFERENCE');
    const encoded = ref.slice(compressed ? 12 : 12);
    requireThat(/^[A-Za-z0-9_-]+$/.test(encoded), 'INVALID_ENCODING');
    let bytes = Buffer.from(encoded, 'base64url');
    if (compressed) bytes = gunzipSync(bytes, { maxOutputLength: LIMITS.bytes });
    requireThat(bytes.length <= LIMITS.bytes, 'SIZE_LIMIT');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    canonical(value);
    return value;
  } catch (error) { throw error instanceof ContractError ? error : new ContractError('INVALID_ARTIFACT'); }
}
export function makeArtifact(value, required_kind = 'canonical', lineage_refs = [], visibility_policy = 'restricted') {
  const content_digest = hash(value);
  return {
    id: `artifact:${hash({ content_digest, required_kind, lineage_refs, visibility_policy }).slice(7)}`,
    content_digest, content_ref: inline(value), required_kind,
    visibility_policy: copy(visibility_policy), lineage_refs: copy(lineage_refs)
  };
}
export function artifactValue(artifact) {
  record('artifact', artifact);
  const value = dereference(artifact.content_ref);
  requireThat(hash(value) === artifact.content_digest, 'DIGEST_MISMATCH');
  return value;
}

/** Optional bytes can be unavailable only under an explicit noncanonical fallback
 * classification. Canonical consumers must still use artifactValue and fail closed.
 */
export function optionalUnavailable(artifact) {
  return ['optional_visual', 'derived_cache'].includes(artifact?.required_kind) &&
    artifact.content_ref === 'unavailable:declared_fallback';
}
export function validateArtifact(artifact) {
  record('artifact', artifact);
  if (optionalUnavailable(artifact)) {
    requireThat(/^sha256:[a-f0-9]{64}$/.test(artifact.content_digest), 'INVALID_DIGEST');
  } else artifactValue(artifact);
  return artifact;
}
