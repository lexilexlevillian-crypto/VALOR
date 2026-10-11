"""System 17 tests use static owner JSON assertions, never external simulators."""

from __future__ import annotations

import copy
from contextlib import ExitStack
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[2] / "src/system17_python/vehicles_transportation.py"
spec = importlib.util.spec_from_file_location("vehicles_transportation", MODULE)
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def r(**values):
    return {"branch_id": "b", "revision": 0, **values}


def fixture_state():
    operation_policy = {
        "version": 1,
        "driver_role": "driver",
        "power_states": {"active": "on", "inactive": "off"},
        "allowed_modes": {
            "BoardVehicle": ["PARKED", "STOPPED_ACTIVE"],
            "BoardTransit": ["STOPPED_ACTIVE"],
            "StartTrip": ["PARKED", "STOPPED_ACTIVE", "DISABLED"],
            "ParkVehicle": ["MOVING", "STOPPED_ACTIVE", "PARKED"],
        },
        "reservation_states": {"held": "held", "released": "released"},
        "trip_states": {"moving": "traveling", "stopped": "stopped", "arrived": "arrived", "interrupted": "interrupted"},
        "recovery_policy": {"ref": "test-recovery-v1", "before_decision": "ABORT"},
        "workflows": {
            "taxi": {"initial": "assigned", "terminal_states": ["complete"], "transitions": {
                "paid": {"from": "assigned", "to": "complete", "stage": "settlement", "requirements": ["actual_ride_completed"]},
                "pickup": {"from": "assigned", "to": "riding", "stage": "pickup", "requirements": []},
            }},
            "tow": {"initial": "requested", "terminal_states": ["released"], "TowLoaded": "loaded", "ImpoundArrived": "retained", "VehicleReleased": "release_approved"},
            "repair": {"authorized": "authorized", "completed": "completed"},
        },
    }
    resource = {
        "resource_kind": "fuel", "unit": "ml", "capacity_units": 10000,
        "quantity_units": 1000, "consumption_policy_version": "fuel-v1",
        "fractional_remainder": m.exact(0), "idle_policy": "idle-zero",
        "load_consumption_policy": "load-off", "gauge_precision": "coarse",
        "consumption_receipts": [], "transfer_or_loss_receipts": [],
    }
    return m.VehicleState({
        "vehicle_type_version": {"sedan-v1": r(type_id="sedan", version=1, layout_ref="layout-v1",
            operation_policy=operation_policy,
            resource_policy={"version": 1, "version_ref": "fuel-v1", "model": "linear_distance_idle", "distance_rate": 80, "idle_rate": 0, "load_policy": "disabled"},
            component_policy={"version": 1, "disabled_states": {"engine": ["broken"], "body": []}, "allowed_states": {"engine": ["sound", "broken"], "body": ["sound", "dented"]}})},
        "vehicle_instance": {"car": r(vehicle_id="car", physical_item_id="item-car", mobile_place_id="root-car", type_version="sedan-v1")},
        "vehicle_operation": {"car": r(vehicle_id="car", mode="PARKED", power_state="off", driver_ref="alice", resource_state=resource, condition_ref="car-condition")},
        "layout_and_operation_configuration": {"layout-v1": r(supported_vehicle_form="sedan", dimensions={}, seat_anchors=["seat-driver", "seat-passenger"], standing_anchors=[], compartment_refs=["trunk"], seat_capacity={"seat-driver": 1, "seat-passenger": 1}, seat_compatibility="compatible-v1", load_policy="load-v1", supported_capabilities=["self_powered"], control_policy="controls-v1", occupant_towing_policy="empty-only")},
        "condition_and_maintenance": {"car-condition": r(component_states={"engine": "sound", "body": "sound"}, supported_component_categories=["propulsion", "body"], damage_causes=[], damage_severity_and_exposure={}, observed_symptom_refs=[], diagnostic_claim_refs=[], replacement_lineage_refs=[], maintenance_policy="LIGHT", routine_wear_enabled=False, service_due_refs=[])},
        "vehicle_seat": {"passenger": r(vehicle_id="car", anchor_id="seat-passenger", role="passenger", compatibility_ref="compatible-v1"), "driver": r(vehicle_id="car", anchor_id="seat-driver", role="driver", compatibility_ref="compatible-v1")},
        "access_and_preparation": {"car": r(door_states={"door": "locked"}, window_states={}, cargo_closure_states={"trunk": "locked"}, credential_refs=["key"], control_access_ref="control-access", gear_control_state="park", restraint_states={}, safety_equipment_refs=[], completed_preparation_receipts=[])},
    })


class Harness:
    def __init__(self, state=None, database=":memory:"):
        self.ports = m.MockDependencies()
        self.system = m.VehicleSystem(database, self.ports)
        self.system.seed("b", state or fixture_state())

    def command(self, key, name, revision=None, **action):
        if revision is None:
            revision = self.system.snapshot("b")["vehicle_instance"]["car"]["revision"]
        command = {
            "branch_id": "b", "actor_principal_ref": "alice", "request_id": key,
            "expected_vehicle_person_anchor_revisions": {"car": revision},
            "intention": {"command": name, "vehicle_ref": "car", **action},
            "permission_or_mandate_ref": None, "owner_context": {},
        }
        self.set(command, "ui", "authorize", {"principal_ref": "alice", "command": name, "accepted": True, "branch_safe": True, "scope_valid": True, "terms_accepted": True, "accepted_terms_ref": "terms-v1", "known_failure_codes": sorted(m.FAILURES), "recovery_policy_ref": "test-recovery-v1"})
        self.set(command, "system12", "validate_revisions", {"matched": True})
        self.set(command, "ui", "project", {"filtered": True, "actor_known_vehicle_view": {"summary": "fixture-visible result"}})
        for owner in m.OWNERS:
            self.set(command, owner, "prepare", {"prepared": True})
            self.set(command, owner, "commit", {"committed": True})
            self.set(command, owner, "abort", {"aborted": True})
        for purpose in ("boarding", "exiting", "preparation", "parking", "travel_commit", "storage_transfer", "resource_transfer", "search"):
            self.set(command, "system11", purpose, {"authorized": True, "interval_ref": "interval-" + key, "checkpoint_ref": "checkpoint-" + key, "next_due_boundary": "boundary-" + key})
        self.set(command, "system12", "driver", {"actual_compatible_occupant": True, "controls_accessible": True})
        self.set(command, "health", "driver_feasibility", {"physically_able": True})
        self.set(command, "system10", "competence", {"feasible": True})
        return command

    def set(self, command, owner, operation, payload, available=True):
        branch, key = command["branch_id"], command["request_id"]
        self.ports.fixtures[(branch, key, owner, operation)] = {
            "owner": owner, "operation": operation, "available": available,
            "branch_id": branch, "request_id": key,
            "receipt_ref": f"{branch}/{key}/{owner}/{operation}", "payload": copy.deepcopy(payload),
        }

    def start(self, key="start"):
        command = self.command(key, "StartTrip", trip_ref="trip", destination="home")
        self.set(command, "system12", "route", {"feasible": True, "known_route": True, "route_version": "route-v1", "first_edge_ref": "edge-1", "origin_ref": "origin", "route_ref": "route", "participant_presence_refs": ["presence-alice"]})
        self.set(command, "system15", "control_access", {"physical_access": True, "accepted_or_grounded_violation": True})
        return command

    def move(self, key, distance=5, duration=5, next_edge="edge-2", arrive=True, name="ApplyEncounterOutcome", **extra):
        state = self.system.snapshot("b")
        trip = state["vehicle_trip"]["trip"]
        command = self.command(key, name, trip_ref="trip", event_kind="RouteInterval", source_event_ref="event-" + key, **extra)
        self.set(command, "system11", "source_event", {"validated": True, "event_kind": "RouteInterval", "source_event_ref": "event-" + key, "vehicle_ref": "car"})
        self.set(command, "system12", "traversal", {"edge_accessible": True, "current_edge_ref": trip["current_edge"], "current_progress": trip["progress_units"], "speed_limit": 1, "remaining_distance": distance, "next_edge_ref": next_edge, "destination_approach": arrive, "approach_anchor_ref": "home-approach"})
        self.set(command, "world", "traffic", {"causal_source_ref": "traffic-source", "speed_limit": 1, "capacity_available": True})
        self.set(command, "system11", "travel_boundary", {"authorized": True, "maximum_duration": duration})
        return command

    def outcome(self, key, kind, owner, payload):
        command = self.command(key, "ApplyEncounterOutcome", event_kind=kind, source_event_ref="event-" + key)
        self.set(command, owner, "source_event", {"validated": True, "event_kind": kind, "source_event_ref": "event-" + key, "vehicle_ref": "car", **payload})
        return command

    def state(self):
        return self.system.snapshot("b")


class VehicleTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()
        self.addCleanup(self.h.system.close)

    def test_default_dependencies_are_stateless_pending(self):
        command = self.h.start()
        self.h.ports.fixtures.clear()
        before = self.h.state()
        self.assertEqual(self.h.system.handle(command)["response_status"], "OWNER_PENDING")
        self.assertEqual(self.h.state(), before)

    def test_canonical_trip_and_exact_fuel(self):
        start = self.h.start()
        self.assertEqual(self.h.system.handle(start)["response_status"], "IN_PROGRESS")
        result = self.h.system.handle(self.h.move("move"))
        self.assertEqual(result["response_status"], "ARRIVED")
        state = self.h.state()
        self.assertEqual(state["vehicle_operation"]["car"]["resource_state"]["quantity_units"], 600)
        self.assertEqual(state["vehicle_operation"]["car"]["driver_ref"], "alice")
        self.assertEqual(state["trip_execution"]["trip"]["committed_distance"], m.exact(5))
        self.assertEqual(state["access_and_preparation"]["car"]["cargo_closure_states"], {"trunk": "locked"})

    def test_segmentation_preserves_consumption_and_fractional_remainder(self):
        self.h.system.handle(self.h.start())
        for i in range(5):
            self.assertIn(self.h.system.handle(self.h.move(f"part{i}", distance=1, duration=1, next_edge=f"edge-{i+2}", arrive=i == 4))["response_status"], {"IN_PROGRESS", "ARRIVED"})
        resource = self.h.state()["vehicle_operation"]["car"]["resource_state"]
        self.assertEqual(resource["quantity_units"], 600)
        self.assertEqual(resource["fractional_remainder"], m.exact(0))
        state = fixture_state()
        state.vehicle_type_version["sedan-v1"]["resource_policy"]["distance_rate"] = {"numerator": 1, "denominator": 3}
        h = Harness(state)
        self.addCleanup(h.system.close)
        h.system.handle(h.start())
        for i in range(3):
            h.system.handle(h.move(f"third-{i}", distance=1, duration=1, arrive=i == 2, next_edge=f"edge-{i+2}"))
        resource = h.state()["vehicle_operation"]["car"]["resource_state"]
        self.assertEqual(resource["quantity_units"], 999)
        self.assertEqual(resource["fractional_remainder"], m.exact(0))

    def test_replay_and_event_dedup_do_not_move_or_charge_twice(self):
        start = self.h.start()
        first = self.h.system.handle(start)
        self.assertEqual(self.h.system.handle(start), first)
        move = self.h.move("move")
        result = self.h.system.handle(move)
        saved = self.h.state()
        self.assertEqual(self.h.system.handle(move), result)
        changed_id = copy.deepcopy(move)
        changed_id["request_id"] = "different-request"
        self.assertEqual(self.h.system.handle(changed_id), result)
        self.assertEqual(self.h.state(), saved)

    def test_same_request_cannot_change_payload(self):
        command = self.h.start()
        self.h.system.handle(command)
        command["intention"]["destination"] = "elsewhere"
        self.assertEqual(self.h.system.handle(command)["failure_code"], "STALE_REVISION")

    def test_resource_exhaustion_stops_at_exact_progress(self):
        state = fixture_state()
        state.vehicle_operation["car"]["resource_state"]["quantity_units"] = 100
        h = Harness(state)
        self.addCleanup(h.system.close)
        h.system.handle(h.start())
        result = h.system.handle(h.move("empty"))
        self.assertEqual(result["response_status"], "PARTIAL")
        self.assertEqual(result["failure_code"], "RESOURCE_INSUFFICIENT")
        snapshot = h.state()
        self.assertEqual(snapshot["vehicle_trip"]["trip"]["progress_units"], {"numerator": 5, "denominator": 4})
        self.assertEqual(snapshot["vehicle_operation"]["car"]["mode"], "DISABLED")
        self.assertEqual(snapshot["vehicle_operation"]["car"]["resource_state"]["quantity_units"], 0)

    def test_delay_does_not_arrive(self):
        self.h.system.handle(self.h.start())
        command = self.h.move("delay")
        self.h.set(command, "world", "traffic", {"causal_source_ref": "queue", "speed_limit": 0, "capacity_available": False})
        self.assertEqual(self.h.system.handle(command)["response_status"], "IN_PROGRESS")
        self.assertEqual(self.h.state()["vehicle_trip"]["trip"]["progress_units"], m.exact(0))

    def test_failed_start_preserves_location_and_resources(self):
        command = self.h.start()
        self.h.set(command, "system15", "control_access", {"physical_access": False, "accepted_or_grounded_violation": True})
        before = self.h.state()
        self.assertEqual(self.h.system.handle(command)["failure_code"], "NO_CONTROL_ACCESS")
        self.assertEqual(self.h.state(), before)

    def test_real_overlapping_seat_requests_have_single_winner(self):
        commands = []
        for key in ("board-a", "board-b"):
            command = self.h.command(key, "BoardVehicle", revision=0, seat_ref="passenger")
            self.h.set(command, "system12", "boarding", {"co_located": True, "path_accessible": True, "compatible": True, "capacity_available": True, "encounter_allows": True, "reservation_available": True, "reservation_expiry": "expiry"})
            commands.append(command)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.h.system.handle, commands))
        self.assertEqual(sum(x["response_status"] == "COMMITTED" for x in results), 1)
        self.assertEqual(len(self.h.state()["reservation_and_parking"]), 1)

    def test_parking_preserves_people_and_locked_storage(self):
        command = self.h.command("park", "ParkVehicle", destination_anchor="bay")
        self.h.set(command, "system12", "parking", {"space_available": True, "form_and_access_supported": True, "reservation_available": True, "reservation_expiry": "expiry", "already_at_parking_anchor": True, "parking_occupancy_ref": "bay-car"})
        self.assertEqual(self.h.system.handle(command)["response_status"], "COMMITTED")
        self.assertEqual(self.h.state()["vehicle_operation"]["car"]["driver_ref"], "alice")
        self.assertEqual(self.h.state()["access_and_preparation"]["car"]["door_states"], {"door": "locked"})

    def test_full_parking_cannot_move_vehicle(self):
        self.h.system.handle(self.h.start())
        command = self.h.command("park", "ParkVehicle", destination_anchor="bay")
        self.h.set(command, "system12", "parking", {"space_available": False})
        before = self.h.state()
        self.assertEqual(self.h.system.handle(command)["failure_code"], "PARKING_UNAVAILABLE")
        self.assertEqual(self.h.state(), before)

    def test_moving_exit_is_rejected(self):
        self.h.system.handle(self.h.start())
        command = self.h.command("exit", "ExitVehicle", destination_anchor="sidewalk")
        self.assertEqual(self.h.system.handle(command)["failure_code"], "OPERATION_DISABLED")

    def test_no_free_refill_or_overcapacity(self):
        payload = {"actual_transfer_or_loss": True, "resource_kind": "fuel", "unit": "ml", "quantity_units": 10000, "supply_exists": True, "compatible": True, "accepted_terms_ref": "fuel-terms"}
        command = self.h.outcome("refuel", "Refuel", "system15", payload)
        self.assertEqual(self.h.system.handle(command)["failure_code"], "CAPACITY_EXCEEDED")
        self.assertEqual(self.h.state()["vehicle_operation"]["car"]["resource_state"]["quantity_units"], 1000)

    def test_cosmetic_damage_has_no_operational_penalty(self):
        command = self.h.outcome("dent", "ComponentDamaged", "encounter", {"actual_cause": True, "component_changes": {"body": "dented"}, "severity_and_exposure": {"severity": "cosmetic"}})
        self.assertEqual(self.h.system.handle(command)["response_status"], "COMMITTED")
        self.assertEqual(self.h.state()["vehicle_operation"]["car"]["mode"], "PARKED")
        self.assertEqual(self.h.state()["condition_and_maintenance"]["car-condition"]["damage_causes"], ["event-dent"])

    def test_stop_signal_does_not_choose_response_or_move(self):
        self.h.system.handle(self.h.start())
        before = self.h.state()
        command = self.h.outcome("signal", "StopSignal", "encounter", {"actual_unit_and_perception": True})
        self.assertEqual(self.h.system.handle(command)["response_status"], "CHOICE_REQUIRED")
        after = self.h.state()
        self.assertEqual(after["vehicle_trip"], before["vehicle_trip"])
        self.assertEqual(after["vehicle_operation"], before["vehicle_operation"])

    def test_phony_encounter_teleport_is_rejected(self):
        command = self.h.outcome("teleport", "EncounterResolved", "encounter", {"physical_effects": [{"anchor": "home"}]})
        before = self.h.state()
        self.assertEqual(self.h.system.handle(command)["response_status"], "REJECTED")
        self.assertEqual(before, self.h.state())

    def test_police_signal_blocks_automatic_continuation(self):
        self.h.system.handle(self.h.start())
        signal = self.h.outcome("signal", "StopSignal", "encounter", {"actual_unit_and_perception": True})
        self.h.system.handle(signal)
        before = self.h.state()
        result = self.h.system.handle(self.h.move("unapproved-continuation"))
        self.assertEqual(result["response_status"], "CHOICE_REQUIRED")
        self.assertEqual(self.h.state(), before)

    def test_explicit_response_can_resume_after_interruption(self):
        self.h.system.handle(self.h.start())
        self.h.system.handle(self.h.outcome("signal", "StopSignal", "encounter", {"actual_unit_and_perception": True}))
        response = self.h.outcome("response", "EncounterResolved", "encounter", {"physical_effects": [], "clears_interruption_ref": "event-signal", "trip_ref": "trip", "explicit_driver_response": True})
        self.h.ports.fixtures[("b", "response", "ui", "authorize")]["payload"]["resolves_interruption_ref"] = "event-signal"
        self.assertEqual(self.h.system.handle(response)["response_status"], "COMMITTED")
        self.assertEqual(self.h.system.handle(self.h.move("continue"))["response_status"], "ARRIVED")

    def test_client_owner_context_is_not_trusted(self):
        command = self.h.start()
        self.h.ports.fixtures.clear()
        command["owner_context"] = {"system12": {"feasible": True}, "ui": {"accepted": True}}
        self.assertEqual(self.h.system.handle(command)["response_status"], "OWNER_PENDING")

    def test_schema_rejects_extra_material_state(self):
        with self.assertRaises(m.Gate):
            m.VehicleState({"money_ledger": {}})
        state = fixture_state()
        state.vehicle_instance["car"]["passengers"] = ["alice"]
        with self.assertRaises(m.Gate):
            state.validate("b")

    def test_schema_rejects_aliasing_physical_vehicle(self):
        state = fixture_state()
        state.vehicle_instance["other"] = copy.deepcopy(state.vehicle_instance["car"])
        state.vehicle_instance["other"]["vehicle_id"] = "other"
        with self.assertRaises(m.Gate):
            state.validate("b")

    def test_cross_branch_owner_response_fails_closed(self):
        command = self.h.start()
        self.h.ports.fixtures[("b", "start", "system12", "route")]["branch_id"] = "other-branch"
        self.assertEqual(self.h.system.handle(command)["response_status"], "OWNER_PENDING")

    def test_unspecified_policy_does_not_get_invented(self):
        state = fixture_state()
        del state.vehicle_type_version["sedan-v1"]["operation_policy"]["power_states"]
        h = Harness(state)
        self.addCleanup(h.system.close)
        self.assertEqual(h.system.handle(h.start())["failure_code"], "OPERATION_DISABLED")

    def test_taxi_without_unit_stays_unfulfilled(self):
        command = self.h.command("taxi", "RequestTaxi", pickup_ref="pickup", destination_ref="home", passenger_count=1)
        self.h.set(command, "system16", "service_channel", {"reachable": True})
        self.h.set(command, "system13", "service_offer", {"actual_unit": False})
        self.assertEqual(self.h.system.handle(command)["failure_code"], "NO_SERVICE_UNIT")
        self.assertEqual(self.h.state()["transport_service"], {})

    def test_taxi_acceptance_is_not_pickup_and_requires_no_owned_car(self):
        command = self.h.command("taxi", "RequestTaxi", pickup_ref="pickup", destination_ref="home", passenger_count=1)
        del command["intention"]["vehicle_ref"]
        self.h.set(command, "system16", "service_channel", {"reachable": True})
        self.h.set(command, "system13", "service_offer", {
            "actual_unit": True, "actual_worker": True, "schedule_feasible": True, "capacity_available": True,
            "transport_service": {"service_id": "service", "provider_ref": "provider", "run_or_order_id": "order", "vehicle_id": "car", "worker_ref": "worker", "terms_version": "terms"},
            "taxi_request": {"pickup_ref": "pickup", "destination_ref": "home", "passenger_count": 1, "assigned_service_ref": "service", "fulfillment_state": "assigned"},
        })
        self.assertEqual(self.h.system.handle(command)["response_status"], "ACCEPTED")
        self.assertEqual(self.h.state()["vehicle_operation"]["car"]["mode"], "PARKED")
        self.assertEqual(self.h.state()["vehicle_trip"], {})


class ServiceAndBoundaryTests(unittest.TestCase):
    def harness(self, state=None):
        h = Harness(state)
        self.addCleanup(h.system.close)
        return h

    def repair_state(self):
        state = fixture_state()
        state.condition_and_maintenance["car-condition"]["component_states"]["engine"] = "broken"
        state.vehicle_operation["car"]["mode"] = "DISABLED"
        state.repair_work_order["order"] = r(service_ref="repair-service", vehicle_ref="car",
            requested_scope={"component_refs": ["engine"]}, authorized_cost_cap=100,
            state="authorized", condition_output_receipts=[], invoice_and_settlement_refs=["paid-invoice"])
        return state

    def test_paid_invoice_does_not_restore_condition(self):
        h = self.harness(self.repair_state())
        result = h.system.handle(h.start())
        self.assertEqual(result["failure_code"], "OPERATION_DISABLED")
        self.assertEqual(h.state()["condition_and_maintenance"]["car-condition"]["component_states"]["engine"], "broken")

    def test_repair_needs_parts_labor_scope_and_cost_cap(self):
        for changed_field, changed_value in (("actual_parts", False), ("certified_labor", False), ("actual_cost", 101), ("authorized_scope", False)):
            with self.subTest(field=changed_field):
                h = self.harness(self.repair_state())
                payload = {"actual_cause": True, "component_changes": {"engine": "sound"}, "order_ref": "order", "authorized_scope": True, "actual_parts": True, "certified_labor": True, "accepted_output": True, "actual_cost": 90, "replacement_lineage_refs": ["new-part-lineage"], changed_field: changed_value}
                command = h.outcome("repair", "RepairCompleted", "system13", payload)
                self.assertIn(h.system.handle(command)["response_status"], {"REJECTED", "CHOICE_REQUIRED"})
                self.assertEqual(h.state()["condition_and_maintenance"]["car-condition"]["component_states"]["engine"], "broken")

    def test_completed_repair_preserves_history_and_requires_new_start(self):
        state = self.repair_state()
        state.condition_and_maintenance["car-condition"]["damage_causes"] = ["old-collision"]
        h = self.harness(state)
        command = h.outcome("repair", "RepairCompleted", "system13", {"actual_cause": True, "component_changes": {"engine": "sound"}, "order_ref": "order", "authorized_scope": True, "actual_parts": True, "certified_labor": True, "accepted_output": True, "actual_cost": 90, "replacement_lineage_refs": ["new-part-lineage"]})
        self.assertEqual(h.system.handle(command)["response_status"], "COMMITTED")
        self.assertEqual(h.state()["condition_and_maintenance"]["car-condition"]["damage_causes"], ["old-collision"])
        self.assertEqual(h.state()["vehicle_operation"]["car"]["power_state"], "off")
        self.assertEqual(h.system.handle(h.start())["response_status"], "IN_PROGRESS")

    def tow_state(self):
        state = fixture_state()
        state.vehicle_instance["carrier"] = r(vehicle_id="carrier", physical_item_id="carrier-item", mobile_place_id="carrier-root", type_version="sedan-v1")
        state.vehicle_operation["carrier"] = copy.deepcopy(state.vehicle_operation["car"])
        state.vehicle_operation["carrier"]["vehicle_id"] = "carrier"
        state.vehicle_operation["carrier"]["driver_ref"] = "worker"
        state.tow_and_impound["tow"] = r(request_ref="tow-request", authority_or_agreement_ref="tow-authority", source_event_ref="tow-source", target_vehicle_ref="car", carrier_vehicle_ref="carrier", worker_ref="worker", carrier_relation_ref=None, occupant_handling_receipts=[], state="requested")
        return state

    def test_unsupported_occupied_towing_cannot_load(self):
        h = self.harness(self.tow_state())
        command = h.outcome("load", "TowLoaded", "system13", {"tow_ref": "tow", "actual_worker": True, "attachment_feasible": True, "capacity_valid": True, "occupants_handled": False})
        h.set(command, "system12", "tow_stage", {"at_actual_stage_anchor": True, "remaining_driver_ref": None})
        self.assertEqual(h.system.handle(command)["failure_code"], "CAPACITY_EXCEEDED")
        self.assertEqual(h.state()["vehicle_operation"]["car"]["mode"], "PARKED")

    def test_tow_loading_and_release_approval_do_not_arrive_home(self):
        h = self.harness(self.tow_state())
        command = h.outcome("load", "TowLoaded", "system13", {"tow_ref": "tow", "actual_worker": True, "attachment_feasible": True, "capacity_valid": True, "occupants_handled": True, "carrier_relation_ref": "car-on-carrier", "occupant_handling_receipts": ["alice-exited"]})
        h.set(command, "system12", "tow_stage", {"at_actual_stage_anchor": True, "remaining_driver_ref": None})
        self.assertEqual(h.system.handle(command)["response_status"], "COMMITTED")
        self.assertIsNone(h.state()["vehicle_operation"]["car"]["driver_ref"])
        command = h.outcome("yard", "ImpoundArrived", "system13", {"tow_ref": "tow", "actual_transport_completed": True, "yard_anchor_ref": "yard", "custody_ref": "impound-custody"})
        h.set(command, "system12", "tow_stage", {"at_actual_stage_anchor": True})
        self.assertEqual(h.system.handle(command)["response_status"], "COMMITTED")
        command = h.outcome("release", "VehicleReleased", "institutions", {"tow_ref": "tow", "release_authorized": True, "actual_retrieval": False})
        h.set(command, "system12", "tow_stage", {"at_actual_stage_anchor": True})
        self.assertEqual(h.system.handle(command)["response_status"], "COMMITTED")
        self.assertEqual(h.state()["vehicle_operation"]["car"]["mode"], "SERVICE_CONTROLLED")
        self.assertEqual(h.state()["tow_and_impound"]["tow"]["yard_anchor_ref"], "yard")
        self.assertEqual(h.state()["tow_and_impound"]["tow"]["custody_ref"], "impound-custody")

    def test_tow_cycle_is_rejected(self):
        state = self.tow_state()
        state.tow_and_impound["tow"]["carrier_relation_ref"] = "relation-a"
        state.tow_and_impound["reverse"] = r(target_vehicle_ref="carrier", carrier_vehicle_ref="car", carrier_relation_ref="relation-b")
        with self.assertRaises(m.Gate):
            state.validate("b")

    def test_scoped_search_cannot_reveal_nested_bag(self):
        h = self.harness()
        payload = {"scope_valid": True, "actual_access": True, "actual_coverage": True, "unchanged_opportunity_reused": True, "authorized_scope_refs": ["trunk"], "observed_scope_refs": ["private-bag"], "search_ref": "search", "search_context": {"actor_ref": "officer", "target_scope_refs": ["trunk"], "collection_and_custody_receipts": [], "observation_refs": []}}
        self.assertEqual(h.system.handle(h.outcome("search", "SearchResolved", "system15", payload))["response_status"], "REJECTED")
        self.assertEqual(h.state()["search_context"], {})

    def test_unsuccessful_search_cannot_collect_consolation_clue(self):
        h = self.harness()
        payload = {"scope_valid": True, "actual_access": True, "actual_coverage": True, "unchanged_opportunity_reused": True, "authorized_scope_refs": ["trunk"], "observed_scope_refs": ["trunk"], "found": False, "search_ref": "search", "search_context": {"actor_ref": "officer", "target_scope_refs": ["trunk"], "collection_and_custody_receipts": ["invented-item"], "observation_refs": []}}
        self.assertEqual(h.system.handle(h.outcome("search", "SearchResolved", "system15", payload))["response_status"], "REJECTED")

    def test_valid_search_retains_only_owner_observations(self):
        h = self.harness()
        payload = {"scope_valid": True, "actual_access": True, "actual_coverage": True, "unchanged_opportunity_reused": True, "authorized_scope_refs": ["trunk"], "observed_scope_refs": ["trunk"], "found": False, "search_ref": "search", "search_context": {"actor_ref": "officer", "target_scope_refs": ["trunk"], "collection_and_custody_receipts": [], "observation_refs": ["nothing-visible"]}}
        self.assertEqual(h.system.handle(h.outcome("search", "SearchResolved", "system15", payload))["response_status"], "COMMITTED")
        self.assertEqual(h.state()["search_context"]["search"]["observation_refs"], ["nothing-visible"])

    def test_departed_bus_cannot_be_boarded(self):
        state = fixture_state()
        state.vehicle_operation["car"]["mode"] = "STOPPED_ACTIVE"
        state.transit_run["run"] = r(run_id="run", vehicle_ref="car")
        h = self.harness(state)
        command = h.command("board", "BoardTransit", run_ref="run", seat_ref="passenger")
        h.set(command, "system13", "boarding_window", {"accepting_at_actual_stop": False})
        self.assertEqual(h.system.handle(command)["failure_code"], "NO_SERVICE_UNIT")

    def test_full_bus_cannot_override_capacity(self):
        state = fixture_state()
        state.vehicle_operation["car"]["mode"] = "STOPPED_ACTIVE"
        state.transit_run["run"] = r(run_id="run", vehicle_ref="car")
        h = self.harness(state)
        command = h.command("board", "BoardTransit", run_ref="run", seat_ref="passenger")
        h.set(command, "system13", "boarding_window", {"accepting_at_actual_stop": True, "capacity_available": False})
        self.assertEqual(h.system.handle(command)["failure_code"], "CAPACITY_EXCEEDED")

    def test_failed_fare_preserves_completed_trip(self):
        state = fixture_state()
        state.transport_service["service"] = r(service_id="service", provider_ref="provider", run_or_order_id="taxi-order", vehicle_id="car", worker_ref="worker", terms_version="fare-v1", state="assigned")
        state.taxi_request["taxi-order"] = r(fulfillment_state="assigned")
        h = self.harness(state)
        h.system.handle(h.start())
        h.system.handle(h.move("ride"))
        before = h.state()
        command = h.outcome("fare", "ServiceProgress", "system13", {"service_ref": "service", "service_kind": "taxi", "transition": "paid", "worker_and_unit_unchanged": True, "requirements": {"actual_ride_completed": True}, "stage": "settlement"})
        h.set(command, "system14", "settlement", {"terms_valid": True, "settled": False})
        self.assertEqual(h.system.handle(command)["response_status"], "CHOICE_REQUIRED")
        self.assertEqual(h.state()["vehicle_trip"], before["vehicle_trip"])
        self.assertEqual(h.state()["vehicle_operation"], before["vehicle_operation"])
        self.assertIn("settlement_ref", h.state()["taxi_request"]["taxi-order"])

    def test_ordinary_travel_never_requests_uncertainty(self):
        h = self.harness()
        start = h.start()
        with patch.object(h.ports, "call", wraps=h.ports.call) as calls:
            h.system.handle(start)
            h.system.handle(h.move("move"))
        skill_calls = [call.args[1] for call in calls.call_args_list if call.args[0] == "system10"]
        self.assertEqual(skill_calls, ["competence", "competence"])

    def test_private_failure_code_is_not_disclosed(self):
        h = self.harness()
        command = h.start()
        h.ports.fixtures[("b", "start", "ui", "authorize")]["payload"]["known_failure_codes"] = []
        h.set(command, "system15", "control_access", {"physical_access": False})
        result = h.system.handle(command)
        self.assertIsNone(result["failure_code"])
        self.assertEqual(result["actor_known_vehicle_view"], {})

    def test_rejected_request_cannot_gain_success_on_retry(self):
        h = self.harness()
        command = h.start()
        h.set(command, "system15", "control_access", {"physical_access": False})
        result = h.system.handle(command)
        h.set(command, "system15", "control_access", {"physical_access": True, "accepted_or_grounded_violation": True})
        self.assertEqual(h.system.handle(command), result)
        self.assertEqual(h.state()["vehicle_trip"], {})

    def test_passenger_cannot_silently_become_driver(self):
        state = fixture_state()
        state.vehicle_operation["car"]["driver_ref"] = "bob"
        h = self.harness(state)
        self.assertEqual(h.system.handle(h.start())["failure_code"], "NO_DRIVER")

    def test_mandate_resource_cap_stops_at_exact_boundary(self):
        state = fixture_state()
        state.travel_mandate["mandate"] = r(principal_ref="alice", vehicle_or_mode="car", destination_ref="home", participant_refs=["alice"], resource_cap={"unit": "ml", "quantity": 160}, cost_cap=0, acceptance_receipt_ref="accepted", duration_or_expiry="expiry")
        h = self.harness(state)
        start = h.start()
        start["permission_or_mandate_ref"] = "mandate"
        auth = h.ports.fixtures[("b", "start", "ui", "authorize")]["payload"]
        auth.update(mandate_ref="mandate", mandate_unexpired=True, stopping_conditions_clear=True)
        h.set(start, "system11", "mandate_validity", {"unexpired": True})
        h.ports.fixtures[("b", "start", "system12", "route")]["payload"]["participant_refs"] = ["alice"]
        self.assertEqual(h.system.handle(start)["response_status"], "IN_PROGRESS")
        command = h.move("capped")
        h.ports.fixtures[("b", "capped", "ui", "authorize")]["payload"]["travel_mandate_valid"] = True
        h.ports.fixtures[("b", "capped", "system12", "traversal")]["payload"]["participant_refs"] = ["alice"]
        self.assertEqual(h.system.handle(command)["response_status"], "CHOICE_REQUIRED")
        self.assertEqual(h.state()["vehicle_trip"]["trip"]["progress_units"], m.exact(2))
        self.assertEqual(h.state()["vehicle_operation"]["car"]["resource_state"]["quantity_units"], 840)
        next_command = h.move("over-cap")
        h.ports.fixtures[("b", "over-cap", "ui", "authorize")]["payload"]["travel_mandate_valid"] = True
        h.ports.fixtures[("b", "over-cap", "system12", "traversal")]["payload"]["participant_refs"] = ["alice"]
        self.assertEqual(h.system.handle(next_command)["response_status"], "CHOICE_REQUIRED")
        self.assertEqual(h.state()["vehicle_operation"]["car"]["resource_state"]["quantity_units"], 840)

    def test_crash_before_durable_decision_aborts_on_recovery(self):
        h = self.harness()
        command = h.start()
        before = h.state()
        with patch.object(h.system, "_finish", side_effect=SystemExit("injected process exit")):
            with self.assertRaises(SystemExit):
                h.system.handle(command)
        self.assertEqual(h.system.recover("b")["response_status"], "REJECTED")
        self.assertEqual(h.state(), before)

    def test_malformed_json_contract_does_not_raise(self):
        h = self.harness()
        for value in (None, [], {}, {"branch_id": "b", "request_id": "bad"}):
            with self.subTest(value=value):
                self.assertEqual(h.system.handle(value)["response_status"], "REJECTED")


class RecoveryTests(unittest.TestCase):
    def test_commit_decision_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder, ExitStack() as cleanup:
            path = Path(folder) / "vehicles.sqlite"
            h = Harness(database=path)
            command = h.start()
            h.set(command, "system15", "commit", {}, available=False)
            self.assertEqual(h.system.handle(command)["response_status"], "OWNER_PENDING")
            with self.assertRaises(m.Gate):
                h.system.snapshot("b")
            h.system.close()
            h.set(command, "system15", "commit", {"committed": True})
            h.system = m.VehicleSystem(path, h.ports)
            cleanup.callback(h.system.close)
            self.assertEqual(h.system.recover("b")["response_status"], "IN_PROGRESS")
            saved = h.state()
            self.assertEqual(h.system.handle(command)["response_status"], "IN_PROGRESS")
            self.assertEqual(h.state(), saved)
            receipt = saved["receipt_and_coordination"]["start"]
            self.assertEqual(receipt["durable_decision"], "COMMIT")

    def test_prepare_failure_aborts_without_applying_local_state(self):
        h = Harness()
        self.addCleanup(h.system.close)
        command = h.start()
        before = h.state()
        h.set(command, "system15", "prepare", {}, available=False)
        result = h.system.handle(command)
        self.assertEqual(result["response_status"], "REJECTED")
        self.assertEqual(h.state(), before)
        self.assertEqual(h.system.handle(command), result)

    def test_pending_commit_blocks_competing_commands(self):
        h = Harness()
        self.addCleanup(h.system.close)
        start, other = h.start(), h.command("other", "ExitVehicle", destination_anchor="outside")
        h.set(start, "system15", "commit", {}, available=False)
        h.system.handle(start)
        self.assertEqual(h.system.handle(other)["response_status"], "OWNER_PENDING")

    def test_two_database_connections_serialize_real_contention(self):
        with tempfile.TemporaryDirectory() as folder, ExitStack() as cleanup:
            path = Path(folder) / "vehicles.sqlite"
            h = Harness(database=path)
            second = m.VehicleSystem(path, h.ports)
            cleanup.callback(h.system.close)
            cleanup.callback(second.close)
            a, b = h.start("a"), h.start("b")
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = [pool.submit(h.system.handle, a), pool.submit(second.handle, b)]
                responses = [f.result() for f in results]
            self.assertEqual(sum(x["response_status"] == "IN_PROGRESS" for x in responses), 1)
            self.assertEqual(len(h.state()["vehicle_trip"]), 1)


if __name__ == "__main__":
    unittest.main()
