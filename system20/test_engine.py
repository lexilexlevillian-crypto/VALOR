"""Run: python -m unittest system20.test_engine -v.

Fixtures are static foreign JSON payloads. They do not implement foreign state.
"""

from copy import deepcopy
import json
import unittest

from .engine import OPERATIONS, QUERIES, REQUIRED_RECEIPT_FLAGS, digest, main_state_machine, new_state, ordered_events, rule_ref
from .schema import FIELDS


class Harness:
    def __init__(self):
        self.state = new_state()
        self.serial = 0
        self.actor = "worker:1"
        self.now = "2012-10-11T12:00:00Z"
        self.rules = {}
        operations = {name: {} for name in OPERATIONS}
        operations.update({
            "QueueResponse": {"initial_states": ["queued"]},
            "AssignResponse": {"transitions": {"queued": ["assigned"], "deferred": ["assigned"]}},
            "BeginTravel": {"transitions": {"assigned": ["en_route"]}},
            "ArriveResponse": {"transitions": {"en_route": ["on_scene"]}},
            "FinishResponse": {"transitions": {"on_scene": ["completed", "deferred"], "queued": ["deferred"]}},
            "OpenCase": {"initial_states": ["open"]},
            "StartCustody": {"initial_states": ["controlled"]},
            "Transport": {"transitions": {"controlled": ["transporting"]}},
            "BookArrival": {"transitions": {"controlled": ["booked"], "transporting": ["booked"]}},
            "IssueOrder": {"initial_states": ["issued"]},
            "CancelOrder": {"transitions": {"issued": ["cancelled"]}},
            "ExecuteRelease": {"transitions": {"booked": ["released"], "controlled": ["released"]}},
            "CreateObligation": {"initial_states": ["due"]},
            "ReviewObligation": {"transitions": {"due": ["satisfied"]}},
            "FileCharges": {"transitions": {"open": ["charged"]}},
            "ScreenCase": {"transitions": {"open": ["declined", "deferred"]}},
            "RecordFinding": {"finding_models": {"conviction": {"all": [{"path": "act", "equals": "taking"}, {"path": "intent", "equals": True}]} }},
        })
        for name in {"FileCharges", "ReviewApplication", "ReviewObligation", "Sentence", "IssueOrder", "ScreenCase"}:
            operations[name]["condition"] = {"path": "specific_basis", "equals": True}
        policy = {key: self.add_rule({}) for key in FIELDS["legal_manifest"]}
        policy.update({
            "version": "fictional:1", "jurisdiction_refs": ["valor"],
            "effective_period": {"start": "2012-01-01T00:00:00Z", "end": "2013-01-01T00:00:00Z"},
            "enabled_offense_families": ["property"],
            "procedural_standards": self.add_rule({"operations": operations}),
            "authority_policies": self.add_rule({"actions": {
                action: {"elements": {"specific_basis": {"path": "specific_basis", "equals": True}}}
                for action in {"arrest", "restrain", "transport", "booking", "search", "seize", "detain", "contact", "execute_order"}
            }}),
            "review_and_deadline_policies": self.add_rule({"intake_review_ref": "review:intake", "intake_overdue_ref": "escalate:intake", "custody_review_ref": "review:custody", "custody_overdue_ref": "escalate:custody", "dispatch_review_ref": "review:dispatch", "dispatch_overdue_ref": "escalate:dispatch"}),
            "order_and_condition_types": self.add_rule({"enabled_types": ["release", "arrest", "restitution"], "active_states": ["issued"], "expired_state": "expired", "release_types": ["release"], "custody_blocking_types": ["arrest"], "release_satisfied_obligation_states": ["satisfied"]}),
            "scenario_generation_controls": self.add_rule({"enabled_misconduct_operations": ["StartCustody"]}),
            "count_combination_rules": self.add_rule({"mutually_exclusive": []}),
            "technology_capabilities": self.add_rule({"communication_channels": ["phone", "in_person"], "search_methods": ["physical"], "recording_methods": ["audio"]}),
        })
        elements = self.add_rule({"family": "property", "trigger": {"path": "act", "equals": "taking"}, "elements": {"taking": {"path": "act", "equals": "taking"}, "intent": {"path": "intent", "equals": True}}, "mental_elements": ["intent"]})
        definition = {"id": "offense:theft:fictional:1", "jurisdiction": "valor", "effective_from": policy["effective_period"]["start"], "effective_to": None, "elements_ref": elements, "defenses_ref": self.add_rule({"elements": {}}), "source_kind": "fictional_valor_rule", "version": "fictional:1"}
        self.fixtures = {
            "system_13": {"snapshot": {"actor_ref": self.actor, "authority_kind": "content_admin", "permitted_operations": [*OPERATIONS, *QUERIES, "InstallManifest", "ClassifyConduct", "AcquireInformation", "ReceiveReport", "AssessAuthority", "ResumeWorkflow", "ResolveChoice", "Tick", "CompleteReview"], "available": True, "institution_ref": "police", "jurisdiction_ref": "valor", "units": {"unit:1": {"available": True, "compatible": True}}}},
            "system_11": {"snapshot": {}},
            "content_manifests": {"snapshot": {"manifests": {"fictional:1": policy}, "rules": self.rules, "offense_definitions": [definition]}},
            "knowledge": {"snapshot": {"actor_ref": self.actor, "facts": {}, "acquisitions": {}, "read_grants": {}, "known_identity_refs": ["unknown-description:1"]}},
            "system_16": {"snapshot": {"deliveries": {}}},
        }
        self.ok("InstallManifest", {})
        self.fixtures["system_13"]["snapshot"]["authority_kind"] = "simulation"

    def add_rule(self, body):
        ref = rule_ref(body)
        self.rules[ref] = deepcopy(body)
        return ref

    def command(self, operation, data, key=None):
        self.serial += 1
        return {"operation": operation, "policy_version": "fictional:1", "data": deepcopy(data), "mutation_context": {
            "actor_or_system_authority": self.actor, "expected_revision": len(self.state["legal_event"]),
            "canonical_timestamp": self.now, "correlation_id": "correlation:" + str(self.serial), "idempotency_key": key or "command:" + str(self.serial),
        }}

    def sync_clock(self):
        self.fixtures["system_11"]["snapshot"] = {
            "canonical_timestamp": self.now,
            "causal_predecessor_ref": ordered_events(self.state)[-1]["id"] if self.state["legal_event"] else None,
            "next_shift_boundary": "2012-10-12T20:00:00Z", "next_daily_review": "2012-10-13T12:00:00Z",
        }

    def run(self, operation, data):
        self.sync_clock()
        command = self.command(operation, data)
        result = main_state_machine(self.state, command, self.fixtures)
        self.state = result["state"]
        return result

    def ok(self, operation, data):
        result = self.run(operation, data)
        assert result["result"]["status"] != "rejected", result["result"]
        return result

    def acquire(self, ref="fact:1", values=None):
        knowledge = self.fixtures["knowledge"]["snapshot"]
        knowledge["facts"][ref] = {"holder_ref": self.actor, "source_ref": "source:" + ref, "occurred_at": self.now, "acquired_at": self.now, "values": values or {"specific_basis": True}, "scope": {"target_ref": "person:1", "jurisdiction": "valor"}}
        knowledge["acquisitions"][ref] = {"kind": "observation", "committed": True, "association": {"holder_ref": self.actor, "observation_refs": [ref], "original_source_refs": ["source:" + ref], "acquired_at": self.now}}
        self.ok("AcquireInformation", {"acquisition_ref": ref})

    def authority(self, action="arrest", facts=None):
        scope = {"action": action, "target_ref": "person:1", "jurisdiction": "valor"}
        result = self.ok("AssessAuthority", {"scope": scope, "basis_refs": facts if facts is not None else ["fact:1"]})
        return result["result"]["record_id"], scope

    def report(self, delivery="delivery:1"):
        self.fixtures["system_16"]["snapshot"]["deliveries"][delivery] = {"delivered": True, "recipient_ref": "police", "received_at": self.now, "incident_or_allegation_ref": "allegation:1", "delivered_content_ref": "content:partial", "channel": "phone"}
        return self.ok("ReceiveReport", {"delivery_ref": delivery})["result"]["record_id"]

    def queue(self, identifier="response:1"):
        report = self.report()
        return self.ok("QueueResponse", {"record_id": identifier, "record": {"id": identifier, "report_ref": report, "priority": "routine", "assigned_unit": None, "queued_at": self.now, "status": "queued", "next_review_at": "2012-10-12T20:00:00Z"}})

    def receipt(self, request, fields=None, **extra):
        receipt = {"status": "committed", "idempotency_key": request["idempotency_key"], "request_hash": request["request_hash"], "event_ref": "external:" + request["idempotency_key"], "occurred_at": self.now, "actor_ref": self.actor, "scope": request["payload"].get("scope", {}), "field_values": fields or {}, **extra}
        flag = REQUIRED_RECEIPT_FLAGS.get((request["payload"]["operation"], request["owner"]))
        if flag:
            receipt[flag] = True
        if request["owner"] == "system_16":
            receipt["delivered"] = True
        self.fixtures.setdefault(request["owner"], {}).setdefault("receipts", {})[request["idempotency_key"]] = receipt
        return receipt

    def custody(self):
        self.acquire()
        authority, scope = self.authority()
        record = {"id": "custody:1", "subject_ref": "person:1", "asserted_basis": {"authority_ref": authority}, "actual_control_ref": "control:1", "facility_ref": None, "started_at": self.now, "status": "controlled", "next_review_at": "2012-10-13T12:00:00Z"}
        pending = self.ok("StartCustody", {"record_id": record["id"], "record": record, "authority_ref": authority, "scope": scope})
        self.receipt(pending["external_requests"][0], {"actual_control_ref": "control:1"})
        self.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        return record

    def order(self, identifier="order:release", kind="release", conditions=None, expires=None):
        if "fact:1" not in self.fixtures["knowledge"]["snapshot"]["facts"]:
            self.acquire()
        scope = {"action": kind, "target_ref": "person:1", "jurisdiction": "valor", "condition_refs": conditions or []}
        application_id = "application:" + identifier
        pending = self.ok("RequestOrder", {"record_id": application_id, "record": {"application_ref": "submission:" + identifier, "applicant_ref": self.actor, "order_jurisdiction": "valor"}, "scope": scope})
        self.receipt(pending["external_requests"][0])
        self.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.ok("ReviewApplication", {"record_id": application_id, "record": {"review_decision": "approve"}, "scope": scope, "basis_refs": ["fact:1"]})
        order = {"id": identifier, "type": kind, "issuer_ref": self.actor, "subject_ref": "person:1", "scope_ref": self.add_rule(scope), "effective_at": self.now, "expires_at": expires, "status": "issued", "basis_refs": ["fact:1"]}
        return self.ok("IssueOrder", {"record_id": identifier, "record": order, "details": {"application_ref": application_id}, "basis_refs": ["fact:1"]})

    def release(self):
        self.custody()
        self.order()
        return self.ok("ExecuteRelease", {"record_id": "custody:1", "record": {"status": "released", "facility_ref": None, "actual_control_ref": None}, "order_ref": "order:release", "scope": {"action": "release", "target_ref": "person:1", "jurisdiction": "valor"}})


class System20Tests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()

    def test_only_declared_state_variables(self):
        self.assertEqual(set(self.h.state), {"domain", "mutation_context", *FIELDS})
        self.assertEqual(json.loads(json.dumps(self.h.state)), self.h.state)

    def test_unauthorized_no_mutation(self):
        old = deepcopy(self.h.state)
        self.h.fixtures["system_13"]["snapshot"]["permitted_operations"] = []
        result = self.h.run("Tick", {})
        self.assertEqual(result["result"]["code"], "not_authorized")
        self.assertEqual(old, self.h.state)

    def test_revision_guard(self):
        self.h.sync_clock()
        command = self.h.command("Tick", {})
        command["mutation_context"]["expected_revision"] = 0
        result = main_state_machine(self.h.state, command, self.h.fixtures)
        self.assertEqual(result["result"]["code"], "revision_conflict")

    def test_idempotency_and_conflict(self):
        self.h.sync_clock()
        command = self.h.command("Tick", {})
        first = main_state_machine(self.h.state, command, self.h.fixtures)
        second = main_state_machine(first["state"], command, self.h.fixtures)
        self.assertEqual(first["state"], second["state"])
        command["data"] = {"different": True}
        conflict = main_state_machine(first["state"], command, self.h.fixtures)
        self.assertEqual(conflict["result"]["code"], "idempotency_conflict")

    def test_no_call_delivery_no_report(self):
        result = self.h.run("ReceiveReport", {"delivery_ref": "dead-phone"})
        self.assertEqual(result["result"]["code"], "report_not_delivered")
        self.assertFalse(self.h.state["report"])

    def test_received_allegation_does_not_create_truth_or_identity(self):
        identifier = self.h.report()
        self.assertFalse(self.h.state["incident"])
        self.assertIsNone(self.h.state["report"][identifier]["reporter_ref"])
        self.assertEqual(self.h.state["report"][identifier]["content_ref"], "content:partial")
        self.h.report()
        self.assertEqual(len(self.h.state["report"]), 1)

    def test_hidden_conduct_does_not_inform_police(self):
        self.h.fixtures["evidence"] = {"snapshot": {"conduct": {"conduct:1": {"committed": True, "event_refs": ["external:conduct"], "occurred_at": self.h.now, "jurisdiction": "valor", "facts": {"act": "taking", "intent": True}, "location_ref": "place:1", "restricted_truth_ref": "truth:1"}}}}
        self.h.ok("ClassifyConduct", {"conduct_ref": "conduct:1"})
        candidate = next(iter(self.h.state["offense_candidate"].values()))
        self.assertEqual(candidate["unresolved_elements"], ["intent"])
        self.assertFalse(self.h.state["information_and_evidence_association"])
        self.assertFalse(self.h.state["report"])

    def test_authority_uses_acquired_facts(self):
        missing = self.h.run("AssessAuthority", {"scope": {"action": "arrest", "target_ref": "person:1", "jurisdiction": "valor"}, "basis_refs": ["hidden"]})
        self.assertEqual(missing["result"]["code"], "basis_not_acquired")
        identifier, _ = self.h.authority(facts=[])
        self.assertEqual(self.h.state["authority_assessment"][identifier]["conclusion"], "unresolved")

    def test_contradictory_evidence_not_averaged(self):
        self.h.acquire("fact:1", {"specific_basis": True})
        self.h.acquire("fact:2", {"specific_basis": False})
        identifier, _ = self.h.authority(facts=["fact:1", "fact:2"])
        self.assertEqual(self.h.state["authority_assessment"][identifier]["conclusion"], "unresolved")

    def test_dispatch_requires_travel_receipt(self):
        self.h.queue()
        self.h.ok("AssignResponse", {"record_id": "response:1", "record": {"assigned_unit": "unit:1", "status": "assigned"}})
        invalid = self.h.run("ArriveResponse", {"record_id": "response:1", "record": {"status": "on_scene"}})
        self.assertEqual(invalid["result"]["status"], "rejected")
        pending = self.h.ok("BeginTravel", {"record_id": "response:1", "record": {"status": "en_route"}})
        self.assertEqual(self.h.state["response_task"]["response:1"]["status"], "assigned")
        self.h.receipt(pending["external_requests"][0])
        done = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(done["result"]["status"], "completed")
        self.assertEqual(self.h.state["response_task"]["response:1"]["status"], "en_route")

    def test_busy_unit_cannot_be_assigned_twice(self):
        self.h.queue("response:1")
        self.h.queue("response:2")
        self.h.ok("AssignResponse", {"record_id": "response:1", "record": {"assigned_unit": "unit:1", "status": "assigned"}})
        result = self.h.run("AssignResponse", {"record_id": "response:2", "record": {"assigned_unit": "unit:1", "status": "assigned"}})
        self.assertEqual(result["result"]["code"], "unit_already_assigned")

    def test_arrest_is_not_teleport(self):
        record = self.h.custody()
        self.assertIsNone(self.h.state["custody"][record["id"]]["facility_ref"])
        self.assertEqual(self.h.state["custody"][record["id"]]["actual_control_ref"], "control:1")

    def test_receipt_binding_rejects_forgery_without_losing_pending_task(self):
        self.h.queue()
        self.h.ok("AssignResponse", {"record_id": "response:1", "record": {"assigned_unit": "unit:1", "status": "assigned"}})
        pending = self.h.ok("BeginTravel", {"record_id": "response:1", "record": {"status": "en_route"}})
        receipt = self.h.receipt(pending["external_requests"][0])
        receipt["request_hash"] = "wrong"
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "pending")
        step = self.h.state["deadline_and_durable_workflow"][pending["result"]["workflow_ref"]]["pending_steps"][0]
        self.assertEqual(step["status"], "receipt_requires_review")

    def test_partial_booking_retains_arrival_if_inventory_unavailable(self):
        self.h.custody()
        authority, scope = self.h.authority("booking")
        pending = self.h.ok("BookArrival", {"record_id": "custody:1", "record": {"facility_ref": "jail:1", "status": "booked", "next_review_at": "2012-10-13T12:00:00Z"}, "authority_ref": authority, "scope": scope})
        arrival = next(request for request in pending["external_requests"] if request["owner"] == "system_12")
        self.h.receipt(arrival, {"facility_ref": "jail:1"})
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "pending")
        self.assertEqual(self.h.state["custody"]["custody:1"]["facility_ref"], "jail:1")
        self.assertEqual(self.h.state["custody"]["custody:1"]["status"], "controlled")

    def test_queries_never_expose_ungranted_truth(self):
        self.h.report()
        result = self.h.ok("GetKnownLegalStatus", {"record_refs": ["incident/hidden", "report/unknown"]})
        self.assertEqual(result["result"]["records"], [])

    def test_query_replay_rechecks_grants(self):
        identifier = self.h.report()
        reference = "report/" + identifier
        self.h.fixtures["knowledge"]["snapshot"]["read_grants"][reference] = ["id", "disposition"]
        self.h.sync_clock()
        command = self.h.command("GetKnownLegalStatus", {"record_refs": [reference]})
        first = main_state_machine(self.h.state, command, self.h.fixtures)
        self.assertEqual(len(first["result"]["records"]), 1)
        self.h.fixtures["knowledge"]["snapshot"]["read_grants"] = {}
        second = main_state_machine(first["state"], command, self.h.fixtures)
        self.assertEqual(second["result"]["records"], [])

    def test_late_review_persists_obligation(self):
        self.h.report()
        self.h.now = "2012-10-14T12:00:00Z"
        first = self.h.ok("Tick", {})
        self.assertTrue(first["result"]["overdue_workflow_refs"])
        self.assertTrue(self.h.state["report"])
        self.assertFalse(self.h.ok("Tick", {})["result"]["overdue_workflow_refs"])

    def test_unknown_variables_rejected(self):
        result = self.h.run("RecordAffectedParty", {"record_id": "victim:1", "record": {"party_ref": "person:1", "wanted_stars": 5}})
        self.assertEqual(result["result"]["code"], "unknown_state_variable")

    def test_changed_policy_content_rejected(self):
        reference = self.h.state["legal_manifest"]["fictional:1"]["authority_policies"]
        self.h.rules[reference]["actions"]["arrest"]["elements"] = {}
        result = self.h.run("AssessAuthority", {"scope": {"action": "arrest", "target_ref": "person:1", "jurisdiction": "valor"}, "basis_refs": []})
        self.assertEqual(result["result"]["code"], "missing_or_changed_policy")

    def test_dependency_defaults_fail_closed(self):
        command = self.h.command("Tick", {})
        result = main_state_machine(self.h.state, command)
        self.assertEqual(result["result"]["code"], "not_authorized")

    def test_save_reload_does_not_depend_on_json_key_order(self):
        self.h.report()
        self.h.acquire()
        self.h.state = json.loads(json.dumps(self.h.state, sort_keys=True))
        identifier, _ = self.h.authority()
        self.assertEqual(self.h.state["authority_assessment"][identifier]["conclusion"], "sufficient")

    def test_acquired_fact_cannot_be_silently_rewritten(self):
        self.h.acquire()
        self.h.fixtures["knowledge"]["snapshot"]["facts"]["fact:1"]["values"] = {"specific_basis": False}
        result = self.h.run("AssessAuthority", {"scope": {"action": "arrest", "target_ref": "person:1", "jurisdiction": "valor"}, "basis_refs": ["fact:1"]})
        self.assertEqual(result["result"]["code"], "acquired_source_changed_without_amendment")

    def test_authority_cannot_be_reused_for_another_person(self):
        self.h.acquire()
        result = self.h.ok("AssessAuthority", {"scope": {"action": "arrest", "target_ref": "person:2", "jurisdiction": "valor"}, "basis_refs": ["fact:1"]})
        self.assertEqual(result["result"]["status"], "unresolved")

    def test_issued_release_order_does_not_release(self):
        self.h.custody()
        self.h.order()
        self.assertEqual(self.h.state["custody"]["custody:1"]["actual_control_ref"], "control:1")

    def test_release_requires_committed_physical_control_end(self):
        pending = self.h.release()
        for request in pending["external_requests"]:
            extra = {"ownership_preserved": True, "instance_refs": []} if request["owner"] == "system_15" else {}
            self.h.receipt(request, **extra)
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "physical_effects_committed_process_requires_review")
        self.assertEqual(self.h.state["custody"]["custody:1"]["actual_control_ref"], "control:1")

    def test_release_commits_only_after_all_effects(self):
        pending = self.h.release()
        for request in pending["external_requests"]:
            fields = {"actual_control_ref": None} if request["owner"] == "system_19" else {}
            extra = {"ownership_preserved": True, "instance_refs": []} if request["owner"] == "system_15" else {}
            self.h.receipt(request, fields, **extra)
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "completed")
        self.assertIsNone(self.h.state["custody"]["custody:1"]["actual_control_ref"])
        self.assertEqual(self.h.state["custody"]["custody:1"]["status"], "released")

    def test_cancelled_release_preserves_actual_effect_and_violation(self):
        pending = self.h.release()
        self.h.ok("CancelOrder", {"record_id": "order:release", "record": {"status": "cancelled"}})
        for request in pending["external_requests"]:
            fields = {"actual_control_ref": None} if request["owner"] == "system_19" else {}
            extra = {"ownership_preserved": True, "instance_refs": []} if request["owner"] == "system_15" else {}
            self.h.receipt(request, fields, **extra)
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "physical_effects_committed_process_requires_review")
        self.assertIsNone(self.h.state["custody"]["custody:1"]["actual_control_ref"])
        self.assertTrue(any(key.startswith("violation:") for key in self.h.state["institutional_decision_and_misconduct"]))

    def test_missing_release_conditions_block_exit(self):
        self.h.custody()
        self.h.order(conditions=["condition:payment"])
        result = self.h.run("ExecuteRelease", {"record_id": "custody:1", "record": {"status": "released", "facility_ref": None, "actual_control_ref": None}, "order_ref": "order:release"})
        self.assertEqual(result["result"]["code"], "release_conditions_not_recorded")

    def test_outstanding_arrest_order_blocks_release(self):
        self.h.custody()
        self.h.order()
        self.h.order("order:arrest", "arrest")
        result = self.h.run("ExecuteRelease", {"record_id": "custody:1", "record": {"status": "released", "facility_ref": None, "actual_control_ref": None}, "order_ref": "order:release"})
        self.assertEqual(result["result"]["code"], "conflicting_order")

    def test_expiry_creates_persistent_notification_without_delivery(self):
        self.h.order(expires="2012-10-11T13:00:00Z")
        self.h.now = "2012-10-11T14:00:00Z"
        result = self.h.ok("Tick", {})
        self.assertEqual(self.h.state["order"]["order:release"]["status"], "expired")
        workflow = self.h.state["deadline_and_durable_workflow"]["workflow:expired:order:release"]
        self.assertFalse(workflow["notice_delivery_refs"])
        request = next(request for request in result["external_requests"] if request["owner"] == "system_16")
        self.h.receipt(request, delivered=True)
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": "workflow:expired:order:release"})
        self.assertEqual(result["result"]["status"], "completed")

    def test_plea_cannot_invent_acceptance(self):
        self.h.ok("OfferAgreement", {"record_id": "plea:1", "record": {"plea_offer": {"exact_terms": "terms:1", "counsel_context": None, "supplied_information": [], "conditions": []}}})
        result = self.h.run("RecordPleaResponse", {"record_id": "plea:1", "record": {"plea_response_ref": "invented"}, "scope": {"target_ref": self.h.actor, "jurisdiction": "valor"}})
        self.assertEqual(result["result"]["code"], "explicit_choice_required")
        self.assertNotIn("plea_response_ref", self.h.state["order_custody_and_court_details"]["plea:1"])

    def test_offer_cannot_contain_preaccepted_plea(self):
        result = self.h.run("OfferAgreement", {"record_id": "plea:1", "record": {"plea_offer": {}, "plea_response_ref": "accepted"}})
        self.assertEqual(result["result"]["code"], "offer_is_not_acceptance")

    def test_new_idempotency_key_cannot_reroll_same_discretion(self):
        self.h.acquire()
        case = {"id": "case:1", "institution_id": "police", "allegations_ref": "allegation:1", "identity_ref": "unknown-description:1", "evidence_matrix_ref": "matrix:1", "stage": "open", "assigned_workers": [self.h.actor], "revision": 0}
        self.h.ok("OpenCase", {"record_id": "case:1", "record": case})
        first = self.h.ok("ScreenCase", {"record_id": "case:1", "record": {"stage": "declined"}, "basis_refs": ["fact:1"]})
        second = self.h.ok("ScreenCase", {"record_id": "case:1", "record": {"stage": "deferred"}, "basis_refs": ["fact:1"]})
        self.assertEqual(first["state"], second["state"])
        self.assertEqual(self.h.state["case_file"]["case:1"]["stage"], "declined")

    def test_bad_second_adapter_does_not_rollback_first_effect(self):
        self.h.custody()
        authority, scope = self.h.authority("booking")
        pending = self.h.ok("BookArrival", {"record_id": "custody:1", "record": {"facility_ref": "jail:1", "status": "booked", "next_review_at": "2012-10-13T12:00:00Z"}, "authority_ref": authority, "scope": scope})
        for request in pending["external_requests"]:
            if request["owner"] == "system_12":
                self.h.receipt(request, {"facility_ref": "jail:1"})
            elif request["owner"] == "system_15":
                self.h.fixtures.setdefault("system_15", {})["receipts"] = {request["idempotency_key"]: []}
        self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(self.h.state["custody"]["custody:1"]["facility_ref"], "jail:1")

    def test_notifications_do_not_recursively_generate_overdue_notifications(self):
        self.h.report()
        self.h.now = "2012-10-14T12:00:00Z"
        self.h.ok("Tick", {})
        count = len(self.h.state["deadline_and_durable_workflow"])
        self.h.now = "2012-10-14T13:00:00Z"
        self.h.ok("Tick", {})
        self.assertEqual(len(self.h.state["deadline_and_durable_workflow"]), count)

    def test_cancelled_order_cannot_trigger_new_physical_requests(self):
        pending = self.h.release()
        self.h.ok("CancelOrder", {"record_id": "order:release", "record": {"status": "cancelled"}})
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "blocked")
        self.assertEqual(result["external_requests"], [])
        self.assertEqual(self.h.state["custody"]["custody:1"]["actual_control_ref"], "control:1")

    def test_missing_control_result_does_not_create_custody(self):
        self.h.acquire()
        authority, scope = self.h.authority()
        record = {"id": "custody:1", "subject_ref": "person:1", "asserted_basis": {"authority_ref": authority}, "actual_control_ref": None, "facility_ref": None, "started_at": self.h.now, "status": "controlled", "next_review_at": "2012-10-13T12:00:00Z"}
        pending = self.h.ok("StartCustody", {"record_id": record["id"], "record": record, "authority_ref": authority, "scope": scope})
        self.h.receipt(pending["external_requests"][0])
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "physical_effects_committed_process_requires_review")
        self.assertFalse(self.h.state["custody"])

    def test_authoritative_control_reference_can_arrive_after_request(self):
        self.h.acquire()
        authority, scope = self.h.authority()
        record = {"id": "custody:1", "subject_ref": "person:1", "asserted_basis": {"authority_ref": authority}, "actual_control_ref": None, "facility_ref": None, "started_at": self.h.now, "status": "controlled", "next_review_at": "2012-10-13T12:00:00Z"}
        pending = self.h.ok("StartCustody", {"record_id": record["id"], "record": record, "authority_ref": authority, "scope": scope})
        self.h.receipt(pending["external_requests"][0], {"actual_control_ref": "external:discovered-control"})
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "completed")
        self.assertEqual(self.h.state["custody"]["custody:1"]["actual_control_ref"], "external:discovered-control")

    def test_actual_custody_review_reschedules_remaining_obligation(self):
        self.h.custody()
        identifier, workflow = next((key, value) for key, value in self.h.state["deadline_and_durable_workflow"].items() if value.get("review_task_ref") == "review:custody")
        self.h.fixtures["system_13"]["snapshot"]["completed_reviews"] = {"review:event": {"committed": True, "actor_ref": self.h.actor, "subject_ref": "custody:1", "review_task_ref": workflow["review_task_ref"], "occurred_at": self.h.now}}
        result = self.h.ok("CompleteReview", {"workflow_ref": identifier, "review_event_ref": "review:event"})
        self.assertEqual(result["result"]["status"], "review_recorded")
        self.assertEqual(self.h.state["custody"]["custody:1"]["actual_control_ref"], "control:1")
        reviews = [value for value in self.h.state["deadline_and_durable_workflow"].values() if value.get("review_task_ref") == "review:custody"]
        self.assertEqual(len(reviews), 2)

    def test_explicit_report_amendment_keeps_original_content(self):
        original = self.h.report()
        self.h.fixtures["system_16"]["snapshot"]["deliveries"]["amendment:1"] = {"delivered": True, "recipient_ref": "police", "received_at": self.h.now, "incident_or_allegation_ref": "allegation:1", "delivered_content_ref": "content:correction", "channel": "phone", "amends_report_ref": original}
        amended = self.h.ok("ReceiveReport", {"delivery_ref": "amendment:1"})["result"]["record_id"]
        self.assertEqual(self.h.state["report"][original]["content_ref"], "content:partial")
        self.assertEqual(self.h.state["report"][amended]["content_ref"], "content:correction")
        self.assertEqual(self.h.state["intake_and_task_details"][amended]["original_and_amended_report_refs"], [original, amended])

    def test_duplicate_charges_rejected(self):
        self.h.acquire()
        case = {"id": "case:1", "institution_id": "police", "allegations_ref": "allegation:1", "identity_ref": "unknown-description:1", "evidence_matrix_ref": "matrix:1", "stage": "open", "assigned_workers": [self.h.actor], "revision": 0}
        self.h.ok("OpenCase", {"record_id": "case:1", "record": case})
        count = {"offense_version": "offense:theft:fictional:1", "alleged_acts": ["allegation:1"], "identity_assessment": "uncertain", "basis": ["fact:1"], "unresolved_issues": ["intent"], "reasons": "reasons:1"}
        result = self.h.run("FileCharges", {"record_id": "case:1", "record": {"stage": "charged"}, "basis_refs": ["fact:1"], "details": {"charge_counts": {"count:1": count, "count:2": count}}})
        self.assertEqual(result["result"]["code"], "duplicate_count")

    def test_unrelated_details_cannot_forge_a_court_finding(self):
        self.h.acquire()
        case = {"id": "case:1", "institution_id": "police", "allegations_ref": "allegation:1", "identity_ref": "unknown-description:1", "evidence_matrix_ref": "matrix:1", "stage": "open", "assigned_workers": [self.h.actor], "revision": 0}
        self.h.ok("OpenCase", {"record_id": "case:1", "record": case})
        result = self.h.run("FileCharges", {"record_id": "case:1", "record": {"stage": "charged"}, "basis_refs": ["fact:1"], "details": {"finding_by_count": {"count:1": "guilty"}}})
        self.assertEqual(result["result"]["code"], "details_outside_operation_scope")

    def test_receipt_cannot_create_a_retroactive_effect(self):
        self.h.queue()
        self.h.ok("AssignResponse", {"record_id": "response:1", "record": {"assigned_unit": "unit:1", "status": "assigned"}})
        pending = self.h.ok("BeginTravel", {"record_id": "response:1", "record": {"status": "en_route"}})
        receipt = self.h.receipt(pending["external_requests"][0])
        receipt["occurred_at"] = "2012-10-10T00:00:00Z"
        self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(self.h.state["response_task"]["response:1"]["status"], "assigned")

    def test_false_delivery_receipt_does_not_complete_referral(self):
        scope = {"action": "release", "target_ref": "person:1", "jurisdiction": "valor"}
        pending = self.h.ok("RequestOrder", {"record_id": "application:1", "record": {"application_ref": "submission:1", "applicant_ref": self.h.actor}, "scope": scope})
        receipt = self.h.receipt(pending["external_requests"][0])
        receipt["delivered"] = False
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "pending")
        self.assertNotIn("application:1", self.h.state["order_custody_and_court_details"])

    def test_misconduct_does_not_convert_insufficient_basis_to_lawful(self):
        authority, scope = self.h.authority(facts=[])
        self.h.fixtures["system_13"]["snapshot"]["npc_decisions"] = {"misconduct:1": {"explicit": True, "actor_ref": self.h.actor, "operation": "StartCustody", "scope": scope, "occurred_at": self.h.now}}
        record = {"id": "custody:1", "subject_ref": "person:1", "asserted_basis": {"authority_ref": authority}, "actual_control_ref": "control:1", "facility_ref": None, "started_at": self.h.now, "status": "controlled", "next_review_at": "2012-10-13T12:00:00Z"}
        pending = self.h.ok("StartCustody", {"record_id": record["id"], "record": record, "authority_ref": authority, "scope": scope, "misconduct_ref": "misconduct:1"})
        self.h.receipt(pending["external_requests"][0], {"actual_control_ref": "control:1"})
        self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(self.h.state["authority_assessment"][authority]["conclusion"], "unresolved")
        self.assertTrue(any(key.startswith("violation:") for key in self.h.state["institutional_decision_and_misconduct"]))

    def test_payment_confirmation_is_separate_from_release_and_not_repeatable(self):
        self.h.custody()
        condition = self.h.add_rule({"subject_ref": "person:1", "requires_financial_transaction": True, "satisfaction_predicate": {"path": "payment_received", "equals": True}})
        self.h.order(conditions=[condition])
        obligation = {"id": "obligation:1", "order_id": "order:release", "subject_ref": "person:1", "condition_ref": condition, "due_at": "2012-10-12T12:00:00Z", "notice_refs": [], "compliance_refs": [], "status": "due"}
        self.h.ok("CreateObligation", {"record_id": "obligation:1", "record": obligation})
        pending = self.h.ok("RequestPayment", {"record_id": "obligation:1", "record": {}, "transaction_ref": "transaction:1"})
        request = pending["external_requests"][0]
        self.h.receipt(request, {"compliance_refs": ["transaction:1"]}, transaction_ref="transaction:1")
        self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.h.acquire("fact:payment", {"payment_received": True})
        self.h.ok("ReviewObligation", {"record_id": "obligation:1", "record": {"status": "satisfied"}, "basis_refs": ["fact:1", "fact:payment"]})
        self.assertEqual(self.h.state["custody"]["custody:1"]["actual_control_ref"], "control:1")
        repeated = self.h.run("RequestPayment", {"record_id": "obligation:1", "record": {}, "transaction_ref": "transaction:1"})
        self.assertEqual(repeated["result"]["code"], "transaction_already_requested")

    def test_proceeding_finding_requires_actual_hearing_and_presented_evidence(self):
        self.h.acquire(values={"specific_basis": True, "act": "taking", "intent": True})
        case = {"id": "case:1", "institution_id": "police", "allegations_ref": "allegation:1", "identity_ref": "unknown-description:1", "evidence_matrix_ref": "matrix:1", "stage": "open", "assigned_workers": [self.h.actor], "revision": 0}
        self.h.ok("OpenCase", {"record_id": "case:1", "record": case})
        count = {"offense_version": "offense:theft:fictional:1", "alleged_acts": ["allegation:1"], "identity_assessment": "uncertain", "basis": ["fact:1"], "unresolved_issues": [], "reasons": "reasons:1"}
        self.h.ok("FileCharges", {"record_id": "case:1", "record": {"stage": "charged"}, "basis_refs": ["fact:1"], "details": {"charge_counts": {"count:1": count}}})
        proceeding = {"id": "hearing:1", "case_id": "case:1", "type": "fictional_hearing", "scheduled_at": self.h.now, "participants_ref": "participants:1", "submitted_material_refs": ["fact:1"], "outcome_ref": None}
        pending = self.h.ok("ScheduleProceeding", {"record_id": "hearing:1", "record": proceeding})
        request = pending["external_requests"][0]
        self.assertEqual(request["payload"]["parameters"]["scheduled_at"], self.h.now)
        self.h.receipt(request)
        self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        finding = {"decision": "conviction", "element_reasons": {"taking": True, "intent": True}, "uncertainty": [], "policy": "fictional:1"}
        data = {"record_id": "hearing:1", "record": {"outcome_ref": "outcome:1"}, "basis_refs": ["fact:1"], "details": {"finding_by_count": {"count:1": finding}}}
        invalid = self.h.run("RecordFinding", data)
        self.assertEqual(invalid["result"]["code"], "actual_hearing_required")
        self.h.fixtures["system_13"]["snapshot"]["hearings"] = {"hearing:1": {"committed": True, "participants_ref": "participants:1", "location_event_ref": "presence:1"}}
        self.h.fixtures["system_12"] = {"snapshot": {"presence_event_refs": ["presence:1"]}}
        result = self.h.ok("RecordFinding", data)
        self.assertEqual(result["result"]["status"], "committed")
        self.assertFalse(self.h.state["incident"])

    def test_narrator_cannot_mutate_even_with_overbroad_role_grant(self):
        self.h.fixtures["system_13"]["snapshot"]["authority_kind"] = "narrator"
        result = self.h.run("Tick", {})
        self.assertEqual(result["result"]["code"], "narration_cannot_mutate")

    def test_unconfigured_modern_channel_does_not_become_2012_capability(self):
        self.h.fixtures["system_16"]["snapshot"]["deliveries"]["delivery:modern"] = {"delivered": True, "channel": "universal_live_video_location"}
        result = self.h.run("ReceiveReport", {"delivery_ref": "delivery:modern"})
        self.assertEqual(result["result"]["code"], "channel_not_configured_for_era")

    def test_unknown_identity_cannot_be_replaced_with_server_identity(self):
        case = {"id": "case:1", "institution_id": "police", "allegations_ref": "allegation:1", "identity_ref": "server:secret-person", "evidence_matrix_ref": "matrix:1", "stage": "open", "assigned_workers": [self.h.actor], "revision": 0}
        result = self.h.run("OpenCase", {"record_id": "case:1", "record": case})
        self.assertEqual(result["result"]["code"], "identity_assessment_not_acquired")

    def test_declining_a_pending_choice_never_executes_the_proposal(self):
        self.h.queue()
        self.h.ok("AssignResponse", {"record_id": "response:1", "record": {"assigned_unit": "unit:1", "status": "assigned"}})
        self.h.fixtures["player_input"] = {"snapshot": {"pending_choices": {"choice:pending": {"scope": {}}}, "decisions": {}}}
        data = {"record_id": "response:1", "record": {"status": "en_route"}, "pending_player_choice_ref": "choice:pending"}
        pending = self.h.ok("BeginTravel", data)
        self.assertFalse(pending["external_requests"])
        self.h.fixtures["player_input"]["snapshot"]["decisions"]["choice:refuse"] = {
            "explicit": True, "actor_ref": self.h.actor, "operation": "BeginTravel", "scope": {},
            "occurred_at": self.h.now, "pending_choice_ref": "choice:pending", "authorizes_proposal": False,
            "proposal_hash": digest({"record": data["record"], "details": {}}),
        }
        self.h.ok("ResolveChoice", {"workflow_ref": pending["result"]["workflow_ref"], "choice_ref": "choice:refuse"})
        result = self.h.ok("ResumeWorkflow", {"workflow_ref": pending["result"]["workflow_ref"]})
        self.assertEqual(result["result"]["status"], "proposal_declined")
        self.assertFalse(result["external_requests"])
        self.assertEqual(self.h.state["response_task"]["response:1"]["status"], "assigned")


if __name__ == "__main__":
    unittest.main()
