# System 02 security and audit report

## Permission matrix

| Principal | World library | Campaign state | Hidden Creator data | Audit history |
| --- | --- | --- | --- | --- |
| World owner / Creator | Read and author | Can create campaigns from owned worlds | Yes, within owned scope | Yes for authorized scope |
| Campaign owner / Creator | Source-world access as authorized | Authoring, membership, exports, imports, diagnostics | Yes | Yes |
| Campaign admin/developer member | No implicit world access | Privileged campaign operations | Yes within membership scope | Yes |
| Player member | No authoring | Player-visible projections, own data, explicit grants | No | No |
| Restricted viewer / observer | No authoring | Own or explicitly granted visibility only | No | No |
| Nonmember/global admin | None by default | None by default | No | No |

Authentication is database-backed. Every route authenticates before access, and every scoped query/mutation performs server-side membership/ownership authorization. AI and player-facing views are built from observer-permitted projections, not privileged rows.

## Delivered

- Additive migration 009 adds request correlation, reason, before-value, and after-value fields to immutable audit records.
- Server-generated request IDs are attached to authenticated actors and privileged edits.
- Record, campaign, membership, and Creator game edits retain before/after audit context.
- Legacy schema fallback preserves forward-migration compatibility before migration 009 is applied.
- Existing field, ancestor, record, campaign, timeline, AI-context, export, and media visibility filters remain enforced.
- Passwords, session tokens, CSRF tokens, request bodies, query strings, hidden fields, and provider credentials remain redacted from logs.

## Verification

npm run check passes. npm test passes with 90 tests and 0 failures, including cross-campaign isolation, role escalation rejection, hidden-field leakage, audit correlation, before/after audit values, CSRF/origin checks, rate limiting, log redaction, observer filtering, and AI-context secrecy.

