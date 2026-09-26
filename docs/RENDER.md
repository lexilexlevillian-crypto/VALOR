# Deploying VALOR on free Render with Turso

Target: [valor-uwgb.onrender.com](https://valor-uwgb.onrender.com). [Service dashboard](https://dashboard.render.com/web/srv-das0ah59fdbs73bbk7hg/deploys). Service ID: `srv-das0ah59fdbs73bbk7hg`.

This build stores production data in external Turso/libSQL using the official `@libsql/client`. It does not require a Render disk. Publishing the branch is not proof of a successful live deployment.

## Existing service settings

Confirm the repository, branch and deploy commit before changing the service. Preserve and back up any existing game database before changing storage.

| Setting | Value |
| --- | --- |
| Type / runtime | Web Service / Node |
| Instance | Free, one instance |
| Repository | lexilexlevillian-crypto/VALOR |
| Branch | full-game-implementation |
| Node | 24.21.0, pinned by .node-version |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check | `/healthz` |
| Persistent disk | None required |
| NODE_ENV | `production` |
| APP_ORIGIN | `https://valor-uwgb.onrender.com` |
| TURSO_DATABASE_URL | Your external libSQL database URL; `libsql://...` or `https://...` |
| TURSO_AUTH_TOKEN | Your database's read/write token, entered privately |
| RATE_LIMIT_SECRET | A random secret of at least 32 characters |

Set secrets in the service's Environment tab; never commit them or paste them into chat. Follow [Render environment configuration](https://render.com/docs/configure-environment-variables). `DATABASE_PATH` is ignored when Turso is configured and may be removed. Do not hardcode PORT; HOST defaults to 0.0.0.0. Startup awaits all checksummed migrations before listening. A connection or migration failure prevents startup; it never silently writes to ephemeral SQLite.

Use the existing libSQL-compatible Turso database, not an unrelated database engine. See the [official libSQL client reference](https://docs.turso.tech/sdk/ts/reference).

## Existing data and operator commands

Changing environment variables does NOT copy an old SQLite database. If there is existing data, stop writes and make a verified backup first. On a trusted operator computer, privately set the destination Turso variables, HTTPS APP_ORIGIN, NODE_ENV and RATE_LIMIT_SECRET. Before the destination is initialized by the server, run:

```sh
npm ci
npm run db:import -- <verified-existing-database.sqlite>
```

Import only targets an EMPTY database and preserves all tables, accounts, hashes, saves, story, lore, rowids, constraints, indexes and immutable triggers. Never delete an existing Turso database to make the import pass. Use a separate empty destination and verify it before switching the service. Large databases require a separately rehearsed migration because copying holds a snapshot in memory and is subject to remote transaction limits.

For a new game, no import is needed. Startup creates the schema. Provision the first Creator from a trusted local computer using the README's private process-environment credential instructions and `npm run user:create`, with the SAME Turso configuration as Render. Public signup creates players only; it cannot create a Creator. No default account is added. Clear bootstrap credentials afterward.

Back up from that operator computer with `npm run backup -- ./backups/valor-UNIQUE.sqlite` and protect the result off-host. A backup inside Render's ephemeral filesystem is not durable. See [operations](OPERATIONS.md) for restore rehearsals.

## Optional Gemini narration

Keep your existing API key private in Render as `GEMINI_API_KEY` or `GOOGLE_API_KEY`. `GEMINI_MODEL` optionally selects a model; see [Gemini setup and limits](SYSTEMS_EXPANSION.md). Never copy the real key into source or chat. Both campaign and user AI budgets default to zero and must be deliberately configured in Settings before paid requests are allowed. Chronicle selects Gemini automatically when configured, with a grounded opt-out and failure fallback. The server currently accepts only ordering of approved fragments, not arbitrary generated prose.

## Deployment acceptance

1. Verify CI for the exact new Git commit and confirm Render tracks full-game-implementation.
2. Confirm both Turso variables and the security settings above without exposing their values.
3. Deploy that commit; inspect startup status and check /healthz and /app over HTTPS.
4. Sign in, author data, take a turn and save. Restart/redeploy the service and verify the same account, content and saves remain.
5. Check real iPad Safari/PWA behavior separately from automated Chromium tests.

Free Render services can sleep and have usage limits; local files are ephemeral, and free instances do not provide shell access. That is why account provisioning and backups run from a trusted computer connected to Turso. See [free-service limitations](https://render.com/docs/free). External database persistence does not guarantee unlimited free hosting or production-grade availability.

No live credentials, service settings, paid resources or live database contents were changed by this implementation. Live Turso connectivity and deployment/restart acceptance remain separate verification steps.
