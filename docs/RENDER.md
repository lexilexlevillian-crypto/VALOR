# Deploying the supplied Render service

Target: [valor-uwgb.onrender.com](https://valor-uwgb.onrender.com). [Service dashboard](https://dashboard.render.com/web/srv-das0ah59fdbs73bbk7hg/deploys). Service ID: `srv-das0ah59fdbs73bbk7hg`.

Status on 2026-09-26: supplied by the owner, not authenticated/inspected by this implementation. The public health check timed out. This does not prove the service is broken; it does mean a successful deployment cannot be claimed. GitHub source publication and production deployment are separate gates.

## Inspect before changing

Confirm this existing service belongs to VALOR and record its current branch, deploy commit, environment variable names, instance count and disk mount. Do not expose secret values. If it already has game data, make a verified backup before changing branches or storage. Never create a replacement service or move an existing database without an explicit migration plan.

Expected settings for this build:

| Setting | Value |
| --- | --- |
| Type / runtime | Web Service / Node |
| Repository | lexilexlevillian-crypto/VALOR |
| Branch | full-game-implementation |
| Node | 24.21.0, pinned by .node-version |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check | `/healthz` |
| Instances | Exactly one |
| Persistent disk mount | `/var/data` if new; honor an existing validated mount |
| NODE_ENV | `production` |
| APP_ORIGIN | `https://valor-uwgb.onrender.com` |
| DATABASE_PATH | `/var/data/valor.sqlite` if using that mount |
| RATE_LIMIT_SECRET | Generate a fresh secret of at least 32 random characters in Render |

Do not hardcode PORT. HOST defaults correctly. Do not add a build/pre-deploy migration command: the app runs migrations at startup when its disk is attached. Render's separate build and pre-deploy compute cannot access that disk. See [deployment commands](https://render.com/docs/deploys).

Render persistent disks require a paid service and the default filesystem is ephemeral. Confirm the owner's billing choice before adding a disk or upgrading. Do not launch this SQLite build as a durable game on free ephemeral storage. See [persistent disk rules](https://render.com/docs/disks). A managed Postgres alternative needs a separate storage implementation/migration, not just a changed URL.

## First deployment and account

1. Verify GitHub CI for the exact implementation commit.
2. Confirm disk, one instance, environment and build/start settings above.
3. Take a backup first if the service has any existing VALOR database.
4. Deploy the selected branch, inspect startup/migration logs, then check `/healthz` and `/app` over HTTPS.
5. Use the authenticated Render shell to run `npm run user:create` with VALOR_BOOTSTRAP_EMAIL, VALOR_BOOTSTRAP_PASSWORD and VALOR_BOOTSTRAP_ROLE=creator set only for that operator process. Supply credentials privately; do not paste passwords into chat, commits or screenshots. Remove bootstrap environment variables after provisioning. There is no default account and the server never automatically consumes bootstrap passwords.
6. Sign in, author a location and playable character, perform a turn, save, then restart the same service and verify the records persist. This persistence rehearsal is mandatory before calling deployment complete.
7. Install the PWA on a real iPad and verify login, long prose, touch/keyboard controls and reconnect. Desktop Chromium emulation is not equivalent to physical Safari testing.

Keep automatic deployment disabled during the initial storage/recovery rehearsal. Only enable it after successful acceptance and an agreed backup policy. Follow [Render's environment configuration guide](https://render.com/docs/configure-environment-variables) for secret management.

## Rollback and maintenance

Back up with `npm run backup -- /var/data/backups/valor-UNIQUE-TIMESTAMP.sqlite`; choose a new filename every time. Copy verified backups to protected off-host storage. Never overwrite the live file as a rollback shortcut. Stop traffic and preserve the current database/WAL before selecting a restored copy. Roll back application code only to a version compatible with the applied schema; otherwise restore the verified pre-migration copy into a new path first.

Check health after deploy/restart, monitor errors and disk capacity, and rehearse restores regularly. No external monitor, retention schedule, off-host storage or paid resource was provisioned by this code change.
