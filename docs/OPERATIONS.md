# VALOR operations

## Database and migrations

Local default: data/valor.sqlite, excluded from Git. Production uses external Turso via the official @libsql/client package. Run npm run migrate before use; startup also awaits verification/application of every migration before accepting requests. All SQL migrations run transactionally with checksums. Never edit an applied migration. Add a forward-compatible migration for future changes. Startup refuses unknown schema versions and modified migration checksums; connectivity/authentication failures never create a local fallback database. `/readyz` returns success only when the database is reachable and schema migration 050 is present; `/healthz` remains the liveness/dependency check.

001_foundation establishes the durable model, constraints and immutable history triggers. 002_query_indexes adds scoped query indexes. 003_game adds timelines, typed entities, epistemic tables, game events, saves, templates and AI usage. 004_chronicle_lineage preserves historical turns across branches/imports. 005_game_delivery adds a leased game-event outbox, committed atomically with mutations. Tests migrate a populated 001 database forward through all migrations and inspect it from a new Node process.

No destructive down-migration is shipped: losing user history is unacceptable. To roll back code, first prove it supports the existing schema; otherwise stop the service and restore a verified pre-migration backup into a new database path.

006_snapshot_chunks adds immutable compressed blocks reused by new saves; 007_intent_usage adds shared-budget AI proposal accounting. Existing inline saves are not changed. New save manifests require a build that understands storage version 2. Do not deploy older code and assume it can restore those manifests. Full backups include snapshot_chunks; game exports remain self-contained, including bounded image assets. No save deletion or garbage collection runs automatically. Migration 018 adds optional audit notes and immutable deletion reports; it is additive and does not hard-delete existing data. Migration 024 adds structured proposition, knowledge, belief, and memory metadata plus append-only lore/Story Card versions and retrieval indexes; deploy it with the System 14-capable build before accepting new epistemic fields. Migration 025 advances character profiles to schema version 4 for the additive NPC job-sheet fields and refreshes the character-version triggers while preserving authored JSON.

## Backups and restore

```sh
npm run backup -- ./backups/valor-before-change.sqlite
```

Run backup on a trusted operator computer with the intended database environment. A libSQL read transaction captures the complete schema and all rows (including rowids that determine history order), then copies them into a new local SQLite file in a transaction. Indexes and immutable-history triggers are restored after the data. The command checks integrity and foreign keys before reporting success and refuses existing destinations. This covers accounts, sessions, lore, story, saves, receipts and all other tables, not just game exports. Protect backups: they contain private canon, user information, password hashes and session hashes. A failed backup must not be used. The snapshot is held in memory; large databases need a separately rehearsed provider-level backup strategy.

A trusted operator should schedule this command and copy verified backups to access-controlled off-host storage. Scheduling, retention duration, encryption/key custody and the destination are deployment decisions; none has been silently provisioned.

Restore rehearsal:

1. Produce a verified backup at a new path.
2. Stop the application before switching the live database.
3. Preserve the current database and associated WAL files for investigation.
4. For local development, set DATABASE_PATH to the restored copy with both Turso variables unset. For production, provision a separate empty Turso/libSQL database, configure its credentials privately on the operator computer, and run `npm run db:import -- <verified-backup.sqlite>` BEFORE starting the server or running migrations on the destination. The import refuses nonempty destinations. Run migrations with the intended application version, then point the stopped service at that verified database.
5. Check /healthz and authenticated campaign/record access.
6. For a real security-incident restore, revoke restored sessions before accepting traffic.

The release rehearsal automates a new backup, opens it as an independent database, reapplies migration verification, runs integrity and foreign-key checks, and compares critical source/restored row counts:

```sh
npm run release:rehearse -- ./backups/valor-release-rehearsal.sqlite
```

The destination must not exist. Run this with writes stopped; a live source can legitimately change between count capture and backup. Keep the JSON result with release evidence. This command proves the application-level restore path, not the provider's off-host retention or disaster-recovery SLA.

The automated backup tests open independent restored databases, verify records and referential integrity, reject overwriting a backup, and compare a complete game export and Chronicle against the original. Game saves restore into new child timelines; they never overwrite the parent. Checksummed imports validate records and transcript references before creating a separate timeline.

## Configuration and secrets

Production requires NODE_ENV=production, an HTTPS APP_ORIGIN with no path (or Render's RENDER_EXTERNAL_URL), TURSO_DATABASE_URL (libsql:// or https://), TURSO_AUTH_TOKEN, and a random RATE_LIMIT_SECRET of at least 32 characters. Both Turso variables must be supplied together in any environment. URLs with embedded credentials, query parameters or non-root paths are rejected. DATABASE_PATH is ignored when Turso is configured; there is no absolute-path or persistent-disk requirement. HOST defaults to 0.0.0.0 in production; PORT honors the hosting environment. Never put secrets in source, prompts, logs, client bundles or Git.

The local API binds to 127.0.0.1. No TLS termination is implemented in Node; production must sit behind trusted HTTPS hosting. Forwarded IP headers are deliberately ignored. Behind a shared reverse proxy, per-IP rate limits may apply to all users of that proxy until its exact trust policy is configured and tested. Do not enable blanket proxy trust.

The session credential is the random cookie; there is no hardcoded JWT signing secret. Rotate RATE_LIMIT_SECRET through the secret store to rotate hashed rate-bucket identifiers. This resets the effective rate buckets; session hashes remain valid. `REQUEST_LIMIT`, `LOGIN_LIMIT`, `MUTATION_LIMIT`, `AI_CALL_LIMIT`, and `EXPORT_LIMIT` control independent one-minute buckets. `IMPORT_MAX_BYTES` and `EXPORT_MAX_BYTES` default to 8 MiB and are bounded at startup. When using a gateway, `AI_GATEWAY_URL` and an `AI_GATEWAY_SECRET` of at least 32 characters must be supplied together. Optional `DEVELOPER_ACCESS_KEY` must be a random 32-256 character server-only secret. Successful redemption grants persistent, audited Creator roles only to the authenticated account and its existing memberships; rotating or removing the key prevents future grants but does not revoke roles already granted. Provision account passwords through environment variables available only to the operator process, then clear them. No email/reset provider is assumed.

Node uses restrictive umask for server/operator processes. Unix database files and backups are chmod 0600 and newly created directories 0700; Windows ACLs are an operator responsibility. Run as a dedicated non-root account with access only to the required data/backup directories.

## Render boundary

Use a **Web Service**, never Static Site. Expected runtime: Node 24.21.x, npm ci --omit=dev for install, npm start for launch, /healthz for health. A free single-instance service can keep authoritative state in external Turso without a Render disk. Keep one application instance: narration concurrency guards are process-local and multi-instance operation needs a separate review. Local SQLite is for development, not Render's ephemeral filesystem.

The supplied service is https://valor-uwgb.onrender.com, ID srv-das0ah59fdbs73bbk7hg. This storage migration does not modify Render settings or access a live Turso database. Follow RENDER.md; the implementation lives on full-game-implementation, without overwriting main or the foundation branch. Deployment and live restart persistence still require verification.

## Logs and failure handling

Request logs include generated request ID, method, route template and status. Never log raw requests, full URLs, command payloads, query strings, narration context or hidden fields. Authentication and privileged changes also have database audit records. A 500 gives the user only a correlation ID and generic error. Backups and migrations fail rather than pretending success.

Archive remains the default content-removal policy. Record hard deletion is restricted to the owning Creator, an archived target, a fresh immutable dependency report with no blockers, and exact confirmation. It retains the audit/event tombstone and deletion report, so it is not a privacy-erasure workflow. Define legal holds, retention, account erasure, and backup purge procedures before treating permanent deletion as regulatory erasure.

SIGINT/SIGTERM stop accepting traffic, close the HTTP server, then close the libSQL client. Uncommitted transactions are rolled back; remote transaction expiry also fails closed. Outbox delivery retries until successful; consumers must deduplicate event IDs. There is no public event subscription endpoint.

## Release gates, metrics and rollback

Migration 044 adds durable Creator drafts/versions/templates, confirmation-bound Developer previews and immutable repair reports, plus bounded operational metric events. The authorized Developer operations view combines API error/latency events, turn and deterministic-simulation trace duration, AI requests/token estimates/failures, outbox depth, saves, snapshot storage, entity growth, and schema version. Request metric writes are best-effort and never make a successful game request fail. Migration/import failures are recorded when the metrics table is already available. Configure external alerts for availability, elevated API/AI/save failures, queue age/depth, storage growth and budget thresholds; VALOR does not silently provision an alert vendor.

Deployment sequence:

1. Stop writes or enter a maintenance window; record the current artifact and schema.
2. Run the full CI gates and `npm run release:rehearse -- <new path>` against the intended source.
3. Deploy to staging, run migrations, require `/healthz` and `/readyz`, then exercise the acceptance matrix in `SYSTEM32_RELEASE.md`.
4. Deploy the same immutable artifact to production, run forward migrations once, require readiness, and inspect errors, latency, queue depth and storage growth before reopening writes.
5. For code rollback, redeploy the prior artifact only if it understands schema 050. Otherwise keep the service stopped and restore the verified pre-release backup to a new database, validate it, then switch credentials. Never down-migrate or overwrite the live database in place.

The release owner must record backup path/checksum custody, artifact/commit, migration result, health/readiness evidence, acceptance result, monitoring baseline, and rollback decision. See [System 32 release report](SYSTEM32_RELEASE.md).

## Durable event worker

The committed game-event outbox can be drained by the authenticated webhook worker:

```sh
VALOR_EVENT_WEBHOOK_URL=https://trusted.example/events `
VALOR_EVENT_WEBHOOK_SECRET=<32-or-more-random-characters> `
VALOR_WORKER_ONCE=1 npm run worker
```

The worker sends one event per POST with `x-valor-event-id`; consumers must deduplicate that ID. It rejects URLs with credentials, query strings or fragments, requires HTTPS/HTTP explicitly, uses a bounded timeout, leases rows through the existing at-least-once delivery contract, and fails closed when configuration is absent. For a continuously running process omit `VALOR_WORKER_ONCE`; deployment still requires an operator-selected destination, secret, database credentials and external alerting policy.
## AI and storage governance

External AI requires either a server-only DeepInfra token (`DEEPINFRA_API_KEY` or `DEEPINFRA_TOKEN`), a Gemini key (`GEMINI_API_KEY` or `GOOGLE_API_KEY`), or a trusted `AI_GATEWAY_URL` and `AI_GATEWAY_SECRET`, plus nonzero campaign and per-user token budgets. DeepInfra defaults to `deepseek-ai/DeepSeek-V4-Pro`; use `AI_PROVIDER` to select the preferred provider when both direct providers are configured. Purpose-specific routes use the matching `DEEPINFRA_*_MODEL` or `GEMINI_*_MODEL` variables. Creator assistance stays disabled unless its provider-specific Creator model is explicitly set. Every call uses the mandatory System 11 request envelope and is recorded by trace ID in ai_requests with redacted provenance digests. Only observer-permitted fragments and a bounded, knowledge-filtered continuity brief leave the server. Users can choose grounded narration instead. Reservations conservatively cover possible attempts and are not refunded on failure; usage values are estimates, not vendor billing. Each attempt has a 12-second deadline, timeline concurrency exclusion and a circuit breaker. Each in-process gateway allows four active and 32 queued calls with a two-second queue wait. Credentials, raw prompts, and raw contexts must not be logged. Do not configure a provider or gateway you do not trust with story text. Real provider behavior has not been live-tested. See SYSTEM_11_REPORT.md for adapter, fallback, cache, and tool boundaries.

Every committed mutation creates an immutable autosave. New saves deduplicate and compress immutable entity/history blocks, while manifests retain their references and checksums. This reduces repeated storage without deleting history; manifests and growing state still consume storage. Monitor Turso storage, query/transfer limits and backup duration; no automatic history deletion, garbage collection or retention pruning is implemented. Monitor HTTP availability/error rates externally and keep backups off-host; no monitoring account, scheduler, billing or off-host destination has been provisioned.

AI interpretation is request-driven, not a background job. The legacy classifier accepts a bounded candidate ID or clarification. The core creative planner can propose up to eight schema-validated actions with exact input evidence and observer-permitted references; the player must confirm the persisted plan before mechanics execute. Both use the existing classification budgets and reservation table when checking campaign and user allowances. Failed requests remain reserved. Provider calls occur outside the world transaction, and receipt replay never invokes the planner again. Creator read-only diagnostics expose warning/storage/outbox counts; they do not provide arbitrary SQL or return credentials.

See CORE_SYSTEM_INTERFACES.md for the canonical 32-system mapping and CORE_TURN_IMPLEMENTATION.md for current core verification. IMPLEMENTATION_STATUS.md retains an older grouped status summary. Passing local tests does not certify production deployment or physical-device accessibility.

## Observer response timing

Observer GET/HEAD reads are held to at least 250 ms; command, legacy turn, parse and story-resolution responses are held to at least 500 ms. Include errors when measuring the public route classes. Monitor private server warnings named privacy.response_latency_overrun, including their route class and processing duration. Frequent overruns invalidate the bounded timing assumption and require profiling and capacity/budget calibration before privacy sign-off. Neither local tests nor minimum padding certify network-level timing indistinguishability. No external alert service is provisioned by this change.
