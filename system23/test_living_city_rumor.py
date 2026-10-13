"""Contract tests; all external responses are literal fixtures, not simulations.

Run: python -m unittest system23.test_living_city_rumor -v
"""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, fields
import json
import unittest

from system23.living_city_rumor import (
    CityState, GateError, LivingCityRumor, MockDependencies,
)


def ok(**values):
    return {"status": "ok", **values}


TEMPLATE = {
    "id": "hours", "family": "business_work", "version": "1",
    "prerequisites_ref": "prerequisites:hours", "impact_band": "low",
    "workflow_ref": "workflow:hours", "observation_rules": {},
}


class CityTests(unittest.TestCase):
    def setUp(self):
        self.now = 10
        self.fixtures = {
            ("diagnostics", "authorize"): ok(authorized=True, actor_ref="A", administrative=True, can_view_actor="B"),
            ("diagnostics", "restore"): ok(authorized=True, administrative=True),
            ("system11", "clock"): ok(canonical_timestamp=10, game_day="day1", paused=False, choice_pending=False),
            ("manifest", "template"): ok(approved=True, template=deepcopy(TEMPLATE)),
            ("system13", "verify_cause"): ok(valid=True, cause_ref="cause:hours", kind="committed_event"),
            ("system9", "validate_proposal"): ok(participants_exist=True, identity_continuity=True),
            ("system12", "validate_proposal"): ok(place_exists=True, access_valid=True, scope_valid=True),
            ("system11", "validate_proposal"): ok(schedules_valid=True, choice_boundary_satisfied=True),
            ("system15", "validate_proposal"): ok(resources_valid=True, reservations_compatible=True),
            ("manifest", "eligibility"): ok(eligible=True, causal_requirements_satisfied=True, context_allowed=True,
                generation_class="discretionary", actors=["A"], requirements=[], reasons_ref="reason:hours", neighborhood_ref="N"),
            ("system9", "actor"): ok(exists=True, actor_ref="A", control="npc"),
            ("system11", "review_boundary"): ok(due=True, game_day="day1"),
            ("manifest", "selection"): ok(approved=True, seed_ref="seed:review", selected_ids=["P"]),
            ("system11", "revalidate_workflow"): ok(schedules_valid=True, choice_boundary_satisfied=True),
            ("system15", "reserve"): ok(reserved=True, reservations_ref="reservation:P", pending_step_refs=["step:P"]),
            ("system13", "committed_event"): ok(committed=True, event_ref="event:hours", occurred_at=10, proposal_ref="P"),
            ("system10", "validate_outcome"): ok(recorded=True, steps_match=True, limitations_supported=True),
            ("knowledge", "acquired_sources"): ok(all_acquired=True, scope_supported=True),
            ("knowledge", "account_decision"): ok(actual_decision=True, content_scope_supported=True, privacy_satisfied=True, lineage_preserved=True),
            ("manifest", "retelling_semantics"): ok(approved=True, bounded=True, new_allegations_explicit=True, summary_adds_no_facts=True),
            ("system16", "validate_publication"): ok(authorized=True, channel_available=True, era_supported=True, privacy_satisfied=True),
            ("system16", "publish"): ok(published=True, content_ref="content:V", published_at=10, publication_ref="pub:V"),
            ("system16", "transmission_opportunity"): ok(actual_opportunity=True, recipients_supported=True, channel_available=True,
                era_supported=True, time_available=True, recipient_refs=["B"]),
            ("knowledge", "sharing_decision"): ok(actual_decision=True, privacy_satisfied=True, choice_boundary_satisfied=True,
                choice="share", generation_class="discretionary"),
            ("system16", "delivery"): ok(transmission_id="T", delivery_status="delivered", delivered_refs=["delivery:T:B"], delivered_at=10),
            ("system16", "exposure"): ok(actually_exposed=True, recipient_matches=True, content_scope_supported=True,
                actor_ref="B", variant_id="V", delivered_at=10, acquired_at=10, voluntary_viewing=False),
            ("knowledge", "record_acquisition"): ok(recorded=True, actor_ref="B", variant_id="V", acquisition_ref="acquisition:B:V", received_content_ref="content:V"),
        }
        self.engine = LivingCityRumor(MockDependencies(self.fixtures))

    def refresh(self):
        self.engine._dependencies = MockDependencies(self.fixtures)

    def command(self, name, data, key=None, revision=None):
        return {"command": name, "envelope": {
            "authority_ref": "authority:fixture",
            "expected_revision": self.engine.revision if revision is None else revision,
            "canonical_timestamp": self.now, "correlation_id": "correlation:fixture",
            "idempotency_key": key or f"{name}:{self.engine.revision}",
        }, "input": deepcopy(data)}

    def run_command(self, name, data, expected="ok", **kwargs):
        self.refresh()
        result = self.engine.step(self.command(name, data, **kwargs))
        self.assertEqual(result["status"], expected, result)
        return result

    def snapshot(self):
        return self.run_command("ExportState", {})["result"]["state"]

    def proposal(self, identity="P", cause="cause:hours", generation="discretionary"):
        self.fixtures[("system13", "verify_cause")] = ok(valid=True, cause_ref=cause, kind="committed_event")
        template_ref = self.run_command("RegisterTemplate", {"template_ref": "template:hours"})["result"]["template_version"]
        proposal = {
            "id": identity, "template_version": template_ref, "cause_refs": [cause], "actors_ref": "actors:A",
            "place_scope": "place:diner", "due_at": self.now, "reservations_ref": None, "seed_ref": "seed:" + identity, "status": "candidate",
        }
        self.run_command("ProposeCityEvent", {"proposal": proposal, "generation_class": generation, "cause_owner_refs": {cause: "system13"}})
        return proposal

    def committed_proposal(self):
        self.proposal()
        self.run_command("ValidateProposal", {"proposal_id": "P"})
        self.run_command("ReviewNeighborhood", {"neighborhood_ref": "N", "proposal_ids": ["P"], "review_ref": "review:1", "seed_ref": "seed:review"})
        self.run_command("CommitCityWorkflow", {"proposal_id": "P"})

    def outcome_input(self, proposal="P", identity="O"):
        return {"occurrence": {"id": identity, "proposal_ref": proposal, "owner_event_refs": ["event:hours"],
            "occurred_at": 10, "outcome_ref": "outcome:hours", "follow_on_refs": []},
            "owner_refs": {"event:hours": "system13"}, "status": "completed",
            "completed_step_refs": ["step:P"] if proposal else []}

    def account_input(self, identity="V", parent=None):
        return {
            "proposition": {"id": "claim:hours", "subject_ref": "description:diner", "claim_kind": "operating_hours",
                "place_scope": "place:diner", "relevant_interval": [10, None], "proposition_ref": "proposition:shorter_hours"},
            "variant": {"id": identity, "proposition_id": "claim:hours", "author_ref": "A", "content_ref": "content:" + identity,
                "parent_variant": parent, "lineage_root": "V" if parent else identity, "claimed_source_ref": "notice:hours",
                "published_at": None, "qualifiers_ref": "qualifiers:uncertain"},
            "source_refs": ["content:" + parent] if parent else ["notice:hours"], "decision_ref": "decision:" + identity,
            "transformation": {"method": "summary" if parent else None, "changed_fields": [], "reason_ref": None}, "correction_of": [],
        }

    def account(self, identity="V", parent=None):
        return self.run_command("CreateAccount", self.account_input(identity, parent))

    def transmission_input(self, identity="T", variant="V"):
        return {"transmission": {"id": identity, "variant_id": variant, "sender_ref": "A", "recipients_ref": "recipients:B",
            "channel_ref": "channel:sms", "attempted_at": self.now, "delivered_refs": [], "status": "attempted"},
            "opportunity_ref": "opportunity:" + identity, "decision_ref": "decision:" + identity}

    def delivered(self):
        self.account()
        self.run_command("AttemptTransmission", self.transmission_input())
        self.run_command("RecordDelivery", {"transmission_id": "T"})

    def acquired(self):
        self.delivered()
        self.run_command("RecordAcquisition", {"actor_ref": "B", "variant_id": "V", "exposure_ref": "delivery:T:B", "transmission_id": "T"})

    def test_default_dependencies_never_fabricate_success(self):
        engine = LivingCityRumor()
        result = engine.step(self.command("RegisterTemplate", {"template_ref": "x"}))
        self.assertEqual(result["status"], "pending")
        self.assertEqual(engine.revision, 0)

    def test_schema_contains_only_declared_state(self):
        state = self.snapshot()
        self.assertEqual(set(state), {f.name for f in fields(CityState)})
        with self.assertRaises(AttributeError):
            CityState().global_reputation = 100

    def test_proposals_have_no_material_effects(self):
        self.proposal()
        state = self.snapshot()
        self.assertEqual(state["city_occurrence"], {})
        self.assertEqual(state["account_variant"], {})
        self.assertEqual(state["city_proposal"]["P"]["status"], "candidate")

    def test_actual_owner_outcome_is_required(self):
        self.committed_proposal()
        self.fixtures[("system13", "committed_event")]["committed"] = False
        before = self.snapshot()
        self.run_command("RecordCityOutcome", self.outcome_input(), "rejected")
        self.assertEqual(self.snapshot(), before)
        self.fixtures[("system13", "committed_event")]["committed"] = True
        self.run_command("RecordCityOutcome", self.outcome_input())
        state = self.snapshot()
        self.assertEqual(state["city_proposal"]["P"]["status"], "completed")
        self.assertEqual(state["workflow_continuity"]['["proposal","P"]']["completed_owner_event_refs"], ["event:hours"])

    def test_owner_effect_cannot_be_duplicated_with_new_command_key(self):
        self.run_command("RecordCityOutcome", self.outcome_input(None))
        self.run_command("RecordCityOutcome", self.outcome_input(None, "O2"), "rejected")
        self.assertEqual(len(self.snapshot()["city_occurrence"]), 1)

    def test_partial_effects_survive_pending_owner_and_cancellation(self):
        self.fixtures[("system15", "reserve")]["pending_step_refs"].append("step:other")
        self.committed_proposal()
        self.run_command("RecordCityOutcome", self.outcome_input())
        self.fixtures[("manifest", "cancel_decision")] = ok(supported=True, choice_boundary_satisfied=True)
        self.run_command("CancelCityWorkflow", {"proposal_id": "P", "decision_ref": "cancel"})
        self.assertEqual(self.snapshot()["city_proposal"]["P"]["status"], "partial")
        self.fixtures[("system15", "release_unused")] = ok(released_unused_only=True)
        self.run_command("CancelCityWorkflow", {"proposal_id": "P", "decision_ref": "cancel"})
        state = self.snapshot()
        self.assertEqual(state["city_proposal"]["P"]["status"], "cancelled")
        self.assertIn("O", state["city_occurrence"])

    def test_exact_retry_reuses_result_and_different_payload_rejects(self):
        request = self.command("RegisterTemplate", {"template_ref": "template:hours"}, key="same")
        first = self.engine.step(request)
        self.assertEqual(first["status"], "ok")
        self.assertEqual(self.engine.step(request), first)
        altered = deepcopy(request)
        altered["input"]["template_ref"] = "other"
        self.assertEqual(self.engine.step(altered)["error"], "idempotency_conflict")
        self.assertEqual(self.engine.revision, 1)

    def test_revision_pause_choice_and_clock_gates_are_atomic(self):
        for field, value in (("paused", True), ("choice_pending", True), ("canonical_timestamp", 11)):
            with self.subTest(field=field):
                original = self.fixtures[("system11", "clock")][field]
                self.fixtures[("system11", "clock")][field] = value
                self.run_command("RegisterTemplate", {"template_ref": "x"}, "rejected")
                self.fixtures[("system11", "clock")][field] = original
        self.run_command("RegisterTemplate", {"template_ref": "x"}, "rejected", revision=99)
        self.assertEqual(self.engine.revision, 0)

    def test_substrate_gates_do_not_create_people_or_resources(self):
        self.proposal()
        for owner, flag in (("system9", "participants_exist"), ("system12", "place_exists"),
                            ("system11", "schedules_valid"), ("system15", "resources_valid")):
            with self.subTest(owner=owner):
                self.fixtures[(owner, "validate_proposal")][flag] = False
                self.run_command("ValidateProposal", {"proposal_id": "P"}, "rejected")
                self.fixtures[(owner, "validate_proposal")][flag] = True
        self.assertEqual(self.snapshot()["city_proposal"]["P"]["status"], "rejected")

    def test_severe_generation_requires_cause_and_random_gate(self):
        self.fixtures[("manifest", "template")]["template"]["impact_band"] = "severe"
        self.proposal()
        self.run_command("ValidateProposal", {"proposal_id": "P"}, "rejected")
        self.fixtures[("manifest", "eligibility")]["established_severe_cause"] = True
        self.fixtures[("manifest", "eligibility")]["random_discretionary"] = True
        self.run_command("ValidateProposal", {"proposal_id": "P"}, "rejected")
        self.fixtures[("manifest", "eligibility")]["random_discretionary"] = False
        self.run_command("ValidateProposal", {"proposal_id": "P"})

    def test_local_budget_and_once_daily_review(self):
        identities = ["P", "P2", "P3"]
        for identity in identities:
            self.proposal(identity, "cause:" + identity)
            self.run_command("ValidateProposal", {"proposal_id": identity})
        self.fixtures[("manifest", "selection")]["selected_ids"] = identities
        data = {"neighborhood_ref": "N", "proposal_ids": identities, "review_ref": "review:1", "seed_ref": "seed:review"}
        result = self.run_command("ReviewNeighborhood", data)
        self.assertEqual(result["result"]["selected_ids"], ["P", "P2"])
        second = self.run_command("ReviewNeighborhood", data)
        self.assertEqual(second["result"], result["result"])
        self.run_command("CommitCityWorkflow", {"proposal_id": "P3"}, "rejected")

    def test_no_feasible_candidates_is_quiet(self):
        result = self.run_command("ReviewNeighborhood", {"neighborhood_ref": "N", "proposal_ids": [], "review_ref": "r", "seed_ref": "seed:review"})
        self.assertEqual(result["result"]["status"], "quiet")

    def test_existing_continuation_bypasses_discretionary_selection(self):
        self.fixtures[("manifest", "eligibility")]["generation_class"] = "existing_cause_continuation"
        self.proposal(generation="existing_cause_continuation")
        self.run_command("ValidateProposal", {"proposal_id": "P"})
        self.run_command("CommitCityWorkflow", {"proposal_id": "P"})
        self.assertTrue(all(not x for x in self.snapshot()["budget_projections"].values()))

    def test_publication_is_not_acquisition(self):
        self.account()
        self.run_command("PublishAccount", {"variant_id": "V", "channel_ref": "notice", "visibility_ref": "public"})
        state = self.snapshot()
        self.assertEqual(len(state["information_provenance"]), 1)
        self.assertEqual(state["audience_assessment"], {})

    def test_attempt_failure_and_delay_never_acquire(self):
        self.account()
        self.run_command("AttemptTransmission", self.transmission_input())
        del self.fixtures[("system16", "delivery")]
        result = self.run_command("RecordDelivery", {"transmission_id": "T"})
        self.assertEqual(result["result"]["status"], "delayed")
        self.run_command("RecordAcquisition", {"actor_ref": "B", "variant_id": "V", "exposure_ref": "missing", "transmission_id": "T"}, "rejected")
        self.fixtures[("system16", "delivery")] = ok(transmission_id="T", delivery_status="failed", delivered_refs=[])
        self.run_command("RecordDelivery", {"transmission_id": "T"})
        self.assertEqual(self.snapshot()["audience_assessment"], {})

    def test_receipt_and_actor_acquisition_are_distinct(self):
        self.delivered()
        before = self.snapshot()
        self.fixtures[("system16", "exposure")]["actor_ref"] = "C"
        self.run_command("RecordAcquisition", {"actor_ref": "B", "variant_id": "V", "exposure_ref": "delivery:T:B", "transmission_id": "T"}, "rejected")
        self.assertEqual(self.snapshot(), before)
        self.fixtures[("system16", "exposure")]["actor_ref"] = "B"
        self.run_command("RecordAcquisition", {"actor_ref": "B", "variant_id": "V", "exposure_ref": "delivery:T:B", "transmission_id": "T"})
        self.assertEqual(self.snapshot()["audience_assessment"], {})

    def test_acquisition_cannot_be_backdated(self):
        self.delivered()
        self.fixtures[("system16", "exposure")]["acquired_at"] = 9
        self.run_command("RecordAcquisition", {"actor_ref": "B", "variant_id": "V", "exposure_ref": "delivery:T:B", "transmission_id": "T"}, "rejected")

    def test_retell_cap_does_not_cancel_supplied_action(self):
        self.account()
        self.run_command("AttemptTransmission", self.transmission_input("T1"))
        self.run_command("AttemptTransmission", self.transmission_input("T2"))
        result = self.run_command("AttemptTransmission", self.transmission_input("T3"))
        self.assertEqual(result["result"]["status"], "deferred")
        self.run_command("RecordDelivery", {"transmission_id": "T3"}, "rejected")
        self.fixtures[("knowledge", "sharing_decision")]["generation_class"] = "supplied_action"
        result = self.run_command("ResumeTransmission", {"transmission_id": "T3", "opportunity_ref": "new:opportunity", "decision_ref": "new:decision"})
        self.assertEqual(result["result"]["status"], "attempted")

    def test_hop_cap(self):
        self.account()
        self.run_command("AttemptTransmission", self.transmission_input("T1"))
        self.run_command("AttemptTransmission", self.transmission_input("T2"))
        self.fixtures[("system9", "actor")] = ok(exists=True, actor_ref="B", control="npc")
        data = self.transmission_input("T3")
        data["transmission"]["sender_ref"] = "B"
        self.run_command("AttemptTransmission", data)
        data = self.transmission_input("T4")
        data["transmission"]["sender_ref"] = "B"
        result = self.run_command("AttemptTransmission", data)
        self.assertEqual(result["result"]["status"], "deferred")
        self.assertEqual(self.snapshot()["budget_projections"]["lineage_hops_by_day"], {'["V","day1"]': 3})

    def test_player_action_requires_explicit_scoped_authorization(self):
        self.fixtures[("system9", "actor")]["control"] = "player"
        self.run_command("CreateAccount", self.account_input(), "pending")
        self.fixtures[("player", "authorize_action")] = ok(authorized=True, content_exact_or_reviewed=False, choice_boundary_satisfied=True)
        self.run_command("CreateAccount", self.account_input(), "rejected")
        self.fixtures[("player", "authorize_action")]["content_exact_or_reviewed"] = True
        self.account()

    def test_rejected_transformation_cannot_mutate_original(self):
        self.account()
        before = self.snapshot()
        self.fixtures[("manifest", "retelling_semantics")]["bounded"] = False
        self.run_command("CreateAccount", self.account_input("V2", "V"), "rejected")
        self.assertEqual(self.snapshot(), before)

    def test_copies_keep_one_root_and_correction_preserves_history(self):
        self.account()
        self.account("V2", "V")
        correction = self.account_input("V3", "V2")
        correction["correction_of"] = ["V", "V2"]
        self.run_command("IssueCorrection", correction)
        state = self.snapshot()
        self.assertEqual({v["lineage_root"] for v in state["account_variant"].values()}, {"V"})
        self.assertEqual(state["account_variant"]["V"]["content_ref"], "content:V")
        self.assertEqual(state["city_occurrence"], {})

    def test_cycle_in_restored_lineage_is_rejected(self):
        self.account()
        state = self.snapshot()
        state["account_variant"]["V"]["parent_variant"] = "V"
        with self.assertRaises(GateError):
            LivingCityRumor.restore(state, MockDependencies(self.fixtures), "admin")

    def test_external_assessment_does_not_compute_truth(self):
        self.acquired()
        self.fixtures[("system9", "actor")] = ok(exists=True, actor_ref="B", control="npc")
        self.fixtures[("knowledge", "review_belief")] = ok(recorded=True, accessible_sources_only=True, independence_preserved=True,
            assessment={"id": "assessment:1", "holder_ref": "B", "proposition_id": "claim:hours",
                "acquired_source_refs": ["acquisition:B:V"], "confidence": "tentative", "reasons_ref": "reason:source",
                "reviewed_at": 10, "supersedes_id": None})
        self.run_command("ReviewBelief", {"actor_ref": "B", "proposition_id": "claim:hours", "variant_ids": ["V"], "decision_ref": "belief"})
        self.assertEqual(self.snapshot()["audience_assessment"]["assessment:1"]["confidence"], "tentative")
        self.assertEqual(self.snapshot()["city_occurrence"], {})

    def test_query_filters_hidden_lineage_and_requires_acquisition(self):
        self.acquired()
        self.fixtures[("knowledge", "query_view")] = ok(safe_for_actor=True, available_or_acquired_only=True, actor_ref="B", items=[{
            "variant_id": "V", "display_text": "Reported shorter hours", "lineage_root": "secret", "hidden_subject": "secret",
        }])
        result = self.run_command("GetReceivedRumors", {"actor_ref": "B", "scope_ref": "local"})
        self.assertEqual(result["result"]["items"], [{"variant_id": "V", "display_text": "Reported shorter hours"}])
        self.fixtures[("knowledge", "query_view")]["items"][0]["variant_id"] = "not_received"
        self.run_command("GetReceivedRumors", {"actor_ref": "B", "scope_ref": "local"}, "rejected")
        self.run_command("GetReceivedRumors", {"actor_ref": "C", "scope_ref": "local"}, "rejected")

    def test_presentation_caps_optional_updates_but_not_urgency(self):
        self.fixtures[("diagnostics", "authorize_view")] = ok(authorized=True, actor_ref="A")
        self.fixtures[("knowledge", "query_view")] = ok(safe_for_actor=True, available_or_acquired_only=True, actor_ref="A", items=[
            {"display_text": "ordinary one"}, {"display_text": "ordinary two"}, {"display_text": "hazard", "physical_interruption": True}])
        data = {"actor_ref": "A", "scope_ref": "local", "scene_ref": "scene", "more_requested_ref": None}
        result = self.run_command("PresentKnownInformation", data)
        self.assertEqual(len(result["result"]["items"]), 2)
        result = self.run_command("PresentKnownInformation", data)
        self.assertEqual(len(result["result"]["items"]), 1)
        self.fixtures[("player", "more_requested")] = ok(explicit=True)
        data["more_requested_ref"] = "player:more"
        self.assertEqual(len(self.run_command("PresentKnownInformation", data)["result"]["items"]), 3)

    def test_save_reload_replays_without_new_transmission(self):
        self.account()
        request = self.command("AttemptTransmission", self.transmission_input(), key="stable")
        expected = self.engine.step(request)
        snapshot = json.loads(json.dumps(self.snapshot(), sort_keys=True))
        restored = LivingCityRumor.restore(snapshot, MockDependencies(self.fixtures), "admin")
        self.assertEqual(restored.step(request), expected)
        self.assertEqual(restored.revision, self.engine.revision)

    def test_mutating_returned_json_cannot_mutate_state(self):
        self.account()
        snapshot = self.snapshot()
        snapshot["account_variant"]["V"]["content_ref"] = "tampered"
        self.assertEqual(self.snapshot()["account_variant"]["V"]["content_ref"], "content:V")

    def test_malformed_and_undeclared_input_is_rejected(self):
        self.run_command("RegisterTemplate", {"template_ref": "x", "global_danger": 100}, "rejected")
        self.assertEqual(self.engine.step({"command": "x"})["status"], "rejected")
        snapshot = self.snapshot()
        snapshot["global_belief"] = 0.9
        with self.assertRaises(GateError):
            LivingCityRumor.restore(snapshot, MockDependencies(self.fixtures), "admin")

    def test_snapshot_integrity_and_chronology_survive_sorted_json(self):
        self.account()
        self.now = 20
        self.fixtures[("system11", "clock")]["canonical_timestamp"] = 20
        self.account("V2", "V")
        snapshot = json.loads(json.dumps(self.snapshot(), sort_keys=True))
        restored = LivingCityRumor.restore(snapshot, MockDependencies(self.fixtures), "admin")
        self.assertEqual(restored.revision, 2)
        snapshot["account_variant"]["V"]["content_ref"] = "forged"
        with self.assertRaises(GateError):
            LivingCityRumor.restore(snapshot, MockDependencies(self.fixtures), "admin")

    def test_medium_city_cap_across_neighborhoods(self):
        self.fixtures[("manifest", "template")]["template"]["impact_band"] = "medium"
        selected = []
        for number in range(5):
            identity, neighborhood = f"P{number}", f"N{number}"
            self.fixtures[("manifest", "eligibility")]["neighborhood_ref"] = neighborhood
            self.proposal(identity, "cause:" + identity)
            self.run_command("ValidateProposal", {"proposal_id": identity})
            self.fixtures[("manifest", "selection")]["selected_ids"] = [identity]
            reply = self.run_command("ReviewNeighborhood", {"neighborhood_ref": neighborhood, "proposal_ids": [identity],
                "review_ref": "review:" + neighborhood, "seed_ref": "seed:review"})
            selected.extend(reply["result"]["selected_ids"])
        self.assertEqual(selected, ["P0", "P1", "P2", "P3"])
        self.assertEqual(self.snapshot()["budget_projections"]["medium_proposals_by_city_day"], {"day1": 4})

    def test_policy_update_is_prospective_and_preserves_templates(self):
        self.proposal()
        old_state = self.snapshot()
        policies = {name: deepcopy(old_state[name]) for name in ("generation_policy", "dissemination_policy", "presentation_policy")}
        policies["generation_policy"]["policy_version"] = "2.0"
        policies["generation_policy"]["low_proposals_per_neighborhood_day"] = 0
        self.fixtures[("manifest", "policies")] = ok(approved=True, prospective_only=True, **policies)
        self.run_command("ConfigurePolicies", {"policy_ref": "policies:2"})
        new_state = self.snapshot()
        self.assertEqual(new_state["city_template"], old_state["city_template"])
        self.assertEqual(new_state["workflow_continuity"]['["proposal","P"]']["eligibility_result"]["policy"]["policy_version"], "1.0")
        self.assertEqual(new_state["generation_policy"]["policy_version"], "2.0")

    def test_changed_resource_revalidated_before_commit(self):
        self.proposal()
        self.run_command("ValidateProposal", {"proposal_id": "P"})
        self.run_command("ReviewNeighborhood", {"neighborhood_ref": "N", "proposal_ids": ["P"], "review_ref": "r", "seed_ref": "seed:review"})
        self.fixtures[("system15", "validate_proposal")]["resources_valid"] = False
        self.run_command("CommitCityWorkflow", {"proposal_id": "P"}, "rejected")
        self.assertIsNone(self.snapshot()["city_proposal"]["P"]["reservations_ref"])

    def test_cause_cannot_be_reinterpreted_as_another_occurrence(self):
        original = self.proposal()
        replacement = deepcopy(original)
        replacement["id"] = "P2"
        replacement["seed_ref"] = "different_seed"
        response = self.run_command("ProposeCityEvent", {"proposal": replacement,
            "generation_class": "discretionary", "cause_owner_refs": {"cause:hours": "system13"}})
        self.assertEqual(response["result"]["proposal_id"], "P")
        self.assertEqual(len(self.snapshot()["city_proposal"]), 1)

    def test_publication_view_without_delivery_uses_actual_exposure(self):
        self.account()
        self.run_command("PublishAccount", {"variant_id": "V", "channel_ref": "notice", "visibility_ref": "public"})
        self.fixtures[("system16", "exposure")]["actually_exposed"] = False
        data = {"actor_ref": "B", "variant_id": "V", "exposure_ref": "view:notice", "transmission_id": None}
        self.run_command("RecordAcquisition", data, "rejected")
        self.fixtures[("system16", "exposure")]["actually_exposed"] = True
        self.run_command("RecordAcquisition", data)

    def test_confidentiality_violation_needs_recorded_disclosure(self):
        self.fixtures[("knowledge", "account_decision")]["unauthorized_disclosure"] = True
        self.run_command("CreateAccount", self.account_input(), "rejected")
        self.fixtures[("knowledge", "account_decision")]["disclosure_event_ref"] = "disclosure:1"
        self.account()
        self.assertEqual(self.snapshot()["information_provenance"]['["variant","V"]']["disclosure_event_ref"], "disclosure:1")

    def test_media_requires_staff_sources_editorial_review_and_publication(self):
        self.fixtures[("system13", "media_stage")] = ok(worker_available=True, service_available=True,
            access_valid=True, actual_decision=True, time_supported=True)
        task = {"id": "media:1", "outlet_ref": "outlet", "worker_ref": "A", "source_refs": ["notice:hours"],
            "objective_ref": "inquiry:hours", "due_at": 10, "status": "inquiry", "publication_ref": None}
        self.run_command("OpenMediaTask", {"task": task})
        data = {"task_id": "media:1", "next_status": "publication", "source_refs": ["notice:hours"],
                "publication_variant_id": "V", "decision_ref": "editorial:1"}
        self.run_command("AdvanceMediaTask", data, "rejected")
        for status in ("reporting", "editorial_review"):
            data.update(next_status=status, publication_variant_id=None)
            self.run_command("AdvanceMediaTask", data)
        self.account()
        data.update(next_status="publication", publication_variant_id="V")
        self.run_command("AdvanceMediaTask", data, "rejected")
        self.run_command("PublishAccount", {"variant_id": "V", "channel_ref": "paper", "visibility_ref": "public"})
        self.fixtures[("system13", "publication_assignment")] = ok(authorized=True, submitted_material_only=True, publication_ref="pub:V")
        self.run_command("AdvanceMediaTask", data)
        self.assertEqual(self.snapshot()["media_task"]["media:1"]["publication_ref"], "pub:V")
        self.assertEqual(self.snapshot()["audience_assessment"], {})

    def test_follow_on_cap_defers_and_owner_failure_keeps_request(self):
        self.run_command("RecordCityOutcome", self.outcome_input(None))
        self.fixtures[("system13", "validate_follow_on")] = ok(actual_decision=True, causally_relevant=True,
            resources_feasible=True, acquired_information_only=True, claim_not_promoted_to_truth=True,
            generation_class="discretionary", new_condition_ref="condition:notice")
        self.fixtures[("system11", "follow_on_review")] = ok(due=True, new_information_or_later_review=True)
        workflows = []
        for number in range(4):
            result = self.run_command("ScheduleFollowOn", {"actor_ref": "A", "variant_id": None,
                "decision_ref": f"decision:{number}", "owner": "system13", "workflow_ref": f"workflow:{number}",
                "parent_occurrence_id": "O", "generation_class": "discretionary", "review_ref": "review:1"})
            workflows.append(result["result"]["workflow_id"])
        self.assertEqual(result["result"]["status"], "deferred")
        self.fixtures[("system13", "revalidate_follow_on")] = ok(actual_decision=True, resources_feasible=True, choice_boundary_satisfied=True)
        result = self.run_command("DispatchFollowOn", {"workflow_id": workflows[0], "review_ref": "review:1"})
        self.assertEqual(result["result"]["status"], "pending")
        self.fixtures[("system13", "request_workflow")] = ok(accepted=True, workflow_ref="accepted:work")
        result = self.run_command("DispatchFollowOn", {"workflow_id": workflows[0], "review_ref": "review:1"})
        self.assertEqual(result["result"]["status"], "handed_off")
        result = self.run_command("DispatchFollowOn", {"workflow_id": workflows[-1], "review_ref": "review:2"})
        self.assertEqual(result["result"]["status"], "handed_off")
        self.assertEqual(len(self.snapshot()["city_occurrence"]), 1)

    def test_recurrence_due_is_not_attendance_and_cancel_is_not_notice(self):
        recurrence = {"series_id": "series:1", "occurrence_ids": [], "calendar_rule_ref": "calendar:weekly",
            "organizer_ref": "A", "planned_resources_ref": "resources:meeting", "review_policy_ref": "review:meeting", "schedule_revision_refs": []}
        self.fixtures[("system11", "register_recurrence")] = ok(accepted_plan=True, calendar_supported=True, resources_supported=True)
        self.run_command("RegisterRecurrence", {"recurrence": recurrence})
        self.fixtures[("system11", "recurrence_occurrence")] = ok(supported=True, series_id="series:1", occurrence_id="meeting:1",
            occurred_at=10, occurrence_status="due", schedule_revision_ref="schedule:1")
        data = {"series_id": "series:1", "occurrence_id": "meeting:1", "decision_ref": "decision:meeting"}
        self.run_command("ReviewRecurrence", data)
        self.assertEqual(self.snapshot()["city_occurrence"], {})
        self.fixtures[("system11", "recurrence_occurrence")].update(occurrence_status="cancelled", actual_decision=True, schedule_revision_ref="schedule:2")
        self.run_command("ReviewRecurrence", data)
        self.assertEqual(self.snapshot()["transmission"], {})
        self.fixtures[("system11", "recurrence_occurrence")]["occurrence_status"] = "due"
        self.run_command("ReviewRecurrence", data, "rejected")

    def test_batch_commits_earlier_tasks_and_stops_on_failure(self):
        first = self.command("CreateAccount", self.account_input(), key="batch:1", revision=0)
        second = self.command("CreateAccount", self.account_input("V2", "missing"), key="batch:2", revision=1)
        third = self.command("CreateAccount", self.account_input("V3", "V"), key="batch:3", revision=2)
        self.fixtures[("diagnostics", "authorize_batch")] = ok(authorized=True)
        self.fixtures[("system11", "due_commands")] = ok(chronological=True, tie_order_explicit=True, bounded=True, commands=[first, second, third])
        result = self.run_command("ProcessDueBoundary", {})
        self.assertEqual([x["status"] for x in result["result"]["results"]], ["ok", "rejected"])
        self.assertEqual(result["result"]["remaining"], 1)
        self.assertEqual(list(self.snapshot()["account_variant"]), ["V"])

    def test_retention_preserves_received_artifacts_and_audit(self):
        self.acquired()
        state = self.snapshot()
        policies = {name: deepcopy(state[name]) for name in ("generation_policy", "dissemination_policy", "presentation_policy")}
        policies["generation_policy"]["policy_version"] = "2.0"
        policies["presentation_policy"]["retention_policy_refs"] = ["retention:notice"]
        self.fixtures[("manifest", "policies")] = ok(approved=True, prospective_only=True, **policies)
        self.run_command("ConfigurePolicies", {"policy_ref": "policy:2"})
        self.fixtures[("system16", "apply_retention")] = ok(source_specific=True, recipient_copies_preserved=True, audit_preserved=True, retention_event_ref="removed:notice")
        self.run_command("ApplyRetention", {"artifact_ref": "notice:hours", "policy_ref": "retention:notice"})
        after = self.snapshot()
        self.assertEqual(after["information_provenance"], state["information_provenance"])
        self.assertEqual(after["account_variant"], state["account_variant"])

    def test_rebuild_circulation_never_becomes_truth(self):
        self.delivered()
        self.fixtures[("diagnostics", "repair")] = ok(authorized=True, administrative=True)
        self.run_command("RebuildProjections", {"scope_ref": "scope:circulation", "reason_ref": "reason:repair", "provenance_ref": "audit:1"})
        state = self.snapshot()
        self.assertEqual(state["derived_views"]["circulation_by_proposition"]["claim:hours"], {"transmissions": 1, "lineage_roots": ["V"]})
        self.assertEqual(state["city_occurrence"], {})

    def test_owner_step_receipt_survives_and_does_not_invent_outcome(self):
        self.committed_proposal()
        self.fixtures[("system10", "validate_step")] = ok(bound_to_workflow=True, prerequisites_revalidated=True,
            due=True, choice_boundary_satisfied=True)
        data = {"proposal_id": "P", "step_ref": "step:P", "owner": "system13"}
        result = self.run_command("ExecuteWorkflowStep", data)
        self.assertEqual(result["result"]["status"], "pending")
        self.fixtures[("system13", "request_step")] = ok(accepted=True, request_ref="accepted:P")
        result = self.run_command("ExecuteWorkflowStep", data)
        self.assertEqual(result["result"]["status"], "awaiting_owner_outcome")
        state = self.snapshot()
        self.assertEqual(state["city_occurrence"], {})
        self.assertEqual(state["workflow_continuity"]['["proposal","P"]']["pending_step_refs"], ["step:P"])
        del self.fixtures[("system13", "request_step")]
        restored = LivingCityRumor.restore(state, MockDependencies(self.fixtures), "admin")
        self.engine = restored
        result = self.run_command("ExecuteWorkflowStep", data)
        self.assertEqual(result["result"]["status"], "awaiting_owner_outcome")
        self.run_command("RecordCityOutcome", self.outcome_input())
        self.assertEqual(self.snapshot()["city_proposal"]["P"]["status"], "completed")

    def test_deferred_validation_keeps_seed_and_reason(self):
        self.proposal()
        del self.fixtures[("system12", "validate_proposal")]
        request = self.command("ValidateProposal", {"proposal_id": "P"}, key="validation:pending")
        self.refresh()
        result = self.engine.step(request)
        self.assertEqual(result["status"], "pending")
        self.assertEqual(self.engine.step(request), result)
        state = self.snapshot()
        self.assertEqual(state["city_proposal"]["P"]["status"], "deferred")
        self.assertEqual(state["workflow_continuity"]['["proposal","P"]']["selection_seed_ref"], "seed:P")
        self.assertEqual(state["workflow_continuity"]['["proposal","P"]']["deferral_reason_ref"], "pending_dependency")
        self.fixtures[("system12", "validate_proposal")] = ok(place_exists=True, access_valid=True, scope_valid=True)
        self.run_command("ValidateProposal", {"proposal_id": "P"})
        self.assertEqual(self.snapshot()["city_proposal"]["P"]["status"], "validated")

    def test_concurrent_retries_produce_one_event(self):
        request = self.command("CreateAccount", self.account_input(), key="concurrent")
        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(self.engine.step, [request] * 16))
        self.assertTrue(all(response == responses[0] for response in responses))
        self.assertEqual(responses[0]["status"], "ok")
        self.assertEqual(self.engine.revision, 1)

    def test_partial_delivery_preserves_already_delivered_portions(self):
        self.account()
        self.run_command("AttemptTransmission", self.transmission_input())
        self.fixtures[("system16", "delivery")]["delivery_status"] = "partially_delivered"
        self.run_command("RecordDelivery", {"transmission_id": "T"})
        self.fixtures[("system16", "delivery")]["delivered_refs"] = []
        self.fixtures[("system16", "delivery")]["delivery_status"] = "failed"
        self.run_command("RecordDelivery", {"transmission_id": "T"}, "rejected")
        self.assertEqual(self.snapshot()["transmission"]["T"]["delivered_refs"], ["delivery:T:B"])

    def test_unsupported_account_source_does_not_create_fact(self):
        self.fixtures[("knowledge", "acquired_sources")]["all_acquired"] = False
        self.run_command("CreateAccount", self.account_input(), "rejected")
        self.assertEqual(self.snapshot()["account_variant"], {})
        self.assertEqual(self.snapshot()["city_occurrence"], {})

    def test_explicit_false_statement_stays_only_an_account(self):
        data = self.account_input()
        data["source_refs"] = []
        self.run_command("CreateAccount", data, "rejected")
        self.fixtures[("knowledge", "account_decision")]["supplied_statement_or_authored_fabrication"] = True
        self.run_command("CreateAccount", data)
        self.assertEqual(self.snapshot()["city_occurrence"], {})

    def test_invalid_error_does_not_reveal_subject(self):
        response = self.run_command("PublishAccount", {"variant_id": "hidden-victim-secret", "channel_ref": "x", "visibility_ref": "x"}, "rejected")
        self.assertNotIn("hidden-victim-secret", json.dumps(response))

    def test_unapproved_modern_channel_is_rejected(self):
        self.account()
        self.fixtures[("system16", "transmission_opportunity")]["era_supported"] = False
        self.run_command("AttemptTransmission", self.transmission_input(), "rejected")
        self.assertEqual(self.snapshot()["transmission"], {})

    def test_record_ids_can_overlap_without_metadata_collision(self):
        self.account()
        self.run_command("AttemptTransmission", self.transmission_input("V"))
        state = self.snapshot()
        self.assertIn('["variant","V"]', state["information_provenance"])
        self.assertIn('["transmission","V"]', state["information_provenance"])
        self.assertEqual(state["information_provenance"]['["variant","V"]']["artifact_version_refs"], ["content:V"])

    def test_deferred_retell_resumes_on_new_day_without_changing_content(self):
        self.account()
        for identity in ("T1", "T2", "T3"):
            self.run_command("AttemptTransmission", self.transmission_input(identity))
        before = self.snapshot()
        self.assertIsNone(before["transmission"]["T3"]["attempted_at"])
        self.now = 20
        self.fixtures[("system11", "clock")].update(canonical_timestamp=20, game_day="day2")
        result = self.run_command("ResumeTransmission", {"transmission_id": "T3", "opportunity_ref": "new:opportunity", "decision_ref": "day2:decision"})
        self.assertEqual(result["result"]["status"], "attempted")
        after = self.snapshot()
        self.assertEqual(after["account_variant"], before["account_variant"])
        self.assertEqual(after["transmission"]["T3"]["attempted_at"], 20)

    def test_later_delivered_portion_adds_acquisition_without_erasing_first(self):
        self.acquired()
        self.fixtures[("system16", "exposure")].update(delivered_at=20, acquired_at=20)
        self.fixtures[("knowledge", "record_acquisition")].update(acquisition_ref="acquisition:B:V:2", received_content_ref="content:V:second_portion")
        self.run_command("PublishAccount", {"variant_id": "V", "channel_ref": "notice", "visibility_ref": "public"})
        self.now = 20
        self.fixtures[("system11", "clock")]["canonical_timestamp"] = 20
        self.run_command("RecordAcquisition", {"actor_ref": "B", "variant_id": "V", "exposure_ref": "new:exposure", "transmission_id": None})
        state = self.snapshot()
        acquired = state["information_provenance"]['["acquired","B","V"]']
        self.assertEqual(acquired["acquisition_refs"], ["acquisition:B:V", "acquisition:B:V:2"])
        self.assertEqual(len(acquired["artifact_version_refs"]), 2)
        self.assertEqual(state["audience_assessment"], {})


if __name__ == "__main__":
    unittest.main()
