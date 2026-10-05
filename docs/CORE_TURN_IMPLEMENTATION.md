# System 1 core gameplay and turn integration

The [master specification](SYSTEM_01_CORE_SPEC.md) is the normative design. This implementation connects its turn protocol to the existing VALOR domain systems. Both play modes use the same interpreter, providers, simulation, transaction, and observer projection.

## Integration and ownership

The repository's historical System 01 is database authority and System 13 is the turn pipeline. Those numbers and their existing records are preserved. The supplied gameplay System 1 is the orchestration layer above them; it does not introduce a second inventory, clock, economy, or knowledge store.

| Responsibility | Existing authority and integration |
| --- | --- |
| Sessions, revisions, persistence | `Game`, timelines, turn cursors, immutable events/receipts, libSQL transactions |
| Commands and interpretation | `turn-contracts.ts`, `turn-input.ts`, `turn-kernel.ts` |
| Rules, checks and clauses | `turn-rules.ts`, `turn-resolution.ts`, existing action/domain owners |
| Typed causal audit | `turn-audit.ts`, resolution batches, attempt records, check provenance |
| Time and interruptions | `simulation.ts`, `turn-clock.ts`, calendar, events, communications |
| Scene lifecycle and handoff | `turn-scenes.ts`, existing combat/chase/travel state |
| Physical interactions | `physical.ts`, items, vehicles, law, observation and time |
| Knowledge and beliefs | System 14 epistemics; System 16 NPC decisions; observer-specific projection |
| Chronicle and narration | System 10 notices, System 11 AI gateway, System 12 frozen contexts |
| Specialized domains | Systems 17–30: social, consent, phone, inventory, weapons, vehicles, health, tactics, spacetime, economy, law, investigation, factions and events |
| Recovery and diagnostics | System 31 saves/branches; System 32 diagnostics; immutable receipts and outbox |

Production rule adapters retain the existing trusted domain implementations. The owner registry rejects duplicate or missing owners and grants no write permissions by default. Its trusted composition root explicitly grants entity kinds, fields, create/archive rights, and permitted state roots to each integration. Provider names confer no authority. Every actual candidate change must match those grants before staging. Entity-kind ownership is exhaustive at compile time; new kinds cannot silently inherit a generic owner. Models cannot register providers, submit patches, or modify canonical state.

The [32-system interface reconciliation](CORE_SYSTEM_INTERFACES.md) now uses the supplied canonical 21-page PDF. Its numbering matches the repository. The executable manifest records exact titles and source pages; all 17 required hook categories map to existing integrations. An exhaustive map assigns all 101 action types to primary domain owners. New core-turn-v3 attempt records and committed batches identify the corrected routing and deterministic dispatch/clinical IDs; historical receipts remain unchanged.

## Command protocol

`POST /game/timelines/:id/commands` accepts a strict envelope:

```json
{
  "commandId": "globally-unique-command-id",
  "sessionId": "<timeline UUID>",
  "expectedRevision": 12,
  "actorId": "<controlled character UUID>",
  "mode": "STORY",
  "input": {"kind": "freeform", "text": "Open Door and take Envelope"}
}
```

Authentication supplies the account identity. Character authority is checked before trace writes or receipt replay. The URL and envelope timeline must match. Command IDs contain 16–128 letters, numbers, underscores or hyphens; UUIDs are accepted. Extra fields and client-provided seeds are rejected.

| Input kind | Behavior |
| --- | --- |
| `freeform` | Interpret explicit intent and up to eight dependent clauses, or persist clarification |
| `action` | Validate a typed domain action with optional original text |
| `affordance` | Resolve an observer/revision-bound suggestion |
| `inspection` | Read scene, inventory, phone, journal, health, cases, or a visible target without time |
| `mode_switch` | Change presentation preference only |
| `clarification_answer` | Choose a stored option by ID/name, or explicitly restate the action |
| `cancel_pending` | Cancel an unresolved clarification; return the existing result if already committed |
| `regenerate_narration` | Add a grounded presentation version from the same committed effects |
| `edit_request` | Create an audited branch from a named checkpoint, preserving parent history |

Results include command ID, revision, world time, mode, explicit control, pending decision, permitted suggestions, and status. Committed results additionally include event/trace IDs, time delta, checks, permitted effects, notices, active scene, completed clause count, and interruption status. Stale commands return a conflict and never silently rebase.

Chronicle submits this protocol. Game Mode renders non-exclusive suggestions and retains the freeform composer. Clarification choices and cancellation are available in the same surface. Both action and view responses use the shared browser revision guard, including selected-character/timeline checks. The public module is included in the offline shell cache.

## Interpretation and physical actions

The deterministic interpreter preserves raw input, correction syntax, quoted speech, declared goals, approaches, explicit constraints, evidence spans, and clause dependencies. Conditional opening checks, arrival/departure waits, quiet goals, work/rest, resignation, persuasion and physical attempts use domain rules. Ambiguous material targets produce stored choices before a world action. A short answer fills the original ambiguous reference; it does not discard the intended action.

Examples include opening/closing/unlocking a door, picking or forcing a lock, pushing a shelf across a doorway, throwing a bottle at a light, and moving remains into a vehicle trunk. An unsupported novel physical attempt asks for clarification without consuming time or inventing a successful mechanism. Missing entities remain missing. Unsupported or consequentially underspecified instructions ask for clarification.

Unrecognized language can use the bounded creative planner when an existing direct provider is configured and both campaign/user AI allowances permit it. The planner receives observer-permitted entity descriptions and the complete compact action-contract index, rather than the UI suggestion menu. It can compose up to eight dependent actions. Exact input evidence, schema validation, visible references (including arrays and conditions), and a confirmation showing parameters and dependencies are required. The accepted plan is persisted with the pending decision, expires on revision change, and executes only after confirmation. Provider I/O occurs before the world transaction; receipt replay never requests another proposal.

A conservative byte-based estimate reserves both attempts and their output limits through the existing shared AI usage ledger. The complete context must fit the configured allowance; a 16,000-token context allowance supports the contract index plus a modest scene. Overflow, unavailable providers and exhausted allowances return ordinary clarification with no world changes. No live external provider call was made during validation.

Physical objects use the optional item `mechanism` record. Authors can configure kind, open/light state, key, destination, obstruction, difficulties, tool wear, damage and duration. Private check parameters and undiscovered destination/obstruction references are removed from player projection. Items support `noticePolicy: normal | scarce | abundant`.

Physical resolution checks reach, possession, access, weight/capacity, lock state and authored mechanics. It invokes the existing inventory/custody, observation, noise, crime and time hooks. Unlocking changes the lock without opening the door. Opening a threat-bearing doorway commits that opening and returns control before any later clause. Requested silence is a goal: a failed quiet check can leave the opening successful with a partial outcome and audible consequences.

Lockpicking records material attempt signatures. Rewording an unchanged failed approach does not obtain a new roll; elapsed time and tool wear still apply. A different key, tool or relevant state can create a new attempt. Check provenance records physical stakes and cost policy before any RNG draw.

## Atomic resolution and reproducibility

Each clause resolves on an isolated candidate through its registered owner. Intermediate candidates validate before subsequent clauses use them. The final candidate validates before persistence. A failed dependency, mandatory interruption, specialized handoff, or recognized later-clause blocker ends the prefix. Infrastructure errors abort the transaction.

The prefix's world state, clock, events, checks, knowledge, projections, cursor, receipt, scene, narration context and save commit together. Migration 045 adds immutable command receipts, input metadata, frozen narration contexts, resolution batches, narration versions and durable RNG seeds. Migration 046 adds scene lifecycle and immutable attempt records.

RNG lineage is reserved before world resolution. Event IDs derive from lineage and command scope; simulation-generated IDs derive from lineage, event and sequence. A transaction retry retains the same uncertainty and event identity. Presentation-only IDs and audit timestamps are not simulation outcomes.

Resolution steps contain typed entity operations, owner names, precondition revisions, changed values and causal event indexes into the combined event batch. Clock, facts, knowledge, beliefs, memories and permitted settings changes are also audited. Validation rejects omitted, duplicate, forged, unauthorized or destructive deltas, changed entity kinds, regressing entity revisions and altered canonical metadata. Events carry occurrence time, source system and cause references. Batch records include clock range, knowledge changes, entity revisions and hashes, rule steps and final control. Attempt records link the command, interpretation, clauses, base revision, committed event IDs, rules/content versions and handoff.

The privileged `developer/turn-traces` endpoint includes immutable attempt records and the resolution batch alongside ordered pipeline stages. Ordinary player responses expose only permitted effects and check fields. The provider registry is a trusted server interface, not an arbitrary-code sandbox.

## Time, scenes and continuity

Wait, sleep, work and travel use the interruptible scheduler. Authored watchers and communications can set `requiresPlayerResponse`. Time boundaries and changing conditions are evaluated during an interval; events at equal times resolve by registered priority and stable ID. Fractional-minute boundaries are preserved. Requested uninterrupted sleep cannot suppress an alarm.

Work records actual elapsed attendance and cumulative wages. Interrupted shifts neither pay future hours nor lose already earned wages; fractional wage carry carries forward. Completion tips/advancement occur only upon completion. Resignation changes employment through its owner and prevents implicit resumption.

Travel preserves character, carried objects, health and communications. An interruption or fuel/condition limit records an en-route journey and remaining duration. Resuming charges only the remaining route and avoids duplicate fares. Arrival-only evidence is produced at arrival. Existing tactical, restraint, chase and communication owners retain their separate phases and consequences.

Persisted scenes track OPEN/SUSPENDED/CLOSED status, location, participants, phase, tempo, control, pressures, environmental/specialized references, timestamps, revision and last turn. Travel suspends the previous scene. Inspection and mode switching preserve the exact committed handoff, including an interrupted plan. Entering an overlay does not replace shared world state.

## Knowledge-safe presentation

Characters may carry `identityDisclosure: {concealed, label, knownByIds}`. Observer projection and permitted effects use the observable label until that observer knows the identity, including canonical-name aliases in generated text. Notices and suggestions are derived from the same projection.

Hidden checks stay in the audit ledger and are absent from player results, history and narration. Partial checks expose only the allowed outcome band. Hidden modifier sources and raw check JSON are removed. Adding an undiscovered object does not change the visible suggestion set.

Every committed turn freezes its permitted scene, controls and bounded context sources. Regeneration uses this snapshot, not later knowledge. The fast commit path omits optional general lore ranking; the existing full context/retrieval APIs retain it.

AI narration cannot add entities or facts. Nonempty additions fail validation. Source-anchored narration currently accepts source-preserving arrangements and specified tense substitutions; arbitrary rewrites are rejected because their factual equivalence cannot be established mechanically. This deliberately conservative boundary blocks unsupported money, identity, emotion, agency, weapon and period claims. Bounded retries and deterministic fallback preserve committed gameplay when a provider fails.

Capability validation checks introduced dates against the game clock, with explicit canonical technology exceptions. Presentation uses the approved source boundary and period checks. Player quotations remain quotations, not instructions or scheduled actions.

Chronicle, notices and inspection are separate outputs. Notices cover meaningful time/location, funds, injuries, messages, evidence, inventory and unlocking changes. Abundant-item quantity churn is suppressed; scarce medication remains tracked. Discovery notices do not elevate an unverified interpretation into truth.

## Response timing

Authenticated observer GET/HEAD reads use a 250 ms minimum release window; player command, legacy turn, parse and story-resolution requests use 500 ms. The class depends on the public route and HTTP method, not target existence, visibility or result status. Hidden and missing inspection targets return the same error and status. The release helper also covers errors and is tested with injected work durations and real HTTP requests.

Over-budget processing emits a private privacy.response_latency_overrun operational warning without entity IDs or input text. Padding cannot conceal overruns, shared-host scheduling or network variation. Deployed-load measurement and calibration remain required before claiming timing-channel indistinguishability; the local suite establishes the bounded release behavior, not that stronger claim.

## Acceptance evidence

The three core test files contain focused contracts; existing owner suites supply integration coverage. The following matrix identifies the behavior exercised rather than asserting exhaustive natural-language or adversarial coverage.

| Master acceptance cases | Evidence |
| --- | --- |
| 001, 006, 020, 026 | Kernel unknown/ambiguous input and no-conjuring tests; persisted target clarification |
| 002, 008, 015, 060, 061 | Acceptance source-preserving narration rejection; kernel frozen fallback; narration and gateway suites |
| 003, 007, 019, 021, 025 | Physical opening, shelf obstruction, quiet-goal and failed-force acceptance |
| 004 | Typed delta owner rejection; items/weapons owner conservation and ammo tests |
| 005 | Threat/decision handoff acceptance; event offers and explicit economy purchases |
| 009, 011, 012, 052, 058 | Hidden identity/alias, hidden check, hidden destination, affordance equivalence and epistemic suites |
| 010 | System 14 false-belief and System 28 unverified hypothesis tests |
| 013, 014 | Kernel period capability boundary; observer-safe available suggestions; phone device capability tests |
| 016, 017, 018 | Actual affordance/text seeded parity; pending/scene invariance; health/case/inventory inspection tests |
| 022, 023, 024 | Correction/quoted speech; conditional and failed compound dependency tests |
| 027, 028, 029, 030, 031 | Routine no-roll movement; pre-draw stakes; failure time/wear; unchanged lockpick retry; changed-key attempt |
| 032 | Persuasion goal/approach interpretation and social-owner resolution |
| 033, 034, 035 | Interrupted shift wages; earliest arrival wait; exact alarm handoff during sleep |
| 036, 053, 054 | Chronicle time/funds tests and abundant/scarce item acceptance |
| 037 | Equal seed/entity-order tests and simultaneous mandatory event priority test |
| 038 | Door reveals threat, commits one clause, preserves exact handoff across presentation operations |
| 039, 040 | Freeform group-fight handoff and restrained-speech acceptance; System 24 tactical initiative and persistent restraints |
| 041 | Interrupted route, exact fuel depletion and remaining-distance resumption acceptance; vehicle/chase continuity suites |
| 042 | System 19 separate SMS send, delivery and receipt-knowledge tests |
| 043, 044, 049 | Duplicate/concurrent HTTP commands, rollback seed recovery, and fresh database-connection replay |
| 045, 046 | Narration failure and repeated regeneration preserve state, time, IDs and permitted knowledge |
| 047, 048, 050 | Pending cancellation, committed-result replay and checkpoint branch tests |
| 051, 055 | Door notice/inspection separation; Chronicle and investigation discovery/knowledge tests |
| 056, 063 | Bottle impact/noise; body-to-trunk capacity/custody/observed transfer; vehicle and law hooks |
| 057 | Contradictory leave/stay clarification |
| 059 | Mock owner outage and database-write fault rollback tests |
| 062 | Browser delayed-response test using the same guard as action/view application |
| 064 | Partial shift resignation preserves earned wages and terminates employment |

## Invariant enforcement

Existence, authority and causality are checked at schema, owner, reference and causal-delta boundaries. Atomicity/idempotency/revision use database transactions, unique receipts and compare-and-swap. RNG, deterministic ordering and retry separation use durable seeds, stable IDs, sorted events and attempt signatures. Agency/handoff/continuity use explicit clauses, result status, scenes and specialized owners.

Knowledge, NPC belief separation and observer specificity use the existing epistemic layer before retrieval/presentation. Time and checks use owner policies and the scheduler; stakes are recorded before draws. No prose mutation, regeneration and failure recovery use frozen effects/context with append-only presentation versions. Audit records retain input through final presentation. Stale commands and stale browser responses cannot silently replace current state.

## Validation and deployment

Canonical reconciliation verified on 2026-10-05T00:53:56.578Z:

- TypeScript and git diff --check passed.
- Full test suite: 340 tests across 68 files; 0 failures and 0 skips; runner exit 0.
- All 241 source/test/migration fingerprints remained unchanged throughout the run.
- Large-roster benchmark: 1,001 NPCs and 1,000 lore entries; ten hourly turns in 28343 ms, below the unchanged 30,000 ms threshold.
- All 32 canonical names, numbering, detail pages, and implementation pages match the supplied PDF; its SHA-256 is recorded in the executable manifest and verification report.
- Browser checks cover Creation Studio, native phone/life flows, reconnect drafts, accessibility, offline behavior and delayed turn responses.
- Ownership checks cover default-denied writes, owner-name spoofing, exact delta coverage, protected roots, nested references, global causal indexes, exhaustive action routing, and unknown-owner rejection.
- Creative-plan checks cover mocked gateway invocation, explicit confirmation, grounded evidence, state preservation and receipt replay.
- Added replay regressions compare complete dispatch request/acceptance state, beliefs, effects and deltas. Clinical care reproduces treatment and assessment IDs while conserving supplies and payment. Persisted attempt and batch ruleset versions are checked.

The current machine-readable report is artifacts/canonical-reconciliation-verification.json; the full log is artifacts/canonical-reconciliation-tests.log. The earlier 337-test run remains preserved in artifacts/core-completion-final-verification.json as historical evidence. Tests use temporary local databases, synthetic content, headless Chromium and mocked provider transports. No live provider request, live database migration or deployment was performed.

Apply migrations through 046 through the existing deployment process before starting the updated server. The canonical reconciliation adds no schema migration or backfill. Existing immutable attempts/batches and idempotent receipts retain their historical outcomes; new records use core-turn-v3.

The supplied PDF closes the §0.1 missing-source check. Response release windows and overrun monitoring are implemented and tested locally; timing indistinguishability under deployed load and network conditions remains uncertified. These external checks are not represented as completed by the local test result.

## Manual acceptance after deployment

1. Open an existing life, inspect inventory/health, and switch Game/Story presentation. Confirm no world time passes for inspection or presentation changes.
2. Submit an ambiguous action and cancel it; then confirm a creative plan with a configured provider. Verify only the confirmed actions occur and that refreshing/retrying does not repeat them.
3. Request assistance using an owned phone and an authored agency; confirm the responder learns a report as a belief. Use an authored clinic and check treatment history, supplies, payment, and elapsed time.
4. Open an authorized Developer trace and check the committed batch and attempt versions, causal deltas, and observer projection. Return to Player Mode and verify hidden records are absent.
5. Save and branch an existing timeline, restart the service, and verify the parent history and child state survive. Use the existing backup/rollback rehearsal before releasing to the live environment.
