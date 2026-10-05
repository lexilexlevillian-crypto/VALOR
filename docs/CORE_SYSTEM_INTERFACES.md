# Core turn interface reconciliation

The supplied 21-page [32-system implementation reference](../.codex-remote-attachments/01a108d1-dce7-7ee1-ba54-77ff65b0a22c/2e1403c4-581d-4e32-82ba-0e16d29d8a7a/1-VALOR-32-SYSTEM-COMPLETE-CODEX-_-ASTRA-IMPLEMENTATION-PROMPTS.pdf) is now the numbering authority. Its index (page 2), matching detail addenda (pages 3-9), and implementation passes (pages 9-21) have been compared with the existing domain interfaces and the [core gameplay master specification](SYSTEM_01_CORE_SPEC.md). Source SHA-256: `77aa846a93ed86bb5199bf8dc7c37e6b4546adda67f2223ca5f40d945b47abb4`.

The numbering matches the repository. Canonical System 01 is Foundation and Persistent Authority; System 13 is Transactional Turn Pipeline, Validation, and Retry. The expanded gameplay document calls its orchestration layer “System 1”; this is a document-local label, not a replacement for the canonical System 01. Existing IDs, migrations, saved history, and acceptance-suite filenames remain valid. IMPLEMENTATION_STATUS.md uses an older 18-group summary and is not a numbering authority.

The expanded gameplay specification supplies the detailed core behavior. In particular its §21.1-21.3 makes simulation commit precede narration, whereas the PDF page 14 presents a compressed pipeline ending in atomic commit/projection. VALOR commits mechanical effects and a deterministic projection atomically, then versions validated narration separately. A provider outage cannot undo or reroll a committed turn.

| ID | Canonical title | Provider/storage ownership keys | PDF detail / implementation pages | Acceptance evidence |
| --- | --- | --- | --- | --- |
| 01 | Foundation and Persistent Authority | Orchestration or presentation | 3 / 9 | [Suite](../tests/system01-authority.test.ts) |
| 02 | Authentication, Roles, Security, and Audit | Orchestration or presentation | 3 / 9 | [Suite](../tests/system02-security.test.ts) |
| 03 | Campaigns, World Configuration, and Canon Boundaries | authored-content | 3 / 10 | [Suite](../tests/system03-campaign-canon.test.ts) |
| 04 | Valor UI Design System and Theme Engine | Orchestration or presentation | 3 / 10 | [Suite](../tests/system04-theme.test.ts) |
| 05 | Player Mode, Developer Mode, and Bottom-Edge Switch | Orchestration or presentation | 4 / 10 | [Suite](../tests/system05-mode.test.ts) |
| 06 | Main Menu, Roster, New Game, and Character Starts | Orchestration or presentation | 4 / 11 | [Suite](../tests/system06-entry.test.ts) |
| 07 | Character Creator and Shared Character Data | characters | 4 / 11 | [Suite](../tests/system07-character.test.ts) |
| 08 | Attributes, Skills, Checks, and Advancement | mechanics | 4 / 12 | [Suite](../tests/system08-mechanics.test.ts) |
| 09 | Trait Catalog, Backgrounds, and Custom Fields | Orchestration or presentation | 4 / 12 | [Suite](../tests/system09-traits.test.ts) |
| 10 | Chronicle, Narrative Input, and Scene Presentation | Orchestration or presentation | 4 / 12 | [Suite](../tests/system10-chronicle.test.ts) |
| 11 | Provider-Agnostic AI Gateway and Tool Contracts | Orchestration or presentation | 5 / 13 | [Suite](../tests/system11-ai-gateway.test.ts) |
| 12 | Context Engine, Narrative Control, and Story Directives | Orchestration or presentation | 5 / 13 | [Suite](../tests/system12-context.test.ts) |
| 13 | Transactional Turn Pipeline, Validation, and Retry | world-actions | 5 / 14 | [Suite](../tests/system13-turn-pipeline.test.ts) |
| 14 | Lore, Semantic Retrieval, Knowledge, Beliefs, and Memories | knowledge | 5 / 14 | [Suite](../tests/system14-epistemics.test.ts) |
| 15 | NPC Registry, Profiles, Privacy, and Creator Visibility | Orchestration or presentation | 5 / 14 | [Suite](../tests/system15-npc-registry.test.ts) |
| 16 | NPC Autonomy, Schedules, Goals, and Tiered Simulation | Orchestration or presentation | 6 / 14 | [Suite](../tests/system16-npc-autonomy.test.ts) |
| 17 | Relationships, Family, Reputation, and Social Graph | relationships | 6 / 15 | [Suite](../tests/system17-social-graph.test.ts) |
| 18 | Romance, Consent, Mature-Content Settings, and NPC Initiative | romance | 6 / 15 | [Suite](../tests/system18-romance-consent.test.ts) |
| 19 | Phone, Contacts, Calls, Texts, Voicemail, and Social Media | communications | 6 / 16 | [Suite](../tests/system19-phone.test.ts) |
| 20 | Items, Inventory, Clothing, Persistent Objects, and Search | items | 6 / 16 | [Suite](../tests/system20-items.test.ts) |
| 21 | Firearms, Weapons, Ammunition, Carry, and Ballistic Protection | weapons | 7 / 17 | [Suite](../tests/system21-weapons.test.ts) |
| 22 | Vehicles, Travel Assets, Vehicle Crime, and Vehicle Evidence | vehicles | 7 / 17 | [Suite](../tests/system22-vehicles.test.ts) |
| 23 | Health, Injury, Medicine, Substances, Death, and Aftermath | health | 7 / 17 | [Suite](../tests/system23-health.test.ts) |
| 24 | Combat, Violence, Restraint, Chases, and Tactical Scenes | combat | 7 / 18 | [Suite](../tests/system24-tactical.test.ts) |
| 25 | Time, Weather, Locations, Map, Travel, and Business Hours | spacetime | 7 / 18 | [Suite](../tests/system25-spacetime.test.ts) |
| 26 | Economy, Jobs, Housing, Businesses, and Optional Daily Needs | economy | 7 / 18 | [Suite](../tests/system26-economy.test.ts) |
| 27 | Crime, Police, Law, Dispatch, Arrest, and Lax Enforcement | law | 8 / 19 | [Suite](../tests/system27-law.test.ts) |
| 28 | Evidence, Investigation, Cases, Informants, and Criminal Heat | investigation | 8 / 19 | [Suite](../tests/system28-investigation.test.ts) |
| 29 | Factions, Gangs, Institutions, Rumors, and Living-City Conflict | factions | 8 / 20 | [Suite](../tests/system29-factions.test.ts) |
| 30 | Quests, Dynamic Events, Watchers, Journal, and Case Files | events | 8 / 20 | [Suite](../tests/system30-events.test.ts) |
| 31 | Saves, Autosaves, Timelines, Settings, Import, and Recovery | Orchestration or presentation | 8 / 20 | [Suite](../tests/system31-saves.test.ts) |
| 32 | Creator Studio, Admin/Debug, QA, Deployment, and Operations | Orchestration or presentation | 9 / 21 | [Suite](../tests/system32-release.test.ts) |

## Core hooks and composition

All 17 categories from master specification §20.2 resolve to existing domain modules. Paths in the last column are under src/game. These are integrations through the staged turn adapter, not new competing stores.

| Required hook | Canonical systems | Implementation |
| --- | --- | --- |
| Character capabilities and conditions | 07, 09, 23 | actions.ts, traits.ts, policy.ts, lifecycle.ts |
| Skills and check resolution | 08 | actions.ts (audited checks), traits.ts |
| Inventory, equipment and resources | 20, 21, 26 | items.ts, weapons.ts, economy.ts |
| Movement, location and travel | 22, 25 | actions.ts, vehicle.ts, city-geography.ts |
| World clock, schedules and interval events | 16, 25, 30 | simulation.ts, calendar.ts, turn-clock.ts, events.ts |
| NPC decisions and relationships | 15, 16, 17, 18 | simulation.ts, social.ts, romance.ts |
| Dialogue, communication and phone | 17, 19 | actions.ts, extended-actions.ts, phone.ts |
| Combat, violence and injury | 21, 23, 24 | actions.ts, weapons.ts, lifecycle.ts, turn-resolution.ts |
| Stealth, perception and knowledge | 08, 14, 20 | actions.ts, items.ts, epistemics.ts |
| Law, crime and custody | 27, 28 | law.ts, investigation.ts, extended-actions.ts |
| Jobs, shifts and economy | 26 | actions.ts, economy.ts, simulation.ts |
| Quests, cases and evidence | 27, 28, 30 | events.ts, investigation.ts, law.ts |
| Vehicles | 22 | vehicle.ts, actions.ts |
| Environment and object state | 20, 25 | physical.ts, items.ts, simulation.ts |
| Media and discoverable information | 03, 14, 19, 20 | model.ts (media references), epistemics.ts, phone.ts, items.ts |
| Save, checkpoint and history | 01, 31 | engine.ts, snapshots.ts, turn-kernel.ts |
| Content and 2012 grounding | 03, 11, 12, 18 | policy.ts, turn-planner.ts, ai.ts, context.ts |

The executable [system manifest](../src/game/system-interfaces.ts) contains exact canonical titles and page references. [actionOwners](../src/game/turn-rules.ts) explicitly assigns all 101 action types; its exhaustive TypeScript contract rejects additions without an owner, and unknown runtime actions fail closed. Specialist providers include mechanics (08), romance boundaries (18), and weapons (21). Inventory entities still belong to the items store (20); a weapon action does not create another inventory. Forensic tests and evidence custody resolve under 28, bail under 27, cover and flight under 24, and events/rumors under 30/29.

Shared dispatch coordinates police and EMS through the existing health/lifecycle adapter; police knowledge and enforcement remain owned by law. Case storage retains its existing law key while evidence analysis uses investigation. These composition decisions do not grant write authority: explicit field/kind grants and exact candidate-delta validation still apply to every staged step. Domain calls do not commit independently.

New attempt records and committed batches record core-turn-v3. This revision identifies explicit canonical action routing and deterministic dispatch belief, clinical treatment, and assessment IDs. Existing immutable records retain their prior versions and receipt replay returns the original outcome. No schema migration or data backfill is needed for this reconciliation; migrations through 046 remain required for the complete core integration.

## Verification scope

This closes the missing-source reconciliation in master specification §0.1. It verifies core interfaces against all 32 definitions; it is not a new claim that every broad product ambition in the PDF has been independently certified. Existing domain suites and the core integration suites supply behavior evidence. Deployed timing-channel indistinguishability remains a separate operational measurement, not something a design PDF or local test can prove. Current test results and deployment status are in [the implementation report](CORE_TURN_IMPLEMENTATION.md).
