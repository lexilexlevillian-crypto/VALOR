import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HealthSystem, HealthState } from './health.mjs';

const T0 = '2026-10-11T12:00:00.000Z';
const T1 = '2026-10-11T12:00:01.000Z';
const T2 = '2026-10-11T12:00:02.000Z';
const committed = data => ({ fixture_outcome: 'committed', data });
const projection = { consciousness: 'alert', breathing_concern: 'none', circulation_concern: 'none',
  mobility: {}, hand_use: {}, pain_burden: 'absent', stamina: null, fatigue: null,
  exertion_tolerance: null, immediate_danger: null, source_effect_refs: [] };
const baseline = { anatomy_ref: 'fixture-anatomy', baseline_function_ref: projection, usual_stamina: null,
  established_condition_refs: [], allergy_sensitivity_history: null, prescribed_support_refs: [],
  injury_history_refs: [], long_term_transition_event_refs: [] };
const effect = magnitude => ({ channel: 'pain', action_class: '*', value_ref: { magnitude,
  restriction: null, reason: 'Limited function.', alternatives: [] }, composition_group: 'pain', duration_ms: null });
const truth = { cause_event_ref: '$cause', mechanism: 'fall', severity: 'moderate', exposure_context_ref: 'fixture-context',
  resolved_extent_ref: 'fixture-extent', current_flags: [], treatment_refs: [], visibility_policy_ref: 'private',
  resolution_state: 'active', recovery_phase: 'initial', milestone_refs: [], monitoring_refs: [], complication_refs: [], lasting_effect_refs: [] };
const transition = { from: 'active', to: 'recovered', when: true, after_ms: null, end_effects: 'all', effects: [],
  truth_patch: { resolution_state: 'resolved' }, payload_patches: [], terminal_eligible: false, stop: true, uncertainty_ref: 'none' };
function fixture() {
  const template = { kind: 'injury', initial_state: 'active', truth, payloads: [], effects: [effect(2)],
    boundary_after_ms: 2000, mechanism: 'fall', when: true, uncertainty_ref: 'none', era_refs: [] };
  const rules = { templates: { injury: template, second: { ...structuredClone(template), effects: [effect(3)] } },
    objectives: { relief: { duration_ms: 1000, target_kinds: ['injury'], external_steps: [], outcomes: {
      success: { to: null, after_ms: 1000, end_effects: ['pain'], effects: [], truth_patch: {}, payload_patches: [] }
    } } }, methods: {}, actions: { speak: { requirements: ['speech'], conscious: true, action_class: 'speech', when: true,
      reason: 'Unavailable.', alternatives: [], uncertainty_ref: 'none' },
    sprint: { requirements: ['weight-bearing'], conscious: true, action_class: 'sprint', when: true,
      reason: 'Unavailable.', alternatives: [], uncertainty_ref: 'difficult' } },
    transitions: { injury: [transition] }, era_refs: ['relief'],
    encounter_statuses: {}, care_statuses: { offered: 'offered', accept: 'accepted', decline: 'declined', ask: 'question', defer: 'deferred', completed: 'completed' },
    ordering: { version: 'ordering-v1', kind_priority: { injury: 0 }, care_before_boundary: true },
    terminal_projection: { ...projection, consciousness: 'unresponsive' }, terminal_states: ['dying'],
    death_state_by_kind: { injury: 'dead' }, resolved_states: ['recovered'], allowed_mechanisms: ['fall'] };
  const snapshot = {
    CampaignConfiguration: { campaign: { detailed_needs_enabled: false, communicable_disease_enabled: false,
      withdrawal_enabled: false, finality_policy: 'permanent death', default_grounded_finality: 'permanent death',
      content_settings_ref: {}, care_authority_policy_ref: {}, privacy_policy_ref: {}, era_manifest_ref: 'fixture-2012',
      enabled_template_refs: ['injury', 'second'], numeric_manifest_version: 'v1', event_ordering_policy_version: 'ordering-v1', migration_policy_ref: {} } },
    ModelConfiguration: { v1: { transition_windows: {}, deterministic_prerequisites_ref: rules,
      uncertain_milestone_refs: [], stop_conditions_ref: {}, composition_rules: { pain: { kind: 'strongest-effect', minimum: 0,
        maximum: 5, field: 'pain_burden', bands: [{ minimum: 0, value: 'absent' }, { minimum: 2, value: 'distracting' }, { minimum: 3, value: 'severe' }] } },
      numeric_units: 'fictional; milliseconds', numeric_bounds: {}, tuning_purpose: 'TEST FIXTURE ONLY, not medical tuning', affected_template_refs: ['injury', 'second'] } }
  };
  const fixtures = {
    consent: { validate_command: committed({ authorized: true }), care_authority: committed({ authorized: true, scope: 'administration', kind: 'choice' }) },
    time: { canonical_context: committed({ canonical_time: T0, paused: false, ordering_version: 'ordering-v1' }),
      validate_boundary: committed({ valid: true, earlier_care_settled: true, equal_time_care_settled: true }),
      terminal_barrier: committed({ concurrent_care_settled: true, timely_interventions_included: true }) },
    character: { health_baseline: committed({ character_id: 'patient', baseline_version: 'v1', baseline, function_projection: projection }),
      validate_anatomy: committed({ plausible: true }) },
    hazard: { resolved_cause: committed({ supported: true, incident_id: 'incident', target: 'patient', mechanism: 'fall', region_ref: 'wrist',
      occurred_at: T0, allowed_template_refs: ['injury', 'second'] }) },
    campaign: { validate_era: committed({ supported: true, year: 2012 }), finality_validation: committed({ allowed: true }) },
    evidence: { query_access: committed({ allowed: true, policy_version: 'privacy-v1', fields: [], record_ids: [] }) },
    knowledge: { visible_health: committed({ supported_acquisition: true, function_fields: ['pain_burden'], statements: [] }) },
    location: { encounter_arrival: committed({ arrived: true, encounter: { id: 'encounter', facility_id: 'clinic', patient_ref: 'patient',
      identity_confidence: 'uncertain', started_at: T0, status: 'intake', responsible_role_ref: 'provider' } }),
      care_presence: committed({ requirements_satisfied: true }), body_continuity: committed({ present: true, possessions_preserved: true }) },
    work: { offer_care: committed({ provider_available: true, qualified: true }),
      complete_care: committed({ completed: true, actor_id: 'provider', actual_duration_ms: 1000 }) },
    objects: { care_resources: committed({ committed: true }) },
    resolution: { committed_care_result: committed({ outcome: 'success' }) }
  };
  return { snapshot, fixtures, rules, engine: () => new HealthSystem(snapshot, fixtures) };
}
function command(name, key, payload, revision = 0, at = T0, actor = 'patient') {
  return { command: name, actor_ref: actor, target: 'patient', canonical_time: at, expected_revision: revision,
    correlation_id: 'correlation', idempotency_key: key, authority_ref: 'authority', cause_ref: 'cause', rules_version: 'v1', payload };
}
const injury = (refs = ['injury']) => command('CreateInjury', 'injury', { incident_id: 'incident', mechanism: 'fall', region_ref: 'wrist', context_ref: 'context', template_refs: refs });

test('state rejects extra fields and preserves explicit unknowns', () => {
  assert.throws(() => new HealthState({ inventedHealthBar: {} }));
  const f = fixture(); assert.equal(new HealthState(f.snapshot).CampaignConfiguration.campaign.withdrawal_enabled, false);
});
test('injury replay is idempotent; same incident cannot create additional wounds', async () => {
  const f = fixture(), engine = f.engine(), c = injury();
  const first = await engine.step(c); assert.equal(first.status, 'committed');
  assert.deepEqual(await engine.step(c), first);
  assert.equal(Object.keys(engine.snapshot().episode).length, 1);
  assert.equal((await engine.step({ ...c, idempotency_key: 'retry', expected_revision: 1 })).code, 'duplicate_source');
  assert.equal((await engine.step({ ...c, payload: { ...c.payload, region_ref: 'other' } })).code, 'idempotency_conflict');
});
test('same-group pain uses maximum; public summaries omit hidden source references', async () => {
  const f = fixture(), engine = f.engine();
  assert.equal((await engine.step(injury(['injury', 'second']))).status, 'committed');
  assert.equal(engine.snapshot().health_record.patient.function_projection.pain_burden, 'severe');
  const view = await engine.step(command('GetKnownHealth', 'view', {}, 1));
  assert.deepEqual(view.function, { pain_burden: 'severe' });
  assert.equal(JSON.stringify(view).includes('truth_ref'), false);
});
test('missing external facts persist pending work without creating an injury', async () => {
  const f = fixture(); f.fixtures.hazard.resolved_cause = { fixture_outcome: 'pending', data: {} };
  const engine = f.engine(); assert.equal((await engine.step(injury())).status, 'pending');
  assert.equal(Object.keys(engine.snapshot().episode).length, 0);
  assert.equal(Object.keys(engine.snapshot().health_record).length, 0);
  assert.equal(Object.keys(engine.snapshot().PendingWorkflowPayload).length, 1);
  f.fixtures.hazard.resolved_cause = committed({ supported: true, incident_id: 'incident', target: 'patient', mechanism: 'fall', region_ref: 'wrist', occurred_at: T0, allowed_template_refs: ['injury'] });
  assert.equal((await engine.step(injury())).status, 'committed');
});
test('uncertainty is stored, not rerolled after save/load', async () => {
  const f = fixture(); f.rules.templates.injury.uncertainty_ref = 'extent';
  f.rules.templates.injury.outcomes = { selected: { effects: [effect(3)] } };
  f.snapshot.ModelConfiguration.v1.uncertain_milestone_refs = ['extent'];
  f.fixtures.resolution.resolve = committed({ outcome: 'selected' });
  const engine = f.engine(), c = injury(), result = await engine.step(c);
  assert.equal(result.status, 'committed'); assert.equal(Object.keys(engine.snapshot().StoredResolution).length, 1);
  const directory = await mkdtemp(join(tmpdir(), 'valor-health-test-'));
  try {
    await engine.save(join(directory, 'state.json'));
    f.fixtures.resolution.resolve = { fixture_outcome: 'failed', data: {} };
    const loaded = await HealthSystem.load(join(directory, 'state.json'), f.fixtures);
    assert.deepEqual(await loaded.step(c), result);
  } finally { await rm(directory, { recursive: true }); }
});
test('capability restriction blocks action before any resolution dependency', async () => {
  const f = fixture(); f.rules.templates.injury.effects[0].value_ref.restriction = 'weight-bearing';
  const engine = f.engine(); await engine.step(injury());
  const result = await engine.step(command('EvaluateAction', 'sprint', { action_ref: 'sprint' }, 1));
  assert.equal(result.feasible, false); assert.equal(result.status, 'ok');
  assert.equal((await engine.step(command('EvaluateAction', 'speak', { action_ref: 'speak' }, 1))).feasible, true);
});
test('due boundaries block stale queries and process stored state exactly once', async () => {
  const f = fixture(), engine = f.engine(), first = await engine.step(injury());
  f.fixtures.time.canonical_context.data.canonical_time = T2;
  assert.equal((await engine.step(command('GetKnownHealth', 'stale', {}, 1, T2))).code, 'catch_up_required');
  const advance = command('AdvanceEpisode', 'advance', { episode_id: first.episode_ids[0], boundary_time: T2, scheduler_token: 'token' }, 1, T2);
  assert.equal((await engine.step(advance)).status, 'committed');
  assert.equal(engine.snapshot().health_record.patient.function_projection.pain_burden, 'absent');
  assert.equal(engine.snapshot().episode[first.episode_ids[0]].state, 'recovered');
  assert.equal(engine.snapshot().Baseline.patient.injury_history_refs.length, 1);
});
test('late boundary processing records distinct occurrence and processing times', async () => {
  const f = fixture(), engine = f.engine(), first = await engine.step(injury());
  f.fixtures.time.canonical_context.data.canonical_time = '2026-10-11T12:00:10.000Z';
  const result = await engine.step(command('AdvanceEpisode', 'late', { episode_id: first.episode_ids[0], boundary_time: T2, scheduler_token: 'token' }, 1, T2));
  assert.equal(result.status, 'committed');
  const event = engine.snapshot().health_event[result.event_id];
  assert.equal(event.occurred_at, T2); assert.equal(event.processed_at, '2026-10-11T12:00:10.000Z');
});
test('revoked privacy permission cannot replay a previously authorized query', async () => {
  const f = fixture(), engine = f.engine(); await engine.step(injury());
  const c = command('GetKnownHealth', 'private', {}, 1);
  assert.equal((await engine.step(c)).status, 'ok');
  f.fixtures.evidence.query_access.data.allowed = false;
  assert.equal((await engine.step(c)).code, 'missing_access');
});
test('care preserves injury; failed billing cannot undo completed symptom relief', async () => {
  const f = fixture(), engine = f.engine(); const first = await engine.step(injury());
  const offer = await engine.step(command('OfferCare', 'offer', { encounter_id: 'encounter', objective_ref: 'relief',
    resource_refs: [], information_offered_ref: 'info', source_assessment_id: 'unused' }, 1, T0, 'provider'));
  assert.equal(offer.status, 'committed');
  const accept = await engine.step(command('RespondToCare', 'accept', { offer_ref: offer.care_action_id, response: 'accept',
    conditions_ref: null, scope_ref: offer.care_action_id, information_offered_ref: 'info' }, 2));
  assert.equal(accept.status, 'committed');
  f.fixtures.consent.care_authority.data.scope = `care:${offer.care_action_id}`;
  f.fixtures.time.canonical_context.data.canonical_time = T1;
  const completed = await engine.step(command('CompleteCare', 'complete', { care_action_id: offer.care_action_id,
    episode_ids: first.episode_ids, resolved_result_ref: 'result' }, 3, T1, 'provider'));
  assert.equal(completed.status, 'committed'); assert.equal(completed.billing_status, 'pending');
  const state = engine.snapshot();
  assert.equal(state.episode[first.episode_ids[0]].state, 'active');
  assert.equal(state.health_record.patient.function_projection.pain_burden, 'absent');
  assert.equal(Object.keys(state.PendingWorkflowPayload).length, 1);
});
test('death is terminal, idempotent, and retains body, baseline, and history', async () => {
  const f = fixture(); f.rules.transitions.injury[0] = { ...transition, to: 'dying', terminal_eligible: true };
  const engine = f.engine(), first = await engine.step(injury());
  f.fixtures.time.canonical_context.data.canonical_time = T2;
  const advanced = await engine.step(command('AdvanceEpisode', 'dying', { episode_id: first.episode_ids[0], boundary_time: T2, scheduler_token: 'token' }, 1, T2));
  assert.equal(advanced.status, 'committed');
  const c = command('CommitDeath', 'death', { cause_chain_refs: first.episode_ids, policy_ref: 'permanent death',
    body_entity_ref: 'body', campaign_lineage_ref: 'lineage' }, 2, T2);
  const dead = await engine.step(c); assert.equal(dead.status, 'committed');
  assert.deepEqual(await engine.step(c), dead);
  assert.equal(engine.snapshot().TerminalPayload[dead.event_id].body_entity_ref, 'body');
  assert.equal(Object.keys(engine.snapshot().health_record).length, 1);
  assert.equal((await engine.step({ ...injury(), idempotency_key: 'after-death', expected_revision: 3, canonical_time: T2 })).code, 'incompatible_state');
});
test('exposure requires consumption, retries use one event, and failed consumption changes no physiology', async () => {
  const f = fixture();
  f.snapshot.SubstanceProfile = { substance: { era_metadata_ref: 'fictional-fixture', effect_categories: ['pain'],
    onset_model_ref: {}, duration_decay_model_ref: { interactions: [] }, interaction_groups: [],
    dependence_potential: null, content_visibility_policy_ref: 'private' } };
  Object.assign(f.rules.templates.injury, { exposure_profile: 'substance', abstract_bands: ['fictional-unit'], routes: ['authored-route'], region_ref: 'body',
    exposure_payload: { source_ref: 'drink', actor_ref: '$target', exposure_context: 'recreational', intent_visibility: 'private',
      plan_ref: null, administration_units: 'fictional-token', consumption_commit_ref: null, cumulative_exposure: 1,
      active_timing_ref: { starts_at: T0, ends_at: T2 }, supported_modifier_refs: [], applied_interaction_refs: [] } });
  f.fixtures.objects.validate_administration = committed({ available: true, source_item_id: 'drink', profile_version: 'substance', plan_matches: true });
  f.fixtures.objects.consume = { fixture_outcome: 'failed', data: {} };
  const engine = f.engine(), c = command('RecordExposure', 'consume', { source_item_id: 'drink', profile_version: 'substance', abstract_band: 'fictional-unit',
    route_kind: 'authored-route', plan_ref: null, source_event_ref: 'cause', template_ref: 'injury' });
  assert.equal((await engine.step(c)).status, 'pending');
  assert.equal(Object.keys(engine.snapshot().exposure).length, 0);
  assert.equal(Object.keys(engine.snapshot().episode).length, 0);
  f.fixtures.objects.consume = committed({ consumed: true, source_item_id: 'drink', commit_ref: 'DUMMY-consumption' });
  const result = await engine.step(c); assert.equal(result.status, 'committed');
  assert.deepEqual(await engine.step(c), result);
  assert.equal(Object.keys(engine.snapshot().exposure).length, 1);
  assert.equal(engine.snapshot().ExposurePayload[result.exposure_id].consumption_commit_ref.mock, true);
});
test('bleeding integration uses the pre-care rate only until care changes the source', async () => {
  const f = fixture();
  f.rules.templates.injury.payloads = [{ type: 'BleedingSource', name: 'source', value: { episode_id: '$episode', state: 'active',
    cumulative_loss: 0, progression_model_ref: { unit: 'fictional burden per millisecond', rates: { active: 0.001, controlled: 0 }, maximum: 100 }, internal_loss: false } }];
  f.rules.objectives.relief.outcomes.success.payload_patches = [{ type: 'BleedingSource', name: 'source', values: { state: 'controlled' } }];
  const engine = f.engine(), injuryResult = await engine.step(injury());
  const offer = await engine.step(command('OfferCare', 'offer-bleed', { encounter_id: 'encounter', objective_ref: 'relief', resource_refs: [],
    information_offered_ref: 'info', source_assessment_id: 'unused' }, 1, T0, 'provider'));
  await engine.step(command('RespondToCare', 'accept-bleed', { offer_ref: offer.care_action_id, response: 'accept', conditions_ref: null,
    scope_ref: offer.care_action_id, information_offered_ref: 'info' }, 2));
  f.fixtures.consent.care_authority.data.scope = `care:${offer.care_action_id}`;
  f.fixtures.time.canonical_context.data.canonical_time = T1;
  const complete = await engine.step(command('CompleteCare', 'complete-bleed', { care_action_id: offer.care_action_id,
    episode_ids: injuryResult.episode_ids, resolved_result_ref: 'result' }, 3, T1, 'provider'));
  assert.equal(complete.status, 'committed');
  assert.equal(Object.values(engine.snapshot().BleedingSource)[0].cumulative_loss, 1);
  f.fixtures.time.canonical_context.data.canonical_time = T2;
  const next = await engine.step(command('AdvanceEpisode', 'advance-bleed', { episode_id: injuryResult.episode_ids[0], boundary_time: T2, scheduler_token: 'token' }, 4, T2));
  assert.equal(next.status, 'committed');
  assert.equal(Object.values(engine.snapshot().BleedingSource)[0].cumulative_loss, 1);
});
test('a rejected capability query does not disclose hidden truth through fixture content', async () => {
  const f = fixture(), engine = f.engine(); await engine.step(injury());
  f.fixtures.knowledge.visible_health.data.statements = [{ truth_ref: 'secret' }];
  const result = await engine.step(command('GetKnownHealth', 'bad-view', {}, 1));
  assert.equal(result.code, 'missing_access');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('concurrent duplicate commands commit exactly once', async () => {
  const f = fixture(), engine = f.engine();
  const results = await Promise.all(Array.from({ length: 5 }, () => engine.step(injury())));
  results.forEach(result => assert.deepEqual(result, results[0]));
  assert.equal(Object.keys(engine.snapshot().episode).length, 1);
  assert.equal(Object.values(engine.snapshot().health_event).filter(e => e.payload_ref.mutation).length, 1);
});
test('assessments and amendments preserve hidden extent and original clinical entries', async () => {
  const f = fixture();
  f.rules.methods.exam = { duration_ms: 1000, requirements: [], uncertainty_ref: 'none', entry_type: 'working diagnosis', confidence: 'provisional' };
  f.fixtures.location.patient_access = committed({ present: true, accessible: true, attention_supported: true });
  f.fixtures.work.assessment_task = committed({ completed: true, provider_qualified: true, tools_available: true, actual_duration_ms: 1000 });
  f.fixtures.knowledge.assessment_evidence = committed({ supported: true, content_refs: ['observed limited movement'] });
  f.fixtures.consent.care_authority.data.scope = 'assessment:exam';
  const engine = f.engine(), injuryResult = await engine.step(injury());
  const initialTruth = structuredClone(Object.values(engine.snapshot().EpisodeModelPayload)[0]);
  f.fixtures.time.canonical_context.data.canonical_time = T1;
  const assessed = await engine.step(command('RequestAssessment', 'exam', { encounter_id: 'encounter', method_ref: 'exam',
    question_ref: 'injury extent', circumstances_ref: 'initial assessment', started_at: T0 }, 1, T1, 'provider'));
  assert.equal(assessed.status, 'committed');
  const originalRecord = structuredClone(engine.snapshot().ClinicalRecordPayload[assessed.assessment_id]);
  f.fixtures.knowledge.amendment_evidence = committed({ supported: true, authorized: true, occurred_at: T0,
    content_refs: ['correction with supported uncertainty'], entry_type: 'working diagnosis', confidence: 'uncertain' });
  const amendment = await engine.step(command('AmendAssessment', 'amend', { prior_entry_id: assessed.assessment_id,
    evidence_ref: 'new evidence', replacement_ref: 'replacement' }, 2, T1, 'provider'));
  assert.equal(amendment.status, 'committed');
  assert.deepEqual(engine.snapshot().ClinicalRecordPayload[assessed.assessment_id], originalRecord);
  assert.deepEqual(engine.snapshot().EpisodeModelPayload[injuryResult.episode_ids[0]], initialTruth);
  assert.equal(engine.snapshot().assessment[amendment.assessment_id].supersedes_id, assessed.assessment_id);
});
test('declined care cannot complete even when external resource fixtures succeed', async () => {
  const f = fixture(), engine = f.engine(), first = await engine.step(injury());
  const offer = await engine.step(command('OfferCare', 'offer-declined', { encounter_id: 'encounter', objective_ref: 'relief', resource_refs: [],
    information_offered_ref: 'info', source_assessment_id: 'unused' }, 1, T0, 'provider'));
  const decline = await engine.step(command('RespondToCare', 'decline', { offer_ref: offer.care_action_id, response: 'decline',
    conditions_ref: null, scope_ref: offer.care_action_id, information_offered_ref: 'info' }, 2));
  assert.equal(decline.status, 'committed');
  f.fixtures.time.canonical_context.data.canonical_time = T1;
  const result = await engine.step(command('CompleteCare', 'refused-completion', { care_action_id: offer.care_action_id,
    episode_ids: first.episode_ids, resolved_result_ref: 'result' }, 3, T1, 'provider'));
  assert.equal(result.code, 'missing_access');
  assert.equal(engine.snapshot().care_action[offer.care_action_id].outcome_event_id, null);
});
