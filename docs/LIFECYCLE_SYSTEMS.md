# Lifecycle systems and release checks

This expansion implements additional executable flows across the 18-system brief. It does not certify every advanced scenario, physical-device acceptance, or multi-day production operation.

## Player controls

- Chronicle: **Ask Gemini to interpret** sends the typed command and a bounded list of permitted action choices to Gemini only when clicked. The returned choice is shown for confirmation; no simulation runs until confirmation. The model cannot supply arbitrary action arguments, player dialogue or consent. Unsupported intent asks for clarification. Direct typed parsing and the explicit action panel remain available without AI.
- Phone / Journal: assistance requests and dispatch status. A working owned phone and an authored in-jurisdiction agency policy are required. Caller reports become responder beliefs, not proof of a crime. NPC responders arrive after the authored delay; player responders must actually travel. A conscious patient needs explicit transport consent. Hospital treatment uses authored clinical services, not automatic healing.
- Relationships: cohabitation, marriage and reconciliation extend the existing reciprocal adult-consent gate. They do not assign player emotions or automatically relocate a character. Creator-authored social rules can connect relationship labels to housing access, notices and faction reputation.
- Combat: tactical movement needs authored starting positions and a movement limit, and consumes the combat turn. Chase checks include authored terrain/traffic penalties, vehicle condition and optional Creator-authored component damage, plus an authored Driving skill when available. Failed-chase damage is deterministic and configured.
- Lore / dossiers: permitted PNG/JPEG/WebP images load through authenticated, non-cacheable routes. No third-party storage is required.

## Creator controls and authoring

All new records use the existing validated Creator forms and can be batched atomically. No canon or real medical/legal policy is supplied.

| Record / setting | Behavior |
| --- | --- |
| `production` | Consumes exact business-owned input stock and increases an existing business-owned output stack on scheduled intervals. No money creation; bounded quantities and catch-up work. |
| `transition` | Tests authored conditions; selects one quest branch per advance by priority; persists once-only execution. Outcomes support quest state, known revelations, notices, faction reputation, housing access and NPC-only relationship-label additions. |
| `socialRule` | Applies authored consequences once when its relationship label and optional conditions match. Cannot manufacture a player's relationship assent. |
| Faction `dispatchPolicy` | Configures police/EMS type, response minutes and optional hospital location. Membership determines who may respond. |
| `judgment` | Creator-authored verdict, fine, custody/probation dates and authority label. Applies only to a listed suspect at trial; fines transfer to the agency. An unaffordable fine leaves the disposition pending. No inferred guilt. |
| `estate` | Explicit executor, beneficiary and authorization. Settlement requires death and transfers money, belongings and vehicle ownership once; memorial notices use authored dates. Existing older corpses need an explicit deceased link before their contents can be included. |
| `media` | Up to 256 KiB PNG/JPEG/WebP per image, stored inside the database and portable exports. Uploads start Creator-only. Attach via `mediaIds`; each asset keeps its independent visibility. HTML/SVG and external URL fetches are not accepted. Format/signature checks are not a full image-codec safety audit. |
| `npcRouteTravel` | Opt-in persistent departures, route time/fare/key checks and arrivals for schedules/plans, including partial-wait saves. Existing campaigns retain legacy schedule positioning until enabled. |
| `deterministicCatchup` | Opt-in one-minute simulation steps for consistent segmented waits. A 200,000 work-unit guard rejects excessive waits atomically; use shorter waits for large rosters. This is not an unlimited full-city real-time simulator. |
| NPC plans | Conditions and per-type preferences gate initiative. Authored messages require an owned, powered phone and a known contact; received claims remain beliefs. Authored breakups end the NPC's relationship without inventing a player response. |
| `calendar` / `closedDates` | Authored hemisphere and daylight hours expose seasonal/daylight metadata; holiday labels and location closures use the campaign timezone. These are configured rules, not astronomical or weather services. |
| `reproductiveHealth` | Off by default; requires an individually enabled, authored character calendar. Tracks cycle/pregnancy phase privately. Never infers sex, conception, miscarriage, birth or symptoms; due dates are metadata for authored events. |
| Injury `modifiers` | Creator-authored attribute effects, including persistent disabilities. No clinical formula or universal disability assumptions are hard-coded. |

Creator now provides read-only diagnostics and observer visibility previews. Saves provide compatibility verification. These do not mutate the timeline. Record restoration remains an explicit audited mutation, not a general-purpose database repair command.

## Persistence and compatibility

Migration `006_snapshot_chunks.sql` adds immutable content-addressed, compressed snapshot blocks. New saves reuse unchanged entity and history blocks; no existing save is rewritten, pruned or deleted. Saved manifests carry the original semantic snapshot checksum. Reading verifies block hashes, the overall checksum and schema. Missing/corrupt blocks fail closed. Full database backups include the block table; portable game exports remain self-contained version-1 JSON with embedded images.

Old inline saves and old exports still load. Import checksums are verified before applying new defaults, avoiding false checksum failures on older settings. Branching always creates a child timeline. Manifests still grow with record counts; compression/deduplication does not provide unlimited storage. No retention deletion or blob garbage collection is enabled. Older application builds that do not understand storage version 2 cannot restore the new saves; rehearse rollback against a full pre-upgrade backup rather than editing applied migrations.

Migration `007_intent_usage.sql` records AI proposal reservations separately from story turns. Proposal and narration usage share campaign/user allowances. A proposal takes one bounded 12-second attempt; narration retains its two-attempt reservation. Failed requests are not automatically refunded. Neither mechanism is a currency cap or a replacement for provider billing controls. Tests clear inherited AI credentials and use mocked providers.

## New endpoints

- `POST /game/timelines/:id/interpret`: characterId, text, provider `gemini`; authenticated/CSRF protected, proposal only.
- `GET /game/timelines/:id/diagnostics`: Creator-only validity, warning and storage/outbox counts.
- `GET /game/timelines/:id/preview?characterId=...`: Creator-only observer projection.
- `GET /game/timelines/:id/saves/compatibility?saveId=...`: Creator-only checksum/schema validation.
- `POST /game/timelines/:id/media`: Creator-only revision/entity upload; idempotency key required.
- `GET /game/timelines/:id/media/:mediaId?characterId=...`: controlled-character and asset visibility checks; no-store/nosniff response.

## Acceptance and remaining boundaries

`npm run check` and the complete 85-test suite pass locally. Added tests cover NPC transit/segmentation, production, quest arbitration, manufactured-consent rejection, EMS transport, court fines/probation, estate conservation, private health calendars, snapshot reuse/legacy import/corruption, Creator diagnostics, AI budget sharing/injection, media privacy/portability, authored NPC messages, reciprocal marriage/housing consequences, and tactical action economy. Browser coverage includes cancelling an AI proposal without taking a turn. A 1,001-NPC/1,000-lore fixture completed ten hourly turns and autosaves in 8,882 ms in the recorded run, below its 30-second regression ceiling.

Still not certified: arbitrary natural-language tools beyond the bounded proposal list, external embedding generation, nuanced personality reasoning beyond Creator-authored trait-weight compatibility, full traffic or ballistic physics, every offscreen interaction under all possible Creator rules, native app binaries, physical Safari/VoiceOver, multi-day soak, independent security audit, live account/save restart acceptance, live Gemini billing/model access, off-host backup scheduling and external alert delivery. The strict narration contract deliberately retains validated source text; expanding prose generation must not weaken the original agency and canon requirements.

Render inspection confirmed commit `649360b282789f04c95e6609ad789153dafa688f` live as deploy `dep-das4dkc9v7es73enbung`, auto-deploy enabled on `full-game-implementation`, a free single instance, HTTP 200 from `/healthz`, and successful build/start logs. Its existing runtime label is Python while the build/start commands run Node; `/healthz` is not configured as the Render health-check path. These settings were observed, not silently changed. See the final handoff for the new deployment's exact commit/status.
