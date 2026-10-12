"""Contract tests use canned JSON receipts, never foreign-domain simulations."""

import copy
import unittest

from system19.combat import Combat, DummyDependencies, State, ident, state_machine


def ok(**values):
    return {"status": "committed", **values}


class RecordingStubs(DummyDependencies):
    def __init__(self, fixtures):
        super().__init__(fixtures)
        self.calls = []

    def call(self, owner, operation, request):
        self.calls.append((owner, operation, copy.deepcopy(request)))
        return super().call(owner, operation, request)


def fixture():
    content = {
        "policy": {"scheduling_policy_version": "scheduler:v1", "duration_overrides": [], "handoff_owners": ["health", "items"]},
        "action:v1": {"version": "action:v1", "intent_family": "strike", "target_type": "observed_actor",
                      "spatial_requirements_ref": "space", "item_requirements_ref": "items", "function_requirements_ref": "function",
                      "timing_ref": "timing", "contested_question_ref": "question", "effects_by_result_band_ref": "effects",
                      "observation_cues_ref": "cues", "interruption_rules_ref": "rules", "concurrent_channels_ref": "channels"},
        "rules": {"family": "strike", "cancellation_policy_ref": "cancel", "consumption_boundary_ref": "consume", "reaction_compatibility_ref": "compatibility"},
        "cancel": {"allowed": True}, "consume": {"kind": "completion"}, "compatibility": {"mode": "cancel"},
        "channels": {"action_channels": ["primary"], "compatible_channels": []},
        "timing": {"category": "quick_action_seconds"},
        "question": {"uncertain": True, "scale_ref": "scale", "modifiers": [], "check_request": {
            "actor_capability_ref": "capability", "objective_ref": "objective", "difficulty_basis_ref": "difficulty",
            "circumstance_groups": ["position"], "outcome_bands": ["success", "failure"]}},
        "effects": {"success": [{"owner": "health", "operation": "impact", "proposal_ref": "impact",
                                  "scope_declared": True, "supported": True}], "failure": []},
        "choice:p": {"actor_id": "p"},
    }
    f = {("content", "read", k): ok(ref=k, data=v) for k, v in content.items()}
    f["player", "authorize", "auth:system"] = ok(authorized=True, actor_id="system", kind="system", encounter_ids=["e"],
        commands=["OpenEncounter", "ResolveBoundary", "UpdateContact", "RecordWorldEvent", "EndEncounter"])
    for actor in ("p", "q"):
        f["player", "authorize", "auth:" + actor] = ok(authorized=True, actor_id=actor, kind="player", encounter_ids=["e"],
            commands=["CommitIntent", "PreviewIntent", "CancelCommitment", "RespondToThreat", "GetKnownEncounter", "GetKnownRoutes",
                      "GetObservedThreats", "GetFeasibleActions", "GetAftermathSummary", "OfferSurrender", "ApplyRestraint"])
        f["knowledge", "snapshot", actor] = ok(observer_id=actor, visible_actor_ids=[actor], observations=[], contact_ids=[])
        f["player", "intent", "intent:" + actor] = ok(actor_id=actor, authorized=True, explicit=True,
            template_version="action:v1", target_ref="target", objective_ref="objective")
    f["world", "opening", "cause"] = ok(supported=True, phase="tension", participants=[
        {"encounter_id": "e", "character_id": actor, "role": "participant", "goal_ref": "goal:" + actor,
         "position_ref": "position:" + actor, "function_revision": "health:1", "status": "present"} for actor in ("p", "q")])
    f["time", "current", "*"] = ok(canonical_time=0)
    for owner in ("location", "items", "health", "vehicles"):
        f[owner, "validate", "*"] = ok(allowed=True)
    f["knowledge", "validate_target", "*"] = ok(allowed=True)
    f["knowledge", "stakes", "*"] = ok(stakes=["observed threat"])
    f["items", "reserve", "*"] = ok(reserved=True)
    f["items", "consume", "*"] = ok(committed=True)
    f["items", "release_unused", "*"] = ok()
    f["time", "schedule", "*"] = ok()
    f["time", "reschedule", "*"] = ok()
    f["time", "authorize_boundary", "*"] = ok(allowed=True)
    f["time", "next_boundary", "*"] = ok(due_time=None)
    f["time", "snapshot", "*"] = ok(ref="snapshot:0")
    f["time", "advance", "*"] = ok()
    f["checks", "compose", "*"] = ok(bounded=True, deduplicated=True)
    f["checks", "resolve", "*"] = ok(band="success")
    f["health", "impact", "*"] = ok(effect_committed=True)
    f["knowledge", "emit", "*"] = ok(observation_event_refs=[])
    f["location", "event_context", "*"] = ok(location_ref="location:diner")
    for owner in ("health", "items"):
        f[owner, "aftermath", "*"] = ok()
    f["knowledge", "aftermath_summary", "*"] = ok()
    return f


class CombatTest(unittest.TestCase):
    def setUp(self):
        self.ports = RecordingStubs(fixture())
        self.engine = Combat(dependencies=self.ports)
        self.serial = 0
        self.assertEqual(self.send("OpenEncounter", "system", cause_ref="cause", policy_version="policy")["status"], "ok")

    def command(self, name, actor="p", **payload):
        self.serial += 1
        e = self.engine.state.encounter.get("e", {"revision": 0, "canonical_time": 0})
        return {"command": name, "encounter_id": "e", "actor_id": actor, "payload": payload,
                "envelope": {"authority_ref": "auth:" + actor, "expected_revision": e["revision"],
                             "canonical_timestamp": e["canonical_time"], "correlation_id": "test", "idempotency_key": str(self.serial)}}

    def send(self, name, actor="p", **payload):
        return self.engine.step(self.command(name, actor, **payload))

    def commit(self, actor="p", **extra):
        return self.send("CommitIntent", actor, template_version="action:v1", target_ref="target", objective_ref="objective", intent_ref="intent:" + actor, **extra)

    def resolve(self, time=2):
        return self.send("ResolveBoundary", "system", scheduler_token="scheduler", due_time=time)

    def calls(self, owner, operation):
        return [r for o, op, r in self.ports.calls if (o, op) == (owner, operation)]

    def test_success_and_strict_save_reload(self):
        self.assertEqual(self.commit()["status"], "ok")
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertEqual(next(iter(self.engine.state.commitment.values()))["status"], "completed")
        self.assertEqual(len(self.calls("checks", "resolve")), 1)
        saved = self.engine.state.dump()
        self.assertEqual(State.load(saved).dump(), saved)

    def test_preview_has_no_effect(self):
        before = self.engine.state.dump()
        result = self.send("PreviewIntent", template_version="action:v1", target_ref="target", objective_ref="objective")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(before, self.engine.state.dump())
        self.assertFalse(self.calls("items", "reserve"))

    def test_duplicate_and_conflicting_idempotency_keys(self):
        c = self.command("CommitIntent", template_version="action:v1", target_ref="target", objective_ref="objective", intent_ref="intent:p")
        self.assertEqual(self.engine.step(c)["status"], "ok")
        saved = self.engine.state.dump()
        self.engine = Combat(State.load(saved), self.ports)
        self.assertEqual(self.engine.step(c)["status"], "replayed")
        c["payload"]["target_ref"] = "other"
        self.assertEqual(self.engine.step(c)["data"]["code"], "idempotency_conflict")
        self.assertEqual(len(self.calls("items", "reserve")), 1)

    def test_stale_revision_and_unauthorized_intent(self):
        c = self.command("CommitIntent", template_version="action:v1", target_ref="target", objective_ref="objective", intent_ref="intent:p")
        c["envelope"]["expected_revision"] = 0
        self.assertEqual(self.engine.step(c)["data"]["code"], "stale_state")
        self.ports.fixtures["player", "intent", "intent:p"]["explicit"] = False
        self.assertEqual(self.commit()["status"], "rejected")
        self.assertFalse(self.calls("items", "reserve"))

    def test_no_second_primary_commitment(self):
        self.commit()
        self.assertEqual(self.commit()["data"]["code"], "action_channel_busy")

    def test_failed_prerequisite_never_rolls(self):
        self.ports.fixtures["items", "validate", "*"] = ok(allowed=False)
        self.assertEqual(self.commit()["status"], "rejected")
        self.assertFalse(self.calls("checks", "resolve"))
        self.assertFalse(self.calls("items", "consume"))

    def test_simultaneous_actions_validate_and_resolve_before_impacts(self):
        self.commit("p")
        self.commit("q")
        self.assertEqual(self.resolve()["status"], "ok")
        calls = [(o, op) for o, op, _ in self.ports.calls]
        self.assertLess(max(i for i, v in enumerate(calls) if v == ("checks", "resolve")), calls.index(("health", "impact")))
        self.assertEqual({r["snapshot_ref"] for r in self.calls("checks", "resolve")}, {"snapshot:0"})
        self.assertEqual(len(self.calls("health", "impact")), 2)

    def test_earlier_function_loss_interrupts_later_completion(self):
        self.commit()
        self.ports.fixtures["health", "validate", "*"] = ok(allowed=False)
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertEqual(next(iter(self.engine.state.commitment.values()))["status"], "interrupted")
        self.assertFalse(self.calls("checks", "resolve"))

    def test_consumed_resources_survive_failure_and_reload(self):
        self.commit()
        self.ports.fixtures["health", "impact", "*"] = {"status": "unavailable", "ref": "offline"}
        self.assertEqual(self.resolve()["status"], "pending")
        saved = self.engine.state.dump()
        self.engine = Combat(State.load(saved), self.ports)
        self.ports.fixtures["health", "impact", "*"] = ok(effect_committed=True)
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertEqual(len(self.calls("items", "consume")), 1)
        self.assertEqual(len(self.calls("checks", "resolve")), 1)
        attempts = self.calls("health", "impact")
        self.assertEqual(attempts[0]["idempotency_key"], attempts[1]["idempotency_key"])

    def test_invalid_effect_acknowledgement_never_erases_consumption(self):
        self.commit()
        self.ports.fixtures["health", "impact", "*"] = ok(effect_committed=False)
        self.assertEqual(self.resolve()["status"], "pending")
        flow = next(iter(self.engine.state.effect_workflow.values()))
        self.assertTrue(flow["resource_commit_refs"])
        self.assertTrue(flow["integration_error_refs"])
        self.assertTrue(self.engine.state.scheduler_state["e"]["pending_boundary_ref"])

    def test_reservation_failure_keeps_channel_and_resumes_same_action(self):
        self.ports.fixtures["items", "reserve", "*"] = {"status": "unavailable", "ref": "offline"}
        self.assertEqual(self.commit()["status"], "pending")
        self.assertEqual(self.commit()["status"], "rejected")
        self.ports.fixtures["items", "reserve", "*"] = ok(reserved=True)
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertEqual(len(self.engine.state.commitment), 1)

    def test_cancellation_does_not_consume_or_refund_time(self):
        self.commit()
        aid = next(iter(self.engine.state.commitment))
        self.assertEqual(self.send("CancelCommitment", action_id=aid)["status"], "ok")
        self.assertEqual(self.engine.state.commitment[aid]["status"], "cancelled")
        self.assertFalse(self.calls("items", "consume"))
        self.assertEqual(self.engine.state.encounter["e"]["canonical_time"], 0)

    def test_pending_choice_blocks_time_and_survives_reload(self):
        self.commit()
        self.engine.state.scheduler_state["e"]["pending_choice_refs"] = ["choice:p"]
        self.engine = Combat(State.load(self.engine.state.dump()), self.ports)
        self.assertEqual(self.resolve()["status"], "pending")
        self.assertEqual(self.engine.state.encounter["e"]["canonical_time"], 0)
        self.assertFalse(self.calls("time", "advance"))

    def test_known_view_has_no_hidden_actor_or_goal(self):
        self.commit("q")
        result = self.send("GetKnownEncounter")["data"]
        self.assertEqual(result["participants"], ["p"])
        self.assertEqual(result["commitments"], [])
        self.assertNotIn("goal", str(result))

    def test_undefined_template_has_no_effect(self):
        before = self.engine.state.dump()
        self.assertEqual(self.send("CommitIntent", template_version="unknown", target_ref="target", objective_ref="objective", intent_ref="intent:p")["status"], "pending")
        self.assertEqual(before, self.engine.state.dump())

    def test_template_change_is_rejected_on_completion(self):
        self.commit()
        self.ports.fixtures["content", "read", "action:v1"]["data"]["timing_ref"] = "different"
        self.resolve()
        self.assertFalse(self.calls("checks", "resolve"))

    def test_aftermath_retains_event_history(self):
        self.commit()
        self.assertEqual(self.send("EndEncounter", "system", reason="finished")["status"], "rejected")
        self.resolve()
        old = copy.deepcopy(self.engine.state.encounter_event)
        self.assertEqual(self.send("EndEncounter", "system", reason="finished")["status"], "ok")
        self.assertEqual(self.engine.state.encounter["e"]["phase"], "closed")
        self.assertTrue(set(old) <= set(self.engine.state.encounter_event))

    def test_search_reuses_result_for_unchanged_evidence(self):
        question = self.ports.fixtures["content", "read", "question"]["data"]
        question["search_context"] = {"scope_ref": "scope", "method_ref": "method", "information_basis_ref": "evidence", "context_revision": 1}
        self.commit()
        self.resolve()
        self.commit()
        self.resolve(4)
        self.assertEqual(len(self.calls("checks", "resolve")), 1)

    def test_no_unbounded_or_duplicate_modifiers(self):
        mods = [{"source_ref": "cover", "group": "position", "overlap_group": "position", "strength": 2},
                {"source_ref": "angle", "group": "position", "overlap_group": "position", "strength": 3},
                {"source_ref": "geometry", "group": "position", "overlap_group": "cover", "strength": 9, "already_in_geometry": True}]
        self.assertEqual(Combat._modifiers(mods), [mods[1]])

    def effect(self, owner, operation, ref):
        return {"owner": owner, "operation": operation, "proposal_ref": ref, "scope_declared": True, "supported": True}

    def local_proposal(self, ref, **data):
        aid = "action:" + ident("e", str(self.serial + 1))
        self.ports.fixtures["content", "read", ref] = ok(data={"action_id": aid, "encounter_id": "e", **data})
        return aid

    def test_early_consumption_is_not_refunded_on_cancel(self):
        self.ports.fixtures["content", "read", "consume"]["data"] = {"kind": "offset", "offset_seconds": 1}
        self.commit()
        self.assertEqual(self.resolve(1)["status"], "ok")
        self.assertEqual(len(self.calls("items", "consume")), 1)
        self.assertFalse(self.calls("checks", "resolve"))
        aid = next(iter(self.engine.state.commitment))
        self.assertEqual(self.send("CancelCommitment", action_id=aid)["status"], "ok")
        self.assertEqual(self.engine.state.encounter["e"]["canonical_time"], 1)
        self.assertTrue(self.calls("items", "release_unused")[-1]["resource_commit_refs"])

    def test_early_consumption_then_completion_only_consumes_once(self):
        self.ports.fixtures["content", "read", "consume"]["data"] = {"kind": "offset", "offset_seconds": 1}
        self.commit()
        self.resolve(1)
        self.assertEqual(self.resolve(2)["status"], "ok")
        self.assertEqual(len(self.calls("items", "consume")), 1)

    def test_mid_action_choice_can_cancel_and_replace_commitment(self):
        self.ports.fixtures["content", "read", "rules"]["data"]["interrupt_points"] = ["interrupt"]
        self.ports.fixtures["content", "read", "interrupt"] = ok(data={"offset_seconds": 1, "event_ref": "choice-event"})
        self.ports.fixtures["time", "event", "choice-event"] = ok(occurred_at=1, kind="choice", choice_ref="choice:p")
        self.commit()
        self.assertEqual(self.resolve(1)["status"], "pending")
        aid = next(iter(self.engine.state.commitment))
        self.assertEqual(self.send("CancelCommitment", action_id=aid)["status"], "ok")
        self.assertEqual(self.commit(choice_ref="choice:p")["status"], "ok")
        self.assertEqual(self.resolve(1)["status"], "ok")
        self.assertEqual(self.engine.state.encounter["e"]["canonical_time"], 1)

    def test_grapple_creates_scoped_control_without_health_effect(self):
        self.local_proposal("control-proposal", engagement={"id": "control", "actors_ref": "actors", "type": "grapple",
            "constrained_channels": ["primary"], "maintenance_ref": "maintenance", "started_event": "pending"},
            control_detail={"controller_ids": ["p"], "controlled_actor_id": "q", "control_state": "limited_control",
                            "contact_context_ref": "contact", "posture_relation_ref": "posture", "maintenance_conditions_ref": "maintenance"})
        self.ports.fixtures["content", "read", "actors"] = ok(data={"encounter_id": "e"})
        self.ports.fixtures["content", "read", "maintenance"] = ok(data={"validation_refs": {"location": "maintain"}, "occupied_channels": ["primary"]})
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = [self.effect("encounter", "control", "control-proposal")]
        self.commit()
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertEqual(self.engine.state.control_detail["control"]["control_state"], "limited_control")
        self.assertFalse(self.calls("health", "impact"))
        self.assertEqual(self.commit("q")["status"], "rejected")
        self.assertEqual(self.commit("p")["status"], "rejected")

    def test_restraint_requires_committed_item_effect(self):
        self.local_proposal("restraint-proposal", requires_effect_refs=["item:attached"], restraint={
            "id": "cuffs", "target_id": "q", "item_id": "item:cuffs", "constraints_ref": "cuff-constraints", "application_event": "pending"})
        self.ports.fixtures["content", "read", "cuff-constraints"] = ok(data={"constrained_channels": ["primary"]})
        self.ports.fixtures["items", "apply_restraint", "*"] = ok(ref="item:attached", effect_committed=True)
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = [
            self.effect("items", "apply_restraint", "item-proposal"), self.effect("encounter", "restraint", "restraint-proposal")]
        self.commit()
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertIn(self.engine.state.restraint["cuffs"]["application_event"], self.engine.state.encounter_event)
        self.assertEqual(self.commit("q")["status"], "rejected")
        self.assertFalse(self.calls("health", "impact"))

    def test_restraint_cannot_use_health_receipt_as_item_proof(self):
        self.local_proposal("restraint-proposal", requires_effect_refs=["health:impact"], restraint={
            "id": "cuffs", "target_id": "q", "item_id": "item:cuffs", "constraints_ref": "cuff-constraints", "application_event": "pending"})
        self.ports.fixtures["health", "impact", "*"] = ok(ref="health:impact", effect_committed=True)
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = [
            self.effect("health", "impact", "impact"), self.effect("encounter", "restraint", "restraint-proposal")]
        self.commit()
        self.assertEqual(self.resolve()["status"], "pending")
        self.assertFalse(self.engine.state.restraint)

    def test_pursuit_cannot_add_an_uninstructed_second_pursuer(self):
        self.local_proposal("pursuit-proposal", requires_effect_refs=["location:moved"], pursuit_decision_ref="decision:p", route_or_contact_basis_ref="route",
            pursuit={"id": "chase", "encounter_id": "e", "pursuer_ids": ["p", "q"], "quarry_ref": "quarry",
                     "contact_refs": [], "route_refs": ["route"], "separation_band": "near", "status": "active"},
            pursuit_detail={"mode": "foot", "last_known_context_refs": [], "observation_channel_refs": ["sight"],
                            "exertion_input_refs": [], "objective_refs": ["follow"], "stop_conditions_ref": "stop"})
        self.ports.fixtures["location", "move", "*"] = ok(ref="location:moved", effect_committed=True)
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = [
            self.effect("location", "move", "move"), self.effect("encounter", "pursuit", "pursuit-proposal")]
        self.commit()
        self.assertEqual(self.resolve()["status"], "pending")
        self.assertFalse(self.engine.state.pursuit)

    def test_foreign_state_setter_is_rejected(self):
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = [self.effect("health", "set_hp", "hp")]
        self.commit()
        self.assertEqual(self.resolve()["status"], "pending")
        self.assertFalse(self.calls("health", "set_hp"))
        self.assertFalse(self.calls("items", "consume"))

    def test_changed_effect_mapping_cannot_change_pending_action(self):
        self.commit()
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = []
        self.assertEqual(self.resolve()["status"], "pending")
        self.assertFalse(self.calls("checks", "resolve"))

    def test_pause_does_not_cancel_already_committed_actions(self):
        self.commit("q")
        self.engine.state.surrender_or_pause["offer"] = {"offer_event_ref": "offer", "actor_id": "p", "supplied_intent_ref": "surrender",
            "conditions_ref": "conditions", "recipient_observation_refs": ["heard"], "response_refs": ["accepted"],
            "adopting_participant_ids": ["q"], "compliance_scope_ref": "pause-scope"}
        self.ports.fixtures["content", "read", "pause-scope"] = ok(data={"withheld_families": ["strike"]})
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertEqual(len(self.calls("health", "impact")), 1)
        self.assertEqual(self.commit("q")["status"], "rejected")

    def test_unheard_actor_cannot_be_added_to_pause(self):
        self.local_proposal("offer-proposal", requires_effect_refs=["speech:delivered"], observed_accepting_actor_ids=[],
            surrender_or_pause={"offer_event_ref": "offer", "actor_id": "p", "supplied_intent_ref": "surrender",
                "conditions_ref": "conditions", "recipient_observation_refs": [], "response_refs": [],
                "adopting_participant_ids": ["q"], "compliance_scope_ref": "pause-scope"})
        self.ports.fixtures["knowledge", "communicate", "*"] = ok(ref="speech:delivered", effect_committed=True)
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = [
            self.effect("knowledge", "communicate", "speech"), self.effect("encounter", "surrender", "offer-proposal")]
        self.commit()
        self.assertEqual(self.resolve()["status"], "pending")
        self.assertFalse(self.engine.state.surrender_or_pause)

    def test_contact_loss_retains_last_known_record(self):
        contact = {"id": "contact", "observer_id": "p", "target_ref": "quarry", "knowledge_kind": "lost",
                   "last_confirmed_at": 0, "observation_event": "observation", "confidence": "uncertain"}
        self.ports.fixtures["knowledge", "acquire", "observation"] = ok(supported=True, contacts=[contact])
        self.assertEqual(self.send("UpdateContact", "system", observation_event_ref="observation")["status"], "ok")
        self.assertEqual(self.engine.state.contact["contact"], contact)
        self.assertEqual(len(self.engine.state.participant), 2)

    def test_routine_action_does_not_roll(self):
        self.ports.fixtures["content", "read", "question"]["data"] = {"uncertain": False, "routine_band": "success"}
        self.commit()
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertFalse(self.calls("checks", "resolve"))

    def test_npc_gets_only_own_snapshot_and_records_decision(self):
        auth = self.ports.fixtures["player", "authorize", "auth:q"]
        auth["kind"] = "npc"
        self.ports.fixtures["npc", "intent", "intent:q"] = copy.deepcopy(self.ports.fixtures["player", "intent", "intent:q"])
        self.ports.fixtures["knowledge", "snapshot", "q"]["ref"] = "known:q"
        self.ports.fixtures["npc", "decision_record", "intent:q"] = ok(decision={"actor_id": "q", "goal_ref": "goal:q",
            "available_information_ref": "known:q", "morale_input_refs": ["perceived-danger:q"], "selected_intent_ref": "intent:q"})
        self.assertEqual(self.commit("q")["status"], "ok")
        self.assertEqual(self.calls("npc", "intent")[0]["known_snapshot"]["visible_actor_ids"], ["q"])
        self.assertEqual(len(self.engine.state.npc_decision_record), 1)

    def test_host_api_is_entirely_json_serializable(self):
        import json
        fixtures = {}
        for (owner, operation, selector), value in self.ports.fixtures.items():
            fixtures.setdefault(owner, {}).setdefault(operation, {})[selector] = value
        command = self.command("GetKnownEncounter")
        result = state_machine(self.engine.state.dump(), command, fixtures)
        self.assertEqual(json.loads(json.dumps(result)), result)
        self.assertEqual(result["reply"]["status"], "ok")

    def test_failed_reservation_acknowledgement_remains_recoverable(self):
        self.ports.fixtures["items", "reserve", "*"] = ok(reserved=False)
        self.assertEqual(self.commit()["status"], "pending")
        saved = self.engine.state.dump()
        self.engine = Combat(State.load(saved), self.ports)
        self.ports.fixtures["items", "reserve", "*"] = ok(reserved=True)
        self.assertEqual(self.resolve()["status"], "ok")
        self.assertEqual(len(self.engine.state.commitment), 1)

    def test_event_details_reference_authoritative_location(self):
        self.commit()
        self.resolve()
        self.assertEqual(next(iter(self.engine.state.event_detail.values()))["location_ref"], "location:diner")

    def test_reusable_local_templates_bind_only_declared_action_context(self):
        self.ports.fixtures["content", "read", "guard-proposal"] = ok(data={"action_id": "$action_id", "encounter_id": "$encounter_id",
            "guard_state": {"commitment_id": "$action_id", "threat_class": "physical", "expires_at_boundary_ref": "guard-expiry"}})
        self.ports.fixtures["content", "read", "guard-expiry"] = ok(data={"kind": "next_boundary"})
        self.ports.fixtures["content", "read", "effects"]["data"]["success"] = [self.effect("encounter", "guard", "guard-proposal")]
        self.commit()
        self.assertEqual(self.resolve(2)["status"], "ok")
        self.commit()
        self.assertEqual(len(self.engine.state.guard_state), 0)
        self.assertEqual(self.resolve(4)["status"], "ok")
        self.assertEqual(len(self.engine.state.guard_state), 1)
        self.assertEqual(next(iter(self.engine.state.guard_state)), list(self.engine.state.commitment)[-1])

    def test_unknown_state_field_is_rejected(self):
        data = self.engine.state.dump()
        data["hp"] = 100
        with self.assertRaises(Exception):
            State.load(data)

    def install_reaction(self):
        self.commit("q")
        incoming = next(iter(self.engine.state.commitment))
        self.ports.fixtures["knowledge", "acquire", "observation"] = ok(supported=True, reaction_eligibility_refs=["eligible"])
        self.ports.fixtures["knowledge", "reaction_cue", "eligible"] = ok(observed=True, eligible=True,
            actor_id="p", initiating_action_id=incoming, cue_event_id="cue", requires_player_choice=True, choice_ref="choice:p")
        self.assertEqual(self.send("UpdateContact", "system", observation_event_ref="observation")["status"], "ok")
        return next(iter(self.engine.state.reaction))

    def test_same_cue_cannot_create_second_reaction(self):
        self.install_reaction()
        self.send("UpdateContact", "system", observation_event_ref="observation")
        self.assertEqual(len(self.engine.state.reaction), 1)

    def test_no_response_does_not_create_defense(self):
        rid = self.install_reaction()
        self.ports.fixtures["player", "response", "response"] = ok(authorized=True, explicit=True, actor_id="p", no_response=True, choice_ref="choice:p")
        self.assertEqual(self.send("RespondToThreat", reaction_id=rid, response_ref="response")["status"], "ok")
        self.assertEqual(len(self.engine.state.commitment), 1)
        self.assertEqual(self.resolve()["status"], "ok")

    def test_defense_occupies_reaction_channel_and_uses_original_contest(self):
        rid = self.install_reaction()
        template = copy.deepcopy(self.ports.fixtures["content", "read", "action:v1"]["data"])
        template.update(version="defense:v1", intent_family="block", timing_ref="reaction_time", interruption_rules_ref="reaction_rules",
                        concurrent_channels_ref="reaction_channels", contested_question_ref="reaction_question", effects_by_result_band_ref="reaction_effects")
        values = {"defense:v1": template, "reaction_time": {"duration_seconds": 1},
                  "reaction_rules": {"family": "block", "reaction": True, "cancellation_policy_ref": "cancel", "consumption_boundary_ref": "consume", "reaction_compatibility_ref": "compatibility"},
                  "reaction_channels": {"action_channels": ["reaction"], "compatible_channels": []},
                  "reaction_question": {"uncertain": False, "routine_band": "success"}, "reaction_effects": {"success": []}}
        for key, value in values.items():
            self.ports.fixtures["content", "read", key] = ok(data=value)
        self.ports.fixtures["player", "response", "response"] = ok(authorized=True, explicit=True, actor_id="p", choice_ref="choice:p",
            template_version="defense:v1", target_ref="target", objective_ref="defend")
        self.assertEqual(self.send("RespondToThreat", reaction_id=rid, response_ref="response")["status"], "ok")
        self.assertEqual(self.commit("p")["status"], "rejected")
        self.assertEqual(self.resolve(1)["status"], "ok")
        self.assertEqual(self.resolve(2)["status"], "ok")
        self.assertEqual(len(self.calls("checks", "resolve")), 1)
        self.assertEqual(self.calls("checks", "resolve")[0]["response_refs"], ["response"])


if __name__ == "__main__":
    unittest.main()
