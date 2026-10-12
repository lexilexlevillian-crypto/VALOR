"""Deterministic, isolated crime/law/police state machine (Python 3.12+).

``main_state_machine`` is an engine-facing JSON-in/JSON-out function. Its
``state`` result contains restricted persistence data and MUST NOT be sent to
the player or narrator. Only ``result`` from the five visibility-filtered query
operations is a player-facing projection.

No laws, penalties, confidence scales, random outcomes, or foreign mechanics
are invented. Rule bodies are supplied by the content stub and addressed by
their SHA-256 digest. Missing policy or missing foreign confirmation blocks
the transition. Fixture dictionaries are trusted test-harness data.

Host persistence must compare-and-swap the input event count when committing
the returned state. The module performs no file writes or network access.
"""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from typing import Any, TypedDict

from .dependencies import STUBS
from .schema import (
    CONTEXT, CORE, FIELDS, ConstraintError, LegalState, new_state, require,
    timestamp, validate_record, validate_state,
)

JSON = dict[str, Any]


class Command(TypedDict):
    operation: str
    mutation_context: JSON
    policy_version: str
    data: JSON


class TransitionResult(TypedDict):
    state: JSON
    result: JSON
    external_requests: list[JSON]
    expected_revision: int
    revision: int


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: Any) -> str:
    return sha256(canonical(value).encode("utf-8")).hexdigest()


def rule_ref(body: JSON) -> str:
    """Create an immutable content reference; this does not install a rule."""
    return "rule:" + digest(body)


def ordered_events(state: JSON) -> list[JSON]:
    """JSON object member order is not a persistence or causal-order contract."""
    events = list(state["legal_event"].values())
    def revision(event: JSON) -> int:
        audit = state["institutional_decision_and_misconduct"][event["payload_ref"]]["decision_and_reasons"]
        return audit["request"]["mutation_context"]["expected_revision"]
    events.sort(key=revision)
    require([revision(event) for event in events] == list(range(len(events))), "invalid_event_history")
    return events


def _path(record: JSON, path: str) -> tuple[bool, Any]:
    value: Any = record
    for component in path.split("."):
        if not isinstance(value, dict) or component not in value:
            return False, None
        value = value[component]
    return True, value


def predicate(expression: JSON, facts: list[JSON]) -> bool | None:
    """Three-valued evaluation. Conflicting source values remain unresolved.

    Grammar: {all: [...]}, {any: [...]}, {not: expression}, or
    {path: "field.path", equals: JSON scalar}. No eval, scores, or coercion.
    """
    require(isinstance(expression, dict), "invalid_predicate")
    if set(expression) in ({"all"}, {"any"}):
        operator = next(iter(expression))
        require(isinstance(expression[operator], list) and bool(expression[operator]), "empty_predicate")
        values = [predicate(item, facts) for item in expression[operator]]
        if operator == "all":
            return False if False in values else None if None in values else True
        return True if True in values else None if None in values else False
    if set(expression) == {"not"}:
        result = predicate(expression["not"], facts)
        return None if result is None else not result
    require(set(expression) == {"path", "equals"} and isinstance(expression["path"], str), "invalid_predicate")
    values = [value for present, value in (_path(f, expression["path"]) for f in facts) if present]
    if not values or any(value is None for value in values):
        return None
    matches = [type(value) is type(expression["equals"]) and value == expression["equals"] for value in values]
    return matches[0] if all(value == matches[0] for value in matches) else None


# Table, mutable fields ("*" means creation only), mandatory effect owners,
# and action-specific authority class. No generic upsert command is exposed.
OPERATIONS: dict[str, tuple[str, str, tuple[str, ...], str | None]] = {
    "RecordAffectedParty": ("affected_party", "*", (), None),
    "SetReportDisposition": ("report", "disposition", (), None),
    "QueueResponse": ("response_task", "*", (), None),
    "AssignResponse": ("response_task", "assigned_unit status next_review_at", (), None),
    "BeginTravel": ("response_task", "status", ("system_12",), None),
    "ArriveResponse": ("response_task", "status", ("system_12",), None),
    "FinishResponse": ("response_task", "status next_review_at", (), None),
    "OpenCase": ("case_file", "*", (), None),
    "Investigate": ("case_file", "evidence_matrix_ref stage assigned_workers", ("evidence",), None),
    "ReopenCase": ("case_file", "stage assigned_workers", (), None),
    "StartContact": ("stop_search_and_interview", "*", ("system_12", "system_16"), "contact"),
    "Detain": ("stop_search_and_interview", "authority_assessment_ref departure_physically_obstructed departure_claimed_restricted review_boundary communicated_claim_refs", ("system_19",), "detain"),
    "EndContact": ("stop_search_and_interview", "departure_physically_obstructed departure_claimed_restricted execution_and_discovery_refs", ("system_19", "system_12"), None),
    "Search": ("stop_search_and_interview", "authority_assessment_ref search_target search_method proposed_scope authorized_scope consent_and_revocation_refs execution_and_discovery_refs violation_refs", ("system_12", "system_15"), "search"),
    "Seize": ("stop_search_and_interview", "authority_assessment_ref seizure_transfer_refs receipt_and_inventory_status violation_refs", ("system_15",), "seize"),
    "RequestOrder": ("order_custody_and_court_details", "*", ("system_16",), None),
    "ReviewApplication": ("order_custody_and_court_details", "review_decision", (), None),
    "IssueOrder": ("order", "*", (), None),
    "ExecuteOrder": ("order", "status", ("system_16",), "execute_order"),
    "CancelOrder": ("order", "status", (), None),
    "StartCustody": ("custody", "*", ("system_19",), "arrest"),
    "Restrain": ("custody", "actual_control_ref status", ("system_15", "system_19"), "restrain"),
    "Transport": ("custody", "actual_control_ref status", ("system_17", "system_12"), "transport"),
    "BookArrival": ("custody", "facility_ref status next_review_at", ("system_12", "system_13", "system_15"), "booking"),
    "RecordInterview": ("stop_search_and_interview", "participants location_ref started_at purpose custody_context_ref communication_access_refs notice_delivery_refs supplied_statement_refs recording counsel_request", ("system_16",), None),
    "RequestCounsel": ("stop_search_and_interview", "counsel_request counsel_appointment_consultation_representation_refs violation_refs", ("system_13", "system_16"), None),
    "OfferAgreement": ("order_custody_and_court_details", "*", (), None),
    "ReferCase": ("case_file", "stage", ("system_16",), None),
    "ScreenCase": ("case_file", "stage", (), None),
    "FileCharges": ("case_file", "stage", (), None),
    "PrepareDefense": ("case_file", "stage", ("system_16",), None),
    "ScheduleProceeding": ("proceeding", "*", ("system_11",), None),
    "RecordPleaResponse": ("order_custody_and_court_details", "plea_response_ref", ("system_16",), None),
    "RecordFinding": ("proceeding", "outcome_ref", (), None),
    "Sentence": ("order", "*", (), None),
    "CreateObligation": ("obligation", "*", (), None),
    "RecordNotice": ("obligation", "notice_refs", ("system_16",), None),
    "ReviewObligation": ("obligation", "status", (), None),
    "ExecuteRelease": ("custody", "status facility_ref actual_control_ref", ("system_19", "system_12", "system_15"), None),
    "RequestPayment": ("obligation", "compliance_refs", ("system_14",), None),
    "RecordMisconduct": ("institutional_decision_and_misconduct", "*", (), None),
    "RequestOversight": ("institutional_decision_and_misconduct", "complaint_and_oversight_task_refs", ("system_13", "system_16"), None),
}

DETAILS = {
    "FileCharges": "order_custody_and_court_details",
    "RecordFinding": "order_custody_and_court_details",
    "Sentence": "order_custody_and_court_details",
    "BookArrival": "order_custody_and_court_details",
    "ExecuteRelease": "order_custody_and_court_details",
    "ReviewObligation": "order_custody_and_court_details",
    "IssueOrder": "order_custody_and_court_details",
}
DETAIL_FIELDS = {
    "FileCharges": {"charge_counts"},
    "RecordFinding": {"finding_by_count", "agreement_approval_refs", "plea_response_ref"},
    "Sentence": {"sentence_template_ref", "recorded_custody_intervals", "credited_intervals"},
    "BookArrival": {"asserted_identity", "booking_staff_refs", "arrival_and_acceptance_refs", "intake_time", "property_inventory_refs", "observed_or_disclosed_health_concerns"},
    "ExecuteRelease": {"release_handoff_refs"},
    "ReviewObligation": {"condition_scope", "suspected_violation"},
    "IssueOrder": {"application_ref", "order_jurisdiction"},
}
QUERIES = {
    "GetKnownLegalStatus": {"report", "case_file", "order", "custody", "obligation", "proceeding"},
    "GetAuthorizedCase": {"case_file", "report", "proceeding", "information_and_evidence_association"},
    "GetOfficerKnownBasis": {"authority_assessment", "information_and_evidence_association"},
    "GetVisibleCustodyOptions": {"custody", "obligation", "stop_search_and_interview"},
    "GetCommunicatedOrders": {"order"},
}
PHYSICAL_FIELDS = {
    "actual_control_ref", "facility_ref", "execution_and_discovery_refs",
    "seizure_transfer_refs", "arrival_and_acceptance_refs", "property_inventory_refs",
    "release_handoff_refs", "service_execution_and_return_refs", "compliance_refs",
    "notice_refs", "notice_delivery_refs", "supplied_statement_refs", "recording",
    "departure_physically_obstructed", "counsel_appointment_consultation_representation_refs",
}
FORBIDDEN_BASIS_PATHS = {"silence", "dislike", "wealth", "neighborhood", "identity", "unrelated_record", "demographic", "communication_ability"}
RECEIPT_FIELDS = {
    "system_11": set(),
    "system_12": {"facility_ref", "arrival_and_acceptance_refs"},
    "system_13": {"counsel_appointment_consultation_representation_refs"},
    "system_14": {"compliance_refs"},
    "system_15": {"execution_and_discovery_refs", "seizure_transfer_refs", "property_inventory_refs", "release_handoff_refs"},
    "system_16": {"notice_refs", "notice_delivery_refs", "supplied_statement_refs", "recording", "service_execution_and_return_refs"},
    "system_17": set(),
    "system_19": {"actual_control_ref", "departure_physically_obstructed"},
    "evidence": set(),
}
RESULT_FIELDS = {
    "StartCustody": {"actual_control_ref"}, "Restrain": {"actual_control_ref"},
    "Transport": {"actual_control_ref"}, "Detain": {"departure_physically_obstructed"},
    "Search": {"execution_and_discovery_refs"}, "Seize": {"seizure_transfer_refs"},
    "BookArrival": {"facility_ref", "arrival_and_acceptance_refs", "property_inventory_refs"},
    "RecordInterview": {"supplied_statement_refs", "recording", "notice_delivery_refs"},
    "RequestCounsel": {"counsel_appointment_consultation_representation_refs"},
    "RequestPayment": {"compliance_refs"}, "RecordNotice": {"notice_refs"},
    "ExecuteRelease": {"release_handoff_refs"},
}
REQUIRED_RECEIPT_FLAGS = {
    ("BeginTravel", "system_12"): "movement_started",
    ("ArriveResponse", "system_12"): "arrived",
    ("BookArrival", "system_12"): "arrived",
    ("BookArrival", "system_13"): "accepted",
    ("Search", "system_12"): "access_confirmed",
    ("StartCustody", "system_19"): "control_established",
    ("Restrain", "system_19"): "restraint_applied",
    ("Detain", "system_19"): "constraint_committed",
    ("EndContact", "system_19"): "constraint_ended",
    ("Transport", "system_17"): "transport_committed",
    ("ExecuteRelease", "system_19"): "control_ended",
    ("ExecuteRelease", "system_12"): "exit_committed",
    ("Seize", "system_15"): "custody_transferred",
    ("RequestPayment", "system_14"): "transaction_committed",
}
OWNER_INPUT_FIELDS = {
    "system_11": {"scheduled_at", "due_at", "next_review_at", "participants_ref", "subject_ref", "type"},
    "system_12": {"participants", "location_ref", "facility_ref", "subject_ref", "search_target"},
    "system_13": {"assigned_unit", "assigned_workers", "institution_id", "scheduled_at", "booking_staff_refs", "counsel_request"},
    "system_14": {"order_id", "condition_ref", "subject_ref"},
    "system_15": {"search_target", "search_method", "proposed_scope", "authorized_scope", "subject_ref", "property_inventory_refs"},
    "system_16": {"content_ref", "participants", "subject_ref", "purpose", "supplied_statement_refs", "plea_response_ref", "plea_offer", "counsel_request"},
    "system_17": {"subject_ref", "actual_control_ref", "facility_ref"},
    "system_19": {"subject_ref", "participants", "actual_control_ref"},
    "evidence": {"evidence_matrix_ref", "allegations_ref"},
}
DECISION_OPERATIONS = {
    "SetReportDisposition", "FinishResponse", "ScreenCase", "FileCharges",
    "ReviewApplication", "ReviewObligation", "RecordFinding", "Investigate",
}


class _Execution:
    """Ephemeral execution context; only ``state`` is persisted by the caller."""

    def __init__(self, state: JSON, command: JSON, fixtures: JSON):
        self.state = deepcopy(state)
        self.command = deepcopy(command)
        self.fixtures = fixtures
        self.operation = command["operation"]
        self.context = command["mutation_context"]
        self.data = command.get("data", {})
        self.actor = self.context["actor_or_system_authority"]
        self.now = self.context["canonical_timestamp"]
        self.version = command.get("policy_version", "")
        self.requests: list[JSON] = []
        self.event_id = "legal:" + digest([self.actor, self.context["idempotency_key"]])
        self.audit_id = "audit:" + self.event_id
        self.fingerprint = digest({
            "operation": self.operation, "actor": self.actor, "version": self.version,
            "data": self.data, "correlation_id": self.context["correlation_id"],
        })

    def snapshot(self, owner: str) -> JSON:
        return STUBS[owner]({"kind": "snapshot", "actor_ref": self.actor}, self.fixtures)

    def ref(self, reference: str) -> JSON:
        rules = self.snapshot("content_manifests").get("rules", {})
        body = rules.get(reference)
        require(isinstance(body, dict) and rule_ref(body) == reference, "missing_or_changed_policy")
        return body

    def manifest(self) -> JSON:
        require(self.version in self.state["legal_manifest"], "missing_policy_version")
        return self.state["legal_manifest"][self.version]

    def policy(self, field: str) -> JSON:
        reference = self.manifest().get(field)
        require(isinstance(reference, str), "missing_policy_configuration")
        return self.ref(reference)

    def operation_policy(self, operation: str | None = None) -> JSON:
        value = self.policy("procedural_standards").get("operations", {}).get(operation or self.operation)
        require(isinstance(value, dict), "operation_not_configured")
        return value

    def audit(self, event: JSON) -> JSON:
        return self.state["institutional_decision_and_misconduct"][event["payload_ref"]]["decision_and_reasons"]

    def enter(self) -> JSON | None:
        work = self.snapshot("system_13")
        require(work.get("actor_ref") == self.actor and self.operation in work.get("permitted_operations", []), "not_authorized")
        if self.operation not in QUERIES:
            require(work.get("authority_kind") not in {"narrator", "narration"}, "narration_cannot_mutate")
        # Authorization precedes replay to avoid leaking an old actor's response.
        for event in self.state["legal_event"].values():
            if event["idempotency_key"] == self.context["idempotency_key"]:
                audit = self.audit(event)
                require(event["actor_ref"] == self.actor and audit["fingerprint"] == self.fingerprint, "idempotency_conflict")
                return deepcopy(audit["result"])
        require(self.context["expected_revision"] == len(self.state["legal_event"]), "revision_conflict")
        clock = self.snapshot("system_11")
        require(clock.get("canonical_timestamp") == self.now, "clock_not_confirmed")
        timestamp(self.now)
        latest = ordered_events(self.state)[-1:]
        require(clock.get("causal_predecessor_ref") == (latest[0]["id"] if latest else None), "causal_order_conflict")
        if latest:
            require(timestamp(self.now) >= timestamp(latest[0]["processed_at"]), "time_reversal")
        if self.operation not in {"InstallManifest", *QUERIES}:
            self.manifest()
            self.guard_policy_version()
        return None

    def guard_policy_version(self) -> None:
        """Existing records stay pinned; new process uses an effective manifest."""
        if self.operation == "ClassifyConduct":
            return  # Classification selects its version using occurrence time.
        target = self.data.get("record_id")
        references = {ref for ref in [target, self.data.get("case_ref"), self.data.get("order_ref"), self.data.get("workflow_ref")] if ref}
        pinned = set()
        for event in ordered_events(self.state):
            for change in self.audit(event)["changes"]:
                if change["key"] in references and change["before"] is None:
                    pinned.add(event["policy_version"])
        if pinned:
            require(pinned == {self.version}, "explicit_policy_migration_required")
        elif self.operation != "Tick":
            period = self.manifest()["effective_period"]
            require(timestamp(period["start"]) <= timestamp(self.now) < timestamp(period["end"]), "inapplicable_process_policy")

    def previous_decision(self) -> JSON | None:
        if self.operation not in DECISION_OPERATIONS:
            return None
        trigger_ref = self.data.get("reconsideration_trigger_ref")
        if trigger_ref:
            trigger = self.snapshot("system_13").get("review_triggers", {}).get(trigger_ref, {})
            require(trigger.get("kind") in {"new_information", "changed_capacity", "new_responsible_actor", "scheduled_review"}, "reconsideration_trigger_required")
            require(trigger.get("subject_ref") == self.data.get("record_id"), "review_subject_mismatch")
        signature = self.decision_signature()
        for event in reversed(ordered_events(self.state)):
            audit = self.audit(event)
            if audit.get("decision_signature") == signature:
                return deepcopy(audit["result"])
        return None

    def decision_signature(self) -> str | None:
        if self.operation not in DECISION_OPERATIONS:
            return None
        return digest([
            self.operation, self.actor, self.data.get("record_id"), self.version,
            sorted(self.data.get("basis_refs", [])), self.data.get("reconsideration_trigger_ref"),
        ])

    def commit(self, result: JSON, before: JSON, extra: JSON | None = None) -> None:
        # The audit is an immutable supplemental record, referenced by an event.
        changes = []
        for table in FIELDS:
            for key, value in self.state[table].items():
                old = before[table].get(key)
                if old != value:
                    changes.append({"table": table, "key": key, "before": old, "after": deepcopy(value)})
        envelope = {
            "operation": self.operation, "fingerprint": self.fingerprint,
            "request": deepcopy(self.command), "changes": changes,
            "result": deepcopy(result), "external_requests": deepcopy(self.requests),
            "decision_signature": self.decision_signature(),
            **(extra or {}),
        }
        self.state["institutional_decision_and_misconduct"][self.audit_id] = {
            "decision_stage": "audit", "decision_and_reasons": envelope,
        }
        self.state["legal_event"][self.event_id] = {
            "id": self.event_id, "occurred_at": self.now, "processed_at": self.now,
            "actor_ref": self.actor, "cause_ref": self.context["correlation_id"],
            "policy_version": self.version, "idempotency_key": self.context["idempotency_key"],
            "payload_ref": self.audit_id,
        }
        self.state["mutation_context"] = deepcopy(self.context)

    def known_facts(self, references: list[str]) -> list[JSON]:
        require(isinstance(references, list) and len(references) == len(set(references)), "invalid_basis")
        acquired = {}
        for identifier, association in self.state["information_and_evidence_association"].items():
            if association.get("holder_ref") == self.actor and timestamp(association["acquired_at"]) <= timestamp(self.now):
                provenance = self.state["institutional_decision_and_misconduct"].get("source-check:" + identifier, {}).get("decision_and_reasons", {}).get("fact_digests", {})
                for key in ("observation_refs", "inference_refs", "recollection_refs", "statement_refs"):
                    for reference in association.get(key, []):
                        if reference in provenance:
                            acquired[reference] = provenance[reference]
        facts = self.snapshot("knowledge").get("facts", {})
        result = []
        for reference in references:
            require(reference in acquired, "basis_not_acquired")
            fact = facts.get(reference, {})
            require(digest(fact) == acquired[reference], "acquired_source_changed_without_amendment")
            require(fact.get("holder_ref") == self.actor and fact.get("source_ref"), "basis_not_acquired")
            require(timestamp(fact["occurred_at"]) <= timestamp(fact["acquired_at"]) <= timestamp(self.now), "invalid_information_time")
            require(fact.get("restricted_truth") is not True, "restricted_basis")
            result.append(deepcopy(fact["values"]))
        return result

    def deadline(self, subject: str, kind: str, policy: JSON | None = None) -> None:
        clock = self.snapshot("system_11")
        field = "next_daily_review" if kind == "custody" else "next_shift_boundary"
        due = clock.get(field)
        require(due is not None and timestamp(due) > timestamp(self.now), "review_boundary_unavailable")
        rule = policy or self.policy("review_and_deadline_policies")
        responsible = self.snapshot("system_13").get("institution_ref")
        require(isinstance(responsible, str), "responsible_institution_missing")
        identifier = "review:" + digest([subject, self.event_id])
        self.state["deadline_and_durable_workflow"][identifier] = {
            "trigger_event_ref": self.event_id, "policy_version": self.version,
            "due_at": due, "responsible_institution_ref": responsible,
            "subject_ref": subject, "review_task_ref": rule.get(kind + "_review_ref"),
            "overdue_status": False, "overdue_response_ref": rule.get(kind + "_overdue_ref"),
            "correlation_id": self.context["correlation_id"], "pending_steps": [],
            "completed_external_event_refs": [], "step_idempotency_keys": [],
            "revision": 0, "pending_player_choice_ref": None, "notice_delivery_refs": [],
        }

    def install(self) -> JSON:
        require(self.snapshot("system_13").get("authority_kind") == "content_admin", "not_authorized")
        content = self.snapshot("content_manifests")
        manifest = deepcopy(content.get("manifests", {}).get(self.version))
        require(isinstance(manifest, dict) and manifest.get("version") == self.version, "manifest_unavailable")
        validate_record("legal_manifest", manifest)
        require(set(manifest) == FIELDS["legal_manifest"], "incomplete_manifest")
        require(self.version not in self.state["legal_manifest"], "immutable_manifest")
        for key in (
            "authority_policies", "procedural_standards", "count_combination_rules",
            "review_and_deadline_policies", "privacy_and_retention_policies",
            "order_and_condition_types", "scenario_generation_controls",
        ):
            self.ref(manifest[key])
        period = manifest["effective_period"]
        require(timestamp(period["start"]) < timestamp(period["end"]), "invalid_effective_period")
        for definition in content.get("offense_definitions", []):
            validate_record("offense_definition", definition)
            require(definition["version"] == self.version, "definition_version_mismatch")
            require(definition["id"] not in self.state["offense_definition"], "immutable_definition")
            require(definition["source_kind"] in {"validated_historical_rule", "fictional_valor_rule", "unresolved_historical_question"}, "invalid_source_kind")
            if definition["source_kind"] == "validated_historical_rule":
                require(definition["id"] in content.get("validated_historical_definitions", []), "historical_provenance_missing")
            self.ref(definition["elements_ref"])
            self.ref(definition["defenses_ref"])
            self.state["offense_definition"][definition["id"]] = deepcopy(definition)
        self.state["legal_manifest"][self.version] = manifest
        return {"status": "installed", "policy_version": self.version}

    def classify(self) -> JSON:
        require(self.snapshot("system_13").get("authority_kind") == "simulation", "not_authorized")
        conduct = self.snapshot("evidence").get("conduct", {}).get(self.data["conduct_ref"], {})
        require(conduct.get("committed") is True and conduct.get("event_refs"), "committed_conduct_required")
        occurred = conduct["occurred_at"]
        require(timestamp(occurred) <= timestamp(self.now), "future_conduct")
        manifest = self.manifest()
        period = manifest["effective_period"]
        require(timestamp(period["start"]) <= timestamp(occurred) < timestamp(period["end"]), "inapplicable_catalog")
        require(conduct["jurisdiction"] in manifest["jurisdiction_refs"], "jurisdiction_not_configured")
        incident_id = "incident:" + digest(sorted(conduct["event_refs"]))
        if incident_id in self.state["incident"]:
            return {"status": "already_classified", "record_id": incident_id}
        candidates = []
        for definition in self.state["offense_definition"].values():
            if definition["version"] != self.version or definition["jurisdiction"] != conduct["jurisdiction"]:
                continue
            if definition["source_kind"] == "unresolved_historical_question":
                continue
            if timestamp(occurred) < timestamp(definition["effective_from"]):
                continue
            if definition["effective_to"] is not None and timestamp(occurred) >= timestamp(definition["effective_to"]):
                continue
            rule = self.ref(definition["elements_ref"])
            if rule["family"] not in manifest["enabled_offense_families"]:
                continue
            # Matching supported acts, not narrative labels, selects candidates.
            if predicate(rule["trigger"], [conduct["facts"]]) is not True:
                continue
            intent = conduct.get("intent_basis_refs", [])
            supplied = self.snapshot("player_input").get("decisions", {})
            npc = self.snapshot("system_13").get("npc_decisions", {})
            valid_intent = []
            for reference in intent:
                choice = supplied.get(reference) or npc.get(reference, {})
                if (choice.get("explicit") is True
                        and choice.get("actor_ref") in conduct.get("person_refs", [])
                        and set(choice.get("conduct_refs", [])) & set(conduct["event_refs"])):
                    valid_intent.append(reference)
            evaluated = {}
            for element, expression in rule["elements"].items():
                evaluated[element] = None if element in rule.get("mental_elements", []) and not valid_intent else predicate(expression, [conduct["facts"]])
            # A disproved required element does not produce a canonical candidate.
            if False in evaluated.values():
                continue
            candidate_id = "candidate:" + digest([incident_id, definition["id"]])
            defenses = self.ref(definition["defenses_ref"]).get("elements", {})
            candidate = {
                "supporting_event_refs": conduct["event_refs"], "offense_definition_ref": definition["id"],
                "catalog_version": self.version, "involved_person_refs": conduct.get("person_refs", []),
                "affected_property_refs": conduct.get("property_refs", []), "jurisdiction": conduct["jurisdiction"],
                "occurred_at": occurred, "satisfied_elements": [key for key, value in evaluated.items() if value is True],
                "unresolved_elements": [key for key, value in evaluated.items() if value is None],
                "intent_basis_refs": valid_intent,
                "possible_exclusions_or_defenses": [key for key, expression in defenses.items() if predicate(expression, [conduct["facts"]]) is not False],
            }
            self.state["offense_candidate"][candidate_id] = candidate
            candidates.append(candidate_id)
        self.state["incident"][incident_id] = {
            "id": incident_id, "conduct_refs": conduct["event_refs"], "occurred_at": occurred,
            "location_ref": conduct["location_ref"], "offense_candidate_refs": candidates,
            "restricted_truth_ref": conduct["restricted_truth_ref"],
        }
        return {"status": "classified", "record_id": incident_id}

    def acquire(self) -> JSON:
        acquisition = self.snapshot("knowledge").get("acquisitions", {}).get(self.data["acquisition_ref"], {})
        require(acquisition.get("kind") in {"observation", "delivery", "authorized_record", "evidence"}, "acquisition_required")
        require(acquisition.get("committed") is True, "acquisition_required")
        record = deepcopy(acquisition.get("association", {}))
        validate_record("information_and_evidence_association", record)
        require(record.get("holder_ref") == self.actor, "wrong_information_recipient")
        require(record.get("original_source_refs"), "source_provenance_required")
        require(timestamp(record["acquired_at"]) <= timestamp(self.now), "future_acquisition")
        require(acquisition.get("restricted_truth") is not True, "restricted_basis")
        # Preserve distinct accounts; only exact acquisition replay is deduplicated.
        identifier = "information:" + digest(self.data["acquisition_ref"])
        existing = self.state["information_and_evidence_association"].get(identifier)
        require(existing is None or existing == record, "immutable_acquisition")
        fact_digests = {}
        for key in ("observation_refs", "inference_refs", "recollection_refs", "statement_refs"):
            for reference in record.get(key, []):
                fact = self.snapshot("knowledge").get("facts", {}).get(reference, {})
                require(fact.get("holder_ref") == self.actor and fact.get("source_ref"), "acquisition_provenance_missing")
                require(fact.get("restricted_truth") is not True, "restricted_basis")
                require(timestamp(fact["occurred_at"]) <= timestamp(fact["acquired_at"]) <= timestamp(record["acquired_at"]), "invalid_information_time")
                fact_digests[reference] = digest(fact)
        provenance_key = "source-check:" + identifier
        provenance = {"decision_stage": "acquisition", "decision_and_reasons": {"fact_digests": fact_digests}}
        require(provenance_key not in self.state["institutional_decision_and_misconduct"] or self.state["institutional_decision_and_misconduct"][provenance_key] == provenance, "immutable_acquisition")
        self.state["institutional_decision_and_misconduct"][provenance_key] = provenance
        self.state["information_and_evidence_association"][identifier] = record
        return {"status": "acquired", "record_id": identifier}

    def receive_report(self) -> JSON:
        delivery = self.snapshot("system_16").get("deliveries", {}).get(self.data["delivery_ref"], {})
        require(delivery.get("delivered") is True, "report_not_delivered")
        require(delivery.get("channel") in self.policy("technology_capabilities").get("communication_channels", []), "channel_not_configured_for_era")
        require(delivery.get("recipient_ref") == self.snapshot("system_13").get("institution_ref"), "wrong_report_recipient")
        require(timestamp(delivery["received_at"]) <= timestamp(self.now), "future_delivery")
        report_id = "report:" + digest(self.data["delivery_ref"])
        if report_id in self.state["report"]:
            return {"status": "already_received", "record_id": report_id}
        # A report may refer to an allegation without creating a canonical incident.
        record = {
            "id": report_id, "incident_ref": delivery["incident_or_allegation_ref"],
            "reporter_ref": delivery.get("known_reporter_ref"), "received_at": delivery["received_at"],
            "content_ref": delivery["delivered_content_ref"], "identity_confidence": delivery.get("identity_confidence"),
            "disposition": "received",
        }
        self.state["report"][report_id] = record
        self.state["intake_and_task_details"][report_id] = {
            "channel_event_ref": self.data["delivery_ref"], "received_content_ref": delivery["delivered_content_ref"],
            "reported_location": delivery.get("reported_location"), "location_confidence": delivery.get("location_confidence"),
            "apparent_urgency": delivery.get("apparent_urgency"), "contact_method": delivery["channel"],
            "receiving_institution_ref": delivery["recipient_ref"], "original_and_amended_report_refs": [report_id],
        }
        if delivery.get("amends_report_ref"):
            original = self.state["intake_and_task_details"].get(delivery["amends_report_ref"], {})
            require(original.get("receiving_institution_ref") == delivery["recipient_ref"], "amendment_source_unavailable")
            self.state["intake_and_task_details"][report_id]["original_and_amended_report_refs"] = [*original["original_and_amended_report_refs"], report_id]
        self.deadline(report_id, "intake")
        self.enqueue_notification("knowledge", "report-knowledge:" + report_id, {
            "operation": "AcquireDeliveredReport", "subject_ref": delivery["recipient_ref"],
            "delivery_ref": self.data["delivery_ref"], "content_ref": delivery["delivered_content_ref"],
        })
        return {"status": "received", "record_id": report_id}

    def assess_authority(self) -> JSON:
        scope = self.data["scope"]
        require(isinstance(scope, dict) and {"action", "target_ref", "jurisdiction"} <= set(scope), "invalid_scope")
        rule = self.policy("authority_policies").get("actions", {}).get(scope["action"])
        require(isinstance(rule, dict) and rule.get("elements"), "authority_policy_missing")
        require(scope["jurisdiction"] in self.manifest()["jurisdiction_refs"], "jurisdiction_not_configured")
        for expression in _expressions(rule["elements"]):
            require(not set(expression.get("path", "").split(".")) & FORBIDDEN_BASIS_PATHS, "prohibited_authority_predicate")
        facts = self.known_facts(self.data.get("basis_refs", []))
        results = {name: predicate(expression, facts) for name, expression in rule["elements"].items()}
        sources = self.snapshot("knowledge").get("facts", {})
        scoped = [sources[ref].get("scope", {}) for ref in self.data.get("basis_refs", [])]
        if not scoped or not all(value.get("target_ref") == scope["target_ref"] and value.get("jurisdiction") == scope["jurisdiction"] for value in scoped):
            results["scope_supported"] = None
        conclusion = "insufficient" if False in results.values() else "unresolved" if None in results.values() else "sufficient"
        identifier = self.data.get("record_id", "authority:" + digest([self.actor, scope, self.data.get("basis_refs", []), self.version]))
        record = {
            "id": identifier, "actor_id": self.actor, "action_scope": scope,
            "known_basis_refs": self.data.get("basis_refs", []), "policy_version": self.version,
            "conclusion": conclusion, "reasons_ref": self.audit_id,
        }
        require(identifier not in self.state["authority_assessment"], "immutable_assessment")
        self.state["authority_assessment"][identifier] = record
        self.state["institutional_decision_and_misconduct"]["reasons:" + identifier] = {
            "decision_stage": "authority", "decision_basis_refs": record["known_basis_refs"],
            "decision_and_reasons": {"element_results": results, "scope": scope, "conclusion": conclusion},
        }
        return {"status": conclusion, "record_id": identifier}

    def query(self) -> JSON:
        knowledge = self.snapshot("knowledge")
        require(knowledge.get("actor_ref") == self.actor, "not_authorized")
        grants = knowledge.get("read_grants", {})
        requested = self.data.get("record_refs", [])
        require(isinstance(requested, list), "invalid_query")
        records = []
        for reference in requested:
            table, _, identifier = reference.partition("/")
            if table not in QUERIES[self.operation] or reference not in grants:
                continue
            record = self.state[table].get(identifier)
            if record is None:
                continue
            if "retention:" + reference in self.state["institutional_decision_and_misconduct"]:
                continue
            allowed = grants[reference]
            require(isinstance(allowed, list), "invalid_access_grant")
            if self.operation == "GetCommunicatedOrders" and identifier not in knowledge.get("communicated_order_refs", []):
                continue
            # References are not followed. Explicit per-field grants are required.
            view = {key: deepcopy(value) for key, value in record.items() if key in allowed}
            records.append({"record_ref": reference, "record": view})
        options = knowledge.get("visible_custody_options", []) if self.operation == "GetVisibleCustodyOptions" else []
        return {"status": "ok", "records": records, "options": deepcopy(options)}

    def explicit_choice(self, reference: str, operation: str, scope: JSON) -> JSON:
        players = self.snapshot("player_input").get("decisions", {})
        workers = self.snapshot("system_13").get("npc_decisions", {})
        choice = players.get(reference) or workers.get(reference, {})
        require(choice.get("explicit") is True, "explicit_choice_required")
        require(choice.get("actor_ref") == self.actor and choice.get("operation") == operation, "choice_scope_mismatch")
        require(choice.get("scope") == scope, "choice_scope_mismatch")
        require(timestamp(choice["occurred_at"]) <= timestamp(self.now), "future_choice")
        return choice

    def active_order(self, identifier: str) -> JSON:
        order = self.state["order"].get(identifier)
        require(order is not None, "order_unavailable")
        policy = self.policy("order_and_condition_types")
        require(order["status"] in policy.get("active_states", []), "order_not_active")
        require(timestamp(order["effective_at"]) <= timestamp(self.now), "order_not_effective")
        require(order["expires_at"] is None or timestamp(self.now) < timestamp(order["expires_at"]), "order_expired")
        return order

    def guard_authority(self, action: str, data: JSON) -> None:
        assessment = self.state["authority_assessment"].get(data.get("authority_ref"), {})
        require(assessment.get("actor_id") == self.actor, "authority_actor_mismatch")
        require(assessment.get("action_scope") == data.get("scope"), "authority_scope_mismatch")
        require(assessment.get("action_scope", {}).get("action") == action, "authority_action_mismatch")
        require(assessment.get("policy_version") == self.version, "authority_version_mismatch")
        self.known_facts(assessment["known_basis_refs"])
        if assessment.get("conclusion") != "sufficient":
            controls = self.policy("scenario_generation_controls")
            require(data.get("misconduct_ref") and self.operation in controls.get("enabled_misconduct_operations", []), "insufficient_authority")
            self.explicit_choice(data["misconduct_ref"], self.operation, data["scope"])
        if data.get("order_ref"):
            order = self.active_order(data["order_ref"])
            require(order["subject_ref"] == data["scope"]["target_ref"], "order_target_mismatch")
            issued_scope = self.ref(order["scope_ref"])
            require(issued_scope == data["scope"], "order_scope_mismatch")
        if data.get("consent_ref"):
            consent = self.snapshot("consent").get("consents", {}).get(data["consent_ref"], {})
            require(consent.get("explicit") is True and consent.get("revoked") is False, "consent_not_confirmed")
            require(consent.get("scope") == data["scope"], "consent_scope_mismatch")
            require(consent.get("subject_ref") == data["scope"]["target_ref"], "consent_subject_mismatch")
        if action == "contact" or self.policy("authority_policies")["actions"][action].get("requires_consent"):
            require(data.get("consent_ref"), "explicit_consent_required")

    def guard_counts(self, case_id: str, counts: JSON) -> None:
        require(isinstance(counts, dict) and bool(counts), "counts_required")
        combination = self.policy("count_combination_rules")
        signatures = set()
        required = {"offense_version", "alleged_acts", "identity_assessment", "basis", "unresolved_issues", "reasons"}
        for count in counts.values():
            require(isinstance(count, dict) and set(count) == required, "invalid_count")
            definition = self.state["offense_definition"].get(count["offense_version"], {})
            require(definition.get("version") == self.version, "count_version_mismatch")
            require(definition.get("source_kind") != "unresolved_historical_question", "historical_rule_disabled")
            self.known_facts(count["basis"])
            signature = digest([count["offense_version"], sorted(count["alleged_acts"])])
            require(signature not in signatures, "duplicate_count")
            signatures.add(signature)
        definitions = {count["offense_version"] for count in counts.values()}
        for exclusion in combination.get("mutually_exclusive", []):
            require(not set(exclusion) <= definitions, "invalid_count_combination")
        previous = self.state["order_custody_and_court_details"].get(case_id, {}).get("charge_counts", {})
        for key, value in previous.items():
            require(key in counts and counts[key] == value, "explicit_charge_revision_required")

    def guard_release(self, record: JSON, data: JSON) -> None:
        order = self.active_order(data["order_ref"])
        policy = self.policy("order_and_condition_types")
        require(order["type"] in policy.get("release_types", []), "release_order_required")
        require(order["subject_ref"] == record["subject_ref"], "release_subject_mismatch")
        required_conditions = self.ref(order["scope_ref"]).get("condition_refs", [])
        recorded_conditions = [item["condition_ref"] for item in self.state["obligation"].values() if item["order_id"] == order["id"]]
        require(set(required_conditions) <= set(recorded_conditions), "release_conditions_not_recorded")
        for other in self.state["order"].values():
            if other["id"] == order["id"] or other["subject_ref"] != record["subject_ref"]:
                continue
            if other["type"] in policy.get("custody_blocking_types", []) and other["status"] in policy.get("active_states", []):
                if timestamp(other["effective_at"]) <= timestamp(self.now) and (other["expires_at"] is None or timestamp(self.now) < timestamp(other["expires_at"])):
                    require(other["id"] in data.get("resolved_conflicting_order_refs", []), "conflicting_order")
                    # A claimed resolution must itself be a configured order rule.
                    resolutions = self.policy("custody_credit_and_order_conflict_rules").get("superseded_by", {})
                    require(resolutions.get(other["id"]) == order["id"], "conflicting_order")
        for obligation in self.state["obligation"].values():
            if obligation["order_id"] == order["id"]:
                require(obligation["status"] in policy.get("release_satisfied_obligation_states", []), "release_condition_pending")

    def guard_proposal(self, operation: str, data: JSON, record: JSON, old: JSON | None) -> None:
        table, mutable, owners, action = OPERATIONS[operation]
        rule = self.operation_policy(operation)
        work = self.snapshot("system_13")
        require(work.get("available") is True, "worker_unavailable")
        allowed_institutions = work.get("institution_refs", [work.get("institution_ref")])
        if table == "case_file":
            require(record["institution_id"] in allowed_institutions, "institution_scope_mismatch")
            require(record["identity_ref"] in self.snapshot("knowledge").get("known_identity_refs", []), "identity_assessment_not_acquired")
        facts = self.known_facts(data.get("basis_refs", []))
        if "condition" in rule:
            require(predicate(rule["condition"], facts) is True, "process_basis_unresolved")
        if operation in {"FileCharges", "ReviewApplication", "ReviewObligation", "Sentence", "IssueOrder", "ScreenCase"}:
            require("condition" in rule or rule.get("decision_model"), "procedural_decision_model_required")
        if operation in {"FileCharges", "IssueOrder", "RecordFinding", "Sentence"}:
            require(data.get("basis_refs"), "acquired_process_basis_required")
        if operation in {"FileCharges", "IssueOrder", "RecordFinding", "Sentence", "ReviewApplication"}:
            for expression in _expressions(rule):
                require(not set(expression.get("path", "").split(".")) & FORBIDDEN_BASIS_PATHS, "prohibited_legal_predicate")
        if rule.get("requires_resolution"):
            require(operation in {"Investigate", "PrepareDefense"}, "resolution_cannot_decide_guilt_or_choice")
            resolution = self.snapshot("system_10").get("resolutions", {}).get(data.get("resolution_ref"), {})
            require(resolution.get("committed") is True and resolution.get("task_ref") == data["record_id"], "stored_resolution_required")
            require(resolution.get("basis_refs") == data.get("basis_refs", []), "resolution_basis_mismatch")
            require(resolution.get("policy_version") == self.version, "resolution_version_mismatch")
        if "scope" in data:
            require(data["scope"].get("jurisdiction") in self.manifest()["jurisdiction_refs"], "jurisdiction_not_configured")
            home = work.get("jurisdiction_ref")
            if home != data["scope"].get("jurisdiction"):
                agreements = self.policy("cross_jurisdiction_authority").get("agreements", [])
                require({"from": home, "to": data["scope"]["jurisdiction"], "operation": operation} in agreements, "cross_jurisdiction_authority_required")
        if action:
            self.guard_authority(action, data)
        state_field = "stage" if table == "case_file" else "status" if "status" in record else None
        if state_field:
            if old is None:
                require(record[state_field] in rule.get("initial_states", []), "invalid_initial_state")
            elif old.get(state_field) != record[state_field]:
                require(record[state_field] in rule.get("transitions", {}).get(old.get(state_field), []), "invalid_transition")
        for name, expected in rule.get("required_values", {}).items():
            require(record.get(name) == expected, "invalid_transition_value")
        if rule.get("requires_choice") and not data.get("pending_player_choice_ref"):
            choice = self.explicit_choice(data.get("choice_ref"), operation, data.get("scope", {}))
            require(choice.get("proposal_hash") == digest({"record": data.get("record", {}), "details": data.get("details", {})}), "choice_terms_mismatch")
        if rule.get("decision_model"):
            outcomes = [item for item in rule["decision_model"] if predicate(item["when"], facts) is True]
            require(len(outcomes) == 1, "decision_unresolved")
            require(all(record.get(key) == value for key, value in outcomes[0]["updates"].items()), "decision_model_mismatch")
        if data.get("pending_player_choice_ref"):
            choice = self.snapshot("player_input").get("pending_choices", {}).get(data["pending_player_choice_ref"], {})
            require(choice.get("scope") == data.get("scope", {}), "choice_scope_mismatch")
        if operation == "QueueResponse":
            require(record["status"] == "queued" and record["assigned_unit"] is None, "invalid_dispatch_start")
            require(record["report_ref"] in self.state["report"], "report_required")
            require(record["priority"] in {"immediate_danger", "urgent", "routine", "deferred"}, "invalid_priority")
            require(record["queued_at"] == self.now, "invalid_queue_time")
            require(record["next_review_at"] == self.snapshot("system_11").get("next_shift_boundary"), "review_boundary_mismatch")
        if operation == "RecordAffectedParty":
            supported = self.snapshot("evidence").get("supported_harm_refs", [])
            require(set(record.get("supported_harm_refs", [])) <= set(supported), "unsupported_harm")
        if operation == "AssignResponse":
            require(old and old["status"] in {"queued", "deferred"} and record["status"] == "assigned", "invalid_dispatch_transition")
            unit = work.get("units", {}).get(record["assigned_unit"], {})
            require(unit.get("available") is True and unit.get("compatible") is True, "unit_unavailable")
            for task in self.state["response_task"].values():
                require(task["id"] == record["id"] or task["assigned_unit"] != record["assigned_unit"] or task["status"] in {"completed", "deferred"}, "unit_already_assigned")
        expected_dispatch = {"BeginTravel": ("assigned", "en_route"), "ArriveResponse": ("en_route", "on_scene")}
        if operation in expected_dispatch:
            require(old is not None and (old["status"], record["status"]) == expected_dispatch[operation], "invalid_dispatch_transition")
        if operation == "FinishResponse":
            require(record["status"] in {"completed", "deferred"}, "invalid_dispatch_transition")
        if operation == "SetReportDisposition":
            require(record["disposition"] in {"received", "pending_clarification", "dispatched", "referred", "declined", "closed"}, "invalid_disposition")
            if record["disposition"] == "dispatched":
                require(any(task["report_ref"] == record["id"] and task["assigned_unit"] for task in self.state["response_task"].values()), "assignment_required")
            if record["disposition"] == "referred":
                require(data.get("referral_delivery_ref") in self.snapshot("system_16").get("delivered_referral_refs", []), "delivered_referral_required")
        if operation in {"StartCustody", "BookArrival"}:
            require(record["next_review_at"] == self.snapshot("system_11").get("next_daily_review"), "review_boundary_mismatch")
        if operation == "StartCustody":
            require(record["started_at"] == self.now and record["facility_ref"] is None, "arrest_is_not_booking")
            require(not any(c["subject_ref"] == record["subject_ref"] and c["actual_control_ref"] is not None for c in self.state["custody"].values()), "custody_already_exists")
        if operation == "BookArrival":
            require(record["facility_ref"] is not None, "facility_required")
        if operation == "CreateObligation":
            order = self.active_order(record["order_id"])
            require(order["subject_ref"] == record["subject_ref"], "obligation_subject_mismatch")
            require(not record["notice_refs"] and not record["compliance_refs"], "obligation_is_not_notice_or_payment")
            require(record["condition_ref"] in self.ref(order["scope_ref"]).get("condition_refs", []), "condition_outside_order_scope")
        if operation == "RequestPayment":
            self.active_order(record["order_id"])
            require(data.get("transaction_ref"), "explicit_transaction_required")
            for workflow in self.state["deadline_and_durable_workflow"].values():
                for step in workflow.get("pending_steps", []):
                    previous = step.get("plan", {})
                    if previous.get("operation") == "RequestPayment":
                        require(previous.get("data", {}).get("transaction_ref") != data["transaction_ref"], "transaction_already_requested")
        if operation == "ReviewObligation":
            condition = self.ref(record["condition_ref"])
            require(condition.get("subject_ref") == record["subject_ref"], "condition_subject_mismatch")
            if record["status"] in self.policy("order_and_condition_types").get("release_satisfied_obligation_states", []):
                require(predicate(condition["satisfaction_predicate"], facts) is True, "condition_not_satisfied")
                if condition.get("requires_financial_transaction"):
                    confirmed = self.confirmed_effect_refs("system_14", record["id"])
                    require(record["compliance_refs"] and set(record["compliance_refs"]) <= confirmed, "payment_not_committed")
        if operation == "FileCharges":
            self.guard_counts(record["id"], data["details"]["charge_counts"])
        if operation in {"IssueOrder", "Sentence"}:
            require(record["issuer_ref"] == self.actor, "issuer_mismatch")
            require(record["type"] in self.policy("order_and_condition_types").get("enabled_types", []), "order_type_disabled")
            require(timestamp(record["effective_at"]) >= timestamp(self.now), "retroactive_order_forbidden")
            require(record["expires_at"] is None or timestamp(record["expires_at"]) > timestamp(record["effective_at"]), "invalid_order_period")
            self.known_facts(record["basis_refs"])
            order_scope = self.ref(record["scope_ref"])
            require(order_scope.get("target_ref") == record["subject_ref"], "order_scope_mismatch")
            if operation == "IssueOrder":
                application = self.state["order_custody_and_court_details"].get(data["details"]["application_ref"], {})
                require(application.get("review_decision") in {"approve", "narrow_scope"}, "approved_application_required")
                reviewed_scope = None
                for event in ordered_events(self.state):
                    audit = self.audit(event)
                    request = audit["request"]
                    if request["operation"] == "ReviewApplication" and request["data"].get("record_id") == data["details"]["application_ref"]:
                        reviewed_scope = request["data"].get("scope")
                require(reviewed_scope == order_scope, "order_exceeds_reviewed_scope")
            else:
                proceeding = self.state["proceeding"].get(data.get("proceeding_ref"), {})
                finding = self.state["order_custody_and_court_details"].get(proceeding.get("id"), {}).get("finding_by_count", {})
                require(proceeding.get("outcome_ref") and finding, "adjudication_required")
                eligible = self.policy("authorized_consequences").get("eligible_findings", [])
                require(any(value["decision"] in eligible for value in finding.values()), "sentencing_basis_missing")
                require(data["details"]["sentence_template_ref"] in self.policy("authorized_consequences").get("enabled_templates", []), "sentence_template_disabled")
        if operation == "ExecuteOrder":
            self.active_order(record["id"])
        if operation == "ExecuteRelease":
            self.guard_release(record, data)
            require(record["facility_ref"] is None and record["actual_control_ref"] is None, "release_requires_exit_and_control_end")
        if operation == "RecordPleaResponse":
            choice = self.explicit_choice(record.get("plea_response_ref"), operation, data.get("scope", {}))
            require(choice.get("offered_terms") == record["plea_offer"], "plea_terms_mismatch")
            require(data.get("scope", {}).get("target_ref") == self.actor, "plea_requires_subject_choice")
        if operation == "OfferAgreement":
            require(set(record) == {"plea_offer"}, "offer_is_not_acceptance")
        if operation == "RecordInterview":
            require(set(record.get("supplied_statement_refs", [])) <= set(self.snapshot("system_16").get("supplied_statement_refs", [])), "unsupplied_statement")
            if record.get("counsel_request"):
                request = record["counsel_request"]
                require(request in self.snapshot("player_input").get("counsel_requests", []) or request in work.get("counsel_requests", []), "unsupplied_counsel_request")
            if record.get("recording"):
                self.guard_recording(record["recording"], data)
        if operation == "Search":
            require(record.get("search_method") in self.policy("technology_capabilities").get("search_methods", []), "search_method_not_configured_for_era")
            require(record.get("search_target") == data.get("scope", {}).get("target_ref"), "search_target_scope_mismatch")
        if operation == "ScheduleProceeding":
            require(record["case_id"] in self.state["case_file"] and record["outcome_ref"] is None, "proceeding_is_not_finding")
            require(timestamp(record["scheduled_at"]) >= timestamp(self.now), "retroactive_proceeding_forbidden")
        if operation == "RequestCounsel":
            require(record.get("counsel_request") in self.snapshot("player_input").get("counsel_requests", []) + work.get("counsel_requests", []), "unsupplied_counsel_request")
        if operation == "RequestOrder":
            require("review_decision" not in record, "application_is_not_approval")
        if operation == "ReviewApplication":
            require(record.get("review_decision") in {"approve", "deny", "request_clarification", "narrow_scope"}, "invalid_review_decision")
        if operation == "RecordFinding":
            require(old is not None and old["outcome_ref"] is None, "separate_review_proceeding_required")
            require(timestamp(record["scheduled_at"]) <= timestamp(self.now), "proceeding_not_due")
            hearing = self.snapshot("system_13").get("hearings", {}).get(record["id"], {})
            require(hearing.get("committed") is True and hearing.get("participants_ref") == record["participants_ref"], "actual_hearing_required")
            present = hearing.get("location_event_ref") in self.snapshot("system_12").get("presence_event_refs", [])
            connected = hearing.get("channel_event_ref") in self.snapshot("system_16").get("hearing_channel_event_refs", [])
            require(present or connected, "hearing_presence_or_channel_required")
            require(set(data.get("basis_refs", [])) <= set(record["submitted_material_refs"]), "unsubmitted_material")
            findings = data["details"]["finding_by_count"]
            counts = self.state["order_custody_and_court_details"].get(record["case_id"], {}).get("charge_counts", {})
            require(findings and set(findings) <= set(counts), "unknown_adjudicated_count")
            for count_id, finding in findings.items():
                require(set(finding) == {"decision", "element_reasons", "uncertainty", "policy"}, "invalid_finding")
                require(finding["policy"] == self.version, "finding_policy_mismatch")
                model = rule.get("finding_models", {}).get(finding["decision"])
                require(model is not None and predicate(model, facts) is True, "finding_not_supported_by_model")
                definition = self.state["offense_definition"][counts[count_id]["offense_version"]]
                elements = self.ref(definition["elements_ref"])["elements"]
                evaluated = {key: predicate(value, facts) for key, value in elements.items()}
                require(finding["element_reasons"] == evaluated, "finding_reasons_mismatch")
                require(finding["uncertainty"] == [key for key, value in evaluated.items() if value is None], "finding_uncertainty_mismatch")
                if finding["decision"] in rule.get("agreement_findings", []):
                    agreement = self.state["order_custody_and_court_details"].get(data.get("plea_record_ref"), {})
                    response = agreement.get("plea_response_ref")
                    choice = self.snapshot("player_input").get("decisions", {}).get(response) or work.get("npc_decisions", {}).get(response, {})
                    require(choice.get("explicit") is True and choice.get("response") == "accept", "agreement_not_accepted")
                    require(choice.get("offered_terms") == agreement.get("plea_offer"), "agreement_terms_mismatch")
                    approvals = work.get("agreement_approvals", {})
                    approval_refs = data["details"].get("agreement_approval_refs", [])
                    require(approval_refs, "agreement_approval_required")
                    for reference in approval_refs:
                        approval = approvals.get(reference, {})
                        require(approval.get("approved") is True and approval.get("terms_hash") == digest(agreement["plea_offer"]), "agreement_approval_required")
        if operation == "ReopenCase":
            trigger = self.snapshot("system_13").get("review_triggers", {}).get(data.get("reconsideration_trigger_ref"), {})
            require(trigger.get("kind") in {"new_information", "changed_capacity", "new_responsible_actor", "scheduled_review"}, "reconsideration_trigger_required")
            require(trigger.get("subject_ref") == record["id"], "review_subject_mismatch")

    def confirmed_effect_refs(self, owner: str, subject: str) -> set[str]:
        references = set()
        for workflow in self.state["deadline_and_durable_workflow"].values():
            if workflow.get("subject_ref") != subject:
                continue
            for step in workflow.get("pending_steps", []):
                if step.get("owner") == owner and step.get("status") in {"effect_committed", "completed"}:
                    receipt = step.get("receipt", {})
                    references.add(receipt.get("event_ref"))
                    for field in ("compliance_refs", "notice_refs", "release_handoff_refs"):
                        references.update(receipt.get("field_values", {}).get(field, []))
        references.discard(None)
        return references

    def guard_recording(self, recording: JSON, data: JSON) -> None:
        require(isinstance(recording, dict) and set(recording) == {"device_ref", "captured_interval", "content_ref", "custody_ref"}, "invalid_recording")
        require(data.get("recording_method") in self.policy("technology_capabilities").get("recording_methods", []), "recording_method_not_configured_for_era")
        require(recording in self.snapshot("system_16").get("recordings", {}).values(), "recording_not_captured")

    def propose(self) -> JSON:
        operation, data = self.operation, self.data
        table, mutable, owners, _ = OPERATIONS[operation]
        identifier = data["record_id"]
        require(isinstance(identifier, str) and identifier and not identifier.startswith(("audit:", "reasons:", "violation:", "source-check:")), "reserved_record_id")
        old = self.state[table].get(identifier)
        patch = deepcopy(data["record"])
        validate_record(table, patch, complete=False)
        if mutable == "*":
            require(old is None, "record_already_exists")
        else:
            require(old is not None, "record_unavailable")
            require(set(patch) <= set(mutable.split()), "immutable_field")
        record = {**(old or {}), **patch}
        for name in {"supplied_statement_refs", "consent_and_revocation_refs", "notice_refs", "notice_delivery_refs", "compliance_refs", "seizure_transfer_refs"}:
            if old and name in old and name in patch:
                require(set(old[name]) <= set(patch[name]), "append_only_history")
        if table in CORE:
            require(record.get("id") == identifier, "record_key_mismatch")
        validate_record(table, record)
        if table == "case_file":
            record["revision"] = 0 if old is None else old["revision"] + 1
        if "details" in data:
            require(operation in DETAILS, "details_not_allowed")
            require(set(data["details"]) <= DETAIL_FIELDS[operation], "details_outside_operation_scope")
            validate_record(DETAILS[operation], data["details"], complete=False)
        self.guard_proposal(operation, data, record, old)
        if data.get("resolution_ref"):
            self.state["institutional_decision_and_misconduct"]["resolution:" + self.event_id] = {
                "decision_stage": operation, "stored_resolution_ref": data["resolution_ref"],
                "decision_basis_refs": data.get("basis_refs", []),
            }
        # A second pending action cannot overwrite a partially executed workflow.
        for workflow in self.state["deadline_and_durable_workflow"].values():
            for step in workflow.get("pending_steps", []):
                if step.get("plan", {}).get("table") == table and step["plan"].get("record_id") == identifier:
                    require(step.get("status") in {"completed", "abandoned"}, "record_has_pending_work")
        rule = self.operation_policy()
        extra_owners = rule.get("effect_owners", [])
        require(isinstance(extra_owners, list) and all(owner in STUBS for owner in extra_owners), "invalid_effect_owner")
        owners = tuple(dict.fromkeys([*owners, *extra_owners]))
        if not owners:
            for name in PHYSICAL_FIELDS & set(record):
                require(record[name] == (old or {}).get(name) or old is None and record[name] in (None, []), "foreign_confirmation_required")
            self.apply_record(table, identifier, record, data)
            if operation == "QueueResponse":
                self.deadline(identifier, "dispatch")
            if operation == "CreateObligation":
                self.enqueue_notification("system_11", "schedule:" + identifier, {
                    "operation": "ScheduleObligation", "subject_ref": record["subject_ref"],
                    "obligation_ref": identifier, "due_at": record["due_at"],
                })
            if operation in {"AssignResponse", "FinishResponse"}:
                self.enqueue_notification("system_13", "dispatch-work:" + self.event_id, {
                    "operation": operation, "subject_ref": record["assigned_unit"] or record["id"],
                    "response_task_ref": identifier, "status": record["status"],
                })
            return {"status": "committed", "record_id": identifier}
        workflow_id = "workflow:" + self.event_id
        plan = {
            "operation": operation, "actor_ref": self.actor, "table": table, "record_id": identifier,
            "record": record, "data": deepcopy(data), "old_digest": digest(old),
            "policy_version": self.version, "physical_fields_confirmed": [],
        }
        steps = []
        for owner in owners:
            key = "effect:" + digest([self.event_id, owner])
            payload = {
                "operation": operation, "actor_ref": self.actor, "record_id": identifier,
                "scope": data.get("scope", {}), "policy_version": self.version,
                "authority_ref": data.get("authority_ref"), "order_ref": data.get("order_ref"),
                "expected_record_digest": digest(old), "requested_fields": {
                    name: value for name, value in {**record, **data.get("details", {})}.items()
                    if name in PHYSICAL_FIELDS and (old or {}).get(name) != value
                }, "transaction_ref": data.get("transaction_ref"),
                "result_fields": sorted(RESULT_FIELDS.get(operation, set()) & RECEIPT_FIELDS.get(owner, set())),
                "parameters": {key: deepcopy(value) for key, value in {**record, **data.get("details", {})}.items() if key in OWNER_INPUT_FIELDS.get(owner, set())},
            }
            request = {"kind": "effect", "owner": owner, "idempotency_key": key, "payload": payload, "request_hash": digest(payload)}
            steps.append({"owner": owner, "status": "pending", "request": request, "plan": deepcopy(plan)})
        due = data.get("due_at", self.now)
        timestamp(due)
        self.state["deadline_and_durable_workflow"][workflow_id] = {
            "trigger_event_ref": self.event_id, "policy_version": self.version, "due_at": due,
            "responsible_institution_ref": self.snapshot("system_13").get("institution_ref"),
            "subject_ref": identifier, "review_task_ref": rule.get("review_task_ref"),
            "overdue_status": False, "overdue_response_ref": rule.get("overdue_response_ref"),
            "correlation_id": self.context["correlation_id"], "pending_steps": steps,
            "completed_external_event_refs": [], "step_idempotency_keys": [step["request"]["idempotency_key"] for step in steps],
            "revision": 0, "pending_player_choice_ref": data.get("pending_player_choice_ref"), "notice_delivery_refs": [],
        }
        if operation in {"StartCustody", "BookArrival"}:
            self.deadline(identifier, "custody")
        # Effects are requested only after the complete plan has been staged.
        # Receipts are processed by a separate ResumeWorkflow transaction.
        if not data.get("pending_player_choice_ref"):
            self.requests.extend(deepcopy(step["request"]) for step in steps)
            for request in self.requests:
                # Stubs are invoked, but the durable request is authoritative even
                # when an unavailable adapter cannot return a valid dictionary.
                try:
                    STUBS[request["owner"]](request, self.fixtures)
                except (KeyError, TypeError, ValueError, AttributeError):
                    pass
        return {"status": "pending", "record_id": identifier, "workflow_ref": workflow_id}

    def apply_record(self, table: str, identifier: str, record: JSON, data: JSON) -> None:
        validate_record(table, record)
        self.state[table][identifier] = deepcopy(record)
        if "details" in data:
            detail_table = DETAILS[self.operation]
            previous = self.state[detail_table].get(identifier, {})
            self.state[detail_table][identifier] = {**previous, **deepcopy(data["details"])}
        if data.get("misconduct_ref"):
            self.state["institutional_decision_and_misconduct"]["violation:" + self.event_id] = {
                "decision_stage": self.operation, "misconduct_actor_and_intent_basis": [data["misconduct_ref"]],
                "decision_basis_refs": [data["authority_ref"]],
                "decision_and_reasons": {"lawful_basis_unchanged": True, "action_ref": self.event_id},
            }
        if self.operation == "CancelOrder":
            self.enqueue_notification("system_16", "cancelled:" + identifier, {"operation": "NotifyOrderStatus", "subject_ref": record["subject_ref"], "order_ref": identifier, "status": record["status"]})

    def resume(self) -> JSON:
        identifier = self.data["workflow_ref"]
        workflow = self.state["deadline_and_durable_workflow"].get(identifier)
        require(workflow is not None and workflow["policy_version"] == self.version, "workflow_unavailable")
        if workflow.get("pending_player_choice_ref"):
            return {"status": "awaiting_player_choice", "workflow_ref": identifier}
        steps = workflow["pending_steps"]
        require(steps, "not_an_effect_workflow")
        if any(step.get("status") == "abandoned" for step in steps):
            return {"status": "proposal_declined", "workflow_ref": identifier}
        if "plan" not in steps[0]:
            return self.resume_notification(identifier, workflow)
        plan = steps[0]["plan"]
        require(plan["actor_ref"] == self.actor, "workflow_actor_mismatch")
        if all(step["status"] == "completed" for step in steps):
            return {"status": "completed", "workflow_ref": identifier}
        table, record_id = plan["table"], plan["record_id"]
        current = self.state[table].get(record_id)
        require(digest(current) == plan["old_digest"], "workflow_projection_conflict")
        saved_operation = self.operation
        self.operation = plan["operation"]
        try:
            preflight_failure = None
            try:
                require(self.snapshot("system_13").get("available") is True, "worker_unavailable")
                action = OPERATIONS[self.operation][3]
                if action:
                    self.guard_authority(action, plan["data"])
                if self.operation == "ExecuteRelease":
                    self.guard_release(plan["record"], plan["data"])
            except (ConstraintError, KeyError, TypeError, ValueError):
                preflight_failure = "current_preconditions_not_satisfied"
            for step in steps:
                if step["status"] in {"completed", "effect_committed"}:
                    continue
                request = step["request"]
                try:
                    # First collect any already-committed effect. A cancelled
                    # authority may not cause another execution attempt.
                    receipt = STUBS[step["owner"]]({**request, "kind": "receipt"}, self.fixtures)
                    require(isinstance(receipt, dict), "invalid_receipt")
                except (ConstraintError, KeyError, TypeError, ValueError, AttributeError):
                    step["status"] = "pending"
                    step["failure"] = "dependency_unavailable"
                    continue
                if receipt.get("status") != "committed":
                    step["status"] = "pending"
                    step["receipt"] = deepcopy(receipt)
                    if preflight_failure:
                        step["failure"] = preflight_failure
                    else:
                        self.requests.append(deepcopy(request))
                        try:
                            STUBS[step["owner"]](request, self.fixtures)
                        except (KeyError, TypeError, ValueError, AttributeError):
                            step["failure"] = "dependency_unavailable"
                    continue
                try:
                    self.validate_receipt(step, receipt)
                except (ConstraintError, KeyError, TypeError, ValueError) as error:
                    # An unverified receipt cannot assert physical state. Preserve
                    # it for review and never resend it as a new idempotency key.
                    step["status"] = "receipt_requires_review"
                    step["receipt"] = deepcopy(receipt)
                    step["failure"] = str(error) if isinstance(error, ConstraintError) else "invalid_receipt"
                    continue
                step["status"] = "effect_committed"
                step["receipt"] = deepcopy(receipt)
                if receipt["event_ref"] not in workflow["completed_external_event_refs"]:
                    workflow["completed_external_event_refs"].append(receipt["event_ref"])
                # Physical effects persist immediately, even if later work fails.
                physical = {key: value for key, value in receipt.get("field_values", {}).items() if key in PHYSICAL_FIELDS}
                if physical:
                    for key, value in physical.items():
                        if key in FIELDS[table]:
                            plan["record"][key] = deepcopy(value)
                        elif self.operation in DETAILS and key in DETAIL_FIELDS[self.operation]:
                            plan["data"].setdefault("details", {})[key] = deepcopy(value)
                    projected = deepcopy(self.state[table].get(record_id))
                    if projected is None:
                        projected = {key: deepcopy(value) for key, value in plan["record"].items() if key not in PHYSICAL_FIELDS}
                        if table in CORE:
                            for key in PHYSICAL_FIELDS & FIELDS[table]:
                                projected[key] = None
                    projected.update({key: value for key, value in physical.items() if key in FIELDS[table]})
                    validate_record(table, projected)
                    self.state[table][record_id] = projected
                    if self.operation in DETAILS:
                        detail_table = DETAILS[self.operation]
                        details = self.state[detail_table].setdefault(record_id, {})
                        details.update({key: value for key, value in physical.items() if key in DETAIL_FIELDS[self.operation]})
                    plan["old_digest"] = digest(projected)
                    plan["physical_fields_confirmed"] = sorted(set(plan["physical_fields_confirmed"]) | set(physical))
                    for other in steps:
                        other["plan"]["old_digest"] = plan["old_digest"]
            workflow["revision"] += 1
            if not all(step["status"] == "effect_committed" for step in steps):
                return {"status": "blocked" if preflight_failure else "pending", "workflow_ref": identifier}
            try:
                # Conditions may have changed while effects were pending. Never
                # relabel an invalid action lawful or roll back a physical effect.
                action = OPERATIONS[self.operation][3]
                if action:
                    self.guard_authority(action, plan["data"])
                if self.operation == "ExecuteRelease":
                    self.guard_release(plan["record"], plan["data"])
                wanted_physical = set().union(*(set(step["request"]["payload"]["requested_fields"]) for step in steps))
                require(wanted_physical <= set(plan["physical_fields_confirmed"]), "physical_confirmation_incomplete")
                if self.operation == "StartCustody":
                    require(plan["record"].get("actual_control_ref") and "actual_control_ref" in plan["physical_fields_confirmed"], "actual_control_required")
                if self.operation == "Seize":
                    require(plan["record"].get("seizure_transfer_refs"), "actual_seizure_required")
                if self.operation == "RequestPayment":
                    require(plan["record"].get("compliance_refs"), "actual_payment_required")
                self.apply_record(table, record_id, plan["record"], plan["data"])
            except (ConstraintError, KeyError, TypeError, ValueError) as error:
                self.state["institutional_decision_and_misconduct"]["violation:" + self.event_id] = {
                    "decision_stage": "workflow_failure",
                    "access_and_material_change_refs": deepcopy(workflow["completed_external_event_refs"]),
                    "decision_and_reasons": {"workflow_ref": identifier, "failure": str(error) if isinstance(error, ConstraintError) else "process_incomplete"},
                }
                return {"status": "physical_effects_committed_process_requires_review", "workflow_ref": identifier}
            for step in steps:
                step["status"] = "completed"
            return {"status": "completed", "workflow_ref": identifier, "record_id": record_id}
        finally:
            self.operation = saved_operation

    def validate_receipt(self, step: JSON, receipt: JSON) -> None:
        request = step["request"]
        require(receipt.get("idempotency_key") == request["idempotency_key"] and receipt.get("request_hash") == request["request_hash"], "receipt_binding_mismatch")
        require(isinstance(receipt.get("event_ref"), str) and receipt["event_ref"], "committed_event_required")
        require(receipt.get("actor_ref") == self.actor, "receipt_actor_mismatch")
        require(receipt.get("scope") == request["payload"]["scope"], "receipt_scope_mismatch")
        require(timestamp(receipt["occurred_at"]) <= timestamp(self.now), "future_effect")
        workflow_start = None
        for event in ordered_events(self.state):
            if any(request["idempotency_key"] in change["after"].get("step_idempotency_keys", []) for change in self.audit(event)["changes"] if change["table"] == "deadline_and_durable_workflow"):
                workflow_start = event["processed_at"]
                break
        require(workflow_start is not None and timestamp(receipt["occurred_at"]) >= timestamp(workflow_start), "effect_predates_request")
        for workflow in self.state["deadline_and_durable_workflow"].values():
            for other in workflow.get("pending_steps", []):
                previous = other.get("receipt", {})
                if other.get("status") in {"completed", "effect_committed"} and previous.get("event_ref") == receipt["event_ref"]:
                    require(previous.get("idempotency_key") == receipt["idempotency_key"], "duplicate_foreign_effect")
        allowed = RECEIPT_FIELDS.get(step["owner"], set())
        values = receipt.get("field_values", {})
        require(isinstance(values, dict) and set(values) <= allowed, "foreign_field_ownership")
        desired = request["payload"]["requested_fields"]
        result_fields = set(request["payload"].get("result_fields", []))
        require(all(key in desired or key in result_fields for key in values), "effect_projection_mismatch")
        for key, value in values.items():
            if key in desired and desired[key] is not None:
                require(desired[key] == value, "effect_projection_mismatch")
            elif key not in result_fields:
                require(value == desired.get(key), "effect_projection_mismatch")
            validate_record(step["plan"]["table"] if key in FIELDS[step["plan"]["table"]] else DETAILS[self.operation], {key: value}, complete=False)
        if self.operation == "RecordInterview":
            require(set(values.get("supplied_statement_refs", [])) <= set(self.snapshot("system_16").get("supplied_statement_refs", [])), "unsupplied_statement")
            if values.get("recording"):
                self.guard_recording(values["recording"], step["plan"]["data"])
        if step["owner"] == "system_15" and self.operation in {"Seize", "BookArrival", "ExecuteRelease", "Restrain"}:
            require(receipt.get("ownership_preserved") is True, "ownership_must_be_preserved")
            require(isinstance(receipt.get("instance_refs"), list), "exact_instances_required")
            require(len(receipt["instance_refs"]) == len(set(receipt["instance_refs"])), "duplicate_instance_transfer")
            if self.operation in {"Seize", "Restrain"}:
                require(receipt["instance_refs"], "actual_item_required")
        flag = REQUIRED_RECEIPT_FLAGS.get((self.operation, step["owner"]))
        if flag:
            require(receipt.get(flag) is True, "foreign_prerequisite_unconfirmed")
        if step["owner"] == "system_16" and self.operation in {"ReferCase", "PrepareDefense", "RecordNotice", "RequestOrder", "RecordPleaResponse", "ExecuteOrder"}:
            require(receipt.get("delivered") is True, "delivery_required")
        if self.operation == "RequestPayment" and step["owner"] == "system_14":
            require(receipt.get("transaction_ref") == request["payload"]["transaction_ref"], "transaction_mismatch")
        for predicate_expression in self.operation_policy().get("receipt_predicates", {}).get(step["owner"], []):
            require(predicate(predicate_expression, [receipt]) is True, "foreign_prerequisite_unconfirmed")

    def tick(self) -> JSON:
        due = []
        ready = []
        for identifier, workflow in sorted(self.state["deadline_and_durable_workflow"].items(), key=lambda item: (timestamp(item[1]["due_at"]), item[0])):
            if workflow["policy_version"] != self.version:
                continue
            if not workflow.get("review_task_ref"):
                continue
            if workflow.get("pending_steps") and all(step.get("status") == "completed" for step in workflow["pending_steps"]):
                continue
            if timestamp(workflow["due_at"]) <= timestamp(self.now):
                ready.append(identifier)
                self.enqueue_notification("system_13", "due:" + identifier, {"operation": "ReviewDue", "subject_ref": workflow["subject_ref"], "review_task_ref": workflow["review_task_ref"]})
            if timestamp(workflow["due_at"]) < timestamp(self.now) and not workflow["overdue_status"]:
                workflow["overdue_status"] = True
                workflow["revision"] += 1
                due.append(identifier)
                # Escalation requests do not claim an actor has completed review.
                payload = {"operation": "ReviewOverdue", "subject_ref": workflow["subject_ref"], "review_task_ref": workflow["review_task_ref"], "overdue_response_ref": workflow["overdue_response_ref"]}
                self.enqueue_notification("system_13", "overdue:" + identifier, payload)
        expired = []
        policy = self.policy("order_and_condition_types")
        for order in self.state["order"].values():
            order_version = None
            for event in ordered_events(self.state):
                if any(change["table"] == "order" and change["key"] == order["id"] and change["before"] is None for change in self.audit(event)["changes"]):
                    order_version = event["policy_version"]
                    break
            if order_version != self.version:
                continue
            if order["status"] in policy.get("active_states", []) and order["expires_at"] is not None and timestamp(order["expires_at"]) <= timestamp(self.now):
                require(isinstance(policy.get("expired_state"), str), "expiry_policy_missing")
                order["status"] = policy["expired_state"]
                expired.append(order["id"])
                self.enqueue_notification("system_16", "expired:" + order["id"], {"operation": "NotifyOrderStatus", "subject_ref": order["subject_ref"], "order_ref": order["id"], "status": order["status"]})
        return {"status": "processed", "due_workflow_refs": ready, "overdue_workflow_refs": due, "expired_order_refs": expired,
                "pending_player_choice_refs": [w["pending_player_choice_ref"] for w in self.state["deadline_and_durable_workflow"].values() if w.get("pending_player_choice_ref")]}

    def enqueue_notification(self, owner: str, key: str, payload: JSON) -> None:
        identifier = "workflow:" + key
        if identifier in self.state["deadline_and_durable_workflow"]:
            return
        payload = {**payload, "actor_ref": self.actor, "policy_version": self.version}
        request = {"kind": "effect", "owner": owner, "idempotency_key": key, "payload": payload, "request_hash": digest(payload)}
        self.state["deadline_and_durable_workflow"][identifier] = {
            "trigger_event_ref": self.event_id, "policy_version": self.version, "due_at": self.now,
            "responsible_institution_ref": self.snapshot("system_13").get("institution_ref"),
            "subject_ref": payload["subject_ref"], "review_task_ref": None,
            "overdue_status": False, "overdue_response_ref": None,
            "correlation_id": self.context["correlation_id"],
            "pending_steps": [{"owner": owner, "status": "pending", "request": request}],
            "completed_external_event_refs": [], "step_idempotency_keys": [key], "revision": 0,
            "pending_player_choice_ref": None, "notice_delivery_refs": [],
        }
        self.requests.append(deepcopy(request))
        try:
            STUBS[owner](request, self.fixtures)
        except (KeyError, TypeError, ValueError, AttributeError):
            pass

    def resume_notification(self, identifier: str, workflow: JSON) -> JSON:
        for step in workflow["pending_steps"]:
            if step["status"] == "completed":
                continue
            request = step["request"]
            require(request["payload"]["actor_ref"] == self.actor, "workflow_actor_mismatch")
            self.requests.append(deepcopy(request))
            try:
                receipt = STUBS[step["owner"]](request, self.fixtures)
                require(isinstance(receipt, dict), "invalid_receipt")
                if receipt.get("status") != "committed":
                    continue
                require(receipt.get("request_hash") == request["request_hash"] and receipt.get("idempotency_key") == request["idempotency_key"], "receipt_binding_mismatch")
                require(receipt.get("event_ref") and timestamp(receipt["occurred_at"]) <= timestamp(self.now), "invalid_receipt")
                require(not receipt.get("field_values"), "notification_cannot_change_legal_state")
                if step["owner"] == "system_16":
                    require(receipt.get("delivered") is True, "notice_not_delivered")
                    workflow["notice_delivery_refs"].append(receipt["event_ref"])
                step["status"] = "completed"
                step["receipt"] = deepcopy(receipt)
                workflow["completed_external_event_refs"].append(receipt["event_ref"])
            except (ConstraintError, KeyError, ValueError, TypeError, AttributeError):
                step["failure"] = "notification_unconfirmed"
        workflow["revision"] += 1
        return {"status": "completed" if all(step["status"] == "completed" for step in workflow["pending_steps"]) else "pending", "workflow_ref": identifier}

    def complete_review(self) -> JSON:
        workflow = self.state["deadline_and_durable_workflow"].get(self.data["workflow_ref"], {})
        require(workflow.get("review_task_ref") and not workflow.get("pending_steps"), "review_task_unavailable")
        review = self.snapshot("system_13").get("completed_reviews", {}).get(self.data["review_event_ref"], {})
        require(review.get("committed") is True and review.get("actor_ref") == self.actor, "actual_review_required")
        require(review.get("subject_ref") == workflow["subject_ref"] and review.get("review_task_ref") == workflow["review_task_ref"], "review_scope_mismatch")
        require(timestamp(review["occurred_at"]) <= timestamp(self.now), "future_review")
        workflow["completed_external_event_refs"].append(self.data["review_event_ref"])
        workflow["pending_steps"] = [{"kind": "review", "status": "completed", "event_ref": self.data["review_event_ref"]}]
        workflow["revision"] += 1
        subject = workflow["subject_ref"]
        custody = self.state["custody"].get(subject)
        report = self.state["report"].get(subject)
        task = self.state["response_task"].get(subject)
        if custody and custody["actual_control_ref"] is not None:
            self.deadline(subject, "custody")
            custody["next_review_at"] = self.snapshot("system_11")["next_daily_review"]
        elif report and report["disposition"] in {"received", "pending_clarification"}:
            self.deadline(subject, "intake")
        elif task and task["status"] not in {"completed"}:
            self.deadline(subject, "dispatch")
            task["next_review_at"] = self.snapshot("system_11")["next_shift_boundary"]
        return {"status": "review_recorded", "workflow_ref": self.data["workflow_ref"]}

    def resolve_choice(self) -> JSON:
        workflow = self.state["deadline_and_durable_workflow"].get(self.data["workflow_ref"], {})
        pending = workflow.get("pending_player_choice_ref")
        require(pending is not None, "no_pending_choice")
        plan = workflow["pending_steps"][0]["plan"]
        choice = self.explicit_choice(self.data["choice_ref"], plan["operation"], plan["data"].get("scope", {}))
        require(choice.get("pending_choice_ref") == pending, "choice_reference_mismatch")
        require(choice.get("proposal_hash") == digest({"record": plan["data"]["record"], "details": plan["data"].get("details", {})}), "choice_terms_mismatch")
        require(type(choice.get("authorizes_proposal")) is bool, "explicit_proposal_decision_required")
        workflow["pending_player_choice_ref"] = None
        workflow["revision"] += 1
        if not choice["authorizes_proposal"]:
            for step in workflow["pending_steps"]:
                step["status"] = "completed" if step["status"] in {"effect_committed", "completed"} else "abandoned"
            return {"status": "proposal_declined", "workflow_ref": self.data["workflow_ref"]}
        for step in workflow["pending_steps"]:
            step["plan"]["data"]["choice_ref"] = self.data["choice_ref"]
            step["plan"]["data"].pop("pending_player_choice_ref", None)
        return {"status": "choice_recorded", "workflow_ref": self.data["workflow_ref"]}

    def apply_retention(self) -> JSON:
        """End an institutional projection's visibility, preserving audit history."""
        table, identifier = self.data["table"], self.data["record_id"]
        require(table in {"report", "case_file", "proceeding", "order"}, "retention_scope_not_supported")
        require(identifier in self.state[table], "record_unavailable")
        rule = self.policy("privacy_and_retention_policies").get("retention", {}).get(table)
        require(isinstance(rule, dict) and rule.get("policy_ref"), "retention_policy_missing")
        boundary = self.snapshot("system_11").get("retention_boundaries", {}).get(table + "/" + identifier, {})
        require(boundary.get("policy_ref") == rule["policy_ref"], "retention_boundary_unconfirmed")
        require(timestamp(boundary["due_at"]) <= timestamp(self.now), "retention_not_due")
        require(isinstance(self.data.get("reason_ref"), str) and self.data["reason_ref"], "correction_reason_required")
        record = self.state[table][identifier]
        if "status" in record:
            require(record["status"] in rule.get("eligible_states", []), "active_record_requires_retention_review")
        self.state["institutional_decision_and_misconduct"]["retention:" + table + "/" + identifier] = {
            "decision_stage": "retention", "decision_basis_refs": [self.data["reason_ref"], rule["policy_ref"]],
            "decision_and_reasons": {"table": table, "record_id": identifier, "visibility_ended_at": self.now, "policy_version": self.version},
        }
        return {"status": "institutional_visibility_ended", "record_id": identifier}


def _expressions(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _expressions(child)
    elif isinstance(value, list):
        for child in value:
            yield from _expressions(child)


def main_state_machine(
    state: JSON, command: Command, stub_payloads: JSON | None = None,
) -> TransitionResult:
    """Apply one command without mutating caller-owned dictionaries.

    Required command keys are ``operation``, ``mutation_context``,
    ``policy_version`` and ``data``. Outbound requests contain stable keys and
    hashes to which fixture receipts must bind. Resume with a NEW command key
    after a new receipt arrives; the external effect key itself never changes.

    No mutation is accepted through narration. State and trusted fixtures belong
    to the engine host; player input enters only through its explicit stub.
    """
    before = deepcopy(state)
    revision = len(state.get("legal_event", {})) if isinstance(state, dict) else 0
    try:
        canonical(state)
        canonical(command)
        canonical(stub_payloads or {})
        validate_state(state)
        require(isinstance(command, dict) and set(command) == {"operation", "mutation_context", "policy_version", "data"}, "invalid_command")
        context = command["mutation_context"]
        require(isinstance(context, dict) and set(context) == CONTEXT, "invalid_mutation_context")
        require(type(context["expected_revision"]) is int and context["expected_revision"] >= 0, "invalid_revision")
        require(all(isinstance(context[name], str) and context[name] for name in CONTEXT - {"expected_revision"}), "invalid_mutation_context")
        require(isinstance(command["operation"], str) and isinstance(command["data"], dict), "invalid_command")
        require(isinstance(command["policy_version"], str) and bool(command["policy_version"]), "policy_version_required")
        execution = _Execution(state, command, deepcopy(stub_payloads or {}))
        replay = execution.enter()
        if replay is not None:
            result = execution.query() if execution.operation in QUERIES else replay
            return {"state": before, "result": result, "external_requests": [], "expected_revision": revision, "revision": revision}
        previous = execution.previous_decision()
        if previous is not None:
            return {"state": before, "result": previous, "external_requests": [], "expected_revision": revision, "revision": revision}
        handlers = {
            "InstallManifest": execution.install,
            "ClassifyConduct": execution.classify,
            "AcquireInformation": execution.acquire,
            "ReceiveReport": execution.receive_report,
            "AssessAuthority": execution.assess_authority,
            "ResumeWorkflow": execution.resume,
            "ResolveChoice": execution.resolve_choice,
            "Tick": execution.tick,
            "CompleteReview": execution.complete_review,
            "ApplyRetention": execution.apply_retention,
        }
        if execution.operation in QUERIES:
            result = execution.query()
        elif execution.operation in OPERATIONS:
            result = execution.propose()
        else:
            require(execution.operation in handlers, "unknown_operation")
            result = handlers[execution.operation]()
        execution.commit(result, before)
        validate_state(execution.state)
        return {
            "state": execution.state, "result": result,
            "external_requests": execution.requests,
            "expected_revision": revision, "revision": len(execution.state["legal_event"]),
        }
    except (ConstraintError, KeyError, TypeError, ValueError, AttributeError) as error:
        # Deliberately omit values, record existence, private references and tracebacks.
        code = str(error) if isinstance(error, ConstraintError) else "invalid_or_incomplete_input"
        return {"state": before, "result": {"status": "rejected", "code": code}, "external_requests": [], "expected_revision": revision, "revision": revision}
