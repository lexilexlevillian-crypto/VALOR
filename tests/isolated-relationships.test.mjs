import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIMENSIONS, RelationshipState, emptySnapshot, examplePolicy,
  relationshipStateMachine, requestCanonicalEvent, requestSystem3Knowledge,
  requestPlayerCreatorControls, domainTrustEvidence,
} from '../src/isolated-relationships/index.mjs';

// These adapters return explicit JSON fixtures. They do not implement any other system.
const pair = { observer_id: 'npc-observer', target_id: 'npc-target' };
const reversed = { observer_id: pair.target_id, target_id: pair.observer_id };
const date = '2026-01-01T12:00:00Z';
const copy = value => JSON.parse(JSON.stringify(value));
const edge = result => result.snapshot.state.relationship_edges[0];
const record = (table, value) => ({ table, record: value });

function fixtures(definitions = {}, overrides = {}) {
  return {
    canonical: request => ({ ...requestCanonicalEvent(request), ...(definitions[request.source_event_id]?.canonical ?? {}) }),
    knowledge: request => {
      const entry = definitions[request.source_event_id] ?? {};
      const def = entry.by_observer?.[request.observer_id] ?? entry;
      const base = requestSystem3Knowledge(request);
      const type = def.type ?? 'reliability';
      return { ...base, known: def.known ?? true, view: {
        ...base.view, event_type: type, allowed_event_types: [type],
        supported_dimensions: Object.keys(examplePolicy().templates[type] ?? {}),
        ...copy(def.view ?? {}),
      } };
    },
    controls: request => ({ ...requestPlayerCreatorControls(), ...copy(definitions[request.source_event_id]?.controls ?? {}) }),
    ...overrides,
  };
}

function ingest(source_event_id, adapters = fixtures(), snapshot = emptySnapshot('main'), policy = examplePolicy()) {
  return relationshipStateMachine({ operation: 'ingest', snapshot, policy, source_event_id }, adapters);
}
function committed(result) {
  assert.equal(result.status, 'committed', JSON.stringify(result.error));
  return result;
}

test('state uses exactly declared collections; missing dimensions are rejected rather than defaulted', () => {
  const s = emptySnapshot('main');
  const state = new RelationshipState(s.state);
  assert.deepEqual(Object.keys(state), Object.keys(s.state));
  assert.throws(() => new RelationshipState({ ...s.state, friendship_score: 1 }));
  const r = committed(ingest('e1'));
  delete edge(r).trust;
  const restored = relationshipStateMachine({ operation: 'restore', snapshot: r.snapshot, policy: examplePolicy() });
  assert.equal(restored.status, 'rejected');
  assert.equal(restored.error.code, 'invalid_contract');
});

test('directional effects, labels, and first-impression confidence are independent', () => {
  const adapters = fixtures({ e1: { canonical: { pairs: [pair, reversed] }, by_observer: {
    [pair.observer_id]: { type: 'care', view: { subjective_label: 'friend' } },
    [reversed.observer_id]: { type: 'harm', view: { subjective_label: 'rival' } },
  } } });
  const r = committed(ingest('e1', adapters));
  assert.equal(r.snapshot.state.relationship_edges.length, 2);
  assert.equal(edge(r).affection, 2);
  assert.equal(edge(r).subjective_label, 'friend');
  assert.equal(r.snapshot.state.relationship_edges[1].trust, -2);
  assert.equal(r.snapshot.state.relationship_edges[1].subjective_label, 'rival');
  assert.equal(r.snapshot.state.relationship_events[0].interpretation_confidence, 0.35);
});

test('reload does not reapply events or redeliver notifications', () => {
  let commits = 0;
  const adapters = fixtures({}, { commit: () => { commits += 1; return { accepted: true }; } });
  const first = committed(ingest('e1', adapters));
  const restored = relationshipStateMachine({ operation: 'restore', snapshot: copy(first.snapshot), policy: examplePolicy() }, adapters);
  assert.equal(restored.status, 'restored');
  const duplicate = ingest('e1', adapters, restored.snapshot);
  assert.equal(duplicate.status, 'unchanged');
  assert.deepEqual(duplicate.snapshot, first.snapshot);
  assert.deepEqual(duplicate.outbox, []);
  assert.equal(commits, 1);
});

test('unknown events create no edge; a later learned event applies once', () => {
  const unseen = ingest('e1', fixtures({ e1: { known: false } }));
  assert.equal(unseen.status, 'unchanged');
  assert.equal(unseen.snapshot.state.relationship_edges.length, 0);
  const learned = committed(ingest('e1', fixtures(), unseen.snapshot));
  assert.equal(edge(learned).trust, 2);
});

test('AI failure and unsupported AI claims fall back without hidden context', () => {
  let received;
  const adapters = fixtures({ e1: { canonical: { hidden_motive: 'secret truth' } } }, {
    memory: () => ({ memories: [{ source_event_id: 'unknown-source', text: 'secret diagnosis' }] }),
    ai: request => { received = request; return { proposal: { invented: 'arbitrary friendship meter' } }; },
  });
  const r = committed(ingest('e1', adapters));
  assert.equal(edge(r).trust, 2);
  assert.equal(JSON.stringify(received).includes('secret'), false);
  assert.deepEqual(received.memories, []);
  assert(r.snapshot.state.relationship_deltas.every(d => d.modifier_tags.includes('interpretation:deterministic_fallback')));
  const failure = committed(ingest('e2', fixtures({}, { ai: () => { throw Error('offline'); } }), r.snapshot));
  assert.equal(edge(failure).trust, 4);
});

test('player emotional delegation is scoped, reversible, and independent of NPC direction', () => {
  const players = [{ entity_id: pair.observer_id, kind: 'player' }, { entity_id: pair.target_id, kind: 'npc' }];
  const definitions = {
    e1: { canonical: { entities: players, pairs: [pair, reversed] } },
    e2: { canonical: { entities: players }, controls: { delegations: [
      { ...pair, dimensions: ['trust'], active: true },
    ] } },
    e3: { canonical: { entities: players }, controls: { delegations: [
      { ...pair, dimensions: ['trust'], active: false },
    ] } },
  };
  const adapters = fixtures(definitions);
  const first = committed(ingest('e1', adapters));
  assert.equal(edge(first).trust, 0);
  assert.equal(edge(first).familiarity, 1);
  assert.equal(first.snapshot.state.relationship_edges[1].trust, 2);
  const delegated = committed(ingest('e2', adapters, first.snapshot));
  assert.equal(edge(delegated).trust, 2);
  const revoked = committed(ingest('e3', adapters, delegated.snapshot));
  assert.equal(edge(revoked).trust, 2);
  assert(revoked.outbox.filter(m => m.destination === 'System 6').every(m => m.payload.pressure_only));
});

test('emotional delegation never authorizes player forgiveness or reconciliation decisions', () => {
  const r = ingest('e1', fixtures({ e1: {
    type: 'forgiveness', canonical: { entities: [
      { entity_id: pair.observer_id, kind: 'player' }, { entity_id: pair.target_id, kind: 'npc' },
    ] },
    view: { reason_tags: ['forgiveness:explicit_decision'] },
    controls: { delegations: [{ ...pair, dimensions: [...DIMENSIONS], active: true }] },
  } }));
  assert.equal(r.status, 'rejected');
  assert.equal(r.error.code, 'player_agency');
});

test('failure in a later pair rolls back all state and all outbox messages', () => {
  let calls = 0;
  const adapters = fixtures({ e1: { canonical: { pairs: [pair, reversed] }, by_observer: {
    [pair.observer_id]: {}, [reversed.observer_id]: { view: { record_changes: [record('relationship_edges', {})] } },
  } } }, { commit: () => { calls += 1; return { accepted: true }; } });
  const original = emptySnapshot('main');
  const r = ingest('e1', adapters, original);
  assert.equal(r.status, 'rejected');
  assert.deepEqual(r.snapshot, original);
  assert.deepEqual(r.outbox, []);
  assert.equal(calls, 0);
});

test('configured bounds allow fractions, clamp large templates, and reject non-finite JSON', () => {
  const policy = examplePolicy();
  policy.templates.reliability.trust = 0.25;
  const first = committed(ingest('e1', fixtures(), emptySnapshot('main'), policy));
  assert.equal(edge(first).trust, 0.25);
  policy.templates.reliability.trust = 1000;
  const second = committed(ingest('e2', fixtures(), first.snapshot, policy));
  assert.equal(edge(second).trust, 15.25);
  policy.max_delta = Infinity;
  assert.equal(ingest('e3', fixtures(), second.snapshot, policy).status, 'rejected');
});

test('tuning cannot introduce compliance-to-trust, role emotions, or low-contact decay', () => {
  for (const type of ['compliance', 'structural', 'elapsed_time']) {
    const policy = examplePolicy();
    policy.templates[type] = { affection: -1, trust: 1 };
    const r = ingest('e1', fixtures(), emptySnapshot('main'), policy);
    assert.equal(r.status, 'rejected');
    assert.equal(r.error.code, 'invalid_policy');
  }
  const first = committed(ingest('e1', fixtures({ e1: { type: 'care' } })));
  const later = committed(ingest('e2', fixtures({ e2: { type: 'elapsed_time' } }), first.snapshot));
  assert.equal(edge(later).affection, edge(first).affection);
});

test('repeated cheap positives saturate; repeated harm is never discounted', () => {
  const defs = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`e${i}`, {
    type: 'compliment', view: { low_novelty: true, novelty_key: 'same-compliment' },
  }]));
  const adapters = fixtures(defs);
  let snapshot = emptySnapshot('main');
  for (let i = 0; i < 8; i++) snapshot = committed(ingest(`e${i}`, adapters, snapshot)).snapshot;
  assert.equal(snapshot.state.relationship_edges[0].affection, 1.75);
  assert.equal(snapshot.state.relationship_patterns[0].supporting_event_ids.length, 8);
  const harms = fixtures(Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`h${i}`, {
    type: 'boundary_violation', view: { low_novelty: true, novelty_key: 'same-violation' },
  }])));
  for (let i = 0; i < 4; i++) snapshot = committed(ingest(`h${i}`, harms, snapshot)).snapshot;
  assert.equal(snapshot.state.relationship_edges[0].resentment, 8);
  assert.equal(snapshot.state.relationship_edges[0].trust, -8);
});

test('meaningless micro-events do not grow the graph', () => {
  const r = ingest('e1', fixtures({ e1: { view: { meaningful: false, magnitude: 'trivial' } } }));
  assert.equal(r.status, 'unchanged');
  assert.equal(r.snapshot.state.relationship_events.length, 0);
});

test('jealousy requires explicit context; triangle membership alone cannot change it', () => {
  const first = committed(ingest('e1', fixtures({ e1: { type: 'jealousy' } })));
  assert.equal(edge(first).jealousy, 0);
  const second = committed(ingest('e2', fixtures({ e2: { type: 'jealousy', view: {
    jealousy_context: ['observed_comparison:npc-rival'],
  } } }), first.snapshot));
  assert.equal(edge(second).jealousy, 1);
  assert(second.snapshot.state.relationship_deltas.some(d => d.dimension === 'jealousy'
    && d.delta_value === 1 && d.modifier_tags.includes('jealousy_context:observed_comparison:npc-rival')));
});

const promise = {
  promise_id: 'p1', promisor_id: pair.target_id, promisee_id: pair.observer_id,
  content: 'Help if materials arrive', explicitness: 'explicit', significance: 'minor',
  conditions: ['materials arrived'], due_at: '2025-12-31T12:00:00Z', status: 'active', source_event_id: 'create',
};

test('conditional promise failure requires actual satisfaction of every condition', () => {
  const first = committed(ingest('create', fixtures({ create: { type: 'structural', view: {
    record_changes: [record('relationship_promises', promise)],
  } } })));
  for (const condition of [undefined, [false], [true, true]]) {
    const canonical = condition ? { promise_conditions: { p1: condition } } : {};
    const r = ingest('fail', fixtures({ fail: { type: 'promise_failed', canonical, view: {
      record_changes: [record('relationship_promises', { ...promise, status: 'failed' })],
    } } }), first.snapshot);
    assert.equal(r.status, 'rejected');
    assert.equal(r.error.code, 'conditional_promise');
  }
  const valid = committed(ingest('fail', fixtures({ fail: { type: 'promise_failed',
    canonical: { promise_conditions: { p1: [true] } }, view: {
      record_changes: [record('relationship_promises', { ...promise, status: 'failed' })],
    },
  } }), first.snapshot));
  assert.equal(edge(valid).trust, -2);
});

test('renegotiation requires affected-party acceptance, including changed terms', () => {
  const initial = committed(ingest('create', fixtures({ create: { type: 'structural', view: {
    record_changes: [record('relationship_promises', promise)],
  } } })));
  const changed = { ...promise, content: 'Different terms', status: 'renegotiated' };
  const rejected = ingest('change', fixtures({ change: { type: 'structural',
    canonical: { accepted_renegotiations: { p1: [pair.target_id] } },
    view: { record_changes: [record('relationship_promises', changed)] },
  } }), initial.snapshot);
  assert.equal(rejected.error.code, 'unaccepted_renegotiation');
  const accepted = committed(ingest('change', fixtures({ change: { type: 'structural',
    canonical: { accepted_renegotiations: { p1: [pair.target_id, pair.observer_id] } },
    view: { record_changes: [record('relationship_promises', changed)] },
  } }), initial.snapshot));
  assert.equal(accepted.snapshot.state.relationship_promises[0].content, 'Different terms');
});

test('independent debt perceptions survive repayment and do not become consent or loyalty', () => {
  const debt = { debt_id: 'debt1', creditor_id: pair.observer_id, debtor_id: pair.target_id,
    type: 'favor', objective_source_event_id: 'favor', creditor_expected_value: 100,
    debtor_acknowledged_value: 10, status: 'disputed', repayment_terms: { belief: 'return the favor' },
    created_at: date, closed_at: null };
  const adapters = fixtures({
    favor: { type: 'favor', view: { reason_tags: ['debt:independent_perceptions'],
      record_changes: [record('social_debts', debt)] } },
    repay: { type: 'structural', view: { reason_tags: ['debt:independent_perceptions'],
      record_changes: [record('social_debts', { ...debt, status: 'repaid', closed_at: date })] } },
  });
  const first = committed(ingest('favor', adapters));
  const final = committed(ingest('repay', adapters, first.snapshot));
  assert.equal(final.snapshot.state.social_debts[0].creditor_expected_value, 100);
  assert.equal(final.snapshot.state.social_debts[0].debtor_acknowledged_value, 10);
  assert.equal(final.snapshot.state.relationship_events.length, 2);
  assert.equal(edge(final).loyalty, 0);
  const sent = final.outbox.find(m => m.destination === 'System 6').payload;
  assert.equal(sent.context.debts[0].own_perceived_value, 100);
  assert.equal(Object.hasOwn(sent.context.debts[0], 'debtor_acknowledged_value'), false);
  assert.equal(Object.hasOwn(sent, 'consent'), false);
});

test('cooling and repair preserve grievances and repair only evidenced trust domains', () => {
  const adapters = fixtures({
    hurt: { type: 'harm', view: { domain: 'financial' } },
    conflict: { type: 'conflict' }, cool: { type: 'cooling' },
    wrong: { type: 'repair', view: { domain: 'confidentiality', repair_evidence: ['restitution'] } },
    right: { type: 'repair', view: { domain: 'financial', repair_evidence: ['restitution'] } },
  });
  const hurt = committed(ingest('hurt', adapters));
  const conflict = committed(ingest('conflict', adapters, hurt.snapshot));
  const cool = committed(ingest('cool', adapters, conflict.snapshot));
  assert.equal(edge(cool).resentment, edge(conflict).resentment);
  assert.equal(edge(cool).trust, edge(conflict).trust);
  assert.equal(edge(cool).tension, edge(conflict).tension - 1);
  const wrong = committed(ingest('wrong', adapters, cool.snapshot));
  assert.equal(edge(wrong).trust, edge(cool).trust);
  const right = committed(ingest('right', adapters, wrong.snapshot));
  assert.equal(edge(right).trust, edge(wrong).trust + 1);
  assert(domainTrustEvidence(right.snapshot, pair.observer_id, pair.target_id, 'financial').some(d => d.delta_value < 0));
  assert.equal(right.snapshot.state.relationship_events.length, 5);
});

test('roles need canonical authority and never automatically assign feelings', () => {
  const role = { role_id: 'role1', relationship_id: JSON.stringify(['edge', 'main', pair.observer_id, pair.target_id]),
    role_type: 'family', structural_truth: { relation: 'sibling' }, subjective_claim: null,
    public_visibility: 'public', started_at: date, ended_at: null, source_event_id: 'role' };
  const change = record('relationship_roles', role);
  const invalid = ingest('role', fixtures({ role: { type: 'structural', view: { record_changes: [change] } } }));
  assert.equal(invalid.error.code, 'unauthorized_structure');
  const first = committed(ingest('role', fixtures({ role: { type: 'structural',
    canonical: { structural_changes: [change], creation_basis: 'structural_tie' },
    view: { record_changes: [change] },
  } })));
  assert(DIMENSIONS.every(d => edge(first)[d] === 0));
  const ended = committed(ingest('label', fixtures({ label: { type: 'structural', view: { subjective_label: 'estranged' } } }), first.snapshot));
  assert.equal(ended.snapshot.state.relationship_roles.length, 1);
  assert.equal(edge(ended).subjective_label, 'estranged');
});

test('promotion retains real history and never hydrates invented memories', () => {
  const initial = committed(ingest('e1'));
  const promoted = committed(ingest('e2', fixtures({ e2: { view: { desired_fidelity: 'Rich' } } }), initial.snapshot));
  assert.equal(edge(promoted).fidelity_level, 'Rich');
  assert.equal(promoted.snapshot.state.relationship_events.length, 2);
  const newRich = ingest('e1', fixtures({ e1: { view: { desired_fidelity: 'Rich' } } }));
  assert.equal(newRich.error.code, 'sparse_graph');
});

test('received rumors require real communication provenance; corrections do not reset trust', () => {
  const missing = ingest('rumor', fixtures({ rumor: { type: 'harm', view: { reason_tags: ['received:rumor'] } } }));
  assert.equal(missing.error.code, 'missing_communication_path');
  const rumor = committed(ingest('rumor', fixtures({ rumor: { type: 'harm', view: {
    reason_tags: ['received:rumor'], communication_provenance: { source_event_id: 'rumor', sender_id: 'witness' },
  } } })));
  const corrected = committed(ingest('correction', fixtures({ correction: { type: 'correction' } }), rumor.snapshot));
  assert.equal(edge(corrected).trust, -2);
  assert.equal(corrected.snapshot.state.relationship_events.length, 2);
});

test('branch state is isolated, including source-event idempotence', () => {
  const initial = committed(ingest('e1'));
  const saved = copy(initial.snapshot);
  const branch = committed(relationshipStateMachine({ operation: 'branch', snapshot: initial.snapshot,
    target_timeline_id: 'branch', policy: examplePolicy() }));
  assert.equal(edge(branch).timeline_id, 'branch');
  const duplicate = ingest('e1', fixtures(), branch.snapshot);
  assert.equal(duplicate.status, 'unchanged');
  const changed = committed(ingest('e2', fixtures({ e2: { type: 'harm' } }), branch.snapshot));
  assert.equal(edge(changed).trust, 0);
  assert.deepEqual(initial.snapshot, saved);
  assert.equal(edge(initial).trust, 2);
});

test('rewind removes invalidated causal descendants and deterministically recomputes survivors', () => {
  const definitions = { e1: { type: 'harm' }, e2: { type: 'conflict',
    canonical: { derived_from_event_ids: ['e1'] } }, e3: { type: 'care' } };
  const adapters = fixtures(definitions);
  let snapshot = emptySnapshot('main');
  for (const id of ['e1', 'e2', 'e3']) snapshot = committed(ingest(id, adapters, snapshot)).snapshot;
  const before = copy(snapshot);
  const replay = { ...adapters, ai: () => { throw Error('Replay must not use this interpreter'); }, replay: () => ({
    anchor_snapshot: emptySnapshot('main'), ordered_source_event_ids: ['e1', 'e2', 'e3'],
    dependency_graph: { e1: [], e2: ['e1'], e3: [] }, preserved_creator_anchor_source_event_ids: [], complete: true,
  }) };
  const r = committed(relationshipStateMachine({ operation: 'rewind', snapshot, policy: examplePolicy(),
    target_timeline_id: 'rewound', invalidated_source_event_ids: ['e1'] }, replay));
  assert.deepEqual(r.snapshot.state.relationship_events.map(e => e.source_event_id), ['e3']);
  assert.equal(edge(r).trust, 0);
  assert.equal(edge(r).affection, 2);
  assert.deepEqual(snapshot, before);
  assert.equal(r.outbox.length, 1);
});

test('rewind rejects missing dependency links and preserves explicit Creator anchors', () => {
  const creator = { ...pair, source_event_id: 'anchor', kind: 'backstory_anchor',
    values: { trust: 50, affection: 40, resentment: 60 }, subjective_label: 'ambivalent', jealousy_context: [] };
  const adapters = fixtures({ anchor: { known: false, controls: { creator_changes: [creator] } },
    e1: { type: 'harm', canonical: { derived_from_event_ids: ['anchor'] } } });
  const anchored = committed(ingest('anchor', adapters));
  assert.equal(anchored.outbox.some(m => ['System 2', 'System 3', 'System 4'].includes(m.destination)), false);
  const harmed = committed(ingest('e1', adapters, anchored.snapshot));
  const plan = { anchor_snapshot: emptySnapshot('main'), ordered_source_event_ids: ['anchor', 'e1'],
    dependency_graph: { anchor: [], e1: ['anchor'] }, preserved_creator_anchor_source_event_ids: ['anchor'], complete: true };
  const r = committed(relationshipStateMachine({ operation: 'rewind', snapshot: harmed.snapshot, policy: examplePolicy(),
    target_timeline_id: 'anchored-branch', invalidated_source_event_ids: ['e1'] }, { ...adapters, replay: () => plan }));
  assert.equal(edge(r).trust, 50);
  assert.equal(edge(r).affection, 40);
  assert.equal(edge(r).resentment, 60);
  const missing = relationshipStateMachine({ operation: 'rewind', snapshot: harmed.snapshot, policy: examplePolicy(),
    target_timeline_id: 'bad', invalidated_source_event_ids: [] }, { ...adapters,
    replay: () => ({ ...plan, dependency_graph: {} }) });
  assert.equal(missing.error.code, 'incomplete_replay');
});

test('retcons are explicitly authorized, audited, and isolated to a new branch', () => {
  const creator = { ...pair, source_event_id: 'retcon', kind: 'retcon',
    values: { trust: 12 }, subjective_label: null, jealousy_context: [] };
  const adapters = fixtures({ old: { type: 'harm' }, retcon: { controls: { creator_changes: [creator] } } }, {
    replay: () => ({ anchor_snapshot: emptySnapshot('main'), ordered_source_event_ids: ['old'],
      dependency_graph: { old: [] }, preserved_creator_anchor_source_event_ids: [], complete: true }),
  });
  const first = committed(ingest('old', adapters));
  const r = committed(relationshipStateMachine({ operation: 'retcon', snapshot: first.snapshot, policy: examplePolicy(),
    target_timeline_id: 'retconned', invalidated_source_event_ids: ['old'], creator_source_event_id: 'retcon',
    replacement_source_event_ids: [] }, adapters));
  assert.equal(edge(r).trust, 12);
  assert.equal(edge(first).trust, -2);
  assert(r.snapshot.state.relationship_deltas.some(d => d.modifier_tags.includes('creator:retcon')));
});

test('persistence rejection and adapter exceptions return the unchanged input', () => {
  const original = emptySnapshot('main');
  const r = ingest('e1', fixtures({}, { commit: () => ({ accepted: false }) }), original);
  assert.equal(r.error.code, 'commit_rejected');
  assert.deepEqual(r.snapshot, original);
  assert.deepEqual(r.outbox, []);
  const error = ingest('e1', fixtures({}, { personality: () => { throw Error('unavailable'); } }), original);
  assert.equal(error.status, 'rejected');
  assert.deepEqual(error.snapshot, original);
});

test('narrative output and private observations disclose no hidden metrics to third parties', () => {
  const r = committed(ingest('e1'));
  const narrative = r.outbox.find(m => m.destination === 'System 2').payload;
  assert.equal(Object.hasOwn(narrative, 'relationship'), false);
  assert.equal(Object.hasOwn(narrative, 'trust'), false);
  assert.equal(r.outbox.some(m => m.destination === 'reputation_authority'), false);
  assert.equal(r.outbox.some(m => m.destination === 'System 23'), false);
  const denied = relationshipStateMachine({ operation: 'inspect', snapshot: r.snapshot, policy: examplePolicy(), ...pair });
  assert.equal(denied.error.code, 'inspection_denied');
  const allowed = relationshipStateMachine({ operation: 'inspect', snapshot: r.snapshot, policy: examplePolicy(), ...pair }, {
    controls: () => ({ ...requestPlayerCreatorControls(), inspection_authorized: true }),
  });
  assert.equal(allowed.status, 'inspected');
  assert.equal(allowed.inspection.edge.trust, 2);
});

test('boundary awareness, accidental violations, communication, and exceptions stay distinct', () => {
  const boundary = { boundary_id: 'b1', owner_id: pair.observer_id, target_id: pair.target_id,
    domain: 'privacy', description: 'Do not read my private notes', explicitness: 'unspoken',
    severity: 'moderate', known_by_target: false, exceptions: ['emergency'], status: 'active', source_event_id: 'boundary' };
  const context = { boundary_id: 'b1', known_by_target: false, intent: 'accidental', exception_applies: false, modifier: 0.5 };
  const first = committed(ingest('boundary', fixtures({ boundary: { type: 'structural', view: {
    record_changes: [record('relationship_boundaries', boundary)],
  } } })));
  const accident = committed(ingest('accident', fixtures({ accident: { type: 'boundary_violation', view: {
    boundary_context: [context],
  } } }), first.snapshot));
  assert.equal(edge(accident).resentment, 1);
  const unexplained = ingest('explain', fixtures({ explain: { type: 'structural', view: {
    record_changes: [record('relationship_boundaries', { ...boundary, known_by_target: true })],
  } } }), accident.snapshot);
  assert.equal(unexplained.error.code, 'unsupported_communication');
  const communicated = committed(ingest('explain', fixtures({ explain: { type: 'structural', view: {
    reason_tags: ['boundary:communicated'],
    record_changes: [record('relationship_boundaries', { ...boundary, known_by_target: true })],
  } } }), accident.snapshot));
  const intentional = committed(ingest('intentional', fixtures({ intentional: { type: 'boundary_violation', view: {
    boundary_context: [{ ...context, known_by_target: true, intent: 'intentional', modifier: 2 }],
  } } }), communicated.snapshot));
  assert.equal(edge(intentional).resentment, 5);
  const excepted = ingest('exception', fixtures({ exception: { type: 'boundary_violation', view: {
    boundary_context: [{ ...context, known_by_target: true, exception_applies: true }],
  } } }), intentional.snapshot);
  assert.equal(excepted.error.code, 'boundary_exception');
});

test('conflict lifecycle preserves triggers, topic ownership, and residual damage', () => {
  const conflict = { conflict_id: 'c1', participant_ids: [pair.observer_id, pair.target_id],
    topics: ['privacy'], intensity: 3, status: 'active', trigger_event_ids: ['conflict'],
    unresolved_points: [{ owner_id: pair.observer_id, issue: 'private notes were read' }],
    started_at: date, cooling_since: null, resolved_at: null };
  const first = committed(ingest('conflict', fixtures({ conflict: { type: 'conflict', view: {
    conflict_topics: ['privacy'], record_changes: [record('relationship_conflicts', conflict)],
  } } })));
  const cooling = { ...conflict, status: 'cooling', intensity: 2, cooling_since: date,
    trigger_event_ids: ['conflict', 'cool'] };
  const next = committed(ingest('cool', fixtures({ cool: { type: 'cooling', view: {
    record_changes: [record('relationship_conflicts', cooling)],
  } } }), first.snapshot));
  assert.deepEqual(next.snapshot.state.relationship_conflicts[0].unresolved_points, conflict.unresolved_points);
  assert.equal(edge(next).affection, -1);
  const unsupported = ingest('reconcile', fixtures({ reconcile: { type: 'reconciliation', view: {
    record_changes: [record('relationship_conflicts', { ...cooling, status: 'reconciled',
      trigger_event_ids: ['conflict', 'cool', 'reconcile'], resolved_at: date })],
  } } }), next.snapshot);
  assert.equal(unsupported.error.code, 'unsupported_reconciliation');
  const repaired = committed(ingest('reconcile', fixtures({ reconcile: { type: 'reconciliation', view: {
    reason_tags: ['reconciliation:mutual'],
    record_changes: [record('relationship_conflicts', { ...cooling, status: 'reconciled',
      trigger_event_ids: ['conflict', 'cool', 'reconcile'], resolved_at: date })],
  } } }), next.snapshot));
  assert.equal(edge(repaired).affection, -1);
  assert.equal(repaired.snapshot.state.relationship_conflicts[0].trigger_event_ids.length, 3);
});

test('explicit player stances are recorded without allowing arbitrary behavioral actions', () => {
  const players = [{ entity_id: pair.observer_id, kind: 'player' }, { entity_id: pair.target_id, kind: 'npc' }];
  const r = committed(ingest('stance', fixtures({ stance: { type: 'player_stance',
    canonical: { entities: players }, controls: { player_stances: [{ ...pair, source_event_id: 'stance',
      values: { affection: -5, respect: 8 }, subjective_label: 'respected rival', jealousy_context: [] }] },
  } })));
  assert.equal(edge(r).affection, -5);
  assert.equal(edge(r).respect, 8);
  assert.equal(edge(r).subjective_label, 'respected rival');
  assert.equal(edge(r).trust, 0);
  const autonomy = r.outbox.find(m => m.destination === 'System 6').payload;
  assert.equal(Object.hasOwn(autonomy, 'chosen_action'), false);
  assert.equal(autonomy.pressure_only, true);
});

test('significant events preserve cornerstones while trust, fear, and affection coexist', () => {
  const r = committed(ingest('severe', fixtures({ severe: { type: 'harm', view: { magnitude: 'severe' } } })));
  assert.equal(r.snapshot.state.relationship_cornerstones.length, 1);
  assert.equal(r.snapshot.state.relationship_cornerstones[0].source_event_id, 'severe');
  assert(edge(r).fear > 0);
  assert(edge(r).trust < 0);
  const loved = committed(ingest('care', fixtures({ care: { type: 'care' } }), r.snapshot));
  assert(edge(loved).affection > 0);
  assert(edge(loved).fear > 0);
  assert(edge(loved).resentment > 0);
  assert(edge(loved).trust < 0);
});

test('anti-farming cannot be bypassed merely by relabeling identical events as novel', () => {
  const defs = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`g${i}`, {
    type: 'gift', view: { low_novelty: false, novelty_key: 'identical-cheap-gift' },
  }]));
  let snapshot = emptySnapshot('main');
  for (let i = 0; i < 8; i++) snapshot = committed(ingest(`g${i}`, fixtures(defs), snapshot)).snapshot;
  assert.equal(snapshot.state.relationship_edges[0].affection, 1.75);
});

test('restore rejects orphan records and broken before/after accounting', () => {
  const r = committed(ingest('e1'));
  const broken = copy(r.snapshot);
  broken.state.relationship_deltas[0].before_value = 17;
  const bad = relationshipStateMachine({ operation: 'restore', snapshot: broken, policy: examplePolicy() });
  assert.equal(bad.error.code, 'invalid_accounting');
  const orphan = copy(r.snapshot);
  orphan.state.relationship_promises.push({ ...promise, source_event_id: 'fabricated' });
  const badRecord = relationshipStateMachine({ operation: 'restore', snapshot: orphan, policy: examplePolicy() });
  assert.equal(badRecord.error.code, 'unsupported_history');
});
