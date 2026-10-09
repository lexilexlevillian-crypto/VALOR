import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldLocationTravel, createDependencyStubs } from '../src/system12/world-location-travel.mjs';

const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x)
  : Array.isArray(x) ? `[${x.map(canonical).join(',')}]`
  : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
const uid = (...parts) => createHash('sha256').update(canonical(parts)).digest('hex');
const key = (...parts) => JSON.stringify(parts);
const anchor = node_ref => ({ anchor_kind: 'PLACE_NODE', anchor_json: { node_ref } });
const request = (command_id, revision = 0, clock = 0, horizon = 200000) => ({
  command_id, branch_id: 'branch', actor_id: 'actor', expected_presence_revision: revision,
  expected_clock_revision: clock, destination_ref: 'destination', mode: 'walk', route_preference: 'earliest',
  authorization_horizon_ms: horizon, delegation_ref: 'delegation', causation_id: 'intent'
});
const command = (operation, id, rest = {}, revision = 0, clock = 0, horizon = 200000) => ({ operation, request: request(id, revision, clock, horizon), ...rest });
function projection(owner, id, payload, end = 10000000) {
  return { status: 'accepted', projection: { owner_ref: owner, record_receipt_ref: id, revision: 0,
    effective_interval: { start_ms: 0, end_ms: end }, payload, observable_evidence: {}, hidden_causes: {} } };
}
const planId = uid('branch', 'plan', 'plan');
const travelId = uid('branch', 'start', 'travel');
const segmentId = uid(planId, 0);

/** Static owner fixtures only: all externally owned outcomes are specified here. */
function fixtures(durations = [60000, 40000], options = {}) {
  const f = {};
  const put = (owner, op, payload, id = '*') => {
    f[owner] ??= {}; f[owner][op] ??= {}; f[owner][op][id] = payload;
  };
  const pack = {
    world_definition: { world_id: 'world', topology_version: 'v1', geometry_version: 'g1', taxonomy_dictionary_version: 't1', coordinate_origin_projection: {}, arithmetic_rounding_policy_version: 'mm-ms-v1', movement_profile_versions: ['walk-v1'] },
    place: [
      { place_id: 'city', world_id: 'world', kind: 'city', parent_id: null, name: 'City', geometry_version: 'g1', revision: 0 },
      { place_id: 'street', world_id: 'world', kind: 'street_block', parent_id: 'city', name: 'Street', geometry_version: 'g1', revision: 0 }
    ],
    spatial_structure: { taxonomy_relations: [], physical_containment_relations: [{ child_id: 'street', parent_id: 'city' }], jurisdiction_memberships: [], place_aliases: [], frontage_links: [], floors: [{ floor_id: 'ground', display_label: 'Ground' }], property_geometry: [] },
    navigation_node: ['a', 'b'].map((node_id, i) => ({ node_id, place_id: 'street', coordinates_or_relative_geometry: { x_mm: i * 130000, y_mm: 0, z_mm: 0 }, geometry_is_nonmetric: false, floor_elevation_ref: 'ground', interaction_or_stop_anchor_ref: null })),
    nav_edge: [{ edge_id: 'ab', from_node: 'a', to_node: 'b', length_mm: 130000, mode_mask: 1, access_policy_id: 'public', version: 'v1', directionality: 'directed', polyline: null, duration_profile_ref: 'walk-v1', accessibility_constraints: [] }],
    spatial_affordances: { interaction_anchors: [], channel_edges: [], access_policies: [{ id: 'public', required_owners: ['security', 'environment', 'health'] }], room_capacity_policy_refs: [], exposure_links: [] },
    modes: { walk: 1 }, profiles: { 'walk-v1': { kind: 'walk' } }
  };
  put('creator', 'adopt', projection('creator', 'content-receipt', pack));
  put('creator', 'place', projection('creator', 'placement-receipt', { actor_id: 'actor', branch_id: 'branch', causation_id: 'intent', capacity_access_accepted: true, anchor: anchor('a'), effective_time_ms: 0 }));
  put('system1', 'authorize', projection('system1', 'authorization', { actor_id: 'actor', branch_id: 'branch', causation_id: 'intent', operations: ['adopt', 'place', 'plan', 'start', 'step', 'recover', 'inspect', 'nearby', 'cancel', 'continue', 'observe', 'fork'], authorization_horizon_ms: 10000000, destinations: ['destination'], modes: ['walk'], delegation_ref: 'delegation', methods: [], accepted_choices: [], privileged: true }));
  put('system3', 'knowledge', projection('system3', 'knowledge', { actor_id: 'actor', branch_id: 'branch', nodes: ['a', 'b'], edges: [{ edge_id: 'ab', from_node: 'a', to_node: 'b', length_mm: 130000, estimated_duration_ms: 100000, modes: ['walk'], eligible: true, duration_profile_ref: 'walk-v1' }], destinations: { destination: 'b' }, public_entrances: ['b'] }));
  put('system11', 'clock', projection('system11', 'clock-start', { now_ms: 0, clock_revision: 0 }));
  put('security', 'admit', projection('security', 'admission', { actor_id: 'actor', branch_id: 'branch', route_plan_ref: planId, accepted: true, reservation_refs: ['actor-slot'] }));
  put('security', 'access', projection('security', 'access', { actor_id: 'actor', branch_id: 'branch', edge_id: 'ab', result: 'allowed', physical_traversable: true, capacity_reserved: true, temporal_available: true, permission: true }));
  put('environment', 'conditions', projection('environment', 'conditions', { edge_id: 'ab' }));
  put('health', 'function', projection('health', 'function', { actor_id: 'actor', method_available: true }));
  put('system11', 'boundaries', projection('system11', 'no-boundaries', { boundaries_ms: [] }));
  let time = 0;
  durations.forEach((duration, i) => {
    const checkpoint = key('checkpoint', travelId, segmentId, i), interval = { start_ms: time, end_ms: time + duration }, coverage = `coverage-${i}`;
    put('system11', 'clock', projection('system11', `clock-${i}`, { now_ms: time, clock_revision: i }), `step-${i}`);
    put('system11', 'boundaries', projection('system11', `boundaries-${i}`, { boundaries_ms: [time + duration] }), checkpoint);
    put('system11', 'prepare_coverage', projection('system11', coverage, { idempotency_key: checkpoint, branch_id: 'branch', expected_clock_revision: i, interval }), checkpoint);
    for (const owner of ['system11', 'security', 'environment', 'health']) {
      put(owner, 'lookup_receipt', { status: 'not_found' }, checkpoint);
      if (options.missingOwner === owner && options.missingIndex === i) continue;
      put(owner, 'commit', projection(owner, `committed-${owner}-${i}`, { idempotency_key: checkpoint, branch_id: 'branch', actor_id: 'actor', interval, committed: true, ...(owner === 'system11' ? { coverage_ref: coverage } : {}) }), checkpoint);
    }
    time += duration;
  });
  return f;
}
function engine(f = fixtures(), database = ':memory:') { return new WorldLocationTravel({ database, adapters: createDependencyStubs(f) }); }
function initialize(e, horizon = 200000) {
  assert.equal(e.execute(command('adopt', 'adopt')).status, 'ACCEPTED');
  assert.equal(e.execute(command('place', 'place')).status, 'ACCEPTED');
  assert.equal(e.execute(command('plan', 'plan', {}, 0, 0, horizon)).status, 'PLANNED');
  const started = e.execute(command('start', 'start', { route_plan_id: planId }, 0, 0, horizon));
  assert.equal(started.status, 'ACTIVE'); return started;
}
function inspect(e, id = 'inspect') { return e.execute(command('inspect', id)).snapshot; }

test('default dependency stubs fail closed without creating world state', () => {
  const e = new WorldLocationTravel();
  assert.equal(e.execute(command('adopt', 'adopt')).stop_reason, 'OPERATIONAL_UNAVAILABLE'); e.close();
});
test('130m walk takes 100s; planning does not move; retries do not move twice', () => {
  const e = engine(); initialize(e);
  const firstCommand = command('step', 'step-0', { travel_id: travelId });
  const first = e.execute(firstCommand);
  assert.equal(first.status, 'ACTIVE'); assert.equal(first.committed_anchor.anchor_json.progress_mm, 78000);
  assert.deepEqual(e.execute(firstCommand), first);
  const final = e.execute(command('step', 'step-1', { travel_id: travelId }, 1, 1));
  assert.equal(final.status, 'ARRIVED'); assert.deepEqual(final.committed_anchor, anchor('b'));
  assert.equal(final.progress.reduce((n, p) => n + p.elapsed_ms, 0), 100000);
  assert.equal(final.progress.reduce((n, p) => n + p.distance_mm, 0), 130000);
  const snapshot = inspect(e);
  assert.equal(Object.keys(snapshot.movement_event).length, 3);
  assert.equal(snapshot.persistence_delivery.pending_recovery_refs.length, 0); e.close();
});
test('checkpoint partitioning preserves distance, residue, and arrival', () => {
  const durations = [333, 777, 10987, 43210, 44693];
  assert.equal(durations.reduce((a, b) => a + b), 100000);
  const e = engine(fixtures(durations)); initialize(e);
  let result;
  durations.forEach((_, i) => { result = e.execute(command('step', `step-${i}`, { travel_id: travelId }, i, i)); });
  assert.equal(result.status, 'ARRIVED');
  assert.equal(result.progress.reduce((n, p) => n + p.distance_mm, 0), 130000);
  assert.equal(result.progress.reduce((n, p) => n + p.elapsed_ms, 0), 100000);
  assert.equal(Object.values(inspect(e).travel_segment)[0].rounding_residue, '0'); e.close();
});
test('same command ID with altered payload is an idempotency conflict', () => {
  const e = engine(); initialize(e);
  const altered = command('plan', 'plan'); altered.request.authorization_horizon_ms = 100000;
  assert.equal(e.execute(altered).stop_reason, 'IDEMPOTENCY_CONFLICT'); e.close();
});
test('blocked access preserves correct-side presence and emits no interior observation', () => {
  const f = fixtures(); f.security.access['*'].projection.payload.result = 'blocked';
  const e = engine(f); initialize(e);
  const result = e.execute(command('step', 'step-0', { travel_id: travelId }));
  assert.equal(result.status, 'PAUSED'); assert.deepEqual(result.committed_anchor, anchor('a'));
  const s = inspect(e); assert.equal(Object.keys(s.discovery_proposal).length, 0); assert.equal(Object.keys(s.movement_event).length, 1); e.close();
});
test('lost owner acknowledgment preserves durable preparation and reconciles by lookup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'valor12-')), database = join(directory, 'state.sqlite');
  try {
    const f = fixtures([60000, 40000], { missingOwner: 'health', missingIndex: 0 });
    let e = engine(f, database); initialize(e);
    const pending = e.execute(command('step', 'step-0', { travel_id: travelId }));
    assert.equal(pending.status, 'RECOVERY_REQUIRED'); assert.deepEqual(pending.committed_anchor, anchor('a'));
    e.close();
    const checkpoint = key('checkpoint', travelId, segmentId, 0), complete = fixtures();
    f.health.lookup_receipt[checkpoint] = complete.health.commit[checkpoint];
    e = engine(f, database);
    const recovered = e.execute(command('recover', 'recover', { travel_id: travelId }));
    assert.equal(recovered.status, 'ACTIVE'); assert.equal(recovered.committed_anchor.anchor_json.progress_mm, 78000);
    assert.deepEqual(e.execute(command('step', 'step-0', { travel_id: travelId })), recovered);
    assert.equal(Object.keys(inspect(e).movement_event).length, 2); e.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('authorization horizon pauses at exact committed position without refunds', () => {
  const e = engine(fixtures([50000])); initialize(e, 50000);
  const result = e.execute(command('step', 'step-0', { travel_id: travelId }, 0, 0, 50000));
  assert.equal(result.status, 'PAUSED'); assert.equal(result.stop_reason, 'AUTHORIZATION_EXCEEDED');
  assert.equal(result.committed_anchor.anchor_json.progress_mm, 65000); e.close();
});
test('unknown topology changes do not affect known nearby estimates', () => {
  const a = fixtures(), b = fixtures();
  const pack = b.creator.adopt['*'].projection.payload;
  pack.navigation_node.push({ ...pack.navigation_node[0], node_id: 'hidden', coordinates_or_relative_geometry: { x_mm: 500000, y_mm: 0, z_mm: 0 } });
  const ea = engine(a), eb = engine(b); initialize(ea); initialize(eb);
  assert.deepEqual(ea.execute(command('nearby', 'nearby')), eb.execute(command('nearby', 'nearby')));
  ea.close(); eb.close();
});
test('invalid metric length and containment cycles reject content atomically', () => {
  for (const mutate of [p => { p.nav_edge[0].length_mm = 1; }, p => { p.spatial_structure.physical_containment_relations.push({ child_id: 'city', parent_id: 'street' }); }]) {
    const f = fixtures(); mutate(f.creator.adopt['*'].projection.payload);
    const e = engine(f); assert.equal(e.execute(command('adopt', 'adopt')).status, 'REJECTED');
    assert.equal(inspect(e).world_definition, null); e.close();
  }
});
test('stale presence cannot admit a competing second step', () => {
  const e = engine(); initialize(e);
  assert.equal(e.execute(command('step', 'step-0', { travel_id: travelId })).status, 'ACTIVE');
  assert.equal(e.execute(command('step', 'other', { travel_id: travelId })).stop_reason, 'STALE_PRESENCE'); e.close();
});
test('access expiring exactly at arrival does not grant destination presence', () => {
  const f = fixtures([60000, 40000]);
  f.security.access['*'].projection.effective_interval.end_ms = 100000;
  const e = engine(f); initialize(e);
  e.execute(command('step', 'step-0', { travel_id: travelId }));
  const result = e.execute(command('step', 'step-1', { travel_id: travelId }, 1, 1));
  assert.equal(result.status, 'ACTIVE'); assert.equal(result.committed_anchor.anchor_kind, 'EDGE_PROGRESS');
  assert.equal(result.committed_anchor.anchor_json.progress_mm, 130000);
  assert.equal(Object.values(inspect(e).movement_event).filter(x => x.after_anchor.anchor_json.node_ref === 'b').length, 0);
  e.close();
});
test('constrained planning retains a slower affordable prefix', () => {
  const f = fixtures(), k = f.system3.knowledge['*'].projection.payload;
  const make = (edge_id, from_node, to_node, duration, cost) => ({ edge_id, from_node, to_node, length_mm: duration * 1300, estimated_duration_ms: duration * 1000, known_cost: cost, modes: ['walk'], eligible: true, duration_profile_ref: 'walk-v1' });
  k.nodes = ['a', 'b', 'c', 'd']; k.budget_constraints = [{ max_cost: 6 }];
  k.edges = [make('fast-expensive', 'a', 'c', 1, 9), make('slow-cheap-1', 'a', 'd', 2, 0), make('slow-cheap-2', 'd', 'c', 2, 1), make('finish', 'c', 'b', 1, 5)];
  const e = engine(f);
  e.execute(command('adopt', 'adopt')); e.execute(command('place', 'place'));
  const plan = e.execute(command('plan', 'plan'));
  assert.equal(plan.status, 'PLANNED'); assert.deepEqual(plan.route, ['slow-cheap-1', 'slow-cheap-2', 'finish']); e.close();
});
test('earliest-arrival ties use route identity rather than secret secondary optimization', () => {
  const f = fixtures(), k = f.system3.knowledge['*'].projection.payload;
  k.edges = [{ ...k.edges[0], edge_id: 'z-short', length_mm: 100 }, { ...k.edges[0], edge_id: 'a-long', length_mm: 200 }];
  const e = engine(f); e.execute(command('adopt', 'adopt')); e.execute(command('place', 'place'));
  assert.deepEqual(e.execute(command('plan', 'plan')).route, ['a-long']); e.close();
});
test('forking midroute preserves physical progress and does not redispatch history', () => {
  const f = fixtures(); f.creator.fork = { '*': projection('creator', 'fork', { branch_id: 'branch', new_branch_id: 'future', owner_references_validated: true }) };
  const e = engine(f); initialize(e); e.execute(command('step', 'step-0', { travel_id: travelId }));
  const before = inspect(e, 'before-fork');
  assert.equal(e.execute(command('fork', 'fork', { new_branch_id: 'future' }, 1, 1)).status, 'ACCEPTED');
  const after = inspect(e, 'after-fork'), p = after.character_presence[key('future', 'actor')];
  assert.equal(p.anchor_json.progress_mm, 78000); assert.equal(p.anchor_kind, 'EDGE_PROGRESS');
  assert.equal(after.travel[uid('future', travelId)].state, 'PAUSED');
  assert.equal(after.persistence_delivery.outbox_entries.length, before.persistence_delivery.outbox_entries.length);
  assert.equal(after.character_presence[key('branch', 'actor')].anchor_json.movement_ref, travelId); e.close();
});
test('unavailable health owner never becomes a fabricated physical blocker', () => {
  const f = fixtures(); delete f.health.function;
  const e = engine(f); initialize(e);
  assert.equal(e.execute(command('step', 'step-0', { travel_id: travelId })).stop_reason, 'OPERATIONAL_UNAVAILABLE');
  const s = inspect(e); assert.equal(Object.keys(s.movement_event).length, 1);
  assert.equal(s.character_presence[key('branch', 'actor')].anchor_json.node_ref, 'a'); e.close();
});
test('ordinary walking rounds up once per segment, not once per checkpoint', () => {
  const f = fixtures([333, 567, 100]);
  const pack = f.creator.adopt['*'].projection.payload;
  pack.nav_edge[0].length_mm = 1000; pack.navigation_node[1].coordinates_or_relative_geometry.x_mm = 1000;
  f.system3.knowledge['*'].projection.payload.edges[0].length_mm = 1000;
  f.system3.knowledge['*'].projection.payload.edges[0].estimated_duration_ms = 1000;
  const e = engine(f); initialize(e);
  let result;
  for (let i = 0; i < 3; i++) result = e.execute(command('step', `step-${i}`, { travel_id: travelId }, i, i));
  assert.equal(result.status, 'ARRIVED'); assert.equal(result.progress.reduce((n, p) => n + p.elapsed_ms, 0), 1000);
  assert.equal(result.progress.reduce((n, p) => n + p.distance_mm, 0), 1000); e.close();
});
test('return travel follows an authored reverse edge from the interrupted position', () => {
  const f = fixtures(), pack = f.creator.adopt['*'].projection.payload, k = f.system3.knowledge['*'].projection.payload;
  pack.world_definition.movement_profile_versions.push('reverse-v1');
  pack.profiles['walk-v1'].reverse_edge_ref = 'ba'; pack.profiles['reverse-v1'] = { kind: 'walk', reverse_edge_ref: 'ab' };
  pack.nav_edge.push({ ...pack.nav_edge[0], edge_id: 'ba', from_node: 'b', to_node: 'a', duration_profile_ref: 'reverse-v1' });
  k.edges[0].reverse_edge_ref = 'ba';
  k.edges.push({ ...k.edges[0], edge_id: 'ba', from_node: 'b', to_node: 'a', reverse_edge_ref: 'ab', duration_profile_ref: 'reverse-v1' });
  k.destinations.home = 'a'; f.system1.authorize['*'].projection.payload.destinations.push('home');
  const at = { anchor_kind: 'EDGE_PROGRESS', anchor_json: { edge_ref: 'ab', origin_node_ref: 'a', progress_mm: 78000, movement_ref: travelId } };
  f.environment.safe_stop = { '*': projection('environment', 'safe-stop', { safe: true, anchor: at }) };
  for (const id of ['cancel', 'return-start', 'return-step']) f.system11.clock[id] = projection('system11', `clock-${id}`, { now_ms: 60000, clock_revision: 1 });
  const returnPlan = uid('branch', 'return-plan', 'plan'), returnTravel = uid('branch', 'return-start', 'travel'), returnSegment = uid(returnPlan, 0);
  f.security.admit['return-start'] = projection('security', 'return-admission', { actor_id: 'actor', branch_id: 'branch', route_plan_ref: returnPlan, accepted: true, reservation_refs: ['return-slot'] });
  const checkpoint = key('checkpoint', returnTravel, returnSegment, 0), interval = { start_ms: 60000, end_ms: 120000 };
  f.security.access[checkpoint] = projection('security', 'reverse-access', { ...f.security.access['*'].projection.payload, edge_id: 'ba' });
  f.environment.conditions[checkpoint] = projection('environment', 'reverse-conditions', { edge_id: 'ba' });
  f.system11.prepare_coverage[checkpoint] = projection('system11', 'reverse-coverage', { idempotency_key: checkpoint, branch_id: 'branch', expected_clock_revision: 1, interval });
  for (const owner of ['system11', 'security', 'environment', 'health']) {
    f[owner].lookup_receipt[checkpoint] = { status: 'not_found' };
    f[owner].commit[checkpoint] = projection(owner, `reverse-${owner}`, { idempotency_key: checkpoint, branch_id: 'branch', actor_id: 'actor', interval, committed: true, ...(owner === 'system11' ? { coverage_ref: 'reverse-coverage' } : {}) });
  }
  const e = engine(f); initialize(e); e.execute(command('step', 'step-0', { travel_id: travelId }));
  assert.equal(e.execute(command('cancel', 'cancel', { travel_id: travelId }, 1, 1)).status, 'CANCELLED');
  const plan = command('plan', 'return-plan', {}, 1, 1); plan.request.destination_ref = 'home';
  assert.deepEqual(e.execute(plan).route, ['ba']);
  const start = command('start', 'return-start', { route_plan_id: returnPlan }, 1, 1); start.request.destination_ref = 'home';
  assert.equal(e.execute(start).status, 'ACTIVE');
  const step = command('step', 'return-step', { travel_id: returnTravel }, 1, 1); step.request.destination_ref = 'home';
  const arrived = e.execute(step);
  assert.equal(arrived.status, 'ARRIVED'); assert.deepEqual(arrived.committed_anchor, anchor('a'));
  assert.equal(arrived.progress[0].distance_mm, 78000); assert.equal(arrived.progress[0].elapsed_ms, 60000); e.close();
});
