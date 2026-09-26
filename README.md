# VALOR

Persistent, server-authoritative foundation for a Creator-authored, grounded 2012 text RPG.

**Implemented: System 01 only.** There is no game UI, AI narrator, authored city canon, or mobile/PWA client yet. System 02 requires a separate instruction. The complete supplied brief is in [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md).

Database determines what exists. Simulation determines what happens. AI interprets, reasons, and narrates.

## Run locally

Requires Node **24.21.x** (see .node-version).

```sh
npm ci
npm run check
npm test
npm run migrate
npm start
```

The default API listens on http://localhost:3000. GET /healthz returns a database-backed health result. GET / explicitly reports that this foundation is not playable.

Optional: create .env from .env.example and customize the settings. Node loads it for start/dev/operator commands; environment variables take precedence. No credentials or database files belong in Git.

## Create the first Creator account

There is no public registration, default password, or first-login privilege escalation. Provision accounts using the local operator command. In PowerShell:

```powershell
$valorCredential = Get-Credential -Message 'VALOR account email and password (12-128 characters)'
$env:VALOR_BOOTSTRAP_EMAIL = $valorCredential.UserName
$env:VALOR_BOOTSTRAP_PASSWORD = $valorCredential.GetNetworkCredential().Password
$env:VALOR_BOOTSTRAP_ROLE = 'creator'
npm run user:create
Remove-Item Env:VALOR_BOOTSTRAP_PASSWORD
Remove-Variable valorCredential
```

Use role player for ordinary accounts; campaigns separately grant player/observer/creator/admin membership. A global admin account has **no automatic access to another user's world or campaign**.

See [API contract](docs/API.md) for authentication and commands, [architecture](docs/ARCHITECTURE.md) for authority and visibility, and [operations](docs/OPERATIONS.md) for migrations, backups and hosting constraints.

## Verification

```sh
npm run check
npm test
npm audit
```

The test suite uses temporary databases and synthetic test content. No test fixture seeds the actual game. GitHub Actions runs type checking and these tests on pushes and PRs.

## Hosting

This is a Node web service, not a static site. SQLite requires a persistent disk and a single application instance. A Render static site or ephemeral disk cannot host the authoritative state safely. No Render service, paid resource, or production deployment is created by this implementation. Release deployment is reserved for System 18 in the brief.

Next authorized implementation: System 02, client shell/Chronicle/navigation/PWA, after explicit instruction.
