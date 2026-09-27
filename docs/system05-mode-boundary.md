# System 05 — Player/Developer mode boundary

## Mode boundary

Player Mode and Developer Mode are separate render paths. Player Mode does not render Developer Studio, campaign mutation controls, recovery tools, hidden facts, full NPC data, diagnostics, AI context inspection, event traces, or simulation controls. API requests use `cache: no-store`, the service worker caches no session/game endpoints, and exiting Developer Mode clears both the full Developer snapshot and the observer view before rendering a fresh Player surface.

The server remains the security boundary. Developer APIs require an authenticated Creator/admin campaign role, and unauthorized accounts receive 403 responses. The user mode preference is revisioned, persisted, and audited. Entering Developer Mode does not itself grant server authority; configured Developer access-key elevation is server-validated and separately audited.

## Bottom-edge switch

The switch is a 44-by-44 icon control with a native title, accessible label, and visible focus/hover tooltip. It uses right and bottom safe-area insets, reserves bottom content space, and has a dedicated stacking layer. The control does not cover the Chronicle composer or the iPad home-indicator area. Entry and exit both open explicit confirmation dialogs. The top bar shows a persistent PLAYER MODE or DEVELOPER MODE badge after switching.

## Developer experience

Developer Studio displays an obvious boundary banner and classification labels for:

- hidden facts and the full NPC/record registry;
- audited mutations;
- read-only simulations;
- test actions;
- dry-run and visibility previews.

Entity and batch edits are validated by the server before confirmation. Campaign settings receive a server validation summary before confirmation. Archives, hidden-fact changes, save recovery, catalog installation, and other controlled changes use deliberate review dialogs. Successful mutations continue through the existing event and immutable audit paths.

Simulation trace advances an in-memory clone only. Its response includes `dryRun: true`, `persisted: false`, unchanged timeline revision, changed/created record summaries, effect counts, and a bounded trace. Player-visibility preview and diagnostics remain read-only.

## Verification

- System 05 persistence, authorization, audit, static-shell, dry-run, and unauthorized-preview tests pass.
- The iPad browser flow verifies portrait and landscape switch placement, real center-point hit targets, visible mode badges, confirmed entry/exit, zero Developer snapshot requests before entry and after exit, no composer overlap, reduced motion, axe accessibility, and offline-shell behavior.
- TypeScript and JavaScript syntax checks pass.
