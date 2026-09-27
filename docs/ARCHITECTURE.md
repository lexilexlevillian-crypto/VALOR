# System 01 architecture

## Current storage implementation

The official `@libsql/client` adapter now serves remote Turso in production and local SQLite in development. Store operations and every database caller are asynchronous. Write transactions use libSQL's write mode (BEGIN IMMEDIATE semantics); an AsyncLocalStorage transaction context and per-Store queue prevent overlapping requests from sharing a transaction. Nested operations reuse the transaction, and the callback must settle before commit. Errors roll back state, receipts, audits and saves together. State loads use read snapshots; persistence batches existing SQL statements to limit network round trips. Schema migrations 001–004 are unchanged and awaited before listening. No local replica, disk-backed production fallback, or client-side token is used.

Turso credentials grant server-side database access; protect them like account data. The original foundation discussion below is historical where it describes OS-only storage boundaries or systems implemented later.

## Authority

The client supplies authenticated intent, an idempotency key, and expected revision. Server schemas reject unknown properties, including client actor IDs, seeds, outcomes and clocks. Actor identity comes from a database-backed session. All domain writes authorize the actor and scope inside BEGIN IMMEDIATE, validate the command, update projections, append a versioned event and audit entry, queue an outbox notification, and save the response receipt before committing.

A thrown error rolls back every part of the mutation. Competing writes must present the current aggregate revision; a stale command receives 409. Retrying the same key and normalized command returns the saved result, without another event or random seed. Changing the command while reusing a key returns 409. Current permissions are checked even on replay. There are no AI endpoints or direct client database writes.

## Durable model

| Table | Purpose |
| --- | --- |
| users, sessions | Operator-provisioned accounts; hashed passwords and opaque session tokens |
| worlds | Owned, reusable Creator content libraries |
| campaigns, memberships | Independently authorized campaign state and roles |
| records | Stable UUID entities belonging to exactly one world or campaign |
| sections, fields, field_values | Stable custom structure, type-checked values, order, revision and visibility |
| visibility_grants | Explicit user access to knowledge-gated records |
| domain_events | Immutable, versioned change history and random seed provenance |
| audit_log | Immutable privileged mutation and authentication history |
| command_receipts | Durable idempotency and exact response correlation |
| outbox | Transactional internal notification delivery |
| rate_limits | Durable, keyed-hash abuse buckets |
| schema_migrations | Forward migration versions and checksum verification |

All content is created through validated commands, never baked into a city seed or source file. Test fixtures use synthetic labels only. No neighborhoods, gangs, families, agencies, legal rules or story are invented.

World and campaign records share structural primitives but are isolated by mutually exclusive foreign-key scope columns. Instantiation requires access to the source world and exact source revision. It copies active sections/fields/values into new stable instance IDs and records source_record_id/source_revision. Later source edits never change an existing instance. Original source revisions are reconstructible from immutable full aggregate snapshots. Editing a name or order keeps that record's field/section identity and values intact.

History-bearing content is soft archived; queries omit it, but data and prior events remain. Archiving a section also hides its descendants without deleting their values. Parent sections are immutable links in this foundation; changing the nesting structure is deferred to Creator UI work. Field types cannot be changed silently after values exist. Full aggregate snapshots favor correctness in this initial foundation; compact projections and storage quotas will need profiling as authored collections grow.

## Permissions and views

World libraries are owner-only. Campaign roles are independently granted by the campaign owner. Only that owner changes memberships, and their own membership cannot be removed or downgraded. Removing a membership also removes its record grants.

| Role | Campaign mutations | Reads |
| --- | --- | --- |
| Creator/admin member | Yes, validated commands | Complete campaign records and privileged history |
| Player member | No foundation authoring mutations | Campaign-visible, own, or explicitly granted records/fields |
| Observer member | No | Own or explicitly granted records/fields; no default campaign-wide access |
| Nonmember, including global admin | No | None |

Visibility applies at record, section, ancestor section, and field levels. A visible field inside a hidden parent does not leak. An explicit grant opens knowledge-visible content only; it does not open Creator secrets. API projections enumerate allowed properties instead of returning database rows wholesale. Event snapshots, seeds and audit history are privileged and never become a player stream.

System 01 visibility grants are **access controls**, not proof that a character knows a fact. World Truth, Character Knowledge, Beliefs and Memories require four separate queryable models in System 04. These grants must not be repurposed into a single omniscient knowledge store. Future narration must use an observer-specific projection, not the privileged event APIs.

## Event and simulation contract

Commands are a TypeScript discriminated union with runtime validation. Every event has schemaVersion=1, aggregate ID/revision, actor, command type, validated payload, server timestamp, a server-generated 256-bit seed and RNG version. The randomSource contract uses HMAC-SHA256 with a counter and rejection sampling for integer draws. It accepts no client seed. Mechanics, dice math and simulated time advancement are deliberately absent.

Audit/event history is paged in insertion order, independently of random UUID order. Receipts persist across process restarts. Events, receipts and audits reject UPDATE/DELETE through database triggers. This protects application-level history, not against a database administrator who can alter the schema.

Internal notification hooks receive full privileged events. They are trusted server worker code, never user-provided URLs or browser subscriptions. Dispatch is at least once: mark delivered only after success; on a crash, retry with the same event ID. Consumers must deduplicate that ID and construct permitted projections before notifying users. Multiworker leasing and external queues are deferred.

## Security boundaries

Scrypt passwords use unique random salts, N=65536/r=8/p=1 and 64-byte derived keys. Sessions are random 256-bit tokens, only SHA-256 token hashes persist, and database expiry is authoritative (12-hour absolute lifetime). Logout deletes the session and audits the action. Account archival immediately invalidates its sessions.

Production cookies are __Host- prefixed, HttpOnly, Secure, host-only and SameSite=Strict. Every unsafe request requires the exact configured Origin. Authenticated mutations additionally require a session-bound CSRF header. There is no permissive CORS. Session details and all responses use no-store.

Requests are size- and time-bounded. Authentication has per-account and per-IP limits, independent of forwarded IP claims. Rate buckets persist with a keyed hash; logs never store their raw identifiers. Proxy headers are not trusted. Failed logins do the same KDF work for unknown accounts and return a uniform error.

SQL is parameterized. The only dynamic SQL identifiers are fixed internal choices between world_id and campaign_id. Structured request logs allow only server-generated request ID, method, route template and status. Error responses omit SQL, payloads, stacks and secret values. Secret-key redaction is an additional layer, verified by tests.

SQLite has no per-table database roles. Least privilege therefore means a dedicated OS service account, restrictive database/backup directory permissions, protected disk and operator-only CLI access. It is not a security boundary against code already running as that account.

## Deliberately undecided

Campaign starting date/time and timezone are explicit inputs; 2012 is the target setting, not hardcoded canon. No game resolution math, jurisdiction, economy, content rating, mature-content policy, character facts, consent model or narrative rules are invented here. Those systems must expose their own validated configuration when implemented.

Public signup, email verification/recovery, MFA, invitations, account lifecycle UI, field-level grants for individual facts, cross-owner world sharing, encrypted backups/key custody, production retention/monitoring and scaling remain explicit future decisions. Password/session resets can presently be performed only by a trusted operator; no unsafe unauthenticated recovery API is provided.
# Integrated game extension

The System 01 architecture below is retained as the foundation record. The current game extension adds timelines and composite timeline/entity keys, separate truth/knowledge/belief/memory tables, immutable game events/receipts/saves, story turns and archived Chronicle lineage. `src/game/engine.ts` owns atomic state/event/prose/autosave writes; `actions.ts` and `simulation.ts` resolve gameplay; `epistemics.ts` projects authorized observations before retrieval or narration. `ai.ts` accepts only source-ID ordering, never state patches or model prose. `public/` is a server-backed responsive PWA with no client authority. See GAME_API.md and IMPLEMENTATION_STATUS.md for the implemented contracts and remaining limits.

### System 01 artifact schema registry

Every durable world/campaign artifact is represented in artifact_schema_versions. Migration 008 backfills existing authored records, campaign timelines, entities (including media references), epistemic rows, events, saves, templates and related history. Database insert triggers register future artifacts atomically. The registry records schema version metadata only; canonical state remains in its domain table. Future transformative migrations must backfill the new version transactionally and retain a compatibility reader. Rollback is performed by restoring a validated backup and replaying forward migrations, never by destructive down-migration.


## System 03: campaign configuration and canon boundaries

Campaign policy is persisted in campaign_configurations as validated defaults plus explicit overrides. Timeline settings remain simulation state; they are initialized from the resolved campaign configuration and do not replace campaign policy. World canon uses reusable records plus canon_records metadata, normalized links, immutable canon revision snapshots, and explicit campaign_canon_bindings. Each timeline copies its campaign binding at creation/branch/import, and each committed game event records the bound revision in event_canon_bindings. Revisions are never inferred from named cities or other setting labels, so multiple campaigns may use conflicting authored worlds without engine changes.
