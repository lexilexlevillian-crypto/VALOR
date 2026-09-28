# SYSTEM 10 — Chronicle, Narrative Input, and Scene Presentation

Status: implemented and tested.

## Chronicle contract

The Player Mode Chronicle is prose-first. Each observer-owned turn contains:

- immutable action input and source event ID;
- grounded or validated narration;
- narration status and creation time;
- a scene snapshot with clock and permitted location identity;
- a bounded list of observer-filtered change notices.

Narration and notices are separate. Prose remains the primary reading surface; state changes stay collapsed under `What changed`. Notices cover time, items, health, money, contacts, known relationships, known cases, messages, clues, and combat. They contain concise labels and descriptions rather than raw state JSON.

Both the before and after state are passed through `observerView` before comparison. Creator-only relationships, undiscovered evidence, secret fields, hidden contacts, and unknown people therefore cannot leak through a diff. Saves, exports, imports, and branches preserve the stored scene/notices JSON. Migrated legacy turns open with their creation time and an unknown historical location rather than fabricating a scene.

## Presentation and transcript

The screen provides a scene/time/location header, semantic transcript section, one labeled article per turn, preserved multiline player input, long-form prose, per-turn scene metadata, expandable consequences, narration controls, composer status, and a current-scene dossier.

Dialogue, observations, phone events, clues, combat effects, time advances, and consequences remain grounded in committed effects. The `look`, `search`, and new target-scoped `inspect` actions are explicit game actions. Inspect requires an observer-visible target and, for located records, presence or ownership.

Unread incoming-message and newly arrived turn badges use quiet `aria-live="off"` indicators. They never focus the player’s cursor or interrupt composition.

## Composer and agency

The composer is a labeled, resizable multiline textarea with a 1,000-character server-aligned limit. Enter inserts a line; Ctrl+Enter or Command+Enter requests review. Draft text is written to session storage under user/timeline/character scope and survives navigation, reload, and reconnect within the browser session. It clears only after the corresponding turn commits.

Example buttons only insert sample text. Parsing or optional Gemini interpretation always produces a review card; neither path mutates state until explicit confirmation. Canceling a proposal preserves the draft. Free text remains available beside the complete explicit-action panel, so optional affordances never constrain intent.

## Streaming and transaction boundary

Narration rebuild has its own cancel control and request `AbortController`. Incoming NDJSON paragraphs are buffered in memory and are not displayed until a terminal `complete` event arrives. Cancellation or malformed/incomplete output leaves the prior prose intact.

The server propagates request disconnects into narration generation and races cancellation independently of provider cooperation. It validates the complete result, checks cancellation again inside the commit transaction, and then atomically updates narration plus usage status. A canceled generation records canceled usage but does not modify the story turn, mechanics, timeline revision, or displayed prose. Generation never rerolls the source action.

## Example turn

Narrated result:

> Rain ticks against the fire escape. The worn brass key carries a narrow stripe of blue paint.

Collapsed `What changed` disclosure:

- Items acquired — Loose brass key
- Time advanced — +1 min · 6/1/2012, 8:01 AM

The disclosure is not inserted into the narration and contains only facts visible to that character.

## Validation and tests

Focused System 10 tests cover:

- scene and change persistence;
- item/time summaries;
- save and branch survival;
- legacy scene fallback;
- knowledge filtering for hidden relationships and undiscovered evidence;
- target-scoped inspect parsing and narration;
- cancellation of a non-cooperative provider;
- unchanged turn prose/status and timeline revision after cancellation;
- canceled AI usage provenance.

The browser acceptance test covers long prose, buffered cancellation, multiline keyboard input, draft survival across navigation and reload, examples that do not mutate revision, proposal confirmation/cancellation, iPad portrait/landscape, mobile layout, reduced motion, offline shell behavior, keyboard focus, and automated accessibility scanning.
