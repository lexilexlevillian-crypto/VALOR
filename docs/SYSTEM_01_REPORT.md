# System 01 implementation report

Status: System 01 implemented; Systems 02-18 have not been started.

Publication: local branch system-01-foundation. The GitHub remote is configured and repository access is verified, but no source has been pushed. Automatic approval review blocked publication because the destination is public and the staged payload includes the complete supplied brief and operational/security documentation. Publication of that exact payload needs user confirmation. CI has not run remotely.

## Delivered

- Typed Node/Fastify API and strict runtime schemas.
- Database-backed accounts, sessions, owned world libraries, campaigns and memberships.
- Separate Creator definitions and independent campaign instances with source revision provenance.
- Stable record/section/field IDs, persisted typed values, explicit visibility, revisions and soft archive.
- Two checked, transactional forward migrations, foreign keys and query indexes.
- Authenticated authorization on scoped queries/mutations; filtered player/observer projections.
- Scrypt password hashing, opaque hashed sessions, production secure cookies, CSRF and Origin checks.
- Durable keyed rate limits, request size/time limits, parameterized queries and redacted structured logs.
- Immutable event/audit/receipt history, optimistic concurrency, idempotency, atomic outbox and versioned deterministic RNG support.
- Operator-only account provisioning, online verified backup and documented recovery.
- Foundation CI and API/architecture/operations documentation.

## Migration and authority status

Migrations 001 and 002 pass fresh installation and populated forward migration. Authored values survive renaming/reordering, migration and a fresh Node process. Database history cannot be updated/deleted by ordinary application operations.

The server is authoritative. No client or AI-supplied actor, seed, clock or arbitrary state update is accepted. All tested writes commit projection, event, audit, receipt and outbox together or roll back together.

## Verification

Run npm run check and npm test. The suite covers fresh/forward migrations, process restart, tenant and global-admin isolation, hidden fields and ancestors, observer grants, source/instance independence, idempotency and revoked access, concurrent HTTP writes, forced rollback, immutable history, foreign keys, field types, archive preservation, backup recovery, deterministic RNG and outbox retry, authentication/session expiry/logout, secure cookies, CSRF/origin rejection, input and size validation, SQL injection handling, durable rate limits, log redaction, and a real HTTP listener.

Verified on Windows with Node 24.21.0:

- npm run check: passed.
- npm test: 18 passed, 0 failed; includes a real HTTP listener and fresh-process database read.
- npm run migrate: passed; 001 and 002 applied to the workspace database.
- npm install / lockfile synchronization: succeeded and reported zero vulnerabilities.
- Standalone npm audit: attempted twice after verification; the registry advisory endpoint reset the connection (ECONNRESET). A fresh final audit is therefore unverified.

CI must independently pass on Linux after publication. No production load, penetration, device accessibility or full-game acceptance claim is made by these foundation checks.

## Deferred decisions

SQLite is a single-instance foundation. Production hosting/durable storage and any migration to PostgreSQL require a deliberate deployment decision. No Render deployment or paid resources have been provisioned.

Player-visible epistemic models are deferred to System 04; foundation visibility grants are not character knowledge. Gameplay math, canon, content policies and jurisdiction are not invented. Public account signup/recovery, MFA/invitations, account lifecycle UI, backup scheduling/retention/key custody, proxy trust, scalable notification workers and production monitoring await their own authorized scope.

This System 01 pass stops here pending approval. System 02 remains the next numbered system only after an explicit user request.

## Completion pass: artifact schema metadata

Migration 008 adds the artifact_schema_versions registry and insert triggers. Existing durable world/campaign records are backfilled with schema version 1; future records, timelines, entities, media references, epistemic rows, events, saves, templates and related history register atomically. The registry is metadata only and never replaces canonical domain state. Focused tests cover additive migration, restart/backup recovery, and transaction rollback.
