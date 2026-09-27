# SYSTEM 05 — Player Mode, Developer Mode, and Bottom-Edge Switch

Status: implemented and verified. Scope stopped at System 05.

## 1. Files/modules added or changed

Added:

- \`migrations/012_system05_mode.sql\` — persisted account mode preference with additive backfill.
- \`tests/system05-mode.test.ts\` — mode persistence, role denial, privileged route denial, audit, safe-area, and cache-isolation checks.

Changed:

- \`src/domain.ts\` — server-authoritative mode read/write methods, role validation, optimistic revisions, and audit records.
- \`src/app.ts\` — \`GET/POST /me/mode\`.
- \`src/game/routes.ts\` — explicit role-gated \`GET /game/timelines/:id/developer/overview\`.
- \`public/app.js\` — explicit mode state, login/session reload, confirmation dialog, mode badge, bottom switch, Developer navigation, Developer-only loading, state clearing on exit, and authorized inspection panels.
- \`public/style.css\` — safe-area-aware bottom switch, mode badge, confirmation dialog, and responsive iPad treatment.
- \`public/sw.js\` — static shell cache version 3 and cached \`theme.js\`; no API/game state is cached.
- \`tests/browser.test.ts\` — deliberate Developer Mode confirmation flow.
- Existing migration-count tests now expect migration 012.

## 2. Database migration/backfill

Migration 012 creates \`user_mode_preferences\` with:

- user foreign key;
- \`player|developer\` constraint;
- revision and timestamps;
- default Player Mode;
- backfill for users existing when the migration runs.

New users safely fall back to Player Mode until an explicit preference exists. This table is an account UI preference, not an authorization source and not a campaign artifact. Developer authorization is recalculated from the authenticated server role on every mode read/write.

## 3. API/state contracts

\`GET /me/mode\` returns:

\`{mode: 'player'|'developer', revision, developerAllowed}\`

\`POST /me/mode\` accepts:

\`{mode: 'player'|'developer', expectedRevision}\`

A Developer request from a non-Creator/admin account returns 403. Stale revisions return 409. Successful changes write an immutable audit record containing the actor, target, request context where available, reason, and before/after values.

\`GET /game/timelines/:id/developer/overview\` is a named Developer surface backed by the existing server-side \`Game.access(..., true)\` authorization. Existing history, diagnostics, context, Creator edit, preview, bulk edit, epistemic, and test/catalog routes retain their server authorization.

The client mode is presentation state only. Hidden data is never granted by the client’s mode value.

## 4. Player Mode behavior

Player Mode:

- exposes normal gameplay navigation and observer-permitted views;
- does not render Developer Studio navigation;
- does not request the Developer overview payload;
- shows a small bottom-edge mode control with an accessible label and tooltip/title;
- opens a confirmation boundary before attempting a mode change;
- shows a visible PLAYER MODE badge;
- clears \`S.creator\` and \`S.view\` when exiting Developer Mode.

Player users can see the switch affordance, but attempting Developer Mode is rejected by the server and produces no privileged payload.

## 5. Developer Mode behavior

After an explicit confirmation and successful server response, authorized Creator/admin users receive:

- Developer Studio navigation;
- full authorized entity/NPC registry and hidden Creator fields;
- world-state counts and timeline state;
- event history/simulation trace;
- AI context source inspection;
- diagnostics and visibility preview;
- controlled record edits, epistemic edits, media tools, catalog/test tools, and atomic bulk editing;
- a visible DEVELOPER MODE badge;
- explicit explanatory copy that Developer Mode does not change server authorization.

On exit, the client clears the Developer snapshot before returning to the campaign roster/game surface. The service worker caches only static shell assets, never Developer or game-state responses.

## 6. Bottom-edge switch/accessibility

The switch is:

- fixed to the lower edge with \`env(safe-area-inset-bottom)\` and right inset support;
- compact and low-emphasis;
- keyboard/focus accessible;
- labeled with icon plus text on larger layouts and icon plus accessible label on narrow layouts;
- kept above the iPad home-indicator safe area;
- non-modal until deliberately activated;
- paired with a native confirmation dialog;
- covered by reduced-motion, contrast, and existing focus styles.

The main content retains bottom spacing so the switch does not cover the composer.

## 7. Validation and security

- Server role claims, not CSS, local state, or the mode button, authorize Developer reads and writes.
- Player requests to the Developer overview and existing Creator endpoint are denied.
- All mode input is strict and limited to two values.
- Optimistic revisions prevent stale mode overwrites.
- Session login reloads the mode preference for the authenticated account.
- Sign-out resets client mode state.
- Developer payloads are loaded only from explicit Developer navigation.
- No Developer data is stored in localStorage, the service worker, URL state, or static shell cache.
- Existing CSRF/session middleware protects the mutation route.

## 8. Tests executed

Passed:

- \`npm run check\`.
- System 05 focused suite: 2 passed, 0 failed.
- Updated iPad/browser suite completed successfully with exit code 0.
- Migration, authority, security, canon, and theme regression group passed.
- API, compatibility, Gemini, gameplay, lifecycle, systems, vehicle, and worker regression groups passed.
- \`git diff --check\` reported no whitespace errors.

## 9. Manual acceptance

1. Sign in as a normal player; confirm Player Mode badge and bottom switch are visible.
2. Try to enter Developer Mode; confirm the server-denied message and absence of Developer navigation.
3. Sign in as Creator/admin; open a campaign and choose Switch to Developer Mode.
4. Confirm the dialog; verify the badge changes and Developer Studio appears.
5. Open Developer Studio; verify NPC/entity registry, hidden fields, event trace, diagnostics, context inspection, and controlled tools.
6. Exit Developer Mode; verify Developer Studio disappears and the roster/game view returns.
7. Reload or sign out/sign back in; verify the persisted mode is loaded for the account.
8. Test iPad portrait/landscape, keyboard focus, reduced motion, and safe-area placement.
9. Inspect network/cache behavior; no Developer or game-state response should appear in the service-worker cache.

## 10. Performance/accessibility/cost and undecided design

The mode preference is one indexed row and one audited write per explicit switch. Developer payloads are fetched only on demand. No AI or external service cost is added by the mode boundary.

The account-global preference is intentional for this pass. A future design question is whether the last-used mode should become campaign-specific for users who are Creator in one campaign and Player in another; this is not blocking because authorization is recalculated per request and Player Mode remains the safe fallback.

STOP: no System 06 work was started.