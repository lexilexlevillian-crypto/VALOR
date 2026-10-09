/** Deterministic System 9 constraints; owner decisions remain opaque receipts. */
import {
  APPEARANCE_FIELDS, BIOGRAPHY_KINDS, DOMAIN, FIELDS, INTERNAL_PC_CATEGORIES,
  MULTIPLE_FIELDS, SENSITIVE_CATEGORIES, Field, Biography, Claim, Kinship,
  Definition, Descriptor, Interval, parse, requireRule, hash, canonical,
  intervalBounds, bounds, contains, overlaps, birthIntervalFromAge, ageRange,
  topologicalOrder,
} from './contracts.mjs';

export const COMMANDS_BY_OWNER = Object.freeze({
  system3: ['initialize_knowledge', 'propose_knowledge', 'supply_evidence'],
  system4: ['initialize_memory', 'propose_memory'],
  system5: ['initialize_personality', 'propose_tendency', 'propose_contextual_response', 'propose_value'],
  system6: ['propose_schedule', 'propose_goal'],
  system7: ['seed_relationship', 'propose_relationship'],
  system8: ['seed_romantic_history', 'propose_romantic_history'],
  system10: ['initialize_capabilities', 'propose_specialization', 'propose_mechanical_trait', 'handoff_legacy_receipt'],
  jobs: ['create_employment', 'propose_employment'],
  institutions: ['record_attendance', 'issue_credential', 'propose_enrollment'],
  legal: ['record_legal_assertion', 'create_obligation', 'verify_identity'],
  licensing: ['issue_license', 'verify_license'],
  economy: ['initial_balance', 'authorized_transfer', 'create_debt', 'historical_settlement'],
  inventory: ['grant_item', 'equip_item'], housing: ['create_household', 'grant_tenancy', 'grant_access'],
  vehicles: ['grant_vehicle'], property: ['grant_property'], health: ['propose_health_history'],
  physiology: ['propose_condition'], grooming: ['propose_grooming'], environment: ['propose_appearance_effect'],
  perception: ['propose_observation'], location: ['validate_placement'], travel: ['propose_travel_history'],
});
const DEMOGRAPHIC_FIELDS = new Set(['gender_identity', 'pronouns', 'citizenship_claims', 'national_affiliation_claims', 'cultural_affiliations', 'socioeconomic_self_description', ...APPEARANCE_FIELDS]);
const RESERVED = /^(?:system\d+:|admin:|developer:|capability:|health:|economy:|inventory:|permissions:)/i;
const UNSAFE_KEYS = new Set(['receipt', 'successful_receipt', 'admin', 'developer', 'permissions', 'execute', 'script', 'tool_call', 'force_pc_action', 'force_consent', 'always_wins', 'universal_attractiveness']);

export function inertText(value, limit = 2000) {
  requireRule(typeof value === 'string' && [...value].length <= limit, 'INVALID_FIELD', 'Text limit exceeded');
  requireRule(!/<\s*(?:script|iframe|object|embed|svg)|\bon\w+\s*=|javascript\s*:/i.test(value), 'INVALID_FIELD', 'Unsafe markup');
  return value;
}
export function safeObject(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    requireRule(!UNSAFE_KEYS.has(key.toLowerCase()), 'INVALID_FIELD', 'Reserved privilege or executable key');
    safeObject(item);
  }
}
export function scopeFor(draft, reference) {
  return draft.delegation_scopes.find(scope => hash(scope) === reference);
}
export function requireDelegation(draft, field, scopeRef, category) {
  const scope = scopeFor(draft, scopeRef);
  requireRule(scope && !scope.revoked && scope.principal === draft.control_principal, 'INVALID_SCOPE', 'Missing or revoked delegation');
  requireRule(scope.permitted_fields.includes(field.field_key) && contains(scope.permitted_interval, field.effective_interval), 'INVALID_SCOPE', 'Proposal exceeds field or interval delegation');
  if (category) requireRule(scope.permitted_categories.includes(category), 'INVALID_SCOPE', 'Proposal exceeds category delegation');
}
export function normalizeField(input, draft) {
  const field = parse(Field, input);
  if (field.field_key === 'birth_date_or_interval' && field.value && typeof field.value === 'object' && Object.keys(field.value).length === 1 && 'age' in field.value) {
    field.value = birthIntervalFromAge(field.value.age, draft.start_time);
  }
  return field;
}
export function validateField(field, state, authority, { generated = false } = {}) {
  parse(Field, field); intervalBounds(field.effective_interval);
  requireRule(FIELDS.includes(field.field_key), 'INVALID_FIELD', 'Unknown identity field; use a registered custom descriptor', [field.field_key]);
  requireRule(field.authority === authority.principal_id || ['creator', 'developer'].includes(authority.role), 'INVALID_SCOPE', 'Cannot impersonate field authority');
  const origin = field.origin;
  requireRule(origin && typeof origin === 'object' && !Array.isArray(origin) && ['player_authored', 'creator_authored', 'generated', 'imported', 'owner_event'].includes(origin.kind), 'INVALID_FIELD', 'Explicit field provenance required');
  requireRule(origin.kind !== 'owner_event', 'INVALID_SCOPE', 'Owner facts require authenticated event intake');
  if (state.creation_draft.target_class === 'PC') {
    requireRule(!INTERNAL_PC_CATEGORIES.has(origin.category), 'INVALID_SCOPE', 'PC actions and internal state are not identity fields');
    if (generated || origin.kind === 'generated') requireDelegation(state.creation_draft, field, origin.scope_ref, origin.category);
    if (SENSITIVE_CATEGORIES.has(origin.category) && origin.kind !== 'player_authored') requireDelegation(state.creation_draft, field, origin.scope_ref, origin.category);
  }
  if (origin.kind === 'imported') requireRule(typeof origin.source_span === 'string', 'INVALID_FIELD', 'Imported fields require source spans');
  if (field.field_state === 'UNSPECIFIED' || field.field_state === 'EXPLICIT_NONE') {
    requireRule(!('value' in field), 'INVALID_FIELD', 'Unset and scoped-negative fields carry no invented value'); return;
  }
  requireRule('value' in field && field.value !== null, 'INVALID_FIELD', 'An asserted field requires a value');
  if (field.field_key === 'birth_date_or_interval') {
    const birth = parse(Interval, field.value); const range = ageRange(birth, state.creation_draft.start_time);
    requireRule(range.min >= 0, 'CHRONOLOGY_CONFLICT', 'Birth cannot follow scenario start');
  } else if (typeof field.value === 'string') inertText(field.value);
  else if (typeof field.value === 'number') requireRule(field.field_key === 'height' && field.value >= 0, 'INVALID_FIELD', 'Unexpected numeric identity value');
  else if (Array.isArray(field.value)) {
    requireRule(MULTIPLE_FIELDS.has(field.field_key) && field.value.length <= state.versioned_defaults.max_values_per_multivalue_field, 'INVALID_FIELD', 'Invalid multi-valued identity field');
    field.value.forEach(value => inertText(value));
  } else requireRule(false, 'INVALID_FIELD', 'Unsupported identity value');
}
export function acceptedFields(state) {
  return state.creation_draft.fields.filter(field => field.review_disposition === 'accepted' && ['CONFIRMED', 'EXPLICIT_NONE'].includes(field.field_state));
}
export function birthFrom(state) {
  if (state.character_core?.lifecycle_state === 'ACTIVE') {
    const superseded = new Set(state.identity_fact.map(fact => fact.supersedes_fact_id).filter(Boolean));
    const fact = state.identity_fact.findLast(fact => fact.field_key === 'birth_date_or_interval' && !superseded.has(fact.fact_id));
    if (fact) return JSON.parse(fact.value_json).value;
  }
  return acceptedFields(state).find(field => field.field_key === 'birth_date_or_interval')?.value;
}
export function validateSingleValues(fields) {
  for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) {
    const a = fields[i], b = fields[j];
    if (a.field_key === b.field_key && !MULTIPLE_FIELDS.has(a.field_key) && overlaps(a.effective_interval, b.effective_interval)) {
      requireRule(canonical({ state: a.field_state, value: a.value ?? null }) === canonical({ state: b.field_state, value: b.value ?? null }), 'CHRONOLOGY_CONFLICT', 'Overlapping single-valued facts', [a.field_key]);
    }
  }
}
export function validateBiography(input, state, { initial = false } = {}) {
  const event = parse(Biography, input);
  requireRule(BIOGRAPHY_KINDS.includes(event.event_kind), 'INVALID_FIELD', 'Unregistered biography kind', [event.event_kind]);
  const [start, end] = intervalBounds(event.interval), birth = birthFrom(state);
  if (birth) {
    const [birthStart, birthEnd] = intervalBounds(birth);
    requireRule(end >= birthStart, 'CHRONOLOGY_CONFLICT', 'Event predates birth', [event.source_event]);
    requireRule(start >= birthEnd || (bounds(event.interval.start)[0] === bounds(birth.end)[0]), 'NEEDS_CHOICE', 'Event overlaps unresolved birth interval', [event.source_event]);
  }
  if (initial) requireRule(start <= bounds(state.creation_draft.start_time)[1] && (end === Infinity || end <= bounds(state.creation_draft.start_time)[1]), 'CHRONOLOGY_CONFLICT', 'Initial history extends into the future');
  safeObject(event.factual_payload);
  return event;
}
export function validateClaim(input) { const claim = parse(Claim, input); intervalBounds(claim.effective_interval); safeObject(claim.asserted_value); return claim; }
export function validateKinship(edges, prior = []) {
  const all = [...prior, ...edges];
  for (const edge of all) {
    parse(Kinship, edge); intervalBounds(edge.effective_interval);
    requireRule(edge.source_person !== edge.target_person && edge.evidence.length > 0, 'CHRONOLOGY_CONFLICT', 'Kinship requires distinct people and evidence');
  }
  const parents = all.filter(edge => edge.relationship_type === 'biological_parent');
  const ids = [...new Set(parents.flatMap(edge => [edge.source_person, edge.target_person]))];
  const graph = Object.fromEntries(ids.map(id => [id, parents.filter(edge => edge.target_person === id).map(edge => edge.source_person)]));
  topologicalOrder(graph, ids);
}
export function validateGrantRequest(line, state) {
  requireRule(COMMANDS_BY_OWNER[line.owner_domain]?.includes(line.command_type), 'INVALID_FIELD', 'Unregistered owner command');
  safeObject(line.payload); line.provenance.forEach(safeObject);
  requireRule(line.provenance.length > 0, 'INVALID_FIELD', 'Owner request requires provenance');
  if (state.creation_draft.target_class === 'PC' && line.owner_domain === 'system5') requireRule(false, 'INVALID_SCOPE', 'NPC behavior grants cannot target the PC');
  if (state.creation_draft.target_class === 'PC' && line.owner_domain === 'system6') requireRule(line.provenance.some(source => source?.kind === 'player_authored' && source.principal === state.creation_draft.control_principal), 'INVALID_SCOPE', 'PC schedule proposals require explicit player authoring');
  if (line.owner_domain === 'system10') {
    function noDemographics(value) {
      if (typeof value === 'string') requireRule(!DEMOGRAPHIC_FIELDS.has(value), 'INVALID_FIELD', 'Demographic input cannot drive capability proposals');
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
        requireRule(!DEMOGRAPHIC_FIELDS.has(key), 'INVALID_FIELD', 'Demographic input cannot drive capability proposals'); noDemographics(item);
      }
    }
    noDemographics(line.payload); noDemographics(line.provenance);
  }
  if (line.owner_domain === 'system8') {
    const birth = birthFrom(state);
    requireRule(birth && ageRange(birth, state.creation_draft.start_time).min >= 18, 'INVALID_SCOPE', 'Romantic history requires a resolved adult age constraint');
  }
  if (['system7', 'system8'].includes(line.owner_domain)) {
    const payload = line.payload;
    requireRule(payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.source_person === 'string' && typeof payload.target_person === 'string', 'INVALID_FIELD', 'Relationship seeds require an explicit direction');
    if (state.creation_draft.target_class === 'PC' && payload.source_person === state.character_core?.character_id) {
      requireRule(line.provenance.some(source => source?.kind === 'player_authored' && source.principal === state.creation_draft.control_principal), 'INVALID_SCOPE', 'PC relationship direction needs explicit authorship');
    }
    requireRule(payload.current_consent === undefined && payload.force_attraction === undefined && payload.reciprocal === undefined, 'INVALID_SCOPE', 'History cannot imply present consent or reciprocal feelings');
  }
  if (!line.required) requireRule(line.fallback !== null, 'NEEDS_CHOICE', 'Optional grant requires an agreed fallback');
}
export function validateDefinition(input, state) {
  const definition = parse(Definition, input);
  requireRule(/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/i.test(definition.key) && !RESERVED.test(definition.key), 'INVALID_FIELD', 'Reserved or invalid custom namespace');
  requireRule(definition.owner === DOMAIN, 'INVALID_FIELD', 'Custom descriptors cannot own foreign state');
  if (definition.length_bounds) requireRule(definition.length_bounds.min <= definition.length_bounds.max && definition.length_bounds.max <= state.versioned_defaults.max_characters_per_custom_text_value, 'INVALID_FIELD', 'Invalid text bounds');
  if (definition.numeric_range) requireRule(definition.numeric_range.min <= definition.numeric_range.max, 'INVALID_FIELD', 'Invalid numeric bounds');
  return definition;
}
export function definitionRef(definition) { return `${definition.key}@${definition.schema_version}`; }
export function validateDescriptor(input, state) {
  const descriptor = parse(Descriptor, input); intervalBounds(descriptor.effective_interval);
  requireRule(descriptor.character_ref === state.character_core.character_id, 'INVALID_SCOPE', 'Wrong descriptor subject');
  safeObject(descriptor.value);
  const definition = state.descriptor_definition.find(def => definitionRef(def) === descriptor.definition_ref);
  if (!definition) {
    const values = Array.isArray(descriptor.value) ? descriptor.value : [descriptor.value];
    requireRule(values.length <= state.versioned_defaults.max_values_per_multivalue_field, 'INVALID_FIELD', 'Inert field exceeds value limit');
    for (const value of values) {
      if (typeof value === 'string') inertText(value, state.versioned_defaults.max_characters_per_custom_text_value);
      else if (value && typeof value === 'object') intervalBounds(value);
      else requireRule(typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean', 'INVALID_FIELD', 'Inert descriptor must use a supported primitive type');
    }
    descriptor.archived_or_inert = true; return descriptor;
  }
  requireRule(descriptor.disclosure === definition.visibility, 'INVALID_SCOPE', 'Descriptor cannot weaken definition disclosure');
  const values = definition.cardinality === 'multiple' ? descriptor.value : [descriptor.value];
  requireRule(Array.isArray(values) && values.length <= state.versioned_defaults.max_values_per_multivalue_field, 'INVALID_FIELD', 'Invalid descriptor cardinality');
  for (const value of values) {
    switch (definition.type) {
      case 'bounded_text': inertText(value, definition.length_bounds?.max ?? state.versioned_defaults.max_characters_per_custom_text_value); requireRule([...value].length >= (definition.length_bounds?.min ?? 0), 'INVALID_FIELD', 'Text too short'); break;
      case 'enum': requireRule(definition.allowed_values.some(item => canonical(item) === canonical(value)), 'INVALID_FIELD', 'Invalid enum'); break;
      case 'boolean': requireRule(typeof value === 'boolean', 'INVALID_FIELD', 'Expected boolean'); break;
      case 'integer': case 'decimal': requireRule(typeof value === 'number' && Number.isFinite(value) && (definition.type !== 'integer' || Number.isInteger(value)) && (!definition.numeric_range || value >= definition.numeric_range.min && value <= definition.numeric_range.max), 'INVALID_FIELD', 'Invalid numeric value'); break;
      case 'date_interval': intervalBounds(value); break;
      case 'entity_reference': requireRule(typeof value === 'string' && value.length > 0, 'INVALID_FIELD', 'Invalid entity reference'); break;
    }
  }
  return descriptor;
}

/** Partial dates remain intervals; no derived exact birthday is generated. */
export function ageEligibility(birth, at, minimum) {
  const age = ageRange(birth, at);
  return age.min >= minimum ? 'eligible' : age.max < minimum ? 'ineligible' : 'needs_choice';
}
