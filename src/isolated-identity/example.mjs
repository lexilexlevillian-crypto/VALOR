/** Run with: node src/isolated-identity/example.mjs */
import { CharacterIdentityDevelopment } from './index.mjs';

const identity = new CharacterIdentityDevelopment();
const start = '2012-06-15T12:00:00Z';
let sequence = 0;

async function command(operation, payload = {}) {
  const response = await identity.execute({
    command: {
      command_id: `example-${++sequence}`,
      world_id: 'mock-world', branch_id: 'mock-branch', principal_id: 'mock-player',
      draft_id: 'example-draft', expected_revision: identity.creation_draft?.revision ?? 0,
      operation, manifest_hash: identity.creation_manifest?.manifest_hash ?? '',
      delegation_ref: null, causation_id: 'explicit-player-review',
    },
    payload,
  });
  if (['rejected', 'pending'].includes(response.status)) throw new Error(JSON.stringify(response.issues));
  return response;
}

function authoredField(field_key, value) {
  return {
    field_key, value, field_state: 'CONFIRMED', origin: { kind: 'player_authored' },
    effective_interval: { start, end: null }, authority: 'mock-player',
    visibility: 'author', review_disposition: 'accepted',
  };
}

await command('create_draft', {
  target_class: 'PC', scenario: 'mock-scenario-v1', start_time: start,
  start_placement: { location_ref: 'mock-start-location' }, control_principal: 'mock-player',
  selected_templates: [], delegation_scopes: [], baseline_capability_preset: 'grounded-pc-v1',
  fields: [authoredField('preferred_name', 'Alex'), authoredField('birth_date_or_interval', { age: 25 })],
});
await command('validate_creation', {
  grant_lines: [], dependencies: {}, reviewed_claims: [], reviewed_kinship: [],
  reviewed_disclosure: {}, biography: [], household_references: [],
});
await command('prepare_creation');
const result = await command('commit_creation');
console.log(JSON.stringify({
  status: result.status,
  character_id: result.character_ref,
  lifecycle_state: identity.character_core.lifecycle_state,
  revision: result.revision,
  owner_receipts: identity.domain_receipt.length,
}, null, 2));
