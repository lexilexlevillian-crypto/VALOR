/** Run: node --test system24/system24.test.mjs
 * Foreign responses below are fixed JSON fixtures, not foreign-system models.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystem24, createMockDependencies } from './index.mjs';
import { key, canonical, DEFAULT_LIMITS, System24State } from './contracts.mjs';

const clone = x => structuredClone(x);
const template = { id: 'service', version: 'v1', premise_ref: 'premise', roles_ref: 'roles',
  prerequisites_ref: 'requirements', pressures_ref: 'pressures', outcomes_ref: 'outcomes',
  watchers_ref: 'watchers', visibility: 'internal', content_policy: 'content-v1' };
const version = JSON.stringify([template.id, template.version]);
const predicate = { op: 'predicate', predicate_ref: 'operating-v1', owner: 'system13',
  entity_ref: 'business', scope_ref: 'service', access_ref: 'access',
  dependency_events: [{ owner: 'system13', entity_ref: 'business', event_type: 'OperatingChanged' }], joins: [] };
// Explicit implementation policy fixture: strong Kleene tables. The runtime
// requires these versioned tables and does not infer them from the prose spec.
const tables = {
  all: { 'true,true': true, 'true,false': false, 'true,unknown': 'unknown',
    'false,true': false, 'false,false': false, 'false,unknown': false,
    'unknown,true': 'unknown', 'unknown,false': false, 'unknown,unknown': 'unknown' },
  any: { 'true,true': true, 'true,false': true, 'true,unknown': true,
    'false,true': true, 'false,false': false, 'false,unknown': 'unknown',
    'unknown,true': true, 'unknown,false': 'unknown', 'unknown,unknown': 'unknown' },
  not: { true: false, false: true, unknown: 'unknown' }
};
const manifest = { version, policy_version: 'rules-v1', enabled: true, supported: true,
  predicate_types: { 'operating-v1': { owner: 'system13', event_types: ['OperatingChanged'] } },
  truth_tables: tables, activation_condition: predicate, required_roles: ['requester'],
  transition_rules: [
    { from: 'active', to: 'resolved', condition: predicate, outcome_scope: 'service', remaining_scopes: [] },
    { from: 'active', to: 'contained', condition: predicate, outcome_scope: null, remaining_scopes: ['debt'] },
    { from: 'active', to: 'transformed', condition: predicate, outcome_scope: null, remaining_scopes: ['debt'] }
  ], outcomes: { service: { predicate_version: 'service-v1', condition: predicate,
    conclusion: 'service_restored', limitations_ref: 'item_remains_damaged' } },
  watcher_rules: { 'outcome-v1': { kind: 'outcome', condition: predicate,
    trigger_policy: 'rising_edge', output_category: 'review_outcome', outcome_scope: 'service',
    action_ref: null, deadline_ref: null, cadence: null, rearm_policy_ref: 'nontrue-then-true-v1' } },
  allowed_action_refs: ['payment-v1'], offer_refs: ['offer-v1'], deadline_policy_refs: ['deadline-policy-v1'] };
const instance = { id: 's1', template_version: version, origin_ref: 'cause-1', bindings_ref: 'bindings-s1',
  state: 'proposed', pressure_refs: ['pressure-v1'], owner_commitments: [], revision: 0 };
const metadata = { origin_kind: 'emergent', creation_cause_refs: ['cause-1'],
  initial_snapshot_refs: [{ owner: 'system13', entity_ref: 'business', revision: 1 }],
  activation_policy_version: 'rules-v1', lineage_refs: [], migration_event_refs: [],
  outcome_history_refs: [], restricted_fact_refs: [], pending_choice_ref: null };
const binding = { role_ref: 'requester', participant_ref: 'npc-1', suitability_evidence_refs: ['role-proof'],
  invalidation_dependencies: ['employment'], actor_visible_description_refs: [], rebind_event_refs: [] };
const watcher = { id: 'w1', situation_id: 's1', version: 'outcome-v1', scope_ref: 'service',
  read_context: 'simulation', subscriptions: predicate.dependency_events, condition_ast: predicate,
  trigger_policy: 'rising_edge', last_value: 'unknown', last_revision: null, edge_ordinal: 0,
  pending_workflow: null, status: 'dormant' };
const watcherMeta = { kind: 'outcome', dependency_refs: ['business'], visibility: 'internal',
  allowed_output_categories: ['review_outcome'], last_evaluated_at: null, snapshot_revision_refs: [],
  fired_cause_ids: [], edge_history_refs: [], trigger_key: null, next_review_at: null,
  rearm_policy_ref: 'nontrue-then-true-v1', suspension_reason_ref: null, retirement_reason_ref: null };
const action = { action_ref: 'payment-v1', owner: 'system14', operation: 'approved_payment', category: 'ordinary',
  actor_id: 'npc-1', player_action: false, actor_action: true, requires_choice: false,
  explicit_response_ref: null, delegation_ref: null, scope_expanded: false,
  knowledge_basis_refs: ['npc-known-agreement'], terms_ref: 'payment-terms', effect_scope_ref: 'agreement-1',
  resource_refs: ['funds-ref'], notification_ref: 'payment-notice' };
const offer = { id: 'offer-1', issuer_ref: 'npc-1', recipient_ref: 'player', terms_ref: 'terms-v1',
  channel_ref: 'channel-1', delivered_refs: [], available_until: 30, status: 'available' };
const offerMeta = { objective_ref: 'service', availability_window_ref: 'window-1', visibility: 'recipient',
  explicit_response_ref: null, accepted_terms_ref: null, expiry_or_withdrawal_cause_ref: null };
const journal = { id: 'j1', situation_id: 's1', actor_id: 'player', acquired_source_refs: ['delivery-1'],
  known_questions: ['is-service-restored'], known_terms: ['terms-v1'], communicated_deadlines: [], last_update_at: 1 };

function fixtures() {
  return {
    agency: { read: {
      authorize: { status: 'ok', authorized: true, scope: 'coordinator', actor_id: 'player' },
      binding: { status: 'ok', exists: true, compatible: true, authorized: true, knowledge_valid: true, task_accepted: true },
      validate_action: { status: 'ok', authorized: true, prerequisites_valid: true, revisions_current: true,
        content_allowed: true, explicit: false, delegation_valid: false },
      explicit_response: { status: 'ok', explicit: true, actor_id: 'player', offer_id: 'offer-1', terms_ref: 'terms-v1', choice: 'accept' }
    }, write: { commit_offer_terms: { status: 'committed', terms_ref: 'terms-v1', commitment_ref: 'commitment-1' } } },
    authoring: { read: {
      manifest: { status: 'ok', manifest: clone(manifest) },
      committed_causes: { status: 'ok', committed: true, event_refs: ['cause-1', 'owner-event-1', 'cause-2'] },
      pressure_definition: { status: 'ok', definition: { scope_ref: 'service', cause_refs: ['cause-1'],
        owner_refs: ['system13'], predicate_ref: 'operating-v1', timing_requirements_ref: null,
        confidence_requirements_ref: null, exclusions_ref: null, transition_rules_ref: 'transition-v1', next_review_at: null } },
      outcome_basis: { status: 'ok', committed: true, owner_event_refs: ['owner-event-1'], snapshot_ref: 'snapshot-1' },
      action: { status: 'ok', action: clone(action) },
      offer: { status: 'ok', feasible: true, offer: clone(offer), metadata: clone(offerMeta),
        unsolicited_major: true, urgent: false, accepted_obligation: false, physical_hazard: false },
      retirement: { status: 'ok', valid: true }
    } },
    system11: { read: { boundary: { status: 'ok', boundary_ref: 'b1', snapshot_ref: 'snapshot-1', canonical_time: 1,
      game_day_ref: 'day1', paused: false, choice_required: false, material_interruption: false,
      events: [{ id: 'owner-event-1', owner: 'system13', entity_ref: 'business', event_type: 'OperatingChanged',
        revision: 1, occurred_at: 1, cause_refs: ['cause-1'], committed: true }],
      revisions: [{ owner: 'system13', entity_ref: 'business', revision: 1 }] } } },
    system13: { read: { predicate: { status: 'ok', owner: 'system13', entity_ref: 'business',
      predicate_ref: 'operating-v1', scope_ref: 'service', read_context: 'simulation', snapshot_ref: 'snapshot-1',
      revision: 1, canonical_time: 1, value: true, exists: true, acquired_source_refs: [] } } },
    system14: { write: {
      reserve: { status: 'committed', reservation_refs: ['reservation-1'] },
      request_action: { status: 'committed', effect_key: key('effect', 'system14', 'agreement-1', 'approved_payment', 'payment-terms'),
        owner_event_refs: ['payment-event'], occurred_at: 1 },
      release_unused_reservations: { status: 'committed' }
    } },
    system16: { write: { schedule_delivery: { status: 'committed', task_ref: 'delivery-task-1' },
      deliver_offer: { status: 'committed', delivered_refs: ['delivery-1'] } } },
    knowledge: { read: { action_basis: { status: 'ok', valid: true, actor_id: 'npc-1' },
      known_story: { status: 'ok', allowed: true, projection: clone(journal) },
      story_access: { status: 'ok', allowed: true, actor_id: 'player', acquired_source_refs: ['delivery-1'] },
      known_available_offers: { status: 'ok', offer_refs: ['offer-1'] } } },
    ui: { read: { presentation_context: { status: 'ok', actor_id: 'player', scene_ref: 'scene-1', preferences_ref: 'preferences-v1' } },
      write: { known_update: { status: 'committed' } } }
  };
}

function harness(overrides = null, saved = null) {
  const f = fixtures(); overrides?.(f);
  const log = [];
  // Replace fixed fixture responses between commands; no external logic is implemented.
  const base = createMockDependencies();
  const dependencies = Object.fromEntries(Object.keys(base).map(owner => [owner,
    Object.fromEntries(['read', 'write'].map(direction => [direction, async request => {
      log.push({ owner, direction, request: clone(request) });
      return createMockDependencies(f)[owner][direction](request);
    }]))]));
  const engine = createSystem24({ dependencies, saved });
  let sequence = 0;
  const command = (type, data = {}, extra = {}) => ({ type, authority_ref: 'authority-1',
    expected_revision: data.situation_id ? engine.save().situation[data.situation_id]?.revision ?? null : null,
    canonical_time: f.system11.read.boundary.canonical_time, correlation_id: 'correlation-1',
    idempotency_key: `command-${++sequence}`, payload: data, ...extra });
  const send = (type, data = {}, extra = {}) => engine.dispatch(command(type, data, extra));
  return { f, log, engine, send, command };
}
async function ready(h, id = 's1') {
  if (!h.engine.save().situation_template[version]) assert.equal((await h.send('PublishTemplate', { template })).status, 'ok');
  const i = clone(instance); i.id = id; i.bindings_ref = `bindings-${id}`;
  const result = await h.send('InstantiateSituation', { instance: i, metadata, bindings: [binding], cause_refs: ['cause-1'] });
  assert.equal(result.status, 'ok', JSON.stringify(result));
}
async function watch(h, id = 'w1', sid = 's1', changes = {}) {
  return h.send('RegisterWatcher', { situation_id: sid,
    watcher: { ...clone(watcher), id, situation_id: sid, ...changes }, metadata: clone(watcherMeta) });
}
function snapshot(h, revision, value, time = revision) {
  const b = h.f.system11.read.boundary;
  b.boundary_ref = `b${revision}`; b.snapshot_ref = `snapshot-${revision}`; b.canonical_time = time;
  b.events = [{ ...b.events[0], id: `owner-event-${revision}`, revision, occurred_at: time }];
  b.revisions[0].revision = revision;
  Object.assign(h.f.system13.read.predicate, { revision, value, canonical_time: time, snapshot_ref: b.snapshot_ref });
  h.f.authoring.read.outcome_basis.snapshot_ref = b.snapshot_ref;
}

test('all external endpoints default to pending dummy JSON', async () => {
  const deps = createMockDependencies();
  for (const dep of Object.values(deps)) for (const direction of ['read', 'write'])
    assert.equal((await dep[direction]({ operation: 'anything' })).status, 'pending');
});
test('state rejects unlisted fields; default state uses only architecture records', () => {
  const s = new System24State(); assert.equal(Object.keys(s).length, 16);
  assert.throws(() => new System24State({ ...s.toJSON(), money: 100 }));
  assert.deepEqual(s.versioned_policy_defaults, DEFAULT_LIMITS);
});
test('unknown dependencies do not authorize activation', async () => {
  const e = createSystem24();
  const r = await e.dispatch({ type: 'PublishTemplate', authority_ref: 'a', expected_revision: null,
    canonical_time: 0, correlation_id: 'c', idempotency_key: 'i', payload: { template } });
  assert.deepEqual(r, { status: 'rejected', reason: 'missing_access' });
  assert.equal(Object.keys(e.save().situation).length, 0);
});
test('activation validates real causes and bindings, without phantom records', async () => {
  const h = harness(f => { f.agency.read.binding.exists = false; });
  await h.send('PublishTemplate', { template });
  const r = await h.send('InstantiateSituation', { instance, metadata, bindings: [binding], cause_refs: ['cause-1'] });
  assert.equal(r.reason, 'unavailable_binding'); assert.equal(Object.keys(h.engine.save().situation).length, 0);
});
test('successful creation retains reference state only', async () => {
  const h = harness(); await ready(h);
  assert.equal(h.engine.save().situation.s1.state, 'active');
  assert.equal(h.engine.save().instance_metadata.s1.origin_kind, 'emergent');
  assert.equal(h.log.filter(x => x.direction === 'write').length, 0);
});
test('same true snapshot, multiple watchers: one scoped outcome, no foreign reward', async () => {
  const h = harness(); await ready(h); await watch(h); await watch(h, 'w2');
  assert.equal((await h.send('ProcessBoundary', { boundary_ref: 'b1' })).status, 'ok');
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  const s = h.engine.save();
  assert.equal(Object.keys(s.outcome_assessment).length, 1);
  assert.equal(s.watcher.w1.edge_ordinal, 1); assert.equal(s.watcher.w2.edge_ordinal, 1);
  assert.equal(s.situation.s1.state, 'active');
  assert.equal(h.log.filter(x => x.direction === 'write').length, 0);
  assert.equal(Object.keys(s.journal_projection).length, 0);
});
test('rising edge rearms only after a new nontrue snapshot', async () => {
  const h = harness(); await ready(h); await watch(h);
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  snapshot(h, 2, false); await h.send('ProcessBoundary', { boundary_ref: 'b2' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
  snapshot(h, 3, true); await h.send('ProcessBoundary', { boundary_ref: 'b3' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 2);
});
test('unknown and missing entity do not become successful outcomes', async () => {
  const h = harness(); await ready(h); await watch(h);
  snapshot(h, 2, 'unknown'); await h.send('ProcessBoundary', { boundary_ref: 'b2' });
  assert.equal(h.engine.save().watcher.w1.last_value, 'unknown');
  assert.equal(Object.keys(h.engine.save().outcome_assessment).length, 0);
  snapshot(h, 3, true); h.f.system13.read.predicate.exists = false;
  await h.send('ProcessBoundary', { boundary_ref: 'b3' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 0);
  assert.ok(h.engine.save().presentation_and_runtime.partition.deferred_review_refs.includes('binding-review:s1'));
});
test('malformed executable predicates, missing tables, broad scope and limits fail closed', async () => {
  for (const mutate of [
    m => { m.activation_condition = { op: 'eval', source: 'process.exit()' }; },
    m => { delete m.truth_tables.not.unknown; },
    m => { m.activation_condition.entity_ref = '*'; },
    m => { m.activation_condition = { op: 'all', args: Array.from({ length: 21 }, () => clone(predicate)) }; }
  ]) {
    const h = harness(f => mutate(f.authoring.read.manifest.manifest));
    assert.equal((await h.send('PublishTemplate', { template })).status, 'rejected');
    assert.equal(Object.keys(h.engine.save().situation_template).length, 0);
  }
});
test('incomplete event subscriptions rejected', async () => {
  const h = harness(); await ready(h);
  assert.equal((await watch(h, 'w1', 's1', { subscriptions: [] })).status, 'rejected');
});
test('hidden watcher cannot acquire knowledge or publish actor-visible output', async () => {
  const h = harness(); await ready(h);
  const r = await h.send('RegisterWatcher', { situation_id: 's1', watcher,
    metadata: { ...watcherMeta, visibility: 'player' } });
  assert.equal(r.reason, 'missing_access');
});
test('actor watcher without access evaluates unknown without reading hidden owner fact', async () => {
  const h = harness(); await ready(h);
  h.f.system13.read.predicate.read_context = { actor_id: 'player' };
  await watch(h, 'w1', 's1', { read_context: { actor_id: 'player' } });
  h.log.length = 0;
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.last_value, 'unknown');
  assert.equal(h.log.filter(x => x.owner === 'system13').length, 0);
});
test('declared resolved transition retires watchers but leaves unrelated owner state alone', async () => {
  const h = harness(); await ready(h); await watch(h);
  const r = await h.send('ProposeTransition', { situation_id: 's1', to: 'resolved', cause_refs: ['cause-1'], lineage_refs: [] });
  assert.equal(r.status, 'ok'); assert.equal(h.engine.save().watcher.w1.status, 'retired');
  assert.equal(h.log.filter(x => x.direction === 'write').length, 0);
});
test('undeclared transition cannot reopen a resolved problem', async () => {
  const h = harness(); await ready(h);
  await h.send('ProposeTransition', { situation_id: 's1', to: 'resolved', cause_refs: ['cause-1'], lineage_refs: [] });
  assert.equal((await h.send('ProposeTransition', { situation_id: 's1', to: 'active', cause_refs: ['cause-1'], lineage_refs: [] })).status, 'rejected');
});
test('transformation preserves source history and records lineage to an existing instance', async () => {
  const h = harness(); await ready(h); await ready(h, 's2');
  assert.equal((await h.send('TransformSituation', { situation_id: 's1', to: 'transformed',
    cause_refs: ['cause-1'], lineage_refs: ['s2'] })).status, 'ok');
  assert.deepEqual(h.engine.save().instance_metadata.s2.lineage_refs, ['s1']);
  assert.deepEqual(h.engine.save().instance_metadata.s1.creation_cause_refs, ['cause-1']);
});
test('durable workflow retries a pending notice without a repeated material effect', async () => {
  const h = harness(f => { f.system16.write.schedule_delivery = { status: 'pending' }; });
  await ready(h);
  const started = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  const r = await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: started.workflow_id });
  assert.equal(r.status, 'pending');
  const saved = h.engine.save();
  assert.deepEqual(saved.durable_workflow[started.workflow_id].committed_owner_result_refs, ['payment-event']);
  const resumed = harness(null, saved);
  const next = await resumed.send('ResumeWorkflow', { situation_id: 's1', workflow_id: started.workflow_id }, { idempotency_key: 'resume-after-reload' });
  assert.equal(next.status, 'ok');
  assert.equal(resumed.log.filter(x => x.request.operation === 'request_action').length, 0);
  assert.equal(resumed.log.filter(x => x.request.operation === 'reserve').length, 0);
});
test('shared agreement effects deduplicate across independent situations', async () => {
  const h = harness(); await ready(h); await ready(h, 's2');
  for (const sid of ['s1', 's2']) {
    const w = await h.send('BeginWorkflow', { situation_id: sid, action_ref: 'payment-v1', cause_refs: ['cause-1'] });
    assert.equal((await h.send('ResumeWorkflow', { situation_id: sid, workflow_id: w.workflow_id })).status, 'ok');
  }
  assert.equal(h.log.filter(x => x.request.operation === 'request_action').length, 1);
});
test('new player commitment stops before owner request and persists the choice', async () => {
  const h = harness(f => { f.authoring.read.action.action.player_action = true; }); await ready(h);
  const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id })).status, 'choice_required');
  assert.equal(h.engine.save().instance_metadata.s1.pending_choice_ref, 'payment-v1');
  assert.equal(h.log.filter(x => x.request.operation === 'request_action').length, 0);
});
test('routine delegation cannot authorize romance, crimes, testimony or affiliation', async () => {
  for (const category of ['romance', 'crime', 'testimony', 'affiliation']) {
    const h = harness(f => {
      Object.assign(f.authoring.read.action.action, { player_action: true, delegation_ref: 'delegation', category });
      f.agency.read.validate_action.delegation_valid = true;
    }); await ready(h);
    const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
    assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id })).status, 'choice_required');
  }
});
test('stale owner revisions block effects', async () => {
  const h = harness(f => { f.agency.read.validate_action.revisions_current = false; }); await ready(h);
  const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id })).status, 'pending');
  assert.equal(h.log.filter(x => x.request.operation === 'request_action').length, 0);
});
test('offer delivery never creates acceptance; explicit response attaches exact owner terms', async () => {
  const h = harness(); await ready(h);
  assert.equal((await h.send('SurfaceOffer', { situation_id: 's1', offer_ref: 'offer-v1' })).status, 'ok');
  assert.equal(h.engine.save().story_offer['offer-1'].status, 'delivered');
  assert.deepEqual(h.engine.save().situation.s1.owner_commitments, []);
  assert.equal((await h.send('RespondToOffer', { situation_id: 's1', offer_id: 'offer-1', response_ref: 'response-1' })).status, 'ok');
  assert.deepEqual(h.engine.save().situation.s1.owner_commitments, ['commitment-1']);
});
test('decline has no punitive effect and silence is not agreement', async () => {
  const h = harness(f => { f.agency.read.explicit_response.choice = 'decline'; }); await ready(h);
  await h.send('SurfaceOffer', { situation_id: 's1', offer_ref: 'offer-v1' });
  h.log.length = 0;
  await h.send('RespondToOffer', { situation_id: 's1', offer_id: 'offer-1', response_ref: 'response-1' });
  assert.deepEqual(h.engine.save().situation.s1.owner_commitments, []);
  assert.equal(h.log.filter(x => x.direction === 'write').length, 0);
});
test('owner cannot expand terms silently', async () => {
  const h = harness(f => { f.agency.write.commit_offer_terms.terms_ref = 'extra-chores'; }); await ready(h);
  await h.send('SurfaceOffer', { situation_id: 's1', offer_ref: 'offer-v1' });
  assert.equal((await h.send('RespondToOffer', { situation_id: 's1', offer_id: 'offer-1', response_ref: 'response-1' })).status, 'pending');
  assert.deepEqual(h.engine.save().situation.s1.owner_commitments, []);
});
test('known journal comes only from acquisition; hide is display-only', async () => {
  const h = harness(); await ready(h); await watch(h);
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal((await h.send('GetKnownStory', { situation_id: 's1', actor_id: 'player' })).journals.length, 0);
  await h.send('AcquireJournal', { situation_id: 's1', actor_id: 'player', acquisition_refs: ['delivery-1'] });
  await h.send('HideJournal', { situation_id: 's1', actor_id: 'player', hidden: true });
  const known = await h.send('GetKnownStory', { situation_id: 's1', actor_id: 'player' });
  assert.equal(known.hidden, true); assert.deepEqual(known.journals[0], journal);
  assert.equal(h.engine.save().situation.s1.state, 'active');
  assert.ok(!JSON.stringify(known).includes('snapshot-1'));
});
test('unauthorized actor cannot inspect a journal or reuse a hidden internal result', async () => {
  const h = harness(); await ready(h);
  const r = await h.send('GetKnownStory', { situation_id: 's1', actor_id: 'rival' });
  assert.deepEqual(r, { status: 'rejected', reason: 'missing_access' });
});
test('command retry is byte-stable; reused key with changed content rejected', async () => {
  const h = harness(); await ready(h);
  const cmd = h.command('ReviewOutcome', { situation_id: 's1', scope_ref: 'service', cause_refs: ['cause-1'] });
  const first = await h.engine.dispatch(cmd); const second = await h.engine.dispatch(cmd);
  assert.deepEqual(first, second);
  assert.equal((await h.engine.dispatch({ ...cmd, payload: { ...cmd.payload, scope_ref: 'secret' } })).reason, 'idempotency_conflict');
});
test('pause and fast-forward choice stop do not evaluate or advance story time', async () => {
  const h = harness(); await ready(h); await watch(h);
  h.f.system11.read.boundary.paused = true;
  assert.equal((await h.send('ProcessBoundary', { boundary_ref: 'b1' })).status, 'paused');
  h.f.system11.read.boundary.paused = false; h.f.system11.read.boundary.choice_required = true;
  assert.equal((await h.send('ProcessBoundary', { boundary_ref: 'b1' })).status, 'choice_required');
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 0);
});
test('deadline due time queues one owner review and never imposes a consequence', async () => {
  const h = harness(); await ready(h);
  const deadline = { id: 'deadline-1', version: 'v1', kind: 'resource_pressure', cause_refs: ['cause-1'],
    starts_at: 0, due_at: 1, owner_ref: 'system13', scope_ref: 'service', known_notice_refs: [],
    review_policy_ref: 'deadline-policy-v1', possible_effect_refs: [] };
  h.f.system13.read.deadline = { status: 'ok', committed: true, deadline };
  h.f.system13.read.current_deadline = { status: 'ok', version: 'v1', cancelled: false };
  h.f.system13.write = { review_deadline: { status: 'committed', task_ref: 'deadline-task' } };
  assert.equal((await h.send('RegisterDeadline', { situation_id: 's1', deadline })).status, 'ok');
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.log.filter(x => x.request.operation === 'review_deadline').length, 1);
  assert.equal(h.engine.save().situation.s1.state, 'active');
});
test('save/reload retains edges, scoped assessments, versions and pending references', async () => {
  const h = harness(); await ready(h); await watch(h); await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  const saved = h.engine.save(); const reload = createSystem24({ saved, dependencies: createMockDependencies(h.f) });
  assert.equal(canonical(reload.save()), canonical(saved));
});
test('template versions are immutable and fixed hidden facts cannot be overwritten', async () => {
  const h = harness(); await ready(h);
  assert.equal((await h.send('PublishTemplate', { template: { ...template, premise_ref: 'new-culprit' } })).status, 'rejected');
  assert.equal((await h.send('SetHiddenTruth', { situation_id: 's1', culprit: 'other' })).status, 'rejected');
});

test('failed outcome review resumes the same stored edge at a quiet boundary', async () => {
  const h = harness(); await ready(h); await watch(h);
  h.f.authoring.read.outcome_basis.status = 'pending';
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.status, 'fired');
  h.f.authoring.read.outcome_basis.status = 'ok';
  h.f.system11.read.boundary.events = [];
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(Object.keys(h.engine.save().outcome_assessment).length, 1);
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
});

test('single-fire watcher retires only after a committed scoped assessment', async () => {
  const h = harness(f => { f.authoring.read.manifest.manifest.watcher_rules['outcome-v1'].trigger_policy = 'single_fire'; });
  await ready(h); await watch(h, 'w1', 's1', { trigger_policy: 'single_fire' });
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.status, 'retired');
  snapshot(h, 2, false); await h.send('ProcessBoundary', { boundary_ref: 'b2' });
  snapshot(h, 3, true); await h.send('ProcessBoundary', { boundary_ref: 'b3' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
});

test('watchers sharing a workflow all settle after one owner effect', async () => {
  const h = harness(f => {
    Object.assign(f.authoring.read.manifest.manifest.watcher_rules['outcome-v1'], {
      kind: 'pressure', output_category: 'review_pressure', outcome_scope: null, action_ref: 'payment-v1'
    });
  }); await ready(h);
  for (const id of ['w1', 'w2']) assert.equal((await h.send('RegisterWatcher', { situation_id: 's1',
    watcher: { ...clone(watcher), id }, metadata: { ...clone(watcherMeta), kind: 'pressure', allowed_output_categories: ['review_pressure'] }
  })).status, 'ok');
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  const ids = Object.keys(h.engine.save().durable_workflow); assert.equal(ids.length, 1);
  assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: ids[0] })).status, 'ok');
  for (const w of Object.values(h.engine.save().watcher)) {
    assert.equal(w.pending_workflow, null); assert.equal(w.status, 'armed');
  }
});

test('explicit choice resumes a waiting player action without rewriting the action definition', async () => {
  const h = harness(f => { f.authoring.read.action.action.player_action = true; }); await ready(h);
  const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id });
  Object.assign(h.f.agency.read.validate_action, { explicit: true, explicit_response_ref: 'player-choice-1',
    action_ref: 'payment-v1', actor_id: 'npc-1' });
  assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id,
    response_ref: 'player-choice-1' })).status, 'ok');
  assert.equal(h.engine.save().instance_metadata.s1.pending_choice_ref, null);
  assert.equal(h.log.find(x => x.request.operation === 'request_action').request.explicit_response_ref, 'player-choice-1');
});

test('terminal cleanup cancels an unstarted action without performing it', async () => {
  const h = harness(); await ready(h);
  const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  await h.send('ProposeTransition', { situation_id: 's1', to: 'resolved', cause_refs: ['cause-1'], lineage_refs: [] });
  assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id })).status, 'cancelled');
  assert.equal(h.log.filter(x => x.request.operation === 'request_action').length, 0);
});

test('terminal cleanup preserves committed payments and completes pending delivery', async () => {
  const h = harness(f => { f.system16.write.schedule_delivery = { status: 'pending' }; }); await ready(h);
  const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id });
  await h.send('ProposeTransition', { situation_id: 's1', to: 'resolved', cause_refs: ['cause-1'], lineage_refs: [] });
  h.f.system16.write.schedule_delivery = { status: 'committed', task_ref: 'delivered-later' };
  assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id })).status, 'ok');
  assert.deepEqual(h.engine.save().durable_workflow[w.workflow_id].committed_owner_result_refs, ['payment-event']);
  assert.equal(h.log.filter(x => x.request.operation === 'request_action').length, 1);
  assert.equal(h.log.filter(x => x.request.operation === 'release_unused_reservations').length, 1);
});

test('terminal reservation cleanup reconciles an uncommitted pending owner request', async () => {
  const h = harness(f => {
    f.system14.write.request_action = { status: 'pending' };
    f.system14.read = { effect_status: { status: 'not_committed' } };
  }); await ready(h);
  const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id });
  await h.send('ProposeTransition', { situation_id: 's1', to: 'resolved', cause_refs: ['cause-1'], lineage_refs: [] });
  assert.equal((await h.send('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id })).status, 'cancelled');
  assert.equal(h.log.filter(x => x.request.operation === 'release_unused_reservations').length, 1);
  assert.deepEqual(h.engine.save().durable_workflow[w.workflow_id].committed_owner_result_refs, []);
});

test('AI/UI unavailability cannot erase acquired state or disable deterministic queries', async () => {
  const h = harness(f => { f.ui.read.presentation_context = { status: 'pending' }; }); await ready(h);
  assert.equal((await h.send('AcquireJournal', { situation_id: 's1', actor_id: 'player', acquisition_refs: ['delivery-1'] })).status, 'ok');
  const result = await h.send('GetKnownStory', { situation_id: 's1', actor_id: 'player' }, { expected_revision: null });
  assert.deepEqual(result.journals, [journal]);
});

test('versioned manifest changes cannot change an active instance in place', async () => {
  const h = harness(); await ready(h);
  h.f.authoring.read.manifest.manifest.outcomes.service.conclusion = 'different_outcome';
  assert.equal((await h.send('ReviewOutcome', { situation_id: 's1', scope_ref: 'service', cause_refs: ['cause-1'] })).reason, 'stale_state');
});

test('same entity revision cannot produce contradictory condition values', async () => {
  const h = harness(); await ready(h); await watch(h);
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  h.f.system13.read.predicate.value = false;
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.last_value, true);
  assert.ok(h.engine.save().presentation_and_runtime.partition.deferred_review_refs.includes('watcher:w1'));
});

test('the ninth follow-on round is deferred without dropping required owner deadline review', async () => {
  const h = harness(); await ready(h); await watch(h);
  for (let i = 0; i < 8; i++) await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  const r = await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(r.status, 'deferred');
  assert.ok(h.engine.save().presentation_and_runtime.partition.deferred_review_refs.includes('watcher:w1'));
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
});

test('watcher capacity defers registration and preserves the watcher for later activation', async () => {
  const initial = new System24State().toJSON();
  initial.versioned_policy_defaults.max_active_watchers_per_situation = 1;
  const h = harness(null, initial); await ready(h);
  assert.equal((await watch(h)).status, 'ok'); assert.equal((await watch(h, 'w2')).status, 'deferred');
  await h.send('RetireWatcher', { situation_id: 's1', watcher_id: 'w1', reason_ref: 'scope-ended' });
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w2.status, 'armed');
});

test('one unsolicited major offer per day; urgent messages bypass the presentation cap', async () => {
  const h = harness(); await ready(h);
  await h.send('SurfaceOffer', { situation_id: 's1', offer_ref: 'offer-v1' });
  h.f.authoring.read.offer.offer.id = 'offer-2';
  assert.equal((await h.send('SurfaceOffer', { situation_id: 's1', offer_ref: 'offer-v1' })).status, 'deferred');
  h.f.authoring.read.offer.urgent = true;
  assert.equal((await h.send('SurfaceOffer', { situation_id: 's1', offer_ref: 'offer-v1' })).status, 'ok');
});

test('low urgency cap defers only notifications, preserving newly acquired journal truth', async () => {
  const h = harness(); await ready(h);
  for (let i = 1; i <= 4; i++) {
    h.f.knowledge.read.known_story.projection.known_questions = [`question-${i}`];
    const r = await h.send('AcquireJournal', { situation_id: 's1', actor_id: 'player', acquisition_refs: ['delivery-1'] });
    assert.equal(r.surfaced, i <= 3);
  }
  assert.deepEqual(h.engine.save().journal_projection.j1.known_questions, ['question-4']);
  h.f.knowledge.read.known_story.urgent = true;
  assert.equal((await h.send('AcquireJournal', { situation_id: 's1', actor_id: 'player', acquisition_refs: ['delivery-1'] })).surfaced, true);
});

test('simultaneous stale commands cannot both change a situation', async () => {
  const h = harness(); await ready(h);
  const a = h.command('ProposeTransition', { situation_id: 's1', to: 'contained', cause_refs: ['cause-1'], lineage_refs: [] });
  const b = h.command('ProposeTransition', { situation_id: 's1', to: 'resolved', cause_refs: ['cause-1'], lineage_refs: [] });
  const results = await Promise.all([h.engine.dispatch(a), h.engine.dispatch(b)]);
  assert.equal(results[0].status, 'ok'); assert.equal(results[1].reason, 'stale_state');
});

test('due watcher fires from canonical time even without subscribed events', async () => {
  const deadlineRef = key('deadline', 'deadline-1', 'v1');
  const h = harness(f => Object.assign(f.authoring.read.manifest.manifest.watcher_rules['outcome-v1'],
    { trigger_policy: 'due_time', deadline_ref: deadlineRef }));
  await ready(h);
  const deadline = { id: 'deadline-1', version: 'v1', kind: 'resource_pressure', cause_refs: ['cause-1'],
    starts_at: 0, due_at: 1, owner_ref: 'system13', scope_ref: 'service', known_notice_refs: [],
    review_policy_ref: 'deadline-policy-v1', possible_effect_refs: [] };
  h.f.system13.read.deadline = { status: 'ok', committed: true, deadline };
  await h.send('RegisterDeadline', { situation_id: 's1', deadline });
  h.f.system13.read.current_deadline = { status: 'ok', version: 'v1', cancelled: false };
  assert.equal((await watch(h, 'w1', 's1', { trigger_policy: 'due_time' })).status, 'ok');
  h.f.system11.read.boundary.events = [];
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
});

test('cadenced level policy requires explicit cadence and a material basis', async () => {
  const h = harness(f => Object.assign(f.authoring.read.manifest.manifest.watcher_rules['outcome-v1'],
    { trigger_policy: 'cadenced_level', cadence: 2 })); await ready(h);
  await h.send('RegisterWatcher', { situation_id: 's1', watcher: { ...watcher, trigger_policy: 'cadenced_level' },
    metadata: { ...watcherMeta, next_review_at: 1 } });
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
  snapshot(h, 2, true, 2); await h.send('ProcessBoundary', { boundary_ref: 'b2' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
  snapshot(h, 3, true, 3); await h.send('ProcessBoundary', { boundary_ref: 'b3' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 2);
});

test('events observed at a choice stop remain queued until a later boundary', async () => {
  const h = harness(); await ready(h); await watch(h);
  h.f.system11.read.boundary.choice_required = true;
  assert.equal((await h.send('ProcessBoundary', { boundary_ref: 'b1' })).status, 'choice_required');
  assert.ok(h.engine.save().presentation_and_runtime.partition.deferred_review_refs.some(x => x.startsWith('event:')));
  h.f.system11.read.boundary.choice_required = false;
  h.f.system11.read.boundary.events = [];
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 1);
  assert.ok(!h.engine.save().presentation_and_runtime.partition.deferred_review_refs.some(x => x.startsWith('event:')));
});

test('journal history retains only sourced actor-visible projections', async () => {
  const h = harness(); await ready(h);
  await h.send('AcquireJournal', { situation_id: 's1', actor_id: 'player', acquisition_refs: ['delivery-1'] });
  h.f.knowledge.read.known_story.projection.known_questions = ['newly-acquired-answer'];
  await h.send('AcquireJournal', { situation_id: 's1', actor_id: 'player', acquisition_refs: ['delivery-1'] });
  const result = await h.send('GetKnownSituationHistory', { situation_id: 's1', actor_id: 'player' });
  assert.equal(result.history.length, 2);
  assert.deepEqual(result.history[0].known_questions, ['is-service-restored']);
  assert.deepEqual(result.history[1].known_questions, ['newly-acquired-answer']);
  h.f.knowledge.read.story_access.acquired_source_refs = [];
  assert.deepEqual((await h.send('GetKnownSituationHistory', { situation_id: 's1', actor_id: 'player' })).history, []);
});

test('known offered terms do not masquerade as accepted commitments', async () => {
  const h = harness(); await ready(h);
  await h.send('AcquireJournal', { situation_id: 's1', actor_id: 'player', acquisition_refs: ['delivery-1'] });
  assert.deepEqual((await h.send('GetAcceptedCommitments', { situation_id: 's1', actor_id: 'player' })).commitments, []);
  h.f.knowledge.read.known_commitments = { status: 'ok', actor_id: 'player', commitments: [
    { commitment_ref: 'actual-duty', terms_ref: 'terms-v1', acquired_source_refs: ['delivery-1'] }
  ] };
  assert.equal((await h.send('GetAcceptedCommitments', { situation_id: 's1', actor_id: 'player' })).commitments.length, 1);
});

test('existing owner obligations can attach at activation without story acceptance', async () => {
  const h = harness(); await h.send('PublishTemplate', { template });
  h.f.agency.read.existing_commitment = { status: 'ok', committed: true, accepted_terms_ref: 'employment-terms' };
  const r = await h.send('InstantiateSituation', { instance: { ...instance, owner_commitments: ['shift-1'] },
    metadata, bindings: [binding], cause_refs: ['cause-1'] });
  assert.equal(r.status, 'ok');
  await h.send('HideJournal', { situation_id: 's1', actor_id: 'player', hidden: true });
  assert.deepEqual(h.engine.save().situation.s1.owner_commitments, ['shift-1']);
});

test('superseded deadline versions cannot fire a new watcher edge', async () => {
  const ref = key('deadline', 'deadline-1', 'v1');
  const h = harness(f => Object.assign(f.authoring.read.manifest.manifest.watcher_rules['outcome-v1'],
    { trigger_policy: 'due_time', deadline_ref: ref })); await ready(h);
  const deadline = { id: 'deadline-1', version: 'v1', kind: 'resource_pressure', cause_refs: ['cause-1'],
    starts_at: 0, due_at: 1, owner_ref: 'system13', scope_ref: 'service', known_notice_refs: [],
    review_policy_ref: 'deadline-policy-v1', possible_effect_refs: [] };
  h.f.system13.read.deadline = { status: 'ok', committed: true, deadline };
  h.f.system13.read.current_deadline = { status: 'ok', version: 'v2', cancelled: false };
  await h.send('RegisterDeadline', { situation_id: 's1', deadline });
  await watch(h, 'w1', 's1', { trigger_policy: 'due_time' });
  await h.send('ProcessBoundary', { boundary_ref: 'b1' });
  assert.equal(h.engine.save().watcher.w1.edge_ordinal, 0);
  assert.equal(h.engine.save().watcher.w1.status, 'retired');
});

test('the identical pending workflow command resumes with unchanged command and effect keys', async () => {
  const h = harness(f => { f.system16.write.schedule_delivery = { status: 'pending' }; }); await ready(h);
  const w = await h.send('BeginWorkflow', { situation_id: 's1', action_ref: 'payment-v1', cause_refs: ['cause-1'] });
  const command = h.command('ResumeWorkflow', { situation_id: 's1', workflow_id: w.workflow_id });
  assert.equal((await h.engine.dispatch(command)).status, 'pending');
  h.f.system16.write.schedule_delivery = { status: 'committed', task_ref: 'delivery-retried' };
  assert.equal((await h.engine.dispatch(command)).status, 'ok');
  assert.equal((await h.engine.dispatch(command)).status, 'ok');
  assert.equal(h.log.filter(x => x.request.operation === 'request_action').length, 1);
  const notices = h.log.filter(x => x.request.operation === 'schedule_delivery');
  assert.equal(notices.length, 2);
  assert.equal(notices[0].request.effect_key, notices[1].request.effect_key);
});

test('a pending acceptance retry cannot override a newer explicit decline', async () => {
  const h = harness(f => { f.agency.write.commit_offer_terms = { status: 'pending' }; }); await ready(h);
  await h.send('SurfaceOffer', { situation_id: 's1', offer_ref: 'offer-v1' });
  const accept = h.command('RespondToOffer', { situation_id: 's1', offer_id: 'offer-1', response_ref: 'accept-1' });
  assert.equal((await h.engine.dispatch(accept)).status, 'pending');
  h.f.agency.read.explicit_response.choice = 'decline';
  await h.send('RespondToOffer', { situation_id: 's1', offer_id: 'offer-1', response_ref: 'decline-2' });
  assert.equal((await h.engine.dispatch(accept)).reason, 'stale_state');
  assert.deepEqual(h.engine.save().situation.s1.owner_commitments, []);
});
