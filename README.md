# VALOR

Persistent, server-authoritative web game and installable PWA for a Creator-authored, grounded 2012 text RPG.

**Integrated alpha:** working client, Creator studio, deterministic game actions, NPC simulation, four-layer knowledge, relationships, items, health/combat, economy, investigations, Watchers, and branchable saves. This is not a claim that every advanced feature in all 18 systems is finished. See the exact [system coverage and limitations](docs/IMPLEMENTATION_STATUS.md). The complete supplied brief is in [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md).

Database determines what exists. Simulation determines what happens. AI interprets, reasons, and narrates.

## Run locally

Requires Node **24.21.x** (see .node-version).

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run migrate
npm start
```

Open http://localhost:3000/app after provisioning an account. Browser requests to / also open the client. GET /healthz returns a database-backed health result. JSON requests to / return release metadata.

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
npm audit
```

The test suite uses temporary databases and synthetic test content. No test fixture seeds the actual game. GitHub Actions runs type checking and these tests on pushes and PRs.

## Hosting

This is a Node web service, not a static site. SQLite requires a persistent disk and a single application instance. A Render static site or ephemeral disk cannot host the authoritative state safely. Follow the [Render deployment runbook](docs/RENDER.md) for the supplied service. No paid resource is silently provisioned.

The optional AI gateway only arranges approved simulation fragments; it cannot invent prose or alter game state. Grounded local narration works without any API key. Rich generative narration and several advanced simulation features remain explicitly tracked in the status report.
