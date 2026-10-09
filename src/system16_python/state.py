"""System 16 records. Only fields in the supplied architecture are persisted.

Times are integer simulation ticks; their unit and epoch belong to System 11.
Policy references are immutable, version-qualified strings. Structured fields
contain JSON, never executable predicates. Record-map keys are opaque references.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from hashlib import sha256
import json
from typing import Any, TypeAlias, TypedDict

JSON: TypeAlias = None | bool | int | float | str | list["JSON"] | dict[str, "JSON"]
Object: TypeAlias = dict[str, Any]


class Command(TypedDict):
    operation: str
    branch_id: str
    principal_id: str
    request_id: str
    arguments: Object


class Result(TypedDict):
    status: str
    data: Object
    failure_code: str | None


class ContractError(ValueError):
    def __init__(self, code: str, status: str = "FAILED") -> None:
        super().__init__(code)
        self.code, self.status = code, status


def require(condition: bool, code: str, status: str = "FAILED") -> None:
    if not condition:
        raise ContractError(code, status)


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def reference(kind: str, *parts: Any) -> str:
    return kind + ":" + sha256(canonical(parts).encode("utf-8")).hexdigest()


# s=string/opaque reference; i=nonnegative integer; t=integer time; b=boolean;
# a=JSON array; o=JSON object; j=JSON value; suffix ? permits explicit null.
_DEFINITIONS = {
    "communication_endpoint": "branch_id:s endpoint_id:s kind:s address:s binding_policy_ref:s revision:i",
    "endpoint_binding": "endpoint_id:s subscription_or_account_id:s valid_from:t valid_to:t? source_event_id:s",
    "communication": "branch_id:s message_id:s request_key:s submitted_actor:s apparent_author_account:s source_client:s payload_revision:s accepted_time:t adapter_version:s source_event_id:s",
    "recipient_delivery": "message_id:s recipient_binding:s state:s queued_time:t? delivered_time:t? expiry:t? revision:i",
    "client_copy": "id:s message_id_or_artifact:s client_store:s copy_state:s source_relation:s revision:i",
    "attention_event": "actor_id:s client_copy_id:s visible_scope:o attention_time:t acknowledgment_policy_ref:s",
    "feature_manifest": "feature_id:s version:s effective_from:t effective_to:t? region:s provider:s device_prerequisites:a os_prerequisites:a client_prerequisites:a account_prerequisites:a rollout_scope:o enabled:b source_classification:s source_refs:a",
    "channel_adapter": "adapter_id:s version:s channel:s feature_manifest_refs:a delivery_target:s routing_policy_ref:s accepted_binding_policy_ref:s retry_policy_ref:s queue_lifetime_policy_ref:s acknowledgment_policy_ref:s encoding_counting_policy_ref:s attachment_transcoding_policy_ref:s recipient_visibility_policy_ref:s fallback_policy_ref:s sync_policy_ref:s retention_policy_ref:s charge_policy_ref:s",
    "client": "client_id:s physical_device_id:s? profile_ref:s os_version:s? client_version:s supported_features:a store_ids:a session_ids:a notification_policy_ref:s display_clock_policy_ref:s",
    "subscription": "subscription_id:s provider_id:s number_or_sim_binding:s? service_state:s voice_eligible:b sms_eligible:b mms_eligible:b data_eligible:b plan_limits_ref:s accepted_charge_terms_ref:s",
    "account": "account_id:s service_id:s identity_associations:a authentication_ref:s role_memberships:a recovery_routes:a privacy_policy_ref:s",
    "session": "session_id:s account_id:s client_id:s scope:a valid_from:t valid_to:t? revocation_event_ref:s?",
    "logical_store": "store_id:s kind:s owner_ref:s access_policy_ref:s sync_policy_ref:s? retention_policy_ref:s restore_source_refs:a",
    "contact_entry": "entry_id:s store_id:s label:s endpoint_refs:a claimed_person_or_organization:s? source_event_ref:s confidence:j permission_claim:j? notes:s last_verified_time:t? revision:i",
    "draft": "draft_id:s client_store:s channel:s selected_recipients:a audience_ref:s? text:s attachment_refs:a revision:i state:s",
    "communication_authority": "authority_id:s principal_id:s kind:s approved_payload_revision:s approved_recipients:a approved_audience:s? channel:s account_or_session_ref:s device_or_endpoint_ref:s charge_cap:j? trigger_condition:o? expires_at:t? request_limit:i? uses_consumed:i",
    "submission": "branch_id:s principal_id:s request_id:s source_client_or_device:s account_or_session:s expected_revisions:o payload_revision:s addressed_endpoints:a audience_ref:s? authority_ref:s route_ref:s approved_fallback_ref:s? reservation_refs:a decision:s communication_ref:s? failure_code:s?",
    "payload_revision": "payload_id:s revision:i text_or_recording_ref:s attachment_refs:a reply_or_forward_source_refs:a email_envelope_recipients:a? email_display_headers:o? email_to:a? email_cc:a? email_bcc:a?",
    "sms_segment": "message_id:s segment_index:i segment_count:i encoding_policy_ref:s encoded_unit_count:i payload_fragment:s recipient_transport_state:s reassembly_state:s",
    "artifact": "artifact_id:s kind:s format:s size:i content_ref:s source_refs:a derivation_operation:o? capture_time:t? source_device_ref:s? coverage:o quality:o metadata:o access_policy_ref:s",
    "notification": "notification_id:s source_event_id:s recipient_ref:s client_id:s mode:s displayed_scope:o display_time:t? policy_ref:s",
    "acknowledgment": "transport_event_ref:s adapter_ref:s kind:s scope:o exposed_to:a exposed_time:t policy_ref:s",
    "typing_signal": "compose_session_ref:s audience:a started_at:t expires_at:t policy_ref:s",
    "call": "call_id:s origin_service_session_actor:o dialed_endpoint:s route_ref:s caller_id_claim:o state:s start_time:t answer_time:t? end_time:t? ring_timeout_event:s? actual_participants:a presented_identities:a hold_transfer_events:a missed_call_record_refs:a recording_refs:a",
    "voicemail_mailbox": "mailbox_id:s route_ref:s greeting_ref:s capacity_policy_ref:s retention_policy_ref:s access_policy_ref:s notification_policy_ref:s",
    "voicemail_recording": "recording_id:s mailbox_id:s call_id:s artifact_ref:s duration:i endpoint_attribution:o submission_time:t transcription_feature_ref:s?",
    "post": "post_id:s platform_ref:s author_account:s submitted_actor:s session_ref:s payload_revision:s published_time:t audience_policy_ref:s audience_evaluation:s protection_state:s reply_retweet_source_refs:a version:i access_or_deletion_state:s",
    "platform_connection_or_action": "record_id:s actor_account:s target_ref:s kind:s state:s source_event_ref:s effective_time:t",
    "contact_rule": "rule_id:s owner_ref:s target_ref:s kind:s service_account_device_scope:o effective_time:t policy_ref:s",
    "feed_retrieval": "retrieval_id:s actor_id:s client_id:s retrieved_time:t audience_policy_versions:a ranking_policy_ref:s selected_post_versions:a selection_reasons:a",
    "communication_profile": "actor_id:s preferred_channels:a checking_windows:j notification_settings_ref:s writing_style_ref:s interruption_tolerance:j privacy_habits_ref:s available_device_refs:a",
    "opportunity_and_reply_plan": "opportunity_id:s actor_id:s source_communication_ref:s eligible_window:o feasibility_input_refs:a decision_ref:s? decision_reason_tags:a known_information_refs:a outcome:s reply_plan_ref:s? plan_state:s submitted_communication_ref:s?",
    "evidence_export": "export_id:s source_refs:a acquiring_actor:s method:s acquired_time:t coverage:o authority_ref:s artifact_ref:s case_ref:s? physical_carrier_ref:s?",
    "scheduled_work": "event_id:s branch_id:s kind:s due_time:t stable_sequence:i causal_dependencies:a target_ref:s policy_version_ref:s completion_state:s",
}
SCHEMAS = {name: dict(item.split(":") for item in definition.split()) for name, definition in _DEFINITIONS.items()}
CANONICAL = tuple(list(SCHEMAS)[:6])
COMPANION = tuple(list(SCHEMAS)[6:])
ENUMS = {
    ("communication_endpoint", "kind"): "telephone_number email_address social_endpoint workplace_extension",
    ("feature_manifest", "source_classification"): "verified_historical fictional_service_policy labeled_approximation",
    ("channel_adapter", "channel"): "SMS MMS voice voicemail email app social",
    ("channel_adapter", "delivery_target"): "account_store device mailbox number",
    ("logical_store", "kind"): "device_local account mailbox directory paper_reference",
    ("draft", "state"): "active saved abandoned submitted",
    ("communication_authority", "kind"): "explicit_action bounded_mandate",
    ("submission", "decision"): "pending COMMIT ABORT",
    ("artifact", "kind"): "photo audio file screenshot export derivative",
    ("acknowledgment", "kind"): "acceptance delivery read",
    ("call", "state"): "pending_route ringing busy unavailable rejected_at_client answered redirected_to_voicemail ended",
    ("post", "audience_evaluation"): "publication retrieval each_access",
    ("platform_connection_or_action", "kind"): "friend_request friendship follow like comment tag favorite retweet invitation profile_claim",
    ("contact_rule", "kind"): "block mute ignore unfriend revoke_access",
    ("opportunity_and_reply_plan", "outcome"): "read partial_read postpone reply call_instead ignore decline seek_context",
    ("opportunity_and_reply_plan", "plan_state"): "planned postponed interrupted canceled submitted",
    ("scheduled_work", "kind"): "transport_retry queue_expiry client_sync ring_timeout typing_expiry attention_opportunity publication retention_expiry",
}


def validate_record(kind: str, record: Object) -> None:
    require(kind in SCHEMAS and type(record) is dict, "INVALID_RECORD")
    require(record.keys() == SCHEMAS[kind].keys(), "INVALID_RECORD_FIELDS")
    canonical(record)
    for name, token in SCHEMAS[kind].items():
        value = record[name]
        if value is None and token.endswith("?"):
            continue
        token = token.rstrip("?")
        valid = {
            "s": lambda: type(value) is str,
            "i": lambda: type(value) is int and value >= 0,
            "t": lambda: type(value) is int,
            "b": lambda: type(value) is bool,
            "a": lambda: type(value) is list,
            "o": lambda: type(value) is dict,
            "j": lambda: value is not None,
        }[token]()
        require(valid, "INVALID_RECORD_TYPE")
        if (kind, name) in ENUMS:
            require(value in ENUMS[kind, name].split(), "INVALID_RECORD_ENUM")
        if token == "a" and name not in {"presented_identities", "selection_reasons"}:
            require(all(type(item) is str for item in value), "INVALID_RECORD_TYPE")
    for start, end in (("valid_from", "valid_to"), ("effective_from", "effective_to"), ("started_at", "expires_at"), ("start_time", "end_time")):
        if start in record and end in record and record[end] is not None:
            require(record[end] >= record[start], "INVALID_INTERVAL")
    if kind == "submission":
        require(all(type(key) is str and type(value) is int and value >= 0 for key, value in record["expected_revisions"].items()), "INVALID_RECORD_TYPE")


@dataclass(slots=True)
class State:
    domain: str = "phone_communication_2012_social_media"
    canonical_records: Object = field(default_factory=lambda: {key: {} for key in CANONICAL})
    companion_records: Object = field(default_factory=lambda: {key: {} for key in COMPANION})

    def table(self, kind: str) -> Object:
        return (self.canonical_records if kind in CANONICAL else self.companion_records)[kind]

    def get(self, kind: str, key: str) -> Object:
        require(key in self.table(kind), "PRIVACY_DENIED")
        return self.table(kind)[key]

    def put(self, kind: str, key: str, record: Object, *, replace: bool = False) -> None:
        validate_record(kind, record)
        old = self.table(kind).get(key)
        require(old is None or replace or old == record, "RECORD_CONFLICT")
        if replace and kind in {"communication", "payload_revision", "endpoint_binding"}:
            require(old is None or old == record, "IMMUTABLE_RECORD")
        self.table(kind)[key] = deepcopy(record)

    def to_json(self) -> Object:
        return deepcopy({"domain": self.domain, "canonical_records": self.canonical_records, "companion_records": self.companion_records})

    @classmethod
    def from_json(cls, value: Object) -> "State":
        require(set(value) == {"domain", "canonical_records", "companion_records"}, "INVALID_STATE_FIELDS")
        require(value["domain"] == "phone_communication_2012_social_media", "INVALID_DOMAIN")
        state = cls(**deepcopy(value))
        require(set(state.canonical_records) == set(CANONICAL), "INVALID_STATE_FIELDS")
        require(set(state.companion_records) == set(COMPANION), "INVALID_STATE_FIELDS")
        branches = set()
        for kind in SCHEMAS:
            require(type(state.table(kind)) is dict, "INVALID_STATE_FIELDS")
            for key, record in state.table(kind).items():
                require(type(key) is str and bool(key), "INVALID_RECORD_KEY")
                validate_record(kind, record)
                if "branch_id" in record:
                    branches.add(record["branch_id"])
        require(len(branches) <= 1, "BRANCH_MISMATCH")
        for kind, fields in {
            "submission": ("branch_id", "principal_id", "request_id"),
            "communication": ("message_id",),
            "recipient_delivery": ("message_id", "recipient_binding"),
            "notification": ("source_event_id", "recipient_ref", "client_id"),
            "acknowledgment": ("transport_event_ref", "adapter_ref"),
        }.items():
            keys = [canonical([r[x] for x in fields]) for r in state.table(kind).values()]
            require(len(keys) == len(set(keys)), "UNIQUENESS_VIOLATION")
        sends = [canonical([row["branch_id"], row["submitted_actor"], row["request_key"]]) for row in state.table("communication").values()]
        require(len(sends) == len(set(sends)), "UNIQUENESS_VIOLATION")
        return state
