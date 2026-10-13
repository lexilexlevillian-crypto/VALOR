/** Run: node --test system25/system25.test.mjs
 * Fixtures use opaque JSON and injected dependency outcomes, never foreign-domain logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistenceSystem25, makeArtifact, hash, FIELDS, FRAME_FIELDS } from './index.mjs';
import { artifactValue, copy } from './schema.mjs';

function fixture(dependencies = {}) {
  const system = new PersistenceSystem25({ dependencies });
  const payload = makeArtifact({ external_owner_blob: 'revision-zero', unknown: null, exact: '999999999999999999.123456789' });
  const contract = makeArtifact({ external_contract: 'dummy-v1' }, 'owner_contract');
  const view = makeArtifact({ external_known_view_ref: 'dummy-view' }, 'owner_view');
  const initialFrame = {
    owner_state_registry: { owner: {
      family: 'owner', schema_version: '1', owner_revision: 0, state_ref: payload.id,
      serialization_contract_ref: contract.id, reconstruction_adapter_ref: contract.id,
      invariant_contract_ref: contract.id, scheduled_work_refs: [], migration_policy_ref: contract.id,
      validation_result: { mock: true, valid: true }, required: true, rebuildable: false
    } },
    workflow: {}, task_outbox: {}, creation_ledger: {}, durable_task_metadata: {}, generation_task: {},
    preserved_scheduler_state: {
      canonical_clock: { ticks: '1200000000000000000000', unit: 'owner-defined' }, calendar_version: 'dummy-calendar-v1',
      due_event_queue: { opaque: 'due-but-unprocessed' }, processed_cursors: { opaque: 'cursor' },
      equal_time_ordering_policy: { opaque: 'System 11 ordering' }, task_ids: [], deadline_versions: {},
      start_completion_elapsed_intervals: null, periodic_series_last_occurrence_next_due: null,
      occurrence_and_processing_times: { opaque: 'timing' }
    },
    preserved_resolution_state: {
      resolved_checks_and_selected_outcomes: { opaque: 'stored-outcome' },
      committed_decision_and_generation_results: null, versioned_random_stream_state: { opaque: 'stream-v1' },
      pending_random_allocations_by_command_event: { opaque: 'allocated-input' }
    },
    preserved_choice_and_workflow_state: {
      prompt_anchor: view.id, known_view_ref: view.id, accepted_scope_and_commitments: { exact_player_words: 'No.' },
      unanswered_status: true, action_timing_targets_budgets_eligibility: { opaque: 'eligibility' },
      completed_and_pending_stages: null, reservations_and_consumed_resources: null,
      communication_content_and_delivery_state: null, watcher_values_edge_ordinals_and_versions: null
    }
  };
  let n = 0;
  let context = {
    campaign_id: 'campaign-1', timeline_id: 'parent', authority: { role: 'administrator', session_id: 'session-1', actor_id: 'actor-1' },
    operation_id: 'create', idempotency_key: 'create', expected_head_revision: 0, expected_entity_revisions: {}, session_fence: 0
  };
  const created = system.stateMachine({ command: 'CreateCampaign', context, now: '2026-10-13T00:00:00Z', args: {
    content_policy: { required_state_families: ['owner'] }, rules_policy: { version: 'rules-1' }, label: 'Parent',
    frame: initialFrame, artifacts: [payload, contract, view]
  } });
  assert.equal(created.ok, true, JSON.stringify(created));
  context.session_fence = created.session_fence;
  function request(command, args = {}, options = {}) {
    n++;
    return { command, context: { ...copy(context), operation_id: `operation-${n}`, idempotency_key: `command-${n}`, ...options.context },
      args: copy(args), now: options.now ?? '2026-10-13T00:01:00Z' };
  }
  function run(command, args = {}, options = {}) {
    const result = system.stateMachine(request(command, args, options));
    if (result.ok && result.head_revision !== undefined) context.expected_head_revision = result.head_revision;
    if (result.ok && result.session_fence !== undefined) context.session_fence = result.session_fence;
    if (result.ok && result.timeline_id !== undefined && ['ContinueTimeline', 'SwitchTimeline', 'ResumeCheckpointAsBranch',
      'CreateTimelineFromAnchor', 'ActivateImportedFamily', 'RecoverTimeline'].includes(command)) context.timeline_id = result.timeline_id;
    if (result.ok && result.campaign_id !== undefined && command === 'ActivateImportedFamily') context.campaign_id = result.campaign_id;
    return result;
  }
  function state() {
    const result = run('SerializeState'); assert.equal(result.ok, true); return result.state;
  }
  function frame(timelineID = context.timeline_id) {
    const current = state(); return Object.fromEntries(FRAME_FIELDS.map(name => [name, current[name][timelineID]]));
  }
  function commit(blob = 'next-owner-record', options = {}) {
    const proposed = frame(); const artifact = makeArtifact({ external_owner_blob: blob });
    proposed.owner_state_registry.owner.state_ref = artifact.id;
    proposed.owner_state_registry.owner.owner_revision++;
    return run('CommitBatch', { frame: proposed, artifacts: [artifact] }, options);
  }
  function checkpoint(args = {}, options = {}) {
    return run('RequestCheckpoint', { publish: true, label: 'Save', ...args }, options);
  }
  return { system, context, initialFrame, run, request, state, frame, commit, checkpoint };
}
const ok = result => assert.equal(result.ok, true, JSON.stringify(result));
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };

test('state owns exactly the distilled variables; mock acknowledgments never claim durability', () => {
  const f = fixture(); const state = f.state();
  assert.deepEqual(Object.keys(state).sort(), Object.keys(FIELDS).sort());
  const result = f.commit(); ok(result); assert.equal(result.mock, true); assert.equal(result.durable, false);
  const status = f.run('GetStatus'); ok(status);
  assert.equal(status.durability.last_durable_commit_cut, null);
  assert.equal(status.durability.sync_status, 'not_synced');
  assert.equal(status.durability.backup_status, 'not_backed_up');
});

test('immutable cut survives live advancement and delayed publication', () => {
  const f = fixture(); ok(f.commit('first'));
  const pending = f.checkpoint({ publish: false }); ok(pending);
  assert.equal(pending.status, 'building');
  error(f.run('InspectCheckpoint', { checkpoint_id: pending.checkpoint_id }), 'CHECKPOINT_UNAVAILABLE');
  ok(f.commit('second'));
  const published = f.run('PublishCheckpoint', { checkpoint_id: pending.checkpoint_id }); ok(published);
  assert.equal(published.captured_cut.sequence, 1);
  assert.equal(f.state().timeline.parent.head_sequence, 2);
  const manifest = f.state().manifest[pending.checkpoint_id];
  const snapshot = manifest.artifact_refs_and_digests.find(a => a.required_kind === 'checkpoint_state');
  const saved = artifactValue(f.state().artifact[snapshot.ref]);
  assert.equal(artifactValue(f.state().artifact[saved.owner_state_registry.owner.state_ref]).external_owner_blob, 'first');
});

test('duplicate command returns exact result; reused key for different input is rejected', () => {
  const f = fixture(); const request = f.request('CommitBatch', { frame: f.frame() });
  const first = f.system.stateMachine(request); ok(first);
  assert.deepEqual(f.system.stateMachine(request), first);
  const changed = copy(request); changed.args.event = { id: 'different-event' };
  error(f.system.stateMachine(changed), 'IDEMPOTENCY_CONFLICT');
  assert.equal(f.state().timeline.parent.head_sequence, 1);
});

test('durability failure rolls back every canonical change and pauses further mutation', () => {
  let fail = false;
  const f = fixture({ commitStorage: () => ({ mock: true, acknowledged: !fail, simulated_durable_commit: !fail, durable: false }) });
  const before = f.state(); fail = true;
  error(f.commit('must-not-commit'), 'STORAGE_UNAVAILABLE');
  const after = f.state();
  assert.deepEqual(after.canonical_event, before.canonical_event);
  assert.deepEqual(after.owner_state_registry, before.owner_state_registry);
  assert.deepEqual(after.command_result_ledger, before.command_result_ledger);
  error(f.commit(), 'MUTATION_PAUSED'); fail = false;
  ok(f.run('ResumeStorage')); ok(f.commit());
});

test('stale head, stale owner revision, stale fence and wrong writer cannot mutate', () => {
  const f = fixture(); ok(f.commit());
  error(f.commit('stale', { context: { expected_head_revision: 0 } }), 'STALE_HEAD');
  error(f.commit('stale', { context: { expected_entity_revisions: { owner: 0 } } }), 'STALE_ENTITY');
  error(f.commit('stale', { context: { session_fence: 0 } }), 'STALE_FENCE');
  error(f.commit('stale', { context: { authority: { role: 'administrator', session_id: 'other', actor_id: 'actor-1' } } }), 'WRITER_CONFLICT');
  assert.equal(f.state().timeline.parent.head_sequence, 1);
});

test('fork restores exact earlier opaque state without deleting parent future or rerolling', () => {
  const f = fixture(); const checkpoint = f.checkpoint(); ok(checkpoint);
  ok(f.commit('future-parent'));
  const before = f.frame(); const futureEvents = copy(f.state().canonical_event.parent);
  const branch = f.run('ResumeCheckpointAsBranch', { checkpoint_id: checkpoint.checkpoint_id, new_timeline_id: 'child' }); ok(branch);
  assert.deepEqual(f.frame().preserved_resolution_state, f.initialFrame.preserved_resolution_state);
  assert.deepEqual(f.frame().preserved_scheduler_state, f.initialFrame.preserved_scheduler_state);
  assert.deepEqual(f.frame().preserved_choice_and_workflow_state, f.initialFrame.preserved_choice_and_workflow_state);
  assert.equal(f.frame().owner_state_registry.owner.owner_revision, 0);
  ok(f.commit('child-future'));
  assert.deepEqual(f.state().canonical_event.parent, futureEvents);
  assert.deepEqual(f.frame('parent'), before);
  assert.equal(f.state().timeline.child.head_sequence, 1);
  error(f.run('CommitBatch', { frame: f.frame('parent') }, { context: { timeline_id: 'parent', expected_head_revision: 1, session_fence: 1 } }), 'WRONG_TIMELINE');
});

test('inspection is read-only, known-view filtered, and AI-independent', () => {
  const f = fixture(); const saved = f.checkpoint(); ok(saved);
  const before = f.state();
  const inspected = f.run('InspectCheckpoint', { checkpoint_id: saved.checkpoint_id }); ok(inspected);
  assert.deepEqual(inspected.known_view.known_facts, []);
  assert.equal(JSON.stringify(inspected).includes('revision-zero'), false);
  assert.deepEqual(f.state(), before);
  ok(f.run('SetDraft', { text: 'unsent' }));
  const result = f.run('RegenerateNarration', { checkpoint_id: saved.checkpoint_id, task_id: 'narrate' }); ok(result);
  assert.equal(result.status, 'deterministic_fallback');
  assert.equal(f.state().timeline.parent.head_sequence, 0);
  assert.equal(f.frame().preserved_choice_and_workflow_state.unanswered_status, true);
});

test('safe anchors reject partial cuts and expose exact supported boundaries', () => {
  const f = fixture(); ok(f.commit());
  const anchor = { input_event_interval: { first: 0, last: 1 }, known_view_ref: f.frame().preserved_choice_and_workflow_state.known_view_ref,
    supported_before_cut: { timeline_id: 'parent', sequence: 0 }, supported_after_cut: { timeline_id: 'parent', sequence: 1 } };
  ok(f.run('CreateTurnAnchor', { anchor_id: 'turn-1', anchor }));
  error(f.run('CreateTimelineFromAnchor', { anchor_id: 'turn-1', boundary: 'middle', new_timeline_id: 'bad' }), 'EXACT_BOUNDARY_REQUIRED');
  ok(f.run('CreateTimelineFromAnchor', { anchor_id: 'turn-1', boundary: 'before', new_timeline_id: 'good' }));
  assert.equal(f.frame().owner_state_registry.owner.owner_revision, 0);
});

test('load validation failure leaves active session and live frame untouched', () => {
  let valid = true;
  const f = fixture({ validateOwnerState: () => ({ mock: true, valid, required_refs: [] }) });
  const saved = f.checkpoint(); ok(saved); const before = f.state(); valid = false;
  error(f.run('ResumeCheckpointAsBranch', { checkpoint_id: saved.checkpoint_id, new_timeline_id: 'bad-child' }), 'OWNER_INVARIANT_FAILED');
  assert.deepEqual(f.state(), before);
});

test('missing required owner or artifact cannot replace live state', () => {
  const f = fixture(); const frame = f.frame(); delete frame.owner_state_registry.owner;
  error(f.run('CommitBatch', { frame }), 'MISSING_REQUIRED_FAMILY');
  const wrong = f.frame(); wrong.owner_state_registry.owner.state_ref = 'absent';
  error(f.run('CommitBatch', { frame: wrong }), 'REQUIRED_ARTIFACT_UNAVAILABLE');
  assert.equal(f.state().timeline.parent.head_sequence, 0);
});

test('owner invariant rejection is a hard gate without implementing foreign logic', () => {
  let accept = true;
  const f = fixture({ approveOwnerMutation: () => ({ mock: true, approved: accept }) });
  accept = false; error(f.commit(), 'OWNER_MUTATION_REJECTED');
  assert.equal(f.state().timeline.parent.head_sequence, 0);
});

test('partial workflows and durable task delivery remain scoped and idempotent', () => {
  let deliveries = 0;
  const f = fixture({ deliverOwnerTask: () => { deliveries++; return { mock: true, acknowledged: true, effect_ref: 'effect-1' }; } });
  const frame = f.frame(); const opaque = makeArtifact({ opaque: 'reservation-and-payload' });
  frame.workflow.w = { id: 'w', timeline_id: 'parent', cause_ref: 'owner-cause', stage: 'owner-pending', effect_keys: ['completed-effect'],
    reservations_ref: opaque.id, pending_tasks: ['t'], status: 'pending' };
  frame.task_outbox.t = { id: 't', timeline_id: 'parent', workflow_ref: 'w', target_ref: 'opaque-owner', payload_ref: opaque.id,
    idempotency_key: 'task-t', fence: 1, status: 'pending' };
  frame.durable_task_metadata.t = { causal_event_ref: 'owner-cause', stage: 'owner-pending', attempts: 0, acknowledgment: null, retry_policy: { opaque: 'retry-policy' } };
  ok(f.run('CommitBatch', { frame, artifacts: [opaque] }));
  const saved = f.checkpoint(); ok(saved);
  ok(f.run('DeliverTask', { task_id: 't' }));
  const duplicate = f.run('DeliverTask', { task_id: 't' }); ok(duplicate); assert.equal(duplicate.duplicate, true);
  assert.equal(deliveries, 1);
  assert.equal(f.frame().workflow.w.stage, 'owner-pending');
  ok(f.run('ResumeCheckpointAsBranch', { checkpoint_id: saved.checkpoint_id, new_timeline_id: 'child' }));
  assert.equal(f.frame().task_outbox.t.status, 'pending');
  ok(f.run('DeliverTask', { task_id: 't' })); assert.equal(deliveries, 2);
  assert.equal(f.frame('parent').task_outbox.t.status, 'acknowledged');
});

test('generation acceptance is fenced and returns a single stable identity', () => {
  const f = fixture();
  const task = { task_id: 'g', original_timeline_session_context: { campaign_id: 'campaign-1', timeline_id: 'parent' },
    model_content_constraints: { opaque: 'owner-constraints' }, source_cut: { timeline_id: 'parent', sequence: 0 },
    staged_candidate_ref: null, validation_status: 'pending', status: 'requested', accepted_output_refs: [], fencing_token: 1 };
  ok(f.run('RequestGeneration', { task }));
  const accepted = makeArtifact({ opaque: 'owner-approved-person' });
  const args = { task_id: 'g', request_key: 'creation-g', entity_id: 'person-001', accepted_content_ref: accepted.id,
    owner_frame: f.frame(), artifacts: [accepted] };
  const result = f.run('AcceptGeneration', args); ok(result);
  const again = f.run('AcceptGeneration', { ...args, entity_id: 'attempted-other-id' }); ok(again);
  assert.equal(again.entity_id, 'person-001');
  assert.equal(Object.keys(f.frame().creation_ledger).length, 1);
  const rewrite = f.frame(); rewrite.creation_ledger['creation-g'].entity_id = 'wrong';
  error(f.run('CommitBatch', { frame: rewrite }), 'CREATION_LEDGER_REWRITE');
});

test('branch-scoped package excludes later parent state and imports independently', () => {
  const f = fixture(); const sourceCheckpoint = f.checkpoint(); ok(sourceCheckpoint);
  ok(f.commit('secret-parent-future'));
  ok(f.run('ResumeCheckpointAsBranch', { checkpoint_id: sourceCheckpoint.checkpoint_id, new_timeline_id: 'child' }));
  ok(f.commit('child-data')); const childCheckpoint = f.checkpoint(); ok(childCheckpoint);
  const exported = f.run('ExportTimeline', { checkpoint_id: childCheckpoint.checkpoint_id, mode: 'selected_timeline_full', acknowledge_hidden_state: true }); ok(exported);
  assert.equal(exported.package.state.timeline.parent.head_sequence, 0);
  assert.equal(Object.values(exported.package.state.artifact).some(a => JSON.stringify(artifactValue(a)).includes('secret-parent-future')), false);
  const validated = f.run('ValidateImport', { package: exported.package }); ok(validated);
  const imported = f.run('ActivateImportedFamily', { validated_operation: validated.validated_operation, new_campaign_id: 'imported-campaign' }); ok(imported);
  assert.equal(f.context.campaign_id, 'imported-campaign');
  assert.deepEqual(f.frame().preserved_resolution_state, f.initialFrame.preserved_resolution_state);
  assert.equal(artifactValue(f.state().artifact[f.frame().owner_state_registry.owner.state_ref]).external_owner_blob, 'child-data');
  assert.equal(f.state().timeline.parent.head_sequence, 1);
  ok(f.run('Audit'));
});

test('full export round trip works without the source host', () => {
  const source = fixture(); ok(source.commit('portable')); const saved = source.checkpoint(); ok(saved);
  const exported = source.run('ExportTimeline', { checkpoint_id: saved.checkpoint_id, acknowledge_hidden_state: true }); ok(exported);
  const target = fixture();
  const staged = target.run('ValidateImport', { package: JSON.parse(JSON.stringify(exported.package)) }); ok(staged);
  const imported = target.run('ActivateImportedFamily', { validated_operation: staged.validated_operation }); ok(imported);
  assert.equal(target.frame().owner_state_registry.owner.owner_revision, 1);
  assert.deepEqual(target.frame().preserved_choice_and_workflow_state, source.frame().preserved_choice_and_workflow_state);
});

test('redacted export cannot be activated as a full world', () => {
  const f = fixture(); const saved = f.checkpoint(); ok(saved);
  const redacted = f.run('ExportTimeline', { checkpoint_id: saved.checkpoint_id, mode: 'redacted_story_history' }); ok(redacted);
  assert.equal(redacted.restorable, false);
  assert.equal(JSON.stringify(redacted).includes('revision-zero'), false);
  error(f.run('ValidateImport', { package: redacted.package }), 'NONRESTORABLE_PACKAGE');
});

test('tampered manifests, ancestry cycles, unsafe keys and executable imports fail in staging', () => {
  const f = fixture(); const saved = f.checkpoint(); ok(saved);
  const exported = f.run('ExportTimeline', { checkpoint_id: saved.checkpoint_id, acknowledge_hidden_state: true }); ok(exported);
  const corrupt = copy(exported.package); corrupt.state.campaign['campaign-1'].status = 'tampered';
  error(f.run('ValidateImport', { package: corrupt }), 'PACKAGE_DIGEST_MISMATCH');
  const executable = copy(exported.package); executable.watcher_content.push({ type: 'script', schema_version: '1', payload: 'run-code' });
  const { integrity, ...unsigned } = executable; executable.integrity = hash(unsigned);
  error(f.run('ValidateImport', { package: executable }), 'EXECUTABLE_CONTENT_FORBIDDEN');
  const unsafe = JSON.parse('{"command":"InspectCheckpoint","__proto__":{"x":1}}');
  error(f.system.stateMachine(unsafe), 'UNSAFE_KEY');
  assert.equal(Object.keys(f.state().campaign).length, 1);
});

test('exact values, unknowns, draft separation, and game time survive restart', () => {
  const f = fixture(); ok(f.run('SetDraft', { text: 'not a committed action' }));
  const serialized = JSON.parse(JSON.stringify(f.state()));
  const restarted = new PersistenceSystem25({ state: serialized });
  const response = restarted.stateMachine({ command: 'ContinueTimeline', context: { ...f.context, operation_id: 'restart', idempotency_key: 'restart' },
    args: {}, now: '2030-01-01T00:00:00Z' }); ok(response);
  const result = restarted.stateMachine({ command: 'SerializeState', context: f.context }); ok(result);
  assert.deepEqual(result.state.preserved_scheduler_state.parent, f.initialFrame.preserved_scheduler_state);
  assert.equal(result.state.noncanonical_optional_state.parent.unsubmitted_player_drafts['actor-1'], 'not a committed action');
  const owner = result.state.owner_state_registry.parent.owner;
  assert.equal(artifactValue(result.state.artifact[owner.state_ref]).exact, '999999999999999999.123456789');
});

test('autosaves coalesce without clock advancement and protect manual retention', () => {
  const f = fixture(); const manual = f.checkpoint(); ok(manual); const originalTime = f.frame().preserved_scheduler_state.canonical_clock;
  for (let i = 0; i < 23; i++) {
    ok(f.commit(`progress-${i}`));
    const saved = f.run('Autosave', { trigger: 'consequential', stable_choice_boundary: true, active_play_seconds: i * 3600 },
      { now: new Date(Date.parse('2026-10-13T00:02:00Z') + i * 6000).toISOString() }); ok(saved);
  }
  const entries = Object.values(f.state().save_entry);
  assert.equal(entries.filter(e => e.kind === 'autosave').length, 20);
  assert.ok(entries.some(e => e.checkpoint_id === manual.checkpoint_id));
  ok(f.commit('coalesced-progress'));
  const coalesced = f.run('Autosave', { trigger: 'choice', stable_choice_boundary: true }, { now: '2026-10-13T00:04:13Z' }); ok(coalesced);
  assert.equal(coalesced.status, 'coalesced');
  assert.deepEqual(f.frame().preserved_scheduler_state.canonical_clock, originalTime);
});

test('catalog rename/removal never changes checkpoint bytes or branch ancestry', () => {
  const f = fixture(); const saved = f.checkpoint(); ok(saved); const before = copy(f.state().checkpoint[saved.checkpoint_id]);
  ok(f.run('RenameSaveEntry', { save_entry_id: saved.save_entry_id, label: 'Renamed' }));
  ok(f.run('DeleteSaveEntry', { save_entry_id: saved.save_entry_id }));
  assert.deepEqual(f.state().checkpoint[saved.checkpoint_id], before);
  ok(f.run('ResumeCheckpointAsBranch', { checkpoint_id: saved.checkpoint_id, new_timeline_id: 'still-loadable' }));
});

test('compaction is lossless, preserves exact old cuts, and retains a recovery anchor', () => {
  const f = fixture(); const first = f.checkpoint(); ok(first);
  ok(f.commit('a'.repeat(2000))); const before = f.frame();
  const compacted = f.run('CompactHistory'); ok(compacted); assert.ok(compacted.compressed_artifacts > 0);
  assert.deepEqual(f.frame(), before); ok(f.run('Audit'));
  ok(f.run('InspectCheckpoint', { checkpoint_id: first.checkpoint_id }));
  assert.equal(f.state().checkpoint[compacted.recovery_checkpoint_id].status, 'valid');
});

test('schema migration stages a new checkpoint and cannot change pending commitments', () => {
  const f = fixture(); const source = f.checkpoint(); ok(source);
  const frame = f.frame(); frame.owner_state_registry.owner.schema_version = '2';
  const migrated = f.run('MigrateCheckpoint', { checkpoint_id: source.checkpoint_id, new_checkpoint_id: 'migrated',
    migrated_frame: frame, target_versions: { owner: '2' } }); ok(migrated);
  assert.equal(f.state().manifest[source.checkpoint_id].schema_versions.owner, '1');
  assert.equal(f.state().manifest.migrated.schema_versions.owner, '2');
  const bad = copy(frame); bad.preserved_choice_and_workflow_state.unanswered_status = false;
  error(f.run('MigrateCheckpoint', { checkpoint_id: source.checkpoint_id, new_checkpoint_id: 'bad-migration',
    migrated_frame: bad, target_versions: { owner: '2' } }), 'MIGRATION_CHANGES_COMMITMENTS');
  assert.equal(f.state().checkpoint['bad-migration'], undefined);
});

test('journal recovery resumes newer committed progress and forks an older prefix', () => {
  const f = fixture(); const saved = f.checkpoint(); ok(saved);
  ok(f.commit('newer-than-checkpoint'));
  const recovered = f.run('RecoverTimeline', { verified_anchor: saved.checkpoint_id }); ok(recovered);
  assert.equal(recovered.recovered_cut.sequence, 1);
  const earlier = f.run('RecoverTimeline', { verified_anchor: saved.checkpoint_id,
    valid_journal_prefix: { timeline_id: 'parent', sequence: 0 }, new_timeline_id: 'recovered-child' }); ok(earlier);
  assert.equal(f.state().timeline.parent.head_sequence, 1);
  assert.equal(f.state().timeline['recovered-child'].head_sequence, 0);
});

test('sync and backup mocks never claim a remote copy or merge a conflict', () => {
  const f = fixture({ requestSync: () => ({ mock: true, acknowledged: true, remote_revision: 99, conflict: true }),
    requestBackup: () => ({ mock: true, completed: true, validated: true, destination: 'dummy' }) });
  const saved = f.checkpoint(); ok(saved);
  const sync = f.run('Synchronize', { checkpoint_id: saved.checkpoint_id }); ok(sync);
  assert.equal(sync.status, 'conflict_separate_branch_required');
  const backup = f.run('Backup', { checkpoint_id: saved.checkpoint_id }); ok(backup);
  assert.equal(backup.status, 'not_backed_up'); assert.equal(Object.keys(f.state().timeline).length, 1);
});

test('production dependencies, extra state variables, and imprecise integers are rejected', () => {
  assert.throws(() => new PersistenceSystem25({ state: { unlisted: true } }));
  const f = fixture();
  error(f.run('SetDraft', { text: 'x', unsafe_number: Number.MAX_SAFE_INTEGER + 1 }), 'INEXACT_NUMBER');
  const state = f.state();
  const engine = new PersistenceSystem25({ state, dependencies: { commitStorage: () => ({ mock: false, durable: true, acknowledged: true }) } });
  const request = f.request('SetDraft', { text: 'x' });
  error(engine.stateMachine(request), 'NONMOCK_DEPENDENCY_FORBIDDEN');
});

test('storage exceptions pause writes and a failed publication preserves prior valid save', () => {
  let throwing = false; let valid = true;
  const f = fixture({ commitStorage: () => {
    if (throwing) throw new Error('private storage details');
    return { mock: true, durable: false, acknowledged: true, simulated_durable_commit: true };
  }, validateOwnerState: () => ({ mock: true, valid, required_refs: [] }) });
  const first = f.checkpoint(); ok(first);
  const staged = f.checkpoint({ publish: false }); ok(staged);
  valid = false;
  error(f.run('PublishCheckpoint', { checkpoint_id: staged.checkpoint_id }), 'OWNER_INVARIANT_FAILED');
  assert.equal(f.state().checkpoint[staged.checkpoint_id].status, 'quarantined');
  assert.equal(f.state().checkpoint[first.checkpoint_id].status, 'valid');
  valid = true; throwing = true;
  error(f.commit(), 'DEPENDENCY_FAILED:commitStorage');
  error(f.commit(), 'MUTATION_PAUSED');
});

test('writer lease takeover increments fencing and prevents a delayed old session', () => {
  const f = fixture();
  ok(f.run('AcquireWriter', { lease_real_milliseconds: 1000 }, { now: '2026-10-13T00:02:00Z' }));
  const other = { role: 'administrator', session_id: 'session-2', actor_id: 'actor-1' };
  error(f.run('AcquireWriter', { lease_real_milliseconds: 1000 }, { context: { authority: other }, now: '2026-10-13T00:02:00.500Z' }), 'WRITER_LEASE_ACTIVE');
  const takeover = f.run('AcquireWriter', { lease_real_milliseconds: 1000 }, { context: { authority: other }, now: '2026-10-13T00:02:02Z' }); ok(takeover);
  assert.equal(takeover.session_fence, 3);
  error(f.commit(), 'WRITER_CONFLICT');
});

test('staged generation is noncanonical identity until approval and cannot accept twice', () => {
  const f = fixture({ requestAI: () => ({ mock: true, available: true, candidate: { opaque: 'candidate' } }) });
  const task = { task_id: 'g', original_timeline_session_context: { campaign_id: 'campaign-1', timeline_id: 'parent' },
    model_content_constraints: {}, source_cut: { timeline_id: 'parent', sequence: 0 }, staged_candidate_ref: null,
    validation_status: 'pending', status: 'requested', accepted_output_refs: [], fencing_token: 1 };
  ok(f.run('RequestGeneration', { task }));
  ok(f.run('ProcessGeneration', { task_id: 'g' }));
  assert.equal(Object.keys(f.frame().creation_ledger).length, 0);
  const candidateRef = f.frame().generation_task.g.staged_candidate_ref;
  ok(f.run('AcceptGeneration', { task_id: 'g', request_key: 'request-g', entity_id: 'entity-g', accepted_content_ref: candidateRef, owner_frame: f.frame() }));
  error(f.run('AcceptGeneration', { task_id: 'g', request_key: 'another-key', entity_id: 'entity-g2', accepted_content_ref: candidateRef, owner_frame: f.frame() }), 'GENERATION_ALREADY_ACCEPTED');
});

test('generation resumes after a new writer fence without replaying canonical input', () => {
  const f = fixture();
  const task = { task_id: 'g', original_timeline_session_context: { campaign_id: 'campaign-1', timeline_id: 'parent' },
    model_content_constraints: {}, source_cut: { timeline_id: 'parent', sequence: 0 }, staged_candidate_ref: null,
    validation_status: 'pending', status: 'requested', accepted_output_refs: [], fencing_token: 1 };
  ok(f.run('RequestGeneration', { task })); ok(f.run('ContinueTimeline'));
  error(f.run('ProcessGeneration', { task_id: 'g' }), 'STALE_FENCE');
  ok(f.run('ResumeGeneration', { task_id: 'g' }));
  const result = f.run('ProcessGeneration', { task_id: 'g' }); ok(result); assert.equal(result.status, 'pending');
  assert.deepEqual(f.frame().preserved_resolution_state, f.initialFrame.preserved_resolution_state);
});

test('migrated checkpoint and migrated child retain provenance in independent imports', () => {
  const f = fixture(); const original = f.checkpoint(); ok(original);
  const migratedFrame = f.frame(); migratedFrame.owner_state_registry.owner.schema_version = '2';
  const migrated = f.run('MigrateCheckpoint', { checkpoint_id: original.checkpoint_id,
    new_checkpoint_id: 'v2', migrated_frame: migratedFrame, target_versions: { owner: '2' } }); ok(migrated);
  const direct = f.run('ExportTimeline', { checkpoint_id: migrated.checkpoint_id, acknowledge_hidden_state: true }); ok(direct);
  const target = fixture(); const staged = target.run('ValidateImport', { package: direct.package }); ok(staged);
  const imported = target.run('ActivateImportedFamily', { validated_operation: staged.validated_operation }); ok(imported);
  assert.equal(target.frame().owner_state_registry.owner.schema_version, '2');
  assert.equal(Object.keys(target.state().migration).length, 1);
  ok(f.run('ResumeCheckpointAsBranch', { checkpoint_id: migrated.checkpoint_id, new_timeline_id: 'v2-child' }));
  const child = f.checkpoint(); ok(child);
  const exported = f.run('ExportTimeline', { checkpoint_id: child.checkpoint_id, acknowledge_hidden_state: true }); ok(exported);
  const isolated = fixture(); const validated = isolated.run('ValidateImport', { package: exported.package }); ok(validated);
  ok(isolated.run('ActivateImportedFamily', { validated_operation: validated.validated_operation }));
  assert.equal(isolated.frame().owner_state_registry.owner.schema_version, '2');
  ok(isolated.run('Audit'));
});

test('a missing optional portrait uses declared fallback while a missing canonical artifact fails', () => {
  const f = fixture();
  const portrait = makeArtifact({ bytes: 'optional portrait bytes' }, 'optional_visual');
  const owner = makeArtifact({ opaque: 'identity-with-portrait-reference', portrait_ref: portrait.id }, 'canonical', [portrait.id]);
  const frame = f.frame(); frame.owner_state_registry.owner.state_ref = owner.id;
  ok(f.run('CommitBatch', { frame, artifacts: [portrait, owner] }));
  const saved = f.checkpoint(); ok(saved);
  const exported = f.run('ExportTimeline', { checkpoint_id: saved.checkpoint_id, acknowledge_hidden_state: true }); ok(exported);
  const packet = copy(exported.package); packet.state.artifact[portrait.id].content_ref = 'unavailable:declared_fallback';
  const { integrity, ...unsigned } = packet; packet.integrity = hash(unsigned);
  const validated = f.run('ValidateImport', { package: packet }); ok(validated);
  ok(f.run('ActivateImportedFamily', { validated_operation: validated.validated_operation }));
  assert.equal(f.frame().owner_state_registry.owner.state_ref, owner.id);
  const broken = copy(exported.package); broken.state.artifact[owner.id].content_ref = 'unavailable:declared_fallback';
  const { integrity: oldDigest, ...body } = broken; broken.integrity = hash(body);
  error(f.run('ValidateImport', { package: broken }), 'UNSUPPORTED_REFERENCE');
});

test('an import with a rehashed but inconsistent fork cannot invent inherited state', () => {
  const f = fixture(); const saved = f.checkpoint(); ok(saved);
  ok(f.run('ResumeCheckpointAsBranch', { checkpoint_id: saved.checkpoint_id, new_timeline_id: 'child' }));
  const childCheckpoint = f.checkpoint(); ok(childCheckpoint);
  const exported = f.run('ExportTimeline', { checkpoint_id: childCheckpoint.checkpoint_id, acknowledge_hidden_state: true }); ok(exported);
  const malformed = copy(exported.package);
  malformed.state.timeline.parent.parent_id = 'child';
  malformed.state.timeline.parent.fork_cut_ref = malformed.state.timeline.child.fork_cut_ref;
  const { integrity, ...body } = malformed; malformed.integrity = hash(body);
  const result = f.run('ValidateImport', { package: malformed });
  assert.equal(result.ok, false); assert.ok(['INVALID_FORK', 'ANCESTRY_CYCLE'].includes(result.error.code));
  assert.equal(Object.keys(f.state().campaign).length, 1);
});

test('idempotency results cannot expose another actor view', () => {
  const f = fixture(); const request = f.request('SetDraft', { text: 'private' });
  ok(f.system.stateMachine(request));
  request.context.authority.actor_id = 'other-actor';
  error(f.system.stateMachine(request), 'UNAUTHORIZED');
});

test('task backoff and retry limits use real processing time without changing canonical deadlines', () => {
  let calls = 0;
  const f = fixture({ deliverOwnerTask: () => { calls++; return { mock: true, acknowledged: false, effect_ref: null }; } });
  const frame = f.frame(); const payload = makeArtifact({ opaque: 'task' });
  frame.task_outbox.t = { id: 't', timeline_id: 'parent', workflow_ref: null, target_ref: 'owner', payload_ref: payload.id,
    idempotency_key: 'task-t', fence: 1, status: 'pending' };
  frame.durable_task_metadata.t = { causal_event_ref: 'cause', stage: 'pending', attempts: 0, acknowledgment: null,
    retry_policy: { max_attempts: 2, backoff_real_milliseconds: 1000 } };
  ok(f.run('CommitBatch', { frame, artifacts: [payload] }));
  ok(f.run('DeliverTask', { task_id: 't' }, { now: '2026-10-13T00:03:00Z' }));
  error(f.run('DeliverTask', { task_id: 't' }, { now: '2026-10-13T00:03:00.500Z' }), 'RETRY_NOT_DUE');
  ok(f.run('DeliverTask', { task_id: 't' }, { now: '2026-10-13T00:03:01Z' }));
  error(f.run('DeliverTask', { task_id: 't' }, { now: '2026-10-13T00:03:02Z' }), 'RETRY_LIMIT_REACHED');
  assert.equal(calls, 2);
  assert.deepEqual(f.frame().preserved_scheduler_state, f.initialFrame.preserved_scheduler_state);
});

test('expired writer cannot commit before renewing its lease', () => {
  const f = fixture();
  ok(f.run('AcquireWriter', { lease_real_milliseconds: 1000 }, { now: '2026-10-13T00:02:00Z' }));
  error(f.commit('expired', { now: '2026-10-13T00:02:02Z' }), 'WRITER_LEASE_EXPIRED');
  ok(f.run('AcquireWriter', { lease_real_milliseconds: 1000 }, { now: '2026-10-13T00:02:02Z' }));
  ok(f.commit('renewed', { now: '2026-10-13T00:02:02.500Z' }));
});
