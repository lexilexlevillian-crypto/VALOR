/** Public JSON interface; unspecified architecture payloads remain typed JSON. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type Lifecycle = 'DRAFT' | 'VALIDATING' | 'READY' | 'PREPARING' | 'COMMITTING' | 'ACTIVE' | 'RECOVERY_REQUIRED' | 'CANCELLED';
export type FieldState = 'UNSPECIFIED' | 'EXPLICIT_NONE' | 'PROPOSED' | 'CONFIRMED' | 'DISPUTED';
export type OwnerDomain = 'system3' | 'system4' | 'system5' | 'system6' | 'system7' | 'system8' | 'system10' | 'jobs' | 'institutions' | 'legal' | 'licensing' | 'economy' | 'inventory' | 'housing' | 'vehicles' | 'property' | 'health' | 'physiology' | 'grooming' | 'environment' | 'perception' | 'location' | 'travel';
export interface TemporalInterval { start: string; end: string | null }
export interface AuthoredField {
  field_key: string;
  field_state: FieldState;
  value?: JsonValue;
  origin: JsonValue;
  effective_interval: TemporalInterval;
  authority: string;
  visibility: string;
  review_disposition: 'accepted' | 'omitted' | 'disputed' | 'needs_owner_validation';
}
export interface DelegationScope {
  principal: string;
  permitted_fields: string[];
  permitted_interval: TemporalInterval;
  permitted_categories: string[];
  revoked: boolean;
}
export interface CharacterCore {
  character_id: string;
  world_id: string;
  creation_lineage_id: string;
  control_kind: string;
  lifecycle_state: Lifecycle;
  revision: number;
}
export interface IdentityFact {
  fact_id: string;
  character_id: string;
  field_key: string;
  value_json: string;
  valid_from: string;
  valid_to: string | null;
  source_event_id: string;
  authority_kind: string;
  supersedes_fact_id: string | null;
  disclosure_policy_id: string;
}
export interface BiographyEntry {
  entry_id: string;
  character_id: string;
  kind: string;
  interval_json: string;
  payload_json: string;
  source_event_id: string;
}
export interface CreationDraft {
  draft_id: string;
  creator_principal: string;
  control_principal: string;
  target_class: 'PC' | 'NPC';
  world_id: string;
  branch_id: string;
  scenario: JsonValue;
  start_time: string;
  start_placement: JsonValue;
  schema_version: string | number;
  revision: number;
  lifecycle_state: Lifecycle;
  selected_templates: JsonValue[];
  fields: AuthoredField[];
  delegation_scopes: DelegationScope[];
  issues: JsonValue[];
  pending_choices: JsonValue[];
  accepted_proposals: JsonValue[];
  accepted_samples: JsonValue[];
  baseline_capability_preset: JsonValue;
}
export interface DomainReceipt {
  owner_domain: OwnerDomain;
  command_hash: string;
  status: 'accepted' | 'rejected';
  canonical_event_refs: string[];
  resultant_revision: string | number;
}
export type GrantFallback = null | { kind: 'omit' } | { kind: 'return_to_choice' } | { kind: 'specific_eligible_substitute'; line_id: string };
export interface GrantLine {
  line_id: string;
  owner_domain: OwnerDomain;
  command_type: string;
  payload: JsonValue;
  required: boolean;
  quantity_or_amount?: number;
  constraints: JsonValue[];
  provenance: JsonValue[];
  reservation_ref: string | null;
  expected_owner_revision: string | number;
  idempotency_key: string;
  compensation_policy: string;
  fallback: GrantFallback;
  status: 'reserved' | 'accepted' | 'rejected' | 'compensated' | 'pending';
  receipt_refs: string[];
}
export interface CreationManifest {
  creation_lineage_id: string;
  draft_revision: number;
  manifest_hash: string;
  validation_revision: string | number;
  grant_policy: JsonValue;
  reviewed_facts: AuthoredField[];
  reviewed_claims: JsonObject[];
  reviewed_kinship: JsonObject[];
  reviewed_disclosure: JsonValue;
  grant_lines: GrantLine[];
  dependencies: Record<string, string[]>;
  owner_availability_snapshot: JsonValue;
  idempotency_key: string;
}
export interface RecoveryState {
  coordinator_stage: Lifecycle;
  reservations: JsonValue[];
  owner_acknowledgments: string[];
  pending_choices: JsonValue[];
  outbox_entries: JsonValue[];
  outbox_cursors: JsonValue[];
  prior_command_results: JsonValue[];
  quarantined_inputs: JsonValue[];
}
export interface VersionedDefaults {
  durable_npc_tendency_min_independent_events: number;
  durable_npc_tendency_min_simulation_days: number;
  max_biography_entries_per_creation_manifest: number;
  max_newly_detailed_relatives_per_generation_request: number;
  max_custom_fields_per_character: number;
  max_characters_per_custom_text_value: number;
  max_values_per_multivalue_field: number;
  max_imported_biography_characters: number;
  max_provisioning_lines: number;
}
export interface System9State {
  character_core: CharacterCore | null;
  creation_draft: CreationDraft | null;
  creation_manifest: CreationManifest | null;
  identity_fact: IdentityFact[];
  identity_claim: JsonObject[];
  biography_entry: BiographyEntry[];
  kinship_edge: JsonObject[];
  household_reference: JsonObject[];
  descriptor_definition: JsonObject[];
  descriptor_value: JsonObject[];
  development_proposal: JsonObject[];
  starting_hook: JsonObject[];
  npc_generation: JsonObject | null;
  domain_receipt: DomainReceipt[];
  decision_trace: JsonObject[];
  durable_recovery_state: RecoveryState;
  versioned_defaults: VersionedDefaults;
}
export type Operation =
  | 'create_draft' | 'import_card' | 'edit_draft' | 'validate_creation'
  | 'prepare_creation' | 'commit_creation' | 'recover_creation' | 'cancel_creation'
  | 'ingest_owner_event' | 'record_claim' | 'establish_kinship' | 'correct_fact' | 'propose_development'
  | 'generate_fields' | 'accept_promotion' | 'import_biography'
  | 'register_descriptor' | 'retire_descriptor' | 'set_descriptor'
  | 'apply_descriptor_adapter' | 'migrate_descriptor' | 'migrate_legacy_receipts'
  | 'register_hook' | 'evaluate_hook' | 'end_kinship' | 'fork_branch'
  | 'flush_outbox' | 'project' | 'preview' | 'inspect' | 'snapshot' | 'export_card'
  | 'age_eligibility' | 'revoke_delegation' | 'author_self_description' | 'author_identity_change'
  | 'archive' | 'set_defaults';
export interface CommandEnvelope {
  command_id: string;
  world_id: string;
  branch_id: string;
  principal_id: string;
  draft_id: string;
  expected_revision: number;
  operation: Operation;
  manifest_hash: string;
  delegation_ref: string | null;
  causation_id: string;
}
export interface CommandRequest { command: CommandEnvelope; payload: JsonObject }
/** Fields beyond the common envelope depend on the registered operation. */
export interface CommandResponse {
  status: string;
  revision?: string | number | null;
  event_refs?: string[];
  owner_request_statuses?: JsonObject[];
  pending_choices?: JsonValue[];
  trace_id?: string | null;
  issues: JsonObject[];
  audience_projection: JsonObject;
  [key: string]: JsonValue | undefined;
}
export type DependencyStub = (request: JsonObject) => JsonObject | Promise<JsonObject>;
export type DependencyName =
  | 'readPlayerAuthority' | 'readWorldConfiguration' | 'readSystem3Knowledge' | 'readSystem4Memory'
  | 'readSystem5Personality' | 'readSystem6Schedules' | 'readSystem7Relationships' | 'readSystem8Romance'
  | 'readSystem10Capabilities' | 'readJobsAndInstitutions' | 'readLegalLicensing' | 'readEconomy'
  | 'readResources' | 'readHealthAppearance' | 'readPerception' | 'readAudience' | 'resolvePerson'
  | 'validateOwnerRequest' | 'reserveOwnerRequest' | 'checkReservation' | 'releaseReservation'
  | 'submitOwnerRequest' | 'lookupOwnerRequest' | 'authenticateOwnerReceipt' | 'compensateOwnerRequest'
  | 'fetchOwnerEvent' | 'evaluateHookPredicates' | 'validateAdapter' | 'persistIdentitySnapshot'
  | 'loadIdentitySnapshot' | 'publishIdentityEvent' | 'publishOpening' | 'requestDependencyRepair'
  | 'readAiProposals' | 'validateConfigurationChange' | 'mapLegacyReceipt';
export interface CharacterIdentityDevelopment extends Readonly<System9State> {}
export class CharacterIdentityDevelopment {
  constructor(dependencies?: Partial<Record<DependencyName, DependencyStub>>);
  execute(request: CommandRequest): Promise<CommandResponse>;
  restore(): Promise<{ status: 'restored' | 'not_found'; revision?: number }>;
}
export const DOMAIN: 'character_identity_development';
export const VERSION: '2.0';
export const DEFAULTS: Readonly<VersionedDefaults>;
export function createMockDependencies(overrides?: Partial<Record<DependencyName, DependencyStub>>): Readonly<Record<DependencyName, DependencyStub>>;
export function hash(value: unknown): string;
export function canonical(value: unknown): string;
export function clone<T>(value: T): T;
export function stableId(kind: string, ...parts: JsonValue[]): string;
export function birthIntervalFromAge(age: number, at: string): TemporalInterval;
export function ageRange(birth: TemporalInterval, at: string): { min: number; max: number };
export function inWorldTimezone(time: string, timezone?: string): string;
export function ageEligibility(birth: TemporalInterval, at: string, minimum: number): 'eligible' | 'ineligible' | 'needs_choice';
export function rebuildIdentityProjections(snapshot: System9State): System9State;
