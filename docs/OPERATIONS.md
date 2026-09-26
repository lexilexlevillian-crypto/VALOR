# Foundation operations

## Database and migrations

Local default: data/valor.sqlite, excluded from Git. Run npm run migrate before use; startup also verifies/applies migrations. All SQL migrations run transactionally with checksums. Never edit an applied migration. Add a forward-compatible migration for future changes. Startup refuses unknown schema versions and modified migration checksums.

001_foundation establishes the durable model, constraints and immutable history triggers. 002_query_indexes adds scoped query indexes without changing authored records. Tests migrate a populated 001 database forward to 002 and inspect it from a new Node process.

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

The automated backup test opens an independent restored database, verifies records and referential integrity, and confirms an existing backup cannot be overwritten. This is foundation recovery, not the later save/timeline/import system.

## Configuration and secrets

Production requires NODE_ENV=production, an HTTPS APP_ORIGIN with no path, absolute DATABASE_PATH on durable storage, and a random RATE_LIMIT_SECRET of at least 32 characters. HOST defaults to 0.0.0.0 in production; PORT honors the hosting environment. Never put secrets in source, prompts, logs, client bundles or Git.

The local API binds to 127.0.0.1. No TLS termination is implemented in Node; production must sit behind trusted HTTPS hosting. Forwarded IP headers are deliberately ignored. Behind a shared reverse proxy, per-IP rate limits may apply to all users of that proxy until its exact trust policy is configured and tested. Do not enable blanket proxy trust.

The session credential is the random cookie; there is no hardcoded JWT signing secret. Rotate RATE_LIMIT_SECRET through the secret store to rotate hashed rate-bucket identifiers. This resets the effective rate buckets; session hashes remain valid. Provision account passwords through environment variables available only to the operator process, then clear them. No email/reset provider is assumed.

Node uses restrictive umask for server/operator processes. Unix database files and backups are chmod 0600 and newly created directories 0700; Windows ACLs are an operator responsibility. Run as a dedicated non-root account with access only to the required data/backup directories.

## Render boundary

Use a **Web Service**, never Static Site, for this foundation. Expected runtime: Node 24.21.x, npm ci for install, npm start for launch, /healthz for health. SQLite needs a persistent disk and one service instance; ephemeral storage loses the game database on replacement. Do not run multiple replicas or multiple machines against this database. Moving to PostgreSQL would require an explicit migration and concurrency review.

No Render blueprint is applied, no paid disk/service is selected, and no deployment URL is claimed. The selected Render service URL, type, account access and storage have not been inspected. The implementation branch intentionally avoids publishing to main. Full release/deployment work belongs to System 18 after the preceding systems pass.

## Logs and failure handling

Request logs include generated request ID, method, route template and status. Never log raw requests, full URLs, command payloads, query strings, narration context or hidden fields. Authentication and privileged changes also have database audit records. A 500 gives the user only a correlation ID and generic error. Backups and migrations fail rather than pretending success.

SIGINT/SIGTERM stop accepting traffic, close the HTTP server, then close SQLite. Host/process failure rolls back uncommitted transactions. Outbox delivery retries until successful; consumers must deduplicate event IDs. There is no public event subscription endpoint.

## Work still outside System 01

Creator/client screens, turn processing, AI providers, character knowledge/belief/memory, simulation mechanics, jobs/economy, police/law, combat, romance/consent, PWA/mobile installation, branchable saves and production release acceptance remain unimplemented. No placeholder page or test fixture should be mistaken for those systems.
