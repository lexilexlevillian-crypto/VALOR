/**
 * Isolated System 8. Node.js >= 22; no packages or other game modules required.
 *
 * All values crossing a port are JSON. Ports below are fixture-returning stubs,
 * never implementations of the systems they represent. Replace fixtures in tests.
 *
 * Encoding choices: IDs are nonempty strings, Time is finite numeric game time,
 * state_version is an integer, and absent optional values are explicit null.
 * Missing required data is an error, never an implicit zero/null/authorization.
 * Numeric bounds, formulas, cooldowns and state labels come from Creator policy.
 *
 * Canonical event payloads are fetched from System 3, not trusted from a caller.
 * process({operation:'apply', timeline_id, source_event_id}) applies one event.
 * A pending decision is immutable. Submit a NEW event referencing it to respond.
 * Accepted consent authorizes one scoped interaction, not reusable permission.
 * The event journal uses romance_events.interpretation for replay inputs/results.
 * Save documents contain only the specified state collections.
 */

/** @typedef {null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue}} JSONValue */
/** @typedef {{[key:string]:JSONValue}} JSONObject */
/** @typedef {{operation:string,timeline_id:string,source_event_id?:string,snapshot?:JSONObject,new_timeline_id?:string,before?:number,remove_source_event_ids?:string[],viewer_id?:string}} Command */
/** @typedef {{ok:boolean,status:string,result?:JSONObject,error?:{code:string,message:string}}} Result */
/** @typedef {{source_event_id:string,timeline_id:string,observer_id:string,target_id:string,event_type:string,occurred_at:number,context_id:string,payload:JSONObject,depends_on:string[],creator_anchor:boolean}} CanonicalEvent */
/** @typedef {{character_id:string,source_event_id:string,action:string,other_id:string,scope:string,context_id:string,terms:string|null,decision:'accepted'|'declined'|'withdrawn'|'unknown',decision_id:string,explicit:boolean,origin:'player'|'system_6',romantic_framing?:boolean}} Decision */

export const INTEREST = Object.freeze(['none', 'possible interest', 'curious', 'interested', 'actively pursuing', 'mutual courtship', 'committed relationship', 'relationship ended but residual interest']);
export const CONSENT = Object.freeze(['unknown', 'invited', 'accepted', 'declined', 'withdrawn', 'unable_to_consent']);
export const INTERACTIONS = Object.freeze(['casual touch', 'hand-holding', 'hugging', 'cuddling', 'kissing', 'making out', 'sexual activity', 'post-intimacy contact']);
export const AGREEMENTS = Object.freeze(['casual/nonexclusive', 'exclusive dating', 'committed partnership', 'marriage/legal partnership if world rules support', 'open relationship with defined terms', 'separated but not formally ended', 'secret relationship']);
export const FLIRTATION = Object.freeze(['clearly flirtatious', 'possibly flirtatious', 'friendly but misread', 'unwelcome flirtation', 'strategic/manipulative flirtation', 'mutual flirting']);
const DIMENSIONS = ['romantic_attraction', 'sexual_attraction', 'aesthetic_attraction'];
const FIDELITY = ['minimal', 'standard', 'rich'];
const SOURCES = ['player', 'creator', 'system_2', 'system_3', 'system_4', 'system_5', 'system_6', 'system_7', 'system_11', 'system_12', 'system_17', 'system_13', 'system_14', 'system_16', 'system_18', 'system_19', 'system_20', 'system_22', 'system_24', 'system_25'];

const FIELDS = Object.freeze({
  romance_edges: 'timeline_id observer_id target_id romantic_attraction sexual_attraction aesthetic_attraction attraction_awareness romantic_interest_state pursuit_state jealousy_level jealousy_context_json current_partner_belief fidelity_level state_version',
  additional_named_attraction_fields: 'romantic_interest_confidence chemistry_context',
  romantic_agreements: 'agreement_id timeline_id participant_ids agreement_type exclusivity_rules disclosure_rules public_private_status started_at ended_at status source_event_id',
  participant_agreement_beliefs: 'agreement_id character_id believed_status believed_rules confidence last_updated_event_id',
  intimacy_boundaries: 'boundary_id owner_id target_id_or_scope category rule explicitness status known_by_target source_event_id',
  IntimacyConsentState: 'initiator_id target_id interaction_category status granted_at expires_on_context_change source_event_id conditions',
  intimacy_consent_events: 'consent_event_id initiator_id target_id interaction_category status granted_at withdrawn_at context_id source_event_id',
  romance_events: 'romance_event_id source_event_id observer_id target_id event_type interpretation attraction_delta jealousy_delta interest_state_change agreement_change_id applied_at',
  romance_milestones: 'milestone_id relationship_pair_or_group milestone_type occurred_at source_event_id public_private salience_by_character_json',
  romantic_conflicts: 'conflict_id participants topics agreement_issue rival_ids betrayal_event_ids status started_at resolved_at',
  RomanceInterpretationProposal: 'observer_id target_id source_event_id perceived_flirtation attraction_relevance compatibility_signals perceived_intent agreement_context jealousy_context consent_required reason_tags confidence',
});

class RuleError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
function requireRule(condition, code, message) { if (!condition) throw new RuleError(code, message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function id(value) { return typeof value === 'string' && value.length > 0; }
function number(value) { return typeof value === 'number' && Number.isFinite(value); }
function json(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || number(value)) return;
  requireRule(Array.isArray(value) || (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))), 'NON_JSON_VALUE');
  for (const item of Object.values(value)) json(item);
}
function copy(value) { json(value); return JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function equal(a, b) { return stable(a) === stable(b); }
function unique(values) { return Array.isArray(values) && new Set(values).size === values.length; }
function exact(value, fields) {
  requireRule(object(value) && equal(Object.keys(value).sort(), fields.split(' ').sort()), 'INVALID_RECORD_FIELDS');
}
function record(name, value) {
  json(value); exact(value, FIELDS[name]);
  for (const [key, v] of Object.entries(value)) {
    if ((key.endsWith('_id') && !['agreement_change_id'].includes(key)) || key === 'timeline_id') requireRule(id(v), 'INVALID_ID', key);
    if (key.endsWith('_at')) requireRule(v === null || number(v), 'INVALID_TIME', key);
  }
  return copy(value);
}
function bounds(policy, field) {
  const range = policy?.ranges?.[field];
  requireRule(Array.isArray(range) && range.length === 2 && range.every(number) && range[0] < range[1], 'MISSING_NUMERIC_POLICY', field);
  return range;
}
function bounded(policy, field, value) {
  requireRule(number(value), 'INVALID_NUMBER', field);
  const [low, high] = bounds(policy, field);
  return Math.max(low, Math.min(high, value));
}
function within(policy, field, value) { requireRule(bounded(policy, field, value) === value, 'OUT_OF_RANGE', field); }
function key(event) { return JSON.stringify([event.timeline_id, event.observer_id, event.target_id]); }

/** Only the named state variables are stored. Additional fields are keyed by edge. */
export class RomanceState {
  constructor() {
    for (const name of Object.keys(FIELDS)) this[name] = name === 'additional_named_attraction_fields' ? {} : [];
  }
  toJSON() { return copy(Object.fromEntries(Object.keys(FIELDS).map(name => [name, this[name]]))); }
}

/**
 * Each request_* and send_* function returns a dummy JSON payload.
 * Fixtures are static data, not alternate implementations of external systems.
 * Default unknown decisions/capacity/opportunity fail closed.
 */
export function createDependencyStubs(fixtures = {}) {
  const defaults = {
    player: {player_ids: ['PC'], authorizations: [], delegations: [], stances: []},
    creator: {authorized: false, policy: null, pairing_locks: [], allow_seeds: false},
    system_2: {proposal: null},
    system_3: {canonical: false, event: null, knowledge: {}, visible_event_ids: {}, agreement_views: {}},
    system_4: {memories: []},
    system_5: {profiles: {}},
    system_6: {decisions: [], stances: [], candidate_event_ids: []},
    system_7: {boundaries: [], inertia: {}, relationship_context: {}},
    system_11: {now: null, opportunity: false},
    system_12: {feasible: false}, system_17: {feasible: false},
    system_13: {action_allowed: false, power_context: {}},
    system_14: {dependency_context: {}},
    system_16: {contact_feasible: false, delivery_confirmed: false, read_receipt_supported: false, read_confirmed: false},
    system_18: {capacity: {}, conditions_met: {}},
    system_19: {action_allowed: false}, system_20: {action_allowed: false},
    system_22: {action_allowed: false},
    system_24: {opportunities: []}, system_25: {authorized: false},
  };
  const ports = {};
  for (const source of SOURCES) {
    ports[`request_${source}`] = (_request) => copy(fixtures[source] ?? defaults[source]);
    ports[`send_${source}`] = (_payload) => ({stub: true, recipient: source, acknowledged: true});
  }
  return ports;
}

/**
 * policy.ranges: explicit numeric ranges for every used numeric field.
 * policy.attraction_rules: signal -> dimension -> signed effect.
 * Character preference_weights supply observer-specific relevance, never globals.
 * policy.max_delta: {minor, major}; policy.novelty_decay: number in [0,1].
 * System 7 supplies inertia[observer_id] in [0,1], consumed without simulation.
 * policy.jealousy_rules: threat -> signed effect, or {base, weights:{input:weight}}.
 * Weighted inputs: system_5.insecurity, system_5.possessiveness,
 * system_7.trust, system_7.attachment, system_7.fear_of_loss,
 * system_7.past_betrayal, context.rival_comparison, context.agreement_threat.
 * Boundary rules: {effect:'allow'|'deny', actions:string[], when?:JSONObject}.
 * 'when' matches canonical event.payload.context; missing context fails closed.
 * policy.cooldowns: {rejection, breakup, conflict, agreement}, in game-time units.
 * policy.labels: {agreement_active, agreement_ended, agreement_separated,
 *                 boundary_active, boundary_inactive, conflict_open, conflict_closed}.
 * No balance values or unspecified state labels are silently invented.
 */
export class RomanceSystem {
  #state = new RomanceState();
  #ports;
  #busy = false;
  constructor(ports = createDependencyStubs()) {
    for (const source of SOURCES) for (const prefix of ['request_', 'send_']) requireRule(typeof ports[prefix + source] === 'function', 'MISSING_STUB', prefix + source);
    this.#ports = ports;
  }

  /** @param {Command} command @returns {Result} */
  process(command) {
    if (this.#busy) return {ok: false, status: 'rejected', error: {code: 'REENTRANT_CALL', message: 'REENTRANT_CALL'}};
    this.#busy = true;
    try {
      json(command); requireRule(object(command) && id(command.timeline_id), 'INVALID_COMMAND');
      const existingTimeline = this.#state.romance_events[0]?.interpretation.event.timeline_id;
      requireRule(!existingTimeline || existingTimeline === command.timeline_id || command.operation === 'load', 'TIMELINE_MISMATCH');
      if (command.operation !== 'apply') return this.#administrative(command);
      requireRule(id(command.source_event_id), 'MISSING_SOURCE_EVENT');
      const previous = this.#state.romance_events.find(r => r.source_event_id === command.source_event_id);
      if (previous) return {ok: true, status: 'duplicate', result: copy(previous.interpretation.result)};
      const inputs = Object.fromEntries(SOURCES.map(source => [source, copy(this.#ports[`request_${source}`](copy(command)))]));
      const event = inputs.system_3.event;
      requireRule(inputs.system_3.canonical === true && event?.source_event_id === command.source_event_id && event?.timeline_id === command.timeline_id, 'NONCANONICAL_EVENT');
      const candidate = this.#clone(this.#state.toJSON());
      const result = this.#apply(candidate, event, inputs);
      // All adapters are pure placeholder acknowledgments. Failed acknowledgments
      // leave local state untouched, so retry cannot duplicate committed effects.
      for (const output of result.outputs) {
        const ack = this.#ports[`send_${output.recipient}`](copy(output.payload));
        json(ack); requireRule(ack.acknowledged === true, 'STUB_HANDOFF_FAILED', output.recipient);
      }
      const saved = this.#ports.send_system_25({timeline_id: command.timeline_id, source_event_id: command.source_event_id, state: candidate.toJSON()});
      json(saved); requireRule(saved.acknowledged === true, 'STUB_HANDOFF_FAILED', 'system_25');
      this.#state = candidate;
      return {ok: true, status: result.status, result: copy(result)};
    } catch (error) {
      return {ok: false, status: 'rejected', error: {code: error.code ?? 'INVALID_INPUT', message: error.message}};
    } finally { this.#busy = false; }
  }

  #clone(snapshot) {
    exact(snapshot, Object.keys(FIELDS).join(' '));
    const state = new RomanceState();
    for (const name of Object.keys(FIELDS)) {
      if (name === 'additional_named_attraction_fields') {
        requireRule(object(snapshot[name]), 'INVALID_STATE');
        for (const row of Object.values(snapshot[name])) record(name, row);
      } else {
        requireRule(Array.isArray(snapshot[name]), 'INVALID_STATE');
        for (const row of snapshot[name]) record(name, row);
      }
      state[name] = copy(snapshot[name]);
    }
    return state;
  }

  #administrative(command) {
    const creator = copy(this.#ports.request_creator(copy(command)));
    const persistence = copy(this.#ports.request_system_25(copy(command)));
    if (command.operation === 'view') {
      const player = copy(this.#ports.request_player(copy(command)));
      requireRule(player.player_ids.includes(command.viewer_id), 'INVALID_VIEWER');
      const knowledge = copy(this.#ports.request_system_3(copy(command)));
      // A previously known agreement ID does not reveal an undisclosed update.
      const visible = knowledge.agreement_views?.[command.viewer_id] ?? [];
      requireRule(Array.isArray(visible), 'INVALID_KNOWLEDGE_VIEW');
      const agreements = visible.map(a => {
        requireRule(id(a.agreement_id) && id(a.agreement_type) && id(a.status), 'INVALID_KNOWLEDGE_VIEW');
        return {agreement_id: a.agreement_id, agreement_type: a.agreement_type, status: a.status};
      });
      return {ok: true, status: 'view', result: {agreements, beliefs: copy(this.#state.participant_agreement_beliefs.filter(b => b.character_id === command.viewer_id))}};
    }
    requireRule(creator.authorized === true || persistence.authorized === true, 'ADMIN_AUTHORIZATION_REQUIRED');
    if (command.operation === 'save' || command.operation === 'inspect') {
      if (command.operation === 'inspect') requireRule(creator.authorized === true, 'CREATOR_AUTHORIZATION_REQUIRED');
      return {ok: true, status: command.operation, result: this.#state.toJSON()};
    }
    if (command.operation === 'load') {
      requireRule(persistence.authorized === true, 'PERSISTENCE_AUTHORIZATION_REQUIRED');
      const supplied = this.#clone(command.snapshot);
      const restored = this.#replay(supplied.romance_events, command.timeline_id);
      requireRule(equal(supplied.toJSON(), restored.toJSON()), 'SNAPSHOT_DERIVATION_MISMATCH');
      this.#state = restored;
      return {ok: true, status: 'loaded', result: {timeline_id: command.timeline_id}};
    }
    if (['fork', 'rewind', 'retcon'].includes(command.operation)) {
      if (command.operation === 'retcon') requireRule(creator.authorized === true, 'CREATOR_AUTHORIZATION_REQUIRED');
      else requireRule(persistence.authorized === true, 'PERSISTENCE_AUTHORIZATION_REQUIRED');
      const timeline = command.operation === 'retcon' ? command.timeline_id : command.new_timeline_id;
      requireRule(id(timeline) && (command.operation === 'retcon' || timeline !== command.timeline_id), 'INVALID_BRANCH_ID');
      let journal = copy(this.#state.romance_events);
      if (command.operation === 'rewind') {
        requireRule(number(command.before), 'INVALID_REWIND_TIME');
        journal = journal.filter(r => r.applied_at < command.before);
      }
      if (command.operation === 'retcon') {
        requireRule(unique(command.remove_source_event_ids) && command.remove_source_event_ids.every(id), 'INVALID_RETCON_IDS');
        const removed = new Set(command.remove_source_event_ids);
        requireRule([...removed].every(x => journal.some(r => r.source_event_id === x)), 'UNKNOWN_RETCON_EVENT');
        for (const r of journal) {
          if (removed.has(r.source_event_id) || r.interpretation.dependencies.some(x => removed.has(x))) {
            requireRule(r.interpretation.event.creator_anchor !== true, 'CREATOR_ANCHOR_PROTECTED');
            removed.add(r.source_event_id);
          }
        }
        journal = journal.filter(r => !removed.has(r.source_event_id));
      }
      const rebuilt = this.#replay(journal, timeline);
      if (command.operation === 'retcon') this.#state = rebuilt;
      return {ok: true, status: command.operation, result: rebuilt.toJSON()};
    }
    throw new RuleError('UNKNOWN_OPERATION');
  }

  #replay(journal, timeline) {
    const state = new RomanceState();
    for (const row of journal) {
      const oldTimeline = row.interpretation.event.timeline_id;
      const rebase = value => {
        if (Array.isArray(value)) return value.map(rebase);
        if (!object(value)) return value;
        return Object.fromEntries(Object.entries(value).map(([name, item]) => {
          if (name === 'timeline_id' && item === oldTimeline) return [name, timeline];
          if (name === 'terms' && typeof item === 'string') {
            try { const parsed = JSON.parse(item); if (object(parsed) || Array.isArray(parsed)) return [name, stable(rebase(parsed))]; } catch { /* Opaque action scope, not serialized terms. */ }
          }
          return [name, rebase(item)];
        }));
      };
      const event = rebase(copy(row.interpretation.event)), inputs = rebase(copy(row.interpretation.inputs));
      inputs.system_3.event = copy(event);
      this.#apply(state, event, inputs);
    }
    return state;
  }

  #apply(state, event, inputs) {
    exact(event, 'source_event_id timeline_id observer_id target_id event_type occurred_at context_id payload depends_on creator_anchor');
    requireRule([event.source_event_id, event.timeline_id, event.observer_id, event.target_id, event.context_id, event.event_type].every(id), 'INVALID_EVENT_ID');
    requireRule(event.observer_id !== event.target_id && number(event.occurred_at) && object(event.payload) && typeof event.creator_anchor === 'boolean', 'INVALID_EVENT');
    requireRule(inputs.system_3.canonical === true && equal(inputs.system_3.event, event), 'NONCANONICAL_EVENT');
    requireRule(number(inputs.system_11.now) && event.occurred_at === inputs.system_11.now, 'TIME_NOT_AUTHORITATIVE');
    requireRule(!state.romance_events.some(r => r.source_event_id === event.source_event_id), 'DUPLICATE_EVENT');
    const last = state.romance_events.at(-1);
    requireRule(!last || (last.interpretation.event.timeline_id === event.timeline_id && last.applied_at <= event.occurred_at), 'OUT_OF_ORDER_EVENT');
    requireRule(unique(event.depends_on) && event.depends_on.every(id), 'INVALID_DEPENDENCIES');
    if (event.creator_anchor) requireRule(inputs.creator.authorized === true && inputs.creator.allow_seeds === true, 'UNAUTHORIZED_ANCHOR');
    const dependencies = new Set(event.depends_on);
    const depend = source => {
      requireRule(state.romance_events.some(r => r.source_event_id === source), 'MISSING_CAUSAL_EVENT', source);
      dependencies.add(source);
    };
    for (const source of dependencies) depend(source);
    const p = event.payload, policy = inputs.creator.policy;
    const label = name => { const value = policy?.labels?.[name]; requireRule(id(value), 'MISSING_STATE_LABEL', name); return value; };
    const outputs = [];
    const emit = (recipient, payload) => outputs.push({recipient, payload: {timeline_id: event.timeline_id, source_event_id: event.source_event_id, ...copy(payload)}});
    const result = {status: 'applied', outputs};
    const changes = {attraction_delta: {}, jealousy_delta: 0, interest_state_change: null, agreement_change_id: null};
    const isPC = character => inputs.player.player_ids.includes(character);
    const knows = character => {
      const k = inputs.system_3.knowledge?.[character];
      return k && ['perceived', 'learned', 'suspected'].includes(k.mode) && Array.isArray(k.evidence_ids) && k.evidence_ids.length > 0;
    };
    const knowledge = character => {
      requireRule(knows(character), 'KNOWLEDGE_REQUIRED', character);
      for (const evidence of inputs.system_3.knowledge[character].evidence_ids) if (state.romance_events.some(r => r.source_event_id === evidence)) depend(evidence);
    };
    const edge = () => {
      const found = state.romance_edges.find(r => key(r) === key(event));
      requireRule(found, 'EDGE_NOT_INITIALIZED');
      const seed = state.romance_events.find(r => r.event_type === 'seed_edge' && key(r.interpretation.event) === key(event));
      if (seed) depend(seed.source_event_id);
      return found;
    };
    const agreement = agreementId => {
      const a = state.romantic_agreements.find(a => a.agreement_id === agreementId);
      requireRule(a && a.timeline_id === event.timeline_id, 'UNKNOWN_AGREEMENT');
      depend(a.source_event_id); return a;
    };
    const authorizations = character => isPC(character) ? inputs.player.authorizations : inputs.system_6.decisions;
    const decision = (character, action, other, scope, terms = null) => {
      const candidates = authorizations(character).filter(d => d.character_id === character && d.source_event_id === event.source_event_id && d.action === action && d.other_id === other && d.scope === scope && d.context_id === event.context_id && d.terms === terms);
      requireRule(candidates.length <= 1, 'CONFLICTING_DECISIONS');
      const d = candidates[0];
      if (!d) return null;
      requireRule(id(d.decision_id) && d.explicit === true && ['accepted', 'declined', 'withdrawn', 'unknown'].includes(d.decision), 'INVALID_DECISION');
      requireRule(d.origin === (isPC(character) ? 'player' : 'system_6'), 'INVALID_DECISION_AUTHORITY');
      return d;
    };
    const authorize = (character, action, scope, terms = null) => {
      const d = decision(character, action, character === event.observer_id ? event.target_id : event.observer_id, scope, terms);
      requireRule(d?.decision === 'accepted', 'EXPLICIT_ACTION_REQUIRED'); return d;
    };
    const emotionalAuthority = fields => {
      if (!isPC(event.observer_id)) return;
      for (const field of fields) requireRule(inputs.player.delegations.some(d => d.character_id === event.observer_id && d.field === field && d.enabled === true && d.explicit === true), 'PC_EMOTIONAL_AGENCY', field);
    };
    const boundary = (owner, target, category, action) => {
      for (const b of [...inputs.system_7.boundaries, ...state.intimacy_boundaries]) {
        if (b.owner_id !== owner || ![target, '*'].includes(b.target_id_or_scope) || b.status !== label('boundary_active')) continue;
        if (![category, 'general'].includes(b.category)) continue;
        const rule = b.rule;
        requireRule(object(rule) && ['deny', 'allow'].includes(rule.effect) && Array.isArray(rule.actions), 'UNSUPPORTED_BOUNDARY_RULE');
        if (!(rule.actions.includes(action) || rule.actions.includes('*'))) continue;
        if (rule.when !== undefined) {
          requireRule(object(rule.when), 'INVALID_BOUNDARY_CONTEXT');
          for (const field of Object.keys(rule.when)) requireRule(object(p.context) && Object.hasOwn(p.context, field), 'BOUNDARY_CONTEXT_REQUIRED');
          if (!Object.entries(rule.when).every(([field, value]) => equal(p.context[field], value))) continue;
        }
        if (rule.effect === 'deny' && (rule.actions.includes(action) || rule.actions.includes('*'))) throw new RuleError('BOUNDARY_DENIED');
      }
    };
    const contact = physical => {
      requireRule(inputs.system_11.opportunity === true, 'NO_TIME_OPPORTUNITY');
      requireRule(inputs.system_13.action_allowed === true && inputs.system_22.action_allowed === true && inputs.system_20.action_allowed === true && inputs.system_19.action_allowed === true, 'DOMAIN_CONSTRAINT');
      if (physical) requireRule(inputs.system_12.feasible === true && inputs.system_17.feasible === true, 'PHYSICAL_OPPORTUNITY_REQUIRED');
      else requireRule(inputs.system_16.contact_feasible === true || (inputs.system_12.feasible === true && inputs.system_17.feasible === true), 'CONTACT_UNAVAILABLE');
    };
    const cooldown = () => {
      for (const r of state.romance_events) {
        const e = r.interpretation.event;
        if (!([e.observer_id, e.target_id].includes(event.observer_id) && [e.observer_id, e.target_id].includes(event.target_id))) continue;
        const type = r.interpretation.result.cooldown;
        if (!type) continue;
        const duration = r.interpretation.inputs.creator.policy?.cooldowns?.[type];
        requireRule(number(duration) && duration >= 0, 'MISSING_COOLDOWN_POLICY', type);
        const newCause = p.new_cause_event_id && event.depends_on.includes(p.new_cause_event_id) && inputs.system_3.strong_new_cause_ids?.includes(p.new_cause_event_id);
        if (type === 'rejection') requireRule(newCause, 'REJECTION_REQUIRES_NEW_CAUSE');
        requireRule(event.occurred_at >= r.applied_at + duration || newCause, 'COOLDOWN_ACTIVE');
      }
    };
    const pairing = () => {
      const lock = inputs.creator.pairing_locks.find(x => x.participant_ids.includes(event.observer_id) && x.participant_ids.includes(event.target_id));
      requireRule(!lock || lock.status !== 'forbidden', 'PAIRING_FORBIDDEN');
    };
    const update = (field, delta, severity, noveltyKey = null) => {
      const e = DIMENSIONS.includes(field) || field === 'jealousy_level' ? edge() : state.additional_named_attraction_fields[key(event)];
      requireRule(e && number(e[field]), 'NUMERIC_STATE_NOT_INITIALIZED', field);
      requireRule(number(delta) && ['minor', 'major'].includes(severity), 'INVALID_DELTA');
      const cap = policy?.max_delta?.[severity];
      const inertia = inputs.system_7.inertia?.[event.observer_id];
      requireRule(number(cap) && cap >= 0 && number(inertia) && inertia >= 0 && inertia <= 1, 'MISSING_UPDATE_POLICY');
      let multiplier = 1;
      if (noveltyKey !== null) {
        requireRule(number(policy.novelty_decay) && policy.novelty_decay >= 0 && policy.novelty_decay <= 1, 'MISSING_NOVELTY_POLICY');
        const count = state.romance_events.filter(r => key(r.interpretation.event) === key(event) && r.interpretation.event.payload.novelty_key === noveltyKey).length;
        multiplier = policy.novelty_decay ** count;
      }
      const change = Math.max(-cap, Math.min(cap, delta * multiplier * inertia));
      const previous = e[field];
      e[field] = bounded(policy, field, previous + change);
      edge().state_version++;
      return e[field] - previous;
    };
    const validateProposal = () => {
      const proposal = inputs.system_2.proposal;
      if (proposal === null) return;
      record('RomanceInterpretationProposal', proposal);
      requireRule(proposal.source_event_id === event.source_event_id && proposal.observer_id === event.observer_id && proposal.target_id === event.target_id, 'PROPOSAL_SCOPE_MISMATCH');
      requireRule(FLIRTATION.includes(proposal.perceived_flirtation) && typeof proposal.consent_required === 'boolean' && number(proposal.confidence) && Array.isArray(proposal.reason_tags) && proposal.reason_tags.every(id), 'INVALID_PROPOSAL');
      requireRule(Array.isArray(proposal.attraction_relevance) && proposal.attraction_relevance.every(x => p.signals?.includes(x)), 'UNSUPPORTED_PROPOSAL_SIGNAL');
      requireRule(Array.isArray(proposal.compatibility_signals) && proposal.compatibility_signals.every(x => p.compatibility_signals?.includes(x)), 'UNSUPPORTED_COMPATIBILITY_SIGNAL');
      requireRule(equal(proposal.agreement_context, p.agreement_context ?? {}) && equal(proposal.jealousy_context, p.jealousy_context ?? {}), 'UNSUPPORTED_PROPOSAL_CONTEXT');
      requireRule(equal(proposal.perceived_intent, p.perceived_intent ?? null) && proposal.consent_required === (p.consent_required === true), 'UNSUPPORTED_PROPOSAL_INTENT');
      // Interpretation is retained for audit only. It cannot set feelings/consent,
      // agreement truth or numeric changes, even when text claims otherwise.
      state.RomanceInterpretationProposal.push(copy(proposal));
    };

    if (p.offscreen === true && !['seed_edge', 'violation', 'conduct', 'belief'].includes(event.event_type)) {
      requireRule(inputs.system_6.candidate_event_ids.includes(event.source_event_id), 'OPPORTUNITY_CANDIDATE_REQUIRED');
      requireRule(!isPC(event.observer_id) && !isPC(event.target_id), 'PC_OFFSCREEN_ACTION_FORBIDDEN');
    }
    if (p.optional_generated === true && ['jealousy', 'conflict', 'breakup', 'separation', 'violation', 'conduct'].includes(event.event_type)) {
      requireRule(event.depends_on.length > 0 && inputs.system_3.caused_consequence === true, 'OPTIONAL_DRAMA_FORBIDDEN');
    }

    switch (event.event_type) {
      case 'seed_edge': {
        requireRule(inputs.creator.authorized === true && inputs.creator.allow_seeds === true && event.creator_anchor, 'CREATOR_SEED_REQUIRED');
        const row = record('romance_edges', p.record);
        requireRule(key(row) === key(event) && !state.romance_edges.some(r => key(r) === key(row)), 'INVALID_EDGE_SEED');
        requireRule(INTEREST.includes(row.romantic_interest_state) && FIDELITY.includes(row.fidelity_level) && Number.isSafeInteger(row.state_version) && row.state_version >= 0, 'INVALID_EDGE_STATE');
        requireRule(object(row.jealousy_context_json), 'INVALID_JEALOUSY_CONTEXT');
        if (['mutual courtship', 'committed relationship'].includes(row.romantic_interest_state)) {
          const a = agreement(p.agreement_id);
          requireRule(a.status === label('agreement_active') && a.participant_ids.includes(event.observer_id) && a.participant_ids.includes(event.target_id), 'MUTUAL_AGREEMENT_REQUIRED');
        }
        for (const field of [...DIMENSIONS, 'jealousy_level']) within(policy, field, row[field]);
        if (isPC(event.observer_id)) authorize(event.observer_id, 'author_stance', 'seed', stable(row));
        else for (const field of DIMENSIONS) if (row[field] > bounds(policy, field)[0]) requireRule(inputs.system_5.profiles?.[event.observer_id]?.orientation_allows?.[event.target_id]?.[field] === true, 'ORIENTATION_CONSTRAINT');
        state.romance_edges.push(row);
        const extra = record('additional_named_attraction_fields', p.additional);
        within(policy, 'romantic_interest_confidence', extra.romantic_interest_confidence);
        if (extra.chemistry_context !== null) within(policy, 'chemistry_context', extra.chemistry_context);
        state.additional_named_attraction_fields[key(event)] = extra;
        break;
      }
      case 'attraction':
      case 'date_outcome': {
        knowledge(event.observer_id); validateProposal();
        requireRule(Array.isArray(p.signals) && unique(p.signals) && p.signals.length > 0 && p.signals.every(id) && id(p.novelty_key), 'OBSERVED_SIGNALS_REQUIRED');
        if (event.event_type === 'date_outcome') {
          const date = state.romance_events.find(r => r.source_event_id === p.date_event_id && r.interpretation.result.date_commitment === true);
          requireRule(date && [date.observer_id, date.target_id].includes(event.observer_id) && [date.observer_id, date.target_id].includes(event.target_id), 'ACCEPTED_DATE_REQUIRED');
          requireRule(!state.romance_events.some(r => r.event_type === 'date_outcome' && r.observer_id === event.observer_id && r.interpretation.event.payload.date_event_id === p.date_event_id), 'DATE_OUTCOME_ALREADY_RESOLVED');
          depend(date.source_event_id); contact(true);
        }
        const profile = inputs.system_5.profiles?.[event.observer_id];
        requireRule(profile && object(profile.preference_weights), 'PREFERENCE_PROFILE_REQUIRED');
        const numericFields = [...DIMENSIONS, 'romantic_interest_confidence', 'chemistry_context'];
        const deltas = Object.fromEntries(numericFields.map(d => [d, 0]));
        for (const signal of p.signals) {
          requireRule(!['protagonist', 'proximity', 'friendship', 'weekly_decay', 'consent', 'gift_entitlement'].includes(signal), 'FORBIDDEN_ATTRACTION_CAUSE');
          const rule = policy?.attraction_rules?.[signal], weight = profile.preference_weights[signal];
          requireRule(object(rule) && number(weight), 'UNCONFIGURED_ATTRACTION_SIGNAL', signal);
          for (const [field, amount] of Object.entries(rule)) { requireRule(numericFields.includes(field) && number(amount), 'INVALID_ATTRACTION_RULE'); deltas[field] += amount * weight; }
        }
        emotionalAuthority(numericFields.filter(d => deltas[d] !== 0));
        for (const field of numericFields.filter(d => DIMENSIONS.includes(d) || deltas[d] !== 0)) {
          if (DIMENSIONS.includes(field) && deltas[field] > 0) requireRule(profile.orientation_allows?.[event.target_id]?.[field] === true, 'ORIENTATION_CONSTRAINT');
          changes.attraction_delta[field] = update(field, deltas[field], p.severity, p.novelty_key);
        }
        emit('system_6', {kind: 'romance_context', edge: copy(edge()), relationship_context: inputs.system_7.relationship_context});
        break;
      }
      case 'stance': {
        knowledge(event.observer_id);
        const fields = ['romantic_attraction', 'sexual_attraction', 'aesthetic_attraction', 'attraction_awareness', 'romantic_interest_state', 'pursuit_state', 'current_partner_belief'];
        requireRule(object(p.values) && Object.keys(p.values).length > 0 && Object.keys(p.values).every(f => fields.includes(f)), 'INVALID_STANCE_FIELDS');
        const source = isPC(event.observer_id) ? inputs.player : inputs.system_6;
        requireRule(source.stances.some(s => s.character_id === event.observer_id && s.source_event_id === event.source_event_id && s.explicit === true && equal(s.values, p.values)), 'EXPLICIT_STANCE_REQUIRED');
        if (!isPC(event.observer_id)) requireRule(Object.keys(p.values).every(f => !DIMENSIONS.includes(f)), 'NPC_ATTRACTION_REQUIRES_UPDATE_RULE');
        if (p.values.romantic_interest_state) {
          requireRule(INTEREST.includes(p.values.romantic_interest_state), 'INVALID_INTEREST_STATE');
          if (p.values.romantic_interest_state === 'mutual courtship' && p.date_event_id) {
            const date = state.romance_events.find(r => r.source_event_id === p.date_event_id && r.interpretation.result.date_commitment === true);
            requireRule(date && [date.observer_id, date.target_id].includes(event.observer_id) && [date.observer_id, date.target_id].includes(event.target_id), 'ACCEPTED_DATE_REQUIRED');
            depend(date.source_event_id);
          } else if (['mutual courtship', 'committed relationship'].includes(p.values.romantic_interest_state)) {
            const a = agreement(p.agreement_id);
            requireRule(a.status === label('agreement_active') && a.participant_ids.includes(event.observer_id) && a.participant_ids.includes(event.target_id), 'MUTUAL_AGREEMENT_REQUIRED');
          }
        }
        for (const [field, value] of Object.entries(p.values)) if (DIMENSIONS.includes(field)) { within(policy, field, value); changes.attraction_delta[field] = value - edge()[field]; }
        changes.interest_state_change = p.values.romantic_interest_state ?? null;
        Object.assign(edge(), copy(p.values)); edge().state_version++;
        break;
      }
      case 'boundary': {
        const b = record('intimacy_boundaries', p.record);
        requireRule(b.owner_id === event.observer_id && b.source_event_id === event.source_event_id && [event.target_id, '*'].includes(b.target_id_or_scope), 'BOUNDARY_SCOPE_MISMATCH');
        requireRule(['romantic', 'physical', 'sexual', 'privacy', 'communication'].includes(b.category) && typeof b.known_by_target === 'boolean' && [label('boundary_active'), label('boundary_inactive')].includes(b.status), 'INVALID_BOUNDARY');
        requireRule(object(b.rule) && ['deny', 'allow'].includes(b.rule.effect) && unique(b.rule.actions) && b.rule.actions.every(id), 'UNSUPPORTED_BOUNDARY_RULE');
        if (!(event.creator_anchor && !isPC(b.owner_id))) authorize(b.owner_id, 'boundary', b.category, stable(b));
        const previous = state.intimacy_boundaries.findIndex(x => x.boundary_id === b.boundary_id);
        if (previous >= 0) { requireRule(state.intimacy_boundaries[previous].owner_id === b.owner_id, 'BOUNDARY_OWNER_MISMATCH'); depend(state.intimacy_boundaries[previous].source_event_id); state.intimacy_boundaries[previous] = b; }
        else state.intimacy_boundaries.push(b);
        emit('system_6', {kind: 'boundary', boundary: b});
        break;
      }
      case 'date': {
        pairing(); contact(false); cooldown();
        for (const [who, other] of [[event.observer_id, event.target_id], [event.target_id, event.observer_id]]) {
          boundary(who, other, 'romantic', 'date'); boundary(who, other, 'communication', 'date');
        }
        const a = authorize(event.observer_id, 'date', 'proposal');
        const b = decision(event.target_id, 'date', event.observer_id, 'proposal');
        if (!b || b.decision === 'unknown') { result.status = 'pending'; result.return_control = isPC(event.target_id); }
        else {
          requireRule(a.decision_id !== b.decision_id, 'INDEPENDENT_DECISIONS_REQUIRED');
          if (b.decision !== 'accepted') { result.status = 'declined'; result.cooldown = 'rejection'; }
          else if (a.romantic_framing !== true || b.romantic_framing !== true) result.status = 'ambiguous';
          else { result.date_commitment = true; emit('system_11', {kind: 'date_commitment', participants: [event.observer_id, event.target_id], timing: p.timing}); }
        }
        if (result.status === 'pending') emit('player', {kind: 'date_response_required', actor_id: event.observer_id, target_id: event.target_id});
        break;
      }
      case 'consent': {
        requireRule(INTERACTIONS.includes(p.interaction_category) && CONSENT.includes(p.status), 'INVALID_CONSENT_SCOPE');
        requireRule(p.conditions === undefined || (Array.isArray(p.conditions) && p.conditions.every(id)), 'INVALID_CONSENT_CONDITIONS');
        const scope = p.interaction_category;
        let consentStatus = p.status;
        const prior = state.IntimacyConsentState.find(c => c.source_event_id === p.consent_source_event_id);
        if (p.status === 'withdrawn') {
          requireRule(prior && prior.initiator_id === event.observer_id && prior.target_id === event.target_id && prior.interaction_category === scope, 'CONSENT_SCOPE_MISMATCH');
          depend(prior.source_event_id);
          const who = p.withdrawing_character_id;
          requireRule([event.observer_id, event.target_id].includes(who), 'INVALID_WITHDRAWAL_PARTICIPANT');
          const d = decision(who, 'consent', who === event.observer_id ? event.target_id : event.observer_id, scope);
          requireRule(d?.decision === 'withdrawn', 'EXPLICIT_WITHDRAWAL_REQUIRED');
          for (const grant of state.IntimacyConsentState) {
            const samePair = [grant.initiator_id, grant.target_id].includes(event.observer_id) && [grant.initiator_id, grant.target_id].includes(event.target_id);
            if (samePair && grant.interaction_category === scope && ['accepted', 'invited', 'unknown'].includes(grant.status)) {
              depend(grant.source_event_id); grant.status = 'withdrawn';
              state.intimacy_consent_events.find(c => c.source_event_id === grant.source_event_id).withdrawn_at = event.occurred_at;
            }
          }
        } else {
          pairing(); contact(true);
          for (const [owner, target] of [[event.observer_id, event.target_id], [event.target_id, event.observer_id]]) {
            for (const category of ['romantic', 'physical', 'sexual', 'privacy']) boundary(owner, target, category, scope);
          }
          requireRule(Array.isArray(p.conditions) && p.conditions.every(id), 'INVALID_CONSENT_CONDITIONS');
          const capacities = [event.observer_id, event.target_id].map(x => inputs.system_18.capacity?.[x]);
          if (capacities.some(c => c?.can_consent === false || c?.voluntary === false)) consentStatus = 'unable_to_consent';
          else {
            requireRule(capacities.every(c => c?.can_consent === true && c?.voluntary === true), 'CAPACITY_UNKNOWN');
            const a = authorize(event.observer_id, 'consent', scope);
            const b = decision(event.target_id, 'consent', event.observer_id, scope);
            requireRule(!b || b.decision_id !== a.decision_id, 'INDEPENDENT_DECISIONS_REQUIRED');
            const status = !b || b.decision === 'unknown' ? 'invited' : b.decision;
            requireRule(p.status === status || (p.status === 'unknown' && status === 'invited'), 'CONSENT_DECISION_MISMATCH');
            if (status === 'accepted') for (const who of [event.observer_id, event.target_id]) for (const condition of p.conditions) requireRule(inputs.system_18.conditions_met?.[who]?.[condition] === true, 'CONSENT_CONDITION_UNMET');
            result.return_control = status === 'invited' && isPC(event.target_id);
          }
        }
        state.IntimacyConsentState.push(record('IntimacyConsentState', {initiator_id: event.observer_id, target_id: event.target_id, interaction_category: scope, status: consentStatus, granted_at: consentStatus === 'accepted' ? event.occurred_at : null, expires_on_context_change: true, source_event_id: event.source_event_id, conditions: copy(p.conditions ?? [])}));
        state.intimacy_consent_events.push(record('intimacy_consent_events', {consent_event_id: event.source_event_id, initiator_id: event.observer_id, target_id: event.target_id, interaction_category: scope, status: consentStatus, granted_at: consentStatus === 'accepted' ? event.occurred_at : null, withdrawn_at: consentStatus === 'withdrawn' ? event.occurred_at : null, context_id: event.context_id, source_event_id: event.source_event_id}));
        result.status = consentStatus;
        if (consentStatus === 'declined') result.cooldown = 'rejection';
        emit('system_6', {kind: 'consent_resolution', status: consentStatus, interaction_category: scope});
        if (result.return_control) emit('player', {kind: 'intimacy_response_required', actor_id: event.observer_id, target_id: event.target_id, interaction_category: scope});
        break;
      }
      case 'context_change': {
        requireRule(unique(p.consent_source_event_ids) && p.consent_source_event_ids.length > 0, 'CONSENT_REFERENCES_REQUIRED');
        for (const source of p.consent_source_event_ids) {
          const grant = state.IntimacyConsentState.find(c => c.source_event_id === source);
          requireRule(grant && [grant.initiator_id, grant.target_id].includes(event.observer_id) && [grant.initiator_id, grant.target_id].includes(event.target_id), 'CONSENT_SCOPE_MISMATCH');
          depend(source);
          if (grant.expires_on_context_change && ['accepted', 'invited'].includes(grant.status)) grant.status = 'unknown';
        }
        break;
      }
      case 'intimacy': {
        contact(true); pairing();
        const c = state.IntimacyConsentState.find(c => c.source_event_id === p.consent_source_event_id);
        const ce = state.intimacy_consent_events.find(c => c.source_event_id === p.consent_source_event_id);
        requireRule(c && ce && c.status === 'accepted' && ce.withdrawn_at === null && c.initiator_id === event.observer_id && c.target_id === event.target_id && c.interaction_category === p.interaction_category && ce.context_id === event.context_id, 'CURRENT_SCOPED_CONSENT_REQUIRED');
        depend(c.source_event_id);
        requireRule(!state.romance_events.some(r => r.event_type === 'intimacy' && r.interpretation.event.payload.consent_source_event_id === c.source_event_id), 'CONSENT_ALREADY_CONSUMED');
        const decisions = [];
        for (const [who, other] of [[event.observer_id, event.target_id], [event.target_id, event.observer_id]]) {
          for (const category of ['romantic', 'physical', 'sexual', 'privacy']) boundary(who, other, category, c.interaction_category);
          const capacity = inputs.system_18.capacity?.[who];
          requireRule(capacity?.can_consent === true && capacity?.voluntary === true, 'CURRENT_CAPACITY_REQUIRED');
          for (const condition of c.conditions) requireRule(inputs.system_18.conditions_met?.[who]?.[condition] === true, 'CONSENT_CONDITION_UNMET');
          decisions.push(authorize(who, 'intimacy', c.interaction_category, c.source_event_id));
        }
        requireRule(decisions[0].decision_id !== decisions[1].decision_id, 'INDEPENDENT_DECISIONS_REQUIRED');
        result.consensual = true;
        emit('system_18', {kind: 'intimacy', participants: [event.observer_id, event.target_id], interaction_category: c.interaction_category, consent_status: 'accepted', context_id: event.context_id});
        emit('system_7', {kind: 'intimacy_event', participants: [event.observer_id, event.target_id]});
        break;
      }
      case 'agreement': {
        pairing(); contact(false); cooldown();
        const a = record('romantic_agreements', p.record);
        requireRule(a.timeline_id === event.timeline_id && a.source_event_id === event.source_event_id && unique(a.participant_ids) && a.participant_ids.length >= 2 && a.participant_ids.every(id) && a.participant_ids.includes(event.observer_id) && a.participant_ids.includes(event.target_id), 'INVALID_AGREEMENT_PARTICIPANTS');
        requireRule(AGREEMENTS.includes(a.agreement_type) && a.status === label('agreement_active') && a.started_at === event.occurred_at && a.ended_at === null && Array.isArray(a.exclusivity_rules) && Array.isArray(a.disclosure_rules), 'INVALID_AGREEMENT');
        for (const rule of a.exclusivity_rules) requireRule(object(rule) && ['allow', 'forbid'].includes(rule.effect) && INTERACTIONS.includes(rule.action) && ['outside_participants', 'any'].includes(rule.scope), 'UNSUPPORTED_AGREEMENT_RULE');
        const terms = stable(a), choices = [];
        const authoredHistory = event.creator_anchor && p.authored_history === true && a.participant_ids.every(who => !isPC(who));
        for (const who of a.participant_ids) {
          for (const other of a.participant_ids.filter(x => x !== who)) {
            boundary(who, other, 'romantic', 'agreement'); boundary(who, other, 'romantic', a.agreement_type);
          }
          if (authoredHistory) continue;
          const d = decision(who, 'agreement', who === event.observer_id ? event.target_id : event.observer_id, a.agreement_id, terms);
          if (!d || d.decision !== 'accepted') { result.status = 'not_mutual'; result.return_control = !d && isPC(who); }
          if (d) choices.push(d.decision_id);
        }
        requireRule(unique(choices), 'INDEPENDENT_DECISIONS_REQUIRED');
        if (p.participant_beliefs !== undefined) {
          requireRule(Array.isArray(p.participant_beliefs), 'INVALID_BELIEFS');
          for (const b of p.participant_beliefs) {
            record('participant_agreement_beliefs', b);
            requireRule(b.agreement_id === a.agreement_id && a.participant_ids.includes(b.character_id) && b.last_updated_event_id === event.source_event_id && Array.isArray(b.believed_rules) && number(b.confidence), 'INVALID_BELIEF');
            const index = state.participant_agreement_beliefs.findIndex(x => x.agreement_id === b.agreement_id && x.character_id === b.character_id);
            if (index < 0) state.participant_agreement_beliefs.push(copy(b)); else state.participant_agreement_beliefs[index] = copy(b);
          }
        }
        if (result.status === 'not_mutual') break;
        const previous = state.romantic_agreements.findIndex(x => x.agreement_id === a.agreement_id);
        if (previous >= 0) {
          const old = state.romantic_agreements[previous]; depend(old.source_event_id);
          requireRule(equal([...old.participant_ids].sort(), [...a.participant_ids].sort()), 'AGREEMENT_PARTICIPANTS_IMMUTABLE');
          state.romantic_agreements[previous] = a;
        } else state.romantic_agreements.push(a);
        changes.agreement_change_id = a.agreement_id; result.cooldown = 'agreement';
        emit('system_3', {kind: 'agreement_changed', agreement: a});
        emit('system_7', {kind: 'agreement_changed', agreement_id: a.agreement_id});
        break;
      }
      case 'belief': {
        knowledge(event.observer_id);
        const b = record('participant_agreement_beliefs', p.record);
        requireRule(b.character_id === event.observer_id && b.last_updated_event_id === event.source_event_id && Array.isArray(b.believed_rules) && number(b.confidence), 'INVALID_BELIEF');
        // A belief can reference an alleged agreement absent from canonical state.
        const i = state.participant_agreement_beliefs.findIndex(x => x.agreement_id === b.agreement_id && x.character_id === b.character_id);
        if (i < 0) state.participant_agreement_beliefs.push(b); else state.participant_agreement_beliefs[i] = b;
        break;
      }
      case 'jealousy': {
        knowledge(event.observer_id); emotionalAuthority(['jealousy_level']); validateProposal();
        requireRule(object(p.jealousy_context) && id(p.jealousy_context.bond) && id(p.threat), 'THREAT_CONTEXT_REQUIRED');
        const rule = policy?.jealousy_rules?.[p.threat];
        let amount = rule;
        if (object(rule)) {
          requireRule(number(rule.base) && object(rule.weights), 'UNCONFIGURED_JEALOUSY_RULE');
          amount = rule.base;
          const allowed = ['system_5.insecurity', 'system_5.possessiveness', 'system_7.trust', 'system_7.attachment', 'system_7.fear_of_loss', 'system_7.past_betrayal', 'context.rival_comparison', 'context.agreement_threat'];
          for (const [path, weight] of Object.entries(rule.weights)) {
            requireRule(allowed.includes(path) && number(weight), 'INVALID_JEALOUSY_WEIGHT');
            const [source, field] = path.split('.');
            const context = source === 'system_5' ? inputs.system_5.profiles?.[event.observer_id] : source === 'system_7' ? inputs.system_7.relationship_context?.[event.observer_id] : p.jealousy_context;
            requireRule(number(context?.[field]), 'MISSING_JEALOUSY_INPUT', path);
            amount += context[field] * weight;
          }
        }
        requireRule(number(amount), 'UNCONFIGURED_JEALOUSY_RULE');
        changes.jealousy_delta = update('jealousy_level', amount, p.severity, null);
        edge().jealousy_context_json = copy(p.jealousy_context);
        emit('system_6', {kind: 'jealousy_pressure', observer_id: event.observer_id, target_id: event.target_id, level: edge().jealousy_level, context: p.jealousy_context});
        break;
      }
      case 'conduct': {
        requireRule(INTERACTIONS.includes(p.action) && id(p.actor_id) && id(p.other_id) && ['fact', 'suspicion', 'accusation', 'confession', 'proof'].includes(p.evidence_state), 'INVALID_CONDUCT');
        const a = agreement(p.agreement_id);
        requireRule(a.participant_ids.includes(p.actor_id), 'CONDUCT_NOT_AGREEMENT_PARTICIPANT');
        const applies = r => r.action === p.action && (r.scope === 'any' || (r.scope === 'outside_participants' && !a.participant_ids.includes(p.other_id)));
        const actual = p.evidence_state === 'fact' && a.status === label('agreement_active');
        result.actual_violation = actual ? a.exclusivity_rules.some(r => r.effect === 'forbid' && applies(r)) : null;
        if (knows(event.observer_id)) {
          knowledge(event.observer_id);
          const belief = state.participant_agreement_beliefs.find(b => b.character_id === event.observer_id && b.agreement_id === a.agreement_id);
          result.perceived_violation = belief ? belief.believed_rules.some(r => r.effect === 'forbid' && applies(r)) : null;
          emit('system_7', {kind: 'perceived_conduct', observer_id: event.observer_id, evidence_state: p.evidence_state, perceived_violation: result.perceived_violation});
        }
        break;
      }
      case 'breakup':
      case 'separation': {
        const a = agreement(p.agreement_id);
        requireRule(a.participant_ids.includes(event.observer_id), 'NOT_AGREEMENT_PARTICIPANT');
        requireRule([label('agreement_active'), label('agreement_separated')].includes(a.status), 'AGREEMENT_ALREADY_ENDED');
        authorize(event.observer_id, event.event_type, a.agreement_id);
        a.status = label(event.event_type === 'breakup' ? 'agreement_ended' : 'agreement_separated');
        if (event.event_type === 'breakup') a.ended_at = event.occurred_at;
        a.source_event_id = event.source_event_id;
        changes.agreement_change_id = a.agreement_id; result.cooldown = 'breakup';
        for (const recipient of ['system_3', 'system_7', 'system_11', 'system_14', 'system_20']) emit(recipient, {kind: event.event_type, agreement_id: a.agreement_id, participants: a.participant_ids});
        break;
      }
      case 'milestone': {
        const m = record('romance_milestones', p.record);
        requireRule(m.source_event_id === event.source_event_id && m.occurred_at === event.occurred_at && unique(m.relationship_pair_or_group) && m.relationship_pair_or_group.includes(event.observer_id) && m.relationship_pair_or_group.includes(event.target_id) && object(m.salience_by_character_json), 'INVALID_MILESTONE');
        requireRule(!state.romance_milestones.some(x => x.milestone_id === m.milestone_id), 'DUPLICATE_MILESTONE');
        requireRule(event.depends_on.length > 0 || event.creator_anchor, 'MILESTONE_PROVENANCE_REQUIRED');
        if (event.creator_anchor) for (const who of m.relationship_pair_or_group.filter(isPC)) authorize(who, 'author_history', m.milestone_type, stable(m));
        state.romance_milestones.push(m); emit('system_4', {kind: 'milestone', milestone: m});
        break;
      }
      case 'conflict': {
        knowledge(event.observer_id);
        const c = record('romantic_conflicts', p.record);
        requireRule(unique(c.participants) && c.participants.includes(event.observer_id) && Array.isArray(c.topics) && Array.isArray(c.rival_ids) && Array.isArray(c.betrayal_event_ids) && [label('conflict_open'), label('conflict_closed')].includes(c.status), 'INVALID_CONFLICT');
        for (const source of c.betrayal_event_ids) depend(source);
        const index = state.romantic_conflicts.findIndex(x => x.conflict_id === c.conflict_id);
        if (index < 0) state.romantic_conflicts.push(c); else state.romantic_conflicts[index] = c;
        result.cooldown = 'conflict'; emit('system_7', {kind: 'romantic_conflict', conflict: c});
        break;
      }
      case 'fidelity': {
        requireRule(FIDELITY.includes(p.fidelity_level), 'INVALID_FIDELITY');
        edge().fidelity_level = p.fidelity_level; edge().state_version++; break;
      }
      case 'disclosure': {
        authorize(event.observer_id, 'disclosure', p.agreement_id);
        const a = agreement(p.agreement_id); knowledge(event.observer_id);
        boundary(event.target_id, event.observer_id, 'privacy', 'disclosure');
        emit('system_3', {kind: 'disclosure', agreement_id: a.agreement_id, disclosure_rules: a.disclosure_rules, witness_ids: p.witness_ids});
        break;
      }
      case 'violation': {
        requireRule(['stalking', 'coercion', 'blackmail', 'harassment', 'force', 'assault', 'withdrawal_violation', 'boundary_violation'].includes(p.kind), 'INVALID_VIOLATION');
        result.consensual = false;
        for (const recipient of ['system_19', 'system_20', 'system_7']) emit(recipient, {kind: p.kind, actor_id: event.observer_id, target_id: event.target_id, consensual: false, context: p.context});
        if (isPC(event.target_id)) emit('player', {kind: 'reaction_window', actor_id: event.observer_id});
        break;
      }
      default: throw new RuleError('UNSUPPORTED_EVENT_TYPE', event.event_type);
    }

    if (result.cooldown) requireRule(number(policy?.cooldowns?.[result.cooldown]) && policy.cooldowns[result.cooldown] >= 0, 'MISSING_COOLDOWN_POLICY');
    if (event.event_type === 'date_outcome') emit('system_7', {kind: 'date_interpretation', observer_id: event.observer_id, target_id: event.target_id, signals: p.signals, compatibility_signals: p.compatibility_signals ?? []});
    if (['agreement', 'breakup', 'separation'].includes(event.event_type) || (event.event_type === 'date' && result.status === 'declined') || p.meaningful === true) {
      const informed = [event.observer_id, event.target_id].filter(knows);
      if (informed.length > 0) emit('system_4', {kind: 'romance_memory', event_type: event.event_type, character_ids: informed, status: result.status});
    }
    // Presentation receives no hidden scores, subjective facts or invented PC feelings.
    for (const viewer of inputs.player.player_ids) if (inputs.system_3.visible_event_ids?.[viewer]?.includes(event.source_event_id)) emit('system_2', {kind: 'romance_resolution', viewer_id: viewer, status: result.status, return_control: result.return_control === true});
    state.romance_events.push(record('romance_events', {romance_event_id: event.source_event_id, source_event_id: event.source_event_id, observer_id: event.observer_id, target_id: event.target_id, event_type: event.event_type, interpretation: {event: copy(event), inputs: copy(inputs), dependencies: [...dependencies], result: copy(result)}, ...changes, applied_at: event.occurred_at}));
    return result;
  }
}
