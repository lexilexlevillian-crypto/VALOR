"""
System 26: isolated player-interface and information-presentation module.

Python 3.11+, standard library only.

Public interface:
    interface = System26.create()
    result = interface.step({
        "operation": "query",
        "context": interface.context(),
        "surface": "inventory",
    })

All dependency functions below are stateless JSON stubs. Replace their returned
fixtures when testing integration contracts; do not implement other systems here.

Representation decisions:
- IDs and cuts are opaque strings; revisions are nonnegative integers.
- Record collections use dictionaries keyed by opaque presentation references.
- Field values are JSON scalars or scalar lists. Structured domain information
  must be supplied as separately entitled fields.
- State is server-private. Only step() responses are ordinary client payloads.
- An explicit=True submission represents an authenticated, deliberate UI event.
  Authentication and verification of that event belong to the hosting transport.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import threading
from dataclasses import dataclass, field, fields
from typing import Any, Callable, TypeAlias


JSONScalar: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONScalar | list["JSONValue"] | dict[str, "JSONValue"]
JSONObject: TypeAlias = dict[str, JSONValue]

_LOCK = threading.RLock()

_CONTEXT_KEYS = {
    "campaign_id",
    "timeline_id",
    "actor_id",
    "access_policy_version",
    "event_cut",
    "view_revision",
}

_SURFACE_OWNERS = {
    "chronicle": "events",
    "player_sheet": "character",
    "npc_profile": "character",
    "inventory": "inventory",
    "phone": "communications",
    "places": "locations",
    "relationships": "relationships",
    "case_files": "legal",
    "journal": "journal",
    "combat": "combat",
    "saves": "timelines",
}

_ACTION_OWNERS = {
    "freeform": "events",
    "say": "events",
    "acquire_record": "knowledge",
    "edit_character": "character",
    "message_person": "relationships",
    "invite": "relationships",
    "discuss": "relationships",
    "offer_help": "relationships",
    "inspect_item": "inventory",
    "give_item": "inventory",
    "drop_item": "inventory",
    "hide_item": "inventory",
    "use_item": "inventory",
    "equip_item": "inventory",
    "change_clothing": "inventory",
    "send_message": "communications",
    "call": "communications",
    "read_device_content": "communications",
    "capture_media": "communications",
    "travel": "locations",
    "discover_place": "locations",
    "fast_forward": "time",
    "attack": "combat",
    "defend": "combat",
    "surrender": "combat",
    "flee": "combat",
    "pursue": "combat",
    "query_case": "legal",
    "submit_report": "legal",
    "submit_hypothesis": "legal",
    "disclose_record": "legal",
    "legal_action": "legal",
    "inspect_evidence": "evidence",
    "seize_evidence": "evidence",
    "accept_offer": "journal",
    "decline_offer": "journal",
    "abandon_commitment": "journal",
    "cancel_action": "events",
    "save": "timelines",
    "load": "timelines",
    "branch": "timelines",
    "correct_history": "timelines",
}

_OWNER_SURFACES = {
    "knowledge": "chronicle",
    "events": "chronicle",
    "character": "player_sheet",
    "relationships": "relationships",
    "inventory": "inventory",
    "communications": "phone",
    "locations": "places",
    "time": "chronicle",
    "combat": "combat",
    "legal": "case_files",
    "evidence": "case_files",
    "journal": "journal",
    "timelines": "saves",
}

_SOURCE_CLASSES = {
    "authored",
    "self_mechanic",
    "observation",
    "record",
    "account",
    "impression",
    "memory",
    "out_of_world",
}

_URGENCIES = {
    "required_choice",
    "known_immediate_concern",
    "ordinary",
    "out_of_world",
}

_ERRORS = {
    "invalid_request": "The request is not valid.",
    "unavailable": "That information or operation is unavailable through this route.",
    "conflict": "The context changed. Review the current information and try again.",
    "authorization_required": "Explicit action authorization is required.",
    "needs_clarification": "Clarify the consequential scope before submitting.",
    "idempotency_conflict": "This request key already belongs to a different intent.",
    "unsupported": "That operation is not supported.",
    "result_pending": "The result is not yet available. Check its status.",
}

_MOCK_CONTEXT = {
    "campaign_id": "demo-campaign",
    "timeline_id": "demo-timeline",
    "actor_id": "demo-player",
    "access_policy_version": "demo-policy-v1",
    "event_cut": "demo-cut-0",
    "view_revision": 0,
}

_MOCK_REVISIONS = {
    owner: 1
    for owner in {
        "knowledge", "events", "character", "relationships", "inventory",
        "communications", "locations", "time", "combat", "legal",
        "evidence", "journal", "timelines",
    }
}


class ContractError(Exception):
    """Carries only a public, nonrevealing error category."""

    def __init__(self, code: str = "unavailable") -> None:
        self.code = code if code in _ERRORS else "unavailable"
        super().__init__(self.code)


def _require(condition: bool, code: str = "invalid_request") -> None:
    if not condition:
        raise ContractError(code)


def _clone(value: Any) -> Any:
    return copy.deepcopy(value)


def _json_valid(value: Any, depth: int = 0) -> bool:
    if depth > 48:
        return False
    if value is None or type(value) in (bool, int, str):
        return True
    if type(value) is float:
        return math.isfinite(value)
    if type(value) is list:
        return all(_json_valid(item, depth + 1) for item in value)
    if type(value) is dict:
        return all(
            type(key) is str and _json_valid(item, depth + 1)
            for key, item in value.items()
        )
    return False


def _text(value: Any, *, empty: bool = False) -> str:
    _require(type(value) is str and len(value) <= 100_000)
    _require(empty or bool(value))
    return value


def _scalar(value: Any) -> bool:
    return (
        value is None
        or type(value) in (str, bool, int)
        or (type(value) is float and math.isfinite(value))
    )


def _field_value(value: Any) -> bool:
    return _scalar(value) or (
        type(value) is list and all(_scalar(item) for item in value)
    )


def _digest(*values: Any) -> str:
    encoded = json.dumps(
        values, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_context(context: Any) -> JSONObject:
    _require(type(context) is dict and set(context) == _CONTEXT_KEYS)
    for key in _CONTEXT_KEYS - {"view_revision"}:
        _text(context[key])
    _require(
        type(context["view_revision"]) is int
        and context["view_revision"] >= 0
    )
    return _clone(context)


def _scope(context: JSONObject, *, access: bool = True) -> tuple[Any, ...]:
    names = ["campaign_id", "timeline_id", "actor_id"]
    if access:
        names.append("access_policy_version")
    return tuple(context[name] for name in names)


def _validate_revisions(value: Any) -> JSONObject:
    _require(type(value) is dict, "unavailable")
    _require(
        all(
            key in _MOCK_REVISIONS
            and type(revision) is int
            and revision >= 0
            for key, revision in value.items()
        ),
        "unavailable",
    )
    return _clone(value)


def _safe_error(code: Any) -> JSONObject:
    normalized = code if code in _ERRORS else "unavailable"
    return {"code": normalized, "message": _ERRORS[normalized]}


# ---------------------------------------------------------------------------
# External dependency stubs.
#
# These return fixture projections/acknowledgments only. They do not resolve
# inventory, combat, communication, consent, time, legal, or timeline behavior.
# ---------------------------------------------------------------------------

def _dummy_manifest() -> JSONObject:
    return {
        "version": "demo-policy-v1",
        "allowed_self_mechanics": [{"field_kind": "skill"}],
        "field_access_and_acquisition": [
            {
                "surface": "player_sheet",
                "field_kind": "skill",
                "source_classes": ["self_mechanic"],
            },
            {
                "surface": "inventory",
                "field_kind": "possession",
                "source_classes": ["observation"],
            },
        ],
        "identity_uncertainty": {"preserve_tentative_mapping": True},
        "freshness": {"authority": "owner"},
        "action_classes": [
            {
                "action_class": action,
                "owner": owner,
                "classification": (
                    "out_of_world" if owner == "timelines" else "in_world"
                ),
            }
            for action, owner in sorted(_ACTION_OWNERS.items())
        ],
        "notification_sources": {"acquired_or_out_of_world_only": True},
        "export_behavior": {"filtered_projection_only": True},
    }


def _dummy_fields(surface: str, context: JSONObject) -> list[JSONObject]:
    if surface == "player_sheet":
        return [{
            "id": "own-skill",
            "subject_ref": context["actor_id"],
            "field_kind": "skill",
            "value_ref": 2,
            "source_class": "self_mechanic",
            "acquisition_ref": None,
            "relevant_interval": {"start": "demo-cut-0", "end": None},
            "confidence": "permitted_exact_mechanic",
            "freshness": "owner_confirmed",
            "permitted_actions": [],
        }]
    if surface == "inventory":
        return [{
            "id": "wallet-possession",
            "subject_ref": "observed-wallet",
            "field_kind": "possession",
            "value_ref": "Last confirmed in the pocket.",
            "source_class": "observation",
            "acquisition_ref": "wallet-observation",
            "relevant_interval": {"start": "demo-cut-0", "end": None},
            "confidence": "observed",
            "freshness": "last_confirmed",
            "permitted_actions": ["inspect_item", "use_item"],
        }]
    return []


def _dummy_reply(request: JSONObject) -> JSONObject:
    operation = request.get("operation")
    statuses = {
        "query": "ok",
        "preview": "preview",
        "submit": "accepted",
        "result": "pending",
        "narrate": "unavailable",
    }
    context = _clone(request["context"])
    return {
        "context": context,
        "owner_revisions": _clone(_MOCK_REVISIONS),
        "status": statuses.get(operation, "unavailable"),
        "command_id": request.get("command_id"),
        "idempotency_key": request.get("idempotency_key"),
        "fields": (
            _dummy_fields(str(request.get("surface", "")), context)
            if operation == "query" else []
        ),
        "preview": {
            "requirements": [],
            "time_estimate": None,
            "cost_estimate": None,
            "uncertainty": [],
        },
        "completed_effects": [],
        "pending_workflows": [],
        "failed_attempts": [],
        "next_choices": [],
        "notifications": [],
    }


def request_access_knowledge(request: JSONObject) -> JSONObject:
    if request.get("operation") != "policy":
        return _dummy_reply(request)

    context = _clone(request["context"])
    actor = context["actor_id"]
    action_grants = [
        {"action_class": action, "target_refs": [None]}
        for action in (
            "freeform", "say", "save", "load", "branch", "correct_history"
        )
    ]
    action_grants += [
        {"action_class": action, "target_refs": ["observed-wallet"]}
        for action in ("inspect_item", "use_item")
    ]

    return {
        "context": context,
        "owner_revisions": _clone(_MOCK_REVISIONS),
        "manifest": _dummy_manifest(),
        "available_surfaces": [
            surface for surface in _SURFACE_OWNERS if surface != "case_files"
        ],
        "subject_refs": [actor, "observed-wallet"],
        "source_anchors": [context["event_cut"]],
        "source_grants": {
            "wallet-observation": {
                "id": "wallet-observation",
                "source_class": "observation",
                "acquired_at": "demo-cut-0",
                "lineage_ref": "wallet-observation",
                "label": "Your earlier observation",
            }
        },
        "field_grants": [
            {
                "surface": "player_sheet",
                "field_id": "own-skill",
                "subject_ref": actor,
                "field_kind": "skill",
                "source_classes": ["self_mechanic"],
                "acquisition_refs": [],
            },
            {
                "surface": "inventory",
                "field_id": "wallet-possession",
                "subject_ref": "observed-wallet",
                "field_kind": "possession",
                "source_classes": ["observation"],
                "acquisition_refs": ["wallet-observation"],
            },
        ],
        "action_grants": action_grants,
        "workflow_refs": [],
        "boundary_grants": {},
        "notification_grants": {},
        "delegations": [],
    }


def request_events_input_narration(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_character_skills_health(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_relationships_consent(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_15_inventory(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_16_communications(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_12_locations(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_11_time(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_19_combat(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_20_legal(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_21_evidence(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_24_journal(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_system_25_timelines(request: JSONObject) -> JSONObject:
    return _dummy_reply(request)


def request_theme_accessibility(request: JSONObject) -> JSONObject:
    return {"status": "presentation_available"}


def _dependency(owner: str, request: JSONObject) -> JSONObject:
    adapters: dict[str, Callable[[JSONObject], JSONObject]] = {
        "knowledge": request_access_knowledge,
        "events": request_events_input_narration,
        "character": request_character_skills_health,
        "relationships": request_relationships_consent,
        "inventory": request_system_15_inventory,
        "communications": request_system_16_communications,
        "locations": request_system_12_locations,
        "time": request_system_11_time,
        "combat": request_system_19_combat,
        "legal": request_system_20_legal,
        "evidence": request_system_21_evidence,
        "journal": request_system_24_journal,
        "timelines": request_system_25_timelines,
    }
    _require(owner in adapters, "unsupported")
    response = adapters[owner](_clone(request))
    _require(type(response) is dict and _json_valid(response), "unavailable")
    return response


# ---------------------------------------------------------------------------
# System 26 state. Only architecture-listed state names are retained.
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class System26:
    view_context: JSONObject = field(default_factory=dict)
    visible_field: dict[str, JSONObject] = field(default_factory=dict)
    surface_view: dict[str, JSONObject] = field(default_factory=dict)
    ui_draft: dict[str, JSONObject] = field(default_factory=dict)
    notification: dict[str, JSONObject] = field(default_factory=dict)
    known_delta: dict[str, JSONObject] = field(default_factory=dict)
    annotation: dict[str, JSONObject] = field(default_factory=dict)

    navigation: JSONObject = field(default_factory=lambda: {
        "active_surface": "chronicle",
        "back_path": [],
        "source_anchor": None,
        "reading_position": None,
        "focused_control": None,
        "selection": None,
        "pending_choice": None,
        "view_changed": False,
    })
    input: JSONObject = field(default_factory=lambda: {
        "presentation_mode": "game",
        "communication_channel": None,
        "communication_context": None,
        "authorized_delegation": None,
        "clarification_pending": False,
    })
    command_presentation: dict[str, JSONObject] = field(default_factory=dict)
    chronicle: JSONObject = field(default_factory=lambda: {
        "blocks": [],
        "presentation_version": 1,
        "generation_pending": False,
    })
    information_presentation: JSONObject = field(default_factory=lambda: {
        "unknown": False,
        "inaccessible_known_source": False,
        "stale": False,
        "conflicting": False,
        "pending_acquisition": False,
        "source_history": [],
        "identity_mapping": {},
    })
    notification_presentation: JSONObject = field(default_factory=lambda: {
        "queue": [],
        "history": [],
        "active_low_urgency_banner": None,
        "low_urgency_banner_limit": 1,
    })
    cache_and_loading: JSONObject = field(default_factory=lambda: {
        "relevant_owner_revisions": {},
        "last_valid_scoped_views": [],
        "pending_callbacks": [],
        "loading_status": "saved_result_available",
    })
    preferences: JSONObject = field(default_factory=lambda: {
        "theme": "default",
        "panel_visibility": {},
        "density": "normal",
        "known_data_sorting": {"field": "field_kind", "descending": False},
        "point_of_view": "third_person",
        "motion_sound_vibration": {},
        "accessibility": {},
    })
    entitlement_manifest: JSONObject = field(default_factory=dict)

    @classmethod
    def create(cls, context: JSONObject | None = None) -> System26:
        state = cls(view_context=_validate_context(context or _MOCK_CONTEXT))
        policy = state._policy()
        state.entitlement_manifest = _clone(policy["manifest"])
        state.cache_and_loading["relevant_owner_revisions"] = _clone(
            policy["owner_revisions"]
        )
        state.navigation["source_anchor"] = state.view_context["event_cut"]
        return state

    def context(self) -> JSONObject:
        return _clone(self.view_context)

    def _copy_from(self, other: System26) -> None:
        for attribute in fields(self):
            setattr(self, attribute.name, _clone(getattr(other, attribute.name)))

    def _policy(self, context: JSONObject | None = None) -> JSONObject:
        context = context or self.view_context
        response = _dependency("knowledge", {
            "operation": "policy",
            "context": context,
        })
        _require(response.get("context") == context, "conflict")
        _validate_revisions(response.get("owner_revisions"))
        manifest = response.get("manifest")
        _require(type(manifest) is dict, "unavailable")
        _require(
            manifest.get("version") == context["access_policy_version"],
            "conflict",
        )
        required = {
            "version", "allowed_self_mechanics",
            "field_access_and_acquisition", "identity_uncertainty",
            "freshness", "action_classes", "notification_sources",
            "export_behavior",
        }
        _require(set(manifest) == required, "unavailable")
        for key in (
            "available_surfaces", "subject_refs", "source_anchors",
            "field_grants", "action_grants", "workflow_refs", "delegations",
        ):
            _require(type(response.get(key)) is list, "unavailable")
        for key in (
            "source_grants", "boundary_grants", "notification_grants",
        ):
            _require(type(response.get(key)) is dict, "unavailable")
        return response

    def _same_context(self, context: Any) -> None:
        _require(_validate_context(context) == self.view_context, "conflict")

    def _action_allowed(
        self, action: str, target: Any, policy: JSONObject
    ) -> bool:
        if action not in _ACTION_OWNERS:
            return False
        if target is not None and target not in policy["subject_refs"]:
            return False
        return any(
            grant.get("action_class") == action
            and target in grant.get("target_refs", [])
            for grant in policy["action_grants"]
            if type(grant) is dict
        )

    def _options(self, values: Any, policy: JSONObject) -> list[JSONObject]:
        if type(values) is not list:
            return []
        result: list[JSONObject] = []
        seen: set[str] = set()
        for value in values:
            if type(value) is not dict:
                continue
            action = value.get("action_class")
            target = value.get("target_ref")
            if not self._action_allowed(action, target, policy):
                continue
            option = {"action_class": action, "target_ref": target}
            fingerprint = _digest(option)
            if fingerprint not in seen:
                result.append(option)
                seen.add(fingerprint)
        return result

    def _source(self, reference: Any, policy: JSONObject) -> JSONObject | None:
        if type(reference) is dict:
            reference = reference.get("id")
        if type(reference) is not str:
            return None
        source = policy["source_grants"].get(reference)
        if type(source) is not dict:
            return None
        if source.get("id") != reference:
            return None
        if source.get("source_class") not in _SOURCE_CLASSES:
            return None
        if not all(
            type(source.get(key)) is str and bool(source[key])
            for key in ("id", "acquired_at", "lineage_ref")
        ):
            return None
        allowed = {
            "id", "source_class", "acquired_at", "lineage_ref",
            "label", "owner_action_ref",
        }
        return {
            key: _clone(value)
            for key, value in source.items()
            if key in allowed and _scalar(value)
        }

    def _filter_fields(
        self,
        surface: str,
        candidates: Any,
        policy: JSONObject,
    ) -> list[JSONObject]:
        _require(type(candidates) is list, "unavailable")
        permitted: list[JSONObject] = []
        seen: set[str] = set()

        for candidate in candidates:
            if type(candidate) is not dict:
                continue

            grant = next((
                item for item in policy["field_grants"]
                if type(item) is dict
                and item.get("surface") == surface
                and item.get("field_id") == candidate.get("id")
                and item.get("subject_ref") == candidate.get("subject_ref")
                and item.get("field_kind") == candidate.get("field_kind")
            ), None)
            if grant is None:
                continue

            subject = candidate.get("subject_ref")
            kind = candidate.get("field_kind")
            source_class = candidate.get("source_class")
            if subject not in policy["subject_refs"]:
                continue
            if source_class not in _SOURCE_CLASSES:
                continue
            if source_class not in grant.get("source_classes", []):
                continue

            field_policy = next((
                item for item in policy["manifest"]["field_access_and_acquisition"]
                if type(item) is dict
                and item.get("surface") == surface
                and item.get("field_kind") == kind
                and source_class in item.get("source_classes", [])
            ), None)
            if field_policy is None:
                continue

            source = self._source(candidate.get("acquisition_ref"), policy)
            if source_class == "self_mechanic":
                allowed_mechanics = {
                    item.get("field_kind")
                    for item in policy["manifest"]["allowed_self_mechanics"]
                    if type(item) is dict
                }
                if subject != self.view_context["actor_id"] or kind not in allowed_mechanics:
                    continue
                source = None
            else:
                if source is None:
                    continue
                if source["id"] not in grant.get("acquisition_refs", []):
                    continue
                if source["source_class"] != source_class:
                    continue

            required = {
                "id", "subject_ref", "field_kind", "value_ref",
                "source_class", "acquisition_ref", "relevant_interval",
                "confidence", "freshness", "permitted_actions",
            }
            if not required.issubset(candidate):
                continue
            if not _field_value(candidate["value_ref"]):
                continue
            if not _scalar(candidate["confidence"]):
                continue
            if not _scalar(candidate["freshness"]):
                continue

            interval = candidate["relevant_interval"]
            if (
                type(interval) is not dict
                or set(interval) != {"start", "end"}
                or not all(_scalar(value) for value in interval.values())
            ):
                continue

            identifier = candidate["id"]
            if type(identifier) is not str or not identifier:
                continue
            _require(identifier not in seen, "unavailable")
            seen.add(identifier)

            raw_actions = candidate["permitted_actions"]
            actions = (
                [
                    action for action in raw_actions
                    if type(action) is str
                    and self._action_allowed(action, subject, policy)
                ]
                if type(raw_actions) is list else []
            )

            permitted.append({
                "id": identifier,
                "subject_ref": subject,
                "field_kind": kind,
                "value_ref": _clone(candidate["value_ref"]),
                "source_class": source_class,
                "acquisition_ref": source,
                "relevant_interval": _clone(interval),
                "confidence": candidate["confidence"],
                "freshness": candidate["freshness"],
                "permitted_actions": list(dict.fromkeys(actions)),
            })

        return permitted

    def _remember_fields(
        self, visible: list[JSONObject], context: JSONObject
    ) -> list[str]:
        references: list[str] = []
        for value in visible:
            # Acquired records are immutable. Corrections need new provenance.
            if value["source_class"] != "self_mechanic":
                for entry in self.information_presentation["source_history"]:
                    if _scope(entry["context_ref"]) != _scope(context):
                        continue
                    previous = self.visible_field[entry["field_ref"]]
                    same_record = (
                        previous["id"] == value["id"]
                        and previous["acquisition_ref"] == value["acquisition_ref"]
                    )
                    if same_record:
                        _require(
                            previous["value_ref"] == value["value_ref"],
                            "unavailable",
                        )

            reference = "field_" + _digest(context, value)
            if reference not in self.visible_field:
                self.visible_field[reference] = _clone(value)
                self.information_presentation["source_history"].append({
                    "context_ref": _clone(context),
                    "field_ref": reference,
                })
            references.append(reference)
        return references

    def _snapshot(
        self, surface: str, visible: list[JSONObject]
    ) -> JSONObject:
        references = self._remember_fields(visible, self.view_context)
        identifier = "view_" + _digest(self.view_context, surface, references)
        snapshot = {
            "id": identifier,
            "context_ref": self.context(),
            "surface_kind": surface,
            "visible_subjects": sorted({
                value["subject_ref"] for value in visible
            }),
            "fields_ref": references,
            "pagination_cursor": None,
        }
        self.surface_view[identifier] = snapshot

        current = [
            reference
            for reference in self.cache_and_loading["last_valid_scoped_views"]
            if self.surface_view[reference]["surface_kind"] != surface
            and self.surface_view[reference]["context_ref"] == self.view_context
        ]
        current.append(identifier)
        self.cache_and_loading["last_valid_scoped_views"] = current
        self.cache_and_loading["loading_status"] = "saved_result_available"
        return snapshot

    def _boundary(self, reference: Any, policy: JSONObject) -> JSONObject | None:
        if reference is None:
            return None
        _require(type(reference) is str, "unavailable")
        granted = policy["boundary_grants"].get(reference)
        _require(type(granted) is dict, "unavailable")
        source = self._source(granted.get("source_ref"), policy)
        _require(source is not None, "unavailable")
        prompt = granted.get("prompt")
        _require(type(prompt) is str, "unavailable")
        choices = self._options(granted.get("choices", []), policy)
        return {
            "id": reference,
            "context_ref": self.context(),
            "source_ref": source,
            "prompt": prompt,
            "choices": choices,
        }

    def _envelope(
        self, response: JSONObject, *, allow_advance: bool = False
    ) -> JSONObject:
        context = _validate_context(response.get("context"))
        _require(_scope(context) == _scope(self.view_context), "conflict")
        revision = context["view_revision"]
        current_revision = self.view_context["view_revision"]

        if allow_advance and revision > current_revision:
            policy = self._policy(context)
        else:
            _require(context == self.view_context, "conflict")
            policy = self._policy()

        revisions = _validate_revisions(response.get("owner_revisions"))
        _require(revisions == policy["owner_revisions"], "conflict")
        if context == self.view_context:
            _require(
                revisions == self.cache_and_loading["relevant_owner_revisions"],
                "conflict",
            )

        if context != self.view_context:
            self.view_context = context
            self.entitlement_manifest = _clone(policy["manifest"])
            self.cache_and_loading["relevant_owner_revisions"] = revisions
            self.cache_and_loading["last_valid_scoped_views"] = []
            self.cache_and_loading["pending_callbacks"] = []
            self.navigation["view_changed"] = True
            # Old boundary content cannot accompany a new canonical cut.
            self.navigation["pending_choice"] = None

        return policy

    def _page(
        self,
        snapshot: JSONObject,
        request: JSONObject,
        *,
        query: str | None = None,
    ) -> JSONObject:
        values = [
            _clone(self.visible_field[reference])
            for reference in snapshot["fields_ref"]
        ]
        if query is not None:
            needle = query.casefold()
            values = [
                value for value in values
                if needle in json.dumps(
                    {
                        "field_kind": value["field_kind"],
                        "value": value["value_ref"],
                    },
                    ensure_ascii=False,
                ).casefold()
            ]

        sorting = request.get("sorting", self.preferences["known_data_sorting"])
        _require(type(sorting) is dict)
        sort_field = sorting.get("field", "field_kind")
        descending = sorting.get("descending", False)
        _require(sort_field in {"field_kind", "value_ref", "freshness"})
        _require(type(descending) is bool)

        known = [value for value in values if value[sort_field] is not None]
        unknown = [value for value in values if value[sort_field] is None]
        known.sort(
            key=lambda value: (
                type(value[sort_field]).__name__,
                json.dumps(value[sort_field], ensure_ascii=False, sort_keys=True),
                value["id"],
            ),
            reverse=descending,
        )
        values = known + sorted(unknown, key=lambda value: value["id"])

        limit = request.get("limit", 50)
        _require(type(limit) is int and 1 <= limit <= 100)
        cursor = request.get("cursor")
        binding = _digest(snapshot["id"], query, sorting)
        start = 0
        if cursor is not None:
            _require(type(cursor) is str)
            matches = [
                offset for offset in range(len(values) + 1)
                if cursor == "page_" + _digest(binding, offset)
            ]
            _require(bool(matches), "conflict")
            start = matches[0]

        selected = values[start:start + limit]
        next_offset = start + len(selected)
        next_cursor = (
            "page_" + _digest(binding, next_offset)
            if next_offset < len(values) else None
        )

        return {
            "id": snapshot["id"],
            "context_ref": _clone(snapshot["context_ref"]),
            "surface_kind": snapshot["surface_kind"],
            "visible_subjects": sorted({
                value["subject_ref"] for value in selected
            }),
            "fields": selected,
            "pagination_cursor": next_cursor,
            "visible_count": len(values),
        }

    def _query(self, request: JSONObject) -> JSONObject:
        surface = request.get("surface")
        _require(surface in _SURFACE_OWNERS, "unsupported")
        policy = self._policy()
        _require(surface in policy["available_surfaces"], "unavailable")

        target = request.get("subject_ref")
        if target is not None:
            _require(target in policy["subject_refs"], "unavailable")

        self.cache_and_loading["loading_status"] = "fetching_view"
        callback = {
            "context_ref": self.context(),
            "request_id": "query_" + _digest(self.view_context, request),
        }
        self.cache_and_loading["pending_callbacks"].append(callback)

        try:
            response = _dependency(_SURFACE_OWNERS[surface], {
                "operation": "query",
                "context": self.context(),
                "surface": surface,
                "subject_ref": target,
                "owner_revisions": _clone(
                    self.cache_and_loading["relevant_owner_revisions"]
                ),
            })
            policy = self._envelope(response)
            _require(response.get("status") == "ok", "unavailable")
            visible = self._filter_fields(surface, response.get("fields", []), policy)
            if target is not None:
                visible = [
                    value for value in visible if value["subject_ref"] == target
                ]
            snapshot = self._snapshot(surface, visible)
            if "pending_choice" in response:
                self.navigation["pending_choice"] = self._boundary(
                    response["pending_choice"], policy
                )
            self._ingest_notifications(response.get("notifications", []), policy)
            return {"view": self._page(snapshot, request), "fetch_pending": False}
        except Exception:
            cached = next((
                self.surface_view[reference]
                for reference in reversed(
                    self.cache_and_loading["last_valid_scoped_views"]
                )
                if self.surface_view[reference]["surface_kind"] == surface
                and self.surface_view[reference]["context_ref"] == self.view_context
            ), None)
            if cached is None:
                raise ContractError("unavailable") from None
            # A cached broad view must not answer a narrower subject query.
            # Reapply the current entitlement policy even on a fetch failure.
            safe = self._filter_fields(
                surface,
                [self.visible_field[ref] for ref in cached["fields_ref"]],
                policy,
            )
            if target is not None:
                safe = [value for value in safe if value["subject_ref"] == target]
            cached = self._snapshot(surface, safe)
            self.cache_and_loading["loading_status"] = "fetching_view"
            return {
                "view": self._page(cached, request),
                "fetch_pending": True,
            }
        finally:
            self.cache_and_loading["pending_callbacks"] = [
                entry for entry in self.cache_and_loading["pending_callbacks"]
                if entry != callback
            ]

    def _validate_intent(
        self, supplied: Any, target: Any, policy: JSONObject
    ) -> JSONObject:
        _require(type(supplied) is dict and _json_valid(supplied))
        action = supplied.get("action_class")
        _require(self._action_allowed(action, target, policy), "unavailable")

        if action == "say":
            _text(supplied.get("words"), empty=True)
            _text(supplied.get("channel"))
        if action == "fast_forward":
            _require("destination" in supplied and "stop_conditions" in supplied)
        if action == "freeform":
            _require(
                type(supplied.get("objective")) is str
                or type(supplied.get("sequence")) is list
            )

        def validate_references(value: Any) -> None:
            if type(value) is dict:
                for key, item in value.items():
                    if key.endswith("_ref") and item is not None:
                        _require(item in policy["subject_refs"], "unavailable")
                    elif key == "source_anchor":
                        _require(item in policy["source_anchors"], "unavailable")
                    else:
                        validate_references(item)
            elif type(value) is list:
                for item in value:
                    validate_references(item)

        validate_references(supplied)
        return _clone(supplied)

    def _authorized(
        self, request: JSONObject, supplied: JSONObject,
        target: Any, policy: JSONObject,
    ) -> bool:
        if request.get("explicit") is True:
            return True
        reference = request.get("delegation_ref")
        if type(reference) is not str:
            return False
        for grant in policy["delegations"]:
            if (
                type(grant) is dict
                and grant.get("id") == reference
                and grant.get("context_ref") == self.view_context
                and grant.get("supplied_input") == supplied
                and grant.get("target_ref") == target
            ):
                self.input["authorized_delegation"] = _clone(grant)
                return True
        return False

    def _preview(self, request: JSONObject) -> JSONObject:
        policy = self._policy()
        target = request.get("target_ref")
        supplied = self._validate_intent(request.get("supplied_input"), target, policy)
        owner = _ACTION_OWNERS[supplied["action_class"]]
        response = _dependency(owner, {
            "operation": "preview",
            "context": self.context(),
            "supplied_input": supplied,
            "target_ref": target,
            "expected_revisions": _clone(
                self.cache_and_loading["relevant_owner_revisions"]
            ),
        })
        policy = self._envelope(response)
        if response.get("status") == "needs_clarification":
            self.input["clarification_pending"] = True
            return {"clarification_required": True}

        _require(response.get("status") == "preview", "unavailable")
        visible = self._filter_fields(
            _OWNER_SURFACES[owner], response.get("fields", []), policy
        )
        by_id = {value["id"]: value for value in visible}
        raw = response.get("preview", {})
        _require(type(raw) is dict, "unavailable")

        def resolve(reference: Any) -> JSONObject | None:
            return _clone(by_id.get(reference)) if type(reference) is str else None

        preview = {
            "requirements": [
                resolve(reference) for reference in raw.get("requirements", [])
                if resolve(reference) is not None
            ],
            "time_estimate": resolve(raw.get("time_estimate")),
            "cost_estimate": resolve(raw.get("cost_estimate")),
            "uncertainty": [
                resolve(reference) for reference in raw.get("uncertainty", [])
                if resolve(reference) is not None
            ],
            "outcome_guaranteed": False,
        }
        self.input["clarification_pending"] = False
        return {"preview": preview, "supplied_input": supplied, "target_ref": target}

    def _command_key(self, key: str) -> str:
        return "command_" + _digest(_scope(self.view_context, access=False), key)

    def _command_request(
        self, command: JSONObject, operation: str
    ) -> JSONObject:
        payload = {
            "operation": operation,
            "context": self.context(),
            "origin_context": _clone(command["context_ref"]),
            "command_id": command["command_id"],
            "request_id": command["request_id"],
            "idempotency_key": command["idempotency_key"],
            "supplied_input": _clone(command["supplied_input"]),
            "target_ref": command["target_ref"],
            "expected_revisions": _clone(command["expected_revisions"]),
        }
        if command["supplied_input"]["action_class"] == "save":
            payload["presentation_state"] = {
                "ui_draft": [
                    _clone(draft) for draft in self.ui_draft.values()
                    if draft["context_ref"] == self.view_context
                ],
                "preferences": _clone(self.preferences),
                "annotation": [
                    _clone(note) for note in self.annotation.values()
                    if note["timeline_scope"] == list(
                        _scope(self.view_context, access=False)
                    )
                ],
            }
        return payload

    def _command_receipt(self, command: JSONObject) -> JSONObject:
        # Intent remains anchored to its original cut. Results have their own
        # committed cut and must not disappear merely because the action moved
        # the context forward.
        result_context = next((
            block["context_ref"]
            for block in reversed(self.chronicle["blocks"])
            if block["id"].startswith(command["command_id"] + ":result:")
        ), command["context_ref"])
        current = result_context == self.view_context
        return {
            "command_id": command["command_id"],
            "idempotency_key": command["idempotency_key"],
            "stage": command["stage"],
            "accepted_pending": command["accepted_pending"],
            "context_ref": _clone(command["context_ref"]),
            "result_context_ref": _clone(result_context),
            "completed_effects": _clone(command["completed_effects"]) if current else [],
            "pending_workflows": _clone(command["pending_workflows"]) if current else [],
            "failed_attempts": _clone(command["failed_attempts"]),
            "next_choices": _clone(command["next_choices"]) if current else [],
            "historical_result": not current,
        }

    def _append_block(self, block: JSONObject) -> None:
        if not any(
            existing["id"] == block["id"] for existing in self.chronicle["blocks"]
        ):
            self.chronicle["blocks"].append(_clone(block))

    def _consume_command(self, key: str, response: JSONObject) -> None:
        command = self.command_presentation[key]
        _require(response.get("command_id") == command["command_id"], "unavailable")
        _require(
            response.get("idempotency_key") == command["idempotency_key"],
            "unavailable",
        )
        status = response.get("status")
        _require(
            status in {
                "accepted", "pending", "completed", "partial", "failed",
                "conflict", "needs_clarification",
            },
            "unavailable",
        )
        policy = self._envelope(response, allow_advance=True)
        action = command["supplied_input"]["action_class"]
        owner = _ACTION_OWNERS[action]

        visible = self._filter_fields(
            _OWNER_SURFACES[owner], response.get("fields", []), policy
        )
        references = self._remember_fields(visible, self.view_context)
        by_id = {
            self.visible_field[reference]["id"]: reference
            for reference in references
        }

        if status in {"accepted", "pending"}:
            command["stage"] = "processing"
            command["accepted_pending"] = True
        else:
            command["stage"] = "result"
            command["accepted_pending"] = False

        command["completed_effects"] = [
            {
                "context_ref": self.context(),
                "field_ref": by_id[reference],
                "field": _clone(self.visible_field[by_id[reference]]),
            }
            for reference in response.get("completed_effects", [])
            if type(reference) is str and reference in by_id
        ]
        command["pending_workflows"] = [
            reference for reference in response.get("pending_workflows", [])
            if type(reference) is str and reference in policy["workflow_refs"]
        ]
        command["failed_attempts"] = [
            _safe_error(reason)
            for reason in response.get("failed_attempts", [])
            if type(reason) is str
        ]
        if status in {"failed", "conflict", "needs_clarification"}:
            command["failed_attempts"].append(_safe_error(
                status if status in _ERRORS else "unavailable"
            ))
        command["next_choices"] = self._options(
            response.get("next_choices", []), policy
        )

        if "pending_choice" in response:
            self.navigation["pending_choice"] = self._boundary(
                response["pending_choice"], policy
            )
        if self.navigation["pending_choice"] is not None and status not in {
            "accepted", "pending",
        }:
            command["stage"] = "next_choice"

        self.input["clarification_pending"] = status == "needs_clarification"
        self.information_presentation["pending_acquisition"] = bool(
            command["pending_workflows"]
        )

        if visible:
            self._snapshot(_OWNER_SURFACES[owner], visible)

        # Submitted input is preserved exactly, never replaced by narration.
        if status in {"accepted", "pending", "completed", "partial"}:
            self._append_block({
                "id": command["command_id"] + ":input",
                "context_ref": _clone(command["context_ref"]),
                "source_anchor": command["context_ref"]["event_cut"],
                "kind": "player_input",
                "content": _clone(command["supplied_input"]),
            })

        if status not in {"accepted", "pending"}:
            self._append_block({
                "id": command["command_id"] + ":result:" + _digest(response["context"]),
                "context_ref": self.context(),
                "source_anchor": self.view_context["event_cut"],
                "kind": "committed_visible_result",
                "content": {
                    "completed_effects": _clone(command["completed_effects"]),
                    "pending_workflows": _clone(command["pending_workflows"]),
                    "failed_attempts": _clone(command["failed_attempts"]),
                },
            })

        if response.get("encounter_ended") is True and owner == "combat":
            self.navigation["active_surface"] = "chronicle"
            self.navigation["pending_choice"] = None
            command["next_choices"] = []
            command["stage"] = "result"

        self._ingest_notifications(response.get("notifications", []), policy)

        if "selected_context" in response:
            _require(
                owner == "timelines"
                and action in {"load", "branch", "correct_history"}
                and status == "completed",
                "unavailable",
            )
            self._restore_timeline(
                response["selected_context"],
                response.get("restored_ui", {}),
                command["supplied_input"],
            )

        self.cache_and_loading["loading_status"] = (
            "processing_action" if command["accepted_pending"]
            else "saved_result_available"
        )
        self.chronicle["generation_pending"] = False

    def _consume_atomically(self, key: str, response: JSONObject) -> None:
        candidate = _clone(self)
        candidate._consume_command(key, response)
        self._copy_from(candidate)

    def _submit(self, request: JSONObject) -> JSONObject:
        supplied = request.get("supplied_input")
        target = request.get("target_ref")
        idempotency_key = _text(request.get("idempotency_key"))
        request_id = _text(request.get("request_id"))
        revisions = _validate_revisions(request.get("expected_revisions"))
        key = self._command_key(idempotency_key)

        existing = self.command_presentation.get(key)
        if existing is not None:
            _require(
                existing["supplied_input"] == supplied
                and existing["target_ref"] == target
                and existing["expected_revisions"] == revisions,
                "idempotency_conflict",
            )
            return {"command": self._command_receipt(existing), "duplicate": True}

        self._same_context(request.get("context"))
        policy = self._policy()
        supplied = self._validate_intent(supplied, target, policy)
        _require(
            revisions == self.cache_and_loading["relevant_owner_revisions"]
            and revisions == policy["owner_revisions"],
            "conflict",
        )
        _require(
            self._authorized(request, supplied, target, policy),
            "authorization_required",
        )
        _require(
            supplied.get("conditional_plan") is not True,
            "needs_clarification",
        )

        # Store intent before invoking a dependency. An uncertain transport result
        # is checked using "result"; it never triggers another submission here.
        command = {
            "command_id": key,
            "request_id": request_id,
            "idempotency_key": idempotency_key,
            "context_ref": self.context(),
            "supplied_input": supplied,
            "target_ref": target,
            "expected_revisions": revisions,
            "stage": "commit",
            "preview": None,
            "accepted_pending": False,
            "completed_effects": [],
            "pending_workflows": [],
            "failed_attempts": [],
            "next_choices": [],
        }
        self.command_presentation[key] = command
        self.cache_and_loading["loading_status"] = "processing_action"

        draft_id = request.get("draft_id")
        if draft_id is not None:
            draft = self.ui_draft.get(draft_id)
            if (
                draft is not None
                and draft["context_ref"] == self.view_context
                and draft["content_ref"] == supplied
                and draft["target_ref"] == target
            ):
                draft["submitted_command_id"] = key
                draft["status"] = "submitted"

        try:
            owner = _ACTION_OWNERS[supplied["action_class"]]
            response = _dependency(owner, self._command_request(command, "submit"))
            self._consume_atomically(key, response)
        except Exception:
            return {
                "command": self._command_receipt(self.command_presentation[key]),
                "result_pending": True,
                "message": _ERRORS["result_pending"],
            }

        return {
            "command": self._command_receipt(self.command_presentation[key]),
            "duplicate": False,
        }

    def _poll(self, request: JSONObject) -> JSONObject:
        key = self._command_key(_text(request.get("idempotency_key")))
        command = self.command_presentation.get(key)
        _require(command is not None, "unavailable")
        _require(
            _scope(command["context_ref"], access=False)
            == _scope(self.view_context, access=False),
            "unavailable",
        )
        if command["stage"] in {"result", "next_choice"}:
            return {"command": self._command_receipt(command)}

        try:
            owner = _ACTION_OWNERS[command["supplied_input"]["action_class"]]
            response = _dependency(owner, self._command_request(command, "result"))
            self._consume_atomically(key, response)
        except Exception:
            return {
                "command": self._command_receipt(self.command_presentation[key]),
                "result_pending": True,
                "message": _ERRORS["result_pending"],
            }
        return {"command": self._command_receipt(self.command_presentation[key])}

    def _restore_timeline(
        self, context: Any, restored: Any, supplied: JSONObject
    ) -> None:
        context = _validate_context(context)
        _require(
            context["campaign_id"] == self.view_context["campaign_id"]
            and context["actor_id"] == self.view_context["actor_id"],
            "unavailable",
        )
        if "timeline_id" in supplied:
            _require(context["timeline_id"] == supplied["timeline_id"], "conflict")
        _require(type(restored) is dict, "unavailable")
        policy = self._policy(context)

        self.view_context = context
        self.entitlement_manifest = _clone(policy["manifest"])
        self.cache_and_loading["relevant_owner_revisions"] = _clone(
            policy["owner_revisions"]
        )
        self.cache_and_loading["last_valid_scoped_views"] = []
        self.cache_and_loading["pending_callbacks"] = []
        self.navigation.update({
            "active_surface": "chronicle",
            "back_path": [],
            "source_anchor": context["event_cut"],
            "reading_position": None,
            "focused_control": None,
            "selection": None,
            "pending_choice": self._boundary(
                restored.get("pending_choice"), policy
            ),
            "view_changed": True,
        })
        self.input.update({
            "communication_channel": None,
            "communication_context": None,
            "authorized_delegation": None,
            "clarification_pending": False,
        })
        self.ui_draft.clear()
        self.notification_presentation.update({
            "queue": [],
            "history": [],
            "active_low_urgency_banner": None,
        })
        self.information_presentation.update({
            "unknown": False,
            "inaccessible_known_source": False,
            "stale": False,
            "conflicting": False,
            "pending_acquisition": False,
            "identity_mapping": {},
        })

        for draft in restored.get("ui_draft", []):
            if type(draft) is not dict or draft.get("context_ref") != context:
                continue
            self._draft({
                "id": draft.get("id"),
                "input_kind": draft.get("input_kind"),
                "content_ref": draft.get("content_ref"),
                "target_ref": draft.get("target_ref"),
            })

        if "preferences" in restored:
            self._preferences({"changes": restored["preferences"]})

        for note in restored.get("annotation", []):
            if (
                type(note) is dict
                and note.get("player_ref") == context["actor_id"]
                and note.get("timeline_scope")
                == list(_scope(context, access=False))
                and note.get("canonical_status") == "noncanonical"
            ):
                self._annotate({
                    "id": note.get("id"),
                    "subject_ref": note.get("subject_ref"),
                    "content_ref": note.get("content_ref"),
                    "created_at": note.get("created_at"),
                })

    def _ingest_notifications(self, identifiers: Any, policy: JSONObject) -> None:
        _require(type(identifiers) is list, "unavailable")
        for identifier in identifiers:
            if type(identifier) is not str:
                continue
            grant = policy["notification_grants"].get(identifier)
            if type(grant) is not dict:
                continue
            source = self._source(grant.get("source_ref"), policy)
            if source is None:
                continue
            urgency = grant.get("urgency")
            if urgency not in _URGENCIES:
                continue
            if urgency == "required_choice" and self.navigation["pending_choice"] is None:
                continue

            deduplication_key = "notice_" + _digest(
                _scope(self.view_context),
                source["id"],
                grant.get("deduplication_key", identifier),
            )
            if any(
                notice["deduplication_key"] == deduplication_key
                for notice in self.notification.values()
            ):
                continue

            # Content is policy-approved acquired content, never owner raw text.
            content = grant.get("content")
            if type(content) is not str:
                continue
            source = {**source, "content": content}
            reference = "notification_" + _digest(
                _scope(self.view_context), identifier, deduplication_key
            )
            self.notification[reference] = {
                "id": reference,
                "context_ref": self.context(),
                "acquisition_or_system_ref": source,
                "urgency": urgency,
                "presentation_status": "queued",
                "deduplication_key": deduplication_key,
            }
            self.notification_presentation["history"].append(reference)
            self.notification_presentation["queue"].append(reference)
        self._promote_banner()

    def _promote_banner(self) -> None:
        _require(
            self.notification_presentation["low_urgency_banner_limit"] == 1,
            "unavailable",
        )
        active = self.notification_presentation["active_low_urgency_banner"]
        if active is not None:
            return
        for reference in self.notification_presentation["queue"]:
            notice = self.notification[reference]
            if (
                notice["urgency"] in {"ordinary", "out_of_world"}
                and notice["presentation_status"] == "queued"
                and _scope(notice["context_ref"]) == _scope(self.view_context)
            ):
                notice["presentation_status"] = "shown"
                self.notification_presentation["active_low_urgency_banner"] = reference
                return

    def _notifications(self) -> JSONObject:
        permitted = [
            _clone(self.notification[reference])
            for reference in self.notification_presentation["history"]
            if _scope(self.notification[reference]["context_ref"])
            == _scope(self.view_context)
        ]
        return {
            "history": permitted,
            "active_low_urgency_banner":
                self.notification_presentation["active_low_urgency_banner"],
            "urgent": [
                notice for notice in permitted
                if notice["urgency"] in {"required_choice", "known_immediate_concern"}
                and notice["presentation_status"] != "dismissed"
            ],
        }

    def _dismiss(self, request: JSONObject) -> JSONObject:
        reference = request.get("id")
        notice = self.notification.get(reference)
        _require(
            notice is not None
            and _scope(notice["context_ref"]) == _scope(self.view_context),
            "unavailable",
        )
        notice["presentation_status"] = "dismissed"
        self.notification_presentation["queue"] = [
            item for item in self.notification_presentation["queue"]
            if item != reference
        ]
        if self.notification_presentation["active_low_urgency_banner"] == reference:
            self.notification_presentation["active_low_urgency_banner"] = None
        self._promote_banner()
        # The owner commitment and pending choice are deliberately untouched.
        return self._notifications()

    def _draft(self, request: JSONObject) -> JSONObject:
        identifier = _text(request.get("id"))
        kind = request.get("input_kind")
        _require(kind in {"say", "listed_action", "freeform", "conditional_plan"})
        content = request.get("content_ref")
        _require(type(content) in (str, dict) and _json_valid(content))
        target = request.get("target_ref")
        policy = self._policy()
        _require(target is None or target in policy["subject_refs"], "unavailable")
        draft = {
            "id": identifier,
            "context_ref": self.context(),
            "input_kind": kind,
            "content_ref": _clone(content),
            "target_ref": target,
            "submitted_command_id": None,
            "status": "draft",
        }
        self.ui_draft[identifier] = draft
        return {"draft": _clone(draft)}

    def _annotate(self, request: JSONObject) -> JSONObject:
        identifier = _text(request.get("id"))
        content = _text(request.get("content_ref"), empty=True)
        timestamp = _text(request.get("created_at"))
        subject = request.get("subject_ref")
        policy = self._policy()
        _require(subject is None or subject in policy["subject_refs"], "unavailable")
        note = {
            "id": identifier,
            "player_ref": self.view_context["actor_id"],
            "timeline_scope": list(_scope(self.view_context, access=False)),
            "subject_ref": subject,
            "content_ref": content,
            "canonical_status": "noncanonical",
            "created_at": timestamp,
        }
        storage_key = "annotation_" + _digest(note["timeline_scope"], identifier)
        previous = self.annotation.get(storage_key)
        if previous is not None:
            note["created_at"] = previous["created_at"]
        self.annotation[storage_key] = note
        return {"annotation": _clone(note)}

    def _preferences(self, request: JSONObject) -> JSONObject:
        changes = request.get("changes")
        _require(type(changes) is dict and set(changes) <= set(self.preferences))
        _require(_json_valid(changes))
        if "theme" in changes:
            _text(changes["theme"])
        if "density" in changes:
            _require(changes["density"] in {"compact", "normal", "detailed"})
        if "point_of_view" in changes:
            _require(changes["point_of_view"] in {
                "first_person", "second_person", "third_person",
            })
        if "known_data_sorting" in changes:
            sorting = changes["known_data_sorting"]
            _require(type(sorting) is dict)
            _require(set(sorting) == {"field", "descending"})
            _require(sorting["field"] in {"field_kind", "value_ref", "freshness"})
            _require(type(sorting["descending"]) is bool)
        for key in ("panel_visibility", "motion_sound_vibration", "accessibility"):
            if key in changes:
                _require(
                    type(changes[key]) is dict
                    and all(type(value) is bool for value in changes[key].values())
                )
        self.preferences.update(_clone(changes))
        return {"preferences": _clone(self.preferences)}

    def _navigate(self, request: JSONObject) -> JSONObject:
        surface = request.get("surface")
        policy = self._policy()
        _require(
            surface in policy["available_surfaces"]
            or surface in {"what_changed", "notifications"},
            "unavailable",
        )
        self.navigation["back_path"].append({
            "active_surface": self.navigation["active_surface"],
            "source_anchor": self.navigation["source_anchor"],
            "reading_position": self.navigation["reading_position"],
            "focused_control": self.navigation["focused_control"],
            "selection": _clone(self.navigation["selection"]),
        })
        self.navigation["active_surface"] = surface
        self.navigation["view_changed"] = False
        return {"navigation": _clone(self.navigation)}

    def _back(self) -> JSONObject:
        if self.navigation["back_path"]:
            previous = self.navigation["back_path"].pop()
            self.navigation.update(previous)
        else:
            self.navigation["active_surface"] = "chronicle"
        return {"navigation": _clone(self.navigation)}

    def _delta(self, request: JSONObject) -> JSONObject:
        previous = self.surface_view.get(request.get("from_view_ref"))
        current = self.surface_view.get(request.get("to_view_ref"))
        _require(previous is not None and current is not None, "unavailable")
        _require(current["context_ref"] == self.view_context, "conflict")
        _require(
            _scope(previous["context_ref"]) == _scope(current["context_ref"])
            and previous["surface_kind"] == current["surface_kind"]
            and previous["context_ref"]["view_revision"]
            <= current["context_ref"]["view_revision"],
            "conflict",
        )

        policy = self._policy()
        surface = current["surface_kind"]
        previous_fields = self._filter_fields(
            surface,
            [self.visible_field[ref] for ref in previous["fields_ref"]],
            policy,
        )
        current_fields = self._filter_fields(
            surface,
            [self.visible_field[ref] for ref in current["fields_ref"]],
            policy,
        )
        old_by_id = {value["id"]: value for value in previous_fields}
        changes: list[JSONObject] = []
        sources: list[JSONObject] = []

        for value in current_fields:
            old = old_by_id.get(value["id"])
            compared = ("value_ref", "confidence", "source_class", "freshness")
            if old is not None and all(old[key] == value[key] for key in compared):
                continue
            change = {
                "field_id": value["id"],
                "current": _clone(value),
                "source_ref": _clone(value["acquisition_ref"]),
            }
            if old is not None:
                change["prior"] = _clone(old)
            source = value["acquisition_ref"]
            if source is not None:
                change["acquired_at"] = source["acquired_at"]
                if "owner_action_ref" in source:
                    change["owner_action_ref"] = source["owner_action_ref"]
                sources.append(_clone(source))
            changes.append(change)

        # Omitted fields never imply disappearance. Discovered absence must be
        # represented by a newly acquired field supplied by its owner.
        identifier = "delta_" + _digest(previous["id"], current["id"], changes)
        delta = {
            "id": identifier,
            "from_view_ref": previous["id"],
            "to_view_ref": current["id"],
            "visible_change_refs": changes,
            "source_refs": sources,
            "status": "changed" if changes else "no_change",
        }
        self.known_delta[identifier] = delta
        return {"delta": _clone(delta)}

    def _history(self) -> JSONObject:
        return {
            "blocks": [
                _clone(block) for block in self.chronicle["blocks"]
                if _scope(block["context_ref"]) == _scope(self.view_context)
                and block["context_ref"]["view_revision"]
                <= self.view_context["view_revision"]
            ],
            "presentation_version": self.chronicle["presentation_version"],
            "generation_pending": self.chronicle["generation_pending"],
        }

    def _retry_presentation(self) -> JSONObject:
        safe_history = self._history()
        self.chronicle["generation_pending"] = True
        try:
            # AI sees only the permitted history. Its unverified prose is never
            # accepted as state, a result, an acquisition, or a new player action.
            _dependency("events", {
                "operation": "narrate",
                "context": self.context(),
                "permitted_context": safe_history,
                "pending_choice": _clone(self.navigation["pending_choice"]),
            })
        except Exception:
            pass
        self.chronicle["generation_pending"] = False
        self.chronicle["presentation_version"] += 1
        return {
            "history": self._history(),
            "fallback": True,
            "pending_choice": _clone(self.navigation["pending_choice"]),
        }

    def _dispatch(self, request: JSONObject) -> JSONObject:
        operation = request.get("operation")
        if operation == "query":
            return self._query(request)
        if operation == "navigate":
            return self._navigate(request)
        if operation in {"back", "close"}:
            return self._back()
        if operation == "set_mode":
            mode = request.get("mode")
            _require(mode in {"game", "story"})
            self.input["presentation_mode"] = mode
            return {"presentation_mode": mode}
        if operation == "draft":
            return self._draft(request)
        if operation == "annotate":
            return self._annotate(request)
        if operation == "preferences":
            return self._preferences(request)
        if operation == "preview":
            return self._preview(request)
        if operation == "submit":
            return self._submit(request)
        if operation == "poll":
            return self._poll(request)
        if operation == "notifications":
            return self._notifications()
        if operation == "dismiss_notification":
            return self._dismiss(request)
        if operation == "delta":
            return self._delta(request)
        if operation == "history":
            return self._history()
        if operation == "retry_presentation":
            return self._retry_presentation()
        if operation in {"search", "export"}:
            reference = request.get("view_ref")
            snapshot = self.surface_view.get(reference)
            _require(snapshot is not None, "unavailable")
            _require(snapshot["context_ref"] == self.view_context, "conflict")
            policy = self._policy()
            visible = self._filter_fields(
                snapshot["surface_kind"],
                [self.visible_field[ref] for ref in snapshot["fields_ref"]],
                policy,
            )
            snapshot = self._snapshot(snapshot["surface_kind"], visible)
            query = (
                _text(request.get("query"), empty=True)
                if operation == "search" else None
            )
            return {"view": self._page(snapshot, request, query=query)}
        raise ContractError("unsupported")

    def step(self, request: JSONObject) -> JSONObject:
        """
        Process one typed JSON request without mutating external canonical state.

        Local failures are atomic. Once a submit may have reached an owner, its
        command record is retained and subsequent calls use status retrieval.
        The host must keep this instance server-private.
        """
        with _LOCK:
            try:
                _require(type(request) is dict and _json_valid(request))
                _require(
                    len(json.dumps(request, ensure_ascii=False)) <= 1_000_000
                )
                supplied_context = _validate_context(request.get("context"))
                _require(
                    _scope(supplied_context) == _scope(self.view_context),
                    "conflict",
                )
                # An exact duplicate can retrieve its receipt after a revision
                # advance. A new submission still requires the current context.
                if request.get("operation") != "submit":
                    self._same_context(supplied_context)

                candidate = _clone(self)
                payload = candidate._dispatch(_clone(request))
                _require(_json_valid(payload), "unavailable")
                self._copy_from(candidate)

                result: JSONObject = {
                    "ok": True,
                    "context": self.context(),
                    "payload": payload,
                    "pending_choice": _clone(self.navigation["pending_choice"]),
                    "loading_status": self.cache_and_loading["loading_status"],
                }

                # Rendering receives exactly the source-safe semantic contract.
                # Renderer output cannot replace or enrich that contract.
                try:
                    request_theme_accessibility({
                        "semantic_contract": _clone(result),
                        "preferences": _clone(self.preferences),
                    })
                except Exception:
                    pass

                return result
            except ContractError as error:
                return {
                    "ok": False,
                    "context": self.context(),
                    "error": _safe_error(error.code),
                    "pending_choice": _clone(self.navigation["pending_choice"]),
                }
            except Exception:
                return {
                    "ok": False,
                    "context": self.context(),
                    "error": _safe_error("unavailable"),
                    "pending_choice": _clone(self.navigation["pending_choice"]),
                }


def main() -> None:
    """Optional JSON-lines transport; emits no private state or exception text."""
    import sys

    interface = System26.create()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            response = interface.step(request)
        except Exception:
            response = {
                "ok": False,
                "context": interface.context(),
                "error": _safe_error("invalid_request"),
            }
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
