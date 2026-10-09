"""Run: python -m unittest discover -s tests/system11_python -v."""
import copy
import json
import threading
import unittest
from datetime import date
from unittest.mock import patch

from src.system11_python import time_schedule_calendar as m


class System11Tests(unittest.TestCase):
    def setUp(self):
        self.state = m.default_state()
        self.start = self.state.world_clock["instant_ms"]

    def request(self, duration=900_000, **changes):
        now = self.state.world_clock["instant_ms"]
        value = {"command_id": "wait", "branch_id": "main", "actor_id": "mock:pc",
                 "expected_clock_revision": self.state.world_clock["revision"],
                 "authorization_ref": "mock:authorization", "causation_id": "mock:intent",
                 "kind": "wait_duration", "duration_ms": duration,
                 "maximum_horizon_ms": now + max(0, duration), "location_ref": "mock:location"}
        value.update(changes)
        return value

    def event(self, eid="event", delta=60_000, kind="Signal", owner="communication"):
        return {"event_id": eid, "branch_id": "main", "due_ms": self.start + delta,
                "phase": m.PHASES[kind], "owner_domain": owner, "occurrence_key": eid,
                "payload_json": {"kind": kind}, "state": "PENDING", "source_event_id": "mock:cause"}

    def register(self, event):
        return m.TimeScheduleCalendar.register_event(self.state, {
            "event": event, "credential": "mock:owner:" + event["owner_domain"]})

    def rule(self, **changes):
        value = {"schedule_id": "shift", "schedule_version": "1", "owner_domain": "employment",
            "subject_or_resource_ref": "mock:worker", "timezone_id": "America/Los_Angeles",
            "tzdata_version": m.PINNED_TZDATA, "recurrence_basis": "local_calendar",
            "recurrence_kind": "daily", "recurrence_payload": {"time": "09:00:00"},
            "interval_policy": {"duration_ms": 3_600_000}, "gap_policy": "shift_forward_by_gap",
            "fold_policy": "first_occurrence", "exception_hierarchy": ["one_off_closure", "cancellation",
                "date_specific_override", "holiday_policy", "normal_recurrence"],
            "validity_start": self.start, "validity_end_or_expiry_policy": self.start + 366 * m.DAY,
            "priority_policy_ref": "mock:priority", "revision": 1}
        value.update(changes)
        return value

    def schedule(self, rule):
        return m.TimeScheduleCalendar.register_schedule(self.state, {"rule": rule, "credential": "mock:owner:employment"})

    def expand(self, duration=3*m.DAY):
        return m.TimeScheduleCalendar.expand(self.state, {"start_ms": self.start, "end_ms": self.start + duration,
                                                        "credential": "mock:owner:configuration"})

    def test_wait_exact_coverage_and_retry(self):
        request = self.request()
        result = m.TimeScheduleCalendar.advance(self.state, request)
        self.assertEqual((result["status"], result["elapsed_ms"]), ("COMPLETED", 900_000))
        before = m.TimeScheduleCalendar.export_state(self.state)
        self.assertEqual(result, m.TimeScheduleCalendar.advance(self.state, request))
        self.assertEqual(before, m.TimeScheduleCalendar.export_state(self.state))
        m.TimeScheduleCalendar.validate_state(self.state)

    def test_json_only_boundary_round_trip(self):
        request = self.request()
        response = m.state_machine(request, m.TimeScheduleCalendar.export_state(self.state))
        self.assertEqual(json.loads(json.dumps(response)), response)
        self.assertEqual(response["result"]["elapsed_ms"], 900_000)
        repeated = m.state_machine(request, response["state"])
        self.assertEqual(repeated, response)

    def test_changed_command_rejected(self):
        request = self.request()
        m.TimeScheduleCalendar.advance(self.state, request)
        changed = request | {"duration_ms": 1}
        self.assertEqual(m.TimeScheduleCalendar.advance(self.state, changed)["error"]["code"], "IDEMPOTENCY_CONFLICT")

    def test_invalid_admission_no_mutation(self):
        for changes in ({"duration_ms": -1}, {"duration_ms": True}, {"duration_ms": 1.5},
                        {"duration_ms": 2**65}, {"expected_clock_revision": 7},
                        {"authorization_ref": "forged"}, {"instant_ms": self.start + 1},
                        {"known_target_ref": "secret"}, {"maximum_horizon_ms": self.start}):
            before = m.TimeScheduleCalendar.export_state(self.state)
            result = m.TimeScheduleCalendar.advance(self.state, self.request(**changes))
            self.assertEqual(result["status"], "ERROR", changes)
            self.assertEqual(before, m.TimeScheduleCalendar.export_state(self.state), changes)

    def test_unknown_predicate_and_no_automatic_routine(self):
        request = self.request(kind="wait_for_known_event", known_target_ref="hidden:suspect")
        self.assertEqual(m.TimeScheduleCalendar.advance(self.state, request)["error"]["code"], "INVALID_STOP_PREDICATE")
        request = self.request(kind="fast_forward_routine", activity_ref="routine")
        self.assertEqual(m.TimeScheduleCalendar.advance(self.state, request)["error"]["code"], "AUTHORIZATION_EXCEEDED")

    def test_known_event_timeout(self):
        result = m.TimeScheduleCalendar.advance(self.state, self.request(kind="wait_for_known_event", known_target_ref="mock:known"))
        self.assertEqual(result["stop_reason"]["code"], "TIMEOUT")

    def test_target_event_settles_before_return(self):
        self.register(self.event(delta=900_000))
        result = m.TimeScheduleCalendar.advance(self.state, self.request())
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(self.state.scheduled_event["event"]["state"], "SETTLED")

    def test_phase_zero_receipt_visible_at_deadline(self):
        self.register(self.event(eid="z-completion", delta=60_000, kind="ActionCompleted", owner="employment"))
        self.register(self.event(eid="a-deadline", delta=60_000, kind="DeadlineTriggered", owner="employment"))
        original = m.request_employment
        phases = []
        def adapter(operation, payload):
            if operation == "handle_due_batch":
                phases.append(payload["phase"])
                if payload["phase"] == 2:
                    self.assertTrue(payload["settled_receipt_refs"])
            return original(operation, payload)
        with patch.object(m, "request_employment", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request(60_000))
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(phases, [0, 2])

    def test_barrier_at_target_preserves_agency_and_privacy(self):
        self.register(self.event(delta=900_000))
        original = m.request_communication
        def adapter(operation, payload):
            response = original(operation, payload)
            if operation == "handle_due_batch":
                response["results"][0]["barrier"] = {"cause": "private caller"}
                response["results"][0]["observation_refs"] = ["secret:name"]
            return response
        with patch.object(m, "request_communication", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request())
        self.assertEqual(result["status"], "PAUSED")
        self.assertEqual(result["elapsed_ms"], 900_000)
        self.assertNotIn("secret", json.dumps(result))
        self.assertNotIn("private caller", json.dumps(result))

    def test_past_event_and_client_phase_rejected(self):
        for event in (self.event(delta=-1000), self.event() | {"phase": 3}):
            with self.assertRaises(m.TemporalError):
                self.register(event)

    def test_cancellation_tombstone_and_idempotent_registration(self):
        event = self.event()
        self.register(event)
        m.TimeScheduleCalendar.cancel_event(self.state, {"event_id": "event", "credential": "mock:owner:communication",
                                                       "reason": "owner cancelled", "source_ref": "cancellation"})
        self.register(event)
        self.assertEqual(self.state.scheduled_event["event"]["state"], "CANCELLED")

    def test_domain_outage_and_recovery_no_reintegration(self):
        original = m.request_health
        failed = False
        commits = []
        def adapter(operation, payload):
            nonlocal failed
            if operation == "commit_interval":
                commits.append(payload["idempotency_key"])
            if operation == "prepare_interval" and not failed:
                failed = True
                return {"available": False}
            return original(operation, payload)
        request = self.request()
        with patch.object(m, "request_health", adapter):
            first = m.TimeScheduleCalendar.advance(self.state, request)
            self.assertEqual(first["status"], "RECOVERY_REQUIRED")
            self.assertEqual(first["elapsed_ms"], 0)
            fresh = m.TimeScheduleCalendar.advance(self.state, self.request(command_id="other"))
            self.assertEqual(fresh["error"]["code"], "RECOVERY_PENDING")
            self.state = m.TimeScheduleCalendar.import_state(m.TimeScheduleCalendar.export_state(self.state))
            result = m.TimeScheduleCalendar.recover(self.state, request | {"advance_id": first["advance_id"]})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(len(commits), 1)
        m.TimeScheduleCalendar.validate_state(self.state)

    def test_commit_loss_receipt_lookup(self):
        original = m.request_health
        accepted = {}
        calls = 0
        def adapter(operation, payload):
            nonlocal calls
            if operation == "commit_interval":
                calls += 1
                accepted[payload["idempotency_key"]] = payload | {"status": "COMMITTED"}
                raise TimeoutError()
            if operation == "receipt_lookup" and payload["idempotency_key"] in accepted:
                return {"available": True, "found": True, "receipt": accepted[payload["idempotency_key"]]}
            return original(operation, payload)
        request = self.request()
        with patch.object(m, "request_health", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, request)
            self.assertEqual(result["status"], "RECOVERY_REQUIRED")
            result = m.TimeScheduleCalendar.recover(self.state, request | {"advance_id": result["advance_id"]})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(calls, 1)

    def test_earlier_boundary_split(self):
        original = m.request_health
        def adapter(operation, payload):
            response = original(operation, payload)
            if operation == "prepare_interval" and payload["start_ms"] < self.start + 60_000 < payload["end_ms"]:
                response["earlier_boundary_ms"] = self.start + 60_000
            return response
        with patch.object(m, "request_health", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request())
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(sorted(s["end_ms"] - s["start_ms"] for s in self.state.temporal_segment.values()), [60_000, 840_000])

    def test_horizon_preserves_action_and_continuation(self):
        first = m.TimeScheduleCalendar.advance(self.state, self.request(10_000, kind="execute_action", activity_ref="task"))
        self.assertEqual(first["status"], "PAUSED")
        self.assertEqual(first["elapsed_ms"], 10_000)
        second = m.TimeScheduleCalendar.advance(self.state, self.request(20_000, command_id="continue", kind="execute_action",
            activity_ref="task", continuation_of=first["progress_ref"]))
        self.assertEqual(second["status"], "COMPLETED")
        self.assertEqual(second["elapsed_ms"], 20_000)

    def test_save_reload_rejects_unknown_fields_or_missing_receipt(self):
        m.TimeScheduleCalendar.advance(self.state, self.request())
        snapshot = m.TimeScheduleCalendar.export_state(self.state)
        self.assertEqual(snapshot, m.TimeScheduleCalendar.export_state(m.TimeScheduleCalendar.import_state(snapshot)))
        snapshot["world_clock"]["health"] = 5
        with self.assertRaises(m.TemporalError):
            m.TimeScheduleCalendar.import_state(snapshot)
        snapshot = m.TimeScheduleCalendar.export_state(self.state)
        next(iter(snapshot["owner_interval_receipt"].values()))["end_ms"] += 1
        with self.assertRaises(m.TemporalError):
            m.TimeScheduleCalendar.import_state(snapshot)

    def test_fork_keeps_history_and_new_future_namespace(self):
        snapshot = m.TimeScheduleCalendar.export_state(self.state)
        self.register(self.event(eid="future", delta=1_800_000))
        m.TimeScheduleCalendar.advance(self.state, self.request())
        branch = m.TimeScheduleCalendar.fork(self.state, {"branch_id": "alternate", "credential": "mock:owner:persistence"})
        self.assertEqual(branch.world_clock["instant_ms"], self.start + 900_000)
        self.assertEqual(branch.scheduled_event["future"]["branch_id"], "alternate")
        rewound = m.TimeScheduleCalendar.fork(self.state, {"branch_id": "rewound", "credential": "mock:owner:persistence", "snapshot": snapshot})
        self.assertEqual(rewound.world_clock["instant_ms"], self.start)
        self.assertEqual(self.state.world_clock["instant_ms"], self.start + 900_000)

    def test_racing_commands_one_wins(self):
        results = []
        requests = [self.request(command_id=str(i)) for i in range(2)]
        threads = [threading.Thread(target=lambda req=req: results.append(m.TimeScheduleCalendar.advance(self.state, req))) for req in requests]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(sum(r["status"] == "COMPLETED" for r in results), 1)
        self.assertEqual(self.state.world_clock["instant_ms"], self.start + 900_000)

    def test_recurrence_idempotent_and_pinned(self):
        self.schedule(self.rule())
        self.expand()
        original = copy.deepcopy(self.state.schedule_occurrence)
        self.expand()
        self.assertEqual(original, self.state.schedule_occurrence)
        self.schedule(self.rule(schedule_version="2", revision=2, recurrence_payload={"time": "10:00:00"}))
        self.expand()
        self.assertEqual(original, self.state.schedule_occurrence)

    def test_exception_precedence(self):
        self.schedule(self.rule())
        local_day = m.TimeScheduleCalendar.project_clock(self.state)["date"]
        for kind, override in (("holiday_policy", {"closed": True}), ("date_specific_override", {"closed": False})):
            m.TimeScheduleCalendar.register_exception(self.state, {"credential": "mock:owner:employment", "exception": {
                "exception_id": kind, "schedule_ref": "shift", "version": "1", "kind": kind,
                "affected_date_or_occurrence": local_day, "override_payload": override,
                "reason": "fixture", "source_ref": "fixture", "visibility_ref": "private"}})
        self.expand(m.DAY)
        self.assertTrue(all(o["status"] == "SCHEDULED" for o in self.state.schedule_occurrence.values()))

    def test_long_wait_expands_in_chunks(self):
        self.schedule(self.rule())
        result = m.TimeScheduleCalendar.advance(self.state, self.request(16 * m.DAY))
        self.assertEqual(result["status"], "COMPLETED")
        self.assertGreaterEqual(len(self.state.schedule_occurrence), 16)
        self.assertFalse(any(e["state"] == "PENDING" and e["due_ms"] <= self.state.world_clock["instant_ms"]
                             for e in self.state.scheduled_event.values()))

    def test_dst_leap_and_duration_formulas(self):
        zone = m.pinned_zone("America/Los_Angeles", m.PINNED_TZDATA)
        spring = m.resolve_local("2012-03-11T01:59:59", zone)
        self.assertEqual(m.utc(spring + 1000).astimezone(zone).isoformat(), "2012-03-11T03:00:00-07:00")
        fall = m.resolve_local("2012-11-04T01:59:59", zone)
        self.assertEqual(m.utc(fall + 1000).astimezone(zone).isoformat(), "2012-11-04T01:00:00-08:00")
        gap = m.resolve_local("2012-03-11T02:30:00", zone)
        self.assertEqual(m.utc(gap).astimezone(zone).hour, 3)
        self.assertEqual(m.utc(gap).astimezone(zone).minute, 30)
        first = m.resolve_local("2012-11-04T01:30:00", zone)
        second = m.resolve_local("2012-11-04T01:30:00", zone, fold="second_occurrence")
        self.assertEqual(second-first, 3_600_000)
        self.assertEqual(m.resolve_local("2012-03-12T00:00:00", zone)-m.resolve_local("2012-03-11T00:00:00", zone), 23*3_600_000)
        self.assertEqual(m.resolve_local("2012-11-05T00:00:00", zone)-m.resolve_local("2012-11-04T00:00:00", zone), 25*3_600_000)
        self.assertTrue(m.TimeScheduleCalendar._matches(self.rule(recurrence_kind="annual", recurrence_payload={"month":2,"day":29}), date(2012,2,29)))
        self.assertTrue(m.TimeScheduleCalendar._matches(self.rule(recurrence_kind="annual", recurrence_payload={"month":2,"day":29}), date(2013,2,28)))
        self.assertEqual(m.duration_ms("speech", m.DEFAULTS, text=" ".join(["word"]*25)), 12_000)
        self.assertEqual(m.interval_union([[0,10], [5,15], [15,20]]), 20)
        self.assertTrue(m.TimeScheduleCalendar.cutoff_matches(10, 10, "inclusive"))
        self.assertFalse(m.TimeScheduleCalendar.cutoff_matches(10, 10, "exclusive"))

    def test_past_target_never_silently_tomorrow(self):
        req = self.request(kind="wait_until_local_time", local_target={"datetime":"2011-01-01T08:00:00"})
        result = m.TimeScheduleCalendar.advance(self.state, req)
        self.assertEqual(result["error"]["code"], "CHOICE_REQUIRED")
        self.assertEqual(self.state.world_clock["instant_ms"], self.start)

    def test_causal_loop_preserves_events_and_clock(self):
        self.register(self.event(delta=0))
        original = m.request_communication
        def adapter(operation, payload):
            response = original(operation, payload)
            if operation == "handle_due_batch":
                for result in response["results"]:
                    result["new_events"] = [self.event(eid="next:"+result["event_id"], delta=0)
                                            | {"source_event_id": result["event_id"]}]
            return response
        with patch.object(m, "request_communication", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request())
        self.assertEqual(result["status"], "RECOVERY_REQUIRED")
        self.assertEqual(result["elapsed_ms"], 0)
        self.assertEqual(sum(e["state"] == "PENDING" for e in self.state.scheduled_event.values()), 1)
        self.assertEqual(next(iter(self.state.time_trace.values()))["microstep_count"], 128)

    def reservation(self, rid="booking", start=0, end=60_000, slots=None, **changes):
        value = {"reservation_id": rid, "branch_id": "main", "resource_id": "mock:resource",
                 "owner_activity_id": rid, "source_intent_ref": "owner:plan", "owner_domain": "institutions",
                 "version": "1", "revision": 0, "start_ms": self.start + start, "end_ms": self.start + end,
                 "exclusivity_class": "exclusive", "actor_slots": slots or [], "attention_requirements": {},
                 "load_requirements": {}, "capacity_requirements": {"units": 1, "capacity": 1},
                 "status": "ACTIVE", "release_policy_ref": "mock:release"}
        value.update(changes)
        return value

    def reserve(self, reservation):
        return m.TimeScheduleCalendar.reserve(self.state, {"reservation": reservation, "credential": "mock:owner:institutions"})

    def test_reservations_half_open_and_exclusive(self):
        self.reserve(self.reservation(slots=["locomotion"]))
        self.reserve(self.reservation("handoff", 60_000, 120_000, ["locomotion"]))
        with self.assertRaises(m.TemporalError):
            self.reserve(self.reservation("overlap", 10_000, 20_000, ["focused_attention"]))
        with self.assertRaises(m.TemporalError):
            self.reserve(self.reservation("sleep", 10_000, 20_000, ["sleep_rest"]))

    def test_shared_capacity_is_peak_not_sum_of_nonoverlaps(self):
        common = {"exclusivity_class": "compatible", "attention_requirements": {"compatibility_ref": "mock:shared"},
                  "capacity_requirements": {"units": 1, "capacity": 2}}
        self.reserve(self.reservation("first", 0, 20_000, **common))
        self.reserve(self.reservation("second", 20_000, 40_000, **common))
        self.reserve(self.reservation("spanning", 0, 40_000, **common))
        with self.assertRaises(m.TemporalError):
            self.reserve(self.reservation("third", 10_000, 30_000, **common))

    def test_tentative_plan_does_not_force_attendance(self):
        self.reserve(self.reservation(status="TENTATIVE", resource_id="mock:pc"))
        result = m.TimeScheduleCalendar.advance(self.state, self.request())
        self.assertEqual(result["status"], "COMPLETED")
        m.TimeScheduleCalendar.validate_state(self.state)

    def test_same_instant_child_completion_before_deadline(self):
        self.register(self.event("parent", 60_000, "ActionCompleted", "employment"))
        self.register(self.event("deadline", 60_000, "DeadlineTriggered", "employment"))
        original = m.request_employment
        order = []
        def adapter(operation, payload):
            response = original(operation, payload)
            if operation == "handle_due_batch":
                for result in response["results"]:
                    order.append(result["event_id"])
                    if result["event_id"] == "parent":
                        result["new_events"] = [self.event("child", 60_000, "ActionCompleted", "employment")
                                                | {"source_event_id": "parent"}]
            return response
        with patch.object(m, "request_employment", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request(60_000))
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(order, ["parent", "child", "deadline"])

    def test_recovery_does_not_spend_causal_microsteps(self):
        self.register(self.event("event", 0))
        original = m.request_communication
        def unavailable(operation, payload):
            if operation == "handle_due_batch":
                raise TimeoutError()
            return original(operation, payload)
        request = self.request()
        with patch.object(m, "request_communication", unavailable):
            result = m.TimeScheduleCalendar.advance(self.state, request)
            for _ in range(3):
                result = m.TimeScheduleCalendar.recover(self.state, request | {"advance_id": result["advance_id"]})
        self.assertEqual(next(iter(self.state.time_trace.values()))["microstep_count"], 1)
        self.assertEqual(result["status"], "RECOVERY_REQUIRED")
        with self.assertRaises(m.TemporalError):
            m.TimeScheduleCalendar.fork(self.state, {"credential": "mock:owner:persistence", "branch_id": "bad-fork"})
        result = m.TimeScheduleCalendar.recover(self.state, request | {"advance_id": result["advance_id"]})
        self.assertEqual(result["status"], "COMPLETED")

    def test_repeated_registration_after_original_due_is_idempotent(self):
        event = self.event()
        self.register(event)
        m.TimeScheduleCalendar.advance(self.state, self.request())
        self.assertEqual(self.register(event)["state"], "SETTLED")

    def test_inclusive_deadline_uses_owner_evidence(self):
        self.register(self.event("completion", 60_000, "ActionCompleted", "employment"))
        deadline = {"deadline_id": "deadline", "owner_domain": "employment", "source_ref": "owner:contract",
                    "version": "1", "resolved_instant_ms": self.start + 60_000, "cutoff_policy": "inclusive",
                    "owner_predicate_ref": "owner:completed", "consequence_owner_ref": "employment",
                    "grace_interval_refs": [], "accepted_extension_refs": [], "trigger_identity": "deadline-event",
                    "trigger_state": "PENDING", "completion_evidence_refs": [], "consequence_receipt_refs": [],
                    "visibility_ref": "private"}
        m.TimeScheduleCalendar.register_deadline(self.state, {"credential": "mock:owner:employment", "deadline": deadline})
        original = m.request_employment
        def adapter(operation, payload):
            response = original(operation, payload)
            if operation == "deadline_evidence":
                self.assertTrue(payload["settled_receipt_refs"])
                response.update(eligible=True, completed_at=self.start + 60_000, completion_evidence_refs=["mock:completion"])
            if operation == "handle_due_batch" and payload["phase"] == 2:
                self.assertTrue(payload["deadline_checks"]["deadline-event"]["satisfied"])
            return response
        with patch.object(m, "request_employment", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request(60_000))
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(self.state.deadline["deadline"]["trigger_state"], "MET")

    def test_zero_time_work_cannot_generate_effort(self):
        original = m.request_system_1
        def adapter(operation, payload):
            result = original(operation, payload)
            if operation == "duration":
                result.update(resolved_duration_ms=0, profile_ref="room_search")
            return result
        with patch.object(m, "request_system_1", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request(kind="execute_action", activity_ref="task"))
        self.assertEqual(result["error"]["code"], "INVALID_DURATION")
        self.assertFalse(self.state.owner_interval_receipt)

    def test_outbox_retry_does_not_publish_twice(self):
        m.TimeScheduleCalendar.advance(self.state, self.request())
        first = m.TimeScheduleCalendar.flush_outbox(self.state, {"credential": "mock:owner:persistence"})
        self.assertTrue(first["delivered_refs"])
        second = m.TimeScheduleCalendar.flush_outbox(self.state, {"credential": "mock:owner:persistence"})
        self.assertFalse(second["delivered_refs"])

    def test_bad_json_shapes_return_typed_errors(self):
        for request in ([], None, {}, self.request(command_id=123), self.request(duration_ms="one minute")):
            self.assertEqual(m.TimeScheduleCalendar.advance(self.state, request)["status"], "ERROR")

    def test_cancel_prepared_interval_without_time_or_effects(self):
        original = m.request_health
        def unavailable(operation, payload):
            if operation == "prepare_interval":
                return {"available": False}
            return original(operation, payload)
        request = self.request()
        with patch.object(m, "request_health", unavailable):
            result = m.TimeScheduleCalendar.advance(self.state, request)
        continuation = request | {"advance_id": result["advance_id"]}
        m.TimeScheduleCalendar.cancel_advance(self.state, continuation)
        result = m.TimeScheduleCalendar.recover(self.state, continuation)
        self.assertEqual(result["elapsed_ms"], 0)
        self.assertEqual(result["stop_reason"]["code"], "CANCELLED")
        self.assertTrue(all(s["state"] == "ABORTED" for s in self.state.temporal_segment.values()))

    def test_admitted_action_completes_in_phase_zero(self):
        self.register(self.event("deadline", 30_000, "DeadlineTriggered", "employment"))
        original = m.request_employment
        def adapter(operation, payload):
            if operation == "handle_due_batch" and payload["phase"] == 2:
                self.assertEqual(self.state.duration_contract["task"]["activity_state"], "COMPLETED")
                self.assertTrue(payload["settled_receipt_refs"])
            return original(operation, payload)
        with patch.object(m, "request_employment", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request(30_000, kind="execute_action", activity_ref="task"))
        self.assertEqual(result["status"], "COMPLETED")

    def test_paused_activity_cannot_complete_later_without_authorization(self):
        self.register(self.event("interrupt", 10_000))
        original = m.request_communication
        def adapter(operation, payload):
            response = original(operation, payload)
            if operation == "handle_due_batch":
                response["results"][0]["barrier"] = {"code": "CHOICE"}
            return response
        with patch.object(m, "request_communication", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, self.request(60_000, kind="execute_action", activity_ref="task"))
        self.assertEqual(result["elapsed_ms"], 10_000)
        self.assertEqual(result["status"], "PAUSED")
        result = m.TimeScheduleCalendar.advance(self.state, self.request(60_000, command_id="wait-instead"))
        self.assertEqual(result["status"], "COMPLETED")
        self.assertNotEqual(self.state.duration_contract["task"]["activity_state"], "COMPLETED")

    def test_action_completion_lost_acknowledgment(self):
        original = m.request_system_1
        accepted, count = {}, 0
        def adapter(operation, payload):
            nonlocal count
            if operation == "receipt_lookup" and payload["idempotency_key"] in accepted:
                return {"available": True, "found": True, "result": accepted[payload["idempotency_key"]]}
            response = original(operation, payload)
            if operation == "handle_due_batch":
                count += 1
                for result in response["results"]:
                    accepted[payload["idempotency_keys"][result["event_id"]]] = result
                raise TimeoutError()
            return response
        request = self.request(30_000, kind="execute_action", activity_ref="task")
        with patch.object(m, "request_system_1", adapter):
            result = m.TimeScheduleCalendar.advance(self.state, request)
            self.assertEqual(result["status"], "RECOVERY_REQUIRED")
            result = m.TimeScheduleCalendar.recover(self.state, request | {"advance_id": result["advance_id"]})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(count, 1)

    def test_npc_replan_throttle_is_temporal_only(self):
        first = self.event("replan", 0, "NPCReplan", "system6")
        first["payload_json"]["actor_ref"] = "mock:npc"
        self.register(first)
        second = self.event("too-soon", 60_000, "NPCReplan", "system6")
        second["payload_json"]["actor_ref"] = "mock:npc"
        second["source_event_id"] = "another-cause"
        with self.assertRaises(m.TemporalError):
            self.register(second)
        second["payload_json"]["urgent"] = True
        self.register(second)

    def test_exhausted_failed_activity_cannot_retry_for_free(self):
        original = m.request_system_1
        def adapter(operation, payload):
            response = original(operation, payload)
            if operation == "handle_due_batch":
                for result in response["results"]:
                    result["activity_state"] = "FAILED"
            return response
        with patch.object(m, "request_system_1", adapter):
            first = m.TimeScheduleCalendar.advance(self.state, self.request(30_000, kind="execute_action", activity_ref="task"))
            self.assertEqual(first["status"], "PAUSED")
            second = m.TimeScheduleCalendar.advance(self.state, self.request(30_000, command_id="retry", kind="execute_action",
                activity_ref="task", continuation_of=first["progress_ref"]))
        self.assertEqual(second["status"], "ERROR")
        self.assertEqual(self.state.world_clock["instant_ms"], self.start + 30_000)


if __name__ == "__main__":
    unittest.main()
