"""Deterministic System 16 command interpreter.

`transition` is a trusted host API: its `state` output must never be exposed to a
player. Only `result` is an observer projection. All external facts are fixed JSON
fixtures. No other numbered module is imported. Policies use explicit versions.

Message acceptance is two phase: PrepareMessage persists a pending submission;
CommitMessage atomically creates the immutable communication and transport work.
The host must persist each successful transition (or use persistence.execute).
"""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from .dependencies import MockDependencies
from .state import Command, ContractError, Object, Result, State, canonical, reference, require


FORBIDDEN = {"stories", "reels", "modern_reactions", "live_location", "universal_cloud_restore", "tweet_edit", "x_branding"}
READ_ONLY = {"InspectCopy", "InspectStatus", "AvailableActions"}
PROVISIONABLE = {"communication_endpoint", "endpoint_binding", "feature_manifest", "channel_adapter", "client", "subscription", "account", "session", "logical_store", "voicemail_mailbox", "communication_profile", "artifact", "client_copy"}
WORKER_OPERATIONS = {"Dispatch", "Recover", "DecideOpportunity"}


def _subset(requested: Object, available: Object) -> bool:
    """Coverage is a set of independent field names and half-open content ranges."""
    if not set(requested) <= {"fields", "text", "audio", "details"}:
        return False
    for key in ("fields", "details"):
        if key in requested and (not isinstance(requested[key], list) or not set(requested[key]) <= set(available.get(key, []))):
            return False
    for key in ("text", "audio"):
        if key in requested:
            value, limit = requested[key], available.get(key)
            if not (isinstance(value, list) and len(value) == 2 and all(type(n) is int for n in value)):
                return False
            if not (isinstance(limit, list) and len(limit) == 2 and limit[0] <= value[0] <= value[1] <= limit[1]):
                return False
    return True


def _text_scope(text: str) -> Object:
    return {"text": [0, len(text)], "fields": [], "details": []}


def _segment(text: str, policy: Object) -> list[tuple[str, int]]:
    """Never split an extension escape or a UTF-16 surrogate pair across parts."""
    require(policy.get("kind") == "sms_encoding", "POLICY_UNAVAILABLE", "OWNER_PENDING")
    basic, extension = set(policy["gsm7_basic"]), set(policy["gsm7_extension"])
    gsm = all(char in basic or char in extension for char in text)
    if gsm:
        units = [(char, 1 if char in basic else 2) for char in text]
        single, multipart = policy["gsm7_single"], policy["gsm7_multipart"]
    else:
        require(policy["unicode_encoding"] == "utf-16-be", "CLIENT_UNSUPPORTED")
        units = [(char, len(char.encode("utf-16-be")) // 2) for char in text]
        single, multipart = policy["unicode_single"], policy["unicode_multipart"]
    require(type(single) is int and type(multipart) is int and single > 0 and multipart > 0, "POLICY_UNAVAILABLE")
    total = sum(n for _, n in units)
    capacity = single if total <= single else multipart
    parts: list[tuple[str, int]] = []
    fragment, count = "", 0
    for char, cost in units:
        require(cost <= capacity, "PLAN_LIMIT")
        if count + cost > capacity:
            parts.append((fragment, count))
            fragment, count = "", 0
        fragment, count = fragment + char, count + cost
    if fragment or not parts:
        parts.append((fragment, count))
    return parts


class _Execution:
    """Ephemeral interpreter context, never persisted as game state."""

    def __init__(self, state: State, command: Command, dependencies: MockDependencies):
        self.s, self.c, self.d = state, command, dependencies
        self.a = command["arguments"]
        self.branch, self.actor, self.request = command["branch_id"], command["principal_id"], command["request_id"]
        self.clock = dependencies.read("system11", "clock", self.branch)
        self.now = self.clock.get("now")
        require(type(self.now) is int, "CLOCK_UNAVAILABLE", "OWNER_PENDING")
        self.key = reference("request", self.branch, self.actor, self.request)
        self.reservations: list[str] = []

    def ident(self, kind: str, *parts: Any) -> str:
        return reference(kind, self.branch, self.actor, self.request, *parts)

    def emit(self, owner: str, event: str, key: str, **payload: Any) -> None:
        self.d.write(owner, event, key, branch_id=self.branch, **payload)

    def policy(self, ref: str) -> Object:
        return self.d.policy(ref)

    def grant(self, operation: str, resource: str, **payload: Any) -> Object:
        grant = self.d.read("system3", operation, resource, actor=self.actor, **payload)
        require(grant.get("allowed") is True, "PRIVACY_DENIED")
        return grant

    def explicit(self) -> Object:
        answer = self.d.read("player", "authorize", self.request, command=self.c)
        identity = self.d.read("system9", "actor_kind", self.actor)
        if identity.get("kind") == "NPC":
            decision = self.d.read("system5_6", "authorize", self.request, command=self.c)
            require(decision.get("approved") is True and decision.get("command_digest") == reference("command", self.c), "OWNER_PENDING", "OWNER_PENDING")
            return decision
        require(answer.get("authorized") is True and answer.get("command_digest") == reference("command", self.c), "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        require(answer.get("explicit") is True, "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        return answer

    def worker(self) -> None:
        grant = self.d.read("infrastructure", "worker", self.actor, command=self.c)
        require(grant.get("authorized") is True, "PRIVACY_DENIED")

    def access(self, client_ref: str, session_ref: str, capability: str) -> tuple[Object, Object]:
        client, session = self.s.get("client", client_ref), self.s.get("session", session_ref)
        require(session["client_id"] == client_ref and session_ref in client["session_ids"], "NO_VALID_SESSION")
        require(session["valid_from"] <= self.now and (session["valid_to"] is None or self.now < session["valid_to"]), "NO_VALID_SESSION")
        require(session["revocation_event_ref"] is None, "NO_VALID_SESSION")
        require(capability in session["scope"], "NO_VALID_SESSION")
        self.s.get("account", session["account_id"])
        physical = self.d.read("system15", "access", client["physical_device_id"] or client_ref, actor=self.actor)
        require(physical.get("present") is True, "DEVICE_NOT_PRESENT")
        require(physical.get("powered") is True, "NO_POWER")
        require(physical.get("accessible") is True and physical.get("compatible") is True, "PRIVACY_DENIED")
        self.grant("session", session_ref, capability=capability)
        return client, session

    def feature(self, feature_ref: str, client: Object, account: str, provider: str) -> None:
        manifest = self.s.get("feature_manifest", feature_ref)
        require(manifest["feature_id"] not in FORBIDDEN, "CLIENT_UNSUPPORTED")
        require(manifest["enabled"], "CLIENT_UNSUPPORTED")
        require(manifest["effective_from"] <= self.now, "FEATURE_NOT_YET_AVAILABLE")
        require(manifest["effective_to"] is None or self.now < manifest["effective_to"], "CLIENT_UNSUPPORTED")
        require(feature_ref in client["supported_features"], "CLIENT_UNSUPPORTED")
        for field, value in (("device_prerequisites", client["profile_ref"]), ("os_prerequisites", client["os_version"]), ("client_prerequisites", client["client_version"]), ("account_prerequisites", account)):
            require(not manifest[field] or value in manifest[field], "CLIENT_UNSUPPORTED")
        environment = self.d.read("infrastructure", "eligibility", client["client_id"], feature_ref=feature_ref)
        require(environment.get("region") == manifest["region"] and provider == manifest["provider"], "CLIENT_UNSUPPORTED")
        scope = manifest["rollout_scope"]
        require(set(scope) <= {"all", "accounts", "clients"}, "POLICY_UNAVAILABLE")
        require(scope.get("all") is True or account in scope.get("accounts", []) or client["client_id"] in scope.get("clients", []), "CLIENT_UNSUPPORTED")
        if manifest["source_classification"] == "verified_historical":
            require(bool(manifest["source_refs"]), "POLICY_UNAVAILABLE")

    def adapter(self, ref: str, client: Object, session: Object) -> Object:
        adapter = self.s.get("channel_adapter", ref)
        account = self.s.get("account", session["account_id"])
        require(adapter["feature_manifest_refs"], "POLICY_UNAVAILABLE", "OWNER_PENDING")
        for feature in adapter["feature_manifest_refs"]:
            self.feature(feature, client, session["account_id"], account["service_id"])
        service = self.d.read("infrastructure", "service", ref, client=client["client_id"], account=session["account_id"])
        require(service.get("available") is True, "SERVICE_UNAVAILABLE")
        require(service.get("eligible") is True, "PLAN_LIMIT")
        subscription_ref = service.get("subscription_ref")
        if adapter["channel"] in {"SMS", "MMS", "voice"}:
            require(isinstance(subscription_ref, str), "SERVICE_UNAVAILABLE")
            subscription = self.s.get("subscription", subscription_ref)
            flag = {"SMS": "sms_eligible", "MMS": "mms_eligible", "voice": "voice_eligible"}[adapter["channel"]]
            require(subscription[flag], "PLAN_LIMIT")
            active = self.policy(subscription["plan_limits_ref"])["active_service_states"]
            require(subscription["service_state"] in active, "SERVICE_UNAVAILABLE")
        return adapter

    def store_access(self, store_ref: str, client: Object, operation: str) -> Object:
        store = self.s.get("logical_store", store_ref)
        require(store_ref in client["store_ids"], "PRIVACY_DENIED")
        self.grant(operation, store_ref, policy_ref=store["access_policy_ref"])
        return store

    def payload(self, draft_ref: str, draft: Object) -> tuple[str, Object]:
        ref = reference("payload", draft_ref, draft["revision"])
        return ref, self.s.get("payload_revision", ref)

    def bind(self, endpoint_ref: str) -> tuple[str, Object]:
        endpoint = self.s.get("communication_endpoint", endpoint_ref)
        require(endpoint["branch_id"] == self.branch, "ENDPOINT_INVALID")
        policy = self.policy(endpoint["binding_policy_ref"])
        require(re.fullmatch(policy["address_pattern"], endpoint["address"]) is not None, "ENDPOINT_INVALID")
        matches = [(ref, row) for ref, row in self.s.table("endpoint_binding").items() if row["endpoint_id"] == endpoint_ref and row["valid_from"] <= self.now and (row["valid_to"] is None or self.now < row["valid_to"])]
        require(len(matches) == 1, "ENDPOINT_INVALID")
        return matches[0]

    def attachment(self, ref: str) -> Object:
        artifact = self.s.get("artifact", ref)
        self.grant("artifact", ref, policy_ref=artifact["access_policy_ref"])
        copies = [row for row in self.s.table("client_copy").values() if row["message_id_or_artifact"] == ref and row["copy_state"] == "available"]
        require(bool(copies), "ATTACHMENT_UNAVAILABLE")
        return artifact

    def schedule(self, kind: str, target: str, policy_ref: str, due: int, *parts: Any) -> str:
        key = reference("work", self.branch, kind, target, due, parts)
        if key in self.s.table("scheduled_work"):
            return key
        order = self.d.read("system11", "schedule", key, kind=kind, due_time=due, target=target)
        require(type(order.get("stable_sequence")) is int, "CLOCK_UNAVAILABLE", "OWNER_PENDING")
        dependencies = order.get("causal_dependencies", [])
        require(type(dependencies) is list, "CLOCK_UNAVAILABLE", "OWNER_PENDING")
        self.s.put("scheduled_work", key, {"event_id": key, "branch_id": self.branch, "kind": kind, "due_time": due, "stable_sequence": order["stable_sequence"], "causal_dependencies": dependencies, "target_ref": target, "policy_version_ref": policy_ref, "completion_state": "pending"})
        self.emit("system11", "ScheduleRequested", key, due_time=due, kind=kind, target_ref=target)
        return key

    def duration(self, operation: str, resource: str) -> int:
        result = self.d.read("system11", "duration", operation, target_ref=resource, actor=self.actor)
        require(result.get("accepted") is True and type(result.get("duration")) is int and result["duration"] >= 0, "CLOCK_UNAVAILABLE", "OWNER_PENDING")
        self.emit("system11", "ActionDuration", self.ident("duration", operation, resource), duration=result["duration"], operation=operation)
        return result["duration"]

    def acknowledge(self, message_ref: str, adapter: Object, kind: str, event_ref: str, scope: Object, client: Object | None = None) -> None:
        policy = self.policy(adapter["acknowledgment_policy_ref"])
        if not policy.get(kind, False):
            return
        if adapter["channel"] == "SMS" and kind == "read":
            return
        if kind in {"delivery", "read"}:
            feature = policy.get(kind + "_feature_ref")
            require(isinstance(feature, str), "POLICY_UNAVAILABLE")
            message = self.s.get("communication", message_ref)
            sender = self.s.get("client", message["source_client"])
            account = self.s.get("account", message["apparent_author_account"])
            self.feature(feature, sender, account["account_id"], account["service_id"])
        key = reference("ack", event_ref, adapter["version"])
        if key not in self.s.table("acknowledgment"):
            message = self.s.get("communication", message_ref)
            self.s.put("acknowledgment", key, {"transport_event_ref": event_ref, "adapter_ref": adapter["version"], "kind": kind, "scope": {"message_id": message_ref, **scope}, "exposed_to": [message["submitted_actor"]], "exposed_time": self.now, "policy_ref": adapter["acknowledgment_policy_ref"]})
            self.emit("system3", "ReceiptExposed", key, message_id=message_ref, kind=kind)

    def remember(self, ref: str | None, status: str) -> None:
        """Generic commands use the existing submission schema as request journal."""
        self.s.put("submission", self.key, {"branch_id": self.branch, "principal_id": self.actor, "request_id": self.request, "source_client_or_device": self.a.get("client_ref", "command-interface"), "account_or_session": self.a.get("session_ref", self.actor), "expected_revisions": self.a.get("expected_revisions", {}), "payload_revision": reference("command", self.c), "addressed_endpoints": [], "audience_ref": None, "authority_ref": reference("command-authority", self.c), "route_ref": "command:" + self.c["operation"] + ":" + status, "approved_fallback_ref": None, "reservation_refs": self.reservations, "decision": "COMMIT", "communication_ref": ref, "failure_code": None})
        if self.reservations:
            self.settle(self.s.get("submission", self.key), self.key)

    def charge_operation(self, adapter: Object, cap: int | None) -> None:
        policy = self.policy(adapter["charge_policy_ref"])
        amount = policy["per_unit"]
        require(type(amount) is int and amount >= 0, "POLICY_UNAVAILABLE")
        require(amount == 0 or (type(cap) is int and cap >= amount), "CHARGE_NOT_AUTHORIZED", "CHOICE_REQUIRED")
        result = self.d.read("system14", "reserve", self.key, amount=amount, terms_ref=policy["terms_ref"])
        require(result.get("accepted") is True, "PLAN_LIMIT")
        self.reservations = result.get("reservation_refs", [])

    def execute(self) -> Result:
        op = self.c["operation"]
        for kind in ("communication_endpoint", "communication", "submission", "scheduled_work"):
            require(all(row["branch_id"] == self.branch for row in self.s.table(kind).values()), "BRANCH_MISMATCH")
        old = self.s.table("submission").get(self.key)
        if old is not None:
            if old["route_ref"].startswith("command:"):
                require(old["payload_revision"] == reference("command", self.c), "REQUEST_CONFLICT")
                status = old["route_ref"].rsplit(":", 1)[1]
                return {"status": status, "data": {"reference": old["communication_ref"]}, "failure_code": None}
            require(op in {"PrepareMessage", "PrepareFallback"}, "REQUEST_CONFLICT")
            return self.prepare_message(retry=old)
        method = getattr(self, "op_" + op, None)
        require(callable(method), "CLIENT_UNSUPPORTED")
        if op in WORKER_OPERATIONS:
            self.worker()
        result = method()
        if op not in READ_ONLY and op not in {"PrepareMessage", "PrepareFallback"} and self.key not in self.s.table("submission") and not (op == "CommitMessage" and result["status"] == "PENDING"):
            self.remember(result["data"].get("reference"), result["status"])
        return result

    @staticmethod
    def result(status: str, ref: str | None = None, **data: Any) -> Result:
        return {"status": status, "data": {"reference": ref, **data}, "failure_code": None}

    def op_Provision(self) -> Result:
        """Trusted development/backstory input; unavailable to ordinary commands."""
        auth = self.d.read("configuration", "development", self.actor, command=self.c)
        require(auth.get("authorized") is True and auth.get("command_digest") == reference("command", self.c), "PRIVACY_DENIED")
        for item in self.a["records"]:
            require(item["kind"] in PROVISIONABLE, "PRIVACY_DENIED")
            row = item["record"]
            if "branch_id" in row:
                require(row["branch_id"] == self.branch, "BRANCH_MISMATCH")
            if item["kind"] == "endpoint_binding":
                for previous in self.s.table("endpoint_binding").values():
                    if previous["endpoint_id"] == row["endpoint_id"]:
                        require((previous["valid_to"] is not None and previous["valid_to"] <= row["valid_from"]) or (row["valid_to"] is not None and row["valid_to"] <= previous["valid_from"]), "BINDING_OVERLAP")
            self.s.put(item["kind"], item["reference"], row)
        return self.result("ACCEPTED")

    def op_SaveContact(self) -> Result:
        self.explicit()
        client, _ = self.access(self.a["client_ref"], self.a["session_ref"], "contacts")
        self.store_access(self.a["store_ref"], client, "write_store")
        knowledge = self.d.read("system4", "endpoints", self.actor)
        endpoints = self.a["endpoint_refs"]
        require(bool(endpoints) and set(endpoints) <= set(knowledge.get("known_endpoints", [])), "ENDPOINT_INVALID")
        source = self.d.read("system4", "learning", self.a["source_event_ref"], actor=self.actor)
        require(source.get("grounded") is True and set(endpoints) <= set(source.get("endpoint_refs", [])), "ENDPOINT_INVALID")
        for endpoint in endpoints:
            self.s.get("communication_endpoint", endpoint)
        key = self.a.get("entry_ref", self.ident("contact"))
        old = self.s.table("contact_entry").get(key)
        if old:
            require(old["store_id"] == self.a["store_ref"] and self.a.get("expected_revision") == old["revision"], "STALE_DRAFT")
        self.s.put("contact_entry", key, {"entry_id": key, "store_id": self.a["store_ref"], "label": self.a["label"], "endpoint_refs": endpoints, "claimed_person_or_organization": source.get("claimed_person_or_organization"), "source_event_ref": self.a["source_event_ref"], "confidence": source["confidence"], "permission_claim": source.get("permission_claim"), "notes": self.a.get("notes", ""), "last_verified_time": source.get("last_verified_time"), "revision": old["revision"] + 1 if old else 1}, replace=old is not None)
        self.emit("system4", "ContactSaved", key, endpoint_refs=endpoints)
        return self.result("ACCEPTED", key)

    def op_DeleteContact(self) -> Result:
        self.explicit()
        contact = self.s.get("contact_entry", self.a["entry_ref"])
        client, _ = self.access(self.a["client_ref"], self.a["session_ref"], "contacts")
        self.store_access(contact["store_id"], client, "write_store")
        require(contact["revision"] == self.a["expected_revision"], "STALE_DRAFT")
        del self.s.table("contact_entry")[self.a["entry_ref"]]
        return self.result("ACCEPTED", self.a["entry_ref"])

    def op_CreateDraft(self) -> Result:
        self.explicit()
        client, _ = self.access(self.a["client_ref"], self.a["session_ref"], "compose")
        self.store_access(self.a["store_ref"], client, "write_store")
        key = self.a.get("draft_ref", self.ident("draft"))
        old = self.s.table("draft").get(key)
        if old:
            require(old["state"] in {"active", "saved"} and old["client_store"] == self.a["store_ref"] and old["revision"] == self.a.get("expected_revision"), "STALE_DRAFT")
        recipients = self.a["recipient_refs"]
        require(len(recipients) == len(set(recipients)), "ENDPOINT_INVALID")
        known = self.d.read("system4", "endpoints", self.actor).get("known_endpoints", [])
        require(set(recipients) <= set(known), "ENDPOINT_INVALID")
        attachments = self.a.get("attachment_refs", [])
        for attachment in attachments:
            self.attachment(attachment)
        revision = old["revision"] + 1 if old else 1
        text = self.a["text"]
        require(type(text) is str, "INVALID_COMMAND")
        draft = {"draft_id": key, "client_store": self.a["store_ref"], "channel": self.a["channel"], "selected_recipients": recipients, "audience_ref": self.a.get("audience_ref"), "text": text, "attachment_refs": attachments, "revision": revision, "state": "active"}
        payload_ref = reference("payload", key, revision)
        email = self.a.get("email", {})
        require(set(email) <= {"envelope", "headers", "to", "cc", "bcc"}, "INVALID_COMMAND")
        if draft["channel"] == "email":
            require(set(email.get("envelope", [])) == set(recipients), "ENDPOINT_INVALID")
            require(set(email.get("to", []) + email.get("cc", []) + email.get("bcc", [])) == set(recipients), "ENDPOINT_INVALID")
            require(set(email.get("headers", {})) <= {"subject", "from", "reply_to"}, "PRIVACY_DENIED")
        sources = self.a.get("source_refs", [])
        for source in sources:
            self.grant("source", source)
        self.s.put("payload_revision", payload_ref, {"payload_id": key, "revision": revision, "text_or_recording_ref": text, "attachment_refs": attachments, "reply_or_forward_source_refs": sources, "email_envelope_recipients": email.get("envelope"), "email_display_headers": email.get("headers"), "email_to": email.get("to"), "email_cc": email.get("cc"), "email_bcc": email.get("bcc")})
        self.s.put("draft", key, draft, replace=old is not None)
        self.duration("compose", key)
        return self.result("DRAFTED", key, revision=revision, payload_revision=payload_ref)

    def op_AbandonDraft(self) -> Result:
        self.explicit()
        client, _ = self.access(self.a["client_ref"], self.a["session_ref"], "compose")
        draft = self.s.get("draft", self.a["draft_ref"])
        self.store_access(draft["client_store"], client, "write_store")
        require(draft["state"] in {"active", "saved"} and draft["revision"] == self.a["expected_revision"], "STALE_DRAFT")
        draft["state"] = "abandoned"
        return self.result("DRAFTED", draft["draft_id"])

    def op_Authorize(self) -> Result:
        self.explicit()
        row = deepcopy(self.a["authority"])
        require(row["principal_id"] == self.actor and row["uses_consumed"] == 0, "PRIVACY_DENIED")
        self.s.get("payload_revision", row["approved_payload_revision"])
        if row["kind"] == "bounded_mandate":
            require(row["request_limit"] is not None and row["request_limit"] > 0 and row["expires_at"] is not None and row["expires_at"] > self.now and row["trigger_condition"] is not None, "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        self.s.put("communication_authority", row["authority_id"], row)
        return self.result("ACCEPTED", row["authority_id"])

    def approved(self, draft: Object, payload_ref: str, client: Object, session: Object, adapter: Object) -> Object:
        authority = self.s.get("communication_authority", self.a["authority_ref"])
        require(authority["principal_id"] == self.actor and authority["approved_payload_revision"] == payload_ref and authority["approved_recipients"] == draft["selected_recipients"] and authority["approved_audience"] == draft["audience_ref"] and authority["channel"] == adapter["channel"] and authority["account_or_session_ref"] in {session["session_id"], session["account_id"]} and authority["device_or_endpoint_ref"] in {client["client_id"], client["physical_device_id"]}, "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        require(authority["expires_at"] is None or self.now < authority["expires_at"], "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        limit = authority["request_limit"]
        require(limit is None or authority["uses_consumed"] < limit, "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        if authority["kind"] == "explicit_action":
            self.explicit()
        else:
            trigger = self.d.read("player", "mandate", authority["authority_id"], command=self.c)
            require(trigger.get("authorized") is True and trigger.get("command_digest") == reference("command", self.c), "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
            require(authority["trigger_condition"].get("route_ref") == self.a["adapter_ref"], "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        return authority

    def validate_send(self) -> tuple[Object, Object, Object, Object, str, Object, Object]:
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "send")
        adapter = self.adapter(self.a["adapter_ref"], client, session)
        draft = self.s.get("draft", self.a["draft_ref"])
        self.store_access(draft["client_store"], client, "read_store")
        require(draft["revision"] == self.a["expected_revision"] and draft["state"] in {"active", "saved"}, "STALE_DRAFT")
        require(draft["channel"] == adapter["channel"], "CLIENT_UNSUPPORTED")
        require(bool(draft["selected_recipients"]), "AUDIENCE_AMBIGUOUS", "CHOICE_REQUIRED")
        payload_ref, payload = self.payload(self.a["draft_ref"], draft)
        authority = self.approved(draft, payload_ref, client, session, adapter)
        for attachment in payload["attachment_refs"]:
            self.attachment(attachment)
        self.validate_media(adapter, payload)
        return client, session, adapter, draft, payload_ref, payload, authority

    def validate_media(self, adapter: Object, payload: Object) -> None:
        policy = self.policy(adapter["attachment_transcoding_policy_ref"])
        attachments = [self.s.get("artifact", ref) for ref in payload["attachment_refs"]]
        require(len(attachments) <= policy["max_attachments"] and sum(row["size"] for row in attachments) <= policy["max_total_bytes"], "PLAN_LIMIT")
        require(all(row["format"] in policy["formats"] for row in attachments), "CLIENT_UNSUPPORTED")
        require(adapter["channel"] != "SMS" or not attachments, "CLIENT_UNSUPPORTED")

    def op_PrepareMessage(self) -> Result:
        return self.prepare_message()

    def prepare_message(self, retry: Object | None = None) -> Result:
        if retry is not None:
            require(retry["payload_revision"] == self.a["payload_revision"] and retry["source_client_or_device"] == self.a["client_ref"] and retry["account_or_session"] == self.a["session_ref"] and retry["route_ref"] == self.a["adapter_ref"] and retry["authority_ref"] == self.a["authority_ref"] and retry["expected_revisions"] == {self.a["draft_ref"]: self.a["expected_revision"]}, "REQUEST_CONFLICT")
            if retry["decision"] == "COMMIT":
                adapter = self.s.get("channel_adapter", retry["route_ref"])
                status = "ACCEPTED" if self.policy(adapter["acknowledgment_policy_ref"])["acceptance"] else "SUBMITTED"
            else:
                status = "PENDING" if retry["decision"] == "pending" else "FAILED"
            return self.result(status, self.key)
        client, session, adapter, draft, payload_ref, payload, authority = self.validate_send()
        require(payload_ref == self.a["payload_revision"], "STALE_DRAFT")
        bindings = [self.bind(endpoint)[0] for endpoint in draft["selected_recipients"]]
        binding_policy = self.policy(adapter["accepted_binding_policy_ref"])
        require(binding_policy["rule"] == "pin_at_acceptance", "POLICY_UNAVAILABLE")
        route = self.policy(adapter["routing_policy_ref"])
        require(route["acceptance"] in {"accept", "pending", "reject"}, "POLICY_UNAVAILABLE")
        require(route["acceptance"] != "reject", "SERVICE_UNAVAILABLE")
        segments = _segment(payload["text_or_recording_ref"], self.policy(adapter["encoding_counting_policy_ref"])) if adapter["channel"] == "SMS" else []
        charge = self.policy(adapter["charge_policy_ref"])
        units = max(1, len(segments)) * len(bindings)
        total = charge["per_unit"] * units
        require(type(total) is int and total >= 0, "POLICY_UNAVAILABLE")
        require(total == 0 or (type(authority["charge_cap"]) is int and total <= authority["charge_cap"]), "CHARGE_NOT_AUTHORIZED", "CHOICE_REQUIRED")
        # The reservation is idempotent under self.key; only the dummy boundary runs.
        economy = self.d.read("system14", "reserve", self.key, amount=total, units=units, terms_ref=charge["terms_ref"])
        require(economy.get("accepted") is True, "PLAN_LIMIT")
        self.s.put("submission", self.key, {"branch_id": self.branch, "principal_id": self.actor, "request_id": self.request, "source_client_or_device": client["client_id"], "account_or_session": session["session_id"], "expected_revisions": {draft["draft_id"]: draft["revision"]}, "payload_revision": payload_ref, "addressed_endpoints": list(draft["selected_recipients"]), "audience_ref": draft["audience_ref"], "authority_ref": authority["authority_id"], "route_ref": self.a["adapter_ref"], "approved_fallback_ref": None, "reservation_refs": economy.get("reservation_refs", []), "decision": "pending", "communication_ref": None, "failure_code": None})
        self.emit("system14", "ReservationRequested", self.key, amount=total, reservation_refs=economy.get("reservation_refs", []))
        return self.result("PENDING", self.key)

    def commit_submission(self, key: str) -> str | None:
        sub = self.s.get("submission", key)
        require(not sub["route_ref"].startswith("command:"), "INVALID_COMMAND")
        if sub["decision"] == "COMMIT":
            self.settle(sub, key)
            return sub["communication_ref"]
        require(sub["decision"] == "pending", "SUBMISSION_ABORTED")
        client, session = self.access(sub["source_client_or_device"], sub["account_or_session"], "send")
        adapter = self.adapter(sub["route_ref"], client, session)
        for draft_ref, revision in sub["expected_revisions"].items():
            draft = self.s.get("draft", draft_ref)
            require(draft["revision"] == revision and draft["state"] in {"active", "saved"}, "STALE_DRAFT")
        authority = self.s.get("communication_authority", sub["authority_ref"])
        require(authority["principal_id"] == sub["principal_id"] and authority["approved_payload_revision"] == sub["payload_revision"] and authority["approved_recipients"] == sub["addressed_endpoints"] and authority["approved_audience"] == sub["audience_ref"] and authority["channel"] == adapter["channel"] and authority["account_or_session_ref"] in {session["session_id"], session["account_id"]} and authority["device_or_endpoint_ref"] in {client["client_id"], client["physical_device_id"]}, "AUTHORIZATION_REQUIRED")
        require(authority["expires_at"] is None or self.now < authority["expires_at"], "AUTHORIZATION_REQUIRED")
        require(authority["request_limit"] is None or authority["uses_consumed"] < authority["request_limit"], "AUTHORIZATION_REQUIRED")
        payload = self.s.get("payload_revision", sub["payload_revision"])
        for ref in payload["attachment_refs"]:
            self.attachment(ref)
        route = self.policy(adapter["routing_policy_ref"])
        acceptance = route["acceptance"]
        if acceptance == "pending":
            acceptance = self.d.read("infrastructure", "acceptance", key).get("decision", "pending")
            if acceptance == "pending":
                return None
        require(acceptance == "accept", "SERVICE_UNAVAILABLE")
        bindings = [self.bind(endpoint) for endpoint in sub["addressed_endpoints"]]
        message_ref = reference("message", key)
        self.s.put("communication", message_ref, {"branch_id": self.branch, "message_id": message_ref, "request_key": sub["request_id"], "submitted_actor": sub["principal_id"], "apparent_author_account": session["account_id"], "source_client": client["client_id"], "payload_revision": sub["payload_revision"], "accepted_time": self.now, "adapter_version": sub["route_ref"], "source_event_id": key})
        lifetime = self.policy(adapter["queue_lifetime_policy_ref"])["ticks"]
        require(type(lifetime) is int and lifetime >= 0, "POLICY_UNAVAILABLE")
        delay = route["initial_delay"]
        require(type(delay) is int and delay >= 0, "POLICY_UNAVAILABLE")
        for binding_ref, _ in bindings:
            delivery_ref = reference("delivery", message_ref, binding_ref)
            self.s.put("recipient_delivery", delivery_ref, {"message_id": message_ref, "recipient_binding": binding_ref, "state": "queued", "queued_time": self.now, "delivered_time": None, "expiry": self.now + lifetime, "revision": 1})
            self.schedule("transport_retry", delivery_ref, sub["route_ref"], self.now + delay)
            self.schedule("queue_expiry", delivery_ref, sub["route_ref"], self.now + lifetime)
        if adapter["channel"] == "SMS":
            segments = _segment(payload["text_or_recording_ref"], self.policy(adapter["encoding_counting_policy_ref"]))
            for index, (fragment, units) in enumerate(segments):
                self.s.put("sms_segment", reference("segment", message_ref, index), {"message_id": message_ref, "segment_index": index, "segment_count": len(segments), "encoding_policy_ref": adapter["encoding_counting_policy_ref"], "encoded_unit_count": units, "payload_fragment": fragment, "recipient_transport_state": "pending", "reassembly_state": "pending"})
        if adapter["channel"] == "MMS":
            self.transcode(message_ref, adapter, payload)
        # The sent copy has its own store/retention and does not imply recipient delivery.
        for draft_ref in sub["expected_revisions"]:
            sent_store = self.s.get("draft", draft_ref)["client_store"]
            self.copy(message_ref, sent_store, key)
            for segment_ref, segment in self.s.table("sms_segment").items():
                if segment["message_id"] == message_ref:
                    self.copy(message_ref, sent_store, segment_ref, "segment")
        sub["decision"], sub["communication_ref"] = "COMMIT", message_ref
        authority["uses_consumed"] += 1
        for draft_ref in sub["expected_revisions"]:
            self.s.get("draft", draft_ref)["state"] = "submitted"
        self.acknowledge(message_ref, adapter, "acceptance", key, {})
        self.settle(sub, key)
        self.emit("system3", "MessageAccepted", key, message_id=message_ref)
        return message_ref

    def transcode(self, message_ref: str, adapter: Object, payload: Object) -> None:
        policy = self.policy(adapter["attachment_transcoding_policy_ref"])
        conversion = policy.get("transcode")
        if conversion is None:
            return
        for source_ref in payload["attachment_refs"]:
            source = self.s.get("artifact", source_ref)
            coverage = deepcopy(source["coverage"])
            if "details" in coverage:
                coverage["details"] = [item for item in coverage["details"] if item in conversion["retained_details"]]
            if "fields" in coverage:
                coverage["fields"] = [item for item in coverage["fields"] if item in conversion["retained_metadata"]]
            metadata = {key: value for key, value in source["metadata"].items() if key in conversion["retained_metadata"]}
            key = reference("mms-derivative", message_ref, source_ref, policy["version"])
            self.s.put("artifact", key, {"artifact_id": key, "kind": "derivative", "format": conversion["format"], "size": min(source["size"], conversion["max_bytes"]), "content_ref": reference("transcoded-content", source["content_ref"], policy["version"]), "source_refs": [source_ref], "derivation_operation": {"operation": "mms_transcode", "message_ref": message_ref, "policy_ref": policy["version"]}, "capture_time": source["capture_time"], "source_device_ref": source["source_device_ref"], "coverage": coverage, "quality": conversion["quality"], "metadata": metadata, "access_policy_ref": source["access_policy_ref"]})

    def delivered_attachments(self, message: Object) -> list[str]:
        payload = self.s.get("payload_revision", message["payload_revision"])
        result = []
        for source_ref in payload["attachment_refs"]:
            derivatives = [ref for ref, artifact in self.s.table("artifact").items() if artifact["source_refs"] == [source_ref] and artifact["derivation_operation"] is not None and artifact["derivation_operation"].get("message_ref") == message["message_id"]]
            result.append(derivatives[0] if derivatives else source_ref)
        return result

    def op_DownloadAttachment(self) -> Result:
        self.explicit()
        copy, client, _ = self.copy_read()
        pair = self.source_message(copy)
        require(pair is not None, "ATTACHMENT_UNAVAILABLE")
        ref = self.a["artifact_ref"]
        require(ref in self.delivered_attachments(pair[0]), "ATTACHMENT_UNAVAILABLE")
        store = self.store_access(self.a["destination_store_ref"], client, "write_store")
        transfer = self.d.read("infrastructure", "attachment_download", ref, copy_ref=copy["id"], client_ref=client["client_id"])
        require(transfer.get("available") is True, "ATTACHMENT_UNAVAILABLE")
        self.s.get("artifact", ref)
        result = self.copy(ref, store["store_id"], copy["id"])
        return self.result("DELIVERED", result)

    def settle(self, sub: Object, key: str) -> None:
        operation = "CommitReservation" if sub["decision"] == "COMMIT" else "ReleaseReservation"
        self.emit("system14", operation, key, reservation_refs=sub["reservation_refs"])

    def op_CommitMessage(self) -> Result:
        sub = self.s.get("submission", self.a["submission_ref"])
        require(sub["principal_id"] == self.actor, "PRIVACY_DENIED")
        ref = self.commit_submission(self.a["submission_ref"])
        adapter = self.s.get("channel_adapter", sub["route_ref"])
        status = ("ACCEPTED" if self.policy(adapter["acknowledgment_policy_ref"])["acceptance"] else "SUBMITTED") if ref else "PENDING"
        return self.result(status, ref)

    def op_PrepareFallback(self) -> Result:
        """Explicit, policy-approved retry on another route after definitive failure.

        The old request is terminal and has no recipient copies. The new explicit
        communication references its failed predecessor through approved_fallback_ref.
        A possibly delivered or partially delivered original cannot use this path.
        """
        self.explicit()
        previous = self.s.get("submission", self.a["failed_submission_ref"])
        require(previous["principal_id"] == self.actor and previous["decision"] in {"COMMIT", "ABORT"}, "SERVICE_UNAVAILABLE")
        original_adapter = self.s.get("channel_adapter", previous["route_ref"])
        fallback = self.policy(original_adapter["fallback_policy_ref"])
        require(fallback.get("enabled") is True and self.a["adapter_ref"] in fallback["allowed_adapters"], "CLIENT_UNSUPPORTED")
        if previous["decision"] == "COMMIT":
            message_ref = previous["communication_ref"]
            deliveries = [row for row in self.s.table("recipient_delivery").values() if row["message_id"] == message_ref]
            require(bool(deliveries) and all(row["state"] in {"failed", "expired", "bounced"} for row in deliveries), "SERVICE_UNAVAILABLE")
            require(all(row["delivered_time"] is None for row in deliveries), "SERVICE_UNAVAILABLE")
            recipient_copies = [row for row in self.s.table("client_copy").values() if row["source_relation"] in {reference("delivery", message_ref, delivery["recipient_binding"]) for delivery in deliveries}]
            require(not recipient_copies, "SERVICE_UNAVAILABLE")
            require(all(self.bind(self.s.get("endpoint_binding", delivery["recipient_binding"])["endpoint_id"])[0] == delivery["recipient_binding"] for delivery in deliveries), "ENDPOINT_INVALID")
        draft = self.s.get("draft", self.a["draft_ref"])
        _, payload = self.payload(draft["draft_id"], draft)
        previous_payload = self.s.get("payload_revision", previous["payload_revision"])
        require(draft["selected_recipients"] == previous["addressed_endpoints"] and payload["text_or_recording_ref"] == previous_payload["text_or_recording_ref"] and payload["attachment_refs"] == previous_payload["attachment_refs"], "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        result = self.prepare_message()
        self.s.get("submission", self.key)["approved_fallback_ref"] = self.a["failed_submission_ref"]
        return result

    def op_AbortSubmission(self) -> Result:
        self.explicit()
        sub = self.s.get("submission", self.a["submission_ref"])
        require(sub["principal_id"] == self.actor and sub["decision"] == "pending", "IMMUTABLE_RECORD")
        sub["decision"], sub["failure_code"] = "ABORT", "CANCELED"
        self.settle(sub, self.a["submission_ref"])
        return self.result("ACCEPTED", self.a["submission_ref"])

    def op_Recover(self) -> Result:
        for key, sub in list(self.s.table("submission").items()):
            if sub["route_ref"].startswith("command:"):
                if sub["reservation_refs"] and sub["decision"] in {"COMMIT", "ABORT"}:
                    self.settle(sub, key)
                continue
            if sub["decision"] in {"COMMIT", "ABORT"}:
                self.settle(sub, key)
            else:
                adapter = self.s.get("channel_adapter", sub["route_ref"])
                recovery = self.policy(adapter["routing_policy_ref"])["recovery"]
                require(recovery in {"pending", "abort"}, "POLICY_UNAVAILABLE")
                if recovery == "abort":
                    sub["decision"], sub["failure_code"] = "ABORT", "RECOVERY_ABORT"
                    self.settle(sub, key)
        return self.result("PENDING")

    def copy(self, target: str, store_ref: str, source: str, state: str = "available") -> str:
        self.s.get("logical_store", store_ref)
        key = reference("copy", target, store_ref, source)
        if key not in self.s.table("client_copy"):
            self.s.put("client_copy", key, {"id": key, "message_id_or_artifact": target, "client_store": store_ref, "copy_state": state, "source_relation": source, "revision": 1})
        return key

    def blocked(self, binding: Object, adapter: Object, effect: str, message: Object) -> bool:
        for row in self.s.table("contact_rule").values():
            scope = row["service_account_device_scope"]
            if row["effective_time"] > self.now or row["owner_ref"] != binding["subscription_or_account_id"]:
                continue
            if scope.get("adapter_ref") != adapter["version"]:
                continue
            if "client_ref" in scope:
                continue  # A client-scoped filter cannot suppress account delivery.
            if row["target_ref"] != message["apparent_author_account"]:
                continue
            if "account_ref" in scope and scope["account_ref"] != binding["subscription_or_account_id"]:
                continue
            if effect in self.policy(row["policy_ref"])["effects"]:
                return True
        return False

    def transport(self, delivery_ref: str, work: Object) -> None:
        delivery = self.s.get("recipient_delivery", delivery_ref)
        if delivery["state"] in {"delivered", "failed", "expired", "bounced"}:
            return
        if delivery["expiry"] is not None and self.now >= delivery["expiry"]:
            delivery["state"], delivery["revision"] = "expired", delivery["revision"] + 1
            return
        message = self.s.get("communication", delivery["message_id"])
        adapter = self.s.get("channel_adapter", message["adapter_version"])
        binding = self.s.get("endpoint_binding", delivery["recipient_binding"])
        policy = self.policy(adapter["routing_policy_ref"])
        route = self.d.read("infrastructure", "delivery", delivery_ref, binding_ref=delivery["recipient_binding"], message_id=message["message_id"])
        if route.get("permanent_failure") is True:
            delivery["state"], delivery["revision"] = "failed", delivery["revision"] + 1
            return
        if self.blocked(binding, adapter, "suppress_delivery", message):
            delivery["state"], delivery["revision"] = "failed", delivery["revision"] + 1
            return
        if route.get("available") is True:
            require(route.get("binding_ref") == delivery["recipient_binding"], "ENDPOINT_INVALID")
            store_ref = route["store_ref"]
            store = self.s.get("logical_store", store_ref)
            require(store["owner_ref"] == binding["subscription_or_account_id"], "PRIVACY_DENIED")
            require(route["placement"] in policy["placements"], "POLICY_UNAVAILABLE")
            segments = [(ref, row) for ref, row in self.s.table("sms_segment").items() if row["message_id"] == message["message_id"]]
            if segments:
                received = route.get("segment_indices", [])
                require(set(received) <= {row["segment_index"] for _, row in segments}, "INVALID_COMMAND")
                for ref, row in segments:
                    if row["segment_index"] in received:
                        self.copy(message["message_id"], store_ref, ref, "segment")
                present = {row["source_relation"] for row in self.s.table("client_copy").values() if row["message_id_or_artifact"] == message["message_id"] and row["client_store"] == store_ref and row["copy_state"] == "segment"}
                complete = all(ref in present for ref, _ in segments)
            else:
                complete = True
            parent_ref = self.copy(message["message_id"], store_ref, delivery_ref, "available" if complete else "partial")
            parent = self.s.get("client_copy", parent_ref)
            # A deleted copy is never resurrected by a late retry or synchronization.
            if parent["copy_state"] != "deleted":
                parent["copy_state"] = "available" if complete else "partial"
            delivery["state"] = "delivered" if complete else "partial"
            delivery["revision"] += 1
            if complete:
                delivery["delivered_time"] = self.now
                self.acknowledge(message["message_id"], adapter, "delivery", reference("delivered", delivery_ref), {"recipient_binding": delivery["recipient_binding"]})
            sync_policy = self.policy(adapter["sync_policy_ref"])
            self.schedule("client_sync", parent_ref, adapter["sync_policy_ref"], self.now + sync_policy["delay"], work["event_id"])
            self.emit("system5_6", "DeliveryOpportunity", reference("opportunity", delivery_ref, delivery["revision"]), message_id=message["message_id"], recipient_binding=delivery["recipient_binding"], placement=route["placement"])
            if complete:
                return
        retry = self.policy(adapter["retry_policy_ref"])
        require(type(retry["interval"]) is int and retry["interval"] > 0, "POLICY_UNAVAILABLE")
        if retry["store_forward"]:
            due = self.now + retry["interval"]
            if delivery["expiry"] is None or due < delivery["expiry"]:
                self.schedule("transport_retry", delivery_ref, message["adapter_version"], due)
        else:
            delivery["state"], delivery["revision"] = "failed", delivery["revision"] + 1

    def sync(self, source_ref: str, work: Object) -> None:
        source = self.s.get("client_copy", source_ref)
        if source["copy_state"] in {"deleted", "expired"}:
            return
        policy = self.policy(work["policy_version_ref"])
        targets = self.d.read("infrastructure", "sync", source_ref).get("targets", [])
        for target in targets:
            client = self.s.get("client", target["client_ref"])
            session = self.s.get("session", target["session_ref"])
            if session["client_id"] != client["client_id"] or session["session_id"] not in client["session_ids"] or session["revocation_event_ref"] is not None or not (session["valid_from"] <= self.now and (session["valid_to"] is None or self.now < session["valid_to"])):
                continue
            store = self.s.get("logical_store", target["store_ref"])
            if target["store_ref"] not in client["store_ids"] or not target.get("enrolled") or target.get("source_ref") != source_ref:
                continue
            if self.d.read("system3", "sync", source_ref, target=target).get("allowed") is not True:
                continue
            physical = self.d.read("system15", "sync", client["physical_device_id"] or client["client_id"])
            if physical.get("powered") is not True or not target.get("connected"):
                continue
            message = self.s.table("communication").get(source["message_id_or_artifact"])
            if message and self.client_rule_suppresses(message, client, session["account_id"], "suppress_delivery"):
                continue
            copied = self.copy(source["message_id_or_artifact"], store["store_id"], source_ref, source["copy_state"])
            for part in list(self.s.table("client_copy").values()):
                if part["client_store"] == source["client_store"] and part["message_id_or_artifact"] == source["message_id_or_artifact"] and part["copy_state"] == "segment":
                    self.copy(part["message_id_or_artifact"], store["store_id"], part["source_relation"], "segment")
            local = self.s.get("client_copy", copied)
            if local["copy_state"] in {"deleted", "expired"}:
                continue
            local["copy_state"] = source["copy_state"]
            self.notify(copied, client, session["account_id"])
            self.emit("system3", "ClientSynced", reference("sync", source_ref, copied, source["revision"]), copy_ref=copied)
        if policy["retry_interval"] is not None:
            interval = policy["retry_interval"]
            require(type(interval) is int and interval > 0, "POLICY_UNAVAILABLE")
            self.schedule("client_sync", source_ref, work["policy_version_ref"], self.now + interval)

    def client_rule_suppresses(self, message: Object, client: Object, recipient: str, effect: str) -> bool:
        for rule in self.s.table("contact_rule").values():
            scope = rule["service_account_device_scope"]
            if rule["owner_ref"] not in {recipient, client["client_id"], client["physical_device_id"]} or rule["target_ref"] != message["apparent_author_account"] or rule["effective_time"] > self.now:
                continue
            if scope.get("adapter_ref") != message["adapter_version"] or ("client_ref" in scope and scope["client_ref"] != client["client_id"]):
                continue
            if effect in self.policy(rule["policy_ref"])["effects"]:
                return True
        return False

    def notify(self, copy_ref: str, client: Object, recipient: str) -> None:
        policy = self.policy(client["notification_policy_ref"])
        source = self.s.get("client_copy", copy_ref)
        key = reference("notification", source["source_relation"], recipient, client["client_id"])
        if key in self.s.table("notification"):
            return
        settings = self.d.read("infrastructure", "notification", client["client_id"], recipient=recipient)
        if settings.get("display") is not True or not policy["enabled"]:
            return
        message = self.s.table("communication").get(source["message_id_or_artifact"])
        if message and self.client_rule_suppresses(message, client, recipient, "suppress_alert"):
            return
        # Preview coverage comes from the client policy; attention remains separate.
        visible = deepcopy(policy["preview_scope"])
        supported = self.copy_scope(source)
        if "text" in visible and "text" in supported:
            start, end = visible["text"]
            visible["text"] = [min(start, supported["text"][1]), min(end, supported["text"][1])]
            if source["copy_state"] == "partial":
                # A preview can show only the contiguous prefix that actually arrived.
                segments = sorted([(ref, row) for ref, row in self.s.table("sms_segment").items() if row["message_id"] == source["message_id_or_artifact"]], key=lambda item: item[1]["segment_index"])
                parts = {row["source_relation"] for row in self.s.table("client_copy").values() if row["client_store"] == source["client_store"] and row["copy_state"] == "segment"}
                end = 0
                for ref, segment in segments:
                    if ref not in parts:
                        break
                    end += len(segment["payload_fragment"])
                visible["text"] = [0, min(visible["text"][1], end)]
        require(_subset(visible, supported), "POLICY_UNAVAILABLE")
        self.s.put("notification", key, {"notification_id": key, "source_event_id": source["source_relation"], "recipient_ref": recipient, "client_id": client["client_id"], "mode": settings.get("mode", policy["mode"]), "displayed_scope": visible, "display_time": self.now, "policy_ref": client["notification_policy_ref"]})
        self.emit("system3", "NotificationDisplayed", key, client_ref=client["client_id"], scope=visible)

    def op_Dispatch(self) -> Result:
        """Only externally dispatched due IDs execute; UI refresh never drains timers."""
        ids = self.clock.get("due_event_ids", [])
        require(type(ids) is list and len(ids) == len(set(ids)), "CLOCK_ORDER_INVALID")
        rows = [self.s.get("scheduled_work", ref) for ref in ids]
        require(rows == sorted(rows, key=lambda row: (row["due_time"], row["stable_sequence"], row["event_id"])), "CLOCK_ORDER_INVALID")
        for work in rows:
            if work["completion_state"] == "complete":
                continue
            require(work["due_time"] <= self.now, "CLOCK_ORDER_INVALID")
            require(all(self.s.get("scheduled_work", ref)["completion_state"] == "complete" for ref in work["causal_dependencies"]), "CLOCK_ORDER_INVALID")
            kind, target = work["kind"], work["target_ref"]
            if kind == "transport_retry":
                self.transport(target, work)
            elif kind == "queue_expiry":
                delivery = self.s.get("recipient_delivery", target)
                if delivery["state"] in {"queued", "partial"}:
                    delivery["state"], delivery["revision"] = "expired", delivery["revision"] + 1
            elif kind == "client_sync":
                self.sync(target, work)
            elif kind == "typing_expiry":
                signal = self.s.table("typing_signal").get(target)
                if signal is not None and signal["expires_at"] <= self.now:
                    self.s.table("typing_signal").pop(target, None)
            elif kind == "ring_timeout":
                call = self.s.get("call", target)
                if call["state"] == "ringing":
                    policy = self.policy(work["policy_version_ref"])
                    outcome = policy["ring_timeout_outcome"]
                    require(outcome in {"unavailable", "redirected_to_voicemail", "ended"}, "POLICY_UNAVAILABLE")
                    call["state"] = outcome
                    if outcome != "redirected_to_voicemail":
                        call["end_time"] = self.now
                    if policy["record_missed_call"]:
                        call["missed_call_record_refs"].append(work["event_id"])
            elif kind == "retention_expiry":
                self.expire_copy(target, work["policy_version_ref"])
            elif kind == "attention_opportunity":
                self.emit("system5_6", "AttentionOpportunity", work["event_id"], target_ref=target)
            elif kind == "publication":
                post = self.s.get("post", target)
                require(post["published_time"] <= self.now, "CLOCK_ORDER_INVALID")
                post["access_or_deletion_state"] = "published"
            work["completion_state"] = "complete"
        return self.result("ACCEPTED")

    def source_message(self, copy: Object) -> tuple[Object, Object] | None:
        message = self.s.table("communication").get(copy["message_id_or_artifact"])
        if message is None:
            return None
        return message, self.s.get("payload_revision", message["payload_revision"])

    def copy_scope(self, copy: Object) -> Object:
        store = self.s.get("logical_store", copy["client_store"])
        retention = self.policy(store["retention_policy_ref"])
        pair = self.source_message(copy)
        if pair:
            available = _text_scope(pair[1]["text_or_recording_ref"])
            available["fields"] = ["apparent_author_account", "attachments"]
            if pair[1]["email_display_headers"] is not None:
                available["fields"].append("headers")
            if retention.get("content") == "metadata_only":
                available.pop("text", None)
                available["fields"] = []
            return available
        artifact = self.s.table("artifact").get(copy["message_id_or_artifact"])
        if artifact:
            return artifact["coverage"]
        post = self.s.table("post").get(copy["message_id_or_artifact"])
        if post:
            return _text_scope(self.s.get("payload_revision", post["payload_revision"])["text_or_recording_ref"])
        raise ContractError("ATTACHMENT_UNAVAILABLE")

    def copy_read(self) -> tuple[Object, Object, Object]:
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "read")
        copy = self.s.get("client_copy", self.a["copy_ref"])
        require(copy["copy_state"] in {"available", "partial"}, "ATTACHMENT_UNAVAILABLE")
        self.store_access(copy["client_store"], client, "read_store")
        post = self.s.table("post").get(copy["message_id_or_artifact"])
        if post:
            require(self.audience(post), "PRIVACY_DENIED")
        scope = self.a["scope"]
        grant = self.grant("exposure", copy["id"], scope=scope)
        require(_subset(scope, grant.get("scope", {})) and _subset(scope, self.copy_scope(copy)), "PRIVACY_DENIED")
        pair = self.source_message(copy)
        if pair and self.s.get("channel_adapter", pair[0]["adapter_version"])["channel"] == "SMS" and "text" in scope:
            segments = sorted([(ref, row) for ref, row in self.s.table("sms_segment").items() if row["message_id"] == pair[0]["message_id"]], key=lambda item: item[1]["segment_index"])
            available = {row["source_relation"] for row in self.s.table("client_copy").values() if row["client_store"] == copy["client_store"] and row["copy_state"] == "segment"}
            start, end = scope["text"]
            offset = 0
            for ref, segment in segments:
                next_offset = offset + len(segment["payload_fragment"])
                if start < next_offset and end > offset:
                    require(ref in available, "ATTACHMENT_UNAVAILABLE")
                offset = next_offset
        return copy, client, session

    def project_copy(self, copy: Object, scope: Object) -> Object:
        pair = self.source_message(copy)
        data: Object = {"copy_ref": copy["id"], "scope": scope}
        if pair:
            message, payload = pair
            if "text" in scope:
                start, end = scope["text"]
                data["text"] = payload["text_or_recording_ref"][start:end]
            # Never project submitted_actor, envelope/Bcc, private routes, or reader IDs.
            if "apparent_author_account" in scope.get("fields", []):
                data["apparent_author_account"] = message["apparent_author_account"]
            if "headers" in scope.get("fields", []):
                data["headers"] = payload["email_display_headers"]
                data["to"], data["cc"] = payload["email_to"], payload["email_cc"]
            if "attachments" in scope.get("fields", []):
                data["attachments"] = self.delivered_attachments(message)
        else:
            artifact = self.s.table("artifact").get(copy["message_id_or_artifact"])
            if artifact:
                data["artifact_ref"] = artifact["artifact_id"]
                data["metadata"] = {key: artifact["metadata"][key] for key in scope.get("fields", []) if key in artifact["metadata"]}
            else:
                post = self.s.get("post", copy["message_id_or_artifact"])
                if "text" in scope:
                    start, end = scope["text"]
                    data["text"] = self.s.get("payload_revision", post["payload_revision"])["text_or_recording_ref"][start:end]
        return data

    def op_InspectCopy(self) -> Result:
        """Inspection is a projection; AttendArtifact records the actual observation."""
        copy, _, _ = self.copy_read()
        require(any(row["actor_id"] == self.actor and row["client_copy_id"] == copy["id"] and _subset(self.a["scope"], row["visible_scope"]) for row in self.s.table("attention_event").values()), "PRIVACY_DENIED")
        return self.result("OBSERVED", copy["id"], **self.project_copy(copy, self.a["scope"]))

    def op_AttendArtifact(self) -> Result:
        self.explicit()
        copy, client, session = self.copy_read()
        scope = self.a["scope"]
        pair = self.source_message(copy)
        adapter = self.s.get("channel_adapter", pair[0]["adapter_version"]) if pair else None
        policy_ref = adapter["acknowledgment_policy_ref"] if adapter else client["notification_policy_ref"]
        key = self.ident("attention")
        elapsed = self.duration("attend", copy["id"])
        if "audio" in scope:
            require(elapsed >= scope["audio"][1] - scope["audio"][0], "CLOCK_UNAVAILABLE", "OWNER_PENDING")
        self.s.put("attention_event", key, {"actor_id": self.actor, "client_copy_id": copy["id"], "visible_scope": scope, "attention_time": self.now, "acknowledgment_policy_ref": policy_ref})
        self.emit("system4", "ArtifactAttended", key, actor_id=self.actor, copy_ref=copy["id"], scope=scope)
        self.emit("system3", "ArtifactAttended", key, actor_id=self.actor, copy_ref=copy["id"], scope=scope)
        self.emit("system7_8", "CommunicationObserved", key, copy_ref=copy["id"], scope=scope, attribution="account_claim")
        if adapter:
            policy = self.policy(policy_ref)
            full = scope.get("text") == self.copy_scope(copy).get("text")
            if full or policy.get("preview_triggers_read", False):
                if policy.get("read", False) and adapter["channel"] != "SMS":
                    self.feature(policy["read_feature_ref"], client, session["account_id"], self.s.get("account", session["account_id"])["service_id"])
                ack_event = reference("read", pair[0]["message_id"], session["account_id"]) if policy["read_scope"] == "account" else reference("read", pair[0]["message_id"], client["client_id"])
                self.acknowledge(pair[0]["message_id"], adapter, "read", ack_event, {"account_ref": session["account_id"]}, client)
        return self.result("OBSERVED", key, **self.project_copy(copy, scope))

    def op_InspectStatus(self) -> Result:
        self.access(self.a["client_ref"], self.a["session_ref"], "read")
        message = self.s.get("communication", self.a["message_ref"])
        self.grant("status", message["message_id"])
        receipts = [{"kind": row["kind"], "time": row["exposed_time"]} for row in self.s.table("acknowledgment").values() if row["scope"].get("message_id") == message["message_id"] and self.actor in row["exposed_to"]]
        return self.result("OBSERVED", message["message_id"], acknowledgments=receipts)

    def op_AvailableActions(self) -> Result:
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "read")
        account = self.s.get("account", session["account_id"])
        allowed = []
        for ref in client["supported_features"]:
            try:
                self.feature(ref, client, session["account_id"], account["service_id"])
                allowed.append(self.s.get("feature_manifest", ref)["feature_id"])
            except ContractError:
                pass
        return self.result("OBSERVED", client["client_id"], features=allowed)

    def op_StartTyping(self) -> Result:
        self.explicit()
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "compose")
        adapter = self.adapter(self.a["adapter_ref"], client, session)
        require(adapter["channel"] == "app", "CLIENT_UNSUPPORTED")
        policy = self.policy(adapter["acknowledgment_policy_ref"])
        self.feature(policy["typing_feature_ref"], client, session["account_id"], self.s.get("account", session["account_id"])["service_id"])
        draft = self.s.get("draft", self.a["draft_ref"])
        self.store_access(draft["client_store"], client, "read_store")
        require(draft["state"] in {"active", "saved"}, "STALE_DRAFT")
        key = reference("typing", self.a["session_ref"], self.a["draft_ref"])
        require(type(policy["typing_lifetime"]) is int and policy["typing_lifetime"] > 0, "POLICY_UNAVAILABLE")
        expiry = self.now + policy["typing_lifetime"]
        self.s.put("typing_signal", key, {"compose_session_ref": self.a["draft_ref"], "audience": draft["selected_recipients"], "started_at": self.now, "expires_at": expiry, "policy_ref": adapter["acknowledgment_policy_ref"]}, replace=True)
        self.schedule("typing_expiry", key, adapter["acknowledgment_policy_ref"], expiry)
        return self.result("ACCEPTED", key)

    def op_StopTyping(self) -> Result:
        self.explicit()
        self.access(self.a["client_ref"], self.a["session_ref"], "compose")
        key = reference("typing", self.a["session_ref"], self.a["draft_ref"])
        self.s.table("typing_signal").pop(key, None)
        return self.result("ACCEPTED", key)

    def op_PlaceCall(self) -> Result:
        self.explicit()
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "call")
        adapter = self.adapter(self.a["adapter_ref"], client, session)
        require(adapter["channel"] == "voice", "CLIENT_UNSUPPORTED")
        self.charge_operation(adapter, self.a.get("charge_cap"))
        endpoint = self.a["endpoint_ref"]
        require(endpoint in self.d.read("system4", "endpoints", self.actor).get("known_endpoints", []), "ENDPOINT_INVALID")
        binding_ref, _ = self.bind(endpoint)
        feasible = self.d.read("dialogue", "feasibility", self.actor, client_ref=client["client_id"])
        require(feasible.get("feasible") is True, "CHOICE_REQUIRED", "CHOICE_REQUIRED")
        route = self.d.read("infrastructure", "call", binding_ref)
        state = route.get("outcome", "pending_route")
        require(state in {"pending_route", "ringing", "busy", "unavailable", "redirected_to_voicemail"}, "POLICY_UNAVAILABLE")
        key = self.ident("call")
        policy = self.policy(adapter["routing_policy_ref"])
        timer = self.schedule("ring_timeout", key, adapter["routing_policy_ref"], self.now + policy["ring_timeout"]) if state == "ringing" else None
        self.s.put("call", key, {"call_id": key, "origin_service_session_actor": {"client_ref": client["client_id"], "session_ref": session["session_id"], "actor_ref": self.actor, "account_ref": session["account_id"], "recipient_binding": binding_ref}, "dialed_endpoint": endpoint, "route_ref": self.a["adapter_ref"], "caller_id_claim": route.get("caller_id_claim", {}), "state": state, "start_time": self.now, "answer_time": None, "end_time": self.now if state in {"busy", "unavailable"} else None, "ring_timeout_event": timer, "actual_participants": [self.actor], "presented_identities": [route.get("caller_id_claim", {})], "hold_transfer_events": [], "missed_call_record_refs": [], "recording_refs": []})
        self.duration("dial", key)
        self.emit("dialogue", "CallRinging" if state == "ringing" else "CallAttempted", key, call_ref=key)
        return self.result("PENDING", key)

    def call_access(self, capability: str = "call") -> tuple[Object, Object, Object]:
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], capability)
        call = self.s.get("call", self.a["call_ref"])
        self.grant("call", call["call_id"], client_ref=client["client_id"])
        return call, client, session

    def op_AnswerCall(self) -> Result:
        self.explicit()
        call, client, _ = self.call_access()
        require(call["state"] == "ringing", "SERVICE_UNAVAILABLE")
        route = self.d.read("infrastructure", "answer_endpoint", call["call_id"], client_ref=client["client_id"])
        require(route.get("authorized") is True and route.get("client_ref") == client["client_id"], "PRIVACY_DENIED")
        require(self.d.read("dialogue", "feasibility", self.actor).get("feasible") is True, "CHOICE_REQUIRED", "CHOICE_REQUIRED")
        call["state"], call["answer_time"] = "answered", self.now
        if self.actor not in call["actual_participants"]:
            call["actual_participants"].append(self.actor)
        call["presented_identities"].append(self.a.get("presented_identity", {}))
        self.emit("dialogue", "CallAnswered", self.ident("answer"), call_ref=call["call_id"], actor_ref=self.actor)
        return self.result("ACCEPTED", call["call_id"])

    def op_DeclineCall(self) -> Result:
        self.explicit()
        call, client, _ = self.call_access()
        require(call["state"] == "ringing", "SERVICE_UNAVAILABLE")
        route = self.d.read("infrastructure", "answer_endpoint", call["call_id"], client_ref=client["client_id"])
        require(route.get("authorized") is True and route.get("client_ref") == client["client_id"], "PRIVACY_DENIED")
        call["state"], call["end_time"] = "rejected_at_client", self.now
        self.emit("dialogue", "CallEnded", self.ident("decline"), call_ref=call["call_id"])
        return self.result("ACCEPTED", call["call_id"])

    def op_EndCall(self) -> Result:
        self.explicit()
        call, _, _ = self.call_access()
        require(self.actor in call["actual_participants"], "PRIVACY_DENIED")
        require(call["state"] in {"answered", "ringing", "pending_route", "redirected_to_voicemail"}, "SERVICE_UNAVAILABLE")
        call["state"], call["end_time"] = "ended", self.now
        self.emit("dialogue", "CallEnded", self.ident("end-call"), call_ref=call["call_id"], ended_at=self.now)
        return self.result("ACCEPTED", call["call_id"])

    def op_CallTurn(self) -> Result:
        self.explicit()
        call, _, _ = self.call_access()
        require(call["state"] == "answered" and self.actor in call["actual_participants"], "SERVICE_UNAVAILABLE")
        turn = self.d.read("dialogue", "turn", self.request, payload=self.a["payload"], actor=self.actor, call_ref=call["call_id"])
        require(turn.get("feasible") is True, "CHOICE_REQUIRED", "CHOICE_REQUIRED")
        self.duration("call_turn", call["call_id"])
        # Speech is not a stored transcript. A distinct recording action is required.
        self.emit("dialogue", "CallTurn", self.ident("call-turn"), call_ref=call["call_id"], payload=self.a["payload"], coverage=turn.get("audible_scope", {}))
        self.emit("system7_8", "CallObserved", self.ident("call-turn"), call_ref=call["call_id"], coverage=turn.get("audible_scope", {}))
        return self.result("CHOICE_REQUIRED" if turn.get("choice_required", True) else "OBSERVED", call["call_id"])

    def op_HoldTransferCall(self) -> Result:
        self.explicit()
        call, client, session = self.call_access()
        require(call["state"] == "answered" and self.actor in call["actual_participants"], "SERVICE_UNAVAILABLE")
        adapter = self.s.get("channel_adapter", call["route_ref"])
        feature_ref = self.policy(adapter["routing_policy_ref"])[self.a["action"] + "_feature_ref"]
        self.feature(feature_ref, client, session["account_id"], self.s.get("account", session["account_id"])["service_id"])
        resolution = self.d.read("dialogue", "hold_transfer", self.request, call_ref=call["call_id"], action=self.a["action"])
        require(resolution.get("feasible") is True, "SERVICE_UNAVAILABLE")
        event = self.ident("hold-transfer")
        call["hold_transfer_events"].append(event)
        # Participants are supplied by the actual supported transfer, never intended identity.
        if self.a["action"] == "transfer":
            call["actual_participants"] = resolution["actual_participants"]
            call["presented_identities"] = resolution["presented_identities"]
        self.emit("dialogue", "CallChanged", event, call_ref=call["call_id"], action=self.a["action"])
        return self.result("ACCEPTED", call["call_id"])

    def op_DepositVoicemail(self) -> Result:
        self.explicit()
        call, _, _ = self.call_access()
        require(call["state"] == "redirected_to_voicemail" and self.actor in call["actual_participants"], "SERVICE_UNAVAILABLE")
        mailbox = self.s.get("voicemail_mailbox", self.a["mailbox_ref"])
        route = self.d.read("infrastructure", "voicemail", mailbox["mailbox_id"], call_ref=call["call_id"])
        require(route.get("connected") is True and route.get("call_ref") == call["call_id"], "SERVICE_UNAVAILABLE")
        policy = self.policy(mailbox["capacity_policy_ref"])
        existing = [row for row in self.s.table("voicemail_recording").values() if row["mailbox_id"] == mailbox["mailbox_id"] and any(copy["message_id_or_artifact"] == row["artifact_ref"] and copy["copy_state"] == "available" for copy in self.s.table("client_copy").values())]
        require(len(existing) < policy["max_recordings"], "PLAN_LIMIT")
        artifact = self.attachment(self.a["artifact_ref"])
        require(artifact["kind"] == "audio" and self.a["duration"] <= policy["max_duration"] and artifact["coverage"].get("audio") == [0, self.a["duration"]], "ATTACHMENT_UNAVAILABLE")
        key = self.ident("voicemail")
        self.s.put("voicemail_recording", key, {"recording_id": key, "mailbox_id": mailbox["mailbox_id"], "call_id": call["call_id"], "artifact_ref": artifact["artifact_id"], "duration": self.a["duration"], "endpoint_attribution": call["caller_id_claim"], "submission_time": self.now, "transcription_feature_ref": None})
        copy_ref = self.copy(artifact["artifact_id"], route["store_ref"], key)
        retention = self.policy(mailbox["retention_policy_ref"])
        if retention["ticks"] is not None:
            self.schedule("retention_expiry", copy_ref, mailbox["retention_policy_ref"], self.now + retention["ticks"])
        call["state"], call["end_time"] = "ended", self.now
        self.duration("record_voicemail", key)
        self.emit("system3", "VoicemailDeposited", key, mailbox_ref=mailbox["mailbox_id"])
        return self.result("ACCEPTED", key)

    def op_CaptureArtifact(self) -> Result:
        self.explicit()
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "capture")
        store = self.store_access(self.a["store_ref"], client, "write_store")
        self.feature(self.a["feature_ref"], client, session["account_id"], self.s.get("account", session["account_id"])["service_id"])
        scene = self.d.read("system12", "capture", self.request, client_ref=client["client_id"])
        require(scene.get("line_of_sight") is True and scene.get("intentional_or_fixed") is True, "ATTACHMENT_UNAVAILABLE")
        output = self.d.read("system10", "capture", self.request, scene_ref=scene.get("receipt"))
        require(output.get("resolved") is True, "OWNER_PENDING", "OWNER_PENDING")
        require(_subset(output["coverage"], scene["coverage"]), "PRIVACY_DENIED")
        key = self.ident("artifact")
        kind = self.a["kind"]
        require(kind in {"photo", "audio", "screenshot"}, "CLIENT_UNSUPPORTED")
        metadata = output.get("metadata", {})
        if "location" in metadata:
            require(scene.get("location_metadata_enabled") is True, "PRIVACY_DENIED")
        self.s.put("artifact", key, {"artifact_id": key, "kind": kind, "format": output["format"], "size": output["size"], "content_ref": output["content_ref"], "source_refs": output.get("source_refs", []), "derivation_operation": None, "capture_time": self.now, "source_device_ref": client["physical_device_id"], "coverage": output["coverage"], "quality": output["quality"], "metadata": metadata, "access_policy_ref": store["access_policy_ref"]})
        self.copy(key, store["store_id"], key)
        self.duration("capture", key)
        self.emit("system12", "ArtifactCaptured", key, artifact_ref=key, coverage=output["coverage"])
        self.emit("system15", "DeviceUsed", key, device_ref=client["physical_device_id"])
        return self.result("ACCEPTED", key)

    def op_DeriveArtifact(self) -> Result:
        self.explicit()
        client, _ = self.access(self.a["client_ref"], self.a["session_ref"], "capture")
        store = self.store_access(self.a["store_ref"], client, "write_store")
        source = self.attachment(self.a["source_ref"])
        policy = self.policy(self.a["policy_ref"])
        require(self.a["operation"] in policy["operations"], "CLIENT_UNSUPPORTED")
        coverage = self.a["coverage"]
        require(_subset(coverage, source["coverage"]), "PRIVACY_DENIED")
        metadata = {key: value for key, value in source["metadata"].items() if key in policy["retained_metadata"]}
        key = self.ident("artifact")
        self.s.put("artifact", key, {"artifact_id": key, "kind": "derivative", "format": policy["output_format"], "size": min(source["size"], policy["max_output_bytes"]), "content_ref": reference("derived-content", source["content_ref"], self.a["operation"], coverage, policy["version"]), "source_refs": [source["artifact_id"]], "derivation_operation": {"operation": self.a["operation"], "policy_ref": policy["version"]}, "capture_time": source["capture_time"], "source_device_ref": source["source_device_ref"], "coverage": coverage, "quality": policy["quality"], "metadata": metadata, "access_policy_ref": store["access_policy_ref"]})
        self.copy(key, store["store_id"], source["artifact_id"])
        return self.result("ACCEPTED", key)

    def op_SaveArtifact(self) -> Result:
        self.explicit()
        source, client, _ = self.copy_read()
        require(self.a["scope"] == self.copy_scope(source), "ATTACHMENT_UNAVAILABLE")
        store = self.store_access(self.a["destination_store_ref"], client, "write_store")
        ref = self.copy(source["message_id_or_artifact"], store["store_id"], source["id"], source["copy_state"])
        return self.result("ACCEPTED", ref)

    def audience(self, post: Object) -> bool:
        if post["access_or_deletion_state"] != "published" or post["published_time"] > self.now:
            return False
        policy = self.policy(post["audience_policy_ref"])
        require(policy["evaluation"] == post["audience_evaluation"], "POLICY_UNAVAILABLE")
        if policy["evaluation"] == "publication":
            allowed = policy["public"] or self.actor in policy["members"] or self.actor == post["submitted_actor"]
        else:
            # Membership is an external scoped fact; System 16 does not infer relationships.
            membership = self.d.read("system3", "audience", post["post_id"], actor=self.actor, policy_ref=policy["version"])
            allowed = membership.get("eligible") is True
        return bool(allowed and self.d.read("system3", "post", post["post_id"], actor=self.actor).get("allowed") is True)

    def op_PublishPost(self) -> Result:
        self.explicit()
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "post")
        adapter = self.adapter(self.a["adapter_ref"], client, session)
        require(adapter["channel"] == "social", "CLIENT_UNSUPPORTED")
        draft = self.s.get("draft", self.a["draft_ref"])
        self.store_access(draft["client_store"], client, "read_store")
        require(draft["channel"] == "social" and draft["revision"] == self.a["expected_revision"] and draft["state"] in {"active", "saved"}, "STALE_DRAFT")
        payload_ref, payload = self.payload(draft["draft_id"], draft)
        authority = self.approved(draft, payload_ref, client, session, adapter)
        self.charge_operation(adapter, authority["charge_cap"])
        require(draft["audience_ref"] is not None, "AUDIENCE_AMBIGUOUS", "CHOICE_REQUIRED")
        audience = self.policy(draft["audience_ref"])
        self.validate_media(adapter, payload)
        for ref in payload["attachment_refs"]:
            self.attachment(ref)
        counter = self.policy(adapter["encoding_counting_policy_ref"])
        text = payload["text_or_recording_ref"]
        require(counter["algorithm"] in {"codepoints", "utf16", "weighted"}, "POLICY_UNAVAILABLE")
        if counter["algorithm"] == "weighted":
            units = sum(counter["weights"].get(char, counter["default_weight"]) for char in text)
        elif counter["algorithm"] == "utf16":
            units = len(text.encode("utf-16-be")) // 2
        else:
            units = len(text)
        if counter.get("url_units") is not None:
            for match in re.finditer(counter["url_pattern"], text):
                original = match.group()
                raw = sum(counter["weights"].get(char, counter["default_weight"]) for char in original) if counter["algorithm"] == "weighted" else len(original.encode("utf-16-be")) // 2 if counter["algorithm"] == "utf16" else len(original)
                units += counter["url_units"] - raw
        units += counter["attachment_units"] * len(payload["attachment_refs"])
        limit = counter["limit"]
        if self.a["platform_ref"] == "Twitter":
            require(limit == 140, "CLIENT_UNSUPPORTED")
        require(units <= limit, "PLAN_LIMIT")
        key = self.ident("post")
        self.s.put("post", key, {"post_id": key, "platform_ref": self.a["platform_ref"], "author_account": session["account_id"], "submitted_actor": self.actor, "session_ref": session["session_id"], "payload_revision": payload_ref, "published_time": self.now, "audience_policy_ref": draft["audience_ref"], "audience_evaluation": audience["evaluation"], "protection_state": audience["protection_state"], "reply_retweet_source_refs": payload["reply_or_forward_source_refs"], "version": 1, "access_or_deletion_state": "published"})
        self.copy(key, draft["client_store"], key)
        authority["uses_consumed"] += 1
        draft["state"] = "submitted"
        self.emit("system3", "PostPublished", key, post_ref=key, audience_policy_ref=draft["audience_ref"])
        return self.result("ACCEPTED", key)

    def op_BrowseFeed(self) -> Result:
        self.explicit()
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "read")
        self.store_access(self.a["store_ref"], client, "write_store")
        policy = self.policy(self.a["ranking_policy_ref"])
        require(policy["algorithm"] == "recency_then_id", "POLICY_UNAVAILABLE")
        connections = set(policy.get("discovery_accounts", []))
        for action in self.s.table("platform_connection_or_action").values():
            if action["state"] != "accepted":
                continue
            if action["kind"] == "follow" and action["actor_account"] == session["account_id"]:
                connections.add(action["target_ref"])
            elif action["kind"] == "friendship":
                request = self.s.table("platform_connection_or_action").get(action["target_ref"])
                if request:
                    participants = {request["actor_account"], request["target_ref"]}
                    if session["account_id"] in participants:
                        connections.update(participants - {session["account_id"]})
        eligible = [post for post in self.s.table("post").values() if post["author_account"] in connections and self.audience(post)]
        eligible.sort(key=lambda row: (-row["published_time"], row["post_id"]))
        selected = eligible[:policy["limit"]]
        key = self.ident("feed")
        self.s.put("feed_retrieval", key, {"retrieval_id": key, "actor_id": self.actor, "client_id": client["client_id"], "retrieved_time": self.now, "audience_policy_versions": [row["audience_policy_ref"] for row in selected], "ranking_policy_ref": policy["version"], "selected_post_versions": [row["post_id"] for row in selected], "selection_reasons": ["eligible_connection_and_recency" for _ in selected]})
        copies = [self.copy(row["post_id"], self.a["store_ref"], key) for row in selected]
        self.duration("browse", key)
        # Actual post text requires AttendArtifact; selection creates no attention event.
        return self.result("ACCEPTED", key, copy_refs=copies)

    def op_PlatformAction(self) -> Result:
        self.explicit()
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "post")
        adapter = self.adapter(self.a["adapter_ref"], client, session)
        require(adapter["channel"] == "social", "CLIENT_UNSUPPORTED")
        self.feature(self.a["feature_ref"], client, session["account_id"], self.s.get("account", session["account_id"])["service_id"])
        target, kind = self.a["target_ref"], self.a["kind"]
        self.grant("platform_action", target, kind=kind)
        post = self.s.table("post").get(target)
        if post:
            require(self.audience(post), "PRIVACY_DENIED")
        if kind == "friendship":
            request = self.s.get("platform_connection_or_action", target)
            require(request["kind"] == "friend_request" and request["state"] == "pending" and request["target_ref"] == session["account_id"], "PRIVACY_DENIED")
            request["state"] = "accepted"
        if kind in {"comment", "retweet", "invitation", "profile_claim", "tag"}:
            # Payload-bearing actions reference a separately authorized immutable post.
            action_post = self.s.get("post", self.a["post_ref"])
            require(action_post["submitted_actor"] == self.actor and target in action_post["reply_retweet_source_refs"], "AUTHORIZATION_REQUIRED", "CHOICE_REQUIRED")
        key = self.ident("platform-action")
        self.s.put("platform_connection_or_action", key, {"record_id": key, "actor_account": session["account_id"], "target_ref": target, "kind": kind, "state": "pending" if kind == "friend_request" else "accepted", "source_event_ref": self.a.get("post_ref", key), "effective_time": self.now})
        self.emit("system7_8", "PlatformAction", key, kind=kind, target_ref=target, account_ref=session["account_id"])
        return self.result("ACCEPTED", key)

    def op_ChangeAudience(self) -> Result:
        self.explicit()
        _, session = self.access(self.a["client_ref"], self.a["session_ref"], "post")
        post = self.s.get("post", self.a["post_ref"])
        require(post["author_account"] == session["account_id"] and post["version"] == self.a["expected_version"], "PRIVACY_DENIED")
        self.grant("change_audience", post["post_id"])
        policy = self.policy(self.a["audience_policy_ref"])
        # Preserve every previous audience version; new version has unchanged payload.
        previous = deepcopy(post)
        version_ref = reference("post-version", post["post_id"], post["version"])
        previous["access_or_deletion_state"] = "superseded"
        self.s.put("post", version_ref, previous)
        post["audience_policy_ref"], post["audience_evaluation"] = policy["version"], policy["evaluation"]
        post["protection_state"] = policy["protection_state"]
        post["version"] += 1
        self.emit("system3", "AudienceChanged", self.ident("audience"), post_ref=post["post_id"], policy_ref=policy["version"])
        return self.result("ACCEPTED", post["post_id"])

    def op_DeletePost(self) -> Result:
        self.explicit()
        _, session = self.access(self.a["client_ref"], self.a["session_ref"], "post")
        post = self.s.get("post", self.a["post_ref"])
        require(post["author_account"] == session["account_id"], "PRIVACY_DENIED")
        self.grant("delete_post", post["post_id"])
        post["access_or_deletion_state"] = "deleted"
        self.emit("system3", "PostDeleted", self.ident("delete-post"), post_ref=post["post_id"])
        return self.result("ACCEPTED", post["post_id"])

    def op_ChangeContactRule(self) -> Result:
        self.explicit()
        client, session = self.access(self.a["client_ref"], self.a["session_ref"], "privacy")
        rule = deepcopy(self.a["rule"])
        require(rule["owner_ref"] in {session["account_id"], client["client_id"], client["physical_device_id"]}, "PRIVACY_DENIED")
        scope = rule["service_account_device_scope"]
        require("adapter_ref" in scope and set(scope) <= {"adapter_ref", "account_ref", "client_ref"}, "INVALID_COMMAND")
        self.s.get("channel_adapter", scope["adapter_ref"])
        self.grant("change_contact_rule", rule["owner_ref"])
        require(rule["effective_time"] >= self.now, "INVALID_COMMAND")
        policy = self.policy(rule["policy_ref"])
        require(rule["kind"] in policy["kinds"], "CLIENT_UNSUPPORTED")
        self.feature(policy["feature_ref"], client, session["account_id"], self.s.get("account", session["account_id"])["service_id"])
        self.s.put("contact_rule", rule["rule_id"], rule)
        self.emit("system3", "ContactRuleChanged", rule["rule_id"], scope=rule["service_account_device_scope"])
        return self.result("ACCEPTED", rule["rule_id"])

    def op_RevokeSessions(self) -> Result:
        self.explicit()
        authorization = self.d.read("infrastructure", "revoke", self.request, session_refs=self.a["session_refs"])
        require(authorization.get("authorized") is True and set(self.a["session_refs"]) <= set(authorization.get("session_refs", [])), "PRIVACY_DENIED")
        for ref in self.a["session_refs"]:
            row = self.s.get("session", ref)
            row["valid_to"] = min(row["valid_to"], self.now) if row["valid_to"] is not None else self.now
            row["revocation_event_ref"] = self.ident("revocation")
        self.emit("infrastructure", "SessionsRevoked", self.ident("revocation"), session_refs=self.a["session_refs"])
        return self.result("ACCEPTED", self.ident("revocation"))

    def expire_copy(self, copy_ref: str, policy_ref: str) -> None:
        copy = self.s.get("client_copy", copy_ref)
        policy = self.policy(policy_ref)
        require(policy["scope"] == "named_copy", "POLICY_UNAVAILABLE")
        copy["copy_state"], copy["revision"] = "expired", copy["revision"] + 1
        # Segment copies in the same store are part of this logical SMS copy.
        for row in self.s.table("client_copy").values():
            if row["client_store"] == copy["client_store"] and row["message_id_or_artifact"] == copy["message_id_or_artifact"] and row["copy_state"] == "segment":
                row["copy_state"], row["revision"] = "expired", row["revision"] + 1

    def op_DeleteCopy(self) -> Result:
        self.explicit()
        client, _ = self.access(self.a["client_ref"], self.a["session_ref"], "delete")
        copy = self.s.get("client_copy", self.a["copy_ref"])
        store = self.store_access(copy["client_store"], client, "write_store")
        policy = self.policy(store["retention_policy_ref"])
        require(policy["client_delete"] is True and copy["revision"] == self.a["expected_revision"], "PRIVACY_DENIED")
        self.expire_copy(copy["id"], store["retention_policy_ref"])
        copy["copy_state"] = "deleted"
        return self.result("ACCEPTED", copy["id"])

    def op_AcquireRecord(self) -> Result:
        self.explicit()
        copy, client, _ = self.copy_read()
        store = self.store_access(self.a["destination_store_ref"], client, "write_store")
        authorization = self.d.read("investigation", "acquire", self.a["authority_ref"], source_ref=copy["id"], actor=self.actor)
        require(authorization.get("authorized") is True and _subset(self.a["scope"], authorization.get("coverage", {})), "PRIVACY_DENIED")
        source_store = self.s.get("logical_store", copy["client_store"])
        retention = self.policy(source_store["retention_policy_ref"])
        require(retention["export_allowed"] is True, "PRIVACY_DENIED")
        key, artifact_ref = self.ident("export"), self.ident("export-artifact")
        view = self.project_copy(copy, self.a["scope"])
        # content_ref is a canonical, self-contained JSON representation of ONLY
        # acquired fields; it is a retained export, not a pointer to secret truth.
        encoded = canonical(view)
        self.s.put("artifact", artifact_ref, {"artifact_id": artifact_ref, "kind": "export", "format": "application/json", "size": len(encoded.encode("utf-8")), "content_ref": encoded, "source_refs": [copy["id"]], "derivation_operation": {"operation": "authorized_export", "method": self.a["method"]}, "capture_time": self.now, "source_device_ref": client["physical_device_id"], "coverage": self.a["scope"], "quality": {"classification": "partial_record", "authenticity": "not_determined"}, "metadata": {}, "access_policy_ref": store["access_policy_ref"]})
        self.copy(artifact_ref, store["store_id"], key)
        self.s.put("evidence_export", key, {"export_id": key, "source_refs": [copy["id"]], "acquiring_actor": self.actor, "method": self.a["method"], "acquired_time": self.now, "coverage": self.a["scope"], "authority_ref": self.a["authority_ref"], "artifact_ref": artifact_ref, "case_ref": self.a.get("case_ref"), "physical_carrier_ref": self.a.get("physical_carrier_ref")})
        self.emit("investigation", "RecordExported", key, export_ref=key, artifact_ref=artifact_ref, coverage=self.a["scope"])
        return self.result("ACCEPTED", key)

    def op_DecideOpportunity(self) -> Result:
        source_ref = self.a["source_communication_ref"]
        self.s.get("communication", source_ref)
        recipient = self.a["actor_ref"]
        fact = self.d.read("system5_6", "opportunity", self.a["opportunity_ref"], actor=recipient, source_ref=source_ref)
        require(fact.get("eligible") is True and fact.get("source_communication_ref") == source_ref and fact.get("actor_id") == recipient, "OWNER_PENDING", "OWNER_PENDING")
        require(any(row["message_id"] == source_ref and row["state"] in {"delivered", "partial"} for row in self.s.table("recipient_delivery").values()), "OWNER_PENDING", "OWNER_PENDING")
        key = self.a["opportunity_ref"]
        if key in self.s.table("opportunity_and_reply_plan"):
            return self.result("ACCEPTED", key)
        outcome = fact["outcome"]
        if outcome in {"reply", "call_instead"}:
            require(any(row["actor_id"] == recipient and self.s.get("client_copy", row["client_copy_id"])["message_id_or_artifact"] == source_ref for row in self.s.table("attention_event").values()), "PRIVACY_DENIED")
        self.s.put("opportunity_and_reply_plan", key, {"opportunity_id": key, "actor_id": recipient, "source_communication_ref": source_ref, "eligible_window": fact["eligible_window"], "feasibility_input_refs": fact["feasibility_input_refs"], "decision_ref": fact["decision_ref"], "decision_reason_tags": fact["decision_reason_tags"], "known_information_refs": fact["known_information_refs"], "outcome": outcome, "reply_plan_ref": fact.get("reply_plan_ref"), "plan_state": fact["plan_state"], "submitted_communication_ref": None})
        return self.result("ACCEPTED", key)

    def op_UpdateReplyPlan(self) -> Result:
        self.worker()
        row = self.s.get("opportunity_and_reply_plan", self.a["opportunity_ref"])
        fact = self.d.read("system5_6", "plan", row["reply_plan_ref"] or row["opportunity_id"])
        require(fact.get("decision_ref") is not None, "OWNER_PENDING", "OWNER_PENDING")
        state = fact["plan_state"]
        require(state in {"planned", "postponed", "interrupted", "canceled", "submitted"}, "INVALID_COMMAND")
        if state == "submitted":
            message = self.s.get("communication", fact["submitted_communication_ref"])
            payload = self.s.get("payload_revision", message["payload_revision"])
            require(message["submitted_actor"] == row["actor_id"] and row["source_communication_ref"] in payload["reply_or_forward_source_refs"], "PRIVACY_DENIED")
            row["submitted_communication_ref"] = message["message_id"]
        row["plan_state"], row["decision_ref"] = state, fact["decision_ref"]
        row["decision_reason_tags"] = fact["decision_reason_tags"]
        return self.result("ACCEPTED", row["opportunity_id"])

    def op_LearnEndpoint(self) -> Result:
        """An external grounded learning event; no local memory is manufactured."""
        self.worker()
        fact = self.d.read("system4", "learning", self.a["source_event_ref"])
        require(fact.get("grounded") is True, "ENDPOINT_INVALID")
        for endpoint in fact["endpoint_refs"]:
            self.s.get("communication_endpoint", endpoint)
        key = self.ident("learned")
        self.emit("system4", "EndpointLearned", key, source_event_ref=self.a["source_event_ref"], actor_ref=self.a["actor_ref"], endpoint_refs=fact["endpoint_refs"], confidence=fact["confidence"])
        self.emit("system9", "EndpointAssociationEvidence", key, source_event_ref=self.a["source_event_ref"])
        return self.result("ACCEPTED", key)

    def op_ReassignEndpoint(self) -> Result:
        self.explicit()
        endpoint_ref = self.a["endpoint_ref"]
        fact = self.d.read("infrastructure", "provision_endpoint", self.request, endpoint_ref=endpoint_ref)
        require(fact.get("authorized") is True and fact.get("endpoint_ref") == endpoint_ref and fact.get("account_ref") == self.a["account_ref"], "PRIVACY_DENIED")
        _, old = self.bind(endpoint_ref)
        # Closing the interval preserves its original account and all pinned references.
        old["valid_to"] = self.now
        key = self.ident("binding")
        self.s.put("endpoint_binding", key, {"endpoint_id": endpoint_ref, "subscription_or_account_id": self.a["account_ref"], "valid_from": self.now, "valid_to": None, "source_event_id": self.ident("provision")})
        endpoint = self.s.get("communication_endpoint", endpoint_ref)
        endpoint["revision"] += 1
        self.emit("infrastructure", "EndpointReassigned", key, endpoint_ref=endpoint_ref, binding_ref=key)
        return self.result("ACCEPTED", key)

    def op_SyncContacts(self) -> Result:
        self.explicit()
        client, _ = self.access(self.a["client_ref"], self.a["session_ref"], "contacts")
        destination = self.store_access(self.a["destination_store_ref"], client, "write_store")
        source = self.s.get("logical_store", self.a["source_store_ref"])
        require(destination["sync_policy_ref"] is not None or source["store_id"] in destination["restore_source_refs"], "CLIENT_UNSUPPORTED")
        route = self.d.read("infrastructure", "contact_sync", destination["store_id"])
        require(route.get("available") is True and route.get("source_store_ref") == source["store_id"], "SERVICE_UNAVAILABLE")
        self.grant("contact_sync", source["store_id"])
        refs = []
        for source_ref in self.a["entry_refs"]:
            entry = self.s.get("contact_entry", source_ref)
            require(entry["store_id"] == source["store_id"], "PRIVACY_DENIED")
            key = reference("contact-copy", source_ref, destination["store_id"], entry["revision"])
            row = deepcopy(entry)
            row.update(entry_id=key, store_id=destination["store_id"], source_event_ref=self.ident("contact-sync"))
            self.s.put("contact_entry", key, row)
            refs.append(key)
        return self.result("ACCEPTED", self.ident("contact-sync"), contact_refs=refs)

    def op_RecordExposure(self) -> Result:
        """Automatic perception requires a real, externally supplied exposure fact.

        Out-of-character accessibility notifications cannot pass this boundary.
        Shared-screen observers need no imaginary session on the owner's account.
        """
        self.worker()
        notification = self.s.get("notification", self.a["notification_ref"])
        perception = self.d.read("system3", "perception", self.a["perception_ref"])
        require(perception.get("perceived") is True and perception.get("in_character") is True and perception.get("notification_ref") == notification["notification_id"], "PRIVACY_DENIED")
        scope = perception["scope"]
        require(_subset(scope, notification["displayed_scope"]), "PRIVACY_DENIED")
        copy = self.s.get("client_copy", perception["copy_ref"])
        client = self.s.get("client", notification["client_id"])
        require(copy["client_store"] in client["store_ids"] and copy["copy_state"] in {"available", "partial"}, "PRIVACY_DENIED")
        require(_subset(scope, self.copy_scope(copy)), "PRIVACY_DENIED")
        key = reference("perception", self.a["perception_ref"])
        pair = self.source_message(copy)
        policy_ref = self.s.get("channel_adapter", pair[0]["adapter_version"])["acknowledgment_policy_ref"] if pair else notification["policy_ref"]
        self.s.put("attention_event", key, {"actor_id": perception["actor_id"], "client_copy_id": copy["id"], "visible_scope": scope, "attention_time": self.now, "acknowledgment_policy_ref": policy_ref})
        self.emit("system4", "ArtifactAttended", key, actor_id=perception["actor_id"], copy_ref=copy["id"], scope=scope)
        return self.result("OBSERVED", key)

    def op_RecordCall(self) -> Result:
        self.explicit()
        call, client, session = self.call_access("capture")
        require(call["state"] == "answered" and self.actor in call["actual_participants"], "SERVICE_UNAVAILABLE")
        adapter = self.s.get("channel_adapter", call["route_ref"])
        policy = self.policy(adapter["routing_policy_ref"])
        self.feature(policy["recording_feature_ref"], client, session["account_id"], self.s.get("account", session["account_id"])["service_id"])
        store = self.store_access(self.a["store_ref"], client, "write_store")
        recording = self.d.read("dialogue", "recording", self.request, call_ref=call["call_id"])
        require(recording.get("recorded") is True, "ATTACHMENT_UNAVAILABLE")
        require(recording["coverage"].get("audio", [0, 0])[1] <= self.now - call["answer_time"], "ATTACHMENT_UNAVAILABLE")
        key = self.ident("call-recording")
        self.s.put("artifact", key, {"artifact_id": key, "kind": "audio", "format": recording["format"], "size": recording["size"], "content_ref": recording["content_ref"], "source_refs": [call["call_id"]], "derivation_operation": None, "capture_time": recording["capture_time"], "source_device_ref": client["physical_device_id"], "coverage": recording["coverage"], "quality": recording["quality"], "metadata": {}, "access_policy_ref": store["access_policy_ref"]})
        self.copy(key, store["store_id"], call["call_id"])
        call["recording_refs"].append(key)
        self.emit("investigation", "RecordingCreated", key, call_ref=call["call_id"], artifact_ref=key)
        return self.result("ACCEPTED", key)

    def op_ResolveCallRoute(self) -> Result:
        self.worker()
        call = self.s.get("call", self.a["call_ref"])
        require(call["state"] == "pending_route", "SERVICE_UNAVAILABLE")
        route = self.d.read("infrastructure", "call", call["origin_service_session_actor"]["recipient_binding"])
        outcome = route.get("outcome")
        require(outcome in {"ringing", "busy", "unavailable", "redirected_to_voicemail"}, "OWNER_PENDING", "OWNER_PENDING")
        call["state"] = outcome
        adapter = self.s.get("channel_adapter", call["route_ref"])
        policy = self.policy(adapter["routing_policy_ref"])
        if outcome == "ringing":
            call["ring_timeout_event"] = self.schedule("ring_timeout", call["call_id"], policy["version"], self.now + policy["ring_timeout"])
        elif outcome != "redirected_to_voicemail":
            call["end_time"] = self.now
        self.emit("dialogue", "CallRouteResolved", self.ident("call-route"), call_ref=call["call_id"])
        return self.result("ACCEPTED", call["call_id"])

    def op_RequestExternalAction(self) -> Result:
        """Reports, repairs, provisioning and recovery are requests to black boxes."""
        self.explicit()
        owner, action = self.a["owner"], self.a["action"]
        require((owner, action) in {("system15", "charge_device"), ("system15", "repair_device"), ("system15", "replace_device"), ("system15", "acquire_carrier"), ("infrastructure", "report_contact"), ("infrastructure", "recover_account"), ("infrastructure", "provision_service")}, "CLIENT_UNSUPPORTED")
        if owner == "system15":
            permission = self.d.read("system15", "operation", self.a["payload"]["device_ref"], action=action, actor=self.actor)
            require(permission.get("authorized") is True, "PRIVACY_DENIED")
        else:
            self.access(self.a["client_ref"], self.a["session_ref"], "read")
        key = self.ident("external-request")
        self.emit(owner, action, key, payload=self.a["payload"])
        return self.result("OWNER_PENDING", key)

    def op_CollectExpiredContent(self) -> Result:
        """Remove unretained content, keeping opaque historical IDs and metadata."""
        self.worker()
        policy = self.policy(self.a["policy_ref"])
        require(policy.get("purge_unreferenced") is True, "PRIVACY_DENIED")
        live = {row["message_id_or_artifact"] for row in self.s.table("client_copy").values() if row["copy_state"] not in {"deleted", "expired"}}
        for message_ref, message in self.s.table("communication").items():
            if message_ref in live or any(row["message_id"] == message_ref and row["state"] in {"queued", "partial"} for row in self.s.table("recipient_delivery").values()):
                continue
            payload_ref = message["payload_revision"]
            if any(row["payload_revision"] == payload_ref and row["access_or_deletion_state"] == "published" for row in self.s.table("post").values()):
                continue
            payload = self.s.table("payload_revision").pop(payload_ref, None)
            if payload:
                draft_ref = payload["payload_id"]
                draft = self.s.table("draft").get(draft_ref)
                if draft and draft["state"] == "submitted":
                    self.s.table("draft").pop(draft_ref)
            for key, segment in list(self.s.table("sms_segment").items()):
                if segment["message_id"] == message_ref:
                    self.s.table("sms_segment").pop(key)
        for key, artifact in list(self.s.table("artifact").items()):
            if key in live:
                continue
            if any(key in payload["attachment_refs"] for payload in self.s.table("payload_revision").values()):
                continue
            # Referenced derivatives remain independently retained; their lineage IDs
            # can outlive unavailable originals without manufacturing original bytes.
            self.s.table("artifact").pop(key)
        return self.result("ACCEPTED")


def transition(state: Object, command: Command, dependencies: MockDependencies | None = None) -> Object:
    """Return {state, result}; failed commands roll back all local mutations.

    Caller commands cannot contain dependency responses or policies. The trusted
    host supplies MockDependencies separately. JSON snapshots retain nulls exactly.
    This function performs no network, filesystem, or real-world clock access.
    """
    deps = dependencies or MockDependencies()
    try:
        original = State.from_json(state)
    except (ContractError, KeyError, TypeError, ValueError):
        return {"state": deepcopy(state), "result": {"status": "FAILED", "data": {}, "failure_code": "INVALID_STATE"}}
    try:
        require(type(command) is dict and set(command) == {"operation", "branch_id", "principal_id", "request_id", "arguments"}, "INVALID_COMMAND")
        require(all(type(command[key]) is str and command[key] for key in ("operation", "branch_id", "principal_id", "request_id")) and type(command["arguments"]) is dict, "INVALID_COMMAND")
        canonical(command)
    except (ContractError, KeyError, TypeError, ValueError):
        return {"state": original.to_json(), "result": {"status": "FAILED", "data": {}, "failure_code": "INVALID_COMMAND"}}
    working = State.from_json(original.to_json())
    try:
        execution = _Execution(working, deepcopy(command), deps)
        result = execution.execute()
        State.from_json(working.to_json())
        return {"state": working.to_json(), "result": result}
    except ContractError as error:
        visible = deps.read("system3", "failure", command["principal_id"], code=error.code)
        safe = {"INVALID_COMMAND", "CLIENT_UNSUPPORTED", "STALE_DRAFT", "AUTHORIZATION_REQUIRED", "CHARGE_NOT_AUTHORIZED", "AUDIENCE_AMBIGUOUS", "POLICY_UNAVAILABLE", "CLOCK_UNAVAILABLE", "REQUEST_CONFLICT"}
        known = error.code in safe or error.code in visible.get("known_failure_codes", [])
        status = error.status if known else "FAILED"
        return {"state": original.to_json(), "result": {"status": status, "data": {}, "failure_code": error.code if known else "SERVICE_UNAVAILABLE"}}
    except (KeyError, TypeError, IndexError, UnicodeError, ValueError):
        return {"state": original.to_json(), "result": {"status": "FAILED", "data": {}, "failure_code": "INVALID_COMMAND"}}


def fork_state(state: Object, new_branch_id: str) -> Object:
    """Trusted save-system boundary: deep-copy history and isolate all future writes.

    Historical IDs remain stable. Only branch fields and request lookup keys change.
    Neither branch shares a mutable Python object with the other.
    """
    require(type(new_branch_id) is str and bool(new_branch_id), "INVALID_COMMAND")
    result = State.from_json(state)
    for kind in ("communication_endpoint", "communication", "submission", "scheduled_work"):
        for row in result.table(kind).values():
            row["branch_id"] = new_branch_id
    requests = result.table("submission")
    remapped = {reference("request", row["branch_id"], row["principal_id"], row["request_id"]): row for row in requests.values()}
    result.companion_records["submission"] = remapped
    return State.from_json(result.to_json()).to_json()
