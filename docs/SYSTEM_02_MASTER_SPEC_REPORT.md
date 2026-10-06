# System 2 master specification implementation

This release implements the supplied **VALOR System 2 Narrative AI Storytelling Master Spec**. It extends the existing narrator with independently reviewed generative prose, scoped director controls, actual scene and NPC style history, perception-aware communication, and state-backed subjective experiences. System 3 is unchanged.

## Files, versions and migration

New modules:

- narrative-directives-contract.ts and narrative-directives.ts: strict directives, OOC parsing, permission checks, scoping, expiry and one-response consumption.
- narrative-review.ts: structured semantic review, literal/agency/number/era/voice guards, and fail-closed verdict validation.
- narrative-style.ts: rolling metrics, scene windows, per-NPC lines, repetition motifs and targeted repair instructions.
- perception-contract.ts and narrative-perception.ts: authored perception, attention, distance, partitions, channel reception, and subjective experience contracts.
- tests/system02-master-spec.test.ts: acceptance and adversarial regressions.
- migrations/048_narrative_directives.sql: indexed, user/character/timeline/mode-scoped presentation metadata.

Integration changes cover the narrative runtime, preferences UI, AI gateway and accounting, communication, observer projection, turn kernel, engine, model, and readiness/release checks. Versions: schema **48**, rules **core-turn-v5**, prompt **narrative-v3**, validator **narrative-validator-v3**, shell **v29**.

Migration 048 is additive. New character perception, voice channel variants, location detail categories/skill requirements, and campaign narrationAttempts fields have compatible defaults; narrationAttempts defaults to 2 at render time rather than changing legacy serialized settings and save checksums. Existing authored content needs no destructive backfill. Original event bundles and prior narration versions remain immutable.

## Input, output and API contracts

The frozen NarrativeBundle contains observer-safe ordered facts, classification and source IDs, exact or flexible speech, mode, profile/layers, scene ID, clock/location, focus/voices, control handoff, content exclusions, private PC authorship, location detail fingerprints, and bounded style/conversation history.

Provider output is a strict object with paragraphs (sourceIds and text) and optional empty additions. It cannot contain mutations. Required sources occur exactly once and in order. Exact PC speech and high-stakes NPC speech retain their words. Nonliteral facts and flexible NPC utterances may be paraphrased, subject to local guards and a separate semantic review request.

The semantic reviewer receives only the permitted sources, candidate paragraphs and presentation constraints. It returns an explicit verdict for every paragraph and each applicable fidelity category. Missing verdicts, wrong IDs, uncertainty, defects, provider errors, malformed JSON and budget exhaustion cannot approve a candidate. Citing a source is not enough to authorize prose.

POST /game/timelines/:id/commands accepts:

    {"kind":"narrative_directive","directive":{"scope":"one-response","patch":{"responseLength":"short","narratorTone":"warm"}}}
    {"kind":"regenerate_narration","turnId":"<event-uuid>","patch":{"perspective":"first","tense":"present"}}

Directives additionally accept a visible focusId or explicit private interior. Supported scopes are one-response, scene, character, campaign and user. Campaign changes require Developer authority. Regeneration appends a presentation version, updates the displayed Chronicle, and preserves the original event bundle, outcomes, clock and handoff. Subsequent AI rendering respects its saved regeneration profile.

OOC:, [OOC] and /ooc are recognized outside quoted speech. Mixed input is separated before interpretation. OOC queries use observer-safe knowledge, Chronicle recap or available actions. Examples include “keep the next reply short,” “balanced dialogue,” “focus on Malik,” and “PC interior: I am jealous but hiding it.” Unknown/ambiguous focus and partially recognized truth-changing instructions are rejected without partial application.

## Player, Developer, Game and Story behavior

Phone → Settings → Writing preferences provides all independent profile controls, scoped sparse overrides, presets, and optional changes to both modes. Next response is a separate temporary scope. OOC results appear in an accessible dialog and do not advance world time or resolve a pending action.

Game Mode provides Say/Sign/Write, recipient, language, tone, volume and preview-only Auto-Phrase. A nonverbal PC cannot use vocal speech. Audibility combines channel capability, language, consciousness, authored distance and partitions, ambient noise and attention. Partial reception does not grant full propositional knowledge. Feigning inattention differs from actual distraction. Group membership alone does not generate reactions.

Story Mode continues from resolved events without repeating the player’s dialogue or manufacturing the PC’s response. Private interior remains explicitly player-authored. NPC voices use authored vocabulary, syntax, register, humor, channel variants, forbidden tendencies, examples and recent actual lines. The simulation retains ownership of speech intentions, decisions, consent and reaction windows.

Only Developer diagnostics expose the frozen context, profile layers, raw bounded attempts, review verdicts, defects, retry details, final prose, latency, provider/model, token usage and validation scores. Player projections omit voice internals and raw perception/subjective schedules, including future experience metadata.

## Settings and inheritance

Defaults: third-person past, close active-PC perspective, grounded literary, balanced description, medium length, minimal exposition, restrained dry humor and strong cliché control.

Independent controls cover POV, tense, distance, description, literary directness, dialogue, length, pacing, narrator tone/custom tone, profanity, exposition, professional detail, graphicness, cliché strength, dreams, sensory/metaphor/emotional detail, humor, feedback and signed-dialogue presentation. Creator controls add examples, prohibited/discouraged phrases, motifs, cooldowns and tone bounds.

Resolution is default → account → campaign → character → scene → one-response, independently for GAME and STORY. Omitted fields inherit. Scene directives expire at scene changes. One-response directives are consumed with the next committed turn in their selected mode, not by inspection, switching, clarification or rendering retries. Transaction rollback also rolls back consumption.

Detail controls select eligible authored material. Professional details may require a particular skill and minimum rating; expertise restrictions apply to player projections as well as narration. Graphic and exposition controls suppress optional detail without hiding required outcomes. The prose reviewer also checks style on flexible wording. Style controls cannot force invented content or extra events.

## Perception, locations and memory

Location fingerprints retain individual descriptions/details so subsequent turns can describe changes without repeating the baseline. Explicit focus can request a known description again. Sensory texture respects sight/hearing capability; unconscious narration withholds surrounding events rather than providing an offscreen camera.

Subjective experience records have a separate local ID, kind (dream/hallucination/distortion), text, established cause, severity and validity interval. They produce clearly subjective optional prose, never persistent people, objects, relationships, NPC memories or inventory. Dream settings govern display and recurrence. They cannot reveal facts not supplied through the character’s authorized subjective state.

History is bounded to 50 turns. Actual scene IDs define the scene window; immediate, medium and character-long windows remain separate. Per-NPC history uses accepted rendered lines where available. Exact phrases, semantic gesture/motif families, openings, endings, joke patterns and dialogue continuity support repetition checks. Metrics include sentence/paragraph length, dialogue, fragments, profanity, metaphor/sensory cues, vocabulary complexity, sarcasm, internal interpretation and exposition. Sustained trends, rather than one unusual turn, produce drift warnings.

## Validation and retry

Local hard checks cover the output schema, source authorization, required coverage/order/uniqueness, additions, literal speech, numeric claims, era, obvious PC agency violations, offscreen cuts and NPC voice constraints. Exact realizations retain the deterministic validation path.

Flexible prose additionally requires semantic checks for state, agency, knowledge, identity, space, time, inventory, health, handoff, dialogue/voice, style, combat, consent, audibility, professional procedure, subjective perception, lore and montage. These checks explicitly reject invented objects/actions/weather, false mutuality, promoted rumors, narrator NPC interiority, altered combat outcomes, unsupported expertise, prophecy and consumption of a reaction window.

Soft repairs preserve supported POV/tense, literal formatting, optional detail density, repetition, excluded content and paragraph pacing. Diagnostics distinguish rule-based scores from semantic review.

Campaign narrationAttempts is 1–2 (default 2). Every attempt uses the same frozen facts and outcomes. Each flexible draft can make one separately budgeted 12-second review call; exact prose needs none. Retry instructions identify the defect. Failure leaves deterministic state-faithful narration playable. Provider output remains buffered; cancellation during review cannot install unreviewed prose. Reported usage includes rejected attempts and reviews rather than only the successful call. Monetary cost is not invented when a provider supplies no price.

## Verification

The final local release run and deployment checks are recorded in artifacts/system02-completion-verification.json and artifacts/system02-completion-deployment.json.

Existing narrative acceptance scenarios cover default/style changes, exact communication, agency, lies/false beliefs, group focus, locations, weather, combat, romance, work, lore, callbacks, time skips, retries, regeneration and outages. Added tests cover both-mode generative prose, independent rejection, literal/voice constraints, incomplete reviews, cancellation, real scene history, per-NPC phrase ownership, perception, dreams, OOC focus, private authorship, one-response/scene expiry, and sparse settings.

Final full-suite result: **391 passed, 0 failed, 0 skipped, 0 cancelled across 71 files; exit 0**. A preceding complete run also passed 391/391. The final run includes the legacy metadata-checksum restore regression.
TypeScript, public JavaScript syntax and whitespace checks passed. The production dependency audit reported 0 vulnerabilities. Browser/accessibility, schema-48 migration/release rehearsal, backup/recovery and legacy-save checks passed. The 1,001-NPC/1,000-lore benchmark completed ten turns in 28044 ms against its unchanged 30,000 ms limit. Logs: [full release suite](../artifacts/system02-completion-release-tests.log), [legacy saves](../artifacts/system02-legacy-saves.log), [machine-readable verification](../artifacts/system02-completion-verification.json). Live deployment and authenticated smoke results are recorded separately after the push.

## Manual acceptance

1. Confirm /readyz reports schema 48 and deployed asset hashes match the release.
2. Change POV/tense/tone and play; earlier Chronicle and world state remain unchanged.
3. Apply a next-response OOC directive; inspect/switch mode, then commit in its mode and verify consumption.
4. Mix an action with private interior; NPCs learn nothing unless actually communicated.
5. Set scene focus, leave, and verify expiry; ask about an unknown NPC and verify no hidden information.
6. Test a nonverbal PC, literal multiline speech, noisy whispers, partitions, distance and distracted listeners.
7. Render three distinct NPC voices and inspect their separate history; reject an invented therapy monologue.
8. Regenerate less flowery prose and compare events, state, clock and handoff.
9. Render an established dream/impairment and an unconscious interval; verify no external state changes or offscreen narration.
10. Interrupt or reject semantic review; verify buffered output, targeted retries, accurate usage and grounded fallback.

## Performance, accessibility and operational limits

The narrator makes no simulation decisions. Profiles, OOC, style history, perception gates and fallback require no model calls. Directive lookup is indexed and capped; history, context, drafts, review output, retries and provider timeouts are bounded. A flexible reply costs an additional review call per attempted draft, with worst-case processing of approximately 48 seconds plus local work at the default attempt limit.

Semantic review is probabilistic, not mathematical proof of literary correctness. Local constraints and immutable mechanics remain deterministic; uncertainty/errors trigger fallback. Style scores and motif detectors are heuristics. Acoustic distance/partition/noise values are game abstractions. Domain systems supply expertise, symptoms, memories, dreams and events; the renderer cannot invent missing canon to make a passage longer.

Responsive UI and automated mobile/iPad-size Chromium/accessibility checks are included in the suite. Physical iPad/Safari/VoiceOver and long-term production literary quality require real-device/use evaluation. These external observations are not claimed from local tests. No undecided author choice blocks this release.
