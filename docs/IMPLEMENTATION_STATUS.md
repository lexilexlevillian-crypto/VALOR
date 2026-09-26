# VALOR integrated implementation status

Build: 0.2.0-alpha, 2026-09-26. The owner authorized continuing across systems and publishing the source and brief. This report separates a working cross-system implementation from full satisfaction of every advanced requirement. **All 18 systems are not yet production-complete.** No city, person, faction or legal canon is seeded into production.

## System coverage

Current expansion: see [SYSTEMS_EXPANSION.md](SYSTEMS_EXPANSION.md) for controls, Gemini configuration, migration 005 and exact remaining work. The additions below extend the alpha; they do not close every requirement in the original brief.

| System | Implemented and exercised | Remaining limits / decisions |
| --- | --- | --- |
| 01 Foundation | Async Turso/libSQL, local SQLite, unchanged 001–004 plus forward migration 005, role/tenant boundaries, atomic commands, histories/receipts, leased game-event outbox, backup/restore | External notification consumer deployment remains |
| 02 Client | Responsive Chronicle, dossier navigation, long prose, structured actions, server state, PWA shell, keyboard/focus/reduced motion | Physical iPad/Safari and screen-reader acceptance; no native App Store binary |
| 03 AI | Direct Gemini with configurable model and private key; trusted gateway; strict source-ID validation; confirmed intent proposals; validated paragraph streaming; no rerolls; retries/circuit breaker; campaign/user budgets | Rich unrestricted narration and model-based language interpretation are not complete; provider transport is mocked, not live-tested |
| 04 Knowledge | Separate truth/knowledge/beliefs/memories, provenance/correction, private retrieval, supplied vectors, Story Cards, bounded extractive continuity brief with repetition suppression | No embedding service/index or generative long-history summarizer; continued adversarial review required |
| 05 Characters | PC/NPC shared model, attributes/skills/traits, editable catalog, identity/background/appearance, stable custom sections, trait costs/prerequisites | Final mechanics and balance are Creator-configured; catalog descriptors are not bespoke mechanics for every trait |
| 06 NPC autonomy | Tiered schedules/plans, work/travel/care/crime/social offers, authored group leadership/cohesion/mood/knowledge sharing, preference-disabled plans | Full travel simulation, richer drift detection and general segmentation-invariant catch-up remain incomplete |
| 07 Relationships | Directional dimensions/history/inertia, labels, boundaries, adult gates, reciprocal offers and explicit PC consent, fade-to-black | Compatibility/preferences, family/social/economic repercussions and complex autonomous relationship transitions remain limited |
| 08 Objects | Persistent inventory/ammo, phones/messages/read status, explicit answer/decline/end/missed calls and supplied dialogue, vehicle access/boarding, private weight-limited trunks, travel/fuel | Media storage, richer voicemail and detailed vehicle damage remain |
| 09 Health | Injuries/blood/needs, medicine/recovery, optional authored infection/withdrawal/sobering, paid supply-consuming clinical services, death/corpse belongings | Full EMS/hospital workflow, estate/funeral and detailed disability mechanics remain |
| 10 Conflict | Auditable checks/initiative, ammo, defense/cover, grapple/restraint/disarm, authored positions/range/blocked lines/body protection, injuries/flee/basic chase | Detailed traffic/terrain/chase and ballistic models remain |
| 11 Time/place | Configurable calendar/timezone, schedules/hours, routes/cost/access, private places, authored weather schedules and timed route interruptions | Seasons/holiday effects and broader dynamic encounters remain; no real weather feed |
| 12 Economy | Integer cents, merchant funds/stock, wages/rent, optional needs, ingredient-conserving recipes and configured washing/laundry | Scarcity/production and optional pregnancy/menstruation simulation remain |
| 13 Crime/law | Witness reports/beliefs, evidence/custody, case/jurisdiction gates, authored paid forensic reports with contamination, authorized bail payment/release, restricted suspect notices | Full dispatch, courtroom sentencing and faction retaliation remain; legal decisions are Creator-authored |
| 14 Events | Watcher priorities/cooldowns/expiry/once guards, compound all/any/negated conditions including evidence, conflict groups, private traces, quest deadlines/journal | Broad authored branch execution and AI-proposal workflow remain limited |
| 15 Saves | Atomic saves/checksums, immutable branches, Chronicle/import/export, full DB restore, Creator save comparison and audited record restoration | Thumbnails, compaction/retention and future save-version upgrades remain |
| 16 Creator | Typed forms/NPC search, references/epistemics/templates, event trace, dry-run import, cross-reference-safe atomic batches, record restore, authoritative settings forms | Graphical previews, media packaging and advanced repair tools remain |
| 17 Quality | Authorization/invariant/adversarial tests, isolated fixture data, AI budgets, browser accessibility, offline/reconnect, large roster benchmark | No multi-day soak, physical-device profiling or full privacy/security audit; AI billing telemetry is estimated |
| 18 Operations | Turso production config checks (no Render disk), awaited startup migrations, health endpoint, CI workflow, full-database import/backup, Render runbook | Live Turso connectivity, Render deploy/restart persistence, off-host backups and monitoring remain unverified |

## Exact verification evidence

On Windows, Node 24.21.0:

- `npm run check`: passed.
- Original integrated-alpha suite: 39 tests; Turso migration raised this to 46. The systems expansion adds 13 integration tests and 2 mocked Gemini tests, for 61 passing tests with local libSQL. This is not a live Gemini/Turso/Render acceptance result.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- Browser test: Chromium iPad-sized portrait/landscape and 390px mobile, keyboard sign-in, Creator form save, action proposal/confirmation, automatic Gemini failure retaining exactly one committed turn, 3,000+ character prose, reduced motion, offline shell/reconnect; zero axe violations in the checked screens and zero uncaught page errors. Not a physical Safari/VoiceOver certification.
- Integrated acceptance: author PC/NPC; look; drive/travel/time; NPC schedule; directional social interaction; phone; medicine/injury; witnessed act/report; evidence discovery/case; timed offer; checkpoint; branch; full export/import; no hidden NPC secret leakage.
- Recovery: independent backup database reproduces the complete game state and Chronicle. Failed escape commits its result once; replaying its receipt does not advance time/reroll.
- Load fixture: 1,001 NPCs and 1,000 lore records; ten hourly turns with autosaves completed in 7,292 ms in an expansion run. Local fixture benchmark, not a throughput or production SLA. Regression ceiling: ten turns under 30 seconds.

GitHub-hosted CI and live deployment results must be checked against the published commit; local results are not proof of either.

## Security and agency boundaries

Only the controlled playable character can execute a player turn. Both revoked membership and revoked character control invalidate retries/narration. The parser asks for clarification on unsupported prose. Simulation resolves before narration; no model-written dialogue, feelings, actions, consent, inventory, evidence or mechanics are accepted. External providers receive only authorized fragments and a bounded observer-permitted continuity brief. Mature options default off, adult dates are required, intimacy fades to black. Cases distinguish reported beliefs from facts and evidence from guilt.

Creator accounts can deliberately edit canonical state and hidden content; this is an authoring authority, not normal-player omniscience. Timeline names are shared metadata. Game exports contain private world content. Persistent database backups contain account/session data. Keep both protected.

## Deployment handoff / next priority

The selected Render service is `srv-das0ah59fdbs73bbk7hg`, https://valor-uwgb.onrender.com. The owner installed/connected the Render plugin during this task, and its skills are now visible, but its service-management tools have not loaded in this running task. The plugin's Render MCP setup guidance calls for a new Codex task/reload to load its MCP server and complete OAuth when prompted. No paid service, disk, production credentials or live deployment were changed.

Immediate release priority: configure external Turso privately on the existing free Render service and complete the documented deploy/restart/restore acceptance without a Render disk. Do not treat the alpha as production-complete or skip the remaining feature matrix. After deployment is verified, the main gameplay priority is the rich, knowledge-filtered narration/intent layer with explicit action confirmation and adversarial evaluation.
