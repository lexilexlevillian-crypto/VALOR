/** Typed JSON interface for the isolated System 13 module. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Rational =
  | number
  | string
  | { numerator: string; denominator: string };
export interface Revision {
  kind: string;
  id: string;
  revision: number;
}
export interface Command {
  command_id: string;
  branch_id: string;
  principal_id: string;
  principal_authority_ref: string;
  operation:
    | "configure"
    | "apply"
    | "application_stage"
    | "assess"
    | "select"
    | "accept_offer"
    | "decline_offer"
    | "provision"
    | "employment_change"
    | "amend_terms"
    | "roster"
    | "call_out"
    | "decide_leave"
    | "attendance"
    | "correct_attendance"
    | "enqueue"
    | "assign"
    | "admit"
    | "execute"
    | "continue_task"
    | "transfer"
    | "cancel_task"
    | "rework"
    | "incident"
    | "review"
    | "discipline"
    | "grievance"
    | "resolve_grievance"
    | "career"
    | "accrue"
    | "approve_payroll"
    | "payroll"
    | "adjust_compensation"
    | "dispute_pay"
    | "allocate_tips"
    | "delegate"
    | "stop_routine"
    | "routine"
    | "interaction"
    | "flush_outbox"
    | "query"
    | "inspect"
    | "fork";
  payload: JsonObject;
  expected_revisions: Revision[];
  correlation_id: string;
  causation_id: string;
}
export interface Response {
  status: "accepted" | "blocked" | "rejected";
  code?: string;
  trace_id?: string;
  [field: string]: Json | undefined;
}
export interface OwnerResponse extends JsonObject {
  status: "accepted" | "rejected" | "pending";
  canonical_event_refs: string[];
  validated_payload: JsonObject;
}
export class FixedOwnerStubs {
  constructor(fixtures?: {
    snapshots?: Record<string, OwnerResponse>;
    replies?: Record<string, OwnerResponse>;
  });
  read(owner: string): OwnerResponse;
  request(owner: string, request: JsonObject): OwnerResponse;
  lookup(owner: string, request: JsonObject): OwnerResponse;
}
export class JobsEngine {
  constructor(options: {
    filename?: string;
    world_id: string;
    branch_id: string;
    owners?: FixedOwnerStubs;
    fault?: ((checkpoint: string) => void) | null;
  });
  dispatch(command: Command): Response;
  close(): void;
}
export class JobsState {
  constructor(snapshot?: Record<string, JsonObject[]> | null);
  employment_contract: JsonObject[];
  work_task: JsonObject[];
  work_receipt: JsonObject[];
  event_context: JsonObject[];
  organization: JsonObject[];
  contract_terms: JsonObject[];
  vacancy: JsonObject[];
  application_and_assessment: JsonObject[];
  offer: JsonObject[];
  onboarding: JsonObject[];
  staffing_and_assignments: JsonObject[];
  attendance: JsonObject[];
  task_definition: JsonObject[];
  task_execution: JsonObject[];
  quality_and_incidents: JsonObject[];
  performance_and_review: JsonObject[];
  discipline_and_grievance: JsonObject[];
  career_edge: JsonObject[];
  compensation: JsonObject[];
  tip_and_commission_allocation: JsonObject[];
  routine_delegation: JsonObject[];
  integration_and_recovery: JsonObject[];
  toJSON(): Record<string, JsonObject[]>;
}
export class RuleError extends Error {
  code: string;
  constructor(code: string, detail?: string);
}
export function canonical(value: Json): string;
export function stableId(...parts: Json[]): string;
export function ownerKey(
  world: string,
  branch: string,
  owner: string,
  operation: string,
  source: string,
): string;
export function hourlyEntitlement(
  rateCentsPerHour: number,
  payableSeconds: Rational,
  carry?: Rational,
): { cents: number; fractional_remainder: Rational };
export function allocateTipPool(
  poolCents: number,
  participants: Array<{
    participant_id: string;
    eligible_service_seconds: Rational;
    role_weight: Rational;
  }>,
): JsonObject[];
export function createCareerDefinitions(
  packId: "bartender" | "detective" | "mortuary",
  options?: { version?: string; role_id?: string; duration_seconds?: number },
): JsonObject[];
export function createCareerPack(
  packId: "bartender" | "detective" | "mortuary",
  options: {
    version?: string;
    pay_policy_ref: string;
    access_map: Json[];
    hierarchy: Json[];
  },
): JsonObject;
export function validateRecord(kind: string, record: JsonObject): JsonObject;
export function validateOrganization(record: JsonObject): JsonObject;
export function validateDefinition(record: JsonObject): JsonObject;
export function validatePack(
  pack: JsonObject,
  definitions: JsonObject[],
): JsonObject;
export const SCHEMAS: Readonly<Record<string, JsonObject>>;
export const OWNER_STUBS: Readonly<Record<string, () => OwnerResponse>>;
export function requestSystem1(): OwnerResponse;
export function requestSystem2(): OwnerResponse;
export function requestSystem3(): OwnerResponse;
export function requestSystem4(): OwnerResponse;
export function requestSystem5(): OwnerResponse;
export function requestSystem6(): OwnerResponse;
export function requestSystem7(): OwnerResponse;
export function requestSystem8(): OwnerResponse;
export function requestSystem9(): OwnerResponse;
export function requestSystem10(): OwnerResponse;
export function requestSystem11(): OwnerResponse;
export function requestSystem12(): OwnerResponse;
export function requestEconomy(): OwnerResponse;
export function requestInventorySecurity(): OwnerResponse;
export function requestHealth(): OwnerResponse;
export function requestLegalInstitutions(): OwnerResponse;
export function requestDemandArtifacts(): OwnerResponse;
