/**
 * System 12: isolated, deterministic spatial engine. Requires Node.js >= 24.
 *
 * All dependency functions are static JSON fixture stubs. No clock, knowledge,
 * vehicle, health, payment, NPC, or access-owner implementation is embedded.
 * Missing fixtures fail closed as operational unavailability.
 *
 * execute(command) accepts/returns JSON objects. The operation envelope is
 * { operation, request, ...operationArguments }; request is travel_request.
 * Game state contains only the entities specified by the distilled architecture.
 * Opaque snapshots/payloads hold versioned contract data, not owner authority.
 *
 * Arithmetic contract mm-ms-v1: integer milliseconds, integer millimeters,
 * one-meter intermediate walking positions, persisted fractional distance.
 * Reference walking/stair speeds are 1300/700 millimeters per second. Physical
 * Ordinary walking/stairs duration rounds up to a second once per segment;
 * checkpoints retain rounding state. Doorway setup defaults to 2000 ms.
 * Authored profiles may explicitly pin a finer time_quantum_ms.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

/** @typedef {null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue}} JSONValue */
/** @typedef {{[key:string]:JSONValue}} JSONObject */

const clone = value => JSON.parse(JSON.stringify(value));
const key = (...parts) => JSON.stringify(parts);
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
const identity = value => createHash('sha256').update(canonical(value)).digest('hex');
const uid = (...parts) => identity(parts);
const dict = () => Object.create(null);
const own = (object, name) => Object.hasOwn(object, name);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const ceilDiv = (a, b) => (a + b - 1n) / b;
function number(value) {
  const result = Number(value);
  requireThat(Number.isSafeInteger(result), 'NUMERIC_OVERFLOW');
  return result;
}
class SpatialError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireThat(condition, code) {
  if (!condition) throw new SpatialError(code);
}
function json(value) {
  requireThat(value !== undefined, 'INVALID_JSON');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'INVALID_JSON'); return; }
  requireThat(typeof value === 'object', 'INVALID_JSON');
  if (Array.isArray(value)) value.forEach(json);
  else {
    requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'INVALID_JSON');
    for (const [name, item] of Object.entries(value)) {
      requireThat(!['__proto__', 'prototype', 'constructor'].includes(name), 'INVALID_JSON');
      json(item);
    }
  }
}

const FIELDS = {
  world_definition: 'world_id topology_version geometry_version taxonomy_dictionary_version coordinate_origin_projection arithmetic_rounding_policy_version movement_profile_versions',
  place: 'place_id world_id kind parent_id name geometry_version revision',
  spatial_structure: 'taxonomy_relations physical_containment_relations jurisdiction_memberships place_aliases frontage_links floors property_geometry',
  navigation_node: 'node_id place_id coordinates_or_relative_geometry geometry_is_nonmetric floor_elevation_ref interaction_or_stop_anchor_ref',
  nav_edge: 'edge_id from_node to_node length_mm mode_mask access_policy_id version directionality polyline duration_profile_ref accessibility_constraints',
  spatial_affordances: 'interaction_anchors channel_edges access_policies room_capacity_policy_refs exposure_links',
  character_presence: 'branch_id world_id character_id anchor_kind anchor_json revision last_movement_event_id',
  travel_request: 'command_id branch_id actor_id expected_presence_revision expected_clock_revision destination_ref mode route_preference authorization_horizon_ms delegation_ref causation_id',
  route_plan: 'route_plan_id plan_version actor_id source_anchor destination_ref topology_version knowledge_revision mode accessibility_needs allowed_transfers budget_constraints avoidances authorization_horizon_ms ordered_segment_definitions estimated_duration estimated_distance projected_costs known_constraints required_choices assumptions_uncertainty freshness_source_revisions',
  route_segment_definition: 'segment_id edge_path_ref direction length_mm mode duration_policy_ref checkpoint_interrupt_policy_refs target_anchor',
  travel: 'travel_id branch_id actor_id command_id causation_id continuation_lineage_ref route_plan_ref state current_segment_ref remaining_route remaining_authorization reservation_refs elapsed_distance_receipts accepted_cost_receipts sample_refs pending_choices stop_reason trace_id',
  travel_segment: 'segment_id travel_id edge_id progress_mm rounding_residue state duration_receipt_id boundary_snapshot access_snapshot reservation_refs owner_receipt_refs sample_refs',
  passage_transition: 'state source_anchor destination_anchor passage_ref duration reservation_refs boundary_snapshot causal_intent_ref',
  commit_coordination: 'state idempotency_key request_payload_identity reservation_refs clock_coverage_receipt_ref required_owner_receipt_refs pending_receipts stored_command_result',
  access_evaluation: 'result structured_causes source_revisions effective_interval observable_evidence hidden_causes',
  owner_projection_ref: 'owner_ref record_receipt_ref revision effective_interval payload observable_evidence hidden_causes',
  taxi_service_projection: 'owner_state dispatch_carrier_occupancy_fare_receipt_refs',
  interruption: 'owner_ref source_ref effective_instant spatial_scope relevance resume_policy',
  movement_event: 'event_id branch_id world_id event_sequence effective_time before_anchor after_anchor method_movement_kind owner_cause_causal_action_ref route_segment_refs consumed_revisions visibility',
  discovery_proposal: 'proposal_opportunity_identity observer_ref source_event_signal_refs spatial_channel_evidence effective_time owner_acceptance_receipt_ref',
  spatial_query_result: 'measure_type distance_estimate assumptions knowledge_revision route_freshness bounds_pagination',
  persistence_delivery: 'spatial_traces outbox_entries pending_recovery_refs placement_correction_provenance'
};
function shape(name, record) {
  requireThat(record && !Array.isArray(record) && typeof record === 'object', 'INVALID_SCHEMA');
  const allowed = FIELDS[name].split(' ');
  requireThat(Object.keys(record).every(k => allowed.includes(k)), 'UNDECLARED_STATE_VARIABLE');
  json(record);
  return record;
}
const OWNERS = Object.freeze([
  'creator', 'system1', 'system2', 'system3', 'system4', 'system5', 'system6',
  'system7', 'system8', 'system9', 'system10', 'system11', 'security', 'vehicles',
  'economy', 'health', 'environment', 'legal', 'physical', 'perception'
]);

/**
 * Static fixture contract:
 * fixtures[owner][operation][request.idempotency_key || '*'] = JSON response.
 * Responses are copied verbatim. These stubs do not derive outcomes, advance
 * time, evaluate permissions, debit balances, or simulate any external system.
 */
export function createDependencyStubs(fixtures = {}) {
  json(fixtures);
  const frozen = clone(fixtures);
  return Object.freeze(Object.fromEntries(OWNERS.map(owner => [owner,
    function placeholder(operation, request) {
      const entries = frozen[owner]?.[operation];
      const fixtureKey = request.idempotency_key ?? request.request?.command_id ?? request.command_id ?? '*';
      return clone(entries?.[fixtureKey] ?? entries?.['*'] ?? {
        status: 'unavailable', owner_ref: owner, reason: 'DUMMY_FIXTURE_NOT_SUPPLIED'
      });
    }
  ])));
}

/** Only architecture-listed game-state variables are persisted. */
export class SpatialState {
  constructor(saved = null) {
    this.domain = 'world_location_travel';
    this.world_definition = null;
    for (const field of Object.keys(FIELDS)) {
      if (!['world_definition', 'persistence_delivery'].includes(field)) this[field] = dict();
    }
    this.anchor_variants = {
      PLACE_NODE: ['node_ref', 'interaction_anchor_ref'],
      EDGE_PROGRESS: ['edge_ref', 'origin_node_ref', 'progress_mm', 'movement_ref'],
      CARRIER_SEAT: ['carrier_instance_ref', 'compartment_seat_ref', 'occupancy_receipt_ref']
    };
    this.persistence_delivery = {
      spatial_traces: [], outbox_entries: [], pending_recovery_refs: [],
      placement_correction_provenance: []
    };
    if (saved) {
      requireThat(canonical(Object.keys(saved).sort()) === canonical(Object.keys(this).sort()), 'INVALID_SNAPSHOT');
      requireThat(saved.domain === this.domain, 'INVALID_SNAPSHOT');
      Object.assign(this, clone(saved));
    }
  }
}

class Heap {
  items = [];
  static compare(a, b) {
    for (let i = 0; i < a.rank.length; i++) {
      if (a.rank[i] !== b.rank[i]) return a.rank[i] < b.rank[i] ? -1 : 1;
    }
    return a.pathKey < b.pathKey ? -1 : a.pathKey > b.pathKey ? 1 : 0;
  }
  push(value) {
    const a = this.items; a.push(value); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (Heap.compare(a[p], value) <= 0) break; a[i] = a[p]; i = p; }
    a[i] = value;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (!a.length) return first;
    let i = 0;
    while (2 * i + 1 < a.length) {
      let c = 2 * i + 1;
      if (c + 1 < a.length && Heap.compare(a[c + 1], a[c]) < 0) c++;
      if (Heap.compare(last, a[c]) <= 0) break;
      a[i] = a[c]; i = c;
    }
    a[i] = last; return first;
  }
}

/** SQLite is infrastructure; owner adapters never become canonical game state. */
export class WorldLocationTravel {
  #db;
  #adapters;
  constructor({ database = ':memory:', adapters = createDependencyStubs() } = {}) {
    this.#adapters = adapters;
    this.#db = new DatabaseSync(database);
    this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.#db.exec('CREATE TABLE IF NOT EXISTS system12_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL)');
    this.#db.prepare('INSERT OR IGNORE INTO system12_state VALUES(1, ?)').run(JSON.stringify(new SpatialState()));
  }
  close() { this.#db.close(); }
  #load() { return new SpatialState(JSON.parse(this.#db.prepare('SELECT payload FROM system12_state WHERE singleton=1').get().payload)); }
  #validateState(state) {
    if (state.world_definition) shape('world_definition', state.world_definition);
    for (const [entity] of Object.entries(FIELDS)) {
      if (entity === 'world_definition' || entity === 'persistence_delivery') continue;
      for (const record of Object.values(state[entity])) shape(entity, record);
    }
    const occupied = new Set();
    for (const [presenceKey, p] of Object.entries(state.character_presence)) {
      requireThat(presenceKey === key(p.branch_id, p.character_id) && integer(p.revision) && p.world_id === state.world_definition?.world_id, 'INVALID_PRESENCE');
      const anchor = this.#anchorOf(p);
      const travel = p.anchor_kind === 'EDGE_PROGRESS' ? state.travel[p.anchor_json.movement_ref] : null;
      const version = travel ? state.route_plan[travel.route_plan_ref]?.topology_version : state.world_definition.topology_version;
      this.#anchor(state, version, anchor);
      if (p.anchor_kind === 'CARRIER_SEAT') {
        const a = p.anchor_json, seat = key(p.branch_id, a.carrier_instance_ref, a.compartment_seat_ref);
        const receipt = state.owner_projection_ref[a.occupancy_receipt_ref];
        requireThat(!occupied.has(seat) && receipt.payload.actor_id === p.character_id && receipt.payload.branch_id === p.branch_id, 'DUPLICATE_OCCUPANCY');
        occupied.add(seat);
      }
      const last = state.movement_event[p.last_movement_event_id];
      requireThat(last && last.branch_id === p.branch_id && canonical(last.after_anchor) === canonical(anchor), 'BROKEN_MOVEMENT_CHAIN');
    }
    for (const s of Object.values(state.travel_segment)) {
      const travel = state.travel[s.travel_id], plan = travel && state.route_plan[travel.route_plan_ref];
      requireThat(plan && integer(s.progress_mm) && typeof s.rounding_residue === 'string' && /^\d+$/.test(s.rounding_residue), 'INVALID_SEGMENT');
      const edge = this.#edge(state, plan.topology_version, s.edge_id);
      // Unstarted known routes can be stale. Executed segments cannot lose their
      // pinned physical definition, including after a save/reload.
      if (s.state !== 'PLANNED') requireThat(edge && s.progress_mm <= edge.length_mm && BigInt(s.rounding_residue) < 1000000n, 'BROKEN_MOVEMENT_CHAIN');
    }
  }
  #transaction(work) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.#load(); this.#validateState(state);
      const result = work(state); this.#validateState(state);
      this.#db.prepare('UPDATE system12_state SET payload=? WHERE singleton=1').run(JSON.stringify(state));
      this.#db.exec('COMMIT'); return clone(result);
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #call(owner, operation, request) {
    try {
      const response = this.#adapters[owner]?.(operation, clone(request));
      json(response); return clone(response);
    } catch { return { status: 'unavailable', owner_ref: owner }; }
  }
  #projection(state, owner, operation, request, interval = null) {
    const response = this.#call(owner, operation, request);
    requireThat(response.status === 'accepted', 'OPERATIONAL_UNAVAILABLE');
    const p = shape('owner_projection_ref', response.projection);
    requireThat(p.owner_ref === owner && typeof p.record_receipt_ref === 'string' && p.revision !== undefined && p.payload, 'INVALID_OWNER_RECEIPT');
    if (interval) {
      requireThat(p.effective_interval && integer(p.effective_interval.start_ms) && integer(p.effective_interval.end_ms)
        && p.effective_interval.start_ms <= interval.start_ms && p.effective_interval.end_ms >= interval.end_ms, 'STALE_OWNER_PROJECTION');
    }
    const old = state.owner_projection_ref[p.record_receipt_ref];
    requireThat(!old || canonical(old) === canonical(p), 'OWNER_RECEIPT_CONFLICT');
    state.owner_projection_ref[p.record_receipt_ref] = clone(p);
    return p;
  }
  #event(state, type, eventIdentity, payload, recipients = []) {
    const entries = state.persistence_delivery.outbox_entries;
    if (!entries.some(e => e.event_id === eventIdentity)) entries.push({
      event_id: eventIdentity, type, payload: clone(payload), delivery_state: 'PENDING',
      recipients: [...recipients].sort(), accepted_receipts: {}
    });
  }
  #presence(state, request) {
    const p = state.character_presence[key(request.branch_id, request.actor_id)];
    requireThat(p, 'STALE_PRESENCE');
    requireThat(p.revision === request.expected_presence_revision, 'STALE_PRESENCE');
    return p;
  }
  #authorize(state, command) {
    const r = shape('travel_request', command.request);
    for (const n of ['command_id', 'branch_id', 'actor_id', 'causation_id']) requireThat(typeof r[n] === 'string' && r[n].length > 0, 'INVALID_REQUEST');
    for (const n of ['expected_presence_revision', 'expected_clock_revision', 'authorization_horizon_ms']) requireThat(integer(r[n]), 'INVALID_REQUEST');
    const auth = this.#projection(state, 'system1', 'authorize', command);
    const a = auth.payload;
    requireThat(a.actor_id === r.actor_id && a.branch_id === r.branch_id && a.causation_id === r.causation_id
      && Array.isArray(a.operations) && a.operations.includes(command.operation), 'AUTHORIZATION_EXCEEDED');
    requireThat(integer(a.authorization_horizon_ms) && a.authorization_horizon_ms >= r.authorization_horizon_ms, 'AUTHORIZATION_EXCEEDED');
    if (r.destination_ref) requireThat(a.destinations?.includes(r.destination_ref), 'AUTHORIZATION_EXCEEDED');
    if (r.mode) requireThat(a.modes?.includes(r.mode), 'AUTHORIZATION_EXCEEDED');
    if (r.delegation_ref) requireThat(a.delegation_ref === r.delegation_ref, 'AUTHORIZATION_EXCEEDED');
    if (a.actor_control === 'NPC' && ['plan', 'start', 'continue', 'cancel'].includes(command.operation)) {
      const decision = this.#projection(state, 'system6', 'decision', command);
      requireThat(decision.payload.actor_id === r.actor_id && decision.payload.branch_id === r.branch_id && decision.payload.accepted === true
        && decision.payload.destination_ref === r.destination_ref && decision.payload.mode === r.mode, 'AUTHORIZATION_EXCEEDED');
    }
    return auth;
  }
  #clock(state, request) {
    requireThat(!state.persistence_delivery.pending_recovery_refs.some(ref => {
      const prepared = state.commit_coordination[ref]?.stored_command_result?.prepared;
      return prepared?.request.branch_id === request.branch_id;
    }), 'RECOVERY_PENDING');
    const p = this.#projection(state, 'system11', 'clock', request);
    requireThat(integer(p.payload.now_ms) && p.payload.clock_revision === request.expected_clock_revision, 'STALE_CLOCK');
    const last = Object.values(state.movement_event).filter(e => e.branch_id === request.branch_id).reduce((time, e) => Math.max(time, e.effective_time), 0);
    requireThat(p.payload.now_ms >= last, 'STALE_CLOCK');
    return p;
  }
  #knowledge(state, request) {
    const p = this.#projection(state, 'system3', 'knowledge', request);
    requireThat(p.payload.actor_id === request.actor_id && p.payload.branch_id === request.branch_id, 'INVALID_OWNER_RECEIPT');
    requireThat(Array.isArray(p.payload.nodes) && Array.isArray(p.payload.edges), 'INVALID_OWNER_RECEIPT');
    return p;
  }
  #content(state, version = state.world_definition?.topology_version) {
    const p = state.owner_projection_ref[key('content', version)];
    requireThat(p, 'STALE_TOPOLOGY'); return p.payload;
  }
  #node(state, version, id) { return state.navigation_node[key(version, id)]; }
  #edge(state, version, id) { return state.nav_edge[key(version, id)]; }
  #anchor(state, version, anchor, movement = false) {
    requireThat(anchor && Object.keys(anchor).every(k => ['anchor_kind', 'anchor_json'].includes(k)), 'INVALID_ANCHOR');
    const allowed = state.anchor_variants[anchor.anchor_kind], a = anchor.anchor_json;
    requireThat(allowed && a && Object.keys(a).every(k => allowed.includes(k)), 'INVALID_ANCHOR');
    if (anchor.anchor_kind === 'PLACE_NODE') {
      requireThat(this.#node(state, version, a.node_ref), 'STALE_TOPOLOGY');
      if (a.interaction_anchor_ref) requireThat(state.spatial_affordances[version].interaction_anchors.some(x => x.id === a.interaction_anchor_ref && x.node_ref === a.node_ref), 'INVALID_ANCHOR');
    } else if (anchor.anchor_kind === 'EDGE_PROGRESS') {
      const edge = this.#edge(state, version, a.edge_ref);
      requireThat(edge && a.origin_node_ref === edge.from_node && integer(a.progress_mm) && a.progress_mm <= edge.length_mm && typeof a.movement_ref === 'string', 'INVALID_ANCHOR');
      requireThat(movement || state.travel[a.movement_ref], 'INVALID_ANCHOR');
    } else {
      requireThat(typeof a.carrier_instance_ref === 'string' && typeof a.compartment_seat_ref === 'string', 'INVALID_ANCHOR');
      const receipt = state.owner_projection_ref[a.occupancy_receipt_ref];
      requireThat(receipt?.owner_ref === 'vehicles' && receipt.payload.carrier_instance_ref === a.carrier_instance_ref
        && receipt.payload.compartment_seat_ref === a.compartment_seat_ref && receipt.payload.occupancy_accepted === true, 'CARRIER_UNAVAILABLE');
    }
  }
  #anchorOf(presence) { return { anchor_kind: presence.anchor_kind, anchor_json: clone(presence.anchor_json) }; }
  #safeAnchor(anchor, knowledge) {
    const k = knowledge?.payload;
    if (!k) return null;
    const a = anchor.anchor_json;
    if (anchor.anchor_kind === 'PLACE_NODE' && k.nodes.includes(a.node_ref)) return { anchor_kind: 'PLACE_NODE', anchor_json: { node_ref: a.node_ref } };
    if (anchor.anchor_kind === 'EDGE_PROGRESS' && k.edges.some(e => e.edge_id === a.edge_ref)) return { anchor_kind: 'EDGE_PROGRESS', anchor_json: { edge_ref: a.edge_ref, progress_mm: a.progress_mm } };
    if (anchor.anchor_kind === 'CARRIER_SEAT' && k.known_carriers?.includes(a.carrier_instance_ref)) return { anchor_kind: 'CARRIER_SEAT', anchor_json: { carrier_instance_ref: a.carrier_instance_ref } };
    return { anchor_kind: anchor.anchor_kind, anchor_json: null };
  }
  #result(state, request, travel = null, status = null, knowledge = null) {
    const p = state.character_presence[key(request.branch_id, request.actor_id)];
    return {
      travel_id: travel?.travel_id ?? null, status: status ?? travel?.state ?? 'ACCEPTED',
      committed_anchor: p ? this.#safeAnchor(this.#anchorOf(p), knowledge) : null,
      route: travel ? state.route_plan[travel.route_plan_ref].ordered_segment_definitions.map(id => {
        const d = state.route_segment_definition[id]; return { edge_ref: d.edge_path_ref, mode: d.mode };
      }) : [],
      progress: travel?.elapsed_distance_receipts.map(ref => clone(state.owner_projection_ref[ref].observable_evidence)) ?? [],
      elapsed_distance_receipts: travel?.elapsed_distance_receipts ?? [],
      accepted_costs: travel?.accepted_cost_receipts.map(ref => clone(state.owner_projection_ref[ref]?.observable_evidence ?? {})) ?? [],
      known_observations: [], stop_reason: travel?.stop_reason ?? null,
      remaining_authorization: travel?.remaining_authorization ?? null,
      permitted_continuations: travel?.state === 'PAUSED' ? ['continue', 'cancel'] : [],
      trace_id: travel?.trace_id ?? uid(request.branch_id, request.command_id, 'trace')
    };
  }

  /** Typed JSON entry point. There is deliberately no set-location operation. */
  execute(command) {
    try {
      json(command); requireThat(command && command.request && typeof command.operation === 'string', 'INVALID_REQUEST');
      if (command.operation === 'step' || command.operation === 'recover') return this.#step(command);
      return this.#transaction(state => {
        const auth = this.#authorize(state, command), r = command.request;
        const id = key('command', r.branch_id, r.command_id), digest = identity(command), previous = state.commit_coordination[id];
        if (previous) {
          requireThat(previous.request_payload_identity === digest, 'IDEMPOTENCY_CONFLICT');
          return previous.stored_command_result ?? this.#result(state, r, null, 'RECOVERY_PENDING');
        }
        let result;
        switch (command.operation) {
          case 'adopt': result = this.#adopt(state, command); break;
          case 'place': case 'correct': case 'displace': result = this.#placement(state, command); break;
          case 'plan': result = this.#plan(state, command, auth); break;
          case 'start': case 'continue': case 'cancel': result = this.#control(state, command, auth); break;
          case 'nearby': result = this.#nearby(state, command); break;
          case 'query': result = this.#query(state, command); break;
          case 'observe': result = this.#observe(state, command); break;
          case 'narrate': result = this.#narrate(state, command); break;
          case 'flush': result = this.#flush(state, command); break;
          case 'inspect': result = this.#inspect(state, command, auth); break;
          case 'fork': result = this.#fork(state, command, auth); break;
          default: throw new SpatialError('UNSUPPORTED_OPERATION');
        }
        state.commit_coordination[id] = {
          state: 'COMMITTED', idempotency_key: id, request_payload_identity: digest,
          reservation_refs: [], clock_coverage_receipt_ref: null, required_owner_receipt_refs: [],
          pending_receipts: [], stored_command_result: result
        };
        state.persistence_delivery.spatial_traces.push({ trace_id: uid(r.branch_id, r.command_id, 'trace'),
          operation: command.operation, actor_id: r.actor_id, branch_id: r.branch_id,
          authorization_ref: auth.record_receipt_ref, result_status: result.status,
          topology_version: state.world_definition?.topology_version ?? null });
        return result;
      });
    } catch (error) {
      const visible = new Set(['INVALID_REQUEST', 'INVALID_JSON', 'IDEMPOTENCY_CONFLICT', 'AUTHORIZATION_EXCEEDED', 'STALE_PRESENCE', 'STALE_CLOCK', 'UNKNOWN_DESTINATION', 'NO_KNOWN_ROUTE', 'PLANNING_BUDGET_EXCEEDED', 'OPERATIONAL_UNAVAILABLE', 'RECOVERY_PENDING', 'UNSUPPORTED_OPERATION']);
      return { status: 'REJECTED', stop_reason: visible.has(error.code) ? error.code : 'REQUEST_NOT_ACCEPTED' };
    }
  }

  #adopt(state, command) {
    const accepted = this.#projection(state, 'creator', 'adopt', command), pack = accepted.payload;
    const world = shape('world_definition', pack.world_definition), version = world.topology_version;
    requireThat(world.arithmetic_rounding_policy_version === 'mm-ms-v1', 'UNSUPPORTED_ARITHMETIC');
    requireThat(typeof version === 'string' && typeof world.world_id === 'string', 'INVALID_SCHEMA');
    requireThat(!state.owner_projection_ref[key('content', version)], 'IMMUTABLE_CONTENT_VERSION');
    requireThat(!state.world_definition || state.world_definition.world_id === world.world_id, 'WORLD_MISMATCH');
    requireThat(!Object.values(state.travel).some(t => !['ARRIVED', 'CANCELLED'].includes(t.state)), 'ACTIVE_ROUTE_MIGRATION_REQUIRED');
    const kinds = ['city', 'subdivision', 'district', 'neighborhood', 'street_block', 'property', 'room'];
    const places = new Map(), nodes = new Map(), edges = new Set();
    for (const place of pack.place) {
      shape('place', place); requireThat(!places.has(place.place_id) && kinds.includes(place.kind) && place.world_id === world.world_id && integer(place.revision), 'INVALID_PLACE');
      places.set(place.place_id, place);
    }
    shape('spatial_structure', pack.spatial_structure); shape('spatial_affordances', pack.spatial_affordances);
    const containment = new Map();
    for (const relation of pack.spatial_structure.physical_containment_relations) {
      requireThat(places.has(relation.child_id) && places.has(relation.parent_id) && !containment.has(relation.child_id), 'INVALID_CONTAINMENT');
      containment.set(relation.child_id, relation.parent_id);
    }
    for (const place of places.values()) {
      if (place.parent_id !== null) requireThat(places.has(place.parent_id) && kinds.indexOf(places.get(place.parent_id).kind) < kinds.indexOf(place.kind), 'INVALID_PARENT_KIND');
      const seen = new Set(); let cursor = place.place_id;
      while (containment.has(cursor)) {
        requireThat(!seen.has(cursor), 'CONTAINMENT_CYCLE'); seen.add(cursor);
        const parent = containment.get(cursor);
        requireThat(kinds.indexOf(places.get(parent).kind) < kinds.indexOf(places.get(cursor).kind), 'INVALID_PARENT_KIND');
        cursor = parent;
      }
      requireThat(places.get(cursor)?.kind === 'city', 'INVALID_CONTAINMENT');
    }
    for (const node of pack.navigation_node) {
      shape('navigation_node', node);
      requireThat(places.has(node.place_id) && !nodes.has(node.node_id) && typeof node.geometry_is_nonmetric === 'boolean', 'INVALID_NODE');
      requireThat(pack.spatial_structure.floors.some(f => f.floor_id === node.floor_elevation_ref), 'INVALID_FLOOR');
      if (!node.geometry_is_nonmetric) requireThat(['x_mm', 'y_mm', 'z_mm'].every(k => Number.isSafeInteger(node.coordinates_or_relative_geometry[k])), 'INVALID_GEOMETRY');
      nodes.set(node.node_id, node);
    }
    requireThat(pack.modes && Object.values(pack.modes).every(x => integer(x, 1) && Number.isInteger(Math.log2(x))), 'INVALID_MODES');
    requireThat(new Set(Object.values(pack.modes)).size === Object.keys(pack.modes).length, 'INVALID_MODES');
    const mask = Object.values(pack.modes).reduce((a, b) => a | b, 0);
    for (const edge of pack.nav_edge) {
      shape('nav_edge', edge);
      requireThat(!edges.has(edge.edge_id) && nodes.has(edge.from_node) && nodes.has(edge.to_node) && integer(edge.length_mm)
        && integer(edge.mode_mask, 1) && (edge.mode_mask & ~mask) === 0 && edge.version === version && edge.directionality === 'directed', 'INVALID_EDGE');
      edges.add(edge.edge_id);
      const profile = pack.profiles[edge.duration_profile_ref];
      requireThat(profile && world.movement_profile_versions.includes(edge.duration_profile_ref), 'INVALID_PROFILE');
      requireThat(['walk', 'stairs', 'door', 'board', 'alight', 'ride', 'drive', 'wait', 'bookkeeping'].includes(profile.kind), 'INVALID_PROFILE');
      requireThat(edge.length_mm > 0 || profile.kind === 'bookkeeping', 'INVALID_ZERO_LENGTH_EDGE');
      requireThat(profile.setup_ms === undefined || integer(profile.setup_ms), 'INVALID_PROFILE');
      requireThat(profile.speed_mm_s === undefined || integer(profile.speed_mm_s, 1), 'INVALID_PROFILE');
      const policy = pack.spatial_affordances.access_policies.find(p => p.id === edge.access_policy_id);
      requireThat(policy && Array.isArray(policy.required_owners) && policy.required_owners.every(o => OWNERS.includes(o)), 'INVALID_ACCESS_POLICY');
      const a = nodes.get(edge.from_node), b = nodes.get(edge.to_node);
      if (a.floor_elevation_ref !== b.floor_elevation_ref) requireThat(profile.vertical === true, 'INVALID_FLOOR_EDGE');
      if (!a.geometry_is_nonmetric && !b.geometry_is_nonmetric) {
        const squared = ['x_mm', 'y_mm', 'z_mm'].reduce((sum, axis) => {
          const difference = BigInt(a.coordinates_or_relative_geometry[axis]) - BigInt(b.coordinates_or_relative_geometry[axis]); return sum + difference * difference;
        }, 0n);
        const tolerance = pack.metric_tolerance_mm ?? 0;
        requireThat(integer(tolerance) && (BigInt(edge.length_mm) + BigInt(tolerance)) ** 2n >= squared, 'INVALID_METRIC_LENGTH');
      }
    }
    // Existing anchors must remain physically identical; occupied edits require
    // a prior explicit correction. Historical definitions remain retained.
    for (const p of Object.values(state.character_presence)) {
      if (p.anchor_kind === 'PLACE_NODE') requireThat(canonical(nodes.get(p.anchor_json.node_ref)) === canonical(this.#node(state, state.world_definition.topology_version, p.anchor_json.node_ref)), 'OCCUPIED_CONTENT_MIGRATION_REQUIRED');
      else requireThat(false, 'OCCUPIED_CONTENT_MIGRATION_REQUIRED');
    }
    state.world_definition = clone(world);
    state.owner_projection_ref[key('content', version)] = clone(accepted);
    for (const p of pack.place) state.place[key(version, p.place_id)] = clone(p);
    for (const n of pack.navigation_node) state.navigation_node[key(version, n.node_id)] = clone(n);
    for (const e of pack.nav_edge) state.nav_edge[key(version, e.edge_id)] = clone(e);
    state.spatial_structure[version] = clone(pack.spatial_structure);
    state.spatial_affordances[version] = clone(pack.spatial_affordances);
    this.#event(state, 'TopologyVersionAdopted', uid(version, 'adopt'), { version });
    for (const p of pack.place) this.#event(state, 'PlaceDefined', uid(version, p.place_id), { place_id: p.place_id });
    return { status: 'ACCEPTED', topology_version: version };
  }

  #placement(state, command) {
    const r = command.request, version = state.world_definition?.topology_version;
    requireThat(version, 'STALE_TOPOLOGY');
    const owner = command.operation === 'displace' ? 'physical' : 'creator';
    const authority = this.#projection(state, owner, command.operation, command), data = authority.payload;
    requireThat(data.actor_id === r.actor_id && data.branch_id === r.branch_id && data.causation_id === r.causation_id && data.capacity_access_accepted === true, 'INVALID_OWNER_RECEIPT');
    const id = key(r.branch_id, r.actor_id), previous = state.character_presence[id];
    if (command.operation === 'place') requireThat(!previous && !state.movement_event[uid(r.branch_id, r.actor_id, 'placement')], 'ALREADY_PLACED');
    else {
      this.#presence(state, r);
      requireThat(canonical(data.before_anchor) === canonical(this.#anchorOf(previous)), 'STALE_PRESENCE');
      requireThat(!Object.values(state.travel).some(t => t.branch_id === r.branch_id && t.actor_id === r.actor_id && !['ARRIVED', 'CANCELLED'].includes(t.state)), 'ACTIVE_ROUTE_RECOVERY_REQUIRED');
    }
    if (data.anchor.anchor_kind === 'CARRIER_SEAT') this.#projection(state, 'vehicles', 'occupancy', command);
    this.#anchor(state, version, data.anchor);
    requireThat(integer(data.effective_time_ms), 'INVALID_OWNER_RECEIPT');
    if (command.operation === 'displace') requireThat(data.grounded_cause_ref && data.geometry_validated === true && data.time_coverage_receipt_ref, 'INVALID_DISPLACEMENT');
    const eventId = command.operation === 'place' ? uid(r.branch_id, r.actor_id, 'placement') : uid(r.branch_id, r.command_id, command.operation);
    const p = {
      branch_id: r.branch_id, world_id: state.world_definition.world_id, character_id: r.actor_id,
      ...clone(data.anchor), revision: (previous?.revision ?? -1) + 1, last_movement_event_id: eventId
    };
    state.character_presence[id] = p;
    state.movement_event[eventId] = {
      event_id: eventId, branch_id: r.branch_id, world_id: p.world_id,
      event_sequence: Object.values(state.movement_event).filter(e => e.branch_id === r.branch_id).length,
      effective_time: data.effective_time_ms, before_anchor: previous ? this.#anchorOf(previous) : null,
      after_anchor: clone(data.anchor), method_movement_kind: command.operation,
      owner_cause_causal_action_ref: authority.record_receipt_ref, route_segment_refs: [],
      consumed_revisions: [authority.record_receipt_ref], visibility: 'owner-filtered'
    };
    state.persistence_delivery.placement_correction_provenance.push({ authority: authority.record_receipt_ref, before_anchor: previous ? this.#anchorOf(previous) : null, after_anchor: clone(data.anchor), branch_id: r.branch_id, reason: data.reason ?? command.operation });
    this.#event(state, 'MovementCommitted', eventId, state.movement_event[eventId], ['system9']);
    return this.#result(state, r);
  }

  #search(knowledge, source, destination, request, limit = 50000) {
    const k = knowledge.payload, adjacency = new Map(), ids = new Set();
    requireThat(['earliest', 'usual', 'shortest_walk', 'lowest_cost', 'fewest_transfers'].includes(request.route_preference), 'INVALID_REQUEST');
    const usual = request.route_preference === 'usual' ? k.usual_routes?.[request.destination_ref] : null;
    if (request.route_preference === 'usual') requireThat(Array.isArray(usual), 'NO_KNOWN_ROUTE');
    requireThat(k.nodes.includes(source), 'NO_KNOWN_ROUTE');
    for (const edge of k.edges) {
      requireThat(typeof edge.edge_id === 'string' && !ids.has(edge.edge_id) && k.nodes.includes(edge.from_node) && k.nodes.includes(edge.to_node), 'INVALID_KNOWN_GRAPH');
      ids.add(edge.edge_id);
      requireThat(integer(edge.length_mm) && integer(edge.estimated_duration_ms) && integer(edge.known_cost ?? 0) && integer(edge.transfers ?? 0), 'INVALID_KNOWN_GRAPH');
      if (!edge.modes.includes(request.mode) || edge.eligible !== true) continue;
      if (usual && !usual.includes(edge.edge_id)) continue;
      if ((k.accessibility_needs ?? []).some(need => !(edge.accessibility_support ?? []).includes(need))) continue;
      if ((k.avoidances ?? []).some(avoid => avoid === edge.edge_id || avoid === edge.to_node || (edge.tags ?? []).includes(avoid))) continue;
      if (!adjacency.has(edge.from_node)) adjacency.set(edge.from_node, []);
      adjacency.get(edge.from_node).push(edge);
    }
    const rank = (duration, distance, cost, transfers) => request.route_preference === 'shortest_walk' ? [distance]
      : request.route_preference === 'lowest_cost' ? [cost]
      : request.route_preference === 'fewest_transfers' ? [transfers] : [duration];
    const heap = new Heap(), best = new Map(), settled = new Map();
    heap.push({ node: source, path: [], visited: [source], pathKey: '', duration: 0, distance: 0, cost: 0, transfers: 0, rank: rank(0, 0, 0, 0) });
    let expansions = 0;
    while (heap.items.length) {
      const item = heap.pop();
      if (best.has(item.node) && Heap.compare(best.get(item.node), item) < 0) continue;
      if (settled.has(item.node) && !(k.budget_constraints ?? []).length) continue;
      if (++expansions > limit) throw new SpatialError('PLANNING_BUDGET_EXCEEDED');
      if (!settled.has(item.node) || Heap.compare(item, settled.get(item.node)) < 0) settled.set(item.node, item);
      if (destination && item.node === destination) return item;
      for (const edge of adjacency.get(item.node) ?? []) {
        if (item.visited.includes(edge.to_node)) continue;
        let wait = 0;
        if (edge.known_departures_ms) {
          requireThat(integer(k.as_of_ms) && edge.known_departures_ms.every(t => integer(t)), 'INVALID_KNOWN_GRAPH');
          const departure = [...edge.known_departures_ms].sort((a, b) => a - b).find(t => t > k.as_of_ms + item.duration);
          if (departure === undefined) continue;
          wait = departure - k.as_of_ms - item.duration;
        }
        const duration = item.duration + wait + edge.estimated_duration_ms, distance = item.distance + edge.length_mm;
        const cost = item.cost + (edge.known_cost ?? 0), transfers = item.transfers + (edge.transfers ?? 0);
        requireThat([duration, distance, cost, transfers].every(x => integer(x)), 'NUMERIC_OVERFLOW');
        if ((k.budget_constraints ?? []).some(b =>
          (b.max_cost !== undefined && cost > b.max_cost) || (b.max_duration_ms !== undefined && duration > b.max_duration_ms)
          || (b.max_distance_mm !== undefined && distance > b.max_distance_mm) || (b.max_transfers !== undefined && transfers > b.max_transfers))) continue;
        const next = { node: edge.to_node, path: [...item.path, edge], visited: [...item.visited, edge.to_node], pathKey: canonical([...item.path.map(e => e.edge_id), edge.edge_id]), duration, distance, cost, transfers, rank: rank(duration, distance, cost, transfers) };
        // Constrained searches retain independent resource labels. Selecting only
        // the fastest prefix could discard the sole affordable complete route.
        if ((k.budget_constraints ?? []).length) {
          const label = key(next.node, next.duration, next.distance, next.cost, next.transfers, next.visited);
          if (!best.has(label)) { best.set(label, next); heap.push(next); }
        } else if (!best.has(next.node) || Heap.compare(next, best.get(next.node)) < 0) { best.set(next.node, next); heap.push(next); }
      }
    }
    if (destination) throw new SpatialError('NO_KNOWN_ROUTE');
    return settled;
  }
  #source(state, presence, command) {
    if (presence.anchor_kind === 'PLACE_NODE') return presence.anchor_json.node_ref;
    if (presence.anchor_kind === 'EDGE_PROGRESS') return null;
    const p = this.#projection(state, 'vehicles', 'position', command);
    requireThat(p.payload.carrier_instance_ref === presence.anchor_json.carrier_instance_ref && p.payload.occupancy_receipt_ref === presence.anchor_json.occupancy_receipt_ref, 'CARRIER_UNAVAILABLE');
    requireThat(p.payload.world_anchor?.anchor_kind === 'PLACE_NODE', 'METHOD_UNAVAILABLE');
    return p.payload.world_anchor.anchor_json.node_ref;
  }
  #plan(state, command, auth) {
    const r = command.request, presence = this.#presence(state, r), known = this.#knowledge(state, r), k = known.payload;
    const destination = k.destinations?.[r.destination_ref];
    requireThat(destination && k.nodes.includes(destination), 'UNKNOWN_DESTINATION');
    const source = this.#source(state, presence, command);
    let path, initialProgress = 0, initialResidue = '0', initialEdge = null;
    if (source === null) {
      const a = presence.anchor_json, edge = k.edges.find(e => e.edge_id === a.edge_ref && e.from_node === a.origin_node_ref);
      requireThat(edge && edge.modes.includes(r.mode) && edge.eligible && a.progress_mm <= edge.length_mm, 'NO_KNOWN_ROUTE');
      const oldSegment = Object.values(state.travel_segment).find(s => s.travel_id === a.movement_ref && s.edge_id === a.edge_ref && s.progress_mm === a.progress_mm);
      requireThat(oldSegment, 'RECOVERY_PENDING');
      const forwardPosition = BigInt(a.progress_mm) * 1000n + BigInt(oldSegment.rounding_residue);
      const candidates = [{ edge, position: forwardPosition }];
      const reverse = k.edges.find(e => e.edge_id === edge.reverse_edge_ref);
      if (reverse && reverse.from_node === edge.to_node && reverse.to_node === edge.from_node && reverse.length_mm === edge.length_mm && reverse.modes.includes(r.mode) && reverse.eligible) {
        candidates.push({ edge: reverse, position: BigInt(edge.length_mm) * 1000n - forwardPosition });
      }
      const feasible = [];
      for (const candidate of candidates) {
        try {
          const e = candidate.edge, progress = number(candidate.position / 1000000n) * 1000;
          const tail = e.to_node === destination ? { path: [], distance: 0, duration: 0, cost: 0, transfers: 0 }
            : this.#search(known, e.to_node, destination, r);
          feasible.push({ edge: e, progress, residue: String(candidate.position - BigInt(progress) * 1000n),
            path: { ...tail, path: [e, ...tail.path], distance: e.length_mm - progress + tail.distance,
              duration: number(ceilDiv(BigInt(e.estimated_duration_ms) * (BigInt(e.length_mm) * 1000n - candidate.position), BigInt(Math.max(1, e.length_mm)) * 1000n)) + tail.duration } });
        } catch (error) { if (error.code !== 'NO_KNOWN_ROUTE') throw error; }
      }
      requireThat(feasible.length, 'NO_KNOWN_ROUTE');
      feasible.sort((a, b) => {
        const metric = r.route_preference === 'shortest_walk' ? 'distance' : r.route_preference === 'lowest_cost' ? 'cost' : r.route_preference === 'fewest_transfers' ? 'transfers' : 'duration';
        return a.path[metric] - b.path[metric] || (canonical(a.path.path.map(e => e.edge_id)) < canonical(b.path.path.map(e => e.edge_id)) ? -1 : 1);
      });
      ({ path, progress: initialProgress, residue: initialResidue, edge: initialEdge } = feasible[0]);
    } else path = this.#search(known, source, destination, r);
    const planId = uid(r.branch_id, r.command_id, 'plan'), segmentIds = [];
    path.path.forEach((edge, index) => {
      const segment_id = uid(planId, index), d = {
        segment_id, edge_path_ref: edge.edge_id, direction: 'forward', length_mm: edge.length_mm,
        mode: edge.segment_mode ?? r.mode, duration_policy_ref: edge.duration_profile_ref,
        checkpoint_interrupt_policy_refs: [], target_anchor: { anchor_kind: 'PLACE_NODE', anchor_json: { node_ref: edge.to_node } }
      };
      state.route_segment_definition[segment_id] = d; segmentIds.push(segment_id);
    });
    const version = state.world_definition?.topology_version;
    requireThat(version, 'STALE_TOPOLOGY');
    state.route_plan[planId] = {
      route_plan_id: planId, plan_version: '1', actor_id: r.actor_id, source_anchor: this.#anchorOf(presence), destination_ref: r.destination_ref,
      topology_version: version, knowledge_revision: known.revision, mode: r.mode,
      accessibility_needs: k.accessibility_needs ?? [], allowed_transfers: k.allowed_transfers ?? [], budget_constraints: k.budget_constraints ?? [], avoidances: k.avoidances ?? [],
      authorization_horizon_ms: r.authorization_horizon_ms, ordered_segment_definitions: segmentIds,
      estimated_duration: path.duration, estimated_distance: path.distance, projected_costs: [],
      known_constraints: path.path.flatMap(e => e.known_constraints ?? []), required_choices: path.path.flatMap(e => e.required_choices ?? []),
      assumptions_uncertainty: { known_projection_ref: known.record_receipt_ref, authorization_ref: auth.record_receipt_ref, initial_progress_mm: initialProgress, initial_rounding_residue: initialResidue, initial_edge_ref: initialEdge?.edge_id ?? null, destination_node_ref: destination },
      freshness_source_revisions: [known.record_receipt_ref]
    };
    state.travel_request[key(r.branch_id, r.command_id)] = clone(r);
    this.#event(state, 'RouteProposed', uid(planId, 'proposed'), { route_plan_ref: planId });
    return { ...this.#result(state, r, null, 'PLANNED', known), route_plan_id: planId, route: path.path.map(e => e.edge_id), estimated_duration_ms: path.duration, estimated_distance_mm: path.distance };
  }

  #control(state, command, auth) {
    const r = command.request, p = this.#presence(state, r), clock = this.#clock(state, r);
    let travel = command.travel_id ? state.travel[command.travel_id] : null;
    if (command.operation === 'start') {
      const plan = state.route_plan[command.route_plan_id];
      requireThat(plan && plan.actor_id === r.actor_id && plan.destination_ref === r.destination_ref && plan.mode === r.mode, 'INVALID_ROUTE');
      requireThat(state.owner_projection_ref[plan.assumptions_uncertainty.authorization_ref]?.payload.branch_id === r.branch_id, 'INVALID_ROUTE');
      requireThat(canonical(plan.source_anchor) === canonical(this.#anchorOf(p)), 'STALE_PRESENCE');
      requireThat(!Object.values(state.travel).some(t => t.actor_id === r.actor_id && t.branch_id === r.branch_id && !['ARRIVED', 'CANCELLED'].includes(t.state)), 'CAPACITY_CONFLICT');
      requireThat(plan.required_choices.every(c => auth.payload.accepted_choices?.includes(c)), 'AUTHORIZATION_EXCEEDED');
      const admission = this.#projection(state, 'security', 'admit', command, { start_ms: clock.payload.now_ms, end_ms: clock.payload.now_ms + 1 });
      requireThat(admission.payload.actor_id === r.actor_id && admission.payload.branch_id === r.branch_id && admission.payload.route_plan_ref === plan.route_plan_id && admission.payload.accepted === true, 'METHOD_UNAVAILABLE');
      const travel_id = uid(r.branch_id, r.command_id, 'travel');
      travel = {
        travel_id, branch_id: r.branch_id, actor_id: r.actor_id, command_id: r.command_id, causation_id: r.causation_id,
        continuation_lineage_ref: p.anchor_kind === 'EDGE_PROGRESS' ? p.anchor_json.movement_ref : null,
        route_plan_ref: plan.route_plan_id, state: 'ADMITTED', current_segment_ref: plan.ordered_segment_definitions[0] ?? null,
        remaining_route: [...plan.ordered_segment_definitions], remaining_authorization: { duration_ms: r.authorization_horizon_ms, authorization_ref: auth.record_receipt_ref },
        reservation_refs: admission.payload.reservation_refs ?? [], elapsed_distance_receipts: [], accepted_cost_receipts: [], sample_refs: [], pending_choices: [], stop_reason: null, trace_id: uid(travel_id, 'trace')
      };
      state.travel[travel_id] = travel;
      for (const id of travel.remaining_route) {
        const d = state.route_segment_definition[id], progress = id === travel.current_segment_ref ? plan.assumptions_uncertainty.initial_progress_mm : 0;
        const previous = travel.continuation_lineage_ref ? Object.values(state.travel_segment).find(s => s.travel_id === travel.continuation_lineage_ref && s.edge_id === d.edge_path_ref && s.progress_mm === progress) : null;
        state.travel_segment[key(travel_id, id)] = {
          segment_id: id, travel_id, edge_id: d.edge_path_ref, progress_mm: progress, rounding_residue: id === travel.current_segment_ref ? plan.assumptions_uncertainty.initial_rounding_residue : '0', state: 'PLANNED', duration_receipt_id: null,
          boundary_snapshot: { setup_elapsed_ms: previous?.boundary_snapshot.setup_elapsed_ms ?? 0, motion_elapsed_ms: previous?.boundary_snapshot.motion_elapsed_ms ?? 0, source_anchor: this.#anchorOf(p) },
          access_snapshot: {}, reservation_refs: [], owner_receipt_refs: [], sample_refs: []
        };
      }
      this.#event(state, 'TravelAdmitted', uid(travel_id, 'admit'), { travel_id });
      travel.state = travel.remaining_route.length ? 'ACTIVE' : 'ARRIVED';
      this.#event(state, travel.state === 'ARRIVED' ? 'TravelArrived' : 'TravelStarted', uid(travel_id, travel.state), { travel_id });
    } else {
      requireThat(travel && travel.branch_id === r.branch_id && travel.actor_id === r.actor_id, 'INVALID_TRAVEL');
      const plan = state.route_plan[travel.route_plan_ref];
      requireThat(plan.destination_ref === r.destination_ref && plan.mode === r.mode, 'AUTHORIZATION_EXCEEDED');
      requireThat(travel.state !== 'RECOVERY_REQUIRED', 'RECOVERY_PENDING');
      if (command.operation === 'cancel') {
        requireThat(['ACTIVE', 'PAUSED', 'ADMITTED'].includes(travel.state), 'INVALID_TRAVEL_STATE');
        const stop = this.#projection(state, 'environment', 'safe_stop', command);
        requireThat(stop.payload.safe === true && canonical(stop.payload.anchor) === canonical(this.#anchorOf(p)), 'METHOD_UNAVAILABLE');
        travel.state = 'CANCELLED'; travel.stop_reason = 'CANCELLED';
        this.#event(state, 'TravelCancelled', uid(travel.travel_id, r.command_id), { travel_id: travel.travel_id, reservation_refs: travel.reservation_refs, release_future_reservations_only: true }, ['security', 'vehicles', 'economy']);
      } else {
        requireThat(travel.state === 'PAUSED', 'INVALID_TRAVEL_STATE');
        travel.remaining_authorization = { duration_ms: r.authorization_horizon_ms, authorization_ref: auth.record_receipt_ref };
        travel.state = 'ACTIVE'; travel.stop_reason = null; travel.pending_choices = [];
      }
    }
    return this.#result(state, r, travel, null, this.#knowledge(state, r));
  }

  #pause(state, travel, reason, recovery = false) {
    travel.state = recovery ? 'RECOVERY_REQUIRED' : 'PAUSED';
    travel.stop_reason = reason;
    this.#event(state, recovery ? 'SpatialRecoveryRequired' : 'TravelPaused', uid(travel.travel_id, travel.current_segment_ref, reason, travel.elapsed_distance_receipts.length), { travel_id: travel.travel_id });
  }

  #prepare(state, command, auth) {
    const r = command.request, travel = state.travel[command.travel_id];
    requireThat(travel && travel.branch_id === r.branch_id && travel.actor_id === r.actor_id, 'INVALID_TRAVEL');
    requireThat(travel.state === 'ACTIVE', 'RECOVERY_PENDING');
    const presence = this.#presence(state, r), plan = state.route_plan[travel.route_plan_ref], known = this.#knowledge(state, r);
    requireThat(plan.destination_ref === r.destination_ref && plan.mode === r.mode, 'AUTHORIZATION_EXCEEDED');
    const clock = this.#clock(state, r), now = clock.payload.now_ms;
    requireThat(travel.remaining_authorization.duration_ms > 0, 'AUTHORIZATION_EXCEEDED');
    const segment = state.travel_segment[key(travel.travel_id, travel.current_segment_ref)];
    const edge = this.#edge(state, plan.topology_version, segment.edge_id);
    if (!edge) { this.#pause(state, travel, 'RECOVERY_PENDING', true); return { result: this.#result(state, r, travel, null, known) }; }
    const pack = this.#content(state, plan.topology_version), profile = pack.profiles[edge.duration_profile_ref];
    const segmentMode = state.route_segment_definition[segment.segment_id].mode;
    requireThat((edge.mode_mask & pack.modes[segmentMode]) !== 0, 'METHOD_UNAVAILABLE');
    requireThat((auth.payload.segment_modes ?? auth.payload.modes).includes(segmentMode), 'AUTHORIZATION_EXCEEDED');
    const source = this.#anchorOf(presence);
    if (source.anchor_kind === 'PLACE_NODE') requireThat(source.anchor_json.node_ref === edge.from_node && segment.progress_mm === 0, 'INVALID_PATH');
    if (source.anchor_kind === 'EDGE_PROGRESS') {
      if (source.anchor_json.edge_ref === edge.edge_id) requireThat(source.anchor_json.progress_mm === segment.progress_mm, 'INVALID_PATH');
      else {
        const priorEdge = this.#edge(state, plan.topology_version, source.anchor_json.edge_ref);
        const priorProfile = priorEdge && pack.profiles[priorEdge.duration_profile_ref];
        requireThat(priorProfile?.reverse_edge_ref === edge.edge_id && priorEdge.from_node === edge.to_node && priorEdge.to_node === edge.from_node && priorEdge.length_mm === edge.length_mm, 'INVALID_PATH');
        requireThat(canonical(plan.source_anchor) === canonical(source), 'STALE_PRESENCE');
      }
    }
    const checkpointKey = key('checkpoint', travel.travel_id, segment.segment_id, travel.elapsed_distance_receipts.length);
    const context = { ...clone(command), idempotency_key: checkpointKey, source_anchor: source, edge: clone(edge), profile: clone(profile), now_ms: now, expected_presence_revision: presence.revision };
    const condition = this.#projection(state, 'environment', 'conditions', context, { start_ms: now, end_ms: now + 1 });
    const functional = this.#projection(state, 'health', 'function', context, { start_ms: now, end_ms: now + 1 });
    requireThat(condition.payload.edge_id === edge.edge_id && functional.payload.actor_id === r.actor_id, 'INVALID_OWNER_RECEIPT');
    if (functional.payload.method_available !== true) { this.#pause(state, travel, 'MOVEMENT_REQUIRES_CHOICE'); return { result: this.#result(state, r, travel, null, known) }; }
    const policy = state.spatial_affordances[plan.topology_version].access_policies.find(p => p.id === edge.access_policy_id);
    const access = this.#projection(state, 'security', 'access', context, { start_ms: now, end_ms: now + 1 });
    const a = access.payload;
    requireThat(a.actor_id === r.actor_id && a.edge_id === edge.edge_id && a.branch_id === r.branch_id, 'INVALID_OWNER_RECEIPT');
    requireThat(['allowed', 'blocked', 'needs-owner-action'].includes(a.result), 'INVALID_OWNER_RECEIPT');
    state.access_evaluation[checkpointKey] = {
      result: a.result, structured_causes: a.structured_causes ?? [], source_revisions: [access.record_receipt_ref], effective_interval: access.effective_interval,
      observable_evidence: access.observable_evidence, hidden_causes: access.hidden_causes
    };
    this.#event(state, 'AccessEvaluated', uid(checkpointKey, 'access'), { evaluation_ref: checkpointKey });
    if (a.result !== 'allowed' || a.physical_traversable !== true || a.capacity_reserved !== true || a.temporal_available !== true) {
      this.#pause(state, travel, 'MOVEMENT_REQUIRES_CHOICE'); return { result: this.#result(state, r, travel, null, known) };
    }
    if (a.permission !== true) requireThat(auth.payload.methods?.includes('restricted_entry'), 'AUTHORIZATION_EXCEEDED');
    if (a.requires_owner_action === true) {
      requireThat(a.owner_action_receipt_ref && auth.payload.methods?.includes(a.method), 'AUTHORIZATION_EXCEEDED');
      const action = this.#projection(state, 'security', 'owner_action', context);
      requireThat(action.record_receipt_ref === a.owner_action_receipt_ref && action.payload.actor_id === r.actor_id
        && action.payload.branch_id === r.branch_id && action.payload.method === a.method && action.payload.accepted === true, 'INVALID_OWNER_RECEIPT');
    }
    requireThat((a.required_choices ?? []).every(c => auth.payload.accepted_choices?.includes(c)), 'AUTHORIZATION_EXCEEDED');
    const owners = new Map([['security', access], ['environment', condition], ['health', functional]]);
    for (const owner of [...new Set(policy.required_owners)].sort()) {
      if (!owners.has(owner)) owners.set(owner, this.#projection(state, owner, 'prepare', context, { start_ms: now, end_ms: now + 1 }));
      requireThat(owners.get(owner).payload.accepted !== false, 'OWNER_REJECTED');
    }
    for (const projection of owners.values()) {
      requireThat((projection.payload.required_choices ?? []).every(c => auth.payload.accepted_choices?.includes(c)), 'AUTHORIZATION_EXCEEDED');
      if (projection.payload.interruption) {
        const interruption = shape('interruption', projection.payload.interruption);
        requireThat(interruption.owner_ref === projection.owner_ref && interruption.source_ref && integer(interruption.effective_instant), 'INVALID_OWNER_RECEIPT');
        state.interruption[interruption.source_ref] = clone(interruption);
      }
    }
    const baseSpeed = profile.speed_mm_s ?? (profile.kind === 'stairs' ? 700 : 1300);
    let speed = condition.payload.effective_speed_mm_s ?? functional.payload.speed_mm_s ?? baseSpeed;
    if (functional.payload.group_profiles) {
      requireThat(auth.payload.stay_together === true && functional.payload.group_profiles.every(p => p.authorized === true && integer(p.speed_mm_s, 1)), 'AUTHORIZATION_EXCEEDED');
      speed = Math.min(speed, ...functional.payload.group_profiles.map(p => p.speed_mm_s));
    }
    requireThat(integer(speed, 1), 'INVALID_PROFILE');
    // Owners return the final combined profile, never additive local health or
    // weather simulations. An environmental override must cite its exposure.
    if (condition.payload.effective_speed_mm_s !== undefined) requireThat(condition.payload.exposure_ref && condition.payload.function_revision === functional.revision, 'INVALID_OWNER_RECEIPT');
    const setup = profile.setup_ms ?? (profile.kind === 'door' ? 2000 : 0);
    const setupRemaining = Math.max(0, setup - segment.boundary_snapshot.setup_elapsed_ms);
    const needed = BigInt(edge.length_mm - segment.progress_mm) * 1000n - BigInt(segment.rounding_residue);
    const exactMotionRemaining = number(ceilDiv(needed > 0n ? needed : 0n, BigInt(speed)));
    const quantum = profile.time_quantum_ms ?? (['walk', 'stairs', 'door'].includes(profile.kind) ? 1000 : 1);
    requireThat(integer(quantum, 1), 'INVALID_PROFILE');
    const motionElapsed = segment.boundary_snapshot.motion_elapsed_ms ?? 0;
    const motionRemaining = exactMotionRemaining + (quantum - ((motionElapsed + exactMotionRemaining) % quantum)) % quantum;
    let duration = Math.min(60000, setupRemaining + motionRemaining, travel.remaining_authorization.duration_ms, r.authorization_horizon_ms);
    for (const p of owners.values()) duration = Math.min(duration, p.effective_interval.end_ms - now);
    for (const p of owners.values()) {
      if (p.payload.interruption) duration = Math.min(duration, Math.max(0, p.payload.interruption.effective_instant - now));
    }
    const due = this.#projection(state, 'system11', 'boundaries', context);
    requireThat(Array.isArray(due.payload.boundaries_ms) && due.payload.boundaries_ms.every(t => integer(t) && t >= now), 'INVALID_OWNER_RECEIPT');
    if (due.payload.boundaries_ms.length) duration = Math.min(duration, Math.min(...due.payload.boundaries_ms) - now);
    if (duration === 0 && (motionRemaining > 0 || setupRemaining > 0)) {
      this.#pause(state, travel, 'MOVEMENT_REQUIRES_CHOICE'); return { result: this.#result(state, r, travel, null, known) };
    }
    requireThat(integer(duration), 'INVALID_DURATION');
    const setupUsed = Math.min(setupRemaining, duration), moveMs = duration - setupUsed;
    const numerator = BigInt(segment.rounding_residue) + BigInt(speed) * BigInt(moveMs);
    const reached = setupUsed === setupRemaining && numerator >= BigInt(edge.length_mm - segment.progress_mm) * 1000n;
    const completed = reached && moveMs >= motionRemaining && now + duration < access.effective_interval.end_ms;
    const increment = reached ? edge.length_mm - segment.progress_mm : number(numerator / 1000000n) * 1000;
    const progress = segment.progress_mm + increment;
    const residue = reached ? '0' : String(numerator - BigInt(increment) * 1000n);
    let target = completed ? { anchor_kind: 'PLACE_NODE', anchor_json: { node_ref: edge.to_node } }
      : moveMs === 0 && source.anchor_kind === 'PLACE_NODE' ? source
      : { anchor_kind: 'EDGE_PROGRESS', anchor_json: { edge_ref: edge.edge_id, origin_node_ref: edge.from_node, progress_mm: progress, movement_ref: travel.travel_id } };
    const interval = { start_ms: now, end_ms: now + duration };
    if (['board', 'alight', 'ride', 'drive'].includes(profile.kind) || source.anchor_kind === 'CARRIER_SEAT') {
      const carrier = this.#projection(state, 'vehicles', 'prepare_motion', { ...context, interval, expected_world_anchor: target, completed }, interval);
      const v = carrier.payload;
      requireThat(v.actor_id === r.actor_id && v.branch_id === r.branch_id && v.idempotency_key === checkpointKey && v.capacity_reserved === true && v.carrier_revision !== undefined, 'INVALID_OWNER_RECEIPT');
      requireThat(canonical(v.before_actor_anchor) === canonical(source) && canonical(v.world_anchor) === canonical(target), 'INVALID_CARRIER_MOTION');
      if (source.anchor_kind === 'CARRIER_SEAT') {
        const expectedWorld = segment.progress_mm === 0 ? { anchor_kind: 'PLACE_NODE', anchor_json: { node_ref: edge.from_node } }
          : { anchor_kind: 'EDGE_PROGRESS', anchor_json: { edge_ref: edge.edge_id, origin_node_ref: edge.from_node, progress_mm: segment.progress_mm, movement_ref: travel.travel_id } };
        requireThat(v.carrier_instance_ref === source.anchor_json.carrier_instance_ref && canonical(v.before_world_anchor) === canonical(expectedWorld), 'INVALID_CARRIER_MOTION');
      }
      if (profile.kind === 'board' && completed) requireThat(v.carrier_present === true && v.boarding_open === true && v.occupancy_accepted === true && auth.payload.methods?.includes('board') && now < v.boarding_cutoff_ms, 'CARRIER_UNAVAILABLE');
      if (profile.kind === 'alight' && completed) requireThat(v.safe_exit === true && v.stopped === true && auth.payload.methods?.includes('alight'), 'METHOD_UNAVAILABLE');
      if (v.actor_anchor.anchor_kind === 'CARRIER_SEAT') {
        requireThat(v.occupancy_accepted === true && v.actor_anchor.anchor_json.occupancy_receipt_ref === carrier.record_receipt_ref, 'INVALID_OWNER_RECEIPT');
      } else requireThat(canonical(v.actor_anchor) === canonical(target), 'INVALID_CARRIER_MOTION');
      target = clone(v.actor_anchor); owners.set('vehicles', carrier);
      if (v.taxi_state !== undefined) {
        requireThat(['REQUESTED', 'ACCEPTED', 'EN_ROUTE_TO_PICKUP', 'WAITING', 'BOARDED', 'RIDING', 'ARRIVED', 'SETTLED', 'CANCELLED'].includes(v.taxi_state), 'INVALID_OWNER_RECEIPT');
        state.taxi_service_projection[key(r.branch_id, v.carrier_instance_ref)] = { owner_state: v.taxi_state, dispatch_carrier_occupancy_fare_receipt_refs: [carrier.record_receipt_ref] };
      }
    }
    this.#anchor(state, plan.topology_version, target, true);
    if (target.anchor_kind === 'CARRIER_SEAT') {
      const seat = target.anchor_json;
      const conflicting = other => other?.anchor_kind === 'CARRIER_SEAT'
        && other.anchor_json.carrier_instance_ref === seat.carrier_instance_ref
        && other.anchor_json.compartment_seat_ref === seat.compartment_seat_ref;
      requireThat(!Object.values(state.character_presence).some(other => other.branch_id === r.branch_id && other.character_id !== r.actor_id && conflicting(other)), 'CAPACITY_CONFLICT');
      requireThat(!state.persistence_delivery.pending_recovery_refs.some(ref => {
        const pending = state.commit_coordination[ref]?.stored_command_result?.prepared;
        return pending?.request.branch_id === r.branch_id && pending.request.actor_id !== r.actor_id && conflicting(pending.target_anchor);
      }), 'CAPACITY_CONFLICT');
    }
    const coverage = this.#projection(state, 'system11', 'prepare_coverage', { ...context, interval }, interval);
    requireThat(coverage.payload.idempotency_key === checkpointKey && coverage.payload.branch_id === r.branch_id && coverage.payload.expected_clock_revision === r.expected_clock_revision
      && canonical(coverage.payload.interval) === canonical(interval), 'INVALID_CLOCK_COVERAGE');
    const prepared = {
      request: clone(r), travel_id: travel.travel_id, segment_id: segment.segment_id, source_anchor: source,
      target_anchor: target, presence_revision: presence.revision, interval, progress_mm: progress, residue,
      setup_elapsed_ms: segment.boundary_snapshot.setup_elapsed_ms + setupUsed, motion_elapsed_ms: motionElapsed + moveMs, completed,
      owner_refs: [...owners.values()].map(p => p.record_receipt_ref), knowledge_ref: known.record_receipt_ref,
      coverage_ref: coverage.record_receipt_ref, consumed_revisions: [auth.record_receipt_ref, clock.record_receipt_ref, due.record_receipt_ref, ...[...owners.values()].map(p => p.record_receipt_ref)],
      command_key: key('command', r.branch_id, r.command_id), delta_distance_mm: increment
    };
    state.commit_coordination[checkpointKey] = {
      state: 'PREPARED', idempotency_key: checkpointKey, request_payload_identity: identity(prepared), reservation_refs: [...travel.reservation_refs, ...(a.reservation_refs ?? [])],
      clock_coverage_receipt_ref: coverage.record_receipt_ref, required_owner_receipt_refs: prepared.owner_refs,
      pending_receipts: ['system11', ...[...owners.keys()]].sort(), stored_command_result: { prepared }
    };
    segment.state = 'PREPARED'; segment.access_snapshot = clone(state.access_evaluation[checkpointKey]);
    segment.sample_refs = [...new Set([...segment.sample_refs, ...[...owners.values()].flatMap(p => p.payload.sample_refs ?? [])])];
    travel.sample_refs = [...new Set([...travel.sample_refs, ...segment.sample_refs])];
    segment.boundary_snapshot = { ...segment.boundary_snapshot, prepared_ref: checkpointKey };
    if (['door', 'board', 'alight'].includes(profile.kind)) state.passage_transition[checkpointKey] = {
      state: 'PREPARED', source_anchor: source, destination_anchor: target, passage_ref: edge.edge_id,
      duration, reservation_refs: state.commit_coordination[checkpointKey].reservation_refs,
      boundary_snapshot: { prepared_ref: checkpointKey }, causal_intent_ref: r.causation_id
    };
    this.#event(state, 'TravelSegmentPrepared', uid(checkpointKey, 'prepared'), { travel_id: travel.travel_id, segment_id: segment.segment_id });
    state.persistence_delivery.pending_recovery_refs.push(checkpointKey);
    return { checkpointKey };
  }

  #step(command) {
    let phase;
    try {
      phase = this.#transaction(state => {
        const auth = this.#authorize(state, command), r = command.request;
        const commandKey = key('command', r.branch_id, r.command_id), existing = state.commit_coordination[commandKey];
        if (existing) {
          requireThat(existing.request_payload_identity === identity(command), 'IDEMPOTENCY_CONFLICT');
          if (existing.state === 'COMMITTED') return { result: existing.stored_command_result };
          return { checkpointKey: existing.stored_command_result.checkpointKey };
        }
        if (command.operation === 'recover') {
          const t = state.travel[command.travel_id];
          requireThat(t && t.actor_id === r.actor_id && t.branch_id === r.branch_id, 'INVALID_TRAVEL');
          const checkpointKey = state.persistence_delivery.pending_recovery_refs.find(ref => state.commit_coordination[ref]?.stored_command_result?.prepared?.travel_id === t.travel_id);
          requireThat(checkpointKey, 'RECOVERY_PENDING');
          return { checkpointKey };
        }
        const result = this.#prepare(state, command, auth);
        state.commit_coordination[commandKey] = {
          state: result.result ? 'COMMITTED' : 'PREPARED', idempotency_key: commandKey,
          request_payload_identity: identity(command), reservation_refs: [], clock_coverage_receipt_ref: null,
          required_owner_receipt_refs: [], pending_receipts: result.result ? [] : [result.checkpointKey], stored_command_result: result.result ?? result
        };
        return result;
      });
      if (phase.result) return phase.result;
      return this.#settle(phase.checkpointKey, command.operation === 'recover');
    } catch (error) { throw error; }
  }

  #settle(checkpointKey, lookupOnly) {
    // Preparation is durable before any commit request. The local write lock
    // serializes concurrent actors and workers. Receipt lookup precedes retries.
    const firstAttempt = this.#transaction(state => {
      const c = state.commit_coordination[checkpointKey];
      requireThat(c, 'RECOVERY_PENDING');
      const first = c.state === 'PREPARED';
      if (c.state !== 'COMMITTED') c.state = 'COMMITTING';
      return first;
    });
    return this.#transaction(state => {
      const coordinator = state.commit_coordination[checkpointKey];
      requireThat(coordinator, 'RECOVERY_PENDING');
      if (coordinator.state === 'COMMITTED') return coordinator.stored_command_result.result;
      const prepared = coordinator.stored_command_result.prepared, travel = state.travel[prepared.travel_id];
      const p = state.character_presence[key(prepared.request.branch_id, prepared.request.actor_id)];
      const known = state.owner_projection_ref[prepared.knowledge_ref];
      if (p.revision !== prepared.presence_revision || canonical(this.#anchorOf(p)) !== canonical(prepared.source_anchor)) {
        coordinator.state = 'BLOCKED'; this.#pause(state, travel, 'RECOVERY_PENDING', true);
        return this.#result(state, prepared.request, travel, null, known);
      }
      coordinator.state = 'COMMITTING';
      for (const owner of [...coordinator.pending_receipts]) {
        const request = { idempotency_key: checkpointKey, branch_id: prepared.request.branch_id, actor_id: prepared.request.actor_id, interval: prepared.interval, prepared_receipt_refs: prepared.owner_refs, coverage_ref: prepared.coverage_ref };
        let response = this.#call(owner, 'lookup_receipt', request);
        if (response.status === 'not_found' && !lookupOnly) response = this.#call(owner, 'commit', request);
        else if (response.status === 'unavailable' && firstAttempt && !lookupOnly) response = this.#call(owner, 'commit', request);
        if (response.status !== 'accepted' || !response.projection) continue;
        const receipt = response.projection;
        try {
          shape('owner_projection_ref', receipt);
          requireThat(receipt.owner_ref === owner && typeof receipt.record_receipt_ref === 'string' && receipt.payload?.idempotency_key === checkpointKey
            && receipt.payload.branch_id === prepared.request.branch_id && receipt.payload.actor_id === prepared.request.actor_id
            && receipt.payload.committed === true && canonical(receipt.payload.interval) === canonical(prepared.interval), 'INVALID_OWNER_RECEIPT');
          if (owner === 'system11') requireThat(receipt.payload.coverage_ref === prepared.coverage_ref, 'INVALID_CLOCK_COVERAGE');
          const previous = state.owner_projection_ref[receipt.record_receipt_ref];
          requireThat(!previous || canonical(previous) === canonical(receipt), 'OWNER_RECEIPT_CONFLICT');
          state.owner_projection_ref[receipt.record_receipt_ref] = clone(receipt);
          coordinator.required_owner_receipt_refs.push(receipt.record_receipt_ref);
          coordinator.pending_receipts = coordinator.pending_receipts.filter(o => o !== owner);
        } catch { /* Keep the essential effect pending; never fabricate success. */ }
      }
      if (coordinator.pending_receipts.length) {
        coordinator.state = 'BLOCKED'; this.#pause(state, travel, 'RECOVERY_PENDING', true);
        return this.#result(state, prepared.request, travel, null, known);
      }
      const segment = state.travel_segment[key(travel.travel_id, prepared.segment_id)], before = this.#anchorOf(p);
      const eventId = uid(checkpointKey, 'movement');
      requireThat(!state.movement_event[eventId], 'DUPLICATE_MOVEMENT');
      Object.assign(p, clone(prepared.target_anchor)); p.revision++; p.last_movement_event_id = eventId;
      segment.progress_mm = prepared.progress_mm; segment.rounding_residue = prepared.residue;
      segment.boundary_snapshot.setup_elapsed_ms = prepared.setup_elapsed_ms;
      segment.boundary_snapshot.motion_elapsed_ms = prepared.motion_elapsed_ms;
      segment.state = prepared.completed ? 'ARRIVED' : 'ACTIVE'; segment.duration_receipt_id = prepared.coverage_ref;
      segment.owner_receipt_refs.push(...coordinator.required_owner_receipt_refs);
      const receiptId = uid(checkpointKey, 'distance');
      state.owner_projection_ref[receiptId] = {
        owner_ref: 'world_location_travel', record_receipt_ref: receiptId, revision: p.revision,
        effective_interval: prepared.interval, payload: { event_id: eventId, distance_mm: prepared.delta_distance_mm, elapsed_ms: prepared.interval.end_ms - prepared.interval.start_ms },
        observable_evidence: { distance_mm: prepared.delta_distance_mm, elapsed_ms: prepared.interval.end_ms - prepared.interval.start_ms }, hidden_causes: {}
      };
      travel.elapsed_distance_receipts.push(receiptId);
      travel.accepted_cost_receipts.push(...coordinator.required_owner_receipt_refs.filter(ref => state.owner_projection_ref[ref].payload.cost_receipt === true));
      travel.remaining_authorization.duration_ms -= prepared.interval.end_ms - prepared.interval.start_ms;
      travel.state = 'ACTIVE'; travel.stop_reason = null;
      state.movement_event[eventId] = {
        event_id: eventId, branch_id: p.branch_id, world_id: p.world_id,
        event_sequence: Object.values(state.movement_event).filter(e => e.branch_id === p.branch_id).length,
        effective_time: prepared.interval.end_ms, before_anchor: before, after_anchor: this.#anchorOf(p), method_movement_kind: state.route_plan[travel.route_plan_ref].mode,
        owner_cause_causal_action_ref: travel.causation_id, route_segment_refs: [travel.route_plan_ref, segment.segment_id],
        consumed_revisions: [...prepared.consumed_revisions, ...coordinator.required_owner_receipt_refs], visibility: 'owner-filtered'
      };
      if (state.passage_transition[checkpointKey]) state.passage_transition[checkpointKey].state = prepared.completed ? 'ARRIVED' : 'IN_PROGRESS';
      this.#event(state, 'MovementCommitted', eventId, state.movement_event[eventId], ['system4', 'system9', 'health', 'legal', 'perception']);
      if (prepared.completed) {
        travel.remaining_route.shift(); travel.current_segment_ref = travel.remaining_route[0] ?? null;
        if (!travel.remaining_route.length) {
          const destination = state.route_plan[travel.route_plan_ref].assumptions_uncertainty.destination_node_ref;
          if (p.anchor_kind === 'PLACE_NODE' && p.anchor_json.node_ref === destination) {
            travel.state = 'ARRIVED'; this.#event(state, 'TravelArrived', uid(travel.travel_id, 'arrive'), { travel_id: travel.travel_id, movement_event_id: eventId }, ['system1']);
          } else this.#pause(state, travel, 'MOVEMENT_REQUIRES_CHOICE');
        }
      }
      if (travel.state === 'ACTIVE' && travel.remaining_authorization.duration_ms === 0) this.#pause(state, travel, 'AUTHORIZATION_EXCEEDED');
      if (travel.state === 'ACTIVE' && coordinator.required_owner_receipt_refs.some(ref => state.owner_projection_ref[ref].payload.choice_barrier === true)) this.#pause(state, travel, 'MOVEMENT_REQUIRES_CHOICE');
      coordinator.state = 'COMMITTED';
      state.persistence_delivery.pending_recovery_refs = state.persistence_delivery.pending_recovery_refs.filter(ref => ref !== checkpointKey);
      const result = this.#result(state, prepared.request, travel, null, known);
      coordinator.stored_command_result.result = result;
      state.persistence_delivery.spatial_traces.push({ trace_id: travel.trace_id,
        checkpoint_ref: checkpointKey, source_anchor: prepared.source_anchor, target_anchor: prepared.target_anchor,
        interval: prepared.interval, source_revisions: prepared.consumed_revisions,
        owner_receipts: coordinator.required_owner_receipt_refs, movement_event_ref: eventId,
        sample_refs: segment.sample_refs, result_status: result.status });
      const command = state.commit_coordination[prepared.command_key];
      command.state = 'COMMITTED'; command.pending_receipts = []; command.stored_command_result = result;
      return result;
    });
  }

  #nearby(state, command) {
    const r = command.request, p = this.#presence(state, r), known = this.#knowledge(state, r);
    requireThat(p.anchor_kind === 'PLACE_NODE', 'METHOD_UNAVAILABLE');
    const budget = command.budget_mm ?? 400000, page = command.page ?? 0, pageSize = command.page_size ?? 50;
    requireThat(integer(budget) && integer(page) && integer(pageSize, 1) && pageSize <= 50, 'INVALID_REQUEST');
    const reachable = this.#search(known, p.anchor_json.node_ref, null, { ...r, mode: 'walk', route_preference: 'shortest_walk' });
    const results = (known.payload.public_entrances ?? []).filter(n => reachable.has(n) && reachable.get(n).distance <= budget)
      .sort((a, b) => reachable.get(a).distance - reachable.get(b).distance || (a < b ? -1 : a > b ? 1 : 0));
    return {
      status: 'ACCEPTED', results: results.slice(page * pageSize, (page + 1) * pageSize).map(node_ref => ({
        node_ref, measure_type: 'walking_route', distance_estimate: reachable.get(node_ref).distance,
        assumptions: ['known-graph', 'execution-revalidates-access'], knowledge_revision: known.revision,
        route_freshness: known.record_receipt_ref, bounds_pagination: { budget_mm: budget, page, page_size: pageSize }
      })), has_more: results.length > (page + 1) * pageSize
    };
  }
  #observe(state, command) {
    const r = command.request, p = this.#presence(state, r), source = this.#anchorOf(p);
    const evidence = this.#projection(state, 'perception', 'observe', { ...command, anchor: source });
    requireThat(evidence.payload.actor_id === r.actor_id && evidence.payload.branch_id === r.branch_id && canonical(evidence.payload.anchor) === canonical(source), 'INVALID_OBSERVATION');
    for (const opportunity of evidence.payload.opportunities ?? []) {
      requireThat(opportunity.spatial_eligible === true && opportunity.channel_ref && integer(opportunity.effective_time), 'INVALID_OBSERVATION');
      const channel = state.spatial_affordances[state.world_definition.topology_version].channel_edges.find(c => c.id === opportunity.channel_ref);
      requireThat(channel || opportunity.accepted_device_channel_ref, 'INVALID_OBSERVATION');
      if (channel && p.anchor_kind === 'PLACE_NODE') requireThat(channel.from_node === p.anchor_json.node_ref || channel.to_node === p.anchor_json.node_ref, 'INVALID_OBSERVATION');
      if (opportunity.method && opportunity.method !== 'passive') {
        const intent = this.#projection(state, 'system1', 'observation_intent', command);
        requireThat(intent.payload.method === opportunity.method && intent.payload.actor_id === r.actor_id && intent.payload.branch_id === r.branch_id && intent.payload.accepted === true, 'AUTHORIZATION_EXCEEDED');
        requireThat(opportunity.time_coverage_receipt_ref, 'INVALID_CLOCK_COVERAGE');
      }
      const id = uid(r.branch_id, r.actor_id, opportunity.opportunity_id);
      if (state.discovery_proposal[id]) continue;
      state.discovery_proposal[id] = {
        proposal_opportunity_identity: id, observer_ref: r.actor_id, source_event_signal_refs: [evidence.record_receipt_ref, p.last_movement_event_id],
        spatial_channel_evidence: opportunity, effective_time: opportunity.effective_time, owner_acceptance_receipt_ref: null
      };
      this.#event(state, 'LocationObservationProposed', id, state.discovery_proposal[id], ['system3']);
    }
    return { status: 'ACCEPTED', known_observations: [] };
  }
  #query(state, command) {
    const r = command.request, p = this.#presence(state, r), known = this.#knowledge(state, r), k = known.payload;
    const measure = command.measure_type;
    if (measure === 'walking_route') return this.#nearby(state, command);
    requireThat(['geometric', 'travel_time', 'same_property', 'interaction_reach'].includes(measure), 'INVALID_REQUEST');
    requireThat(p.anchor_kind === 'PLACE_NODE' && k.nodes.includes(command.target_node_ref), 'UNKNOWN_DESTINATION');
    const source = p.anchor_json.node_ref, target = command.target_node_ref;
    let value;
    if (measure === 'travel_time') value = this.#search(known, source, target, { ...r, route_preference: 'earliest' }).duration;
    else if (measure === 'same_property') {
      const a = k.known_property_membership?.[source], b = k.known_property_membership?.[target];
      value = a !== undefined && b !== undefined ? a === b : null;
    } else if (measure === 'geometric') {
      const a = k.metric_coordinates?.[source], b = k.metric_coordinates?.[target];
      requireThat(a && b && ['x_mm', 'y_mm', 'z_mm'].every(axis => Number.isSafeInteger(a[axis]) && Number.isSafeInteger(b[axis])), 'METHOD_UNAVAILABLE');
      const squared = ['x_mm', 'y_mm', 'z_mm'].reduce((sum, axis) => sum + (BigInt(a[axis]) - BigInt(b[axis])) ** 2n, 0n);
      let low = 0n, high = squared + 1n;
      while (high - low > 1n) { const mid = (low + high) / 2n; if (mid * mid <= squared) low = mid; else high = mid; }
      value = number(low * low === squared ? low : low + 1n);
    } else {
      const version = state.world_definition.topology_version;
      const interaction = state.spatial_affordances[version].interaction_anchors.find(a => a.id === command.interaction_anchor_ref && a.node_ref === target && a.task_ref === command.task_ref);
      requireThat(interaction && k.known_interaction_anchors?.includes(interaction.id) && integer(interaction.reach_mm), 'METHOD_UNAVAILABLE');
      const a = this.#node(state, version, source), b = this.#node(state, version, target);
      requireThat(a && b && !a.geometry_is_nonmetric && !b.geometry_is_nonmetric, 'METHOD_UNAVAILABLE');
      const squared = ['x_mm', 'y_mm', 'z_mm'].reduce((sum, axis) => sum + (BigInt(a.coordinates_or_relative_geometry[axis]) - BigInt(b.coordinates_or_relative_geometry[axis])) ** 2n, 0n);
      const eligibility = this.#projection(state, 'perception', 'reach', command);
      requireThat(eligibility.payload.actor_id === r.actor_id && eligibility.payload.branch_id === r.branch_id && eligibility.payload.interaction_anchor_ref === interaction.id && canonical(eligibility.payload.anchor) === canonical(this.#anchorOf(p)), 'INVALID_OWNER_RECEIPT');
      value = squared <= BigInt(interaction.reach_mm) ** 2n && a.floor_elevation_ref === b.floor_elevation_ref && eligibility.payload.channel_open === true && eligibility.payload.method_available === true;
    }
    const result = {
      measure_type: measure, distance_estimate: value, assumptions: ['knowledge-filtered', 'measure-specific'],
      knowledge_revision: known.revision, route_freshness: known.record_receipt_ref, bounds_pagination: {}
    };
    state.spatial_query_result[key(r.branch_id, r.command_id)] = result;
    return { status: 'ACCEPTED', result };
  }
  #narrate(state, command) {
    const r = command.request, p = this.#presence(state, r), known = this.#knowledge(state, r);
    const safe = this.#safeAnchor(this.#anchorOf(p), known);
    // The optional model selects a registered template only. Unvalidated free
    // prose is never returned and cannot introduce actor/location assertions.
    this.#call('system2', 'render', { idempotency_key: key(r.branch_id, r.command_id), committed_anchor: safe });
    const a = safe?.anchor_json;
    const text = !a ? 'Current location is unmapped.' : safe.anchor_kind === 'PLACE_NODE'
      ? `Current location: ${known.payload.labels?.[a.node_ref] ?? a.node_ref}.`
      : safe.anchor_kind === 'EDGE_PROGRESS' ? `Travel in progress: ${a.progress_mm} millimeters along the known segment.`
      : 'Currently aboard the known carrier.';
    return { status: 'ACCEPTED', committed_anchor: safe, text };
  }
  #flush(state, command) {
    for (const entry of state.persistence_delivery.outbox_entries) {
      if (entry.delivery_state === 'DELIVERED') continue;
      for (const owner of entry.recipients) {
        if (entry.accepted_receipts[owner]) continue;
        const result = this.#call(owner, 'publish', { idempotency_key: entry.event_id, type: entry.type, payload: entry.payload });
        if (result.status === 'accepted' && result.event_id === entry.event_id && typeof result.receipt_ref === 'string') {
          entry.accepted_receipts[owner] = result.receipt_ref;
          if (owner === 'system3' && state.discovery_proposal[entry.event_id]) state.discovery_proposal[entry.event_id].owner_acceptance_receipt_ref = result.receipt_ref;
        }
      }
      if (entry.recipients.every(owner => entry.accepted_receipts[owner])) entry.delivery_state = 'DELIVERED';
    }
    return { status: 'ACCEPTED' };
  }
  #inspect(state, command, auth) {
    requireThat(auth.payload.privileged === true, 'AUTHORIZATION_EXCEEDED');
    // Snapshot is diagnostic only. There is no unvalidated JSON import endpoint.
    return { status: 'ACCEPTED', snapshot: clone(state) };
  }
  #fork(state, command, auth) {
    requireThat(auth.payload.privileged === true && typeof command.new_branch_id === 'string' && command.new_branch_id !== command.request.branch_id, 'AUTHORIZATION_EXCEEDED');
    const branch = command.request.branch_id, next = command.new_branch_id;
    requireThat(!Object.values(state.character_presence).some(p => p.branch_id === next), 'BRANCH_EXISTS');
    requireThat(!state.persistence_delivery.pending_recovery_refs.some(ref => state.commit_coordination[ref]?.stored_command_result?.prepared?.request.branch_id === branch), 'RECOVERY_PENDING');
    const approval = this.#projection(state, 'creator', 'fork', command);
    requireThat(approval.payload.branch_id === branch && approval.payload.new_branch_id === next && approval.payload.owner_references_validated === true, 'INVALID_OWNER_RECEIPT');
    const travels = Object.values(state.travel).filter(t => t.branch_id === branch);
    const travelIds = new Map(travels.map(t => [t.travel_id, uid(next, t.travel_id)]));
    const remapAnchor = anchor => {
      if (!anchor) return null;
      const a = clone(anchor);
      if (a.anchor_kind === 'EDGE_PROGRESS') a.anchor_json.movement_ref = travelIds.get(a.anchor_json.movement_ref) ?? a.anchor_json.movement_ref;
      return a;
    };
    const events = Object.values(state.movement_event).filter(e => e.branch_id === branch);
    const eventIds = new Map(events.map(e => [e.event_id, uid(next, e.event_id)]));
    const occupancyChanges = [];
    for (const travel of travels) {
      const copy = clone(travel), plan = clone(state.route_plan[travel.route_plan_ref]);
      copy.travel_id = travelIds.get(travel.travel_id); copy.branch_id = next;
      copy.continuation_lineage_ref = travelIds.get(travel.continuation_lineage_ref) ?? travel.continuation_lineage_ref;
      plan.route_plan_id = uid(next, plan.route_plan_id); plan.source_anchor = remapAnchor(plan.source_anchor);
      state.route_plan[plan.route_plan_id] = plan; copy.route_plan_ref = plan.route_plan_id;
      // Future execution requires newly authorized continuation in the fork.
      if (['ACTIVE', 'ADMITTED', 'PAUSED'].includes(copy.state)) {
        copy.state = 'PAUSED'; copy.stop_reason = 'AUTHORIZATION_EXCEEDED';
        copy.remaining_authorization.duration_ms = 0;
      }
      state.travel[copy.travel_id] = copy;
      for (const segment of Object.values(state.travel_segment).filter(s => s.travel_id === travel.travel_id)) {
        const s = clone(segment); s.travel_id = copy.travel_id;
        s.boundary_snapshot.source_anchor = remapAnchor(s.boundary_snapshot.source_anchor);
        state.travel_segment[key(s.travel_id, s.segment_id)] = s;
      }
    }
    for (const presence of Object.values(state.character_presence).filter(p => p.branch_id === branch)) {
      const copy = clone(presence); copy.branch_id = next;
      if (copy.anchor_kind === 'CARRIER_SEAT') {
        const occupancy = this.#projection(state, 'vehicles', 'fork_occupancy', { ...command, actor_id: copy.character_id });
        requireThat(occupancy.payload.branch_id === next && occupancy.payload.actor_id === copy.character_id && occupancy.payload.carrier_instance_ref === copy.anchor_json.carrier_instance_ref && occupancy.payload.compartment_seat_ref === copy.anchor_json.compartment_seat_ref && occupancy.payload.occupancy_accepted === true, 'OWNER_FORK_REQUIRED');
        occupancyChanges.push({ presence: copy, before: this.#anchorOf(copy), receipt: occupancy.record_receipt_ref });
        copy.anchor_json.occupancy_receipt_ref = occupancy.record_receipt_ref;
      } else Object.assign(copy, remapAnchor(this.#anchorOf(copy)));
      copy.last_movement_event_id = eventIds.get(copy.last_movement_event_id);
      state.character_presence[key(next, copy.character_id)] = copy;
    }
    for (const event of events) {
      const copy = clone(event); copy.branch_id = next;
      copy.event_id = eventIds.get(event.event_id);
      copy.before_anchor = remapAnchor(copy.before_anchor); copy.after_anchor = remapAnchor(copy.after_anchor);
      state.movement_event[copy.event_id] = copy;
    }
    for (const change of occupancyChanges) {
      const p = change.presence, previous = state.movement_event[p.last_movement_event_id], id = uid(next, p.character_id, 'fork-occupancy');
      state.movement_event[id] = {
        event_id: id, branch_id: next, world_id: p.world_id,
        event_sequence: Object.values(state.movement_event).filter(e => e.branch_id === next).length,
        effective_time: previous.effective_time, before_anchor: change.before, after_anchor: this.#anchorOf(p),
        method_movement_kind: 'fork_occupancy', owner_cause_causal_action_ref: change.receipt,
        route_segment_refs: [], consumed_revisions: [approval.record_receipt_ref, change.receipt], visibility: 'owner-filtered'
      };
      p.revision++; p.last_movement_event_id = id;
    }
    // Past outbox deliveries are intentionally not copied or redispatched.
    return { status: 'ACCEPTED', branch_id: next };
  }
}
