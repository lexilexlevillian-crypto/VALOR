# Foundation API

JSON only. No HTML/client is implemented. IDs are UUIDs. All successful mutations use server clocks and revisions.

## Authentication

POST /auth/login with Origin equal to APP_ORIGIN and body:

```json
{"email":"your-account@example.com","password":"your own passphrase"}
```

The response sets an HttpOnly session cookie and returns {user:{id,role},csrfToken}. Keep the cookie in the browser's cookie jar and the CSRF token in memory. GET /auth/session retrieves current identity and the CSRF token after a reload. POST /auth/logout revokes the session.

Every authenticated mutation requires the cookie, matching Origin, and X-CSRF-Token. Authoring/management mutations additionally require Idempotency-Key: a fresh UUID (or 16-128 ASCII letters/digits/underscore/hyphen). Preserve the key when retrying the same operation.

An authenticated player may submit `{accessKey,expectedRevision}` to `POST /me/developer-access`. When the server-only `DEVELOPER_ACCESS_KEY` matches, the transaction grants that account the global Creator role, upgrades only its existing campaign memberships to Creator, enters Developer Mode, and appends redacted audit records. It never adds the account to an unrelated campaign, returns the key, or stores it in the database or browser. Invalid attempts are rate-limited and audited.

## Scopes

- POST /worlds: {name}; global creator/admin required, returned world is owned by the caller.
- GET /worlds: owned worlds only.
- POST /campaigns: {worldId,name,startingAt,timezone}; source world ownership required. startingAt is an ISO UTC timestamp and timezone an IANA identifier. The date must be deliberately supplied.
- GET /campaigns: caller's memberships only.
- POST /campaigns/:campaignId/members: {userId,role,expectedRevision}. Campaign owner only. role is admin/creator/player/observer or null to revoke. expectedRevision is the campaign revision.
- GET /scopes/:type/:scopeId/records: permitted record projections. type is world or campaign.
- GET /scopes/:type/:scopeId/records/:recordId: one permitted record projection.
- POST /foundation/commands: execute one strict System 01 command envelope. The body carries commandId, type, aggregateId, expectedRevision, idempotencyKey, and a type-specific payload; actor, clock, seed, authorization, and outcome remain server-owned.
- GET /game/timelines/:id/projections?characterId=UUID: observer-scoped Chronicle, roster, phone inbox, inventory, map, case file, and NPC profile read models.
- GET /scopes/:type/:scopeId/events and /audits: Creator/admin members only.
- POST /scopes/:type/:scopeId/records/:recordId/deletion-report: owner-only immutable dependency report for a possible permanent deletion; optional `{note}`.
- DELETE /scopes/:type/:scopeId/records/:recordId: owner-only permanent deletion with `{reportId,confirmation,note?}`. The record must be archived, the report fresh and unchanged, and confirmation must exactly match the report response.

Lists are capped at 100. Record lists include nextCursor; pass it as ?after=UUID. For world/campaign lists, use the last ID returned until an empty page. Histories return insertion-ordered pages; use the last event/audit ID as ?after=UUID. Unknown or out-of-scope records return 404 without distinguishing secret existence.

## Typed commands

POST /commands takes `{scope:{type,id},command:{...},audit?:{reason,note?}}`. Extra fields are rejected. Creator/admin authorization is scoped, not inferred from IDs. Existing records require expectedRevision, incremented once per successful aggregate mutation. `audit.reason` is 1-160 characters and `audit.note` is optional up to 1000 characters; omitted metadata defaults the reason to the command type.

| type | Required fields beyond type |
| --- | --- |
| record.create | kind, name, visibility |
| record.update | recordId, expectedRevision, name, visibility |
| record.archive | recordId, expectedRevision |
| record.instantiate | sourceRecordId, sourceRevision, visibility; campaign scope required |
| section.add | recordId, expectedRevision, name, position, visibility; optional parentId |
| section.update | recordId, expectedRevision, sectionId, name, position, visibility |
| section.archive | recordId, expectedRevision, sectionId |
| field.add | recordId, expectedRevision, sectionId, name, position, visibility, valueType |
| field.update | recordId, expectedRevision, fieldId, name, position, visibility |
| field.archive | recordId, expectedRevision, fieldId |
| field.set | recordId, expectedRevision, fieldId, value |
| visibility.grant / visibility.revoke | recordId, expectedRevision, userId; campaign member target required |

visibility: creator, campaign, owner, knowledge. valueType: text, number, boolean, json. JSON values are explicitly sized and schema-validated; field values are never interpreted as instructions. Section/field rename or reorder uses update, never replacement.

Example request (replace both IDs with returned UUIDs):

```json
{
  "scope": {"type":"campaign","id":"CAMPAIGN_UUID"},
  "command": {
    "type":"section.add",
    "recordId":"RECORD_UUID",
    "expectedRevision":1,
    "name":"Creator-authored details",
    "position":0,
    "visibility":"creator",
    "parentId":null
  }
}
```

Success: {id,revision,eventId}, with sectionId or fieldId when created. These IDs are stable and must be retained by clients. No mechanics or AI tool receives arbitrary write access.

Errors: 400 invalid input, 401 unauthenticated/invalid credentials, 403 forbidden/CSRF/origin rejection, 404 unavailable resource, 409 stale revision or idempotency conflict, 413 oversized request, 429 rate limit, 500 generic internal failure. Responses include a server requestId for log correlation, never a stack trace.


## NPC behavior (schema 51)

Creator-only profile, preview, inspection, proposal-validation and command routes are documented in [System 5 NPC behavior](SYSTEM_05_NPC_BEHAVIOR_IMPLEMENTATION.md#persistence-and-api). Behavior commands use the normal timeline revision, idempotency key and CSRF requirements. Preview and proposal validation do not execute actions or advance time.
