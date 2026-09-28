# SYSTEM 12 — Context Engine, Narrative Control, and Story Directives

Status: implemented and tested.

## Context priority ladder

The context engine assembles a bounded manifest in this exact order:

1. **Validated immediate state and system rules** — server clock and settings, observer condition/activity/goals, current location, visible scene participants, and permitted inventory.
2. **Relevant current-scene events** — committed effects visible to the observer, plus recent player input and unresolved conversation questions.
3. **Observer-permitted knowledge** — known, non-retired facts and current beliefs. Corrected beliefs are rejected as stale rather than presented beside truth.
4. **Active Story Cards and directives** — visibility, validity interval, location/character/keyword activation, and authored priority all apply.
5. **Salient memory and relationship history** — decayed memory salience and observer-visible directional relationship history.
6. **Retrieved canon** — only campaign-visible records/fields from the timeline-bound published canon revision.
7. **Optional stylistic material** — active lore and explicit style hints, ranked with the existing lexical/embedding retrieval score.

Every included item records source, category, ladder rank, relevance score, token estimate, repetition status, clarity requirement, and optional contradiction key. Omitted and rejected items record a reason: budget, duplicate, repetition damping, lower-priority conflict, secret, stale belief, expiry, inactivity, unsupported control, or attempted agency/truth override. Observer manifests redact hidden source identity and never echo raw retrieval queries. Creator-only inspection may show the source ID/name needed to diagnose authoring.

The engine sorts by ladder rank before relevance. When two structured claims conflict, the earlier authoritative claim wins and the lower-priority claim is omitted. Corrected beliefs never compete with facts. The model does not arbitrate truth.

## Narrative controls and directives

Active Story Cards become directives when tagged `directive` or with a supported control tag:

- `pov:first-person|third-person|third-person-limited`
- `pacing:slow|measured|brisk`
- `tone:<bounded label>`
- `tension:low|medium|high`
- `spotlight:<visible character UUID>`
- `exclude:<bounded content label>`
- `style` for optional descriptive guidance
- `required` when the card is necessary for scene clarity

Server defaults are third-person limited, measured pacing, grounded tone, observer spotlight, and campaign-derived tension. The immutable safety controls always preserve player agency, require consent, and make server truth authoritative. Tags attempting to control `agency`, `consent`, `truth`, `authority`, or tools reject the entire directive as an authority override. Unsupported tags are reported, not guessed. Directive descriptions remain untrusted stylistic content and cannot create mechanics, canon, or consent.

## Repetition and continuity

Recent Chronicle turns seed a repetition tracker for source facts, six-word phrases, narrative beats, and questions. Repeated optional material is damped during context selection. Validated current events and facts marked required for clarity bypass repetition damping. Narrative output is reviewed after schema/source validation; repeated connective phrasing, beats, questions, or excluded content trigger the existing bounded provider retry/fallback path. The engine flags output and never rewrites it.

Recent player input and unanswered questions are included as conversation continuity beneath committed current-scene events. They remain untrusted context and cannot outrank state or rules.

## Character drift

`checkCharacterDrift` compares a structured NPC response proposal with the NPC's server-side assigned traits, active goals, known fact IDs, current mood, memories, and relationship event history. Unsupported trait/goal/knowledge claims request a retry. Mood or history mismatches request Developer review. The original response is returned unchanged beside flags; the checker never modifies state or manufactures a more convenient truth. Player characters are not accepted as NPC proposals.

Private NPC characterization used by this server-side check is not added to observer context. The check therefore improves consistency without leaking hidden traits, goals, knowledge, mood, or instructions.

## Budgeting, privacy, and inspection

Token estimates use a conservative UTF-8 byte conversion. Required and high-priority entries are considered first; optional material is trimmed until the configured context budget is met. The compact prompt brief is separately byte-bounded, while the full manifest is available through `GET /game/timelines/:id/developer/context-manifest?characterId=...&query=...` to Creator/admin roles. The normal context endpoint returns only the observer-safe manifest.

Secrets are filtered through the existing observer projection before ranking. Hidden lore, Creator-only relationships, undiscovered evidence, corrected beliefs, inactive cards, and expired material cannot enter the model context. Developer inspection can see that a secret source was rejected, but the player response receives only a redacted rejection count/identifier.

## Verification

Focused tests cover the exact ladder order, secret filtering, stale-belief rejection, invalid directive rejection, immutable agency/consent controls, semantic lore/canon ranking, repetition damping, required-fact preservation, repeated phrase/beat/question review, NPC personality/knowledge/mood/history drift, token-budget trimming, and Creator-only source inspection. Existing security, context, narration, cancellation, and Chronicle suites remain green.
