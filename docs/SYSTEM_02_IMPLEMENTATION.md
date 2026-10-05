# System 02 — Narrative and AI Storytelling

Implements the supplied [Behavior Bible](SYSTEM_02_NARRATIVE_SPEC.md) in the existing turn, AI gateway, Chronicle and Creator architecture. The simulation commits first; presentation uses a frozen, observer-filtered bundle. The narrative renderer never receives a world-mutation tool.

## Data and versioning

Migration **047_narrative_runtime.sql** adds:

- Revisioned narrative preferences, scoped to account, campaign, character and scene, separately for GAME and STORY.
- Append-only preference history and custom presets.
- Append-only render records tied to the original game event and accepted narration version.
- Additive character voice/communication fields, character schema **10**, and updated character schema registry triggers. Existing identity and authored content are preserved.

Readiness, export/import reporting and release rehearsal now expect database schema **47**. The core ruleset is **core-turn-v4** because explicit communication and NPC speech handoffs are simulation behavior. Existing saves accept the additive default fields. The application applies the migration transactionally during release startup; `/readyz` verifies schema 47.

## Modules and integration

| Module | Responsibility |
|---|---|
| src/game/narrative-profile.ts | Strict profile, override, preset, voice, language and location-detail schemas |
| src/game/narrative-preferences.ts | Authorized persistent settings, inheritance, optimistic revisions, custom presets and developer diagnostics |
| src/game/narrative-runtime.ts | Frozen fact manifest, safe realizations, scene detail selection, conversation continuity, suppression, validation and deterministic prose |
| src/game/communication.ts | Say/Sign/Write, comprehension, asserted utterance facts, conversation links and bounded Auto-Phrase |
| src/game/engine.ts | Freeze mode/profile/context after resolution; commit grounded prose and provenance with the turn |
| src/game/ai.ts; src/ai/gateway.ts | Existing provider pipeline, targeted repairs, bounded retries, buffered validation and atomic presentation commits |
| src/game/actions.ts; simulation.ts; turn-kernel.ts | Explicit communication, NPC intent execution, response windows, travel provenance and safe regeneration |
| src/game/epistemics.ts; turn-visibility.ts | Remove private location details and NPC voice metadata from player projections; preserve spoken wording |
| src/game/routes.ts | Authorized preferences, presets, preview and developer diagnostics endpoints |
| public/narrative-ui.js | Writing preferences, presets, advanced creator controls and communication panel |
| public/app.js; phone-apps.js; play-ui.js | Desktop/mobile integration, visible deterministic fallback, game-feedback presentation |
| src/static.ts; public/sw.js | Serve/cache the new public module; shell cache v28 |

## Profiles and controls

Profiles include perspective, tense, narrative distance, description density, literary intensity, dialogue density, response length, pacing, sensory detail, metaphor, humor, violence, emotional detail, exposition, mechanical feedback and signed-dialogue formatting. Advanced fields include approved/negative examples, discouraged/forbidden phrases, phrase cooldowns, recurring motifs and tone bounds.

Presets: Standard Valor, Straightforward, Literary, Dialogue Heavy and Minimal. Edited compositions are identified as Custom; users can save reusable named presets. Profile versions fingerprint the effective composition and layer revisions.

Inheritance runs from account to campaign to character to temporary scene. Omitted override fields remain omitted; they do not silently reset inherited values. Game defaults use standard feedback; Story defaults use light feedback. Default prose is third-person past. Settings affect future turns. Retry uses the profile frozen with the original turn.

Players reach writing preferences through Phone → Settings → Writing preferences. Creator advanced controls add examples, phrase rules, motifs and tone bounds. Character Studio exposes structured voice/communication fields; location records expose strict/flexible interior policy and public/private detail pools. Developer Mode can inspect the latest narrative context, source manifest, focus, voice sources, suppression, knowledge filters, repairs, rejections, retry count, model/config and fallback usage.

## Game, Story and communication

Both modes use the same simulation. Story continues from the resolved outcomes and keeps exact authored input in the transcript; it does not turn a thought into an objective fact or repeat the player's speech as new authored dialogue. Game provides Say, Sign and Write with recipient, language, tone and volume controls. Auto-Phrase is a preview for a bounded greeting, refusal, location question or status question; the player reviews and submits it explicitly.

Communication checks consciousness, speaking ability, language/channel proficiency, audience and recipient visibility. Unknown language is not translated; partial comprehension receives a partial-understanding notice. Fully understood public speech becomes an asserted utterance fact, not proof that its claim is true. Sign is rendered as language. Literal wording, including multiline speech, survives rendering.

NPCs speak through simulation-owned plans. Plans can require known facts, select authored repetition-aware answers and link answers to heard questions. Comprehension and speech ability are checked. Dead/unconscious NPCs do not speak. A response-requiring NPC speech plan stops interruptible time advancement at its execution point. NPC-to-NPC initiative remains bounded by the existing simulation budget. Voice registers use authored relationships; terse/humorless voice restrictions outrank stylistic preferences.

## Validation, repair and failure behavior

The fact manifest separates REQUIRED, OPTIONAL and UI_ONLY sources; hidden state is removed before generation. The detail type vocabulary also distinguishes state, event, generated-canon, decorative and invalid details. This implementation supplies state/event-backed material and does not promote generated decoration to canon.

Validation checks authorized sources, required-fact coverage, unique event use, event order, literal speech, approved realizations and bounded output. Together these prevent unsupported physical results, player actions/interiority, hidden knowledge, new objects, new dialogue, added time and extension beyond the frozen handoff. Optional detail selection applies density, length, sensory, content and repetition constraints even when a model combines optional and required sources in one paragraph.

Wrong supported POV/tense and literal formatting receive targeted deterministic repair. Optional repetitive or disallowed texture is removed without erasing required facts. Structural failures retry at most once through the existing AI gateway, with repair instructions and the identical source bundle. Mechanics never reroll. Repeated failure retains the committed deterministic prose. Raw provider text and invalid partial streams are never installed in the Chronicle; cancellation preserves the prior version.

Every new committed turn records initial presentation provenance. Accepted AI/grounded rerenders and deterministic command regeneration record the original turn/events, full profile snapshot/layers, prompt, provider/model/config, validator version and retry count. Failed render records retain fixed failure codes and repair reasons. External-provider provenance labels player speech, NPC speech and creator description as untrusted data.

## Verification

The 52 requested scenarios have explicit automated coverage in tests/system02-narrative.test.ts. Additional tests exercise real browser communication/preferences, inheritance conflicts and authorization, immutable audit records, actual retry request repair, speech handoffs, repetition-aware answers and multiline grammar. Existing browser, API, save/restore, migration, simulation and provider suites are included in the full regression run.

Verified locally on 2026-10-05:

- TypeScript: npm run check passed. Public JavaScript syntax checks and git diff --check passed.
- Full suite: **371 tests across 70 files; 0 failures, 0 skips**, runner exit 0.
- After the final player-response metadata privacy correction: **42 targeted tests across 3 files passed**, including all System 02 scenarios, the real mobile browser flow and core turn regressions; runner exit 0.
- All **52** numbered acceptance scenarios are represented in the matrix below and passed.
- Real browser checks cover saved preferences, no time advancement from settings/preview, literal multiline speech, grounded availability, 390 px layout and automated accessibility. Screenshots: artifacts/system02-writing-mobile.png and artifacts/system02-communication-mobile.png.
- Large roster: 1,001 NPCs, 1,000 lore records, ten hourly turns in **28,423 ms**, under the unchanged 30,000 ms ceiling. This is a local regression benchmark, not a production SLA.
- Schema-47 readiness, backup/recovery rehearsal, legacy character migration, tenant access and immutable history checks passed in the full suite.
- Logs: artifacts/system02-full-final-tests.log and artifacts/system02-final-safety-tests.log. Verification manifest: artifacts/system02-verification.json. Final source fingerprints: artifacts/system02-source-hashes.json.
- These results describe local verification before deployment. Live release results are recorded separately in artifacts/system02-deployment.json.

## Acceptance matrix

| Scenario | Requirement | Automated evidence |
|---:|---|---|
| 1 | Default third-person past narration remains stable. | S02-01: Default/first-person rendering and targeted grammar repair |
| 2 | First-person present works without drift. | S02-02: Default/first-person rendering and targeted grammar repair |
| 3 | Rich description increases texture without fabricating interactable objects. | S02-03: Rich/sparse state-backed description and hidden location pools |
| 4 | Sparse description retains essential spatial/actionable information. | S02-04: Rich/sparse state-backed description and hidden location pools |
| 5 | Game Mode Say preserves exact player dialogue. | S02-05: Exact communication, nonverbal methods, language comprehension and utterance knowledge |
| 6 | Nonverbal PC uses sign/writing correctly. | S02-06: Exact communication, nonverbal methods, language comprehension and utterance knowledge |
| 7 | Auto-Phrase adds no extra intent. | S02-07: Bounded Auto-Phrase; preview has no state effects |
| 8 | Player thought remains private and non-objective. | S02-08: Private thoughts, hidden attraction, lies, unidentified stains and theories |
| 9 | Hidden NPC attraction remains hidden. | S02-09: Private thoughts, hidden attraction, lies, unidentified stains and theories |
| 10 | NPC cannot reference knowledge they lack. | S02-10: Knowledge-gated NPC speech and dead-speaker exclusion |
| 11 | Lying NPC is not labeled as lying without player knowledge. | S02-11: Private thoughts, hidden attraction, lies, unidentified stains and theories |
| 12 | Unknown stain is not called blood before identification. | S02-12: Private thoughts, hidden attraction, lies, unidentified stains and theories |
| 13 | Familiar location uses delta description. | S02-13: Location fingerprints and persistent damage |
| 14 | Persistent damage remains present. | S02-14: Location fingerprints and persistent damage |
| 15 | Wrong POV output is repaired. | S02-15: Default/first-person rendering and targeted grammar repair |
| 16 | Invented PC forgiveness is rejected. | S02-16: Adversarial unsupported-claim rejection with unchanged state |
| 17 | Miss narrated as hit is rejected without reroll. | S02-17: Adversarial unsupported-claim rejection with unchanged state |
| 18 | Unknown NPC name does not leak. | S02-18: Observer labels for concealed identity |
| 19 | Multi-NPC scene avoids round-robin speech. | S02-19: Resolved-speaker focus and bounded NPC initiative |
| 20 | NPC-to-NPC interaction does not become endless cutscene. | S02-20: Resolved-speaker focus and bounded NPC initiative |
| 21 | Very Long output still stops at weapon-draw reaction window. | S02-21: Reaction handoff, clock and combat-event preservation |
| 22 | Fast pacing does not alter world time. | S02-22: Reaction handoff, clock and combat-event preservation |
| 23 | Slow pacing does not invent PC interiority. | S02-23: Adversarial unsupported-claim rejection with unchanged state |
| 24 | Dialogue-heavy mode does not make taciturn NPC verbose. | S02-24: Voice precedence, exact threats and meaning-preserving casual variants |
| 25 | High humor does not make humorless NPC funny. | S02-25: Voice precedence, exact threats and meaning-preserving casual variants |
| 26 | High romance does not manufacture attraction. | S02-26: Adversarial unsupported-claim rejection with unchanged state |
| 27 | Combat prose preserves exact event count and positions. | S02-27: Reaction handoff, clock and combat-event preservation |
| 28 | NPC kiss does not create reciprocal PC kiss. | S02-28: Adversarial unsupported-claim rejection with unchanged state |
| 29 | Work shift compression stops at important event. | S02-29: Real work compression and mandatory handoff |
| 30 | Travel summary preserves actual passengers and time. | S02-30: Travel facts, selective lore and rumor attribution |
| 31 | Sleep does not invent dream. | S02-31: Adversarial unsupported-claim rejection with unchanged state |
| 32 | Retrieved lore is not dumped automatically. | S02-32: Travel facts, selective lore and rumor attribution |
| 33 | False rumor remains rumor/belief. | S02-33: Travel facts, selective lore and rumor attribution |
| 34 | Foreshadowing uses actual causal signs. | S02-34: Adversarial unsupported-claim rejection with unchanged state |
| 35 | Wrong player theory is not omnisciently corrected. | S02-35: Private thoughts, hidden attraction, lies, unidentified stains and theories |
| 36 | Repetition damping suppresses recent generic cues. | S02-36: Semantic cue suppression, motif cooldown and stable straightforward profile |
| 37 | Character signature may recur selectively. | S02-37: Semantic cue suppression, motif cooldown and stable straightforward profile |
| 38 | Straightforward profile does not drift poetic over long play. | S02-38: Semantic cue suppression, motif cooldown and stable straightforward profile |
| 39 | 2012 tech violations are repaired. | S02-39: Adversarial unsupported-claim rejection with unchanged state |
| 40 | Repeated AI validation failure produces fallback without state loss. | S02-40: Frozen profiles, capped retries, outages, regeneration and future-only settings |
| 41 | Game Mode remains playable during narration outage where deterministic actions exist. | S02-41: Frozen profiles, capped retries, outages, regeneration and future-only settings |
| 42 | Story Mode preserves complex input rather than guessing unsafely during parsing outage. | S02-42: Frozen profiles, capped retries, outages, regeneration and future-only settings |
| 43 | Regenerate changes prose only. | S02-43: Frozen profiles, capped retries, outages, regeneration and future-only settings |
| 44 | Mid-campaign narrative setting changes future prose only. | S02-44: Frozen profiles, capped retries, outages, regeneration and future-only settings |
| 45 | Unknown language is not auto-translated. | S02-45: Exact communication, nonverbal methods, language comprehension and utterance knowledge |
| 46 | Sign language requires recipient comprehension. | S02-46: Exact communication, nonverbal methods, language comprehension and utterance knowledge |
| 47 | Publicly spoken secret can become audible knowledge. | S02-47: Exact communication, nonverbal methods, language comprehension and utterance knowledge |
| 48 | Offscreen event is not narrated omnisciently. | S02-48: Adversarial unsupported-claim rejection with unchanged state |
| 49 | Clue exists before discovery. | S02-49: Adversarial unsupported-claim rejection with unchanged state |
| 50 | Decorative prose detail does not become evidence automatically. | S02-50: Adversarial unsupported-claim rejection with unchanged state |
| 51 | Exact canonical NPC threat remains exact after rerender. | S02-51: Voice precedence, exact threats and meaning-preserving casual variants |
| 52 | Semantic casual dialogue may be rephrased without changing meaning. | S02-52: Voice precedence, exact threats and meaning-preserving casual variants |

## Deliberate limits

- The existing fail-closed narration contract remains in force: providers arrange approved, fact-preserving realizations and verified casual equivalents. Arbitrary free-form model prose is not accepted merely because it cites a source. Literary variety therefore depends on authored detail pools and approved phrasing; style preferences cannot fabricate texture or force long output in a sparse scene.
- Flexible interiors are supported as an authoring policy, but this renderer does not automatically invent/promote furniture, clues or NPCs. Durable additions still require the existing authoritative authoring/simulation paths.
- Comprehension uses authored channel proficiency and conservative partial-understanding notices, not a translation service. Semantic casual variants use a deliberately bounded equivalence vocabulary; canonical threats stay exact.
- Repetition and conversation presentation use bounded recent history; canonical utterances, events and audit records remain durable. Historical/legacy turns without a System 02 bundle retain their original restricted rendering path.
- Automated provider-contract tests use controlled responses. Production deployment, authenticated gameplay and live-provider results are recorded separately in artifacts/system02-deployment.json; they are not inferred from local test counts.
