"""System 26 regression tests; external responses are JSON fixtures only."""
import copy
import json
import unittest
from dataclasses import fields
from unittest.mock import patch

from system26 import System26
from system26 import interface as module


class InterfaceTests(unittest.TestCase):
    def setUp(self):
        self.state = System26.create()

    def call(self, operation, **kwargs):
        return self.state.step({
            "operation": operation, "context": self.state.context(), **kwargs,
        })

    def command(self, **kwargs):
        return {
            "operation": "submit", "context": self.state.context(),
            "supplied_input": {"action_class": "inspect_item"},
            "target_ref": "observed-wallet", "idempotency_key": "check-wallet",
            "request_id": "request-1", "explicit": True,
            "expected_revisions": copy.deepcopy(module._MOCK_REVISIONS),
            **kwargs,
        }

    def test_state_names_are_architecture_only(self):
        self.assertEqual({f.name for f in fields(self.state)}, {
            "view_context", "visible_field", "surface_view", "ui_draft",
            "notification", "known_delta", "annotation", "navigation", "input",
            "command_presentation", "chronicle", "information_presentation",
            "notification_presentation", "cache_and_loading", "preferences",
            "entitlement_manifest",
        })
        with self.assertRaises(AttributeError):
            self.state.world_time = 10

    def test_all_default_surfaces_return_json(self):
        for surface in module._SURFACE_OWNERS:
            result = self.call("query", surface=surface)
            json.dumps(result, allow_nan=False)
            self.assertEqual(result["ok"], surface != "case_files")

    def test_hidden_fields_and_counts_never_reach_client(self):
        def fixture(request):
            response = module._dummy_reply(request)
            response["fields"].append({
                **response["fields"][0], "id": "secret-field",
                "subject_ref": "secret-thief", "value_ref": "SECRET_CUSTODY",
            })
            response["total_count"] = 999
            return response
        with patch.object(module, "request_system_15_inventory", fixture):
            result = self.call("query", surface="inventory")
        self.assertTrue(result["ok"])
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("secret-thief", json.dumps(result))
        self.assertEqual(result["payload"]["view"]["visible_count"], 1)

    def test_access_without_acquisition_omits_field(self):
        def fixture(request):
            response = module._dummy_reply(request)
            response["fields"][0]["acquisition_ref"] = "unread-record"
            return response
        with patch.object(module, "request_system_15_inventory", fixture):
            result = self.call("query", surface="inventory")
        self.assertEqual(result["payload"]["view"]["fields"], [])

    def test_navigation_preserves_draft_choice_and_time(self):
        self.call("draft", id="draft", input_kind="say", content_ref="Exact words")
        self.state.navigation["pending_choice"] = {"id": "fixture-choice"}
        before = self.state.context()
        for operation, kwargs in [("navigate", {"surface": "inventory"}),
                                  ("set_mode", {"mode": "story"}),
                                  ("close", {})]:
            self.assertTrue(self.call(operation, **kwargs)["ok"])
        self.assertEqual(self.state.context(), before)
        self.assertEqual(self.state.ui_draft["draft"]["content_ref"], "Exact words")
        self.assertEqual(self.state.navigation["pending_choice"]["id"], "fixture-choice")
        self.assertFalse(self.state.command_presentation)

    def test_preview_is_not_a_commit(self):
        with patch.object(module, "request_system_15_inventory", wraps=module._dummy_reply) as owner:
            result = self.call("preview", supplied_input={"action_class": "inspect_item"}, target_ref="observed-wallet")
        self.assertTrue(result["ok"])
        self.assertEqual(owner.call_args.args[0]["operation"], "preview")
        self.assertFalse(self.state.command_presentation)

    def test_explicit_authorization_required(self):
        result = self.state.step(self.command(explicit=False))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "authorization_required")

    def test_duplicate_never_resubmits(self):
        with patch.object(module, "request_system_15_inventory", wraps=module._dummy_reply) as owner:
            first = self.state.step(self.command())
            second = self.state.step(self.command(request_id="request-2"))
        self.assertEqual(owner.call_count, 1)
        self.assertTrue(second["payload"]["duplicate"])
        self.assertEqual(first["payload"]["command"], second["payload"]["command"])

    def test_key_reuse_with_changed_intent_is_rejected(self):
        self.state.step(self.command())
        result = self.state.step(self.command(supplied_input={"action_class": "use_item"}))
        self.assertEqual(result["error"]["code"], "idempotency_conflict")

    def test_uncertain_submission_is_retained_and_polled(self):
        with patch.object(module, "request_system_15_inventory", side_effect=TimeoutError):
            result = self.state.step(self.command())
        self.assertTrue(result["payload"]["result_pending"])
        with patch.object(module, "request_system_15_inventory", wraps=module._dummy_reply) as owner:
            self.state.step(self.command())
            self.call("poll", idempotency_key="check-wallet")
        self.assertEqual(owner.call_count, 1)
        self.assertEqual(owner.call_args.args[0]["operation"], "result")

    def test_wrong_actor_and_stale_request_rejected(self):
        for changed in ({"actor_id": "other"}, {"view_revision": 1}):
            result = self.call("query", surface="inventory", context={**self.state.context(), **changed})
            self.assertFalse(result["ok"])

    def test_late_other_timeline_response_does_not_populate_view(self):
        def fixture(request):
            response = module._dummy_reply(request)
            response["context"]["timeline_id"] = "future"
            return response
        with patch.object(module, "request_system_15_inventory", fixture):
            result = self.call("query", surface="inventory")
        self.assertFalse(result["ok"])
        self.assertFalse(self.state.surface_view)

    def test_fetch_failure_keeps_last_known_view(self):
        first = self.call("query", surface="inventory")
        with patch.object(module, "request_system_15_inventory", side_effect=TimeoutError):
            result = self.call("query", surface="inventory")
        self.assertTrue(result["payload"]["fetch_pending"])
        self.assertEqual(first["payload"]["view"], result["payload"]["view"])

    def test_search_and_export_use_filtered_projection(self):
        view = self.call("query", surface="inventory")["payload"]["view"]
        result = self.call("search", view_ref=view["id"], query="secret-thief")
        self.assertEqual(result["payload"]["view"]["visible_count"], 0)
        self.assertEqual(self.call("export", view_ref=view["id"])["payload"]["view"], view)

    def test_absent_field_does_not_create_disappearance_delta(self):
        first = self.call("query", surface="inventory")["payload"]["view"]
        def fixture(request):
            response = module._dummy_reply(request)
            response["fields"] = []
            return response
        with patch.object(module, "request_system_15_inventory", fixture):
            second = self.call("query", surface="inventory")["payload"]["view"]
        delta = self.call("delta", from_view_ref=first["id"], to_view_ref=second["id"])
        self.assertEqual(delta["payload"]["delta"]["status"], "no_change")

    def test_presentation_retry_never_repeats_action(self):
        self.state.step(self.command())
        with patch.object(module, "request_system_15_inventory") as owner:
            self.assertTrue(self.call("retry_presentation")["ok"])
        owner.assert_not_called()

    def test_annotations_remain_noncanonical(self):
        result = self.call("annotate", id="note", content_ref="Suspect is guilty", created_at="2026-10-13")
        self.assertEqual(result["payload"]["annotation"]["canonical_status"], "noncanonical")
        self.assertFalse(self.state.command_presentation)

    def test_preferences_cannot_override_policy(self):
        before = copy.deepcopy(self.state.entitlement_manifest)
        self.assertFalse(self.call("preferences", changes={"allowed_self_mechanics": ["enemy_hp"]})["ok"])
        self.assertEqual(before, self.state.entitlement_manifest)

    def test_result_at_new_cut_is_in_receipt(self):
        def fixture(request):
            response = module._dummy_reply(request)
            response["status"] = "completed"
            response["context"]["event_cut"] = "demo-cut-1"
            response["context"]["view_revision"] = 1
            response["fields"] = module._dummy_fields("inventory", response["context"])
            response["completed_effects"] = ["wallet-possession"]
            return response
        with patch.object(module, "request_system_15_inventory", fixture):
            result = self.state.step(self.command())
        self.assertEqual(result["context"]["view_revision"], 1)
        self.assertEqual(len(result["payload"]["command"]["completed_effects"]), 1)

    def test_fallback_does_not_return_different_subject(self):
        self.call("query", surface="inventory")
        with patch.object(module, "request_system_15_inventory", side_effect=TimeoutError):
            result = self.call("query", surface="inventory", subject_ref=self.state.context()["actor_id"])
        self.assertEqual(result["payload"]["view"]["fields"], [])


if __name__ == "__main__":
    unittest.main()
