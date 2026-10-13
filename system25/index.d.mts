/** TypeScript contracts for the isolated Node.js module. Foreign payloads remain JSON. */
export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject { [key: string]: Json; }
export interface Cut extends JsonObject { timeline_id: string; sequence: number; }
export interface Authority extends JsonObject { role: 'player' | 'administrator'; session_id: string; actor_id: string; }
export interface CommandContext extends JsonObject {
  campaign_id: string; timeline_id: string; authority: Authority;
  operation_id: string; idempotency_key: string; expected_head_revision: number;
  expected_entity_revisions: JsonObject; session_fence: number;
}
export interface QueryContext extends JsonObject { campaign_id: string; timeline_id: string; authority: Authority; }
export type ReadCommand = 'ListSaveEntries' | 'GetTimelineLineage' | 'GetCheckpointCompatibility'
  | 'GetKnownHistoryAtCut' | 'InspectCheckpoint' | 'ExportTimeline' | 'GetStatus' | 'Audit' | 'SerializeState';
export type MutationCommand = 'CreateCampaign' | 'RegisterParticipant' | 'CommitBatch' | 'RequestCheckpoint'
  | 'PublishCheckpoint' | 'Autosave' | 'CreateTurnAnchor' | 'ResumeCheckpointAsBranch' | 'CreateTimelineFromAnchor'
  | 'ContinueTimeline' | 'SwitchTimeline' | 'RenameSaveEntry' | 'DeleteSaveEntry' | 'RenameTimeline'
  | 'DeliverTask' | 'RequestGeneration' | 'ProcessGeneration' | 'ResumeGeneration' | 'AcceptGeneration'
  | 'RegenerateNarration' | 'SetDraft' | 'ValidateImport' | 'ActivateImportedFamily' | 'MigrateCheckpoint'
  | 'CompactHistory' | 'RecoverTimeline' | 'ResumeStorage' | 'AcquireWriter' | 'Synchronize' | 'Backup';
export type Request =
  | { command: ReadCommand; context: QueryContext; args?: JsonObject; now?: string }
  | { command: MutationCommand; context: CommandContext; args?: JsonObject; now?: string };
export interface SuccessResponse extends JsonObject { ok: true; mock: true; durable: false; }
export interface ErrorResponse extends JsonObject { ok: false; mock: true; durable: false; error: { code: string }; }
export type Response = SuccessResponse | ErrorResponse;
export interface Artifact extends JsonObject {
  id: string; content_digest: string; content_ref: string; required_kind: string;
  visibility_policy: Json; lineage_refs: string[];
}
export interface OwnerState extends JsonObject {
  family: string; schema_version: string; owner_revision: Json; state_ref: string;
  serialization_contract_ref: string; reconstruction_adapter_ref: string; invariant_contract_ref: string;
  scheduled_work_refs: string[]; migration_policy_ref: string; validation_result: Json;
  required: boolean; rebuildable: boolean;
}
export interface Frame extends JsonObject {
  owner_state_registry: Record<string, OwnerState>;
  workflow: JsonObject; task_outbox: JsonObject; creation_ledger: JsonObject;
  durable_task_metadata: JsonObject; generation_task: JsonObject;
  preserved_scheduler_state: JsonObject; preserved_resolution_state: JsonObject;
  preserved_choice_and_workflow_state: JsonObject;
}
export type StateVariable = 'campaign' | 'timeline' | 'canonical_event' | 'checkpoint' | 'save_entry'
  | 'workflow' | 'task_outbox' | 'creation_ledger' | 'artifact' | 'migration' | 'manifest'
  | 'command_context' | 'command_result_ledger' | 'operation_tracking' | 'owner_state_registry'
  | 'turn_anchor' | 'timeline_metadata' | 'writer_coordination' | 'durable_task_metadata' | 'generation_task'
  | 'preserved_scheduler_state' | 'preserved_resolution_state' | 'preserved_choice_and_workflow_state'
  | 'portability_and_maintenance' | 'durability_reporting' | 'versioned_baseline_policy' | 'noncanonical_optional_state';
export type State = { [K in StateVariable]: JsonObject };
export interface PersistenceState extends State { toJSON(): State; }
export const PersistenceState: { new(serialized?: State): PersistenceState };
export class ContractError extends Error { constructor(code: string); code: string; }
/** Dependencies must synchronously return a JSON object containing mock:true. */
export type Dependency = (request: JsonObject) => JsonObject;
export interface Dependencies {
  requestOwnerContract: Dependency; requestCharacterRelationshipKnowledge: Dependency;
  requestResolutionGeneration: Dependency; requestSystem11: Dependency; requestOtherDomains: Dependency;
  validateOwnerState: Dependency; approveOwnerMutation: Dependency; validateMigration: Dependency;
  validateNamespace: Dependency; requestSystem24Validation: Dependency; restoreOwnerState: Dependency;
  deliverOwnerTask: Dependency; requestKnownView: Dependency; requestAI: Dependency; authorizeUI: Dependency;
  publishUI: Dependency; commitStorage: Dependency; requestStorageSnapshot: Dependency;
  requestStorageRecovery: Dependency; requestStorageCapacity: Dependency; requestSync: Dependency; requestBackup: Dependency;
}
export class PersistenceSystem25 {
  constructor(options?: { state?: State; dependencies?: Partial<Dependencies> });
  stateMachine(request: Request): Response;
}
export function makeArtifact(value: Json, required_kind?: string, lineage_refs?: string[], visibility_policy?: Json): Artifact;
export function canonical(value: Json): string;
export function hash(value: Json): string;
export const FIELDS: Readonly<Record<StateVariable, readonly string[]>>;
export const FRAME_FIELDS: readonly (keyof Frame)[];
export const BASELINE: Readonly<JsonObject>;
export const MOCK_DEPENDENCIES: Readonly<Dependencies>;
export const requestOwnerContract: Dependency;
export const requestCharacterRelationshipKnowledge: Dependency;
export const requestResolutionGeneration: Dependency;
export const requestSystem11: Dependency;
export const requestOtherDomains: Dependency;
export const validateOwnerState: Dependency;
export const approveOwnerMutation: Dependency;
export const validateMigration: Dependency;
export const validateNamespace: Dependency;
export const requestSystem24Validation: Dependency;
export const restoreOwnerState: Dependency;
export const deliverOwnerTask: Dependency;
export const requestKnownView: Dependency;
export const requestAI: Dependency;
export const authorizeUI: Dependency;
export const publishUI: Dependency;
export const commitStorage: Dependency;
export const requestStorageSnapshot: Dependency;
export const requestStorageRecovery: Dependency;
export const requestStorageCapacity: Dependency;
export const requestSync: Dependency;
export const requestBackup: Dependency;
