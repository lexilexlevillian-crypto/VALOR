# Integrated game API

All `/game/*` endpoints require the existing authenticated session. Mutations require the exact configured Origin and `x-csrf-token`. Entity, settings, epistemic, catalog and turn mutations also require `Idempotency-Key` and the current timeline `revision`. Clients never supply a random seed, successful result, NPC action or authoritative consequence. Stale revisions fail atomically with 409.

`GET /game/catalog` returns supported entity kinds, their strict JSON Schemas, action schemas and installed narration provider IDs. The Creator and explicit-action UI are generated from these contracts; `src/game/model.ts` is the authoritative schema, not an independent client copy.

## Campaign and character selection

- `GET /game/campaigns/:id/timelines`: campaign timelines and lineage.
- `POST /game/campaigns/:id/timelines`: Creator initializes the original timeline.
- `GET /game/timelines/:id/roster`: characters controlled by the caller.
- `GET /game/timelines/:id/view?characterId=UUID`: observer-filtered entities, knowledge, beliefs, memories and that account's Chronicle.
- `GET /game/timelines/:id/creator`: privileged full state and reference impact data.

Timeline names/lineage are campaign-shared metadata. Players should not place private plot spoilers in timeline names. Save listings and branching are restricted to their creator, except privileged campaign editors.

## Play

`POST /game/timelines/:id/parse` with `{characterId,text}` returns a supported explicit command or clarification without mutating state. Accepted free text is currently a limited grammar, not a general language-action interpreter.

`POST /game/timelines/:id/turns`:

```json
{"revision":12,"characterId":"<UUID>","action":{"type":"look"}}
```

Use actual UUIDs and an idempotency key. Returns `{revision,eventId,narration,permitted}`. Outcomes, seed and draws, entity state, epistemic changes, event, audit, receipt, prose and autosave commit together. Reusing a key with different input fails. Repeating the same request never rerolls. Revoked membership or character control is checked before replaying a receipt.

`POST /game/timelines/:id/narrate` with `{turnId,provider}` may arrange already-approved fragments. It never runs simulation again. External providers can return only a permutation of permitted source IDs; arbitrary prose/tool instructions fail validation and fall back to grounded text. There is no externally exposed streaming HTTP endpoint yet.

`GET /game/timelines/:id/context?characterId=UUID&query=...` returns observer-filtered lexical retrieval with authored priorities, relevant memories and corrected beliefs. The retrieval function additionally supports supplied vectors; the HTTP endpoint does not call an embedding provider.

## Creator and debugging

- `POST .../entities`: `{revision,entity}` for strict typed create/edit/archive. IDs survive renames and changes to custom section order. Active references block archival.
- `POST .../settings`: `{revision,settings}`; campaign-local rule, simulation, content, context and token budgets.
- `POST .../epistemic`: `{revision,layer,subjectId,text,...}`; truth, knowledge, belief, memory, correct-belief, retire-truth or refresh-memory. Corrections use factId/recordId and never convert a belief into truth implicitly.
- `POST .../catalog`: `{revision}` installs editable descriptive skill/trait records.
- `GET .../history`: privileged immutable game event trace with inputs, effects, seeds and draws.
- `GET .../ai-usage`: privileged provider reservations and estimated usage/status. Not vendor billing telemetry.

Global admin status does not grant access to other campaigns. Normal players cannot call Creator/export/debug endpoints. Creator content is untrusted as model instructions and is never executable code.

## Saves and portability

- `GET/POST .../saves`: list permitted checkpoints or create `{name}`.
- `POST .../branch`: `{saveId,name}` creates an independent child and preserves the parent's state and Chronicle.
- `GET .../export`: Creator-only `{payload,checksum}` with version 1, state and transcript.
- `POST .../import`: `{name,bundle,dryRun:true}` validates before import; `false` creates a new child. Limit 8 MB. Entity IDs remain stable inside composite timeline keys; imported playable characters are assigned to the importing Creator, not arbitrary external account IDs. Transcript users are remapped accordingly.
- `POST .../template`: `{name}` stores a world-owned reusable export.
- `GET .../templates` and `POST .../templates/use` with `{templateId,name}` instantiate a template into a separate timeline.

Checksums detect corruption, not authorship/authenticity. Keep exports private: they include all hidden game content and private Chronicle. Accounts, credentials and session tables are excluded from game exports; full database backups include them and require stronger protection.
