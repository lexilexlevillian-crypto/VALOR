"""Isolated System 19 coordinator. Python 3.11+, standard library only.

Times are canonical seconds. References are opaque strings; scheduler decisions
and workflow stage references are JSON records. Undefined content rules are
required from versioned fixtures, never guessed. Dependency adapters below are
stateless JSON stubs, not implementations of their owning systems.
Workflow status strings are local operational labels, not inferred domain enums.
Empty reference strings represent unfilled coordinator stages, never zero-valued
knowledge, confidence, relationship, or health data.

Command JSON:
  {"command": str, "encounter_id": str, "actor_id": str,
   "payload": dict, "envelope": {"authority_ref": str,
     "expected_revision": int, "canonical_timestamp": number,
     "correlation_id": str, "idempotency_key": str}}

Each mutation is durably represented in the returned state. Persist that state
before publishing results. Production storage must serialize calls per state;
this module intentionally has no database, network, or foreign-state setters.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
from dataclasses import dataclass, field, fields
from typing import Any, Callable, TypedDict

JSON = dict[str, Any]


class Envelope(TypedDict):
    authority_ref: str
    expected_revision: int
    canonical_timestamp: float
    correlation_id: str
    idempotency_key: str


class Command(TypedDict):
    command: str
    encounter_id: str
    actor_id: str
    payload: JSON
    envelope: Envelope


class Reply(TypedDict):
    status: str
    data: JSON


SCHEMA = {
    "encounter": "id phase initiating_event policy_version canonical_time revision linked_encounter_ids",
    "participant": "encounter_id character_id role goal_ref position_ref function_revision status",
    "commitment": "id encounter_id actor_id template_version objective_ref target_ref starts_at completes_at prerequisites_ref reservations_ref status",
    "reaction": "id initiating_action_id actor_id cue_event_id eligibility_ref response_ref status",
    "engagement": "id actors_ref type constrained_channels maintenance_ref started_event ended_event",
    "restraint": "id target_id item_id constraints_ref application_event release_event",
    "pursuit": "id encounter_id pursuer_ids quarry_ref contact_refs route_refs separation_band status",
    "contact": "id observer_id target_ref knowledge_kind last_confirmed_at observation_event confidence",
    "encounter_event": "id encounter_id action_id occurred_at processed_at cause_ref result_ref domain_effect_refs idempotency_key",
    "position_projection": "location_id anchor_id posture engagement_refs observation_context_ref coordinates_ref",
    "target_context": "target_type target_ref knowledge_basis_ref spatial_context_ref",
    "scheduler_state": "scheduling_policy_version initiative_result_refs snapshot_revision tie_decisions pending_choice_refs pending_boundary_ref reservation_ownership_refs seeded_check_result_refs",
    "commitment_detail": "action_channels interrupt_points cancellation_policy_ref consumption_boundary_ref reaction_compatibility_ref",
    "automatic_defense_policy": "scope_ref movement_authorized acceptable_costs_ref assumptions_ref",
    "guard_state": "commitment_id threat_class expires_at_boundary_ref",
    "control_detail": "controller_ids controlled_actor_id control_state contact_context_ref posture_relation_ref maintenance_conditions_ref",
    "surrender_or_pause": "offer_event_ref actor_id supplied_intent_ref conditions_ref recipient_observation_refs response_refs adopting_participant_ids compliance_scope_ref",
    "pursuit_detail": "mode last_known_context_refs observation_channel_refs exertion_input_refs objective_refs stop_conditions_ref",
    "search_context": "actor_id scope_ref method_ref information_basis_ref context_revision commitment_id stored_result_ref",
    "npc_decision_record": "actor_id goal_ref available_information_ref morale_input_refs selected_intent_ref",
    "effect_workflow": "action_id resolved_result_ref resource_commit_refs domain_effect_refs observation_event_refs stage_status_refs idempotency_keys integration_error_refs",
    "event_detail": "actor_refs target_refs location_ref resource_refs observation_cue_refs supported_trace_refs",
    "aftermath": "handoff_refs summary_ref closure_reason",
    "timing_manifest": "quick_action_seconds short_local_movement_seconds longer_manipulation_seconds eligible_reaction_max_seconds duration_overrides route_duration_source",
    "action_template": "version intent_family target_type spatial_requirements_ref item_requirements_ref function_requirements_ref timing_ref contested_question_ref effects_by_result_band_ref observation_cues_ref interruption_rules_ref concurrent_channels_ref",
    "check_request": "actor_capability_ref objective_ref opponent_response_ref difficulty_basis_ref circumstance_groups outcome_bands",
    "impact_proposal": "mechanism_category affected_target_context_ref effect_band circumstance_refs",
    "mutation_envelope": "authority_ref expected_revision canonical_timestamp correlation_id idempotency_key",
}
OPTIONAL = {
    "engagement": {"ended_event"}, "restraint": {"release_event"},
    "position_projection": {"coordinates_ref"}, "check_request": {"opponent_response_ref"},
    "encounter_event": {"action_id", "result_ref"},
}
PHASES = {"ordinary", "tension", "active", "suspended", "aftermath", "closed"}
BANDS = {"success", "partial_success", "failure", "critical_success", "critical_failure"}
GROUPS = {"position", "awareness", "relevant_function", "environmental_interference", "assistance", "time_pressure"}
LIVE = {"reserving", "committed", "resolving", "cancelling", "interrupting"}
QUERIES = {"PreviewIntent", "GetKnownEncounter", "GetFeasibleActions", "GetKnownRoutes", "GetObservedThreats", "GetAftermathSummary"}
SYSTEM_COMMANDS = {"OpenEncounter", "ResolveBoundary", "UpdateContact", "EndEncounter", "RecordWorldEvent", "LinkEncounters"}
LIST_FIELDS = set("linked_encounter_ids constrained_channels pursuer_ids contact_refs route_refs domain_effect_refs engagement_refs initiative_result_refs tie_decisions pending_choice_refs reservation_ownership_refs seeded_check_result_refs action_channels interrupt_points controller_ids recipient_observation_refs response_refs adopting_participant_ids last_known_context_refs observation_channel_refs exertion_input_refs objective_refs morale_input_refs resource_commit_refs observation_event_refs stage_status_refs idempotency_keys integration_error_refs actor_refs target_refs resource_refs observation_cue_refs supported_trace_refs handoff_refs circumstance_groups outcome_bands circumstance_refs".split())
TIME_FIELDS = {"canonical_time", "starts_at", "completes_at", "last_confirmed_at", "occurred_at", "processed_at", "canonical_timestamp"}
INTEGER_FIELDS = {"revision", "snapshot_revision", "context_revision", "expected_revision"}
OPERATIONS = {
    "health": {"impact", "exertion", "medical_concern"},
    "items": {"discharge", "material_impact", "place", "transfer", "retain", "search", "apply_restraint", "release_restraint", "environment"},
    "vehicles": {"drive", "move", "enter", "exit", "depart", "material_impact", "collision"},
    "location": {"move", "displace", "environment"},
    "knowledge": {"acquire", "communicate"},
    "social": {"scoped_event"}, "world": {"communicate", "alarm", "environment", "recording"},
    "institution": {"handoff"},
}


class Rejected(Exception):
    """A safe public rejection; never include hidden targets in its message."""


class Unavailable(Exception):
    def __init__(self, ref: str):
        self.ref = ref


def require(condition: Any, code: str = "unavailable_action") -> None:
    if not condition:
        raise Rejected(code)


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def ident(*parts: Any) -> str:
    return hashlib.sha256(canonical(parts).encode()).hexdigest()


def number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def record(kind: str, value: JSON) -> JSON:
    require(type(value) is dict, "invalid_record")
    allowed = set(SCHEMA[kind].split())
    require(set(value) <= allowed and allowed - OPTIONAL.get(kind, set()) <= set(value), "invalid_record")
    for name, item in value.items():
        if name in LIST_FIELDS:
            require(type(item) is list, "invalid_record")
            require(all(isinstance(v, (str, dict)) if name in {"tie_decisions", "stage_status_refs"} else isinstance(v, str) for v in item), "invalid_record")
        elif name in TIME_FIELDS or name.endswith("_seconds"):
            require(number(item), "invalid_record")
        elif name in INTEGER_FIELDS:
            require(type(item) is int and item >= 0, "invalid_record")
        elif name == "movement_authorized":
            require(type(item) is bool, "invalid_record")
        elif name == "confidence":
            require(isinstance(item, (str, bool)) or number(item), "invalid_record")
        elif name == "function_revision":
            require(isinstance(item, str) or type(item) is int, "invalid_record")
        elif name == "duration_overrides":
            require(isinstance(item, (str, dict, list)), "invalid_record")
        else:
            require(isinstance(item, str), "invalid_record")
    canonical(value)
    return copy.deepcopy(value)


@dataclass(slots=True)
class State:
    """Only architecture-listed state namespaces; keys identify local records."""

    encounter: JSON = field(default_factory=dict)
    participant: JSON = field(default_factory=dict)
    commitment: JSON = field(default_factory=dict)
    reaction: JSON = field(default_factory=dict)
    engagement: JSON = field(default_factory=dict)
    restraint: JSON = field(default_factory=dict)
    pursuit: JSON = field(default_factory=dict)
    contact: JSON = field(default_factory=dict)
    encounter_event: JSON = field(default_factory=dict)
    position_projection: JSON = field(default_factory=dict)
    target_context: JSON = field(default_factory=dict)
    scheduler_state: JSON = field(default_factory=dict)
    commitment_detail: JSON = field(default_factory=dict)
    automatic_defense_policy: JSON = field(default_factory=dict)
    guard_state: JSON = field(default_factory=dict)
    control_detail: JSON = field(default_factory=dict)
    surrender_or_pause: JSON = field(default_factory=dict)
    pursuit_detail: JSON = field(default_factory=dict)
    search_context: JSON = field(default_factory=dict)
    npc_decision_record: JSON = field(default_factory=dict)
    effect_workflow: JSON = field(default_factory=dict)
    event_detail: JSON = field(default_factory=dict)
    aftermath: JSON = field(default_factory=dict)
    timing_manifest: JSON = field(default_factory=dict)
    action_template: JSON = field(default_factory=dict)
    check_request: JSON = field(default_factory=dict)
    impact_proposal: JSON = field(default_factory=dict)
    mutation_envelope: JSON = field(default_factory=dict)

    def dump(self) -> JSON:
        return copy.deepcopy({f.name: getattr(self, f.name) for f in fields(self)})

    @classmethod
    def load(cls, data: JSON) -> State:
        require(type(data) is dict and set(data) == set(SCHEMA), "invalid_state")
        state = cls()
        for kind, records in data.items():
            require(type(records) is dict, "invalid_state")
            setattr(state, kind, {key: record(kind, value) for key, value in records.items()})
        for encounter in state.encounter.values():
            require(encounter["phase"] in PHASES and number(encounter["canonical_time"]), "invalid_state")
            require(type(encounter["revision"]) is int and encounter["revision"] >= 0, "invalid_state")
        for action in state.commitment.values():
            require(action["status"] in LIVE | {"completed", "cancelled", "interrupted"}, "invalid_state")
            require(number(action["starts_at"]) and number(action["completes_at"]) and action["starts_at"] < action["completes_at"], "invalid_state")
            require(action["encounter_id"] in state.encounter and action["template_version"] in state.action_template, "invalid_state")
            require(action["id"] in state.commitment_detail and action["id"] in state.effect_workflow, "invalid_state")
        for kind in ("encounter", "commitment", "reaction", "engagement", "restraint", "pursuit", "contact", "encounter_event"):
            require(all(key == value["id"] for key, value in getattr(state, kind).items()), "invalid_state")
        for flow in state.effect_workflow.values():
            names = [stage["stage"] for stage in flow["stage_status_refs"]]
            require(len(names) == len(set(names)), "invalid_state")
        occupied: set[tuple[str, str]] = set()
        for action in state.commitment.values():
            if action["status"] in LIVE:
                for channel in state.commitment_detail[action["id"]]["action_channels"]:
                    pair = (action["actor_id"], channel)
                    require(pair not in occupied, "invalid_state")
                    occupied.add(pair)
        reactions: set[tuple[str, str]] = set()
        for reaction in state.reaction.values():
            require(reaction["status"] in {"eligible", "chosen", "resolved", "interrupted"}, "invalid_state")
            pair = (reaction["actor_id"], reaction["initiating_action_id"])
            require(pair not in reactions, "invalid_state")
            reactions.add(pair)
        return state


def dummy_dependency(owner: str, operation: str, request: JSON) -> JSON:
    """Fail-closed placeholder: no domain logic, RNG, IO, or foreign mutation."""
    return {"status": "unavailable", "ref": f"dummy:{owner}:{operation}"}


def request_player_input(operation: str, request: JSON) -> JSON:
    return dummy_dependency("player", operation, request)


def request_system_10(operation: str, request: JSON) -> JSON:
    return dummy_dependency("checks", operation, request)


def request_system_11(operation: str, request: JSON) -> JSON:
    return dummy_dependency("time", operation, request)


def request_system_12(operation: str, request: JSON) -> JSON:
    return dummy_dependency("location", operation, request)


def request_system_15(operation: str, request: JSON) -> JSON:
    return dummy_dependency("items", operation, request)


def request_system_17(operation: str, request: JSON) -> JSON:
    return dummy_dependency("vehicles", operation, request)


def request_system_18(operation: str, request: JSON) -> JSON:
    return dummy_dependency("health", operation, request)


def request_systems_3_4(operation: str, request: JSON) -> JSON:
    return dummy_dependency("knowledge", operation, request)


def request_systems_7_8(operation: str, request: JSON) -> JSON:
    return dummy_dependency("social", operation, request)


def request_systems_13_16(operation: str, request: JSON) -> JSON:
    return dummy_dependency("world", operation, request)


def request_institution(operation: str, request: JSON) -> JSON:
    return dummy_dependency("institution", operation, request)


def request_npc_source(operation: str, request: JSON) -> JSON:
    return dummy_dependency("npc", operation, request)


def request_content(operation: str, request: JSON) -> JSON:
    return dummy_dependency("content", operation, request)


STUBS: dict[str, Callable[[str, JSON], JSON]] = {
    "player": request_player_input, "checks": request_system_10,
    "time": request_system_11, "location": request_system_12,
    "items": request_system_15, "vehicles": request_system_17,
    "health": request_system_18, "knowledge": request_systems_3_4,
    "social": request_systems_7_8, "world": request_systems_13_16,
    "institution": request_institution, "npc": request_npc_source,
    "content": request_content,
}


class DummyDependencies:
    """Immutable canned responses, keyed by (owner, operation, selector).

    Selectors prefer request.ref, then action_id, then encounter_id. '*' supplies
    an operation default. Fixtures are trusted test/configuration input, never
    part of a player command. Metadata echoing is transport scaffolding only.
    """

    def __init__(self, fixtures: dict[tuple[str, str, str], JSON] | None = None):
        self.fixtures = copy.deepcopy(fixtures or {})

    def call(self, owner: str, operation: str, request: JSON) -> JSON:
        require(owner in STUBS, "invalid_owner")
        selectors = [request.get(k) for k in ("ref", "action_id", "encounter_id", "observer_id", "actor_id")]
        for selector in [*selectors, "*"]:
            if (owner, operation, selector) in self.fixtures:
                result = copy.deepcopy(self.fixtures[owner, operation, selector])
                result.setdefault("ref", "dummy:" + ident(owner, operation, request))
                return result
        return STUBS[owner](operation, request)


class Combat:
    """The JSON state machine. Foreign validation is required, never inferred."""

    def __init__(self, state: State | None = None, dependencies: DummyDependencies | None = None):
        self.state = state or State()
        self.dependencies = dependencies or DummyDependencies()

    def _put(self, kind: str, key: str, value: JSON) -> None:
        getattr(self.state, kind)[key] = record(kind, value)

    def _call(self, owner: str, operation: str, request: JSON) -> JSON:
        result = self.dependencies.call(owner, operation, copy.deepcopy(request))
        require(type(result) is dict, "invalid_integration_result")
        canonical(result)
        if result.get("status") in {"unavailable", "pending", "failed"}:
            raise Unavailable(result.get("ref", f"{owner}:{operation}"))
        require(result.get("status") == "committed" and isinstance(result.get("ref"), str), "invalid_integration_result")
        return result

    def _read(self, ref: str) -> JSON:
        require(isinstance(ref, str) and ref, "missing_content")
        result = self._call("content", "read", {"ref": ref})
        require(type(result.get("data")) is dict, "missing_content")
        return result["data"]

    def _encounter(self, eid: str) -> JSON:
        require(eid in self.state.encounter)
        return self.state.encounter[eid]

    def _scheduler(self, eid: str) -> JSON:
        return self.state.scheduler_state[eid]

    def _participant(self, eid: str, actor: str) -> JSON:
        matches = [p for p in self.state.participant.values() if p["encounter_id"] == eid and p["character_id"] == actor]
        require(len(matches) == 1)
        return matches[0]

    def _context(self, eid: str, aid: str, operation: str) -> JSON:
        return {"encounter_id": eid, "action_id": aid, "causal_event_id": aid,
                "idempotency_key": ident(eid, aid, operation)}

    def _event(self, eid: str, key: str, cause: str, result: str, action: str = "", effects: list[str] | None = None) -> str:
        event_id = "event:" + ident(eid, key)
        value = {"id": event_id, "encounter_id": eid, "occurred_at": self._encounter(eid)["canonical_time"],
                 "processed_at": self._encounter(eid)["canonical_time"], "cause_ref": cause,
                 "result_ref": result, "domain_effect_refs": effects or [], "idempotency_key": key}
        if action:
            value["action_id"] = action
        if event_id in self.state.encounter_event:
            require(self.state.encounter_event[event_id]["cause_ref"] == cause, "idempotency_conflict")
            return event_id
        self._put("encounter_event", event_id, value)
        return event_id

    def _known(self, eid: str, actor: str) -> JSON:
        result = self._call("knowledge", "snapshot", {"encounter_id": eid, "observer_id": actor})
        require(result.get("observer_id") == actor, "invalid_integration_result")
        return result

    def _view(self, eid: str, actor: str) -> JSON:
        e = self._encounter(eid)
        known = self._known(eid, actor)
        visible = set(known.get("visible_actor_ids", [])) | {actor}
        actions = set(known.get("visible_action_ids", []))
        return {"encounter_id": eid, "phase": e["phase"], "canonical_time": e["canonical_time"],
                "revision": e["revision"], "observations": copy.deepcopy(known.get("observations", [])),
                "participants": [p["character_id"] for p in self.state.participant.values()
                                 if p["encounter_id"] == eid and p["character_id"] in visible],
                "commitments": [{k: a[k] for k in ("id", "actor_id", "status")}
                                for a in self.state.commitment.values()
                                if a["encounter_id"] == eid and (a["actor_id"] == actor or a["id"] in actions)],
                "choices": [ref for ref in self._scheduler(eid)["pending_choice_refs"]
                            if self._read(ref).get("actor_id") == actor],
                "contacts": [copy.deepcopy(c) for c in self.state.contact.values()
                             if c["observer_id"] == actor and c["id"] in known.get("contact_ids", [])]}

    def _authorize(self, command: Command) -> JSON:
        envelope = record("mutation_envelope", command["envelope"])
        require(type(envelope["expected_revision"]) is int and number(envelope["canonical_timestamp"]), "invalid_command")
        require(all(isinstance(envelope[k], str) and envelope[k] for k in ("authority_ref", "correlation_id", "idempotency_key")), "invalid_command")
        auth = self._call("player", "authorize", {"ref": envelope["authority_ref"], "command": command["command"],
                         "actor_id": command["actor_id"], "encounter_id": command["encounter_id"]})
        require(auth.get("authorized") is True and command["command"] in auth.get("commands", []), "not_authorized")
        require(command["encounter_id"] in auth.get("encounter_ids", []), "not_authorized")
        require(auth.get("actor_id") == command["actor_id"], "not_authorized")
        if command["command"] in SYSTEM_COMMANDS:
            require(auth.get("kind") == "system", "not_authorized")
        return auth

    def step(self, command: Command) -> Reply:
        """Public output contains only safe acknowledgements or actor-filtered data."""
        try:
            require(type(command) is dict and set(command) == {"command", "encounter_id", "actor_id", "payload", "envelope"}, "invalid_command")
            canonical(command)
            require(type(command["payload"]) is dict, "invalid_command")
            auth = self._authorize(command)
            name, eid = command["command"], command["encounter_id"]
            if name in QUERIES:
                return {"status": "ok", "data": self._query(command)}
            key = command["envelope"]["idempotency_key"]
            event_id = "event:" + ident(eid, "command:" + key)
            fingerprint = "command:" + ident(command)
            if event_id in self.state.encounter_event:
                require(self.state.encounter_event[event_id]["cause_ref"] == fingerprint, "idempotency_conflict")
                return {"status": "replayed", "data": {"receipt_ref": event_id}}
            revision = self.state.encounter.get(eid, {}).get("revision", 0)
            require(command["envelope"]["expected_revision"] == revision, "stale_state")
            if eid in self.state.encounter:
                require(command["envelope"]["canonical_timestamp"] == self._encounter(eid)["canonical_time"], "stale_state")
            handlers = {"OpenEncounter": self._open, "CommitIntent": self._commit_command,
                        "RespondToThreat": self._respond, "CancelCommitment": self._cancel_command,
                        "ResolveBoundary": self._resolve, "UpdateContact": self._contact_command,
                        "OfferSurrender": self._commit_command, "ApplyRestraint": self._commit_command,
                        "EndEncounter": self._end, "RecordWorldEvent": self._world_command,
                        "LinkEncounters": self._link}
            require(name in handlers, "unknown_command")
            before = self.state.dump()
            try:
                result = handlers[name](command, auth)
            except Unavailable as error:
                if eid not in self.state.encounter or self.state.dump() == before:
                    raise
                self._encounter(eid)["phase"] = "suspended"
                result = "pending:" + error.ref
            except (Rejected, KeyError, TypeError, ValueError) as error:
                if self.state.dump() == before:
                    raise
                # An outgoing command may have committed despite a bad/absent
                # acknowledgement. Never erase the durable attempt or its key.
                self._encounter(eid)["phase"] = "suspended"
                result = "pending:integration_error:" + ident(type(error).__name__, str(error))
            self._encounter(eid)["revision"] += 1
            self._put("mutation_envelope", event_id, command["envelope"])
            receipt = self._event(eid, "command:" + key, fingerprint, result)
            return {"status": "pending" if result.startswith("pending:") else "ok", "data": {"receipt_ref": receipt}}
        except Unavailable:
            return {"status": "pending", "data": {"code": "required_dependency_unavailable"}}
        except (KeyError, TypeError, ValueError, OverflowError):
            return {"status": "rejected", "data": {"code": "invalid_contract"}}
        except Rejected as error:
            return {"status": "rejected", "data": {"code": str(error)}}

    def _open(self, c: Command, auth: JSON) -> str:
        eid, payload = c["encounter_id"], c["payload"]
        require(eid not in self.state.encounter, "encounter_exists")
        opening = self._call("world", "opening", {"ref": payload["cause_ref"], "encounter_id": eid})
        require(opening.get("supported") is True and opening.get("phase") in {"tension", "active"})
        clock = self._call("time", "current", {"encounter_id": eid})
        require(number(clock.get("canonical_time")) and clock["canonical_time"] == c["envelope"]["canonical_timestamp"], "stale_state")
        policy = self._read(payload["policy_version"])
        require(isinstance(policy.get("scheduling_policy_version"), str) and "duration_overrides" in policy, "invalid_policy")
        require(type(opening.get("choice_refs", [])) is list and all(isinstance(v, str) for v in opening.get("choice_refs", [])), "invalid_opening")
        participants = [record("participant", p) for p in opening["participants"]]
        require(participants and all(p["encounter_id"] == eid for p in participants))
        require(len({p["character_id"] for p in participants}) == len(participants))
        initiative = []
        if opening.get("initiative_required") is True:
            initiative = [self._call("checks", "initiative", {**self._context(eid, eid, "initiative"), "ref": opening["initiative_ref"]})["ref"]]
        self._put("encounter", eid, {"id": eid, "phase": opening["phase"], "initiating_event": payload["cause_ref"],
                  "policy_version": payload["policy_version"], "canonical_time": clock["canonical_time"], "revision": 0, "linked_encounter_ids": []})
        self._put("scheduler_state", eid, {"scheduling_policy_version": policy["scheduling_policy_version"],
                  "initiative_result_refs": initiative, "snapshot_revision": 0, "tie_decisions": [],
                  "pending_choice_refs": opening.get("choice_refs", []), "pending_boundary_ref": "",
                  "reservation_ownership_refs": [], "seeded_check_result_refs": []})
        for p in participants:
            self._put("participant", ident(eid, p["character_id"]), p)
        self._put("timing_manifest", eid, {"quick_action_seconds": 2, "short_local_movement_seconds": 2,
                  "longer_manipulation_seconds": 4, "eligible_reaction_max_seconds": 1,
                  "duration_overrides": policy["duration_overrides"], "route_duration_source": "System 12"})
        return opening["ref"]

    def _template(self, version: str) -> JSON:
        template = record("action_template", self._read(version))
        require(template["version"] == version, "invalid_template")
        old = self.state.action_template.get(version)
        require(old is None or old == template, "template_version_changed")
        return template

    def _prepare(self, c: Command, auth: JSON | None, preview: bool = False, snapshot: str = "", ignored_actions: set[str] | None = None) -> tuple[JSON, JSON, JSON]:
        eid, actor, p = c["encounter_id"], c["actor_id"], c["payload"]
        e = self._encounter(eid)
        self._participant(eid, actor)
        require(e["phase"] in {"tension", "active", "suspended"})
        template = self._template(p["template_version"])
        rule = self._read(template["interruption_rules_ref"])
        require(rule.get("family") == template["intent_family"], "invalid_template")
        require(all(isinstance(rule.get(k), str) and rule[k] for k in ("cancellation_policy_ref", "consumption_boundary_ref", "reaction_compatibility_ref")), "invalid_template")
        require(type(rule.get("interrupt_points", [])) is list and all(isinstance(v, str) for v in rule.get("interrupt_points", [])), "invalid_template")
        if c["command"] == "OfferSurrender":
            require(template["intent_family"] == "surrender")
        if c["command"] == "ApplyRestraint":
            require(template["intent_family"] == "restrain")
        context = {"encounter_id": eid, "actor_id": actor, "template_version": template["version"],
                   "target_ref": p["target_ref"], "objective_ref": p["objective_ref"], "snapshot_ref": snapshot,
                   "action_id": p.get("action_id", ""), "canonical_time": e["canonical_time"]}
        if p.get("action_id") in self.state.commitment:
            current = self.state.commitment[p["action_id"]]
            context["reservations_ref"] = current["reservations_ref"]
            context["resource_commit_refs"] = self.state.effect_workflow[current["id"]]["resource_commit_refs"]
        known = self._known(eid, actor)
        target = self._call("knowledge", "validate_target", {**context, "known_snapshot_ref": known["ref"], "target_type": template["target_type"]})
        require(target.get("allowed") is True)
        for owner, ref in (("location", template["spatial_requirements_ref"]),
                           ("items", template["item_requirements_ref"]), ("health", template["function_requirements_ref"])):
            validation = self._call(owner, "validate", {**context, "ref": ref})
            require(validation.get("allowed") is True)
        if rule.get("vehicle_requirements_ref"):
            require(self._call("vehicles", "validate", {**context, "ref": rule["vehicle_requirements_ref"]}).get("allowed") is True)
        for ref in rule.get("additional_prerequisite_refs", []):
            requirement = self._read(ref)
            require(requirement["owner"] in STUBS and requirement["owner"] != "content", "invalid_template")
            require(self._call(requirement["owner"], "validate", {**context, "ref": ref}).get("allowed") is True)
        channels = self._read(template["concurrent_channels_ref"])
        require(type(channels.get("action_channels")) is list and channels["action_channels"], "invalid_template")
        require(len(channels["action_channels"]) == len(set(channels["action_channels"])), "invalid_template")
        for existing in self.state.commitment.values():
            if existing["actor_id"] == actor and existing["status"] in LIVE and existing["id"] != p.get("action_id") and existing["id"] not in (ignored_actions or set()):
                existing_plan = self._stage(existing["id"], "reaction_plan")
                if p.get("action_id") and existing_plan and any(change["action_id"] == p["action_id"] for change in existing_plan["changes"]):
                    continue
                other = self.state.commitment_detail[existing["id"]]["action_channels"]
                require(not set(other) & set(channels["action_channels"]), "action_channel_busy")
                require(set(other) <= set(channels.get("compatible_channels", [])), "action_channel_busy")
                old_channels = self._read(self.state.action_template[existing["template_version"]]["concurrent_channels_ref"])
                require(set(channels["action_channels"]) <= set(old_channels.get("compatible_channels", [])), "action_channel_busy")
        for key, engagement in self.state.engagement.items():
            if engagement.get("ended_event"):
                continue
            detail = self.state.control_detail.get(key, {})
            if detail.get("controlled_actor_id") == actor:
                require(not set(channels["action_channels"]) & set(engagement["constrained_channels"]))
            if actor in detail.get("controller_ids", []):
                maintenance = self._read(engagement["maintenance_ref"])
                require(not set(channels["action_channels"]) & set(maintenance.get("occupied_channels", [])))
        for restraint in self.state.restraint.values():
            if restraint["target_id"] == actor and not restraint.get("release_event"):
                constraints = self._read(restraint["constraints_ref"])
                require(not set(channels["action_channels"]) & set(constraints["constrained_channels"]))
        for pause in self.state.surrender_or_pause.values():
            if not p.get("action_id") and actor in pause["adopting_participant_ids"]:
                scope = self._read(pause["compliance_scope_ref"])
                require(template["intent_family"] not in scope["withheld_families"])
        if not preview and auth is not None:
            owner = "npc" if auth.get("kind") == "npc" else "player"
            intent = self._call(owner, "intent", {**context, "ref": p["intent_ref"], "known_snapshot": known})
            require(intent.get("actor_id") == actor and intent.get("authorized") is True, "not_authorized")
            require(all(intent.get(k) == p[k] for k in ("template_version", "target_ref", "objective_ref")), "intent_mismatch")
            if intent.get("delegated") is True:
                policy = record("automatic_defense_policy", self._read(intent["policy_ref"]))
                require(template["intent_family"] in {"guard", "evade", "block"}, "delegation_scope")
                require(not rule.get("counterattack", False), "delegation_scope")
                require(not rule.get("voluntary_movement", False) or policy["movement_authorized"], "delegation_scope")
                require(self._call("player", "validate_policy", {**context, "policy": policy}).get("allowed") is True, "delegation_scope")
                self._validate_delegated_effects(template, policy)
            else:
                require(intent.get("explicit") is True, "not_authorized")
        return template, rule, channels

    def _duration(self, eid: str, template: JSON, rule: JSON) -> float:
        timing = self._read(template["timing_ref"])
        if timing.get("source") == "System 12":
            duration = self._call("location", "duration", {"encounter_id": eid, "ref": template["timing_ref"]})["duration_seconds"]
        elif "duration_seconds" in timing:
            duration = timing["duration_seconds"]
        else:
            require(timing.get("category") in {"quick_action_seconds", "short_local_movement_seconds", "longer_manipulation_seconds"}, "missing_duration")
            duration = self.state.timing_manifest[eid][timing["category"]]
        require(number(duration) and duration > 0, "invalid_duration")
        if rule.get("reaction") is True:
            require(duration <= self.state.timing_manifest[eid]["eligible_reaction_max_seconds"], "invalid_duration")
        return duration

    def _validate_delegated_effects(self, template: JSON, policy: JSON) -> None:
        effects = self._read(template["effects_by_result_band_ref"])
        for band in effects.values():
            for effect in band:
                require((effect["owner"], effect["operation"]) in {("location", "move"), ("encounter", "guard")}, "delegation_scope")
                require(effect["owner"] != "location" or policy["movement_authorized"], "delegation_scope")

    def _resource_time(self, aid: str) -> float:
        action = self.state.commitment[aid]
        boundary = self._read(self.state.commitment_detail[aid]["consumption_boundary_ref"])
        if boundary.get("kind") == "completion":
            return action["completes_at"]
        require(boundary.get("kind") == "offset" and number(boundary.get("offset_seconds")), "invalid_consumption_boundary")
        due = action["starts_at"] + boundary["offset_seconds"]
        require(action["starts_at"] <= due <= action["completes_at"], "invalid_consumption_boundary")
        return due

    def _interrupts(self, aid: str) -> list[tuple[float, str]]:
        action = self.state.commitment[aid]
        result = []
        for ref in self.state.commitment_detail[aid]["interrupt_points"]:
            if self._stage(aid, "interrupt:" + ref):
                continue
            point = self._read(ref)
            require(number(point.get("offset_seconds")), "invalid_interrupt_boundary")
            due = action["starts_at"] + point["offset_seconds"]
            require(action["starts_at"] <= due <= action["completes_at"], "invalid_interrupt_boundary")
            result.append((due, ref))
        return result

    def _consume(self, aid: str) -> None:
        action, flow = self.state.commitment[aid], self.state.effect_workflow[aid]
        if self._stage(aid, "resources"):
            return
        require(self._encounter(action["encounter_id"])["canonical_time"] == self._resource_time(aid), "wrong_consumption_boundary")
        result = self._call("items", "consume", {**self._context(action["encounter_id"], aid, "consume"),
                            "ref": action["reservations_ref"], "result_ref": flow["resolved_result_ref"],
                            "consumption_boundary_ref": self.state.commitment_detail[aid]["consumption_boundary_ref"]})
        require(result.get("committed") is True, "invalid_integration_result")
        flow["resource_commit_refs"].append(result["ref"])
        self._save_stage(aid, "resources", result_ref=result["ref"])

    def _commit_command(self, c: Command, auth: JSON) -> str:
        eid, p, actor = c["encounter_id"], c["payload"], c["actor_id"]
        scheduler = self._scheduler(eid)
        own_choices = [ref for ref in scheduler["pending_choice_refs"] if self._read(ref).get("actor_id") == actor]
        require(not scheduler["pending_boundary_ref"] or p.get("choice_ref") in own_choices, "paused_workflow")
        require(not any(r["actor_id"] == actor and r["status"] == "eligible" and self.state.commitment[r["initiating_action_id"]]["encounter_id"] == eid for r in self.state.reaction.values()), "reaction_required")
        template, rule, channels = self._prepare(c, auth)
        require(rule.get("reaction") is not True, "reaction_required")
        choices = [ref for ref in scheduler["pending_choice_refs"] if self._read(ref).get("actor_id") == actor]
        if choices:
            require(p.get("choice_ref") in choices, "choice_required")
        duration = self._duration(eid, template, rule)
        npc_record = None
        if auth.get("kind") == "npc":
            known = self._known(eid, actor)
            result = self._call("npc", "decision_record", {"ref": p["intent_ref"], "actor_id": actor, "known_snapshot": known})
            npc_record = record("npc_decision_record", result["decision"])
            require(npc_record["actor_id"] == actor and npc_record["selected_intent_ref"] == p["intent_ref"] and npc_record["available_information_ref"] == known["ref"], "invalid_decision_record")
        if scheduler["initiative_result_refs"]:
            opportunity = self._call("time", "commitment_opportunity", {"encounter_id": eid, "actor_id": actor,
                                     "initiative_result_refs": scheduler["initiative_result_refs"], "canonical_time": self._encounter(eid)["canonical_time"]})
            require(opportunity.get("allowed") is True)
        action_id = "action:" + ident(eid, c["envelope"]["idempotency_key"])
        now = self._encounter(eid)["canonical_time"]
        self._put("action_template", template["version"], template)
        self._put("commitment", action_id, {"id": action_id, "encounter_id": eid, "actor_id": actor,
                  "template_version": template["version"], "objective_ref": p["objective_ref"], "target_ref": p["target_ref"],
                  "starts_at": now, "completes_at": now + duration, "prerequisites_ref": template["interruption_rules_ref"],
                  "reservations_ref": "reservation:" + action_id, "status": "reserving"})
        self._put("commitment_detail", action_id, {"action_channels": channels["action_channels"],
                  "interrupt_points": rule.get("interrupt_points", []), "cancellation_policy_ref": rule["cancellation_policy_ref"],
                  "consumption_boundary_ref": rule["consumption_boundary_ref"], "reaction_compatibility_ref": rule["reaction_compatibility_ref"]})
        self._put("effect_workflow", action_id, {"action_id": action_id, "resolved_result_ref": "",
                  "resource_commit_refs": [], "domain_effect_refs": [], "observation_event_refs": [],
                  "stage_status_refs": [], "idempotency_keys": [], "integration_error_refs": []})
        self._pin_content(action_id)
        if npc_record:
            self._put("npc_decision_record", action_id, npc_record)
        self._resource_time(action_id)
        self._interrupts(action_id)
        if choices:
            scheduler["pending_choice_refs"].remove(p["choice_ref"])
        self._reserve(action_id)
        self._encounter(eid)["phase"] = "active"
        return action_id

    def _stage(self, action_id: str, name: str) -> JSON | None:
        return next((s for s in self.state.effect_workflow[action_id]["stage_status_refs"] if s["stage"] == name), None)

    def _save_stage(self, action_id: str, name: str, **data: Any) -> JSON:
        stage = {"stage": name, **copy.deepcopy(data)}
        self.state.effect_workflow[action_id]["stage_status_refs"].append(stage)
        return stage

    def _pin_content(self, aid: str) -> None:
        if self._stage(aid, "content_pins"):
            return
        template = self.state.action_template[self.state.commitment[aid]["template_version"]]
        refs = [template[key] for key in ("version", "timing_ref", "contested_question_ref", "effects_by_result_band_ref", "interruption_rules_ref", "concurrent_channels_ref")]
        rule = self._read(template["interruption_rules_ref"])
        refs += [rule[key] for key in ("cancellation_policy_ref", "consumption_boundary_ref", "reaction_compatibility_ref")]
        refs += rule.get("interrupt_points", [])
        mapping = self._read(template["effects_by_result_band_ref"])
        require(set(mapping) <= BANDS and all(type(effects) is list for effects in mapping.values()), "invalid_template")
        refs += [effect["proposal_ref"] for effects in mapping.values() for effect in effects if effect.get("owner") == "encounter"]
        pins = {ref: ident(self._read(ref)) for ref in sorted(set(refs))}
        self._save_stage(aid, "content_pins", content_hashes=pins)

    def _verify_pins(self, aid: str) -> None:
        self._pin_content(aid)
        pins = self._stage(aid, "content_pins")["content_hashes"]
        if any(ident(self._read(ref)) != digest for ref, digest in pins.items()):
            ref = "integration_error:content_version_changed:" + aid
            flow = self.state.effect_workflow[aid]
            if ref not in flow["integration_error_refs"]:
                flow["integration_error_refs"].append(ref)
            raise Unavailable(ref)

    def _reserve(self, action_id: str) -> None:
        a = self.state.commitment[action_id]
        self._verify_pins(action_id)
        response_plan = self._stage(action_id, "reaction_plan")
        if response_plan:
            for entry in response_plan["changes"]:
                original = self.state.commitment[entry["action_id"]]
                stage = "reaction_change:" + original["id"]
                if self._stage(action_id, stage):
                    continue
                if entry["mode"] == "cancel":
                    original["status"] = "cancelling"
                    self._release(original["id"])
                elif entry["mode"] == "delay":
                    self._call("time", "reschedule", {**self._context(a["encounter_id"], action_id, stage),
                                "original_action_id": original["id"], "completes_at": entry["completes_at"]})
                    original["completes_at"] = entry["completes_at"]
                self._save_stage(action_id, stage, result_ref=entry["compatibility_ref"])
        if not self._stage(action_id, "reserved"):
            result = self._call("items", "reserve", {**self._context(a["encounter_id"], action_id, "reserve"),
                                "ref": a["reservations_ref"], "requirements_ref": self.state.action_template[a["template_version"]]["item_requirements_ref"]})
            require(result.get("reserved") is True, "invalid_integration_result")
            self._save_stage(action_id, "reserved", result_ref=result["ref"])
            self._scheduler(a["encounter_id"])["reservation_ownership_refs"].append(result["ref"])
        if not self._stage(action_id, "scheduled"):
            result = self._call("time", "schedule", {**self._context(a["encounter_id"], action_id, "schedule"),
                                "starts_at": a["starts_at"], "completes_at": a["completes_at"],
                                "interrupt_points": self.state.commitment_detail[action_id]["interrupt_points"]})
            self._save_stage(action_id, "scheduled", result_ref=result["ref"])
        a["status"] = "committed"
        for key, guard in list(self.state.guard_state.items()):
            guarded_action = self.state.commitment[guard["commitment_id"]]
            if guarded_action["actor_id"] == a["actor_id"] and guard["commitment_id"] != action_id:
                self._event(a["encounter_id"], "guard-reconsidered:" + ident(key, action_id), action_id, key)
                del self.state.guard_state[key]

    def _cancel_command(self, c: Command, auth: JSON) -> str:
        aid = c["payload"]["action_id"]
        require(aid in self.state.commitment)
        a = self.state.commitment[aid]
        require(a["actor_id"] == c["actor_id"] and a["encounter_id"] == c["encounter_id"])
        scheduler = self._scheduler(c["encounter_id"])
        require(not scheduler["pending_boundary_ref"] or any(self._read(ref).get("actor_id") == c["actor_id"] for ref in scheduler["pending_choice_refs"]), "paused_workflow")
        require(a["status"] in {"reserving", "committed", "cancelling"})
        policy = self._read(self.state.commitment_detail[aid]["cancellation_policy_ref"])
        require(policy.get("allowed") is True)
        a["status"] = "cancelling"
        self._release(aid)
        return aid

    def _release(self, aid: str) -> None:
        a, flow = self.state.commitment[aid], self.state.effect_workflow[aid]
        if not self._stage(aid, "released"):
            result = self._call("items", "release_unused", {**self._context(a["encounter_id"], aid, "release_unused"),
                                "ref": a["reservations_ref"], "resource_commit_refs": flow["resource_commit_refs"]})
            self._save_stage(aid, "released", result_ref=result["ref"])
        reserved = self._stage(aid, "reserved")
        if reserved and reserved["result_ref"] in self._scheduler(a["encounter_id"])["reservation_ownership_refs"]:
            self._scheduler(a["encounter_id"])["reservation_ownership_refs"].remove(reserved["result_ref"])
        a["status"] = "interrupted" if a["status"] == "interrupting" else "cancelled"

    def _query(self, c: Command) -> JSON:
        name, p, eid, actor = c["command"], c["payload"], c["encounter_id"], c["actor_id"]
        if name == "PreviewIntent":
            template, rule, _ = self._prepare(c, None, preview=True)
            return {"feasible": True, "duration_seconds": self._duration(eid, template, rule),
                    "known_stakes": self._call("knowledge", "stakes", {"encounter_id": eid, "observer_id": actor,
                                                "template_version": template["version"], "target_ref": p["target_ref"]}).get("stakes", [])}
        known = self._known(eid, actor)
        if name == "GetKnownRoutes":
            return {"routes": known.get("known_routes", [])}
        if name == "GetObservedThreats":
            return {"threats": known.get("observed_threats", [])}
        if name == "GetAftermathSummary":
            return {"summary": known.get("aftermath_summary", ""), "known_concerns": known.get("known_concerns", [])}
        if name == "GetFeasibleActions":
            result = []
            for proposal in known.get("action_proposals", []):
                trial = copy.deepcopy(c)
                trial["payload"] = proposal
                try:
                    self._prepare(trial, None, preview=True)
                    result.append(proposal)
                except (Rejected, Unavailable):
                    pass
            return {"actions": result}
        return self._view(eid, actor)

    def _contact_command(self, c: Command, auth: JSON) -> str:
        return self._acquire(c["encounter_id"], c["payload"]["observation_event_ref"])

    def _acquire(self, eid: str, ref: str) -> str:
        result = self._call("knowledge", "acquire", {**self._context(eid, ref, "acquire"), "ref": ref})
        require(result.get("supported") is True, "invalid_integration_result")
        now = self._encounter(eid)["canonical_time"]
        contacts = [record("contact", value) for value in result.get("contacts", [])]
        for contact in contacts:
            self._participant(eid, contact["observer_id"])
            require(contact["knowledge_kind"] in {"confirmed", "last_known", "suspected", "lost"})
            require(number(contact["last_confirmed_at"]) and contact["last_confirmed_at"] <= now)
            old = self.state.contact.get(contact["id"])
            require(old is None or (old["observer_id"] == contact["observer_id"] and old["target_ref"] == contact["target_ref"] and old["last_confirmed_at"] <= contact["last_confirmed_at"]))
        for contact in contacts:
            self._put("contact", contact["id"], contact)
        for eligibility_ref in result.get("reaction_eligibility_refs", []):
            self._offer_reaction(eid, eligibility_ref)
        return result["ref"]

    def _offer_reaction(self, eid: str, ref: str) -> None:
        cue = self._call("knowledge", "reaction_cue", {"ref": ref, "encounter_id": eid})
        require(cue.get("observed") is True and cue.get("eligible") is True)
        actor, aid = cue["actor_id"], cue["initiating_action_id"]
        self._participant(eid, actor)
        require(aid in self.state.commitment and self.state.commitment[aid]["encounter_id"] == eid)
        require(self.state.commitment[aid]["status"] == "committed")
        if any(r["actor_id"] == actor and r["initiating_action_id"] == aid for r in self.state.reaction.values()):
            return
        require(self._encounter(eid)["canonical_time"] < self.state.commitment[aid]["completes_at"])
        rid = "reaction:" + ident(aid, actor)
        self._put("reaction", rid, {"id": rid, "initiating_action_id": aid, "actor_id": actor,
                  "cue_event_id": cue["cue_event_id"], "eligibility_ref": ref, "response_ref": "", "status": "eligible"})
        if cue.get("requires_player_choice") is True:
            choice = cue["choice_ref"]
            require(self._read(choice).get("actor_id") == actor)
            if choice not in self._scheduler(eid)["pending_choice_refs"]:
                self._scheduler(eid)["pending_choice_refs"].append(choice)
            self._encounter(eid)["phase"] = "suspended"

    def _respond(self, c: Command, auth: JSON) -> str:
        eid, p = c["encounter_id"], c["payload"]
        r = self.state.reaction.get(p["reaction_id"])
        require(r and r["actor_id"] == c["actor_id"] and r["status"] == "eligible")
        incoming = self.state.commitment[r["initiating_action_id"]]
        require(incoming["encounter_id"] == eid and incoming["status"] == "committed")
        response = self._call("player" if auth.get("kind") != "npc" else "npc", "response",
                              {"ref": p["response_ref"], "actor_id": c["actor_id"], "reaction_id": r["id"]})
        require(response.get("authorized") is True and response.get("actor_id") == c["actor_id"])
        choice = response.get("choice_ref")
        choices = self._scheduler(eid)["pending_choice_refs"]
        own_choices = [ref for ref in choices if self._read(ref).get("actor_id") == c["actor_id"]]
        require(not own_choices or choice in own_choices, "choice_required")
        if response.get("no_response") is not True:
            # Responses contribute to the original contest; they never resolve a
            # second check or independently emit an impact.
            template = self._template(response["template_version"])
            plan = self._read(template["interruption_rules_ref"])
            require(template["intent_family"] in {"evade", "block", "guard"} and plan.get("reaction") is True and not plan.get("counterattack", False))
            duration = self._duration(eid, template, plan)
            require(self._encounter(eid)["canonical_time"] + duration <= incoming["completes_at"])
            if response.get("delegated") is True:
                policy = record("automatic_defense_policy", self._read(response["policy_ref"]))
                require(not plan.get("voluntary_movement", False) or policy["movement_authorized"])
                require(self._call("player", "validate_policy", {"policy": policy, "response_ref": p["response_ref"]}).get("allowed") is True)
                self._validate_delegated_effects(template, policy)
            else:
                require(response.get("explicit") is True)
            changes = []
            for a in self.state.commitment.values():
                if a["actor_id"] == c["actor_id"] and a["status"] in LIVE:
                    compatibility = self._read(self.state.commitment_detail[a["id"]]["reaction_compatibility_ref"])
                    require(compatibility.get("mode") in {"cancel", "continue_with_cost", "delay"})
                    entry = {"action_id": a["id"], "mode": compatibility["mode"],
                             "compatibility_ref": self.state.commitment_detail[a["id"]]["reaction_compatibility_ref"]}
                    if compatibility["mode"] == "cancel":
                        require(a["status"] == "committed")
                        require(self._read(self.state.commitment_detail[a["id"]]["cancellation_policy_ref"]).get("allowed") is True)
                    elif compatibility["mode"] == "delay":
                        delay = compatibility["delay_seconds"]
                        require(a["status"] == "committed" and number(delay) and delay >= duration)
                        entry["completes_at"] = a["completes_at"] + delay
                    else:
                        require(a["status"] == "committed" and compatibility.get("circumstance_ref"))
                        entry["circumstance_ref"] = compatibility["circumstance_ref"]
                    changes.append(entry)
            aid = "reaction-action:" + r["id"]
            trial = copy.deepcopy(c)
            trial["payload"] = {"template_version": template["version"], "target_ref": response["target_ref"],
                                "objective_ref": response["objective_ref"], "action_id": aid}
            _, _, channels = self._prepare(trial, None, ignored_actions={v["action_id"] for v in changes})
            require(channels["action_channels"] == ["reaction"], "invalid_reaction_channel")
            require(all("reaction" not in self.state.commitment_detail[v["action_id"]]["action_channels"] for v in changes), "action_channel_busy")
            self._put("action_template", template["version"], template)
            now = self._encounter(eid)["canonical_time"]
            self._put("commitment", aid, {"id": aid, "encounter_id": eid, "actor_id": c["actor_id"],
                      "template_version": template["version"], "objective_ref": response["objective_ref"], "target_ref": response["target_ref"],
                      "starts_at": now, "completes_at": now + duration, "prerequisites_ref": template["interruption_rules_ref"],
                      "reservations_ref": "reservation:" + aid, "status": "reserving"})
            self._put("commitment_detail", aid, {"action_channels": ["reaction"], "interrupt_points": plan.get("interrupt_points", []),
                      "cancellation_policy_ref": plan["cancellation_policy_ref"], "consumption_boundary_ref": plan["consumption_boundary_ref"],
                      "reaction_compatibility_ref": plan["reaction_compatibility_ref"]})
            self._put("effect_workflow", aid, {"action_id": aid, "resolved_result_ref": "", "resource_commit_refs": [],
                      "domain_effect_refs": [], "observation_event_refs": [], "stage_status_refs": [], "idempotency_keys": [], "integration_error_refs": []})
            self._pin_content(aid)
            self._save_stage(aid, "reaction_plan", changes=changes, reaction_id=r["id"], response_ref=p["response_ref"])
            if response.get("delegated") is True:
                self._put("automatic_defense_policy", c["actor_id"], policy)
            r["response_ref"] = p["response_ref"]
            r["status"] = "chosen"
            if choice in choices:
                choices.remove(choice)
            self._reserve(aid)
        else:
            require(response.get("explicit") is True)
            r["response_ref"] = p["response_ref"]
        r["status"] = "chosen"
        if choice in self._scheduler(eid)["pending_choice_refs"]:
            self._scheduler(eid)["pending_choice_refs"].remove(choice)
        return r["id"]

    def _world_command(self, c: Command, auth: JSON) -> str:
        return self._world(c["encounter_id"], c["payload"]["event_ref"])

    def _world(self, eid: str, ref: str) -> str:
        event = self._call("time", "event", {"ref": ref, "encounter_id": eid})
        require(event.get("occurred_at") == self._encounter(eid)["canonical_time"])
        receipt = "event:" + ident(eid, "world:" + ref)
        if receipt in self.state.encounter_event:
            return receipt
        kind = event["kind"]
        if kind == "observation":
            self._acquire(eid, event["observation_event_ref"])
        elif kind in {"function_changed", "location_changed", "participant_changed"}:
            owner = {"function_changed": "health", "location_changed": "location", "participant_changed": "world"}[kind]
            result = self._call(owner, "projection", {"ref": event["projection_ref"], "encounter_id": eid})
            if kind == "participant_changed":
                p = record("participant", result["participant"])
                require(p["encounter_id"] == eid)
                self._put("participant", ident(eid, p["character_id"]), p)
            else:
                participant = self._participant(eid, result["actor_id"])
                key = "function_revision" if kind == "function_changed" else "position_ref"
                participant[key] = result[key]
                if kind == "function_changed":
                    for choice in result.get("unavailable_choice_refs", []):
                        require(self._read(choice).get("actor_id") == result["actor_id"])
                        if choice in self._scheduler(eid)["pending_choice_refs"]:
                            self._scheduler(eid)["pending_choice_refs"].remove(choice)
            self._maintain(eid, ref)
        elif kind == "choice":
            require(self._read(event["choice_ref"]).get("actor_id"))
            if event["choice_ref"] not in self._scheduler(eid)["pending_choice_refs"]:
                self._scheduler(eid)["pending_choice_refs"].append(event["choice_ref"])
        elif kind == "information":
            self._acquire(eid, event["observation_event_ref"])
        else:
            raise Rejected("unsupported_world_event")
        return self._event(eid, "world:" + ref, ref, event["ref"])

    def _maintain(self, eid: str, cause: str) -> None:
        for key, engagement in self.state.engagement.items():
            if engagement.get("ended_event"):
                continue
            membership = self._read(engagement["actors_ref"])
            if membership.get("encounter_id") != eid:
                continue
            requirements = self._read(engagement["maintenance_ref"])
            supported = True
            for owner, ref in requirements["validation_refs"].items():
                supported &= self._call(owner, "validate", {"ref": ref, "encounter_id": eid}).get("allowed") is True
            if not supported:
                engagement["ended_event"] = self._event(eid, "control-ended:" + ident(key, cause), cause, key)
                self.state.control_detail[key]["control_state"] = "broken_contact"

    def _resolve(self, c: Command, auth: JSON) -> str:
        eid, e, s = c["encounter_id"], self._encounter(c["encounter_id"]), self._scheduler(c["encounter_id"])
        require(e["phase"] in {"active", "tension", "suspended"})
        require(self._call("time", "authorize_boundary", {"ref": c["payload"]["scheduler_token"], "encounter_id": eid}).get("allowed") is True, "not_authorized")
        if s["pending_choice_refs"]:
            e["phase"] = "suspended"
            return "pending:player_choice"
        for a in list(self.state.commitment.values()):
            if a["encounter_id"] == eid:
                if a["status"] == "reserving":
                    self._reserve(a["id"])
                elif a["status"] in {"cancelling", "interrupting"}:
                    self._release(a["id"])
        if s["pending_boundary_ref"]:
            boundary = next(d for d in s["tie_decisions"] if d["ref"] == s["pending_boundary_ref"])
        else:
            world = self._call("time", "next_boundary", {"encounter_id": eid, "canonical_time": e["canonical_time"]})
            active = [a for a in self.state.commitment.values() if a["encounter_id"] == eid and a["status"] == "committed"]
            resources = {a["id"]: self._resource_time(a["id"]) for a in active if not self._stage(a["id"], "resources")}
            interrupts = [(a["id"], due, ref) for a in active for due, ref in self._interrupts(a["id"])]
            times = [a["completes_at"] for a in active] + list(resources.values()) + [due for _, due, _ in interrupts]
            if world.get("due_time") is not None:
                require(number(world["due_time"]) and world["due_time"] >= e["canonical_time"])
                times.append(world["due_time"])
            require(times, "no_due_boundary")
            due = min(times)
            require(due >= e["canonical_time"] and c["payload"]["due_time"] == due, "invalid_boundary")
            actions = sorted(a["id"] for a in self.state.commitment.values() if a["encounter_id"] == eid and a["status"] == "committed" and a["completes_at"] == due)
            boundary = {"ref": "boundary:" + ident(eid, due, actions, e["revision"]), "due_time": due,
                        "action_ids": actions, "snapshot_revision": e["revision"],
                        "world_event_refs": world.get("event_refs", []) if world.get("due_time") == due else [],
                        "groups": self._groups(actions), "group_snapshot_refs": {},
                        "resource_action_ids": [aid for aid, at in resources.items() if at == due and aid not in actions],
                        "interrupts": [[aid, ref] for aid, at, ref in interrupts if at == due]}
            snapshot = self._call("time", "snapshot", {"encounter_id": eid, "due_time": due, "revision": e["revision"]})
            boundary["snapshot_ref"] = snapshot["ref"]
            s["tie_decisions"].append(boundary)
            s["pending_boundary_ref"] = boundary["ref"]
            s["snapshot_revision"] = e["revision"]
        # The snapshot and boundary survive uncertain acknowledgements and reload.
        if not boundary.get("time_committed"):
            self._call("time", "advance", {**self._context(eid, boundary["ref"], "advance"), "due_time": boundary["due_time"]})
            e["canonical_time"] = boundary["due_time"]
            boundary["time_committed"] = True
        for ref in boundary["world_event_refs"]:
            self._world(eid, ref)
        for aid, ref in boundary["interrupts"]:
            if not self._stage(aid, "interrupt:" + ref):
                point = self._read(ref)
                self._world(eid, point["event_ref"])
                self._save_stage(aid, "interrupt:" + ref, result_ref=point["event_ref"])
        if s["pending_choice_refs"]:
            e["phase"] = "suspended"
            return "pending:player_choice"
        for aid in boundary["resource_action_ids"]:
            if self._stage(aid, "resources"):
                continue
            action = self.state.commitment[aid]
            trial = {"command": "CommitIntent", "encounter_id": eid, "actor_id": action["actor_id"],
                     "payload": {"action_id": aid, "template_version": action["template_version"], "objective_ref": action["objective_ref"], "target_ref": action["target_ref"]}}
            try:
                self._prepare(trial, None, snapshot=boundary["snapshot_ref"])
            except Rejected:
                action["status"] = "interrupting"
                self._release(aid)
                continue
            self._consume(aid)
        for index, group in enumerate(boundary["groups"]):
            snapshot = boundary["snapshot_ref"]
            if index:
                key = str(index)
                if key not in boundary["group_snapshot_refs"]:
                    boundary["group_snapshot_refs"][key] = self._call("time", "snapshot", {"encounter_id": eid, "due_time": e["canonical_time"], "after_group": index - 1, "boundary_ref": boundary["ref"]})["ref"]
                snapshot = boundary["group_snapshot_refs"][key]
            # All independent prerequisites and checks finish before ANY effect.
            for aid in group:
                self._validate_action(aid, snapshot)
            for aid in group:
                self._resolve_action(aid, snapshot)
            for aid in group:
                if self.state.commitment[aid]["status"] == "resolving":
                    self._effects(aid)
        s["pending_boundary_ref"] = ""
        e["phase"] = "active"
        self._maintain(eid, boundary["ref"])
        self._expire_guards(eid, boundary)
        if s["pending_choice_refs"]:
            e["phase"] = "suspended"
        return boundary["ref"]

    def _groups(self, actions: list[str]) -> list[list[str]]:
        remaining = set(actions)
        groups = []
        while remaining:
            ready = []
            for aid in sorted(remaining):
                rules = self._read(self.state.commitment[aid]["prerequisites_ref"])
                dependencies = set(rules.get("depends_on_action_ids", []))
                require(all(d in self.state.commitment for d in dependencies), "invalid_dependency")
                require(all(d in actions or self.state.commitment[d]["status"] == "completed" for d in dependencies), "dependency_not_completed")
                if not dependencies & remaining:
                    ready.append(aid)
            require(ready, "causal_cycle")
            # Authored exclusive effects cannot be treated as independent.
            used = set()
            independent = []
            for aid in ready:
                locks = set(self._read(self.state.commitment[aid]["prerequisites_ref"]).get("exclusive_effect_refs", []))
                if not locks & used:
                    independent.append(aid)
                    used |= locks
            groups.append(independent)
            remaining -= set(independent)
        return groups

    def _validate_action(self, aid: str, snapshot: str) -> None:
        a, flow = self.state.commitment[aid], self.state.effect_workflow[aid]
        if a["status"] not in {"committed", "resolving"} or self._stage(aid, "resolved"):
            return
        self._verify_pins(aid)
        if not self._stage(aid, "validated"):
            trial = {"command": "CommitIntent", "encounter_id": a["encounter_id"], "actor_id": a["actor_id"],
                     "payload": {"action_id": aid, "template_version": a["template_version"], "target_ref": a["target_ref"], "objective_ref": a["objective_ref"]}}
            try:
                plan = self._stage(aid, "reaction_plan")
                ignored = {entry["action_id"] for entry in plan["changes"]} if plan else set()
                self._prepare(trial, None, snapshot=snapshot, ignored_actions=ignored)
            except Rejected:
                a["status"] = "interrupting"
                self._release(aid)
                if aid.startswith("reaction-action:"):
                    self.state.reaction[aid.removeprefix("reaction-action:")]["status"] = "interrupted"
                return
            self._save_stage(aid, "validated", snapshot_ref=snapshot)

    def _resolve_action(self, aid: str, snapshot: str) -> None:
        a, flow = self.state.commitment[aid], self.state.effect_workflow[aid]
        if a["status"] not in {"committed", "resolving"} or self._stage(aid, "resolved"):
            return
        require(self._stage(aid, "validated"), "missing_validation")
        snapshot = self._stage(aid, "validated")["snapshot_ref"]
        template = self.state.action_template[a["template_version"]]
        question = self._read(template["contested_question_ref"])
        responses = []
        for r in self.state.reaction.values():
            if r["initiating_action_id"] != aid or r["status"] != "chosen":
                continue
            reaction_action = self.state.commitment.get("reaction-action:" + r["id"])
            if reaction_action is None or reaction_action["status"] == "completed" or (
                reaction_action["completes_at"] <= a["completes_at"] and self._stage(reaction_action["id"], "validated")
            ):
                responses.append(r["response_ref"])
        search = question.get("search_context")
        previous = None
        if search:
            keys = ("scope_ref", "method_ref", "information_basis_ref", "context_revision")
            previous = next((s for s in self.state.search_context.values() if s["actor_id"] == a["actor_id"]
                             and all(s[k] == search[k] for k in keys)), None)
        if previous:
            old = self._stage(previous["commitment_id"], "resolved")
            require(old is not None, "missing_stored_result")
            result, band = {"ref": previous["stored_result_ref"]}, old["band"]
        elif self._stage(aid, "reaction_plan"):
            require(question.get("uncertain") is False, "second_defense_check_forbidden")
            band, result = question["routine_band"], {"ref": "routine:" + aid}
            require(band in BANDS, "invalid_template")
        elif question.get("uncertain") is True:
            request = record("check_request", question["check_request"])
            require(request["objective_ref"] == a["objective_ref"])
            require(set(request["circumstance_groups"]) <= GROUPS and set(request["outcome_bands"]) <= BANDS)
            modifiers = self._modifiers(question.get("modifiers", []))
            costs = [change["circumstance_ref"] for f in self.state.effect_workflow.values()
                     for stage in f["stage_status_refs"] if stage["stage"] == "reaction_plan"
                     for change in stage["changes"] if change["action_id"] == aid and change.get("circumstance_ref")]
            composition = self._call("checks", "compose", {**self._context(a["encounter_id"], aid, "compose"),
                                      "modifiers": modifiers, "response_refs": responses, "circumstance_refs": costs,
                                      "guard_refs": [key for key, guard in self.state.guard_state.items()
                                                     if self.state.commitment[guard["commitment_id"]]["encounter_id"] == a["encounter_id"]],
                                      "scale_ref": question["scale_ref"]})
            require(composition.get("bounded") is True and composition.get("deduplicated") is True, "invalid_integration_result")
            self._put("check_request", aid, request)
            result = self._call("checks", "resolve", {**self._context(a["encounter_id"], aid, "resolve"),
                                "check_request": request, "composition_ref": composition["ref"], "snapshot_ref": snapshot,
                                "response_refs": responses})
            band = result["band"]
            require(band in request["outcome_bands"], "invalid_integration_result")
            self._scheduler(a["encounter_id"])["seeded_check_result_refs"].append(result["ref"])
        else:
            band = question["routine_band"]
            require(band in BANDS, "invalid_template")
            result = {"ref": "routine:" + aid}
        flow["resolved_result_ref"] = result["ref"]
        self._save_stage(aid, "resolved", result_ref=result["ref"], band=band, response_refs=responses)
        if search:
            self._put("search_context", aid, {"actor_id": a["actor_id"], **{k: search[k] for k in ("scope_ref", "method_ref", "information_basis_ref", "context_revision")},
                      "commitment_id": aid, "stored_result_ref": result["ref"]})
        a["status"] = "resolving"

    @staticmethod
    def _modifiers(modifiers: list[JSON]) -> list[JSON]:
        sources: dict[str, JSON] = {}
        groups: dict[str, JSON] = {}
        for modifier in modifiers:
            require(modifier.get("group") in GROUPS and number(modifier.get("strength")), "invalid_modifier")
            require(modifier.get("source_ref") and modifier.get("overlap_group"), "invalid_modifier")
            if modifier.get("already_in_geometry") is True:
                continue
            source = modifier["source_ref"]
            if source in sources:
                require(sources[source] == modifier, "duplicate_causal_modifier")
            sources[source] = modifier
        for modifier in sources.values():
            group = modifier["overlap_group"]
            old = groups.get(group)
            if old is None or (modifier["strength"], modifier["source_ref"]) > (old["strength"], old["source_ref"]):
                groups[group] = modifier
        return [copy.deepcopy(groups[k]) for k in sorted(groups)]

    def _effects(self, aid: str) -> None:
        a, flow = self.state.commitment[aid], self.state.effect_workflow[aid]
        eid = a["encounter_id"]
        try:
            self._verify_pins(aid)
            template = self.state.action_template[a["template_version"]]
            resolved = self._stage(aid, "resolved")
            mapping = self._read(template["effects_by_result_band_ref"])
            require(resolved["band"] in mapping, "missing_effect_mapping")
            effects = mapping[resolved["band"]]
            require(type(effects) is list, "invalid_template")
            for effect in effects:
                require(effect.get("scope_declared") is True and effect.get("supported") is True, "unsupported_effect")
                require(effect.get("owner") == "encounter" or effect.get("operation") in OPERATIONS.get(effect.get("owner"), set()), "unsupported_owner_operation")
            if self._stage(aid, "reaction_plan"):
                require(all((effect["owner"], effect["operation"]) in {
                    ("location", "move"), ("encounter", "guard")
                } for effect in effects), "counterattack_forbidden")
            if not self._stage(aid, "resources"):
                self._consume(aid)
            for index, effect in enumerate(effects):
                stage = "effect:" + str(index)
                if self._stage(aid, stage):
                    continue
                require(effect.get("scope_declared") is True and effect.get("supported") is True, "unsupported_effect")
                if effect["owner"] == "encounter":
                    result_ref = self._local_effect(aid, effect)
                else:
                    require(effect["owner"] in {"health", "items", "vehicles", "location", "knowledge", "social", "world", "institution"}, "invalid_owner")
                    result = self._call(effect["owner"], effect["operation"], {**self._context(eid, aid, stage),
                                        "ref": effect["proposal_ref"], "actor_id": a["actor_id"], "target_ref": a["target_ref"],
                                        "result_ref": flow["resolved_result_ref"], "resource_commit_refs": flow["resource_commit_refs"]})
                    require(result.get("effect_committed") is True, "invalid_integration_result")
                    if effect["owner"] in {"location", "health"}:
                        key = "position_ref" if effect["owner"] == "location" else "function_revision"
                        for update in result.get("participant_updates", []):
                            participant = copy.deepcopy(self._participant(eid, update["actor_id"]))
                            participant[key] = update[key]
                            record("participant", participant)
                        for update in result.get("participant_updates", []):
                            self._participant(eid, update["actor_id"])[key] = update[key]
                    result_ref = result["ref"]
                flow["domain_effect_refs"].append(result_ref)
                flow["idempotency_keys"].append(self._context(eid, aid, stage)["idempotency_key"])
                self._save_stage(aid, stage, result_ref=result_ref, owner=effect["owner"], operation=effect["operation"])
            if not self._stage(aid, "observations"):
                result = self._call("knowledge", "emit", {**self._context(eid, aid, "observations"),
                                    "ref": template["observation_cues_ref"], "domain_effect_refs": flow["domain_effect_refs"],
                                    "resource_commit_refs": flow["resource_commit_refs"]})
                flow["observation_event_refs"] = result.get("observation_event_refs", [])
                self._save_stage(aid, "observations", result_ref=result["ref"])
            if not self._stage(aid, "settled"):
                result = self._call("items", "release_unused", {**self._context(eid, aid, "release_unused"),
                                    "ref": a["reservations_ref"], "resource_commit_refs": flow["resource_commit_refs"]})
                self._save_stage(aid, "settled", result_ref=result["ref"])
            if not self._stage(aid, "event_detail"):
                result = self._call("location", "event_context", {**self._context(eid, aid, "event_context"),
                                    "actor_id": a["actor_id"], "snapshot_ref": self._stage(aid, "validated")["snapshot_ref"]})
                detail = {"actor_refs": [a["actor_id"]], "target_refs": [a["target_ref"]], "location_ref": result["location_ref"],
                          "resource_refs": flow["resource_commit_refs"], "observation_cue_refs": [template["observation_cues_ref"]],
                          "supported_trace_refs": [ref for stage in flow["stage_status_refs"] for ref in stage.get("supported_trace_refs", [])]}
                self._put("event_detail", "event:" + ident(eid, "completed:" + aid), detail)
                self._save_stage(aid, "event_detail", result_ref=result["ref"])
            reserved = self._stage(aid, "reserved")
            if reserved and reserved["result_ref"] in self._scheduler(eid)["reservation_ownership_refs"]:
                self._scheduler(eid)["reservation_ownership_refs"].remove(reserved["result_ref"])
            a["status"] = "completed"
            for r in self.state.reaction.values():
                if r["initiating_action_id"] == aid:
                    r["status"] = "resolved"
            self._event(eid, "completed:" + aid, aid, flow["resolved_result_ref"], aid, flow["domain_effect_refs"])
        except (Rejected, KeyError, TypeError, ValueError) as error:
            ref = "integration_error:" + ident(aid, type(error).__name__, str(error))
            if ref not in flow["integration_error_refs"]:
                flow["integration_error_refs"].append(ref)
            raise Unavailable(ref) from None

    def _bind(self, value: Any, aid: str, effect: JSON) -> Any:
        """Bind authored local templates without evaluating code or creating items.

        Available placeholders are whole JSON string values. `$effect:0` refers
        to an already committed effect receipt; `$relation_id` creates only an
        encounter-owned relation ID, never a foreign character/item/location.
        """
        action = self.state.commitment[aid]
        substitutions = {"$action_id": aid, "$encounter_id": action["encounter_id"], "$actor_id": action["actor_id"],
                         "$target_ref": action["target_ref"], "$objective_ref": action["objective_ref"],
                         "$relation_id": "relation:" + ident(aid, effect["proposal_ref"]),
                         "$canonical_time": self._encounter(action["encounter_id"])["canonical_time"],
                         "$result_ref": self.state.effect_workflow[aid]["resolved_result_ref"]}
        if isinstance(value, dict):
            return {k: self._bind(v, aid, effect) for k, v in value.items()}
        if isinstance(value, list):
            return [self._bind(v, aid, effect) for v in value]
        if isinstance(value, str):
            if value in substitutions:
                return substitutions[value]
            if value.startswith("$effect:"):
                stage = self._stage(aid, "effect:" + value.removeprefix("$effect:"))
                require(stage is not None, "uncommitted_prerequisite")
                return stage["result_ref"]
            require(not value.startswith("$"), "unknown_template_binding")
        return value

    def _local_effect(self, aid: str, effect: JSON) -> str:
        """Only explicitly authored System 19 projections can be changed here."""
        a = self.state.commitment[aid]
        eid = a["encounter_id"]
        proposal = self._bind(self._read(effect["proposal_ref"]), aid, effect)
        operation = effect["operation"]
        require(proposal.get("action_id") == aid and proposal.get("encounter_id") == eid, "invalid_projection")
        # Local projections requiring foreign outcomes cannot precede receipts.
        committed = self.state.effect_workflow[aid]["domain_effect_refs"]
        require(set(proposal.get("requires_effect_refs", [])) <= set(committed), "uncommitted_prerequisite")
        stages = self.state.effect_workflow[aid]["stage_status_refs"]
        local_event_key = "projection:" + ident(aid, effect["proposal_ref"])
        local_event = "event:" + ident(eid, local_event_key)
        def has_owner(owner: str, operation: str | None = None) -> bool:
            return any(stage.get("result_ref") in proposal.get("requires_effect_refs", []) and stage.get("owner") == owner
                       and (operation is None or stage.get("operation") == operation) for stage in stages)
        if operation == "control":
            engagement = record("engagement", proposal["engagement"])
            detail = record("control_detail", proposal["control_detail"])
            require(detail["control_state"] in {"contact_contested", "limited_control", "sustained_control", "broken_contact"})
            require(a["actor_id"] in detail["controller_ids"])
            for actor in [*detail["controller_ids"], detail["controlled_actor_id"]]:
                self._participant(eid, actor)
            previous = self.state.engagement.get(engagement["id"])
            require(not previous or not previous.get("ended_event"), "ended_control_relation")
            engagement["started_event"] = previous["started_event"] if previous else local_event
            if detail["control_state"] == "broken_contact":
                engagement["ended_event"] = local_event
            self._put("engagement", engagement["id"], engagement)
            self._put("control_detail", engagement["id"], detail)
        elif operation in {"restraint", "release_restraint"}:
            require(has_owner("items", "apply_restraint" if operation == "restraint" else "release_restraint"), "missing_item_commitment")
            restraint = record("restraint", proposal["restraint"])
            if operation == "release_restraint":
                old = self.state.restraint.get(restraint["id"])
                require(old and not old.get("release_event") and all(old[k] == restraint[k] for k in ("target_id", "item_id", "constraints_ref")))
                restraint["application_event"] = old["application_event"]
                restraint["release_event"] = local_event
            else:
                require(restraint["id"] not in self.state.restraint, "restraint_id_reused")
                restraint["application_event"] = local_event
                restraint.pop("release_event", None)
            self._put("restraint", restraint["id"], restraint)
        elif operation == "pursuit":
            pursuit = record("pursuit", proposal["pursuit"])
            detail = record("pursuit_detail", proposal["pursuit_detail"])
            require(pursuit["encounter_id"] == eid and pursuit["separation_band"] in {"contact", "near", "distant", "lost"})
            require(pursuit["status"] in {"active", "ended"}, "invalid_pursuit_status")
            require(detail["mode"] in {"foot", "vehicle"})
            require(has_owner("location") if detail["mode"] == "foot" else has_owner("vehicles"), "missing_movement_commitment")
            require(proposal.get("pursuit_decision_ref") and proposal.get("route_or_contact_basis_ref"))
            previous = self.state.pursuit.get(pursuit["id"], {}).get("pursuer_ids", [])
            require(set(pursuit["pursuer_ids"]) - set(previous) <= {a["actor_id"]}, "unrequested_pursuit")
            self._put("pursuit", pursuit["id"], pursuit)
            self._put("pursuit_detail", pursuit["id"], detail)
        elif operation == "surrender":
            offer = record("surrender_or_pause", proposal["surrender_or_pause"])
            require(offer["actor_id"] == a["actor_id"])
            require(proposal.get("requires_effect_refs"), "missing_observation_commitment")
            require(set(offer["adopting_participant_ids"]) <= set(proposal["observed_accepting_actor_ids"]))
            self._put("surrender_or_pause", offer["offer_event_ref"], offer)
        elif operation == "guard":
            guard = record("guard_state", proposal["guard_state"])
            require(guard["commitment_id"] == aid)
            self._put("guard_state", aid, guard)
        elif operation == "search":
            search = record("search_context", proposal["search_context"])
            require(search["actor_id"] == a["actor_id"] and search["commitment_id"] == aid)
            require(search["stored_result_ref"] == self.state.effect_workflow[aid]["resolved_result_ref"])
            self._put("search_context", aid, search)
        else:
            raise Rejected("unsupported_local_effect")
        self._event(eid, local_event_key, aid, effect["proposal_ref"], aid, committed)
        return effect["proposal_ref"]

    def _expire_guards(self, eid: str, boundary: JSON) -> None:
        for key, guard in list(self.state.guard_state.items()):
            action = self.state.commitment[guard["commitment_id"]]
            if action["encounter_id"] != eid:
                continue
            expiry = self._read(guard["expires_at_boundary_ref"])
            expired = (expiry.get("kind") == "next_boundary" and boundary["due_time"] > action["completes_at"])
            expired |= expiry.get("boundary_ref") == boundary["ref"]
            if number(expiry.get("at")):
                expired |= expiry["at"] <= boundary["due_time"]
            if expired:
                self._event(eid, "guard-expired:" + key, boundary["ref"], key)
                del self.state.guard_state[key]

    def _end(self, c: Command, auth: JSON) -> str:
        eid, e = c["encounter_id"], self._encounter(c["encounter_id"])
        require(e["phase"] != "closed")
        s = self._scheduler(eid)
        require(not s["pending_choice_refs"] and not s["pending_boundary_ref"], "unsettled_encounter")
        require(not any(a["encounter_id"] == eid and a["status"] in LIVE for a in self.state.commitment.values()), "unsettled_encounter")
        require(not any(self.state.commitment[r["initiating_action_id"]]["encounter_id"] == eid and r["status"] in {"eligible", "chosen"} for r in self.state.reaction.values()), "unsettled_encounter")
        require(not any(p["encounter_id"] == eid and p["status"] != "ended" for p in self.state.pursuit.values()), "unsettled_encounter")
        require(not s["reservation_ownership_refs"], "unsettled_encounter")
        e["phase"] = "aftermath"
        if eid not in self.state.aftermath:
            self._put("aftermath", eid, {"handoff_refs": [], "summary_ref": "", "closure_reason": c["payload"]["reason"]})
        aftermath = self.state.aftermath[eid]
        policy = self._read(e["policy_version"])
        for owner in policy["handoff_owners"]:
            require(owner in STUBS and owner not in {"content", "player", "checks", "time"}, "invalid_owner")
            key = "handoff:" + owner
            receipt = "event:" + ident(eid, key)
            if receipt not in self.state.encounter_event:
                result = self._call(owner, "aftermath", {**self._context(eid, eid, key),
                                    "event_refs": [ev["id"] for ev in self.state.encounter_event.values() if ev["encounter_id"] == eid]})
                aftermath["handoff_refs"].append(result["ref"])
                self._event(eid, key, e["initiating_event"], result["ref"])
        result = self._call("knowledge", "aftermath_summary", {**self._context(eid, eid, "summary"), "handoff_refs": aftermath["handoff_refs"]})
        aftermath["summary_ref"] = result["ref"]
        e["phase"] = "closed"
        return result["ref"]

    def _link(self, c: Command, auth: JSON) -> str:
        """Link coordination without copying actors, budgets, or commitments."""
        eid, other = c["encounter_id"], c["payload"]["linked_encounter_id"]
        require(eid != other and other in self.state.encounter)
        result = self._call("world", "validate_link", {"encounter_id": eid, "linked_encounter_id": other, "ref": c["payload"]["cause_ref"]})
        require(result.get("shared_dependency") is True)
        if other not in self._encounter(eid)["linked_encounter_ids"]:
            self._encounter(eid)["linked_encounter_ids"].append(other)
        return result["ref"]


def state_machine(state: JSON, command: Command, fixtures: JSON | None = None) -> JSON:
    """Trusted host API. Persist `state`; expose ONLY `reply` to the actor.

    Fixtures and snapshots belong to the trusted host, never a player endpoint.
    Empty state creates a fresh coordinator. All external calls remain mocks.
    """
    canned = {(owner, operation, selector): response
              for owner, operations in (fixtures or {}).items()
              for operation, responses in operations.items()
              for selector, response in responses.items()}
    engine = Combat(State.load(state) if state else State(), DummyDependencies(canned))
    reply = engine.step(command)
    return {"state": engine.state.dump(), "reply": reply}
