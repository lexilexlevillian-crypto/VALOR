"""Deterministic, isolated vehicles/transportation module (Python 3.11+).

Only the supplied architecture's fields are permitted in domain records. All
mutable records carry branch_id/revision. Records are indexed by opaque refs;
companion records use the vehicle, trip, service-order or encounter ref they
describe. resource_state is nested in vehicle_operation, never duplicated.

Every dependency is a stateless JSON stub. Fixture responses are assertions
provided by a test/host, not simulations of clocks, money, locations or actors.
Without a supplied response an integration fails closed with OWNER_PENDING.
Client owner_context is never accepted as an authoritative dependency result.

PolicyState values, transitions, rates and workflow stages must be authored in
vehicle_type_version.operation_policy/resource_policy/component_policy. The
only implemented numerical model is explicitly selected 'linear_distance_idle':
distance = speed * duration; consumption = distance * distance_rate + duration
* idle_rate. There are no implicit rates. More elaborate models must be added
as reviewed local policies; arbitrary executable policy strings are prohibited.
An explicitly enabled linear load policy adds authored per-load coefficients
using a System 15 load projection certified to exclude containment double counts.

SQLite journal columns describe storage/protocol metadata, not extra game state.
The journal durably records prepared writes and owner requests before delivery.
Separate owners must honor prepare/commit/abort idempotency and decision-based
visibility. The dummy stubs acknowledge payloads only; they do not implement
those owners. No completed movement is undone because a later owner fails.
"""

from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
import threading
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, TypedDict

JSON = dict[str, Any]


class Command(TypedDict):
    branch_id: str
    actor_principal_ref: str
    request_id: str
    expected_vehicle_person_anchor_revisions: dict[str, int]
    intention: JSON
    permission_or_mandate_ref: str | None
    owner_context: JSON


class Response(TypedDict):
    response_status: str
    failure_code: str | None
    source_event_ref: str
    actor_known_vehicle_view: JSON


SCHEMA = {
    "vehicle_type_version": "type_id version layout_ref operation_policy resource_policy component_policy",
    "vehicle_instance": "vehicle_id physical_item_id mobile_place_id type_version",
    "vehicle_operation": "vehicle_id mode power_state driver_ref resource_state condition_ref",
    "vehicle_trip": "trip_id request_key vehicle_id route_version current_edge progress_units intended_destination state source_event",
    "vehicle_seat": "vehicle_id anchor_id role compatibility_ref",
    "transport_service": "service_id provider_ref run_or_order_id vehicle_id worker_ref terms_version state",
    "vehicle_identification": "vehicle_id feature_ref credential_ref effective_interval source_event",
    "layout_and_operation_configuration": "supported_vehicle_form dimensions seat_anchors standing_anchors compartment_refs seat_capacity seat_compatibility load_policy supported_capabilities control_policy overcapacity_policy occupant_towing_policy",
    "access_and_preparation": "door_states window_states cargo_closure_states credential_refs control_access_ref gear_control_state restraint_states safety_equipment_refs completed_preparation_receipts",
    "vehicle_resource_state": "resource_kind unit capacity_units quantity_units consumption_policy_version fractional_remainder idle_policy load_consumption_policy gauge_precision consumption_receipts transfer_or_loss_receipts",
    "condition_and_maintenance": "component_states supported_component_categories damage_causes damage_severity_and_exposure observed_symptom_refs diagnostic_claim_refs replacement_lineage_refs maintenance_policy routine_wear_enabled service_due_refs",
    "vehicle_use_agreement": "title_rights_ref offer_acceptance_refs permitted_driver_refs use_scope third_party_lending_terms passenger_terms return_anchor_ref return_deadline responsibility_terms fuel_maintenance_terms access_provisioning_refs state",
    "travel_mandate": "principal_ref vehicle_or_mode destination_ref route_preferences participant_refs cost_cap resource_cap stopping_conditions duration_or_expiry accepted_routine_preparation accepted_routine_exit named_essentials acceptance_receipt_ref",
    "trip_execution": "origin_ref accepted_route_ref mandate_ref participant_presence_refs validated_owner_revisions committed_distance elapsed_time_ref next_due_boundary delay_receipts interruption_ref progress_receipts",
    "traffic_interval": "source_event_ref effective_interval affected_edge_refs aggregate_demand capacity_effect speed_effect queue_state junction_delay restriction_refs forecast_observation_refs",
    "reservation_and_parking": "reservation_id request_ref reserved_resource_ref expiry state parking_anchor_ref capacity_policy_ref access_and_vehicle_form_policy_ref restriction_interval_refs accepted_fee_terms_ref parking_occupancy_ref placement_receipt_ref",
    "taxi_request": "pickup_ref destination_ref passenger_count cargo_requirements service_type communication_request_ref assigned_service_ref approach_trip_ref passenger_trip_ref quote_ref accepted_terms_ref payment_method_refs fare_basis authorized_tip_ref fulfillment_state settlement_ref",
    "transit_run": "run_id route_pattern_ref stop_refs published_timetable_ref actual_stop_call_receipts vehicle_ref driver_ref current_stop_or_edge_ref capacity_policy_ref aggregate_rider_count boarding_state operational_status fare_policy_ref pass_and_transfer_refs selected_exit_stop_ref service_change_refs",
    "repair_work_order": "service_ref vehicle_ref custody_and_access_refs known_symptom_refs requested_scope inspection_authority_ref diagnostic_finding_refs quote_ref authorized_cost_cap parts_authorization_ref parts_and_delivery_refs labor_task_refs expected_completion return_conditions state condition_output_receipts invoice_and_settlement_refs",
    "tow_and_impound": "request_ref authority_or_agreement_ref source_event_ref target_vehicle_ref carrier_vehicle_ref worker_ref carrier_relation_ref capacity_policy_ref occupant_handling_receipts transport_trip_ref yard_anchor_ref custody_ref observed_inventory_ref storage_fee_terms_and_period_keys release_authority_ref retrieval_receipt_ref state",
    "search_context": "actor_ref authority_permission_or_violation_ref target_scope_refs method_ref effort_and_time_refs access_result_ref coverage_ref opportunity_ref resolved_outcome_ref observation_refs collection_and_custody_receipts",
    "observation_and_evidence_links": "observer_or_recording_source_ref event_time_and_location_refs coverage_and_attention_refs observed_feature_claim_ref confidence_ref last_known_location_claim_ref registration_record_ref case_association_refs custody_and_condition_record_refs photo_sample_report_refs telemetry_artifact_refs retention_policy_ref",
    "chase_context": "encounter_ref target_vehicle_ref pursuer_vehicle_refs participant_trip_refs line_of_sight_observation_refs last_known_observation_refs search_plan_refs distance_gap maneuver_opportunity_refs resolved_outcome_refs state",
    "command_envelope": "actor_principal_ref request_id expected_vehicle_person_anchor_revisions intention permission_or_mandate_ref owner_context",
    "receipt_and_coordination": "trip_initiation_key segment_key resource_consumption_key service_charge_key owner_handoff_key source_event_ref participant_owner_refs prepare_receipt_refs durable_decision owner_completion_receipts recovery_policy_ref response_status failure_code",
    "persistence_and_projections": "coherent_clock_checkpoint_ref simulation_fidelity_policy_ref historical_policy_versions migration_or_override_event_refs quarantined_reference_refs derived_occupants derived_effective_location derived_cargo_load actor_known_vehicle_view",
}
MODES = frozenset("PARKED STOPPED_ACTIVE MOVING DISABLED TOWED SERVICE_CONTROLLED".split())
STATUSES = frozenset("PROPOSED ACCEPTED IN_PROGRESS COMMITTED ARRIVED PARTIAL CHOICE_REQUIRED REJECTED OWNER_PENDING".split())
FAILURES = frozenset("VEHICLE_NOT_PRESENT NO_CONTROL_ACCESS NO_DRIVER SEAT_UNAVAILABLE CAPACITY_EXCEEDED ROUTE_BLOCKED RESOURCE_INSUFFICIENT OPERATION_DISABLED PARKING_UNAVAILABLE NO_SERVICE_UNIT TERMS_NOT_ACCEPTED AUTHORITY_REQUIRED STALE_REVISION OWNER_UNAVAILABLE".split())
OWNERS = ("system12", "system15", "system11", "system10", "system13", "system14", "system16", "system3", "health", "encounter", "institutions", "npc", "world", "ui")
COMMANDS = frozenset("BoardVehicle ExitVehicle StartTrip ChangeRoute StopVehicle ParkVehicle RequestTaxi BoardTransit AuthorizeRepair RequestTow ApplyEncounterOutcome".split())


def clone(value: Any) -> Any:
    return copy.deepcopy(value)


def encode(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def require(condition: Any, code: str = "AUTHORITY_REQUIRED", status: str = "REJECTED") -> None:
    if condition is not True:
        raise Gate(code, status)


class Gate(Exception):
    def __init__(self, code: str, status: str = "REJECTED"):
        super().__init__(code)
        self.code, self.status = code, status


def integer(value: Any, minimum: int = 0) -> int:
    require(type(value) is int and value >= minimum)
    return value


def rational(value: Any) -> Fraction:
    if type(value) is int:
        return Fraction(value)
    require(isinstance(value, dict) and set(value) == {"numerator", "denominator"})
    require(type(value["numerator"]) is int)
    return Fraction(value["numerator"], integer(value["denominator"], 1))


def exact(value: Fraction | int) -> JSON:
    q = Fraction(value)
    return {"numerator": q.numerator, "denominator": q.denominator}


def positive(value: Any, allow_zero: bool = True) -> Fraction:
    q = rational(value)
    require(q >= 0 if allow_zero else q > 0)
    return q


def checked_record(entity: str, record: JSON, branch: str) -> None:
    require(isinstance(record, dict))
    allowed = set(SCHEMA[entity].split()) | {"branch_id", "revision"}
    require(set(record) <= allowed)
    require(record.get("branch_id") == branch)
    integer(record.get("revision"))
    encode(record)
    for name, value in record.items():
        if name.endswith("_refs"):
            require(isinstance(value, list) and all(isinstance(ref, str) and bool(ref) for ref in value))
        elif name.endswith("_ref") and value is not None:
            require(isinstance(value, str) and bool(value))
    for name in ("version", "passenger_count", "aggregate_rider_count", "authorized_cost_cap"):
        if name in record:
            integer(record[name])
    if "routine_wear_enabled" in record:
        require(type(record["routine_wear_enabled"]) is bool)
    if entity == "vehicle_operation":
        require(record.get("mode") in MODES)
        resource = record.get("resource_state")
        require(isinstance(resource, dict))
        require(set(resource) <= set(SCHEMA["vehicle_resource_state"].split()))
        capacity = integer(resource.get("capacity_units"))
        quantity = integer(resource.get("quantity_units"))
        remainder = rational(resource.get("fractional_remainder"))
        require(quantity <= capacity and 0 <= remainder < 1)
        require(Fraction(quantity) - remainder >= 0)
    if entity == "vehicle_trip":
        positive(record["progress_units"])
    if entity == "trip_execution":
        positive(record["committed_distance"])
    if entity == "receipt_and_coordination":
        require(record["durable_decision"] in {"UNDECIDED", "COMMIT", "ABORT"})
        require(record["response_status"] in STATUSES)
        require(record.get("failure_code") is None or record["failure_code"] in FAILURES)


class VehicleState:
    """Strict domain state. All attributes are architecture-listed entities."""

    __slots__ = tuple(k for k in SCHEMA if k != "vehicle_resource_state")

    def __init__(self, records: JSON | None = None):
        records = records or {}
        require(set(records) <= set(self.__slots__))
        for name in self.__slots__:
            value = clone(records.get(name, {}))
            require(isinstance(value, dict))
            setattr(self, name, value)

    def to_json(self) -> JSON:
        return {name: clone(getattr(self, name)) for name in self.__slots__}

    def validate(self, branch: str) -> None:
        for entity in self.__slots__:
            for ref, record in getattr(self, entity).items():
                require(isinstance(ref, str) and bool(ref))
                checked_record(entity, record, branch)
        roots, physical = set(), set()
        for ref, vehicle in self.vehicle_instance.items():
            require(vehicle["vehicle_id"] == ref)
            require(vehicle["mobile_place_id"] not in roots)
            require(vehicle["physical_item_id"] not in physical)
            roots.add(vehicle["mobile_place_id"])
            physical.add(vehicle["physical_item_id"])
            require(vehicle["type_version"] in self.vehicle_type_version)
            require(ref in self.vehicle_operation)
        for ref, operation in self.vehicle_operation.items():
            require(ref in self.vehicle_instance and operation["vehicle_id"] == ref)
            require(operation["condition_ref"] in self.condition_and_maintenance)
        for trip in self.vehicle_trip.values():
            require(trip["vehicle_id"] in self.vehicle_instance)
        # Carrier links are System 17 relations; external placement is untouched.
        attached = [t for t in self.tow_and_impound.values() if t.get("carrier_relation_ref")]
        require(len({t["target_vehicle_ref"] for t in attached}) == len(attached), "CAPACITY_EXCEEDED")
        for tow in attached:
            require(tow["target_vehicle_ref"] in self.vehicle_instance and tow["carrier_vehicle_ref"] in self.vehicle_instance,
                    "NO_SERVICE_UNIT")
        parents = {
            t["target_vehicle_ref"]: t["carrier_vehicle_ref"]
            for t in attached
        }
        for child in parents:
            seen = set()
            while child in parents:
                require(child not in seen, "CAPACITY_EXCEEDED")
                seen.add(child)
                child = parents[child]


def stub(owner: str, operation: str, request: JSON) -> JSON:
    """Outgoing and incoming placeholder; no external state is read or changed."""
    return {"owner": owner, "operation": operation, "available": False,
            "branch_id": request["branch_id"], "request_id": request["request_id"],
            "receipt_ref": None, "payload": {}}


def request_system_12(operation: str, request: JSON) -> JSON:
    return stub("system12", operation, request)


def request_system_15(operation: str, request: JSON) -> JSON:
    return stub("system15", operation, request)


def request_system_11(operation: str, request: JSON) -> JSON:
    return stub("system11", operation, request)


def request_system_10(operation: str, request: JSON) -> JSON:
    return stub("system10", operation, request)


def request_system_13(operation: str, request: JSON) -> JSON:
    return stub("system13", operation, request)


def request_system_14(operation: str, request: JSON) -> JSON:
    return stub("system14", operation, request)


def request_system_16(operation: str, request: JSON) -> JSON:
    return stub("system16", operation, request)


def request_system_3(operation: str, request: JSON) -> JSON:
    return stub("system3", operation, request)


def request_health(operation: str, request: JSON) -> JSON:
    return stub("health", operation, request)


def request_encounter(operation: str, request: JSON) -> JSON:
    return stub("encounter", operation, request)


def request_institutions(operation: str, request: JSON) -> JSON:
    return stub("institutions", operation, request)


def request_npc(operation: str, request: JSON) -> JSON:
    return stub("npc", operation, request)


def request_world(operation: str, request: JSON) -> JSON:
    return stub("world", operation, request)


def request_ui(operation: str, request: JSON) -> JSON:
    return stub("ui", operation, request)


STUBS: dict[str, Callable[[str, JSON], JSON]] = dict(zip(OWNERS, (
    request_system_12, request_system_15, request_system_11, request_system_10,
    request_system_13, request_system_14, request_system_16, request_system_3,
    request_health, request_encounter, request_institutions, request_npc,
    request_world, request_ui,
)))


class MockDependencies:
    """Static fixture payloads keyed by (branch, request_id, owner, operation).

    A fixture is returned verbatim. No clock, ledger, route, access, actor,
    uncertainty, or external reservation algorithm is implemented here.
    """

    def __init__(self, fixtures: dict[tuple[str, str, str, str], JSON] | None = None):
        self.fixtures = clone(fixtures or {})

    def call(self, owner: str, operation: str, request: JSON) -> JSON:
        key = (request["branch_id"], request["request_id"], owner, operation)
        if key in self.fixtures:
            return clone(self.fixtures[key])
        return STUBS[owner](operation, clone(request))


def owner_payload(dependencies: MockDependencies, owner: str, operation: str, request: JSON) -> tuple[JSON, str]:
    try:
        result = dependencies.call(owner, operation, request)
    except Exception as exc:
        raise Gate("OWNER_UNAVAILABLE", "OWNER_PENDING") from exc
    require(isinstance(result, dict) and result.get("available") is True,
            "OWNER_UNAVAILABLE", "OWNER_PENDING")
    require(result.get("owner") == owner and result.get("operation") == operation,
            "OWNER_UNAVAILABLE", "OWNER_PENDING")
    require(result.get("branch_id") == request["branch_id"] and result.get("request_id") == request["request_id"],
            "OWNER_UNAVAILABLE", "OWNER_PENDING")
    require(isinstance(result.get("receipt_ref"), str) and bool(result["receipt_ref"]),
            "OWNER_UNAVAILABLE", "OWNER_PENDING")
    require(isinstance(result.get("payload"), dict), "OWNER_UNAVAILABLE", "OWNER_PENDING")
    return clone(result["payload"]), result["receipt_ref"]


class _Transition:
    """Ephemeral command evaluation; not persisted game state."""

    def __init__(self, state: VehicleState, command: Command, dependencies: MockDependencies, history: list[JSON] | None = None):
        self.state, self.command, self.dependencies = state, command, dependencies
        self.branch, self.key = command["branch_id"], command["request_id"]
        self.action = command["intention"]
        self.owners: dict[str, list[JSON]] = {}
        self.events: list[JSON] = []
        self.status = "COMMITTED"
        self.failure: str | None = None
        self.authorization: JSON = {}
        self.history = history or []
        self.source = f"{self.branch}/vehicle-event/{self.key}"
        self.record("command_envelope", self.key, dict(command))

    def record(self, entity: str, ref: str, values: JSON) -> JSON:
        table = getattr(self.state, entity)
        prior = table.get(ref)
        result = clone(values)
        result["branch_id"] = self.branch
        result["revision"] = prior["revision"] + 1 if prior else 0
        checked_record(entity, result, self.branch)
        table[ref] = result
        return result

    def get(self, entity: str, ref: str) -> JSON:
        result = getattr(self.state, entity).get(ref)
        require(result is not None, "OWNER_UNAVAILABLE", "OWNER_PENDING")
        return clone(result)

    def query(self, owner: str, operation: str, **context: Any) -> JSON:
        request = {"branch_id": self.branch, "request_id": self.key,
                   "actor_principal_ref": self.command["actor_principal_ref"],
                   "intention": clone(self.action), "context": clone(context)}
        payload, receipt = owner_payload(self.dependencies, owner, operation, request)
        payload["owner_receipt_ref"] = receipt
        return payload

    def effect(self, owner: str, operation: str, **payload: Any) -> None:
        self.owners.setdefault(owner, []).append({"operation": operation, "payload": clone(payload),
                                                 "source_event_ref": self.source})

    def event(self, name: str, **facts: Any) -> None:
        self.events.append({"event": name, "source_event_ref": self.source, **clone(facts)})

    def policy(self, vehicle_ref: str) -> tuple[JSON, JSON, JSON, JSON]:
        vehicle = self.get("vehicle_instance", vehicle_ref)
        operation = self.get("vehicle_operation", vehicle_ref)
        kind = self.get("vehicle_type_version", vehicle["type_version"])
        config = self.get("layout_and_operation_configuration", kind["layout_ref"])
        for key in ("operation_policy", "resource_policy", "component_policy"):
            require(isinstance(kind[key], dict) and "version" in kind[key], "OPERATION_DISABLED")
        return vehicle, operation, kind, config

    def authorize(self) -> None:
        self.authorization = self.query("ui", "authorize")
        require(self.authorization.get("principal_ref") == self.command["actor_principal_ref"])
        require(self.authorization.get("command") == self.action["command"])
        require(self.authorization.get("accepted") is True)
        require(self.authorization.get("branch_safe") is True)
        require(self.authorization.get("scope_valid") is True, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        if self.command["permission_or_mandate_ref"] is not None:
            require(self.authorization.get("mandate_ref") == self.command["permission_or_mandate_ref"])
            require(self.authorization.get("mandate_unexpired") is True,
                    "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            mandate = self.get("travel_mandate", self.command["permission_or_mandate_ref"])
            require(mandate["principal_ref"] == self.command["actor_principal_ref"])
            require(mandate.get("acceptance_receipt_ref") is not None)
            clock = self.query("system11", "mandate_validity", duration_or_expiry=mandate["duration_or_expiry"])
            require(clock.get("unexpired") is True, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            require(self.authorization.get("stopping_conditions_clear") is True,
                    "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            if self.action["command"] in {"ParkVehicle", "RequestTaxi", "RequestTow", "AuthorizeRepair", "BoardTransit"}:
                budget = self.query("system14", "mandate_budget", mandate_ref=self.command["permission_or_mandate_ref"])
                require(integer(budget["committed_and_proposed_cost"]) <= integer(mandate["cost_cap"]),
                        "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            if self.action.get("vehicle_ref"):
                require(mandate["vehicle_or_mode"] == self.action["vehicle_ref"], "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            if self.action.get("destination"):
                require(mandate["destination_ref"] == self.action["destination"], "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            # New voluntary commitments need a new accepted action, not a routine mandate.
            require(self.action.get("event_kind") not in {"SearchResolved", "StopSignal"},
                    "AUTHORITY_REQUIRED", "CHOICE_REQUIRED")
        expected = self.command["expected_vehicle_person_anchor_revisions"]
        facts = self.query("system12", "validate_revisions", expected=expected)
        require(facts.get("matched") is True, "STALE_REVISION")
        vehicle_ref = self.action.get("vehicle_ref")
        if vehicle_ref:
            vehicle = self.get("vehicle_instance", vehicle_ref)
            require(expected.get(vehicle_ref) == vehicle["revision"], "STALE_REVISION")

    def operating(self, vehicle_ref: str) -> tuple[JSON, JSON, JSON, JSON]:
        vehicle, operation, kind, config = self.policy(vehicle_ref)
        require("self_powered" in config["supported_capabilities"], "OPERATION_DISABLED")
        require(operation["mode"] not in {"TOWED", "SERVICE_CONTROLLED"}, "OPERATION_DISABLED")
        condition = self.get("condition_and_maintenance", operation["condition_ref"])
        rules = kind["component_policy"]["disabled_states"]
        for component, value in condition["component_states"].items():
            require(component in rules, "OPERATION_DISABLED")
            require(value not in rules[component], "OPERATION_DISABLED")
        driver = operation["driver_ref"]
        require(driver is not None, "NO_DRIVER")
        presence = self.query("system12", "driver", vehicle_ref=vehicle_ref, driver_ref=driver)
        require(presence.get("actual_compatible_occupant") is True, "NO_DRIVER")
        require(presence.get("controls_accessible") is True, "NO_CONTROL_ACCESS")
        health = self.query("health", "driver_feasibility", driver_ref=driver)
        require(health.get("physically_able") is True, "NO_DRIVER")
        skill = self.query("system10", "competence", driver_ref=driver)
        require(skill.get("feasible") is True, "NO_DRIVER")
        # A competence query is not an uncertainty roll.
        resource = operation["resource_state"]
        require(Fraction(resource["quantity_units"]) - rational(resource["fractional_remainder"]) > 0,
                "RESOURCE_INSUFFICIENT")
        return vehicle, operation, kind, config

    def allowed_mode(self, kind: JSON, operation: JSON, command: str) -> None:
        require(operation["mode"] in kind["operation_policy"]["allowed_modes"][command], "OPERATION_DISABLED")

    def reserve(self, resource_ref: str, facts: JSON, kind: JSON) -> None:
        states = kind["operation_policy"]["reservation_states"]
        existing = self.state.reservation_and_parking.get(resource_ref)
        prior_request = self.state.command_envelope.get(existing["request_ref"]) if existing else None
        same_parking_plan = bool(
            self.action["command"] == "ParkVehicle" and prior_request
            and prior_request["intention"].get("vehicle_ref") == self.action.get("vehicle_ref")
            and prior_request["intention"].get("trip_ref") == self.action.get("trip_ref")
        )
        require(existing is None or existing["state"] == states["released"] or same_parking_plan,
                "PARKING_UNAVAILABLE" if self.action["command"] == "ParkVehicle" else "SEAT_UNAVAILABLE")
        require(facts.get("reservation_available") is True, "CAPACITY_EXCEEDED")
        self.record("reservation_and_parking", resource_ref, {
            "reservation_id": resource_ref, "request_ref": self.key,
            "reserved_resource_ref": resource_ref, "expiry": facts["reservation_expiry"],
            "state": states["held"],
        })
        self.effect("system12", "reserve", resource_ref=resource_ref,
                    expected_revisions=self.command["expected_vehicle_person_anchor_revisions"],
                    reservation_expiry=facts["reservation_expiry"])

    def release(self, resource_ref: str, kind: JSON) -> None:
        reservation = self.state.reservation_and_parking.get(resource_ref)
        if reservation:
            reservation = clone(reservation)
            reservation["state"] = kind["operation_policy"]["reservation_states"]["released"]
            self.record("reservation_and_parking", resource_ref, reservation)
        self.effect("system12", "release_reservation", resource_ref=resource_ref)

    def board(self, transit: bool = False) -> None:
        ref = self.action["vehicle_ref"]
        _, operation, kind, config = self.policy(ref)
        self.allowed_mode(kind, operation, "BoardTransit" if transit else "BoardVehicle")
        seat_ref = self.action["seat_ref"]
        seat = self.get("vehicle_seat", seat_ref)
        require(seat["vehicle_id"] == ref, "SEAT_UNAVAILABLE")
        require(seat["anchor_id"] in config["seat_anchors"] + config["standing_anchors"], "SEAT_UNAVAILABLE")
        if transit:
            run = self.get("transit_run", self.action["run_ref"])
            require(run["vehicle_ref"] == ref, "VEHICLE_NOT_PRESENT")
            run_facts = self.query("system13", "boarding_window", run_ref=self.action["run_ref"])
            require(run_facts.get("accepting_at_actual_stop") is True, "NO_SERVICE_UNIT")
            require(run_facts.get("capacity_available") is True, "CAPACITY_EXCEEDED")
            fare = self.query("system14", "fare_entitlement", run_ref=self.action["run_ref"])
            require(fare.get("valid") is True, "TERMS_NOT_ACCEPTED")
            self.effect("system14", "fare", entitlement_receipt_ref=fare["owner_receipt_ref"])
        facts = self.query("system12", "boarding", vehicle_ref=ref, seat_ref=seat_ref)
        for key, code in (("co_located", "VEHICLE_NOT_PRESENT"), ("path_accessible", "NO_CONTROL_ACCESS"),
                          ("compatible", "SEAT_UNAVAILABLE"), ("capacity_available", "CAPACITY_EXCEEDED"),
                          ("encounter_allows", "AUTHORITY_REQUIRED")):
            require(facts.get(key) is True, code)
        self.reserve(seat["anchor_id"], facts, kind)
        self.effect("system12", "board", vehicle_ref=ref, seat_ref=seat_ref,
                    person_ref=self.command["actor_principal_ref"], root_follows_vehicle=True)
        self.interval("boarding")
        if self.action.get("take_driver_role") is True:
            require(operation["driver_ref"] is None, "NO_DRIVER")
            require(seat["role"] == kind["operation_policy"]["driver_role"], "NO_DRIVER")
            require(facts.get("controls_compatible") is True, "NO_CONTROL_ACCESS")
            operation["driver_ref"] = self.command["actor_principal_ref"]
            self.record("vehicle_operation", ref, operation)
            self.event("DriverAssigned", vehicle_ref=ref, driver_ref=operation["driver_ref"])
        self.event("VehicleBoarded", vehicle_ref=ref, seat_ref=seat_ref, actor_ref=self.command["actor_principal_ref"])

    def interval(self, purpose: str, duration: JSON | None = None) -> JSON:
        facts = self.query("system11", purpose, duration=duration)
        require(facts.get("authorized") is True, "OWNER_UNAVAILABLE", "OWNER_PENDING")
        self.effect("system11", "interval", purpose=purpose, duration=duration,
                    interval_ref=facts["interval_ref"], checkpoint_ref=facts["checkpoint_ref"])
        projection = clone(self.state.persistence_and_projections.get(self.branch, {}))
        projection["coherent_clock_checkpoint_ref"] = facts["checkpoint_ref"]
        self.record("persistence_and_projections", self.branch, projection)
        return facts

    def exit(self) -> None:
        ref = self.action["vehicle_ref"]
        _, operation, kind, _ = self.policy(ref)
        require(operation["mode"] in {"PARKED", "STOPPED_ACTIVE", "DISABLED"}, "OPERATION_DISABLED")
        facts = self.query("system12", "exit", vehicle_ref=ref, destination_ref=self.action["destination_anchor"])
        require(facts.get("actual_occupant") is True, "VEHICLE_NOT_PRESENT")
        require(facts.get("reachable_exterior") is True, "NO_CONTROL_ACCESS")
        require(facts.get("encounter_allows") is True)
        self.effect("system12", "exit", person_ref=self.command["actor_principal_ref"],
                    destination_anchor=self.action["destination_anchor"], vehicle_ref=ref)
        self.release(facts["seat_anchor_ref"], kind)
        self.interval("exiting")
        if operation["driver_ref"] == self.command["actor_principal_ref"]:
            operation["driver_ref"] = None
            self.record("vehicle_operation", ref, operation)
        self.event("PassengerExited", vehicle_ref=ref, actor_ref=self.command["actor_principal_ref"],
                   destination_anchor=self.action["destination_anchor"])

    def start(self) -> None:
        ref = self.action["vehicle_ref"]
        vehicle, operation, kind, _ = self.operating(ref)
        self.allowed_mode(kind, operation, "StartTrip")
        trip_ref = self.action["trip_ref"]
        require(trip_ref not in self.state.vehicle_trip, "STALE_REVISION")
        states = kind["operation_policy"]["trip_states"]
        require(not any(t["vehicle_id"] == ref and t["state"] == states["moving"]
                        for t in self.state.vehicle_trip.values()), "OPERATION_DISABLED")
        route = self.query("system12", "route", vehicle_ref=ref, destination=self.action["destination"])
        require(route.get("feasible") is True and route.get("known_route") is True, "ROUTE_BLOCKED")
        if self.command["permission_or_mandate_ref"] is not None:
            mandate = self.get("travel_mandate", self.command["permission_or_mandate_ref"])
            require(set(route["participant_refs"]) == set(mandate["participant_refs"]),
                    "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        access = self.query("system15", "control_access", vehicle_ref=ref)
        require(access.get("physical_access") is True, "NO_CONTROL_ACCESS")
        require(access.get("accepted_or_grounded_violation") is True)
        time = self.interval("preparation")
        operation["power_state"] = kind["operation_policy"]["power_states"]["active"]
        operation["mode"] = "MOVING"
        self.record("vehicle_operation", ref, operation)
        self.record("vehicle_trip", trip_ref, {
            "trip_id": trip_ref, "request_key": self.key, "vehicle_id": ref,
            "route_version": route["route_version"], "current_edge": route["first_edge_ref"],
            "progress_units": exact(0), "intended_destination": self.action["destination"],
            "state": states["moving"], "source_event": self.source,
        })
        self.record("trip_execution", trip_ref, {
            "origin_ref": route["origin_ref"], "accepted_route_ref": route["route_ref"],
            "mandate_ref": self.command["permission_or_mandate_ref"],
            "participant_presence_refs": route["participant_presence_refs"],
            "validated_owner_revisions": self.command["expected_vehicle_person_anchor_revisions"],
            "committed_distance": exact(0), "elapsed_time_ref": time["interval_ref"],
            "next_due_boundary": time["next_due_boundary"], "delay_receipts": [],
            "interruption_ref": None, "progress_receipts": [],
        })
        if route.get("parking_anchor_ref"):
            self.release(route["parking_anchor_ref"], kind)
        self.effect("system12", "depart", vehicle_ref=ref, mobile_place_id=vehicle["mobile_place_id"],
                    origin_ref=route["origin_ref"], edge_ref=route["first_edge_ref"], progress_units=exact(0))
        self.effect("system15", "follow_mobile_root", vehicle_ref=ref)
        self.event("EngineStateChanged", vehicle_ref=ref)
        self.event("TripStarted", vehicle_ref=ref, trip_ref=trip_ref, origin_ref=route["origin_ref"], route_version=route["route_version"])
        self.status = "IN_PROGRESS"

    def change_route(self) -> None:
        trip_ref = self.action["trip_ref"]
        trip = self.get("vehicle_trip", trip_ref)
        require(trip["vehicle_id"] == self.action["vehicle_ref"])
        self.operating(trip["vehicle_id"])
        route = self.query("system12", "reroute", trip=trip)
        require(route.get("connects_at_actual_progress") is True and route.get("known_route") is True, "ROUTE_BLOCKED")
        execution = self.get("trip_execution", trip_ref)
        self.resolve_interruption(execution)
        if self.command["permission_or_mandate_ref"] is not None:
            execution["mandate_ref"] = self.command["permission_or_mandate_ref"]
        if execution["mandate_ref"] is not None:
            mandate = self.get("travel_mandate", execution["mandate_ref"])
            require(route["destination_ref"] == mandate["destination_ref"], "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        trip["route_version"] = route["route_version"]
        trip["intended_destination"] = route["destination_ref"]
        # Changing a proposal cannot alter the already committed edge/progress.
        self.record("vehicle_trip", trip_ref, trip)
        execution["accepted_route_ref"] = route["route_ref"]
        self.record("trip_execution", trip_ref, execution)
        self.status = "IN_PROGRESS"

    def resolve_interruption(self, execution: JSON) -> None:
        if execution["interruption_ref"] is not None:
            require(self.action["command"] in {"StopVehicle", "ChangeRoute"}
                    and self.authorization.get("resolves_interruption_ref") == execution["interruption_ref"],
                    "AUTHORITY_REQUIRED", "CHOICE_REQUIRED")
            execution["interruption_ref"] = None

    def move(self, stopping: bool = False, parking: bool = False) -> None:
        ref, trip_ref = self.action["vehicle_ref"], self.action["trip_ref"]
        vehicle, operation, kind, _ = self.operating(ref)
        trip = self.get("vehicle_trip", trip_ref)
        execution = self.get("trip_execution", trip_ref)
        self.resolve_interruption(execution)
        require(trip["vehicle_id"] == ref)
        if not parking:
            require(operation["mode"] == "MOVING", "OPERATION_DISABLED")
        route = self.query("system12", "traversal", trip=trip, stopping=stopping, parking=parking)
        require(route.get("edge_accessible") is True, "ROUTE_BLOCKED")
        require(route.get("current_edge_ref") == trip["current_edge"], "STALE_REVISION")
        require(rational(route["current_progress"]) == rational(trip["progress_units"]), "STALE_REVISION")
        traffic = self.query("world", "traffic", edge_ref=trip["current_edge"])
        require(traffic.get("causal_source_ref") is not None, "ROUTE_BLOCKED")
        time = self.query("system11", "travel_boundary", trip_ref=trip_ref)
        require(time.get("authorized") is True, "OWNER_UNAVAILABLE", "OWNER_PENDING")
        duration = positive(time["maximum_duration"])
        speed = min(positive(route["speed_limit"]), positive(traffic["speed_limit"]))
        condition = self.get("condition_and_maintenance", operation["condition_ref"])
        for component, state in condition["component_states"].items():
            limits = kind["component_policy"].get("speed_limits", {}).get(component, {})
            if isinstance(state, str) and state in limits:
                speed = min(speed, positive(limits[state]))
        if traffic.get("capacity_available") is not True:
            speed = Fraction(0)
        remaining = positive(route["remaining_distance"])
        if speed > 0:
            duration = min(duration, remaining / speed)
        resource = operation["resource_state"]
        policy = kind["resource_policy"]
        require(policy["model"] == "linear_distance_idle", "OPERATION_DISABLED")
        require(resource["consumption_policy_version"] == policy["version_ref"], "OPERATION_DISABLED")
        distance_rate, idle_rate = positive(policy["distance_rate"]), positive(policy["idle_rate"])
        require(policy["load_policy"] in {"disabled", "linear"}, "OPERATION_DISABLED")
        if policy["load_policy"] == "linear":
            load = self.query("system15", "operational_load", vehicle_ref=ref)
            require(load.get("authoritative_containment") is True and load.get("no_double_counting") is True)
            require(load["unit"] == policy["load_unit"])
            amount = positive(load["quantity"])
            distance_rate += amount * positive(policy["load_distance_rate"])
            idle_rate += amount * positive(policy["load_idle_rate"])
        available = Fraction(resource["quantity_units"]) - rational(resource["fractional_remainder"])
        rate = speed * distance_rate + idle_rate
        resource_limit = None
        if execution["mandate_ref"] is not None:
            mandate = self.get("travel_mandate", execution["mandate_ref"])
            require(self.authorization.get("travel_mandate_valid") is True,
                    "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            require(set(route["participant_refs"]) == set(mandate["participant_refs"]),
                    "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            consumed = sum((rational(event["quantity"]) for event in self.history
                            if event.get("event") == "ResourceConsumed" and event.get("trip_ref") == trip_ref), Fraction(0))
            cap = mandate["resource_cap"]
            require(cap["unit"] == resource["unit"])
            resource_limit = positive(cap["quantity"]) - consumed
            require(resource_limit > 0, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        if rate > 0:
            duration = min(duration, available / rate)
            if resource_limit is not None:
                duration = min(duration, resource_limit / rate)
        distance = speed * duration
        used = distance * distance_rate + duration * idle_rate
        residue = rational(resource["fractional_remainder"]) + used
        whole = residue.numerator // residue.denominator
        resource["quantity_units"] -= whole
        resource["fractional_remainder"] = exact(residue - whole)
        resource["consumption_receipts"].append(self.source)
        trip["progress_units"] = exact(rational(trip["progress_units"]) + distance)
        execution["committed_distance"] = exact(rational(execution["committed_distance"]) + distance)
        reached = distance == remaining
        depleted = rate > 0 and available == used
        destination_reached = reached and route.get("destination_approach") is True
        target_reached = reached and (stopping or parking)
        if target_reached:
            require(route.get("target_anchor_ref") == self.action["destination_anchor"], "ROUTE_BLOCKED")
            require(route.get("reachable_stopping_anchor") is True, "ROUTE_BLOCKED")
        actual_time = self.interval("travel_commit", exact(duration))
        execution["elapsed_time_ref"] = actual_time["interval_ref"]
        execution["next_due_boundary"] = actual_time["next_due_boundary"]
        execution["progress_receipts"].append(self.source)
        if speed == 0 and duration > 0:
            execution["delay_receipts"].append(self.source)
            self.event("TrafficDelayApplied", vehicle_ref=ref)
        if reached and not destination_reached and not target_reached:
            trip["current_edge"] = route["next_edge_ref"]
            trip["progress_units"] = exact(0)
        if destination_reached or target_reached:
            operation["mode"] = "STOPPED_ACTIVE"
            trip["state"] = kind["operation_policy"]["trip_states"]["arrived" if destination_reached else "stopped"]
            self.status = "ARRIVED" if destination_reached else "COMMITTED"
            self.event("VehicleStopped", vehicle_ref=ref)
        else:
            self.status = "IN_PROGRESS"
        if depleted:
            operation["mode"] = "DISABLED"
            if not destination_reached and not target_reached:
                trip["state"] = kind["operation_policy"]["trip_states"]["interrupted"]
                self.status, self.failure = "PARTIAL", "RESOURCE_INSUFFICIENT"
        if time.get("choice_boundary_ref") is not None and duration == positive(time["maximum_duration"]):
            execution["interruption_ref"] = time["choice_boundary_ref"]
            self.status = "CHOICE_REQUIRED"
        if resource_limit is not None and used == resource_limit:
            execution["interruption_ref"] = execution["mandate_ref"]
            self.status = "CHOICE_REQUIRED"
        self.record("vehicle_operation", ref, operation)
        self.record("vehicle_trip", trip_ref, trip)
        self.record("trip_execution", trip_ref, execution)
        self.effect("system12", "move_root", vehicle_ref=ref, mobile_place_id=vehicle["mobile_place_id"],
                    edge_ref=trip["current_edge"], progress_units=trip["progress_units"],
                    distance=exact(distance), duration=exact(duration),
                    anchor_ref=route.get("target_anchor_ref") if target_reached else route.get("approach_anchor_ref") if destination_reached else None,
                    person_dependencies_follow_root=True)
        self.effect("system15", "follow_mobile_root", vehicle_ref=ref, cargo_ancestry_preserved=True)
        self.event("RouteProgressed", vehicle_ref=ref, trip_ref=trip_ref, current_edge=trip["current_edge"],
                   progress_units=trip["progress_units"], distance=exact(distance), duration=exact(duration))
        self.event("ResourceConsumed", vehicle_ref=ref, trip_ref=trip_ref, quantity=exact(used))
        if parking and target_reached:
            self.finish_parking(ref, kind, route)

    def park(self) -> None:
        ref = self.action["vehicle_ref"]
        _, operation, kind, _ = self.policy(ref)
        self.allowed_mode(kind, operation, "ParkVehicle")
        facts = self.query("system12", "parking", vehicle_ref=ref, anchor_ref=self.action["destination_anchor"])
        require(facts.get("space_available") is True, "PARKING_UNAVAILABLE")
        require(facts.get("form_and_access_supported") is True, "PARKING_UNAVAILABLE")
        require(self.authorization.get("terms_accepted") is True, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        self.reserve(self.action["destination_anchor"], facts, kind)
        if facts.get("already_at_parking_anchor") is True:
            require(operation["mode"] != "MOVING", "OPERATION_DISABLED")
            self.interval("parking")
            self.finish_parking(ref, kind, facts)
        else:
            self.move(parking=True)

    def finish_parking(self, ref: str, kind: JSON, facts: JSON) -> None:
        operation = self.get("vehicle_operation", ref)
        operation["mode"] = "PARKED"
        self.record("vehicle_operation", ref, operation)
        anchor = self.action["destination_anchor"]
        reservation = self.get("reservation_and_parking", anchor)
        reservation.update(parking_anchor_ref=anchor, parking_occupancy_ref=facts["parking_occupancy_ref"],
                           placement_receipt_ref=facts["owner_receipt_ref"],
                           accepted_fee_terms_ref=self.authorization["accepted_terms_ref"])
        self.record("reservation_and_parking", anchor, reservation)
        self.effect("system12", "park", vehicle_ref=ref, anchor_ref=anchor,
                    preserve_occupants=True, preserve_closures=True)
        self.effect("system14", "parking_terms", vehicle_ref=ref,
                    accepted_terms_ref=self.authorization["accepted_terms_ref"])
        self.event("VehicleParked", vehicle_ref=ref, parking_anchor_ref=anchor)

    def request_service(self, service_kind: str) -> None:
        channel = self.query("system16", "service_channel", service_kind=service_kind)
        require(channel.get("reachable") is True, "NO_SERVICE_UNIT")
        facts = self.query("system13", "service_offer", service_kind=service_kind)
        for field in ("actual_unit", "actual_worker", "schedule_feasible", "capacity_available"):
            require(facts.get(field) is True, "NO_SERVICE_UNIT")
        require(self.authorization.get("terms_accepted") is True, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        service = clone(facts["transport_service"])
        require(service["vehicle_id"] in self.state.vehicle_instance, "NO_SERVICE_UNIT")
        ref = self.action["vehicle_ref"] if service_kind == "tow" else service["vehicle_id"]
        _, _, kind, _ = self.policy(ref)
        service_ref = service["service_id"]
        require(service_ref not in self.state.transport_service, "STALE_REVISION")
        workflow = kind["operation_policy"]["workflows"][service_kind]
        require(not any(s["vehicle_id"] == service["vehicle_id"] and s["state"] not in workflow["terminal_states"]
                        for s in self.state.transport_service.values()), "NO_SERVICE_UNIT")
        service["state"] = workflow["initial"]
        self.record("transport_service", service_ref, service)
        companion = "taxi_request" if service_kind == "taxi" else "tow_and_impound"
        record = clone(facts[companion])
        if service_kind == "taxi":
            require(record["pickup_ref"] == self.action["pickup_ref"])
            require(record["destination_ref"] == self.action["destination_ref"])
            require(record["passenger_count"] == integer(self.action["passenger_count"], 1))
            require(record["assigned_service_ref"] == service_ref)
        else:
            require(record["target_vehicle_ref"] == ref)
            require(record["carrier_vehicle_ref"] == service["vehicle_id"])
        self.record(companion, service["run_or_order_id"], record)
        if service_kind == "taxi" and not self.action.get("vehicle_ref"):
            self.record("vehicle_instance", ref, self.get("vehicle_instance", ref))
        self.effect("system13", "accept_service", service_ref=service_ref, terms_version=service["terms_version"])
        self.effect("system16", "dispatch_request", service_ref=service_ref,
                    communication_receipt_ref=channel["owner_receipt_ref"])
        self.effect("system14", "accept_service_terms", service_ref=service_ref,
                    terms_ref=self.authorization["accepted_terms_ref"])
        self.status = "ACCEPTED"

    def authorize_repair(self) -> None:
        order_ref = self.action["order_ref"]
        facts = self.query("system13", "repair_authorization", order_ref=order_ref)
        order = self.get("repair_work_order", order_ref) if order_ref in self.state.repair_work_order else clone(facts["repair_work_order"])
        require(order["vehicle_ref"] == self.action["vehicle_ref"])
        require(facts.get("shop_and_worker_available") is True, "NO_SERVICE_UNIT")
        require(facts.get("scope_matches_quote") is True, "TERMS_NOT_ACCEPTED")
        require(self.authorization.get("terms_accepted") is True, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        cap = integer(self.action["cost_cap"])
        require(integer(facts["quoted_amount"]) <= cap, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        order["requested_scope"], order["authorized_cost_cap"] = clone(self.action["scope"]), cap
        order["quote_ref"] = facts["quote_ref"]
        order["parts_authorization_ref"] = facts["parts_authorization_ref"]
        _, _, kind, _ = self.policy(order["vehicle_ref"])
        order["state"] = kind["operation_policy"]["workflows"]["repair"]["authorized"]
        self.record("repair_work_order", order_ref, order)
        self.effect("system13", "authorize_repair", order_ref=order_ref, scope=order["requested_scope"], cost_cap=cap)
        self.status = "ACCEPTED"

    def outcome(self) -> None:
        event_kind = self.action["event_kind"]
        owner = {
            "RouteInterval": "system11", "ServiceProgress": "system13", "RepairCompleted": "system13",
            "ComponentDamaged": "encounter", "Refuel": "system15", "ResourceLost": "system15",
            "StorageTransfer": "system15", "SearchResolved": "system15", "TowLoaded": "system13",
            "ImpoundArrived": "system13", "VehicleReleased": "institutions", "StopSignal": "encounter",
            "ChaseUpdated": "encounter", "IdentificationChanged": "system15", "EvidenceAssociated": "institutions",
            "EncounterResolved": "encounter", "OpportunityResolved": "system10", "TransitStopCall": "system13",
        }.get(event_kind)
        require(owner is not None)
        facts = self.query(owner, "source_event", source_event_ref=self.action["source_event_ref"])
        require(facts.get("validated") is True)
        require(facts.get("event_kind") == event_kind and facts.get("source_event_ref") == self.action["source_event_ref"])
        require(facts.get("vehicle_ref") == self.action["vehicle_ref"])
        self.source = facts["source_event_ref"]
        if event_kind == "RouteInterval":
            self.move()
        elif event_kind == "ServiceProgress":
            self.service_progress(facts)
        elif event_kind in {"ComponentDamaged", "RepairCompleted"}:
            self.condition_outcome(facts, event_kind == "RepairCompleted")
        elif event_kind in {"Refuel", "ResourceLost"}:
            self.resource_transfer(facts, event_kind == "Refuel")
        elif event_kind in {"TowLoaded", "ImpoundArrived", "VehicleReleased"}:
            self.tow_outcome(facts, event_kind)
        elif event_kind == "StorageTransfer":
            require(facts.get("actual_access") is True and facts.get("capacity_valid") is True)
            require(facts.get("actual_transfer") is True)
            self.effect("system15", "storage_transfer", owner_receipt_ref=facts["owner_receipt_ref"])
            self.interval("storage_transfer")
        elif event_kind == "SearchResolved":
            self.search(facts)
        elif event_kind == "StopSignal":
            require(facts.get("actual_unit_and_perception") is True)
            for trip_ref, trip in self.state.vehicle_trip.items():
                if trip["vehicle_id"] == self.action["vehicle_ref"]:
                    execution = self.get("trip_execution", trip_ref)
                    execution["interruption_ref"] = self.source
                    self.record("trip_execution", trip_ref, execution)
            self.status = "CHOICE_REQUIRED"
            self.event("StopSignalPerceived", vehicle_ref=self.action["vehicle_ref"])
        elif event_kind == "ChaseUpdated":
            self.chase(facts)
        elif event_kind == "IdentificationChanged":
            require(facts.get("actual_object_transition") is True)
            record = facts["vehicle_identification"]
            require(record["vehicle_id"] == self.action["vehicle_ref"])
            self.record("vehicle_identification", facts["identification_ref"], record)
            self.effect("system15", "identification_transition", receipt_ref=facts["owner_receipt_ref"])
        elif event_kind == "EvidenceAssociated":
            record = facts["observation_and_evidence_links"]
            require(facts.get("supported_coverage") is True)
            self.record("observation_and_evidence_links", facts["evidence_ref"], record)
            self.effect("institutions", "associate_evidence", receipt_ref=facts["owner_receipt_ref"])
        elif event_kind == "TransitStopCall":
            run = self.get("transit_run", facts["run_ref"])
            require(run["vehicle_ref"] == self.action["vehicle_ref"])
            require(facts.get("actual_arrival") is True)
            placement = self.query("system12", "transit_stop", run_ref=facts["run_ref"])
            require(placement.get("at_actual_stop") is True, "VEHICLE_NOT_PRESENT")
            run["current_stop_or_edge_ref"] = facts["stop_ref"]
            run["actual_stop_call_receipts"].append(facts["owner_receipt_ref"])
            run["boarding_state"] = facts["boarding_state"]
            self.record("transit_run", facts["run_ref"], run)
        elif event_kind == "OpportunityResolved":
            require(facts.get("meaningful_uncertainty") is True)
            self.effect("system10", "retain_opportunity", opportunity_ref=facts["opportunity_ref"],
                        outcome_receipt_ref=facts["owner_receipt_ref"])
            self.event("OpportunityResolved", opportunity_ref=facts["opportunity_ref"])
        else:
            # A generic encounter receipt cannot move roots or settle money.
            require(facts.get("physical_effects") == [])
            if facts.get("clears_interruption_ref") is not None:
                execution = self.get("trip_execution", facts["trip_ref"])
                trip = self.get("vehicle_trip", facts["trip_ref"])
                require(trip["vehicle_id"] == self.action["vehicle_ref"])
                require(execution["interruption_ref"] == facts["clears_interruption_ref"])
                require(facts.get("explicit_driver_response") is True)
                require(self.authorization.get("resolves_interruption_ref") == execution["interruption_ref"])
                execution["interruption_ref"] = None
                self.record("trip_execution", facts["trip_ref"], execution)
            self.event("EncounterResolved", owner_receipt_ref=facts["owner_receipt_ref"])

    def service_progress(self, facts: JSON) -> None:
        service_ref = facts["service_ref"]
        service = self.get("transport_service", service_ref)
        require(service["vehicle_id"] == self.action["vehicle_ref"] or facts.get("target_vehicle_ref") == self.action["vehicle_ref"])
        _, _, kind, _ = self.policy(self.action["vehicle_ref"])
        workflow = kind["operation_policy"]["workflows"][facts["service_kind"]]
        transition = workflow["transitions"][facts["transition"]]
        require(service["state"] == transition["from"], "STALE_REVISION")
        require(facts.get("worker_and_unit_unchanged") is True, "NO_SERVICE_UNIT")
        for requirement in transition["requirements"]:
            require(facts["requirements"].get(requirement) is True, "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
        # Mandatory physical boundaries cannot be weakened by authored workflow.
        stage = facts["stage"]
        require(stage == transition["stage"])
        require(stage in {"assign", "approach", "pickup", "ride", "dropoff", "yard", "collect", "settlement", "inspect", "quote", "perform", "release", "wait"})
        if stage in {"pickup", "dropoff", "yard", "collect"}:
            spatial = self.query("system12", "service_presence", service_ref=service_ref)
            require(spatial.get("at_actual_stage_anchor") is True, "VEHICLE_NOT_PRESENT")
        if stage in {"pickup", "ride", "dropoff"}:
            require(facts.get("actual_boarding_or_exit_receipts") is True)
        if stage == "approach":
            require(facts.get("actual_trip_ref") in self.state.vehicle_trip, "ROUTE_BLOCKED")
            require(self.state.vehicle_trip[facts["actual_trip_ref"]]["vehicle_id"] == service["vehicle_id"], "ROUTE_BLOCKED")
        if stage == "settlement":
            money = self.query("system14", "settlement", service_ref=service_ref)
            require(money.get("terms_valid") is True, "TERMS_NOT_ACCEPTED")
            self.effect("system14", "settle_service", service_ref=service_ref,
                        receipt_ref=money["owner_receipt_ref"], terms_version=service["terms_version"])
            if money.get("settled") is not True:
                self.status = "CHOICE_REQUIRED"
        if facts["service_kind"] == "taxi":
            taxi = self.get("taxi_request", service["run_or_order_id"])
            taxi["fulfillment_state"] = transition["to"]
            if stage == "approach":
                taxi["approach_trip_ref"] = facts["actual_trip_ref"]
            if stage == "ride":
                require(facts.get("actual_trip_ref") in self.state.vehicle_trip, "ROUTE_BLOCKED")
                require(self.state.vehicle_trip[facts["actual_trip_ref"]]["vehicle_id"] == service["vehicle_id"], "ROUTE_BLOCKED")
                taxi["passenger_trip_ref"] = facts["actual_trip_ref"]
            if stage == "settlement":
                taxi["settlement_ref"] = money["owner_receipt_ref"]
            self.record("taxi_request", service["run_or_order_id"], taxi)
        service["state"] = transition["to"]
        self.record("transport_service", service_ref, service)
        self.effect("system13", "service_progress", service_ref=service_ref, transition=facts["transition"])

    def condition_outcome(self, facts: JSON, repair: bool) -> None:
        ref = self.action["vehicle_ref"]
        _, operation, kind, _ = self.policy(ref)
        condition = self.get("condition_and_maintenance", operation["condition_ref"])
        require(facts.get("actual_cause") is True)
        changes = facts["component_changes"]
        require(set(changes) <= set(condition["component_states"]))
        for component, value in changes.items():
            require(value in kind["component_policy"]["allowed_states"][component], "OPERATION_DISABLED")
        if repair:
            order = self.get("repair_work_order", facts["order_ref"])
            require(order["vehicle_ref"] == ref)
            for flag in ("authorized_scope", "actual_parts", "certified_labor", "accepted_output"):
                require(facts.get(flag) is True, "TERMS_NOT_ACCEPTED")
            require(integer(facts["actual_cost"]) <= integer(order["authorized_cost_cap"]),
                    "TERMS_NOT_ACCEPTED", "CHOICE_REQUIRED")
            require(set(changes) <= set(order["requested_scope"]["component_refs"]))
            order["condition_output_receipts"].append(facts["owner_receipt_ref"])
            order["state"] = kind["operation_policy"]["workflows"]["repair"]["completed"]
            self.record("repair_work_order", facts["order_ref"], order)
            condition["replacement_lineage_refs"].extend(facts["replacement_lineage_refs"])
            self.effect("system15", "component_lineage", lineage_refs=facts["replacement_lineage_refs"])
        else:
            condition["damage_causes"].append(self.source)
            condition["damage_severity_and_exposure"] = clone(facts["severity_and_exposure"])
            self.effect("system15", "cargo_exposure", receipt_ref=facts["owner_receipt_ref"])
            self.effect("health", "occupant_exposure", receipt_ref=facts["owner_receipt_ref"])
        condition["component_states"].update(changes)
        disabled_rules = kind["component_policy"]["disabled_states"]
        disabled = any(value in disabled_rules[component] for component, value in condition["component_states"].items())
        if disabled:
            operation["mode"] = "DISABLED"
            self.record("vehicle_operation", ref, operation)
        # Repair does not start the engine or choose a route, even if feasible.
        self.record("condition_and_maintenance", operation["condition_ref"], condition)
        self.effect("system12", "component_constraints", vehicle_ref=ref, component_changes=changes,
                    source_receipt_ref=facts["owner_receipt_ref"])
        self.event("RepairCompleted" if repair else "ComponentDamaged", vehicle_ref=ref)

    def resource_transfer(self, facts: JSON, refuel: bool) -> None:
        ref = self.action["vehicle_ref"]
        _, operation, _, _ = self.policy(ref)
        require(facts.get("actual_transfer_or_loss") is True)
        resource = operation["resource_state"]
        require(facts["resource_kind"] == resource["resource_kind"] and facts["unit"] == resource["unit"])
        quantity = integer(facts["quantity_units"])
        if refuel:
            require(facts.get("supply_exists") is True and facts.get("compatible") is True)
            require(resource["quantity_units"] + quantity <= resource["capacity_units"], "CAPACITY_EXCEEDED")
            require(self.authorization.get("terms_accepted") is True, "TERMS_NOT_ACCEPTED")
            resource["quantity_units"] += quantity
            self.effect("system14", "fuel_terms", receipt_ref=facts["accepted_terms_ref"])
        else:
            require(Fraction(resource["quantity_units"] - quantity) >= rational(resource["fractional_remainder"]), "RESOURCE_INSUFFICIENT")
            resource["quantity_units"] -= quantity
        resource["transfer_or_loss_receipts"].append(facts["owner_receipt_ref"])
        self.record("vehicle_operation", ref, operation)
        self.effect("system15", "resource_transfer", receipt_ref=facts["owner_receipt_ref"])
        self.interval("resource_transfer")

    def tow_outcome(self, facts: JSON, event_kind: str) -> None:
        tow_ref = facts["tow_ref"]
        tow = self.get("tow_and_impound", tow_ref)
        ref = tow["target_vehicle_ref"]
        require(ref == self.action["vehicle_ref"])
        _, operation, kind, _ = self.policy(ref)
        spatial = self.query("system12", "tow_stage", tow_ref=tow_ref)
        require(spatial.get("at_actual_stage_anchor") is True, "VEHICLE_NOT_PRESENT")
        if event_kind == "TowLoaded":
            require(tow["carrier_vehicle_ref"] in self.state.vehicle_instance, "NO_SERVICE_UNIT")
            for flag in ("actual_worker", "attachment_feasible", "capacity_valid", "occupants_handled"):
                require(facts.get(flag) is True, "CAPACITY_EXCEEDED")
            tow["carrier_relation_ref"] = facts["carrier_relation_ref"]
            tow["occupant_handling_receipts"] = facts["occupant_handling_receipts"]
            require(spatial.get("remaining_driver_ref") in {None, operation["driver_ref"]})
            require("remaining_driver_ref" in spatial)
            operation["driver_ref"] = spatial["remaining_driver_ref"]
            operation["mode"] = "TOWED"
            self.effect("system12", "attach_carrier", target_ref=ref, carrier_ref=tow["carrier_vehicle_ref"],
                        relation_ref=tow["carrier_relation_ref"])
            self.effect("system15", "follow_mobile_root", vehicle_ref=ref)
        elif event_kind == "ImpoundArrived":
            require(operation["mode"] == "TOWED" and facts.get("actual_transport_completed") is True)
            tow["yard_anchor_ref"], tow["custody_ref"] = facts["yard_anchor_ref"], facts["custody_ref"]
            tow["carrier_relation_ref"] = None
            operation["mode"] = "SERVICE_CONTROLLED"
            self.effect("system12", "detach_at_yard", vehicle_ref=ref, anchor_ref=tow["yard_anchor_ref"])
            self.effect("system15", "follow_mobile_root", vehicle_ref=ref)
        else:
            require(facts.get("release_authorized") is True)
            tow["release_authority_ref"] = facts["owner_receipt_ref"]
            if facts.get("actual_retrieval") is True:
                require(facts.get("accepted_release_terms") is True, "TERMS_NOT_ACCEPTED")
                tow["retrieval_receipt_ref"] = facts["retrieval_receipt_ref"]
                operation["mode"] = "PARKED"
                self.effect("institutions", "release_custody", vehicle_ref=ref, receipt_ref=facts["owner_receipt_ref"])
            # Approval alone changes no placement or custody.
        tow["state"] = kind["operation_policy"]["workflows"]["tow"][event_kind]
        self.record("tow_and_impound", tow_ref, tow)
        self.record("vehicle_operation", ref, operation)
        self.event(event_kind, vehicle_ref=ref)

    def search(self, facts: JSON) -> None:
        search = facts["search_context"]
        require(facts.get("scope_valid") is True and facts.get("actual_access") is True)
        require(facts.get("actual_coverage") is True)
        require(facts.get("unchanged_opportunity_reused") is True)
        require(set(search["target_scope_refs"]) <= set(facts["authorized_scope_refs"]))
        require(set(facts["observed_scope_refs"]) <= set(search["target_scope_refs"]))
        if facts.get("found") is not True:
            require(search["collection_and_custody_receipts"] == [])
        if facts.get("hidden_search") is True:
            result = self.query("system10", "opportunity", opportunity_ref=search["opportunity_ref"])
            require(result.get("persisted") is True and result.get("meaningful") is True)
        self.record("search_context", facts["search_ref"], search)
        self.effect("system15", "search_result", receipt_ref=facts["owner_receipt_ref"],
                    scope_refs=search["target_scope_refs"], custody_receipts=search["collection_and_custody_receipts"])
        self.effect("system3", "observations", observation_refs=search["observation_refs"])
        self.interval("search")

    def chase(self, facts: JSON) -> None:
        chase = facts["chase_context"]
        require(facts.get("grounded_participants") is True and facts.get("observation_limited") is True)
        require(facts.get("no_material_relocation") is True)
        for ref in [chase["target_vehicle_ref"], *chase["pursuer_vehicle_refs"]]:
            require(ref in self.state.vehicle_instance, "NO_SERVICE_UNIT")
        if facts.get("contact_lost") is True:
            require(chase["line_of_sight_observation_refs"] == [])
        self.record("chase_context", chase["encounter_ref"], chase)
        self.effect("encounter", "chase_facts", encounter_ref=chase["encounter_ref"],
                    last_known_observation_refs=chase["last_known_observation_refs"],
                    observation_refs=chase["line_of_sight_observation_refs"])

    def evaluate(self) -> tuple[JSON, dict[str, list[JSON]], Response]:
        self.authorize()
        if self.action["command"] in {"StartTrip", "ChangeRoute", "StopVehicle", "ParkVehicle"}:
            operation = self.get("vehicle_operation", self.action["vehicle_ref"])
            require(operation["driver_ref"] == self.command["actor_principal_ref"], "NO_DRIVER")
        handlers = {
            "BoardVehicle": self.board, "ExitVehicle": self.exit, "StartTrip": self.start,
            "ChangeRoute": self.change_route, "StopVehicle": lambda: self.move(stopping=True),
            "ParkVehicle": self.park, "RequestTaxi": lambda: self.request_service("taxi"),
            "BoardTransit": lambda: self.board(transit=True), "AuthorizeRepair": self.authorize_repair,
            "RequestTow": lambda: self.request_service("tow"), "ApplyEncounterOutcome": self.outcome,
        }
        handlers[self.action["command"]]()
        ref = self.action.get("vehicle_ref")
        if ref:
            self.record("vehicle_instance", ref, self.get("vehicle_instance", ref))
        # Outward facts are filtered by their black-box owners, never by prose.
        view = self.query("ui", "project", events=self.events, response_status=self.status, failure_code=self.failure)
        require(view.get("filtered") is True)
        self.effect("system3", "publish_observation_candidates", events=self.events)
        self.effect("ui", "publish", actor_known_vehicle_view=view["actor_known_vehicle_view"])
        recovery_ref = self.authorization.get("recovery_policy_ref")
        if ref:
            _, _, kind, _ = self.policy(ref)
            recovery = kind["operation_policy"]["recovery_policy"]
            require(recovery["before_decision"] == "ABORT", "OPERATION_DISABLED")
            recovery_ref = recovery["ref"]
        require(isinstance(recovery_ref, str), "OPERATION_DISABLED")
        self.record("receipt_and_coordination", self.key, {
            "trip_initiation_key": self.key, "segment_key": self.source,
            "resource_consumption_key": self.source, "service_charge_key": self.source,
            "owner_handoff_key": self.source, "source_event_ref": self.source,
            "participant_owner_refs": sorted(self.owners), "prepare_receipt_refs": [],
            "durable_decision": "UNDECIDED", "owner_completion_receipts": [],
            "recovery_policy_ref": recovery_ref, "response_status": self.status,
            "failure_code": self.failure,
        })
        self.state.validate(self.branch)
        visible_failure = self.failure if self.failure in self.authorization.get("known_failure_codes", []) else None
        response: Response = {"response_status": self.status, "failure_code": self.failure,
                              "source_event_ref": self.source,
                              "actor_known_vehicle_view": view["actor_known_vehicle_view"]}
        response["failure_code"] = visible_failure
        return self.state.to_json(), self.owners, response


class VehicleSystem:
    """Durable typed-JSON state machine. Use one database for contested resources.

    seed() is only for trusted initial fixtures on an empty branch. handle() is
    the material command entry point. snapshot() refuses incoherent pending
    decisions. Reopen the same database and call recover() after a crash.
    """

    def __init__(self, database: str | Path, dependencies: MockDependencies | None = None):
        self.dependencies = dependencies or MockDependencies()
        self._mutex = threading.RLock()
        self._db = sqlite3.connect(str(database), timeout=30, isolation_level=None, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS vehicle_state (
                branch_id TEXT PRIMARY KEY, document TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS vehicle_journal (
                branch_id TEXT NOT NULL, request_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL, command TEXT NOT NULL,
                decision TEXT NOT NULL, next_state TEXT NOT NULL,
                effects TEXT NOT NULL, response TEXT NOT NULL,
                prepare_receipts TEXT NOT NULL, completion_receipts TEXT NOT NULL,
                PRIMARY KEY(branch_id, request_id)
            );
            CREATE TABLE IF NOT EXISTS vehicle_dedup (
                branch_id TEXT NOT NULL, source_event_ref TEXT NOT NULL,
                request_id TEXT NOT NULL,
                PRIMARY KEY(branch_id, source_event_ref)
            );
        """)

    def close(self) -> None:
        with self._mutex:
            self._db.close()

    def seed(self, branch_id: str, state: VehicleState) -> None:
        with self._mutex:
            state.validate(branch_id)
            self._db.execute("INSERT INTO vehicle_state VALUES (?, ?)", (branch_id, encode(state.to_json())))

    def snapshot(self, branch_id: str) -> JSON:
        with self._mutex:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                require(self._pending(branch_id) is None, "OWNER_UNAVAILABLE", "OWNER_PENDING")
                row = self._db.execute("SELECT document FROM vehicle_state WHERE branch_id=?", (branch_id,)).fetchone()
                require(row is not None, "OWNER_UNAVAILABLE", "OWNER_PENDING")
                return json.loads(row["document"])
            finally:
                self._db.execute("ROLLBACK")

    def _pending(self, branch: str) -> sqlite3.Row | None:
        return self._db.execute("SELECT * FROM vehicle_journal WHERE branch_id=? AND decision IN ('UNDECIDED','COMMIT','ABORT') ORDER BY request_id LIMIT 1", (branch,)).fetchone()

    @staticmethod
    def _failure(command: JSON, failure: Gate) -> Response:
        # No secret-dependent detail is emitted by the default failure renderer.
        command = command if isinstance(command, dict) else {}
        return {"response_status": failure.status, "failure_code": failure.code,
                "source_event_ref": f"{command.get('branch_id', '')}/vehicle-event/{command.get('request_id', '')}",
                "actor_known_vehicle_view": {}}

    def handle(self, command: Command) -> Response:
        with self._mutex:
            transition = None
            try:
                command = clone(command)
                require(isinstance(command, dict))
                require(set(command) == set(Command.__annotations__))
                for field in ("branch_id", "request_id", "actor_principal_ref"):
                    require(isinstance(command[field], str) and bool(command[field]))
                require(isinstance(command["intention"], dict) and command["intention"].get("command") in COMMANDS)
                require(isinstance(command["owner_context"], dict))
                require(command["permission_or_mandate_ref"] is None or isinstance(command["permission_or_mandate_ref"], str))
                if command["intention"]["command"] == "ApplyEncounterOutcome":
                    require(isinstance(command["intention"].get("source_event_ref"), str)
                            and bool(command["intention"]["source_event_ref"]))
                require(isinstance(command["expected_vehicle_person_anchor_revisions"], dict))
                for revision in command["expected_vehicle_person_anchor_revisions"].values():
                    integer(revision)
                fingerprint = hashlib.sha256(encode(command).encode()).hexdigest()
                self._db.execute("BEGIN IMMEDIATE")
                existing = self._db.execute("SELECT * FROM vehicle_journal WHERE branch_id=? AND request_id=?",
                                            (command["branch_id"], command["request_id"])).fetchone()
                if existing:
                    require(existing["fingerprint"] == fingerprint, "STALE_REVISION")
                    self._db.execute("ROLLBACK")
                    return self._finish(command["branch_id"], command["request_id"])
                if self._pending(command["branch_id"]) is not None:
                    raise Gate("OWNER_UNAVAILABLE", "OWNER_PENDING")
                source = command["intention"].get("source_event_ref")
                if source:
                    original = self._db.execute("SELECT j.* FROM vehicle_dedup d JOIN vehicle_journal j USING(branch_id,request_id) WHERE d.branch_id=? AND d.source_event_ref=?",
                                                (command["branch_id"], source)).fetchone()
                    if original:
                        require(json.loads(original["command"])["actor_principal_ref"] == command["actor_principal_ref"])
                        self._db.execute("ROLLBACK")
                        return json.loads(original["response"])
                row = self._db.execute("SELECT document FROM vehicle_state WHERE branch_id=?", (command["branch_id"],)).fetchone()
                require(row is not None, "OWNER_UNAVAILABLE", "OWNER_PENDING")
                history = []
                for entry in self._db.execute("SELECT effects FROM vehicle_journal WHERE branch_id=? AND decision='DONE'", (command["branch_id"],)):
                    for effect in json.loads(entry["effects"]).get("system3", []):
                        if effect["operation"] == "publish_observation_candidates":
                            history.extend(effect["payload"]["events"])
                transition = _Transition(VehicleState(json.loads(row["document"])), command, self.dependencies, history)
                next_state, effects, response = transition.evaluate()
                self._db.execute("INSERT INTO vehicle_journal VALUES (?,?,?,?,?,?,?,?,?,?)", (
                    command["branch_id"], command["request_id"], fingerprint, encode(command), "UNDECIDED",
                    encode(next_state), encode(effects), encode(response), "{}", "{}"))
                if source:
                    self._db.execute("INSERT INTO vehicle_dedup VALUES (?,?,?)", (command["branch_id"], source, command["request_id"]))
                self._db.execute("COMMIT")
                return self._finish(command["branch_id"], command["request_id"], preparing=True)
            except Gate as error:
                if self._db.in_transaction:
                    self._db.execute("ROLLBACK")
                result = self._failure(command, error)
                if transition is not None and error.code not in {"OWNER_UNAVAILABLE", "STALE_REVISION", "AUTHORITY_REQUIRED"}:
                    if error.code not in transition.authorization.get("known_failure_codes", []):
                        result["failure_code"] = None
                if error.status in {"REJECTED", "CHOICE_REQUIRED"} and "fingerprint" in locals():
                    self._remember_rejection(command, fingerprint, result)
                return result
            except (KeyError, TypeError, ValueError, ZeroDivisionError) as error:
                if self._db.in_transaction:
                    self._db.execute("ROLLBACK")
                return self._failure(command, Gate("OPERATION_DISABLED"))
            except sqlite3.Error:
                if self._db.in_transaction:
                    self._db.execute("ROLLBACK")
                return self._failure(command, Gate("OWNER_UNAVAILABLE", "OWNER_PENDING"))

    def _remember_rejection(self, command: Command, fingerprint: str, response: Response) -> None:
        """Rejected commands also have stable receipts; retry cannot gain success."""
        self._db.execute(
            "INSERT OR IGNORE INTO vehicle_journal SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM vehicle_state WHERE branch_id=?)",
            (command["branch_id"], command["request_id"], fingerprint, encode(command), "DONE", "{}", "{}",
             encode(response), "{}", "{}", command["branch_id"]),
        )

    def _finish(self, branch: str, key: str, preparing: bool = False) -> Response:
        """Recover one journaled transaction; serialize with other processes."""
        self._db.execute("BEGIN IMMEDIATE")
        try:
            row = self._db.execute("SELECT * FROM vehicle_journal WHERE branch_id=? AND request_id=?", (branch, key)).fetchone()
            require(row is not None, "OWNER_UNAVAILABLE", "OWNER_PENDING")
            command = json.loads(row["command"])
            if row["decision"] in {"DONE", "ABORTED"}:
                self._db.execute("ROLLBACK")
                return json.loads(row["response"])
            effects, response = json.loads(row["effects"]), json.loads(row["response"])
            prepared, completed = json.loads(row["prepare_receipts"]), json.loads(row["completion_receipts"])
            request = {"branch_id": branch, "request_id": key, "source_event_ref": response["source_event_ref"]}
            decision = row["decision"]
            if decision == "UNDECIDED":
                # An explicit recovery never assumes that preparation completed.
                if preparing:
                    try:
                        for owner in sorted(effects):
                            payload, receipt = owner_payload(self.dependencies, owner, "prepare", {**request, "effects": effects[owner]})
                            require(payload.get("prepared") is True, "OWNER_UNAVAILABLE", "OWNER_PENDING")
                            prepared[owner] = receipt
                        decision = "COMMIT"
                    except Gate:
                        decision = "ABORT"
                else:
                    decision = "ABORT"
                self._db.execute("UPDATE vehicle_journal SET decision=?,prepare_receipts=? WHERE branch_id=? AND request_id=?",
                                 (decision, encode(prepared), branch, key))
                # Commit the decision before attempting any irreversible owner call.
                self._db.execute("COMMIT")
                return self._finish(branch, key)
            method = "commit" if decision == "COMMIT" else "abort"
            for owner in sorted(effects):
                if owner in completed:
                    continue
                try:
                    payload, receipt = owner_payload(self.dependencies, owner, method,
                                                     {**request, "effects": effects[owner], "durable_decision": decision,
                                                      "prepare_receipt_ref": prepared.get(owner)})
                    require(payload.get("committed" if method == "commit" else "aborted") is True,
                            "OWNER_UNAVAILABLE", "OWNER_PENDING")
                except Gate:
                    self._db.execute("UPDATE vehicle_journal SET completion_receipts=? WHERE branch_id=? AND request_id=?",
                                     (encode(completed), branch, key))
                    self._db.execute("COMMIT")
                    return self._failure(command, Gate("OWNER_UNAVAILABLE", "OWNER_PENDING"))
                completed[owner] = receipt
            if decision == "COMMIT":
                state = VehicleState(json.loads(row["next_state"]))
                receipt = state.receipt_and_coordination[key]
                receipt.update(durable_decision="COMMIT", prepare_receipt_refs=list(prepared.values()),
                               owner_completion_receipts=list(completed.values()))
                state.validate(branch)
                self._db.execute("UPDATE vehicle_state SET document=? WHERE branch_id=?", (encode(state.to_json()), branch))
                terminal = "DONE"
            else:
                response = self._failure(command, Gate("OWNER_UNAVAILABLE", "REJECTED"))
                terminal = "ABORTED"
            self._db.execute("UPDATE vehicle_journal SET decision=?,completion_receipts=?,response=? WHERE branch_id=? AND request_id=?",
                             (terminal, encode(completed), encode(response), branch, key))
            self._db.execute("COMMIT")
            return response
        except BaseException:
            if self._db.in_transaction:
                self._db.execute("ROLLBACK")
            raise

    def recover(self, branch_id: str) -> Response | None:
        with self._mutex:
            row = self._pending(branch_id)
            return self._finish(branch_id, row["request_id"]) if row else None


def state_machine(system: VehicleSystem, command: Command) -> Response:
    """Typed JSON entry point; the caller supplies the durable System 17 instance."""
    return system.handle(command)
