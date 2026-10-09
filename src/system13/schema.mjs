/** System 13 data contracts. No foreign-domain state is stored here. */
export class RuleError extends Error {
  constructor(code, detail = code) {
    super(detail);
    this.name = "RuleError";
    this.code = code;
  }
}
export function requireRule(condition, code, detail) {
  if (!condition) throw new RuleError(code, detail);
}
export const clone = (value) => structuredClone(value);
export const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function json(value, depth = 0) {
  requireRule(depth <= 64, "JSON_TOO_DEEP");
  requireRule(value !== undefined, "INVALID_JSON");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    requireRule(
      Number.isSafeInteger(value),
      "INVALID_JSON",
      "Use safe integers or rational strings.",
    );
    return;
  }
  requireRule(
    Array.isArray(value) ||
      (isObject(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value))),
    "INVALID_JSON",
  );
  if (Array.isArray(value)) value.forEach((child) => json(child, depth + 1));
  else
    for (const [key, child] of Object.entries(value)) {
      requireRule(
        !["__proto__", "prototype", "constructor"].includes(key),
        "INVALID_FIELD",
      );
      json(child, depth + 1);
    }
}
export function exact(value, required, optional = []) {
  requireRule(isObject(value), "INVALID_RECORD");
  const allowed = new Set([...required, ...optional]);
  requireRule(
    Object.keys(value).every((key) => allowed.has(key)),
    "UNKNOWN_FIELD",
  );
  requireRule(
    required.every((key) => Object.hasOwn(value, key)),
    "MISSING_FIELD",
  );
}
export const text = (value) =>
  requireRule(typeof value === "string" && value.length > 0, "INVALID_STRING");
export const integer = (value, minimum = 0) =>
  requireRule(
    Number.isSafeInteger(value) && value >= minimum,
    "INVALID_INTEGER",
  );
export function interval(value) {
  exact(value, ["start_ms", "end_ms"]);
  integer(value.start_ms);
  requireRule(
    value.end_ms === null ||
      (Number.isSafeInteger(value.end_ms) && value.end_ms > value.start_ms),
    "INVALID_INTERVAL",
  );
}
export const overlaps = (a, b) =>
  a.start_ms < (b.end_ms ?? Infinity) && b.start_ms < (a.end_ms ?? Infinity);
export const covers = (a, b) =>
  a.start_ms <= b.start_ms && (a.end_ms ?? Infinity) >= (b.end_ms ?? Infinity);

const S = "string",
  I = "integer",
  B = "boolean",
  A = "array",
  O = "object",
  J = "json";
const nullable = (type) => [type, null];
const enumeration = (values) => ({ enum: values.split("|") });
export const EMPLOYMENT =
  "APPLICANT|OFFERED|ACTIVE|PROBATIONARY|ON_LEAVE|SUSPENDED|NOTICE_PERIOD|ENDED|REJECTED|WITHDRAWN";
export const TASKS =
  "QUEUED|ASSIGNED|ADMITTED|ACTIVE|PAUSED|COMPLETED|FAILED|CANCELLED|TRANSFERRED";
export const AUTHORITY = [
  "assign_work",
  "approve_leave",
  "evaluate_work",
  "authorize_overtime",
  "discipline",
  "terminate",
  "hire",
  "access_admin",
  "payroll_approve",
];
export const SCHEMAS = Object.freeze({
  employment_contract: {
    contract_id: S,
    character_id: S,
    employer_id: S,
    role_slot_id: S,
    terms_version: S,
    start_ms: I,
    end_ms: nullable(I),
    status: enumeration(EMPLOYMENT),
    revision: I,
  },
  work_task: {
    task_id: S,
    definition_id: S,
    definition_version: S,
    demand_source_id: S,
    assigned_contract_id: nullable(S),
    state: enumeration(TASKS),
    artifact_ref: S,
    work_cycle_index: I,
    revision: I,
  },
  work_receipt: {
    receipt_id: S,
    task_id: S,
    character_id: S,
    source_event_id: S,
    effort_json: S,
    quality_json: S,
  },
  event_context: {
    world_id: S,
    branch_id: S,
    sequence: I,
    simulation_time_ms: I,
    schema_version: S,
    ruleset_version: S,
    principal_id: S,
    principal_authority_ref: S,
    command_id: S,
    correlation_id: S,
    causation_id: S,
    disclosure: O,
    superseded_event_ref: nullable(S),
  },
  organization: {
    employer_id: S,
    workplace_id: S,
    site_refs: A,
    departments: A,
    role_definitions: A,
    role_slots: A,
    role_assignments: A,
    reporting_edges: A,
    authority_scopes: A,
    deputy_authorizations: A,
    operational_policy_versions: A,
  },
  contract_terms: {
    version: S,
    site_ref: S,
    duties: A,
    compensation_policy_ref: S,
    schedule_policy_ref: S,
    probation_policy_ref: S,
    leave_policy_ref: S,
    call_out_policy_ref: S,
    discipline_policy_ref: S,
    confidentiality_scopes: A,
    access_scopes: A,
    prerequisite_refs: A,
    acceptance_ref: S,
    amendments: A,
    end_reason: nullable(S),
  },
  vacancy: {
    vacancy_id: S,
    employer_id: S,
    role_slot_id: S,
    capacity: I,
    budget_ref: S,
    requirements: A,
    hiring_authority_ref: S,
    application_window: O,
    posting_channels: A,
    publication_evidence_refs: A,
    selection_policy_version: S,
    tie_policy_ref: S,
    persisted_tie_result_ref: nullable(S),
    revision: I,
  },
  application_and_assessment: {
    application_id: S,
    vacancy_id: S,
    character_id: S,
    state: enumeration(
      "DRAFT|SUBMITTED|SCREENING|INTERVIEW|ASSESSMENT|DECIDED|WITHDRAWN",
    ),
    lineage_ref: S,
    revision: I,
    identity_claim_refs: A,
    experience_claim_refs: A,
    verified_evidence_refs: A,
    credential_verification_refs: A,
    reference_claim_refs: A,
    supplied_availability: A,
    appointment_refs: A,
    assessment_artifact_refs: A,
    eligibility: enumeration("PASS|BLOCKED|UNVERIFIED"),
    task_demonstration_score: nullable(I),
    experience_score: nullable(I),
    schedule_score: nullable(I),
    hard_schedule_conflict: B,
    reference_score: nullable(I),
    reference_confidence: J,
    rubric_total: nullable(I),
    subjective_influences: A,
    decision_ref: nullable(S),
    decision_communication_refs: A,
  },
  offer: {
    offer_id: S,
    application_id: S,
    frozen_terms_version: S,
    required_onboarding_line_ids: A,
    authorized_decision_ref: S,
    acceptance_or_rejection_ref: nullable(S),
  },
  onboarding: {
    contract_id: S,
    state: enumeration("PREPARED|COMMITTING|COMPLETE|RECOVERY_REQUIRED"),
    lines: A,
  },
  staffing_and_assignments: {
    schedule_rule_version: S,
    shift_ref: S,
    minimum_role_coverage: A,
    station_requirements: A,
    qualification_requirements: A,
    break_and_rest_policy_refs: A,
    workload_limits: O,
    known_availability_refs: A,
    approved_leave_refs: A,
    roster_revision: I,
    publication_and_notice_refs: A,
    assignment_intervals: A,
    controlling_instruction_refs: A,
    resource_reservation_refs: A,
    conflicts: A,
    handoff_refs: A,
  },
  attendance: {
    contract_id: S,
    shift_ref: S,
    absence_lineage_ref: nullable(S),
    presence_receipt_refs: A,
    check_in_receipt_refs: A,
    arrival_ms: nullable(I),
    departure_ms: nullable(I),
    effort_coverage_refs: A,
    notice_evidence_refs: A,
    call_out_channel_ref: nullable(S),
    supplied_explanation_ref: nullable(S),
    leave_request_ref: nullable(S),
    leave_decision_ref: nullable(S),
    interpretation: S,
    missed_effort: J,
    dispute_and_correction_refs: A,
  },
  task_definition: {
    task_id: S,
    version: S,
    demand_source: S,
    role_scope: A,
    inputs: A,
    resources: A,
    methods: A,
    stages_and_checkpoints: A,
    duration_policy: O,
    resolution_profile: O,
    quality_dimensions: A,
    mandatory_gates: A,
    result_mapping: O,
    outputs: A,
    visibility_policy: O,
    failure_and_partial_policy: O,
    rework_and_handoff_policy: O,
    learning_eligibility: O,
  },
  task_execution: {
    task_id: S,
    method_id: S,
    current_stage: S,
    progress: O,
    remaining_scope: A,
    queue_priority: I,
    deadline_ref: nullable(S),
    expected_artifact_revisions: A,
    accepted_artifact_revisions: A,
    authorization_ref: S,
    reservation_refs: A,
    capability_result_receipt_ref: nullable(S),
    time_effort_receipt_refs: A,
    presence_receipt_refs: A,
    achieved_output_receipt_refs: A,
    pending_choice_refs: A,
    predecessor_or_rework_task_refs: A,
    responsibility_intervals: A,
    unresolved_issue_refs: A,
    learning_receipt_refs: A,
  },
  quality_and_incidents: {
    true_quality: O,
    observed_evidence_refs: A,
    incident_id: S,
    task_and_artifact_refs: A,
    objective_fault_ref: nullable(S),
    actual_impact_receipt_refs: A,
    estimated_impact: J,
    severity: enumeration(
      "routine rework|service/administrative impact|material loss|safety/privacy impact|major regulated incident",
    ),
    detection_source_refs: A,
    known_observer_refs: A,
    attribution_claims: A,
    containment_request_refs: A,
    review_status: S,
    remedy_task_and_receipt_refs: A,
    duplicate_report_refs: A,
  },
  performance_and_review: {
    performance_evidence_id: S,
    worker_ref: S,
    source_receipt_refs: A,
    work_context_ref: S,
    review_id: S,
    review_window: O,
    evaluator_ref: S,
    evaluator_known_evidence_refs: A,
    components: A,
    component_scores: O,
    confidence: J,
    sample_size: I,
    distinct_context_count: I,
    evidence_sufficient: B,
    weighting_policy_version: S,
    subjective_adjustments: A,
    finding_refs: A,
    communication_refs: A,
    appeal_and_correction_refs: A,
  },
  discipline_and_grievance: {
    case_id: S,
    contract_id: S,
    incident_and_evidence_refs: A,
    decision_authority_ref: S,
    policy_version: S,
    action: enumeration(
      "coaching|warning|restricted duty|suspension|termination",
    ),
    effective_interval: O,
    pay_policy_ref: nullable(S),
    decision_ref: nullable(S),
    grievance_submission_ref: nullable(S),
    reviewer_authority_ref: nullable(S),
    deadline_refs: A,
    appeal_decision_ref: nullable(S),
  },
  career_edge: {
    edge_id: S,
    source_role_ref: S,
    target_role_ref: S,
    credential_requirements: A,
    task_evidence_requirements: A,
    experience_interval_requirement: O,
    vacancy_and_authority_requirements: A,
    availability_requirements: A,
    assessment_policy_ref: S,
    reassessment_policy_ref: S,
    decision_ref: nullable(S),
    accepted_terms_ref: nullable(S),
  },
  compensation: {
    entitlement_id: S,
    contract_id: S,
    terms_version: S,
    source_refs: A,
    period_id: S,
    method: enumeration(
      "hourly|salary|per accepted task/output|commission|explicit combination",
    ),
    currency: S,
    currency_precision: I,
    rate_cents_per_hour: nullable(I),
    payable_seconds: J,
    salary_period_amount: nullable(I),
    per_output_rate: nullable(I),
    commission_policy_ref: nullable(S),
    paid_time_and_leave_policy_ref: S,
    rounding_and_carry_policy_ref: S,
    fractional_remainder: J,
    approved_adjustment_lines: A,
    gross_entitlement: I,
    net_owed: J,
    actual_settled_amount: I,
    payroll_state: enumeration(
      "ACCRUED|APPROVED|REQUESTED|SETTLED|DISPUTED|RECOVERY_REQUIRED",
    ),
    payroll_request_ref: nullable(S),
    economy_receipt_refs: A,
    dispute_refs: A,
  },
  tip_and_commission_allocation: {
    source_transfer_or_sale_refs: A,
    revenue_type: enumeration(
      "direct tip|tip pool|sales commission|service charge|refund/reversal",
    ),
    ownership_and_eligibility_policy_ref: S,
    pool_amount_cents: nullable(I),
    participants: A,
    exclusion_and_refund_policy_ref: nullable(S),
    adjustment_receipt_refs: A,
  },
  routine_delegation: {
    delegation_ref: S,
    actor_ref: S,
    role_ref: S,
    eligible_task_types: A,
    permitted_methods: A,
    authorization_horizon_ms: I,
    resource_and_cost_limits: A,
    location_scope: A,
    permitted_communication_scope: A,
    stop_conditions: A,
    pending_choice_refs: A,
    aggregate_receipt_refs: A,
  },
  integration_and_recovery: {
    command_id: S,
    expected_revisions: A,
    owner_requests: A,
    execution_saga_state: enumeration(
      "PREPARED|COMMITTING|COMMITTED|BLOCKED|ABORTED",
    ),
    outbox_entries: A,
    outbox_cursor: I,
    recovery_checkpoint_ref: nullable(S),
    trace_id: S,
    evaluated_predicates: A,
    blocked_or_rejected_reasons: A,
  },
});
function checkType(value, type) {
  if (Array.isArray(type)) {
    if (value === null && type.includes(null)) return;
    return checkType(value, type[0]);
  }
  if (isObject(type)) {
    requireRule(type.enum.includes(value), "INVALID_ENUM");
    return;
  }
  if (type === S) text(value);
  else if (type === I) integer(value);
  else if (type === B)
    requireRule(typeof value === "boolean", "INVALID_BOOLEAN");
  else if (type === A) requireRule(Array.isArray(value), "INVALID_ARRAY");
  else if (type === O) requireRule(isObject(value), "INVALID_OBJECT");
  else json(value);
}
export function validateRecord(kind, record) {
  const schema = SCHEMAS[kind];
  requireRule(schema, "UNKNOWN_RECORD");
  json(record);
  exact(record, Object.keys(schema));
  for (const [key, type] of Object.entries(schema))
    checkType(record[key], type);
  if (kind === "employment_contract")
    interval({ start_ms: record.start_ms, end_ms: record.end_ms });
  if (kind === "application_and_assessment") {
    for (const [field, max] of [
      ["task_demonstration_score", 4],
      ["experience_score", 3],
      ["schedule_score", 3],
      ["reference_score", 2],
      ["rubric_total", 12],
    ])
      requireRule(
        record[field] === null || record[field] <= max,
        "INVALID_SCORE",
      );
  }
  for (const field of ["true_quality", "component_scores"])
    if (record[field]) {
      for (const score of Object.values(record[field])) {
        integer(score);
        requireRule(score <= 4, "INVALID_SCORE");
      }
    }
  if (kind === "onboarding")
    for (const line of record.lines) {
      exact(line, [
        "line_id",
        "owner",
        "preconditions",
        "required",
        "idempotency_key",
        "owner_receipt_ref",
      ]);
      text(line.line_id);
      text(line.owner);
      text(line.idempotency_key);
      requireRule(
        typeof line.required === "boolean" && Array.isArray(line.preconditions),
        "INVALID_PROVISIONING",
      );
    }
  return record;
}

/** All own properties are exactly the state categories from the supplied architecture. */
export class JobsState {
  constructor(snapshot = null) {
    if (snapshot) exact(snapshot, Object.keys(SCHEMAS));
    for (const kind of Object.keys(SCHEMAS)) {
      const records = snapshot ? clone(snapshot[kind]) : [];
      requireRule(Array.isArray(records), "INVALID_STATE");
      records.forEach((record) => validateRecord(kind, record));
      this[kind] = records;
    }
    Object.seal(this);
  }
  toJSON() {
    return Object.fromEntries(
      Object.keys(SCHEMAS).map((kind) => [kind, clone(this[kind])]),
    );
  }
}
