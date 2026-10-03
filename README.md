# VALOR

Persistent, server-authoritative web game and installable PWA for a Creator-authored, grounded 2012 text RPG.

**Integrated alpha:** working client, Creator studio, deterministic game actions, NPC simulation, four-layer knowledge, relationships, items, health/combat, economy, investigations, Watchers, and branchable saves. This is not a claim that every advanced feature in all 18 systems is finished. See the exact [system coverage and limitations](docs/IMPLEMENTATION_STATUS.md). The complete supplied brief is in [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md).

Database determines what exists. Simulation determines what happens. AI interprets, reasons, and narrates.

The latest [lifecycle systems guide](docs/LIFECYCLE_SYSTEMS.md) covers NPC route travel and fixed-step catch-up, production, quest branches, social consequences, dispatch, court/estate flows, private image assets, deduplicated saves, Creator diagnostics and confirmed Gemini action proposals.

## Run locally

Requires Node **24.21.x** (see .node-version).

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run migrate
npm run release:rehearse -- ./backups/valor-release-rehearsal.sqlite
npm start
```

Open http://localhost:3000/app after provisioning an account. Browser requests to / also open the client. GET /healthz returns a database-backed health result; GET /readyz additionally requires the current schema. JSON requests to / return release metadata.

Optional: create .env from .env.example and customize the settings. Node loads it for start/dev/operator commands; environment variables take precedence. No credentials or database files belong in Git.

## Create the first Creator account

Public signup creates player accounts only. There is no default password or first-login privilege escalation. Provision the first Creator using the local operator command. In PowerShell:

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

See [API contract](docs/API.md) and [game API](docs/GAME_API.md) for commands, [architecture](docs/ARCHITECTURE.md) for authority and visibility, and [operations](docs/OPERATIONS.md) for migrations, backups and hosting constraints.

## First game

1. Sign in, create a world and campaign, and open Creator.
2. Create a location, then a character with Playable enabled, your account as Controller, and that Location. Visibility defaults to Creator; set visible scene records to Campaign or Knowledge deliberately.
3. Open Chronicle, choose your character, and enter `look`, `wait 10`, `say ...`, or `go to [known location]`. The structured action panel exposes all supported actions; ambiguous prose never silently chooses an action.
4. Author NPCs, routes, objects, schedules, relationships and rules in Creator. Install the editable skill/trait catalog if wanted. No city canon or test fixture is seeded into your game.
5. Configure resolution rules in Settings before combat/checks/treatment. Needs, fuel, mature content and external AI budgets default off/zero.
6. Use Saves to create checkpoints, branch without overwriting a parent, export/import, and reuse world templates.

On iPad Safari, use Share → Add to Home Screen. The app is a PWA, not an App Store binary. Offline mode keeps the public shell available; authoritative game actions require the server. Sign-in and private state are never cached by the service worker.

## Verification

```sh
npm run check
npm test
npm run test:release
npm audit
```

The test suite uses temporary databases and synthetic test content. No test fixture seeds the actual game. GitHub Actions runs type checking and these tests on pushes and PRs.

## Hosting

This is a Node web service, not a static site. Production uses external Turso/libSQL through `@libsql/client`, so it can run on a free Render Web Service without a persistent disk. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, HTTPS `APP_ORIGIN`, and a `RATE_LIMIT_SECRET` of at least 32 characters privately in Render. Set a distinct random `PASSWORD_RECOVERY_KEY` to enable the login screen's recovery flow; a successful recovery is rate-limited and audited, replaces the password, and revokes every session. Production never falls back to a local file. Local development still uses `DATABASE_PATH` when Turso is unset. Follow the [Render deployment runbook](docs/RENDER.md); no paid resource is silently provisioned.

Optional Gemini narration uses the server-only `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) already configured in Render. Set nonzero campaign and user AI budgets in Settings to allow requests. With Gemini available, Chronicle selects it for automatic narration; choose `grounded` to opt out. Provider failure retains the committed turn without rerolling. See [new systems and Gemini setup](docs/SYSTEMS_EXPANSION.md).

Chronicle's **Ask Gemini to interpret** button is separate and explicit. It sends your typed command and permitted action choices, then presents a proposal for confirmation. It never takes a turn by itself, and it shares the same AI budgets as narration.

Gemini and the optional trusted gateway currently arrange approved simulation fragments; they cannot invent prose or alter game state. Grounded local narration works without any API key. Rich generative narration and several advanced simulation features remain explicitly tracked in the status report.
