# System 4 memory implementation

This report covers the supplied VALOR System 4 Memory System Master Specification, SHA-256 `b6e97d3b9d695243d8ff1e5208c009275022403cc3c3f0fe24413524557f8459`. It describes the memory system, rather than the older repository numbering in which System 04 meant themes. No production deployment or live database migration was performed.

## 1. Files and modules

| Module | Responsibility |
| --- | --- |
| `src/game/memory-contracts.ts` | Validated memory types, cognition, links, consolidation lineage, and mutation snapshots |
| `src/game/memory.ts` | Formation, retention, recall, consolidation, anchors, mutation, invalidation, inspection, rebuild, and timeline binding |
| `src/game/memory-routes.ts` | Authorized player and Creator interfaces with revision checks and idempotent writes |
| `src/game/model.ts`, `engine.ts` | Optional legacy-compatible cognition, database persistence, effect formation, scene/day consolidation, save inheritance, and refresh compatibility |
| `src/game/information.ts`, `information-extensions.ts`, `information-operations.ts` | Formation from actual observation/acquisition, timeline scope, memory-based retelling, and dependency tracing |
| `src/game/context.ts`, `information-context.ts`, `information-access.ts`, `epistemics.ts` | Bounded subjective recall and detail-aware context, without raw private cognition or mutation history in player projections |
| `src/game/actions.ts`, `simulation.ts`, `turn-kernel.ts`, `routes.ts` | Selective effects, offscreen goal experience, freeform recall/significance, and API registration |
| `public/phone-apps.js`, `public/app.js`, `public/sw.js` | Journal recall and anchors, Creator inspector/repair, updated shell cache |
| `src/app.ts`, `src/cli.ts` | Schema 50 readiness and recovery rehearsal |
| `tests/system04-memory.test.ts`, `tests/system04-memory-ui.test.ts` | Memory acceptance, real persistence/branching, command retries, scaling, browser and accessibility checks |

Foundation, libSQL, Turso, save and release assertions advance to schema 50. Existing local System 3 work was preserved and integrated.

## 2. Database migration

`050_system04_memory.sql` adds nullable, JSON-validated `character_memories.cognition_json`. Existing memory columns and primary keys remain intact. Indexes cover timeline/owner/time, timeline/source event/owner, and timeline/owner/status/type. Full memory objects already participate in the existing compressed snapshot blocks, so cognition, mutations and consolidation lineage survive saves, exports, imports and branches without a second snapshot format.

Deployment uses the existing backup/migration workflow. `npm run migrate` applies migration 050; startup also applies migrations. Readiness and release rehearsal require version 50. Legacy fixtures without the new column remain readable and writable. The live database was not opened or migrated during implementation.

## 3. Memory contracts and indexes

Each memory keeps its observer and source event alongside optional versioned cognition. Cognition contains type, timeline, inherited timeline, validity bounds, observation/acquisition IDs, scene, formation time, entity/location/topic links, retained fragments, gist, detail, confidence, accessibility, informational and emotional salience, source strength, interpretation, status, anchor, recall/reinforcement counts, consolidation and mutation history.

Supported types are episodic, semantic, source, procedural, spatial, recognition, social, relationship and routine. External records remain System 3 records; reading them can produce a separately sourced internal memory. Procedural familiarity never grants skill points.

Disposable source lookup maps are reconstructed from state. SQL indexes and direct event/entity/location/topic matching require no embedding provider. An unavailable semantic index cannot prevent direct recall. No generated embedding determines memory truth.

## 4. Formation and consolidation

The authoritative commit pipeline forms memories from observer-filtered effects. System 3 observation and acquisition paths form memories immediately from their actual stored sources. Partial observations retain only their perceived text and confidence. An observation that also grants a proposition produces one memory with both source links. Reprocessing the same event, owner and perceived text merges provenance without adding reinforcement or independent corroboration.

Consequential categories such as threats, injuries, arrests, death, confessions, promises, evidence, betrayal and rescue receive at least 0.85 informational salience. Ordinary attended experience is lower priority; effects below 0.35 are not retained. Explicit threat/promise/confession wording can affect retention, but never establishes a canonical crime or a player emotion. Exact fragments must be substrings of perceived content and belong to a quote-sensitive category. Routine conversation stores gist rather than a durable verbatim quote.

Location departure consolidates the closing scene's routine experience. Crossing a canonical day also consolidates offscreen routines; Creators can invoke consolidation directly. At least three matching ordinary experiences form a routine/familiarity summary. Matching uses owner, type, location, linked entities, topics and gist. Summary confidence is the minimum supporting confidence. Salient episodes, emotional exceptions, anchors and retained significant quotes are excluded from compression. Underlying episodes remain stored, linked and inspectable; only their active recall status changes. Summaries retain exception IDs and source hashes. This is conservative deterministic pattern grouping, not an AI inference that different experiences necessarily express the same habit.

## 5. Decay and accessibility

All age calculations use the canonical game clock. Real-world inactivity has no effect. Retention is an exponential half-life model: episodic base 30 days, stable/familiarity types base 180 days, multiplied by informational salience, explicit emotional salience, reinforcement and anchor status. Major events have a retrieval floor; grounded unresolved questions/promises/threats receive elevated retention until resolved.

Accessibility, available detail, significant wording, confidence and source recall decay separately. Source strength and exact wording can weaken while the claim's gist remains accessible. Retrieval supplies only available fragments/gist; missing wording never becomes a fabricated quotation. Reinforcement restores accessibility without increasing source confidence or restoring lost original wording. Failed recall does not remove stored history. Hot/warm/cold labels use canonical recency; cold records can be recovered by real stored cues.

Legacy memories retain their previous configurable decay behavior until an explicit System 4 mutation upgrades them. Read-only inspection does not migrate, reinforce or change them. This preserves existing campaigns and the legacy epistemic API.

## 6. System 3 recall interfaces

`recallMemories(state, ownerId, cues)` is the bounded core interface. Cues include query text, entity IDs, location, topics, event IDs and an explicit-recall flag. It filters owner, source ownership, invalidation, timeline and time before returning at most 50 records; normal context requests 20. Results distinguish confidence, detail, retained quotes, source recall, current interpretation and stale status. A matching location is a legitimate cue even when the query has no matching words.

`recallInformation` supplies sanitized player results. Context manifests use the same recall interface and existing token/category budgets. Old observations linked to memories stop being injected as exact narration context after one game day; current observations and recent live dialogue retain their separate immediate-context role. Stored provenance remains inspectable through the authorized information tools.

Player APIs, under `/game/timelines/:id/memory`:

| Method and suffix | Behavior |
| --- | --- |
| `GET /recall?characterId=...&query=...` | Read-only recall; no time, knowledge or reinforcement mutation |
| `POST /recall` | Explicit, revision-checked recall with audited reinforcement |
| `POST /anchor` | Mark an existing owned memory significant; no world time |
| `GET /inspect?characterId=...&offset=...` | Creator-only, paginated full provenance and recall explanation |
| `POST /developer` | Creator-only source/backstory grant, mutation, consolidation or rebuild |

Writes require the existing CSRF, idempotency and revision protocol. Player writes require control of the selected character. Freeform `What do I remember about ...?` uses recall without advancing time. `I never forgot that`, `I will never forget that`, or the controlled character's name with that wording anchors the most recent recalled experience; Journal provides precise selection. Neither path invents an underlying event.

## 7. PC and NPC behavior

Player memories default to zero emotional salience with no inferred fear, trauma, grief, attraction or fixation. Trusted simulation hooks accept explicit player/mechanic authority; NPC emotional weighting accepts NPC-state authority and rejects its use for a playable character. System 4 does not diagnose trauma or invent emotions.

NPC decisions receive accessible memories through the existing System 3 planning profile; memory is evidence/context rather than a forced action. NPC goal experience can persist without narration. Relationship memories are owner-specific, and changes in trust or interpretation do not erase the original episode. Existing live-dialogue and active-question context remains responsible for conversation continuity.

Automatic gossip uses current accessible remembered interpretation when linked memory exists. `retellMemory` provides an explicit information-service hook, preserving original rumor roots while sending the current remembered account. Forgetting attribution does not destroy system-level provenance.

## 8. Timeline integrity

Persistence binds cognition to its actual timeline. New child timelines inherit only the selected snapshot's memories, recording their parent timeline. Existing timelines reject mismatched cognition. Future formation/experience is excluded; a rewind continuation invalidates memories beyond its clock. Sibling state is never consulted. Context assembly rejects a timeline scope different from the loaded memory state.

Canonical source records are not edited by memory mutations. Snapshot checksums, chunk integrity and existing import/recovery controls continue to apply.

## 9. Creator tools

Creator → Memory inspector and repair shows full records, source links, salience reasons, mutation snapshots, consolidation, timeline lineage and calculated recall state. Preview is read-only. Mutations include anchor, reinforce, weaken, reinterpret, contaminate, source confusion, correction, stale marking and invalidation.

Grants require an observation/acquisition owned by the selected character, or explicit authored backstory. Interpretation/contamination/correction/source-confusion require an experienced cause. The player Journal offers a search and an existing-memory anchor control with confidence/detail/source labels.

## 10. Repair and rebuild

Invalidation preserves the bad record for audit and excludes it from recall. Corrupt source ownership can itself be invalidated. Dependency tracing includes acquisition, summaries, transmissions, relationships, hypotheses and consolidated memories. Creator repair reports committed narration-context events that depend on affected IDs; those committed events remain intact for a deliberate later branch/retcon decision.

Rebuild clears disposable lookups, reactivates eligible underlying episodes and regenerates routine projections from their sources. It preserves original observations/events and existing summary mutation history. Unrebuildable summaries become invalid rather than being silently deleted. Creator writes retain their normal canonical operation event and receipt.

## 11. Acceptance and verification

`tests/system04-memory.test.ts` contains 21 tests spanning all 40 scenarios in specification section 28. Tests group related scenarios rather than asserting one implementation function per test. Coverage includes immediate threats; routine and exception handling; partial/different observers; source forgetting; exact/gist recall; PC and NPC agency; anchors and reinforcement; recognition/spatial/procedural familiarity; contamination; invented-history rejection; relationship reinterpretation; time skips and offscreen experience; location/object cues; failed recall; external record recovery; branch/rewind isolation; read-only inspection; corruption/dependencies; 10,000 memories; duplicate provenance; semantic patterns; stale knowledge; NPC planning; live dialogue/open questions; cold recovery/index failure; real database persistence, snapshots, and inherited lineage.

`tests/system04-memory-ui.test.ts` exercises authenticated mobile recall and anchors, verifies unchanged world time, checks mobile/iPad overflow, captures both viewports and runs axe accessibility validation.

Verification performed:

- `npm run check` passes; browser JavaScript also passes syntax checks.
- The initial `npm test` run executed 425 tests, with 422 passing and three failures. The trait fixture's non-UUID event ID and legacy alias projection were corrected and their 11-test compatibility rerun passed. The large-world performance failure was corrected and its isolated rerun passed. The full 425-test suite was not repeated after those fixes.
- The System 3/System 4/browser validation run passed 55 tests, including all 21 memory acceptance tests and mobile/iPad accessibility. Core command suites were also exercised. After the persistence optimization, the final eight-suite run passed all 78 tests covering information, memory, epistemics, traits, NPC profiles, saves, release/recovery and the browser UI.
- The 10,000-memory fixture produced a 2,712-token context in approximately 250–360 ms on focused runs (runtime varies with concurrent tests).
- The existing 1,001-NPC/1,000-lore benchmark completed ten hourly turns in 28,803 ms, within its unchanged 30,000-ms ceiling. Import took 6,065 ms and retrieval took 2,573 ms.

Local logs are under `artifacts/system04-*.log` and are not production data. Mobile/iPad screenshots were visually inspected; axe reported no violations.

## 12. Performance and storage

The 10,000-memory acceptance fixture returns bounded recall and a context below the existing 4,000-token profile budget. Recall uses deterministic direct matching and disposable source maps without AI calls or embedding costs. Source observations are indexed once for detail-aware context filtering. Observer-filtered effects are computed once per witness and shared by memory and information formation. Sanitizers reuse indexed identity data, and incremental persistence compares against the transaction's prior state to skip unchanged facts, knowledge, beliefs and memories. New, changed, imported and branched records still persist normally.

Durable storage grows with retained experiences and audited mutations; consolidation bounds active recall, not total historical storage. The engine still loads timeline state and scans/ranks candidates in memory; this is not database-paged arbitrary-scale storage. No automatic deletion or paid external service was added. Confidence, quotes and salience never rise merely because an imported event was duplicated.

## 13. Design decisions and boundaries

No author decision blocks this implementation. Retention half-lives, grouping threshold, 0.35 formation cutoff, critical salience floor, and one-day immediate-observation window are deterministic defaults. They can be tuned later without rewriting canonical history. Existing domain resolvers remain responsible for perception, identity, competence, emotion authorization and actual consequences. Memory does not add a psychology simulator, arbitrary fabricated backstory, automatic flashback presentation, or an embedding dependency.

System 5 work was not started.
