# SYSTEM 13 — Transactional Turn Pipeline, Validation, and Retry

Status: implemented and tested.

## Turn contract

A player obtains the current `revision` and opaque `turnCursor` from `GET /game/timelines/:id/view`. The public turn endpoint requires both values, a controlled `characterId`, one schema-valid action, the original player text when present, and an `Idempotency-Key`:

```json
{
  "revision": 12,
  "cursor": "opaque-current-cursor",
  "characterId": "<UUID>",
  "action": {"type": "look"},
  "text": "look"
}
```

A successful response contains the next `revision`, next `turnCursor`, immutable `eventId`, durable `traceId`, observer-permitted effects/checks, and the deterministic grounded summary. The cursor is opaque; clients compare or return it but do not derive authority from it.

The parser returns `originalText` unchanged. A single supported meaning becomes a proposal that still requires player confirmation. If compound text yields several incompatible supported actions, the parser returns `classification: "clarification"`, `action: null`, and bounded alternatives. Parsing never advances state.

## Transaction pipeline

The server executes a confirmed turn in this order:

1. Validate the idempotency key and action schema.
2. Authorize campaign membership and control of the playable character before writing trace metadata.
3. Preserve the exact original text and record the confirmed intent.
4. Validate the timeline revision and cursor.
5. Load authoritative state and create one event ID and one cryptographic simulation seed.
6. Resolve deterministic simulation/checks and produce domain effects.
7. Persist state projections.
8. Compare-and-swap both timeline revision and opaque turn cursor.
9. Append the immutable event, check records, canon/world bindings, and outbox record.
10. Build and store an observer-permitted deterministic summary.
11. Store audit, idempotency receipt, and autosave.
12. Commit all mechanics, events, projections, receipt, and grounded Chronicle turn atomically.

Any exception before transaction commit rolls the entire mutation back. The failure trace is persisted only after rollback. A later request therefore cannot observe partial state, an orphan event, a consumed cursor, or a receipt for an uncommitted turn.

AI narration starts only after that commit. It receives the committed event's permitted effect bundle and cannot call simulation. All bounded retries reuse the same event ID, permitted effects, seed, draw count, checks, and resulting state. A validated narration update is a separate atomic Chronicle update. It does not change timeline revision or mechanics.

## Lock and cursor protocol

`timeline_turn_cursors` stores one current `(timeline_id, revision, cursor)` tuple. Every timeline mutation updates the timeline revision and cursor with database compare-and-swap predicates inside the same transaction. A turn also checks the cursor supplied by the browser.

Two tabs may read the same state, but only the first valid transaction can advance that tuple. The other receives `revision_conflict` or `turn_cursor_conflict`, refreshes the view, and must ask the player to act against the new state. The browser displays a specific stale-tab recovery message. The database protocol remains authoritative across processes; it does not rely on an in-memory mutex.

Receipt lookup precedes stale revision/cursor rejection. Retrying the exact same idempotency key and body returns the original response—including event, trace, revision, and next cursor—without resolving mechanics again. Reusing the key with different content fails with `idempotency_conflict`.

## Trace contract

`turn_traces` correlates the actor, request key, body hash, exact original text, expected revision/cursor, committed event, terminal status, and sanitized failure reason. `turn_trace_steps` is append-only and records a non-negative `duration_ms`, status, sanitized failure reason, and JSON details for each applicable stage:

- input preservation;
- confirmed intent;
- character authorization;
- server validation;
- idempotency replay;
- database turn lock/cursor compare-and-swap;
- state load;
- deterministic simulation;
- state projection;
- domain-event append;
- grounded summary;
- aggregate atomic commit;
- context build;
- narration attempts;
- output validation;
- narration commit or fallback/cancellation.

Provider text and secrets are not written to failure fields. Failure reasons are stable server codes; unknown exceptions become `internal_error`. Creator/admin roles can inspect the latest 100 traces and ordered steps through `GET /game/timelines/:id/developer/turn-traces`. Normal players cannot use that endpoint.

## Failure behavior

| Failure | State behavior | User-visible behavior |
| --- | --- | --- |
| Unsupported or multiply interpretable input | No transaction starts | Clarification; original text remains available |
| Invalid target/action | Transaction rolls back; cursor and revision remain unchanged | Validated server error; draft can be corrected |
| Duplicate exact request | Original receipt is replayed | Original committed result; no reroll |
| Same key, different body | No mutation | `idempotency_conflict` |
| Concurrent/stale tab | Compare-and-swap loser rolls back | Refresh-and-retry message |
| Partial database failure | State, event, projections, outbox, receipt, and autosave roll back together | Stable failure code; trace records failed stage |
| Invalid narration claim, agency/style/secrecy violation, or malformed output | Narration alone retries against the same bundle | Mechanics remain committed and unchanged |
| Provider outage/timeout/all narration retries fail | Grounded deterministic summary remains; campaign is preserved | Graceful fallback message with `mechanicsPreserved: true` and `rerolled: false` |
| Later narration retry after outage | Reuses the original committed event and effects | Validated prose may replace grounded prose; mechanics still do not reroll |
| Client cancellation before narration commit | Existing prose remains | Cancellation message; no partial model text is exposed |

## Verification

`tests/system13-turn-pipeline.test.ts` covers preserved original text, incompatible compound interpretations, duplicate request replay, conflicting concurrent sessions, failed simulation rollback, durable failure latency/reason, agency-violating model output, bounded narration retry, unchanged seed/draws/effects, provider outage fallback, and successful retry after outage. Existing core game, migration, libSQL/Turso, AI gateway, context, and security suites remain green.
