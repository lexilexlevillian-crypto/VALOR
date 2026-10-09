/** Content definitions only. These factories never create demand, actors, stock, or cases. */
import { clone } from "./schema.mjs";

const specs = {
  bartender: {
    grammar:
      "order queue / stock / product transfer / tab settlement / station handoff",
    profile: "bar_service",
    quality: [
      "request_match",
      "service_timing",
      "station_organization",
      "tab_accuracy",
      "policy_compliance",
    ],
    inputs: [
      "order_id",
      "requested_product",
      "quantity",
      "preferences",
      "payment_ref",
      "known_restrictions",
    ],
    gates: [
      {
        owner: "legal_institutions",
        kind: "service_authorization",
        scope: "demand",
      },
    ],
    tasks: [
      ["setup", "station_condition", "inventory_security", "station_prepared"],
      ["order", "order", "demand_artifacts", "order_recorded"],
      ["serve", "order", "inventory_security", "product_transferred"],
      ["settle", "tab", "economy", "sale_settled"],
      ["close", "closing_duty", "demand_artifacts", "handoff_recorded"],
    ],
  },
  detective: {
    grammar:
      "assigned case / accessible evidence / sourced hypothesis / institutional report / case coordination",
    profile: "case_analysis",
    quality: [
      "factual_support",
      "completeness",
      "clarity",
      "timely_submission",
      "lawful_scope",
    ],
    inputs: [
      "institutional_case_id",
      "assignment_scope",
      "case_lead_ref",
      "authorized_record_refs",
      "known_lead_refs",
    ],
    gates: [
      {
        owner: "legal_institutions",
        kind: "case_authorization",
        scope: "demand",
      },
      { owner: "legal_institutions", kind: "credential", scope: "actor" },
    ],
    tasks: [
      ["review", "case_assignment", "demand_artifacts", "file_reviewed"],
      [
        "interview",
        "interview_request",
        "demand_artifacts",
        "witness_claim_submitted",
      ],
      [
        "request",
        "record_request",
        "legal_institutions",
        "record_request_submitted",
      ],
      ["report", "report_assignment", "legal_institutions", "report_submitted"],
      [
        "coordinate",
        "case_handoff",
        "legal_institutions",
        "case_handoff_submitted",
      ],
    ],
  },
  mortuary: {
    grammar:
      "service case / identity and custody verification / authorization / qualified care / service coordination",
    profile: "mortuary_workflow",
    quality: [
      "identity_authorization_integrity",
      "record_completeness",
      "service_fit",
      "technical_quality",
      "schedule_reliability",
    ],
    inputs: [
      "service_case_id",
      "identity_ref",
      "death_status_ref",
      "custody_ref",
      "authorization_ref",
      "requested_service_refs",
    ],
    gates: [
      {
        owner: "legal_institutions",
        kind: "identity_authorization",
        scope: "demand",
      },
      { owner: "legal_institutions", kind: "custody", scope: "demand" },
      { owner: "legal_institutions", kind: "credential", scope: "actor" },
    ],
    tasks: [
      ["intake", "service_request", "legal_institutions", "intake_submitted"],
      ["care", "care_authorization", "health", "care_submitted"],
      [
        "document",
        "documentation_request",
        "legal_institutions",
        "record_submitted",
      ],
      [
        "plan",
        "service_plan_request",
        "demand_artifacts",
        "service_plan_submitted",
      ],
      [
        "transport",
        "transport_request",
        "legal_institutions",
        "custody_handoff_requested",
      ],
    ],
  },
};

export function createCareerDefinitions(
  packId,
  { version = "1", role_id = packId, duration_seconds = 300 } = {},
) {
  const spec = specs[packId];
  if (!spec) throw new TypeError("Unknown career pack");
  return spec.tasks.map(([name, demand, owner, output]) => ({
    task_id: `${packId}.${name}`,
    version,
    demand_source: demand,
    role_scope: [role_id],
    inputs: [
      {
        owner: "demand_artifacts",
        kind: "demand",
        required_fields: clone(spec.inputs),
      },
    ],
    resources: [],
    methods: ["standard"],
    stages_and_checkpoints: [
      {
        stage_id: name,
        duration_seconds,
        stop_conditions: [],
        permitted_communication_scope: [],
        resource_and_cost_limits: [],
      },
    ],
    duration_policy: { version: `${packId}.duration.${version}` },
    resolution_profile: { profile_ref: spec.profile },
    quality_dimensions: clone(spec.quality),
    mandatory_gates: clone(spec.gates),
    result_mapping: {
      full: {
        terminal_state: "COMPLETED",
        remaining_scope: [],
        needs_choice: false,
      },
      partial: {
        terminal_state: "PAUSED",
        remaining_scope: [],
        needs_choice: true,
      },
      failure: {
        terminal_state: "FAILED",
        remaining_scope: [],
        needs_choice: false,
      },
      critical: {
        terminal_state: "FAILED",
        remaining_scope: [],
        needs_choice: false,
      },
    },
    outputs: [
      {
        owner,
        command_type: output,
        required: true,
        bands: ["full", "partial", "failure", "critical"],
      },
    ],
    visibility_policy: { owner: "system3", require_acquisition: true },
    failure_and_partial_policy: {
      version: `${packId}.partial.${version}`,
      preserve_original: true,
    },
    rework_and_handoff_policy: {
      version: `${packId}.rework.${version}`,
      new_effort_required: true,
    },
    learning_eligibility: {
      enabled: true,
      requires_real_demand: true,
      requires_effort: true,
      owner_caps: true,
    },
  }));
}

export function createCareerPack(
  packId,
  { version = "1", pay_policy_ref, access_map, hierarchy } = {},
) {
  const spec = specs[packId];
  if (!spec) throw new TypeError("Unknown career pack");
  return {
    pack_id: packId,
    version,
    task_definition_refs: spec.tasks.map(
      ([name]) => `${packId}.${name}@${version}`,
    ),
    partial_rework_policies: [
      `${packId}.partial.${version}`,
      `${packId}.rework.${version}`,
    ],
    handoff_workflow: `${packId}.handoff.${version}`,
    hierarchy: clone(hierarchy),
    pay_policy_ref,
    access_map: clone(access_map),
    acceptance_fixtures: [
      `${packId}.ordinary`,
      `${packId}.missing_authorization`,
      `${packId}.rework`,
    ],
    narrow_role_reason: null,
    era_year: 2012,
    supernatural: false,
    grammar: spec.grammar,
  };
}
