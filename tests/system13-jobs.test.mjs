import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import {
  JobsEngine,
  JobsState,
  FixedOwnerStubs,
  OWNER_STUBS,
  stableId,
  ownerKey,
  hourlyEntitlement,
  allocateTipPool,
  createCareerDefinitions,
  createCareerPack,
  validateOrganization,
  validatePack,
  validateDefinition,
  SCHEMAS,
} from "../src/system13/index.mjs";

/** Fixtures are literal receipts; no dependency has a simulated state machine. */
function fixture() {
  const world = "world",
    branch = "main",
    now = 10_000_000,
    snapshots = {},
    replies = {},
    commands = {};
  const proof = (owner, ref, kind, data) => {
    snapshots[owner] ??= {
      status: "accepted",
      canonical_event_refs: [`${owner}:snapshot`],
      validated_payload: { proofs: {} },
    };
    snapshots[owner].validated_payload.proofs[ref] = {
      kind,
      world_id: world,
      branch_id: branch,
      source_ref: ref,
      canonical_event_refs: [`${owner}:${ref}`],
      ...structuredClone(data),
    };
  };
  const reply = (owner, operation, source, data = {}, revision = 0) => {
    const key = ownerKey(world, branch, owner, operation, source);
    replies[key] = {
      status: "accepted",
      idempotency_key: key,
      source_ref: source,
      expected_revision: revision,
      canonical_event_refs: [`${owner}:${operation}:${source}`],
      validated_payload: {
        world_id: world,
        branch_id: branch,
        ...structuredClone(data),
      },
    };
    return key;
  };
  const known = (actor, ref, data = {}) =>
    proof("system3", `${actor}:${ref}`, "knowledge", {
      known: true,
      acquisition_ref: `acquired:${ref}`,
      ...data,
    });
  const command = (
    id,
    operation,
    payload,
    principal = "manager",
    revisions = [],
  ) => {
    const c = {
      command_id: id,
      branch_id: branch,
      principal_id: principal,
      principal_authority_ref:
        principal === "manager" ? "manager-authority" : "player-authority",
      operation,
      payload: structuredClone(payload),
      expected_revisions: revisions.map(([kind, id, revision]) => ({
        kind,
        id,
        revision,
      })),
      correlation_id: id,
      causation_id: `intent:${id}`,
    };
    commands[id] = c;
    return c;
  };
  const intent = (id, actor, subject, extra = {}) => {
    const c = commands[id];
    proof("system1", c.causation_id, "intent", {
      authorized: true,
      principal_id: c.principal_id,
      actor_ref: actor,
      command_id: id,
      operation: c.operation,
      subject_ref: subject,
      payload_hash: stableId(c.payload),
      accepted_conditions: [],
      ...extra,
    });
  };
  const action = (id) => {
    const c = commands[id];
    proof("system11", c.causation_id, "action_effort", {
      actor_ref: c.principal_id,
      payable_seconds: 30,
      channel_ref: "telephone",
      era_year: 2012,
    });
    reply("system11", "execute_action", c.causation_id);
  };
  proof("system1", "manager", "principal", {
    principal_id: "manager",
    actor_ref: "manager",
    actor_type: "PC",
    authenticated: true,
    authority_ref: "manager-authority",
    scopes: ["creator", "developer", "recovery"],
  });
  proof("system1", "player", "principal", {
    principal_id: "player",
    actor_ref: "player",
    actor_type: "PC",
    authenticated: true,
    authority_ref: "player-authority",
    scopes: [],
  });
  proof("system11", "clock", "clock", { now_ms: now });
  proof("system12", "bar", "workplace", { site_refs: ["site"] });
  proof("economy", "budget", "budget", { funded: true });
  const defs = createCareerDefinitions("bartender");
  const pack = createCareerPack("bartender", {
    pay_policy_ref: "pay-v1",
    access_map: ["site"],
    hierarchy: ["bartender", "lead"],
  });
  const org = {
    employer_id: "employer",
    workplace_id: "bar",
    site_refs: ["site"],
    departments: [],
    role_definitions: [
      {
        role_id: "bartender",
        version: "1",
        duties: defs.map((d) => d.task_id),
        pack,
        policies: [
          {
            version: "pay-v1",
            kind: "compensation",
            method: "hourly",
            rate_cents_per_hour: 1200,
            currency: "USD",
            currency_precision: 2,
            paid_time_and_leave_policy_ref: "leave-v1",
            rounding_and_carry_policy_ref: "round-v1",
          },
          { version: "probation-v1", kind: "probation", required: false },
          { version: "schedule-v1", kind: "schedule", grace_ms: 300000 },
          { version: "selection-v1", kind: "selection", offer_threshold: 7 },
          { version: "tie-v1", kind: "earlier_assessment" },
          { version: "review-v1", kind: "review" },
          { version: "discipline-v1", kind: "discipline", baseline: true },
          {
            version: "tips-v1",
            kind: "tip_allocation",
            role_weights: { bartender: "1" },
          },
        ],
      },
    ],
    role_slots: [
      {
        role_slot_id: "slot",
        role_id: "bartender",
        capacity: 1,
        budget_ref: "budget",
      },
    ],
    role_assignments: [
      {
        character_id: "manager",
        role_slot_id: "slot",
        scopes: [
          "hire",
          "assign_work",
          "approve_leave",
          "evaluate_work",
          "discipline",
          "terminate",
          "payroll_approve",
        ],
        effective_interval: { start_ms: 0, end_ms: null },
        authority_ref: "manager-authority",
      },
    ],
    reporting_edges: [],
    authority_scopes: [
      "hire",
      "assign_work",
      "approve_leave",
      "evaluate_work",
      "discipline",
      "terminate",
      "payroll_approve",
    ],
    deputy_authorizations: [],
    operational_policy_versions: [],
  };
  const terms = {
    version: "terms-v1",
    site_ref: "site",
    duties: defs.map((d) => d.task_id),
    compensation_policy_ref: "pay-v1",
    schedule_policy_ref: "schedule-v1",
    probation_policy_ref: "probation-v1",
    leave_policy_ref: "leave-v1",
    call_out_policy_ref: "call-v1",
    discipline_policy_ref: "discipline-v1",
    confidentiality_scopes: [],
    access_scopes: ["site"],
    prerequisite_refs: [],
    acceptance_ref: "terms-template",
    amendments: [],
    end_reason: null,
  };
  const vacancy = {
    vacancy_id: "vacancy",
    employer_id: "employer",
    role_slot_id: "slot",
    capacity: 1,
    budget_ref: "budget",
    requirements: [],
    hiring_authority_ref: "manager-authority",
    application_window: { start_ms: 0, end_ms: null },
    posting_channels: ["notice"],
    publication_evidence_refs: ["posted"],
    selection_policy_version: "selection-v1",
    tie_policy_ref: "tie-v1",
    persisted_tie_result_ref: null,
    revision: 0,
  };
  command("configure", "configure", {
    organizations: [org],
    task_definitions: defs,
    contract_terms: [terms],
    vacancies: [vacancy],
    career_edges: [],
  });
  command(
    "apply",
    "apply",
    {
      application_id: "application",
      vacancy_id: "vacancy",
      character_id: "player",
      lineage_ref: "app-lineage",
      identity_claim_refs: ["claimed-name"],
      experience_claim_refs: [],
      reference_claim_refs: [],
      supplied_availability: [{ start_ms: 0, end_ms: null }],
    },
    "player",
    [["vacancy", "vacancy", 0]],
  );
  intent("apply", "player", "vacancy");
  known("player", "vacancy");
  command(
    "submit",
    "application_stage",
    { application_id: "application", state: "SUBMITTED" },
    "player",
    [["application_and_assessment", "application", 0]],
  );
  intent("submit", "player", "application");
  action("submit");
  command(
    "screen",
    "application_stage",
    { application_id: "application", state: "SCREENING" },
    "manager",
    [["application_and_assessment", "application", 1]],
  );
  command(
    "assess",
    "assess",
    { application_id: "application", assessment_ref: "assessment" },
    "manager",
    [["application_and_assessment", "application", 2]],
  );
  proof("system10", "assessment", "assessment", {
    application_id: "application",
    character_id: "player",
    eligibility: "PASS",
    task_demonstration_score: 4,
    experience_score: 3,
    schedule_score: 3,
    reference_score: 2,
    hard_schedule_conflict: false,
    reference_confidence: "1",
    verified_evidence_refs: ["evidence"],
    credential_verification_refs: [],
    assessment_artifact_refs: ["demonstration"],
  });
  known("manager", "evidence");
  proof("system11", "assessment:application", "assessment_time", {
    completed_ms: 1000,
  });
  command(
    "select",
    "select",
    {
      vacancy_id: "vacancy",
      terms_version: "terms-v1",
      onboarding_line_ids: ["access", "schedule"],
    },
    "manager",
    [["vacancy", "vacancy", 0]],
  );
  const offerId = stableId(branch, "vacancy", "application", "offer");
  known("player", offerId);
  const lines = ["access", "schedule"].map((line_id, index) => ({
    line_id,
    owner: index ? "system11" : "inventory_security",
    preconditions: [],
    required: true,
    idempotency_key: ownerKey(
      world,
      branch,
      index ? "system11" : "inventory_security",
      "provision",
      `contract:${line_id}`,
    ),
    owner_receipt_ref: null,
  }));
  proof("legal_institutions", offerId, "onboarding_plan", { lines });
  command(
    "accept",
    "accept_offer",
    {
      offer_id: offerId,
      contract_id: "contract",
      start_ms: 0,
      end_ms: null,
      onboarding_lines: lines,
    },
    "player",
  );
  intent("accept", "player", offerId);
  for (const line of lines)
    reply(line.owner, "provision", `contract:${line.line_id}`);
  const taskId = stableId(
      world,
      branch,
      "bartender.serve",
      "order",
      "artifact",
      0,
    ),
    stageSource = `${taskId}:serve`;
  proof("demand_artifacts", "order", "demand", {
    available: true,
    artifact_ref: "artifact",
    revision: 0,
    employer_id: "employer",
    partition_ref: "bar",
    demand_type: "order",
    work_context_ref: "service",
    order_id: "order",
    requested_product: "water",
    quantity: 1,
    preferences: [],
    payment_ref: "tab",
    known_restrictions: [],
  });
  proof(
    "legal_institutions",
    "order:service_authorization",
    "service_authorization",
    { valid: true },
  );
  proof("system12", "player", "presence", {
    site_ref: "site",
    reachable_artifact_refs: ["artifact"],
    interval: { start_ms: 0, end_ms: null },
  });
  proof("system10", "player:bar_service", "capability", { eligible: true });
  known("player", taskId);
  command("enqueue", "enqueue", {
    definition_id: "bartender.serve",
    definition_version: "1",
    demand_source_id: "order",
    artifact_ref: "artifact",
  });
  command(
    "assign",
    "assign",
    { task_id: taskId, contract_id: "contract" },
    "manager",
    [["work_task", taskId, 0]],
  );
  command(
    "admit",
    "admit",
    { task_id: taskId, method_id: "standard" },
    "player",
    [["work_task", taskId, 1]],
  );
  intent("admit", "player", taskId);
  reply("system11", "reserve_task", `${taskId}:contract`, { reserved: true });
  reply("inventory_security", "reserve_task", `${taskId}:contract`, {
    reserved: true,
  });
  command("execute", "execute", { task_id: taskId }, "player", [
    ["work_task", taskId, 2],
  ]);
  intent("execute", "player", taskId);
  proof("system11", stageSource, "checkpoint", { material_conditions: [] });
  reply("system10", "resolve_task", stageSource, {
    task_id: taskId,
    stage_id: "serve",
    actor_ref: "player",
    profile_ref: "bar_service",
    band: "full",
    quality: { request_match: 4 },
    routine_eligible: true,
    no_roll: true,
  });
  reply("system11", "certify_effort", stageSource, {
    task_id: taskId,
    stage_id: "serve",
    actor_ref: "player",
    start_ms: 100000,
    end_ms: 400000,
    compatible_task_refs: [],
  });
  reply("inventory_security", "product_transferred", stageSource, {
    artifact_revision: 1,
  });
  proof("system11", "period", "pay_period", {
    closed: true,
    start_ms: 0,
    end_ms: now,
  });
  proof("system11", "coverage", "pay_coverage", {
    contract_id: "contract",
    actor_ref: "player",
    period_id: "period",
    terms_version: "terms-v1",
    interval: { start_ms: 0, end_ms: 5400000 },
    payable_seconds: 5400,
    kind_of_time: "worked",
  });
  command("accrue", "accrue", {
    contract_id: "contract",
    period_id: "period",
    source_refs: ["coverage"],
  });
  const entitlementId = stableId(
    world,
    branch,
    "contract",
    "terms-v1",
    "period",
  );
  command("approve", "approve_payroll", { entitlement_id: entitlementId });
  command("pay", "payroll", { entitlement_id: entitlementId });
  reply("economy", "settle_payroll", entitlementId, {
    entitlement_id: entitlementId,
    settled_amount_cents: 1800,
  });
  command("inspect", "inspect", {});
  command("flush", "flush_outbox", {});
  const all = [
    "configure",
    "apply",
    "submit",
    "screen",
    "assess",
    "select",
    "accept",
    "enqueue",
    "assign",
    "admit",
    "execute",
    "accrue",
    "approve",
    "pay",
  ];
  return {
    world,
    branch,
    now,
    snapshots,
    replies,
    commands,
    proof,
    reply,
    known,
    command,
    intent,
    action,
    org,
    terms,
    vacancy,
    defs,
    taskId,
    stageSource,
    entitlementId,
    offerId,
    all,
  };
}
function open(f, { filename = ":memory:", fault = null } = {}) {
  return new JobsEngine({
    filename,
    world_id: f.world,
    branch_id: f.branch,
    owners: new FixedOwnerStubs({ snapshots: f.snapshots, replies: f.replies }),
    fault,
  });
}
function run(engine, f, ids = f.all) {
  for (const id of ids) {
    const response = engine.dispatch(f.commands[id]);
    assert.equal(
      response.status,
      "accepted",
      `${id}: ${JSON.stringify(response)}`,
    );
  }
}
function state(engine, f) {
  const result = engine.dispatch(f.commands.inspect);
  assert.equal(result.status, "accepted");
  return result.state;
}
const through = (f, id) => f.all.slice(0, f.all.indexOf(id) + 1);
function removeTemp(dir) {
  const target = resolve(dir);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith("valor13-"));
  rmSync(target, { recursive: true });
}

test("fixed stubs never implement external behavior and default calls fail closed", () => {
  for (const stub of Object.values(OWNER_STUBS))
    assert.deepEqual(stub(), stub({ forged: true }));
  const f = fixture(),
    engine = new JobsEngine({ world_id: f.world, branch_id: f.branch });
  assert.equal(engine.dispatch(f.commands.configure).code, "OWNER_UNAVAILABLE");
  engine.close();
});
test("JobsState has exactly the prescribed categories and rejects unknown state fields", () => {
  const s = new JobsState();
  assert.deepEqual(Object.keys(s).sort(), Object.keys(SCHEMAS).sort());
  assert.throws(
    () => new JobsState({ ...s.toJSON(), cash: 9000 }),
    /UNKNOWN_FIELD/,
  );
});
test("three careers define distinct workflows and meet pack requirements", () => {
  const grammars = [];
  for (const id of ["bartender", "detective", "mortuary"]) {
    const definitions = createCareerDefinitions(id);
    definitions.forEach(validateDefinition);
    const pack = createCareerPack(id, {
      pay_policy_ref: "pay",
      access_map: ["site"],
      hierarchy: ["worker", "lead"],
    });
    validatePack(pack, definitions);
    grammars.push(pack.grammar);
  }
  assert.equal(new Set(grammars).size, 3);
});
test("hourly arithmetic is exact and rounds once, including fractional seconds", () => {
  assert.equal(hourlyEntitlement(1200, 5400).cents, 1800);
  assert.equal(hourlyEntitlement(1, 1800).cents, 1);
  assert.equal(hourlyEntitlement(1200, "3/2").cents, 1);
  assert.equal(hourlyEntitlement(1, 3600).cents, 1);
  assert.throws(() => hourlyEntitlement(100, -1), /INVALID_DURATION/);
});
test("tip allocation conserves every cent and breaks equal remainders by stable ID", () => {
  const result = allocateTipPool(101, [
    { participant_id: "b", eligible_service_seconds: 60, role_weight: 1 },
    { participant_id: "a", eligible_service_seconds: 60, role_weight: 1 },
  ]);
  assert.equal(
    result.find((p) => p.participant_id === "a").final_allocation_cents,
    51,
  );
  assert.equal(
    result.reduce((sum, p) => sum + p.final_allocation_cents, 0),
    101,
  );
  assert.throws(
    () =>
      allocateTipPool(101, [
        { participant_id: "a", eligible_service_seconds: 0, role_weight: 1 },
      ]),
    /ZERO_WEIGHT/,
  );
});
test("full hiring, accepted contract, ordinary work and payroll flow", () => {
  const f = fixture(),
    engine = open(f);
  run(engine, f);
  const s = state(engine, f);
  assert.equal(s.employment_contract[0].status, "ACTIVE");
  assert.equal(s.work_task[0].state, "COMPLETED");
  assert.equal(s.work_receipt.length, 1);
  assert.equal(s.compensation[0].gross_entitlement, 1800);
  assert.equal(s.compensation[0].actual_settled_amount, 1800);
  assert.equal(s.task_execution[0].learning_receipt_refs.length, 0); // queued evidence is not awarded skill
  assert.equal(
    s.integration_and_recovery
      .flatMap((j) => j.outbox_entries)
      .filter((e) => e.destination === "system10").length,
    1,
  );
  engine.close();
});
test("100 repeated commands preserve one task, receipt, entitlement and settlement", () => {
  const f = fixture(),
    engine = open(f);
  run(engine, f);
  const expected = engine.dispatch(f.commands.execute);
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(engine.dispatch(f.commands.execute), expected);
    assert.equal(engine.dispatch(f.commands.pay).status, "accepted");
  }
  const s = state(engine, f);
  assert.equal(s.work_receipt.length, 1);
  assert.equal(s.compensation.length, 1);
  assert.equal(
    s.integration_and_recovery
      .flatMap((j) => j.owner_requests)
      .filter((r) => r.command_type === "economy.settle_payroll").length,
    1,
  );
  engine.close();
});
test("changed payload under an existing command ID is an idempotency conflict", () => {
  const f = fixture(),
    engine = open(f);
  run(engine, f, through(f, "execute"));
  assert.equal(
    engine.dispatch({ ...f.commands.execute, payload: { task_id: "other" } })
      .code,
    "IDEMPOTENCY_CONFLICT",
  );
  engine.close();
});
test("extra fields, missing revisions and forged authority cannot mutate state", () => {
  const f = fixture(),
    engine = open(f);
  run(engine, f, ["configure"]);
  assert.equal(
    engine.dispatch({ ...f.commands.apply, success: true }).code,
    "UNKNOWN_FIELD",
  );
  assert.equal(
    engine.dispatch({ ...f.commands.apply, expected_revisions: [] }).code,
    "MISSING_REVISION",
  );
  assert.equal(
    engine.dispatch({
      ...f.commands.configure,
      command_id: "forged",
      principal_id: "player",
    }).code,
    "AUTHORITY_DENIED",
  );
  assert.equal(state(engine, f).employment_contract.length, 0);
  engine.close();
});
test("missing regulated authorization blocks a highly skilled worker without a sample", () => {
  const f = fixture();
  delete f.snapshots.legal_institutions.validated_payload.proofs[
    "order:service_authorization"
  ];
  const engine = open(f);
  run(engine, f, through(f, "assign"));
  assert.equal(engine.dispatch(f.commands.admit).status, "blocked");
  const s = state(engine, f);
  assert.equal(s.work_receipt.length, 0);
  assert.equal(s.work_task[0].state, "ASSIGNED");
  engine.close();
});
test("missing demand cannot produce output", () => {
  const f = fixture();
  delete f.snapshots.demand_artifacts.validated_payload.proofs.order;
  const engine = open(f);
  run(engine, f, through(f, "accept"));
  assert.equal(engine.dispatch(f.commands.enqueue).status, "blocked");
  assert.equal(state(engine, f).work_task.length, 0);
  engine.close();
});
test("managerial cycles are rejected only when their effective intervals overlap", () => {
  const f = fixture(),
    org = structuredClone(f.org);
  org.reporting_edges = [
    {
      supervisor_id: "a",
      subordinate_id: "b",
      scopes: ["assign_work"],
      effective_interval: { start_ms: 0, end_ms: 10 },
    },
    {
      supervisor_id: "b",
      subordinate_id: "a",
      scopes: ["assign_work"],
      effective_interval: { start_ms: 10, end_ms: 20 },
    },
  ];
  validateOrganization(org);
  org.reporting_edges[1].effective_interval.start_ms = 9;
  assert.throws(() => validateOrganization(org), /MANAGERIAL_CYCLE/);
});
test("new risk pauses before resolution and does not invent a player response", () => {
  const f = fixture();
  f.snapshots.system11.validated_payload.proofs[
    f.stageSource
  ].material_conditions = ["new_risk"];
  const engine = open(f);
  run(engine, f, through(f, "admit"));
  const result = engine.dispatch(f.commands.execute);
  assert.equal(result.state, "PAUSED");
  assert.equal(result.pending_choices.length, 1);
  const s = state(engine, f);
  assert.equal(s.work_receipt.length, 0);
  assert.equal(s.task_execution[0].capability_result_receipt_ref, null);
  engine.close();
});
test("payroll outage retains the exact entitlement and resumes the original request", () => {
  const f = fixture(),
    key = ownerKey(
      f.world,
      f.branch,
      "economy",
      "settle_payroll",
      f.entitlementId,
    ),
    good = structuredClone(f.replies[key]);
  delete f.replies[key];
  const dir = mkdtempSync(join(tmpdir(), "valor13-")),
    filename = join(dir, "state.sqlite");
  let engine = open(f, { filename });
  run(engine, f, through(f, "approve"));
  assert.equal(engine.dispatch(f.commands.pay).code, "OWNER_UNAVAILABLE");
  let s = state(engine, f);
  assert.equal(s.compensation[0].net_owed, 1800);
  assert.equal(s.compensation[0].actual_settled_amount, 0);
  engine.close();
  f.replies[key] = good;
  engine = open(f, { filename });
  assert.equal(engine.dispatch(f.commands.pay).actual_settled_amount, 1800);
  s = state(engine, f);
  assert.equal(
    s.integration_and_recovery
      .flatMap((j) => j.owner_requests)
      .filter((r) => r.idempotency_key === key).length,
    1,
  );
  engine.close();
  removeTemp(dir);
});
for (const boundary of ["sample_durable", "effort_durable", "work_committed"])
  test(`crash recovery at ${boundary} preserves one result and output`, () => {
    const f = fixture(),
      dir = mkdtempSync(join(tmpdir(), "valor13-")),
      filename = join(dir, "state.sqlite");
    let armed = false;
    let engine = open(f, {
      filename,
      fault: (label) => {
        if (armed && label === boundary) {
          armed = false;
          throw new Error("CRASH");
        }
      },
    });
    run(engine, f, through(f, "admit"));
    armed = true;
    assert.throws(() => engine.dispatch(f.commands.execute), /CRASH/);
    engine.close();
    const resolutionKey = ownerKey(
      f.world,
      f.branch,
      "system10",
      "resolve_task",
      f.stageSource,
    );
    f.replies[resolutionKey].validated_payload.band = "failure"; // changed fixture must not replace an accepted sample
    engine = open(f, { filename });
    assert.equal(engine.dispatch(f.commands.execute).state, "COMPLETED");
    const s = state(engine, f);
    assert.equal(s.work_receipt.length, 1);
    assert.equal(JSON.parse(s.work_receipt[0].quality_json).request_match, 4);
    engine.close();
    removeTemp(dir);
  });
test("private state is not exposed by queries or inspector privilege escalation", () => {
  const f = fixture();
  f.command(
    "private",
    "query",
    { kind: "quality_and_incidents", id: "secret" },
    "player",
  );
  f.command("spy", "inspect", {}, "player");
  const engine = open(f);
  run(engine, f, through(f, "execute"));
  assert.equal(engine.dispatch(f.commands.private).status, "rejected");
  assert.equal(engine.dispatch(f.commands.spy).code, "AUTHORITY_DENIED");
  engine.close();
});

test("exclusive attendance grace cutoff is late and does not alter certified missed effort", () => {
  const f = fixture();
  f.proof("system11", "shift", "shift", {
    employer_id: "employer",
    start_ms: 9000000,
    end_ms: f.now,
  });
  f.proof("system12", "contract:shift", "attendance", {
    character_id: "player",
    arrival_ms: 9300000,
    departure_ms: f.now,
    check_in_receipt_refs: ["check-in"],
    notice_evidence_refs: [],
  });
  f.proof("system11", "contract:shift", "attendance_coverage", {
    coverage_refs: ["actual-coverage"],
    missed_effort: { seconds: 300 },
  });
  f.command("attendance", "attendance", {
    contract_id: "contract",
    shift_ref: "shift",
  });
  const engine = open(f);
  run(engine, f, through(f, "accept"));
  const result = engine.dispatch(f.commands.attendance);
  assert.equal(result.interpretation, "LATE");
  const row = state(engine, f).attendance[0];
  assert.equal(row.arrival_ms, 9300000);
  assert.deepEqual(row.missed_effort, { seconds: 300 });
  engine.close();
});
test("denied call-out remains a request and never forces attendance or grants paid leave", () => {
  const f = fixture();
  f.proof("system11", "shift", "shift", {
    employer_id: "employer",
    start_ms: 9000000,
    end_ms: f.now,
  });
  f.command(
    "call",
    "call_out",
    {
      contract_id: "contract",
      shift_ref: "shift",
      channel_ref: "telephone",
      explanation_ref: "supplied-explanation",
    },
    "player",
  );
  f.intent("call", "player", "contract");
  f.action("call");
  const requestRef = stableId(
    f.world,
    f.branch,
    "call",
    "LeaveRequested",
    "contract:shift",
  );
  f.proof("system6", "denial", "leave_decision", {
    contract_id: "contract",
    shift_ref: "shift",
    request_ref: requestRef,
    approved: false,
  });
  f.command("deny", "decide_leave", {
    contract_id: "contract",
    shift_ref: "shift",
    decision_ref: "denial",
  });
  const engine = open(f);
  run(engine, f, [...through(f, "accept"), "call", "deny"]);
  const s = state(engine, f);
  assert.equal(s.attendance[0].arrival_ms, null);
  assert.equal(s.attendance[0].leave_decision_ref, "denial");
  assert.equal(s.compensation.length, 0);
  engine.close();
});
function reviewRecord(f, refs) {
  return {
    performance_evidence_id: "review-evidence",
    worker_ref: "player",
    source_receipt_refs: refs,
    work_context_ref: "general",
    review_id: "review",
    review_window: { start_ms: 0, end_ms: f.now },
    evaluator_ref: "manager",
    evaluator_known_evidence_refs: [],
    components: ["task performance"],
    component_scores: { "task performance": 0 },
    confidence: null,
    sample_size: 0,
    distinct_context_count: 0,
    evidence_sufficient: false,
    weighting_policy_version: "review-v1",
    subjective_adjustments: [],
    finding_refs: [],
    communication_refs: [],
    appeal_and_correction_refs: [],
  };
}
test("insufficient reviews do not fabricate ratings; five observations across two contexts qualify", () => {
  for (const count of [1, 5]) {
    const f = fixture(),
      refs = [];
    for (let i = 0; i < count; i++) {
      const ref = `review-evidence-${i}`;
      refs.push(ref);
      f.known("manager", ref, {
        evidence: {
          worker_ref: "player",
          simulation_time_ms: 1000,
          work_context_ref: i % 2 ? "closing" : "service",
          component_scores: { "task performance": 4 },
        },
      });
    }
    f.command("review", "review", { record: reviewRecord(f, refs) });
    const engine = open(f);
    run(engine, f, [...through(f, "accept"), "review"]);
    const r = state(engine, f).performance_and_review[0];
    assert.equal(r.evidence_sufficient, count === 5);
    assert.deepEqual(
      r.component_scores,
      count === 5 ? { "task performance": 4 } : {},
    );
    engine.close();
  }
});
test("hidden performance evidence cannot be used by a supervisor", () => {
  const f = fixture();
  f.command("review", "review", {
    record: reviewRecord(f, ["unobserved-fault"]),
  });
  const engine = open(f);
  run(engine, f, through(f, "accept"));
  assert.equal(engine.dispatch(f.commands.review).code, "MISSING_EVIDENCE");
  assert.equal(state(engine, f).performance_and_review.length, 0);
  engine.close();
});
test("ordinary termination requires a warning and isolated routine issues allow coaching only", () => {
  const f = fixture();
  f.known("manager", "complaint");
  const record = {
    case_id: "discipline",
    contract_id: "contract",
    incident_and_evidence_refs: ["complaint"],
    decision_authority_ref: "manager-authority",
    policy_version: "discipline-v1",
    action: "termination",
    effective_interval: { start_ms: f.now, end_ms: null },
    pay_policy_ref: null,
    decision_ref: "discipline-decision",
    grievance_submission_ref: null,
    reviewer_authority_ref: null,
    deadline_refs: [],
    appeal_decision_ref: null,
  };
  f.proof("system6", "discipline-decision", "discipline_decision", {
    case_id: "discipline",
    contract_id: "contract",
    action: "termination",
    policy_version: "discipline-v1",
    reason: "ordinary",
    isolated_routine_issue: true,
  });
  f.command("discipline", "discipline", { record });
  const engine = open(f);
  run(engine, f, through(f, "accept"));
  assert.equal(
    engine.dispatch(f.commands.discipline).code,
    "DISCIPLINE_POLICY",
  );
  assert.equal(state(engine, f).employment_contract[0].status, "ACTIVE");
  engine.close();
});
test("layoff preserves historical work and every cent of outstanding compensation", () => {
  const f = fixture();
  f.proof("system6", "layoff", "employment_decision", {
    contract_id: "contract",
    status: "ENDED",
    authorized: true,
    reason: "layoff",
    effective_ms: f.now,
  });
  f.command(
    "end",
    "employment_change",
    { contract_id: "contract", status: "ENDED", decision_ref: "layoff" },
    "manager",
    [["employment_contract", "contract", 1]],
  );
  const engine = open(f);
  run(engine, f, [...through(f, "approve"), "end"]);
  const s = state(engine, f);
  assert.equal(s.employment_contract[0].status, "ENDED");
  assert.equal(s.work_receipt.length, 1);
  assert.equal(s.compensation[0].net_owed, 1800);
  assert.equal(s.compensation[0].actual_settled_amount, 0);
  assert.equal(engine.dispatch(f.commands.pay).actual_settled_amount, 1800);
  engine.close();
});
test("salary is paid once per period and a replayed output cannot multiply it", () => {
  const f = fixture();
  Object.assign(
    f.commands.configure.payload.organizations[0].role_definitions[0]
      .policies[0],
    { method: "salary", salary_period_amount: 5000 },
  );
  f.commands.accrue.payload.source_refs = ["salary"];
  f.proof("system11", "salary", "salary_eligibility", {
    contract_id: "contract",
    period_id: "period",
    terms_version: "terms-v1",
    eligible: true,
  });
  f.reply("economy", "settle_payroll", f.entitlementId, {
    entitlement_id: f.entitlementId,
    settled_amount_cents: 5000,
  });
  const engine = open(f);
  run(engine, f);
  assert.equal(state(engine, f).compensation[0].gross_entitlement, 5000);
  assert.equal(engine.dispatch(f.commands.accrue).gross_entitlement, 5000);
  engine.close();
});
test("commission requires an actual settled qualifying sale", () => {
  for (const qualifies of [true, false]) {
    const f = fixture();
    Object.assign(
      f.commands.configure.payload.organizations[0].role_definitions[0]
        .policies[0],
      {
        method: "commission",
        commission_policy_ref: "commission",
        commission_rate: "1/10",
      },
    );
    f.commands.accrue.payload.source_refs = ["sale"];
    f.proof("economy", "sale", "qualifying_sale", {
      settled: true,
      qualifies,
      contract_id: "contract",
      period_id: "period",
      policy_ref: "commission",
      qualifying_cents: 1000,
    });
    const engine = open(f);
    run(engine, f, through(f, "execute"));
    const result = engine.dispatch(f.commands.accrue);
    if (qualifies) assert.equal(result.gross_entitlement, 100);
    else assert.equal(result.code, "INVALID_PAY_SOURCE");
    engine.close();
  }
});
test("settled tip pool has exact participant allocations and duplicate sources cannot pay twice", () => {
  const f = fixture();
  f.proof("economy", "tip", "tip_transfer", {
    settled: true,
    voluntary: true,
    employer_id: "employer",
    policy_ref: "tips-v1",
    amount_cents: 101,
  });
  for (const id of ["a", "b"])
    f.proof("system11", `tip:${id}`, "tip_coverage", {
      policy_ref: "tips-v1",
      employer_id: "employer",
      eligible: true,
      participant_id: id,
      role_ref: "bartender",
      eligible_service_seconds: 60,
    });
  f.command("tips", "allocate_tips", {
    contract_id: "contract",
    transfer_refs: ["tip"],
    policy_ref: "tips-v1",
    coverage_refs: ["tip:b", "tip:a"],
  });
  const engine = open(f);
  run(engine, f, [...through(f, "accept"), "tips"]);
  const result = engine.dispatch(f.commands.tips);
  assert.equal(
    result.allocation.participants.find((p) => p.participant_id === "a")
      .final_allocation_cents,
    51,
  );
  assert.equal(state(engine, f).tip_and_commission_allocation.length, 1);
  engine.close();
});
test("partial work freezes the accepted sample; rework creates a linked cycle once", () => {
  const f = fixture(),
    key = ownerKey(
      f.world,
      f.branch,
      "system10",
      "resolve_task",
      f.stageSource,
    );
  f.replies[key].validated_payload.band = "partial";
  f.proof("system6", "rework-authorization", "rework", {
    task_id: f.taskId,
    authorized: true,
  });
  f.command(
    "rework",
    "rework",
    { task_id: f.taskId, authorization_ref: "rework-authorization" },
    "manager",
    [["work_task", f.taskId, 3]],
  );
  const engine = open(f);
  run(engine, f, through(f, "execute"));
  assert.equal(state(engine, f).work_task[0].state, "PAUSED");
  const r = engine.dispatch(f.commands.rework);
  assert.equal(r.status, "accepted");
  assert.equal(engine.dispatch(f.commands.rework).task_id, r.task_id);
  const s = state(engine, f);
  assert.equal(s.work_task.length, 2);
  assert.equal(s.work_task[1].work_cycle_index, 1);
  assert.equal(s.work_receipt.length, 1);
  engine.close();
});
test("loss of the final output reply after owner acceptance recovers without duplicate work", () => {
  const f = fixture(),
    dir = mkdtempSync(join(tmpdir(), "valor13-")),
    filename = join(dir, "state.sqlite");
  let armed = false,
    count = 0;
  let engine = open(f, {
    filename,
    fault: (label) => {
      if (armed && label === "owner_accepted" && ++count === 3)
        throw new Error("LOST_OUTPUT_REPLY");
    },
  });
  run(engine, f, through(f, "admit"));
  armed = true;
  assert.throws(() => engine.dispatch(f.commands.execute), /LOST_OUTPUT_REPLY/);
  engine.close();
  engine = open(f, { filename });
  assert.equal(engine.dispatch(f.commands.execute).state, "COMPLETED");
  assert.equal(state(engine, f).work_receipt.length, 1);
  engine.close();
  removeTemp(dir);
});
test("fork preserves earned state and never redispatches inherited outbox messages", () => {
  const f = fixture(),
    dir = mkdtempSync(join(tmpdir(), "valor13-")),
    filename = join(dir, "state.sqlite");
  f.command("fork", "fork", { target_branch_id: "alternative" });
  let engine = open(f, { filename });
  run(engine, f, [...f.all, "fork"]);
  engine.close();
  const alternate = structuredClone(f.snapshots);
  for (const snapshot of Object.values(alternate))
    for (const proof of Object.values(snapshot.validated_payload.proofs))
      proof.branch_id = "alternative";
  engine = new JobsEngine({
    filename,
    world_id: f.world,
    branch_id: "alternative",
    owners: new FixedOwnerStubs({ snapshots: alternate, replies: {} }),
  });
  const inspect = { ...f.commands.inspect, branch_id: "alternative" },
    flush = { ...f.commands.flush, branch_id: "alternative" };
  assert.equal(
    engine.dispatch(inspect).state.compensation[0].actual_settled_amount,
    1800,
  );
  assert.equal(engine.dispatch(flush).pending, 0);
  assert.equal(engine.dispatch(inspect).state.work_receipt.length, 1);
  engine.close();
  removeTemp(dir);
});
test("acquired interaction evidence is handed off without creating relationship or consent state", () => {
  const f = fixture();
  const payload = {
    event_ref: "conversation",
    actor_ref: "player",
    source_refs: ["known-claim"],
    channel_ref: "bar-conversation",
    recipient_refs: ["coworker"],
    kind: "social_contact",
  };
  f.command("interaction", "interaction", payload, "player");
  f.intent("interaction", "player", "conversation");
  f.known("player", "known-claim");
  f.proof("system3", "conversation", "interaction", {
    delivered: true,
    actor_ref: "player",
    channel_ref: "bar-conversation",
    era_year: 2012,
    recipient_refs: ["coworker"],
    source_refs: ["known-claim"],
    interaction_kind: "social_contact",
    audience_safe_projection: { text: "An observed conversation occurred." },
  });
  const engine = open(f);
  run(engine, f, ["configure", "interaction"]);
  const s = state(engine, f),
    entries = s.integration_and_recovery.flatMap((j) => j.outbox_entries);
  assert.ok(entries.some((e) => e.destination === "system7"));
  assert.ok(entries.some((e) => e.destination === "system8"));
  assert.equal(Object.hasOwn(s, "relationships"), false);
  engine.close();
});

function delegationFixture(f) {
  const record = {
    delegation_ref: "routine",
    actor_ref: "player",
    role_ref: "bartender",
    eligible_task_types: ["bartender.serve"],
    permitted_methods: ["standard"],
    authorization_horizon_ms: 20000000,
    resource_and_cost_limits: [],
    location_scope: ["site"],
    permitted_communication_scope: [],
    stop_conditions: ["new_risk"],
    pending_choice_refs: [],
    aggregate_receipt_refs: [],
  };
  f.proof("system1", "routine", "delegation", {
    actor_ref: "player",
    active: true,
    start_ms: 0,
    scope: record,
  });
  f.command("delegate", "delegate", { record }, "player");
  f.intent("delegate", "player", "routine");
  f.command(
    "routine",
    "routine",
    { delegation_ref: "routine", task_ids: [f.taskId] },
    "player",
  );
  f.intent("routine", "player", "routine");
  f.command("stop", "stop_routine", { delegation_ref: "routine" }, "player");
  f.intent("stop", "player", "routine");
}
test("delegated and detailed work produce identical certified work receipts", () => {
  const detailedFixture = fixture(),
    detailed = open(detailedFixture);
  run(detailed, detailedFixture, through(detailedFixture, "execute"));
  const f = fixture();
  delegationFixture(f);
  const engine = open(f);
  run(engine, f, [...through(f, "admit"), "delegate", "routine"]);
  const s = state(engine, f);
  assert.deepEqual(
    s.work_receipt,
    state(detailed, detailedFixture).work_receipt,
  );
  assert.equal(s.routine_delegation[0].aggregate_receipt_refs.length, 1);
  engine.close();
  detailed.close();
});
test("delegation stops at material choices and an explicit stop cannot be bypassed", () => {
  const f = fixture();
  delegationFixture(f);
  f.snapshots.system11.validated_payload.proofs[
    f.stageSource
  ].material_conditions = ["new_risk"];
  const engine = open(f);
  run(engine, f, [...through(f, "admit"), "delegate", "routine", "stop"]);
  const s = state(engine, f);
  assert.equal(s.work_receipt.length, 0);
  assert.ok(
    s.routine_delegation[0].pending_choice_refs.includes("PLAYER_STOPPED"),
  );
  assert.equal(s.work_task[0].state, "PAUSED");
  engine.close();
});
test("stale artifacts before resolution do not obtain a new sample or charge effort", () => {
  const f = fixture(),
    dir = mkdtempSync(join(tmpdir(), "valor13-")),
    filename = join(dir, "state.sqlite");
  let engine = open(f, { filename });
  run(engine, f, through(f, "admit"));
  engine.close();
  f.snapshots.demand_artifacts.validated_payload.proofs.order.revision = 1;
  engine = open(f, { filename });
  assert.equal(engine.dispatch(f.commands.execute).code, "STALE_REVISION");
  const s = state(engine, f);
  assert.equal(s.task_execution[0].capability_result_receipt_ref, null);
  assert.equal(s.work_receipt.length, 0);
  engine.close();
  removeTemp(dir);
});
test("per-output compensation credits the completed task once, not every retry", () => {
  const f = fixture();
  Object.assign(
    f.commands.configure.payload.organizations[0].role_definitions[0]
      .policies[0],
    { method: "per accepted task/output", per_output_rate: 250 },
  );
  f.commands.accrue.payload.source_refs = [
    stableId(f.world, f.branch, f.taskId, "player", f.stageSource),
  ];
  const engine = open(f);
  run(engine, f, through(f, "accrue"));
  assert.equal(state(engine, f).compensation[0].gross_entitlement, 250);
  assert.equal(engine.dispatch(f.commands.accrue).gross_entitlement, 250);
  engine.close();
});
test("explicit combined compensation does not duplicate its component sources", () => {
  const f = fixture();
  Object.assign(
    f.commands.configure.payload.organizations[0].role_definitions[0]
      .policies[0],
    {
      method: "explicit combination",
      components: [
        { method: "hourly", rate_cents_per_hour: 1200 },
        { method: "salary", salary_period_amount: 1000 },
      ],
    },
  );
  f.commands.accrue.payload.source_refs = ["coverage", "salary"];
  f.proof("system11", "salary", "salary_eligibility", {
    contract_id: "contract",
    period_id: "period",
    terms_version: "terms-v1",
    eligible: true,
  });
  const engine = open(f);
  run(engine, f, through(f, "accrue"));
  assert.equal(state(engine, f).compensation[0].gross_entitlement, 2800);
  engine.close();
});
test("malformed nested input is rejected as typed JSON without crashing the dispatcher", () => {
  const f = fixture(),
    engine = open(f);
  run(engine, f, ["configure"]);
  assert.equal(
    engine.dispatch({
      ...f.commands.apply,
      payload: { ...f.commands.apply.payload, supplied_availability: 0 },
    }).code,
    "INVALID_ARRAY",
  );
  assert.equal(
    engine.dispatch({
      ...f.commands.accept,
      payload: { ...f.commands.accept.payload, onboarding_lines: [null] },
    }).code,
    "INVALID_RECORD",
  );
  engine.close();
});
test("two accepted offers cannot occupy a one-person slot, even across engine instances", () => {
  const f = fixture(),
    second = { ...structuredClone(f.vacancy), vacancy_id: "vacancy2" };
  f.commands.configure.payload.vacancies.push(second);
  const apply = {
    ...structuredClone(f.commands.apply.payload),
    application_id: "application2",
    vacancy_id: "vacancy2",
    lineage_ref: "app2",
  };
  f.command("apply2", "apply", apply, "player", [["vacancy", "vacancy2", 0]]);
  f.intent("apply2", "player", "vacancy2");
  f.known("player", "vacancy2");
  f.command(
    "submit2",
    "application_stage",
    { application_id: "application2", state: "SUBMITTED" },
    "player",
    [["application_and_assessment", "application2", 0]],
  );
  f.intent("submit2", "player", "application2");
  f.action("submit2");
  f.command(
    "screen2",
    "application_stage",
    { application_id: "application2", state: "SCREENING" },
    "manager",
    [["application_and_assessment", "application2", 1]],
  );
  f.command(
    "assess2",
    "assess",
    { application_id: "application2", assessment_ref: "assessment2" },
    "manager",
    [["application_and_assessment", "application2", 2]],
  );
  const assessment = {
    ...f.snapshots.system10.validated_payload.proofs.assessment,
    application_id: "application2",
  };
  delete assessment.source_ref;
  f.proof("system10", "assessment2", "assessment", assessment);
  f.proof("system11", "assessment:application2", "assessment_time", {
    completed_ms: 1000,
  });
  f.command(
    "select2",
    "select",
    {
      vacancy_id: "vacancy2",
      terms_version: "terms-v1",
      onboarding_line_ids: [],
    },
    "manager",
    [["vacancy", "vacancy2", 0]],
  );
  const offer = stableId(f.branch, "vacancy2", "application2", "offer");
  f.known("player", offer);
  f.proof("legal_institutions", offer, "onboarding_plan", { lines: [] });
  f.command(
    "accept2",
    "accept_offer",
    {
      offer_id: offer,
      contract_id: "contract2",
      start_ms: 0,
      end_ms: null,
      onboarding_lines: [],
    },
    "player",
  );
  f.intent("accept2", "player", offer);
  const dir = mkdtempSync(join(tmpdir(), "valor13-")),
    filename = join(dir, "state.sqlite");
  const first = open(f, { filename }),
    other = open(f, { filename });
  run(first, f, [
    ...through(f, "select"),
    "apply2",
    "submit2",
    "screen2",
    "assess2",
    "select2",
    "accept",
  ]);
  assert.equal(other.dispatch(f.commands.accept2).code, "NO_VACANCY");
  assert.equal(state(other, f).employment_contract.length, 1);
  first.close();
  other.close();
  removeTemp(dir);
});

test("an employment status command cannot bypass ordinary termination safeguards", () => {
  const f = fixture();
  f.proof("system6", "shortcut", "employment_decision", {
    contract_id: "contract",
    status: "ENDED",
    authorized: true,
    reason: "poor_performance",
    effective_ms: f.now,
  });
  f.command(
    "shortcut",
    "employment_change",
    { contract_id: "contract", status: "ENDED", decision_ref: "shortcut" },
    "manager",
    [["employment_contract", "contract", 1]],
  );
  const engine = open(f);
  run(engine, f, through(f, "accept"));
  assert.equal(engine.dispatch(f.commands.shortcut).code, "DISCIPLINE_POLICY");
  assert.equal(state(engine, f).employment_contract[0].status, "ACTIVE");
  engine.close();
});

test("a known contract does not disclose an uncommunicated status change", () => {
  const f = fixture();
  f.known("player", "employment_contract:contract", {
    allowed_fields: ["contract_id", "status"],
    projection: { contract_id: "contract", status: "ACTIVE" },
  });
  f.proof("system6", "layoff", "employment_decision", {
    contract_id: "contract",
    status: "ENDED",
    authorized: true,
    reason: "layoff",
    effective_ms: f.now,
  });
  f.command(
    "end",
    "employment_change",
    { contract_id: "contract", status: "ENDED", decision_ref: "layoff" },
    "manager",
    [["employment_contract", "contract", 1]],
  );
  f.command(
    "view",
    "query",
    { kind: "employment_contract", id: "contract" },
    "player",
  );
  const engine = open(f);
  run(engine, f, [...through(f, "accept"), "end"]);
  assert.equal(state(engine, f).employment_contract[0].status, "ENDED");
  assert.equal(engine.dispatch(f.commands.view).projection.status, "ACTIVE");
  engine.close();
});

test("staffing minima require qualified coverage or an explicit service reduction", () => {
  const f = fixture(),
    requirements = [{ role_ref: "bartender", count: 2 }];
  f.commands.configure.payload.organizations[0].role_definitions[0].policies.find(
    (p) => p.version === "schedule-v1",
  ).minimum_role_coverage = requirements;
  f.proof("system11", "shift", "shift", {
    employer_id: "employer",
    start_ms: 0,
    end_ms: f.now,
  });
  f.proof("system6", "shift", "roster_decision", {
    assignment_intervals: [],
    priority_order: [
      "mandatory_qualified_coverage",
      "accepted_leave",
      "contract_availability",
      "rotation_fairness",
      "worker_preferences",
    ],
  });
  const record = {
    schedule_rule_version: "schedule-v1",
    shift_ref: "shift",
    minimum_role_coverage: requirements,
    station_requirements: [],
    qualification_requirements: [],
    break_and_rest_policy_refs: [],
    workload_limits: {},
    known_availability_refs: [],
    approved_leave_refs: [],
    roster_revision: 0,
    publication_and_notice_refs: [],
    assignment_intervals: [],
    controlling_instruction_refs: [],
    resource_reservation_refs: [],
    conflicts: [],
    handoff_refs: [],
  };
  f.command("roster", "roster", { employer_id: "employer", record });
  const engine = open(f);
  run(engine, f, through(f, "accept"));
  assert.equal(
    engine.dispatch(f.commands.roster).code,
    "INSUFFICIENT_COVERAGE",
  );
  assert.equal(state(engine, f).staffing_and_assignments.length, 0);
  engine.close();
});
