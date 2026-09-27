# SYSTEM 06 — Main Menu, Roster, New Game, and Character Starts

Status: implemented and tested. Work stops at System 06 pending approval for System 07.

## Goal

VALOR now has a server-backed entry flow before play: campaign selection, Continue, New Game, playable-character roster, Developer/Creator access, settings, and Save / Load remain distinct entry surfaces. A start is an authoritative state transition, not a client-side preset.

## Files and modules

Added:

- migrations/013_system06_entry.sql
- tests/system06-entry.test.ts
- docs/SYSTEM_06_REPORT.md

Changed:

- src/game/engine.ts
- src/game/routes.ts
- src/app.ts
- public/app.js
- migration-count assertions in tests/foundation.test.ts, tests/libsql.test.ts, and tests/turso.test.ts

## Data and migration

Migration 013 adds campaign_start_packages with:

- stable UUID, campaign ownership, slug, name, description, kind, visibility, and draft/published/archived status;
- versioned JSON definition, revision, creator, timestamps, archive state, and a unique campaign/slug constraint;
- visibility/status index;
- delete protection so packages are archived rather than physically deleted.

No existing rows require a backfill. Existing databases migrate additively from 12 to 13 migrations. Package definitions are validated before persistence and again before use. A failed start rolls back the entity projection, event, receipt, outbox, autosave, and audit transaction together.

## Start-definition contract

A start definition contains:

- a character name, description, and validated partial character data;
- source entity IDs for authored possessions, vehicles, phones, quests, housing, or relationships;
- explicit relationship templates with directional values;
- faction reputation entries;
- plot-hook source IDs.

When applied, the server creates a new playable character controlled by the requesting account, clones only permitted source types, remaps ownership and character/quest/housing references, creates directional relationships, applies authored faction reputation, validates the complete state, and records a start.character game event with a server-generated random seed.

Character data can carry authored attributes, skills, traits, identity, appearance, background, cash/bank values, location, home, schedules, goals, and other fields already supported by the System 01–05 domain model. A phone, vehicle, clothing item, weapon, or other possession remains a distinct object instance.

## API and state contracts

- GET /continue
  - returns the latest committed campaign/timeline and the caller-controlled playable character, or null;
  - derives recency from immutable game events and timeline creation, not browser storage.
- GET /game/timelines/:id/start-packages
  - Players receive only published campaign-visible package summaries;
  - authorized Creator/Admin receives authorized package definitions for the Developer surface.
- POST /game/timelines/:id/start-packages
  - Creator/Admin only;
  - validates package metadata, slug, definition, references, and projected state before insertion.
- POST /game/timelines/:id/start
  - requires the current timeline revision and an idempotency key;
  - accepts exactly one package ID or one freeform definition;
  - published campaign packages may be selected by players;
  - freeform definitions are Creator/Admin-only;
  - a timeline may receive one canonical playable start through this command.

The command uses the existing revision lock, receipt, immutable game event, audit, outbox, and autosave path. The projected entities are authoritative; the UI only refreshes from roster/view APIs.

## Player Mode behavior

The main menu shows:

- Continue for the latest committed player life;
- campaign cards with Open campaign and New Game;
- empty campaign state;
- a large-roster-safe character selection screen;
- published authored starts only.

Players cannot see draft/Creator packages, package definitions, unassigned Developer characters, or freeform authoring controls. New Game refuses a second start on an already-started timeline and directs the player to a new timeline.

## Developer Mode behavior

Developer Mode adds:

- the New Game start catalog with package definitions;
- a freeform start authoring form for character name, description, starting location, and cash;
- publish-as-campaign-package and immediate-freeform-start actions;
- the existing Developer Studio and authorized diagnostics.

The UI label is an affordance only. Every package read/write and freeform start is role-checked on the server. Developer state is not used as Player Mode authority.

## Validation and security

- campaign membership and timeline access are checked before every read/write;
- package visibility and publication status are checked against the caller role;
- package slugs are campaign-unique and constrained;
- source grants are limited to item, vehicle, quest, housing, and relationship records;
- complete projected state is validated for references, trait rules, containment, and schema integrity;
- timeline revision and idempotency prevent stale or duplicate starts;
- event seeds are generated server-side and persisted for replay/audit;
- package deletion is blocked by an archive trigger;
- Player package responses omit definitions and Developer roster records;
- SQL is parameterized.

## Tests executed

Focused:

- node tests/run.ts tests/system06-entry.test.ts
  - 3 passed, 0 failed.

The focused suite covers package creation and filtering, transactional start projection, immutable event creation, Continue, invalid grants, freeform Creator-only boundaries, and a 120-record roster.

Also executed during implementation:

- npm run check
- git diff --check

Migration-count assertions were advanced to 13 and the existing regression groups remain compatible with the additive migration.

Browser note: node tests/browser.test.ts reached the final offline-shell and accessibility assertions; the process then reported the known Windows libSQL temp-directory cleanup EPERM in tests/cleanup.ts after browser shutdown. This is environmental and does not indicate a failed entry-flow assertion.

## Manual acceptance

1. Sign in as a Creator.
2. Open or initialize a campaign.
3. Switch to Developer Mode.
4. Open New Game.
5. Enter a freeform character and save a published start package.
6. Switch to Player Mode or sign in as a player in the campaign.
7. Open New Game and confirm only the published package summary appears.
8. Start it and confirm the roster and Chronicle show the created character.
9. Reload and confirm Continue returns to the same campaign/timeline/character.
10. Attempt to start again on that timeline and confirm the server rejects the duplicate canonical start.
11. Confirm a player cannot access Developer package definitions, freeform starts, or unassigned characters.

## Performance, accessibility, and cost

The entry flow uses bounded package definitions and a maximum of 100 source grants per package. The roster remains a server projection and handles large sets without client-owned authority; card rendering can still be paged in a later presentation pass if real campaigns exceed the current practical browser viewport.

Continue uses indexed campaign/timeline membership plus event recency. New Game uses ordinary labeled controls, touch-safe buttons, and the existing theme/accessibility system. Start creation is synchronous and bounded by state validation; it does not call an AI provider.

## Genuine undecided design question

The current start package is campaign-scoped and references source entities in the selected timeline. A future Creator workflow may add world-library start templates that are copied into a new timeline with explicit source-version bindings. That is intentionally not merged into System 06 because it changes reusable-world authoring semantics.