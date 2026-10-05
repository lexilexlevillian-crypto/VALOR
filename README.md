# VALOR

Persistent, server-authoritative web game and installable PWA for a Creator-authored, grounded 2012 text RPG.

**Integrated alpha:** working client, Creator studio, deterministic game actions, NPC simulation, four-layer knowledge, relationships, items, health/combat, economy, investigations, Watchers, and branchable saves. This is not a claim that every advanced feature in all 18 systems is finished. See the exact [system coverage and limitations](docs/IMPLEMENTATION_STATUS.md). The complete supplied brief is in [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md).

Database determines what exists. Simulation determines what happens. AI interprets, reasons, and narrates.

The supplied [System 1 gameplay specification](docs/SYSTEM_01_CORE_SPEC.md) now has a [core turn integration report](docs/CORE_TURN_IMPLEMENTATION.md). It documents the new command endpoint, mode controls, clarification, compound actions, interruption behavior, physical interactions, persistent scenes, causal audit and acceptance evidence.

The supplied System 2 Behavior Bible is implemented in the [narrative and storytelling report](docs/SYSTEM_02_IMPLEMENTATION.md), including its 52-scenario acceptance matrix. Writing preferences are under Phone → Settings → Writing preferences; Game Mode adds Say / Sign / Write.

The latest [lifecycle systems guide](docs/LIFECYCLE_SYSTEMS.md) covers NPC route travel and fixed-step catch-up, production, quest branches, social consequences, dispatch, court/estate flows, private image assets, deduplicated saves, Creator diagnostics and confirmed AI action proposals.

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
3. Open a life and write in Chronicle's continuous, theme-colored story strip. Enter submits; Shift+Enter adds a line. Known roleplayed actions commit their validated mechanics automatically; ambiguous targets ask for clarification. A small phone button opens the 2012-style phone with character, inventory, health, journal, map, jobs, settings, and save apps. Combat appears in Chronicle only during an active encounter.
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

Optional DeepInfra narration uses the server-only `DEEPINFRA_API_KEY` (or `DEEPINFRA_TOKEN`) with `deepseek-ai/DeepSeek-V4-Pro` by default. Gemini remains supported. Set `AI_PROVIDER=deepinfra` to choose explicitly, and set nonzero campaign and user AI budgets in Settings to allow requests. Story submissions use the same observer filtering and campaign/user budgets as other AI requests. Provider failure retains the committed turn without rerolling. See [AI provider setup](docs/SYSTEMS_EXPANSION.md).

Chronicle submits through the revision-checked, idempotent turn command endpoint. Recognized actions and bounded sequences use the existing authoritative simulation. Ambiguous or unsupported input requests clarification without advancing time. Game Mode shows observer-safe suggestions; Story Mode keeps the freeform composer. Mode switches, inspection, and pending cancellation do not advance world time. The legacy parse/interpret APIs remain available for proposal-only clients.

Story narration uses source-anchored prose: the provider arranges committed source text using validated wording and tense changes, preserving player dialogue, without authority to grant items or change the world. A saved turn appears immediately; generation is asynchronous and may take several seconds. Story narration has a 12-second provider deadline and bounded validation retries, then retains the grounded result. Story tools can rebuild narration without rerolling mechanics.

New lives receive one-time everyday essentials: a wallet, clothes, a working phone when communications are enabled, and keys when a home exists. Authored equipment takes precedence. Pickups and other validated inventory actions persist before narration; prose alone never awards money, weapons, or arbitrary items. Dropping or consuming equipment does not respawn it.

Creator/admin Settings includes **Test DeepSeek connection**. The server also makes one small synthetic check of the selected provider after startup and logs `<provider>.startup_check` with status and latency, never credentials or player content. Set `AI_STARTUP_CHECK=off` to disable that check. Provider availability does not override zero or exhausted world/user budgets.

Narration failures show a safe failure code in the notice or Retry status. Render logs `ai.narration_fallback` with only the trace ID and code, never raw exception messages or story text. Diagnostics distinguish output-schema errors, provider/network errors, and narrative checks. Existing audit rows retain their original codes. Retry rewrites narration without repeating the saved action; no additional automatic attempts or budget increases are enabled by these diagnostics.

The shared narration schema lists the exact citable event UUIDs and matches the validator’s paragraph limits. Background labels such as `original-story-input` and `dossier` are not citations. Schema failures identify fixed structural fields (`source_ids`, `text`, `paragraphs`, `additions`, or `order`) without logging model values, unknown keys, or raw errors. Startup probes use the production provider completion path with synthetic background entries. Broad repeated narrative beats are advisory; duplicated passages and unsupported mechanics remain checked.


## Lives and phone apps

Load Life includes Delete life for your own private lives. Deletion is a recoverable archive of the whole life, including its timeline branches; Deleted lives offers Restore life. Shared authoring worlds and other users’ lives cannot be deleted through this control. Characters, checkpoints, and audit history are retained.

The summoned phone has dedicated app screens, including Weather, News, SMS conversations, Contacts, and a dialer. Contacts can be saved only after the character learns a phone number. Weather shows simulated or authored in-game conditions and forecasts; News shows observer-permitted notifications, not invented headlines. Phone Settings links to the current life’s settings without selecting the master world.

New playable characters can choose only the eight documented Union apartment neighborhoods: Langley, Court District, First Harbor, Chinatown, North Crowns, South Crowns, Sparrow Ward, and Low End. NPC authoring retains the wider geography; unchanged legacy player residences are preserved.

For the isolated three-viewport phone smoke test, run `node tests/phone-ui.browser.mjs`. The authenticated creation, phone navigation, and delete/restore tests are included in `npm test`.

### Descriptive stories and game updates

Narration rewrites only committed, observer-visible outcomes. It cannot add NPCs, locations, items, or lasting facts. Each new turn freezes its narration context so later discoveries cannot enter an older turn's regeneration. New canonical content is authored through the existing Creator/domain services.

Retry rewrites narration without rerolling mechanics or changing world state. Grounded summaries and notices appear in Game updates. Unrecognized prose asks for clarification instead of silently consuming a minute. See the core turn report for supported input and remaining domain-provider work.

### Island County climate and interactive phone map

Pacific-time lives default to deterministic seasonal Island County weather (`weatherSimulation: island-county`). The saved game clock drives conditions, temperature, wind, daylight and a three-hourly forecast. This is fictional simulation, not live weather or a historical 2012 weather reconstruction. Authored actual-weather entries override automatic weather; their temperature/wind remain unspecified. Choose “Only my authored weather” in friendly world settings to disable automatic conditions. Other timezones retain authored weather.

Climate reference: [Island County Surface Water](https://www.islandcountywa.gov/545/Surface-Water), including the Olympic rain shadow and regional rainfall differences. Map scale reference: [US Navy / NAS Whidbey Island](https://cnrnw.cnic.navy.mil/Installations/NAS-Whidbey-Island/About/Contact-Us/), approximately 60 km north–south in a straight line and 89 km along roads. These constrain the scale; Valor's supplied fictional map governs the neighborhood layout.

The phone map supports pins, destination selection, zoom/pan, route previews and an explicit Travel control. Interior/locked/private access still follows authored exits and engine authorization. Public neighborhood routes use land corridors and **provisional fictional** Holiday–Centennial (Eastend–Collision), Lee Way–Midland (Dockside–Prescott), and Gateway–Industrial (First Harbor–Southwest) bridges. Bridge anchors/corridors are maintained in `src/game/city-geography.ts`; explicit authored exits take precedence. They are not claims about real roads or bridges. The old automatically generated “Valor” city-container shortcuts are removed, without deleting any location.

Estimated defaults: walking 4.8 km/h; urban driving 32 km/h, or 20 km/h at 07–10 and 16–19 local time; longer trips in rain, snow, or driving fog. The displayed estimate is the same duration used by the travel action. Driving requires a usable vehicle and permission; transit/taxi require existing services. No routes cross water except the explicit fictional bridge edges. Map discovery remains observer-filtered. The public atlas is seeded for residential Pacific-time worlds at character assignment or the next committed turn.

Regression coverage: `tests/story-world.test.ts`, `tests/island-world.test.ts`, and `node tests/phone-ui.browser.mjs` (map controls and Chronicle log/Retry included).
