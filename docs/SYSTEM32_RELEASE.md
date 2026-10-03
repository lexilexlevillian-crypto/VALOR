# System 32 release report

Status: **release-candidate implementation; not production-certified**. The application has a durable content-production workflow and executable release/recovery gates. Live deployment, provider restore, physical iPad/Safari, VoiceOver, multi-day soak, and external security review remain operator acceptance work.

## Delivered production workflow

- Creator content is saved as non-canonical drafts with optimistic version checks. Validation reports schema errors, dependency/reference impact, warnings, a full Developer preview and an optional Player projection. Publication is explicit, confirmed, idempotent, audited and atomic for up to 100 interdependent records.
- Every draft, publish, archive and restore produces immutable version history. Restore creates a new draft version and does not rewrite the published entity or event history. Validated drafts can become reusable world templates and template use creates a new identity.
- Creation Studio exposes search, typed editors, duplicate/archive, impact references, safe atomic batches, draft status, publication review, history/restore and templates across all registered entity kinds. Existing profile-layout templates remain available for character dossiers.
- Authorized Developer tools are read-first: source-of-truth labels, raw state, Player projection, event/turn/simulation trace, AI prompt/schema version metadata, usage/error data and operations metrics. Deterministic fixtures and projection repair require expiring actor/revision-bound previews and exact confirmation. Repairs preserve the canonical state checksum and create immutable audit/report records.
- `/readyz` requires schema 44. CI performs type checks, the complete test suite, Chromium accessibility/responsive tests and a high-severity production-dependency audit. `release:rehearse` proves a new independently openable backup with migration, integrity, foreign-key and critical row-count checks.

## Acceptance evidence and exact tests

Run the authoritative local gates:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm audit --omit=dev --audit-level=high
npm run release:rehearse -- ./backups/valor-release-YYYYMMDD.sqlite
```

Focused System 32 coverage is `npm run test:release`:

- `Creator Studio drafts validate both perspectives, publish atomically, retain versions, and produce templates`
- `deterministic fixtures and projection repair require fresh exact previews and preserve source history`
- `read-first debug and operational views identify their sources and readiness requires schema 44`

The final acceptance is intentionally composed from stable domain tests rather than a brittle click-through monolith:

| Acceptance path | Test evidence |
| --- | --- |
| Create PC/NPC and safely edit Creator content | `System 07 persists one validated character architecture...`; System 32 Creator Studio test; `Creation Studio preserves exact ratings...` |
| Exchange numbers; send/receive texts | System 19 number, SMS, NPC-message and branch-persistence tests; `objects, ammunition and phones conserve state...` |
| Non-forced Chronicle turn and agency | `full game turn is atomic... ambiguous text preserves player agency`; System 10/13 narration and turn-pipeline suites |
| Advance time and observe offscreen NPC life | System 16 autonomy suite; `NPC work catch-up conserves funds...`; route-aware schedule tests |
| Crime, evidence and lax-but-nonzero consequences | System 27 law, System 28 investigation, witness/report/evidence tests and integrated acceptance |
| Item, vehicle and phone paths | Systems 19–22 suites and integrated game tests |
| Relationship, health and combat paths | Systems 17, 18, 23 and 24 suites |
| Timeline branch and parent preservation | System 31 long-history/autosave/import tests and integrated acceptance |
| Player/Developer mode boundary | System 05 mode tests, Developer diagnostics restrictions and System 32 authorization checks |
| Restart/migration/backup survival | foundation process-restart and backup tests, libSQL/Turso migration tests, System 31 upgraded saves and `release:rehearse` |
| Mobile/iPad, keyboard, contrast and screen-reader automation | `browser.test.ts`, `city-guide-ui.test.ts`, `creation-ui.test.ts`, axe checks and reduced-motion coverage |
| Load/soak bounds | `large authored roster and lore set remain bounded...` and large-roster UI/domain tests |

## Deployment and rollback plan

Use the exact sequence in `OPERATIONS.md`: freeze writes, capture a verified backup/rehearsal and immutable artifact ID, pass CI, migrate and validate staging, require both health endpoints, exercise the acceptance matrix, then promote the same artifact. Reopen production only after metrics establish a clean baseline.

Rollback never down-migrates and never overwrites the live database. Redeploy an older artifact only when it is schema-44 compatible. Otherwise keep writes stopped, restore the verified pre-release backup into a new destination, validate it, switch credentials, and retain the failed database for investigation.

## Operational signals

The Developer operations view identifies each source of truth and reports API errors/latency, turn latency, deterministic simulation duration, AI request/token estimates/failures, notification queue depth/age, save count/manifest bytes, shared snapshot bytes, entity growth and schema version. Metric persistence is best-effort; health and alerting must be external. Recommended initial alerts are sustained 5xx/error growth, readiness failure, queue age, repeated AI/save/migration failure, latency regression, budget exhaustion and abnormal storage growth.

## Known limitations and next priority

- No physical iPad/Safari/VoiceOver certification, multi-day soak, independent penetration/privacy review, live AI-provider billing validation, or real production rollback has been performed in this workspace.
- Alerts, off-host encrypted backup scheduling/retention, log aggregation and on-call ownership require operator-selected services. Metric rows currently have no automatic retention/pruning.
- Repair scope is deliberately narrow: it rebuilds derived projections only. There is no arbitrary SQL console or event-history rewrite.
- Draft templates cover entity records; campaign settings and media lifecycle retain their existing specialized workflows.
- Browser tests automate Chromium device sizes. Safari rendering, assistive-technology behavior and real network constraints still need physical-device sign-off.

Recommended next priority: run the release rehearsal and full acceptance matrix against a staging clone, then complete physical iPad/VoiceOver, multi-day soak, independent security/privacy, alert routing and a timed production rollback drill. Do not declare general availability until those external gates have named owners and recorded evidence.
