"""Deterministic, isolated System 23; Python 3.11+, standard library only.

Storage conventions (not additional game rules): timestamps are nonnegative
canonical integer ticks; unset references are None; external references are
opaque strings. Collections are ID-keyed dictionaries. Event payload_ref uses
an embedded JSON document reference, {"value": document}, so snapshots remain
self-contained. All persistent fields belong to the supplied architecture.

External calls are static JSON fixtures, never domain simulations. Missing
fixtures defer work or deny access. Fixtures are trusted adapter responses,
not player command arguments. Production adapters are deliberately excluded.
Unspecified selection, semantic, retention, confidence, and calendar policies
must be supplied explicitly by their corresponding fixtures.

Main interface: engine.step({"command": str, "envelope": {...}, "input": {...}}).
Commands are serialized, revision checked, idempotent, and copy-on-write.
ExportState/restore are authorized administrative boundaries, not player APIs.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict, dataclass, field, fields
from hashlib import sha256
import json
from threading import RLock
from typing import Any, Callable, Mapping, TypedDict

JSONObject = dict[str, Any]
SYSTEM_ID = 23
DOMAIN = "living_city_rumor"


class Envelope(TypedDict):
    authority_ref: str
    expected_revision: int
    canonical_timestamp: int
    correlation_id: str
    idempotency_key: str


class Command(TypedDict):
    command: str
    envelope: Envelope
    input: JSONObject


class Reply(TypedDict, total=False):
    status: str
    revision: int
    result: JSONObject
    error: str


FAMILIES = (
    "ordinary_activity", "community_occasion", "business_work",
    "local_disruption", "conflict_crime", "institutional_response",
    "health_life_event", "information_event",
)
CONFIDENCE = {"unassessed", "tentative", "accepted", "contested", "rejected"}
OWNERS = tuple(f"system{i}" for i in range(9, 23)) + (
    "knowledge", "memory", "relationships", "manifest", "player",
    "presentation", "diagnostics",
)
SCHEMAS = {
    "city_template": "id family version prerequisites_ref impact_band workflow_ref observation_rules",
    "city_proposal": "id template_version cause_refs actors_ref place_scope due_at reservations_ref seed_ref status",
    "city_occurrence": "id proposal_ref owner_event_refs occurred_at outcome_ref follow_on_refs",
    "account_proposition": "id subject_ref claim_kind place_scope relevant_interval proposition_ref",
    "account_variant": "id proposition_id author_ref content_ref parent_variant lineage_root claimed_source_ref published_at qualifiers_ref",
    "transmission": "id variant_id sender_ref recipients_ref channel_ref attempted_at delivered_refs status",
    "audience_assessment": "id holder_ref proposition_id acquired_source_refs confidence reasons_ref reviewed_at supersedes_id",
    "media_task": "id outlet_ref worker_ref source_refs objective_ref due_at status publication_ref",
    "city_event": "id cause_ref occurred_at processed_at actor_ref policy_version payload_ref idempotency_key",
    "workflow_continuity": "generation_class eligibility_result selection_seed_ref decision_reasons_ref pending_step_refs completed_owner_event_refs deferral_reason_ref next_review_ref player_choice_boundary_ref",
    "recurrence": "series_id occurrence_ids calendar_rule_ref organizer_ref planned_resources_ref review_policy_ref schedule_revision_refs",
    "information_provenance": "observation_refs acquisition_refs artifact_version_refs transformation_actor_ref transformation_method changed_fields transformation_reason_ref attribution_ref confidentiality_scope_ref disclosure_event_ref correction_links downstream_decision_refs",
    "time_separation": "occurred_at published_or_spoken_at delivered_at acquired_at entered_or_processed_at relevant_interval",
}
READS = {
    "GetKnownCityChanges", "GetAvailableLocalAccounts", "GetReceivedRumors",
    "GetKnownCommunityCalendar", "ExportState",
}


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value: Any) -> str:
    return sha256(canonical(value).encode("utf-8")).hexdigest()


class GateError(Exception):
    """Public errors deliberately contain no subject, source, or owner details."""


class Pending(Exception):
    pass


def require(condition: bool, code: str = "invalid_request") -> None:
    if not condition:
        raise GateError(code)


def exact(value: Any, names: str) -> JSONObject:
    require(type(value) is dict and set(value) == set(names.split()))
    return value


def text(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def tick(value: Any) -> bool:
    return type(value) is int and value >= 0


def refs(value: Any) -> bool:
    return type(value) is list and all(text(x) for x in value) and len(set(value)) == len(value)


def _stub(owner: str) -> Callable[[JSONObject], JSONObject]:
    def request(payload: JSONObject) -> JSONObject:
        """Return an unavailable dummy response; perform no external action."""
        return {"status": "pending", "owner": owner, "result_ref": None}
    request.__name__ = f"request_{owner}"
    return request


# Each dependency has its own callable placeholder for both reads and requests.
STUBS = {owner: _stub(owner) for owner in OWNERS}
globals().update({function.__name__: function for function in STUBS.values()})


class MockDependencies:
    """Static responses keyed by (owner, operation[, request fingerprint]).

    Fixture values are copied, never executed. No clocks, inventories, beliefs,
    deliveries, or other external state are simulated by this adapter.
    """

    def __init__(self, responses: Mapping[tuple[str, ...], JSONObject] | None = None):
        self._responses = deepcopy(dict(responses or {}))

    def call(self, owner: str, operation: str, payload: JSONObject) -> JSONObject:
        require(owner in STUBS, "invalid_dependency")
        key = (owner, operation, fingerprint(payload))
        result = self._responses.get(key, self._responses.get((owner, operation)))
        if result is None:
            result = STUBS[owner]({"operation": operation, "input": deepcopy(payload)})
        canonical(result)
        require(type(result) is dict, "invalid_dependency_response")
        return deepcopy(result)


def generation_defaults() -> JSONObject:
    return {
        "policy_version": "1.0", "enabled_families": list(FAMILIES),
        "neighborhood_daily_review_boundary": None,
        "low_proposals_per_neighborhood_day": 2,
        "medium_proposals_per_neighborhood_day": 1,
        "medium_proposals_per_city_day": 4,
        "severe_random_proposals_enabled": False,
        "discretionary_follow_ons_per_incident_review": 3,
    }


def dissemination_defaults() -> JSONObject:
    return {
        "discretionary_npc_retell_tasks_per_actor_day": 2,
        "hops_per_lineage_day": 3,
        "approved_retelling_operations": None,
        "era_channel_capabilities_ref": None,
    }


def presentation_defaults() -> JSONObject:
    return {"optional_low_urgency_updates_per_ordinary_scene": 1, "retention_policy_refs": []}


def budget_defaults() -> JSONObject:
    return {name: {} for name in (
        "low_proposals_by_neighborhood_day", "medium_proposals_by_neighborhood_day",
        "medium_proposals_by_city_day", "follow_on_proposals_by_incident_review",
        "retell_tasks_by_actor_day", "lineage_hops_by_day", "optional_updates_by_scene",
    )}


def provenance() -> JSONObject:
    value = dict.fromkeys(SCHEMAS["information_provenance"].split())
    for key in ("observation_refs", "acquisition_refs", "artifact_version_refs",
                "changed_fields", "correction_links", "downstream_decision_refs"):
        value[key] = []
    return value


def times(now: int) -> JSONObject:
    value = dict.fromkeys(SCHEMAS["time_separation"].split())
    value["entered_or_processed_at"] = now
    return value


@dataclass(slots=True)
class CityState:
    """Only the state variables declared in the architecture are persisted."""

    city_template: JSONObject = field(default_factory=dict)
    city_proposal: JSONObject = field(default_factory=dict)
    city_occurrence: JSONObject = field(default_factory=dict)
    account_proposition: JSONObject = field(default_factory=dict)
    account_variant: JSONObject = field(default_factory=dict)
    transmission: JSONObject = field(default_factory=dict)
    audience_assessment: JSONObject = field(default_factory=dict)
    media_task: JSONObject = field(default_factory=dict)
    city_event: JSONObject = field(default_factory=dict)
    generation_policy: JSONObject = field(default_factory=generation_defaults)
    dissemination_policy: JSONObject = field(default_factory=dissemination_defaults)
    presentation_policy: JSONObject = field(default_factory=presentation_defaults)
    budget_projections: JSONObject = field(default_factory=budget_defaults)
    workflow_continuity: JSONObject = field(default_factory=dict)
    recurrence: JSONObject = field(default_factory=dict)
    information_provenance: JSONObject = field(default_factory=dict)
    time_separation: JSONObject = field(default_factory=dict)
    mutation_envelope: JSONObject = field(default_factory=dict)
    derived_views: JSONObject = field(default_factory=lambda: {
        "neighborhood_projection": {}, "known_city_view_by_actor": {},
        "circulation_by_proposition": {},
    })


class LivingCityRumor:
    """Single-writer coordinator. Adapter configuration is not game state."""

    def __init__(self, dependencies: MockDependencies | None = None):
        self._dependencies = dependencies or MockDependencies()
        self._state = CityState()
        self._lock = RLock()

    @property
    def revision(self) -> int:
        with self._lock:
            return len(self._state.city_event)

    def _ask(self, owner: str, operation: str, payload: JSONObject,
             flags: tuple[str, ...] = ()) -> JSONObject:
        result = self._dependencies.call(owner, operation, payload)
        if result.get("status") == "pending":
            raise Pending()
        require(result.get("status") == "ok" and all(result.get(x) is True for x in flags),
                "prerequisite_not_satisfied")
        return result

    def _actor(self, actor: str, operation: str, payload: JSONObject) -> str:
        require(text(actor))
        identity = self._ask("system9", "actor", {"actor_ref": actor}, ("exists",))
        require(identity.get("actor_ref") == actor and identity.get("control") in {"npc", "player"})
        if identity["control"] == "player":
            self._ask("player", "authorize_action", {
                "actor_ref": actor, "operation": operation, "input": payload,
            }, ("authorized", "content_exact_or_reviewed", "choice_boundary_satisfied"))
        return identity["control"]

    @staticmethod
    def _get(state: CityState, collection: str, identity: str) -> JSONObject:
        require(text(identity))
        record = getattr(state, collection).get(identity)
        require(record is not None, "unavailable")
        return record

    @staticmethod
    def _put(state: CityState, collection: str, record: JSONObject) -> None:
        exact(record, SCHEMAS[collection])
        require(text(record.get("id")))
        table = getattr(state, collection)
        require(record["id"] not in table, "already_exists")
        table[record["id"]] = deepcopy(record)

    @staticmethod
    def _history(state: CityState, command: str) -> list[JSONObject]:
        ordered = sorted(state.city_event.values(), key=lambda x: x["payload_ref"]["value"]["reply"]["revision"])
        return [event["payload_ref"]["value"] for event in ordered
                if event["payload_ref"]["value"]["command"] == command]

    @staticmethod
    def _key(*values: Any) -> str:
        return canonical(values)

    @staticmethod
    def _budget(state: CityState, checks: list[tuple[str, str, int]], consume: bool) -> None:
        for name, key, limit in checks:
            require(state.budget_projections[name].get(key, 0) < limit, "budget_exhausted")
        if consume:
            for name, key, _ in checks:
                table = state.budget_projections[name]
                table[key] = table.get(key, 0) + 1

    def step(self, request: Command) -> Reply:
        """JSON in/out; errors never include hidden IDs or exception details."""
        if type(request) is dict and request.get("command") == "ProcessDueBoundary":
            return self.process_due(request)
        with self._lock:
            try:
                request = json.loads(canonical(request))
                exact(request, "command envelope input")
                name, envelope, data = request["command"], request["envelope"], request["input"]
                exact(envelope, "authority_ref expected_revision canonical_timestamp correlation_id idempotency_key")
                require(text(name) and type(data) is dict)
                require(all(text(envelope[x]) for x in ("authority_ref", "correlation_id", "idempotency_key")))
                require(tick(envelope["expected_revision"]) and tick(envelope["canonical_timestamp"]))
                authority = self._ask("diagnostics", "authorize", request, ("authorized",))
                require(text(authority.get("actor_ref")))
                if name in READS:
                    return {"status": "ok", "revision": self.revision,
                            "result": self._query(self._state, name, data, authority)}
                require(name in MUTATIONS, "unsupported_command")
                identity = envelope["idempotency_key"]
                digest = fingerprint(request)
                for event in self._state.city_event.values():
                    if event["idempotency_key"] == identity:
                        previous = event["payload_ref"]["value"]
                        require(previous["request_digest"] == digest, "idempotency_conflict")
                        return deepcopy(previous["reply"])
                require(envelope["expected_revision"] == self.revision, "stale_revision")
                clock = self._ask("system11", "clock", {"canonical_timestamp": envelope["canonical_timestamp"]})
                require(clock.get("canonical_timestamp") == envelope["canonical_timestamp"], "stale_time")
                require(clock.get("paused") is False, "paused")
                require(clock.get("choice_pending") is False, "choice_required")
                now = envelope["canonical_timestamp"]
                require(all(now >= e["processed_at"] for e in self._state.city_event.values()), "stale_time")
                working = deepcopy(self._state)
                result = getattr(self, "_" + MUTATIONS[name])(working, data, envelope, clock)
                status = result["status"] if name == "ValidateProposal" and result["status"] in {"rejected", "pending"} else "ok"
                reply: Reply = {"status": status, "revision": self.revision + 1, "result": result}
                event_id = "city-event:" + fingerprint(identity)
                working.city_event[event_id] = {
                    "id": event_id, "cause_ref": envelope["correlation_id"],
                    "occurred_at": now, "processed_at": now, "actor_ref": authority["actor_ref"],
                    "policy_version": working.generation_policy["policy_version"],
                    "payload_ref": {"value": {"command": name, "input": data,
                        "request_digest": digest, "reply": reply, "state_digest": None}},
                    "idempotency_key": identity,
                }
                working.mutation_envelope = deepcopy(envelope)
                working.city_event[event_id]["payload_ref"]["value"]["state_digest"] = self._state_digest(working)
                self._validate_state(working)
                self._state = working
                return deepcopy(reply)
            except Pending:
                return {"status": "pending", "revision": self.revision, "error": "pending_dependency"}
            except GateError as error:
                return {"status": "rejected", "revision": self.revision, "error": str(error)}
            except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
                return {"status": "rejected", "revision": self.revision, "error": "invalid_request"}

    def _register_template(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "template_ref")
        r = self._ask("manifest", "template", d, ("approved",))
        template = exact(r["template"], SCHEMAS["city_template"])
        require(template["family"] in FAMILIES and template["impact_band"] in {"low", "medium", "severe"})
        key = self._key(template["id"], template["version"])
        if key in s.city_template:
            require(s.city_template[key] == template, "immutable_record")
        else:
            s.city_template[key] = deepcopy(template)
        return {"template_version": key}

    def _configure(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "policy_ref")
        r = self._ask("manifest", "policies", d, ("approved", "prospective_only"))
        require(r["generation_policy"]["policy_version"] != s.generation_policy["policy_version"], "immutable_record")
        for name in ("generation_policy", "dissemination_policy", "presentation_policy"):
            exact(r[name], " ".join(getattr(s, name)))
            setattr(s, name, deepcopy(r[name]))
        return {"policy_version": s.generation_policy["policy_version"]}

    def _propose(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "proposal generation_class cause_owner_refs")
        p = exact(d["proposal"], SCHEMAS["city_proposal"])
        require(p["status"] == "candidate" and p["reservations_ref"] is None)
        require(refs(p["cause_refs"]) and bool(p["cause_refs"]) and text(p["seed_ref"]))
        require(tick(p["due_at"]) and p["due_at"] >= e["canonical_timestamp"])
        t = self._get(s, "city_template", p["template_version"])
        require(t["family"] in s.generation_policy["enabled_families"], "disabled_family")
        require(d["generation_class"] in {"discretionary", "existing_cause_continuation"})
        require(type(d["cause_owner_refs"]) is dict and set(d["cause_owner_refs"]) == set(p["cause_refs"]))
        for ref in p["cause_refs"]:
            owner = d["cause_owner_refs"][ref]
            require(owner in OWNERS[:14] or owner == "manifest")
            cause = self._ask(owner, "verify_cause", {"cause_ref": ref}, ("valid",))
            require(cause.get("cause_ref") == ref)
            require(cause.get("kind") in {"committed_event", "due_task", "accepted_plan", "resource_condition", "scenario_fact"}, "missing_source")
        for old in s.city_proposal.values():
            old_t = self._get(s, "city_template", old["template_version"])
            if old_t["id"] == t["id"] and set(old["cause_refs"]) == set(p["cause_refs"]):
                return {"proposal_id": old["id"], "status": old["status"]}
        self._put(s, "city_proposal", p)
        s.workflow_continuity[self._key("proposal", p["id"])] = {
            "generation_class": d["generation_class"], "eligibility_result": {
                "policy": deepcopy(s.generation_policy), "eligible": False},
            "selection_seed_ref": p["seed_ref"], "decision_reasons_ref": None,
            "pending_step_refs": [], "completed_owner_event_refs": [],
            "deferral_reason_ref": None, "next_review_ref": None, "player_choice_boundary_ref": None,
        }
        return {"proposal_id": p["id"], "status": "candidate"}

    def _validate_proposal(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "proposal_id")
        p = self._get(s, "city_proposal", d["proposal_id"])
        require(p["status"] in {"candidate", "deferred", "rejected"}, "invalid_transition")
        try:
            return self._evaluate_proposal(s, d, e, c)
        except (GateError, Pending) as failure:
            pending = isinstance(failure, Pending)
            w = s.workflow_continuity[self._key("proposal", p["id"])]
            w["eligibility_result"]["eligible"] = False
            w["deferral_reason_ref"] = "pending_dependency" if pending else str(failure)
            p["status"] = "deferred" if pending else "rejected"
            return {"proposal_id": p["id"], "status": "pending" if pending else "rejected",
                    "reason": w["deferral_reason_ref"]}

    def _evaluate_proposal(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "proposal_id")
        p = self._get(s, "city_proposal", d["proposal_id"])
        require(p["status"] in {"candidate", "deferred", "rejected"}, "invalid_transition")
        t = self._get(s, "city_template", p["template_version"])
        w = s.workflow_continuity[self._key("proposal", p["id"])]
        context = {"proposal": p, "template": t, "policy": w["eligibility_result"]["policy"],
                   "canonical_timestamp": e["canonical_timestamp"]}
        for owner, flags in (
            ("system9", ("participants_exist", "identity_continuity")),
            ("system12", ("place_exists", "access_valid", "scope_valid")),
            ("system11", ("schedules_valid", "choice_boundary_satisfied")),
            ("system15", ("resources_valid", "reservations_compatible")),
        ):
            self._ask(owner, "validate_proposal", context, flags)
        approval = self._ask("manifest", "eligibility", context,
                             ("eligible", "causal_requirements_satisfied", "context_allowed"))
        require(approval.get("generation_class") == w["generation_class"])
        if t["impact_band"] == "severe":
            require(approval.get("established_severe_cause") is True or
                    approval.get("enabled_bounded_scenario") is True, "severe_gate")
            if approval.get("random_discretionary") is True:
                require(w["eligibility_result"]["policy"]["severe_random_proposals_enabled"] is True, "severe_gate")
        require(type(approval.get("requirements")) is list and refs(approval.get("actors")) and bool(approval["actors"]))
        for actor in approval["actors"]:
            self._actor(actor, "CommitCityWorkflow", context)
        for requirement in approval["requirements"]:
            exact(requirement, "owner prerequisite_ref")
            self._ask(requirement["owner"], "validate_prerequisite", requirement, ("satisfied",))
        p["status"] = "validated"
        w["eligibility_result"].update({"eligible": True, "approval": approval})
        w["decision_reasons_ref"] = approval["reasons_ref"]
        w["deferral_reason_ref"] = None
        return {"proposal_id": p["id"], "status": p["status"]}

    def _proposal_budget(self, s: CityState, p: JSONObject, c: JSONObject) -> list[tuple[str, str, int]]:
        w = s.workflow_continuity[self._key("proposal", p["id"])]
        if w["generation_class"] == "existing_cause_continuation":
            return []
        t = self._get(s, "city_template", p["template_version"])
        policy = w["eligibility_result"]["policy"]
        approval = w["eligibility_result"]["approval"]
        require(text(c.get("game_day")) and text(approval.get("neighborhood_ref")))
        key = self._key(approval["neighborhood_ref"], c["game_day"])
        if t["impact_band"] == "low":
            return [("low_proposals_by_neighborhood_day", key, policy["low_proposals_per_neighborhood_day"])]
        if t["impact_band"] == "medium":
            return [("medium_proposals_by_neighborhood_day", key, policy["medium_proposals_per_neighborhood_day"]),
                    ("medium_proposals_by_city_day", c["game_day"], policy["medium_proposals_per_city_day"])]
        return []

    def _review(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "neighborhood_ref proposal_ids review_ref seed_ref")
        require(refs(d["proposal_ids"]) and text(d["seed_ref"]))
        boundary = self._ask("system11", "review_boundary", d, ("due",))
        require(boundary.get("game_day") == c.get("game_day") and text(c.get("game_day")))
        for history in self._history(s, "ReviewNeighborhood"):
            old = history["reply"]["result"]
            if old["neighborhood_ref"] == d["neighborhood_ref"] and old["game_day"] == c["game_day"]:
                return deepcopy(old)
        eligible = []
        for identity in d["proposal_ids"]:
            p = self._get(s, "city_proposal", identity)
            require(p["status"] == "validated", "invalid_transition")
            if "selected_review_ref" in s.workflow_continuity[self._key("proposal", identity)]["eligibility_result"]:
                continue
            approval = s.workflow_continuity[self._key("proposal", identity)]["eligibility_result"]["approval"]
            require(approval["neighborhood_ref"] == d["neighborhood_ref"])
            try:
                self._budget(s, self._proposal_budget(s, p, c), False)
                eligible.append(identity)
            except GateError as error:
                if str(error) != "budget_exhausted":
                    raise
        selected = []
        if eligible:
            selection = self._ask("manifest", "selection", {
                "eligible_proposal_ids": eligible, "seed_ref": d["seed_ref"], "review_ref": d["review_ref"],
                "candidate_context": [s.city_proposal[identity] for identity in eligible],
            }, ("approved",))
            require(selection.get("seed_ref") == d["seed_ref"] and refs(selection.get("selected_ids")))
            require(set(selection["selected_ids"]) <= set(eligible))
            for identity in selection["selected_ids"]:
                p = s.city_proposal[identity]
                try:
                    self._budget(s, self._proposal_budget(s, p, c), True)
                except GateError as error:
                    if str(error) != "budget_exhausted":
                        raise
                    continue
                selected.append(identity)
                s.workflow_continuity[self._key("proposal", identity)]["eligibility_result"]["selected_review_ref"] = d["review_ref"]
        return {"neighborhood_ref": d["neighborhood_ref"], "game_day": c["game_day"],
                "selected_ids": selected, "status": "selected" if selected else "quiet"}

    def _commit(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "proposal_id")
        p = self._get(s, "city_proposal", d["proposal_id"])
        require(p["status"] in {"validated", "committed"}, "invalid_transition")
        w = s.workflow_continuity[self._key("proposal", p["id"])]
        if p["status"] == "committed":
            return {"proposal_id": p["id"], "status": "committed"}
        if w["generation_class"] == "discretionary":
            require("selected_review_ref" in w["eligibility_result"], "not_selected")
        self._ask("system11", "revalidate_workflow", {"proposal": p},
                  ("schedules_valid", "choice_boundary_satisfied"))
        self._ask("system9", "validate_proposal", {"proposal": p},
                  ("participants_exist", "identity_continuity"))
        self._ask("system12", "validate_proposal", {"proposal": p},
                  ("place_exists", "access_valid", "scope_valid"))
        self._ask("system15", "validate_proposal", {"proposal": p},
                  ("resources_valid", "reservations_compatible"))
        approval = w["eligibility_result"]["approval"]
        for actor in approval["actors"]:
            self._actor(actor, "CommitCityWorkflow", {"proposal": p})
        for requirement in approval["requirements"]:
            self._ask(requirement["owner"], "validate_prerequisite", requirement, ("satisfied",))
        # The durable pending request is recorded before any owner execution.
        # Actual owner steps use RecordCityOutcome in separate transactions.
        reservation = self._ask("system15", "reserve", {
            "proposal": p, "idempotency_key": "reserve:" + p["id"],
        }, ("reserved",))
        require(text(reservation.get("reservations_ref")) and refs(reservation.get("pending_step_refs")))
        p["reservations_ref"] = reservation["reservations_ref"]
        p["status"] = "committed"
        w["pending_step_refs"] = reservation["pending_step_refs"]
        return {"proposal_id": p["id"], "status": "committed"}

    def _execute_step(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "proposal_id step_ref owner")
        p = self._get(s, "city_proposal", d["proposal_id"])
        require(p["status"] in {"committed", "partial"}, "invalid_transition")
        w = s.workflow_continuity[self._key("proposal", p["id"])]
        require(d["step_ref"] in w["pending_step_refs"] and d["owner"] in OWNERS[:14])
        receipts = w["eligibility_result"].setdefault("owner_receipts", {})
        if d["step_ref"] in receipts and receipts[d["step_ref"]].get("accepted") is True:
            return {"proposal_id": p["id"], "status": "awaiting_owner_outcome"}
        self._ask("system10", "validate_step", {**d, "proposal": p},
                  ("bound_to_workflow", "prerequisites_revalidated", "due", "choice_boundary_satisfied"))
        for actor in w["eligibility_result"]["approval"]["actors"]:
            self._actor(actor, "ExecuteWorkflowStep", d)
        # One stable owner key covers all retries, including after save/reload.
        result = self._dependencies.call(d["owner"], "request_step", {
            **d, "reservations_ref": p["reservations_ref"],
            "idempotency_key": self._key("owner-step", p["id"], d["step_ref"]),
        })
        receipts[d["step_ref"]] = result
        accepted = result.get("status") == "ok" and result.get("accepted") is True
        w["deferral_reason_ref"] = None if accepted else "pending_owner_effect"
        # Keep the step pending until independently recorded committed events arrive.
        return {"proposal_id": p["id"], "status": "awaiting_owner_outcome" if accepted else "pending"}

    def _outcome(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "occurrence owner_refs status completed_step_refs")
        occurrence = exact(d["occurrence"], SCHEMAS["city_occurrence"])
        require(d["status"] in {"completed", "partial", "failed"})
        require(refs(occurrence["owner_event_refs"]) and refs(occurrence["follow_on_refs"]))
        require(occurrence["follow_on_refs"] == [] and refs(d["completed_step_refs"]))
        require(tick(occurrence["occurred_at"]) and occurrence["occurred_at"] <= e["canonical_timestamp"])
        require(type(d["owner_refs"]) is dict and set(d["owner_refs"]) == set(occurrence["owner_event_refs"]))
        p = None
        if occurrence["proposal_ref"] is not None:
            p = self._get(s, "city_proposal", occurrence["proposal_ref"])
            require(p["status"] in {"committed", "partial"}, "invalid_transition")
            w = s.workflow_continuity[self._key("proposal", p["id"])]
            require(set(d["completed_step_refs"]) <= set(w["pending_step_refs"]))
            self._ask("system10", "validate_outcome", d, ("recorded", "steps_match", "limitations_supported"))
        else:
            require(bool(occurrence["owner_event_refs"]) and not d["completed_step_refs"])
        used = {ref for old in s.city_occurrence.values() for ref in old["owner_event_refs"]}
        require(not used.intersection(occurrence["owner_event_refs"]), "duplicate_owner_effect")
        for ref, owner in d["owner_refs"].items():
            require(owner in OWNERS[:14])
            record = self._ask(owner, "committed_event", {"event_ref": ref}, ("committed",))
            require(record.get("event_ref") == ref and tick(record.get("occurred_at")))
            require(record["occurred_at"] <= occurrence["occurred_at"], "invalid_chronology")
            if p is not None:
                require(record.get("proposal_ref") == p["id"], "unrelated_owner_effect")
        if d["status"] == "completed":
            require(bool(occurrence["owner_event_refs"]), "missing_owner_effect")
        self._put(s, "city_occurrence", occurrence)
        if p is not None:
            w["completed_owner_event_refs"].extend(occurrence["owner_event_refs"])
            w["pending_step_refs"] = [x for x in w["pending_step_refs"] if x not in d["completed_step_refs"]]
            # An owner result is never discarded because unrelated steps failed.
            p["status"] = "partial" if w["pending_step_refs"] else d["status"]
        s.time_separation[self._key("occurrence", occurrence["id"])] = {
            **times(e["canonical_timestamp"]), "occurred_at": occurrence["occurred_at"],
        }
        return {"occurrence_id": occurrence["id"], "status": p["status"] if p else d["status"]}

    def _cancel(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "proposal_id decision_ref")
        p = self._get(s, "city_proposal", d["proposal_id"])
        require(p["status"] in {"candidate", "validated", "committed", "partial"}, "invalid_transition")
        self._ask("manifest", "cancel_decision", d, ("supported", "choice_boundary_satisfied"))
        w = s.workflow_continuity[self._key("proposal", p["id"])]
        if p["reservations_ref"] is not None:
            response = self._dependencies.call("system15", "release_unused", {
                "reservations_ref": p["reservations_ref"],
                "completed_owner_event_refs": w["completed_owner_event_refs"],
                "idempotency_key": "release:" + p["id"],
            })
            if response.get("status") != "ok" or response.get("released_unused_only") is not True:
                w["deferral_reason_ref"] = "pending_reservation_release"
                return {"proposal_id": p["id"], "status": "pending"}
        p["status"] = "cancelled"
        w["pending_step_refs"] = []
        w["deferral_reason_ref"] = None
        return {"proposal_id": p["id"], "status": "cancelled"}

    def _source_access(self, actor: str, source_refs: list[str]) -> None:
        require(refs(source_refs) and bool(source_refs), "missing_source")
        self._ask("knowledge", "acquired_sources", {
            "actor_ref": actor, "source_refs": source_refs,
        }, ("all_acquired", "scope_supported"))

    def _account(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "proposition variant source_refs decision_ref transformation correction_of")
        p = exact(d["proposition"], SCHEMAS["account_proposition"])
        v = exact(d["variant"], SCHEMAS["account_variant"])
        require(v["published_at"] is None and v["proposition_id"] == p["id"])
        require(text(v["author_ref"]) and text(v["content_ref"]) and text(d["decision_ref"]))
        require(refs(d["source_refs"]) and refs(d["correction_of"]))
        self._actor(v["author_ref"], "CreateAccount", d)
        parent = None
        if v["parent_variant"] is not None:
            parent = self._get(s, "account_variant", v["parent_variant"])
            require(v["lineage_root"] == parent["lineage_root"] and v["id"] != parent["id"], "invalid_lineage")
            require(parent["content_ref"] in d["source_refs"], "missing_source")
        else:
            require(v["lineage_root"] == v["id"], "invalid_lineage")
        if d["source_refs"]:
            self._source_access(v["author_ref"], d["source_refs"])
        decision = self._ask("knowledge", "account_decision", d,
                             ("actual_decision", "content_scope_supported", "privacy_satisfied", "lineage_preserved"))
        if decision.get("unauthorized_disclosure") is True:
            require(text(decision.get("disclosure_event_ref")), "missing_disclosure_event")
        if not d["source_refs"]:
            require(decision.get("supplied_statement_or_authored_fabrication") is True, "missing_source")
        transform = exact(d["transformation"], "method changed_fields reason_ref")
        require(refs(transform["changed_fields"]))
        if parent is not None or transform["method"] is not None:
            self._ask("manifest", "retelling_semantics", {
                "parent": parent, "variant": v, "transformation": transform,
                "decision_ref": d["decision_ref"],
                "policy": s.dissemination_policy["approved_retelling_operations"],
            }, ("approved", "bounded", "new_allegations_explicit", "summary_adds_no_facts"))
        for identity in d["correction_of"]:
            old = self._get(s, "account_variant", identity)
            self._source_access(v["author_ref"], [old["content_ref"]])
        if p["id"] in s.account_proposition:
            require(s.account_proposition[p["id"]] == p, "immutable_record")
        else:
            self._put(s, "account_proposition", p)
        self._put(s, "account_variant", v)
        info = provenance()
        info.update({
            "observation_refs": decision.get("observation_refs", []),
            "artifact_version_refs": [v["content_ref"]],
            "transformation_actor_ref": v["author_ref"], "transformation_method": transform["method"],
            "changed_fields": transform["changed_fields"], "transformation_reason_ref": transform["reason_ref"],
            "attribution_ref": decision.get("attribution_ref"),
            "confidentiality_scope_ref": decision.get("confidentiality_scope_ref"),
            "disclosure_event_ref": decision.get("disclosure_event_ref"), "correction_links": d["correction_of"],
        })
        s.information_provenance[self._key("variant", v["id"])] = info
        s.time_separation[self._key("variant", v["id"])] = {
            **times(e["canonical_timestamp"]), "relevant_interval": p["relevant_interval"],
        }
        return {"variant_id": v["id"], "status": "draft"}

    def _correction(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        require(bool(d.get("correction_of")), "missing_source")
        return self._account(s, d, e, c)

    def _publish(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "variant_id channel_ref visibility_ref")
        v = self._get(s, "account_variant", d["variant_id"])
        if v["published_at"] is not None:
            return {"variant_id": v["id"], "status": "published"}
        self._actor(v["author_ref"], "PublishAccount", d)
        self._ask("system16", "validate_publication", {
            **d, "author_ref": v["author_ref"], "content_ref": v["content_ref"],
            "era_ref": s.dissemination_policy["era_channel_capabilities_ref"],
        }, ("authorized", "channel_available", "era_supported", "privacy_satisfied"))
        result = self._ask("system16", "publish", {
            **d, "content_ref": v["content_ref"], "idempotency_key": "publish:" + v["id"],
        }, ("published",))
        require(result.get("content_ref") == v["content_ref"] and tick(result.get("published_at")))
        require(s.time_separation[self._key("variant", v["id"])]["entered_or_processed_at"] <= result["published_at"] <= e["canonical_timestamp"], "invalid_chronology")
        require(text(result.get("publication_ref")))
        v["published_at"] = result["published_at"]
        s.time_separation[self._key("variant", v["id"])]["published_or_spoken_at"] = result["published_at"]
        s.information_provenance[self._key("variant", v["id"])]["artifact_version_refs"].append(result["publication_ref"])
        return {"variant_id": v["id"], "status": "published"}

    def _attempt(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "transmission opportunity_ref decision_ref")
        t = exact(d["transmission"], SCHEMAS["transmission"])
        require(t["status"] == "attempted" and t["attempted_at"] == e["canonical_timestamp"])
        require(t["delivered_refs"] == [] and text(d["opportunity_ref"]) and text(d["decision_ref"]))
        v = self._get(s, "account_variant", t["variant_id"])
        control = self._actor(t["sender_ref"], "AttemptTransmission", d)
        self._source_access(t["sender_ref"], [v["content_ref"]])
        opportunity = self._ask("system16", "transmission_opportunity", {
            **d, "content_ref": v["content_ref"],
            "era_ref": s.dissemination_policy["era_channel_capabilities_ref"],
        }, ("actual_opportunity", "recipients_supported", "channel_available", "era_supported", "time_available"))
        decision = self._ask("knowledge", "sharing_decision", {
            **d, "content_ref": v["content_ref"],
        }, ("actual_decision", "privacy_satisfied", "choice_boundary_satisfied"))
        require(decision.get("choice") in {"share", "withhold", "ask", "seek_confirmation"})
        if decision["choice"] != "share":
            return {"status": decision["choice"]}
        require(decision.get("generation_class") in {"discretionary", "required_direct", "supplied_action"})
        require(control != "player" or decision["generation_class"] != "discretionary", "choice_required")
        if decision.get("unauthorized_disclosure") is True:
            require(text(decision.get("disclosure_event_ref")), "missing_disclosure_event")
        require(text(c.get("game_day")))
        checks = []
        root_key = self._key(v["lineage_root"], c["game_day"])
        deferred = False
        if decision["generation_class"] == "discretionary":
            checks = [("retell_tasks_by_actor_day", self._key(t["sender_ref"], c["game_day"]),
                       s.dissemination_policy["discretionary_npc_retell_tasks_per_actor_day"]),
                      ("lineage_hops_by_day", root_key, s.dissemination_policy["hops_per_lineage_day"])]
            try:
                self._budget(s, checks, True)
            except GateError as failure:
                if str(failure) != "budget_exhausted":
                    raise
                deferred = True
        saved = {**t, "status": "deferred", "attempted_at": None} if deferred else t
        self._put(s, "transmission", saved)
        # An attempted task is durable even if delivery is subsequently unavailable.
        info = s.information_provenance.get(self._key("transmission", t["id"]), provenance())
        if d["decision_ref"] not in info["downstream_decision_refs"]:
            info["downstream_decision_refs"].append(d["decision_ref"])
        info["confidentiality_scope_ref"] = decision.get("confidentiality_scope_ref")
        info["disclosure_event_ref"] = decision.get("disclosure_event_ref")
        s.information_provenance[self._key("transmission", t["id"])] = info
        s.time_separation[self._key("transmission", t["id"])] = times(e["canonical_timestamp"])
        # The lineage counter is owned here, never accepted from an external
        # confidence/sharing result. One discretionary retell task is one hop.
        # Required direct communications and supplied actions remain uncapped.
        require(refs(opportunity.get("recipient_refs")) and bool(opportunity["recipient_refs"]))
        return {"transmission_id": t["id"], "status": saved["status"]}

    def _resume_transmission(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "transmission_id opportunity_ref decision_ref")
        previous = self._get(s, "transmission", d["transmission_id"])
        require(previous["status"] == "deferred", "invalid_transition")
        attempt = {**previous, "attempted_at": e["canonical_timestamp"], "status": "attempted"}
        del s.transmission[previous["id"]]
        result = self._attempt(s, {"transmission": attempt,
            "opportunity_ref": d["opportunity_ref"], "decision_ref": d["decision_ref"]}, e, c)
        if previous["id"] not in s.transmission:
            s.transmission[previous["id"]] = {**previous, "status": "withheld"}
        return result

    def _delivery(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "transmission_id")
        t = self._get(s, "transmission", d["transmission_id"])
        require(t["status"] not in {"deferred", "withheld"}, "invalid_transition")
        if t["status"] in {"delivered", "failed"}:
            return {"transmission_id": t["id"], "status": t["status"]}
        result = self._dependencies.call("system16", "delivery", {
            "transmission": t, "idempotency_key": "deliver:" + t["id"],
        })
        if result.get("status") == "pending":
            t["status"] = "delayed"
            return {"transmission_id": t["id"], "status": "delayed"}
        require(result.get("status") == "ok" and result.get("transmission_id") == t["id"])
        require(result.get("delivery_status") in {"failed", "delayed", "partially_delivered", "delivered"})
        require(refs(result.get("delivered_refs")))
        require(set(t["delivered_refs"]) <= set(result["delivered_refs"]), "immutable_record")
        if result["delivered_refs"]:
            require(tick(result.get("delivered_at")))
            require(t["attempted_at"] <= result["delivered_at"] <= e["canonical_timestamp"], "invalid_chronology")
            previous_time = s.time_separation[self._key("transmission", t["id"])]["delivered_at"]
            require(previous_time is None or result["delivered_at"] >= previous_time, "invalid_chronology")
        require(result["delivery_status"] != "delivered" or bool(result["delivered_refs"]))
        t["status"] = result["delivery_status"]
        t["delivered_refs"] = result["delivered_refs"]
        if t["delivered_refs"]:
            s.time_separation[self._key("transmission", t["id"])]["delivered_at"] = result["delivered_at"]
        return {"transmission_id": t["id"], "status": t["status"]}

    def _acquire(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "actor_ref variant_id exposure_ref transmission_id")
        v = self._get(s, "account_variant", d["variant_id"])
        key = self._key("acquired", d["actor_ref"], v["id"])
        for previous in self._history(s, "RecordAcquisition"):
            if previous["input"] == d:
                return deepcopy(previous["reply"]["result"])
        if d["transmission_id"] is not None:
            t = self._get(s, "transmission", d["transmission_id"])
            require(t["variant_id"] == v["id"] and d["exposure_ref"] in t["delivered_refs"], "missing_delivery")
            earliest = t["attempted_at"]
        else:
            require(v["published_at"] is not None, "unpublished")
            earliest = v["published_at"]
        exposure = self._ask("system16", "exposure", d, ("actually_exposed", "recipient_matches", "content_scope_supported"))
        require(exposure.get("actor_ref") == d["actor_ref"] and exposure.get("variant_id") == v["id"])
        require(tick(exposure.get("delivered_at")) and tick(exposure.get("acquired_at")))
        require(earliest <= exposure["delivered_at"] <= exposure["acquired_at"] <= e["canonical_timestamp"], "invalid_chronology")
        require(type(exposure.get("voluntary_viewing")) is bool)
        if exposure.get("voluntary_viewing") is True:
            self._actor(d["actor_ref"], "ViewAccount", d)
        acquisition = self._ask("knowledge", "record_acquisition", {
            **d, "exposure": exposure, "idempotency_key": self._key("acquire", key, d["exposure_ref"]),
        }, ("recorded",))
        require(acquisition.get("actor_ref") == d["actor_ref"] and acquisition.get("variant_id") == v["id"])
        require(text(acquisition.get("acquisition_ref")) and text(acquisition.get("received_content_ref")))
        info = s.information_provenance.get(key, provenance())
        if acquisition["acquisition_ref"] not in info["acquisition_refs"]:
            info["acquisition_refs"].append(acquisition["acquisition_ref"])
        if acquisition["received_content_ref"] not in info["artifact_version_refs"]:
            info["artifact_version_refs"].append(acquisition["received_content_ref"])
        s.information_provenance[key] = info
        timing = {**times(e["canonical_timestamp"]),
            "published_or_spoken_at": v["published_at"], "delivered_at": exposure["delivered_at"],
            "acquired_at": exposure["acquired_at"],
            "relevant_interval": s.account_proposition[v["proposition_id"]]["relevant_interval"]}
        s.time_separation.setdefault(key, timing)
        acquisition_key = self._key("acquisition", acquisition["acquisition_ref"])
        if acquisition_key in s.time_separation:
            require(s.time_separation[acquisition_key] == timing, "immutable_record")
        else:
            s.time_separation[acquisition_key] = timing
        return {"variant_id": v["id"], "status": "acquired"}

    def _belief(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "actor_ref proposition_id variant_ids decision_ref")
        self._get(s, "account_proposition", d["proposition_id"])
        require(refs(d["variant_ids"]) and bool(d["variant_ids"]))
        acquired = []
        for identity in d["variant_ids"]:
            variant = self._get(s, "account_variant", identity)
            require(variant["proposition_id"] == d["proposition_id"])
            key = self._key("acquired", d["actor_ref"], identity)
            require(key in s.information_provenance, "missing_acquisition")
            acquired.extend(s.information_provenance[key]["acquisition_refs"])
        self._actor(d["actor_ref"], "ReviewBelief", d)
        response = self._ask("knowledge", "review_belief", {
            **d, "acquired_source_refs": acquired,
            "idempotency_key": e["idempotency_key"],
        }, ("recorded", "accessible_sources_only", "independence_preserved"))
        assessment = exact(response["assessment"], SCHEMAS["audience_assessment"])
        require(assessment["holder_ref"] == d["actor_ref"] and assessment["proposition_id"] == d["proposition_id"])
        require(assessment["confidence"] in CONFIDENCE and set(assessment["acquired_source_refs"]) <= set(acquired))
        require(bool(assessment["acquired_source_refs"]), "missing_acquisition")
        require(assessment["reviewed_at"] == e["canonical_timestamp"])
        previous = [a for a in s.audience_assessment.values()
                    if a["holder_ref"] == d["actor_ref"] and a["proposition_id"] == d["proposition_id"]]
        require(not previous or assessment["supersedes_id"] is not None, "stale_assessment")
        if assessment["supersedes_id"] is not None:
            old = self._get(s, "audience_assessment", assessment["supersedes_id"])
            require(old["holder_ref"] == d["actor_ref"] and old["proposition_id"] == d["proposition_id"])
            require(not any(x["supersedes_id"] == old["id"] for x in s.audience_assessment.values()), "stale_assessment")
        self._put(s, "audience_assessment", assessment)
        return {"assessment_id": assessment["id"], "status": "recorded"}

    def _media(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "task")
        task = exact(d["task"], SCHEMAS["media_task"])
        require(task["status"] == "inquiry" and task["publication_ref"] is None)
        require(tick(task["due_at"]) and task["due_at"] >= e["canonical_timestamp"])
        self._actor(task["worker_ref"], "OpenMediaTask", d)
        self._source_access(task["worker_ref"], task["source_refs"])
        self._ask("system13", "media_stage", d,
                  ("worker_available", "service_available", "access_valid", "actual_decision", "time_supported"))
        self._put(s, "media_task", task)
        return {"media_task_id": task["id"], "status": task["status"]}

    def _media_advance(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "task_id next_status source_refs publication_variant_id decision_ref")
        task = self._get(s, "media_task", d["task_id"])
        transitions = {
            "inquiry": {"reporting"}, "reporting": {"editorial_review"},
            "editorial_review": {"publication"}, "publication": {"follow_up", "correction"},
            "follow_up": {"reporting"}, "correction": {"reporting"},
        }
        require(d["next_status"] in transitions.get(task["status"], set()), "invalid_transition")
        self._actor(task["worker_ref"], "AdvanceMediaTask", d)
        self._source_access(task["worker_ref"], d["source_refs"])
        self._ask("system13", "media_stage", {"task": task, **d},
                  ("worker_available", "service_available", "access_valid", "actual_decision", "time_supported"))
        if d["next_status"] == "publication":
            variant = self._get(s, "account_variant", d["publication_variant_id"])
            require(variant["published_at"] is not None, "unpublished")
            authorization = self._ask("system13", "publication_assignment", {
                "task_id": task["id"], "variant_id": variant["id"],
            }, ("authorized", "submitted_material_only"))
            publication_ref = authorization.get("publication_ref")
            require(publication_ref in s.information_provenance[self._key("variant", variant["id"])]["artifact_version_refs"])
            task["publication_ref"] = publication_ref
        else:
            require(d["publication_variant_id"] is None)
        task["source_refs"] = list(dict.fromkeys(task["source_refs"] + d["source_refs"]))
        task["status"] = d["next_status"]
        return {"media_task_id": task["id"], "status": task["status"]}

    def _follow_on(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "actor_ref variant_id decision_ref owner workflow_ref parent_occurrence_id generation_class review_ref")
        require(d["owner"] in OWNERS[:14] + ("knowledge", "relationships"))
        require(d["generation_class"] in {"discretionary", "existing_cause_continuation"})
        self._actor(d["actor_ref"], "ScheduleFollowOn", d)
        parent = self._get(s, "city_occurrence", d["parent_occurrence_id"]) if d["parent_occurrence_id"] else None
        if d["variant_id"] is not None:
            self._get(s, "account_variant", d["variant_id"])
            acquisition_key = self._key("acquired", d["actor_ref"], d["variant_id"])
            require(acquisition_key in s.information_provenance, "missing_acquisition")
        else:
            require(parent is not None, "missing_source")
        decision = self._ask(d["owner"], "validate_follow_on", d,
                             ("actual_decision", "causally_relevant", "resources_feasible", "acquired_information_only", "claim_not_promoted_to_truth"))
        require(decision.get("generation_class") == d["generation_class"])
        require(text(decision.get("new_condition_ref")), "missing_new_condition")
        for history in self._history(s, "ScheduleFollowOn"):
            if history["input"]["decision_ref"] == d["decision_ref"]:
                require(history["input"] == d, "idempotency_conflict")
                return deepcopy(history["reply"]["result"])
        checks = []
        if d["generation_class"] == "discretionary" and parent is not None:
            self._ask("system11", "follow_on_review", d, ("due", "new_information_or_later_review"))
            checks = [("follow_on_proposals_by_incident_review",
                       self._key(parent["id"], d["review_ref"]),
                       s.generation_policy["discretionary_follow_ons_per_incident_review"])]
        # A capped request remains queued, retaining its actual decision and cause.
        queued_id = "follow-on:" + fingerprint(d["decision_ref"])
        status = "pending"
        try:
            self._budget(s, checks, True)
            eligible = True
        except GateError as error:
            if str(error) != "budget_exhausted":
                raise
            eligible, status = False, "deferred"
        s.workflow_continuity[self._key("follow_on", queued_id)] = {
            "generation_class": d["generation_class"],
            "eligibility_result": {"eligible": eligible, "request": deepcopy(d)},
            "selection_seed_ref": None, "decision_reasons_ref": d["decision_ref"],
            "pending_step_refs": [d["workflow_ref"]], "completed_owner_event_refs": [],
            "deferral_reason_ref": "budget_exhausted" if not eligible else None,
            "next_review_ref": d["review_ref"], "player_choice_boundary_ref": None,
        }
        info = provenance()
        info["downstream_decision_refs"] = [d["decision_ref"]]
        s.information_provenance[self._key("follow_on", queued_id)] = info
        if parent is not None:
            parent["follow_on_refs"].append(queued_id)
        return {"workflow_id": queued_id, "status": status}

    def _dispatch_follow_on(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "workflow_id review_ref")
        w = self._get(s, "workflow_continuity", self._key("follow_on", d["workflow_id"]))
        request = w["eligibility_result"]["request"]
        if not w["pending_step_refs"]:
            return {"workflow_id": d["workflow_id"], "status": "handed_off"}
        self._actor(request["actor_ref"], "ScheduleFollowOn", request)
        self._ask(request["owner"], "revalidate_follow_on", request,
                  ("actual_decision", "resources_feasible", "choice_boundary_satisfied"))
        if not w["eligibility_result"]["eligible"]:
            self._ask("system11", "follow_on_review", {**request, "review_ref": d["review_ref"]},
                      ("due", "new_information_or_later_review"))
            self._budget(s, [("follow_on_proposals_by_incident_review",
                self._key(request["parent_occurrence_id"], d["review_ref"]),
                s.generation_policy["discretionary_follow_ons_per_incident_review"])], True)
            w["eligibility_result"]["eligible"] = True
            w["next_review_ref"] = d["review_ref"]
        response = self._dependencies.call(request["owner"], "request_workflow", {
            **request, "idempotency_key": d["workflow_id"],
        })
        if response.get("status") != "ok" or response.get("accepted") is not True:
            w["deferral_reason_ref"] = "pending_owner_effect"
            return {"workflow_id": d["workflow_id"], "status": "pending"}
        require(text(response.get("workflow_ref")))
        w["pending_step_refs"] = []
        w["deferral_reason_ref"] = None
        s.information_provenance[self._key("follow_on", d["workflow_id"])]["downstream_decision_refs"].append(response["workflow_ref"])
        return {"workflow_id": d["workflow_id"], "status": "handed_off"}

    def _recurrence(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "recurrence")
        r = exact(d["recurrence"], SCHEMAS["recurrence"])
        require(text(r["series_id"]) and r["series_id"] not in s.recurrence, "already_exists")
        require(r["occurrence_ids"] == [] and r["schedule_revision_refs"] == [])
        self._actor(r["organizer_ref"], "RegisterRecurrence", d)
        self._ask("system11", "register_recurrence", d, ("accepted_plan", "calendar_supported", "resources_supported"))
        s.recurrence[r["series_id"]] = deepcopy(r)
        return {"series_id": r["series_id"], "status": "registered"}

    def _recurrence_review(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "series_id occurrence_id decision_ref")
        r = self._get(s, "recurrence", d["series_id"])
        result = self._ask("system11", "recurrence_occurrence", d, ("supported",))
        require(result.get("series_id") == r["series_id"] and result.get("occurrence_id") == d["occurrence_id"])
        require(tick(result.get("occurred_at")) and result["occurred_at"] <= e["canonical_timestamp"])
        status = result.get("occurrence_status")
        require(status in {"due", "confirmed", "completed", "cancelled", "postponed", "missed"})
        previous = [x["reply"]["result"] for x in self._history(s, "ReviewRecurrence")
                    if x["input"]["series_id"] == r["series_id"] and x["input"]["occurrence_id"] == d["occurrence_id"]]
        if previous:
            last = previous[-1]
            allowed = {
                "due": {"confirmed", "cancelled", "postponed", "missed"},
                "confirmed": {"completed", "cancelled", "postponed", "missed"},
                "postponed": {"confirmed", "cancelled", "missed"},
                "completed": set(), "cancelled": set(), "missed": set(),
            }
            require(status == last["status"] or status in allowed[last["status"]], "invalid_transition")
        else:
            require(status == "due", "invalid_transition")
        if status != "due":
            require(result.get("actual_decision") is True or status == "missed")
        if status in {"confirmed", "cancelled", "postponed"}:
            self._actor(r["organizer_ref"], "ReviewRecurrence", d)
        if status == "completed":
            self._get(s, "city_occurrence", d["occurrence_id"])
        require(text(result.get("schedule_revision_ref")))
        if result["schedule_revision_ref"] not in r["schedule_revision_refs"]:
            r["schedule_revision_refs"].append(result["schedule_revision_ref"])
        if d["occurrence_id"] not in r["occurrence_ids"]:
            r["occurrence_ids"].append(d["occurrence_id"])
        # Calendar changes deliberately perform no recipient or attendance update.
        return {"series_id": r["series_id"], "occurrence_id": d["occurrence_id"], "status": status}

    def _retention(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "artifact_ref policy_ref")
        require(d["policy_ref"] in s.presentation_policy["retention_policy_refs"], "missing_policy")
        result = self._ask("system16", "apply_retention", {
            **d, "canonical_timestamp": e["canonical_timestamp"], "idempotency_key": e["idempotency_key"],
        }, ("source_specific", "recipient_copies_preserved", "audit_preserved"))
        require(text(result.get("retention_event_ref")))
        return {"status": "recorded", "retention_event_ref": result["retention_event_ref"]}

    def _query(self, s: CityState, name: str, d: JSONObject, authority: JSONObject) -> JSONObject:
        if name == "ExportState":
            exact(d, "")
            require(authority.get("administrative") is True, "access_denied")
            return {"state": asdict(s)}
        exact(d, "actor_ref scope_ref")
        require(d["actor_ref"] == authority["actor_ref"] or authority.get("can_view_actor") == d["actor_ref"], "access_denied")
        known = []
        for identity in s.account_variant:
            key = self._key("acquired", d["actor_ref"], identity)
            if key in s.information_provenance:
                known.append({"variant_id": identity,
                              "acquisition_refs": s.information_provenance[key]["acquisition_refs"],
                              "received_content_refs": s.information_provenance[key]["artifact_version_refs"],
                              "acquired_at": s.time_separation[key]["acquired_at"]})
        result = self._ask("knowledge", "query_view", {
            "query": name, **d, "acquired_accounts": known,
        }, ("safe_for_actor", "available_or_acquired_only"))
        require(result.get("actor_ref") == d["actor_ref"] and type(result.get("items")) is list)
        allowed = {"kind", "variant_id", "content_ref", "display_text", "claimed_source_ref", "qualifiers_ref",
                   "published_at", "acquired_at", "relevant_interval", "known_place_ref", "uncertainty",
                   "urgency", "obligation", "physical_interruption", "known_change_ref", "known_calendar_ref"}
        items = []
        for item in result["items"]:
            require(type(item) is dict)
            safe = {key: value for key, value in item.items() if key in allowed}
            if name == "GetReceivedRumors":
                require(any(x["variant_id"] == safe.get("variant_id") for x in known), "unavailable")
            items.append(safe)
        return {"items": items}

    def _present(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "actor_ref scope_ref scene_ref more_requested_ref")
        authority = self._ask("diagnostics", "authorize_view", d, ("authorized",))
        result = self._query(s, "GetKnownCityChanges", {
            "actor_ref": d["actor_ref"], "scope_ref": d["scope_ref"],
        }, authority)
        if d["more_requested_ref"] is not None:
            self._ask("player", "more_requested", d, ("explicit",))
        key = self._key(d["actor_ref"], d["scene_ref"])
        used = s.budget_projections["optional_updates_by_scene"].get(key, 0)
        remaining = max(0, s.presentation_policy["optional_low_urgency_updates_per_ordinary_scene"] - used)
        shown = []
        for item in result["items"]:
            urgent = item.get("urgency") == "urgent" or item.get("obligation") is True or item.get("physical_interruption") is True
            if urgent or d["more_requested_ref"] is not None:
                shown.append(item)
            elif remaining:
                shown.append(item)
                remaining -= 1
                used += 1
        s.budget_projections["optional_updates_by_scene"][key] = used
        s.derived_views["known_city_view_by_actor"][d["actor_ref"]] = {
            "version": len(s.city_event) + 1, "items": deepcopy(shown),
        }
        # AI is optional; the returned structured known-state view is sufficient.
        return {"items": shown}

    def _repair(self, s: CityState, d: JSONObject, e: Envelope, c: JSONObject) -> JSONObject:
        exact(d, "scope_ref reason_ref provenance_ref")
        require(all(text(x) for x in d.values()))
        self._ask("diagnostics", "repair", d, ("authorized", "administrative"))
        # The only automatic repair rebuilds derived circulation, never history.
        circulation: JSONObject = {}
        for transmission in s.transmission.values():
            if transmission["delivered_refs"]:
                variant = s.account_variant[transmission["variant_id"]]
                row = circulation.setdefault(variant["proposition_id"], {"transmissions": 0, "lineage_roots": []})
                row["transmissions"] += 1
                if variant["lineage_root"] not in row["lineage_roots"]:
                    row["lineage_roots"].append(variant["lineage_root"])
        s.derived_views["circulation_by_proposition"] = circulation
        return {"status": "rebuilt"}

    def process_due(self, request: Command) -> Reply:
        """Run explicit scheduler order; each task is an independent transaction.

        Scheduler fixtures supply complete command envelopes, including revisions.
        No local tie-breaker or catch-up clock is invented. Earlier successful tasks
        survive a later failure. Choice/pause gates are checked for every task.
        """
        with self._lock:
            try:
                exact(request, "command envelope input")
                require(request["command"] == "ProcessDueBoundary")
                self._ask("diagnostics", "authorize_batch", request, ("authorized",))
                batch = self._ask("system11", "due_commands", request,
                                  ("chronological", "tie_order_explicit", "bounded"))
                commands = batch["commands"]
                require(type(commands) is list)
                stamps = [x["envelope"]["canonical_timestamp"] for x in commands]
                require(all(tick(x) for x in stamps) and stamps == sorted(stamps), "invalid_chronology")
                results = []
                for command in commands:
                    require(command["command"] in MUTATIONS, "unsupported_command")
                    result = self.step(command)
                    results.append(result)
                    if result["status"] != "ok":
                        break
                return {"status": "ok", "revision": self.revision, "result": {
                    "results": results, "remaining": len(commands) - len(results),
                }}
            except Pending:
                return {"status": "pending", "revision": self.revision, "error": "pending_dependency"}
            except GateError as error:
                return {"status": "rejected", "revision": self.revision, "error": str(error)}
            except (KeyError, TypeError, ValueError):
                return {"status": "rejected", "revision": self.revision, "error": "invalid_request"}

    @classmethod
    def restore(cls, snapshot: JSONObject, dependencies: MockDependencies,
                authority_ref: str) -> LivingCityRumor:
        """Restore or branch an authorized snapshot without replaying effects."""
        engine = cls(dependencies)
        engine._ask("diagnostics", "restore", {"authority_ref": authority_ref}, ("authorized", "administrative"))
        exact(snapshot, " ".join(f.name for f in fields(CityState)))
        state = CityState(**json.loads(canonical(snapshot)))
        engine._validate_state(state)
        engine._state = state
        return engine

    @staticmethod
    def _state_digest(s: CityState) -> str:
        document = asdict(s)
        if document["city_event"]:
            latest = max(document["city_event"].values(), key=lambda x: x["payload_ref"]["value"]["reply"]["revision"])
            latest["payload_ref"]["value"]["state_digest"] = None
        return fingerprint(document)

    @staticmethod
    def _validate_state(s: CityState) -> None:
        """Validate snapshots and staged commits before replacing live state."""
        canonical(asdict(s))
        require(all(type(getattr(s, f.name)) is dict for f in fields(CityState)))
        for table, schema in SCHEMAS.items():
            for key, record in getattr(s, table).items():
                require(text(key))
                exact(record, schema)
                if table not in {"city_template", "workflow_continuity", "information_provenance", "time_separation"}:
                    require(record.get("id", record.get("series_id")) == key)
                for name, value in record.items():
                    if name.endswith("_refs") or name in {"changed_fields", "occurrence_ids"}:
                        require(refs(value))
                    if name.endswith("_at"):
                        require(value is None or tick(value))
                    if name.endswith("_ref") and name != "payload_ref":
                        require(value is None or text(value))
                    if name in {"id", "series_id", "proposition_id", "lineage_root", "template_version", "version"}:
                        require(text(value))
                    if name == "relevant_interval" and value is not None:
                        require(type(value) is list and len(value) == 2 and tick(value[0]))
                        require(value[1] is None or (tick(value[1]) and value[1] >= value[0]))
        for name, defaults in (("generation_policy", generation_defaults()),
                               ("dissemination_policy", dissemination_defaults()),
                               ("presentation_policy", presentation_defaults())):
            policy = getattr(s, name)
            exact(policy, " ".join(defaults))
            for key, value in defaults.items():
                if type(value) is int:
                    require(tick(policy[key]))
                elif type(value) is bool:
                    require(type(policy[key]) is bool)
        require(refs(s.generation_policy["enabled_families"]) and set(s.generation_policy["enabled_families"]) <= set(FAMILIES))
        require(text(s.generation_policy["policy_version"]))
        exact(s.budget_projections, " ".join(budget_defaults()))
        for counters in s.budget_projections.values():
            require(type(counters) is dict and all(text(k) and tick(v) for k, v in counters.items()))
        exact(s.derived_views, "neighborhood_projection known_city_view_by_actor circulation_by_proposition")
        owner_refs: set[str] = set()
        for occurrence in s.city_occurrence.values():
            require(not owner_refs.intersection(occurrence["owner_event_refs"]), "duplicate_owner_effect")
            owner_refs.update(occurrence["owner_event_refs"])
            require(occurrence["proposal_ref"] is None or occurrence["proposal_ref"] in s.city_proposal)
        for p in s.city_proposal.values():
            require(p["template_version"] in s.city_template and LivingCityRumor._key("proposal", p["id"]) in s.workflow_continuity)
        for identity, v in s.account_variant.items():
            require(v["proposition_id"] in s.account_proposition and v["lineage_root"] in s.account_variant)
            seen = set()
            cursor = identity
            while cursor is not None:
                require(cursor in s.account_variant and cursor not in seen, "invalid_lineage")
                seen.add(cursor)
                current = s.account_variant[cursor]
                require(current["lineage_root"] == v["lineage_root"], "invalid_lineage")
                if current["parent_variant"] is None:
                    require(current["id"] == v["lineage_root"], "invalid_lineage")
                cursor = current["parent_variant"]
        for t in s.transmission.values():
            require(t["variant_id"] in s.account_variant)
        for a in s.audience_assessment.values():
            require(a["confidence"] in CONFIDENCE and a["proposition_id"] in s.account_proposition)
            require(a["supersedes_id"] is None or a["supersedes_id"] in s.audience_assessment)
        keys, chronology = set(), []
        for event in s.city_event.values():
            require(event["idempotency_key"] not in keys, "idempotency_conflict")
            keys.add(event["idempotency_key"])
            exact(event["payload_ref"], "value")
            payload = exact(event["payload_ref"]["value"], "command input request_digest reply state_digest")
            require(payload["command"] in MUTATIONS and text(payload["request_digest"]))
            revision = payload["reply"]["revision"]
            require(type(revision) is int and revision > 0)
            chronology.append((revision, event["processed_at"]))
        chronology.sort()
        require([x[0] for x in chronology] == list(range(1, len(chronology) + 1)), "invalid_revision_history")
        stamps = [x[1] for x in chronology]
        require(stamps == sorted(stamps), "invalid_chronology")
        if s.city_event:
            latest = max(s.city_event.values(), key=lambda x: x["payload_ref"]["value"]["reply"]["revision"])
            require(latest["payload_ref"]["value"]["state_digest"] == LivingCityRumor._state_digest(s), "invalid_snapshot_integrity")
        else:
            require(asdict(s) == asdict(CityState()), "missing_event_history")


MUTATIONS = {
    "RegisterTemplate": "register_template", "ConfigurePolicies": "configure",
    "ProposeCityEvent": "propose", "ValidateProposal": "validate_proposal",
    "ReviewNeighborhood": "review", "CommitCityWorkflow": "commit",
    "ExecuteWorkflowStep": "execute_step",
    "RecordCityOutcome": "outcome", "CancelCityWorkflow": "cancel",
    "CreateAccount": "account", "IssueCorrection": "correction", "PublishAccount": "publish",
    "AttemptTransmission": "attempt", "ResumeTransmission": "resume_transmission", "RecordDelivery": "delivery",
    "RecordAcquisition": "acquire", "ReviewBelief": "belief",
    "OpenMediaTask": "media", "AdvanceMediaTask": "media_advance",
    "ScheduleFollowOn": "follow_on", "DispatchFollowOn": "dispatch_follow_on",
    "RegisterRecurrence": "recurrence", "ReviewRecurrence": "recurrence_review",
    "ApplyRetention": "retention", "PresentKnownInformation": "present",
    "RebuildProjections": "repair",
}
