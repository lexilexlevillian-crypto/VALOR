"""Executable isolation/acceptance fixtures; no real external system is loaded.

Run: python -m unittest discover -s tests/system16_python -v
All times, costs and policy values in this file are explicit test tuning.
"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from src.system16_python import MockDependencies, State, execute, fork_state, load, save, transition
from src.system16_python.engine import _segment
from src.system16_python.state import ContractError, reference


class Fixture:
    def __init__(self):
        self.state = State()
        self.now = 100
        self.counter = 0
        self.fixtures = {
            "system3": {"allowed": True, "scope": {"text": [0, 100000], "audio": [0, 100000], "fields": ["headers", "attachments", "apparent_author_account", "location"], "details": ["visible-person"]}, "known_failure_codes": ["DEVICE_NOT_PRESENT", "NO_POWER", "NO_VALID_SESSION", "FEATURE_NOT_YET_AVAILABLE", "ENDPOINT_INVALID", "ATTACHMENT_UNAVAILABLE", "PLAN_LIMIT", "PRIVACY_DENIED", "IMMUTABLE_RECORD", "CLOCK_ORDER_INVALID", "BRANCH_MISMATCH"]},
            "system4:endpoints": {"known_endpoints": ["endpoint-b"]},
            "system4:learning:learn-b": {"grounded": True, "endpoint_refs": ["endpoint-b"], "confidence": "reported", "last_verified_time": None},
            "system15": {"present": True, "accessible": True, "powered": True, "compatible": True},
            "system11:schedule": {"stable_sequence": 1, "causal_dependencies": []},
            "system11:duration": {"accepted": True, "duration": 1},
            "system14:reserve": {"accepted": True, "reservation_refs": ["dummy-reservation"]},
            "infrastructure:eligibility": {"region": "US"},
            "infrastructure:service": {"available": True, "eligible": True, "subscription_ref": "sub-a"},
            "infrastructure:worker": {"authorized": True},
            "infrastructure:notification": {"display": True, "mode": "silent"},
            "dialogue:feasibility": {"feasible": True},
        }
        self.policy("endpoint@1", address_pattern=r"\+1[0-9]{10}")
        self.policy("plan@1", active_service_states=["active"])
        self.policy("routing@1", acceptance="accept", initial_delay=0, recovery="pending", placements=["inbox", "spam", "quarantine"], ring_timeout=30, ring_timeout_outcome="redirected_to_voicemail", record_missed_call=True)
        self.policy("binding@1", rule="pin_at_acceptance")
        self.policy("retry@1", interval=5, store_forward=True)
        self.policy("lifetime@1", ticks=100)
        self.policy("ack@1", acceptance=True, delivery=False, read=False, read_scope="account", preview_triggers_read=False)
        self.policy("sms@1", kind="sms_encoding", gsm7_basic="".join(chr(i) for i in range(32, 127) if chr(i) not in "^{}\\[~]|€") + "\n\r", gsm7_extension="^{}\\[~]|€", gsm7_single=160, gsm7_multipart=153, unicode_encoding="utf-16-be", unicode_single=70, unicode_multipart=67)
        self.policy("media@1", max_attachments=0, max_total_bytes=0, formats=[])
        self.policy("visibility@1", recipient_visibility="individual")
        self.policy("fallback@1", enabled=False)
        self.policy("sync@1", delay=0, retry_interval=None)
        self.policy("retention@1", ticks=None, scope="named_copy", client_delete=True, export_allowed=True)
        self.policy("charge@1", per_unit=0, terms_ref="terms@1")
        self.policy("notification@1", enabled=True, preview_scope={"text": [0, 0]}, mode="silent")
        self.policy("counter@1", algorithm="codepoints", limit=140, url_units=None, attachment_units=0)
        self.policy("public@1", public=True, members=[], evaluation="publication", protection_state="public")
        self.policy("private@1", public=False, members=["alice"], evaluation="publication", protection_state="private")
        self.policy("feed@1", algorithm="recency_then_id", limit=20)
        self.policy("capacity@1", max_recordings=2, max_duration=120)
        self.add("communication_endpoint", "endpoint-b", branch_id="main", endpoint_id="endpoint-b", kind="telephone_number", address="+15555550100", binding_policy_ref="endpoint@1", revision=1)
        self.add("endpoint_binding", "binding-b", endpoint_id="endpoint-b", subscription_or_account_id="account-b", valid_from=0, valid_to=None, source_event_id="seed")
        self.add("subscription", "sub-a", subscription_id="sub-a", provider_id="carrier", number_or_sim_binding=None, service_state="active", voice_eligible=True, sms_eligible=True, mms_eligible=True, data_eligible=True, plan_limits_ref="plan@1", accepted_charge_terms_ref="terms@1")
        for suffix, actor in (("a", "alice"), ("b", "bob")):
            self.add("account", "account-" + suffix, account_id="account-" + suffix, service_id="carrier", identity_associations=[], authentication_ref="auth", role_memberships=[], recovery_routes=[], privacy_policy_ref="privacy")
            self.add("client", "client-" + suffix, client_id="client-" + suffix, physical_device_id="device-" + suffix, profile_ref="phone", os_version="2012", client_version="1", supported_features=["feature"], store_ids=["store-" + suffix], session_ids=["session-" + suffix], notification_policy_ref="notification@1", display_clock_policy_ref="clock@1")
            self.add("session", "session-" + suffix, session_id="session-" + suffix, account_id="account-" + suffix, client_id="client-" + suffix, scope=["contacts", "compose", "send", "read", "call", "capture", "post", "privacy", "delete"], valid_from=0, valid_to=None, revocation_event_ref=None)
            self.add("logical_store", "store-" + suffix, store_id="store-" + suffix, kind="device_local", owner_ref="account-" + suffix, access_policy_ref="access@1", sync_policy_ref=None, retention_policy_ref="retention@1", restore_source_refs=[])
        self.add("logical_store", "server-b", store_id="server-b", kind="account", owner_ref="account-b", access_policy_ref="access@1", sync_policy_ref="sync@1", retention_policy_ref="retention@1", restore_source_refs=[])
        self.add("feature_manifest", "feature", feature_id="carrier_sms", version="feature", effective_from=0, effective_to=None, region="US", provider="carrier", device_prerequisites=["phone"], os_prerequisites=["2012"], client_prerequisites=["1"], account_prerequisites=[], rollout_scope={"all": True}, enabled=True, source_classification="fictional_service_policy", source_refs=[])
        self.add("channel_adapter", "adapter@1", adapter_id="adapter", version="adapter@1", channel="SMS", feature_manifest_refs=["feature"], delivery_target="number", routing_policy_ref="routing@1", accepted_binding_policy_ref="binding@1", retry_policy_ref="retry@1", queue_lifetime_policy_ref="lifetime@1", acknowledgment_policy_ref="ack@1", encoding_counting_policy_ref="sms@1", attachment_transcoding_policy_ref="media@1", recipient_visibility_policy_ref="visibility@1", fallback_policy_ref="fallback@1", sync_policy_ref="sync@1", retention_policy_ref="retention@1", charge_policy_ref="charge@1")

    def policy(self, ref, **values):
        self.fixtures["configuration:policy:" + ref] = {"version": ref, **values}

    def add(self, record_type, key, **row):
        self.state.put(record_type, key, row)

    def command(self, operation, arguments, actor="alice", request=None, authorize=True):
        self.counter += 1
        command = {"operation": operation, "branch_id": "main", "principal_id": actor, "request_id": request or str(self.counter), "arguments": arguments}
        self.fixtures["system11:clock"] = {"now": self.now, "due_event_ids": []}
        if authorize:
            self.fixtures["player:authorize:" + command["request_id"]] = {"authorized": True, "explicit": True, "command_digest": reference("command", command)}
        return command

    def run(self, operation, arguments, actor="alice", request=None, authorize=True):
        command = self.command(operation, arguments, actor, request, authorize)
        outcome = transition(self.state.to_json(), command, MockDependencies(self.fixtures))
        self.state = State.from_json(outcome["state"])
        return outcome["result"]

    def draft(self, text="hello", channel="SMS", recipients=None, audience=None, **extra):
        result = self.run("CreateDraft", {"client_ref": "client-a", "session_ref": "session-a", "store_ref": "store-a", "channel": channel, "recipient_refs": ["endpoint-b"] if recipients is None else recipients, "text": text, "audience_ref": audience, **extra})
        assert result["status"] == "DRAFTED", result
        return result["data"]

    def authority(self, draft, channel="SMS", recipients=None, audience=None, cap=0):
        key = "authority-" + str(self.counter)
        result = self.run("Authorize", {"authority": {"authority_id": key, "principal_id": "alice", "kind": "explicit_action", "approved_payload_revision": draft["payload_revision"], "approved_recipients": ["endpoint-b"] if recipients is None else recipients, "approved_audience": audience, "channel": channel, "account_or_session_ref": "session-a", "device_or_endpoint_ref": "client-a", "charge_cap": cap, "trigger_condition": None, "expires_at": None, "request_limit": 1, "uses_consumed": 0}})
        assert result["status"] == "ACCEPTED", result
        return key

    def prepare(self, text="hello", channel="SMS", **extra):
        draft = self.draft(text, channel, **extra)
        authority = self.authority(draft, channel)
        args = {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"], "expected_revision": draft["revision"], "payload_revision": draft["payload_revision"], "authority_ref": authority}
        result = self.run("PrepareMessage", args)
        assert result["status"] == "PENDING", result
        return result["data"]["reference"], args

    def send(self, text="hello", channel="SMS", **extra):
        sub, args = self.prepare(text, channel, **extra)
        result = self.run("CommitMessage", {"submission_ref": sub})
        assert result["status"] == "ACCEPTED", result
        return result["data"]["reference"], sub, args

    def dispatch(self, kinds=None):
        command = self.command("Dispatch", {}, actor="worker")
        work = [row for row in self.state.table("scheduled_work").values() if row["completion_state"] == "pending" and row["due_time"] <= self.now and (kinds is None or row["kind"] in kinds)]
        work.sort(key=lambda row: (row["due_time"], row["stable_sequence"], row["event_id"]))
        self.fixtures["system11:clock"] = {"now": self.now, "due_event_ids": [row["event_id"] for row in work]}
        out = transition(self.state.to_json(), command, MockDependencies(self.fixtures))
        self.state = State.from_json(out["state"])
        return out["result"]

    def deliver(self, message, segments=None, sync=True):
        delivery_ref, delivery = next((key, row) for key, row in self.state.table("recipient_delivery").items() if row["message_id"] == message)
        count = len([row for row in self.state.table("sms_segment").values() if row["message_id"] == message])
        self.fixtures["infrastructure:delivery:" + delivery_ref] = {"available": True, "binding_ref": delivery["recipient_binding"], "store_ref": "server-b", "placement": "inbox", "segment_indices": list(range(count)) if segments is None else segments}
        result = self.dispatch({"transport_retry"})
        assert result["status"] == "ACCEPTED", result
        source = next(row for row in self.state.table("client_copy").values() if row["message_id_or_artifact"] == message and row["client_store"] == "server-b" and row["copy_state"] in {"available", "partial"})
        if not sync:
            return source["id"]
        self.fixtures["infrastructure:sync:" + source["id"]] = {"targets": [{"client_ref": "client-b", "session_ref": "session-b", "store_ref": "store-b", "enrolled": True, "connected": True, "source_ref": source["id"]}]}
        result = self.dispatch({"client_sync"})
        assert result["status"] == "ACCEPTED", result
        return next(row["id"] for row in self.state.table("client_copy").values() if row["message_id_or_artifact"] == message and row["client_store"] == "store-b" and row["copy_state"] in {"available", "partial"})

    def attend(self, copy, start=0, end=5, actor="bob"):
        suffix = "b" if actor == "bob" else "a"
        return self.run("AttendArtifact", {"client_ref": "client-" + suffix, "session_ref": "session-" + suffix, "copy_ref": copy, "scope": {"text": [start, end]}}, actor=actor)


class System16Tests(unittest.TestCase):
    def test_strict_state_and_record_fields(self):
        fixture = Fixture()
        self.assertEqual(fixture.state, State.from_json(fixture.state.to_json()))
        snapshot = fixture.state.to_json()
        snapshot["clock"] = 1
        with self.assertRaises(ContractError):
            State.from_json(snapshot)
        snapshot = fixture.state.to_json()
        snapshot["companion_records"]["session"]["session-a"]["feelings"] = 10
        with self.assertRaises(ContractError):
            State.from_json(snapshot)

    def test_default_dependencies_fail_closed(self):
        fixture = Fixture()
        command = fixture.command("CreateDraft", {})
        result = transition(fixture.state.to_json(), command)["result"]
        self.assertEqual(result["status"], "CHOICE_REQUIRED")

    def test_no_send_without_explicit_action(self):
        fixture = Fixture()
        before = fixture.state.to_json()
        result = fixture.run("CreateDraft", {}, authorize=False)
        self.assertEqual(result["failure_code"], "AUTHORIZATION_REQUIRED")
        self.assertEqual(before, fixture.state.to_json())

    def test_draft_does_not_deliver(self):
        fixture = Fixture()
        fixture.draft()
        self.assertFalse(fixture.state.table("communication"))
        self.assertFalse(fixture.state.table("client_copy"))
        self.assertFalse(fixture.state.table("notification"))

    def test_delivery_attention_and_sms_receipt_are_separate(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        self.assertFalse(fixture.state.table("attention_event"))
        self.assertEqual(len(fixture.state.table("notification")), 1)
        result = fixture.attend(copy)
        self.assertEqual(result["data"]["text"], "hello")
        self.assertEqual(len(fixture.state.table("attention_event")), 1)
        self.assertEqual({row["kind"] for row in fixture.state.table("acknowledgment").values()}, {"acceptance"})

    def test_missing_physical_device_blocks_read(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        fixture.fixtures["system15:access:device-b"] = {"present": False}
        self.assertEqual(fixture.attend(copy)["failure_code"], "DEVICE_NOT_PRESENT")
        self.assertFalse(fixture.state.table("attention_event"))

    def test_dead_recipient_has_server_delivery_without_sync(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        fixture.fixtures["system15:sync:device-b"] = {"powered": False}
        fixture.deliver(message, sync=False)
        self.assertEqual(next(iter(fixture.state.table("recipient_delivery").values()))["state"], "delivered")
        self.assertFalse(fixture.state.table("notification"))

    def test_partial_sms_cannot_expose_missing_text(self):
        fixture = Fixture()
        message, _, _ = fixture.send("a" * 200)
        copy = fixture.deliver(message, segments=[0])
        self.assertEqual(fixture.attend(copy, end=153)["status"], "OBSERVED")
        self.assertEqual(fixture.attend(copy, end=200)["failure_code"], "ATTACHMENT_UNAVAILABLE")
        self.assertEqual(next(iter(fixture.state.table("recipient_delivery").values()))["state"], "partial")

    def test_unicode_and_extension_segmentation(self):
        fixture = Fixture()
        policy = fixture.fixtures["configuration:policy:sms@1"]
        self.assertEqual([n for _, n in _segment("a" * 160, policy)], [160])
        self.assertEqual([n for _, n in _segment("a" * 161, policy)], [153, 8])
        self.assertEqual(sum(n for _, n in _segment("^" * 81, policy)), 162)
        segments = _segment("😀" * 36, policy)
        self.assertEqual([n for _, n in segments], [66, 6])
        self.assertEqual("".join(part for part, _ in segments), "😀" * 36)

    def test_stale_draft_rejects_commit(self):
        fixture = Fixture()
        sub, args = fixture.prepare()
        fixture.run("CreateDraft", {"client_ref": "client-a", "session_ref": "session-a", "store_ref": "store-a", "channel": "SMS", "recipient_refs": ["endpoint-b"], "text": "changed", "draft_ref": args["draft_ref"], "expected_revision": 1})
        self.assertEqual(fixture.run("CommitMessage", {"submission_ref": sub})["failure_code"], "STALE_DRAFT")
        self.assertFalse(fixture.state.table("communication"))

    def test_prepare_retry_does_not_reserve_or_duplicate(self):
        fixture = Fixture()
        message, sub, args = fixture.send()
        request = fixture.state.get("submission", sub)["request_id"]
        before = len(fixture.state.table("communication"))
        result = fixture.run("PrepareMessage", args, request=request)
        self.assertEqual(result["status"], "ACCEPTED")
        self.assertEqual(len(fixture.state.table("communication")), before)
        args["payload_revision"] = "unapproved"
        self.assertEqual(fixture.run("PrepareMessage", args, request=request)["failure_code"], "REQUEST_CONFLICT")

    def test_commit_retry_returns_same_message(self):
        fixture = Fixture()
        message, sub, _ = fixture.send()
        result = fixture.run("CommitMessage", {"submission_ref": sub})
        self.assertEqual(message, result["data"]["reference"])
        self.assertEqual(len(fixture.state.table("communication")), 1)
        self.assertEqual(next(iter(fixture.state.table("communication_authority").values()))["uses_consumed"], 1)

    def test_expired_queue_never_delivers(self):
        fixture = Fixture()
        fixture.send()
        fixture.now = 201
        result = fixture.dispatch()
        self.assertEqual(result["status"], "ACCEPTED")
        self.assertEqual(next(iter(fixture.state.table("recipient_delivery").values()))["state"], "expired")
        self.assertFalse(any(row["client_store"] != "store-a" for row in fixture.state.table("client_copy").values()))

    def test_refresh_does_not_advance_transport(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        before = deepcopy(fixture.state.table("recipient_delivery"))
        for _ in range(3):
            fixture.run("InspectStatus", {"client_ref": "client-a", "session_ref": "session-a", "message_ref": message})
        self.assertEqual(before, fixture.state.table("recipient_delivery"))

    def test_feature_date_is_campaign_time(self):
        fixture = Fixture()
        fixture.state.get("feature_manifest", "feature")["effective_from"] = 200
        draft = fixture.draft()
        authority = fixture.authority(draft)
        result = fixture.run("PrepareMessage", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"], "expected_revision": 1, "payload_revision": draft["payload_revision"], "authority_ref": authority})
        self.assertEqual(result["failure_code"], "FEATURE_NOT_YET_AVAILABLE")

    def test_data_plan_failure_does_not_disable_sms(self):
        fixture = Fixture()
        fixture.state.get("subscription", "sub-a")["data_eligible"] = False
        self.assertTrue(fixture.send()[0])

    def test_sms_charge_cap_requires_choice(self):
        fixture = Fixture()
        fixture.policy("charge@1", per_unit=2, terms_ref="terms@1")
        draft = fixture.draft()
        authority = fixture.authority(draft, cap=1)
        result = fixture.run("PrepareMessage", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"], "expected_revision": 1, "payload_revision": draft["payload_revision"], "authority_ref": authority})
        self.assertEqual(result["status"], "CHOICE_REQUIRED")
        self.assertEqual(result["failure_code"], "CHARGE_NOT_AUTHORIZED")

    def test_delete_local_copy_keeps_other_store(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        row = fixture.state.get("client_copy", copy)
        result = fixture.run("DeleteCopy", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "expected_revision": row["revision"]}, actor="bob")
        self.assertEqual(result["status"], "ACCEPTED")
        self.assertTrue(any(row["client_store"] == "server-b" and row["copy_state"] == "available" for row in fixture.state.table("client_copy").values()))
        self.assertEqual(fixture.attend(copy)["failure_code"], "ATTACHMENT_UNAVAILABLE")

    def test_unknown_number_not_saved(self):
        fixture = Fixture()
        result = fixture.run("SaveContact", {"client_ref": "client-a", "session_ref": "session-a", "store_ref": "store-a", "endpoint_refs": ["secret-number"], "source_event_ref": "learn-b", "label": "Unknown"})
        self.assertEqual(result["failure_code"], "ENDPOINT_INVALID")
        self.assertFalse(fixture.state.table("contact_entry"))

    def test_contact_deletion_does_not_remove_endpoint(self):
        fixture = Fixture()
        result = fixture.run("SaveContact", {"client_ref": "client-a", "session_ref": "session-a", "store_ref": "store-a", "endpoint_refs": ["endpoint-b"], "source_event_ref": "learn-b", "label": "Bob"})
        self.assertEqual(result["status"], "ACCEPTED")
        fixture.run("DeleteContact", {"client_ref": "client-a", "session_ref": "session-a", "entry_ref": result["data"]["reference"], "expected_revision": 1})
        self.assertFalse(fixture.state.table("contact_entry"))
        self.assertIn("endpoint-b", fixture.state.table("communication_endpoint"))

    def test_recovery_preserves_commit(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        before = deepcopy(fixture.state.table("communication"))
        result = fixture.run("Recover", {}, actor="worker")
        self.assertEqual(result["status"], "PENDING")
        self.assertEqual(before, fixture.state.table("communication"))
        self.assertIn(message, before)

    def test_recovery_abort_releases_pending_only(self):
        fixture = Fixture()
        sub, _ = fixture.prepare()
        fixture.fixtures["configuration:policy:routing@1"]["recovery"] = "abort"
        fixture.run("Recover", {}, actor="worker")
        self.assertEqual(fixture.state.get("submission", sub)["decision"], "ABORT")
        self.assertFalse(fixture.state.table("communication"))

    def test_branch_mutations_are_isolated(self):
        fixture = Fixture()
        fixture.send()
        original = fixture.state.to_json()
        branch = fork_state(original, "alternate")
        branch["canonical_records"]["communication"].clear()
        self.assertTrue(original["canonical_records"]["communication"])

    def test_private_post_not_in_feed(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1").update(channel="social", encoding_counting_policy_ref="counter@1")
        draft = fixture.draft("private", "social", recipients=[], audience="private@1")
        authority = fixture.authority(draft, "social", recipients=[], audience="private@1")
        result = fixture.run("PublishPost", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"], "expected_revision": 1, "authority_ref": authority, "platform_ref": "Twitter"})
        self.assertEqual(result["status"], "ACCEPTED")
        fixture.fixtures["infrastructure:feed_candidates:bob"] = {"account_refs": ["account-a"]}
        feed = fixture.run("BrowseFeed", {"client_ref": "client-b", "session_ref": "session-b", "store_ref": "store-b", "ranking_policy_ref": "feed@1"}, actor="bob")
        self.assertEqual(feed["data"]["copy_refs"], [])
        self.assertFalse(fixture.state.table("attention_event"))

    def test_twitter_140_limit(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1").update(channel="social", encoding_counting_policy_ref="counter@1")
        draft = fixture.draft("x" * 141, "social", recipients=[], audience="public@1")
        authority = fixture.authority(draft, "social", recipients=[], audience="public@1")
        result = fixture.run("PublishPost", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"], "expected_revision": 1, "authority_ref": authority, "platform_ref": "Twitter"})
        self.assertEqual(result["failure_code"], "PLAN_LIMIT")
        self.assertFalse(fixture.state.table("post"))

    def test_call_waits_for_explicit_answer_and_no_transcript(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1")["channel"] = "voice"
        fixture.fixtures["infrastructure:call:binding-b"] = {"outcome": "ringing", "caller_id_claim": {"number": "unknown"}}
        result = fixture.run("PlaceCall", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "endpoint_ref": "endpoint-b"})
        self.assertEqual(result["status"], "PENDING")
        call = result["data"]["reference"]
        self.assertEqual(fixture.state.get("call", call)["state"], "ringing")
        self.assertEqual(fixture.state.get("call", call)["recording_refs"], [])
        fixture.fixtures["infrastructure:answer_endpoint:" + call] = {"authorized": True, "client_ref": "client-b"}
        answer = fixture.run("AnswerCall", {"client_ref": "client-b", "session_ref": "session-b", "call_ref": call}, actor="bob")
        self.assertEqual(answer["status"], "ACCEPTED")
        self.assertEqual(fixture.state.get("call", call)["actual_participants"], ["alice", "bob"])

    def test_call_timeout_routes_to_voicemail(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1")["channel"] = "voice"
        fixture.fixtures["infrastructure:call:binding-b"] = {"outcome": "ringing"}
        result = fixture.run("PlaceCall", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "endpoint_ref": "endpoint-b"})
        fixture.now = 130
        fixture.dispatch()
        self.assertEqual(fixture.state.get("call", result["data"]["reference"])["state"], "redirected_to_voicemail")
        self.assertFalse(fixture.state.table("voicemail_recording"))

    def test_sqlite_duplicate_concurrent_commits(self):
        fixture = Fixture()
        sub, _ = fixture.prepare()
        command = fixture.command("CommitMessage", {"submission_ref": sub}, request="commit-once")
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "system16.sqlite"
            save(database, "main", fixture.state.to_json())
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: execute(database, command, MockDependencies(fixture.fixtures)), range(2)))
            self.assertTrue(all(result["status"] == "ACCEPTED" for result in results), results)
            self.assertEqual(results[0]["data"]["reference"], results[1]["data"]["reference"])
            restored = load(database, "main")
            self.assertEqual(len(restored["canonical_records"]["communication"]), 1)
            self.assertEqual(restored, json.loads(json.dumps(restored)))

    def test_email_bcc_and_headers_projection(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1")["channel"] = "email"
        message, _, _ = fixture.send(channel="email", email={"envelope": ["endpoint-b"], "headers": {"subject": "Private", "from": "account-a"}, "to": [], "cc": [], "bcc": ["endpoint-b"]})
        copy = fixture.deliver(message)
        result = fixture.run("AttendArtifact", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "scope": {"text": [0, 5], "fields": ["headers"]}}, actor="bob")
        self.assertEqual(result["status"], "OBSERVED")
        self.assertEqual(result["data"]["headers"]["subject"], "Private")
        self.assertNotIn("bcc", result["data"])
        self.assertNotIn("endpoint-b", json.dumps(result["data"]))

    def test_email_header_cannot_smuggle_bcc(self):
        fixture = Fixture()
        result = fixture.run("CreateDraft", {"client_ref": "client-a", "session_ref": "session-a", "store_ref": "store-a", "channel": "email", "recipient_refs": ["endpoint-b"], "text": "hello", "email": {"envelope": ["endpoint-b"], "to": [], "cc": [], "bcc": ["endpoint-b"], "headers": {"bcc": ["endpoint-b"]}}})
        self.assertEqual(result["failure_code"], "PRIVACY_DENIED")

    def test_app_read_receipt_never_reveals_stolen_device_reader(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1")["channel"] = "app"
        fixture.fixtures["configuration:policy:ack@1"].update(read=True, read_feature_ref="feature")
        message, _, _ = fixture.send(channel="app")
        copy = fixture.deliver(message)
        result = fixture.run("AttendArtifact", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "scope": {"text": [0, 5]}}, actor="thief")
        self.assertEqual(result["status"], "OBSERVED")
        self.assertEqual(next(iter(fixture.state.table("attention_event").values()))["actor_id"], "thief")
        result = fixture.run("InspectStatus", {"client_ref": "client-a", "session_ref": "session-a", "message_ref": message})
        self.assertIn("read", [row["kind"] for row in result["data"]["acknowledgments"]])
        self.assertNotIn("thief", json.dumps(result))

    def test_actual_actor_and_apparent_account_are_separate(self):
        fixture = Fixture()
        sub, _ = fixture.prepare()
        fixture.state.get("submission", sub)["principal_id"] = "thief"
        authority_ref = fixture.state.get("submission", sub)["authority_ref"]
        fixture.state.get("communication_authority", authority_ref)["principal_id"] = "thief"
        # A trusted restored unauthorized-use fixture, not a player mutation endpoint.
        result = fixture.run("CommitMessage", {"submission_ref": sub}, actor="thief")
        self.assertEqual(result["status"], "ACCEPTED")
        message = fixture.state.get("communication", result["data"]["reference"])
        self.assertEqual(message["submitted_actor"], "thief")
        self.assertEqual(message["apparent_author_account"], "account-a")

    def test_mms_derivative_and_download_are_separate(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1")["channel"] = "MMS"
        fixture.policy("media@1", max_attachments=1, max_total_bytes=1000, formats=["image/jpeg"], transcode={"format": "image/jpeg", "max_bytes": 100, "quality": {"lossy": True}, "retained_details": [], "retained_metadata": []})
        fixture.add("artifact", "photo", artifact_id="photo", kind="photo", format="image/jpeg", size=1000, content_ref="photo-bytes", source_refs=[], derivation_operation=None, capture_time=90, source_device_ref="device-a", coverage={"details": ["visible-person"], "fields": ["location"]}, quality={"resolution": "original"}, metadata={"location": "visible-place"}, access_policy_ref="access@1")
        fixture.add("client_copy", "photo-copy", id="photo-copy", message_id_or_artifact="photo", client_store="store-a", copy_state="available", source_relation="photo", revision=1)
        message, _, _ = fixture.send(channel="MMS", attachment_refs=["photo"])
        copy = fixture.deliver(message)
        result = fixture.run("AttendArtifact", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "scope": {"fields": ["attachments"]}}, actor="bob")
        derivative = result["data"]["attachments"][0]
        self.assertNotEqual(derivative, "photo")
        self.assertEqual(fixture.state.get("artifact", derivative)["coverage"]["details"], [])
        self.assertFalse(any(row["message_id_or_artifact"] == derivative for row in fixture.state.table("client_copy").values()))
        fixture.fixtures["infrastructure:attachment_download:" + derivative] = {"available": True}
        download = fixture.run("DownloadAttachment", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "scope": {"fields": ["attachments"]}, "artifact_ref": derivative, "destination_store_ref": "store-b"}, actor="bob")
        self.assertEqual(download["status"], "DELIVERED")
        self.assertEqual(fixture.state.get("artifact", "photo")["size"], 1000)

    def test_number_reassignment_does_not_change_accepted_delivery(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        fixture.now += 1
        command = fixture.command("ReassignEndpoint", {"endpoint_ref": "endpoint-b", "account_ref": "replacement-account"})
        fixture.fixtures["infrastructure:provision_endpoint:" + command["request_id"]] = {"authorized": True, "endpoint_ref": "endpoint-b", "account_ref": "replacement-account"}
        out = transition(fixture.state.to_json(), command, MockDependencies(fixture.fixtures))
        self.assertEqual(out["result"]["status"], "ACCEPTED")
        fixture.state = State.from_json(out["state"])
        self.assertEqual(next(iter(fixture.state.table("recipient_delivery").values()))["recipient_binding"], "binding-b")
        fixture.deliver(message)
        self.assertEqual(fixture.state.get("endpoint_binding", "binding-b")["subscription_or_account_id"], "account-b")

    def test_account_revocation_is_prospective(self):
        fixture = Fixture()
        message, sub, _ = fixture.send()
        command = fixture.command("RevokeSessions", {"session_refs": ["session-a"]})
        fixture.fixtures["infrastructure:revoke:" + command["request_id"]] = {"authorized": True, "session_refs": ["session-a"]}
        out = transition(fixture.state.to_json(), command, MockDependencies(fixture.fixtures))
        self.assertEqual(out["result"]["status"], "ACCEPTED")
        fixture.state = State.from_json(out["state"])
        self.assertEqual(fixture.run("CommitMessage", {"submission_ref": sub})["data"]["reference"], message)
        result = fixture.run("CreateDraft", {"client_ref": "client-a", "session_ref": "session-a"})
        self.assertEqual(result["failure_code"], "NO_VALID_SESSION")
        fixture.deliver(message)

    def test_typing_refresh_does_not_expire_on_old_timer(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1")["channel"] = "app"
        fixture.fixtures["configuration:policy:ack@1"].update(typing_feature_ref="feature", typing_lifetime=10)
        draft = fixture.draft(channel="app")
        args = {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"]}
        first = fixture.run("StartTyping", args)
        self.assertEqual(first["status"], "ACCEPTED")
        fixture.now = 105
        fixture.run("StartTyping", args)
        fixture.now = 110
        fixture.dispatch()
        self.assertTrue(fixture.state.table("typing_signal"))
        fixture.now = 115
        fixture.dispatch()
        self.assertFalse(fixture.state.table("typing_signal"))

    def test_public_feed_selection_is_not_attention(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1").update(channel="social", encoding_counting_policy_ref="counter@1")
        fixture.fixtures["configuration:policy:feed@1"]["discovery_accounts"] = ["account-a"]
        draft = fixture.draft("public", "social", recipients=[], audience="public@1")
        authority = fixture.authority(draft, "social", recipients=[], audience="public@1")
        fixture.run("PublishPost", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"], "expected_revision": 1, "authority_ref": authority, "platform_ref": "Twitter"})
        result = fixture.run("BrowseFeed", {"client_ref": "client-b", "session_ref": "session-b", "store_ref": "store-b", "ranking_policy_ref": "feed@1"}, actor="bob")
        self.assertEqual(len(result["data"]["copy_refs"]), 1)
        self.assertFalse(fixture.state.table("attention_event"))
        self.assertNotIn("public", json.dumps(result["data"]))

    def test_capture_rejects_off_frame_details(self):
        fixture = Fixture()
        command = fixture.command("CaptureArtifact", {"client_ref": "client-a", "session_ref": "session-a", "store_ref": "store-a", "feature_ref": "feature", "kind": "photo"})
        fixture.fixtures["system12:capture:" + command["request_id"]] = {"line_of_sight": True, "intentional_or_fixed": True, "coverage": {"details": ["visible-person"]}}
        fixture.fixtures["system10:capture:" + command["request_id"]] = {"resolved": True, "coverage": {"details": ["off-frame-secret"]}}
        out = transition(fixture.state.to_json(), command, MockDependencies(fixture.fixtures))
        self.assertEqual(out["result"]["failure_code"], "PRIVACY_DENIED")
        self.assertFalse(out["state"]["companion_records"]["artifact"])

    def test_export_survives_source_deletion(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        fixture.fixtures["investigation:acquire:authority"] = {"authorized": True, "coverage": {"text": [0, 5]}}
        result = fixture.run("AcquireRecord", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "scope": {"text": [0, 5]}, "destination_store_ref": "store-b", "authority_ref": "authority", "method": "authorized_export"}, actor="bob")
        self.assertEqual(result["status"], "ACCEPTED")
        export = fixture.state.get("evidence_export", result["data"]["reference"])
        artifact = deepcopy(fixture.state.get("artifact", export["artifact_ref"]))
        fixture.run("DeleteCopy", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "expected_revision": 1}, actor="bob")
        self.assertEqual(artifact, fixture.state.get("artifact", export["artifact_ref"]))
        self.assertEqual(json.loads(artifact["content_ref"])["text"], "hello")

    def test_metadata_only_store_cannot_export_message_body(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        fixture.fixtures["configuration:policy:retention@1"]["content"] = "metadata_only"
        self.assertEqual(fixture.attend(copy)["failure_code"], "PRIVACY_DENIED")

    def test_unsupported_feature_fails_even_if_manifest_enabled(self):
        fixture = Fixture()
        fixture.state.get("feature_manifest", "feature")["feature_id"] = "stories"
        draft = fixture.draft()
        authority = fixture.authority(draft)
        result = fixture.run("PrepareMessage", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "draft_ref": draft["reference"], "expected_revision": 1, "payload_revision": draft["payload_revision"], "authority_ref": authority})
        self.assertEqual(result["failure_code"], "CLIENT_UNSUPPORTED")

    def test_due_events_require_causal_completion(self):
        fixture = Fixture()
        fixture.send()
        work = next(iter(fixture.state.table("scheduled_work").values()))
        work["causal_dependencies"] = [work["event_id"]]
        result = fixture.dispatch()
        self.assertEqual(result["failure_code"], "CLOCK_ORDER_INVALID")

    def test_unknown_private_failure_is_generic(self):
        fixture = Fixture()
        fixture.fixtures["system3:failure"] = {"known_failure_codes": []}
        result = fixture.run("InspectStatus", {"client_ref": "client-a", "session_ref": "session-a", "message_ref": "secret-message"})
        self.assertEqual(result["failure_code"], "SERVICE_UNAVAILABLE")
        self.assertNotIn("secret-message", json.dumps(result))

    def test_no_npc_reply_without_real_attention(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        fixture.deliver(message)
        fixture.fixtures["system5_6:opportunity:opportunity"] = {"eligible": True, "source_communication_ref": message, "actor_id": "bob", "outcome": "reply"}
        result = fixture.run("DecideOpportunity", {"source_communication_ref": message, "actor_ref": "bob", "opportunity_ref": "opportunity"}, actor="worker")
        self.assertEqual(result["failure_code"], "PRIVACY_DENIED")
        self.assertEqual(len(fixture.state.table("communication")), 1)

    def test_out_of_character_notification_does_not_create_knowledge(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        notification = next(iter(fixture.state.table("notification")))
        fixture.fixtures["system3:perception:perception"] = {"perceived": True, "in_character": False, "notification_ref": notification, "copy_ref": copy, "scope": {}, "actor_id": "bob"}
        result = fixture.run("RecordExposure", {"notification_ref": notification, "perception_ref": "perception"}, actor="worker")
        self.assertEqual(result["failure_code"], "PRIVACY_DENIED")
        self.assertFalse(fixture.state.table("attention_event"))

    def test_pending_submission_can_abort_without_send(self):
        fixture = Fixture()
        sub, _ = fixture.prepare()
        result = fixture.run("AbortSubmission", {"submission_ref": sub})
        self.assertEqual(result["status"], "ACCEPTED")
        self.assertEqual(fixture.state.get("submission", sub)["decision"], "ABORT")
        self.assertFalse(fixture.state.table("communication"))

    def test_no_aliasing_between_transition_input_and_output(self):
        fixture = Fixture()
        before = fixture.state.to_json()
        command = fixture.command("AvailableActions", {"client_ref": "client-a", "session_ref": "session-a"})
        out = transition(before, command, MockDependencies(fixture.fixtures))
        out["state"]["companion_records"]["client"].clear()
        self.assertTrue(before["companion_records"]["client"])

    def test_pending_commit_retry_can_complete_later(self):
        fixture = Fixture()
        fixture.fixtures["configuration:policy:routing@1"]["acceptance"] = "pending"
        sub, _ = fixture.prepare()
        result = fixture.run("CommitMessage", {"submission_ref": sub}, request="same-commit")
        self.assertEqual(result["status"], "PENDING")
        self.assertFalse(fixture.state.table("communication"))
        fixture.fixtures["infrastructure:acceptance:" + sub] = {"decision": "accept"}
        result = fixture.run("CommitMessage", {"submission_ref": sub}, request="same-commit")
        self.assertEqual(result["status"], "ACCEPTED")
        self.assertEqual(len(fixture.state.table("communication")), 1)

    def test_unexposed_acceptance_is_not_reported(self):
        fixture = Fixture()
        sub, _ = fixture.prepare()
        fixture.fixtures["configuration:policy:ack@1"]["acceptance"] = False
        result = fixture.run("CommitMessage", {"submission_ref": sub})
        self.assertEqual(result["status"], "SUBMITTED")
        self.assertFalse(fixture.state.table("acknowledgment"))

    def test_inspection_before_attention_is_denied(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        result = fixture.run("InspectCopy", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "scope": {"text": [0, 5]}}, actor="bob")
        self.assertEqual(result["failure_code"], "PRIVACY_DENIED")

    def test_mute_suppresses_alert_not_delivery(self):
        fixture = Fixture()
        fixture.policy("mute@1", effects=["suppress_alert"], kinds=["mute"], feature_ref="feature")
        result = fixture.run("ChangeContactRule", {"client_ref": "client-b", "session_ref": "session-b", "rule": {"rule_id": "mute", "owner_ref": "account-b", "target_ref": "account-a", "kind": "mute", "service_account_device_scope": {"adapter_ref": "adapter@1", "client_ref": "client-b"}, "effective_time": 100, "policy_ref": "mute@1"}}, actor="bob")
        self.assertEqual(result["status"], "ACCEPTED")
        message, _, _ = fixture.send()
        fixture.deliver(message)
        self.assertFalse(fixture.state.table("notification"))
        self.assertEqual(next(iter(fixture.state.table("recipient_delivery").values()))["state"], "delivered")

    def test_block_is_private_and_scoped(self):
        fixture = Fixture()
        fixture.policy("block@1", effects=["suppress_delivery"], kinds=["block"], feature_ref="feature")
        fixture.run("ChangeContactRule", {"client_ref": "client-b", "session_ref": "session-b", "rule": {"rule_id": "block", "owner_ref": "account-b", "target_ref": "account-a", "kind": "block", "service_account_device_scope": {"adapter_ref": "adapter@1"}, "effective_time": 100, "policy_ref": "block@1"}}, actor="bob")
        message, _, _ = fixture.send()
        fixture.dispatch()
        self.assertEqual(next(iter(fixture.state.table("recipient_delivery").values()))["state"], "failed")
        result = fixture.run("InspectStatus", {"client_ref": "client-a", "session_ref": "session-a", "message_ref": message})
        self.assertNotIn("block", json.dumps(result))
        self.assertEqual([row["kind"] for row in result["data"]["acknowledgments"]], ["acceptance"])

    def test_voicemail_deposit_and_partial_listening(self):
        fixture = Fixture()
        fixture.state.get("channel_adapter", "adapter@1")["channel"] = "voice"
        fixture.fixtures["infrastructure:call:binding-b"] = {"outcome": "redirected_to_voicemail"}
        call = fixture.run("PlaceCall", {"client_ref": "client-a", "session_ref": "session-a", "adapter_ref": "adapter@1", "endpoint_ref": "endpoint-b"})["data"]["reference"]
        fixture.add("voicemail_mailbox", "mailbox", mailbox_id="mailbox", route_ref="adapter@1", greeting_ref="greeting", capacity_policy_ref="capacity@1", retention_policy_ref="retention@1", access_policy_ref="access@1", notification_policy_ref="notification@1")
        fixture.add("artifact", "audio", artifact_id="audio", kind="audio", format="audio/wav", size=100, content_ref="actual-recording", source_refs=[], derivation_operation=None, capture_time=100, source_device_ref="device-a", coverage={"audio": [0, 10]}, quality={"audible": True}, metadata={}, access_policy_ref="access@1")
        fixture.add("client_copy", "audio-source", id="audio-source", message_id_or_artifact="audio", client_store="store-a", copy_state="available", source_relation="audio", revision=1)
        fixture.fixtures["infrastructure:voicemail:mailbox"] = {"connected": True, "call_ref": call, "store_ref": "store-b"}
        result = fixture.run("DepositVoicemail", {"client_ref": "client-a", "session_ref": "session-a", "call_ref": call, "mailbox_ref": "mailbox", "artifact_ref": "audio", "duration": 10})
        self.assertEqual(result["status"], "ACCEPTED")
        recording = fixture.state.get("voicemail_recording", result["data"]["reference"])
        self.assertIsNone(recording["transcription_feature_ref"])
        copy = next(row["id"] for row in fixture.state.table("client_copy").values() if row["message_id_or_artifact"] == "audio" and row["client_store"] == "store-b")
        fixture.fixtures["system11:duration:attend"] = {"accepted": True, "duration": 3}
        result = fixture.run("AttendArtifact", {"client_ref": "client-b", "session_ref": "session-b", "copy_ref": copy, "scope": {"audio": [0, 3]}}, actor="bob")
        self.assertEqual(result["status"], "OBSERVED")
        self.assertEqual(next(iter(fixture.state.table("attention_event").values()))["visible_scope"], {"audio": [0, 3]})
        self.assertNotIn("transcript", json.dumps(result))

    def test_unretained_content_is_not_resurrected_by_collection(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        copy = fixture.deliver(message)
        for row in fixture.state.table("client_copy").values():
            row["copy_state"] = "expired"
        fixture.policy("purge@1", purge_unreferenced=True)
        result = fixture.run("CollectExpiredContent", {"policy_ref": "purge@1"}, actor="worker")
        self.assertEqual(result["status"], "ACCEPTED")
        self.assertFalse(fixture.state.table("payload_revision"))
        self.assertTrue(fixture.state.table("communication"))
        self.assertEqual(fixture.attend(copy)["failure_code"], "ATTACHMENT_UNAVAILABLE")

    def test_npc_no_reply_is_a_persisted_external_decision(self):
        fixture = Fixture()
        message, _, _ = fixture.send()
        fixture.deliver(message)
        fixture.fixtures["system5_6:opportunity:opportunity"] = {"eligible": True, "source_communication_ref": message, "actor_id": "bob", "outcome": "ignore", "eligible_window": {"start": 100, "end": 120}, "feasibility_input_refs": ["external-window"], "decision_ref": "decision-no-reply", "decision_reason_tags": ["busy"], "known_information_refs": [], "reply_plan_ref": None, "plan_state": "canceled"}
        args = {"source_communication_ref": message, "actor_ref": "bob", "opportunity_ref": "opportunity"}
        self.assertEqual(fixture.run("DecideOpportunity", args, actor="worker")["status"], "ACCEPTED")
        fixture.fixtures["system5_6:opportunity:opportunity"]["outcome"] = "reply"
        fixture.run("DecideOpportunity", args, actor="worker")
        self.assertEqual(fixture.state.get("opportunity_and_reply_plan", "opportunity")["outcome"], "ignore")
        self.assertEqual(len(fixture.state.table("communication")), 1)

    def test_invalid_command_still_returns_json_failure(self):
        fixture = Fixture()
        out = transition(fixture.state.to_json(), {"operation": "SubmitMessage"})
        self.assertEqual(out["result"]["failure_code"], "INVALID_COMMAND")
        self.assertEqual(out["state"], fixture.state.to_json())

    def test_unauthorized_development_mutation_is_denied(self):
        fixture = Fixture()
        result = fixture.run("Provision", {"records": []})
        self.assertEqual(result["failure_code"], "PRIVACY_DENIED")

    def test_baseline_tweet_edit_has_no_command(self):
        fixture = Fixture()
        result = fixture.run("EditTweet", {"post_ref": "anything", "text": "changed"})
        self.assertEqual(result["failure_code"], "CLIENT_UNSUPPORTED")

    def test_worker_dispatch_requires_external_authority(self):
        fixture = Fixture()
        fixture.fixtures["infrastructure:worker"] = {"authorized": False}
        self.assertEqual(fixture.run("Dispatch", {})["failure_code"], "PRIVACY_DENIED")

    def test_dead_phone_charge_request_does_not_require_power(self):
        fixture = Fixture()
        fixture.fixtures["system15:access:device-a"] = {"present": True, "powered": False}
        fixture.fixtures["system15:operation:device-a"] = {"authorized": True}
        result = fixture.run("RequestExternalAction", {"owner": "system15", "action": "charge_device", "payload": {"device_ref": "device-a", "connector_ref": "actual-charger"}})
        self.assertEqual(result["status"], "OWNER_PENDING")
        self.assertNotIn("battery", fixture.state.to_json())

    def test_client_block_does_not_prevent_account_delivery(self):
        fixture = Fixture()
        fixture.policy("block@1", effects=["suppress_delivery"], kinds=["block"], feature_ref="feature")
        result = fixture.run("ChangeContactRule", {"client_ref": "client-b", "session_ref": "session-b", "rule": {"rule_id": "block", "owner_ref": "account-b", "target_ref": "account-a", "kind": "block", "service_account_device_scope": {"adapter_ref": "adapter@1", "client_ref": "client-b"}, "effective_time": 100, "policy_ref": "block@1"}}, actor="bob")
        self.assertEqual(result["status"], "ACCEPTED")
        message, _, _ = fixture.send()
        source_ref = fixture.deliver(message, sync=False)
        fixture.fixtures["infrastructure:sync:" + source_ref] = {"targets": [{"client_ref": "client-b", "session_ref": "session-b", "store_ref": "store-b", "enrolled": True, "connected": True, "source_ref": source_ref}]}
        fixture.dispatch({"client_sync"})
        self.assertEqual(next(iter(fixture.state.table("recipient_delivery").values()))["state"], "delivered")
        self.assertFalse(any(row["client_store"] == "store-b" for row in fixture.state.table("client_copy").values()))


if __name__ == "__main__":
    unittest.main()
