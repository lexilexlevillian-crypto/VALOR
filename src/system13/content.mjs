import {
  AUTHORITY,
  exact,
  interval,
  overlaps,
  requireRule,
  text,
  integer,
  validateRecord,
} from "./schema.mjs";
import { OWNER_STUBS } from "./owners.mjs";

export function validateOrganization(org) {
  validateRecord("organization", org);
  requireRule(
    org.authority_scopes.every((s) => AUTHORITY.includes(s)),
    "INVALID_AUTHORITY",
  );
  const roles = new Set(org.role_definitions.map((r) => r.role_id));
  requireRule(roles.size === org.role_definitions.length, "DUPLICATE_ROLE");
  const slots = new Set();
  for (const slot of org.role_slots) {
    exact(slot, ["role_slot_id", "role_id", "capacity", "budget_ref"]);
    text(slot.role_slot_id);
    integer(slot.capacity, 1);
    text(slot.budget_ref);
    requireRule(
      roles.has(slot.role_id) && !slots.has(slot.role_slot_id),
      "INVALID_ROLE_SLOT",
    );
    slots.add(slot.role_slot_id);
  }
  const policyIds = new Set();
  for (const role of org.role_definitions) {
    exact(role, ["role_id", "version", "duties", "policies", "pack"]);
    text(role.version);
    requireRule(
      Array.isArray(role.duties) && Array.isArray(role.policies),
      "INVALID_ROLE",
    );
    for (const policy of role.policies) {
      text(policy.version);
      text(policy.kind);
      requireRule(!policyIds.has(policy.version), "DUPLICATE_POLICY");
      policyIds.add(policy.version);
    }
  }
  for (const grant of [...org.role_assignments, ...org.deputy_authorizations]) {
    exact(grant, [
      "character_id",
      "role_slot_id",
      "scopes",
      "effective_interval",
      "authority_ref",
    ]);
    text(grant.character_id);
    text(grant.authority_ref);
    interval(grant.effective_interval);
    requireRule(
      slots.has(grant.role_slot_id) &&
        grant.scopes.every((s) => AUTHORITY.includes(s)),
      "INVALID_AUTHORITY",
    );
  }
  const boundaries = new Set();
  for (const edge of org.reporting_edges) {
    exact(edge, [
      "supervisor_id",
      "subordinate_id",
      "scopes",
      "effective_interval",
    ]);
    interval(edge.effective_interval);
    requireRule(
      edge.scopes.every((s) => AUTHORITY.includes(s)),
      "INVALID_AUTHORITY",
    );
    boundaries.add(edge.effective_interval.start_ms);
    if (edge.effective_interval.end_ms !== null)
      boundaries.add(edge.effective_interval.end_ms);
  }
  for (const time of boundaries) {
    const graph = new Map();
    for (const edge of org.reporting_edges)
      if (
        overlaps(edge.effective_interval, { start_ms: time, end_ms: time + 1 })
      ) {
        if (!graph.has(edge.supervisor_id)) graph.set(edge.supervisor_id, []);
        graph.get(edge.supervisor_id).push(edge.subordinate_id);
      }
    const visiting = new Set(),
      done = new Set();
    const visit = (node) => {
      requireRule(!visiting.has(node), "MANAGERIAL_CYCLE");
      if (done.has(node)) return;
      visiting.add(node);
      for (const child of graph.get(node) ?? []) visit(child);
      visiting.delete(node);
      done.add(node);
    };
    for (const node of graph.keys()) visit(node);
  }
  return org;
}

export function validateDefinition(definition) {
  validateRecord("task_definition", definition);
  requireRule(
    definition.inputs.length > 0 &&
      definition.stages_and_checkpoints.length > 0,
    "INVALID_TASK_DEFINITION",
  );
  requireRule(
    definition.role_scope.length > 0 && definition.methods.length > 0,
    "INVALID_TASK_DEFINITION",
  );
  const ids = new Set();
  for (const stage of definition.stages_and_checkpoints) {
    exact(stage, [
      "stage_id",
      "duration_seconds",
      "stop_conditions",
      "permitted_communication_scope",
      "resource_and_cost_limits",
    ]);
    text(stage.stage_id);
    integer(stage.duration_seconds, 1);
    requireRule(!ids.has(stage.stage_id), "DUPLICATE_STAGE");
    ids.add(stage.stage_id);
  }
  for (const gate of definition.mandatory_gates) {
    exact(gate, ["owner", "kind", "scope"]);
    requireRule(Object.hasOwn(OWNER_STUBS, gate.owner), "UNKNOWN_OWNER");
    requireRule(
      ["actor", "contract", "demand"].includes(gate.scope),
      "INVALID_GATE",
    );
    text(gate.kind);
  }
  for (const input of definition.inputs) {
    exact(input, ["owner", "kind", "required_fields"]);
    requireRule(Object.hasOwn(OWNER_STUBS, input.owner), "UNKNOWN_OWNER");
    requireRule(Array.isArray(input.required_fields), "INVALID_INPUT");
  }
  for (const output of definition.outputs) {
    exact(output, ["owner", "command_type", "required", "bands"]);
    requireRule(
      Object.hasOwn(OWNER_STUBS, output.owner) &&
        typeof output.required === "boolean",
      "INVALID_OUTPUT",
    );
    requireRule(
      ["full", "partial", "failure", "critical"].every((b) =>
        Object.hasOwn(definition.result_mapping, b),
      ),
      "INVALID_RESULT_MAPPING",
    );
  }
  requireRule(
    definition.outputs.some((o) => o.required),
    "MISSING_OUTPUT_OWNER",
  );
  for (const [band, mapping] of Object.entries(definition.result_mapping)) {
    requireRule(
      ["full", "partial", "failure", "critical"].includes(band),
      "INVALID_RESULT_MAPPING",
    );
    exact(mapping, ["terminal_state", "remaining_scope", "needs_choice"]);
    requireRule(
      ["COMPLETED", "FAILED", "PAUSED"].includes(mapping.terminal_state),
      "INVALID_RESULT_MAPPING",
    );
    requireRule(
      typeof mapping.needs_choice === "boolean" &&
        Array.isArray(mapping.remaining_scope),
      "INVALID_RESULT_MAPPING",
    );
  }
  requireRule(
    new Set(definition.quality_dimensions).size ===
      definition.quality_dimensions.length,
    "INVALID_RUBRIC",
  );
  text(definition.resolution_profile.profile_ref);
  text(definition.duration_policy.version);
  return definition;
}

/** Pack data lives inside a versioned organization role definition, not a new state category. */
export function validatePack(pack, definitions) {
  exact(pack, [
    "pack_id",
    "version",
    "task_definition_refs",
    "partial_rework_policies",
    "handoff_workflow",
    "hierarchy",
    "pay_policy_ref",
    "access_map",
    "acceptance_fixtures",
    "narrow_role_reason",
    "era_year",
    "supernatural",
    "grammar",
  ]);
  requireRule(
    pack.era_year === 2012 && pack.supernatural === false,
    "INVALID_WORLD_CONTENT",
  );
  requireRule(
    pack.task_definition_refs.length >= 5 ||
      (typeof pack.narrow_role_reason === "string" &&
        pack.narrow_role_reason.trim().length > 0),
    "INSUFFICIENT_TASK_TYPES",
  );
  requireRule(
    pack.partial_rework_policies.length >= 2 &&
      pack.handoff_workflow &&
      pack.hierarchy.length &&
      pack.access_map.length &&
      pack.acceptance_fixtures.length,
    "INCOMPLETE_PACK",
  );
  text(pack.pay_policy_ref);
  text(pack.grammar);
  for (const ref of pack.task_definition_refs)
    requireRule(
      definitions.some((d) => `${d.task_id}@${d.version}` === ref),
      "MISSING_DEFINITION",
    );
  return pack;
}
