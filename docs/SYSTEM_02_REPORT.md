# System 02 security and audit report

## Result

System 02 is implemented as a server-side boundary, not as a hidden client screen. Authenticated identity is resolved from a revocable database session. Every privileged scoped read and write then rechecks world ownership or campaign membership inside the server service that owns the operation. Global role alone never grants campaign access.

Migration 018 is additive. It adds optional audit notes and immutable, expiring deletion reports without rewriting existing campaign data. Existing archive behavior remains the default.

## Permission matrix

| Principal | Reusable world content | Campaign state | Creator-only fields and history | Membership, export, diagnostics | Hard delete |
| --- | --- | --- | --- | --- | --- |
| World owner / Creator | Full read/write for owned worlds | Only through an explicit campaign membership | Yes, within the authorized scope | Not implied by world ownership | Owned, archived records after a fresh dependency report |
| Campaign owner / Creator | No implicit access to other owners' worlds | Full validated campaign operations | Yes | Membership management, export/import, diagnostics | Archived campaign records after a fresh dependency report |
| Campaign admin/developer member | No implicit world access | Privileged campaign operations | Yes, only in that campaign | Export/import and diagnostics; cannot alter owner membership | No |
| Player member | No authoring | Player-visible projections and own/explicitly granted data | No | No | No |
| Restricted viewer / observer | No authoring | Own or explicitly granted visibility only | No | No | No |
| Nonmember, including global admin | None | None | No | No | No |

The future restricted viewer role is represented by the existing `observer` campaign role and receives no default campaign-wide visibility.

## Authentication, sessions, and request protection

- Passwords use scrypt with independent random salts. Login performs the same key-derivation work for unknown accounts and returns a uniform failure.
- Sessions use random 256-bit bearer tokens; only SHA-256 hashes are stored. Expiry is database-authoritative and logout revokes the session.
- Production cookies are `__Host-` prefixed, Secure, HttpOnly, host-only, and SameSite=Strict.
- Unsafe requests require the configured exact Origin and a session-bound CSRF header. Structured command writes also require durable idempotency keys and expected revisions.
- Request bodies, JSON fields, and import/export artifacts have explicit size bounds. Schemas reject unknown properties and client-supplied actor, clock, seed, authorization, or outcome data.
- SQL values are parameterized. Dynamic identifiers are selected only from fixed server-owned choices.

## Authorization and visibility

- World libraries are owner-only. Campaign permissions come only from current database membership.
- Owners, creator members, and admin/developer members can perform privileged campaign operations. Players and observers receive only allowlisted projections.
- Visibility is enforced at record, ancestor section, section, and field level. Knowledge grants do not reveal Creator-only values.
- Hidden data is filtered before search results, API responses, exports, errors, and AI context are built. Error behavior does not confirm whether an inaccessible resource exists.
- AI interpretation and narration receive only the requesting observer's bounded projection. They cannot return a state patch or bypass mechanics.

## Abuse and payload limits

Durable keyed-hash buckets enforce independent limits for general requests, login attempts, authenticated mutation bursts, AI calls, and exports. Defaults are 120 requests, 10 login attempts, 60 mutations, 10 AI calls, and 10 exports per minute. Limits are configurable within bounded ranges. Import and export JSON default to 8 MiB each and cannot be configured above 64 MiB.

Rate-limit identifiers are HMAC-derived with `RATE_LIMIT_SECRET`; raw email addresses, user IDs, and network identifiers are not stored in the buckets. Forwarded client-IP headers are not trusted.

## Audit and redaction

Privileged changes append immutable audit rows with actor, action, target, world/campaign scope, timestamp, request correlation ID, reason, optional note, and redacted before/after values. Authentication, membership, record, game, branch, import, template, deletion-report, and hard-delete operations are covered.

Audit serialization recursively redacts passwords, hashes/tokens, credentials, authorization/cookies/CSRF values, Creator secrets/instructions, contact data, phone/email data, and private message bodies. Request logging permits only generated request ID, method, route template, and status; full URLs, query strings, headers, bodies, AI context, provider secrets, and error internals are excluded.

## Deletion policy

Archive is the normal deletion operation. Permanent record deletion is owner-only and requires this deliberate sequence:

1. Archive the target.
2. Generate an immutable dependency report.
3. Resolve every blocking source-instance or canon reference.
4. Within ten minutes, submit that report ID plus the exact confirmation `HARD_DELETE <record-id>`.

Execution rechecks authorization, report ownership and expiry, target identity, archive state, and a dependency hash inside one transaction. A changed dependency graph invalidates the operation. The report is consumed once, the record and owned projection rows are removed, and immutable audit/event history records the deletion. That retained history is intentional: this workflow is permanent content deletion, not a privacy-erasure mechanism.

Game timelines, saves, events, receipts, and other history-bearing runtime artifacts remain archive/retention-only because their dependency and legal-retention policy has not been defined.

## Verification

The System 02 suite covers audit correlation and notes, before/after redaction, cross-campaign isolation, role escalation, nonmember global-admin denial, hidden field/contact/API/export/AI leakage, archive-first deletion, dependency-report confirmation, mutation/AI/export throttles, and import/export size limits. The complete repository suite also exercises session security, CSRF/origin enforcement, parameterized state operations, immutable audit/event triggers, restart persistence, migration recovery, transaction rollback, and projection visibility.

## Open operational decisions

MFA, public signup, account recovery, invitations, privacy-erasure/legal-hold policy, retention periods, backup encryption/key custody, external alerting, multi-instance distributed narration locks, and production rate values remain deployment/product decisions. No unsafe placeholder implementation is enabled for them.
