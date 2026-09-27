# System 01 completion report

Status: complete in migration 017 and the server command/projection layer.

## Schema

The normalized foundation remains split by authority and lifecycle:

- Accounts and access: `users`, `sessions`, `memberships`.
- Reusable Creator definitions: world-scoped `records`, `sections`, `fields`, canon records/revisions, and `creator_templates`.
- Campaign configuration and instances: `campaigns`, configurations, start packages, timelines, and campaign-scoped records.
- Runtime characters, objects, media references, and other instances: `game_entities`, with `kind`, stable UUID, revision, visibility, provenance/source ID, timestamps, and archive state. Characters, objects, and media share this instance envelope while retaining kind-specific strict schemas.
- History: immutable `domain_events`, `game_events`, `foundation_commands`, `foundation_events`, receipts, checks, saves, chronicle rows, and audit records.
- Relationships and epistemic state: referential `entity_links`, facts, character knowledge, beliefs, and memories.
- Schema metadata: `artifact_schema_versions` registers durable world/campaign artifacts; `schema_compatibility` states current/minimum versions and recovery policy.

Migration 017 adds immutable, versioned command and event envelopes for the required vocabulary:
`CreateCharacter`, `EditCharacter`, `StartCampaign`, `AdvanceWorldTime`, `MoveActor`, `TransferItem`, `AddContact`, `SendText`, `StartConversation`, `ResolveCheck`, `StartCombat`, `CreateEvidence`, `TriggerWatcher`, `CreateSave`, and `BranchTimeline`. Each maps one-to-one to its past-tense event.

Every accepted command stores its authenticated actor, scope, optional expected revision, idempotency key, canonical request hash, strict payload, and schema version. Exactly one immutable foundation event records the actual outcome, aggregate revision, source domain/game event, server-generated audit seed, RNG version, and schema version. The response receipt is committed in the same transaction.

## Authority boundaries

- Clients submit intent only. Actor identity comes from the authenticated session. Payload schemas reject unknown properties, client seeds, outcomes, clocks, and state patches.
- Existing domain/game methods remain the enforcement point for world ownership, campaign membership, Creator privileges, controlled-character authority, referential integrity, and optimistic revisions. The foundation command bus delegates to those checks inside the same transaction.
- Creator definitions are independent of campaign instances. Instantiation records source ID and source revision; later definition edits do not mutate running campaigns.
- Canonical state is stored in normalized tables. Immutable events explain what happened. Receipts provide idempotent replay. Outboxes are delivery state. None is replaced by browser state.
- Chronicle, roster, phone inbox, inventory, map, case file, and NPC profile are rebuilt server-side from the observer-filtered canonical state. Hidden Creator data never enters these read models, and projections are explicitly non-authoritative.

## Migration and recovery result

Migration 017 is forward-only and additive. It creates new tables/indexes/triggers, backfills missing artifact schema registrations, and installs insert triggers for future worlds, campaigns, memberships, start packages, character profile schemas, checks, game receipts/outbox rows, and foundation command artifacts.

Migration application is transactional and checksummed. A failed migration or command leaves no partial projection, command, event, receipt, audit, outbox, or artifact metadata. Rollback means restoring a verified pre-migration backup; immutable history is never rewritten backward. New incompatible shapes require a new schema version and an additive/transformative migration. Projections can always be rebuilt from canonical state.

Verified acceptance coverage includes:

- fresh install, populated forward migration, checksum enforcement, and process restart;
- backup to an independently opened database and recovery with migration re-check;
- forced transaction rollback with unchanged canonical and schema metadata;
- strict command payloads, authorization failure rollback, optimistic revision conflict, and idempotent replay;
- immutable command/event/receipt rows and deterministic seed linkage to the underlying game event;
- schema-version registration for command/event/receipt and later campaign artifacts;
- all seven observer-scoped projections, including rejection of client-owned authority.

Commands:

```sh
npm run check
npm test
npm run migrate
```

## Open decisions

- SQLite/libSQL is the current single-writer transactional authority. Moving to PostgreSQL or a multi-writer event store is a deployment/scale decision, not required for System 01 correctness.
- Foundation schema version 1 is the only supported wire version today. Version 2 must define an explicit transformer and raise the compatibility minimum only after deployed readers are ready.
- Projections are rebuilt on request. Materialized server caches may be added after profiling; they must remain disposable and revision-keyed.
- Retention, backup scheduling, key custody, disaster-recovery objectives, and production monitoring remain operational deployment decisions.
