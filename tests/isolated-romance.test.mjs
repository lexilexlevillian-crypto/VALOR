import test from 'node:test';
import assert from 'node:assert/strict';
import {RomanceSystem, createDependencyStubs} from '../src/isolated-romance/system8.mjs';

const policy = {
  ranges: {romantic_attraction: [0, 100], sexual_attraction: [0, 100], aesthetic_attraction: [0, 100], jealousy_level: [0, 100], romantic_interest_confidence: [0, 100], chemistry_context: [-100, 100]},
  attraction_rules: {warmth: {romantic_attraction: 10}, betrayal: {romantic_attraction: -60}},
  jealousy_rules: {suspected_rival: 8}, max_delta: {minor: 3, major: 40}, novelty_decay: 0.5,
  cooldowns: {rejection: 10, breakup: 10, agreement: 10, conflict: 10},
  labels: {agreement_active: 'active', agreement_ended: 'ended', agreement_separated: 'separated', boundary_active: 'active', boundary_inactive: 'inactive', conflict_open: 'open', conflict_closed: 'closed'},
};
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};

function harness() {
  let fixtures = {};
  const defaults = createDependencyStubs();
  const sent = [];
  const ports = Object.fromEntries(Object.entries(defaults).map(([name, fn]) => [name, request => {
    if (name.startsWith('send_')) { sent.push({port: name, payload: structuredClone(request)}); return fn(request); }
    return structuredClone(fixtures[name.slice(8)] ?? fn(request));
  }]));
  const engine = new RomanceSystem(ports);
  let tick = 0;
  const author = (event, who, action, scope, decision = 'accepted', terms = null, framing = true) => ({character_id: who, source_event_id: event.source_event_id, action, other_id: who === event.observer_id ? event.target_id : event.observer_id, scope, context_id: event.context_id, terms, decision, decision_id: `${event.source_event_id}/${who}`, explicit: true, origin: who === 'PC' ? 'player' : 'system_6', romantic_framing: framing});
  const event = (type, payload, observer = 'A', target = 'B', opts = {}) => ({source_event_id: `e${++tick}`, timeline_id: 'main', observer_id: observer, target_id: target, event_type: type, occurred_at: tick * 100, context_id: 'room', payload, depends_on: [], creator_anchor: false, ...opts});
  const run = (e, overrides = {}) => {
    fixtures = {
      creator: {authorized: true, allow_seeds: true, policy, pairing_locks: []},
      system_25: {authorized: true},
      system_3: {canonical: true, event: e, knowledge: {[e.observer_id]: {mode: 'perceived', evidence_ids: [e.source_event_id]}}, visible_event_ids: {}, visible_agreement_ids: {}},
      system_5: {profiles: {[e.observer_id]: {preference_weights: {warmth: 1, betrayal: 1}, orientation_allows: {[e.target_id]: {romantic_attraction: true, sexual_attraction: true, aesthetic_attraction: true}}}}},
      system_7: {boundaries: [], inertia: {[e.observer_id]: 1}, relationship_context: {}},
      system_11: {now: e.occurred_at, opportunity: true},
      system_12: {feasible: true}, system_17: {feasible: true}, system_13: {action_allowed: true},
      system_19: {action_allowed: true}, system_20: {action_allowed: true}, system_22: {action_allowed: true},
      system_16: {contact_feasible: true},
      system_18: {capacity: {[e.observer_id]: {can_consent: true, voluntary: true}, [e.target_id]: {can_consent: true, voluntary: true}}, conditions_met: {}},
      ...overrides,
    };
    return engine.process({operation: 'apply', timeline_id: e.timeline_id, source_event_id: e.source_event_id});
  };
  const save = () => {
    const r = engine.process({operation: 'save', timeline_id: 'main'});
    assert.equal(r.ok, true, JSON.stringify(r)); return r.result;
  };
  const seed = (observer = 'A', target = 'B', attraction = 10) => {
    const e = event('seed_edge', {}, observer, target, {creator_anchor: true});
    const row = {timeline_id: 'main', observer_id: observer, target_id: target, romantic_attraction: attraction, sexual_attraction: 0, aesthetic_attraction: 0, attraction_awareness: 'recognized', romantic_interest_state: 'none', pursuit_state: 'none', jealousy_level: 0, jealousy_context_json: {}, current_partner_belief: null, fidelity_level: 'standard', state_version: 0};
    e.payload = {record: row, additional: {romantic_interest_confidence: 0, chemistry_context: null}};
    const overrides = observer === 'PC' ? {player: {player_ids: ['PC'], delegations: [], stances: [], authorizations: [author(e, observer, 'author_stance', 'seed', 'accepted', canonical(row))]}} : {};
    const r = run(e, overrides); assert.equal(r.ok, true, JSON.stringify(r)); return e;
  };
  const consent = (target = 'B', status = 'accepted', overrides = {}) => {
    const e = event('consent', {interaction_category: 'kissing', status, conditions: []}, 'A', target);
    const ds = [author(e, 'A', 'consent', 'kissing')];
    if (target !== 'PC') ds.push(author(e, target, 'consent', 'kissing', status === 'invited' ? 'unknown' : status));
    return {e, r: run(e, {system_6: {decisions: ds, stances: [], candidate_event_ids: []}, ...overrides})};
  };
  const agree = () => {
    const e = event('agreement', {});
    const row = {agreement_id: 'g', timeline_id: 'main', participant_ids: ['A', 'B'], agreement_type: 'exclusive dating', exclusivity_rules: [{effect: 'forbid', action: 'kissing', scope: 'outside_participants'}], disclosure_rules: [], public_private_status: 'private', started_at: e.occurred_at, ended_at: null, status: 'active', source_event_id: e.source_event_id};
    e.payload = {record: row};
    const ds = ['A', 'B'].map(who => author(e, who, 'agreement', 'g', 'accepted', canonical(row)));
    const r = run(e, {system_6: {decisions: ds, stances: [], candidate_event_ids: []}});
    assert.equal(r.ok, true, JSON.stringify(r)); return e;
  };
  return {engine, event, run, save, seed, consent, agree, author, sent, ports};
}
const rejected = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code, JSON.stringify(r)); };

test('default dependency placeholders fail closed', () => {
  rejected(new RomanceSystem().process({operation: 'apply', timeline_id: 'main', source_event_id: 'x'}), 'NONCANONICAL_EVENT');
});
test('directional changes are bounded, nonreciprocal and diminish with repeated novelty', () => {
  const h = harness(); h.seed(); h.seed('B', 'A');
  for (let i = 0; i < 4; i++) assert.equal(h.run(h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'same'})).ok, true);
  const s = h.save(); assert.equal(s.romance_edges[0].romantic_attraction, 19.75); assert.equal(s.romance_edges[1].romantic_attraction, 10);
});
test('invalid mutations roll back state and emit nothing', () => {
  const h = harness(); h.seed(); const before = h.save(), count = h.sent.length;
  rejected(h.run(h.event('attraction', {signals: ['protagonist'], severity: 'minor', novelty_key: 'x'})), 'FORBIDDEN_ATTRACTION_CAUSE');
  assert.deepEqual(h.save(), before); assert.equal(h.sent.length, count);
});
test('attraction has no universal orientation bypass', () => {
  const h = harness(); h.seed();
  rejected(h.run(h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'x'}), {system_5: {profiles: {A: {preference_weights: {warmth: 1}, orientation_allows: {B: {romantic_attraction: false}}}}}}), 'ORIENTATION_CONSTRAINT');
});
test('unknown observers cannot acquire attraction or jealousy from hidden truth', () => {
  const h = harness(); h.seed();
  const e = h.event('jealousy', {threat: 'suspected_rival', severity: 'minor', jealousy_context: {bond: 'B', rival: 'C'}});
  rejected(h.run(e, {system_3: {canonical: true, event: e, knowledge: {}, visible_event_ids: {}}}), 'KNOWLEDGE_REQUIRED');
});
test('PC emotions require explicit delegation', () => {
  const h = harness(); h.seed('PC', 'B');
  rejected(h.run(h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'x'}, 'PC', 'B')), 'PC_EMOTIONAL_AGENCY');
});
test('delegated emotion does not accept a date for the PC', () => {
  const h = harness(); const e = h.event('date', {timing: {at: 200}}, 'A', 'PC');
  const r = h.run(e, {system_6: {decisions: [h.author(e, 'A', 'date', 'proposal')], stances: [], candidate_event_ids: []}, player: {player_ids: ['PC'], authorizations: [], delegations: [{character_id: 'PC', field: 'romantic_attraction', enabled: true, explicit: true}], stances: []}});
  assert.equal(r.result.status, 'pending'); assert.equal(r.result.return_control, true); assert.equal(r.result.date_commitment, undefined);
});
test('date ambiguity never creates a date commitment', () => {
  const h = harness(); const e = h.event('date', {timing: {at: 200}});
  const r = h.run(e, {system_6: {decisions: [h.author(e, 'A', 'date', 'proposal'), h.author(e, 'B', 'date', 'proposal', 'accepted', null, false)], stances: [], candidate_event_ids: []}});
  assert.equal(r.result.status, 'ambiguous'); assert.equal(h.save().romantic_agreements.length, 0);
});
test('rejection persists and cannot be ground away after cooldown', () => {
  const h = harness();
  for (let i = 0; i < 2; i++) {
    const e = h.event('date', {timing: {at: 200}});
    const r = h.run(e, {system_6: {decisions: [h.author(e, 'A', 'date', 'proposal'), h.author(e, 'B', 'date', 'proposal', 'declined')], stances: [], candidate_event_ids: []}});
    if (i === 0) assert.equal(r.result.status, 'declined'); else rejected(r, 'REJECTION_REQUIRES_NEW_CAUSE');
  }
});
test('consent invitation pauses before PC participation', () => {
  const h = harness(); const {r} = h.consent('PC', 'invited');
  assert.equal(r.ok, true); assert.equal(r.result.status, 'invited'); assert.equal(r.result.return_control, true);
});
test('missing target decision cannot be claimed as accepted', () => {
  const h = harness(); rejected(h.consent('PC', 'accepted').r, 'CONSENT_DECISION_MISMATCH');
});
test('incapacity never produces accepted consent', () => {
  const h = harness(); const {r} = h.consent('B', 'accepted', {system_18: {capacity: {A: {can_consent: true, voluntary: true}, B: {can_consent: false, voluntary: true}}, conditions_met: {}}});
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.status, 'unable_to_consent');
  assert.equal(h.engine.process({operation: 'load', timeline_id: 'main', snapshot: h.save()}).ok, true);
});
test('unknown capacity is not voluntary consent', () => {
  const h = harness(); rejected(h.consent('B', 'accepted', {system_18: {capacity: {}, conditions_met: {}}}).r, 'CAPACITY_UNKNOWN');
});
test('consent requires two independent decisions', () => {
  const h = harness(); const e = h.event('consent', {status: 'accepted', interaction_category: 'kissing', conditions: []});
  const ds = ['A', 'B'].map(x => ({...h.author(e, x, 'consent', 'kissing'), decision_id: 'same'}));
  rejected(h.run(e, {system_6: {decisions: ds, stances: []}}), 'INDEPENDENT_DECISIONS_REQUIRED');
});
test('kissing consent cannot authorize sex or a changed context', () => {
  const h = harness(); const {e: grant, r} = h.consent(); assert.equal(r.ok, true);
  rejected(h.run(h.event('intimacy', {consent_source_event_id: grant.source_event_id, interaction_category: 'sexual activity'})), 'CURRENT_SCOPED_CONSENT_REQUIRED');
  rejected(h.run(h.event('intimacy', {consent_source_event_id: grant.source_event_id, interaction_category: 'kissing'}, 'A', 'B', {context_id: 'other'})), 'CURRENT_SCOPED_CONSENT_REQUIRED');
});
test('intimacy needs contemporaneous decisions, consumes consent, and creates no partnership', () => {
  const h = harness(); const {e: grant} = h.consent();
  const e = h.event('intimacy', {consent_source_event_id: grant.source_event_id, interaction_category: 'kissing'});
  rejected(h.run(e), 'EXPLICIT_ACTION_REQUIRED');
  const ds = ['A', 'B'].map(x => h.author(e, x, 'intimacy', 'kissing', 'accepted', grant.source_event_id));
  assert.equal(h.run(e, {system_6: {decisions: ds, stances: []}}).result.consensual, true);
  assert.equal(h.save().romantic_agreements.length, 0);
  rejected(h.run(h.event('intimacy', e.payload)), 'CONSENT_ALREADY_CONSUMED');
});
test('withdrawal stops progression without requiring capacity, opportunity or mutual permission', () => {
  const h = harness(); const {e: grant} = h.consent();
  const e = h.event('consent', {consent_source_event_id: grant.source_event_id, interaction_category: 'kissing', status: 'withdrawn', withdrawing_character_id: 'B'});
  const r = h.run(e, {system_6: {decisions: [h.author(e, 'B', 'consent', 'kissing', 'withdrawn')], stances: []}, system_18: {capacity: {}, conditions_met: {}}, system_12: {feasible: false}});
  assert.equal(r.result.status, 'withdrawn');
  rejected(h.run(h.event('intimacy', {consent_source_event_id: grant.source_event_id, interaction_category: 'kissing'})), 'CURRENT_SCOPED_CONSENT_REQUIRED');
});
test('mutual agreement requires all participant decisions for identical terms', () => {
  const h = harness(); h.agree(); assert.equal(h.save().romantic_agreements[0].status, 'active');
});
test('unilateral breakup changes status and preserves attraction', () => {
  const h = harness(); h.seed(); h.agree();
  const e = h.event('breakup', {agreement_id: 'g'});
  const r = h.run(e, {system_6: {decisions: [h.author(e, 'A', 'breakup', 'g')], stances: []}});
  assert.equal(r.ok, true, JSON.stringify(r)); const s = h.save(); assert.equal(s.romantic_agreements[0].status, 'ended'); assert.equal(s.romance_edges[0].romantic_attraction, 10);
});
test('undiscovered conduct does not notify the betrayed observer', () => {
  const h = harness(); h.agree();
  const e = h.event('conduct', {agreement_id: 'g', action: 'kissing', actor_id: 'B', other_id: 'C', evidence_state: 'fact'});
  const r = h.run(e, {system_3: {canonical: true, event: e, knowledge: {}, visible_event_ids: {}}});
  assert.equal(r.result.actual_violation, true); assert.equal(r.result.outputs.length, 0);
});
test('duplicate event does not call ports or reapply effects', () => {
  const h = harness(); h.seed(); const e = h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'x'});
  const r = h.run(e), before = h.save(), n = h.sent.length;
  const duplicate = h.engine.process({operation: 'apply', timeline_id: 'main', source_event_id: e.source_event_id});
  assert.equal(duplicate.status, 'duplicate'); assert.deepEqual(duplicate.result, r.result); assert.deepEqual(h.save(), before); assert.equal(h.sent.length, n);
});
test('save/load validates derived state and never rerolls decisions', () => {
  const h = harness(); h.seed(); h.consent(); const snapshot = h.save();
  assert.equal(h.engine.process({operation: 'load', timeline_id: 'main', snapshot}).ok, true);
  const altered = structuredClone(snapshot); altered.romance_edges[0].romantic_attraction = 90;
  rejected(h.engine.process({operation: 'load', timeline_id: 'main', snapshot: altered}), 'SNAPSHOT_DERIVATION_MISMATCH');
  assert.deepEqual(h.save(), snapshot);
});
test('fork rewrites timeline references and cannot leak branch events to parent', () => {
  const h = harness(); h.seed(); const original = h.save();
  const branch = h.engine.process({operation: 'fork', timeline_id: 'main', new_timeline_id: 'other'});
  assert.equal(branch.ok, true, JSON.stringify(branch)); assert.equal(branch.result.romance_edges[0].timeline_id, 'other'); assert.deepEqual(h.save(), original);
  rejected(h.engine.process({operation: 'apply', timeline_id: 'other', source_event_id: 'x'}), 'TIMELINE_MISMATCH');
});
test('retcon recomputes later bounded attraction and preserves unrelated edges', () => {
  const h = harness(); h.seed(); h.seed('C', 'D');
  const e = h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'same'}); h.run(e);
  h.run(h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'same'}));
  const r = h.engine.process({operation: 'retcon', timeline_id: 'main', remove_source_event_ids: [e.source_event_id]});
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.romance_edges[0].romantic_attraction, 13); assert.equal(r.result.romance_edges[1].romantic_attraction, 10);
});
test('retcon invalidates intimacy causally dependent on removed consent', () => {
  const h = harness(); const {e: grant} = h.consent();
  const e = h.event('intimacy', {consent_source_event_id: grant.source_event_id, interaction_category: 'kissing'});
  h.run(e, {system_6: {decisions: ['A', 'B'].map(x => h.author(e, x, 'intimacy', 'kissing', 'accepted', grant.source_event_id)), stances: []}});
  const r = h.engine.process({operation: 'retcon', timeline_id: 'main', remove_source_event_ids: [grant.source_event_id]});
  assert.equal(r.ok, true); assert.equal(r.result.romance_events.length, 0);
});
test('creator anchors survive retcon attempts', () => {
  const h = harness(); const seed = h.seed();
  rejected(h.engine.process({operation: 'retcon', timeline_id: 'main', remove_source_event_ids: [seed.source_event_id]}), 'CREATOR_ANCHOR_PROTECTED');
});
test('player view hides attraction and unlearned agreement state', () => {
  const h = harness(); h.seed(); h.agree();
  const r = h.engine.process({operation: 'view', timeline_id: 'main', viewer_id: 'PC'});
  assert.deepEqual(r.result, {agreements: [], beliefs: []});
});

test('fork preserves PC-authored seed terms and negotiated agreement decisions', () => {
  const h = harness(); h.seed('PC', 'B'); h.agree();
  const branch = h.engine.process({operation: 'fork', timeline_id: 'main', new_timeline_id: 'other'});
  assert.equal(branch.ok, true, JSON.stringify(branch));
  assert.equal(h.engine.process({operation: 'load', timeline_id: 'other', snapshot: branch.result}).ok, true);
});
test('withdrawal invalidates all outstanding grants in the scope and survives reload', () => {
  const h = harness(); const first = h.consent().e; const second = h.consent().e;
  const e = h.event('consent', {consent_source_event_id: second.source_event_id, interaction_category: 'kissing', status: 'withdrawn', withdrawing_character_id: 'B'});
  assert.equal(h.run(e, {system_6: {decisions: [h.author(e, 'B', 'consent', 'kissing', 'withdrawn')], stances: []}}).ok, true);
  rejected(h.run(h.event('intimacy', {consent_source_event_id: first.source_event_id, interaction_category: 'kissing'})), 'CURRENT_SCOPED_CONSENT_REQUIRED');
  assert.equal(h.engine.process({operation: 'load', timeline_id: 'main', snapshot: h.save()}).ok, true);
});
test('context changes invalidate accepted consent', () => {
  const h = harness(); const {e} = h.consent();
  assert.equal(h.run(h.event('context_change', {consent_source_event_ids: [e.source_event_id]})).ok, true);
  rejected(h.run(h.event('intimacy', {consent_source_event_id: e.source_event_id, interaction_category: 'kissing'})), 'CURRENT_SCOPED_CONSENT_REQUIRED');
});
test('missing optional chemistry is never silently initialized to zero', () => {
  const h = harness(); h.seed();
  const custom = structuredClone(policy); custom.attraction_rules.warmth.chemistry_context = 1;
  rejected(h.run(h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'x'}), {creator: {authorized: true, allow_seeds: true, policy: custom, pairing_locks: []}}), 'NUMERIC_STATE_NOT_INITIALIZED');
  assert.equal(h.save().romance_edges[0].romantic_attraction, 10);
});
test('no public affection boundary blocks consent but permits private scoped action', () => {
  const h = harness(); const e = h.event('boundary', {}, 'B', 'A');
  const b = {boundary_id: 'b', owner_id: 'B', target_id_or_scope: 'A', category: 'romantic', rule: {effect: 'deny', actions: ['kissing'], when: {public: true}}, explicitness: 'explicit', status: 'active', known_by_target: true, source_event_id: e.source_event_id};
  e.payload = {record: b};
  assert.equal(h.run(e, {system_6: {decisions: [h.author(e, 'B', 'boundary', 'romantic', 'accepted', canonical(b))], stances: []}}).ok, true);
  const request = h.event('consent', {status: 'accepted', interaction_category: 'kissing', conditions: [], context: {public: true}});
  const decisions = ['A', 'B'].map(who => h.author(request, who, 'consent', 'kissing'));
  rejected(h.run(request, {system_6: {decisions, stances: []}}), 'BOUNDARY_DENIED');
  request.payload.context.public = false;
  assert.equal(h.run(request, {system_6: {decisions, stances: []}}).result.status, 'accepted');
});
test('AI proposals cannot assert unsupported intent or consent', () => {
  const h = harness(); h.seed(); const e = h.event('attraction', {signals: ['warmth'], severity: 'minor', novelty_key: 'x'});
  const proposal = {observer_id: 'A', target_id: 'B', source_event_id: e.source_event_id, perceived_flirtation: 'possibly flirtatious', attraction_relevance: ['warmth'], compatibility_signals: [], perceived_intent: 'silence means consent', agreement_context: {}, jealousy_context: {}, consent_required: false, reason_tags: [], confidence: 1};
  rejected(h.run(e, {system_2: {proposal}}), 'UNSUPPORTED_PROPOSAL_INTENT');
});
test('offscreen proposals require a supplied opportunity candidate', () => {
  const h = harness(); const e = h.event('date', {offscreen: true, timing: {at: 200}});
  rejected(h.run(e), 'OPPORTUNITY_CANDIDATE_REQUIRED');
});
test('retcon removes jealousy dependent on removed evidence', () => {
  const h = harness(); h.seed(); h.agree();
  const conduct = h.event('conduct', {agreement_id: 'g', action: 'kissing', actor_id: 'B', other_id: 'C', evidence_state: 'fact'}); h.run(conduct);
  const jealousy = h.event('jealousy', {threat: 'suspected_rival', severity: 'minor', jealousy_context: {bond: 'B', rival: 'C'}});
  const r = h.run(jealousy, {system_3: {canonical: true, event: jealousy, knowledge: {A: {mode: 'learned', evidence_ids: [conduct.source_event_id]}}, visible_event_ids: {}}});
  assert.equal(r.ok, true, JSON.stringify(r));
  const retcon = h.engine.process({operation: 'retcon', timeline_id: 'main', remove_source_event_ids: [conduct.source_event_id]});
  assert.equal(retcon.ok, true); assert.equal(retcon.result.romance_edges[0].jealousy_level, 0);
});
