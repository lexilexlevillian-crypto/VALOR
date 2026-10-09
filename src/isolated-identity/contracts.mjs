/** System 9 JSON contracts. No foreign domain state is stored here. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const DOMAIN = 'character_identity_development';
export const VERSION = '2.0';
export const LIFECYCLES = ['DRAFT', 'VALIDATING', 'READY', 'PREPARING', 'COMMITTING', 'ACTIVE', 'RECOVERY_REQUIRED', 'CANCELLED'];
export const FIELD_STATES = ['UNSPECIFIED', 'EXPLICIT_NONE', 'PROPOSED', 'CONFIRMED', 'DISPUTED'];
export const ERRORS = ['INVALID_SCOPE', 'CHRONOLOGY_CONFLICT', 'MISSING_OWNER', 'OWNER_UNAVAILABLE', 'DOMAIN_UNAVAILABLE', 'INCOMPATIBLE_EXISTING_PERSON', 'INVALID_FIELD', 'STALE_REVISION', 'BUDGET_EXCEEDED', 'GRANT_REJECTED', 'NEEDS_CHOICE', 'RECOVERY_PENDING', 'IDEMPOTENCY_CONFLICT'];
export const EVENTS = ['CreationDraftEdited', 'CreationValidated', 'CreationReserved', 'CreationCommitStarted', 'OwnerGrantAcknowledged', 'CharacterActivated', 'CreationRecoveryRequired', 'IdentityFactRecorded', 'IdentityClaimRecorded', 'AppearanceChanged', 'BiographyEventRecorded', 'KinshipEstablished', 'KinshipIntervalEnded', 'DevelopmentProposed', 'DevelopmentAccepted', 'DevelopmentRejected', 'DescriptorChanged', 'FactCorrected', 'CharacterArchived'];
export const DEFAULTS = Object.freeze({
  durable_npc_tendency_min_independent_events: 3,
  durable_npc_tendency_min_simulation_days: 14,
  max_biography_entries_per_creation_manifest: 200,
  max_newly_detailed_relatives_per_generation_request: 12,
  max_custom_fields_per_character: 64,
  max_characters_per_custom_text_value: 2000,
  max_values_per_multivalue_field: 32,
  max_imported_biography_characters: 20000,
  max_provisioning_lines: 200,
});
export const OWNERS = Object.freeze(['system3', 'system4', 'system5', 'system6', 'system7', 'system8', 'system10', 'jobs', 'institutions', 'legal', 'licensing', 'economy', 'inventory', 'housing', 'vehicles', 'property', 'health', 'physiology', 'grooming', 'environment', 'perception', 'location', 'travel']);
export const FIELDS = Object.freeze([
  'preferred_name', 'legal_name_assertions', 'former_names', 'aliases', 'optional_normalized_search_keys',
  'pronouns', 'gender_identity', 'birth_date_or_interval', 'birthplace', 'citizenship_claims',
  'national_affiliation_claims', 'cultural_affiliations', 'language_affiliations', 'authored_use_preferences',
  'preferred_communication_channels', 'height', 'build', 'hair', 'eyes', 'skin_description', 'facial_features',
  'voice_qualities', 'visible_marks', 'posture_tendencies', 'presentation', 'grooming_descriptors',
  'personality_descriptors', 'values', 'boundaries', 'authored_practices', 'socioeconomic_self_description',
]);
export const MULTIPLE_FIELDS = new Set(['legal_name_assertions', 'former_names', 'aliases', 'optional_normalized_search_keys', 'citizenship_claims', 'national_affiliation_claims', 'cultural_affiliations', 'language_affiliations', 'authored_use_preferences', 'preferred_communication_channels', 'visible_marks', 'personality_descriptors', 'values', 'boundaries', 'authored_practices']);
export const APPEARANCE_FIELDS = new Set(['height', 'build', 'hair', 'eyes', 'skin_description', 'facial_features', 'voice_qualities', 'visible_marks', 'posture_tendencies', 'presentation', 'grooming_descriptors']);
export const BIOGRAPHY_KINDS = ['upbringing', 'caregiving', 'schooling', 'employment', 'relocation', 'relationship', 'significant_event', 'capability_milestone', 'appearance', 'health', 'death', 'incarceration', 'disappearance'];
export const SENSITIVE_CATEGORIES = new Set(['sexual_history', 'criminal_behavior', 'family_trauma', 'intimacy', 'romance']);
export const INTERNAL_PC_CATEGORIES = new Set(['dialogue', 'thoughts', 'feelings', 'decisions', 'consent', 'movement', 'actions']);

export class IdentityError extends Error {
  constructor(code, message = code, refs = []) { super(message); this.code = code; this.refs = refs; }
}
export function requireRule(condition, code, message, refs = []) {
  if (!condition) throw new IdentityError(code, message, refs);
}

/** Reject non-JSON values, cycles, prototype keys, excessive depth and nonfinite numbers. */
export function assertJson(value, depth = 0, seen = new Set()) {
  requireRule(depth <= 24, 'INVALID_FIELD', 'JSON nesting limit exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { requireRule(Number.isFinite(value), 'INVALID_FIELD', 'Nonfinite number'); return; }
  requireRule(typeof value === 'object' && !seen.has(value), 'INVALID_FIELD', 'Expected acyclic JSON');
  requireRule(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'INVALID_FIELD', 'Expected plain JSON');
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    requireRule(!['__proto__', 'prototype', 'constructor'].includes(key), 'INVALID_FIELD', 'Reserved JSON key');
    assertJson(item, depth + 1, seen);
  }
  seen.delete(value);
}
export function canonical(value) {
  assertJson(value);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export const stableId = (kind, ...parts) => `${kind}_${hash(parts).slice(0, 32)}`;
export const clone = value => structuredClone(value);
const Json = z.any().superRefine((value, ctx) => { try { assertJson(value); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid JSON' }); } });
const Id = z.string().min(1).max(240);
const Text = z.string().max(2000);
const Revision = z.union([z.string().min(1), z.number().int().nonnegative()]);
export const Interval = z.object({ start: z.string(), end: z.string().nullable() }).strict();
const RefList = z.array(Id);
export const Scope = z.object({ principal: Id, permitted_fields: RefList, permitted_interval: Interval, permitted_categories: RefList, revoked: z.boolean() }).strict();
export const Field = z.object({
  field_key: Id, field_state: z.enum(FIELD_STATES), value: Json.optional(), origin: Json,
  effective_interval: Interval, authority: Id, visibility: Id,
  review_disposition: z.enum(['accepted', 'omitted', 'disputed', 'needs_owner_validation']),
}).strict();
export const Claim = z.object({ subject: Id, field_key: Id, asserted_value: Json, source: Json, effective_interval: Interval, certainty: Json, authority: Id, disclosure: Id }).strict();
export const Kinship = z.object({ source_person: Id, target_person: Id, relationship_type: z.enum(['biological_parent', 'adoptive_parent', 'step_parent', 'foster_parent', 'guardian', 'marital', 'chosen_family', 'sibling', 'step_sibling']), effective_interval: Interval, certainty: Json, evidence: z.array(Json), visibility: Id }).strict();
export const Receipt = z.object({ owner_domain: z.enum(OWNERS), command_hash: Id, status: z.enum(['accepted', 'rejected']), canonical_event_refs: RefList, resultant_revision: Revision }).strict();
export const Fallback = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('omit') }).strict(),
  z.object({ kind: z.literal('return_to_choice') }).strict(),
  z.object({ kind: z.literal('specific_eligible_substitute'), line_id: Id }).strict(),
]);
export const Grant = z.object({
  line_id: Id, owner_domain: z.enum(OWNERS), command_type: Id, payload: Json, required: z.boolean(),
  quantity_or_amount: z.number().finite().optional(), constraints: z.array(Json), provenance: z.array(Json),
  reservation_ref: Id.nullable(), expected_owner_revision: Revision, idempotency_key: Id,
  compensation_policy: Id, fallback: Fallback.nullable(), status: z.enum(['reserved', 'accepted', 'rejected', 'compensated', 'pending']), receipt_refs: RefList,
}).strict();
export const GrantInput = Grant.omit({ reservation_ref: true, idempotency_key: true, status: true, receipt_refs: true });
export const Biography = z.object({ event_kind: Id, subject: Id, interval: Interval, precision: Id, location_ref: Id.nullable(), participants: RefList, factual_payload: Json, source_event: Id, authority: Id, disclosure: Id, certainty: Json }).strict();
export const Definition = z.object({ key: Id, schema_version: Revision, owner: Id, type: z.enum(['bounded_text', 'enum', 'boolean', 'integer', 'decimal', 'date_interval', 'entity_reference']), cardinality: z.enum(['single', 'multiple']), allowed_values: z.array(Json), length_bounds: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict().nullable(), numeric_range: z.object({ min: z.number(), max: z.number() }).strict().nullable(), effective_time_policy: Id, visibility: Id, permitted_adapters: RefList }).strict();
export const Descriptor = z.object({ definition_ref: Id, character_ref: Id, value: Json, effective_interval: Interval, provenance: z.array(Json), disclosure: Id, archived_or_inert: z.boolean() }).strict();
export const Development = z.object({ subject: Id, target_owner: z.enum(OWNERS), requested_change: Json, evidence_event_refs: RefList, evidence_interval: Interval, context_refs: RefList, status: z.enum(['proposed', 'accepted', 'rejected']), owner_receipt_refs: RefList }).strict();
export const Hook = z.object({ owner: z.enum(OWNERS), underlying_record_refs: RefList, onset: z.union([z.string(), Interval]), severity_description: Text, known_parties: RefList, activation_predicates: z.array(Json), observation_policy: Id, allowed_response_windows: z.array(Interval), resolution_receipts: RefList, active_interval: Interval, activation_source_refs: RefList }).strict();
export const Household = z.object({ person_refs: RefList, household_ref: Id, housing_refs: RefList, support_arrangement_refs: RefList, effective_interval: Interval }).strict();
export const Generation = z.object({ tier: z.enum(['Ambient', 'Supporting', 'Major', 'Historical']), world_seed: Json, character_id: Id, generation_version: Revision, random_algorithm_version: Revision, field_sample_slots: Json, accepted_samples: z.array(Json), role_constraints: Json, frozen_fact_refs: RefList, unresolved_fields: RefList }).strict();
export const Command = z.object({ command_id: Id, world_id: Id, branch_id: Id, principal_id: Id, draft_id: Id, expected_revision: z.number().int().nonnegative(), operation: Id, manifest_hash: z.string(), delegation_ref: Id.nullable(), causation_id: Id }).strict();
export const Request = z.object({ command: Command, payload: Json }).strict();
export const Core = z.object({ character_id: Id, world_id: Id, creation_lineage_id: Id, control_kind: Id, lifecycle_state: z.enum(LIFECYCLES), revision: z.number().int().nonnegative() }).strict();
export const Fact = z.object({ fact_id: Id, character_id: Id, field_key: Id, value_json: z.string(), valid_from: z.string(), valid_to: z.string().nullable(), source_event_id: Id, authority_kind: Id, supersedes_fact_id: Id.nullable(), disclosure_policy_id: Id }).strict();
export const Entry = z.object({ entry_id: Id, character_id: Id, kind: Id, interval_json: z.string(), payload_json: z.string(), source_event_id: Id }).strict();
export const Draft = z.object({ draft_id: Id, creator_principal: Id, control_principal: Id, target_class: z.enum(['PC', 'NPC']), world_id: Id, branch_id: Id, scenario: Json, start_time: z.string(), start_placement: Json, schema_version: Revision, revision: z.number().int().nonnegative(), lifecycle_state: z.enum(LIFECYCLES), selected_templates: z.array(Json), fields: z.array(Field), delegation_scopes: z.array(Scope), issues: z.array(Json), pending_choices: z.array(Json), accepted_proposals: z.array(Json), accepted_samples: z.array(Json), baseline_capability_preset: Json }).strict();
export const Manifest = z.object({ creation_lineage_id: Id, draft_revision: z.number().int().nonnegative(), manifest_hash: Id, validation_revision: Revision, grant_policy: Json, reviewed_facts: z.array(Field), reviewed_claims: z.array(Claim), reviewed_kinship: z.array(Kinship), reviewed_disclosure: Json, grant_lines: z.array(Grant), dependencies: z.record(z.string(), RefList), owner_availability_snapshot: Json, idempotency_key: Id }).strict();
export const Envelope = z.object({ world_id: Id, branch_id: Id, sequence: z.number().int().positive(), simulation_time: z.string(), schema_version: Revision, ruleset_version: Revision, actor_authority: Id, command_ref: Id, correlation_ref: Id, causation_ref: Id, disclosure_refs: RefList }).strict();
export const Trace = z.object({ trace_id: Id, rule_id: Id, rule_version: Revision, command: Id, input_refs_and_revisions: z.array(Json), evaluated_predicates: z.array(Json), blockers: z.array(Json), accepted_effects: z.array(Json), rejected_effects: z.array(Json), source_events: RefList, sample_refs: RefList, disclosure_policy: Id }).strict();
export const Recovery = z.object({ coordinator_stage: z.enum(LIFECYCLES), reservations: z.array(Json), owner_acknowledgments: RefList, pending_choices: z.array(Json), outbox_entries: z.array(Json), outbox_cursors: z.array(Json), prior_command_results: z.array(Json), quarantined_inputs: z.array(Json) }).strict();
export const State = z.object({
  character_core: Core.nullable(), creation_draft: Draft.nullable(), creation_manifest: Manifest.nullable(),
  identity_fact: z.array(Fact), identity_claim: z.array(Claim), biography_entry: z.array(Entry), kinship_edge: z.array(Kinship), household_reference: z.array(Household),
  descriptor_definition: z.array(Definition), descriptor_value: z.array(Descriptor), development_proposal: z.array(Development), starting_hook: z.array(Hook), npc_generation: Generation.nullable(),
  domain_receipt: z.array(Receipt), decision_trace: z.array(Trace), durable_recovery_state: Recovery,
  versioned_defaults: z.object(Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, z.number().int().positive()]))).strict(),
}).strict();
export function emptyState() {
  return State.parse({ character_core: null, creation_draft: null, creation_manifest: null, identity_fact: [], identity_claim: [], biography_entry: [], kinship_edge: [], household_reference: [], descriptor_definition: [], descriptor_value: [], development_proposal: [], starting_hook: [], npc_generation: null, domain_receipt: [], decision_trace: [], durable_recovery_state: { coordinator_stage: 'DRAFT', reservations: [], owner_acknowledgments: [], pending_choices: [], outbox_entries: [], outbox_cursors: [], prior_command_results: [], quarantined_inputs: [] }, versioned_defaults: { ...DEFAULTS } });
}
export function parse(schema, value) {
  assertJson(value);
  const result = schema.safeParse(value);
  requireRule(result.success, 'INVALID_FIELD', 'JSON contract violation', result.success ? [] : result.error.issues.map(issue => issue.path.join('.')));
  return result.data;
}

/** Civil dates/intervals are inclusive; null interval ends are unbounded. */
export function bounds(text) {
  requireRule(typeof text === 'string', 'CHRONOLOGY_CONFLICT', 'Expected temporal text');
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (match) {
    const year = Number(match[1]), month = Number(match[2] ?? 1), day = Number(match[3] ?? 1);
    const start = new Date(0); start.setUTCFullYear(year, month - 1, day); start.setUTCHours(0, 0, 0, 0);
    requireRule(start.getUTCFullYear() === year && start.getUTCMonth() === month - 1 && start.getUTCDate() === day, 'CHRONOLOGY_CONFLICT', 'Invalid calendar date');
    const next = new Date(start);
    if (!match[2]) next.setUTCFullYear(year + 1); else if (!match[3]) next.setUTCMonth(month); else next.setUTCDate(day + 1);
    return [start.getTime(), next.getTime() - 1];
  }
  requireRule(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text), 'CHRONOLOGY_CONFLICT', 'Dates require explicit precision and timezone');
  bounds(text.slice(0, 10));
  const value = Date.parse(text);
  requireRule(Number.isFinite(value), 'CHRONOLOGY_CONFLICT', 'Invalid timestamp');
  return [value, value];
}
export function intervalBounds(value) {
  const interval = parse(Interval, value);
  const start = bounds(interval.start)[0], end = interval.end === null ? Infinity : bounds(interval.end)[1];
  requireRule(start <= end, 'CHRONOLOGY_CONFLICT', 'Interval ends before it starts');
  return [start, end];
}
export function overlaps(a, b) { const [as, ae] = intervalBounds(a), [bs, be] = intervalBounds(b); return as <= be && bs <= ae; }
export function contains(outer, inner) { const [a, b] = intervalBounds(outer), [c, d] = intervalBounds(inner); return a <= c && d <= b; }
export function birthIntervalFromAge(age, at) {
  requireRule(Number.isInteger(age) && age >= 0 && age <= 150, 'INVALID_FIELD', 'Invalid integer age');
  const reference = new Date(bounds(at.slice(0, 10))[0]);
  const anniversary = years => {
    const date = new Date(reference); date.setUTCDate(1); date.setUTCFullYear(reference.getUTCFullYear() - years);
    const finalDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(reference.getUTCDate(), finalDay)); return date;
  };
  const start = anniversary(age + 1); start.setUTCDate(start.getUTCDate() + 1);
  return { start: start.toISOString().slice(0, 10), end: anniversary(age).toISOString().slice(0, 10) };
}
export function ageRange(birth, at) {
  const [earliest, latest] = intervalBounds(birth), current = new Date(bounds(at.slice(0, 10))[0]);
  requireRule(Number.isFinite(latest) && latest <= bounds(at.slice(0, 10))[1], 'CHRONOLOGY_CONFLICT', 'Birth interval must be finite and not future');
  const age = epoch => { const date = new Date(epoch); return current.getUTCFullYear() - date.getUTCFullYear() - Number(current.getUTCMonth() < date.getUTCMonth() || (current.getUTCMonth() === date.getUTCMonth() && current.getUTCDate() < date.getUTCDate())); };
  return { min: age(latest), max: age(earliest) };
}
/** Preserve the instant while expressing its civil date in the supplied world timezone. */
export function inWorldTimezone(time, timezone = 'UTC') {
  const epoch = bounds(time)[0];
  if (!time.includes('T')) return time;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const offset = Math.round((Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(epoch / 1000) * 1000) / 60000);
    const sign = offset < 0 ? '-' : '+';
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0'), minutes = String(Math.abs(offset) % 60).padStart(2, '0');
    const milliseconds = String(((epoch % 1000) + 1000) % 1000).padStart(3, '0');
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}${sign}${hours}:${minutes}`;
  } catch { throw new IdentityError('INVALID_FIELD', 'Invalid world timezone'); }
}
export function topologicalOrder(graph, ids) {
  const known = new Set(ids), visiting = new Set(), visited = new Set(), result = [];
  requireRule(known.size === ids.length, 'INVALID_FIELD', 'Duplicate dependency ID');
  for (const [id, deps] of Object.entries(graph)) requireRule(known.has(id) && deps.every(dep => known.has(dep)), 'INVALID_FIELD', 'Unknown dependency');
  function visit(id) {
    requireRule(!visiting.has(id), 'CHRONOLOGY_CONFLICT', 'Dependency cycle', [id]);
    if (visited.has(id)) return;
    visiting.add(id); for (const dep of graph[id] ?? []) visit(dep);
    visiting.delete(id); visited.add(id); result.push(id);
  }
  for (const id of [...ids].sort()) visit(id);
  return result;
}
export function manifestHash(manifest) {
  const { manifest_hash: ignored, ...body } = manifest;
  return hash({ ...body, grant_lines: body.grant_lines.map(({ reservation_ref, status, receipt_refs, ...line }) => line) });
}

/** Outgoing payloads are explicit requests, never copied identity sheets. */
export function ownerRequest(line) {
  return { owner_domain: line.owner_domain, command_type: line.command_type, payload: line.payload, quantity_or_amount: line.quantity_or_amount ?? null, constraints: line.constraints, provenance: line.provenance, expected_owner_revision: line.expected_owner_revision, idempotency_key: line.idempotency_key };
}

export { z, Json, Id, RefList };
