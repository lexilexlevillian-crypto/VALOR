/** Isolated System 25. All state transitions are synchronous, copy-on-write JSON
 * transactions. External dependencies are stateless, explicitly marked mocks.
 * A successful response means the mock storage contract accepted the transition;
 * durable is always false. Serialize/export explicitly to retain an in-memory run.
 */
import {
  ContractError, requireThat, copy, equal, canonical, hash, object, id, integer,
  timestamp, cut, cutRef, readCut, exact, FIELDS, FRAME_FIELDS, FRAME_TABLES,
  PersistenceState, record, inline, artifactValue, makeArtifact, validateArtifact, optionalUnavailable
} from './schema.mjs';
import { MOCK_DEPENDENCIES } from './dependencies.mjs';

const FORMAT = 'system25.persistence.v1';
const READS = new Set(['ListSaveEntries', 'GetTimelineLineage', 'GetCheckpointCompatibility',
  'GetKnownHistoryAtCut', 'InspectCheckpoint', 'ExportTimeline', 'GetStatus', 'Audit', 'SerializeState']);
const MODES = new Set(['selected_timeline_full', 'timeline_family', 'snapshot_only_full_root', 'redacted_story_history']);
const key = (...parts) => canonical(parts);
const head = timeline => ({ timeline_id: timeline.id, sequence: timeline.head_sequence });
const success = data => ({ ok: true, mock: true, durable: false, ...data });
const failure = code => ({ ok: false, mock: true, durable: false, error: { code } });
const next = number => integer(integer(number) + 1);

function emptyDurability() {
  return {
    last_durable_commit_cut: null, last_valid_checkpoint_cut: null,
    later_acknowledged_journal_progress: null, unavailable_extent: null,
    checkpoint_availability: 'mock_available', sync_status: 'not_synced',
    acknowledged_remote_revision: null, backup_status: 'not_backed_up', backup_destination_and_policy: null
  };
}
function emptyPortability() {
  return {
    export_mode: null, declared_scope: null, omitted_families: [],
    namespace_mapping_and_provenance: {}, compatibility_status: 'unchecked',
    reachability_and_pinned_dependencies: [], verified_recovery_anchor: null,
    valid_journal_prefix: null, migration_and_repair_provenance: []
  };
}
function emptyOptional() {
  return { unsubmitted_player_drafts: {}, narration_and_summaries: {}, retrieval_indexes_embeddings_and_visual_caches: {} };
}

export class PersistenceSystem25 {
  #state;
  #dependencies;
  #busy = false;

  /** @param {{state?: import('./schema.mjs').JsonObject, dependencies?: object}} options */
  constructor({ state, dependencies = {} } = {}) {
    for (const [name, fn] of Object.entries(dependencies)) {
      requireThat(name in MOCK_DEPENDENCIES && typeof fn === 'function', 'UNKNOWN_DEPENDENCY');
    }
    this.#dependencies = Object.freeze({ ...MOCK_DEPENDENCIES, ...dependencies });
    this.#state = new PersistenceState(state).toJSON();
    this.#validateStructure(this.#state);
  }

  /** Main typed JSON state-machine interface. No exceptions or private payloads
   * escape errors. now is real metadata only; it never advances canonical time.
   * @param {import('./schema.mjs').Request} request
   * @returns {import('./schema.mjs').JsonObject}
   */
  stateMachine(request) {
    if (this.#busy) return failure('REENTRANT_OPERATION');
    this.#busy = true;
    try {
      canonical(request); object(request);
      requireThat(Object.keys(request).every(k => ['command', 'context', 'args', 'now'].includes(k)));
      id(request.command);
      const args = copy(request.args ?? {}); object(args);
      const context = copy(request.context ?? {});
      const now = timestamp(request.now ?? new Date().toISOString());
      this.#authorize(context, request.command, args);
      if (READS.has(request.command)) return success(this.#query(this.#state, request.command, context, args));
      record('command_context', context);
      for (const field of ['campaign_id', 'timeline_id', 'operation_id', 'idempotency_key']) id(context[field]);
      integer(context.expected_head_revision); integer(context.session_fence); object(context.expected_entity_revisions);
      const commandKey = key(context.campaign_id, context.timeline_id, context.idempotency_key);
      const operationKey = key(context.campaign_id, context.timeline_id, context.operation_id);
      const fingerprint = hash({ command: request.command, args, operation_id: context.operation_id });
      const previous = this.#state.command_result_ledger[commandKey];
      if (previous) {
        requireThat(this.#state.command_context[commandKey]?.authority.actor_id === context.authority.actor_id, 'UNAUTHORIZED');
        const tracking = this.#state.operation_tracking[operationKey];
        requireThat(tracking?.validation_results?.request_digest === fingerprint, 'IDEMPOTENCY_CONFLICT');
        return copy(this.#value(this.#state, previous.committed_result_ref));
      }
      requireThat(!this.#state.operation_tracking[operationKey], 'OPERATION_ID_CONFLICT');
      if (request.command !== 'CreateCampaign') this.#guard(this.#state, context, request.command, now);
      const draft = copy(this.#state);
      draft.command_context[commandKey] = context;
      draft.operation_tracking[operationKey] = {
        operation_id: context.operation_id, requested_cut: null, captured_cut: null,
        status: 'building', validation_results: { request_digest: fingerprint }, failure_diagnosis: null
      };
      const result = this.#mutate(draft, request.command, context, args, now, commandKey, operationKey);
      const response = result.ok === false ? { ...result, mock: true, durable: false } : success(result);
      const resultRef = this.#put(draft, response, 'operation_result');
      draft.command_result_ledger[commandKey] = { scoped_command_key: commandKey, committed_result_ref: resultRef };
      if (draft.operation_tracking[operationKey].status === 'building' && !draft.operation_tracking[operationKey].validation_results.checkpoint_id) {
        draft.operation_tracking[operationKey].status = 'mock_committed';
      }
      this.#validateStructure(draft);
      let receipt;
      try {
        receipt = this.#call('commitStorage', {
          operation_id: context.operation_id, expected_revision: context.expected_head_revision,
          state_ref: inline(draft), revision_guard: copy(context), atomic: true
        });
      } catch (error) {
        const report = this.#state.durability_reporting[context.timeline_id];
        if (report) report.checkpoint_availability = 'storage_unavailable';
        throw error;
      }
      if (!(receipt.acknowledged === true && receipt.simulated_durable_commit === true && receipt.durable === false)) {
        const report = this.#state.durability_reporting[context.timeline_id];
        if (report) report.checkpoint_availability = 'storage_unavailable';
        throw new ContractError('STORAGE_UNAVAILABLE');
      }
      this.#state = draft;
      return copy(response);
    } catch (error) {
      return failure(error instanceof ContractError ? error.code : 'OPERATION_FAILED');
    } finally { this.#busy = false; }
  }

  #call(name, payload) {
    let result;
    try { result = this.#dependencies[name](copy(payload)); }
    catch { throw new ContractError(`DEPENDENCY_FAILED:${name}`); }
    canonical(result); object(result);
    requireThat(result.mock === true, 'NONMOCK_DEPENDENCY_FORBIDDEN');
    return copy(result);
  }
  #authorize(context, command, args) {
    object(context); object(context.authority);
    requireThat(['player', 'administrator'].includes(context.authority.role), 'UNAUTHORIZED');
    id(context.authority.session_id); id(context.authority.actor_id);
    requireThat(this.#call('authorizeUI', { context, command, args }).authorized === true, 'UNAUTHORIZED');
    if (['SerializeState', 'Audit', 'MigrateCheckpoint', 'CompactHistory', 'RecoverTimeline'].includes(command)) {
      requireThat(context.authority.role === 'administrator', 'UNAUTHORIZED');
    }
  }
  #guard(state, context, command, now) {
    const timeline = this.#timeline(state, context.timeline_id);
    requireThat(timeline.campaign_id === context.campaign_id, 'SCOPE_MISMATCH');
    if (command !== 'ResumeStorage') requireThat(state.durability_reporting[timeline.id].checkpoint_availability !== 'storage_unavailable', 'MUTATION_PAUSED');
    requireThat(timeline.status !== 'quarantined' || ['RecoverTimeline', 'ResumeStorage'].includes(command), 'TIMELINE_QUARANTINED');
    const writer = state.writer_coordination[context.campaign_id];
    requireThat(writer && writer.active_timeline_id === timeline.id, 'WRONG_TIMELINE');
    if (command !== 'AcquireWriter') requireThat(writer.writer_owner === context.authority.session_id, 'WRITER_CONFLICT');
    if (command !== 'AcquireWriter' && writer.writer_lease.expires_at !== undefined) {
      requireThat(Date.parse(writer.writer_lease.expires_at) > Date.parse(now), 'WRITER_LEASE_EXPIRED');
    }
    requireThat(writer.session_mode === 'writable', 'READ_ONLY');
    requireThat(writer.fencing_token === context.session_fence, 'STALE_FENCE');
    requireThat(timeline.head_revision === context.expected_head_revision, 'STALE_HEAD');
    for (const [family, revision] of Object.entries(context.expected_entity_revisions)) {
      requireThat(equal(state.owner_state_registry[timeline.id][family]?.owner_revision ?? null, revision), 'STALE_ENTITY');
    }
  }
  #timeline(state, timelineID) {
    id(timelineID);
    const timeline = state.timeline[timelineID];
    requireThat(timeline, 'TIMELINE_UNAVAILABLE');
    return timeline;
  }
  #put(state, value, kind = 'canonical', refs = [], visibility = 'restricted', explicitID) {
    const artifact = makeArtifact(value, kind, [...new Set(refs)].sort(), visibility);
    if (explicitID) artifact.id = id(explicitID);
    this.#addArtifact(state, artifact);
    return artifact.id;
  }
  #addArtifact(state, artifact) {
    validateArtifact(artifact);
    const existing = state.artifact[artifact.id];
    requireThat(!existing || (existing.content_digest === artifact.content_digest &&
      equal(existing.lineage_refs, artifact.lineage_refs) && equal(existing.visibility_policy, artifact.visibility_policy) &&
      existing.required_kind === artifact.required_kind), 'IMMUTABLE_ARTIFACT_CONFLICT');
    if (!existing) state.artifact[artifact.id] = copy(artifact);
  }
  #addArtifacts(state, artifacts = []) {
    requireThat(Array.isArray(artifacts));
    for (const artifact of artifacts) this.#addArtifact(state, artifact);
  }
  #value(state, ref) {
    id(ref); requireThat(state.artifact[ref], 'REQUIRED_ARTIFACT_UNAVAILABLE');
    return artifactValue(state.artifact[ref]);
  }
  #frame(state, timelineID) {
    return Object.fromEntries(FRAME_FIELDS.map(name => [name, copy(state[name][timelineID])]));
  }
  #installFrame(state, timelineID, frame) {
    for (const name of FRAME_FIELDS) state[name][timelineID] = copy(frame[name]);
  }
  #frameRefs(frame) {
    const refs = [];
    for (const owner of Object.values(frame.owner_state_registry)) {
      refs.push(owner.state_ref, owner.serialization_contract_ref, owner.reconstruction_adapter_ref,
        owner.invariant_contract_ref, owner.migration_policy_ref, ...owner.scheduled_work_refs);
    }
    for (const workflow of Object.values(frame.workflow)) refs.push(workflow.reservations_ref);
    for (const task of Object.values(frame.task_outbox)) refs.push(task.payload_ref);
    for (const creation of Object.values(frame.creation_ledger)) refs.push(creation.accepted_content_ref);
    for (const task of Object.values(frame.generation_task)) {
      if (task.staged_candidate_ref !== null) refs.push(task.staged_candidate_ref);
      refs.push(...task.accepted_output_refs);
    }
    refs.push(frame.preserved_choice_and_workflow_state.prompt_anchor, frame.preserved_choice_and_workflow_state.known_view_ref);
    return [...new Set(refs)].filter(ref => ref !== null);
  }
  #reachable(state, roots) {
    const seen = new Set(); const pending = [...roots];
    while (pending.length) {
      const ref = pending.pop();
      if (seen.has(ref)) continue;
      const artifact = state.artifact[ref];
      requireThat(artifact, 'REQUIRED_ARTIFACT_UNAVAILABLE');
      validateArtifact(artifact); seen.add(ref);
      pending.push(...artifact.lineage_refs);
    }
    return [...seen].sort();
  }
  #validateFrame(state, timelineID, frame, restoring = false) {
    exact(frame, FRAME_FIELDS);
    const timeline = this.#timeline(state, timelineID);
    for (const name of FRAME_FIELDS) {
      if (FRAME_TABLES.has(name)) {
        object(frame[name]);
        for (const value of Object.values(frame[name])) record(name, value);
      } else record(name, frame[name]);
    }
    const policy = state.campaign[timeline.campaign_id].content_policy;
    requireThat(Array.isArray(policy.required_state_families) && policy.required_state_families.length > 0, 'REQUIRED_FAMILIES_UNDECLARED');
    for (const family of policy.required_state_families) {
      requireThat(frame.owner_state_registry[family]?.required === true, 'MISSING_REQUIRED_FAMILY');
    }
    for (const [family, owner] of Object.entries(frame.owner_state_registry)) {
      requireThat(owner.family === family, 'OWNER_ID_MISMATCH');
      requireThat(this.#call('requestOwnerContract', { family, schema_version: owner.schema_version, contract: owner }).supported === true,
        'UNSUPPORTED_OWNER_VERSION');
      const validation = this.#call('validateOwnerState', {
        timeline_id: timelineID, owner, payload: this.#value(state, owner.state_ref), frame, restoring
      });
      requireThat(validation.valid === true, 'OWNER_INVARIANT_FAILED');
      requireThat(Array.isArray(validation.required_refs), 'INVALID_OWNER_CONTRACT');
      const retained = new Set(this.#reachable(state, [owner.state_ref, ...owner.scheduled_work_refs]));
      for (const ref of validation.required_refs) requireThat(retained.has(ref), 'UNMANIFESTED_OWNER_REFERENCE');
    }
    this.#reachable(state, this.#frameRefs(frame));
    requireThat(this.#call('requestSystem11', { frame: frame.preserved_scheduler_state, restoring }).approved === true, 'TIMING_INVARIANT_FAILED');
    const effectKeys = new Set();
    for (const [workflowID, workflow] of Object.entries(frame.workflow)) {
      requireThat(workflow.id === workflowID && workflow.timeline_id === timelineID, 'WORKFLOW_SCOPE_MISMATCH');
      for (const taskID of workflow.pending_tasks) requireThat(frame.task_outbox[taskID], 'MISSING_PENDING_TASK');
      for (const effect of workflow.effect_keys) {
        requireThat(!effectKeys.has(effect), 'DUPLICATE_EFFECT_KEY'); effectKeys.add(effect);
      }
    }
    const taskKeys = new Set();
    for (const [taskID, task] of Object.entries(frame.task_outbox)) {
      requireThat(task.id === taskID && task.timeline_id === timelineID, 'TASK_SCOPE_MISMATCH');
      requireThat(task.workflow_ref === null || frame.workflow[task.workflow_ref], 'MISSING_WORKFLOW');
      requireThat(frame.durable_task_metadata[taskID], 'MISSING_TASK_METADATA');
      requireThat(!taskKeys.has(task.idempotency_key), 'DUPLICATE_TASK_KEY'); taskKeys.add(task.idempotency_key);
    }
    for (const [requestKey, creation] of Object.entries(frame.creation_ledger)) {
      requireThat(creation.request_key === requestKey && equal(creation.timeline_scope,
        { campaign_id: timeline.campaign_id, timeline_id: timelineID }), 'CREATION_SCOPE_MISMATCH');
    }
    for (const [taskID, task] of Object.entries(frame.generation_task)) {
      requireThat(task.task_id === taskID && task.original_timeline_session_context.timeline_id === timelineID &&
        task.original_timeline_session_context.campaign_id === timeline.campaign_id, 'GENERATION_SCOPE_MISMATCH');
    }
    return true;
  }
  #lineage(state, timelineID) {
    const visited = new Set(); const ancestry = [];
    let timeline = this.#timeline(state, timelineID);
    while (true) {
      requireThat(!visited.has(timeline.id), 'ANCESTRY_CYCLE'); visited.add(timeline.id);
      if (timeline.parent_id === null) { requireThat(timeline.fork_cut_ref === null, 'INVALID_FORK'); break; }
      const parent = this.#timeline(state, timeline.parent_id); const fork = readCut(timeline.fork_cut_ref);
      requireThat(parent.campaign_id === timeline.campaign_id && fork.timeline_id === parent.id &&
        fork.sequence <= parent.head_sequence, 'INVALID_FORK');
      ancestry.unshift({ parent_id: parent.id, fork_cut: fork }); timeline = parent;
    }
    return ancestry;
  }
  #frameAt(state, at) {
    cut(at); const timeline = this.#timeline(state, at.timeline_id);
    requireThat(at.sequence <= timeline.head_sequence, 'INVALID_CUT'); this.#lineage(state, timeline.id);
    const events = state.canonical_event[timeline.id];
    for (let i = 0; i < at.sequence; i++) {
      requireThat(events[i]?.sequence === i + 1 && events[i].timeline_id === timeline.id, 'JOURNAL_GAP');
      const event = events[i];
      requireThat(this.#call('requestOwnerContract', { contract_kind: 'resolved_event_adapter', schema_version: event.schema_version,
        rules_version: event.rules_version }).supported === true, 'UNSUPPORTED_EVENT_VERSION');
      const resolved = this.#value(state, event.resolved_payload_ref);
      requireThat(equal(event.occurred_at, resolved.preserved_scheduler_state.canonical_clock), 'EVENT_TIME_MISMATCH');
      requireThat(equal(event.resulting_revisions, Object.fromEntries(Object.entries(resolved.owner_state_registry)
        .map(([family, owner]) => [family, owner.owner_revision]))), 'EVENT_REVISION_MISMATCH');
    }
    const ref = at.sequence === 0 ? `root:${timeline.id}` : events[at.sequence - 1].resolved_payload_ref;
    const frame = this.#value(state, ref);
    this.#validateFrame(state, timeline.id, frame, true);
    return frame;
  }
  #append(state, context, frame, eventInput, commandKey) {
    const timeline = this.#timeline(state, context.timeline_id);
    this.#validateFrame(state, timeline.id, frame);
    for (const [family, previous] of Object.entries(state.owner_state_registry[timeline.id])) {
      if (previous.required || !previous.rebuildable) requireThat(frame.owner_state_registry[family], 'CANONICAL_FAMILY_REMOVAL');
      if (previous.required) requireThat(frame.owner_state_registry[family].required === true, 'CANONICAL_FAMILY_REMOVAL');
    }
    requireThat(this.#call('approveOwnerMutation', { context, previous: this.#frame(state, timeline.id), proposed: frame }).approved === true,
      'OWNER_MUTATION_REJECTED');
    const seq = next(timeline.head_sequence);
    const eventID = id(eventInput.id ?? `event:${hash(commandKey).slice(7)}`);
    requireThat(!Object.values(state.canonical_event).flat().some(e => e.id === eventID &&
      state.timeline[e.timeline_id].campaign_id === timeline.campaign_id), 'DUPLICATE_EVENT_ID');
    const resulting_revisions = Object.fromEntries(Object.entries(frame.owner_state_registry).map(([family, owner]) => [family, owner.owner_revision]));
    if (eventInput.resulting_revisions !== undefined) requireThat(equal(eventInput.resulting_revisions, resulting_revisions), 'REVISION_MISMATCH');
    const event = {
      id: eventID, timeline_id: timeline.id, sequence: seq, command_key: commandKey,
      cause_refs: copy(eventInput.cause_refs ?? []), occurred_at: copy(frame.preserved_scheduler_state.canonical_clock),
      schema_version: eventInput.schema_version ?? FORMAT, rules_version: eventInput.rules_version ?? 'persistence-v1',
      resolved_payload_ref: this.#put(state, frame, 'resolved_frame', this.#frameRefs(frame)), resulting_revisions
    };
    if (eventInput.occurred_at !== undefined) requireThat(equal(eventInput.occurred_at, event.occurred_at), 'TIME_MISMATCH');
    record('canonical_event', event);
    state.canonical_event[timeline.id].push(event);
    timeline.head_sequence = seq; timeline.head_revision = next(timeline.head_revision);
    this.#installFrame(state, timeline.id, frame);
    state.durability_reporting[timeline.id].later_acknowledged_journal_progress = { mock: true, cut: head(timeline) };
    return { event_id: event.id, cut: head(timeline), head_revision: timeline.head_revision };
  }
  #create(state, context, args, now) {
    requireThat(!state.campaign[context.campaign_id] && !state.timeline[context.timeline_id], 'IDENTITY_EXISTS');
    requireThat(context.expected_head_revision === 0 && context.session_fence === 0, 'STALE_HEAD');
    object(args.content_policy); object(args.frame);
    requireThat(args.content_policy.offline_progression_enabled !== true, 'OFFLINE_POLICY_NOT_REGISTERED');
    state.campaign[context.campaign_id] = { id: context.campaign_id, content_policy: copy(args.content_policy), created_at: now, status: 'active' };
    state.timeline[context.timeline_id] = {
      id: context.timeline_id, campaign_id: context.campaign_id, parent_id: null, fork_cut_ref: null,
      head_sequence: 0, head_revision: 0, rules_policy: copy(args.rules_policy ?? {}), status: 'active'
    };
    state.timeline_metadata[context.timeline_id] = { label: String(args.label ?? ''), fork_reason: 'root', created_at: now };
    state.canonical_event[context.timeline_id] = [];
    this.#addArtifacts(state, args.artifacts);
    this.#validateFrame(state, context.timeline_id, args.frame);
    this.#installFrame(state, context.timeline_id, args.frame);
    this.#put(state, args.frame, 'root_frame', this.#frameRefs(args.frame), 'restricted', `root:${context.timeline_id}`);
    state.writer_coordination[context.campaign_id] = {
      active_timeline_id: context.timeline_id, writer_owner: context.authority.session_id,
      writer_lease: { status: 'mock_active' }, fencing_token: 1, session_mode: 'writable'
    };
    state.durability_reporting[context.timeline_id] = emptyDurability();
    state.portability_and_maintenance[context.timeline_id] = emptyPortability();
    state.noncanonical_optional_state[context.timeline_id] = emptyOptional();
    return { campaign_id: context.campaign_id, timeline_id: context.timeline_id, head_revision: 0, session_fence: 1 };
  }
  #capture(state, context, args, now, operationKey) {
    const at = cut(args.desired_cut ?? head(this.#timeline(state, context.timeline_id)));
    requireThat(at.timeline_id === context.timeline_id, 'SCOPE_MISMATCH');
    const storage = this.#call('requestStorageSnapshot', { cut: at });
    requireThat(storage.consistent_view === true && storage.available === true, 'SNAPSHOT_UNAVAILABLE');
    requireThat(this.#call('requestStorageCapacity', { cut: at }).available === true, 'STORAGE_CAPACITY');
    const frame = this.#frameAt(state, at);
    const checkpointID = id(args.checkpoint_id ?? `checkpoint:${hash(operationKey).slice(7)}`);
    requireThat(!state.checkpoint[checkpointID], 'CHECKPOINT_EXISTS');
    const ancestry = this.#lineage(state, at.timeline_id);
    const refs = [this.#put(state, frame, 'checkpoint_state', this.#frameRefs(frame))];
    const segmentRefs = [];
    for (const selected of [...ancestry.map(a => a.fork_cut), at]) {
      const events = state.canonical_event[selected.timeline_id].slice(0, selected.sequence);
      segmentRefs.push(this.#put(state, events, 'event_segment', events.map(e => e.resolved_payload_ref)));
      refs.push(`root:${selected.timeline_id}`);
    }
    refs.push(...segmentRefs);
    const reachable = this.#reachable(state, refs);
    const manifest = {
      format_version: FORMAT, campaign_id: context.campaign_id, timeline_id: at.timeline_id,
      ancestry_and_fork_cuts: ancestry, checkpoint_id: checkpointID, event_cut: at,
      canonical_time: copy(frame.preserved_scheduler_state.canonical_clock),
      schema_versions: Object.fromEntries(Object.entries(frame.owner_state_registry).map(([f, o]) => [f, o.schema_version])),
      rules_and_content_versions: { rules_policy: copy(state.timeline[at.timeline_id].rules_policy), content_policy: copy(state.campaign[context.campaign_id].content_policy) },
      required_state_families: Object.values(frame.owner_state_registry).filter(o => o.required).map(o => o.family).sort(),
      event_segment_refs: segmentRefs,
      artifact_refs_and_digests: reachable.map(ref => ({ ref, digest: state.artifact[ref].content_digest, required_kind: state.artifact[ref].required_kind })),
      visibility_and_privacy_policy: 'preserve_owner_policies', completeness_status: 'complete'
    };
    const manifestRef = this.#put(state, manifest, 'manifest', reachable);
    state.manifest[checkpointID] = manifest;
    state.checkpoint[checkpointID] = {
      id: checkpointID, timeline_id: at.timeline_id, cut_ref: cutRef(at), canonical_time: copy(manifest.canonical_time),
      manifest_ref: manifestRef, digest_ref: state.artifact[manifestRef].content_digest, status: 'building', created_at: now
    };
    const tracking = state.operation_tracking[operationKey];
    tracking.requested_cut = at; tracking.captured_cut = at; tracking.status = 'building';
    Object.assign(tracking.validation_results, {
      checkpoint_id: checkpointID, save_kind: args.save_kind ?? 'manual', label: String(args.label ?? ''),
      retention_class: args.retention_class ?? (args.save_kind === 'autosave' ? 'ordinary' : 'manual')
    });
    requireThat(['manual', 'autosave', 'recovery', 'fork_root', 'hourly'].includes(tracking.validation_results.save_kind), 'INVALID_SAVE_KIND');
    if (args.publish === true) return this.#publish(state, checkpointID);
    return { checkpoint_id: checkpointID, captured_cut: at, status: 'building' };
  }
  #checkpointFrame(state, checkpointID, requireValid = true) {
    const checkpoint = state.checkpoint[id(checkpointID)];
    requireThat(checkpoint && (!requireValid || checkpoint.status === 'valid'), 'CHECKPOINT_UNAVAILABLE');
    const manifest = state.manifest[checkpointID]; record('manifest', manifest);
    requireThat(manifest.format_version === FORMAT && manifest.completeness_status === 'complete', 'UNSUPPORTED_FORMAT');
    requireThat(equal(this.#value(state, checkpoint.manifest_ref), manifest) &&
      checkpoint.digest_ref === state.artifact[checkpoint.manifest_ref].content_digest, 'MANIFEST_MISMATCH');
    const at = readCut(checkpoint.cut_ref);
    requireThat(equal(at, manifest.event_cut) && manifest.timeline_id === checkpoint.timeline_id &&
      manifest.checkpoint_id === checkpointID && manifest.campaign_id === state.timeline[checkpoint.timeline_id].campaign_id &&
      equal(checkpoint.canonical_time, manifest.canonical_time), 'CUT_MISMATCH');
    requireThat(equal(manifest.ancestry_and_fork_cuts, this.#lineage(state, checkpoint.timeline_id)), 'ANCESTRY_MISMATCH');
    const snapshots = manifest.artifact_refs_and_digests.filter(a => a.required_kind === 'checkpoint_state');
    requireThat(snapshots.length === 1, 'SNAPSHOT_MISSING');
    for (const item of manifest.artifact_refs_and_digests) {
      requireThat(state.artifact[item.ref], 'REQUIRED_ARTIFACT_UNAVAILABLE');
      validateArtifact(state.artifact[item.ref]);
      requireThat(state.artifact[item.ref].content_digest === item.digest && state.artifact[item.ref].required_kind === item.required_kind, 'DIGEST_MISMATCH');
    }
    const requiredRefs = this.#reachable(state, [snapshots[0].ref, ...manifest.event_segment_refs,
      `root:${checkpoint.timeline_id}`, ...manifest.ancestry_and_fork_cuts.map(a => `root:${a.parent_id}`)]);
    requireThat(equal(requiredRefs, manifest.artifact_refs_and_digests.map(a => a.ref).sort()), 'MANIFEST_INCOMPLETE');
    const frame = this.#value(state, snapshots[0].ref);
    requireThat(equal(frame.preserved_scheduler_state.canonical_clock, manifest.canonical_time), 'TIME_MISMATCH');
    requireThat(equal(Object.fromEntries(Object.entries(frame.owner_state_registry).map(([f, o]) => [f, o.schema_version])), manifest.schema_versions), 'SCHEMA_MISMATCH');
    requireThat(equal(Object.values(frame.owner_state_registry).filter(o => o.required).map(o => o.family).sort(), manifest.required_state_families), 'MISSING_REQUIRED_FAMILY');
    const cuts = [...manifest.ancestry_and_fork_cuts.map(a => a.fork_cut), at];
    requireThat(cuts.length === manifest.event_segment_refs.length, 'JOURNAL_MISMATCH');
    cuts.forEach((c, i) => requireThat(equal(this.#value(state, manifest.event_segment_refs[i]), state.canonical_event[c.timeline_id].slice(0, c.sequence)), 'JOURNAL_MISMATCH'));
    const resolved = this.#frameAt(state, at);
    if (!equal(resolved, frame)) {
      const migration = Object.values(state.migration).find(m => m.target_ref === checkpointID && m.status === 'valid');
      requireThat(migration, 'SNAPSHOT_STATE_MISMATCH');
      const proof = this.#value(state, migration.validation_ref);
      requireThat(proof.valid === true && proof.equivalent === true && proof.owner_approved === true, 'MIGRATION_REJECTED');
      const revalidation = this.#call('validateMigration', { source: resolved, target: frame,
        versions: this.#value(state, migration.versions_ref), restoring: true });
      requireThat(revalidation.valid === true && revalidation.equivalent === true && revalidation.owner_approved === true, 'MIGRATION_REJECTED');
      for (const field of FRAME_FIELDS.filter(f => f !== 'owner_state_registry')) requireThat(equal(resolved[field], frame[field]), 'MIGRATION_CHANGES_COMMITMENTS');
    }
    this.#validateFrame(state, checkpoint.timeline_id, frame, true);
    return frame;
  }
  #publish(state, checkpointID) {
    const checkpoint = state.checkpoint[id(checkpointID)];
    requireThat(checkpoint, 'CHECKPOINT_UNAVAILABLE');
    if (checkpoint.status === 'valid') return { checkpoint_id: checkpointID, captured_cut: readCut(checkpoint.cut_ref), status: 'valid' };
    requireThat(checkpoint.status === 'building', 'INVALID_CHECKPOINT_TRANSITION');
    const tracking = Object.values(state.operation_tracking).find(o => o.validation_results.checkpoint_id === checkpointID);
    requireThat(tracking, 'CAPTURE_OPERATION_MISSING');
    checkpoint.status = 'validating'; tracking.status = 'validating';
    try { this.#checkpointFrame(state, checkpointID, false); }
    catch (error) {
      checkpoint.status = 'quarantined'; tracking.status = 'quarantined';
      tracking.failure_diagnosis = { code: error instanceof ContractError ? error.code : 'VALIDATION_FAILED' };
      return failure(tracking.failure_diagnosis.code);
    }
    checkpoint.status = 'valid'; tracking.status = 'valid';
    const plan = tracking.validation_results;
    const entryID = `save:${checkpointID}`;
    state.save_entry[entryID] = { id: entryID, checkpoint_id: checkpointID, kind: plan.save_kind, label: plan.label, retention_class: plan.retention_class };
    const report = state.durability_reporting[checkpoint.timeline_id];
    const previous = report.last_valid_checkpoint_cut;
    const captured = readCut(checkpoint.cut_ref);
    if (!previous || captured.sequence >= previous.sequence) report.last_valid_checkpoint_cut = captured;
    return { checkpoint_id: checkpointID, save_entry_id: entryID, captured_cut: captured, status: 'valid' };
  }

  #rebindFrame(frame, campaignID, timelineID, fence, sourceCut) {
    const result = copy(frame);
    for (const workflow of Object.values(result.workflow)) workflow.timeline_id = timelineID;
    for (const task of Object.values(result.task_outbox)) { task.timeline_id = timelineID; task.fence = fence; }
    for (const creation of Object.values(result.creation_ledger)) creation.timeline_scope = { campaign_id: campaignID, timeline_id: timelineID };
    for (const task of Object.values(result.generation_task)) {
      task.original_timeline_session_context = { campaign_id: campaignID, timeline_id: timelineID };
      task.fencing_token = fence;
      if (!['accepted', 'completed'].includes(task.status)) task.source_cut = copy(sourceCut);
    }
    return result;
  }
  #activate(state, context, timelineID, frame) {
    const timeline = this.#timeline(state, timelineID);
    this.#validateFrame(state, timelineID, frame, true);
    requireThat(this.#call('restoreOwnerState', { campaign_id: timeline.campaign_id, timeline_id: timelineID,
      cut: head(timeline), frame }).accepted === true, 'OWNER_RESTORE_REJECTED');
    const previous = state.writer_coordination[timeline.campaign_id];
    const fence = next(previous?.fencing_token ?? 0);
    state.writer_coordination[timeline.campaign_id] = {
      active_timeline_id: timelineID, writer_owner: context.authority.session_id,
      writer_lease: { status: 'mock_active' }, fencing_token: fence, session_mode: 'writable'
    };
    return { timeline_id: timelineID, head_revision: timeline.head_revision, session_fence: fence,
      known_view: this.#known(state, context, timelineID, frame) };
  }
  #known(state, context, timelineID, frame) {
    return this.#call('requestKnownView', {
      actor_id: context.authority.actor_id, campaign_id: state.timeline[timelineID].campaign_id,
      timeline_id: timelineID, owner_state_registry: frame.owner_state_registry,
      choice: frame.preserved_choice_and_workflow_state
    });
  }
  #fork(state, context, args, now) {
    let at; let frame;
    if (args.checkpoint_id !== undefined) {
      const checkpoint = state.checkpoint[args.checkpoint_id];
      frame = this.#checkpointFrame(state, args.checkpoint_id); at = readCut(checkpoint.cut_ref);
    } else if (args.anchor_id !== undefined) {
      const anchor = state.turn_anchor[key(context.campaign_id, context.timeline_id, args.anchor_id)];
      requireThat(anchor, 'UNSUPPORTED_ANCHOR');
      requireThat(['before', 'after'].includes(args.boundary), 'EXACT_BOUNDARY_REQUIRED');
      at = cut(args.boundary === 'before' ? anchor.supported_before_cut : anchor.supported_after_cut);
      frame = this.#frameAt(state, at);
    } else {
      requireThat(args.exact_cut !== undefined, 'EXACT_BOUNDARY_REQUIRED');
      at = cut(args.exact_cut); frame = this.#frameAt(state, at);
    }
    requireThat(this.#timeline(state, at.timeline_id).campaign_id === context.campaign_id, 'SCOPE_MISMATCH');
    const childID = id(args.new_timeline_id);
    requireThat(!state.timeline[childID], 'TIMELINE_EXISTS');
    const parent = state.timeline[at.timeline_id];
    const fence = next(state.writer_coordination[context.campaign_id].fencing_token);
    frame = this.#rebindFrame(frame, context.campaign_id, childID, fence, { timeline_id: childID, sequence: 0 });
    state.timeline[childID] = { id: childID, campaign_id: context.campaign_id,
      parent_id: parent.id, fork_cut_ref: cutRef(at), head_sequence: 0, head_revision: 0,
      rules_policy: copy(args.checkpoint_id ? state.manifest[args.checkpoint_id].rules_and_content_versions.rules_policy : parent.rules_policy), status: 'active' };
    state.timeline_metadata[childID] = { label: String(args.new_label ?? ''), fork_reason: String(args.reason ?? 'historical_resume'), created_at: now };
    state.canonical_event[childID] = [];
    this.#installFrame(state, childID, frame);
    this.#validateFrame(state, childID, frame, true);
    this.#put(state, frame, 'root_frame', this.#frameRefs(frame), 'restricted', `root:${childID}`);
    state.durability_reporting[childID] = emptyDurability();
    state.portability_and_maintenance[childID] = emptyPortability();
    state.portability_and_maintenance[childID].reachability_and_pinned_dependencies = this.#lineage(state, childID);
    state.noncanonical_optional_state[childID] = emptyOptional();
    return { ...this.#activate(state, context, childID, frame), fork_cut: at, parent_id: parent.id };
  }
  #autosave(state, context, args, now, operationKey) {
    requireThat(['consequential', 'choice', 'periodic', 'flush', 'suspend', 'exit'].includes(args.trigger), 'INVALID_TRIGGER');
    const timeline = state.timeline[context.timeline_id];
    const at = head(timeline);
    const valid = Object.values(state.checkpoint).filter(c => c.timeline_id === timeline.id && c.status === 'valid');
    const latestCut = valid.reduce((best, c) => Math.max(best, readCut(c.cut_ref).sequence), -1);
    if (latestCut >= at.sequence) return { status: 'no_progress', cut: at };
    const entries = Object.values(state.save_entry).filter(e => state.checkpoint[e.checkpoint_id]?.timeline_id === timeline.id);
    const autosaves = entries.filter(e => ['autosave', 'hourly'].includes(e.kind));
    const lastTime = autosaves.reduce((best, e) => Math.max(best, Date.parse(state.checkpoint[e.checkpoint_id].created_at)),
      Date.parse(state.campaign[context.campaign_id].created_at));
    const elapsed = Math.max(0, (Date.parse(now) - lastTime) / 1000);
    const policy = state.versioned_baseline_policy;
    const forced = ['suspend', 'exit'].includes(args.trigger);
    const threshold = args.trigger === 'periodic' ? policy.periodic_checkpoint_real_seconds : policy.autosave_coalescing_real_seconds;
    if (!forced && autosaves.length && elapsed < threshold) {
      state.operation_tracking[operationKey].requested_cut = at;
      state.operation_tracking[operationKey].status = 'autosave_deferred';
      return { status: 'coalesced', requested_cut: at };
    }
    if (args.trigger === 'periodic' && elapsed < threshold) return { status: 'not_due', requested_cut: at };
    if (['choice', 'consequential'].includes(args.trigger)) requireThat(args.stable_choice_boundary === true, 'CHOICE_BOUNDARY_REQUIRED');
    const captured = this.#capture(state, context, { desired_cut: at, save_kind: 'autosave', label: '', publish: true, retention_class: 'ordinary' }, now, operationKey);
    if (captured.ok === false) return captured;
    if (args.active_play_seconds !== undefined) {
      integer(args.active_play_seconds);
      const hour = Math.floor(args.active_play_seconds / 3600);
      const retentionClass = `active_hour:${hour}`;
      if (!entries.some(e => e.retention_class === retentionClass)) {
        const entryID = `hourly:${captured.checkpoint_id}`;
        state.save_entry[entryID] = { id: entryID, checkpoint_id: captured.checkpoint_id, kind: 'hourly', label: '', retention_class: retentionClass };
      }
    }
    this.#rotate(state, timeline.id);
    return captured;
  }
  #rotate(state, timelineID) {
    const entries = Object.values(state.save_entry).filter(e => state.checkpoint[e.checkpoint_id]?.timeline_id === timelineID);
    const ordinary = entries.filter(e => e.kind === 'autosave' && e.retention_class === 'ordinary')
      .sort((a, b) => Date.parse(state.checkpoint[b.checkpoint_id].created_at) - Date.parse(state.checkpoint[a.checkpoint_id].created_at));
    for (const entry of ordinary.slice(state.versioned_baseline_policy.ordinary_autosave_retention_minimum)) delete state.save_entry[entry.id];
    const hourly = entries.filter(e => e.kind === 'hourly' && /^active_hour:\d+$/.test(e.retention_class))
      .sort((a, b) => Number(b.retention_class.slice(12)) - Number(a.retention_class.slice(12)));
    for (const entry of hourly.slice(state.versioned_baseline_policy.hourly_retention_active_play_hours)) delete state.save_entry[entry.id];
    // Rotation removes catalog references only. Checkpoints, roots, and events stay reachable.
  }
  #deliverTask(state, context, args, commandKey, now) {
    const frame = this.#frame(state, context.timeline_id);
    const task = frame.task_outbox[id(args.task_id)];
    requireThat(task, 'TASK_UNAVAILABLE');
    const metadata = frame.durable_task_metadata[task.id];
    if (task.status === 'acknowledged') return { task_id: task.id, acknowledgment: copy(metadata.acknowledgment), duplicate: true };
    const policy = object(metadata.retry_policy);
    if (policy.max_attempts !== undefined) requireThat(metadata.attempts < integer(policy.max_attempts), 'RETRY_LIMIT_REACHED');
    if (metadata.acknowledgment?.next_retry_at) {
      requireThat(Date.parse(timestamp(metadata.acknowledgment.next_retry_at)) <= Date.parse(now), 'RETRY_NOT_DUE');
    }
    task.fence = context.session_fence;
    metadata.attempts = next(metadata.attempts);
    const acknowledgment = this.#call('deliverOwnerTask', {
      campaign_id: context.campaign_id, timeline_id: context.timeline_id, task,
      idempotency_key: key(context.campaign_id, context.timeline_id, task.idempotency_key),
      payload: this.#value(state, task.payload_ref), metadata
    });
    task.status = acknowledgment.acknowledged === true ? 'acknowledged' : 'pending';
    metadata.acknowledgment = { ...acknowledgment, processed_at: now, next_retry_at: null };
    if (!acknowledgment.acknowledged && policy.backoff_real_milliseconds !== undefined) {
      const delay = integer(policy.backoff_real_milliseconds);
      metadata.acknowledgment.next_retry_at = timestamp(new Date(Date.parse(now) + delay).toISOString());
    }
    // Transport acknowledgment does not complete the opaque owner's workflow.
    return { ...this.#append(state, context, frame, {}, commandKey), task_id: task.id, acknowledgment };
  }
  #generation(state, context, args, commandKey, accepting) {
    const frame = this.#frame(state, context.timeline_id);
    if (!accepting) {
      const task = copy(args.task); record('generation_task', task);
      requireThat(!frame.generation_task[task.task_id], 'GENERATION_TASK_EXISTS');
      requireThat(task.fencing_token === context.session_fence, 'STALE_FENCE');
      requireThat(task.status === 'requested' && task.accepted_output_refs.length === 0 && task.staged_candidate_ref === null, 'INVALID_GENERATION_STAGE');
      task.source_cut = { timeline_id: context.timeline_id, sequence: next(state.timeline[context.timeline_id].head_sequence) };
      frame.generation_task[task.task_id] = task;
      return { ...this.#append(state, context, frame, {}, commandKey), task_id: task.task_id, status: 'requested' };
    }
    const task = frame.generation_task[id(args.task_id)];
    requireThat(task, 'GENERATION_TASK_UNAVAILABLE');
    const ledger = frame.creation_ledger[id(args.request_key)];
    if (ledger) return { entity_id: ledger.entity_id, accepted_content_ref: ledger.accepted_content_ref, duplicate: true };
    requireThat(['requested', 'candidate_returned'].includes(task.status), 'GENERATION_ALREADY_ACCEPTED');
    requireThat(!Object.values(frame.creation_ledger).some(c => c.entity_id === args.entity_id), 'DUPLICATE_CREATION_ID');
    requireThat(task.fencing_token === context.session_fence, 'STALE_FENCE');
    requireThat(equal(task.source_cut, head(state.timeline[context.timeline_id])), 'STALE_GENERATION_CUT');
    this.#addArtifacts(state, args.artifacts);
    this.#value(state, args.accepted_content_ref);
    requireThat(args.owner_frame !== undefined, 'OWNER_RESULT_REQUIRED');
    const proposed = copy(args.owner_frame);
    this.#validateFrame(state, context.timeline_id, proposed);
    requireThat(equal(proposed.generation_task, frame.generation_task) && equal(proposed.creation_ledger, frame.creation_ledger), 'CREATION_LEDGER_REWRITE');
    const accepted = proposed.generation_task[task.task_id];
    accepted.status = 'accepted'; accepted.validation_status = 'approved';
    accepted.staged_candidate_ref = args.accepted_content_ref; accepted.accepted_output_refs = [args.accepted_content_ref];
    proposed.creation_ledger[args.request_key] = {
      request_key: args.request_key, timeline_scope: { campaign_id: context.campaign_id, timeline_id: context.timeline_id },
      entity_id: id(args.entity_id), accepted_content_ref: args.accepted_content_ref, status: 'committed'
    };
    return { ...this.#append(state, context, proposed, {}, commandKey), entity_id: args.entity_id };
  }
  #processGeneration(state, context, args, commandKey, resumeOnly) {
    const frame = this.#frame(state, context.timeline_id);
    const task = frame.generation_task[id(args.task_id)];
    requireThat(task && ['requested', 'candidate_returned'].includes(task.status), 'GENERATION_TASK_UNAVAILABLE');
    if (!resumeOnly) {
      requireThat(task.fencing_token === context.session_fence, 'STALE_FENCE');
      requireThat(equal(task.source_cut, head(state.timeline[context.timeline_id])), 'STALE_GENERATION_CUT');
      const known = this.#known(state, context, context.timeline_id, frame);
      const result = this.#call('requestAI', { task, known_view: known, constraints: task.model_content_constraints });
      if (result.available !== true) return { task_id: task.task_id, status: 'pending', available: false };
      requireThat(result.candidate !== null && result.candidate !== undefined, 'CANDIDATE_MISSING');
      task.staged_candidate_ref = this.#put(state, result.candidate, 'generation_candidate');
      task.status = 'candidate_returned'; task.validation_status = 'pending';
    }
    task.fencing_token = context.session_fence;
    task.source_cut = { timeline_id: context.timeline_id, sequence: next(state.timeline[context.timeline_id].head_sequence) };
    return { ...this.#append(state, context, frame, {}, commandKey), task_id: task.task_id, status: task.status };
  }
  #narrate(state, context, args) {
    const checkpoint = state.checkpoint[id(args.checkpoint_id)];
    const frame = this.#checkpointFrame(state, args.checkpoint_id);
    requireThat(checkpoint.timeline_id === context.timeline_id, 'SCOPE_MISMATCH');
    const known = this.#known(state, context, context.timeline_id, frame);
    const generated = this.#call('requestAI', {
      task_id: id(args.task_id), source_cut: readCut(checkpoint.cut_ref),
      timeline_id: context.timeline_id, session_fence: context.session_fence, known_view: known
    });
    const result = { source_cut: readCut(checkpoint.cut_ref), known_view: known,
      presentation: generated.available === true ? generated.candidate : null, status: generated.available === true ? 'generated' : 'deterministic_fallback' };
    state.noncanonical_optional_state[context.timeline_id].narration_and_summaries[args.task_id] = result;
    return result;
  }

  #mutate(state, command, context, args, now, commandKey, operationKey) {
    switch (command) {
      case 'CreateCampaign': return this.#create(state, context, args, now);
      case 'RegisterParticipant': {
        this.#addArtifacts(state, args.artifacts);
        const frame = this.#frame(state, context.timeline_id);
        const participant = record('owner_state_registry', copy(args.participant));
        requireThat(!frame.owner_state_registry[participant.family], 'PARTICIPANT_EXISTS');
        frame.owner_state_registry[participant.family] = participant;
        return this.#append(state, context, frame, {}, commandKey);
      }
      case 'CommitBatch': {
        this.#addArtifacts(state, args.artifacts);
        const previous = this.#frame(state, context.timeline_id);
        const frame = copy(args.frame);
        // Creation acceptance is exclusive to the fenced generation ledger path.
        requireThat(equal(previous.creation_ledger, frame.creation_ledger), 'CREATION_LEDGER_REWRITE');
        requireThat(equal(previous.generation_task, frame.generation_task), 'GENERATION_TASK_REWRITE');
        const result = this.#append(state, context, frame, args.event ?? {}, commandKey);
        if (args.turn_anchor) this.#anchor(state, context, args.turn_anchor);
        return result;
      }
      case 'RequestCheckpoint': return this.#capture(state, context, args, now, operationKey);
      case 'PublishCheckpoint': {
        requireThat(state.checkpoint[args.checkpoint_id]?.timeline_id === context.timeline_id, 'SCOPE_MISMATCH');
        return this.#publish(state, args.checkpoint_id);
      }
      case 'Autosave': return this.#autosave(state, context, args, now, operationKey);
      case 'CreateTurnAnchor': return this.#anchor(state, context, args);
      case 'ResumeCheckpointAsBranch':
      case 'CreateTimelineFromAnchor': return this.#fork(state, context, args, now);
      case 'ContinueTimeline':
      case 'SwitchTimeline': {
        const timelineID = args.timeline_id ?? context.timeline_id;
        requireThat(state.timeline[timelineID]?.campaign_id === context.campaign_id, 'SCOPE_MISMATCH');
        const frame = this.#frameAt(state, head(state.timeline[timelineID]));
        return this.#activate(state, context, timelineID, frame);
      }
      case 'RenameSaveEntry':
      case 'DeleteSaveEntry': {
        const entry = state.save_entry[id(args.save_entry_id)];
        requireThat(entry && state.checkpoint[entry.checkpoint_id].timeline_id === context.timeline_id, 'SAVE_ENTRY_UNAVAILABLE');
        if (command === 'RenameSaveEntry') { requireThat(typeof args.label === 'string'); entry.label = args.label; }
        else {
          requireThat(!['fork_root', 'recovery'].includes(entry.retention_class), 'PROTECTED_RECOVERY_REFERENCE');
          delete state.save_entry[entry.id];
        }
        return { save_entry_id: entry.id, status: command === 'RenameSaveEntry' ? 'renamed' : 'catalog_reference_removed' };
      }
      case 'RenameTimeline': {
        requireThat(typeof args.label === 'string'); state.timeline_metadata[context.timeline_id].label = args.label;
        return { timeline_id: context.timeline_id, label: args.label };
      }
      case 'DeliverTask': return this.#deliverTask(state, context, args, commandKey, now);
      case 'RequestGeneration': return this.#generation(state, context, args, commandKey, false);
      case 'AcceptGeneration': return this.#generation(state, context, args, commandKey, true);
      case 'ProcessGeneration': return this.#processGeneration(state, context, args, commandKey, false);
      case 'ResumeGeneration': return this.#processGeneration(state, context, args, commandKey, true);
      case 'RegenerateNarration': return this.#narrate(state, context, args);
      case 'SetDraft': {
        requireThat(typeof args.text === 'string');
        state.noncanonical_optional_state[context.timeline_id].unsubmitted_player_drafts[context.authority.actor_id] = args.text;
        return { status: 'draft_stored', submitted: false };
      }
      case 'ValidateImport': return this.#validateImport(state, context, args, operationKey);
      case 'ActivateImportedFamily': return this.#import(state, context, args, now);
      case 'MigrateCheckpoint': return this.#migrate(state, context, args, now, operationKey);
      case 'CompactHistory': return this.#compact(state, context, args, now, operationKey);
      case 'RecoverTimeline': return this.#recover(state, context, args, now);
      case 'ResumeStorage': {
        requireThat(this.#call('requestStorageRecovery', { campaign_id: context.campaign_id }).available === true, 'STORAGE_UNAVAILABLE');
        state.durability_reporting[context.timeline_id].checkpoint_availability = 'mock_available';
        return { status: 'mock_available' };
      }
      case 'AcquireWriter': {
        const writer = state.writer_coordination[context.campaign_id];
        const expired = writer.writer_lease.expires_at !== undefined && Date.parse(writer.writer_lease.expires_at) <= Date.parse(now);
        requireThat(writer.writer_owner === context.authority.session_id || expired, 'WRITER_LEASE_ACTIVE');
        requireThat(integer(args.lease_real_milliseconds) > 0, 'LEASE_DURATION_REQUIRED');
        writer.writer_owner = context.authority.session_id;
        writer.fencing_token = next(writer.fencing_token);
        writer.writer_lease = { status: 'mock_active', expires_at: timestamp(new Date(Date.parse(now) + args.lease_real_milliseconds).toISOString()) };
        return { session_fence: writer.fencing_token, head_revision: state.timeline[context.timeline_id].head_revision };
      }
      case 'Synchronize': {
        const packet = this.#export(state, context, { checkpoint_id: args.checkpoint_id, mode: 'selected_timeline_full', acknowledge_hidden_state: true });
        const receipt = this.#call('requestSync', { package: packet.package, expected_remote_revision: args.expected_remote_revision ?? null });
        const report = state.durability_reporting[context.timeline_id];
        report.sync_status = receipt.conflict ? 'conflict_separate_branch_required' : 'sync_pending';
        // A mock acknowledgment is never a real synchronized copy.
        return { status: report.sync_status, receipt };
      }
      case 'Backup': {
        const packet = this.#export(state, context, { checkpoint_id: args.checkpoint_id, mode: 'selected_timeline_full', acknowledge_hidden_state: true });
        const receipt = this.#call('requestBackup', { package: packet.package, destination: args.destination ?? null });
        state.durability_reporting[context.timeline_id].backup_status = 'not_backed_up';
        return { status: 'not_backed_up', receipt };
      }
      default: throw new ContractError('UNKNOWN_COMMAND');
    }
  }
  #anchor(state, context, args) {
    const anchorID = id(args.anchor_id); const anchor = copy(args.anchor);
    record('turn_anchor', anchor);
    const before = cut(anchor.supported_before_cut); const after = cut(anchor.supported_after_cut);
    requireThat(before.timeline_id === context.timeline_id && after.timeline_id === context.timeline_id && before.sequence <= after.sequence, 'INVALID_ANCHOR');
    this.#frameAt(state, before); this.#frameAt(state, after); this.#value(state, anchor.known_view_ref);
    const anchorKey = key(context.campaign_id, context.timeline_id, anchorID);
    requireThat(!state.turn_anchor[anchorKey] || equal(state.turn_anchor[anchorKey], anchor), 'IMMUTABLE_ANCHOR_CONFLICT');
    state.turn_anchor[anchorKey] = anchor;
    return { anchor_id: anchorID, before_cut: before, after_cut: after };
  }
  #query(state, command, context, args) {
    const campaignID = id(context.campaign_id);
    requireThat(state.campaign[campaignID], 'CAMPAIGN_UNAVAILABLE');
    const scopedTimeline = timelineID => {
      const timeline = this.#timeline(state, timelineID);
      requireThat(timeline.campaign_id === campaignID, 'SCOPE_MISMATCH'); return timeline;
    };
    switch (command) {
      case 'SerializeState': return { state: copy(state) };
      case 'Audit': this.#audit(state, campaignID); return { valid: true };
      case 'ExportTimeline': return this.#export(state, context, args);
      case 'GetStatus': {
        scopedTimeline(context.timeline_id);
        return { durability: copy(state.durability_reporting[context.timeline_id]),
          head: head(state.timeline[context.timeline_id]), head_revision: state.timeline[context.timeline_id].head_revision,
          writer_coordination: copy(state.writer_coordination[campaignID]) };
      }
      case 'GetTimelineLineage': {
        const timeline = scopedTimeline(args.timeline_id ?? context.timeline_id);
        return { timeline_id: timeline.id, ancestry: this.#lineage(state, timeline.id) };
      }
      case 'ListSaveEntries': return { entries: Object.values(state.save_entry).filter(entry =>
        state.timeline[state.checkpoint[entry.checkpoint_id].timeline_id].campaign_id === campaignID).map(entry => {
        const checkpoint = state.checkpoint[entry.checkpoint_id];
        return { ...copy(entry), timeline_id: checkpoint.timeline_id, canonical_time: copy(checkpoint.canonical_time),
          created_at: checkpoint.created_at, cut: readCut(checkpoint.cut_ref), status: checkpoint.status };
      }) };
      case 'GetCheckpointCompatibility':
      case 'InspectCheckpoint': {
        const checkpoint = state.checkpoint[id(args.checkpoint_id)];
        requireThat(checkpoint, 'CHECKPOINT_UNAVAILABLE'); scopedTimeline(checkpoint.timeline_id);
        const frame = this.#checkpointFrame(state, checkpoint.id);
        if (command === 'GetCheckpointCompatibility') return { checkpoint_id: checkpoint.id, compatible: true };
        return { checkpoint_id: checkpoint.id, cut: readCut(checkpoint.cut_ref), read_only: true,
          known_view: this.#known(state, context, checkpoint.timeline_id, frame) };
      }
      case 'GetKnownHistoryAtCut': {
        const at = cut(args.cut); scopedTimeline(at.timeline_id);
        const frame = this.#frameAt(state, at);
        return { cut: at, known_view: this.#known(state, context, at.timeline_id, frame) };
      }
      default: throw new ContractError('UNKNOWN_QUERY');
    }
  }

  #export(state, context, args) {
    const mode = args.mode ?? 'selected_timeline_full';
    requireThat(MODES.has(mode), 'INVALID_EXPORT_MODE');
    const checkpointIDs = mode === 'timeline_family' ? copy(args.checkpoint_ids) : [args.checkpoint_id];
    requireThat(Array.isArray(checkpointIDs) && checkpointIDs.length > 0, 'CHECKPOINT_REQUIRED');
    for (const checkpointID of checkpointIDs) {
      this.#checkpointFrame(state, checkpointID);
      requireThat(state.timeline[state.checkpoint[checkpointID].timeline_id].campaign_id === context.campaign_id, 'SCOPE_MISMATCH');
    }
    if (mode === 'redacted_story_history') {
      const views = checkpointIDs.map(checkpointID => {
        const checkpoint = state.checkpoint[checkpointID];
        return { cut: readCut(checkpoint.cut_ref), known_view: this.#known(state, context, checkpoint.timeline_id, this.#checkpointFrame(state, checkpointID)) };
      });
      return { restorable: false, package: { format: FORMAT, mode, restorable: false,
        omitted_families: [...state.campaign[context.campaign_id].content_policy.required_state_families], views } };
    }
    requireThat(args.acknowledge_hidden_state === true, 'FULL_EXPORT_SCOPE_REQUIRED');
    if (mode === 'snapshot_only_full_root') {
      requireThat(args.root_lineage_policy === 'retain_required_history', 'ROOT_LINEAGE_POLICY_REQUIRED');
    }
    // A migrated fork root can depend on a validated representation at the same
    // historical cut. Carry that checkpoint and its migration proof as ancestry.
    for (let i = 0; i < checkpointIDs.length; i++) {
      const ancestry = this.#lineage(state, state.checkpoint[checkpointIDs[i]].timeline_id);
      for (const migration of Object.values(state.migration)) {
        const checkpoint = state.checkpoint[migration.target_ref];
        if (checkpoint?.status === 'valid' && ancestry.some(a => equal(a.fork_cut, readCut(checkpoint.cut_ref))) &&
          !checkpointIDs.includes(checkpoint.id)) checkpointIDs.push(checkpoint.id);
      }
    }
    const exported = new PersistenceState().toJSON();
    exported.versioned_baseline_policy = copy(state.versioned_baseline_policy);
    exported.campaign[context.campaign_id] = copy(state.campaign[context.campaign_id]);
    const limits = new Map(); const roots = []; const eventKeys = new Set();
    for (const checkpointID of checkpointIDs) {
      const checkpoint = state.checkpoint[checkpointID];
      const at = readCut(checkpoint.cut_ref);
      for (const selected of [...this.#lineage(state, at.timeline_id).map(a => a.fork_cut), at]) {
        limits.set(selected.timeline_id, Math.max(limits.get(selected.timeline_id) ?? 0, selected.sequence));
      }
      exported.checkpoint[checkpointID] = copy(checkpoint);
      exported.manifest[checkpointID] = copy(state.manifest[checkpointID]);
      roots.push(checkpoint.manifest_ref);
      for (const entry of Object.values(state.save_entry)) {
        if (entry.checkpoint_id === checkpointID) exported.save_entry[entry.id] = copy(entry);
      }
    }
    for (const [timelineID, sequence] of limits) {
      const at = { timeline_id: timelineID, sequence };
      exported.timeline[timelineID] = { ...copy(state.timeline[timelineID]), head_sequence: sequence, head_revision: sequence };
      exported.timeline_metadata[timelineID] = copy(state.timeline_metadata[timelineID]);
      exported.canonical_event[timelineID] = copy(state.canonical_event[timelineID].slice(0, sequence));
      for (const event of exported.canonical_event[timelineID]) { roots.push(event.resolved_payload_ref); eventKeys.add(event.command_key); }
      roots.push(`root:${timelineID}`);
      this.#installFrame(exported, timelineID, this.#frameAt(state, at));
      exported.durability_reporting[timelineID] = emptyDurability();
      exported.portability_and_maintenance[timelineID] = emptyPortability();
      exported.portability_and_maintenance[timelineID].valid_journal_prefix = at;
      exported.noncanonical_optional_state[timelineID] = emptyOptional();
    }
    for (const [anchorKey, anchor] of Object.entries(state.turn_anchor)) {
      const c = anchor.supported_after_cut;
      if (limits.has(c.timeline_id) && c.sequence <= limits.get(c.timeline_id)) {
        exported.turn_anchor[anchorKey] = copy(anchor); roots.push(anchor.known_view_ref);
      }
    }
    for (const commandKey of eventKeys) {
      const ledger = state.command_result_ledger[commandKey];
      if (!ledger) continue;
      exported.command_result_ledger[commandKey] = copy(ledger); roots.push(ledger.committed_result_ref);
      const ctx = state.command_context[commandKey];
      if (ctx) {
        exported.command_context[commandKey] = copy(ctx);
        const opKey = key(ctx.campaign_id, ctx.timeline_id, ctx.operation_id);
        exported.operation_tracking[opKey] = copy(state.operation_tracking[opKey]);
      }
    }
    // Preserve migration provenance and its immutable source package through references.
    for (const [migrationID, migration] of Object.entries(state.migration)) {
      if (checkpointIDs.includes(migration.target_ref)) {
        exported.migration[migrationID] = copy(migration);
        for (const ref of [migration.source_ref, migration.versions_ref, migration.validation_ref]) {
          if (state.artifact[ref]) roots.push(ref);
        }
      }
    }
    for (const ref of this.#reachable(state, roots)) exported.artifact[ref] = copy(state.artifact[ref]);
    const scope = { campaign_id: context.campaign_id, checkpoints: [...checkpointIDs],
      cuts: [...limits].map(([timeline_id, sequence]) => ({ timeline_id, sequence })),
      root_lineage_policy: mode === 'snapshot_only_full_root' ? 'retain_required_history' : 'ancestry_included' };
    const packet = { format: FORMAT, mode, restorable: true, declared_scope: scope, state: exported, watcher_content: [] };
    this.#audit(exported, context.campaign_id);
    return { restorable: true, package: { ...packet, integrity: hash(packet) } };
  }
  #validatePackage(packet) {
    canonical(packet);
    requireThat(packet?.restorable === true && packet.mode !== 'redacted_story_history', 'NONRESTORABLE_PACKAGE');
    exact(packet, ['format', 'mode', 'restorable', 'declared_scope', 'state', 'watcher_content', 'integrity']);
    requireThat(packet.format === FORMAT && MODES.has(packet.mode), 'UNSUPPORTED_FORMAT');
    const { integrity, ...unsigned } = packet;
    requireThat(hash(unsigned) === integrity, 'PACKAGE_DIGEST_MISMATCH');
    const staged = new PersistenceState(packet.state).toJSON();
    this.#validateStructure(staged);
    exact(packet.declared_scope, ['campaign_id', 'checkpoints', 'cuts', 'root_lineage_policy']);
    requireThat(Array.isArray(packet.declared_scope.checkpoints) && packet.declared_scope.checkpoints.length > 0, 'CHECKPOINT_REQUIRED');
    requireThat(Array.isArray(packet.watcher_content), 'INVALID_DECLARATIVE_CONTENT');
    for (const declaration of packet.watcher_content) {
      exact(declaration, ['type', 'schema_version', 'payload']);
      requireThat(declaration.type === 'declarative', 'EXECUTABLE_CONTENT_FORBIDDEN');
      const validation = this.#call('requestSystem24Validation', declaration);
      requireThat(validation.valid === true && validation.declarative_only === true, 'WATCHER_VALIDATION_FAILED');
    }
    requireThat(Object.keys(staged.campaign).length === 1 && staged.campaign[packet.declared_scope.campaign_id], 'EXPORT_SCOPE_MISMATCH');
    requireThat(equal(Object.keys(staged.checkpoint).sort(), [...packet.declared_scope.checkpoints].sort()), 'EXPORT_SCOPE_MISMATCH');
    requireThat(equal(Object.values(staged.timeline).map(head).sort((a, b) => a.timeline_id.localeCompare(b.timeline_id)),
      [...packet.declared_scope.cuts].sort((a, b) => a.timeline_id.localeCompare(b.timeline_id))), 'EXPORT_SCOPE_MISMATCH');
    this.#audit(staged, packet.declared_scope.campaign_id);
    return staged;
  }
  #validateImport(state, context, args, operationKey) {
    const staged = this.#validatePackage(args.package);
    const sourceRef = this.#put(state, args.package, 'staged_import');
    const tracking = state.operation_tracking[operationKey];
    tracking.status = 'validated';
    Object.assign(tracking.validation_results, { package_ref: sourceRef, package_digest: hash(args.package),
      source_campaign_id: Object.keys(staged.campaign)[0], activated: false });
    return { validated_operation: operationKey, status: 'validated', source_ref: sourceRef };
  }
  #import(state, context, args, now) {
    const validation = state.operation_tracking[id(args.validated_operation)];
    requireThat(validation?.status === 'validated', 'IMPORT_NOT_VALIDATED');
    const originScope = JSON.parse(args.validated_operation);
    requireThat(originScope[0] === context.campaign_id, 'SCOPE_MISMATCH');
    if (validation.validation_results.activated) return copy(validation.validation_results.activation_result);
    const packet = this.#value(state, validation.validation_results.package_ref);
    const source = this.#validatePackage(packet);
    const oldCampaignID = packet.declared_scope.campaign_id;
    const newCampaignID = id(args.new_campaign_id ?? `import:${hash(args.validated_operation).slice(7)}`);
    requireThat(!state.campaign[newCampaignID], 'IMPORT_CAMPAIGN_EXISTS');
    const namespace = this.#call('validateNamespace', { source_campaign_id: oldCampaignID, target_campaign_id: newCampaignID,
      strategy: 'campaign_scoped_ids', opaque_payloads_unchanged: true });
    requireThat(namespace.valid === true && namespace.strategy === 'campaign_scoped_ids', 'NAMESPACE_ADAPTER_REQUIRED');
    const timelineMap = Object.fromEntries(Object.keys(source.timeline).map(old => [old, `timeline:${hash([newCampaignID, old]).slice(7)}`]));
    const checkpointMap = Object.fromEntries(Object.keys(source.checkpoint).map(old => [old, `checkpoint:${hash([newCampaignID, old]).slice(7)}`]));
    const mappedCut = old => ({ timeline_id: timelineMap[old.timeline_id], sequence: old.sequence });
    const mappedKey = old => {
      const parts = JSON.parse(old);
      return key(newCampaignID, timelineMap[parts[1]], parts[2]);
    };
    const mapFrame = (oldFrame, oldTimelineID) => {
      const mapped = this.#rebindFrame(oldFrame, newCampaignID, timelineMap[oldTimelineID], 1,
        { timeline_id: timelineMap[oldTimelineID], sequence: 0 });
      for (const [taskID, task] of Object.entries(oldFrame.generation_task)) {
        mapped.generation_task[taskID].source_cut = mappedCut(task.source_cut);
      }
      return mapped;
    };
    state.campaign[newCampaignID] = { ...copy(source.campaign[oldCampaignID]), id: newCampaignID };
    // Opaque owner artifacts remain byte-identical. Only System 25 reference envelopes
    // are reconstructed. Unresolvable custom artifact collisions fail closed.
    const structural = new Set(['root_frame', 'resolved_frame', 'checkpoint_state', 'manifest', 'event_segment', 'operation_result']);
    for (const artifact of Object.values(source.artifact)) {
      if (!structural.has(artifact.required_kind)) this.#addArtifact(state, artifact);
    }
    for (const [oldID, oldTimeline] of Object.entries(source.timeline)) {
      const timelineID = timelineMap[oldID];
      requireThat(!state.timeline[timelineID], 'IMPORT_TIMELINE_EXISTS');
      state.timeline[timelineID] = { ...copy(oldTimeline), id: timelineID, campaign_id: newCampaignID,
        parent_id: oldTimeline.parent_id === null ? null : timelineMap[oldTimeline.parent_id],
        fork_cut_ref: oldTimeline.fork_cut_ref === null ? null : cutRef(mappedCut(readCut(oldTimeline.fork_cut_ref))) };
      state.timeline_metadata[timelineID] = copy(source.timeline_metadata[oldID]);
      state.canonical_event[timelineID] = [];
      state.durability_reporting[timelineID] = emptyDurability();
      state.portability_and_maintenance[timelineID] = emptyPortability();
      state.portability_and_maintenance[timelineID].namespace_mapping_and_provenance = {
        source_package_ref: validation.validation_results.package_ref, campaign: { source: oldCampaignID, target: newCampaignID },
        timelines: timelineMap, checkpoints: checkpointMap, entity_identity_policy: 'campaign_scoped_ids'
      };
      state.noncanonical_optional_state[timelineID] = emptyOptional();
      const root = mapFrame(this.#value(source, `root:${oldID}`), oldID);
      this.#put(state, root, 'root_frame', this.#frameRefs(root), 'restricted', `root:${timelineID}`);
      for (const event of source.canonical_event[oldID]) {
        const frame = mapFrame(this.#value(source, event.resolved_payload_ref), oldID);
        state.canonical_event[timelineID].push({ ...copy(event), timeline_id: timelineID, command_key: mappedKey(event.command_key),
          resolved_payload_ref: this.#put(state, frame, 'resolved_frame', this.#frameRefs(frame)) });
      }
      this.#installFrame(state, timelineID, mapFrame(this.#frame(source, oldID), oldID));
    }
    for (const [oldKey, ledger] of Object.entries(source.command_result_ledger)) {
      const commandKey = mappedKey(oldKey);
      const oldResult = copy(this.#value(source, ledger.committed_result_ref));
      for (const field of ['cut', 'captured_cut', 'fork_cut']) if (oldResult[field]) oldResult[field] = mappedCut(oldResult[field]);
      if (oldResult.timeline_id) oldResult.timeline_id = timelineMap[oldResult.timeline_id];
      if (oldResult.campaign_id) oldResult.campaign_id = newCampaignID;
      state.command_result_ledger[commandKey] = { scoped_command_key: commandKey,
        committed_result_ref: this.#put(state, oldResult, 'operation_result') };
      if (source.command_context[oldKey]) {
        const ctx = source.command_context[oldKey];
        state.command_context[commandKey] = { ...copy(ctx), campaign_id: newCampaignID, timeline_id: timelineMap[ctx.timeline_id] };
        const oldOp = key(oldCampaignID, ctx.timeline_id, ctx.operation_id);
        const tracking = copy(source.operation_tracking[oldOp]);
        if (tracking.requested_cut) tracking.requested_cut = mappedCut(tracking.requested_cut);
        if (tracking.captured_cut) tracking.captured_cut = mappedCut(tracking.captured_cut);
        state.operation_tracking[key(newCampaignID, timelineMap[ctx.timeline_id], ctx.operation_id)] = tracking;
      }
    }
    state.writer_coordination[newCampaignID] = {
      active_timeline_id: timelineMap[source.checkpoint[packet.declared_scope.checkpoints[0]].timeline_id],
      writer_owner: context.authority.session_id, writer_lease: { status: 'mock_active' }, fencing_token: 0, session_mode: 'writable'
    };
    for (const [oldMigrationID, migration] of Object.entries(source.migration)) {
      const migrationID = `migration:${hash([newCampaignID, oldMigrationID]).slice(7)}`;
      requireThat(checkpointMap[migration.target_ref], 'MIGRATION_TARGET_UNAVAILABLE');
      state.migration[migrationID] = { ...copy(migration), id: migrationID, target_ref: checkpointMap[migration.target_ref] };
      const targetTimelineID = timelineMap[source.checkpoint[migration.target_ref].timeline_id];
      state.portability_and_maintenance[targetTimelineID].migration_and_repair_provenance.push(migrationID);
    }
    for (const oldCheckpointID of packet.declared_scope.checkpoints) {
      const oldCheckpoint = source.checkpoint[oldCheckpointID];
      const checkpointID = checkpointMap[oldCheckpointID];
      const timelineID = timelineMap[oldCheckpoint.timeline_id];
      const importOperation = key(newCampaignID, timelineID, `import:${checkpointID}`);
      state.operation_tracking[importOperation] = { operation_id: `import:${checkpointID}`, requested_cut: null, captured_cut: null,
        status: 'building', validation_results: {}, failure_diagnosis: null };
      const importContext = { ...context, campaign_id: newCampaignID, timeline_id: timelineID };
      this.#capture(state, importContext, { checkpoint_id: checkpointID, desired_cut: mappedCut(readCut(oldCheckpoint.cut_ref)),
        save_kind: 'manual', label: '', publish: false }, oldCheckpoint.created_at, importOperation);
      const oldFrame = this.#checkpointFrame(source, oldCheckpointID);
      this.#replaceCheckpointFrame(state, checkpointID, mapFrame(oldFrame, oldCheckpoint.timeline_id));
      const publication = this.#publish(state, checkpointID);
      requireThat(publication.status === 'valid', 'IMPORTED_CHECKPOINT_INVALID');
      delete state.save_entry[`save:${checkpointID}`];
      for (const entry of Object.values(source.save_entry).filter(e => e.checkpoint_id === oldCheckpointID)) {
        const entryID = `save:${hash([newCampaignID, entry.id]).slice(7)}`;
        state.save_entry[entryID] = { ...copy(entry), id: entryID, checkpoint_id: checkpointID };
      }
    }
    for (const [oldKey, anchor] of Object.entries(source.turn_anchor)) {
      const parts = JSON.parse(oldKey);
      state.turn_anchor[key(newCampaignID, timelineMap[parts[1]], parts[2])] = { ...copy(anchor),
        supported_before_cut: mappedCut(anchor.supported_before_cut), supported_after_cut: mappedCut(anchor.supported_after_cut) };
    }
    this.#audit(state, newCampaignID);
    const selectedID = checkpointMap[args.checkpoint_id ?? packet.declared_scope.checkpoints[0]];
    requireThat(selectedID, 'IMPORTED_CHECKPOINT_UNAVAILABLE');
    const selected = state.checkpoint[selectedID];
    const selectedCut = readCut(selected.cut_ref);
    const selectedFrame = this.#checkpointFrame(state, selectedID);
    const currentFrame = this.#frameAt(state, head(state.timeline[selected.timeline_id]));
    // A selected historical or migrated representation resumes as a child; it must
    // never silently activate the selected timeline's different latest state.
    let activation;
    if (!equal(selectedCut, head(state.timeline[selected.timeline_id])) || !equal(selectedFrame, currentFrame)) {
      activation = this.#fork(state, { ...context, campaign_id: newCampaignID }, {
        checkpoint_id: selectedID, new_timeline_id: `timeline:${hash([newCampaignID, 'resume', selectedID]).slice(7)}`,
        reason: 'imported_checkpoint_resume'
      }, now);
    } else activation = this.#activate(state, context, selected.timeline_id, selectedFrame);
    const result = { ...activation,
      campaign_id: newCampaignID, namespace_mapping: { timelines: timelineMap, checkpoints: checkpointMap },
      checkpoint_id: selectedID, source_retained: true };
    validation.validation_results.activated = true; validation.validation_results.activation_result = result;
    return result;
  }
  #replaceCheckpointFrame(state, checkpointID, frame) {
    const checkpoint = state.checkpoint[checkpointID];
    requireThat(checkpoint.status === 'building', 'IMMUTABLE_CHECKPOINT');
    const manifest = state.manifest[checkpointID];
    requireThat(equal(frame.preserved_scheduler_state.canonical_clock, manifest.canonical_time), 'TIME_MISMATCH');
    const snapshotRef = this.#put(state, frame, 'checkpoint_state', this.#frameRefs(frame));
    const roots = [snapshotRef, ...manifest.event_segment_refs, ...manifest.ancestry_and_fork_cuts.map(a => `root:${a.parent_id}`), `root:${checkpoint.timeline_id}`];
    const reachable = this.#reachable(state, roots);
    manifest.artifact_refs_and_digests = reachable.map(ref => ({ ref, digest: state.artifact[ref].content_digest, required_kind: state.artifact[ref].required_kind }));
    manifest.schema_versions = Object.fromEntries(Object.entries(frame.owner_state_registry).map(([f, o]) => [f, o.schema_version]));
    manifest.required_state_families = Object.values(frame.owner_state_registry).filter(o => o.required).map(o => o.family).sort();
    checkpoint.manifest_ref = this.#put(state, manifest, 'manifest', reachable);
    checkpoint.digest_ref = state.artifact[checkpoint.manifest_ref].content_digest;
  }
  #migrate(state, context, args, now, operationKey) {
    const sourceFrame = this.#checkpointFrame(state, args.checkpoint_id);
    requireThat(state.checkpoint[args.checkpoint_id].timeline_id === context.timeline_id, 'SCOPE_MISMATCH');
    this.#addArtifacts(state, args.artifacts);
    const targetFrame = copy(args.migrated_frame);
    this.#validateFrame(state, context.timeline_id, targetFrame, true);
    const validation = this.#call('validateMigration', { source: sourceFrame, target: targetFrame,
      source_versions: state.manifest[args.checkpoint_id].schema_versions, target_versions: args.target_versions,
      preconditions: args.preconditions ?? {}, policy: args.compatibility_policy ?? {} });
    requireThat(validation.valid === true && validation.equivalent === true && validation.owner_approved === true, 'MIGRATION_REJECTED');
    // Only owner representation/version may differ in a schema migration. Active
    // commitments, allocations, queues, creation ledgers and canonical time are exact.
    for (const field of FRAME_FIELDS.filter(f => f !== 'owner_state_registry')) requireThat(equal(sourceFrame[field], targetFrame[field]), 'MIGRATION_CHANGES_COMMITMENTS');
    const targetVersions = Object.fromEntries(Object.entries(targetFrame.owner_state_registry).map(([f, o]) => [f, o.schema_version]));
    requireThat(equal(args.target_versions, targetVersions), 'MIGRATION_VERSION_MISMATCH');
    const captured = this.#capture(state, context, { desired_cut: readCut(state.checkpoint[args.checkpoint_id].cut_ref),
      checkpoint_id: args.new_checkpoint_id, label: args.label ?? '', save_kind: 'manual', publish: false }, now, operationKey);
    this.#replaceCheckpointFrame(state, captured.checkpoint_id, targetFrame);
    const sourcePackage = this.#export(state, context, { checkpoint_id: args.checkpoint_id, mode: 'selected_timeline_full', acknowledge_hidden_state: true }).package;
    const migrationID = id(args.migration_id ?? `migration:${hash(operationKey).slice(7)}`);
    requireThat(!state.migration[migrationID], 'MIGRATION_EXISTS');
    state.migration[migrationID] = { id: migrationID, source_ref: this.#put(state, sourcePackage, 'migration_source'),
      target_ref: captured.checkpoint_id, versions_ref: this.#put(state, { source: state.manifest[args.checkpoint_id].schema_versions, target: targetVersions }, 'migration_versions'),
      validation_ref: this.#put(state, validation, 'migration_validation'), status: 'valid' };
    const result = this.#publish(state, captured.checkpoint_id);
    requireThat(result.status === 'valid', 'MIGRATION_VALIDATION_FAILED');
    state.portability_and_maintenance[context.timeline_id].migration_and_repair_provenance.push(migrationID);
    return { ...result, migration_id: migrationID };
  }
  #compact(state, context, args, now, operationKey) {
    const recovery = this.#capture(state, context, { save_kind: 'recovery', retention_class: 'recovery', label: '', publish: true }, now, operationKey);
    requireThat(recovery.status === 'valid', 'RECOVERY_ANCHOR_REQUIRED');
    const roots = [];
    for (const timeline of Object.values(state.timeline)) {
      roots.push(`root:${timeline.id}`, ...state.canonical_event[timeline.id].map(e => e.resolved_payload_ref), ...this.#frameRefs(this.#frame(state, timeline.id)));
    }
    for (const checkpoint of Object.values(state.checkpoint)) roots.push(checkpoint.manifest_ref);
    for (const ledger of Object.values(state.command_result_ledger)) roots.push(ledger.committed_result_ref);
    for (const anchor of Object.values(state.turn_anchor)) roots.push(anchor.known_view_ref);
    for (const migration of Object.values(state.migration)) roots.push(migration.source_ref, migration.versions_ref, migration.validation_ref);
    for (const operation of Object.values(state.operation_tracking)) {
      if (operation.validation_results.package_ref) roots.push(operation.validation_results.package_ref);
    }
    for (const maintenance of Object.values(state.portability_and_maintenance)) {
      if (maintenance.namespace_mapping_and_provenance.source_package_ref) roots.push(maintenance.namespace_mapping_and_provenance.source_package_ref);
    }
    const reachable = new Set(this.#reachable(state, roots));
    let removed = 0; let compressed = 0;
    for (const [ref, artifact] of Object.entries(state.artifact)) {
      if (!reachable.has(ref)) { delete state.artifact[ref]; removed++; continue; }
      if (optionalUnavailable(artifact)) continue;
      const representation = inline(artifactValue(artifact), true);
      if (representation.length < artifact.content_ref.length) { artifact.content_ref = representation; compressed++; }
    }
    state.noncanonical_optional_state[context.timeline_id].retrieval_indexes_embeddings_and_visual_caches = {};
    const maintenance = state.portability_and_maintenance[context.timeline_id];
    maintenance.verified_recovery_anchor = recovery.checkpoint_id;
    maintenance.reachability_and_pinned_dependencies = [...reachable].sort();
    this.#audit(state, context.campaign_id);
    return { recovery_checkpoint_id: recovery.checkpoint_id, removed_unreachable_artifacts: removed, compressed_artifacts: compressed };
  }
  #recover(state, context, args, now) {
    const verified = this.#checkpointFrame(state, args.verified_anchor);
    const checkpoint = state.checkpoint[args.verified_anchor];
    requireThat(checkpoint.timeline_id === context.timeline_id, 'SCOPE_MISMATCH');
    const prefix = cut(args.valid_journal_prefix ?? head(state.timeline[context.timeline_id]));
    requireThat(prefix.timeline_id === context.timeline_id && prefix.sequence >= readCut(checkpoint.cut_ref).sequence, 'INVALID_RECOVERY_PREFIX');
    const recovered = this.#frameAt(state, prefix);
    requireThat(this.#call('requestStorageRecovery', { anchor: args.verified_anchor, prefix }).valid === true, 'RECOVERY_FAILED');
    const maintenance = state.portability_and_maintenance[context.timeline_id];
    maintenance.verified_recovery_anchor = args.verified_anchor; maintenance.valid_journal_prefix = prefix;
    if (prefix.sequence < state.timeline[context.timeline_id].head_sequence) {
      requireThat(args.new_timeline_id, 'RECOVERY_BRANCH_REQUIRED');
      return this.#fork(state, context, { exact_cut: prefix, new_timeline_id: args.new_timeline_id, reason: 'recovery' }, now);
    }
    void verified;
    return { ...this.#activate(state, context, context.timeline_id, recovered), recovered_cut: prefix };
  }
  #validateStructure(state) {
    exact(state, Object.keys(FIELDS));
    record('versioned_baseline_policy', state.versioned_baseline_policy);
    const policy = state.versioned_baseline_policy;
    requireThat(policy.automatic_branch_merge_supported === false && policy.offline_progression_enabled === false &&
      policy.manual_saves_retained_until_explicit_removal === true, 'UNSUPPORTED_POLICY');
    for (const field of ['autosave_coalescing_real_seconds', 'periodic_checkpoint_real_seconds',
      'ordinary_autosave_retention_minimum', 'hourly_checkpoints_per_active_play_hour', 'hourly_retention_active_play_hours']) {
      requireThat(integer(policy[field]) > 0, 'INVALID_RETENTION_POLICY');
    }
    for (const name of Object.keys(FIELDS)) {
      if (name === 'versioned_baseline_policy') continue;
      object(state[name]);
      if (FRAME_FIELDS.includes(name)) {
        for (const [timelineID, table] of Object.entries(state[name])) {
          requireThat(state.timeline[timelineID], 'ORPHAN_STATE');
          if (FRAME_TABLES.has(name)) for (const entry of Object.values(object(table))) record(name, entry);
          else record(name, table);
        }
      } else if (name === 'canonical_event') {
        for (const events of Object.values(state[name])) {
          requireThat(Array.isArray(events)); for (const event of events) record(name, event);
        }
      } else {
        for (const entry of Object.values(state[name])) record(name, entry);
      }
    }
    for (const [campaignID, campaign] of Object.entries(state.campaign)) requireThat(campaign.id === campaignID, 'IDENTITY_MISMATCH');
    for (const [timelineID, timeline] of Object.entries(state.timeline)) {
      requireThat(timeline.id === timelineID && state.campaign[timeline.campaign_id], 'IDENTITY_MISMATCH');
      requireThat(state.canonical_event[timelineID]?.length === timeline.head_sequence, 'HEAD_MISMATCH');
      requireThat(state.timeline_metadata[timelineID] && state.durability_reporting[timelineID] && state.portability_and_maintenance[timelineID] &&
        state.noncanonical_optional_state[timelineID], 'REQUIRED_STATE_MISSING');
      for (const name of FRAME_FIELDS) requireThat(state[name][timelineID], 'REQUIRED_STATE_MISSING');
      this.#lineage(state, timelineID);
      const keys = new Set(); const ids = new Set();
      state.canonical_event[timelineID].forEach((event, i) => {
        requireThat(event.timeline_id === timelineID && event.sequence === i + 1, 'JOURNAL_GAP');
        requireThat(!keys.has(event.command_key) && !ids.has(event.id), 'DUPLICATE_EVENT');
        const scope = JSON.parse(event.command_key);
        requireThat(scope[0] === timeline.campaign_id && scope[1] === timelineID && scope.length === 3, 'COMMAND_SCOPE_MISMATCH');
        keys.add(event.command_key); ids.add(event.id);
      });
    }
    for (const [checkpointID, checkpoint] of Object.entries(state.checkpoint)) {
      requireThat(checkpoint.id === checkpointID && state.timeline[checkpoint.timeline_id], 'IDENTITY_MISMATCH');
    }
    for (const [entryID, entry] of Object.entries(state.save_entry)) {
      requireThat(entry.id === entryID && state.checkpoint[entry.checkpoint_id]?.status === 'valid', 'INVALID_CATALOG_POINTER');
    }
    for (const [ref, artifact] of Object.entries(state.artifact)) requireThat(artifact.id === ref, 'IDENTITY_MISMATCH');
    for (const report of Object.values(state.durability_reporting)) {
      requireThat(report.last_durable_commit_cut === null && report.sync_status !== 'synced' && report.backup_status !== 'backed_up', 'FALSE_DURABILITY_CLAIM');
    }
  }
  #audit(state, campaignID) {
    this.#validateStructure(state);
    for (const timeline of Object.values(state.timeline).filter(t => t.campaign_id === campaignID)) {
      const frame = this.#frameAt(state, head(timeline));
      requireThat(equal(frame, this.#frame(state, timeline.id)), 'PROJECTION_DRIFT');
      for (const event of state.canonical_event[timeline.id]) {
        this.#validateFrame(state, timeline.id, this.#value(state, event.resolved_payload_ref), true);
        const ledger = state.command_result_ledger[event.command_key];
        requireThat(ledger && state.command_context[event.command_key], 'COMMAND_LEDGER_MISSING');
        const result = this.#value(state, ledger.committed_result_ref);
        requireThat(result.event_id === event.id && equal(result.cut, { timeline_id: timeline.id, sequence: event.sequence }), 'COMMAND_RESULT_MISMATCH');
      }
      if (timeline.parent_id !== null) {
        const fork = readCut(timeline.fork_cut_ref);
        const normalize = source => {
          const normalized = copy(source);
          for (const workflow of Object.values(normalized.workflow)) workflow.timeline_id = 'scope';
          for (const task of Object.values(normalized.task_outbox)) { task.timeline_id = 'scope'; task.fence = 0; }
          for (const creation of Object.values(normalized.creation_ledger)) creation.timeline_scope = 'scope';
          for (const task of Object.values(normalized.generation_task)) {
            task.original_timeline_session_context = 'scope'; task.fencing_token = 0;
            if (!['accepted', 'completed'].includes(task.status)) task.source_cut = 'scope';
          }
          return normalized;
        };
        const root = normalize(this.#value(state, `root:${timeline.id}`));
        const candidates = [normalize(this.#frameAt(state, fork))];
        for (const checkpoint of Object.values(state.checkpoint)) {
          if (checkpoint.status === 'valid' && equal(readCut(checkpoint.cut_ref), fork)) {
            candidates.push(normalize(this.#checkpointFrame(state, checkpoint.id)));
          }
        }
        requireThat(candidates.some(candidate => equal(root, candidate)), 'FORK_STATE_MISMATCH');
      }
    }
    for (const checkpoint of Object.values(state.checkpoint)) {
      if (checkpoint.status === 'valid' && state.timeline[checkpoint.timeline_id].campaign_id === campaignID) this.#checkpointFrame(state, checkpoint.id);
    }
    return true;
  }
}
