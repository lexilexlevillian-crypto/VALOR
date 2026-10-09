"""Public JSON command vocabulary and configuration documentation.

All commands have exactly:
    operation: str, branch_id: str, principal_id: str, request_id: str,
    arguments: dict

Record schemas are exposed as state.SCHEMAS. A record reference is the key of its
record map. Payload references are reference('payload', draft_id, revision).
Policies are supplied only through MockDependencies fixtures:
    'configuration:policy:<ref>': {'version': '<ref>', ...explicit values...}

Feature, adapter and policy versions are immutable content-pack identifiers; ship
a new identifier for an edited policy. Tick units are supplied by System 11.

Authorization fixture for an exact PC command:
    'player:authorize:<request_id>': {
        'authorized': True, 'explicit': True,
        'command_digest': reference('command', command)
    }
For an NPC, system9:actor_kind:<actor> must report kind='NPC', and the separate
system5_6:authorize:<request_id> fixture supplies approved=True and the same digest.
No text parser, LLM, memory engine, relationship engine, balance engine, physical
simulation, or independent clock is implemented here.

Lifecycle:
    CreateDraft -> Authorize -> PrepareMessage -> persist -> CommitMessage
    Dispatch -> client synchronization -> AttendArtifact -> InspectCopy

The request journal uses the supplied submission entity for other mutations too.
In such records route_ref is 'command:<operation>:<status>' and payload_revision
is an opaque command digest, not a communication payload. All stored keys still
belong to the supplied State Variables. Retry request IDs are scoped to branch
and principal. A changed command needs a new request ID.

Neutral internal vocabulary (not sender-visible service guarantees):
    recipient_delivery.state: queued, partial, delivered, failed, expired, bounced
    client_copy.copy_state: available, partial, segment, deleted, expired
    scheduled_work.completion_state: pending, complete

Supported counter algorithms are codepoints, utf16, and explicit weighted tables,
with optional declared URL replacement/media units. These are implementation
policies, never unverified claims about proprietary 2012 counters.

Optional service behaviors are enabled by explicit policy and feature references.
No configured policy, feature, permission or owner response means no invented
success. The tests contain a complete fictional fixture pack and JSON examples.
"""

COMMANDS = {
    "Provision": "Trusted development fixture records; external development authorization required.",
    "LearnEndpoint": "Record a grounded external learning event without creating a contact.",
    "SaveContact": "Save known endpoint references to an accessible store.",
    "DeleteContact": "Delete only the selected address-book entry.",
    "SyncContacts": "Copy actual contacts through an enrolled sync/restore route.",
    "ReassignEndpoint": "Close an assignment prospectively and create its successor.",
    "CreateDraft": "Create/edit a revision; optional email headers, attachments and source refs.",
    "AbandonDraft": "Abandon an unsent draft with an expected revision.",
    "Authorize": "Persist exact communication_authority supplied by the player.",
    "PrepareMessage": "Validate exact draft/authority/adapter and reserve usage durably.",
    "PrepareFallback": "Explicit alternative route after a definitively failed original.",
    "CommitMessage": "Accept once and create pinned recipient deliveries.",
    "AbortSubmission": "Abort a pending request and release its reservations.",
    "Recover": "Reconcile durable COMMIT/ABORT decisions; no speculative resend.",
    "Dispatch": "Process only the due IDs supplied by the external clock fixture.",
    "AttendArtifact": "Record real content coverage and permitted acknowledgments.",
    "InspectCopy": "Reproject already-attended content through current access.",
    "InspectStatus": "Return exposed acknowledgments, never private queue/reader state.",
    "AvailableActions": "Filter client feature manifests by campaign eligibility.",
    "RecordExposure": "Record an externally grounded notification/preview perception.",
    "StartTyping": "Begin/refresh a supported transient composing signal.",
    "StopTyping": "End the caller's composing signal without sending.",
    "DownloadAttachment": "Create an actual local artifact copy after a successful transfer.",
    "PlaceCall": "Route an explicit call attempt without answering for its recipient.",
    "ResolveCallRoute": "Apply an externally supplied pending-route outcome.",
    "AnswerCall": "Connect the actual answering actor at an accessible endpoint.",
    "DeclineCall": "Decline only at the actual receiving endpoint.",
    "EndCall": "End a participant's current call.",
    "CallTurn": "Submit one authorized live turn; no transcript is created.",
    "HoldTransferCall": "Apply an eligible service action and actual participant result.",
    "RecordCall": "Create a separately authorized recording artifact.",
    "DepositVoicemail": "Deposit real audio in a connected mailbox with capacity.",
    "CaptureArtifact": "Create an artifact from actual scene/task-result coverage.",
    "DeriveArtifact": "Create a scoped derivative with operation and source lineage.",
    "SaveArtifact": "Copy an accessible artifact to an authorized local store.",
    "PublishPost": "Publish an immutable payload to its exact authorized audience.",
    "BrowseFeed": "Select eligible connected/discovery posts; attention is separate.",
    "PlatformAction": "Record a supported like/favorite/follow/friendship or linked post action.",
    "ChangeAudience": "Retain the previous audience version and apply a new policy.",
    "DeletePost": "Remove platform access while preserving independent exports/captures.",
    "ChangeContactRule": "Apply an explicitly scoped block/mute/privacy rule.",
    "RevokeSessions": "Apply externally authorized prospective session revocation.",
    "DeleteCopy": "Delete only the named local copy and its SMS segments.",
    "AcquireRecord": "Export only available authorized content with provenance.",
    "DecideOpportunity": "Persist an external NPC decision; never send its reply plan.",
    "UpdateReplyPlan": "Persist interruption/cancellation or link an actual submitted reply.",
    "RequestExternalAction": "Send a dummy repair/report/recovery/provisioning request.",
    "CollectExpiredContent": "Remove unretained bodies while preserving metadata references.",
}

POLICY_FIELDS = {
    "endpoint": ["version", "address_pattern"],
    "plan": ["version", "active_service_states"],
    "routing": ["version", "acceptance", "initial_delay", "recovery", "placements"],
    "voice_routing": ["ring_timeout", "ring_timeout_outcome", "record_missed_call"],
    "accepted_binding": ["version", "rule"],
    "retry": ["version", "interval", "store_forward"],
    "queue_lifetime": ["version", "ticks"],
    "acknowledgment": ["version", "acceptance", "delivery", "read", "read_scope", "preview_triggers_read"],
    "sms_encoding": ["version", "kind", "gsm7_basic", "gsm7_extension", "gsm7_single", "gsm7_multipart", "unicode_encoding", "unicode_single", "unicode_multipart"],
    "media": ["version", "max_attachments", "max_total_bytes", "formats"],
    "sync": ["version", "delay", "retry_interval"],
    "retention": ["version", "ticks", "scope", "client_delete", "export_allowed"],
    "charge": ["version", "per_unit", "terms_ref"],
    "notification": ["version", "enabled", "preview_scope", "mode"],
    "audience": ["version", "public", "members", "evaluation", "protection_state"],
    "feed": ["version", "algorithm", "limit"],
    "voicemail_capacity": ["version", "max_recordings", "max_duration"],
}
