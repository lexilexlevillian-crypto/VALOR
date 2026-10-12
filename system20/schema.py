"""Only architecture-listed variables are persistent.

Supplemental records are sparse because the specification leaves many values
unresolved. Absence is preserved; it is never converted to zero or false.
Every persistent reference is a string. Referenced content is held by its owner.
"""

from dataclasses import asdict, field, make_dataclass
from datetime import datetime
from typing import Any

JSON = dict[str, Any]

FIELDS = {
    "offense_definition": "id jurisdiction effective_from effective_to elements_ref defenses_ref source_kind version",
    "incident": "id conduct_refs occurred_at location_ref offense_candidate_refs restricted_truth_ref",
    "report": "id incident_ref reporter_ref received_at content_ref identity_confidence disposition",
    "authority_assessment": "id actor_id action_scope known_basis_refs policy_version conclusion reasons_ref",
    "response_task": "id report_ref priority assigned_unit queued_at status next_review_at",
    "case_file": "id institution_id allegations_ref identity_ref evidence_matrix_ref stage assigned_workers revision",
    "order": "id type issuer_ref subject_ref scope_ref effective_at expires_at status basis_refs",
    "custody": "id subject_ref asserted_basis actual_control_ref facility_ref started_at status next_review_at",
    "proceeding": "id case_id type scheduled_at participants_ref submitted_material_refs outcome_ref",
    "obligation": "id order_id subject_ref condition_ref due_at notice_refs compliance_refs status",
    "legal_event": "id occurred_at processed_at actor_ref cause_ref policy_version idempotency_key payload_ref",
    "legal_manifest": "version jurisdiction_refs effective_period enabled_offense_families mental_state_requirements severity_classes authorized_consequences count_combination_rules authority_policies procedural_standards institution_roles cross_jurisdiction_authority dispatch_policies review_and_deadline_policies order_and_condition_types financial_consequence_rules custody_credit_and_order_conflict_rules privacy_and_retention_policies technology_capabilities historical_source_provenance scenario_generation_controls presentation_controls",
    "offense_candidate": "supporting_event_refs offense_definition_ref catalog_version involved_person_refs affected_property_refs jurisdiction occurred_at satisfied_elements unresolved_elements intent_basis_refs possible_exclusions_or_defenses",
    "affected_party": "party_ref supported_harm_refs property_interest_refs account_refs safety_concerns contact_preferences report_participation desired_response remedy_request_refs remedy_decision_refs remedy_execution_refs",
    "information_and_evidence_association": "holder_ref observation_refs inference_refs recollection_refs statement_refs original_source_refs transmission_links acquired_at confidence observation_conditions identity_match supporting_sources_by_element contradictory_sources_by_element unresolved_questions admissibility_assessments physical_custody_refs access_and_amendment_history",
    "intake_and_task_details": "channel_event_ref received_content_ref apparent_urgency reported_location location_confidence contact_method receiving_institution_ref original_and_amended_report_refs linked_agency_task_refs task_actor_ref purpose method access_basis_ref duration outcome_ref decision_reason_refs",
    "stop_search_and_interview": "participants location_ref started_at purpose authority_assessment_ref departure_physically_obstructed departure_claimed_restricted communicated_claim_refs review_boundary search_target search_method proposed_scope authorized_scope consent_and_revocation_refs execution_and_discovery_refs seizure_transfer_refs receipt_and_inventory_status custody_context_ref communication_access_refs notice_delivery_refs counsel_request counsel_appointment_consultation_representation_refs supplied_statement_refs recording violation_refs",
    "order_custody_and_court_details": "application_ref applicant_ref review_decision order_jurisdiction service_execution_and_return_refs asserted_identity booking_staff_refs arrival_and_acceptance_refs intake_time property_inventory_refs observed_or_disclosed_health_concerns charge_counts plea_offer plea_response_ref agreement_approval_refs finding_by_count sentence_template_ref recorded_custody_intervals credited_intervals condition_scope suspected_violation release_handoff_refs",
    "institutional_decision_and_misconduct": "institution_profile_version capacity_and_workload_refs competence_distribution follow_through record_quality incentives oversight actor_context_refs decision_stage decision_basis_refs stored_resolution_ref decision_and_reasons reconsideration_trigger_ref misconduct_actor_and_intent_basis access_and_material_change_refs beneficiary_and_harmed_party_refs possible_trace_refs complaint_and_oversight_task_refs",
    "deadline_and_durable_workflow": "trigger_event_ref policy_version due_at responsible_institution_ref subject_ref review_task_ref overdue_status overdue_response_ref correlation_id pending_steps completed_external_event_refs step_idempotency_keys revision pending_player_choice_ref notice_delivery_refs",
}
FIELDS = {name: frozenset(value.split()) for name, value in FIELDS.items()}
CONTEXT = frozenset("actor_or_system_authority expected_revision canonical_timestamp correlation_id idempotency_key".split())
CORE = frozenset(list(FIELDS)[:11])
NULLABLE_CORE = {
    "offense_definition": {"effective_to"}, "report": {"reporter_ref", "identity_confidence"},
    "response_task": {"assigned_unit"}, "order": {"expires_at"},
    "custody": {"actual_control_ref", "facility_ref"}, "proceeding": {"outcome_ref"},
}


class ConstraintError(ValueError):
    """The message is a public error code, never private legal information."""


def require(condition: bool, code: str = "constraint_rejected") -> None:
    if not condition:
        raise ConstraintError(code)


def timestamp(value: Any) -> datetime:
    require(isinstance(value, str), "invalid_timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ConstraintError("invalid_timestamp") from error
    require(parsed.tzinfo is not None, "timezone_required")
    return parsed


def validate_record(table: str, record: JSON, complete: bool = True) -> None:
    require(table in FIELDS and isinstance(record, dict), "invalid_record")
    require(set(record) <= FIELDS[table], "unknown_state_variable")
    if complete and table in CORE:
        require(set(record) == FIELDS[table], "incomplete_record")
    for name, value in record.items():
        if table in CORE and value is None:
            require(name in NULLABLE_CORE.get(table, set()), "required_value_missing")
        if name == "revision":
            require(type(value) is int and value >= 0, "invalid_revision")
        elif name in {"overdue_status", "departure_physically_obstructed", "departure_claimed_restricted"}:
            require(type(value) is bool, "invalid_boolean")
        elif name.endswith("_refs") or name in {
            "participants", "assigned_workers", "step_idempotency_keys", "transmission_links",
            "satisfied_elements", "unresolved_elements", "intent_basis_refs",
        }:
            require(isinstance(value, list) and all(isinstance(x, str) and x for x in value), "invalid_reference_list")
        elif name.endswith("_ref") or name in {
            "id", "actor_id", "institution_id", "case_id", "order_id", "subject_ref", "version",
            "policy_version", "catalog_version", "idempotency_key", "correlation_id", "assigned_unit",
        }:
            require(value is None or isinstance(value, str) and bool(value), "invalid_reference")
        elif name.endswith("_at") or name in {"effective_from", "effective_to", "intake_time"}:
            if value is not None:
                timestamp(value)
        elif name in {"status", "stage", "disposition", "source_kind", "conclusion", "jurisdiction", "type", "priority"}:
            require(isinstance(value, str) and bool(value), "invalid_string_state")
        elif name in {"pending_steps", "unresolved_questions", "admissibility_assessments"}:
            require(isinstance(value, list) and all(isinstance(item, dict) for item in value), "invalid_record_list")


LegalState = make_dataclass(
    "LegalState",
    [("domain", str, field(default="crime_law_police"))]
    + [(name, dict, field(default_factory=dict)) for name in FIELDS]
    + [("mutation_context", dict, field(default_factory=dict))],
    slots=True,
)
LegalState.__module__ = __name__
LegalState.__doc__ = "Persistent System 20 state; table keys are opaque record identifiers."


def new_state() -> JSON:
    return asdict(LegalState())


def validate_state(state: JSON) -> None:
    require(set(state) == {"domain", "mutation_context", *FIELDS}, "invalid_state_schema")
    require(state["domain"] == "crime_law_police", "invalid_domain")
    for table in FIELDS:
        require(isinstance(state[table], dict), "invalid_state_schema")
        for key, record in state[table].items():
            require(isinstance(key, str) and bool(key), "invalid_record_key")
            validate_record(table, record)
            if "id" in record:
                require(record["id"] == key, "record_key_mismatch")
    require(set(state["mutation_context"]) <= CONTEXT, "invalid_mutation_context")
