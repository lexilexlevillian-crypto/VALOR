# Integrated game API

All `/game/*` endpoints require the existing authenticated session. Mutations require the exact configured Origin and `x-csrf-token`. Entity, settings, epistemic, catalog and turn mutations also require `Idempotency-Key` and the current timeline `revision`. Clients never supply a random seed, successful result, NPC action or authoritative consequence. Stale revisions fail atomically with 409.

`GET /game/catalog` returns supported entity kinds, their strict JSON Schemas, action schemas and installed narration provider IDs. The Creator and explicit-action UI are generated from these contracts; `src/game/model.ts` is the authoritative schema, not an independent client copy.

## Campaign and character selection

- `GET /game/campaigns/:id/timelines`: campaign timelines and lineage.
- `POST /game/campaigns/:id/timelines`: Creator initializes the original timeline.
- `GET /game/timelines/:id/roster`: characters controlled by the caller.
- `GET /game/timelines/:id/view?characterId=UUID`: observer-filtered entities, knowledge, beliefs, memories and that account's Chronicle. `timeline.turnCursor` is the opaque concurrency cursor required by the next public turn request. Each turn includes a permitted scene snapshot plus bounded `notices` for low-noise `What changed` disclosure.
- `GET /game/timelines/:id/creator`: privileged full state and reference impact data.

Timeline names/lineage are campaign-shared metadata. Players should not place private plot spoilers in timeline names. Save listings and branching are restricted to their creator, except privileged campaign editors.

## Play

`POST /game/timelines/:id/parse` with `{characterId,text}` returns a supported explicit command or clarification without mutating state. Accepted free text is currently a limited grammar, not a general language-action interpreter.

`look`, `search`, and `inspect` are distinct explicit actions. Inspect takes a visible `targetId` and requires presence or ownership for located records.

`POST /game/timelines/:id/turns`:

```json
{"revision":12,"cursor":"<opaque turn cursor>","characterId":"<UUID>","action":{"type":"look"},"text":"look"}
```

Use actual UUIDs, the current cursor returned by `view`, and an idempotency key. Returns `{revision,turnCursor,eventId,traceId,narration,permitted,checks}`. Outcomes, seed and draws, entity state, epistemic changes, event, audit, receipt, grounded prose and autosave commit together. Revision and cursor advance with one database compare-and-swap, so only one tab can advance a shared starting state. Reusing a key with different input fails. Repeating the same request returns its original receipt and never rerolls. Revoked membership or character control is checked before any trace write or receipt replay.

`POST /game/timelines/:id/narrate` with `{turnId,provider}` may arrange already-approved fragments. It never runs simulation again. External providers can return only validated source-grounded or source-anchored output; arbitrary instructions and incomplete fragment coverage fail validation and retain grounded text.

`POST /game/timelines/:id/narrate/stream` accepts the same body and returns NDJSON `paragraph` records followed by one `complete` record. The complete narration is validated and atomically committed before exposure. A client disconnect cancels provider work; cancellation before commit leaves the turn and timeline revision unchanged. Clients buffer paragraphs until `complete` so canceled output is never partially displayed.

`GET /game/timelines/:id/context?characterId=UUID&query=...` returns observer-filtered lexical plus deterministic local semantic retrieval, a bounded System 12 context brief, and an observer-safe inclusion/omission/rejection manifest. Corrected beliefs are rejected as stale. Creator-supplied vectors remain supported; the HTTP endpoint does not call an external embedding provider. `GET /game/timelines/:id/developer/context-manifest?characterId=UUID&query=...` is Creator/admin-only and exposes full source decisions for diagnosis. Narration remains grounded by default; Creator settings may opt into source-anchored prose whose paragraphs cite every committed simulation fragment.

`GET /game/timelines/:id/retrieval?characterId=UUID&query=...&filters=<encoded JSON>` returns observer-permitted lore/Story Cards, beliefs, and recall-eligible memories. Filters may contain `entityIds`, `tags`, `from`, `until`, `placeIds`, `personIds`, `relationshipIds`, `eventIds`, `evidenceIds`, `factionIds`, and `kinds` (`lore`, `storycard`, `canon`). Permission and Story Card lifecycle checks run before lexical/semantic ranking; equal scores use stable ID ordering. `GET .../developer/retrieval` requires Creator/admin write authority and adds rejected source IDs/reasons without echoing rejected secret text. Returned source provenance includes revision, visibility, source references, typed links, validity, activation/deactivation decision, and match components.

## Creator and debugging

- `POST .../entities`: `{revision,entity}` for strict typed create/edit/archive. IDs survive renames and changes to custom section order. Active references block archival.
- `GET .../character-profile-templates`: lists reusable world-owned dossier layouts for authorized Creators.
- `POST .../character-profile-templates`: `{name,characterId}` snapshots a character's persisted stable-ID section layout as a reusable template.
- `POST .../character-profile-templates/use`: `{revision,templateId,characterId}` applies a template through the normal audited/idempotent timeline mutation. Matching field IDs retain their values even when relabeled or moved; omitted authored fields remain archived instead of being discarded.
- `POST .../settings`: `{revision,settings}`; campaign-local rule, simulation, content, context and token budgets.
- `POST .../epistemic`: `{revision,layer,subjectId,text,...}`; supports truth, knowledge, belief, memory, gossip, correct-belief, retire-truth, and refresh-memory. Structured fields include `propositionSubjectId`, `predicate`, `objectId`, `value`, qualifiers, source/status/audience/confidence, observation/learning/validity times, event/evidence links, tags, interpretation/privacy, recall conditions, decay, and expiry. `subjectId` is the observer for belief/memory/gossip operations; `propositionSubjectId` is the belief proposition subject. Gossip requires `recordId` and `targetId`, attenuates confidence, and never creates truth. Corrections use `factId`/`recordId` and never convert a belief into truth implicitly.
- `POST .../turns` with a `check` action resolves only an authored/campaign-configured formula and records attribute, skill, random input, difficulty, named typed modifiers, outcome band, margin, requirements, and provenance in the immutable check ledger. Supported results include critical, success, success-at-cost, partial, failure-with-information, failure-with-consequence, impossible, and no-roll.
- `POST .../turns` with a `train` action records explicit instruction or practice time, trainer/source, proportional cost, prerequisites, authored scale step, and milestone state. One completed record advances at most one authored step.
- `GET .../checks?characterId=UUID` returns the controlled character's ledger or the full authorized Creator view. Player history retains the numeric audit but redacts identities of Creator-hidden modifier sources.
- `POST .../catalog`: `{revision}` installs editable skills, realistic descriptive traits, and weighted NPC trait templates. Seeded traits remain Creator-editable and have no implicit mechanics.
- `POST .../traits/generate`: `{revision,characterId,templateId,seed}` replaces an NPC's trait set through deterministic weighted selection. The server validates background requirements, prerequisites, oppositions, combination/effect conflicts, category/tag caps, visibility policy, and the template/campaign point limits before committing.
- GET .../history: privileged immutable game event trace with inputs, effects, seeds and draws.
- GET .../developer/turn-traces: privileged request/event correlation with ordered stage latencies, statuses, sanitized failure reasons, cursor expectations, and narration retry/fallback stages.
- `GET .../ai-usage`: privileged provider reservations and estimated usage/status. Not vendor billing telemetry.

Global admin status does not grant access to other campaigns. Normal players cannot call Creator/export/debug endpoints. Creator content is untrusted as model instructions and is never executable code.

Trait definitions declare category, visibility, prerequisites, oppositions, combinations, acquisition/loss and permanence policy, generation weight/background tags, and optional cost/balance metadata. Every effect declares a type, scope, stacking rule, conflict behavior, stable key, and operation. Supported hooks cover checks, choice unlock/restriction, need rates, schedule priority, NPC plan priority, contextual first impressions, and descriptive flavor. Creator-hidden traits remain active in authoritative simulation but their IDs and decision traces are omitted from Player Mode.

## Saves and portability

- `GET/POST .../saves`: list permitted checkpoints or create `{name}`.
- `POST .../branch`: `{saveId,name}` creates an independent child and preserves the parent's state and Chronicle.
- `GET .../export`: Creator-only `{payload,checksum}` with version 1, state and transcript.
- `POST .../import`: `{name,bundle,dryRun:true}` validates before import; `false` creates a new child. Limit 8 MB. Entity IDs remain stable inside composite timeline keys; imported playable characters are assigned to the importing Creator, not arbitrary external account IDs. Transcript users are remapped accordingly.
- `POST .../template`: `{name}` stores a world-owned reusable export.
- `GET .../templates` and `POST .../templates/use` with `{templateId,name}` instantiate a template into a separate timeline.

Checksums detect corruption, not authorship/authenticity. Keep exports private: they include all hidden game content and private Chronicle. Accounts, credentials and session tables are excluded from game exports; full database backups include them and require stronger protection.
