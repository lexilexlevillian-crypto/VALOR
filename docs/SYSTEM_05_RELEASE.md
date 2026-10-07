# System 5 release evidence

Release prepared 2026-10-07 on the isolated system05-release branch, based on b7833cc51586c6fa8aacd0a04db44c8acc061d66. The newer System 3, System 4, character-creation and complete offline-shell changes are retained. Existing uncommitted work in E:/VALOR is preserved.

## Verification

- Full repository run: **534 passed, 0 failed, 0 skipped**, 80 test files.
- Final affected-code regression run: **83 passed, 0 failed**, covering the 34 controller tests, 29 completion tests, core authority boundaries, saves and tactical owners. These overlap the full run; they are not 83 additional unique tests.
- TypeScript check and git diff whitespace check: passed.
- Dependency installation audit: zero vulnerabilities.
- Chromium: versioned profile preview/publication, no-time-advance, 390/820/1536-pixel layouts, no uncaught page errors, and zero axe violations in the behavior editor. The screenshot was visually inspected.
- Database recovery rehearsal: migration 051, backup/restore row-count equality, integrity check and foreign-key checks passed through the System 32 release suite. This is an isolated recovery fixture, not a production database backup.

The full suite ran while the last affected-code fixes were completed; the final 83-test run covers those changes. Historical migrations through 050 are unchanged. Migration 051 adds timeline_npc_behavior and npc_planner_requests; startup awaits migration before readiness.

## Reproducibility and performance

Environment: Node v24.21.0, Windows x64, Intel Core i7-5930K at 3.50 GHz. Fixture: system05-completion-v1. Fractional and whole intervals produced identical behavior and item hashes:

- Behavior: b1a1e02bf0766fda8c713ec0699345c7b79d43b2a2470494c57051c908b60a46
- Item: 8a727fceb9b418e8aa2191df5e84401e44c9b1081709bcfab6b3528613a1fe1e

The 82-character crowded fixture processed 81 managed decisions: one selected acquisition, 80 bounded waits, zero context-blocked decisions, zero network calls and no pending wakes. Final measured context-plus-decision p50: **123.25 ms**; p95: **148.14 ms**. This is above the 10 ms target. It is measured performance, not a target-pass claim. Required state and handoffs remain protected; overload fails explicitly instead of silently dropping critical work.

Logs retained in the release checkout:

| Artifact | SHA-256 |
| --- | --- |
| artifacts/system05-full-suite.log | d10e06a3459ca90337aa151a82bdc8f6542d8dec49f1246dae551a72553dfd95 |
| artifacts/system05-final-validation.log | 5ac64bf3e5e9303f4155d6b962d71b11779597f7ed391c6524be23062b68f50e |

artifacts/system05-release-evidence.json retains structured counts, hashes and benchmark configuration. The [126-case evidence map](SYSTEM_05_ACCEPTANCE_MATRIX.md) distinguishes controller fixtures from owner integrations. Live paid AI, physical Safari/VoiceOver and production soak certification are outside this automated evidence.

## Deployment identity and checks

Authorized target: My Workspace (tea-dandhkoae00c73edouo0), existing [VALOR service](https://valor-uwgb.onrender.com), srv-das0ah59fdbs73bbk7hg. Render tracks full-game-implementation and deploys on commit. The release is pushed without force; no duplicate manual deploy is requested and no credentials or service settings are changed.

Pre-release live checks: /healthz, /readyz, /app and /sw.js returned HTTP 200; readiness reported schema 50 and the shell cache was v33. The release expects schema 51 and shell cache v34. The exact pushed commit, Render deploy ID/status and post-release HTTP checks are recorded in artifacts/system05-deployment.json and the delivery message after deployment completes. Public health checks verify startup and migration; authenticated production gameplay is not claimed from these checks.

Use forward fixes for this additive migration. Do not down-migrate or overwrite the production database. Optional AI remains off unless a Creator publishes an enabled profile and existing provider credentials and campaign/user budgets permit requests.
