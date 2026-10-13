"""
System 27: isolated creator/developer control plane.

Python 3.11+, standard library only.

All external dependencies are stateless dummy-JSON adapters. They do not implement
game systems or commit canonical game effects. Successful mock acknowledgements
are explicitly distinguished from real simulation results.

Persistent state contains only the variables supplied in the architecture.
Implementation choices:
- Identifiers, references, versions, revisions, and fences are opaque strings.
- Unassigned references use None.
- Status values are local workflow states, not external owner states.
- SQLite serializes control-plane commands and persists partial outcomes.
- Owner calls carry stable idempotency keys and conditional-write requirements.
  A future real adapter must honor those contracts across timeout/crash retries.

CLI:
    python -B -m system27 [control.sqlite3]

Each stdin line is a request JSON object. Each stdout line is a response JSON
object. The demo session is selected by the server-side environment variable
SYSTEM27_DEMO_SESSION: "creator" (default), "player", or "revoked".
These demo sessions are placeholders, not production authentication.

Example opening request:
{
  "command": "OpenContext",
  "request_id": "open-1",
  "context_id": "context-1",
  "campaign_id": "demo:campaign",
  "timeline_id": "demo:source",
  "cut_ref": "demo:cut:0",
  "fence": null,
  "actor_or_subject_ref": "demo:actor",
  "read_write_scope": "write",
  "policy_version": "27.1",
  "payload": {"workspace": "authoring"}
}

Subsequent requests must supply the returned fence and the exact context scope.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import sqlite3
import sys
from dataclasses import dataclass, field, fields
from datetime import datetime, timezone
from typing import Any, Callable, Literal, TypedDict


JSON = Any
Object = dict[str, JSON]


class CommandRequest(TypedDict):
    command: str
    request_id: str
    context_id: str
    campaign_id: str
    timeline_id: str
    cut_ref: str
    fence: str | None
    actor_or_subject_ref: str
    read_write_scope: Literal["read", "write"]
    policy_version: str
    payload: Object


class CommandResponse(TypedDict):
    ok: bool
    status: str
    execution: Literal["mock"]
    canonical_effects_committed: Literal[False]
    data: Object


POLICY_VERSION = "27.1"
MAX_REQUEST_BYTES = 256_000
MAX_COLLECTION_SIZE = 1_000

RECORD_FIELDS = {
    "creator_context":
        "id principal_ref capability_refs campaign_id timeline_id cut_ref fence",
    "content_draft":
        "id owner_domain source_version candidate_ref validation_ref status",
    "impact_plan":
        "id context_ref target_refs expected_revisions patch_refs "
        "dependencies_ref knowledge_policy recovery_anchor status",
    "control_operation":
        "id plan_ref reason kind started_at completed_stages owner_event_refs status",
    "test_scenario":
        "id root_checkpoint fixture_refs scripted_inputs assertion_refs version",
    "test_run":
        "id scenario_ref sandbox_timeline trace_refs actual_results status",
    "diagnostic_artifact":
        "id task_ref source_cut privilege_scope payload_ref redaction_policy",
    "repair_case":
        "id invariant_refs evidence_refs diagnosis_ref approved_plan validation_results",
    "workspace_context":
        "workspace actor_or_subject_ref read_write_scope selected_campaign "
        "selected_timeline selected_cut",
    "capability_contract":
        "domain campaign_timeline_scope permitted_operation_classes expiry_revocation",
    "version_and_lineage":
        "version source_cut source_lineage applicability provenance",
    "impact_details":
        "before_after_values owner_approvals affected_dependencies invariant_results "
        "resource_access_changes pending_work_conflicts information_effects "
        "application_steps fallback requires_paused_simulation",
    "operation_audit":
        "actor intent capability_context target_scope before_after_revisions "
        "idempotency_key pending_stages outcome",
    "generation_task":
        "task_id constraint_snapshot accepted_output creation_key created_entity_id",
    "test_execution":
        "fixture_provenance target_time_or_interval stop_policy progress_cursor "
        "before_after_cuts processed_owner_events paused_choices deferred_tasks "
        "errors assertion_evidence invalid_fault_fixture",
    "diagnosis_details":
        "classification facts_inspected unavailable_sources uncertainty "
        "restoration_route post_repair_checks",
    "knowledge_correction":
        "subject source acquisition_time reason owner_validation",
    "policy_manifest":
        "version capability_scope field_ownership allowed_patch_classes test_seams "
        "knowledge_correction_rules trace_retention export_redaction "
        "live_boundary_handling",
}
RECORD_FIELDS = {
    name: frozenset(value.split()) for name, value in RECORD_FIELDS.items()
}


@dataclass(slots=True)
class System27State:
    creator_context: dict[str, Object] = field(default_factory=dict)
    content_draft: dict[str, Object] = field(default_factory=dict)
    impact_plan: dict[str, Object] = field(default_factory=dict)
    control_operation: dict[str, Object] = field(default_factory=dict)
    test_scenario: dict[str, Object] = field(default_factory=dict)
    test_run: dict[str, Object] = field(default_factory=dict)
    diagnostic_artifact: dict[str, Object] = field(default_factory=dict)
    repair_case: dict[str, Object] = field(default_factory=dict)
    workspace_context: dict[str, Object] = field(default_factory=dict)
    capability_contract: dict[str, Object] = field(default_factory=dict)
    version_and_lineage: dict[str, Object] = field(default_factory=dict)
    impact_details: dict[str, Object] = field(default_factory=dict)
    operation_audit: dict[str, Object] = field(default_factory=dict)
    generation_task: dict[str, Object] = field(default_factory=dict)
    test_execution: dict[str, Object] = field(default_factory=dict)
    diagnosis_details: dict[str, Object] = field(default_factory=dict)
    knowledge_correction: dict[str, Object] = field(default_factory=dict)
    policy_manifest: dict[str, Object] = field(default_factory=dict)

    def put(self, table: str, key: str, record: Object) -> None:
        require(table in RECORD_FIELDS, "INVALID_STATE_TABLE")
        require(set(record) == RECORD_FIELDS[table], "INVALID_STATE_FIELDS")
        assert_json(record)
        getattr(self, table)[key] = copy.deepcopy(record)

    def get(self, table: str, key: str) -> Object:
        text(key)
        result = getattr(self, table).get(key)
        require(result is not None, "RECORD_NOT_FOUND")
        return result

    def dump(self) -> Object:
        return {f.name: copy.deepcopy(getattr(self, f.name)) for f in fields(self)}

    @classmethod
    def load(cls, data: Object) -> "System27State":
        require(set(data) == set(RECORD_FIELDS), "INVALID_STATE_SCHEMA")
        state = cls()
        for table, records in data.items():
            require(isinstance(records, dict), "INVALID_STATE_SCHEMA")
            for key, record in records.items():
                require(isinstance(key, str), "INVALID_STATE_SCHEMA")
                state.put(table, key, record)
        return state


class ControlError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ControlError(code)


def canonical(value: JSON) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    )


def digest(value: JSON) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def assert_json(value: JSON, depth: int = 0) -> None:
    require(depth <= 32, "JSON_TOO_DEEP")
    if value is None or type(value) in (str, bool, int):
        return
    if type(value) is float:
        require(math.isfinite(value), "INVALID_JSON_NUMBER")
        return
    if isinstance(value, list):
        require(len(value) <= MAX_COLLECTION_SIZE, "COLLECTION_TOO_LARGE")
        for item in value:
            assert_json(item, depth + 1)
        return
    if isinstance(value, dict):
        require(len(value) <= MAX_COLLECTION_SIZE, "COLLECTION_TOO_LARGE")
        for key, item in value.items():
            require(isinstance(key, str), "INVALID_JSON_KEY")
            assert_json(item, depth + 1)
        return
    raise ControlError("INVALID_JSON_VALUE")


def exact(data: Object, required: set[str], optional: set[str] | None = None) -> None:
    require(isinstance(data, dict), "INVALID_OBJECT")
    optional = optional or set()
    require(required <= set(data), "MISSING_FIELD")
    require(set(data) <= required | optional, "UNSUPPORTED_FIELD")
    # Validate scalar identifiers before they reach dictionary/set lookups.
    scalar_fields = {
        "command", "request_id", "context_id", "campaign_id", "timeline_id",
        "cut_ref", "actor_or_subject_ref", "policy_version", "read_write_scope",
        "id", "draft_id", "plan_id", "case_id", "repair_case_id", "task_id",
        "run_id", "scenario_id", "operation_id", "new_context_id", "owner_domain",
        "source_version", "candidate_ref", "accepted_output", "creation_key",
        "constraint_snapshot", "generation_task_id", "preview_digest", "reason",
        "kind", "workspace", "mode", "version", "root_checkpoint", "recovery_anchor",
        "checkpoint_ref", "package_ref", "patch_ref", "task_ref", "stop_policy",
        "subject", "source", "content",
    }
    for key in set(data) & scalar_fields:
        text(data[key])


def text(value: JSON) -> str:
    require(isinstance(value, str) and 0 < len(value) <= 4096, "INVALID_STRING")
    return value


def references(value: JSON, *, allow_empty: bool = False) -> list[str]:
    require(isinstance(value, list), "INVALID_REFERENCE_LIST")
    require(allow_empty or bool(value), "EMPTY_REFERENCE_LIST")
    require(len(value) <= MAX_COLLECTION_SIZE, "COLLECTION_TOO_LARGE")
    for item in value:
        text(item)
    require(len(set(value)) == len(value), "DUPLICATE_REFERENCE")
    return value


def utc_now() -> str:
    """Administrative timestamp; never a canonical game-clock input."""
    return datetime.now(timezone.utc).isoformat()


def scope_of(request: Object) -> Object:
    return {
        key: request[key]
        for key in (
            "context_id", "campaign_id", "timeline_id", "cut_ref", "fence",
            "actor_or_subject_ref", "read_write_scope", "policy_version",
        )
    }


def result(status: str, data: Object | None = None, *, ok: bool = True) -> CommandResponse:
    return {
        "ok": ok,
        "status": status,
        "execution": "mock",
        "canonical_effects_committed": False,
        "data": copy.deepcopy(data or {}),
    }


# ---------------------------------------------------------------------------
# External black-box placeholders.
#
# Fixtures are canned contract responses, not simulations of owner behavior.
# Binding and generated mock receipt IDs identify requests only.
# Unknown references fail closed rather than acquiring invented semantics.
# ---------------------------------------------------------------------------

OWNER_DOMAINS = {
    "system_9", "system_10", "system_11", "system_12", "system_13",
    "system_14", "system_15", "system_17", "system_20", "system_21",
    "system_22", "system_23", "system_24", "system_25", "system_26",
    "relationships", "consent", "knowledge", "memory", "health",
}

PATCH_CLASSES = {
    "instance_edit", "migration", "archive", "deletion",
    "repair", "knowledge_correction", "npc_create", "intervention",
}

VALIDATION_CHECKS = (
    "schema", "dependencies", "references", "content_settings", "era_policy",
    "owner_invariants", "field_ownership", "agency", "consent_scope",
    "history_preserved", "definition_instance_separation", "identity_continuity",
    "resource_continuity", "legal_sources", "typed_content", "no_executable_code",
    "knowledge_policy", "reference_safe_removal", "lineage_preserved",
    "no_runtime_secrets", "no_stereotype_defaults",
)

PATCH_FIXTURES = {
    "demo:patch": ("instance_edit", "truth"),
    "demo:migration": ("migration", "truth"),
    "demo:archive": ("archive", "truth"),
    "demo:delete": ("deletion", "truth"),
    "demo:repair": ("repair", "truth"),
    "demo:knowledge": ("knowledge_correction", "knowledge"),
    "demo:npc-create": ("npc_create", "truth"),
    "demo:intervention": ("intervention", "truth"),
}


def mock_reply(request: Object, data: Object) -> Object:
    return {
        "mock": True,
        "request_binding": digest(request),
        "data": copy.deepcopy(data),
    }


def request_authorization(request: Object) -> Object:
    session = request.get("server_session")
    creator = session == "creator"
    player = session == "player"
    return mock_reply(request, {
        "verified": creator or player,
        "principal_ref": "demo:creator" if creator else "demo:player",
        "capability_refs": ["demo:creator-capability"] if creator else ["demo:preview"],
        "capability_contract": {
            "domain": "creator_developer_control",
            "campaign_timeline_scope": {
                "campaign_id": "demo:campaign",
                "source_timeline": "demo:source",
                "test_timeline_prefix": "demo:test:",
                "actor_refs": ["demo:actor"],
            },
            "permitted_operation_classes": (
                [
                    "context", "preview", "inspect", "author", "test",
                    "migrate", "repair", "export", "administration",
                ] if creator else ["context", "preview"]
            ),
            "expiry_revocation": {
                "revoked": not (creator or player),
                "expired": False,
            },
        },
    })


def mock_owner(request: Object, owner_domain: str) -> Object:
    action = request["action"]
    payload = request["payload"]

    if action == "validate_candidate":
        known = payload.get("candidate_ref") == "demo:candidate"
        return mock_reply(request, {
            "valid": known,
            "validation_ref": "demo:validation" if known else None,
            "checks": {name: known for name in VALIDATION_CHECKS},
            "unresolved": [] if known else ["UNKNOWN_CANDIDATE_REFERENCE"],
        })

    if action == "preview":
        patch_refs = payload.get("patch_refs", [])
        known = (
            bool(patch_refs)
            and all(ref in PATCH_FIXTURES for ref in patch_refs)
            and payload.get("target_refs") == ["demo:entity"]
        )
        patches = []
        for ref in patch_refs:
            if ref not in PATCH_FIXTURES:
                continue
            kind, layer = PATCH_FIXTURES[ref]
            patches.append({
                "owner_domain": owner_domain,
                "patch_ref": ref,
                "target_ref": "demo:entity",
                "kind": kind,
                "layer": layer,
                "before": {"source_ref": "demo:before"},
                "after": {"source_ref": "demo:after"},
                "provenance": (
                    "correction" if kind in {"repair", "knowledge_correction"}
                    else "creator-authored intervention"
                ),
            })
        return mock_reply(request, {
            "valid": known,
            "checks": {name: known for name in VALIDATION_CHECKS},
            "unresolved": [] if known else ["UNKNOWN_PATCH_OR_TARGET"],
            "expected_revisions": {
                "demo:entity": "demo:r1",
                "demo:dependency": "demo:r1",
            },
            "patches": patches,
            "approval_ref": "demo:owner-approval",
            "dependencies_ref": "demo:dependencies",
            "dependencies": ["demo:dependency"],
            "resource_access_changes": [],
            "pending_work_conflicts": [],
            "information_effects": {
                "truth": any(p["layer"] == "truth" for p in patches),
                "record": False,
                "knowledge": any(p["layer"] == "knowledge" for p in patches),
                "rendering": False,
            },
            "destructive_dependencies_resolved": True,
            "requires_paused_simulation": False,
            "supports_atomic_batch": False,
        })

    if action == "check_revisions":
        return mock_reply(request, {
            "revisions": {
                "demo:entity": "demo:r1",
                "demo:dependency": "demo:r1",
            },
            "head_valid": True,
        })

    if action == "prepare":
        return mock_reply(request, {
            "approved": True,
            "coherent_boundary": True,
            "reservations_valid": True,
            "approval_ref": "demo:owner-approval",
        })

    if action == "validate_knowledge":
        valid = (
            payload.get("subject") == "demo:actor"
            and payload.get("source") == "demo:acquisition"
            and payload.get("acquisition_time") == "demo:time:0"
            and bool(payload.get("reason"))
        )
        return mock_reply(request, {
            "valid": valid,
            "source_verified": valid,
            "owner_validation": "demo:knowledge-validation" if valid else None,
            "demonstrably_lost_or_wrong": valid,
        })

    if action == "diagnose":
        known = (
            payload.get("invariant_refs") == ["demo:invariant"]
            and payload.get("evidence_refs") == ["demo:evidence"]
        )
        return mock_reply(request, {
            "diagnosis_ref": "demo:diagnosis",
            "classification": (
                "exact_record_correction" if known else "unrecoverable_canonical_gap"
            ),
            "facts_inspected": ["demo:evidence"] if known else [],
            "unavailable_sources": [] if known else ["demo:required-source"],
            "uncertainty": [] if known else ["Restoration is not established."],
            "restoration_route": "restore_reference" if known else "restore_or_fork_anchor",
            "post_repair_checks": ["references", "known_views", "pending_tasks"],
            "verified_restoration": known,
            "modeled_disagreement": False,
        })

    if action == "post_validate":
        return mock_reply(request, {
            "valid": True,
            "invariants": True,
            "known_views": True,
            "pending_tasks": True,
            "references": True,
            "branch_isolation": True,
        })

    if action == "inspect":
        return mock_reply(request, {
            "read_only": True,
            "secret_free": True,
            "scope": request["context"],
            "panes": {
                "truth": {"payload_ref": "demo:truth", "owner": owner_domain},
                "record": {"payload_ref": "demo:record", "owner": owner_domain},
                "knowledge": {"payload_ref": "demo:knowledge-view", "owner": owner_domain},
                "belief": {"payload_ref": "demo:belief", "owner": owner_domain},
                "memory": {"payload_ref": "demo:memory", "owner": owner_domain},
                "derived": {"payload_ref": "demo:derived", "owner": owner_domain},
            },
        })

    if action == "trace":
        return mock_reply(request, {
            "read_only": True,
            "secret_free": True,
            "trace_ref": "demo:trace",
            "source_cut": request["context"]["cut_ref"],
            "details_available": False,
            "details": None,
            "randomness_consumed": False,
            "canonical_time_advanced": False,
        })

    if action == "evaluate_watcher":
        return mock_reply(request, {
            "read_only": True,
            "secret_free": True,
            "value": "unknown",
            "dependency_event_refs": [],
            "proposed_reviews": [],
            "effects_applied": False,
        })

    if action in {"apply_patch", "publish", "apply_fixture", "context_override"}:
        key = request["idempotency_key"]
        data = {
            "acknowledged": True,
            "conditional_write_honored": True,
            "idempotency_honored": True,
            "invariants_preserved": True,
            "history_preserved": True,
            "effect_scope": request["context"],
            "canonical_effect": False,
            "owner_event_refs": [f"mock:event:{owner_domain}:{key}"],
            "before_revisions": {
                "demo:entity": "demo:r1", "demo:dependency": "demo:r1",
            },
            "after_revisions": {
                "demo:entity": "demo:r1", "demo:dependency": "demo:r1",
            },
        }
        if action == "publish":
            data.update({
                "published_version": f"mock:version:{key}",
                "existing_instances_changed": False,
                "historical_versions_retained": True,
            })
        if payload.get("kind") == "npc_create":
            data["created_entity_id"] = f"mock:entity:{key}"
        return mock_reply(request, data)

    raise ControlError("UNSUPPORTED_OWNER_CONTRACT")


def request_system_9(request: Object) -> Object:
    return mock_owner(request, "system_9")


def request_system_10(request: Object) -> Object:
    return mock_owner(request, "system_10")


def request_system_11(request: Object) -> Object:
    if request["action"] in {"advance", "pause", "resume", "scripted_input"}:
        return mock_reply(request, {
            "acknowledged": True,
            "conditional_write_honored": True,
            "idempotency_honored": True,
            "invariants_preserved": True,
            "history_preserved": True,
            "effect_scope": request["context"],
            "canonical_effect": False,
            "owner_event_refs": [],
            "progress_cursor": "demo:scheduler-cursor",
            "before_after_cuts": [
                request["context"]["cut_ref"], request["context"]["cut_ref"],
            ],
            "processed_owner_events": [],
            "paused_choices": (
                ["demo:choice"] if request["action"] == "advance" else []
            ),
            "deferred_tasks": [],
            "errors": [],
            "chronological_processing": True,
            "stop_policy_honored": True,
        })
    return mock_owner(request, "system_11")


def request_system_12(request: Object) -> Object:
    return mock_owner(request, "system_12")


def request_system_13(request: Object) -> Object:
    return mock_owner(request, "system_13")


def request_system_14(request: Object) -> Object:
    return mock_owner(request, "system_14")


def request_system_15(request: Object) -> Object:
    return mock_owner(request, "system_15")


def request_system_17(request: Object) -> Object:
    return mock_owner(request, "system_17")


def request_relationships(request: Object) -> Object:
    return mock_owner(request, "relationships")


def request_consent(request: Object) -> Object:
    return mock_owner(request, "consent")


def request_knowledge(request: Object) -> Object:
    return mock_owner(request, "knowledge")


def request_memory(request: Object) -> Object:
    return mock_owner(request, "memory")


def request_health(request: Object) -> Object:
    return mock_owner(request, "health")


def request_system_20(request: Object) -> Object:
    return mock_owner(request, "system_20")


def request_system_21(request: Object) -> Object:
    return mock_owner(request, "system_21")


def request_system_22(request: Object) -> Object:
    return mock_owner(request, "system_22")


def request_system_23(request: Object) -> Object:
    return mock_owner(request, "system_23")


def request_system_24(request: Object) -> Object:
    return mock_owner(request, "system_24")


def request_system_25(request: Object) -> Object:
    action = request["action"]
    payload = request["payload"]

    if action in {"verify_checkpoint", "verify_evidence"}:
        reference = payload.get("checkpoint_ref", payload.get("evidence_ref"))
        return mock_reply(request, {
            "verified": reference in {"demo:checkpoint", "demo:evidence"},
            "source_cut": "demo:cut:0",
            "ancestry_preserved": True,
            "pending_work_preserved": True,
            "knowledge_at_cut_preserved": True,
            "future_facts_excluded": True,
        })

    if action in {"fork", "restore"}:
        return mock_reply(request, {
            "acknowledged": True,
            "conditional_write_honored": True,
            "idempotency_honored": True,
            "invariants_preserved": True,
            "history_preserved": True,
            "effect_scope": request["context"],
            "canonical_effect": False,
            "owner_event_refs": [],
            "sandbox_timeline": f"demo:test:{request['idempotency_key']}",
            "source_cut": "demo:cut:0",
            "isolated": True,
            "original_future_retained": True,
            "immutable_prefix_unchanged": True,
            "fixture_provenance_retained": True,
        })

    if action == "ensure_anchor":
        return mock_reply(request, {
            "verified": payload.get("anchor_ref") == "demo:checkpoint",
            "anchor_ref": "demo:checkpoint",
            "source_cut": "demo:cut:0",
        })

    if action == "assertions":
        return mock_reply(request, {
            "assertions": [
                {
                    "assertion_ref": ref,
                    "status": "not_executed",
                    "evidence_refs": [],
                    "reason": "External assertion engine is a placeholder.",
                }
                for ref in payload["assertion_refs"]
            ],
            "trace_refs": [],
            "source_cut": request["context"]["cut_ref"],
        })

    if action == "stage_import":
        known = payload.get("package_ref") == "demo:package"
        return mock_reply(request, {
            "valid": known,
            "staged_candidate_ref": "demo:candidate" if known else None,
            "checks": {
                name: known for name in (
                    "schema", "content", "privacy", "safe_paths",
                    "no_executable_code", "required_data", "provenance_retained",
                )
            },
            "activated": False,
        })

    if action == "export":
        return mock_reply(request, {
            "payload_ref": "demo:export",
            "secret_free": True,
            "redaction_applied": True,
            "published": False,
            "restorable": False,
            "scope": request["context"],
            "panes": payload["panes"],
            "fixture_provenance_retained": True,
        })

    return mock_owner(request, "system_25")


def request_system_26(request: Object) -> Object:
    if request["action"] == "preview":
        return mock_reply(request, {
            "actor_ref": request["context"]["actor_or_subject_ref"],
            "timeline_id": request["context"]["timeline_id"],
            "cut_ref": request["context"]["cut_ref"],
            "policy_version": request["context"]["policy_version"],
            "filtered": True,
            "read_only": True,
            "secret_free": True,
            "projection": {
                "description": "Dummy actor-entitled projection.",
                "known_entity_refs": [],
            },
        })
    return mock_owner(request, "system_26")


def request_ai_context(request: Object) -> Object:
    if request["action"] == "context":
        return mock_reply(request, {
            "read_only": True,
            "secret_free": True,
            "redaction_applied": True,
            "actual_task_artifacts_only": True,
            "task_ref": request["payload"]["task_ref"],
            "source_cut": request["context"]["cut_ref"],
            "payload_ref": "demo:redacted-context",
            "details_available": False,
            "hidden_reasoning_available": False,
            "provider_usage": None,
        })
    return mock_owner(request, "ai_context")


def request_creator_test_author(request: Object) -> Object:
    action = request["action"]
    payload = request["payload"]
    if action == "validate_scenario":
        known = (
            all(ref in {"demo:fixture", "demo:fault-fixture"} for ref in payload["fixture_refs"])
            and all(ref == "demo:assertion" for ref in payload["assertion_refs"])
        )
        return mock_reply(request, {
            "valid": known,
            "typed_fixtures": known,
            "synthetic_inputs_only": True,
            "supported_test_seams": known,
        })
    if action == "describe_fixture":
        ref = payload["fixture_ref"]
        return mock_reply(request, {
            "valid": ref in {"demo:fixture", "demo:fault-fixture"},
            "fixture_ref": ref,
            "owner_domain": "system_15",
            "invalid_fault_fixture": ref == "demo:fault-fixture",
            "provenance": "test fixture",
        })
    raise ControlError("UNSUPPORTED_AUTHOR_CONTRACT")


ADAPTERS: dict[str, Callable[[Object], Object]] = {
    "authorization": request_authorization,
    "system_9": request_system_9,
    "system_10": request_system_10,
    "system_11": request_system_11,
    "system_12": request_system_12,
    "system_13": request_system_13,
    "system_14": request_system_14,
    "system_15": request_system_15,
    "system_17": request_system_17,
    "relationships": request_relationships,
    "consent": request_consent,
    "knowledge": request_knowledge,
    "memory": request_memory,
    "health": request_health,
    "system_20": request_system_20,
    "system_21": request_system_21,
    "system_22": request_system_22,
    "system_23": request_system_23,
    "system_24": request_system_24,
    "system_25": request_system_25,
    "system_26": request_system_26,
    "ai_context": request_ai_context,
    "creator_test_author": request_creator_test_author,
}


def external(service: str, request: Object) -> Object:
    require(service in ADAPTERS, "UNKNOWN_DEPENDENCY")
    try:
        response = ADAPTERS[service](copy.deepcopy(request))
    except ControlError:
        raise
    except Exception:
        raise ControlError("DEPENDENCY_UNAVAILABLE") from None
    assert_json(response)
    require(isinstance(response, dict), "INVALID_DEPENDENCY_RESULT")
    require(response.get("mock") is True, "NON_MOCK_ADAPTER_FORBIDDEN")
    require(response.get("request_binding") == digest(request), "UNBOUND_DEPENDENCY_RESULT")
    require(isinstance(response.get("data"), dict), "INVALID_DEPENDENCY_RESULT")
    return response["data"]


COMMAND_CLASSES = {
    "OpenContext": "context",
    "SwitchContext": "context",
    "LeavePrivilegedMode": "context",
    "CreateDraft": "author",
    "EditDraft": "author",
    "ValidateDraft": "author",
    "PublishVersion": "author",
    "StageGeneration": "author",
    "PreviewImpact": "migrate",
    "ReviewPlan": "migrate",
    "ApplyReviewedPlan": "migrate",
    "CancelOperation": "administration",
    "GetOperation": "inspect",
    "InspectTruth": "inspect",
    "InspectTrace": "inspect",
    "InspectContext": "inspect",
    "InspectWatcher": "inspect",
    "PreviewPlayerView": "preview",
    "CreateScenario": "test",
    "RunScenario": "test",
    "AdvanceTestTime": "test",
    "PauseTestTime": "test",
    "ResumeTestTime": "test",
    "StageContextOverride": "test",
    "DiagnoseState": "repair",
    "ApplyRepair": "repair",
    "RecoverAnchor": "repair",
    "StageImport": "author",
    "Export": "export",
}

READ_COMMANDS = {
    "InspectTruth", "InspectTrace", "InspectContext", "InspectWatcher",
    "PreviewPlayerView", "GetOperation",
}

CONTEXT_COMMANDS = {"OpenContext", "SwitchContext", "LeavePrivilegedMode"}

WORKSPACES = {"authoring", "inspector", "test", "repair", "player_preview"}

DIAGNOSES = {
    "rebuildable_cache", "owner_projection_reconstruction",
    "exact_record_correction", "linked_migration", "unrecoverable_canonical_gap",
}


class ControlPlane:
    """Infrastructure and behavior; all game-control state is System27State."""

    def __init__(self, path: str = ":memory:", *, server_session: str = "creator"):
        self._server_session = server_session
        self._db = sqlite3.connect(path, isolation_level=None)
        self._db.execute("PRAGMA busy_timeout = 5000")
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.execute("PRAGMA synchronous = FULL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS control_snapshot "
            "(singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL)"
        )
        state = System27State()
        state.put("policy_manifest", POLICY_VERSION, {
            "version": POLICY_VERSION,
            "capability_scope": "backend-verified; every request and stage",
            "field_ownership": sorted(OWNER_DOMAINS),
            "allowed_patch_classes": sorted(PATCH_CLASSES),
            "test_seams": "explicit isolated owner fixtures",
            "knowledge_correction_rules": "separate source-proven operation",
            "trace_retention": "retain provenance and source references",
            "export_redaction": "owner-attested secret-free artifact references",
            "live_boundary_handling": "conditional owner commands at coherent boundary",
        })
        self._db.execute(
            "INSERT OR IGNORE INTO control_snapshot VALUES (1, ?)",
            (canonical(state.dump()),),
        )

    def close(self) -> None:
        self._db.close()

    def state_machine(self, request: CommandRequest) -> CommandResponse:
        """Process one typed JSON command and durably retain partial outcomes."""
        try:
            assert_json(request)
            require(len(canonical(request).encode("utf-8")) <= MAX_REQUEST_BYTES,
                    "REQUEST_TOO_LARGE")
            exact(request, set(CommandRequest.__annotations__))
            require(request["command"] in COMMAND_CLASSES, "UNKNOWN_COMMAND")
            for name in (
                "request_id", "context_id", "campaign_id", "timeline_id", "cut_ref",
                "actor_or_subject_ref", "policy_version",
            ):
                text(request[name])
            require(request["read_write_scope"] in {"read", "write"}, "INVALID_SCOPE")
            require(isinstance(request["payload"], dict), "INVALID_PAYLOAD")
            require(request["policy_version"] == POLICY_VERSION, "UNSUPPORTED_VERSION")
        except (ControlError, TypeError, ValueError, RecursionError):
            return result("rejected", {"code": "INVALID_REQUEST"}, ok=False)

        try:
            self._db.execute("BEGIN IMMEDIATE")
            row = self._db.execute(
                "SELECT payload FROM control_snapshot WHERE singleton=1"
            ).fetchone()
            state = System27State.load(json.loads(row[0]))
            try:
                auth = self._authorize(request)
                if request["command"] != "OpenContext":
                    self._check_context(state, request, auth)
                response = self._dispatch(state, request, auth)
                # Recheck before releasing any privileged result.
                self._authorize(request)
            except ControlError as error:
                response = result("rejected", {"code": error.code}, ok=False)

            self._db.execute(
                "UPDATE control_snapshot SET payload=? WHERE singleton=1",
                (canonical(state.dump()),),
            )
            self._db.execute("COMMIT")
            return response
        except Exception:
            if self._db.in_transaction:
                self._db.execute("ROLLBACK")
            return result("unavailable", {"code": "CONTROL_STORAGE_UNAVAILABLE"}, ok=False)

    def _authorize(self, request: Object, operation_class: str | None = None) -> Object:
        for key in ("context_id", "campaign_id", "timeline_id", "cut_ref",
                    "actor_or_subject_ref", "policy_version"):
            text(request[key])
        require(request["read_write_scope"] in {"read", "write"}, "INVALID_SCOPE")
        auth = external("authorization", {
            "server_session": self._server_session,
            "operation_class": operation_class or COMMAND_CLASSES[request["command"]],
            "scope": scope_of(request),
        })
        require(auth.get("verified") is True, "ACCESS_DENIED")
        contract = auth["capability_contract"]
        revocation = contract["expiry_revocation"]
        require(revocation.get("revoked") is False, "ACCESS_DENIED")
        require(revocation.get("expired") is False, "ACCESS_DENIED")
        permission = operation_class or COMMAND_CLASSES[request["command"]]
        require(permission in contract["permitted_operation_classes"], "ACCESS_DENIED")
        target = contract["campaign_timeline_scope"]
        require(request["campaign_id"] == target["campaign_id"], "ACCESS_DENIED")
        require(request["actor_or_subject_ref"] in target["actor_refs"], "ACCESS_DENIED")
        timeline = request["timeline_id"]
        require(
            timeline == target["source_timeline"]
            or timeline.startswith(target["test_timeline_prefix"]),
            "ACCESS_DENIED",
        )
        return auth

    def _check_context(self, state: System27State, request: Object, auth: Object) -> None:
        context = state.get("creator_context", request["context_id"])
        workspace = state.get("workspace_context", request["context_id"])
        require(context["principal_ref"] == auth["principal_ref"], "ACCESS_DENIED")
        for key in ("campaign_id", "timeline_id", "cut_ref", "fence"):
            require(context[key] == request[key], "STALE_CONTEXT")
        require(
            workspace["actor_or_subject_ref"] == request["actor_or_subject_ref"],
            "SUBJECT_MISMATCH",
        )
        if workspace["workspace"] == "player_preview":
            require(request["command"] in CONTEXT_COMMANDS | {"PreviewPlayerView"},
                    "PRIVILEGED_CONTEXT_REQUIRED")
        if request["command"] not in READ_COMMANDS | CONTEXT_COMMANDS:
            require(request["read_write_scope"] == "write", "READ_ONLY_SCOPE")
            require(workspace["read_write_scope"] == "write", "READ_ONLY_SCOPE")
            require(workspace["workspace"] != "player_preview", "READ_ONLY_PREVIEW")

    def _call(
        self, request: Object, service: str, action: str, payload: Object,
        *, key: str | None = None, target_scope: Object | None = None,
    ) -> Object:
        self._authorize(request)
        target = copy.deepcopy(target_scope or scope_of(request))
        if target["timeline_id"] != request["timeline_id"]:
            child_request = dict(request, **target)
            self._authorize(child_request, "test")
        return external(service, {
            "action": action,
            "context": target,
            "payload": copy.deepcopy(payload),
            "idempotency_key": key,
        })

    def _lineage(
        self, state: System27State, key: str, request: Object,
        provenance: str, *, version: str = "1", parents: list[str] | None = None,
        extra_scope: Object | None = None,
    ) -> None:
        state.put("version_and_lineage", key, {
            "version": version,
            "source_cut": request["cut_ref"],
            "source_lineage": parents or [],
            "applicability": {**scope_of(request), **(extra_scope or {})},
            "provenance": provenance,
        })

    def _bound(self, state: System27State, key: str, request: Object) -> Object:
        lineage = state.get("version_and_lineage", key)
        stored = lineage["applicability"]
        for name in (
            "context_id", "campaign_id", "timeline_id", "cut_ref", "fence",
            "actor_or_subject_ref", "policy_version",
        ):
            require(stored[name] == request[name], "STALE_OR_CROSS_SCOPE_RECORD")
        return lineage

    def _new(self, state: System27State, table: str, key: str, record: Object) -> None:
        require(key not in getattr(state, table), "IDENTIFIER_ALREADY_EXISTS")
        state.put(table, key, record)

    def _validate_owner(self, response: Object) -> None:
        require(response.get("valid") is True, "OWNER_VALIDATION_FAILED")
        checks = response.get("checks", {})
        require(all(checks.get(name) is True for name in VALIDATION_CHECKS),
                "OWNER_INVARIANT_NOT_ESTABLISHED")
        require(response.get("unresolved") == [], "UNRESOLVED_OWNER_VALIDATION")

    def _operation(
        self, state: System27State, request: Object, auth: Object,
        plan_ref: str, kind: str, reason: str, steps: list[Object],
    ) -> tuple[Object, Object]:
        text(reason)
        identity = {
            "principal": auth["principal_ref"],
            "campaign": request["campaign_id"],
            "timeline": request["timeline_id"],
            "request_id": request["request_id"],
        }
        operation_id = "op:" + digest(identity)
        intent = {
            "command": request["command"],
            "payload": request["payload"],
            "scope": scope_of(request),
        }
        existing = state.control_operation.get(operation_id)
        if existing is not None:
            audit = state.get("operation_audit", operation_id)
            require(audit["intent"] == intent, "IDEMPOTENCY_KEY_REUSED")
            require(existing["plan_ref"] == plan_ref, "IDEMPOTENCY_KEY_REUSED")
            return existing, audit

        if kind in PATCH_CLASSES | {"publish_version"}:
            require(not any(
                other["plan_ref"] == plan_ref
                and other["kind"] == kind
                and state.operation_audit[other_id]["target_scope"]["campaign_id"]
                == request["campaign_id"]
                and state.operation_audit[other_id]["target_scope"]["timeline_id"]
                == request["timeline_id"]
                and state.operation_audit[other_id]["outcome"].get("application_started") is True
                for other_id, other in state.control_operation.items()
            ), "RESUME_OR_RECOVER_ORIGINAL_OPERATION")

        state.put("control_operation", operation_id, {
            "id": operation_id,
            "plan_ref": plan_ref,
            "reason": reason,
            "kind": kind,
            "started_at": utc_now(),
            "completed_stages": [],
            "owner_event_refs": [],
            "status": "pending",
        })
        state.put("operation_audit", operation_id, {
            "actor": auth["principal_ref"],
            "intent": intent,
            "capability_context": request["context_id"],
            "target_scope": scope_of(request),
            "before_after_revisions": {"before": {}, "after": {}},
            "idempotency_key": operation_id,
            "pending_stages": copy.deepcopy(steps),
            "outcome": {},
        })
        return state.control_operation[operation_id], state.operation_audit[operation_id]

    def _stage(
        self, state: System27State, request: Object, operation: Object, audit: Object,
        name: str, service: str, action: str, payload: Object,
        *, target_scope: Object | None = None, mutation: bool = True,
    ) -> Object:
        require(operation["status"] != "cancelled", "OPERATION_CANCELLED")
        for completed in operation["completed_stages"]:
            if completed["stage"] == name:
                require(
                    completed["request_fingerprint"]
                    == digest([service, action, payload, target_scope]),
                    "STAGE_CHANGED",
                )
                return copy.deepcopy(completed["result"])

        self._check_context(state, request, self._authorize(request))
        if mutation:
            # Retain the claim even when an acknowledgement is lost. Retrying with
            # a different key could duplicate an external effect.
            audit["outcome"]["application_started"] = True
        receipt = self._call(
            request, service, action, payload,
            key=f"{operation['id']}:{name}", target_scope=target_scope,
        )
        if mutation:
            for guard in (
                "acknowledged", "conditional_write_honored", "idempotency_honored",
                "invariants_preserved", "history_preserved",
            ):
                require(receipt.get(guard) is True, "OWNER_ACKNOWLEDGEMENT_INCOMPLETE")
            require(
                receipt.get("effect_scope") == (target_scope or scope_of(request)),
                "OWNER_SCOPE_MISMATCH",
            )
            require(receipt.get("canonical_effect") is False, "REAL_EFFECT_FORBIDDEN")
        operation["completed_stages"].append({
            "stage": name,
            "request_fingerprint": digest([service, action, payload, target_scope]),
            "result": copy.deepcopy(receipt),
        })
        for event_ref in receipt.get("owner_event_refs", []):
            if event_ref not in operation["owner_event_refs"]:
                operation["owner_event_refs"].append(event_ref)
        audit["pending_stages"] = [
            step for step in audit["pending_stages"] if step["stage"] != name
        ]
        if "after_revisions" in receipt:
            audit["before_after_revisions"]["after"].update(receipt["after_revisions"])
        operation["status"] = "partial"
        return receipt

    def _finish(self, operation: Object, audit: Object, data: Object) -> CommandResponse:
        require(not audit["pending_stages"], "INCOMPLETE_WORKFLOW")
        operation["status"] = "completed"
        audit["outcome"] = copy.deepcopy(data)
        return result("completed", {"operation_id": operation["id"], **data})

    def _partial(self, operation: Object, audit: Object, error: ControlError) -> CommandResponse:
        if operation["status"] == "cancelled":
            return result("cancelled", {
                "operation_id": operation["id"], "code": "OPERATION_CANCELLED",
                "completed_stages": [s["stage"] for s in operation["completed_stages"]],
            }, ok=False)
        operation["status"] = "partial" if operation["completed_stages"] else "pending"
        audit["outcome"] = {**audit["outcome"], "code": error.code}
        return result(operation["status"], {
            "operation_id": operation["id"],
            "code": error.code,
            "completed_stages": [s["stage"] for s in operation["completed_stages"]],
            "pending_stages": copy.deepcopy(audit["pending_stages"]),
        }, ok=False)

    def _dispatch(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        command = r["command"]
        if command in CONTEXT_COMMANDS:
            return self._context(state, r, auth)
        if command in {"CreateDraft", "EditDraft", "ValidateDraft", "PublishVersion"}:
            return self._draft(state, r, auth)
        if command == "StageGeneration":
            return self._generation(state, r)
        if command in {"PreviewImpact", "ReviewPlan", "ApplyReviewedPlan", "ApplyRepair"}:
            return self._plan(state, r, auth)
        if command in READ_COMMANDS:
            return self._inspect(state, r)
        if command == "CancelOperation":
            return self._cancel(state, r, auth)
        if command in {"CreateScenario", "RunScenario"}:
            return self._scenario(state, r, auth)
        if command in {"AdvanceTestTime", "PauseTestTime", "ResumeTestTime",
                       "StageContextOverride"}:
            return self._test_action(state, r, auth)
        if command == "DiagnoseState":
            return self._diagnose(state, r)
        if command == "RecoverAnchor":
            return self._recover(state, r, auth)
        if command in {"StageImport", "Export"}:
            return self._package(state, r)
        raise ControlError("UNKNOWN_COMMAND")

    def _context(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        p = r["payload"]
        if r["command"] == "LeavePrivilegedMode":
            exact(p, set())
            context = state.get("creator_context", r["context_id"])
            workspace = state.get("workspace_context", r["context_id"])
            context["fence"] = digest([context["fence"], r["request_id"], "leave"])
            workspace["workspace"] = "player_preview"
            workspace["read_write_scope"] = "read"
            for plan in state.impact_plan.values():
                if plan["context_ref"] == r["context_id"] and plan["status"] in {
                    "previewed", "reviewed"
                }:
                    plan["status"] = "stale"
            return result("player_preview", {
                "fence": context["fence"],
                "clear_privileged_stores": True,
                "cancel_or_fence_pending_requests": True,
                "rebuild_filtered_projection": True,
            })

        exact(p, {"workspace"}, {"new_context_id", "target"})
        workspace_name = p["workspace"]
        require(workspace_name in WORKSPACES, "INVALID_WORKSPACE")
        if "inspect" not in auth["capability_contract"]["permitted_operation_classes"]:
            require(workspace_name == "player_preview", "ACCESS_DENIED")
            require(r["read_write_scope"] == "read", "ACCESS_DENIED")

        target_request = copy.deepcopy(r)
        if r["command"] == "SwitchContext":
            require("new_context_id" in p and "target" in p, "MISSING_TARGET")
            exact(p["target"], {
                "campaign_id", "timeline_id", "cut_ref",
                "actor_or_subject_ref", "read_write_scope",
            })
            target_request.update(p["target"])
            target_request["context_id"] = text(p["new_context_id"])
            target_request["fence"] = None
            self._authorize(target_request)
        else:
            require(set(p) == {"workspace"}, "UNSUPPORTED_FIELD")
            require(r["fence"] is None, "INVALID_INITIAL_FENCE")

        timeline = target_request["timeline_id"]
        if timeline != "demo:source":
            require(any(
                run["sandbox_timeline"] == timeline
                for run in state.test_run.values()
            ), "UNKNOWN_TEST_TIMELINE")
        require(target_request["cut_ref"] == "demo:cut:0", "UNVERIFIED_CUT")
        context_id = target_request["context_id"]
        fence = digest([
            auth["principal_ref"], context_id, scope_of(target_request),
            r["request_id"], "context",
        ])
        record = {
            "id": context_id,
            "principal_ref": auth["principal_ref"],
            "capability_refs": auth["capability_refs"],
            "campaign_id": target_request["campaign_id"],
            "timeline_id": timeline,
            "cut_ref": target_request["cut_ref"],
            "fence": fence,
        }
        existing = state.creator_context.get(context_id)
        if existing is not None:
            require(existing == record, "CONTEXT_ALREADY_EXISTS")
            return result("opened", {"context_id": context_id, "fence": fence})

        self._new(state, "creator_context", context_id, record)
        state.put("workspace_context", context_id, {
            "workspace": workspace_name,
            "actor_or_subject_ref": target_request["actor_or_subject_ref"],
            "read_write_scope": target_request["read_write_scope"],
            "selected_campaign": target_request["campaign_id"],
            "selected_timeline": timeline,
            "selected_cut": target_request["cut_ref"],
        })
        state.put("capability_contract", context_id, auth["capability_contract"])

        if r["command"] == "SwitchContext":
            old = state.get("creator_context", r["context_id"])
            old["fence"] = digest([old["fence"], r["request_id"], "switched"])
            for plan in state.impact_plan.values():
                if plan["context_ref"] == r["context_id"] and plan["status"] in {
                    "previewed", "reviewed"
                }:
                    plan["status"] = "stale"
        return result("opened", {
            "context_id": context_id,
            "fence": fence,
            "clear_privileged_stores": r["command"] == "SwitchContext",
        })

    def _draft(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        p, command = r["payload"], r["command"]
        if command == "CreateDraft":
            exact(p, {"id", "owner_domain", "source_version", "candidate_ref"})
            require(p["owner_domain"] in OWNER_DOMAINS, "UNKNOWN_OWNER")
            for name in ("id", "source_version", "candidate_ref"):
                text(p[name])
            self._new(state, "content_draft", p["id"], {
                **p, "validation_ref": None, "status": "draft",
            })
            self._lineage(state, "draft:" + p["id"], r, "authored setup",
                          version=p["source_version"])
            return result("draft", {"draft_id": p["id"]})

        required = {"draft_id"}
        if command == "EditDraft":
            required.add("candidate_ref")
        if command == "PublishVersion":
            required.add("reason")
        exact(p, required)
        draft = state.get("content_draft", p["draft_id"])
        self._bound(state, "draft:" + draft["id"], r)

        if command == "EditDraft":
            require(draft["status"] != "published", "PUBLISHED_VERSION_IMMUTABLE")
            draft["candidate_ref"] = text(p["candidate_ref"])
            draft["validation_ref"] = None
            draft["status"] = "draft"
            return result("draft", {"draft_id": draft["id"]})

        if command == "ValidateDraft":
            require(draft["status"] != "published", "PUBLISHED_VERSION_IMMUTABLE")
            validation = self._call(r, draft["owner_domain"], "validate_candidate", {
                "candidate_ref": draft["candidate_ref"],
                "source_version": draft["source_version"],
            })
            try:
                self._validate_owner(validation)
            except ControlError:
                draft["status"] = "invalid"
                draft["validation_ref"] = validation.get("validation_ref")
                raise
            draft["validation_ref"] = validation["validation_ref"]
            draft["status"] = "validated"
            return result("validated", {
                "draft_id": draft["id"], "validation_ref": draft["validation_ref"],
            })

        operation, audit = self._operation(
            state, r, auth, draft["id"], "publish_version", p["reason"],
            [{"stage": "publish"}],
        )
        if operation["status"] == "completed":
            return result("completed", {"operation_id": operation["id"], **audit["outcome"]})
        try:
            require(draft["status"] == "validated", "DRAFT_NOT_VALIDATED")
            validation = self._call(r, draft["owner_domain"], "validate_candidate", {
                "candidate_ref": draft["candidate_ref"],
                "source_version": draft["source_version"],
            })
            self._validate_owner(validation)
            receipt = self._stage(
                state, r, operation, audit, "publish", draft["owner_domain"], "publish",
                {
                    "candidate_ref": draft["candidate_ref"],
                    "source_version": draft["source_version"],
                    "validation_ref": validation["validation_ref"],
                    "apply_to_existing_instances": False,
                    "retain_historical_versions": True,
                },
            )
            require(receipt.get("existing_instances_changed") is False,
                    "IMPLICIT_INSTANCE_MIGRATION")
            require(receipt.get("historical_versions_retained") is True,
                    "HISTORY_NOT_RETAINED")
            draft["status"] = "published"
            self._lineage(
                state, "published:" + receipt["published_version"], r, "authored setup",
                version=receipt["published_version"], parents=[draft["source_version"]],
            )
            return self._finish(operation, audit, {
                "published_version": receipt["published_version"],
                "existing_instances_changed": False,
            })
        except ControlError as error:
            return self._partial(operation, audit, error)

    def _generation(self, state: System27State, r: Object) -> CommandResponse:
        p = r["payload"]
        exact(p, {"task_id", "constraint_snapshot", "accepted_output", "creation_key"})
        for value in p.values():
            text(value)
        validation = self._call(r, "system_9", "validate_candidate", {
            "candidate_ref": p["accepted_output"], "constraint_snapshot": p["constraint_snapshot"],
        })
        self._validate_owner(validation)
        existing = state.generation_task.get(p["task_id"])
        if existing is not None:
            require(all(existing[k] == v for k, v in p.items()), "GENERATION_TASK_REUSED")
            self._bound(state, "generation:" + p["task_id"], r)
            return result("staged", copy.deepcopy(existing))
        require(not any(
            task["creation_key"] == p["creation_key"]
            for task in state.generation_task.values()
        ), "CREATION_KEY_REUSED")
        state.put("generation_task", p["task_id"], {**p, "created_entity_id": None})
        self._lineage(state, "generation:" + p["task_id"], r, "authored setup")
        return result("staged", copy.deepcopy(state.generation_task[p["task_id"]]))

    def _plan_digest(self, state: System27State, plan_id: str) -> str:
        plan = copy.deepcopy(state.get("impact_plan", plan_id))
        plan.pop("status")
        return digest({
            "plan": plan,
            "details": state.get("impact_details", plan_id),
            "lineage": state.get("version_and_lineage", "plan:" + plan_id),
            "knowledge": state.knowledge_correction.get(plan_id),
        })

    def _plan(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        p, command = r["payload"], r["command"]
        if command == "PreviewImpact":
            return self._preview_plan(state, r)

        if command == "ReviewPlan":
            exact(p, {"plan_id", "preview_digest", "reason"})
            plan = state.get("impact_plan", p["plan_id"])
            self._bound(state, "plan:" + plan["id"], r)
            require(plan["status"] in {"previewed", "reviewed"}, "PLAN_NOT_REVIEWABLE")
            require(p["preview_digest"] == self._plan_digest(state, plan["id"]),
                    "REVIEW_DIGEST_MISMATCH")
            operation, audit = self._operation(
                state, r, auth, plan["id"], "review_plan", p["reason"], [],
            )
            plan["status"] = "reviewed"
            return self._finish(operation, audit, {
                "plan_id": plan["id"], "preview_digest": p["preview_digest"],
            })

        exact(p, {"plan_id", "reason"}, {"repair_case_id"})
        plan = state.get("impact_plan", p["plan_id"])
        lineage = self._bound(state, "plan:" + plan["id"], r)
        kind = lineage["applicability"]["operation_class"]
        if command == "ApplyRepair":
            require(kind == "repair", "NOT_A_REPAIR_PLAN")
            require("repair_case_id" in p, "MISSING_REPAIR_CASE")
            case = state.get("repair_case", p["repair_case_id"])
            self._bound(state, "repair:" + p["repair_case_id"], r)
            require(case["approved_plan"] == plan["id"], "REPAIR_PLAN_MISMATCH")
            require(case["validation_results"].get("verified_restoration") is True,
                    "RESTORATION_NOT_ESTABLISHED")
        else:
            require(kind != "repair", "USE_APPLY_REPAIR")
            require("repair_case_id" not in p, "UNSUPPORTED_FIELD")

        details = state.get("impact_details", plan["id"])
        stages = [
            {"stage": f"patch:{i}"}
            for i in range(len(details["application_steps"]))
        ] + [{"stage": "post_validate"}]
        operation, audit = self._operation(
            state, r, auth, plan["id"], kind, p["reason"], stages,
        )
        if operation["status"] == "completed":
            return result("completed", {"operation_id": operation["id"], **audit["outcome"]})
        try:
            require(plan["status"] in {"reviewed", "applying"}, "PLAN_NOT_REVIEWED")
            current_digest = self._plan_digest(state, plan["id"])
            require(any(
                op["kind"] == "review_plan"
                and op["plan_ref"] == plan["id"]
                and op["status"] == "completed"
                and state.operation_audit[op_id]["outcome"].get("preview_digest")
                == current_digest
                for op_id, op in state.control_operation.items()
            ), "REVIEW_REQUIRED")
            self._authorize(r, "repair" if kind == "repair" else "migrate")

            if not audit["before_after_revisions"]["before"]:
                audit["before_after_revisions"] = {
                    "before": copy.deepcopy(plan["expected_revisions"]),
                    "after": copy.deepcopy(plan["expected_revisions"]),
                }
            expected = audit["before_after_revisions"]["after"]
            owners = sorted({
                step["owner_domain"] for step in details["application_steps"]
            })
            for owner in owners:
                snapshot = self._call(r, owner, "check_revisions", {
                    "expected_revisions": expected,
                    "dependencies_ref": plan["dependencies_ref"],
                })
                require(snapshot.get("head_valid") is True, "STALE_PLAN")
                require(all(snapshot["revisions"].get(k) == v for k, v in expected.items()),
                        "STALE_PLAN")
                prepared = self._call(r, owner, "prepare", {
                    "plan_id": plan["id"], "expected_revisions": expected,
                    "approval_refs": details["owner_approvals"],
                    "requires_paused_simulation": details["requires_paused_simulation"],
                })
                require(
                    prepared.get("approved") is True
                    and prepared.get("coherent_boundary") is True
                    and prepared.get("reservations_valid") is True,
                    "OWNER_NOT_READY",
                )
            anchor = self._call(r, "system_25", "ensure_anchor", {
                "anchor_ref": plan["recovery_anchor"],
                "expected_revisions": expected,
            })
            require(anchor.get("verified") is True, "RECOVERY_ANCHOR_UNVERIFIED")
            require(anchor.get("source_cut") == r["cut_ref"], "RECOVERY_CUT_MISMATCH")
            plan["status"] = "applying"

            for index, step in enumerate(details["application_steps"]):
                payload = {
                    **step,
                    "expected_revisions": copy.deepcopy(
                        plan["expected_revisions"] if index == 0 else
                        self._preceding_revisions(operation, index, plan["expected_revisions"])
                    ),
                    "knowledge_policy": plan["knowledge_policy"],
                    "knowledge_correction": state.knowledge_correction.get(plan["id"]),
                    "owner_approval_refs": details["owner_approvals"],
                    "recovery_anchor": plan["recovery_anchor"],
                    "preserve_history": True,
                    "administrative_not_in_world_action": True,
                }
                generation_id = lineage["applicability"].get("generation_task_id")
                if kind == "npc_create":
                    task = state.get("generation_task", generation_id)
                    # Two independently reviewed plans must not create two entities
                    # for the same accepted generation task.
                    already_completed = any(
                        item["stage"] == f"patch:{index}"
                        for item in operation["completed_stages"]
                    )
                    require(task["created_entity_id"] is None or already_completed,
                            "ENTITY_ALREADY_CREATED")
                    payload["generation_task"] = copy.deepcopy(task)
                    payload["generation_task"]["created_entity_id"] = None
                    self._bound(state, "generation:" + generation_id, r)
                receipt = self._stage(
                    state, r, operation, audit, f"patch:{index}",
                    step["owner_domain"], "apply_patch", payload,
                )
                if kind == "npc_create":
                    entity_id = text(receipt.get("created_entity_id"))
                    task = state.get("generation_task", generation_id)
                    require(task["created_entity_id"] in {None, entity_id},
                            "CREATION_IDENTITY_CHANGED")
                    task["created_entity_id"] = entity_id

            post_results = {}
            for owner in owners:
                post = self._call(r, owner, "post_validate", {"plan_id": plan["id"]})
                require(all(post.get(key) is True for key in (
                    "valid", "invariants", "known_views", "pending_tasks",
                    "references", "branch_isolation",
                )), "POST_VALIDATION_FAILED")
                post_results[owner] = post
            operation["completed_stages"].append({
                "stage": "post_validate", "result": post_results,
            })
            audit["pending_stages"] = []
            plan["status"] = "applied"
            return self._finish(operation, audit, {
                "plan_id": plan["id"],
                "owner_event_refs": operation["owner_event_refs"],
                "post_validation": post_results,
            })
        except ControlError as error:
            if error.code == "STALE_PLAN" and not operation["completed_stages"]:
                plan["status"] = "stale"
            return self._partial(operation, audit, error)

    @staticmethod
    def _preceding_revisions(
        operation: Object, index: int, initial: Object,
    ) -> Object:
        revisions = copy.deepcopy(initial)
        for item in operation["completed_stages"]:
            if item["stage"] == f"patch:{index}":
                break
            revisions.update(item["result"].get("after_revisions", {}))
        return revisions

    def _preview_plan(self, state: System27State, r: Object) -> CommandResponse:
        p = r["payload"]
        exact(p, {"plan_id", "kind", "targets", "patches", "recovery_anchor"}, {
            "knowledge_correction", "repair_case_id", "generation_task_id",
        })
        require(p["kind"] in PATCH_CLASSES, "UNSUPPORTED_PATCH_CLASS")
        targets = references(p["targets"])
        require(isinstance(p["patches"], list) and p["patches"], "EMPTY_PATCH_PLAN")
        require(p["plan_id"] not in state.impact_plan, "PLAN_IMMUTABLE_CREATE_NEW_PLAN")
        grouped: dict[str, list[str]] = {}
        for patch in p["patches"]:
            exact(patch, {"owner_domain", "patch_ref"})
            require(patch["owner_domain"] in OWNER_DOMAINS, "UNKNOWN_OWNER")
            grouped.setdefault(patch["owner_domain"], []).append(text(patch["patch_ref"]))
        require(len({canonical(x) for x in p["patches"]}) == len(p["patches"]),
                "DUPLICATE_PATCH")

        correction = None
        if p["kind"] == "knowledge_correction":
            require(set(grouped) == {"knowledge"}, "KNOWLEDGE_REQUIRES_SEPARATE_OWNER")
            correction = p.get("knowledge_correction")
            require(isinstance(correction, dict), "MISSING_KNOWLEDGE_POLICY")
            exact(correction, {"subject", "source", "acquisition_time", "reason"})
            verified = self._call(r, "knowledge", "validate_knowledge", correction)
            require(
                verified.get("valid") is True
                and verified.get("source_verified") is True
                and verified.get("demonstrably_lost_or_wrong") is True,
                "KNOWLEDGE_SOURCE_NOT_VERIFIED",
            )
            correction = {**correction, "owner_validation": verified["owner_validation"]}
        else:
            require("knowledge_correction" not in p, "IMPLICIT_KNOWLEDGE_EFFECT")

        if p["kind"] == "repair":
            case_id = text(p.get("repair_case_id"))
            case = state.get("repair_case", case_id)
            self._bound(state, "repair:" + case_id, r)
            require(case["validation_results"].get("verified_restoration") is True,
                    "RESTORATION_NOT_ESTABLISHED")
        else:
            require("repair_case_id" not in p, "REPAIR_CLASS_REQUIRED")

        if p["kind"] == "npc_create":
            require(set(grouped) == {"system_9"}, "NPC_OWNER_REQUIRED")
            task_id = text(p.get("generation_task_id"))
            task = state.get("generation_task", task_id)
            self._bound(state, "generation:" + task_id, r)
            require(task["created_entity_id"] is None, "ENTITY_ALREADY_CREATED")
            require(len(p["patches"]) == 1, "ONE_CREATION_PER_GENERATION_TASK")
        else:
            require("generation_task_id" not in p, "CREATION_CLASS_REQUIRED")

        anchor = self._call(r, "system_25", "verify_checkpoint", {
            "checkpoint_ref": p["recovery_anchor"],
        })
        require(anchor.get("verified") is True, "RECOVERY_ANCHOR_UNVERIFIED")
        require(anchor.get("source_cut") == r["cut_ref"], "RECOVERY_CUT_MISMATCH")

        revisions: Object = {}
        changes, approvals, dependencies, resources, steps = [], [], [], [], []
        information = {"truth": False, "record": False, "knowledge": False, "rendering": False}
        requires_pause = False
        dependency_refs = []
        for owner, patch_refs in sorted(grouped.items()):
            preview = self._call(r, owner, "preview", {
                "target_refs": targets, "patch_refs": patch_refs, "kind": p["kind"],
            })
            self._validate_owner(preview)
            require(preview["pending_work_conflicts"] == [], "UNRESOLVED_WORK_CONFLICT")
            require(preview["destructive_dependencies_resolved"] is True,
                    "UNRESOLVED_DESTRUCTIVE_DEPENDENCIES")
            returned = preview["patches"]
            require({item["patch_ref"] for item in returned} == set(patch_refs),
                    "PATCH_SCOPE_MISMATCH")
            for patch in returned:
                require(patch["owner_domain"] == owner, "FIELD_OWNER_MISMATCH")
                require(patch["target_ref"] in targets, "TARGET_SCOPE_BROADENED")
                require(patch["kind"] == p["kind"], "PATCH_CLASS_MISMATCH")
            require(
                preview["information_effects"]["knowledge"]
                == (p["kind"] == "knowledge_correction"),
                "IMPLICIT_KNOWLEDGE_EFFECT",
            )
            for ref, revision in preview["expected_revisions"].items():
                require(ref not in revisions or revisions[ref] == revision,
                        "INCOHERENT_PREVIEW")
                revisions[ref] = revision
            changes.extend(copy.deepcopy(returned))
            steps.extend(copy.deepcopy(returned))
            approvals.append(preview["approval_ref"])
            dependencies.extend(preview["dependencies"])
            dependency_refs.append(preview["dependencies_ref"])
            resources.extend(preview["resource_access_changes"])
            for layer in information:
                information[layer] |= preview["information_effects"][layer]
            requires_pause |= preview["requires_paused_simulation"]

        require(set(targets) <= set(revisions), "TARGET_REVISION_MISSING")
        state.put("impact_plan", p["plan_id"], {
            "id": p["plan_id"],
            "context_ref": r["context_id"],
            "target_refs": targets,
            "expected_revisions": revisions,
            "patch_refs": [item["patch_ref"] for item in p["patches"]],
            "dependencies_ref": "dependencies:" + digest(dependency_refs),
            "knowledge_policy": "source_correction" if correction else "none",
            "recovery_anchor": p["recovery_anchor"],
            "status": "previewed",
        })
        state.put("impact_details", p["plan_id"], {
            "before_after_values": changes,
            "owner_approvals": approvals,
            "affected_dependencies": sorted(set(dependencies)),
            "invariant_results": {name: True for name in VALIDATION_CHECKS},
            "resource_access_changes": resources,
            "pending_work_conflicts": [],
            "information_effects": information,
            "application_steps": steps,
            "fallback": "retain completed stages; recover through verified anchor",
            "requires_paused_simulation": requires_pause,
        })
        self._lineage(
            state, "plan:" + p["plan_id"], r,
            "correction" if p["kind"] == "repair" else "creator-authored intervention",
            extra_scope={
                "operation_class": p["kind"],
                "generation_task_id": p.get("generation_task_id"),
            },
        )
        if correction:
            state.put("knowledge_correction", p["plan_id"], correction)
        if p["kind"] == "repair":
            state.repair_case[p["repair_case_id"]]["approved_plan"] = p["plan_id"]
        return result("previewed", {
            "plan": state.impact_plan[p["plan_id"]],
            "impact": state.impact_details[p["plan_id"]],
            "preview_digest": self._plan_digest(state, p["plan_id"]),
        })

    def _inspect(self, state: System27State, r: Object) -> CommandResponse:
        p, command = r["payload"], r["command"]
        if command == "GetOperation":
            exact(p, {"operation_id"})
            operation = state.get("control_operation", p["operation_id"])
            audit = state.get("operation_audit", p["operation_id"])
            require(audit["target_scope"]["campaign_id"] == r["campaign_id"],
                    "SCOPE_MISMATCH")
            require(audit["target_scope"]["timeline_id"] == r["timeline_id"],
                    "SCOPE_MISMATCH")
            return result(operation["status"], {
                "operation": operation, "audit": audit,
            })

        if command == "PreviewPlayerView":
            exact(p, set())
            view = self._call(r, "system_26", "preview", {})
            require(all(view.get(k) is True for k in ("filtered", "read_only", "secret_free")),
                    "UNSAFE_PLAYER_PROJECTION")
            require(
                view.get("actor_ref") == r["actor_or_subject_ref"]
                and view.get("timeline_id") == r["timeline_id"]
                and view.get("cut_ref") == r["cut_ref"]
                and view.get("policy_version") == r["policy_version"],
                "PLAYER_VIEW_SCOPE_MISMATCH",
            )
            # No privileged source object is copied into this response.
            return result("preview", {
                "actor_ref": view["actor_ref"],
                "timeline_id": view["timeline_id"],
                "cut_ref": view["cut_ref"],
                "projection": view["projection"],
                "cache_key": digest({
                    "privilege": "player",
                    "actor": r["actor_or_subject_ref"],
                    "timeline": r["timeline_id"],
                    "cut": r["cut_ref"],
                    "policy": r["policy_version"],
                }),
            })

        if command == "InspectContext":
            exact(p, {"task_ref"})
            payload = self._call(r, "ai_context", "context", p)
            require(payload.get("redaction_applied") is True, "REDACTION_REQUIRED")
            require(payload.get("actual_task_artifacts_only") is True,
                    "DIAGNOSTIC_PROVENANCE_MISSING")
            require(payload.get("hidden_reasoning_available") is False,
                    "UNSUPPORTED_DIAGNOSTIC_CLAIM")
        else:
            exact(p, {"owner_domain", "target_refs"})
            require(p["owner_domain"] in OWNER_DOMAINS, "UNKNOWN_OWNER")
            references(p["target_refs"])
            action = {
                "InspectTruth": "inspect",
                "InspectTrace": "trace",
                "InspectWatcher": "evaluate_watcher",
            }[command]
            if command == "InspectWatcher":
                require(p["owner_domain"] == "system_24", "WATCHER_OWNER_REQUIRED")
            payload = self._call(r, p["owner_domain"], action, {
                "target_refs": p["target_refs"],
            })
            if command == "InspectWatcher":
                require(payload.get("value") in {True, False, "unknown"},
                        "INVALID_WATCHER_RESULT")
                require(payload.get("effects_applied") is False, "INSPECTOR_MUTATION")
            if command == "InspectTrace":
                require(payload.get("randomness_consumed") is False, "INSPECTOR_MUTATION")
                require(payload.get("canonical_time_advanced") is False, "INSPECTOR_MUTATION")

        require(payload.get("read_only") is True, "INSPECTOR_MUTATION")
        require(payload.get("secret_free") is True, "REDACTION_REQUIRED")
        artifact_id = "diagnostic:" + digest([scope_of(r), r["request_id"]])
        state.put("diagnostic_artifact", artifact_id, {
            "id": artifact_id,
            "task_ref": p.get("task_ref"),
            "source_cut": r["cut_ref"],
            "privilege_scope": scope_of(r),
            "payload_ref": payload.get("payload_ref", payload.get("trace_ref")),
            "redaction_policy": POLICY_VERSION,
        })
        return result("inspected", {"artifact_id": artifact_id, "payload": payload})

    def _cancel(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        exact(r["payload"], {"operation_id", "reason"})
        text(r["payload"]["reason"])
        operation = state.get("control_operation", r["payload"]["operation_id"])
        audit = state.get("operation_audit", operation["id"])
        require(audit["target_scope"]["campaign_id"] == r["campaign_id"], "SCOPE_MISMATCH")
        require(audit["target_scope"]["timeline_id"] == r["timeline_id"], "SCOPE_MISMATCH")
        if operation["status"] == "completed":
            raise ControlError("COMPLETED_OPERATION_REQUIRES_RECOVERY")
        operation["status"] = "cancelled"
        audit["outcome"] = {**audit["outcome"],
            "cancelled_by": auth["principal_ref"],
            "reason": r["payload"]["reason"],
            "committed_stages_retained": True,
            "recovery_may_be_required": bool(operation["completed_stages"]),
        }
        return result("cancelled", {
            "operation_id": operation["id"],
            "completed_stages_retained": len(operation["completed_stages"]),
            "uncommitted_stages_stopped": len(audit["pending_stages"]),
        })

    def _scenario(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        p = r["payload"]
        if r["command"] == "CreateScenario":
            exact(p, set(RECORD_FIELDS["test_scenario"]))
            references(p["fixture_refs"], allow_empty=True)
            references(p["assertion_refs"], allow_empty=True)
            require(isinstance(p["scripted_inputs"], list), "INVALID_SCRIPTED_INPUTS")
            for scripted in p["scripted_inputs"]:
                exact(scripted, {"kind", "content", "test_only"})
                require(scripted["kind"] == "synthetic_player_input", "INVALID_TEST_INPUT")
                require(scripted["test_only"] is True, "SYNTHETIC_PROVENANCE_REQUIRED")
                text(scripted["content"])
            checkpoint = self._call(r, "system_25", "verify_checkpoint", {
                "checkpoint_ref": p["root_checkpoint"],
            })
            require(checkpoint.get("verified") is True, "UNVERIFIED_CHECKPOINT")
            require(checkpoint["source_cut"] == r["cut_ref"], "CHECKPOINT_CUT_MISMATCH")
            validation = self._call(r, "creator_test_author", "validate_scenario", p)
            require(all(validation.get(k) is True for k in (
                "valid", "typed_fixtures", "synthetic_inputs_only", "supported_test_seams",
            )), "INVALID_SCENARIO")
            self._new(state, "test_scenario", text(p["id"]), p)
            self._lineage(
                state, "scenario:" + p["id"], r, "test fixture",
                version=text(p["version"]), parents=[p["root_checkpoint"]],
            )
            return result("defined", {"scenario_id": p["id"], "tests_executed": False})

        exact(p, {"scenario_id", "run_id", "reason"})
        scenario = state.get("test_scenario", p["scenario_id"])
        self._bound(state, "scenario:" + scenario["id"], r)
        run_id = text(p["run_id"])
        stage_names = (
            ["fork"]
            + [f"fixture:{i}" for i in range(len(scenario["fixture_refs"]))]
            + [f"input:{i}" for i in range(len(scenario["scripted_inputs"]))]
            + ["assertions"]
        )
        operation, audit = self._operation(
            state, r, auth, scenario["id"], "run_scenario", p["reason"],
            [{"stage": name} for name in stage_names],
        )
        if operation["status"] == "completed":
            return result("completed", {"operation_id": operation["id"], **audit["outcome"]})
        try:
            if run_id in state.test_run:
                lineage = state.get("version_and_lineage", "run:" + run_id)
                require(lineage["applicability"]["operation_id"] == operation["id"],
                        "RUN_ID_REUSED_USE_NEW_RUN")
            checkpoint = self._call(r, "system_25", "verify_checkpoint", {
                "checkpoint_ref": scenario["root_checkpoint"],
            })
            require(checkpoint.get("verified") is True, "UNVERIFIED_CHECKPOINT")
            fork = self._stage(
                state, r, operation, audit, "fork", "system_25", "fork",
                {"checkpoint_ref": scenario["root_checkpoint"], "run_id": run_id},
            )
            self._validate_fork(fork, r)
            child_scope = {**scope_of(r), "timeline_id": fork["sandbox_timeline"]}
            if run_id not in state.test_run:
                state.put("test_run", run_id, {
                    "id": run_id, "scenario_ref": scenario["id"],
                    "sandbox_timeline": fork["sandbox_timeline"],
                    "trace_refs": [], "actual_results": [], "status": "running",
                })
                self._lineage(
                    state, "run:" + run_id, r, "test fixture",
                    parents=[scenario["root_checkpoint"]],
                    extra_scope={"operation_id": operation["id"]},
                )
                state.put("test_execution", run_id, {
                    "fixture_provenance": [],
                    "target_time_or_interval": None,
                    "stop_policy": "stop_at_player_choice",
                    "progress_cursor": None,
                    "before_after_cuts": [r["cut_ref"], fork["source_cut"]],
                    "processed_owner_events": [],
                    "paused_choices": [],
                    "deferred_tasks": [],
                    "errors": [],
                    "assertion_evidence": [],
                    "invalid_fault_fixture": False,
                })
            execution = state.test_execution[run_id]
            for index, fixture_ref in enumerate(scenario["fixture_refs"]):
                fixture = self._call(r, "creator_test_author", "describe_fixture", {
                    "fixture_ref": fixture_ref,
                })
                require(fixture.get("valid") is True, "INVALID_FIXTURE")
                receipt = self._stage(
                    state, r, operation, audit, f"fixture:{index}",
                    fixture["owner_domain"], "apply_fixture",
                    {
                        "fixture_ref": fixture_ref,
                        "provenance": "test fixture",
                        "fault_store_only": fixture["invalid_fault_fixture"],
                        "source_writeback": False,
                    },
                    target_scope=child_scope,
                )
                marker = {
                    "fixture_ref": fixture_ref,
                    "owner_event_refs": receipt["owner_event_refs"],
                    "provenance": "test fixture",
                }
                if marker not in execution["fixture_provenance"]:
                    execution["fixture_provenance"].append(marker)
                execution["invalid_fault_fixture"] |= fixture["invalid_fault_fixture"]

            for index, scripted in enumerate(scenario["scripted_inputs"]):
                self._stage(
                    state, r, operation, audit, f"input:{index}",
                    "system_11", "scripted_input",
                    {"input": scripted, "source_writeback": False},
                    target_scope=child_scope,
                )
            assertions = self._stage(
                state, r, operation, audit, "assertions", "system_25", "assertions",
                {"assertion_refs": scenario["assertion_refs"]},
                target_scope=child_scope, mutation=False,
            )
            run = state.test_run[run_id]
            run["actual_results"] = assertions["assertions"]
            run["trace_refs"] = assertions["trace_refs"]
            run["status"] = "not_executed"
            execution["assertion_evidence"] = assertions["assertions"]
            return self._finish(operation, audit, {
                "run": run,
                "source_unchanged": True,
                "assertion_engine_is_stubbed": True,
            })
        except ControlError as error:
            if run_id in state.test_run:
                state.test_run[run_id]["status"] = "partial"
                state.test_execution[run_id]["errors"].append({"code": error.code})
            return self._partial(operation, audit, error)

    @staticmethod
    def _validate_fork(fork: Object, r: Object) -> None:
        require(
            isinstance(fork.get("sandbox_timeline"), str)
            and fork["sandbox_timeline"] != r["timeline_id"],
            "SOURCE_BRANCH_WRITE_FORBIDDEN",
        )
        require(all(fork.get(k) is True for k in (
            "isolated", "original_future_retained", "immutable_prefix_unchanged",
            "fixture_provenance_retained",
        )), "TEST_ISOLATION_NOT_ESTABLISHED")

    def _test_action(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        p, command = r["payload"], r["command"]
        required = {"run_id", "reason"}
        optional: set[str] = set()
        if command == "AdvanceTestTime":
            required |= {"target_time_or_interval", "stop_policy"}
            optional = {"synthetic_response"}
        elif command == "StageContextOverride":
            required |= {"task_ref", "candidate_ref"}
        exact(p, required, optional)
        run = state.get("test_run", p["run_id"])
        self._bound(state, "run:" + p["run_id"], r)
        require(run["sandbox_timeline"] != r["timeline_id"], "SOURCE_BRANCH_WRITE_FORBIDDEN")
        child_scope = {**scope_of(r), "timeline_id": run["sandbox_timeline"]}
        if command == "AdvanceTestTime":
            require(p["stop_policy"] in {"stop_at_player_choice", "scripted_test_response"},
                    "INVALID_STOP_POLICY")
            if p["stop_policy"] == "scripted_test_response":
                scripted = p.get("synthetic_response")
                require(isinstance(scripted, dict), "SYNTHETIC_INPUT_REQUIRED")
                exact(scripted, {"kind", "content", "test_only"})
                require(
                    scripted["kind"] == "synthetic_player_input"
                    and scripted["test_only"] is True,
                    "SYNTHETIC_PROVENANCE_REQUIRED",
                )
                text(scripted["content"])
            else:
                require("synthetic_response" not in p, "UNUSED_SYNTHETIC_RESPONSE")
        service = "ai_context" if command == "StageContextOverride" else "system_11"
        action = {
            "AdvanceTestTime": "advance",
            "PauseTestTime": "pause",
            "ResumeTestTime": "resume",
            "StageContextOverride": "context_override",
        }[command]
        if command == "StageContextOverride":
            validation = self._call(r, "system_9", "validate_candidate", {
                "candidate_ref": p["candidate_ref"],
            })
            self._validate_owner(validation)

        operation, audit = self._operation(
            state, r, auth, run["id"], command, p["reason"], [{"stage": action}],
        )
        if operation["status"] == "completed":
            return result("completed", {"operation_id": operation["id"], **audit["outcome"]})
        try:
            receipt = self._stage(
                state, r, operation, audit, action, service, action,
                {**p, "provenance": "test fixture", "source_writeback": False},
                target_scope=child_scope,
            )
            if service == "system_11":
                require(
                    receipt.get("chronological_processing") is True
                    and receipt.get("stop_policy_honored") is True,
                    "SCHEDULER_CONTRACT_VIOLATION",
                )
                execution = state.test_execution[run["id"]]
                execution["target_time_or_interval"] = p.get("target_time_or_interval")
                execution["stop_policy"] = p.get("stop_policy", "stop_at_player_choice")
                for key in (
                    "progress_cursor", "before_after_cuts", "processed_owner_events",
                    "paused_choices", "deferred_tasks", "errors",
                ):
                    execution[key] = copy.deepcopy(receipt[key])
            return self._finish(operation, audit, {"receipt": receipt})
        except ControlError as error:
            return self._partial(operation, audit, error)

    def _diagnose(self, state: System27State, r: Object) -> CommandResponse:
        p = r["payload"]
        exact(p, {"case_id", "owner_domain", "invariant_refs", "evidence_refs"})
        require(p["owner_domain"] in OWNER_DOMAINS, "UNKNOWN_OWNER")
        references(p["invariant_refs"])
        references(p["evidence_refs"], allow_empty=True)
        require(p["case_id"] not in state.repair_case, "REPAIR_CASE_ALREADY_EXISTS")
        verified_evidence = bool(p["evidence_refs"])
        for ref in p["evidence_refs"]:
            source = self._call(r, "system_25", "verify_evidence", {"evidence_ref": ref})
            verified_evidence &= source.get("verified") is True
        diagnosis = self._call(r, p["owner_domain"], "diagnose", {
            "invariant_refs": p["invariant_refs"], "evidence_refs": p["evidence_refs"],
        })
        require(diagnosis.get("classification") in DIAGNOSES, "UNKNOWN_DIAGNOSIS")
        restoration = (
            verified_evidence
            and diagnosis.get("verified_restoration") is True
            and diagnosis.get("modeled_disagreement") is False
            and diagnosis.get("uncertainty") == []
            and diagnosis.get("unavailable_sources") == []
            and diagnosis["classification"] != "unrecoverable_canonical_gap"
        )
        state.put("repair_case", p["case_id"], {
            "id": p["case_id"],
            "invariant_refs": p["invariant_refs"],
            "evidence_refs": p["evidence_refs"],
            "diagnosis_ref": diagnosis["diagnosis_ref"],
            "approved_plan": None,
            "validation_results": {
                "verified_restoration": restoration,
                "modeled_disagreement": diagnosis.get("modeled_disagreement"),
                "activation_blocked": not restoration,
            },
        })
        state.put("diagnosis_details", p["case_id"], {
            name: diagnosis[name] for name in RECORD_FIELDS["diagnosis_details"]
        })
        self._lineage(state, "repair:" + p["case_id"], r, "correction")
        return result("diagnosed", {
            "case": state.repair_case[p["case_id"]],
            "diagnosis": state.diagnosis_details[p["case_id"]],
            "automatic_truth_changes": False,
        })

    def _recover(self, state: System27State, r: Object, auth: Object) -> CommandResponse:
        p = r["payload"]
        exact(p, {"checkpoint_ref", "reason"})
        checkpoint = self._call(r, "system_25", "verify_checkpoint", {
            "checkpoint_ref": p["checkpoint_ref"],
        })
        require(checkpoint.get("verified") is True, "UNVERIFIED_CHECKPOINT")
        operation, audit = self._operation(
            state, r, auth, p["checkpoint_ref"], "recovery", p["reason"],
            [{"stage": "restore"}],
        )
        if operation["status"] == "completed":
            return result("completed", {"operation_id": operation["id"], **audit["outcome"]})
        try:
            receipt = self._stage(
                state, r, operation, audit, "restore", "system_25", "restore",
                {
                    "checkpoint_ref": p["checkpoint_ref"],
                    "preserve_original_future": True,
                    "provenance": "correction",
                    "fabricate_in_world_undo": False,
                },
            )
            self._validate_fork(receipt, r)
            return self._finish(operation, audit, {"recovery": receipt})
        except ControlError as error:
            return self._partial(operation, audit, error)

    def _package(self, state: System27State, r: Object) -> CommandResponse:
        p = r["payload"]
        if r["command"] == "StageImport":
            exact(p, {"draft_id", "package_ref", "owner_domain", "source_version"})
            require(p["owner_domain"] in OWNER_DOMAINS, "UNKNOWN_OWNER")
            imported = self._call(r, "system_25", "stage_import", {
                "package_ref": p["package_ref"],
            })
            require(imported.get("valid") is True, "INVALID_IMPORT")
            require(all(imported.get("checks", {}).get(key) is True for key in (
                "schema", "content", "privacy", "safe_paths",
                "no_executable_code", "required_data", "provenance_retained",
            )), "INVALID_IMPORT")
            require(imported.get("activated") is False, "IMPORT_AUTO_ACTIVATION")
            self._new(state, "content_draft", p["draft_id"], {
                "id": p["draft_id"],
                "owner_domain": p["owner_domain"],
                "source_version": p["source_version"],
                "candidate_ref": imported["staged_candidate_ref"],
                "validation_ref": None,
                "status": "draft",
            })
            self._lineage(
                state, "draft:" + p["draft_id"], r, "authored setup",
                version=p["source_version"], parents=[p["package_ref"]],
            )
            return result("staged", {"draft_id": p["draft_id"], "activated": False})

        exact(p, {"panes", "mode"})
        references(p["panes"])
        require(set(p["panes"]) <= {
            "truth", "record", "knowledge", "belief", "memory", "derived", "diagnostics",
        }, "UNSUPPORTED_EXPORT_PANE")
        require(p["mode"] in {"privileged_redacted", "known_view"}, "INVALID_EXPORT_MODE")
        if p["mode"] == "known_view":
            require(set(p["panes"]) <= {"knowledge", "derived"}, "PRIVILEGED_PANE_IN_KNOWN_VIEW")
        exported = self._call(r, "system_25", "export", p)
        require(
            exported.get("secret_free") is True
            and exported.get("redaction_applied") is True
            and exported.get("fixture_provenance_retained") is True
            and exported.get("published") is False,
            "UNSAFE_EXPORT",
        )
        require(exported.get("scope") == scope_of(r), "EXPORT_SCOPE_MISMATCH")
        require(exported.get("panes") == p["panes"], "EXPORT_SCOPE_BROADENED")
        return result("exported", {
            "payload_ref": exported["payload_ref"],
            "scope": exported["scope"],
            "panes": exported["panes"],
            "restorable": exported["restorable"],
            "published": False,
        })


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "system27.sqlite3"
    engine = ControlPlane(
        path,
        server_session=os.environ.get("SYSTEM27_DEMO_SESSION", "creator"),
    )
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                request = json.loads(
                    line,
                    parse_constant=lambda _: (_ for _ in ()).throw(ValueError()),
                )
                response = engine.state_machine(request)
            except (ValueError, TypeError, RecursionError):
                response = result("rejected", {"code": "INVALID_JSON"}, ok=False)
            print(canonical(response), flush=True)
    finally:
        engine.close()


if __name__ == "__main__":
    main()
