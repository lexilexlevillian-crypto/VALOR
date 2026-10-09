import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CharacterIdentityDevelopment, DOMAIN, DEFAULTS, State, hash, clone,
  birthIntervalFromAge, ageEligibility, rebuildIdentityProjections,
  submitOwnerRequest, inWorldTimezone,
} from '../src/isolated-identity/index.mjs';

const at = '2012-06-15T12:00:00Z';
const authority = { principal_id: 'mock-player', world_id: 'mock-world', branch_id: 'mock-branch', role: 'player', authorized: true };
const developer = { ...authority, role: 'developer' };
const authorAudience = { viewer: 'mock-player', channel: 'author', audience_entitlement: 'author', selected_export_audience: 'author', authorized: true };
function field(key, value, extra = {}) {
  return { field_key: key, field_state: 'CONFIRMED', value, origin: { kind: 'player_authored' }, effective_interval: { start: at, end: null }, authority: 'mock-player', visibility: 'public', review_disposition: 'accepted', ...extra };
}
function creation(extra = {}) {
  return { target_class: 'PC', scenario: 'mock-scenario-v1', start_time: at, start_placement: { location_ref: 'mock-home' }, control_principal: 'mock-player', selected_templates: [], fields: [field('preferred_name', 'Alex'), field('birth_date_or_interval', { age: 25 })], delegation_scopes: [], baseline_capability_preset: 'grounded-pc-v1', ...extra };
}
function validation(extra = {}) { return { grant_lines: [], dependencies: {}, reviewed_claims: [], reviewed_kinship: [], reviewed_disclosure: {}, biography: [], household_references: [], ...extra }; }
function grant(extra = {}) { return { line_id: 'cash', owner_domain: 'economy', command_type: 'initial_balance', payload: { amount: 50 }, required: true, constraints: [], provenance: [{ kind: 'player_authored', principal: 'mock-player' }], expected_owner_revision: 'mock-owner-v1', compensation_policy: 'owner_defined', fallback: null, ...extra }; }
function harness(dependencies = {}) {
  const system = new CharacterIdentityDevelopment(dependencies);
  let number = 0;
  const request = (operation, payload = {}, extra = {}) => ({ command: { command_id: `cmd-${++number}`, world_id: 'mock-world', branch_id: 'mock-branch', principal_id: 'mock-player', draft_id: 'draft-one', expected_revision: system.creation_draft?.revision ?? 0, operation, manifest_hash: system.creation_manifest?.manifest_hash ?? '', delegation_ref: null, causation_id: 'explicit-user-choice', ...extra }, payload });
  const send = (operation, payload = {}, extra = {}) => system.execute(request(operation, payload, extra));
  return { system, send, request };
}
async function ready(h, data = validation(), initial = creation()) {
  assert.equal((await h.send('create_draft', initial)).status, 'ok');
  const result = await h.send('validate_creation', data);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(h.system.creation_draft.lifecycle_state, 'READY');
}
async function activate(h, data = validation(), initial = creation()) {
  await ready(h, data, initial);
  assert.equal((await h.send('prepare_creation')).status, 'ok');
  const result = await h.send('commit_creation');
  assert.equal(result.status, 'committed', JSON.stringify(result));
  return result;
}
function snapshot(system) { return Object.fromEntries(Object.keys(system).map(key => [key, system[key]])); }

test('module exposes only architecture state and immutable copies', async () => {
  const h = harness(); await h.send('create_draft', creation());
  State.parse(snapshot(h.system));
  const draft = h.system.creation_draft; draft.fields[0].value = 'mutated';
  assert.equal(h.system.creation_draft.fields[0].value, 'Alex');
  assert.equal(h.system.versioned_defaults.max_provisioning_lines, DEFAULTS.max_provisioning_lines);
});
test('blank optional fields remain distinct from scoped negative facts', async () => {
  const blank = field('values', undefined, { field_state: 'UNSPECIFIED', review_disposition: 'omitted' }); delete blank.value;
  const none = field('aliases', undefined, { field_state: 'EXPLICIT_NONE' }); delete none.value;
  const h = harness(); await activate(h, validation(), creation({ fields: [...creation().fields, blank, none] }));
  assert.equal(h.system.identity_fact.some(item => item.field_key === 'values'), false);
  assert.equal(JSON.parse(h.system.identity_fact.find(item => item.field_key === 'aliases').value_json).field_state, 'EXPLICIT_NONE');
});
test('integer ages preserve an interval and do not guess eligibility', () => {
  assert.deepEqual(birthIntervalFromAge(18, at), { start: '1993-06-16', end: '1994-06-15' });
  assert.equal(ageEligibility({ start: '1993-01-01', end: '1995-01-01' }, at, 18), 'needs_choice');
});
test('activation sends one capability grant and no duplicate grants across retries', async () => {
  const requests = [];
  const h = harness({ submitOwnerRequest: request => { requests.push(request); return submitOwnerRequest(request); } });
  await ready(h, validation({ grant_lines: [grant()] })); await h.send('prepare_creation');
  const command = h.request('commit_creation'); const first = await h.system.execute(command);
  for (let i = 0; i < 100; i++) assert.deepEqual(await h.system.execute(command), first);
  assert.equal(requests.length, 2); assert.equal(h.system.domain_receipt.length, 2);
  assert.equal(h.system.durable_recovery_state.outbox_entries.filter(event => event.kind === 'CharacterActivated').length, 1);
});
test('same command ID with changed payload conflicts', async () => {
  const h = harness(); const request = h.request('create_draft', creation()); await h.system.execute(request);
  request.payload.fields[0].value = 'Different';
  assert.equal((await h.system.execute(request)).issues[0].code, 'IDEMPOTENCY_CONFLICT');
});
test('concurrent edits return a stale revision instead of silent overwrite', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const a = h.request('edit_draft', { fields: [field('preferred_name', 'A')] });
  const b = h.request('edit_draft', { fields: [field('preferred_name', 'B')] });
  const results = await Promise.all([h.system.execute(a), h.system.execute(b)]);
  assert.equal(results[0].status, 'ok'); assert.equal(results[1].issues[0].code, 'STALE_REVISION');
  assert.ok(results[1].field_diff); assert.equal(h.system.creation_draft.fields.find(item => item.field_key === 'preferred_name').value, 'A');
});
test('manifest edits invalidate prior hashes', async () => {
  const h = harness(); await ready(h); const old = h.system.creation_manifest.manifest_hash;
  await h.send('edit_draft', { fields: [field('preferred_name', 'New')] });
  assert.equal(h.system.creation_manifest, null);
  assert.equal((await h.send('prepare_creation', {}, { manifest_hash: old })).status, 'rejected');
});
test('before-birth truth is rejected while an impossible claim is preserved', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const subject = h.system.character_core.character_id;
  const biography = [{ event_kind: 'schooling', subject, interval: { start: '1900', end: '1901' }, precision: 'year', location_ref: null, participants: [], factual_payload: {}, source_event: 'authored-school', authority: 'mock-player', disclosure: 'author', certainty: 'confirmed' }];
  assert.equal((await h.send('validate_creation', validation({ biography }))).issues[0].code, 'CHRONOLOGY_CONFLICT');
  const claim = { subject, field_key: 'claimed_degree', asserted_value: 'Graduated in 1901', source: 'authored-claim', effective_interval: { start: '1901', end: null }, certainty: 'false_claim', authority: 'mock-player', disclosure: 'public' };
  assert.equal((await h.send('validate_creation', validation({ reviewed_claims: [claim] }))).status, 'ok');
  await h.send('prepare_creation'); await h.send('commit_creation');
  assert.equal(h.system.identity_claim.length, 1); assert.equal(h.system.biography_entry.length, 0);
});
test('dependency cycles are rejected before reservation or dispatch', async () => {
  let dispatched = 0;
  const h = harness({ submitOwnerRequest: request => { dispatched++; return submitOwnerRequest(request); } });
  await h.send('create_draft', creation());
  const result = await h.send('validate_creation', validation({ grant_lines: [grant()], dependencies: { cash: ['baseline-capabilities'], 'baseline-capabilities': ['cash'] } }));
  assert.equal(result.issues[0].code, 'CHRONOLOGY_CONFLICT'); assert.equal(dispatched, 0);
});
test('biological ancestry cannot cycle', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const id = h.system.character_core.character_id;
  const edge = (a, b) => ({ source_person: a, target_person: b, relationship_type: 'biological_parent', effective_interval: { start: '1980', end: null }, certainty: 'confirmed', evidence: ['authored-family'], visibility: 'author' });
  const result = await h.send('validate_creation', validation({ reviewed_kinship: [edge(id, 'other'), edge('other', id)] }));
  assert.equal(result.issues[0].code, 'CHRONOLOGY_CONFLICT');
});
test('owner outage does not establish unemployment or delete proposals', async () => {
  const h = harness({ validateOwnerRequest: () => ({ available: false }) });
  await h.send('create_draft', creation()); const result = await h.send('validate_creation', validation());
  assert.equal(result.issues[0].code, 'OWNER_UNAVAILABLE'); assert.equal(h.system.creation_draft.lifecycle_state, 'DRAFT');
  assert.equal(h.system.identity_fact.length, 0);
});
test('lost owner response reconciles original receipt without another grant', async () => {
  let externalFixture, submissions = 0;
  const h = harness({
    submitOwnerRequest: request => { submissions++; externalFixture = submitOwnerRequest(request); throw new Error('response lost'); },
    lookupOwnerRequest: request => externalFixture?.command_hash === hash(request) ? { available: true, found: true, receipt: externalFixture } : { available: true, found: false },
  });
  await ready(h); await h.send('prepare_creation');
  assert.equal((await h.send('commit_creation')).status, 'pending'); assert.equal(h.system.creation_draft.lifecycle_state, 'RECOVERY_REQUIRED');
  assert.equal((await h.send('recover_creation')).status, 'committed'); assert.equal(submissions, 1);
});
test('untrusted owner receipt cannot activate', async () => {
  const h = harness({ authenticateOwnerReceipt: () => ({ authenticated: false, revision_valid: false }) });
  await ready(h); await h.send('prepare_creation'); const result = await h.send('commit_creation');
  assert.equal(result.status, 'pending'); assert.equal(h.system.creation_draft.lifecycle_state, 'RECOVERY_REQUIRED');
});
test('required rejection blocks activation and cancel compensates accepted grants', async () => {
  const compensated = [];
  const h = harness({
    submitOwnerRequest: request => ({ ...submitOwnerRequest(request), status: request.owner_domain === 'economy' ? 'rejected' : 'accepted' }),
    compensateOwnerRequest: request => { compensated.push(request); return { available: true, compensated: true, current_revision_valid: true }; },
  });
  await ready(h, validation({ grant_lines: [grant()], dependencies: { cash: ['baseline-capabilities'] } })); await h.send('prepare_creation');
  assert.equal((await h.send('commit_creation')).status, 'pending'); await h.send('cancel_creation');
  assert.equal(h.system.creation_draft.lifecycle_state, 'CANCELLED'); assert.equal(compensated.length, 1);
  assert.equal(h.system.domain_receipt.length, 2); assert.ok(h.system.creation_manifest.idempotency_key);
});
test('unsafe compensation leaves recovery required', async () => {
  const h = harness({
    submitOwnerRequest: request => ({ ...submitOwnerRequest(request), status: request.owner_domain === 'economy' ? 'rejected' : 'accepted' }),
    compensateOwnerRequest: () => ({ available: true, compensated: false, current_revision_valid: false }),
  });
  await ready(h, validation({ grant_lines: [grant()], dependencies: { cash: ['baseline-capabilities'] } })); await h.send('prepare_creation'); await h.send('commit_creation');
  assert.equal((await h.send('cancel_creation')).status, 'pending'); assert.equal(h.system.creation_draft.lifecycle_state, 'RECOVERY_REQUIRED');
});
test('optional rejected grant uses explicit omit fallback', async () => {
  const h = harness({ submitOwnerRequest: request => ({ ...submitOwnerRequest(request), status: request.owner_domain === 'economy' ? 'rejected' : 'accepted' }) });
  await activate(h, validation({ grant_lines: [grant({ required: false, fallback: { kind: 'omit' } })] }));
  assert.equal(h.system.creation_manifest.grant_lines.find(line => line.line_id === 'cash').status, 'rejected');
});
test('snapshots resume accepted samples, identities and grants without reprovisioning', async () => {
  let stored;
  const h = harness({ persistIdentitySnapshot: input => { stored = input; return { saved: true }; } });
  await activate(h);
  const restored = new CharacterIdentityDevelopment({ loadIdentitySnapshot: () => ({ available: true, found: true, ...stored }) });
  assert.equal((await restored.restore()).status, 'restored');
  assert.equal(restored.character_core.character_id, h.system.character_core.character_id);
  assert.deepEqual(restored.domain_receipt, h.system.domain_receipt);
});
test('public projection does not leak hidden scars, author fields, or draft contents', async () => {
  let audience = authorAudience;
  const h = harness({ readAudience: () => audience });
  await activate(h, validation(), creation({ fields: [...creation().fields, field('visible_marks', ['covered tattoo'], { visibility: 'restricted' }), field('values', ['private value'], { visibility: 'author' })] }));
  audience = { ...authorAudience, channel: 'player', audience_entitlement: 'player', selected_export_audience: 'player' };
  const result = await h.send('project');
  assert.equal(result.audience_projection.creation_draft, undefined);
  assert.equal(JSON.stringify(result).includes('covered tattoo'), false);
  assert.equal(JSON.stringify(result).includes('private value'), false);
});
test('forged principal cannot retrieve cached command result or existence', async () => {
  const h = harness(); const request = h.request('create_draft', creation()); await h.system.execute(request);
  request.command.principal_id = 'intruder'; const result = await h.system.execute(request);
  assert.equal(result.revision, null); assert.deepEqual(result.audience_projection, {});
});
test('demographic references are rejected from capability proposals', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const result = await h.send('validate_creation', validation({ grant_lines: [grant({ line_id: 'trait', owner_domain: 'system10', command_type: 'propose_mechanical_trait', payload: { field: 'socioeconomic_self_description' } })] }));
  assert.equal(result.issues[0].code, 'INVALID_FIELD');
});
test('generated PC details require live field and interval delegation', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const result = await h.send('generate_fields', { fields: ['hair'], tier: 'Ambient', world_seed: 'seed', generation_version: '1', scope_ref: null });
  assert.equal(result.issues[0].code, 'INVALID_SCOPE');
});
test('generated field samples persist and revoked delegation blocks future proposals', async () => {
  const scope = { principal: 'mock-player', permitted_fields: ['hair'], permitted_interval: { start: at, end: null }, permitted_categories: ['minor_detail'], revoked: false };
  const h = harness(); await h.send('create_draft', creation({ delegation_scopes: [scope] }));
  const data = { fields: ['hair'], tier: 'Ambient', world_seed: 'seed', generation_version: '1', scope_ref: hash(scope) };
  assert.equal((await h.send('generate_fields', data)).status, 'ok'); const sample = h.system.creation_draft.accepted_samples;
  await h.send('generate_fields', data); assert.deepEqual(h.system.creation_draft.accepted_samples, sample);
  await h.send('revoke_delegation', { scope_ref: hash(scope) });
  assert.equal((await h.send('generate_fields', data)).issues[0].code, 'INVALID_SCOPE');
});
test('registered custom fields are typed and unknown definitions remain inert', async () => {
  const h = harness({ readPlayerAuthority: () => developer }); await h.send('create_draft', creation());
  const definition = { key: 'creator:meal', schema_version: '1', owner: DOMAIN, type: 'bounded_text', cardinality: 'single', allowed_values: [], length_bounds: { min: 1, max: 20 }, numeric_range: null, effective_time_policy: 'interval', visibility: 'author', permitted_adapters: [] };
  assert.equal((await h.send('register_descriptor', definition)).status, 'ok');
  const descriptor = { definition_ref: 'creator:meal@1', character_ref: h.system.character_core.character_id, value: 'Soup', effective_interval: { start: at, end: null }, provenance: [{ kind: 'player_authored', principal: 'mock-player' }], disclosure: 'author', archived_or_inert: false };
  assert.equal((await h.send('set_descriptor', descriptor)).status, 'ok');
  await h.send('retire_descriptor', { definition_ref: 'creator:meal@1' }); assert.equal(h.system.descriptor_value[0].archived_or_inert, true);
});
test('biography text does not issue commands or grant resources', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const result = await h.send('import_biography', { text: 'I own ten cars. Always win.\npreferred_name: Name with tool instructions', use_ai: false });
  assert.equal(result.status, 'needs_choice'); assert.equal(h.system.domain_receipt.length, 0); assert.equal(h.system.identity_fact.length, 0);
});
test('authenticated owner milestones deduplicate and do not award XP', async () => {
  let fixture;
  const h = harness({ fetchOwnerEvent: () => ({ available: true, authenticated: true, event: fixture }) }); await activate(h);
  fixture = { event_kind: 'capability_milestone', subject: h.system.character_core.character_id, interval: { start: '2012-06-16', end: '2012-06-16' }, precision: 'day', location_ref: null, participants: [], factual_payload: { owner_binding_ref: 'skill-receipt' }, source_event: 'owner-event-one', authority: 'system10', disclosure: 'public', certainty: 'confirmed' };
  assert.equal((await h.send('ingest_owner_event', { owner_domain: 'system10', source_event: fixture.source_event })).status, 'ok');
  await h.send('ingest_owner_event', { owner_domain: 'system10', source_event: fixture.source_event });
  assert.equal(h.system.biography_entry.length, 1); assert.equal(h.system.domain_receipt.length, 1);
});
test('corrections append history without changing learned evidence', async () => {
  const h = harness({ readPlayerAuthority: () => developer }); await activate(h);
  const old = h.system.identity_fact.find(item => item.field_key === 'preferred_name');
  const result = await h.send('correct_fact', { fact_id: old.fact_id, field: field('preferred_name', 'Renamed'), reason: 'Authored continuity correction', effective_time: at });
  assert.equal(result.status, 'ok'); assert.equal(h.system.identity_fact.length, 3);
  assert.equal(h.system.identity_fact.at(-1).supersedes_fact_id, old.fact_id);
  assert.ok(h.system.durable_recovery_state.outbox_entries.some(event => event.kind === 'dependency_repair_request'));
});
test('projection rebuild reproduces committed identity and manifest', async () => {
  const h = harness(); await activate(h);
  const rebuilt = rebuildIdentityProjections(snapshot(h.system));
  assert.deepEqual(rebuilt.identity_fact, h.system.identity_fact);
  assert.deepEqual(rebuilt.character_core, h.system.character_core);
  assert.deepEqual(rebuilt.creation_manifest, h.system.creation_manifest);
});
test('privilege keys and foreign state variables cannot be added', async () => {
  const h = harness(); const data = creation(); data.money = 1000;
  assert.equal((await h.send('create_draft', data)).issues[0].code, 'INVALID_FIELD');
  assert.equal(h.system.creation_draft, null);
});

test('preview is a pure projection and consumes no samples or reservations', async () => {
  const h = harness(); await ready(h); const before = snapshot(h.system);
  assert.equal((await h.send('preview')).status, 'ok');
  assert.deepEqual(snapshot(h.system), before);
});
test('public projections are identical when only a private fact changes', async () => {
  let audience = authorAudience;
  const h = harness({ readPlayerAuthority: () => developer, readAudience: () => audience });
  await activate(h, validation(), creation({ fields: [...creation().fields, field('values', ['secret-a'], { visibility: 'author' })] }));
  audience = { ...authorAudience, audience_entitlement: 'player', channel: 'player' };
  const before = await h.send('project');
  const fact = h.system.identity_fact.find(item => item.field_key === 'values');
  audience = authorAudience;
  await h.send('correct_fact', { fact_id: fact.fact_id, field: field('values', ['secret-b'], { visibility: 'author' }), reason: 'Correction', effective_time: at });
  audience = { ...authorAudience, audience_entitlement: 'player', channel: 'player' };
  assert.deepEqual(await h.send('project'), before);
});
test('a known observer can read allowed NPC fields but not private draft details', async () => {
  let auth = developer, audience = authorAudience;
  const h = harness({ readPlayerAuthority: () => auth, readAudience: () => audience });
  await activate(h, validation(), creation({ target_class: 'NPC' }));
  auth = { ...authority, principal_id: 'observer', can_read: true };
  audience = { viewer: 'observer', authorized: true, channel: 'player', audience_entitlement: 'player', selected_export_audience: 'player' };
  const result = await h.send('project', {}, { principal_id: 'observer' });
  assert.equal(result.audience_projection.identity_fact[0].field_key, 'preferred_name');
  assert.equal(result.audience_projection.creation_draft, undefined);
});
test('optional omission cannot fulfill a required dependency', async () => {
  const h = harness({ submitOwnerRequest: request => ({ ...submitOwnerRequest(request), status: request.payload?.name === 'container' ? 'rejected' : 'accepted' }) });
  const container = grant({ line_id: 'container', owner_domain: 'inventory', command_type: 'grant_item', payload: { name: 'container' }, required: false, fallback: { kind: 'omit' } });
  const contents = grant({ line_id: 'contents', owner_domain: 'inventory', command_type: 'grant_item', payload: { parent_line_id: 'container' } });
  await ready(h, validation({ grant_lines: [container, contents], dependencies: { contents: ['container'] } })); await h.send('prepare_creation');
  const result = await h.send('commit_creation');
  assert.equal(result.status, 'pending'); assert.equal(h.system.creation_draft.lifecycle_state, 'RECOVERY_REQUIRED');
  assert.equal(h.system.creation_manifest.grant_lines.find(line => line.line_id === 'contents').status, 'reserved');
});
test('a specific substitute is dispatched only when the original is rejected', async () => {
  const submitted = [];
  const h = harness({ submitOwnerRequest: request => { submitted.push(request.payload); return submitOwnerRequest(request); } });
  const first = grant({ line_id: 'first', payload: { amount: 10 }, fallback: { kind: 'specific_eligible_substitute', line_id: 'second' } });
  const second = grant({ line_id: 'second', payload: { amount: 5 }, required: false, fallback: { kind: 'return_to_choice' } });
  await activate(h, validation({ grant_lines: [first, second] }));
  assert.equal(submitted.some(payload => payload.amount === 5), false);
  assert.equal(h.system.durable_recovery_state.reservations.find(record => record.line_id === 'second').released, true);
});
test('fallback dependency cycles are rejected before any grant', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const a = grant({ line_id: 'a', required: false, fallback: { kind: 'specific_eligible_substitute', line_id: 'b' } });
  const b = grant({ line_id: 'b', required: false, fallback: { kind: 'specific_eligible_substitute', line_id: 'a' } });
  assert.equal((await h.send('validate_creation', validation({ grant_lines: [a, b] }))).issues[0].code, 'CHRONOLOGY_CONFLICT');
});
test('branch snapshots preserve IDs and receipts without issuing owner commands', async () => {
  const stored = new Map(); let submissions = 0;
  const h = harness({ readPlayerAuthority: () => developer, persistIdentitySnapshot: data => { stored.set(data.snapshot.creation_draft.branch_id, data); return { saved: true }; }, submitOwnerRequest: request => { submissions++; return submitOwnerRequest(request); } });
  await activate(h); const count = submissions;
  assert.equal((await h.send('fork_branch', { branch_id: 'alternate' })).status, 'ok');
  assert.equal(submissions, count);
  const fork = new CharacterIdentityDevelopment({ loadIdentitySnapshot: () => ({ found: true, ...stored.get('alternate') }), readPlayerAuthority: () => ({ ...developer, branch_id: 'alternate' }) });
  await fork.restore(); assert.equal(fork.character_core.character_id, h.system.character_core.character_id);
  assert.deepEqual(fork.domain_receipt, h.system.domain_receipt); assert.equal(fork.creation_draft.branch_id, 'alternate');
});
test('new-person card import never copies owner receipts or stable person identity', async () => {
  const old = harness(); await activate(old);
  const card = (await old.send('export_card')).card;
  const fresh = harness(); const result = await fresh.send('import_card', { card, creation: creation() }, { draft_id: 'different-draft' });
  assert.equal(result.status, 'ok'); assert.notEqual(fresh.system.character_core.character_id, old.system.character_core.character_id);
  assert.equal(fresh.system.domain_receipt.length, 0); assert.equal(fresh.system.identity_fact.length, 0);
  assert.equal(fresh.system.creation_draft.lifecycle_state, 'DRAFT');
});
test('card import rejects live grant data', async () => {
  const h = harness(); const result = await h.send('import_card', { card: { schema_version: '2.0', audience: 'author', projection: { domain_receipt: [] } }, creation: creation() });
  assert.equal(result.issues[0].code, 'INVALID_FIELD');
});
test('legacy receipt handoff is explicit, deduplicated and quarantines missing mappings', async () => {
  let calls = 0;
  const h = harness({ readPlayerAuthority: () => developer, mapLegacyReceipt: request => request.source_ref === 'old-good' ? { mapped: true, request: grant({ line_id: 'legacy', owner_domain: 'system10', command_type: 'handoff_legacy_receipt', payload: { source_ref: request.source_ref } }) } : { mapped: false, request: null }, submitOwnerRequest: request => { calls++; return submitOwnerRequest(request); } });
  await activate(h); await h.send('migrate_legacy_receipts', { source_refs: ['old-good', 'old-bad'] });
  await h.send('migrate_legacy_receipts', { source_refs: ['old-good', 'old-bad'] });
  assert.equal(calls, 2);
  assert.equal(h.system.durable_recovery_state.quarantined_inputs.filter(item => item.legacy_source === 'old-bad').length, 1);
});
test('NPC promotion enriches gaps without replacing established identity', async () => {
  const h = harness({ readPlayerAuthority: () => developer }); await activate(h, validation(), creation({ target_class: 'NPC' }));
  const original = h.system.identity_fact.find(fact => fact.field_key === 'preferred_name');
  assert.equal((await h.send('generate_fields', { fields: ['preferred_name', 'hair'], tier: 'Supporting', world_seed: 'stable', generation_version: '1', scope_ref: null })).status, 'ok');
  const proposal = h.system.creation_draft.accepted_proposals.find(item => item.field_key === 'hair');
  assert.equal((await h.send('accept_promotion', { proposal_refs: [hash(proposal)] })).status, 'ok');
  assert.deepEqual(h.system.identity_fact.find(fact => fact.field_key === 'preferred_name'), original);
  assert.equal((await h.send('accept_promotion', { proposal_refs: [hash(proposal)] })).issues[0].code, 'INCOMPATIBLE_EXISTING_PERSON');
});
test('durable NPC development requires actual independent evidence across fourteen days', async () => {
  let fixture;
  const h = harness({ readPlayerAuthority: () => developer, fetchOwnerEvent: () => ({ authenticated: true, event: fixture }) });
  await activate(h, validation(), creation({ target_class: 'NPC' }));
  const subject = h.system.character_core.character_id;
  for (let i = 0; i < 3; i++) {
    const date = ['2012-06-16', '2012-06-23', '2012-07-01'][i];
    fixture = { event_kind: 'significant_event', subject, interval: { start: date, end: date }, precision: 'day', location_ref: null, participants: [], factual_payload: { evidence_kind: 'relevant_behavior' }, source_event: `evidence-${i}`, authority: 'system5', disclosure: 'author', certainty: 'confirmed' };
    await h.send('ingest_owner_event', { owner_domain: 'system5', source_event: fixture.source_event });
  }
  const proposal = { subject, target_owner: 'system5', requested_change: { command_type: 'propose_tendency', tendency: 'prefers routine' }, evidence_event_refs: ['evidence-0', 'evidence-1'], evidence_interval: { start: '2012-06-16', end: '2012-07-01' }, context_refs: [], status: 'proposed', owner_receipt_refs: [] };
  assert.equal((await h.send('propose_development', proposal)).issues[0].code, 'NEEDS_CHOICE');
  proposal.evidence_event_refs.push('evidence-2');
  assert.equal((await h.send('propose_development', proposal)).status, 'accepted');
  assert.equal(h.system.development_proposal[0].status, 'accepted');
});
test('PC traits cannot initialize NPC behavioral control', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const line = grant({ line_id: 'personality', owner_domain: 'system5', command_type: 'initialize_personality', payload: { tendency: 'aggressive' } });
  assert.equal((await h.send('validate_creation', validation({ grant_lines: [line] }))).issues[0].code, 'INVALID_SCOPE');
});
test('a relationship seed cannot target a minor', async () => {
  const h = harness({ resolvePerson: () => ({ exists: true, compatible: true, age_constraint: { min: 16, max: 16 } }) });
  await h.send('create_draft', creation());
  const line = grant({ line_id: 'romance', owner_domain: 'system8', command_type: 'seed_romantic_history', payload: { source_person: h.system.character_core.character_id, target_person: 'minor' } });
  assert.equal((await h.send('validate_creation', validation({ grant_lines: [line] }))).issues[0].code, 'INVALID_SCOPE');
});
test('invalid event kinds are quarantined and owner authority is checked', async () => {
  let fixture;
  const h = harness({ fetchOwnerEvent: () => ({ authenticated: true, event: fixture }) }); await activate(h);
  fixture = { event_kind: 'unknown_kind', subject: h.system.character_core.character_id, interval: { start: '2012-06-16', end: '2012-06-16' }, precision: 'day', location_ref: null, participants: [], factual_payload: {}, source_event: 'unknown-event', authority: 'economy', disclosure: 'author', certainty: 'confirmed' };
  assert.equal((await h.send('ingest_owner_event', { owner_domain: 'economy', source_event: fixture.source_event })).status, 'quarantined');
  fixture = { ...fixture, event_kind: 'capability_milestone', source_event: 'wrong-owner' };
  assert.equal((await h.send('ingest_owner_event', { owner_domain: 'economy', source_event: fixture.source_event })).issues[0].code, 'INVALID_SCOPE');
});
test('simulation time comes from the world boundary, not real inactivity or creation date', async () => {
  const { readWorldConfiguration } = await import('../src/isolated-identity/dependencies.mjs');
  const h = harness({ readWorldConfiguration: () => ({ ...readWorldConfiguration(), simulation_time: '2013-06-15T12:00:00Z' }) });
  await activate(h);
  const event = h.system.durable_recovery_state.outbox_entries.find(item => item.kind === 'CharacterActivated');
  assert.equal(event.envelope.simulation_time, '2013-06-15T12:00:00Z');
  assert.equal((await h.send('project')).audience_projection.age.min, 26);
});
test('malformed timestamps, JSON cycles and invalid enum values fail closed', async () => {
  const h = harness(); const data = creation({ start_time: '2012-02-30' });
  assert.equal((await h.send('create_draft', data)).issues[0].code, 'CHRONOLOGY_CONFLICT');
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal((await h.system.execute(cyclic)).issues[0].code, 'INVALID_FIELD');
  assert.equal((await h.send('create_draft', creation({ fields: [field('preferred_name', 'A', { field_state: 'BOGUS' })] }))).issues[0].code, 'INVALID_FIELD');
});

test('same interrupted commit command resumes despite its original expected revision', async () => {
  let lostReceipt;
  const h = harness({ submitOwnerRequest: request => { lostReceipt = submitOwnerRequest(request); throw new Error('lost'); }, lookupOwnerRequest: request => lostReceipt?.command_hash === hash(request) ? { found: true, receipt: lostReceipt } : { found: false } });
  await ready(h); await h.send('prepare_creation'); const request = h.request('commit_creation');
  assert.equal((await h.system.execute(request)).status, 'pending');
  const altered = clone(request); altered.payload = { malicious: true };
  assert.equal((await h.system.execute(altered)).issues[0].code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await h.system.execute(request)).status, 'committed');
});
test('crash after activation but before result persistence returns the original person on retry', async () => {
  let saved, failFinal = false;
  const h = harness({ persistIdentitySnapshot: data => {
    const results = data.snapshot.durable_recovery_state.prior_command_results;
    if (failFinal && data.snapshot.creation_draft.lifecycle_state === 'ACTIVE' && results.some(item => item.result?.status === 'committed')) throw new Error('crash before response checkpoint');
    saved = clone(data); return { saved: true };
  } });
  await ready(h); await h.send('prepare_creation'); const request = h.request('commit_creation'); failFinal = true;
  assert.equal((await h.system.execute(request)).status, 'pending');
  const restored = new CharacterIdentityDevelopment({ loadIdentitySnapshot: () => ({ found: true, ...saved }), submitOwnerRequest: () => { throw new Error('No grants should be replayed'); } });
  await restored.restore(); const result = await restored.execute(request);
  assert.equal(result.status, 'committed'); assert.equal(restored.domain_receipt.length, 1);
  assert.equal(restored.character_core.character_id, h.system.character_core.character_id);
});
test('read-only projections and errors cannot change domain revisions', async () => {
  const h = harness(); await activate(h); const before = snapshot(h.system);
  await h.send('project'); await h.send('export_card');
  assert.deepEqual(snapshot(h.system), before);
});

test('world timezone determines birthdays at UTC date boundaries', async () => {
  const { readWorldConfiguration } = await import('../src/isolated-identity/dependencies.mjs');
  const instant = '2012-06-15T01:00:00Z';
  assert.equal(inWorldTimezone(instant, 'America/Los_Angeles').slice(0, 10), '2012-06-14');
  const h = harness({ readWorldConfiguration: () => ({ ...readWorldConfiguration(), simulation_time: instant, timezone: 'America/Los_Angeles' }) });
  const effective = { effective_interval: { start: instant, end: null } };
  await activate(h, validation(), creation({ start_time: instant, fields: [field('preferred_name', 'Alex', effective), field('birth_date_or_interval', { age: 18 }, effective)] }));
  const birth = h.system.creation_draft.fields.find(item => item.field_key === 'birth_date_or_interval').value;
  assert.deepEqual(birth, { start: '1993-06-15', end: '1994-06-14' });
  assert.deepEqual((await h.send('project')).audience_projection.age, { min: 18, max: 18 });
});
test('runtime name changes retain dated names and do not masquerade as corrections', async () => {
  const h = harness(); await activate(h); const old = h.system.identity_fact[0];
  assert.equal((await h.send('author_identity_change', field('preferred_name', 'Sam'))).status, 'ok');
  assert.deepEqual(h.system.identity_fact[0], old);
  assert.equal(h.system.durable_recovery_state.outbox_entries.some(event => event.kind === 'FactCorrected'), false);
  assert.equal((await h.send('author_identity_change', field('hair', 'black'))).issues[0].code, 'INVALID_SCOPE');
});
test('runtime claims do not establish authoritative facts', async () => {
  const h = harness(); await activate(h); const count = h.system.identity_fact.length;
  const claim = { subject: h.system.character_core.character_id, field_key: 'degree', asserted_value: 'claimed diploma', source: 'player-statement', effective_interval: { start: at, end: null }, certainty: 'unverified', authority: 'mock-player', disclosure: 'restricted' };
  await h.send('record_claim', claim); await h.send('record_claim', claim);
  assert.equal(h.system.identity_claim.length, 1); assert.equal(h.system.identity_fact.length, count);
});
test('unknown descriptor fields are inert but cannot contain executable or recursive objects', async () => {
  const h = harness(); await h.send('create_draft', creation());
  const descriptor = { definition_ref: 'creator:unknown@1', character_ref: h.system.character_core.character_id, value: { nested: { arbitrary: true } }, effective_interval: { start: at, end: null }, provenance: [{ kind: 'player_authored', principal: 'mock-player' }], disclosure: 'author', archived_or_inert: false };
  assert.equal((await h.send('set_descriptor', descriptor)).status, 'rejected');
  descriptor.value = 'inert text'; assert.equal((await h.send('set_descriptor', descriptor)).status, 'ok');
  assert.equal(h.system.descriptor_value[0].archived_or_inert, true);
});
test('hook triggering is event-driven, deduplicated, and closes only on an owner resolution', async () => {
  let fixture, evaluated = 0, submissions = 0;
  const h = harness({
    fetchOwnerEvent: () => ({ authenticated: true, event: fixture }),
    evaluateHookPredicates: () => { evaluated++; return { satisfied: true, knowledge_valid: true, opportunity_valid: true, resolved: true, evaluated_predicates: [{ predicate: 'due_date', result: true }], request: grant({ line_id: 'resolved-hook', command_type: 'historical_settlement', payload: { record_ref: 'underlying-debt' } }) }; },
    submitOwnerRequest: request => { submissions++; return submitOwnerRequest(request); },
  });
  await activate(h, validation({ grant_lines: [grant({ command_type: 'create_debt' })] }));
  const ownerRef = h.system.domain_receipt.find(receipt => receipt.owner_domain === 'economy').canonical_event_refs[0];
  const hook = { owner: 'economy', underlying_record_refs: [ownerRef], onset: at, severity_description: 'A defined obligation', known_parties: [h.system.character_core.character_id], activation_predicates: [{ kind: 'due_date' }], observation_policy: 'author', allowed_response_windows: [{ start: at, end: null }], resolution_receipts: [], active_interval: { start: at, end: null }, activation_source_refs: [] };
  const registered = await h.send('register_hook', hook); assert.equal(registered.status, 'ok');
  fixture = { source_event: 'due-event', interval: { start: '2012-06-16', end: '2012-06-16' } };
  assert.equal((await h.send('evaluate_hook', { hook_ref: registered.hook_ref, source_event: 'due-event' })).status, 'accepted');
  await h.send('evaluate_hook', { hook_ref: registered.hook_ref, source_event: 'due-event' });
  assert.equal(evaluated, 1); assert.equal(submissions, 3);
  assert.equal(h.system.starting_hook[0].active_interval.end, '2012-06-16');
});
test('dormant hook decisions preserve evaluated blockers in developer traces', async () => {
  const h = harness({ fetchOwnerEvent: () => ({ authenticated: true, event: { source_event: 'event' } }), evaluateHookPredicates: () => ({ satisfied: false, knowledge_valid: false, opportunity_valid: true, evaluated_predicates: [{ predicate: 'known_address', result: false }] }) });
  await activate(h, validation({ grant_lines: [grant()] }));
  const ownerRef = h.system.domain_receipt.find(receipt => receipt.owner_domain === 'economy').canonical_event_refs[0];
  const hook = { owner: 'economy', underlying_record_refs: [ownerRef], onset: at, severity_description: 'Obligation', known_parties: [], activation_predicates: [], observation_policy: 'author', allowed_response_windows: [{ start: at, end: null }], resolution_receipts: [], active_interval: { start: at, end: null }, activation_source_refs: [] };
  const { hook_ref } = await h.send('register_hook', hook);
  assert.equal((await h.send('evaluate_hook', { hook_ref, source_event: 'event' })).status, 'dormant');
  assert.ok(h.system.decision_trace.at(-1).evaluated_predicates.some(predicate => predicate.predicate === 'known_address' && predicate.result === false));
});
test('hook owner cannot reuse a different domain receipt', async () => {
  const h = harness(); await activate(h);
  const hook = { owner: 'economy', underlying_record_refs: [h.system.domain_receipt[0].canonical_event_refs[0]], onset: at, severity_description: 'fake debt', known_parties: [], activation_predicates: [], observation_policy: 'author', allowed_response_windows: [], resolution_receipts: [], active_interval: { start: at, end: null }, activation_source_refs: [] };
  assert.equal((await h.send('register_hook', hook)).issues[0].code, 'INVALID_SCOPE');
});
test('expired reservations are reconciled and renewed with unchanged grant keys', async () => {
  let valid = true;
  const h = harness({ checkReservation: () => ({ valid }), reserveOwnerRequest: request => ({ valid: true, reservation_ref: 'reservation', expected_owner_revision: request.expected_owner_revision }) });
  await ready(h); await h.send('prepare_creation'); const key = h.system.creation_manifest.grant_lines[0].idempotency_key;
  valid = false; assert.equal((await h.send('commit_creation')).status, 'pending');
  valid = true; assert.equal((await h.send('prepare_creation')).status, 'ok');
  assert.equal((await h.send('commit_creation')).status, 'committed');
  assert.equal(h.system.creation_manifest.grant_lines[0].idempotency_key, key);
});
