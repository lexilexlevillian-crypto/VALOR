# SYSTEM 04 — Valor UI Design System and Theme Engine

Status: implemented and verified. Scope stopped at System 04.

## 1. Files and modules

System 04-specific additions:

- \`migrations/011_system04_theme.sql\` — durable user preferences, campaign palette policy, indexes, backfill, and artifact-registry trigger.
- \`src/theme.ts\` — server-side stable theme IDs and validation schema.
- \`public/theme.js\` — client theme catalog and token application.
- \`tests/system04-theme.test.ts\` — theme catalog, contrast, persistence, authorization, and artifact tests.

Shared files extended:

- \`public/style.css\` — semantic token stylesheet, responsive profile layout, dense panels, tabs, dividers, stat bars, framed media, textures, reduced-motion, high-contrast, and forced-colors behavior.
- \`public/app.js\` — theme loading, Player palette picker, Creator campaign policy editor, reusable panel/stat/theme helpers, and Character profile sheet.
- \`src/domain.ts\` — user preference and campaign policy commands with optimistic revisions and audit/event integration.
- \`src/app.ts\` — authenticated theme read/write routes.
- \`src/static.ts\` — serves \`/theme.js\`.
- Existing migration-count tests were advanced to migration 011.

No external brand assets or bitmap page backgrounds were copied.

## 2. Migration and backfill

Migration 011 adds:

- \`user_theme_preferences\`, keyed by user, backfilled to Neon Green Terminal for users existing at migration time.
- \`campaign_theme_settings\`, keyed by campaign, backfilled with the 11 required palettes and Neon Green Terminal as the recommendation.
- Revision indexes and a campaign-theme artifact registry entry/insert trigger.

New users and campaigns receive safe defaults through domain behavior and campaign creation. The migration remains additive; the existing forward migration checksum and backup/recovery path apply. User preferences are account-level settings and are intentionally outside the world/campaign artifact registry.

## 3. Contracts

User preference:

- \`GET /me/theme\` → \`{themeId, revision}\`
- \`POST /me/theme\` with \`{themeId, expectedRevision}\`
- A successful write increments the preference revision and emits an immutable audit record.

Campaign policy:

- \`GET /campaigns/:campaignId/theme\` → \`{recommendedThemeId, allowedThemes, revision}\`
- \`POST /campaigns/:campaignId/theme\` with \`{recommendedThemeId, allowedThemes, expectedRevision, reason?}\`
- The recommendation must be included in the allowed set; IDs are server-validated and deduplicated.
- Creator/admin writes increment campaign revision and use the existing immutable domain event, receipt, outbox, and audit path.

Client state is presentation state only. Canonical preference and policy data live in the database.

## 4. Player Mode and Developer Mode

Player Mode renders only the allowed campaign palette choices and the player’s own persisted preference. The Character page is presented as a structured dossier with OVERVIEW, STATS, and BACKGROUND regions, readable body text, utility labels, framed portrait placeholder, and responsive touch-safe controls.

The existing Developer/Creator surface receives the same token system but remains server-gated by the existing role checks. It exposes campaign palette policy editing only to Creator/admin, with recommendation validation and audit context. No hidden Developer state is preloaded by this System 04 work.

## 5. Creator controls

Creator/admin can:

- set the campaign default/recommended palette;
- restrict the palette list available to campaign members;
- preview the same palette choices and retain the existing campaign settings controls.

A campaign cannot save an empty allowed set or a recommendation outside the allowed set.

## 6. Validation and security

- Theme IDs are a strict server-side enum.
- Campaign reads require campaign membership; campaign writes require Creator/admin authorization.
- User writes use authenticated session/CSRF/idempotency middleware and optimistic revision checks.
- Palette writes are audited with actor, target, request correlation where available, reason, and before/after JSON through System 02’s audit columns.
- Client selection never becomes authoritative and cannot bypass server policy.
- Invalid IDs, stale revisions, unauthorized writes, cross-campaign access, and malformed payloads fail closed.

## 7. Tests executed

- \`npm run check\` — passed.
- Focused System 04 suite — 2 passed, 0 failed.
- Existing iPad/Playwright browser suite — completed successfully with exit code 0; it retained the responsive, reduced-motion, offline-shell, Axe, and touch viewport checks.
- Foundation, Systems 01–03, API, lifecycle, AI, libSQL, Turso, vehicle, worker, and compatibility regression groups were executed in serialized groups; all observed tests passed.
- The repository currently contains 94 test cases, including the two new System 04 cases.

## 8. Manual acceptance

1. Sign in as Creator and open a campaign.
2. Open Settings; confirm the palette panel shows all 11 required families.
3. Choose a soft palette; reload or revisit the campaign and confirm the choice persists.
4. As Creator, restrict allowed palettes and select a recommendation; confirm the recommendation must remain allowed.
5. Sign in as a player; confirm only allowed palettes are selectable and Creator policy controls are absent.
6. Open Character; confirm the profile sheet presents OVERVIEW, STATS, BACKGROUND, framed media, and touch-safe controls.
7. Use keyboard focus, iPad portrait/landscape, reduced motion, and a soft palette; confirm readable contrast and no horizontal overflow.

## 9. Performance, accessibility, and cost

Theme changes are CSS custom-property updates; no bitmap theme assets or per-screen color payloads are loaded. The palette catalog is a small static module. Campaign/user writes are single-row transactional updates with indexed reads.

Controls use a minimum 44px touch target, semantic buttons/labels, visible focus rings, responsive layouts, reduced-motion rules, high-contrast overrides, forced-colors support, and no motion-dependent interaction. Soft palettes use light surfaces with dark text; neon palettes use dark surfaces with light text.

AI and external service cost is unchanged. The only additional durable writes are explicit preference/policy changes and their audit/domain records.

## 10. Genuine undecided design question

The final Creator Studio preview could later render a side-by-side Player/Developer theme preview with campaign-specific sample content. System 04 provides the token catalog and live application path; the exact preview fixture/content is intentionally left for the Creator Studio scope in System 32.

STOP: no System 05 work was started.