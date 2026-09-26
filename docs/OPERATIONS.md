# VALOR operations

## Database and migrations

Local default: data/valor.sqlite, excluded from Git. Run npm run migrate before use; startup also verifies/applies migrations. All SQL migrations run transactionally with checksums. Never edit an applied migration. Add a forward-compatible migration for future changes. Startup refuses unknown schema versions and modified migration checksums.

001_foundation establishes the durable model, constraints and immutable history triggers. 002_query_indexes adds scoped query indexes. 003_game adds timelines, typed entities, epistemic tables, game events, saves, templates and AI usage. 004_chronicle_lineage preserves historical turns across branches/imports. Tests migrate a populated 001 database forward through all migrations and inspect it from a new Node process.

No destructive down-migration is shipped: losing user history is unacceptable. To roll back code, first prove it supports the existing schema; otherwise stop the service and restore a verified pre-migration backup into a new database path.

## Backups and restore

```sh
npm run backup -- ./backups/valor-before-change.sqlite
```

The online SQLite backup API captures committed state consistently, including WAL-backed writes. A new destination is required. The command checks database integrity and foreign keys before reporting success. Protect backup directories as carefully as the live database: they include private canon, user information, password hashes and session hashes.

A trusted operator should schedule this command and copy verified backups to access-controlled off-host storage. Scheduling, retention duration, encryption/key custody and the destination are deployment decisions; none has been silently provisioned.

Restore rehearsal:

1. Produce a verified backup at a new path.
2. Stop the application before switching the live database.
3. Preserve the current database and associated WAL files for investigation.
4. Set DATABASE_PATH to the restored copy, run migrations with the intended application version, then start.
5. Check /healthz and authenticated campaign/record access.
6. For a real security-incident restore, revoke restored sessions before accepting traffic.

The automated backup tests open independent restored databases, verify records and referential integrity, reject overwriting a backup, and compare a complete game export and Chronicle against the original. Game saves restore into new child timelines; they never overwrite the parent. Checksummed imports validate records and transcript references before creating a separate timeline.

## Configuration and secrets

Production requires NODE_ENV=production, an HTTPS APP_ORIGIN with no path (or Render's RENDER_EXTERNAL_URL), absolute DATABASE_PATH on durable storage, and a random RATE_LIMIT_SECRET of at least 32 characters. HOST defaults to 0.0.0.0 in production; PORT honors the hosting environment. Never put secrets in source, prompts, logs, client bundles or Git.

The local API binds to 127.0.0.1. No TLS termination is implemented in Node; production must sit behind trusted HTTPS hosting. Forwarded IP headers are deliberately ignored. Behind a shared reverse proxy, per-IP rate limits may apply to all users of that proxy until its exact trust policy is configured and tested. Do not enable blanket proxy trust.

The session credential is the random cookie; there is no hardcoded JWT signing secret. Rotate RATE_LIMIT_SECRET through the secret store to rotate hashed rate-bucket identifiers. This resets the effective rate buckets; session hashes remain valid. Provision account passwords through environment variables available only to the operator process, then clear them. No email/reset provider is assumed.

Node uses restrictive umask for server/operator processes. Unix database files and backups are chmod 0600 and newly created directories 0700; Windows ACLs are an operator responsibility. Run as a dedicated non-root account with access only to the required data/backup directories.

## Render boundary

Use a **Web Service**, never Static Site, for this foundation. Expected runtime: Node 24.21.x, npm ci for install, npm start for launch, /healthz for health. SQLite needs a persistent disk and one service instance; ephemeral storage loses the game database on replacement. Do not run multiple replicas or multiple machines against this database. Moving to PostgreSQL would require an explicit migration and concurrency review.

The user supplied https://valor-uwgb.onrender.com and service srv-das0ah59fdbs73bbk7hg. Authenticated management access and persistent storage remain unverified; a public health request timed out. No Render blueprint is applied and no paid resource is provisioned. Follow RENDER.md; the implementation lives on full-game-implementation, without overwriting main or the foundation branch.

## Logs and failure handling

Request logs include generated request ID, method, route template and status. Never log raw requests, full URLs, command payloads, query strings, narration context or hidden fields. Authentication and privileged changes also have database audit records. A 500 gives the user only a correlation ID and generic error. Backups and migrations fail rather than pretending success.

SIGINT/SIGTERM stop accepting traffic, close the HTTP server, then close SQLite. Host/process failure rolls back uncommitted transactions. Outbox delivery retries until successful; consumers must deduplicate event IDs. There is no public event subscription endpoint.

## AI and storage governance

External AI requires operator-configured AI_GATEWAY_URL and AI_GATEWAY_SECRET plus nonzero campaign and per-user token budgets. Only observer-permitted fragments leave the server. Reservations conservatively cover both possible attempts and are not refunded on failure; usage values are estimates, not vendor billing. Each attempt has a 12-second deadline; two attempts maximum, timeline concurrency exclusion and a circuit breaker. Credentials and raw contexts must not be logged. Do not configure a gateway you do not trust with story text. Paid provider behavior has not been live-tested.

Every committed mutation creates an immutable autosave. Snapshots currently include full state and transcript, so long campaigns can grow quadratically. Monitor disk usage and backup duration; no automatic history deletion or retention pruning is implemented. Large production campaigns need snapshot compaction/retention design before general release. Monitor HTTP availability/error rates externally and keep backups off-host; no monitoring account, scheduler, billing or off-host destination has been provisioned.

See IMPLEMENTATION_STATUS.md for per-system coverage and remaining work. Passing local tests does not certify production deployment or physical-device accessibility.
