"""System 11: deterministic, isolated time, scheduling, and calendar service.

Python 3.12+. Install requirements.txt for the pinned timezone database.
Only State contains simulation state. Adapter functions are deliberately stateless
JSON fixtures: they never calculate another system's behavior or effects.
The in-process coordinator serializes transitions; export_state/import_state are
the persistence boundary. Mock persistence acknowledgments are NOT durable disk
writes. A hosting engine must durably store exported state before publishing it.
All mutation entry points accept JSON dictionaries. Owner entry points are trusted
adapter endpoints, never player endpoints. Mock credentials are test fixtures.
"""

from __future__ import annotations

import calendar
import copy
import hashlib
import json
import re
import threading
from dataclasses import dataclass, field, fields
from datetime import date, datetime, timedelta, timezone
from importlib.resources import files
from typing import Any, TypedDict
from zoneinfo import ZoneInfo

import tzdata

JSON = dict[str, Any]
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
PINNED_TZDATA = "2026d"
PINNED_PACKAGE = "2026.4"
VERSION = "system11/1"
DAY = 86_400_000
LOCK = threading.RLock()
MAX_MS = 253_402_214_399_999  # Leave one local day below datetime's upper limit.
MIN_MS = -62_135_510_400_000
DOMAINS = (
    "system1", "system2", "system3", "system4", "system5", "system6",
    "system7", "system8", "system9", "system10", "travel", "employment",
    "health", "institutions", "communication", "environment", "combat",
    "configuration", "persistence",
)
INTEGRATORS = ("health", "travel", "employment", "environment", "system10")
KINDS = {"execute_action", "wait_duration", "wait_until_local_time",
         "wait_for_known_event", "sleep", "fast_forward_routine"}
SLOTS = {"locomotion", "hands_body_execution", "focused_attention", "sleep_rest"}
PHASES = {
    "PhysicalTransition": 0, "ActionCompleted": 0, "Arrival": 0, "Signal": 0,
    "OccurrenceEnded": 1, "ConditionBoundary": 1,
    "DeadlineTriggered": 2, "AttendanceWindowClosed": 2,
    "OccurrenceDue": 3, "CalendarBoundaryReached": 3,
    "BreakWindowOpened": 3, "PaymentScheduleDue": 3,
    "ContractBoundaryReached": 3, "Notification": 4,
    "NPCReplan": 3,
}
EXCEPTION_RANK = {"one_off_closure": 0, "cancellation": 0,
                  "date_specific_override": 1, "holiday_policy": 2}
DEFAULTS = {
    "scheduled_quantum_ms": 1000, "recurrence_lookahead_local_days": 14,
    "maximum_expansion_chunk_days": 90, "routine_segment_ceiling_ms": 21_600_000,
    "foreground_checkpoint_ceiling_ms": 60_000,
    "critical_speech_checkpoint_ceiling_ms": 30_000,
    "sleep_initiation_checkpoint_ms": 900_000,
    "known_event_wait_maximum_ms": 3_600_000,
    "ordinary_npc_replan_interval_ms": 300_000,
    "maximum_microsteps_per_instant": 128, "speech_words_per_minute": 150,
    "speech_pause_per_executed_turn_ms": 2000,
    "signing_lexical_units_per_minute": 120, "typing_words_per_minute": 40,
    "typing_setup_ms": 5000, "reading_words_per_minute": 200,
    "tokenizer_version": "lexical-ascii-markup/1", "real_time_enabled": False,
}

# Record whitelists deliberately contain only architecture-listed variables.
SCHEMA = {
    "world_clock": "branch_id instant_ms revision timezone_id tzdata_version last_event_sequence",
    "temporal_event_metadata": "branch_id sequence effective_instant_ms command_id correlation_id causation_id schema_version ruleset_version visibility_ref",
    "advance_intent": "advance_id command_id branch_id actor_id expected_clock_revision authorization_ref causation_id kind start_ms maximum_horizon_ms duration_ms local_target requested_target_ms activity_ref method_ref location_ref location_constraints known_target_ref stop_predicate_refs interrupt_policy allowed_automatic_continuations delegation_ref cancellation_requested continuation_of",
    "duration_contract": "activity_id owner_domain source_intent_ref profile_ref profile_version policy_kind estimated_duration resolved_duration_ms frozen_input_refs sample_or_capability_result_ref checkpoint_policy_ref progress_ref activity_state interruptibility_policy_ref resource_release_policy_ref",
    "temporal_segment": "segment_id advance_id start_ms end_ms state snapshot_hash causal_intent_ref owner_input_revisions reservation_refs event_batch_ids integration_receipt_refs unresolved_coverage_refs continuation_authorization_ref result_status",
    "activity_reservation": "reservation_id branch_id resource_id owner_activity_id source_intent_ref owner_domain version revision start_ms end_ms exclusivity_class actor_slots attention_requirements load_requirements capacity_requirements status release_policy_ref",
    "schedule_rule": "schedule_id schedule_version owner_domain subject_or_resource_ref timezone_id tzdata_version recurrence_basis recurrence_kind recurrence_payload interval_policy gap_policy fold_policy exception_hierarchy validity_start validity_end_or_expiry_policy priority_policy_ref revision",
    "schedule_exception": "exception_id schedule_ref version kind affected_date_or_occurrence override_payload reason source_ref visibility_ref",
    "schedule_occurrence": "occurrence_id schedule_id schedule_version local_occurrence_key fold_policy timezone_id tzdata_version resolved_start_ms resolved_end_ms status cancellation_reason replacement_or_lineage_ref",
    "calendar_definition": "calendar_id version timezone_id weekend_pattern date_rules actual_and_observed_date_links leap_day_reminder_policy exception_precedence institution_or_character_policy_refs visibility_refs",
    "deadline": "deadline_id owner_domain source_ref version resolved_instant_ms cutoff_policy owner_predicate_ref consequence_owner_ref grace_interval_refs accepted_extension_refs trigger_identity trigger_state completion_evidence_refs consequence_receipt_refs visibility_ref",
    "scheduled_event": "event_id branch_id due_ms phase owner_domain occurrence_key payload_json state source_event_id cancellation_tombstone",
    "event_delivery": "event_ref owner_domain command_id idempotency_key delivery_state receipt_ref outbox_cursor",
    "owner_interval_receipt": "receipt_id owner_domain segment_id start_ms end_ms input_revision_refs activity_context_refs accepted_effect_refs idempotency_key status",
    "advance_result": "advance_id status committed_start committed_end elapsed_ms requested_target pending_activity_ref progress_ref stop_reason observation_refs next_permitted_options trace_id",
    "time_trace": "trace_id candidate_boundaries selected_boundary_ms authorization_refs owner_revision_refs duration_and_sample_refs conflict_resolution_refs command_and_receipt_refs delivered_observation_refs continuation_decision microstep_count loop_causation_refs model_version input_projection_hash",
    "versioned_defaults": " ".join(DEFAULTS),
}


class AdvanceRequest(TypedDict):
    command_id: str
    branch_id: str
    actor_id: str
    expected_clock_revision: int
    authorization_ref: str
    causation_id: str
    kind: str
    maximum_horizon_ms: int
    location_ref: str


class TemporalError(Exception):
    def __init__(self, code: str, retryable: bool = False):
        super().__init__(code)
        self.code, self.retryable = code, retryable


def require(condition: bool, code: str = "INVALID_REQUEST") -> None:
    if not condition:
        raise TemporalError(code)


def integer(value: Any, minimum: int = MIN_MS, maximum: int = MAX_MS) -> int:
    require(type(value) is int and minimum <= value <= maximum, "INVALID_DURATION")
    return value


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def stable(*values: Any) -> str:
    return hashlib.sha256(canonical(values).encode()).hexdigest()


def record(kind: str, value: JSON) -> JSON:
    require(type(value) is dict and not (value.keys() - set(SCHEMA[kind].split())))
    canonical(value)
    for key, item in value.items():
        if key.endswith("_ms") or key in {"revision", "sequence", "last_event_sequence", "phase", "microstep_count"}:
            integer(item)
        elif key.endswith("_refs") or key in {"actor_slots", "stop_predicate_refs", "allowed_automatic_continuations",
                "event_batch_ids", "exception_hierarchy", "weekend_pattern", "date_rules", "actual_and_observed_date_links",
                "exception_precedence", "candidate_boundaries"}:
            require(type(item) is list)
        elif key in {"cancellation_requested", "real_time_enabled"}:
            require(type(item) is bool)
        elif key.endswith("_id") or key.endswith("_ref") or key in {"owner_domain", "version", "state", "status", "kind"}:
            require((key == "delegation_ref" and item is None) or (isinstance(item, str) and bool(item)))
    return copy.deepcopy(value)


def instant(dt: datetime) -> int:
    delta = dt.astimezone(timezone.utc) - EPOCH
    return integer(delta.days * DAY + delta.seconds * 1000 + delta.microseconds // 1000)


def utc(ms: int) -> datetime:
    return EPOCH + timedelta(milliseconds=integer(ms))


def pinned_zone(name: str, version: str) -> ZoneInfo:
    require(version == PINNED_TZDATA and tzdata.__version__ == PINNED_PACKAGE
            and tzdata.IANA_VERSION == version, "RECOVERY_PENDING")
    require(isinstance(name, str) and name and all(
        part not in ("", ".", "..") for part in name.split("/")), "UNKNOWN_LOCAL_TIME")
    try:
        with files("tzdata.zoneinfo").joinpath(*name.split("/")).open("rb") as handle:
            return ZoneInfo.from_file(handle, key=name)
    except (FileNotFoundError, ValueError):
        raise TemporalError("UNKNOWN_LOCAL_TIME") from None


def resolve_local(value: str, zone: ZoneInfo, gap: str = "shift_forward_by_gap",
                  fold: str = "first_occurrence") -> int:
    require(gap in {"shift_forward_by_gap", "reject"}, "UNKNOWN_LOCAL_TIME")
    require(fold in {"first_occurrence", "second_occurrence", "reject"},
            "AMBIGUOUS_LOCAL_TIME")
    try:
        local = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise TemporalError("UNKNOWN_LOCAL_TIME") from None
    require(local.tzinfo is None and local.microsecond % 1000 == 0, "UNKNOWN_LOCAL_TIME")
    candidates = sorted({instant(local.replace(tzinfo=zone, fold=f)) for f in (0, 1)
                         if local.replace(tzinfo=zone, fold=f).astimezone(timezone.utc)
                         .astimezone(zone).replace(tzinfo=None) == local})
    if not candidates:
        require(gap != "reject", "UNKNOWN_LOCAL_TIME")
        shifted = [local.replace(tzinfo=zone, fold=f).astimezone(timezone.utc)
                   .astimezone(zone) for f in (0, 1)]
        return instant(min((x for x in shifted if x.replace(tzinfo=None) > local),
                           key=lambda x: x.replace(tzinfo=None)))
    require(len(candidates) < 2 or fold != "reject", "AMBIGUOUS_LOCAL_TIME")
    return candidates[-1] if fold == "second_occurrence" else candidates[0]


def interval_union(intervals: list[list[int]]) -> int:
    total, end = 0, None
    for start, stop in sorted(intervals):
        integer(start)
        integer(stop, start)
        total += max(0, stop - max(start, end if end is not None else start))
        end = max(stop, end if end is not None else stop)
    return total


def duration_ms(profile: str, defaults: JSON, *, text: str = "", units: int = 1) -> int:
    """Pure temporal arithmetic; this does not execute communication or learning."""
    require(defaults["tokenizer_version"] == "lexical-ascii-markup/1", "RECOVERY_PENDING")
    integer(units, 0)
    words = len(re.findall(r"[^\W_]+(?:['’-][^\W_]+)*", re.sub(r"<[^>]*>", "", text)))
    fixed = {"known_ui": 0, "obvious_glance": 0, "brief_inspection": 30_000,
             "simple_item": 5000, "record_lookup": 120_000, "gesture": 2000}
    if profile in fixed:
        return fixed[profile]
    if profile == "room_search":
        return integer(300_000 * units, 0)
    if profile == "speech":
        return 0 if not words else max(2000, ((words * 60 + defaults["speech_words_per_minute"] - 1)
            // defaults["speech_words_per_minute"]) * 1000 + defaults["speech_pause_per_executed_turn_ms"])
    if profile in {"typing", "reading", "signing"}:
        count = units if profile == "signing" else words
        if not count:
            return 0
        rate = defaults[{"typing": "typing_words_per_minute", "reading": "reading_words_per_minute",
                         "signing": "signing_lexical_units_per_minute"}[profile]]
        result = ((count * 60 + rate - 1) // rate) * 1000
        return result + defaults["typing_setup_ms"] if profile == "typing" else (
            max(2000, result) if profile == "reading" else result)
    raise TemporalError("INVALID_DURATION")


def mock_dependency(domain: str, operation: str, payload: JSON) -> JSON:
    """Dummy adapter envelopes only. No external game state is stored or simulated."""
    base = {"available": True, "owner_domain": domain, "revision": "mock:revision:1"}
    if operation == "authorize":
        return base | {"authorized": payload.get("authorization_ref") == "mock:authorization"
            and payload.get("actor_id") == "mock:pc", "maximum_duration_ms": 366 * DAY,
            "allowed_kinds": sorted(KINDS), "allowed_location_refs": ["mock:location"],
            "allowed_continuations": [], "delegation_refs": ["mock:delegation"]}
    if operation == "authenticate_owner":
        return base | {"authorized": payload.get("credential") == "mock:owner:" + domain}
    if operation == "validate_intent":
        return base | {"accepted": True, "access_confirmed": True, "prerequisites_met": True}
    if operation == "validate_predicates":
        return base | {"accepted": all(ref == "mock:known" for ref in payload["refs"])}
    if operation == "configuration":
        return base | {"tzdata_version": PINNED_TZDATA, "ruleset_version": VERSION,
                       "defaults": copy.deepcopy(DEFAULTS)}
    if operation == "contract":
        return base | {"required": domain in INTEGRATORS, "can_create_barrier": True,
                       "boundaries": [], "subsecond_allowed": domain == "combat"}
    if operation == "duration":
        amount = payload.get("accepted_duration_ms", 30_000) if payload.get("kind") in {"sleep", "fast_forward_routine"} else 30_000
        return base | {"profile_ref": "rest_interval" if domain == "health" else "brief_inspection", "profile_version": VERSION,
                       "policy_kind": "fixed", "resolved_duration_ms": amount,
                       "estimated_duration": amount, "frozen_input_refs": ["mock:task:001"],
                       "checkpoint_policy_ref": "mock:checkpoint", "progress_ref": "mock:progress:001",
                       "activity_state": "ACTIVE", "interruptibility_policy_ref": "mock:interruptible",
                       "resource_release_policy_ref": "mock:release"}
    if operation == "reservation_requirements":
        return base | {"actor_slots": ["sleep_rest"] if payload["kind"] == "sleep"
                       else ["hands_body_execution"], "exclusivity_class": "exclusive",
                       "attention_requirements": {}, "load_requirements": {},
                       "capacity_requirements": {"units": 1, "capacity": 1}}
    if operation == "prepare_interval":
        return base | {"earlier_boundary_ms": None, "receipt": {
            "receipt_id": "mock:" + payload["idempotency_key"], "owner_domain": domain,
            "segment_id": payload["segment_id"], "start_ms": payload["start_ms"],
            "end_ms": payload["end_ms"], "input_revision_refs": ["mock:revision:1"],
            "activity_context_refs": payload["activity_context_refs"], "accepted_effect_refs": [],
            "idempotency_key": payload["idempotency_key"], "status": "PREPARED"}}
    if operation == "receipt_lookup":
        return base | {"found": False}
    if operation in {"commit_interval", "persist", "cancel_preparation", "publish"}:
        return base | {"accepted": True, "receipt_ref": "mock:" + stable(domain, operation, payload)}
    if operation == "resolve_simultaneous":
        return base | {"accepted": True, "resolution_ref": "mock:" + stable(payload)}
    if operation == "deadline_evidence":
        return base | {"eligible": False, "completed_at": None, "completion_evidence_refs": [],
                       "owner_cutoff_satisfied": False}
    if operation == "handle_due_batch":
        return base | {"results": [{"event_id": event["event_id"], "accepted": True,
            "receipt_ref": "mock:event:" + stable(payload["branch_id"], event["event_id"]),
            "new_events": [], "observation_refs": [], "barrier": None,
            "completion_evidence_refs": [], "activity_state": "COMPLETED",
            "progress_ref": "mock:progress:001"} for event in payload["events"]]}
    if operation == "review":
        return base | {"barrier": None, "predicate_satisfied": False, "observation_refs": [],
                       "next_permitted_options": [], "progress_ref": "mock:progress:001"}
    if operation == "complete_activity":
        return base | {"activity_state": "COMPLETED", "progress_ref": "mock:progress:001",
                       "receipt_ref": "mock:" + payload["idempotency_key"]}
    if operation == "release_resources":
        return base | {"releasable_reservation_refs": payload["reservation_refs"]}
    if operation == "project":
        return base | {"observation_refs": [], "next_permitted_options": [],
                       "stop_reason": {"code": payload["public_code"]}}
    if operation == "safe_compensation":
        return base | {"supported": False}
    raise TemporalError("OWNER_UNAVAILABLE", True)


# Separate callable boundaries make replacement with fixture-only test doubles explicit.
def request_system_1(operation: str, payload: JSON) -> JSON: return mock_dependency("system1", operation, payload)
def request_system_2(operation: str, payload: JSON) -> JSON: return mock_dependency("system2", operation, payload)
def request_system_3(operation: str, payload: JSON) -> JSON: return mock_dependency("system3", operation, payload)
def request_system_4(operation: str, payload: JSON) -> JSON: return mock_dependency("system4", operation, payload)
def request_system_5(operation: str, payload: JSON) -> JSON: return mock_dependency("system5", operation, payload)
def request_system_6(operation: str, payload: JSON) -> JSON: return mock_dependency("system6", operation, payload)
def request_system_7(operation: str, payload: JSON) -> JSON: return mock_dependency("system7", operation, payload)
def request_system_8(operation: str, payload: JSON) -> JSON: return mock_dependency("system8", operation, payload)
def request_system_9(operation: str, payload: JSON) -> JSON: return mock_dependency("system9", operation, payload)
def request_system_10(operation: str, payload: JSON) -> JSON: return mock_dependency("system10", operation, payload)
def request_travel(operation: str, payload: JSON) -> JSON: return mock_dependency("travel", operation, payload)
def request_employment(operation: str, payload: JSON) -> JSON: return mock_dependency("employment", operation, payload)
def request_health(operation: str, payload: JSON) -> JSON: return mock_dependency("health", operation, payload)
def request_institutions(operation: str, payload: JSON) -> JSON: return mock_dependency("institutions", operation, payload)
def request_communication(operation: str, payload: JSON) -> JSON: return mock_dependency("communication", operation, payload)
def request_environment(operation: str, payload: JSON) -> JSON: return mock_dependency("environment", operation, payload)
def request_combat(operation: str, payload: JSON) -> JSON: return mock_dependency("combat", operation, payload)
def request_configuration(operation: str, payload: JSON) -> JSON: return mock_dependency("configuration", operation, payload)
def request_persistence(operation: str, payload: JSON) -> JSON: return mock_dependency("persistence", operation, payload)


def call(domain: str, operation: str, payload: JSON) -> JSON:
    require(domain in DOMAINS, "OWNER_UNAVAILABLE")
    name = "request_system_" + domain[6:] if domain.startswith("system") else "request_" + domain
    try:
        response = globals()[name](operation, copy.deepcopy(payload))
        canonical(response)
    except TemporalError:
        raise
    except Exception:
        raise TemporalError("OWNER_UNAVAILABLE", True) from None
    require(type(response) is dict and response.get("available") is True, "OWNER_UNAVAILABLE")
    return response


@dataclass(slots=True)
class State:
    """Only architecture-listed state variables; keyed collections hold their records."""
    domain: str = "time_schedule_calendar"
    world_clock: JSON = field(default_factory=dict)
    temporal_event_metadata: JSON = field(default_factory=dict)
    advance_intent: JSON = field(default_factory=dict)
    duration_contract: JSON = field(default_factory=dict)
    temporal_segment: JSON = field(default_factory=dict)
    activity_reservation: JSON = field(default_factory=dict)
    schedule_rule: JSON = field(default_factory=dict)
    schedule_exception: JSON = field(default_factory=dict)
    schedule_occurrence: JSON = field(default_factory=dict)
    calendar_definition: JSON = field(default_factory=dict)
    deadline: JSON = field(default_factory=dict)
    scheduled_event: JSON = field(default_factory=dict)
    event_delivery: JSON = field(default_factory=dict)
    owner_interval_receipt: JSON = field(default_factory=dict)
    advance_result: JSON = field(default_factory=dict)
    time_trace: JSON = field(default_factory=dict)
    versioned_defaults: JSON = field(default_factory=lambda: copy.deepcopy(DEFAULTS))


def default_state(branch_id: str = "main", instant_ms: int = 1_325_404_800_000) -> State:
    config = call("configuration", "configuration", {})
    pinned_zone("America/Los_Angeles", config["tzdata_version"])
    require(isinstance(branch_id, str) and bool(branch_id))
    return State(world_clock={"branch_id": branch_id, "instant_ms": integer(instant_ms),
        "revision": 0, "timezone_id": "America/Los_Angeles",
        "tzdata_version": config["tzdata_version"], "last_event_sequence": 0},
        versioned_defaults=config["defaults"])


class TimeScheduleCalendar:
    """Stateless service methods over an explicit State argument; no hidden game fields."""

    @staticmethod
    def export_state(state: State) -> JSON:
        with LOCK:
            return copy.deepcopy({f.name: getattr(state, f.name) for f in fields(State)})

    @staticmethod
    def import_state(payload: JSON) -> State:
        require(type(payload) is dict and set(payload) == {f.name for f in fields(State)}, "RECOVERY_PENDING")
        state = State(**copy.deepcopy(payload))
        try:
            TimeScheduleCalendar.validate_state(state)
        except (KeyError, TypeError, ValueError, OverflowError):
            raise TemporalError("RECOVERY_PENDING") from None
        return state

    @staticmethod
    def validate_state(state: State) -> None:
        require(state.domain == "time_schedule_calendar", "RECOVERY_PENDING")
        for name in SCHEMA:
            collection = getattr(state, name)
            require(type(collection) is dict, "RECOVERY_PENDING")
            for value in ([collection] if name in {"world_clock", "versioned_defaults"} else collection.values()):
                record(name, value)
        clock = state.world_clock
        integer(clock["instant_ms"])
        integer(clock["revision"], 0)
        integer(clock["last_event_sequence"], 0)
        pinned_zone(clock["timezone_id"], clock["tzdata_version"])
        require(state.versioned_defaults == DEFAULTS, "RECOVERY_PENDING")
        keys: set[tuple] = set()
        for event in state.scheduled_event.values():
            key = (event["branch_id"], event["owner_domain"], event["occurrence_key"])
            require(key not in keys and event["branch_id"] == clock["branch_id"], "RECOVERY_PENDING")
            keys.add(key)
            require(event["phase"] == PHASES[event["payload_json"]["kind"]], "RECOVERY_PENDING")
        ends: dict[str, int] = {}
        segment_keys: set[tuple] = set()
        for segment in sorted(state.temporal_segment.values(), key=lambda x: (x["advance_id"], x["start_ms"])):
            key = (segment["advance_id"], segment["start_ms"])
            require(key not in segment_keys, "RECOVERY_PENDING")
            segment_keys.add(key)
            require(segment["end_ms"] >= segment["start_ms"], "RECOVERY_PENDING")
            if segment["state"] != "COMMITTED":
                continue
            aid = segment["advance_id"]
            expected = ends.get(aid, state.advance_intent[aid]["start_ms"])
            require(expected == segment["start_ms"], "RECOVERY_PENDING")
            require(segment["end_ms"] <= clock["instant_ms"], "RECOVERY_PENDING")
            receipts = [state.owner_interval_receipt[r] for r in segment["integration_receipt_refs"]]
            require(len(receipts) == len(INTEGRATORS) and {r["owner_domain"] for r in receipts} == set(INTEGRATORS), "RECOVERY_PENDING")
            for receipt in receipts:
                require(receipt["start_ms"] == segment["start_ms"] and receipt["end_ms"] == segment["end_ms"]
                        and receipt["status"] == "COMMITTED" and receipt["segment_id"] == segment["segment_id"], "RECOVERY_PENDING")
            ends[aid] = segment["end_ms"]
        committed = sorted((s["start_ms"], s["end_ms"]) for s in state.temporal_segment.values()
                           if s["state"] == "COMMITTED")
        for first, second in zip(committed, committed[1:]):
            require(first[1] == second[0], "RECOVERY_PENDING")
        if committed:
            require(committed[-1][1] == clock["instant_ms"], "RECOVERY_PENDING")
        for reservation in state.activity_reservation.values():
            TimeScheduleCalendar._check_reservation(state, reservation)
        for rule in state.schedule_rule.values():
            pinned_zone(rule["timezone_id"], rule["tzdata_version"])
        for occurrence in state.schedule_occurrence.values():
            require(stable(occurrence["schedule_id"], occurrence["schedule_version"]) in state.schedule_rule,
                    "RECOVERY_PENDING")
            pinned_zone(occurrence["timezone_id"], occurrence["tzdata_version"])

    @staticmethod
    def project_clock(state: State) -> JSON:
        clock = state.world_clock
        local = utc(clock["instant_ms"]).astimezone(pinned_zone(clock["timezone_id"], clock["tzdata_version"]))
        return {"instant_ms": clock["instant_ms"], "revision": clock["revision"],
                "local_datetime": local.isoformat(), "date": local.date().isoformat(),
                "weekday": local.weekday(), "month": local.month, "year": local.year,
                "day_of_year": local.timetuple().tm_yday,
                "utc_offset_seconds": int(local.utcoffset().total_seconds()), "fold": local.fold}

    @staticmethod
    def _owner(domain: str, credential: str) -> None:
        require(call(domain, "authenticate_owner", {"credential": credential}).get("authorized") is True,
                "AUTHORIZATION_EXCEEDED")

    @staticmethod
    def _stamp(state: State, key: str, kind: str, effective_ms: int, cause: str,
               visibility: str = "private", command: str = "") -> None:
        if key in state.temporal_event_metadata:
            return
        state.world_clock["last_event_sequence"] += 1
        state.temporal_event_metadata[key] = {
            "branch_id": state.world_clock["branch_id"],
            "sequence": state.world_clock["last_event_sequence"], "effective_instant_ms": effective_ms,
            "command_id": command or key, "correlation_id": cause, "causation_id": cause,
            "schema_version": VERSION, "ruleset_version": VERSION, "visibility_ref": visibility}
        state.event_delivery[key] = {"event_ref": key, "owner_domain": "system1", "command_id": kind + ":" + key,
            "idempotency_key": stable(state.world_clock["branch_id"], key), "delivery_state": "OUTBOX",
            "outbox_cursor": state.world_clock["last_event_sequence"]}

    @staticmethod
    def _persist(state: State) -> None:
        response = call("persistence", "persist", TimeScheduleCalendar.export_state(state))
        require(response.get("accepted") is True, "RECOVERY_PENDING")

    @staticmethod
    def _event(state: State, value: JSON) -> JSON:
        event = record("scheduled_event", value)
        require(event["branch_id"] == state.world_clock["branch_id"], "AUTHORIZATION_EXCEEDED")
        require(event["owner_domain"] in DOMAINS and event["source_event_id"] and event["occurrence_key"])
        integer(event["due_ms"])
        require(event["payload_json"].get("kind") in PHASES)
        require(type(event["phase"]) is int and event["phase"] == PHASES[event["payload_json"]["kind"]])
        require(event["state"] == "PENDING")
        if event["due_ms"] % state.versioned_defaults["scheduled_quantum_ms"]:
            require(call(event["owner_domain"], "contract", {}).get("subsecond_allowed") is True)
        previous = state.scheduled_event.get(event["event_id"])
        if previous:
            comparable = dict(previous, state="PENDING")
            comparable.pop("cancellation_tombstone", None)
            require(comparable == event, "IDEMPOTENCY_CONFLICT")
            return previous
        require(event["due_ms"] >= state.world_clock["instant_ms"], "PAST_EVENT_REGISTRATION")
        if event["due_ms"] == state.world_clock["instant_ms"]:
            require(not any(e["state"] == "SETTLED" and e["due_ms"] == event["due_ms"]
                            and e["phase"] > event["phase"] for e in state.scheduled_event.values()),
                    "PAST_EVENT_REGISTRATION")
        if event["payload_json"]["kind"] == "NPCReplan":
            require(event["owner_domain"] == "system6" and event["payload_json"].get("actor_ref"),
                    "AUTHORIZATION_EXCEEDED")
            for other in state.scheduled_event.values():
                if other["state"] == "CANCELLED" or other["payload_json"].get("kind") != "NPCReplan":
                    continue
                if other["payload_json"].get("actor_ref") != event["payload_json"]["actor_ref"]:
                    continue
                require(other["source_event_id"] != event["source_event_id"], "IDEMPOTENCY_CONFLICT")
                if not event["payload_json"].get("urgent") and not other["payload_json"].get("urgent"):
                    require(abs(event["due_ms"] - other["due_ms"]) >= state.versioned_defaults["ordinary_npc_replan_interval_ms"],
                            "RESERVATION_CONFLICT")
        require(not any((x["branch_id"], x["owner_domain"], x["occurrence_key"]) ==
                        (event["branch_id"], event["owner_domain"], event["occurrence_key"])
                        for x in state.scheduled_event.values()), "IDEMPOTENCY_CONFLICT")
        state.scheduled_event[event["event_id"]] = event
        return event

    @staticmethod
    def register_event(state: State, request: JSON) -> JSON:
        with LOCK:
            value = request["event"]
            TimeScheduleCalendar._owner(value["owner_domain"], request["credential"])
            result = TimeScheduleCalendar._event(state, value)
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(result)

    @staticmethod
    def cancel_event(state: State, request: JSON) -> JSON:
        with LOCK:
            event = state.scheduled_event[request["event_id"]]
            TimeScheduleCalendar._owner(event["owner_domain"], request["credential"])
            require(event["state"] != "SETTLED", "RECOVERY_PENDING")
            require(not any(d["event_ref"] == event["event_id"] and d["delivery_state"] == "PENDING"
                            for d in state.event_delivery.values()), "RECOVERY_PENDING")
            require(request.get("reason") and request.get("source_ref"))
            event["state"] = "CANCELLED"
            event["cancellation_tombstone"] = {"reason": request["reason"], "source_ref": request["source_ref"]}
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(event)

    @staticmethod
    def _check_reservation(state: State, value: JSON) -> None:
        integer(value["start_ms"])
        integer(value["end_ms"], value["start_ms"])
        require(set(value["actor_slots"]) <= SLOTS, "RESERVATION_CONFLICT")
        require(value["branch_id"] == state.world_clock["branch_id"], "RESERVATION_CONFLICT")
        if value["status"] != "ACTIVE" or value["start_ms"] == value["end_ms"]:
            return
        overlaps = [x for x in state.activity_reservation.values()
                    if x["reservation_id"] != value["reservation_id"]
                    and x["resource_id"] == value["resource_id"] and x["status"] == "ACTIVE"
                    and x["start_ms"] < value["end_ms"] and value["start_ms"] < x["end_ms"]]
        for other in overlaps:
            sleep_conflict = "sleep_rest" in set(value["actor_slots"] + other["actor_slots"])
            require(not sleep_conflict and value["exclusivity_class"] == other["exclusivity_class"] == "compatible",
                    "RESERVATION_CONFLICT")
            require(value["attention_requirements"].get("compatibility_ref") and
                    value["attention_requirements"].get("compatibility_ref") ==
                    other["attention_requirements"].get("compatibility_ref"), "RESERVATION_CONFLICT")
        capacity = value["capacity_requirements"].get("capacity", 1)
        integer(capacity, 1)
        relevant = [value] + [x for x in overlaps if not value["actor_slots"] or
                               set(x["actor_slots"]) & set(value["actor_slots"])]
        points = sorted({x["start_ms"] for x in relevant} | {x["end_ms"] for x in relevant})
        for point in points:
            active = [x for x in relevant if x["start_ms"] <= point < x["end_ms"]]
            if not active:
                continue
            limit = min(x["capacity_requirements"].get("capacity", 1) for x in active)
            load = sum(integer(x["capacity_requirements"].get("units", 1), 0) for x in active)
            require(load <= limit, "RESERVATION_CONFLICT")

    @staticmethod
    def reserve(state: State, request: JSON) -> JSON:
        with LOCK:
            value = record("activity_reservation", request["reservation"])
            TimeScheduleCalendar._owner(value["owner_domain"], request["credential"])
            previous = state.activity_reservation.get(value["reservation_id"])
            require(request.get("expected_revision", 0) == (previous["revision"] if previous else 0),
                    "STALE_CLOCK")
            TimeScheduleCalendar._check_reservation(state, value)
            value["revision"] = (previous["revision"] if previous else 0) + 1
            state.activity_reservation[value["reservation_id"]] = value
            TimeScheduleCalendar._stamp(state, stable("reservation", value), "TemporalReservationChanged",
                                       state.world_clock["instant_ms"], value["source_intent_ref"])
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(value)

    @staticmethod
    def register_calendar(state: State, request: JSON) -> JSON:
        with LOCK:
            TimeScheduleCalendar._owner("configuration", request["credential"])
            definition = record("calendar_definition", request["calendar"])
            require(definition["leap_day_reminder_policy"] in {"February 28", "March 1"})
            require(set(definition["weekend_pattern"]) <= set(range(7)))
            pinned_zone(definition["timezone_id"], state.world_clock["tzdata_version"])
            key = stable(definition["calendar_id"], definition["version"])
            require(key not in state.calendar_definition or state.calendar_definition[key] == definition,
                    "IDEMPOTENCY_CONFLICT")
            state.calendar_definition[key] = definition
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(definition)

    @staticmethod
    def calendar_labels(definition: JSON, day: date) -> list[JSON]:
        """Return labels, never closures, rewards, observance, or legal eligibility."""
        labels = []
        for rule in definition["date_rules"]:
            for year in (day.year - 1, day.year, day.year + 1):
                if not 1 <= year <= 9999:
                    continue
                kind = rule["kind"]
                if kind == "fixed_date":
                    month, number = rule["month"], rule["day"]
                    if (month, number) == (2, 29) and not calendar.isleap(year):
                        month, number = (2, 28) if definition["leap_day_reminder_policy"] == "February 28" else (3, 1)
                    actual = date(year, month, number)
                elif kind == "nth_weekday":
                    days = [date(year, rule["month"], n) for n in range(1, calendar.monthrange(year, rule["month"])[1] + 1)
                            if date(year, rule["month"], n).weekday() == rule["weekday"]]
                    nth = rule["nth"]
                    require(nth in {-1, 1, 2, 3, 4, 5})
                    if nth > len(days):
                        continue
                    actual = days[nth - 1] if nth > 0 else days[-1]
                elif kind == "explicit_date":
                    actual = date.fromisoformat(rule["date"])
                    if actual.year != year:
                        continue
                else:
                    raise TemporalError("RECOVERY_PENDING")
                observed = actual
                policy = rule.get("observed_policy", "none")
                require(policy in {"none", "sunday_to_monday", "nearest_weekday"})
                if actual.weekday() == 6 and policy in {"sunday_to_monday", "nearest_weekday"}:
                    observed += timedelta(days=1)
                elif actual.weekday() == 5 and policy == "nearest_weekday":
                    observed -= timedelta(days=1)
                if day in {actual, observed}:
                    labels.append({"rule_ref": rule["id"], "actual_date": actual.isoformat(),
                                   "observed_date": observed.isoformat()})
        return labels

    @staticmethod
    def register_schedule(state: State, request: JSON) -> JSON:
        with LOCK:
            rule = record("schedule_rule", request["rule"])
            TimeScheduleCalendar._owner(rule["owner_domain"], request["credential"])
            pinned_zone(rule["timezone_id"], rule["tzdata_version"])
            integer(rule["validity_start"])
            integer(rule["validity_end_or_expiry_policy"], rule["validity_start"] + 1)
            integer(rule["revision"], 0)
            require(rule["gap_policy"] in {"shift_forward_by_gap", "reject"})
            require(rule["fold_policy"] in {"first_occurrence", "second_occurrence"})
            require(rule["exception_hierarchy"] == ["one_off_closure", "cancellation",
                                                    "date_specific_override", "holiday_policy", "normal_recurrence"])
            kind, payload = rule["recurrence_kind"], rule["recurrence_payload"]
            kinds = {"one_time", "daily", "specified_weekdays", "weekly", "monthly_date",
                     "monthly_nth_weekday", "annual", "explicit_dates", "elapsed_interval"}
            require(kind in kinds)
            require(rule["recurrence_basis"] == ("elapsed_duration" if kind == "elapsed_interval" else "local_calendar"))
            if kind == "elapsed_interval":
                integer(payload["interval_ms"], state.versioned_defaults["scheduled_quantum_ms"])
                integer(payload["anchor_ms"])
            else:
                datetime.strptime(payload["time"], "%H:%M:%S")
                if kind == "one_time":
                    date.fromisoformat(payload["date"])
                elif kind == "explicit_dates":
                    require(type(payload["dates"]) is list and len(payload["dates"]) <= 100_000)
                    for local_date in payload["dates"]:
                        date.fromisoformat(local_date)
                elif kind in {"weekly", "specified_weekdays"}:
                    require(type(payload["weekdays"]) is list and payload["weekdays"]
                            and all(type(d) is int and 0 <= d <= 6 for d in payload["weekdays"]))
                    integer(payload.get("interval_weeks", 1), 1)
                    date.fromisoformat(payload.get("anchor_date", "1970-01-05"))
                elif kind == "monthly_date":
                    integer(payload["day"], 1, 31)
                elif kind == "monthly_nth_weekday":
                    integer(payload["weekday"], 0, 6)
                    require(type(payload["nth"]) is int and payload["nth"] in {-1, 1, 2, 3, 4, 5})
                elif kind == "annual":
                    date(2012, integer(payload["month"], 1, 12), integer(payload["day"], 1, 31))
            policy = rule["interval_policy"]
            require(set(policy) in ({"duration_ms"}, {"end_time", "end_day_offset"}))
            if "duration_ms" in policy:
                integer(policy["duration_ms"], state.versioned_defaults["scheduled_quantum_ms"])
            else:
                datetime.strptime(policy["end_time"], "%H:%M:%S")
                integer(policy["end_day_offset"], 0, 90)
            key = stable(rule["schedule_id"], rule["schedule_version"])
            if key in state.schedule_rule:
                require(state.schedule_rule[key] == rule, "IDEMPOTENCY_CONFLICT")
                return copy.deepcopy(rule)
            previous = [r for r in state.schedule_rule.values() if r["schedule_id"] == rule["schedule_id"]]
            if previous:
                require(rule["revision"] > max(r["revision"] for r in previous), "STALE_CLOCK")
                require(rule["validity_start"] >= state.world_clock["instant_ms"], "PAST_EVENT_REGISTRATION")
            state.schedule_rule[key] = rule
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(rule)

    @staticmethod
    def register_exception(state: State, request: JSON) -> JSON:
        with LOCK:
            exception = record("schedule_exception", request["exception"])
            rules = [r for r in state.schedule_rule.values() if r["schedule_id"] == exception["schedule_ref"]]
            require(bool(rules))
            TimeScheduleCalendar._owner(rules[0]["owner_domain"], request["credential"])
            require(exception["kind"] in EXCEPTION_RANK and exception["reason"] and exception["source_ref"])
            previous = state.schedule_exception.get(exception["exception_id"])
            require(previous is None or previous == exception, "IDEMPOTENCY_CONFLICT")
            # Equal-precedence contradictions must be authored explicitly, not insertion-ordered.
            require(not any(x["exception_id"] != exception["exception_id"] and
                x["schedule_ref"] == exception["schedule_ref"] and
                x["affected_date_or_occurrence"] == exception["affected_date_or_occurrence"] and
                EXCEPTION_RANK[x["kind"]] == EXCEPTION_RANK[exception["kind"]]
                for x in state.schedule_exception.values()), "RESERVATION_CONFLICT")
            state.schedule_exception[exception["exception_id"]] = exception
            # Already exposed/reserved occurrences remain pinned; explicit owner cancellation is separate.
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(exception)

    @staticmethod
    def cancel_occurrence(state: State, request: JSON) -> JSON:
        """Explicit live owner cancellation; past timing and attendance remain intact."""
        with LOCK:
            occurrence = state.schedule_occurrence[request["occurrence_id"]]
            rule = state.schedule_rule[stable(occurrence["schedule_id"], occurrence["schedule_version"])]
            TimeScheduleCalendar._owner(rule["owner_domain"], request["credential"])
            require(occurrence["resolved_start_ms"] > state.world_clock["instant_ms"], "PAST_EVENT_REGISTRATION")
            require(request.get("reason") and request.get("source_ref"))
            for event in state.scheduled_event.values():
                if event["payload_json"].get("occurrence_ref") == occurrence["occurrence_id"]:
                    require(event["state"] in {"PENDING", "CANCELLED"}, "RECOVERY_PENDING")
                    event["state"] = "CANCELLED"
                    event["cancellation_tombstone"] = {"reason": request["reason"], "source_ref": request["source_ref"]}
            occurrence.update(status="CANCELLED", cancellation_reason=request["reason"])
            TimeScheduleCalendar._stamp(state, stable(occurrence["occurrence_id"], "cancelled"), "ScheduleOccurrenceChanged",
                                       state.world_clock["instant_ms"], request["source_ref"])
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(occurrence)

    @staticmethod
    def _matches(rule: JSON, day: date) -> bool:
        kind, p = rule["recurrence_kind"], rule["recurrence_payload"]
        if kind == "one_time":
            return day.isoformat() == p["date"]
        if kind == "explicit_dates":
            return day.isoformat() in p["dates"]
        if kind == "daily":
            return True
        if kind in {"specified_weekdays", "weekly"}:
            require(set(p["weekdays"]) <= set(range(7)))
            anchor = date.fromisoformat(p.get("anchor_date", "1970-01-05"))
            interval = integer(p.get("interval_weeks", 1), 1)
            week = (day - (anchor - timedelta(days=anchor.weekday()))).days // 7
            return day.weekday() in p["weekdays"] and (kind != "weekly" or week % interval == 0)
        if kind == "monthly_date":
            return day.day == integer(p["day"], 1, 31)
        if kind == "monthly_nth_weekday":
            nth = p["nth"]
            require(nth in {-1, 1, 2, 3, 4, 5})
            return day.weekday() == p["weekday"] and ((day.day - 1) // 7 + 1 == nth or
                (nth == -1 and day.day + 7 > calendar.monthrange(day.year, day.month)[1]))
        if kind == "annual":
            month, number = p["month"], p["day"]
            if (month, number) == (2, 29) and not calendar.isleap(day.year):
                policy = p.get("leap_day_reminder_policy", "February 28")
                require(policy in {"February 28", "March 1"})
                month, number = (2, 28) if policy == "February 28" else (3, 1)
            return (day.month, day.day) == (month, number)
        return False

    @staticmethod
    def expand(state: State, request: JSON) -> JSON:
        """Trusted bounded expansion; private occurrences must not be exposed to players."""
        with LOCK:
            TimeScheduleCalendar._owner("configuration", request["credential"])
            start, stop = integer(request["start_ms"]), integer(request["end_ms"])
            require(start >= state.world_clock["instant_ms"] and stop >= start)
            require(stop - start <= (state.versioned_defaults["maximum_expansion_chunk_days"] + 1) * DAY)
            before = set(state.schedule_occurrence)
            TimeScheduleCalendar._expand(state, start, stop)
            TimeScheduleCalendar._persist(state)
            return {"occurrence_refs": sorted(set(state.schedule_occurrence) - before)}

    @staticmethod
    def _expand(state: State, start: int, stop: int) -> None:
        for rule in sorted(state.schedule_rule.values(), key=lambda r: (r["schedule_id"], -r["revision"])):
            zone = pinned_zone(rule["timezone_id"], rule["tzdata_version"])
            lo, hi = max(start, rule["validity_start"]), min(stop, rule["validity_end_or_expiry_policy"])
            if hi <= lo:
                continue
            candidates = []
            if rule["recurrence_kind"] == "elapsed_interval":
                p = rule["recurrence_payload"]
                step, anchor = p["interval_ms"], p["anchor_ms"]
                first = anchor + max(0, (lo - anchor + step - 1) // step) * step
                require((hi - first + step - 1) // step <= 100_000, "RECOVERY_PENDING")
                candidates = [(utc(t).astimezone(zone).date(), str(t), t) for t in range(first, hi, step)]
            else:
                day, last = utc(lo).astimezone(zone).date(), utc(hi).astimezone(zone).date()
                require((last - day).days <= 91)
                while day <= last:
                    if TimeScheduleCalendar._matches(rule, day):
                        candidates.append((day, day.isoformat(), None))
                    day += timedelta(days=1)
            for day, local_key, elapsed_start in candidates:
                # Exposed/reserved versions win over newer unexpanded rules.
                if any(o["schedule_id"] == rule["schedule_id"] and o["local_occurrence_key"] == local_key
                       for o in state.schedule_occurrence.values()):
                    continue
                exceptions = sorted([x for x in state.schedule_exception.values()
                    if x["schedule_ref"] == rule["schedule_id"] and
                    (x["affected_date_or_occurrence"] in (day.isoformat(), local_key) or
                     isinstance(x["affected_date_or_occurrence"], dict) and
                     (x["affected_date_or_occurrence"].get("date") == day.isoformat() or
                      x["affected_date_or_occurrence"].get("local_occurrence_key") == local_key))],
                    key=lambda x: EXCEPTION_RANK[x["kind"]])
                exception = exceptions[0] if exceptions else None
                override = exception["override_payload"] if exception else {}
                local_time = override.get("time", rule["recurrence_payload"].get("time"))
                beginning = elapsed_start if elapsed_start is not None else resolve_local(
                    day.isoformat() + "T" + local_time, zone, rule["gap_policy"], rule["fold_policy"])
                if not lo <= beginning < hi:
                    continue
                newer = [r for r in state.schedule_rule.values() if r["schedule_id"] == rule["schedule_id"]
                         and r["revision"] > rule["revision"]
                         and r["validity_start"] <= beginning < r["validity_end_or_expiry_policy"]]
                if newer:
                    continue
                interval = override.get("interval_policy", rule["interval_policy"])
                if "duration_ms" in interval:
                    ending = integer(beginning + integer(interval["duration_ms"], 0))
                else:
                    end_date = day + timedelta(days=integer(interval["end_day_offset"], 0, 90))
                    ending = resolve_local(end_date.isoformat() + "T" + interval["end_time"], zone,
                                           rule["gap_policy"], rule["fold_policy"])
                require(ending > beginning, "INVALID_DURATION")
                cancelled = bool(exception and (exception["kind"] in {"cancellation", "one_off_closure"}
                                                or override.get("closed") is True))
                oid = stable(rule["schedule_id"], rule["schedule_version"], local_key, rule["fold_policy"])
                occurrence = {"occurrence_id": oid, "schedule_id": rule["schedule_id"],
                    "schedule_version": rule["schedule_version"], "local_occurrence_key": local_key,
                    "fold_policy": rule["fold_policy"], "timezone_id": rule["timezone_id"],
                    "tzdata_version": rule["tzdata_version"], "resolved_start_ms": beginning,
                    "resolved_end_ms": ending, "status": "CANCELLED" if cancelled else "SCHEDULED"}
                if cancelled:
                    occurrence["cancellation_reason"] = exception["reason"]
                else:
                    for suffix, due, kind in (("start", beginning, "OccurrenceDue"), ("end", ending, "OccurrenceEnded")):
                        TimeScheduleCalendar._event(state, {"event_id": stable(oid, suffix),
                            "branch_id": state.world_clock["branch_id"], "due_ms": due, "phase": PHASES[kind],
                            "owner_domain": rule["owner_domain"], "occurrence_key": oid + ":" + suffix,
                            "payload_json": {"kind": kind, "occurrence_ref": oid}, "state": "PENDING",
                            "source_event_id": stable(rule["schedule_id"], rule["schedule_version"])})
                state.schedule_occurrence[oid] = occurrence

    @staticmethod
    def register_deadline(state: State, request: JSON) -> JSON:
        with LOCK:
            value = record("deadline", request["deadline"])
            TimeScheduleCalendar._owner(value["owner_domain"], request["credential"])
            require(value["cutoff_policy"] and value["owner_predicate_ref"] and value["source_ref"])
            require(value["trigger_state"] == "PENDING")
            previous = state.deadline.get(value["deadline_id"])
            require(previous is None or previous == value, "IDEMPOTENCY_CONFLICT")
            TimeScheduleCalendar._event(state, {"event_id": value["trigger_identity"],
                "branch_id": state.world_clock["branch_id"], "due_ms": value["resolved_instant_ms"],
                "phase": 2, "owner_domain": value["owner_domain"], "occurrence_key": value["trigger_identity"],
                "payload_json": {"kind": "DeadlineTriggered", "deadline_ref": value["deadline_id"],
                                 "cutoff_policy": value["cutoff_policy"], "owner_predicate_ref": value["owner_predicate_ref"]},
                "state": "PENDING", "source_event_id": value["source_ref"]})
            state.deadline[value["deadline_id"]] = value
            TimeScheduleCalendar._persist(state)
            return copy.deepcopy(value)

    @staticmethod
    def cutoff_matches(completed_at: int, cutoff: int, policy: str) -> bool:
        integer(completed_at)
        integer(cutoff)
        require(policy in {"inclusive", "exclusive"})
        return completed_at <= cutoff if policy == "inclusive" else completed_at < cutoff

    @staticmethod
    def _authorize(state: State, request: JSON) -> JSON:
        require(request["branch_id"] == state.world_clock["branch_id"], "AUTHORIZATION_EXCEEDED")
        auth = call("system1", "authorize", request)
        require(auth.get("authorized") is True, "AUTHORIZATION_EXCEEDED")
        return auth

    @staticmethod
    def _admit(state: State, raw: JSON) -> JSON:
        intent = record("advance_intent", raw)
        require(not {"advance_id", "start_ms", "requested_target_ms", "cancellation_requested"} & raw.keys())
        auth = TimeScheduleCalendar._authorize(state, raw)
        now = state.world_clock["instant_ms"]
        require(type(raw["expected_clock_revision"]) is int and
                raw["expected_clock_revision"] == state.world_clock["revision"], "STALE_CLOCK")
        require(raw["kind"] in KINDS and raw["kind"] in auth["allowed_kinds"], "AUTHORIZATION_EXCEEDED")
        require(raw["location_ref"] in auth["allowed_location_refs"], "AUTHORIZATION_EXCEEDED")
        horizon = integer(raw["maximum_horizon_ms"], now)
        require(horizon - now <= auth["maximum_duration_ms"], "AUTHORIZATION_EXCEEDED")
        require(not raw.get("allowed_automatic_continuations") or
                raw["allowed_automatic_continuations"] == auth["allowed_continuations"], "AUTHORIZATION_EXCEEDED")
        require(raw.get("delegation_ref") is None or raw["delegation_ref"] in auth["delegation_refs"],
                "AUTHORIZATION_EXCEEDED")
        require(raw["kind"] != "fast_forward_routine" or raw.get("delegation_ref"), "AUTHORIZATION_EXCEEDED")
        predicates = raw.get("stop_predicate_refs", []) + ([raw["known_target_ref"]] if raw.get("known_target_ref") else [])
        require(call("system3", "validate_predicates", {"refs": predicates}).get("accepted") is True,
                "INVALID_STOP_PREDICATE")
        require(raw["kind"] != "wait_for_known_event" or predicates, "INVALID_STOP_PREDICATE")
        for domain in ("system1", "health", "travel", "institutions"):
            valid = call(domain, "validate_intent", raw)
            require(valid.get("accepted") is True and valid.get("prerequisites_met") is True
                    and valid.get("access_confirmed") is True, "AUTHORIZATION_EXCEEDED")
        for owner in INTEGRATORS:
            require(call(owner, "contract", {}).get("required") is True, "OWNER_UNAVAILABLE")
        aid = stable(state.world_clock["branch_id"], raw["command_id"])
        intent.update(advance_id=aid, start_ms=now, cancellation_requested=False)
        intent.setdefault("stop_predicate_refs", [])
        intent.setdefault("allowed_automatic_continuations", [])
        intent.setdefault("interrupt_policy", "material_observable_change")
        require(intent["interrupt_policy"] == "material_observable_change", "AUTHORIZATION_EXCEEDED")
        intent.setdefault("location_constraints", {})
        intent.setdefault("delegation_ref", None)
        if "duration_ms" in raw:
            integer(raw["duration_ms"], 0)
        if raw["kind"] == "wait_duration":
            target = integer(now + integer(raw["duration_ms"], 0))
            require(target <= horizon, "AUTHORIZATION_EXCEEDED")
        elif raw["kind"] == "wait_for_known_event":
            target = min(horizon, integer(now + raw.get("duration_ms", state.versioned_defaults["known_event_wait_maximum_ms"])))
        elif raw.get("local_target") is not None:
            local = raw["local_target"]
            zone = pinned_zone(state.world_clock["timezone_id"], state.world_clock["tzdata_version"])
            value = local.get("datetime")
            if value is None:
                day = utc(now).astimezone(zone).date() + timedelta(days=integer(local["relative_days"], 0, 366))
                value = day.isoformat() + "T" + local["time"]
            target = resolve_local(value, zone, local.get("gap_policy", "shift_forward_by_gap"),
                                   local.get("fold_policy", "first_occurrence"))
            if target <= now:
                require(local.get("past_policy") == "complete_without_time", "CHOICE_REQUIRED")
                target = now
            require(target <= horizon, "AUTHORIZATION_EXCEEDED")
        elif raw["kind"] in {"sleep", "fast_forward_routine"}:
            target = integer(now + integer(raw.get("duration_ms", horizon - now), 0))
            require(target <= horizon, "AUTHORIZATION_EXCEEDED")
        elif raw["kind"] == "execute_action":
            target = horizon  # Replaced below with the frozen owner duration.
        else:
            raise TemporalError("UNKNOWN_LOCAL_TIME")
        if raw["kind"] in {"execute_action", "sleep", "fast_forward_routine"}:
            require(bool(raw.get("activity_ref")), "AUTHORIZATION_EXCEEDED")
            activity = raw["activity_ref"]
            if activity in state.duration_contract:
                contract = state.duration_contract[activity]
                require(raw.get("continuation_of") == contract["progress_ref"], "AUTHORIZATION_EXCEEDED")
                require(contract["activity_state"] != "COMPLETED", "AUTHORIZATION_EXCEEDED")
                original = state.advance_intent[contract["source_intent_ref"]]
                require(original["actor_id"] == raw["actor_id"] and original["kind"] == raw["kind"]
                        and original.get("method_ref") == raw.get("method_ref"), "AUTHORIZATION_EXCEEDED")
            else:
                owner = "health" if raw["kind"] == "sleep" else "system1"
                response = call(owner, "duration", raw | {"accepted_duration_ms": target - now})
                contract = record("duration_contract", {k: v for k, v in response.items()
                    if k in SCHEMA["duration_contract"].split()} | {"activity_id": activity,
                    "owner_domain": owner, "source_intent_ref": aid})
                integer(contract["resolved_duration_ms"], 0)
                require(contract["policy_kind"] in {"fixed", "derived", "checkpointed", "sampled"})
                if contract["resolved_duration_ms"] == 0:
                    require(contract["profile_ref"] in {"known_ui", "obvious_glance"}, "INVALID_DURATION")
                state.duration_contract[activity] = contract
            if raw["kind"] == "execute_action":
                intervals = [[s["start_ms"], s["end_ms"]] for s in state.temporal_segment.values()
                    if s["state"] == "COMMITTED" and
                    state.advance_intent[s["advance_id"]].get("activity_ref") == activity]
                remaining = max(0, contract["resolved_duration_ms"] - interval_union(intervals))
                require(not raw.get("continuation_of") or remaining > 0, "AUTHORIZATION_EXCEEDED")
                target = integer(now + remaining)
        intent["requested_target_ms"] = target
        if raw.get("activity_ref") in state.duration_contract and now < target <= horizon:
            contract = state.duration_contract[raw["activity_ref"]]
            TimeScheduleCalendar._event(state, {"event_id": stable(aid, "activity-completion"),
                "branch_id": raw["branch_id"], "due_ms": target, "phase": 0,
                "owner_domain": contract["owner_domain"], "occurrence_key": aid + ":activity-completion",
                "payload_json": {"kind": "ActionCompleted", "activity_ref": raw["activity_ref"], "advance_ref": aid},
                "state": "PENDING", "source_event_id": aid})
        if min(target, horizon) > now:
            requirements = call("system1", "reservation_requirements", intent)
            rid = stable(aid, "actor-reservation")
            reservation = {"reservation_id": rid, "branch_id": raw["branch_id"],
                "resource_id": raw["actor_id"], "owner_activity_id": raw.get("activity_ref", aid),
                "source_intent_ref": aid, "owner_domain": "system1", "version": VERSION, "revision": 1,
                "start_ms": now, "end_ms": min(target, horizon), "status": "ACTIVE",
                "release_policy_ref": "mock:release"} | {k: requirements[k] for k in
                    ("actor_slots", "exclusivity_class", "attention_requirements", "load_requirements", "capacity_requirements")}
            TimeScheduleCalendar._check_reservation(state, reservation)
            state.activity_reservation[rid] = reservation
        state.advance_intent[aid] = intent
        state.time_trace[aid] = {"trace_id": aid, "candidate_boundaries": [], "selected_boundary_ms": now,
            "authorization_refs": [raw["authorization_ref"]], "owner_revision_refs": [],
            "duration_and_sample_refs": [raw["activity_ref"]] if raw.get("activity_ref") else [],
            "conflict_resolution_refs": [], "command_and_receipt_refs": [], "delivered_observation_refs": [],
            "continuation_decision": {}, "microstep_count": 0, "loop_causation_refs": [],
            "input_projection_hash": stable(raw)}
        TimeScheduleCalendar._stamp(state, stable(aid, "TimeAdvancePrepared"), "TimeAdvancePrepared", now,
                                   raw["causation_id"], command=raw["command_id"])
        return intent

    @staticmethod
    def _error(state: State, request: JSON, error: TemporalError) -> JSON:
        request = request if isinstance(request, dict) else {}
        aid = stable(state.world_clock["branch_id"], request.get("command_id", ""))
        intent = state.advance_intent.get(aid)
        start = intent["start_ms"] if intent else state.world_clock["instant_ms"]
        receipts = [r for r in state.owner_interval_receipt.values()
                    if r["segment_id"] in {s["segment_id"] for s in state.temporal_segment.values()
                                           if s["advance_id"] == aid}]
        return {"status": "ERROR", "error": {"code": error.code, "retryable": error.retryable or
            error.code in {"STALE_CLOCK", "OWNER_UNAVAILABLE", "RECOVERY_PENDING"},
            "committed_coverage": {"start_ms": start, "end_ms": state.world_clock["instant_ms"]},
            "owner_effects_exist": any(r["status"] == "COMMITTED" or r["accepted_effect_refs"] for r in receipts)
                or bool(state.time_trace.get(aid, {}).get("command_and_receipt_refs"))}}

    @staticmethod
    def advance(state: State, request: AdvanceRequest | JSON) -> JSON:
        """Player JSON entry point. Invalid admission never mutates state or elapsed time."""
        with LOCK:
            try:
                raw = json.loads(canonical(request))
                TimeScheduleCalendar._authorize(state, raw)
                aid = stable(state.world_clock["branch_id"], raw["command_id"])
                if aid in state.advance_intent:
                    require(state.time_trace[aid]["input_projection_hash"] == stable(raw), "IDEMPOTENCY_CONFLICT")
                    require(aid in state.advance_result, "RECOVERY_PENDING")
                    return copy.deepcopy(state.advance_result[aid])
                require(not any(s["state"] in {"PREPARED", "COMMITTING", "BLOCKED"}
                                for s in state.temporal_segment.values()), "RECOVERY_PENDING")
                require(not any(a not in state.advance_result or state.advance_result[a]["status"] == "RECOVERY_REQUIRED"
                                for a in state.advance_intent), "RECOVERY_PENDING")
                staged = State(**TimeScheduleCalendar.export_state(state))
                intent = TimeScheduleCalendar._admit(staged, raw)
                TimeScheduleCalendar._persist(staged)
                for f in fields(State):
                    setattr(state, f.name, getattr(staged, f.name))
            except TemporalError as error:
                return TimeScheduleCalendar._error(state, request, error)
            except (KeyError, TypeError, ValueError, OverflowError):
                return TimeScheduleCalendar._error(state, request, TemporalError("INVALID_REQUEST"))
        return TimeScheduleCalendar._run(state, intent)

    @staticmethod
    def cancel_advance(state: State, request: JSON) -> JSON:
        with LOCK:
            TimeScheduleCalendar._authorize(state, request)
            intent = state.advance_intent[request["advance_id"]]
            require(intent["actor_id"] == request["actor_id"], "AUTHORIZATION_EXCEEDED")
            intent["cancellation_requested"] = True
            TimeScheduleCalendar._persist(state)
            return {"accepted": True, "committed_end": state.world_clock["instant_ms"]}

    @staticmethod
    def recover(state: State, request: JSON) -> JSON:
        with LOCK:
            try:
                TimeScheduleCalendar._authorize(state, request)
                intent = state.advance_intent[request["advance_id"]]
                require(intent["actor_id"] == request["actor_id"], "AUTHORIZATION_EXCEEDED")
                require(intent["advance_id"] not in state.advance_result or
                        state.advance_result[intent["advance_id"]]["status"] == "RECOVERY_REQUIRED", "RECOVERY_PENDING")
            except TemporalError as error:
                return TimeScheduleCalendar._error(state, request, error)
        return TimeScheduleCalendar._run(state, intent)

    @staticmethod
    def _boundary(state: State, intent: JSON) -> int:
        now, defaults = state.world_clock["instant_ms"], state.versioned_defaults
        ceiling = defaults["routine_segment_ceiling_ms"]
        if intent["kind"] == "execute_action":
            contract = state.duration_contract[intent["activity_ref"]]
            ceiling = defaults["critical_speech_checkpoint_ceiling_ms"] if contract["profile_ref"] == "speech" else defaults["foreground_checkpoint_ceiling_ms"]
        if intent["kind"] == "sleep" and now == intent["start_ms"]:
            ceiling = min(ceiling, defaults["sleep_initiation_checkpoint_ms"])
        candidates = [{"instant_ms": min(intent["maximum_horizon_ms"], intent["requested_target_ms"]), "cause": "authorized_target"},
                      {"instant_ms": integer(now + ceiling), "cause": "checkpoint"}]
        candidates += [{"instant_ms": e["due_ms"], "cause": e["event_id"]}
                       for e in state.scheduled_event.values() if e["state"] == "PENDING" and e["due_ms"] > now]
        for domain in INTEGRATORS:
            response = call(domain, "contract", {"instant_ms": now, "intent": intent})
            require(response.get("required") is True, "OWNER_UNAVAILABLE")
            for boundary in response["boundaries"]:
                integer(boundary["instant_ms"], now + 1)
                candidates.append({"instant_ms": boundary["instant_ms"], "cause": boundary["ref"]})
        selected = min(x["instant_ms"] for x in candidates)
        require(selected > now, "CAUSAL_LOOP")
        trace = state.time_trace[intent["advance_id"]]
        trace["candidate_boundaries"] = sorted(candidates, key=lambda x: (x["instant_ms"], x["cause"]))
        trace["selected_boundary_ms"] = selected
        return selected

    @staticmethod
    def _validate_receipt(receipt: JSON, segment: JSON, owner: str, key: str) -> JSON:
        receipt = record("owner_interval_receipt", receipt)
        require(receipt["owner_domain"] == owner and receipt["segment_id"] == segment["segment_id"]
                and receipt["start_ms"] == segment["start_ms"] and receipt["end_ms"] == segment["end_ms"]
                and receipt["idempotency_key"] == key and receipt["status"] in {"PREPARED", "COMMITTED"}
                and bool(receipt["receipt_id"]), "RECOVERY_PENDING")
        return receipt

    @staticmethod
    def _segment(state: State, intent: JSON, boundary: int) -> None:
        aid, start = intent["advance_id"], state.world_clock["instant_ms"]
        sid = stable(aid, start)
        segment = state.temporal_segment.get(sid)
        if segment is None:
            segment = {"segment_id": sid, "advance_id": aid, "start_ms": start, "end_ms": boundary,
                "state": "PREPARED", "snapshot_hash": stable(TimeScheduleCalendar.export_state(state)),
                "causal_intent_ref": aid, "owner_input_revisions": {},
                "reservation_refs": [r["reservation_id"] for r in state.activity_reservation.values()
                                     if r["source_intent_ref"] == aid and r["status"] == "ACTIVE"],
                "event_batch_ids": [], "integration_receipt_refs": [], "unresolved_coverage_refs": list(INTEGRATORS),
                "continuation_authorization_ref": intent["authorization_ref"], "result_status": "PENDING"}
            state.temporal_segment[sid] = segment
            TimeScheduleCalendar._stamp(state, stable(sid, "prepared"), "TemporalSegmentPrepared", start,
                                       aid, command=intent["command_id"])
        require(segment["state"] != "COMMITTED" and segment["end_ms"] <= intent["maximum_horizon_ms"], "RECOVERY_PENDING")
        TimeScheduleCalendar._persist(state)
        try:
            for owner in INTEGRATORS:
                existing = [state.owner_interval_receipt[r] for r in segment["integration_receipt_refs"]
                            if state.owner_interval_receipt[r]["owner_domain"] == owner]
                if existing:
                    continue
                key = stable(state.world_clock["branch_id"], sid, owner, segment["start_ms"], segment["end_ms"])
                request = {"segment_id": sid, "start_ms": segment["start_ms"], "end_ms": segment["end_ms"],
                    "idempotency_key": key, "activity_context_refs": [intent.get("activity_ref", aid)]}
                lookup = call(owner, "receipt_lookup", request)
                if lookup.get("found"):
                    response = {"receipt": lookup["receipt"], "revision": "receipt:" + lookup["receipt"]["receipt_id"]}
                else:
                    response = call(owner, "prepare_interval", request)
                earlier = response.get("earlier_boundary_ms")
                if earlier is not None:
                    integer(earlier, start + 1, segment["end_ms"] - 1)
                    require(not any(state.owner_interval_receipt[r]["status"] == "COMMITTED"
                                    for r in segment["integration_receipt_refs"]), "RECOVERY_PENDING")
                    for prepared in segment["integration_receipt_refs"]:
                        old = state.owner_interval_receipt[prepared]
                        require(call(old["owner_domain"], "cancel_preparation", old).get("accepted") is True,
                                "RECOVERY_PENDING")
                        old["status"] = "ABORTED"
                    segment["integration_receipt_refs"] = []
                    segment["owner_input_revisions"] = {}
                    segment["end_ms"] = earlier
                    segment["state"] = "PREPARED"
                    TimeScheduleCalendar._persist(state)
                    return  # Next loop reuses the same segment identity and smaller boundary.
                receipt = TimeScheduleCalendar._validate_receipt(response["receipt"], segment, owner, key)
                previous = state.owner_interval_receipt.get(receipt["receipt_id"])
                require(previous is None or previous == receipt, "IDEMPOTENCY_CONFLICT")
                state.owner_interval_receipt[receipt["receipt_id"]] = receipt
                segment["integration_receipt_refs"].append(receipt["receipt_id"])
                segment["owner_input_revisions"][owner] = response["revision"]
                state.time_trace[aid]["owner_revision_refs"].append(response["revision"])
                segment["unresolved_coverage_refs"] = [x for x in INTEGRATORS if x not in segment["owner_input_revisions"]]
                TimeScheduleCalendar._persist(state)
            segment["state"] = "COMMITTING"
            TimeScheduleCalendar._persist(state)
            for rid in segment["integration_receipt_refs"]:
                receipt = state.owner_interval_receipt[rid]
                if receipt["status"] == "COMMITTED":
                    continue
                lookup = call(receipt["owner_domain"], "receipt_lookup", receipt)
                if lookup.get("found") and lookup["receipt"].get("status") == "COMMITTED":
                    TimeScheduleCalendar._validate_receipt(lookup["receipt"], segment, receipt["owner_domain"], receipt["idempotency_key"])
                else:
                    require(call(receipt["owner_domain"], "commit_interval", receipt).get("accepted") is True,
                            "OWNER_UNAVAILABLE")
                receipt["status"] = "COMMITTED"
                state.time_trace[aid]["command_and_receipt_refs"].append(rid)
                TimeScheduleCalendar._persist(state)
            require(len(segment["integration_receipt_refs"]) == len(INTEGRATORS), "RECOVERY_PENDING")
            state.world_clock["instant_ms"] = segment["end_ms"]
            state.world_clock["revision"] += 1
            segment.update(state="COMMITTED", result_status="COMMITTED", unresolved_coverage_refs=[])
            TimeScheduleCalendar._stamp(state, stable(sid, "commit"), "TemporalSegmentCommitted",
                                       segment["end_ms"], aid, command=intent["command_id"])
            TimeScheduleCalendar._persist(state)
        except TemporalError:
            if segment["state"] != "COMMITTED":
                segment["state"] = "BLOCKED"
                segment["unresolved_coverage_refs"] = [owner for owner in INTEGRATORS if not any(
                    state.owner_interval_receipt[r]["owner_domain"] == owner and
                    state.owner_interval_receipt[r]["status"] == "COMMITTED" for r in segment["integration_receipt_refs"])]
            raise

    @staticmethod
    def _abort_prepared(state: State, segment: JSON) -> bool:
        """Cancel only after all owners confirm no interval effects committed."""
        for ref in segment["integration_receipt_refs"]:
            if state.owner_interval_receipt[ref]["status"] == "COMMITTED":
                return False
        requests = {}
        for owner in INTEGRATORS:
            request = {"segment_id": segment["segment_id"], "start_ms": segment["start_ms"], "end_ms": segment["end_ms"],
                "idempotency_key": stable(state.world_clock["branch_id"], segment["segment_id"], owner,
                                          segment["start_ms"], segment["end_ms"])}
            found = call(owner, "receipt_lookup", request)
            if found.get("found") and found["receipt"]["status"] == "COMMITTED":
                return False
            requests[owner] = request
        for owner, request in requests.items():
            require(call(owner, "cancel_preparation", request).get("accepted") is True, "RECOVERY_PENDING")
        for ref in segment["integration_receipt_refs"]:
            state.owner_interval_receipt[ref]["status"] = "ABORTED"
        segment.update(state="ABORTED", unresolved_coverage_refs=[], result_status="CANCELLED")
        TimeScheduleCalendar._persist(state)
        return True

    @staticmethod
    def _complete_activity(state: State, intent: JSON, contract: JSON) -> None:
        if contract["activity_state"] == "COMPLETED":
            return
        key = stable(state.world_clock["branch_id"], "complete", contract["activity_id"], intent["advance_id"])
        delivery = state.event_delivery.setdefault(key, {"event_ref": contract["activity_id"],
            "owner_domain": contract["owner_domain"], "command_id": key, "idempotency_key": key,
            "delivery_state": "PENDING", "outbox_cursor": state.world_clock["last_event_sequence"]})
        TimeScheduleCalendar._persist(state)
        lookup = call(contract["owner_domain"], "receipt_lookup", {"idempotency_key": key})
        completed = lookup["result"] if lookup.get("found") else call(contract["owner_domain"], "complete_activity",
            {"intent": intent, "progress_ref": contract["progress_ref"], "instant_ms": state.world_clock["instant_ms"],
             "idempotency_key": key})
        require(completed.get("activity_state") and completed.get("progress_ref") and completed.get("receipt_ref"),
                "RECOVERY_PENDING")
        contract["activity_state"] = completed["activity_state"]
        contract["progress_ref"] = completed["progress_ref"]
        delivery.update(delivery_state="SETTLED", receipt_ref=completed["receipt_ref"])
        state.time_trace[intent["advance_id"]]["command_and_receipt_refs"].append(completed["receipt_ref"])
        TimeScheduleCalendar._persist(state)

    @staticmethod
    def _batch(state: State, intent: JSON) -> None:
        now, aid = state.world_clock["instant_ms"], intent["advance_id"]
        trace = state.time_trace[aid]
        decision = trace["continuation_decision"]
        if decision.get("batch_instant_ms") != now:
            decision.update(batch_instant_ms=now, snapshot_hash=stable(TimeScheduleCalendar.export_state(state)), barriers=[])
            decision.pop("inflight_batch", None)
            trace["microstep_count"] = 0
        while any(e["state"] == "PENDING" and e["due_ms"] == now for e in state.scheduled_event.values()):
            wave = decision.get("inflight_batch")
            if wave is None:
                due = [e for e in state.scheduled_event.values() if e["state"] == "PENDING" and e["due_ms"] == now]
                phase = min(e["phase"] for e in due)
                require(trace["microstep_count"] < state.versioned_defaults["maximum_microsteps_per_instant"], "CAUSAL_LOOP")
                trace["microstep_count"] += 1
                wave = {"phase": phase, "event_ids": sorted(e["event_id"] for e in due if e["phase"] == phase)}
                decision["inflight_batch"] = wave
                for segment in state.temporal_segment.values():
                    if segment["advance_id"] == aid and segment["state"] == "COMMITTED" and segment["end_ms"] == now:
                        segment["event_batch_ids"].append(stable(now, wave["event_ids"]))
                TimeScheduleCalendar._persist(state)
            phase = wave["phase"]
            if phase >= 1:
                for reservation in state.activity_reservation.values():
                    if reservation["end_ms"] <= now and reservation["status"] == "ACTIVE":
                        reservation["status"] = "RELEASED"
            all_events = [dict(state.scheduled_event[eid], state="PENDING") for eid in wave["event_ids"]]
            events = [state.scheduled_event[eid] for eid in wave["event_ids"] if state.scheduled_event[eid]["state"] == "PENDING"]
            shared = {"branch_id": state.world_clock["branch_id"], "effective_instant_ms": now,
                      "snapshot_hash": decision["snapshot_hash"], "phase": phase, "events": all_events}
            if "resolution_ref" not in wave:
                resolution = call("system1", "resolve_simultaneous", shared)
                require(resolution.get("accepted") is True, "RECOVERY_PENDING")
                trace["conflict_resolution_refs"].append(resolution["resolution_ref"])
                wave["resolution_ref"] = resolution["resolution_ref"]
                TimeScheduleCalendar._persist(state)
            for owner in sorted({e["owner_domain"] for e in events}):
                batch = [e for e in events if e["owner_domain"] == owner]
                resolutions = wave.setdefault("owner_resolution_refs", {})
                if owner not in resolutions:
                    resolved = call(owner, "resolve_simultaneous", shared | {"events": batch})
                    require(resolved.get("accepted") is True, "RECOVERY_PENDING")
                    resolutions[owner] = resolved["resolution_ref"]
                    trace["conflict_resolution_refs"].append(resolved["resolution_ref"])
                    TimeScheduleCalendar._persist(state)
                request = shared | {"events": batch, "resolution_ref": resolutions[owner],
                    "settled_receipt_refs": [d["receipt_ref"] for d in state.event_delivery.values()
                                             if d["delivery_state"] == "SETTLED" and "receipt_ref" in d]}
                keys, checks = {}, {}
                for event in batch:
                    eid = event["event_id"]
                    key = stable(state.world_clock["branch_id"], "event", eid)
                    keys[eid] = key
                    state.event_delivery.setdefault(key, {"event_ref": eid, "owner_domain": owner,
                        "command_id": key, "idempotency_key": key, "delivery_state": "PENDING",
                        "outbox_cursor": state.world_clock["last_event_sequence"]})
                    TimeScheduleCalendar._stamp(state, stable(eid, "due"), "ScheduledEventDue", now, event["source_event_id"])
                    deadline_ref = event["payload_json"].get("deadline_ref")
                    if deadline_ref:
                        deadline = state.deadline[deadline_ref]
                        frozen = wave.setdefault("deadline_checks", {})
                        if eid not in frozen:
                            evidence = call(owner, "deadline_evidence", request | {"deadline": deadline})
                            satisfied = evidence.get("eligible") is True
                            if deadline["cutoff_policy"] in {"inclusive", "exclusive"}:
                                satisfied = satisfied and evidence.get("completed_at") is not None and TimeScheduleCalendar.cutoff_matches(
                                    evidence["completed_at"], deadline["resolved_instant_ms"], deadline["cutoff_policy"])
                            else:
                                satisfied = satisfied and evidence.get("owner_cutoff_satisfied") is True
                            frozen[eid] = {"satisfied": bool(satisfied), "completion_evidence_refs": evidence["completion_evidence_refs"]}
                        checks[eid] = frozen[eid]
                request.update(idempotency_keys=keys, deadline_checks=checks)
                TimeScheduleCalendar._persist(state)
                results, missing = [], []
                for event in batch:
                    lookup = call(owner, "receipt_lookup", {"idempotency_key": keys[event["event_id"]]})
                    if lookup.get("found"):
                        results.append(lookup["result"])
                    else:
                        missing.append(event)
                if missing:
                    results += call(owner, "handle_due_batch", request | {"events": missing})["results"]
                require(len(results) == len(batch) and {r["event_id"] for r in results} == {e["event_id"] for e in batch},
                        "RECOVERY_PENDING")
                for result in sorted(results, key=lambda r: r["event_id"]):
                    event = state.scheduled_event[result["event_id"]]
                    require(type(result["accepted"]) is bool and bool(result["receipt_ref"]), "RECOVERY_PENDING")
                    activity_ref = event["payload_json"].get("activity_ref")
                    if activity_ref:
                        require(activity_ref in state.duration_contract and
                                state.duration_contract[activity_ref]["owner_domain"] == owner, "AUTHORIZATION_EXCEEDED")
                        require(result.get("activity_state") and result.get("progress_ref"), "RECOVERY_PENDING")
                    # Validate descendants before publishing this acknowledged owner result.
                    staged = State(world_clock=copy.deepcopy(state.world_clock), scheduled_event=dict(state.scheduled_event),
                                   versioned_defaults=state.versioned_defaults)
                    if result["accepted"]:
                        for new in result.get("new_events", []):
                            require(new["owner_domain"] == owner and new["source_event_id"] == event["event_id"],
                                    "AUTHORIZATION_EXCEEDED")
                            require(new["due_ms"] != now or new["phase"] >= phase, "PAST_EVENT_REGISTRATION")
                            TimeScheduleCalendar._event(staged, new)
                    for new_id, new in staged.scheduled_event.items():
                        if new_id not in state.scheduled_event:
                            state.scheduled_event[new_id] = new
                    event["state"] = "SETTLED"
                    delivery = state.event_delivery[keys[event["event_id"]]]
                    delivery.update(delivery_state="SETTLED", receipt_ref=result["receipt_ref"])
                    trace["command_and_receipt_refs"].append(result["receipt_ref"])
                    trace["loop_causation_refs"].append(event["event_id"])
                    if result["accepted"]:
                        trace["delivered_observation_refs"].extend(result.get("observation_refs", []))
                        if result.get("barrier"):
                            decision["barriers"].append(result["barrier"])
                    if activity_ref:
                        contract = state.duration_contract[activity_ref]
                        if result["accepted"]:
                            contract["activity_state"] = result["activity_state"]
                            contract["progress_ref"] = result["progress_ref"]
                        if not result["accepted"] or contract["activity_state"] != "COMPLETED":
                            decision["barriers"].append({"code": "CONTINUATION_REQUIRED"})
                    deadline_ref = event["payload_json"].get("deadline_ref")
                    if deadline_ref:
                        deadline = state.deadline[deadline_ref]
                        check = checks[event["event_id"]]
                        deadline.update(trigger_state="MET" if check["satisfied"] else "MISSED",
                                        completion_evidence_refs=check["completion_evidence_refs"],
                                        consequence_receipt_refs=[result["receipt_ref"]])
                        TimeScheduleCalendar._stamp(state, stable(event["event_id"], "deadline"), "DeadlineTriggered", now,
                                                   event["source_event_id"])
                    occurrence_ref = event["payload_json"].get("occurrence_ref")
                    if occurrence_ref and occurrence_ref in state.schedule_occurrence:
                        state.schedule_occurrence[occurrence_ref]["status"] = "ENDED" if phase == 1 else "START_DUE_SETTLED"
                    TimeScheduleCalendar._stamp(state, stable(event["event_id"], "settled"), "ScheduledEventSettled", now, event["source_event_id"])
                    TimeScheduleCalendar._persist(state)
            decision.pop("inflight_batch", None)
        decision.pop("inflight_batch", None)
        for reservation in state.activity_reservation.values():
            if reservation["status"] == "ACTIVE" and reservation["end_ms"] <= now:
                reservation["status"] = "RELEASED"

    @staticmethod
    def _finish(state: State, intent: JSON, status: str, code: str) -> JSON:
        aid, now = intent["advance_id"], state.world_clock["instant_ms"]
        trace = state.time_trace[aid]
        activity = state.duration_contract.get(intent.get("activity_ref", ""))
        if status != "RECOVERY_REQUIRED":
            for event in state.scheduled_event.values():
                if event["payload_json"].get("advance_ref") == aid and event["state"] == "PENDING":
                    event["state"] = "CANCELLED"
                    event["cancellation_tombstone"] = {"reason": code, "source_ref": aid}
            references = [r["reservation_id"] for r in state.activity_reservation.values()
                          if r["source_intent_ref"] == aid and r["status"] == "ACTIVE"]
            release = call("system1", "release_resources", {"reservation_refs": references, "status": status})
            require(set(release["releasable_reservation_refs"]) <= set(references), "RECOVERY_PENDING")
            for ref in release["releasable_reservation_refs"]:
                state.activity_reservation[ref]["status"] = "RELEASED"
            projection = call("system3", "project", {"public_code": code,
                "observation_refs": trace["delivered_observation_refs"], "actor_id": intent["actor_id"]})
        else:
            # Infrastructure diagnostics disclose no private owner/event identities.
            projection = {"observation_refs": [], "next_permitted_options": [],
                          "stop_reason": {"code": "OPERATIONAL_RECOVERY",
                                          "error": TimeScheduleCalendar._error(state, intent, TemporalError(code))["error"]}}
        target: Any = intent["requested_target_ms"]
        if activity and activity["policy_kind"] == "sampled":
            target = {"estimated_duration": activity["estimated_duration"]}
        result = {"advance_id": aid, "status": status, "committed_start": intent["start_ms"], "committed_end": now,
            "elapsed_ms": now - intent["start_ms"], "requested_target": target,
            "stop_reason": projection["stop_reason"], "observation_refs": projection["observation_refs"],
            "next_permitted_options": projection["next_permitted_options"], "trace_id": aid}
        if activity and activity["activity_state"] != "COMPLETED":
            result.update(pending_activity_ref=activity["activity_id"], progress_ref=activity["progress_ref"])
        state.advance_result[aid] = result
        trace["continuation_decision"]["status"] = status
        trace["continuation_decision"]["reason"] = code
        if result["elapsed_ms"] and status != "RECOVERY_REQUIRED":
            TimeScheduleCalendar._stamp(state, stable(aid, "committed", now), "TimeAdvanceCommitted", now, aid)
        TimeScheduleCalendar._stamp(state, stable(aid, status, now),
            "AdvanceRecoveryRequired" if status == "RECOVERY_REQUIRED" else
            "AdvanceCompleted" if status == "COMPLETED" else "AdvancePaused", now, aid)
        if status != "RECOVERY_REQUIRED":
            TimeScheduleCalendar._persist(state)
        return copy.deepcopy(result)

    @staticmethod
    def _run(state: State, intent: JSON) -> JSON:
        while True:
            with LOCK:
                aid, now = intent["advance_id"], state.world_clock["instant_ms"]
                prior = state.advance_result.get(aid)
                if prior and prior["status"] != "RECOVERY_REQUIRED":
                    return copy.deepcopy(prior)
                try:
                    pending = next((s for s in state.temporal_segment.values() if s["advance_id"] == aid
                                    and s["state"] in {"PREPARED", "COMMITTING", "BLOCKED"}), None)
                    if pending:
                        if intent["cancellation_requested"] and TimeScheduleCalendar._abort_prepared(state, pending):
                            TimeScheduleCalendar._batch(state, intent)
                            return TimeScheduleCalendar._finish(state, intent, "PAUSED", "CANCELLED")
                        TimeScheduleCalendar._segment(state, intent, pending["end_ms"])
                        continue
                    if intent["cancellation_requested"]:
                        TimeScheduleCalendar._batch(state, intent)
                        return TimeScheduleCalendar._finish(state, intent, "PAUSED", "CANCELLED")
                    clock = state.world_clock
                    zone = pinned_zone(clock["timezone_id"], clock["tzdata_version"])
                    future_local = utc(now).astimezone(zone).replace(tzinfo=None) + timedelta(
                        days=state.versioned_defaults["recurrence_lookahead_local_days"])
                    lookahead = min(resolve_local(future_local.isoformat(), zone), intent["maximum_horizon_ms"] + 1)
                    TimeScheduleCalendar._expand(state, now, lookahead)
                    TimeScheduleCalendar._batch(state, intent)
                    decision = state.time_trace[aid]["continuation_decision"]
                    for owner in ("system1", "health", "travel", "communication"):
                        review = call(owner, "review", {"intent": intent, "instant_ms": now})
                        state.time_trace[aid]["delivered_observation_refs"].extend(review["observation_refs"])
                        if review.get("barrier"):
                            decision.setdefault("barriers", []).append(review["barrier"])
                        if review.get("predicate_satisfied"):
                            decision["predicate_satisfied"] = True
                        contract = state.duration_contract.get(intent.get("activity_ref", ""))
                        if contract and contract["owner_domain"] == owner:
                            contract["progress_ref"] = review["progress_ref"]
                    if decision.get("barriers"):
                        return TimeScheduleCalendar._finish(state, intent, "PAUSED", "CHOICE_REQUIRED")
                    if decision.get("predicate_satisfied"):
                        return TimeScheduleCalendar._finish(state, intent, "COMPLETED", "STOP_PREDICATE")
                    if now >= min(intent["requested_target_ms"], intent["maximum_horizon_ms"]):
                        if now < intent["requested_target_ms"]:
                            return TimeScheduleCalendar._finish(state, intent, "PAUSED", "AUTHORIZATION_EXCEEDED")
                        if intent.get("activity_ref") in state.duration_contract:
                            contract = state.duration_contract[intent["activity_ref"]]
                            TimeScheduleCalendar._complete_activity(state, intent, contract)
                            if contract["activity_state"] != "COMPLETED":
                                return TimeScheduleCalendar._finish(state, intent, "PAUSED", "CONTINUATION_REQUIRED")
                        return TimeScheduleCalendar._finish(state, intent, "COMPLETED",
                            "TIMEOUT" if intent["kind"] == "wait_for_known_event" else "TARGET_REACHED")
                    TimeScheduleCalendar._segment(state, intent, TimeScheduleCalendar._boundary(state, intent))
                except TemporalError as error:
                    return TimeScheduleCalendar._finish(state, intent, "RECOVERY_REQUIRED", error.code)
                except (KeyError, TypeError, ValueError, OverflowError):
                    return TimeScheduleCalendar._finish(state, intent, "RECOVERY_REQUIRED", "RECOVERY_PENDING")

    @staticmethod
    def flush_outbox(state: State, request: JSON) -> JSON:
        """Retry-safe outgoing placeholder calls, with no external domain implementation."""
        with LOCK:
            TimeScheduleCalendar._owner("persistence", request["credential"])
            delivered = []
            for key in sorted(list(state.event_delivery)):
                entry = state.event_delivery[key]
                if entry["delivery_state"] != "OUTBOX":
                    continue
                for owner in DOMAINS:
                    if owner in {"configuration", "persistence"}:
                        continue
                    output_key = stable(key, owner)
                    if output_key in state.event_delivery and state.event_delivery[output_key]["delivery_state"] == "DELIVERED":
                        continue
                    projection = call("system3", "project", {"public_code": "TEMPORAL_UPDATE",
                        "audience": owner, "event_ref": entry["event_ref"]})
                    response = call(owner, "publish", {"idempotency_key": output_key,
                        "event_type": entry["command_id"].split(":", 1)[0], "projection": projection})
                    require(response.get("accepted") is True, "OWNER_UNAVAILABLE")
                    state.event_delivery[output_key] = {"event_ref": entry["event_ref"], "owner_domain": owner,
                        "command_id": output_key, "idempotency_key": output_key, "delivery_state": "DELIVERED",
                        "receipt_ref": response["receipt_ref"], "outbox_cursor": entry["outbox_cursor"]}
                    TimeScheduleCalendar._persist(state)
                entry["delivery_state"] = "DELIVERED"
                delivered.append(key)
                TimeScheduleCalendar._persist(state)
            return {"delivered_refs": delivered}

    @staticmethod
    def fork(state: State, request: JSON) -> State:
        """Fork now, or rewind using a validated historical export; original state is untouched."""
        with LOCK:
            TimeScheduleCalendar._owner("persistence", request["credential"])
            source = TimeScheduleCalendar.import_state(request.get("snapshot", TimeScheduleCalendar.export_state(state)))
            require(source.world_clock["branch_id"] == state.world_clock["branch_id"], "AUTHORIZATION_EXCEEDED")
            require(source.world_clock["instant_ms"] <= state.world_clock["instant_ms"], "AUTHORIZATION_EXCEEDED")
            require(request["branch_id"] != state.world_clock["branch_id"] and bool(request["branch_id"]))
            require(not any(s["state"] in {"PREPARED", "COMMITTING", "BLOCKED"}
                            for s in source.temporal_segment.values()), "RECOVERY_PENDING")
            require(not any(d["delivery_state"] == "PENDING" for d in source.event_delivery.values()) and
                    not any(a not in source.advance_result or source.advance_result[a]["status"] == "RECOVERY_REQUIRED"
                            for a in source.advance_intent), "RECOVERY_PENDING")
            parent, child = source.world_clock["branch_id"], request["branch_id"]
            source.world_clock["branch_id"] = child
            for collection in (source.scheduled_event, source.activity_reservation):
                for value in collection.values():
                    value["branch_id"] = child
            # Inherited history never republishes effects. Future dispatch gets new branch keys.
            for delivery in source.event_delivery.values():
                if delivery["delivery_state"] == "OUTBOX":
                    delivery["delivery_state"] = "INHERITED"
            trace_id = stable(child, parent, source.world_clock["instant_ms"])
            source.time_trace[trace_id] = {"trace_id": trace_id, "continuation_decision": {
                "parent_branch_id": parent, "fork_instant_ms": source.world_clock["instant_ms"]}}
            TimeScheduleCalendar.validate_state(source)
            TimeScheduleCalendar._persist(source)
            return source


def state_machine(request: JSON, snapshot: JSON) -> JSON:
    """JSON-only boundary. The host supplies a trusted snapshot, never the player.

    Persist the returned snapshot through the hosting coordinator before exposing
    the result. Dependency adapters remain mocked in this isolated implementation.
    """
    state = TimeScheduleCalendar.import_state(snapshot)
    result = TimeScheduleCalendar.advance(state, request)
    return {"state": TimeScheduleCalendar.export_state(state), "result": result}


if __name__ == "__main__":
    # A quiet fifteen-minute wait; all external effects remain mocked.
    state = default_state()
    request = {"command_id": "example-wait", "branch_id": "main", "actor_id": "mock:pc",
        "expected_clock_revision": 0, "authorization_ref": "mock:authorization", "causation_id": "mock:input",
        "kind": "wait_duration", "duration_ms": 900_000,
        "maximum_horizon_ms": state.world_clock["instant_ms"] + 900_000, "location_ref": "mock:location"}
    print(json.dumps(TimeScheduleCalendar.advance(state, request), indent=2))
