# Systems expansion and Gemini setup

This is an implementation checkpoint, not a claim that all 18 systems are production-complete.

Historical checkpoint: several gaps below were subsequently implemented in [LIFECYCLE_SYSTEMS.md](LIFECYCLE_SYSTEMS.md). Use that guide and IMPLEMENTATION_STATUS.md for the current feature and acceptance matrix.

## Gemini on the existing Render service

VALOR reads `GEMINI_API_KEY` (preferred) or `GOOGLE_API_KEY` from the server environment. If the key is already in Render under either name, do not copy it into source or chat. `GEMINI_MODEL` selects the model; the default is `gemini-3.8-flash`. The client receives only the provider ID, never the key. The adapter uses Google's documented [GenerateContent structured-output API](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en) and [model identifier](https://ai.google.dev/gemini-api/docs/models).

In campaign Settings, set both `tokenBudget` and `userTokenBudget` above zero to permit external AI. These are conservative application allowances, not a currency limit or a claim about Google's billing. They default to zero. Gemini reserves request-byte-based input estimates plus the output cap for two attempts before sending anything; rejected or failed attempts are not refunded automatically.

When available, Gemini is selected for new web-client turns. The user explicitly authorized automatically sending observer-permitted turn context to their Gemini account. Choose grounded in Chronicle to opt out for that session. The simulation commits first; provider failure or exhausted budgets retain grounded narration without replaying mechanics. Rebuild narration can also be requested explicitly for an existing turn.

Important current boundary: Gemini orders source-verified simulation fragments. It does NOT yet generate unrestricted new prose, player speech, feelings, consent, or canonical facts. Observer context includes bounded, source-labeled known facts, beliefs, memories and lore; its extractive continuity summary does not invent information. Structured provider output is checked locally before text is committed or streamed. HTTP paragraph streaming begins only after validation, not with unvalidated model tokens.

No live Gemini request, Render environment change, or live database access was used to develop these changes. Transport tests are mocked, and the test runner clears inherited AI credentials. Live key/model access still needs a deployment check.

## Delivered features

- Foundation: migration 005 adds a durable game-event outbox. Events, notifications, receipts, state and saves share one transaction. Trusted consumers use bounded leases and at-least-once delivery; they must deduplicate IDs. No external notification destination or worker has been provisioned.
- Client/AI: explicit text proposals must be confirmed; ambiguous or unknown targets do nothing. Chronicle exposes provider selection and safe narration rebuilding. The catalog supplies the complete authoritative settings schema.
- Knowledge: bounded context separates facts, unverified/corrected beliefs, memories and lore, includes provenance and suppresses duplicate text. It uses only the current character's projection.
- NPCs/relationships: optional faction group policy controls local NPC-only knowledge/mood sharing and cohesion. Absent members and player characters receive no automatic knowledge or mood changes. Character boundaries and authored romance preferences constrain offers; individual plan types can be disabled through preferences.
- Objects: incoming calls require a receiver response, can be answered/declined/ended/missed, and retain explicitly supplied dialogue. Message read status persists. Vehicle unlocking/boarding/leaving and weight-limited trunks enforce ownership/key access; another player is never silently boarded.
- Health/daily life: opt-in authored infection, withdrawal and sobering rates; authored recipes consume real ingredients; washing/laundry require facilities and configured rules. Clinical services consume clinic stock, transfer real funds and advance authored treatment time. These are fictional campaign parameters, not medical advice.
- Conflict: authored tactical positions, weapon range, blocked lines and body-part protection affect attacks; invalid attacks do not consume ammunition.
- Time/travel: authored weather schedules and route interruptions advance to a specified encounter location/time. Unrevealed encounters are not leaked in route projections. No automatic real-world weather feed or city canon is generated.
- Crime/law: Creator-authorized bail amounts transfer funds into agency treasury and persist release state. Suspects receive a restricted case notice, not investigative leads. Forensic services require investigator/custody authority and an authored result; contamination is labeled, results remain private until tested, and a lab report never proves guilt automatically.
- Events: compound all/any/negated Watcher conditions, priority-based conflict groups and private execution traces.
- Saves/Creator: atomic batches of up to 100 entities support cross-references, validated all-or-nothing writes and one revision/receipt/autosave. Save comparison and single-record restoration are Creator-only; restoration creates a new audited revision rather than editing the saved snapshot.

New record types, fields and actions are exposed through Creator forms and the explicit action panel. Clinical/forensic services use a business record, authored duration/cost and supply/result rules. Cooking uses a recipe record with specific ingredient IDs. Existing entities gain safe defaults when parsed; no original migration is rewritten.

## API additions

- `POST /game/timelines/:id/entities/bulk`: revision, entities; idempotency key required.
- `GET /game/timelines/:id/saves/compare?saveId=...`: Creator-only metadata comparison.
- `POST /game/timelines/:id/entities/restore`: revision, saveId, entityId; idempotency key required.
- `POST /game/timelines/:id/narrate/stream`: turnId and provider; authenticated POST/CSRF; validated NDJSON paragraphs followed by completion.
- Existing catalog, parse, context and action endpoints now expose the new schemas and proposal/context metadata.

## Still required before all-systems completion

Rich generative narration and language-model intent proposals need a separately tested agency/continuity design. Full NPC travel and segmentation-invariant planning, complex family/economic relationship consequences, media assets, EMS/estate/funeral flows, detailed traffic/chases, supply/production economics, optional reproductive-health simulation, police dispatch/court sentencing, broad authored quest branches/AI proposals, save compaction/version-upgrade tooling and advanced admin repair remain incomplete.

Physical Safari/VoiceOver testing, a multi-day soak, independent privacy/security review, live Turso/Gemini/Render restart acceptance, off-host backup scheduling and external monitoring are not certified by local tests. No new paid resources were provisioned. See IMPLEMENTATION_STATUS.md for the per-system matrix.
