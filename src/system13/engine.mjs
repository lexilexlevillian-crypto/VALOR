/**
 * Isolated Jobs, Workplaces & Career state machine (Node.js 24+).
 * dispatch accepts/returns JSON dictionaries. Infrastructure references are private;
 * JobsState contains only the supplied architecture's state variables.
 */
import { createHash } from "node:crypto";
import {
  JobsState,
  RuleError,
  requireRule as must,
  clone,
  json,
  exact,
  text,
  integer,
  interval,
  overlaps,
  covers,
  validateRecord,
} from "./schema.mjs";
import { FixedOwnerStubs, OWNER_STUBS } from "./owners.mjs";
import { JobsStore } from "./store.mjs";
import {
  validateOrganization,
  validateDefinition,
  validatePack,
} from "./content.mjs";
import {
  rational,
  add,
  multiply,
  divide,
  asJSON,
  safeNumber,
  roundHalfUp,
  allocateTipPool,
} from "./money.mjs";

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const stableId = (...parts) =>
  createHash("sha256").update(canonical(parts)).digest("hex");
export const ownerKey = (world, branch, owner, operation, source) =>
  stableId(world, branch, owner, operation, source);
const ACTUAL_WORK = ["ACTIVE", "PROBATIONARY", "NOTICE_PERIOD"];
const OCCUPIED = [
  "OFFERED",
  "ACTIVE",
  "PROBATIONARY",
  "ON_LEAVE",
  "SUSPENDED",
  "NOTICE_PERIOD",
];
const FINAL_TASK = ["COMPLETED", "FAILED", "CANCELLED", "TRANSFERRED"];
const MATERIAL = [
  "new_risk",
  "changed_terms",
  "overtime",
  "disclosure",
  "discipline_response",
  "conflict",
  "unusual_purchase",
  "boundary_sensitive_contact",
  "new_commitment",
];
const KEYS = {
  employment_contract: "contract_id",
  work_task: "task_id",
  work_receipt: "receipt_id",
  organization: "employer_id",
  contract_terms: "version",
  vacancy: "vacancy_id",
  application_and_assessment: "application_id",
  offer: "offer_id",
  onboarding: "contract_id",
  staffing_and_assignments: "shift_ref",
  task_definition: "task_id",
  task_execution: "task_id",
  quality_and_incidents: "incident_id",
  performance_and_review: "review_id",
  discipline_and_grievance: "case_id",
  career_edge: "edge_id",
  compensation: "entitlement_id",
  routine_delegation: "delegation_ref",
};
const PAYLOADS = {
  configure: [
    [
      "organizations",
      "task_definitions",
      "contract_terms",
      "vacancies",
      "career_edges",
    ],
  ],
  apply: [
    [
      "application_id",
      "vacancy_id",
      "character_id",
      "lineage_ref",
      "identity_claim_refs",
      "experience_claim_refs",
      "reference_claim_refs",
      "supplied_availability",
    ],
  ],
  application_stage: [["application_id", "state"]],
  assess: [["application_id", "assessment_ref"]],
  select: [["vacancy_id", "terms_version", "onboarding_line_ids"]],
  accept_offer: [
    ["offer_id", "contract_id", "start_ms", "end_ms", "onboarding_lines"],
  ],
  decline_offer: [["offer_id"]],
  provision: [["contract_id"]],
  employment_change: [["contract_id", "status", "decision_ref"]],
  amend_terms: [["contract_id", "terms_version", "decision_ref"]],
  roster: [["employer_id", "record"]],
  call_out: [["contract_id", "shift_ref", "channel_ref", "explanation_ref"]],
  decide_leave: [["contract_id", "shift_ref", "decision_ref"]],
  attendance: [["contract_id", "shift_ref"]],
  enqueue: [
    ["definition_id", "definition_version", "demand_source_id", "artifact_ref"],
  ],
  assign: [["task_id", "contract_id"]],
  admit: [["task_id", "method_id"], ["delegation_ref"]],
  execute: [["task_id"], ["delegation_ref"]],
  continue_task: [["task_id", "choice_refs"], ["delegation_ref"]],
  transfer: [["task_id", "target_contract_id", "handoff_ref"]],
  cancel_task: [["task_id", "decision_ref"]],
  rework: [["task_id", "authorization_ref"]],
  incident: [["record"]],
  review: [["record"]],
  discipline: [["record"]],
  grievance: [["case_id", "submission_ref"]],
  resolve_grievance: [["case_id", "decision_ref"]],
  career: [["edge_id", "contract_id", "vacancy_id", "decision_ref"]],
  accrue: [["contract_id", "period_id", "source_refs"], ["terms_version"]],
  approve_payroll: [["entitlement_id"]],
  payroll: [["entitlement_id"]],
  adjust_compensation: [["entitlement_id", "adjustment_ref"]],
  dispute_pay: [["entitlement_id", "dispute_ref"]],
  allocate_tips: [
    ["contract_id", "transfer_refs", "policy_ref", "coverage_refs"],
  ],
  delegate: [["record"]],
  stop_routine: [["delegation_ref"]],
  routine: [["delegation_ref", "task_ids"]],
  correct_attendance: [["contract_id", "shift_ref", "correction_ref"]],
  interaction: [
    [
      "event_ref",
      "actor_ref",
      "source_refs",
      "channel_ref",
      "recipient_refs",
      "kind",
    ],
  ],
  flush_outbox: [[]],
  query: [["kind", "id"]],
  inspect: [[]],
  fork: [["target_branch_id"]],
};

export class JobsEngine {
  #store;
  #owners;
  #world;
  #branch;
  #state;
  #command;
  #journal;
  #principal;
  #now;
  #fault;
  constructor({
    filename = ":memory:",
    world_id,
    branch_id,
    owners = new FixedOwnerStubs(),
    fault = null,
  }) {
    text(world_id);
    text(branch_id);
    must(owners instanceof FixedOwnerStubs, "INVALID_STUBS");
    this.#world = world_id;
    this.#branch = branch_id;
    this.#owners = owners;
    this.#fault = fault;
    this.#store = new JobsStore(filename);
    this.#state = new JobsState();
  }
  close() {
    this.#store.close();
  }
  #record(kind, id, optional = false) {
    const record = this.#state[kind]?.find((r) => r[KEYS[kind]] === id);
    must(record || optional, "UNKNOWN_RECORD");
    return record;
  }
  #put(kind, record) {
    validateRecord(kind, record);
    this.#state[kind].push(record);
    return record;
  }
  #save(label) {
    this.#store.save(this.#world, this.#branch, this.#state);
    if (this.#fault) this.#fault(label);
  }
  #predicate(name, result, source) {
    this.#journal.evaluated_predicates.push({
      predicate: name,
      result: clone(result),
      source,
    });
  }
  #memo(name) {
    return this.#journal.evaluated_predicates.findLast(
      (p) => p.predicate === name,
    )?.result;
  }
  #proof(owner, ref, kind) {
    const snapshot = this.#owners.read(owner);
    must(snapshot.status === "accepted", "OWNER_UNAVAILABLE");
    const proof = snapshot.validated_payload?.proofs?.[ref];
    must(proof, "MISSING_EVIDENCE");
    must(
      proof.kind === kind &&
        proof.world_id === this.#world &&
        proof.branch_id === this.#branch,
      "INVALID_OWNER_PROOF",
    );
    must(
      proof.source_ref === ref &&
        Array.isArray(proof.canonical_event_refs) &&
        proof.canonical_event_refs.length > 0,
      "INVALID_OWNER_PROOF",
    );
    return clone(proof);
  }
  #known(actor, ref) {
    const p = this.#proof("system3", `${actor}:${ref}`, "knowledge");
    must(p.known === true && p.acquisition_ref, "UNKNOWN_INFORMATION");
    return p;
  }
  #intent(actor, source, operation = this.#command.operation) {
    const owner = this.#principal.actor_type === "NPC" ? "system6" : "system1";
    const p = this.#proof(owner, this.#command.causation_id, "intent");
    must(
      p.command_id === this.#command.command_id &&
        p.principal_id === this.#command.principal_id &&
        p.actor_ref === actor &&
        p.operation === operation &&
        p.subject_ref === source,
      "NEEDS_CHOICE",
    );
    must(
      p.authorized === true &&
        p.payload_hash === stableId(this.#command.payload),
      "NEEDS_CHOICE",
    );
    return p;
  }
  #authority(employer, scope) {
    const org = this.#record("organization", employer);
    const grant = [...org.role_assignments, ...org.deputy_authorizations].find(
      (g) =>
        g.character_id === this.#principal.actor_ref &&
        g.authority_ref === this.#command.principal_authority_ref &&
        g.scopes.includes(scope) &&
        covers(g.effective_interval, {
          start_ms: this.#now,
          end_ms: this.#now + 1,
        }),
    );
    must(grant, "AUTHORITY_DENIED");
    const employments = this.#state.employment_contract.filter(
      (c) =>
        c.character_id === grant.character_id && c.employer_id === employer,
    );
    must(
      employments.length === 0 ||
        employments.some(
          (c) =>
            ACTUAL_WORK.includes(c.status) &&
            covers(c, { start_ms: this.#now, end_ms: this.#now + 1 }),
        ),
      "AUTHORITY_DENIED",
    );
    return grant;
  }
  #admin() {
    must(
      this.#principal.scopes.includes("creator") &&
        this.#command.principal_authority_ref === this.#principal.authority_ref,
      "AUTHORITY_DENIED",
    );
  }
  #policy(contract, ref) {
    const org = this.#record("organization", contract.employer_id);
    const policy = org.role_definitions
      .flatMap((r) => r.policies)
      .find((p) => p.version === ref);
    must(policy, "MISSING_POLICY");
    return policy;
  }
  #role(contract) {
    const org = this.#record("organization", contract.employer_id);
    const slot = org.role_slots.find(
      (s) => s.role_slot_id === contract.role_slot_id,
    );
    must(slot, "INELIGIBLE_ROLE");
    return {
      org,
      slot,
      role: org.role_definitions.find((r) => r.role_id === slot.role_id),
    };
  }
  #capacity(employer, slotId, span, excluding = null) {
    const org = this.#record("organization", employer),
      slot = org.role_slots.find((s) => s.role_slot_id === slotId);
    must(slot, "NO_VACANCY");
    const others = this.#state.employment_contract.filter(
      (c) =>
        c.contract_id !== excluding &&
        c.employer_id === employer &&
        c.role_slot_id === slotId &&
        [...OCCUPIED, "ENDED"].includes(c.status) &&
        overlaps(c, span),
    );
    const boundaries = new Set([
      span.start_ms,
      ...others.map((c) => Math.max(c.start_ms, span.start_ms)),
    ]);
    must(
      [...boundaries].every(
        (t) =>
          others.filter((c) => covers(c, { start_ms: t, end_ms: t + 1 }))
            .length < slot.capacity,
      ),
      "NO_VACANCY",
    );
  }
  #outbox(owner, type, source, payload) {
    must(Object.hasOwn(OWNER_STUBS, owner), "UNKNOWN_OWNER");
    const key = ownerKey(this.#world, this.#branch, owner, type, source);
    const existing = this.#state.integration_and_recovery
      .flatMap((j) => j.outbox_entries)
      .find((e) => e.deduplication === key);
    if (existing) {
      must(
        canonical(existing.payload) === canonical(payload),
        "IDEMPOTENCY_CONFLICT",
      );
      return;
    }
    this.#journal.outbox_entries.push({
      source,
      destination: owner,
      payload: clone(payload),
      deduplication: key,
      delivery: {
        command_type: type,
        status: "pending",
        canonical_event_refs: [],
        inherited: false,
      },
    });
  }
  #request(
    owner,
    type,
    source,
    payload,
    { required = true, revision = 0 } = {},
  ) {
    const key = ownerKey(this.#world, this.#branch, owner, type, source);
    let request = this.#state.integration_and_recovery
      .flatMap((j) => j.owner_requests)
      .find((r) => r.idempotency_key === key);
    const normalized = { owner, ...clone(payload) };
    if (request)
      must(
        canonical(request.validated_payload) === canonical(normalized) &&
          request.expected_revision === revision,
        "IDEMPOTENCY_CONFLICT",
      );
    else {
      request = {
        command_type: `${owner}.${type}`,
        validated_payload: normalized,
        source_ref: source,
        idempotency_key: key,
        required,
        preconditions: [],
        expected_revision: revision,
        receipt_status: "pending",
        canonical_event_refs: [],
      };
      this.#journal.owner_requests.push(request);
      this.#journal.execution_saga_state = "COMMITTING";
      this.#save("owner_prepared");
    }
    const prior = this.#state.integration_and_recovery
      .flatMap((j) => j.evaluated_predicates)
      .find((p) => p.predicate === "owner_response" && p.source === key);
    if (request.receipt_status === "accepted" && prior)
      return clone(prior.result);
    const reply = this.#owners.lookup(owner, clone(request));
    json(reply);
    must(
      ["accepted", "rejected", "pending"].includes(reply.status),
      "INVALID_OWNER_RECEIPT",
    );
    if (reply.status === "accepted") {
      must(
        reply.idempotency_key === key &&
          reply.source_ref === source &&
          reply.expected_revision === revision &&
          Array.isArray(reply.canonical_event_refs) &&
          reply.canonical_event_refs.length > 0,
        "INVALID_OWNER_RECEIPT",
      );
      must(
        reply.validated_payload &&
          reply.validated_payload.world_id === this.#world &&
          reply.validated_payload.branch_id === this.#branch,
        "INVALID_OWNER_RECEIPT",
      );
      request.receipt_status = "accepted";
      request.canonical_event_refs = clone(reply.canonical_event_refs);
      this.#predicate("owner_response", reply, key);
      this.#save("owner_accepted");
      return reply;
    }
    request.receipt_status = reply.status;
    this.#save("owner_unresolved");
    if (required)
      throw new RuleError(
        reply.status === "pending" ? "OWNER_UNAVAILABLE" : "OWNER_REJECTED",
      );
    return reply;
  }
  #event(type, source, payload = {}) {
    const eventRef = stableId(
      this.#world,
      this.#branch,
      this.#command.command_id,
      type,
      source,
    );
    this.#predicate(
      "event",
      { event_ref: eventRef, type, source, ...payload },
      this.#command.command_id,
    );
    return eventRef;
  }
  #validateCommand(command) {
    json(command);
    exact(command, [
      "command_id",
      "branch_id",
      "principal_id",
      "principal_authority_ref",
      "operation",
      "payload",
      "expected_revisions",
      "correlation_id",
      "causation_id",
    ]);
    for (const key of [
      "command_id",
      "branch_id",
      "principal_id",
      "principal_authority_ref",
      "operation",
      "correlation_id",
      "causation_id",
    ])
      text(command[key]);
    must(command.branch_id === this.#branch, "BRANCH_MISMATCH");
    const schema = PAYLOADS[command.operation];
    must(schema, "UNKNOWN_OPERATION");
    exact(command.payload, schema[0], schema[1] ?? []);
    must(
      Buffer.byteLength(JSON.stringify(command), "utf8") <= 1048576,
      "COMMAND_TOO_LARGE",
    );
    const arrays = new Set([
      "organizations",
      "task_definitions",
      "contract_terms",
      "vacancies",
      "career_edges",
      "identity_claim_refs",
      "experience_claim_refs",
      "reference_claim_refs",
      "supplied_availability",
      "onboarding_line_ids",
      "onboarding_lines",
      "choice_refs",
      "source_refs",
      "transfer_refs",
      "coverage_refs",
      "task_ids",
      "recipient_refs",
    ]);
    for (const [key, value] of Object.entries(command.payload)) {
      if (arrays.has(key)) must(Array.isArray(value), "INVALID_ARRAY");
      else if (key === "record")
        must(
          value !== null && typeof value === "object" && !Array.isArray(value),
          "INVALID_RECORD",
        );
      else if (key === "start_ms") integer(value);
      else if (key === "end_ms") {
        if (value !== null) integer(value);
      } else text(value);
    }
    if (command.operation === "accept_offer")
      validateRecord("onboarding", {
        contract_id: command.payload.contract_id,
        state: "PREPARED",
        lines: command.payload.onboarding_lines,
      });
    must(Array.isArray(command.expected_revisions), "INVALID_REVISION");
    for (const ref of command.expected_revisions) {
      exact(ref, ["kind", "id", "revision"]);
      integer(ref.revision);
    }
  }
  /** @param {import('./index.mjs').Command} command @returns {object} JSON response */
  dispatch(command) {
    try {
      this.#validateCommand(command);
      return this.#store.hold(() => this.#dispatchLocked(clone(command)));
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      return { status: "rejected", code: error.code };
    }
  }
  #dispatchLocked(command) {
    this.#state = this.#store.load(this.#world, this.#branch);
    this.#command = command;
    this.#principal = this.#proof("system1", command.principal_id, "principal");
    must(
      this.#principal.principal_id === command.principal_id &&
        this.#principal.authenticated === true,
      "AUTHORITY_DENIED",
    );
    this.#now = this.#proof("system11", "clock", "clock").now_ms;
    integer(this.#now);
    // Queries never append snapshots or store recursive inspector results.
    if (command.operation === "inspect") {
      must(this.#principal.scopes.includes("developer"), "AUTHORITY_DENIED");
      return { status: "accepted", state: this.#state.toJSON() };
    }
    if (command.operation === "query")
      return { status: "accepted", ...this.#query(command.payload) };
    const trace = stableId(this.#world, this.#branch, command.command_id);
    this.#journal = this.#state.integration_and_recovery.find(
      (j) => j.trace_id === trace,
    );
    if (this.#journal) {
      must(
        canonical(this.#memo("command")) === canonical(command),
        "IDEMPOTENCY_CONFLICT",
      );
      const result = this.#memo("response");
      if (
        ["COMMITTED", "ABORTED"].includes(this.#journal.execution_saga_state) &&
        result
      )
        return clone(result);
    } else {
      const target = {
        application_stage: ["application_and_assessment", "application_id"],
        assess: ["application_and_assessment", "application_id"],
        select: ["vacancy", "vacancy_id"],
        apply: ["vacancy", "vacancy_id"],
        employment_change: ["employment_contract", "contract_id"],
        amend_terms: ["employment_contract", "contract_id"],
        assign: ["work_task", "task_id"],
        admit: ["work_task", "task_id"],
        execute: ["work_task", "task_id"],
        continue_task: ["work_task", "task_id"],
        transfer: ["work_task", "task_id"],
        cancel_task: ["work_task", "task_id"],
        rework: ["work_task", "task_id"],
      }[command.operation];
      if (target)
        must(
          command.expected_revisions.some(
            (ref) =>
              ref.kind === target[0] && ref.id === command.payload[target[1]],
          ),
          "MISSING_REVISION",
        );
      for (const ref of command.expected_revisions) {
        const r = this.#record(ref.kind, ref.id);
        must(
          (r.revision ?? r.roster_revision) === ref.revision,
          "STALE_REVISION",
        );
      }
      this.#journal = this.#put("integration_and_recovery", {
        command_id: command.command_id,
        expected_revisions: clone(command.expected_revisions),
        owner_requests: [],
        execution_saga_state: "PREPARED",
        outbox_entries: [],
        outbox_cursor: 0,
        recovery_checkpoint_ref: null,
        trace_id: trace,
        evaluated_predicates: [],
        blocked_or_rejected_reasons: [],
      });
      this.#predicate("command", command, command.command_id);
      this.#put("event_context", {
        world_id: this.#world,
        branch_id: this.#branch,
        sequence: this.#state.event_context.length,
        simulation_time_ms: this.#now,
        schema_version: "1",
        ruleset_version: "system13-v1",
        principal_id: command.principal_id,
        principal_authority_ref: command.principal_authority_ref,
        command_id: command.command_id,
        correlation_id: command.correlation_id,
        causation_id: command.causation_id,
        disclosure: { principal_ids: [command.principal_id] },
        superseded_event_ref: null,
      });
      this.#save("command_prepared");
    }
    try {
      const result = this.#operate(command.operation, command.payload);
      const response = { ...result, status: "accepted", trace_id: trace };
      this.#journal.execution_saga_state = "COMMITTED";
      this.#predicate("response", response, command.command_id);
      this.#save("command_committed");
      return response;
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      // Roll back unsaved local mutations, retaining durable samples/accepted owner effects.
      this.#state = this.#store.load(this.#world, this.#branch);
      this.#journal = this.#state.integration_and_recovery.find(
        (j) => j.trace_id === trace,
      );
      const recoverable = [
        "OWNER_UNAVAILABLE",
        "OWNER_REJECTED",
        "RECOVERY_PENDING",
        "NEEDS_CHOICE",
        "STALE_REVISION",
        "MISSING_EVIDENCE",
        "MISSING_POLICY",
        "MISSING_DEFINITION",
      ].includes(error.code);
      const hasEffects = this.#journal.owner_requests.some(
        (r) => r.receipt_status === "accepted",
      );
      this.#journal.execution_saga_state =
        recoverable || hasEffects ? "BLOCKED" : "ABORTED";
      this.#journal.blocked_or_rejected_reasons.push(error.code);
      const response = {
        status:
          this.#journal.execution_saga_state === "BLOCKED"
            ? "blocked"
            : "rejected",
        code: error.code,
        trace_id: trace,
      };
      this.#predicate("response", response, command.command_id);
      this.#save("command_blocked");
      return response;
    }
  }
  #operate(op, p) {
    switch (op) {
      case "configure":
        return this.#configure(p);
      case "apply":
      case "application_stage":
      case "assess":
      case "select":
        return this.#hiring(op, p);
      case "accept_offer":
      case "decline_offer":
      case "provision":
      case "employment_change":
      case "amend_terms":
        return this.#employment(op, p);
      case "roster":
      case "call_out":
      case "decide_leave":
      case "attendance":
      case "correct_attendance":
        return this.#scheduling(op, p);
      case "enqueue":
      case "assign":
      case "admit":
      case "execute":
      case "continue_task":
      case "transfer":
      case "cancel_task":
      case "rework":
        return this.#tasks(op, p);
      case "incident":
      case "review":
      case "discipline":
      case "grievance":
      case "resolve_grievance":
      case "career":
        return this.#professional(op, p);
      case "accrue":
      case "approve_payroll":
      case "payroll":
      case "adjust_compensation":
      case "dispute_pay":
      case "allocate_tips":
        return this.#pay(op, p);
      case "delegate":
      case "stop_routine":
      case "routine":
        return this.#routine(op, p);
      case "interaction":
        return this.#interaction(p);
      case "flush_outbox":
        return this.#flush();
      case "query":
        return this.#query(p);
      case "inspect":
        must(this.#principal.scopes.includes("developer"), "AUTHORITY_DENIED");
        return { state: this.#state.toJSON() };
      case "fork":
        return this.#fork(p);
      default:
        throw new RuleError("UNKNOWN_OPERATION");
    }
  }
  #configure(p) {
    this.#admin();
    for (const values of Object.values(p))
      must(Array.isArray(values), "INVALID_ARRAY");
    for (const d of p.task_definitions) {
      validateDefinition(d);
      must(
        !this.#state.task_definition.some(
          (x) => x.task_id === d.task_id && x.version === d.version,
        ),
        "IMMUTABLE_VERSION",
      );
    }
    const allDefs = [...this.#state.task_definition, ...p.task_definitions];
    for (const org of p.organizations) {
      validateOrganization(org);
      must(
        !this.#record("organization", org.employer_id, true),
        "IMMUTABLE_ORGANIZATION",
      );
      const place = this.#proof("system12", org.workplace_id, "workplace");
      must(
        org.site_refs.every((ref) => place.site_refs.includes(ref)),
        "ACCESS_BLOCKED",
      );
      for (const role of org.role_definitions) validatePack(role.pack, allDefs);
    }
    const grammars = new Map();
    for (const org of [...this.#state.organization, ...p.organizations])
      for (const role of org.role_definitions) {
        const old = grammars.get(role.pack.grammar);
        must(!old || old === role.pack.pack_id, "INDISTINCT_PACK");
        grammars.set(role.pack.grammar, role.pack.pack_id);
      }
    for (const [kind, records] of [
      ["organization", p.organizations],
      ["task_definition", p.task_definitions],
      ["contract_terms", p.contract_terms],
      ["vacancy", p.vacancies],
      ["career_edge", p.career_edges],
    ]) {
      for (const record of records) {
        validateRecord(kind, record);
        if (kind !== "task_definition")
          must(
            !this.#record(kind, record[KEYS[kind]], true),
            "IMMUTABLE_VERSION",
          );
        if (kind === "vacancy") {
          interval(record.application_window);
          integer(record.capacity, 1);
          const org = this.#record("organization", record.employer_id);
          must(
            org.role_slots.some(
              (s) =>
                s.role_slot_id === record.role_slot_id &&
                s.capacity >= record.capacity &&
                s.budget_ref === record.budget_ref,
            ),
            "NO_VACANCY",
          );
          const budget = this.#proof("economy", record.budget_ref, "budget");
          must(budget.funded === true, "NO_VACANCY");
        }
        this.#put(kind, clone(record));
      }
    }
    return { configured: true };
  }
  #actionEffort(source) {
    const proof = this.#proof("system11", source, "action_effort");
    must(
      proof.actor_ref === this.#principal.actor_ref &&
        proof.payable_seconds > 0 &&
        proof.channel_ref &&
        proof.era_year === 2012,
      "INVALID_EFFORT",
    );
    const receipt = this.#request("system11", "execute_action", source, {
      actor_ref: proof.actor_ref,
      effort_ref: source,
      channel_ref: proof.channel_ref,
    });
    return receipt.canonical_event_refs;
  }
  #hiring(op, p) {
    if (op === "apply") {
      const vacancy = this.#record("vacancy", p.vacancy_id);
      this.#intent(p.character_id, p.vacancy_id);
      this.#known(p.character_id, p.vacancy_id);
      must(
        covers(vacancy.application_window, {
          start_ms: this.#now,
          end_ms: this.#now + 1,
        }),
        "NO_VACANCY",
      );
      must(
        !this.#record("application_and_assessment", p.application_id, true),
        "DUPLICATE_APPLICATION",
      );
      const repeated = this.#state.application_and_assessment.filter(
        (a) =>
          a.character_id === p.character_id && a.vacancy_id === p.vacancy_id,
      );
      if (repeated.length) {
        const policy = this.#policy(
          { employer_id: vacancy.employer_id },
          vacancy.selection_policy_version,
        );
        const permit = this.#proof(
          "system6",
          `${p.character_id}:${p.vacancy_id}:reapplication`,
          "reapplication",
        );
        must(
          permit.allowed === true &&
            permit.policy_version === policy.version &&
            repeated.some((a) => a.lineage_ref === p.lineage_ref),
          "REAPPLICATION_BLOCKED",
        );
      }
      p.supplied_availability.forEach(interval);
      const app = this.#put("application_and_assessment", {
        ...clone(p),
        state: "DRAFT",
        revision: 0,
        verified_evidence_refs: [],
        credential_verification_refs: [],
        appointment_refs: [],
        assessment_artifact_refs: [],
        eligibility: "UNVERIFIED",
        task_demonstration_score: null,
        experience_score: null,
        schedule_score: null,
        hard_schedule_conflict: false,
        reference_score: null,
        reference_confidence: null,
        rubric_total: null,
        subjective_influences: [],
        decision_ref: null,
        decision_communication_refs: [],
      });
      return { application_id: app.application_id, state: app.state };
    }
    if (op === "select") {
      const vacancy = this.#record("vacancy", p.vacancy_id);
      this.#authority(vacancy.employer_id, "hire");
      this.#record("contract_terms", p.terms_version);
      const policy = this.#policy(
        { employer_id: vacancy.employer_id },
        vacancy.selection_policy_version,
      );
      const decided = this.#memo("hiring_decisions");
      if (decided) return decided;
      const applicants = this.#state.application_and_assessment.filter(
        (a) =>
          a.vacancy_id === p.vacancy_id &&
          a.state !== "WITHDRAWN" &&
          a.state !== "DECIDED",
      );
      must(
        applicants.every((a) =>
          (policy.decision_stages ?? ["ASSESSMENT"]).includes(a.state),
        ),
        "ASSESSMENT_PENDING",
      );
      const candidates = applicants.filter(
        (a) =>
          a.eligibility === "PASS" &&
          !a.hard_schedule_conflict &&
          a.rubric_total !== null &&
          a.rubric_total >= (policy.offer_threshold ?? 7),
      );
      for (const a of candidates)
        for (const ref of a.verified_evidence_refs)
          this.#known(this.#principal.actor_ref, ref);
      const tiePolicy = this.#policy(
        { employer_id: vacancy.employer_id },
        vacancy.tie_policy_ref,
      );
      let tieOrder;
      if (tiePolicy.kind === "earlier_assessment") {
        tieOrder = new Map(
          candidates.map((a) => [
            a.application_id,
            this.#proof(
              "system11",
              `assessment:${a.application_id}`,
              "assessment_time",
            ).completed_ms,
          ]),
        );
      } else if (tiePolicy.kind === "persisted_fair_draw") {
        must(vacancy.persisted_tie_result_ref, "MISSING_POLICY");
        const draw = this.#proof(
          "system6",
          vacancy.persisted_tie_result_ref,
          "fair_draw",
        );
        tieOrder = new Map(
          draw.application_order.map((id, index) => [id, index]),
        );
      } else throw new RuleError("MISSING_POLICY");
      must(
        candidates.every((a) =>
          Number.isSafeInteger(tieOrder.get(a.application_id)),
        ),
        "MISSING_EVIDENCE",
      );
      candidates.sort(
        (a, b) =>
          b.rubric_total - a.rubric_total ||
          tieOrder.get(a.application_id) - tieOrder.get(b.application_id),
      );
      for (let i = 1; i < candidates.length; i++)
        if (
          candidates[i].rubric_total === candidates[i - 1].rubric_total &&
          tieOrder.get(candidates[i].application_id) ===
            tieOrder.get(candidates[i - 1].application_id)
        )
          throw new RuleError("UNRESOLVED_TIE");
      const org = this.#record("organization", vacancy.employer_id),
        slot = org.role_slots.find(
          (s) => s.role_slot_id === vacancy.role_slot_id,
        );
      const occupied = this.#state.employment_contract.filter(
        (c) =>
          c.role_slot_id === vacancy.role_slot_id &&
          c.employer_id === vacancy.employer_id &&
          OCCUPIED.includes(c.status) &&
          covers(c, { start_ms: this.#now, end_ms: this.#now + 1 }),
      ).length;
      const pendingOffers = this.#state.offer.filter(
        (o) =>
          o.acceptance_or_rejection_ref === null &&
          this.#record("application_and_assessment", o.application_id)
            .vacancy_id === vacancy.vacancy_id,
      ).length;
      const available = Math.max(
        0,
        Math.min(vacancy.capacity, slot.capacity) - occupied - pendingOffers,
      );
      const winners = new Set(
          candidates.slice(0, available).map((a) => a.application_id),
        ),
        decisions = [];
      for (const app of applicants) {
        app.state = "DECIDED";
        app.revision++;
        app.decision_ref = this.#event(
          "ApplicantDecision",
          app.application_id,
          {
            decision: winners.has(app.application_id) ? "OFFERED" : "REJECTED",
          },
        );
        if (winners.has(app.application_id)) {
          const offer = {
            offer_id: stableId(
              this.#branch,
              p.vacancy_id,
              app.application_id,
              "offer",
            ),
            application_id: app.application_id,
            frozen_terms_version: p.terms_version,
            required_onboarding_line_ids: clone(p.onboarding_line_ids),
            authorized_decision_ref: app.decision_ref,
            acceptance_or_rejection_ref: null,
          };
          this.#put("offer", offer);
          decisions.push({
            application_id: app.application_id,
            offer_id: offer.offer_id,
            decision: "OFFERED",
          });
        } else
          decisions.push({
            application_id: app.application_id,
            decision: "REJECTED",
          });
        this.#outbox("system3", "application_decision", app.decision_ref, {
          application_id: app.application_id,
          decision_ref: app.decision_ref,
          recipient_ref: app.character_id,
        });
      }
      vacancy.revision++;
      this.#predicate("hiring_decisions", { decisions }, vacancy.vacancy_id);
      return { decisions };
    }
    const app = this.#record("application_and_assessment", p.application_id),
      vacancy = this.#record("vacancy", app.vacancy_id);
    if (op === "application_stage") {
      const transitions = {
        DRAFT: ["SUBMITTED", "WITHDRAWN"],
        SUBMITTED: ["SCREENING", "WITHDRAWN"],
        SCREENING: ["INTERVIEW", "ASSESSMENT", "WITHDRAWN"],
        INTERVIEW: ["ASSESSMENT", "WITHDRAWN"],
        ASSESSMENT: ["WITHDRAWN"],
      };
      must(transitions[app.state]?.includes(p.state), "INVALID_TRANSITION");
      if (["SUBMITTED", "WITHDRAWN"].includes(p.state))
        this.#intent(app.character_id, app.application_id);
      else this.#authority(vacancy.employer_id, "hire");
      if (["SUBMITTED", "INTERVIEW"].includes(p.state))
        this.#actionEffort(this.#command.causation_id);
      app.state = p.state;
      app.revision++;
      this.#event("ApplicationStateChanged", app.application_id, {
        state: app.state,
      });
      return { application_id: app.application_id, state: app.state };
    }
    this.#authority(vacancy.employer_id, "hire");
    must(
      ["SCREENING", "INTERVIEW", "ASSESSMENT"].includes(app.state),
      "INVALID_TRANSITION",
    );
    const assessment = this.#proof("system10", p.assessment_ref, "assessment");
    must(
      assessment.application_id === app.application_id &&
        assessment.character_id === app.character_id,
      "INVALID_OWNER_PROOF",
    );
    for (const ref of assessment.verified_evidence_refs)
      this.#known(this.#principal.actor_ref, ref);
    for (const ref of assessment.credential_verification_refs) {
      const credential = this.#proof("legal_institutions", ref, "credential");
      must(
        credential.valid === true &&
          credential.character_id === app.character_id,
        "INELIGIBLE_ROLE",
      );
    }
    for (const requirement of vacancy.requirements) {
      const prerequisite = this.#proof(
        requirement.owner,
        `${app.character_id}:${requirement.kind}`,
        requirement.kind,
      );
      must(prerequisite.valid === true, "INELIGIBLE_ROLE");
    }
    const fields = [
      "eligibility",
      "task_demonstration_score",
      "experience_score",
      "schedule_score",
      "hard_schedule_conflict",
      "reference_score",
      "reference_confidence",
      "verified_evidence_refs",
      "credential_verification_refs",
      "assessment_artifact_refs",
    ];
    const updated = { ...app };
    for (const field of fields) {
      must(Object.hasOwn(assessment, field), "MISSING_EVIDENCE");
      updated[field] = clone(assessment[field]);
    }
    const scores = [
      updated.task_demonstration_score,
      updated.experience_score,
      updated.schedule_score,
      updated.reference_score,
    ];
    updated.rubric_total =
      updated.eligibility === "PASS" &&
      !updated.hard_schedule_conflict &&
      scores.every((s) => s !== null)
        ? scores.reduce((a, b) => a + b, 0)
        : null;
    updated.state = "ASSESSMENT";
    updated.revision++;
    validateRecord("application_and_assessment", updated);
    Object.assign(app, updated);
    return {
      application_id: app.application_id,
      state: app.state,
      rubric_total: app.rubric_total,
    };
  }
  #employment(op, p) {
    if (op === "accept_offer" || op === "decline_offer") {
      const offer = this.#record("offer", p.offer_id),
        app = this.#record("application_and_assessment", offer.application_id);
      this.#intent(app.character_id, p.offer_id);
      this.#known(app.character_id, p.offer_id);
      if (op === "decline_offer") {
        must(offer.acceptance_or_rejection_ref === null, "OFFER_CLOSED");
        offer.acceptance_or_rejection_ref = this.#event(
          "OfferDeclined",
          offer.offer_id,
        );
        return { offer_id: offer.offer_id, decision: "DECLINED" };
      }
      let contract = this.#record("employment_contract", p.contract_id, true);
      if (!contract) {
        must(offer.acceptance_or_rejection_ref === null, "OFFER_CLOSED");
        interval({ start_ms: p.start_ms, end_ms: p.end_ms });
        const vacancy = this.#record("vacancy", app.vacancy_id),
          terms = this.#record("contract_terms", offer.frozen_terms_version);
        this.#capacity(vacancy.employer_id, vacancy.role_slot_id, {
          start_ms: p.start_ms,
          end_ms: p.end_ms,
        });
        must(
          new Set(p.onboarding_lines.map((l) => l.line_id)).size ===
            p.onboarding_lines.length,
          "DUPLICATE_PROVISIONING",
        );
        must(
          p.onboarding_lines.every(
            (l) =>
              l.owner_receipt_ref === null &&
              Object.hasOwn(OWNER_STUBS, l.owner),
          ),
          "INVALID_PROVISIONING",
        );
        must(
          offer.required_onboarding_line_ids.every((id) =>
            p.onboarding_lines.some((l) => l.line_id === id && l.required),
          ),
          "MISSING_PROVISIONING",
        );
        const plan = this.#proof(
          "legal_institutions",
          offer.offer_id,
          "onboarding_plan",
        );
        must(
          canonical(plan.lines) === canonical(p.onboarding_lines),
          "INVALID_PROVISIONING",
        );
        const acceptance = this.#event("ContractAccepted", p.contract_id, {
          terms_version: terms.version,
        });
        contract = this.#put("employment_contract", {
          contract_id: p.contract_id,
          character_id: app.character_id,
          employer_id: vacancy.employer_id,
          role_slot_id: vacancy.role_slot_id,
          terms_version: terms.version,
          start_ms: p.start_ms,
          end_ms: p.end_ms,
          status: "OFFERED",
          revision: 0,
        });
        offer.acceptance_or_rejection_ref = acceptance;
        const onboarding = {
          contract_id: contract.contract_id,
          state: "PREPARED",
          lines: clone(p.onboarding_lines),
        };
        this.#put("onboarding", onboarding);
        this.#save("contract_accepted");
      }
      return this.#provision(contract);
    }
    const c = this.#record("employment_contract", p.contract_id);
    if (op === "provision") {
      must(
        this.#principal.actor_ref === c.character_id ||
          this.#principal.scopes.includes("recovery"),
        "AUTHORITY_DENIED",
      );
      return this.#provision(c);
    }
    if (op === "amend_terms") {
      this.#authority(c.employer_id, "hire");
      const terms = this.#record("contract_terms", p.terms_version),
        decision = this.#proof("system6", p.decision_ref, "terms_amendment");
      must(
        decision.contract_id === c.contract_id &&
          decision.terms_version === terms.version &&
          decision.effective_ms <= this.#now &&
          decision.approved === true,
        "INVALID_AMENDMENT",
      );
      this.#intent(c.character_id, c.contract_id);
      const old = this.#record("contract_terms", c.terms_version);
      must(
        !old.amendments.some((a) => a.acceptance_ref === p.decision_ref),
        "DUPLICATE_AMENDMENT",
      );
      // Append-only amendment metadata; earned compensation retains its original terms_version.
      old.amendments.push({
        version: terms.version,
        effective_time: decision.effective_ms,
        acceptance_ref: p.decision_ref,
      });
      const previousVersion = c.terms_version;
      c.terms_version = terms.version;
      c.revision++;
      this.#event("ContractAmended", c.contract_id, {
        previous_terms_version: previousVersion,
        terms_version: terms.version,
      });
      return { contract_id: c.contract_id, terms_version: c.terms_version };
    }
    const decision = this.#proof(
      "system6",
      p.decision_ref,
      "employment_decision",
    );
    must(
      decision.contract_id === c.contract_id &&
        decision.status === p.status &&
        decision.authorized === true,
      "INVALID_DECISION",
    );
    const transitions = {
      ACTIVE: ["ON_LEAVE", "SUSPENDED", "NOTICE_PERIOD", "ENDED"],
      PROBATIONARY: [
        "ACTIVE",
        "ON_LEAVE",
        "SUSPENDED",
        "NOTICE_PERIOD",
        "ENDED",
      ],
      ON_LEAVE: ["ACTIVE", "PROBATIONARY", "ENDED"],
      SUSPENDED: ["ACTIVE", "PROBATIONARY", "ENDED"],
      NOTICE_PERIOD: ["ENDED"],
    };
    must(transitions[c.status]?.includes(p.status), "INVALID_TRANSITION");
    if (decision.reason === "resignation")
      this.#intent(c.character_id, c.contract_id);
    else
      this.#authority(
        c.employer_id,
        p.status === "ENDED"
          ? "terminate"
          : p.status === "ON_LEAVE"
            ? "approve_leave"
            : "discipline",
      );
    if (p.status === "ENDED") {
      // Culpability-based endings must pass the discipline workflow; an owner
      // proposal cannot bypass its warning/evidence gates through this route.
      must(
        [
          "resignation",
          "layoff",
          "employer_closure",
          "contract_expiry",
        ].includes(decision.reason),
        "DISCIPLINE_POLICY",
      );
      if (decision.reason === "contract_expiry")
        must(
          c.end_ms !== null && this.#now >= c.end_ms,
          "INVALID_EFFECTIVE_TIME",
        );
      return this.#endEmployment(c, decision);
    }
    c.status = p.status;
    c.revision++;
    this.#event("EmploymentChanged", c.contract_id, { status: c.status });
    this.#outbox("system9", "employment_changed", p.decision_ref, {
      contract_id: c.contract_id,
      status: c.status,
      effective_ms: this.#now,
    });
    return { contract_id: c.contract_id, employment_status: c.status };
  }
  #provision(c) {
    const onboarding = this.#record("onboarding", c.contract_id);
    if (onboarding.state === "COMPLETE")
      return {
        contract_id: c.contract_id,
        employment_status: c.status,
        onboarding: "COMPLETE",
      };
    must(c.status === "OFFERED", "INVALID_TRANSITION");
    onboarding.state = "COMMITTING";
    try {
      const terms = this.#record("contract_terms", c.terms_version);
      for (const prerequisite of terms.prerequisite_refs) {
        const proof = this.#proof(
          prerequisite.owner,
          `${c.character_id}:${prerequisite.kind}`,
          prerequisite.kind,
        );
        must(proof.valid === true, "INELIGIBLE_ROLE");
      }
      const role = this.#role(c).role;
      const regulatedActorGates = this.#state.task_definition
        .filter((d) =>
          role.pack.task_definition_refs.includes(`${d.task_id}@${d.version}`),
        )
        .flatMap((d) => d.mandatory_gates)
        .filter((g) => g.scope === "actor");
      for (const gate of regulatedActorGates) {
        const proof = this.#proof(
          gate.owner,
          `${c.character_id}:${gate.kind}`,
          gate.kind,
        );
        must(proof.valid === true, "INELIGIBLE_ROLE");
      }
      for (const line of onboarding.lines) {
        if (line.owner_receipt_ref) continue;
        must(Object.hasOwn(OWNER_STUBS, line.owner), "UNKNOWN_OWNER");
        for (const gate of line.preconditions) {
          const proof = this.#proof(gate.owner, gate.source_ref, gate.kind);
          must(proof.valid === true, "INELIGIBLE_ROLE");
        }
        const source = `${c.contract_id}:${line.line_id}`;
        must(
          line.idempotency_key ===
            ownerKey(
              this.#world,
              this.#branch,
              line.owner,
              "provision",
              source,
            ),
          "INVALID_PROVISIONING",
        );
        const reply = this.#request(
          line.owner,
          "provision",
          source,
          {
            contract_id: c.contract_id,
            line_id: line.line_id,
            character_id: c.character_id,
          },
          { required: line.required },
        );
        if (reply.status === "accepted") {
          line.owner_receipt_ref = reply.canonical_event_refs[0];
          this.#save("provisioning_line_accepted");
        }
      }
      must(
        onboarding.lines
          .filter((l) => l.required)
          .every((l) => l.owner_receipt_ref),
        "RECOVERY_PENDING",
      );
      const policy = this.#policy(c, terms.probation_policy_ref);
      c.status = policy.required ? "PROBATIONARY" : "ACTIVE";
      c.revision++;
      onboarding.state = "COMPLETE";
      const event = this.#event("OnboardingCompleted", c.contract_id);
      this.#outbox("system9", "employment_started", event, {
        contract_id: c.contract_id,
        character_id: c.character_id,
        start_ms: c.start_ms,
      });
      return {
        contract_id: c.contract_id,
        employment_status: c.status,
        onboarding: onboarding.state,
      };
    } catch (error) {
      onboarding.state = "RECOVERY_REQUIRED";
      this.#save("onboarding_recovery");
      throw error;
    }
  }
  #endEmployment(c, decision) {
    integer(decision.effective_ms);
    must(
      decision.effective_ms <= this.#now && decision.effective_ms >= c.start_ms,
      "INVALID_EFFECTIVE_TIME",
    );
    c.status = "ENDED";
    c.end_ms = decision.effective_ms;
    c.revision++;
    const event = this.#event("EmploymentEnded", c.contract_id, {
      reason: decision.reason,
      effective_ms: decision.effective_ms,
    });
    for (const t of this.#state.work_task.filter(
      (t) =>
        t.assigned_contract_id === c.contract_id &&
        !FINAL_TASK.includes(t.state),
    )) {
      t.state = "PAUSED";
      t.revision++;
      const e = this.#record("task_execution", t.task_id, true);
      if (e && !e.unresolved_issue_refs.includes(event))
        e.unresolved_issue_refs.push(event);
    }
    for (const [owner, type] of [
      ["inventory_security", "revoke_access"],
      ["inventory_security", "equipment_return"],
      ["system11", "end_assignments"],
      ["economy", "final_settlement"],
      ["system9", "employment_ended"],
    ])
      this.#outbox(owner, type, event, {
        contract_id: c.contract_id,
        character_id: c.character_id,
        effective_ms: decision.effective_ms,
      });
    return {
      contract_id: c.contract_id,
      employment_status: "ENDED",
      owed_entitlement_ids: this.#state.compensation
        .filter(
          (x) =>
            x.contract_id === c.contract_id && x.payroll_state !== "SETTLED",
        )
        .map((x) => x.entitlement_id),
    };
  }
  #scheduling(op, p) {
    if (op === "roster") {
      this.#authority(p.employer_id, "assign_work");
      validateRecord("staffing_and_assignments", p.record);
      const occurrence = this.#proof("system11", p.record.shift_ref, "shift");
      must(occurrence.employer_id === p.employer_id, "INVALID_SHIFT");
      const rosterProof = this.#proof(
        "system6",
        p.record.shift_ref,
        "roster_decision",
      );
      const staffingPolicy = this.#policy(
        { employer_id: p.employer_id },
        p.record.schedule_rule_version,
      );
      must(
        canonical(p.record.minimum_role_coverage) ===
          canonical(staffingPolicy.minimum_role_coverage ?? []),
        "INVALID_ROSTER_POLICY",
      );
      must(
        canonical(rosterProof.priority_order) ===
          canonical([
            "mandatory_qualified_coverage",
            "accepted_leave",
            "contract_availability",
            "rotation_fairness",
            "worker_preferences",
          ]),
        "INVALID_ROSTER_POLICY",
      );
      must(
        canonical(rosterProof.assignment_intervals) ===
          canonical(p.record.assignment_intervals),
        "INVALID_ROSTER",
      );
      for (const a of p.record.assignment_intervals) {
        interval(a.interval);
        const c = this.#record("employment_contract", a.contract_id);
        must(
          c.employer_id === p.employer_id && ACTUAL_WORK.includes(c.status),
          "INELIGIBLE_ROLE",
        );
        const capacity = this.#proof(
          "system11",
          `${p.record.shift_ref}:${c.character_id}`,
          "schedule_capacity",
        );
        must(capacity.feasible === true, "SCHEDULE_CONFLICT");
        const qualification = this.#proof(
          "legal_institutions",
          `${a.contract_id}:${a.station_ref}`,
          "staffing_qualification",
        );
        must(qualification.valid === true, "INELIGIBLE_ROLE");
        const leave = this.#state.attendance.find(
          (x) =>
            x.contract_id === c.contract_id &&
            x.shift_ref === p.record.shift_ref &&
            x.leave_decision_ref,
        );
        must(
          !leave ||
            this.#proof("system6", leave.leave_decision_ref, "leave_decision")
              .approved !== true,
          "SCHEDULE_CONFLICT",
        );
      }
      const boundaries = new Set([
        occurrence.start_ms,
        ...p.record.assignment_intervals
          .flatMap((a) => [a.interval.start_ms, a.interval.end_ms])
          .filter((t) => t !== null),
      ]);
      for (const requirement of p.record.minimum_role_coverage) {
        exact(requirement, ["role_ref", "count"]);
        integer(requirement.count);
        for (const time of boundaries) {
          if (time < occurrence.start_ms || time >= occurrence.end_ms) continue;
          const workers = new Set(
            p.record.assignment_intervals
              .filter(
                (a) =>
                  covers(a.interval, { start_ms: time, end_ms: time + 1 }) &&
                  this.#role(this.#record("employment_contract", a.contract_id))
                    .role.role_id === requirement.role_ref,
              )
              .map(
                (a) =>
                  this.#record("employment_contract", a.contract_id)
                    .character_id,
              ),
          );
          must(
            workers.size >= requirement.count ||
              rosterProof.service_reduced === true ||
              rosterProof.service_closed === true,
            "INSUFFICIENT_COVERAGE",
          );
        }
      }
      const old = this.#record(
        "staffing_and_assignments",
        p.record.shift_ref,
        true,
      );
      must(
        !old || p.record.roster_revision === old.roster_revision + 1,
        "STALE_REVISION",
      );
      const reply = this.#request(
        "system11",
        "register_roster",
        `${p.record.shift_ref}:${p.record.roster_revision}`,
        { employer_id: p.employer_id, record: p.record },
      );
      if (old) Object.assign(old, clone(p.record));
      else this.#put("staffing_and_assignments", clone(p.record));
      this.#outbox(
        "system3",
        "publish_roster",
        `${p.record.shift_ref}:${p.record.roster_revision}`,
        {
          shift_ref: p.record.shift_ref,
          occurrence_receipts: reply.canonical_event_refs,
        },
      );
      return {
        shift_ref: p.record.shift_ref,
        roster_revision: p.record.roster_revision,
      };
    }
    const c = this.#record("employment_contract", p.contract_id);
    let row = this.#state.attendance.find(
      (a) => a.contract_id === c.contract_id && a.shift_ref === p.shift_ref,
    );
    const shift = this.#proof("system11", p.shift_ref, "shift");
    must(shift.employer_id === c.employer_id, "INVALID_SHIFT");
    if (!row) {
      row = this.#put("attendance", {
        contract_id: c.contract_id,
        shift_ref: p.shift_ref,
        absence_lineage_ref: null,
        presence_receipt_refs: [],
        check_in_receipt_refs: [],
        arrival_ms: null,
        departure_ms: null,
        effort_coverage_refs: [],
        notice_evidence_refs: [],
        call_out_channel_ref: null,
        supplied_explanation_ref: null,
        leave_request_ref: null,
        leave_decision_ref: null,
        interpretation: "UNEVALUATED",
        missed_effort: null,
        dispute_and_correction_refs: [],
      });
    }
    if (op === "call_out") {
      must(
        this.#proof("system11", this.#command.causation_id, "action_effort")
          .channel_ref === p.channel_ref,
        "INVALID_CHANNEL",
      );
      this.#intent(c.character_id, c.contract_id);
      this.#actionEffort(this.#command.causation_id);
      must(row.leave_request_ref === null, "DUPLICATE_CALL_OUT");
      row.call_out_channel_ref = p.channel_ref;
      row.supplied_explanation_ref = p.explanation_ref;
      row.leave_request_ref = this.#event(
        "LeaveRequested",
        `${c.contract_id}:${p.shift_ref}`,
      );
      row.absence_lineage_ref = stableId(
        this.#branch,
        c.contract_id,
        p.shift_ref,
        "absence",
      );
      this.#outbox("system6", "leave_request", row.leave_request_ref, {
        contract_id: c.contract_id,
        shift_ref: p.shift_ref,
        channel_ref: p.channel_ref,
        explanation_ref: p.explanation_ref,
      });
      return { leave_request_ref: row.leave_request_ref };
    }
    this.#authority(c.employer_id, "approve_leave");
    if (op === "decide_leave") {
      must(
        row.leave_request_ref && row.leave_decision_ref === null,
        "INVALID_TRANSITION",
      );
      const d = this.#proof("system6", p.decision_ref, "leave_decision");
      must(
        d.contract_id === c.contract_id &&
          d.shift_ref === p.shift_ref &&
          d.request_ref === row.leave_request_ref,
        "INVALID_DECISION",
      );
      row.leave_decision_ref = p.decision_ref;
      this.#outbox("system3", "leave_decision", p.decision_ref, {
        contract_id: c.contract_id,
        shift_ref: p.shift_ref,
        decision_ref: p.decision_ref,
      });
      return { decision_ref: p.decision_ref };
    }
    if (op === "correct_attendance") {
      const correction = this.#proof(
        "system12",
        p.correction_ref,
        "attendance_correction",
      );
      must(
        correction.contract_id === c.contract_id &&
          correction.shift_ref === p.shift_ref,
        "INVALID_CORRECTION",
      );
      must(
        !row.dispute_and_correction_refs.includes(p.correction_ref),
        "DUPLICATE_CORRECTION",
      );
      this.#predicate("attendance_before", clone(row), p.correction_ref);
      row.dispute_and_correction_refs.push(p.correction_ref);
      this.#outbox(
        "economy",
        "attendance_adjustment_review",
        p.correction_ref,
        {
          contract_id: c.contract_id,
          shift_ref: p.shift_ref,
          correction_ref: p.correction_ref,
        },
      );
    }
    const presence = this.#proof(
      "system12",
      `${c.contract_id}:${p.shift_ref}`,
      "attendance",
    );
    must(presence.character_id === c.character_id, "INVALID_OWNER_PROOF");
    const terms = this.#record("contract_terms", c.terms_version),
      policy = this.#policy(c, terms.schedule_policy_ref);
    row.arrival_ms = presence.arrival_ms;
    row.departure_ms = presence.departure_ms;
    row.presence_receipt_refs = clone(presence.canonical_event_refs);
    row.check_in_receipt_refs = clone(presence.check_in_receipt_refs);
    row.notice_evidence_refs = clone(presence.notice_evidence_refs);
    const effort = this.#proof(
      "system11",
      `${c.contract_id}:${p.shift_ref}`,
      "attendance_coverage",
    );
    row.effort_coverage_refs = clone(effort.coverage_refs);
    row.missed_effort = clone(effort.missed_effort);
    const excused =
      row.leave_decision_ref &&
      this.#proof("system6", row.leave_decision_ref, "leave_decision")
        .approved === true;
    row.interpretation =
      presence.arrival_ms === null
        ? excused
          ? "EXCUSED"
          : "ABSENT"
        : presence.arrival_ms >= shift.start_ms + (policy.grace_ms ?? 300000)
          ? "LATE"
          : "PRESENT";
    if (presence.departure_ms !== null && presence.departure_ms < shift.end_ms)
      row.interpretation = `${row.interpretation}_EARLY_DEPARTURE`;
    this.#event("AttendanceEvaluated", `${c.contract_id}:${p.shift_ref}`);
    return {
      contract_id: c.contract_id,
      shift_ref: p.shift_ref,
      interpretation: row.interpretation,
    };
  }
  #definition(task) {
    const d = this.#state.task_definition.find(
      (d) =>
        d.task_id === task.definition_id &&
        d.version === task.definition_version,
    );
    must(d, "MISSING_DEFINITION");
    return d;
  }
  #taskContext(task, method) {
    const c = this.#record("employment_contract", task.assigned_contract_id),
      definition = this.#definition(task);
    must(
      ACTUAL_WORK.includes(c.status) &&
        covers(c, { start_ms: this.#now, end_ms: this.#now + 1 }),
      "INELIGIBLE_ROLE",
    );
    const { role } = this.#role(c);
    must(definition.role_scope.includes(role.role_id), "INELIGIBLE_ROLE");
    must(definition.methods.includes(method), "UNSUPPORTED_METHOD");
    const terms = this.#record("contract_terms", c.terms_version),
      demand = this.#proof("demand_artifacts", task.demand_source_id, "demand");
    must(
      terms.duties.some(
        (duty) =>
          duty === task.definition_id || duty?.task_id === task.definition_id,
      ),
      "NEEDS_CHOICE",
    );
    must(
      demand.available === true &&
        demand.artifact_ref === task.artifact_ref &&
        demand.employer_id === c.employer_id,
      "INVALID_DEMAND",
    );
    const presence = this.#proof("system12", c.character_id, "presence");
    must(
      presence.site_ref === terms.site_ref &&
        presence.reachable_artifact_refs.includes(task.artifact_ref),
      "ACCESS_BLOCKED",
    );
    const capability = this.#proof(
      "system10",
      `${c.character_id}:${definition.resolution_profile.profile_ref}`,
      "capability",
    );
    must(capability.eligible === true, "INELIGIBLE_ROLE");
    for (const gate of [
      ...terms.prerequisite_refs,
      ...definition.mandatory_gates,
    ]) {
      const scope =
        gate.scope === "contract"
          ? c.contract_id
          : gate.scope === "demand"
            ? task.demand_source_id
            : c.character_id;
      const proof = this.#proof(gate.owner, `${scope}:${gate.kind}`, gate.kind);
      must(proof.valid === true, "INELIGIBLE_ROLE");
    }
    for (const input of definition.inputs) {
      const proof = this.#proof(input.owner, task.demand_source_id, input.kind);
      must(
        input.required_fields.every(
          (field) => Object.hasOwn(proof, field) && proof[field] !== null,
        ),
        "MISSING_EVIDENCE",
      );
    }
    for (const resource of definition.resources) {
      const proof = this.#proof("inventory_security", resource, "resource");
      must(
        proof.available === true && proof.site_ref === terms.site_ref,
        "MISSING_RESOURCE",
      );
    }
    return { c, definition, terms, demand, presence, capability };
  }
  #scope(task, execution, delegationRef) {
    const c = this.#record("employment_contract", task.assigned_contract_id),
      d = this.#definition(task);
    if (!delegationRef) {
      return this.#intent(c.character_id, task.task_id);
    }
    const scope = this.#record("routine_delegation", delegationRef);
    must(
      scope.actor_ref === c.character_id &&
        scope.pending_choice_refs.length === 0 &&
        scope.authorization_horizon_ms > 0,
      "NEEDS_CHOICE",
    );
    must(
      scope.eligible_task_types.includes(task.definition_id) &&
        scope.permitted_methods.includes(execution.method_id),
      "NEEDS_CHOICE",
    );
    must(scope.role_ref === this.#role(c).role.role_id, "NEEDS_CHOICE");
    const authorization = this.#proof("system1", delegationRef, "delegation");
    must(
      authorization.actor_ref === c.character_id &&
        authorization.active === true &&
        this.#now <= authorization.start_ms + scope.authorization_horizon_ms,
      "NEEDS_CHOICE",
    );
    must(
      scope.location_scope.includes(
        this.#record("contract_terms", c.terms_version).site_ref,
      ),
      "NEEDS_CHOICE",
    );
    const stage = d.stages_and_checkpoints.find(
      (s) => s.stage_id === execution.current_stage,
    );
    must(stage, "MISSING_DEFINITION");
    must(
      stage.permitted_communication_scope.every((s) =>
        scope.permitted_communication_scope.includes(s),
      ),
      "NEEDS_CHOICE",
    );
    for (const cost of stage.resource_and_cost_limits) {
      const limit = scope.resource_and_cost_limits.find(
        (l) => l.resource_ref === cost.resource_ref,
      );
      must(
        limit && (limit.consumed ?? 0) + cost.maximum <= limit.maximum,
        "NEEDS_CHOICE",
      );
    }
    return authorization;
  }
  #enqueue(p, cycle = 0, predecessor = null) {
    const definition = this.#state.task_definition.find(
      (d) =>
        d.task_id === p.definition_id && d.version === p.definition_version,
    );
    must(definition, "MISSING_DEFINITION");
    const demand = this.#proof(
      "demand_artifacts",
      p.demand_source_id,
      "demand",
    );
    must(
      demand.available === true &&
        demand.artifact_ref === p.artifact_ref &&
        demand.demand_type === definition.demand_source,
      "INVALID_DEMAND",
    );
    this.#authority(demand.employer_id, "assign_work");
    const prior = this.#state.work_task.find(
      (t) =>
        t.definition_id === p.definition_id &&
        t.demand_source_id === p.demand_source_id &&
        t.artifact_ref === p.artifact_ref &&
        t.work_cycle_index === cycle,
    );
    if (prior) return { task_id: prior.task_id, state: prior.state };
    const queued = this.#state.work_task
      .filter((t) => t.state === "QUEUED")
      .filter((t) => {
        const org = this.#state.integration_and_recovery
          .flatMap((j) => j.evaluated_predicates)
          .find(
            (x) => x.predicate === "task_partition" && x.source === t.task_id,
          );
        return org?.result === demand.partition_ref;
      });
    must(queued.length < 1000, "BACKPRESSURE");
    const task = this.#put("work_task", {
      task_id: stableId(
        this.#world,
        this.#branch,
        p.definition_id,
        p.demand_source_id,
        p.artifact_ref,
        cycle,
      ),
      ...clone(p),
      assigned_contract_id: null,
      state: "QUEUED",
      work_cycle_index: cycle,
      revision: 0,
    });
    this.#predicate("task_partition", demand.partition_ref, task.task_id);
    if (predecessor)
      this.#predicate("task_predecessor", predecessor, task.task_id);
    this.#event("TaskQueued", task.task_id);
    return { task_id: task.task_id, state: task.state };
  }
  #tasks(op, p) {
    if (op === "enqueue") return this.#enqueue(p);
    const task = this.#record("work_task", p.task_id),
      definition = this.#definition(task);
    const completed = this.#memo("task_response");
    if (op === "execute" && completed?.task_id === task.task_id)
      return clone(completed.response);
    if (op === "rework") {
      must(
        ["COMPLETED", "FAILED", "PAUSED"].includes(task.state),
        "INVALID_TRANSITION",
      );
      const permission = this.#proof("system6", p.authorization_ref, "rework");
      must(
        permission.task_id === task.task_id && permission.authorized === true,
        "INVALID_REWORK",
      );
      const previous = this.#state.integration_and_recovery
        .flatMap((j) => j.evaluated_predicates)
        .find(
          (x) =>
            x.predicate === "rework_authorization" &&
            x.source === p.authorization_ref,
        );
      if (previous) return clone(previous.result);
      const siblings = this.#state.work_task.filter(
        (t) =>
          t.definition_id === task.definition_id &&
          t.demand_source_id === task.demand_source_id &&
          t.artifact_ref === task.artifact_ref,
      );
      const result = this.#enqueue(
        {
          definition_id: task.definition_id,
          definition_version: task.definition_version,
          demand_source_id: task.demand_source_id,
          artifact_ref: task.artifact_ref,
        },
        Math.max(...siblings.map((t) => t.work_cycle_index)) + 1,
        task.task_id,
      );
      this.#predicate("rework_authorization", result, p.authorization_ref);
      return result;
    }
    if (op === "assign") {
      must(task.state === "QUEUED", "INVALID_TRANSITION");
      const c = this.#record("employment_contract", p.contract_id);
      this.#authority(c.employer_id, "assign_work");
      const demand = this.#proof(
        "demand_artifacts",
        task.demand_source_id,
        "demand",
      );
      must(demand.employer_id === c.employer_id, "AUTHORITY_DENIED");
      must(
        ACTUAL_WORK.includes(c.status) &&
          definition.role_scope.includes(this.#role(c).role.role_id),
        "INELIGIBLE_ROLE",
      );
      task.assigned_contract_id = c.contract_id;
      task.state = "ASSIGNED";
      task.revision++;
      for (const owner of ["system3", "system5", "system6"])
        this.#outbox(
          owner,
          "work_assigned",
          `${task.task_id}:${task.revision}`,
          { task_id: task.task_id, character_id: c.character_id },
        );
      return { task_id: task.task_id, state: task.state };
    }
    const c = this.#record("employment_contract", task.assigned_contract_id);
    if (op === "cancel_task") {
      this.#authority(c.employer_id, "assign_work");
      must(!FINAL_TASK.includes(task.state), "INVALID_TRANSITION");
      const decision = this.#proof("system6", p.decision_ref, "cancel_task");
      must(
        decision.task_id === task.task_id && decision.authorized === true,
        "INVALID_DECISION",
      );
      task.state = "CANCELLED";
      task.revision++;
      this.#event("TaskCancelled", task.task_id);
      this.#outbox("system11", "release_reservations", p.decision_ref, {
        task_id: task.task_id,
      });
      return { task_id: task.task_id, state: task.state };
    }
    if (op === "transfer") {
      this.#authority(c.employer_id, "assign_work");
      must(!FINAL_TASK.includes(task.state), "INVALID_TRANSITION");
      const target = this.#record("employment_contract", p.target_contract_id);
      must(
        target.employer_id === c.employer_id &&
          ACTUAL_WORK.includes(target.status) &&
          definition.role_scope.includes(this.#role(target).role.role_id),
        "INELIGIBLE_ROLE",
      );
      const handoff = this.#proof("system6", p.handoff_ref, "handoff");
      must(
        handoff.task_id === task.task_id &&
          handoff.target_contract_id === target.contract_id &&
          handoff.accepted === true,
        "INVALID_HANDOFF",
      );
      const e = this.#record("task_execution", task.task_id, true);
      if (e) {
        e.responsibility_intervals.push({
          actor_ref: c.character_id,
          scope: clone(e.remaining_scope),
          interval: { start_ms: handoff.previous_start_ms, end_ms: this.#now },
        });
        e.responsibility_intervals.push({
          actor_ref: target.character_id,
          scope: clone(e.remaining_scope),
          interval: { start_ms: this.#now, end_ms: null },
        });
        e.unresolved_issue_refs.push(p.handoff_ref);
        e.reservation_refs = [];
        e.presence_receipt_refs = [];
        e.authorization_ref = p.handoff_ref;
      }
      this.#event("TaskTransferred", task.task_id, {
        previous_contract_id: c.contract_id,
        target_contract_id: target.contract_id,
        handoff_ref: p.handoff_ref,
      });
      task.assigned_contract_id = target.contract_id;
      task.state = "ASSIGNED";
      task.revision++;
      this.#outbox("system11", "handoff_reservations", p.handoff_ref, {
        task_id: task.task_id,
        previous_contract_id: c.contract_id,
        target_contract_id: target.contract_id,
      });
      return { task_id: task.task_id, state: task.state };
    }
    let execution = this.#record("task_execution", task.task_id, true);
    if (op === "admit") {
      must(["ASSIGNED", "ADMITTED"].includes(task.state), "INVALID_TRANSITION");
      const context = this.#taskContext(task, p.method_id);
      this.#known(c.character_id, task.task_id);
      if (!execution) {
        const first = definition.stages_and_checkpoints[0].stage_id;
        const predecessor = this.#state.integration_and_recovery
          .flatMap((j) => j.evaluated_predicates)
          .find(
            (x) =>
              x.predicate === "task_predecessor" && x.source === task.task_id,
          )?.result;
        execution = this.#put("task_execution", {
          task_id: task.task_id,
          method_id: p.method_id,
          current_stage: first,
          progress: {
            completed_stage_ids: [],
            result_receipts: {},
            effort_receipts: {},
            stage_output_receipts: {},
            stage_actors: {},
            mapping_applied: [],
          },
          remaining_scope: definition.stages_and_checkpoints.map(
            (s) => s.stage_id,
          ),
          queue_priority: context.demand.queue_priority ?? 0,
          deadline_ref: context.demand.deadline_ref ?? null,
          expected_artifact_revisions: [
            {
              owner: "demand_artifacts",
              artifact_ref: task.artifact_ref,
              revision: context.demand.revision,
            },
          ],
          accepted_artifact_revisions: [],
          authorization_ref: this.#command.causation_id,
          reservation_refs: [],
          capability_result_receipt_ref: null,
          time_effort_receipt_refs: [],
          presence_receipt_refs: [],
          achieved_output_receipt_refs: [],
          pending_choice_refs: [],
          predecessor_or_rework_task_refs: predecessor ? [predecessor] : [],
          responsibility_intervals: [],
          unresolved_issue_refs: [],
          learning_receipt_refs: [],
        });
      }
      must(execution.method_id === p.method_id, "FROZEN_METHOD");
      this.#scope(task, execution, p.delegation_ref);
      const active = this.#state.work_task.filter(
        (t) =>
          t.task_id !== task.task_id &&
          ["ADMITTED", "ACTIVE", "PAUSED"].includes(t.state) &&
          t.assigned_contract_id &&
          this.#record("employment_contract", t.assigned_contract_id)
            .character_id === c.character_id,
      );
      must(active.length < 32, "BACKPRESSURE");
      const reservation = this.#request(
        "system11",
        "reserve_task",
        `${task.task_id}:${c.contract_id}`,
        {
          task_id: task.task_id,
          character_id: c.character_id,
          stages: definition.stages_and_checkpoints,
        },
      );
      must(
        reservation.validated_payload.reserved === true,
        "SCHEDULE_CONFLICT",
      );
      const resources = this.#request(
        "inventory_security",
        "reserve_task",
        `${task.task_id}:${c.contract_id}`,
        {
          task_id: task.task_id,
          resources: definition.resources,
          site_ref: context.terms.site_ref,
        },
      );
      must(resources.validated_payload.reserved === true, "MISSING_RESOURCE");
      execution.reservation_refs = [
        ...reservation.canonical_event_refs,
        ...resources.canonical_event_refs,
      ];
      execution.presence_receipt_refs = clone(
        context.presence.canonical_event_refs,
      );
      task.state = "ADMITTED";
      task.revision++;
      this.#event("TaskAdmitted", task.task_id);
      return { task_id: task.task_id, state: task.state };
    }
    must(execution, "UNKNOWN_ASSIGNMENT");
    if (op === "continue_task") {
      must(
        task.state === "PAUSED" && execution.remaining_scope.length > 0,
        "INVALID_TRANSITION",
      );
      const intent = this.#intent(c.character_id, task.task_id);
      must(
        canonical(intent.choice_refs) === canonical(p.choice_refs) &&
          execution.pending_choice_refs.every((ref) =>
            p.choice_refs.includes(ref),
          ),
        "NEEDS_CHOICE",
      );
      execution.pending_choice_refs = [];
      execution.authorization_ref = this.#command.causation_id;
      task.state = "ADMITTED";
      task.revision++;
      return { task_id: task.task_id, state: task.state };
    }
    must(
      ["ADMITTED", "ACTIVE", "PAUSED"].includes(task.state),
      "INVALID_TRANSITION",
    );
    if (task.state === "PAUSED")
      must(execution.pending_choice_refs.length === 0, "NEEDS_CHOICE");
    return this.#executeStage(task, execution, p.delegation_ref);
  }
  #executeStage(task, e, delegationRef) {
    const context = this.#taskContext(task, e.method_id),
      { c, definition, demand, presence } = context;
    const authorized = this.#scope(task, e, delegationRef);
    e.authorization_ref = delegationRef ?? this.#command.causation_id;
    must(e.remaining_scope.length > 0, "NEEDS_REWORK");
    e.current_stage = e.remaining_scope[0];
    const stage = definition.stages_and_checkpoints.find(
      (s) => s.stage_id === e.current_stage,
    );
    must(stage, "MISSING_DEFINITION");
    const source = `${task.task_id}:${stage.stage_id}`,
      expected =
        e.progress.result_receipts[stage.stage_id]?.input_artifact_revision ??
        e.accepted_artifact_revisions.at(-1)?.revision ??
        e.expected_artifact_revisions[0].revision;
    const sampled = !!e.progress.result_receipts[stage.stage_id];
    const ownCommittedRevision = e.accepted_artifact_revisions.at(-1)?.revision;
    if (
      demand.revision !== expected &&
      !(sampled && demand.revision === ownCommittedRevision)
    ) {
      if (sampled) {
        task.state = "PAUSED";
        if (!e.unresolved_issue_refs.includes("STALE_REVISION"))
          e.unresolved_issue_refs.push("STALE_REVISION");
        this.#save("sample_preserved");
      }
      throw new RuleError("STALE_REVISION");
    }
    const checkpoint = this.#proof("system11", source, "checkpoint");
    const conditions = [
      ...stage.stop_conditions,
      ...checkpoint.material_conditions,
    ];
    const unresolved = conditions.filter(
      (flag) =>
        MATERIAL.includes(flag) &&
        !(authorized.accepted_conditions ?? []).includes(flag),
    );
    if (unresolved.length) {
      task.state = "PAUSED";
      e.pending_choice_refs = unresolved.map((flag) => `${source}:${flag}`);
      task.revision++;
      const response = {
        task_id: task.task_id,
        state: "PAUSED",
        pending_choices: clone(e.pending_choice_refs),
      };
      this.#predicate(
        "task_response",
        { task_id: task.task_id, response },
        source,
      );
      this.#save("choice_barrier");
      return response;
    }
    task.state = "ACTIVE";
    let resolution = e.progress.result_receipts[stage.stage_id];
    if (!resolution) {
      const reply = this.#request("system10", "resolve_task", source, {
        task_id: task.task_id,
        stage_id: stage.stage_id,
        actor_ref: c.character_id,
        profile_ref: definition.resolution_profile.profile_ref,
        method_id: e.method_id,
        artifact_ref: task.artifact_ref,
        expected_revision: expected,
      });
      resolution = reply.validated_payload;
      must(
        ["full", "partial", "failure", "critical"].includes(resolution.band),
        "INVALID_RESOLUTION",
      );
      must(
        resolution.task_id === task.task_id &&
          resolution.stage_id === stage.stage_id &&
          resolution.actor_ref === c.character_id,
        "INVALID_RESOLUTION",
      );
      must(
        resolution.profile_ref === definition.resolution_profile.profile_ref &&
          (!resolution.routine_eligible || resolution.no_roll === true),
        "INVALID_RESOLUTION",
      );
      for (const [dimension, score] of Object.entries(resolution.quality)) {
        must(
          definition.quality_dimensions.includes(dimension),
          "INVALID_RUBRIC",
        );
        integer(score);
        must(score <= 4, "INVALID_SCORE");
      }
      resolution = { ...resolution, input_artifact_revision: expected };
      e.progress.result_receipts[stage.stage_id] = clone(resolution);
      e.capability_result_receipt_ref = reply.canonical_event_refs[0];
      e.progress.stage_actors[stage.stage_id] = c.character_id;
      this.#save("sample_durable");
    }
    // A partially resolved stage cannot silently attribute its result to a new worker.
    must(
      e.progress.stage_actors[stage.stage_id] === c.character_id,
      "HANDOFF_REQUIRES_STAGE_POLICY",
    );
    let effort = e.progress.effort_receipts[stage.stage_id];
    if (!effort) {
      const receipt = this.#request("system11", "certify_effort", source, {
        task_id: task.task_id,
        stage_id: stage.stage_id,
        actor_ref: c.character_id,
        duration_seconds: stage.duration_seconds,
        reservation_refs: e.reservation_refs,
      });
      effort = receipt.validated_payload;
      interval({ start_ms: effort.start_ms, end_ms: effort.end_ms });
      must(
        effort.end_ms !== null &&
          effort.end_ms > effort.start_ms &&
          effort.actor_ref === c.character_id &&
          effort.task_id === task.task_id,
        "INVALID_EFFORT",
      );
      must(
        effort.end_ms - effort.start_ms === stage.duration_seconds * 1000 &&
          covers(c, effort) &&
          covers(presence.interval, effort),
        "INVALID_EFFORT",
      );
      const prior = this.#state.integration_and_recovery
        .flatMap((j) => j.evaluated_predicates)
        .filter((p) => p.predicate === "certified_effort");
      for (const previous of prior) {
        const other = previous.result;
        if (
          previous.source !== source &&
          other.actor_ref === effort.actor_ref &&
          overlaps(other, effort)
        )
          must(
            other.compatible_task_refs?.includes(task.task_id) &&
              effort.compatible_task_refs?.includes(other.task_id),
            "OVERLAPPING_EFFORT",
          );
      }
      if (delegationRef) {
        const scope = this.#record("routine_delegation", delegationRef),
          authorization = this.#proof("system1", delegationRef, "delegation");
        must(
          effort.end_ms <=
            authorization.start_ms + scope.authorization_horizon_ms,
          "NEEDS_CHOICE",
        );
      }
      e.progress.effort_receipts[stage.stage_id] = clone(effort);
      e.time_effort_receipt_refs.push(...receipt.canonical_event_refs);
      this.#predicate("certified_effort", effort, source);
      this.#save("effort_durable");
    }
    const outputs = definition.outputs.filter((o) =>
      o.bands.includes(resolution.band),
    );
    const outputRefs = [],
      resourceCosts = [];
    for (const output of outputs) {
      const payload = {
        task_id: task.task_id,
        stage_id: stage.stage_id,
        source_demand_ref: task.demand_source_id,
        artifact_ref: task.artifact_ref,
        result_receipt_ref: e.capability_result_receipt_ref,
        effort_receipt_refs: e.time_effort_receipt_refs,
        method_id: e.method_id,
      };
      if (!output.required) {
        this.#outbox(output.owner, output.command_type, source, payload);
        continue;
      }
      const receipt = this.#request(
        output.owner,
        output.command_type,
        source,
        payload,
        { revision: expected },
      );
      outputRefs.push(...receipt.canonical_event_refs);
      resourceCosts.push(...(receipt.validated_payload.resource_costs ?? []));
      if (receipt.validated_payload.artifact_revision !== undefined) {
        integer(receipt.validated_payload.artifact_revision);
        e.accepted_artifact_revisions.push({
          owner: output.owner,
          artifact_ref: task.artifact_ref,
          revision: receipt.validated_payload.artifact_revision,
        });
      }
    }
    must(
      outputs.some((o) => o.required),
      "MISSING_OUTPUT_OWNER",
    );
    if (delegationRef) {
      const delegation = this.#record("routine_delegation", delegationRef);
      for (const cost of resourceCosts) {
        integer(cost.amount);
        const limit = delegation.resource_and_cost_limits.find(
          (l) => l.resource_ref === cost.resource_ref,
        );
        must(
          limit && (limit.consumed ?? 0) + cost.amount <= limit.maximum,
          "OWNER_SCOPE_VIOLATION",
        );
        limit.consumed = (limit.consumed ?? 0) + cost.amount;
      }
    }
    const receiptId = stableId(
      this.#world,
      this.#branch,
      task.task_id,
      c.character_id,
      source,
    );
    if (!this.#record("work_receipt", receiptId, true))
      this.#put("work_receipt", {
        receipt_id: receiptId,
        task_id: task.task_id,
        character_id: c.character_id,
        source_event_id: source,
        effort_json: JSON.stringify(effort),
        quality_json: JSON.stringify(resolution.quality),
      });
    e.progress.stage_output_receipts[stage.stage_id] = outputRefs;
    e.achieved_output_receipt_refs = [
      ...new Set([...e.achieved_output_receipt_refs, ...outputRefs]),
    ];
    e.progress.completed_stage_ids.push(stage.stage_id);
    e.remaining_scope = e.remaining_scope.filter((id) => id !== stage.stage_id);
    const mapping = definition.result_mapping[resolution.band];
    if (resolution.band !== "full") {
      must(
        mapping.remaining_scope.every(
          (id) =>
            definition.stages_and_checkpoints.some((s) => s.stage_id === id) &&
            !e.progress.completed_stage_ids.includes(id),
        ),
        "INVALID_PARTIAL_POLICY",
      );
      e.remaining_scope = clone(mapping.remaining_scope);
    }
    if (mapping.needs_choice || mapping.terminal_state === "PAUSED") {
      task.state = "PAUSED";
      e.pending_choice_refs = [`${source}:continuation`];
    } else
      task.state =
        mapping.terminal_state === "FAILED"
          ? "FAILED"
          : e.remaining_scope.length
            ? "ACTIVE"
            : "COMPLETED";
    if (e.remaining_scope.length) e.current_stage = e.remaining_scope[0];
    task.revision++;
    const event = this.#event(
      task.state === "COMPLETED" ? "TaskCompleted" : "TaskProgressed",
      task.task_id,
      { receipt_id: receiptId },
    );
    this.#outbox("system3", "work_observation", source, {
      actor_ref: c.character_id,
      task_id: task.task_id,
      output_receipt_refs: outputRefs,
    });
    this.#outbox("system4", "work_experience", source, {
      actor_ref: c.character_id,
      event_ref: event,
      observation_source_ref: source,
    });
    if (definition.learning_eligibility.enabled === true)
      this.#outbox("system10", "learning_evidence", source, {
        actor_ref: c.character_id,
        task_id: task.task_id,
        effort_receipt_refs: clone(e.time_effort_receipt_refs),
        resolution_receipt_ref: e.capability_result_receipt_ref,
        completion_receipt_ref: receiptId,
        eligibility_policy: definition.learning_eligibility,
      });
    this.#predicate(
      "performance_evidence",
      {
        worker_ref: c.character_id,
        receipt_id: receiptId,
        work_context_ref: demand.work_context_ref,
      },
      source,
    );
    this.#outbox("system1", "compensation_evidence", source, {
      contract_id: c.contract_id,
      work_receipt_ref: receiptId,
    });
    const response = {
      task_id: task.task_id,
      state: task.state,
      receipt_id: receiptId,
      output_receipt_refs: outputRefs,
      pending_choices: clone(e.pending_choice_refs),
    };
    this.#predicate(
      "task_response",
      { task_id: task.task_id, response },
      source,
    );
    this.#save("work_committed");
    return response;
  }
  #professional(op, p) {
    if (op === "incident") {
      const r = clone(p.record);
      validateRecord("quality_and_incidents", r);
      must(r.task_and_artifact_refs.length > 0, "MISSING_EVIDENCE");
      const task = r.task_and_artifact_refs
        .map((ref) => this.#record("work_task", ref, true))
        .find(Boolean);
      must(task, "MISSING_EVIDENCE");
      const contract = this.#record(
        "employment_contract",
        task.assigned_contract_id,
      );
      this.#intent(this.#principal.actor_ref, r.incident_id);
      must(
        r.observed_evidence_refs.length > 0 &&
          r.detection_source_refs.length > 0,
        "MISSING_EVIDENCE",
      );
      // Client reports carry observations/claims. Hidden truth is filled internally,
      // never compared against client guesses that could become a probing oracle.
      must(
        Object.keys(r.true_quality).length === 0 &&
          r.objective_fault_ref === null &&
          r.actual_impact_receipt_refs.length === 0,
        "PRIVATE_FIELD",
      );
      for (const ref of [
        ...r.observed_evidence_refs,
        ...r.detection_source_refs,
      ])
        this.#known(this.#principal.actor_ref, ref);
      const truth = this.#proof(
        "demand_artifacts",
        r.incident_id,
        "incident_evidence",
      );
      must(truth.task_id === task.task_id, "INVALID_INCIDENT");
      r.objective_fault_ref = truth.objective_fault_ref;
      r.true_quality = clone(truth.true_quality);
      r.severity = truth.severity;
      r.actual_impact_receipt_refs = clone(truth.actual_impact_receipt_refs);
      for (const claim of r.attribution_claims) {
        exact(claim, ["actor_ref", "source_ref", "confidence"]);
        this.#known(this.#principal.actor_ref, claim.source_ref);
      }
      const duplicate = this.#state.quality_and_incidents.find(
        (i) =>
          i.incident_id === r.incident_id ||
          (r.objective_fault_ref &&
            i.objective_fault_ref === r.objective_fault_ref),
      );
      if (duplicate) {
        if (
          !duplicate.duplicate_report_refs.includes(this.#command.causation_id)
        )
          duplicate.duplicate_report_refs.push(this.#command.causation_id);
        return { incident_id: duplicate.incident_id, duplicate: true };
      }
      must(
        r.containment_request_refs.length === 0 &&
          r.remedy_task_and_receipt_refs.length === 0,
        "UNAUTHORIZED_EFFECT",
      );
      this.#put("quality_and_incidents", r);
      this.#outbox("system3", "incident_report", r.incident_id, {
        incident_id: r.incident_id,
        employer_id: contract.employer_id,
        source_refs: r.observed_evidence_refs,
      });
      return { incident_id: r.incident_id };
    }
    if (op === "review") {
      const r = clone(p.record);
      validateRecord("performance_and_review", r);
      must(
        !this.#record("performance_and_review", r.review_id, true),
        "DUPLICATE_REVIEW",
      );
      const contract = this.#state.employment_contract.find(
        (c) => c.character_id === r.worker_ref && OCCUPIED.includes(c.status),
      );
      must(contract, "INELIGIBLE_ROLE");
      this.#authority(contract.employer_id, "evaluate_work");
      must(r.evaluator_ref === this.#principal.actor_ref, "AUTHORITY_DENIED");
      const policy = this.#policy(contract, r.weighting_policy_version);
      interval(r.review_window);
      must(r.review_window.end_ms <= this.#now, "INVALID_REVIEW_WINDOW");
      must(
        r.review_window.end_ms - r.review_window.start_ms <=
          (policy.window_ms ?? 28 * 86400000) || policy.milestone === true,
        "INVALID_REVIEW_WINDOW",
      );
      const refs = [...new Set(r.source_receipt_refs)],
        contexts = new Set(),
        components = new Map();
      for (const ref of refs) {
        const knowledge = this.#known(r.evaluator_ref, ref);
        must(
          knowledge.evidence && knowledge.evidence.worker_ref === r.worker_ref,
          "MISSING_EVIDENCE",
        );
        must(
          knowledge.evidence.simulation_time_ms >= r.review_window.start_ms &&
            knowledge.evidence.simulation_time_ms < r.review_window.end_ms,
          "INVALID_REVIEW_WINDOW",
        );
        contexts.add(knowledge.evidence.work_context_ref);
        for (const [key, value] of Object.entries(
          knowledge.evidence.component_scores ?? {},
        )) {
          must(r.components.includes(key), "INVALID_RUBRIC");
          integer(value);
          must(value <= 4, "INVALID_SCORE");
          if (!components.has(key)) components.set(key, []);
          components.get(key).push(value);
        }
      }
      r.source_receipt_refs = refs;
      r.sample_size = refs.length;
      r.distinct_context_count = contexts.size;
      r.evidence_sufficient =
        r.sample_size >= (policy.minimum_items ?? 5) &&
        r.distinct_context_count >= (policy.minimum_contexts ?? 2);
      r.component_scores = {};
      if (r.evidence_sufficient)
        for (const [key, scores] of components)
          r.component_scores[key] = roundHalfUp(
            divide(
              rational(scores.reduce((a, b) => a + b, 0)),
              rational(scores.length),
            ),
          );
      r.evaluator_known_evidence_refs = clone(refs);
      for (const adjustment of r.subjective_adjustments) {
        exact(adjustment, [
          "source_ref",
          "policy_ref",
          "component",
          "adjustment",
        ]);
        this.#known(r.evaluator_ref, adjustment.source_ref);
        must(adjustment.policy_ref === policy.version, "INVALID_POLICY");
      }
      // Subjective adjustments remain separate; they never rewrite objective component evidence.
      must(
        r.communication_refs.length === 0 &&
          r.appeal_and_correction_refs.length === 0,
        "UNAUTHORIZED_EFFECT",
      );
      r.finding_refs = [
        this.#event("ReviewIssued", r.review_id, {
          evidence_sufficient: r.evidence_sufficient,
        }),
      ];
      this.#put("performance_and_review", r);
      this.#outbox("system3", "review_notice", r.review_id, {
        review_id: r.review_id,
        worker_ref: r.worker_ref,
        finding_refs: r.finding_refs,
      });
      return {
        review_id: r.review_id,
        evidence_sufficient: r.evidence_sufficient,
        component_scores: r.component_scores,
      };
    }
    if (op === "career") {
      const c = this.#record("employment_contract", p.contract_id),
        edge = this.#record("career_edge", p.edge_id),
        v = this.#record("vacancy", p.vacancy_id);
      this.#authority(v.employer_id, "hire");
      must(
        this.#role(c).role.role_id === edge.source_role_ref,
        "INELIGIBLE_ROLE",
      );
      const org = this.#record("organization", v.employer_id),
        slot = org.role_slots.find((s) => s.role_slot_id === v.role_slot_id);
      must(slot?.role_id === edge.target_role_ref, "INELIGIBLE_ROLE");
      this.#capacity(
        v.employer_id,
        v.role_slot_id,
        { start_ms: this.#now, end_ms: null },
        c.contract_id,
      );
      for (const requirement of [
        ...edge.credential_requirements,
        ...edge.task_evidence_requirements,
        ...edge.vacancy_and_authority_requirements,
        ...edge.availability_requirements,
      ]) {
        const proof = this.#proof(
          requirement.owner,
          `${c.character_id}:${requirement.kind}`,
          requirement.kind,
        );
        must(proof.valid === true, "INELIGIBLE_ROLE");
      }
      must(
        this.#now - c.start_ms >=
          (edge.experience_interval_requirement.minimum_ms ?? 0),
        "INELIGIBLE_ROLE",
      );
      const decision = this.#proof(
        "system6",
        p.decision_ref,
        "career_decision",
      );
      must(
        decision.character_id === c.character_id &&
          decision.edge_id === edge.edge_id &&
          decision.vacancy_id === v.vacancy_id &&
          decision.assessment_policy_ref === edge.assessment_policy_ref,
        "INVALID_DECISION",
      );
      edge.decision_ref = p.decision_ref;
      this.#outbox("system3", "career_decision", p.decision_ref, {
        character_id: c.character_id,
        edge_id: edge.edge_id,
        vacancy_id: v.vacancy_id,
      });
      // Advancement remains an offer/application, then accepted contract + provisioning.
      return {
        edge_id: edge.edge_id,
        vacancy_id: v.vacancy_id,
        decision_ref: p.decision_ref,
        requires_accepted_contract: true,
      };
    }
    if (op === "discipline") {
      const r = clone(p.record);
      validateRecord("discipline_and_grievance", r);
      must(
        !this.#record("discipline_and_grievance", r.case_id, true),
        "DUPLICATE_DISCIPLINE",
      );
      const c = this.#record("employment_contract", r.contract_id);
      this.#authority(
        c.employer_id,
        r.action === "termination" ? "terminate" : "discipline",
      );
      must(
        r.decision_authority_ref === this.#command.principal_authority_ref &&
          r.incident_and_evidence_refs.length > 0,
        "AUTHORITY_DENIED",
      );
      for (const ref of r.incident_and_evidence_refs)
        this.#known(this.#principal.actor_ref, ref);
      const policy = this.#policy(c, r.policy_version);
      must(policy.kind === "discipline", "INVALID_POLICY");
      const decision = this.#proof(
        "system6",
        r.decision_ref,
        "discipline_decision",
      );
      must(
        decision.case_id === r.case_id &&
          decision.contract_id === c.contract_id &&
          decision.action === r.action &&
          decision.policy_version === r.policy_version,
        "INVALID_DECISION",
      );
      const prior = this.#state.discipline_and_grievance.filter(
        (d) => d.contract_id === c.contract_id,
      );
      must(
        !prior.some(
          (d) =>
            d.action === r.action &&
            canonical([...d.incident_and_evidence_refs].sort()) ===
              canonical([...r.incident_and_evidence_refs].sort()),
        ),
        "DUPLICATE_DISCIPLINE",
      );
      if (policy.baseline !== false) {
        if (decision.isolated_routine_issue === true)
          must(r.action === "coaching", "DISCIPLINE_POLICY");
        if (decision.repeated_material_incidents === true)
          must(
            decision.review_ref &&
              this.#record("performance_and_review", decision.review_ref),
            "DISCIPLINE_POLICY",
          );
        if (
          r.action === "termination" &&
          decision.severe_protective_exception !== true
        )
          must(
            prior.some((d) => d.action === "warning"),
            "DISCIPLINE_POLICY",
          );
      } else {
        must(decision.authored_policy_reason_ref, "DISCIPLINE_POLICY");
        this.#known(
          this.#principal.actor_ref,
          decision.authored_policy_reason_ref,
        );
      }
      interval(r.effective_interval);
      must(
        r.grievance_submission_ref === null && r.appeal_decision_ref === null,
        "UNAUTHORIZED_EFFECT",
      );
      this.#put("discipline_and_grievance", r);
      if (r.action === "termination")
        this.#endEmployment(c, {
          effective_ms: r.effective_interval.start_ms,
          reason: decision.reason,
        });
      if (r.action === "suspension") {
        c.status = "SUSPENDED";
        c.revision++;
      }
      if (["restricted duty", "suspension"].includes(r.action))
        this.#outbox("inventory_security", "restrict_duties", r.decision_ref, {
          contract_id: c.contract_id,
          interval: r.effective_interval,
          decision_ref: r.decision_ref,
        });
      this.#outbox("system3", "discipline_notice", r.case_id, {
        contract_id: c.contract_id,
        case_id: r.case_id,
        decision_ref: r.decision_ref,
      });
      return { case_id: r.case_id, action: r.action };
    }
    const d = this.#record("discipline_and_grievance", p.case_id),
      c = this.#record("employment_contract", d.contract_id);
    if (op === "grievance") {
      this.#intent(c.character_id, p.case_id);
      must(d.grievance_submission_ref === null, "DUPLICATE_GRIEVANCE");
      const submission = this.#proof(
        "system3",
        p.submission_ref,
        "grievance_submission",
      );
      must(
        submission.case_id === d.case_id &&
          submission.actor_ref === c.character_id,
        "INVALID_GRIEVANCE",
      );
      this.#actionEffort(this.#command.causation_id);
      d.grievance_submission_ref = p.submission_ref;
      return { case_id: d.case_id, grievance_submission_ref: p.submission_ref };
    }
    this.#authority(c.employer_id, "discipline");
    must(
      d.grievance_submission_ref && d.appeal_decision_ref === null,
      "INVALID_TRANSITION",
    );
    const decision = this.#proof(
      "system6",
      p.decision_ref,
      "grievance_decision",
    );
    must(
      decision.case_id === d.case_id && decision.authorized === true,
      "INVALID_DECISION",
    );
    d.reviewer_authority_ref = this.#command.principal_authority_ref;
    d.appeal_decision_ref = p.decision_ref;
    this.#outbox("system3", "finding_correction", p.decision_ref, {
      case_id: d.case_id,
      original_decision_ref: d.decision_ref,
      correction_ref: p.decision_ref,
    });
    return { case_id: d.case_id, appeal_decision_ref: p.decision_ref };
  }
  #coverage(contract, sourceRefs, period) {
    const sources = [...new Set(sourceRefs)].map((ref) =>
      this.#proof("system11", ref, "pay_coverage"),
    );
    const intervals = [];
    let seconds = rational(0);
    for (const proof of sources) {
      must(
        proof.contract_id === contract.contract_id &&
          proof.actor_ref === contract.character_id &&
          proof.period_id === period,
        "INVALID_PAY_COVERAGE",
      );
      interval(proof.interval);
      must(
        proof.interval.end_ms !== null && covers(contract, proof.interval),
        "INVALID_PAY_COVERAGE",
      );
      const duration = divide(
        rational(proof.interval.end_ms - proof.interval.start_ms),
        rational(1000),
      );
      const payable = rational(proof.payable_seconds);
      must(
        payable[0] >= 0n &&
          payable[0] * duration[1] <= duration[0] * payable[1],
        "INVALID_PAY_COVERAGE",
      );
      must(
        !intervals.some((i) => overlaps(i, proof.interval)),
        "OVERLAPPING_PAY",
      );
      intervals.push(proof.interval);
      for (const other of this.#state.compensation.filter(
        (x) => x.contract_id !== contract.contract_id,
      )) {
        const otherContract = this.#record(
          "employment_contract",
          other.contract_id,
        );
        if (otherContract.character_id !== contract.character_id) continue;
        for (const previousRef of other.source_refs) {
          const previous =
            this.#owners.read("system11").validated_payload?.proofs?.[
              previousRef
            ];
          if (previous?.kind === "pay_coverage")
            must(
              !overlaps(previous.interval, proof.interval),
              "OVERLAPPING_PAY",
            );
        }
      }
      if (proof.kind_of_time === "paid_leave")
        must(
          proof.approved_leave_ref && proof.balance_receipt_ref,
          "UNAPPROVED_LEAVE",
        );
      else
        must(
          ["worked", "availability"].includes(proof.kind_of_time),
          "INVALID_PAY_COVERAGE",
        );
      seconds = add(seconds, payable);
    }
    return { seconds, proofs: sources };
  }
  #pay(op, p) {
    if (op === "allocate_tips") return this.#tips(p);
    if (op === "accrue") {
      const c = this.#record("employment_contract", p.contract_id);
      this.#authority(c.employer_id, "payroll_approve");
      const termsVersion = p.terms_version ?? c.terms_version;
      must(
        termsVersion === c.terms_version ||
          this.#state.integration_and_recovery.some((j) =>
            j.evaluated_predicates.some(
              (x) =>
                x.predicate === "event" &&
                x.result.source === c.contract_id &&
                ["ContractAccepted", "ContractAmended"].includes(
                  x.result.type,
                ) &&
                [
                  x.result.terms_version,
                  x.result.previous_terms_version,
                ].includes(termsVersion),
            ),
          ),
        "INVALID_TERMS_VERSION",
      );
      const terms = this.#record("contract_terms", termsVersion),
        policy = this.#policy(c, terms.compensation_policy_ref);
      const period = this.#proof("system11", p.period_id, "pay_period");
      must(period.closed === true && period.end_ms <= this.#now, "PERIOD_OPEN");
      const entitlementId = stableId(
        this.#world,
        this.#branch,
        c.contract_id,
        termsVersion,
        p.period_id,
      );
      const previous = this.#record("compensation", entitlementId, true);
      const sources = [...new Set(p.source_refs)].sort();
      must(sources.length > 0, "MISSING_EVIDENCE");
      if (previous) {
        must(
          canonical(previous.source_refs) === canonical(sources),
          "IMMUTABLE_ENTITLEMENT",
        );
        return {
          entitlement_id: previous.entitlement_id,
          gross_entitlement: previous.gross_entitlement,
        };
      }
      must(
        [
          "hourly",
          "salary",
          "per accepted task/output",
          "commission",
          "explicit combination",
        ].includes(policy.method),
        "INVALID_PAY_POLICY",
      );
      let gross = rational(0),
        seconds = rational(0);
      const components =
        policy.method === "explicit combination" ? policy.components : [policy];
      must(
        components.length > 0 &&
          new Set(components.map((x) => x.method)).size === components.length,
        "DUPLICATE_PAY_COMPONENT",
      );
      // A closed settlement period is accrued once. Later missing coverage is an
      // explicit reconciliation, not another independently rounded wage line.
      if (components.some((component) => component.method === "hourly")) {
        must(
          !this.#state.compensation.some(
            (line) =>
              line.contract_id === c.contract_id &&
              line.period_id === p.period_id &&
              ["hourly", "explicit combination"].includes(line.method),
          ),
          "PERIOD_ALREADY_ACCRUED",
        );
      }
      const consumed = new Set();
      for (const component of components) {
        if (component.method === "hourly") {
          const refs = sources.filter(
            (ref) =>
              this.#owners.read("system11").validated_payload?.proofs?.[ref]
                ?.kind === "pay_coverage",
          );
          must(refs.length > 0, "MISSING_EVIDENCE");
          const coverage = this.#coverage(c, refs, p.period_id);
          seconds = coverage.seconds;
          for (const proof of coverage.proofs) {
            must(
              covers(
                { start_ms: period.start_ms, end_ms: period.end_ms },
                proof.interval,
              ),
              "INVALID_PAY_PERIOD",
            );
            must(proof.terms_version === termsVersion, "INVALID_TERMS_VERSION");
            consumed.add(proof.source_ref);
          }
          gross = add(
            gross,
            divide(
              multiply(rational(component.rate_cents_per_hour), seconds),
              rational(3600),
            ),
          );
        } else if (component.method === "salary") {
          const refs = sources.filter(
            (ref) =>
              this.#owners.read("system11").validated_payload?.proofs?.[ref]
                ?.kind === "salary_eligibility",
          );
          must(refs.length === 1, "DUPLICATE_SALARY");
          const proof = this.#proof("system11", refs[0], "salary_eligibility");
          must(
            proof.contract_id === c.contract_id &&
              proof.period_id === p.period_id &&
              proof.eligible === true &&
              proof.terms_version === termsVersion,
            "INVALID_PAY_COVERAGE",
          );
          must(
            !this.#state.compensation.some(
              (x) =>
                x.contract_id === c.contract_id &&
                x.period_id === p.period_id &&
                ["salary", "explicit combination"].includes(x.method),
            ),
            "DUPLICATE_SALARY",
          );
          gross = add(gross, rational(component.salary_period_amount));
          consumed.add(refs[0]);
        } else if (component.method === "per accepted task/output") {
          const receipts = sources
            .map((ref) => this.#record("work_receipt", ref, true))
            .filter(Boolean);
          must(receipts.length > 0, "MISSING_EVIDENCE");
          for (const receipt of receipts) {
            const task = this.#record("work_task", receipt.task_id);
            const effort = JSON.parse(receipt.effort_json);
            must(
              receipt.character_id === c.character_id &&
                task.assigned_contract_id === c.contract_id &&
                task.state === "COMPLETED" &&
                effort.start_ms >= period.start_ms &&
                effort.end_ms <= period.end_ms,
              "INVALID_PAY_SOURCE",
            );
            // Only the final accepted task receipt qualifies; intermediate stages are not extra products.
            const e = this.#record("task_execution", task.task_id);
            must(
              receipt.source_event_id.endsWith(
                `:${e.progress.completed_stage_ids.at(-1)}`,
              ),
              "INVALID_PAY_SOURCE",
            );
            consumed.add(receipt.receipt_id);
          }
          gross = add(
            gross,
            multiply(
              rational(component.per_output_rate),
              rational(receipts.length),
            ),
          );
        } else if (component.method === "commission") {
          const refs = sources.filter(
            (ref) =>
              this.#owners.read("economy").validated_payload?.proofs?.[ref]
                ?.kind === "qualifying_sale",
          );
          must(refs.length > 0, "MISSING_EVIDENCE");
          for (const ref of refs) {
            const sale = this.#proof("economy", ref, "qualifying_sale");
            must(
              sale.settled === true &&
                sale.qualifies === true &&
                sale.contract_id === c.contract_id &&
                sale.period_id === p.period_id &&
                sale.policy_ref === component.commission_policy_ref,
              "INVALID_PAY_SOURCE",
            );
            gross = add(
              gross,
              multiply(
                rational(sale.qualifying_cents),
                rational(component.commission_rate),
              ),
            );
            consumed.add(ref);
          }
        } else throw new RuleError("INVALID_PAY_POLICY");
      }
      must(consumed.size === sources.length, "INVALID_PAY_SOURCE");
      for (const other of this.#state.compensation)
        must(
          !other.source_refs.some((ref) => sources.includes(ref)),
          "DUPLICATE_ENTITLEMENT",
        );
      let carry = rational(0);
      if (policy.carry_fractions === true) {
        const candidates = this.#state.compensation.filter(
          (x) =>
            x.contract_id === c.contract_id && x.terms_version === termsVersion,
        );
        if (candidates.length) {
          const last = candidates.at(-1),
            lastPeriod = this.#proof("system11", last.period_id, "pay_period");
          must(lastPeriod.end_ms === period.start_ms, "CARRY_SEQUENCE");
          carry = rational(last.fractional_remainder);
        }
      }
      gross = add(gross, carry);
      const grossCents = roundHalfUp(gross);
      must(grossCents >= 0, "INVALID_AMOUNT");
      const r = this.#put("compensation", {
        entitlement_id: entitlementId,
        contract_id: c.contract_id,
        terms_version: termsVersion,
        source_refs: sources,
        period_id: p.period_id,
        method: policy.method,
        currency: policy.currency ?? "USD",
        currency_precision: policy.currency_precision ?? 2,
        rate_cents_per_hour: policy.rate_cents_per_hour ?? null,
        payable_seconds: asJSON(seconds),
        salary_period_amount: policy.salary_period_amount ?? null,
        per_output_rate: policy.per_output_rate ?? null,
        commission_policy_ref: policy.commission_policy_ref ?? null,
        paid_time_and_leave_policy_ref: policy.paid_time_and_leave_policy_ref,
        rounding_and_carry_policy_ref: policy.rounding_and_carry_policy_ref,
        fractional_remainder: asJSON(add(gross, rational(-grossCents))),
        approved_adjustment_lines: [],
        gross_entitlement: grossCents,
        net_owed: grossCents,
        actual_settled_amount: 0,
        payroll_state: "ACCRUED",
        payroll_request_ref: null,
        economy_receipt_refs: [],
        dispute_refs: [],
      });
      this.#event("CompensationAccrued", entitlementId);
      return {
        entitlement_id: entitlementId,
        gross_entitlement: r.gross_entitlement,
      };
    }
    const r = this.#record("compensation", p.entitlement_id),
      c = this.#record("employment_contract", r.contract_id);
    if (op === "dispute_pay") {
      this.#intent(c.character_id, r.entitlement_id);
      this.#known(c.character_id, p.dispute_ref);
      if (!r.dispute_refs.includes(p.dispute_ref))
        r.dispute_refs.push(p.dispute_ref);
      r.payroll_state = "DISPUTED";
      return { entitlement_id: r.entitlement_id, state: r.payroll_state };
    }
    this.#authority(c.employer_id, "payroll_approve");
    if (op === "approve_payroll") {
      must(
        ["ACCRUED", "DISPUTED"].includes(r.payroll_state),
        "INVALID_TRANSITION",
      );
      if (r.payroll_state === "DISPUTED") {
        const decision = this.#proof(
          "economy",
          r.entitlement_id,
          "pay_dispute_decision",
        );
        must(decision.resolved === true, "UNRESOLVED_DISPUTE");
      }
      r.payroll_state = "APPROVED";
      return { entitlement_id: r.entitlement_id, state: r.payroll_state };
    }
    if (op === "adjust_compensation") {
      const adjustment = this.#proof(
        "economy",
        p.adjustment_ref,
        "pay_adjustment",
      );
      must(
        adjustment.entitlement_id === r.entitlement_id &&
          adjustment.authorized === true,
        "INVALID_ADJUSTMENT",
      );
      must(
        !r.approved_adjustment_lines.some(
          (a) => a.source_ref === p.adjustment_ref,
        ),
        "DUPLICATE_ADJUSTMENT",
      );
      integer(adjustment.amount_cents, Number.MIN_SAFE_INTEGER);
      const reply = this.#request(
        "economy",
        "adjust_entitlement",
        p.adjustment_ref,
        {
          entitlement_id: r.entitlement_id,
          adjustment_ref: p.adjustment_ref,
          original_receipt_refs: r.economy_receipt_refs,
        },
      );
      must(
        reply.validated_payload.adjustment_cents === adjustment.amount_cents,
        "INVALID_SETTLEMENT",
      );
      r.approved_adjustment_lines.push({
        source_ref: p.adjustment_ref,
        policy_ref: adjustment.policy_ref,
        amount: adjustment.amount_cents,
      });
      r.net_owed = safeNumber(
        BigInt(r.net_owed) + BigInt(adjustment.amount_cents),
      );
      if (reply.validated_payload.settled_delta_cents !== undefined)
        r.actual_settled_amount = safeNumber(
          BigInt(r.actual_settled_amount) +
            BigInt(reply.validated_payload.settled_delta_cents),
        );
      must(r.actual_settled_amount >= 0, "INVALID_SETTLEMENT");
      r.economy_receipt_refs.push(...reply.canonical_event_refs);
      r.payroll_state =
        r.actual_settled_amount === r.net_owed ? "SETTLED" : "DISPUTED";
      return {
        entitlement_id: r.entitlement_id,
        net_owed: r.net_owed,
        actual_settled_amount: r.actual_settled_amount,
      };
    }
    if (r.payroll_state === "SETTLED")
      return {
        entitlement_id: r.entitlement_id,
        actual_settled_amount: r.actual_settled_amount,
      };
    must(
      ["APPROVED", "REQUESTED", "RECOVERY_REQUIRED"].includes(r.payroll_state),
      "INVALID_TRANSITION",
    );
    r.payroll_state = "REQUESTED";
    r.payroll_request_ref = ownerKey(
      this.#world,
      this.#branch,
      "economy",
      "settle_payroll",
      r.entitlement_id,
    );
    try {
      const response = this.#request(
        "economy",
        "settle_payroll",
        r.entitlement_id,
        {
          entitlement_id: r.entitlement_id,
          contract_id: r.contract_id,
          period_id: r.period_id,
          currency: r.currency,
          amount_cents: r.net_owed,
          source_refs: r.source_refs,
        },
      );
      must(
        response.validated_payload.entitlement_id === r.entitlement_id &&
          response.validated_payload.settled_amount_cents === r.net_owed,
        "INVALID_SETTLEMENT",
      );
      r.actual_settled_amount = response.validated_payload.settled_amount_cents;
      r.payroll_state = "SETTLED";
      r.economy_receipt_refs = [
        ...new Set([
          ...r.economy_receipt_refs,
          ...response.canonical_event_refs,
        ]),
      ];
      this.#outbox("system3", "pay_notice", r.entitlement_id, {
        contract_id: c.contract_id,
        entitlement_id: r.entitlement_id,
        settlement_refs: r.economy_receipt_refs,
      });
      return {
        entitlement_id: r.entitlement_id,
        net_owed: r.net_owed,
        actual_settled_amount: r.actual_settled_amount,
      };
    } catch (error) {
      r.payroll_state = "RECOVERY_REQUIRED";
      this.#save("payroll_recovery");
      throw error;
    }
  }
  #tips(p) {
    const c = this.#record("employment_contract", p.contract_id);
    this.#authority(c.employer_id, "payroll_approve");
    const policy = this.#policy(c, p.policy_ref);
    must(policy.kind === "tip_allocation", "INVALID_PAY_POLICY");
    const refs = [...new Set(p.transfer_refs)].sort();
    must(
      refs.length === p.transfer_refs.length && refs.length > 0,
      "DUPLICATE_TIP",
    );
    const existing = this.#state.tip_and_commission_allocation.find(
      (a) => canonical(a.source_transfer_or_sale_refs) === canonical(refs),
    );
    if (existing) return { allocation: clone(existing) };
    must(
      !this.#state.tip_and_commission_allocation.some((a) =>
        a.source_transfer_or_sale_refs.some((ref) => refs.includes(ref)),
      ),
      "DUPLICATE_TIP",
    );
    let total = 0n;
    for (const ref of refs) {
      const transfer = this.#proof("economy", ref, "tip_transfer");
      must(
        transfer.settled === true &&
          transfer.voluntary === true &&
          transfer.employer_id === c.employer_id &&
          transfer.policy_ref === p.policy_ref,
        "INVALID_TIP",
      );
      integer(transfer.amount_cents);
      total += BigInt(transfer.amount_cents);
    }
    const pool = safeNumber(total),
      participants = [];
    for (const ref of p.coverage_refs) {
      const proof = this.#proof("system11", ref, "tip_coverage");
      must(
        proof.policy_ref === p.policy_ref &&
          proof.employer_id === c.employer_id &&
          proof.eligible === true,
        "INVALID_TIP_COVERAGE",
      );
      const roleWeight = policy.role_weights[proof.role_ref];
      must(roleWeight !== undefined, "INVALID_TIP_POLICY");
      participants.push({
        participant_id: proof.participant_id,
        eligible_service_seconds: proof.eligible_service_seconds,
        role_weight: roleWeight,
      });
    }
    const allocation = allocateTipPool(pool, participants);
    const record = {
      source_transfer_or_sale_refs: refs,
      revenue_type: policy.direct === true ? "direct tip" : "tip pool",
      ownership_and_eligibility_policy_ref: p.policy_ref,
      pool_amount_cents: pool,
      participants: allocation,
      exclusion_and_refund_policy_ref: policy.refund_policy_ref ?? null,
      adjustment_receipt_refs: [],
    };
    this.#put("tip_and_commission_allocation", record);
    this.#outbox("economy", "allocate_tips", stableId(refs), {
      source_refs: refs,
      policy_ref: p.policy_ref,
      participants: allocation,
    });
    return { allocation: record };
  }
  #routine(op, p) {
    if (op === "delegate") {
      const r = clone(p.record);
      validateRecord("routine_delegation", r);
      this.#intent(r.actor_ref, r.delegation_ref);
      must(
        !this.#record("routine_delegation", r.delegation_ref, true),
        "DUPLICATE_DELEGATION",
      );
      const proof = this.#proof("system1", r.delegation_ref, "delegation");
      must(
        proof.actor_ref === r.actor_ref &&
          proof.active === true &&
          canonical(proof.scope) === canonical(r),
        "INVALID_DELEGATION",
      );
      must(
        r.authorization_horizon_ms > 0 &&
          r.pending_choice_refs.length === 0 &&
          r.aggregate_receipt_refs.length === 0,
        "INVALID_DELEGATION",
      );
      must(
        r.resource_and_cost_limits.every((l) => (l.consumed ?? 0) === 0),
        "INVALID_DELEGATION",
      );
      this.#put("routine_delegation", r);
      return { delegation_ref: r.delegation_ref };
    }
    const d = this.#record("routine_delegation", p.delegation_ref);
    this.#intent(d.actor_ref, d.delegation_ref);
    if (op === "stop_routine") {
      if (!d.pending_choice_refs.includes("PLAYER_STOPPED"))
        d.pending_choice_refs.push("PLAYER_STOPPED");
      for (const task of this.#state.work_task) {
        const e = this.#record("task_execution", task.task_id, true);
        if (
          e?.authorization_ref === d.delegation_ref &&
          !FINAL_TASK.includes(task.state)
        ) {
          task.state = "PAUSED";
          task.revision++;
        }
      }
      return { delegation_ref: d.delegation_ref, stopped: true };
    }
    must(d.pending_choice_refs.length === 0, "NEEDS_CHOICE");
    must(new Set(p.task_ids).size === p.task_ids.length, "DUPLICATE_TASK");
    const receipts = [],
      results = [];
    for (const id of p.task_ids) {
      const task = this.#record("work_task", id),
        execution = this.#record("task_execution", id),
        c = this.#record("employment_contract", task.assigned_contract_id);
      must(
        c.character_id === d.actor_ref &&
          d.eligible_task_types.includes(task.definition_id),
        "NEEDS_CHOICE",
      );
      if (FINAL_TASK.includes(task.state)) {
        results.push({ task_id: id, state: task.state });
        continue;
      }
      while (["ADMITTED", "ACTIVE"].includes(task.state)) {
        const result = this.#executeStage(task, execution, d.delegation_ref);
        results.push(result);
        if (result.receipt_id) receipts.push(result.receipt_id);
        if (task.state === "PAUSED") {
          d.pending_choice_refs = [
            ...new Set([
              ...d.pending_choice_refs,
              ...execution.pending_choice_refs,
            ]),
          ];
          return {
            delegation_ref: d.delegation_ref,
            results,
            pending_choices: clone(d.pending_choice_refs),
          };
        }
      }
    }
    d.aggregate_receipt_refs = [
      ...new Set([...d.aggregate_receipt_refs, ...receipts]),
    ];
    return { delegation_ref: d.delegation_ref, results };
  }
  #interaction(p) {
    must(
      [
        "help",
        "handoff",
        "conflict",
        "gossip",
        "social_contact",
        "boundary_context",
        "opportunity",
      ].includes(p.kind),
      "INVALID_INTERACTION",
    );
    this.#intent(p.actor_ref, p.event_ref);
    const observation = this.#proof("system3", p.event_ref, "interaction");
    must(
      observation.delivered === true &&
        observation.actor_ref === p.actor_ref &&
        observation.channel_ref === p.channel_ref &&
        observation.era_year === 2012,
      "INVALID_CHANNEL",
    );
    must(
      canonical(observation.recipient_refs) === canonical(p.recipient_refs) &&
        canonical(observation.source_refs) === canonical(p.source_refs) &&
        observation.interaction_kind === p.kind,
      "INVALID_INTERACTION",
    );
    for (const ref of p.source_refs) this.#known(p.actor_ref, ref);
    const payload = {
      event_ref: p.event_ref,
      actor_ref: p.actor_ref,
      source_refs: p.source_refs,
      channel_ref: p.channel_ref,
      recipient_refs: p.recipient_refs,
      kind: p.kind,
    };
    for (const owner of ["system3", "system4", "system5", "system6", "system7"])
      this.#outbox(owner, "workplace_interaction", p.event_ref, payload);
    if (p.kind === "boundary_context" || p.kind === "social_contact")
      this.#outbox(
        "system8",
        "workplace_boundary_context",
        p.event_ref,
        payload,
      );
    // The owner-supplied audience projection excludes hidden beliefs, quality and motives.
    if (observation.audience_safe_projection)
      this.#outbox("system2", "narrate_workplace_interaction", p.event_ref, {
        projection: observation.audience_safe_projection,
      });
    return { event_ref: p.event_ref, delivered_evidence: true };
  }
  #flush() {
    must(this.#principal.scopes.includes("recovery"), "AUTHORITY_DENIED");
    let delivered = 0,
      pending = 0;
    // Snapshot the journals: request receipts can append to the current journal.
    for (const journal of [...this.#state.integration_and_recovery]) {
      for (const entry of journal.outbox_entries) {
        if (entry.delivery.inherited || entry.delivery.status === "accepted")
          continue;
        const response = this.#request(
          entry.destination,
          entry.delivery.command_type,
          entry.source,
          entry.payload,
          { required: false },
        );
        entry.delivery.status = response.status;
        if (response.status === "accepted") {
          entry.delivery.canonical_event_refs = clone(
            response.canonical_event_refs,
          );
          delivered++;
          if (
            entry.destination === "system10" &&
            entry.delivery.command_type === "learning_evidence"
          ) {
            const e = this.#record(
              "task_execution",
              entry.payload.task_id,
              true,
            );
            if (e)
              e.learning_receipt_refs = [
                ...new Set([
                  ...e.learning_receipt_refs,
                  ...response.canonical_event_refs,
                ]),
              ];
          }
        } else pending++;
      }
      journal.outbox_cursor = journal.outbox_entries.findIndex(
        (e) => e.delivery.status !== "accepted" && !e.delivery.inherited,
      );
      if (journal.outbox_cursor < 0)
        journal.outbox_cursor = journal.outbox_entries.length;
    }
    return { delivered, pending };
  }
  #query({ kind, id }) {
    const actor = this.#principal.actor_ref;
    const knowledge = this.#known(actor, `${kind}:${id}`);
    this.#record(kind, id);
    // Explicit owner disclosure is necessary even for a worker's own uncommunicated records.
    const permitted = {
      employment_contract: [
        "contract_id",
        "character_id",
        "employer_id",
        "role_slot_id",
        "terms_version",
        "start_ms",
        "end_ms",
        "status",
        "revision",
      ],
      work_task: [
        "task_id",
        "definition_id",
        "definition_version",
        "demand_source_id",
        "assigned_contract_id",
        "state",
        "artifact_ref",
        "work_cycle_index",
        "revision",
      ],
      offer: [
        "offer_id",
        "application_id",
        "frozen_terms_version",
        "acceptance_or_rejection_ref",
      ],
      application_and_assessment: [
        "application_id",
        "vacancy_id",
        "character_id",
        "state",
        "revision",
        "decision_ref",
        "decision_communication_refs",
      ],
      compensation: [
        "entitlement_id",
        "contract_id",
        "period_id",
        "currency",
        "gross_entitlement",
        "approved_adjustment_lines",
        "net_owed",
        "actual_settled_amount",
        "payroll_state",
        "dispute_refs",
      ],
      performance_and_review: [
        "review_id",
        "worker_ref",
        "component_scores",
        "evidence_sufficient",
        "sample_size",
        "confidence",
        "finding_refs",
        "communication_refs",
      ],
      discipline_and_grievance: [
        "case_id",
        "contract_id",
        "action",
        "effective_interval",
        "decision_ref",
        "grievance_submission_ref",
        "appeal_decision_ref",
      ],
      vacancy: [
        "vacancy_id",
        "employer_id",
        "role_slot_id",
        "requirements",
        "application_window",
        "posting_channels",
      ],
    }[kind];
    must(permitted, "ACCESS_BLOCKED");
    must(Array.isArray(knowledge.allowed_fields), "ACCESS_BLOCKED");
    // A previously learned record is not a subscription to private future edits.
    // Read the acquired owner projection, never the latest hidden canonical row.
    must(
      knowledge.projection &&
        typeof knowledge.projection === "object" &&
        !Array.isArray(knowledge.projection),
      "UNKNOWN_INFORMATION",
    );
    const projection = Object.fromEntries(
      permitted
        .filter(
          (field) =>
            knowledge.allowed_fields.includes(field) &&
            Object.hasOwn(knowledge.projection, field),
        )
        .map((field) => [field, clone(knowledge.projection[field])]),
    );
    return { projection };
  }
  #fork(p) {
    must(this.#principal.scopes.includes("developer"), "AUTHORITY_DENIED");
    text(p.target_branch_id);
    must(
      p.target_branch_id !== this.#branch &&
        !this.#store.exists(this.#world, p.target_branch_id),
      "BRANCH_EXISTS",
    );
    must(
      !this.#state.integration_and_recovery.some(
        (j) =>
          j !== this.#journal &&
          ["COMMITTING", "BLOCKED"].includes(j.execution_saga_state) &&
          j.owner_requests.length > 0,
      ),
      "RECOVERY_PENDING",
    );
    const copy = new JobsState(this.#state.toJSON());
    // Canonical past remains dated to its originating branch. Inherited deliveries never execute again.
    for (const journal of copy.integration_and_recovery) {
      for (const e of journal.outbox_entries) e.delivery.inherited = true;
      journal.outbox_cursor = journal.outbox_entries.length;
    }
    this.#store.save(this.#world, p.target_branch_id, copy);
    return { branch_id: p.target_branch_id };
  }
}
