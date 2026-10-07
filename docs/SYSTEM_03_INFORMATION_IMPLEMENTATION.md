# System 3 completion report

Authoritative specification: **VALOR_System_3_Context_Knowledge_Information_Master_Spec-5.docx**, SHA-256 `138d4fadb66f237123eeef35b921a20aca84a3808f184e2bfe56363dbd06b0b2`. This report replaces the earlier report against the original attachment. This work completes System 3. It was prepared in an isolated checkout. Concurrent System 4 commits `a78e747` and `26d0924` reached the deployment branch during verification, so this release preserves that existing baseline and validates their integration with System 3.

## 1. Changed modules

- `information-contracts.ts`, `information-extensions.ts`: validated epistemic structures and backward-readable defaults.
- `information.ts`, `information-access.ts`, `information-operations.ts`: acquisition, sources, facets, identity, spatial precision, recall eligibility, record custody, starting packages, and audited repair.
- `information-context.ts`, `context.ts`, `epistemics.ts`: purpose profiles, deterministic candidate reduction, shared projection rules, summaries, scope binding, and call manifests.
- `information-routes.ts`, `information-tools.ts`, `information-replay.ts`, `turn-kernel.ts`, `simulation.ts`, `extended-actions.ts`: authenticated player queries and Creator inspection, authoring, replay, grant, and repair interfaces.
- `engine.ts`, `model.ts`, `ai.ts`, `ai-intent.ts`, `turn-planner.ts`, `src/ai/contracts.ts`: persistence, reference checks, immutable request capture, stale-output rejection, and safe generation fallback.
- `public/phone-apps.js`, `public/app.js`, `public/sw.js`: notebook queries, approximate/last-known places, memory archive distinction, Creator perspectives/replay/repair, shell cache v32.
- New completion and scale test suites; expanded notebook browser and NPC profile regressions. The existing large-roster timing threshold is unchanged.

## 2. Database and backfill

System 3 uses additive migration **049_system03_information.sql**. The integrated deployment retains the already-released System 4 migration **050_system04_memory.sql**, so readiness reports schema 50. No applied migration was edited and this System 3 completion adds no SQL migration. Canonical information remains in timeline-local `timeline_information`; immutable recorded calls remain in `information_context_manifests`.

New JSON fields have schema defaults. Existing facts and character acquisitions backfill typed source records during normal persistence without granting new knowledge. Historical snapshots load their own saved information; branches clear derived summaries. Acquisition quarantine survives persistence and prevents legacy facts from restoring repaired knowledge. Matching code and data must be retained when rolling back; older strict JSON readers cannot read newly extended documents without adaptation.

## 3. Data structures and APIs

World propositions, character acquisitions, observations, later interpretations, records, transmissions, memories, directives, and derived summaries remain separate. New records include typed sources; independently discoverable secret facets; dated identity stages; exact/area/rumored/last-known spatial knowledge; starting-knowledge packages; custody-bound records; access-change histories; and acquisition repair records with before/after data and affected committed events.

Routes below are relative to `/game/timelines/:id/information`:

| Route | Boundary |
| --- | --- |
| GET root, GET /query | Controlled character; known/remembered/observed/where/why; no time advance |
| POST /author, /active/:recordId | Controlled character; revision and idempotency checked |
| POST /research | Controlled character; access-filtered records and deterministic game-time cost |
| GET /diagnostics, /inspect, /perspective, /why, /context, /calls | Creator; diagnostic reads grant no PC knowledge |
| POST /replay, /repair-preview, /retcon-preview | Creator; noncanonical previews; explicit replay execution is budgeted |
| POST /developer, /operations | Creator; revision, idempotency, schema checks, provenance, audit |

Freeform character beliefs and knowledge/recall questions also use these domain operations. Named-PC beliefs are supported; OOC theories remain outside character knowledge.

## 4. Retrieval and token policy

Eleven versioned profiles cover narration, NPC planning, dialogue, input parsing, knowledge queries, recap, research, investigation, memory consolidation, validation, and Creator inspection. Hard perspective/date/quarantine filtering precedes ranking. Deterministic lexical, entity, thread, recency, salience, and source paths remain available without an external embedding service.

Memory candidates are reduced to at most 200 before semantic ranking. Optional records compete within category shares and a bounded input budget. Exact active threats, promises, questions, current events, immediate state, and secrecy/agency constraints are protected. Profiles carry an output reserve. An incomplete required bundle is explicitly marked unready and uses committed deterministic narration instead of creative generation. Byte-based estimates in information bundles deliberately overestimate tokenizer usage.

## 5. Permission and shared projection architecture

The same acquired-information and identity rules feed profiles, context, maps, notebook, search, and target labels. Learning one field no longer unlocks unrelated profile fields. Knowledge-scoped fields show acquired historical values rather than a silently updated NPC record. Private relationship metrics and NPC planner motives remain excluded from player narration.

Physical note access follows its carrier, lock, condition, and phone availability. A previously read record remains a character acquisition after access is lost; the external record itself requires current access. Copies require current read access and retain independent provenance. Faction/institution membership grants access only where the record explicitly names that audience, and never implies consumption. Public/faction inspector views identify availability and explicitly require individual consumption.

## 6. Rumor and provenance

Delivery, exposure, comprehension, acceptance, and acquisition are distinct. The live SMS/email/voicemail path now waits for an explicit read/listen action, with per-reader provenance; delivery alone grants neither facts nor beliefs. Unread content is withheld from player projections and phone previews. Reading an accessible stolen phone grants only that reader knowledge, and sender deletion preserves the recipient copy. Partial previews and interrupted speech preserve only the perceived fragment. A rumor keeps parent transmission, source acquisitions, original roots, mutations, and individual recipients. Circular-source diagnostics identify return paths; repeated origins do not increase independent corroboration. Independent witnesses retain distinct roots. Forged records remain source claims without revealing their objective authenticity.

Declassification widens availability for the specific facet and appropriate single-facet records. It does not update everyone’s knowledge or expose other facets. Creator grants carry explicit source provenance.

## 7. Player surfaces

The notebook separates knowledge, uncertain beliefs, hypotheses/leads, observations, read records, and an external memory archive. Read-only questions show what the controlled character knows, remembers, observed, or last knew about a location. Research takes 1/10/30 minutes according to depth. Archive inspection neither advances time nor refreshes recall.

Staged labels suppress unrevealed names and aliases. Approximate knowledge shows an area-level statement without an exact pin or hidden action target. Observations retain original raw text while later identification/correction is recorded separately. Conflicting accounts retain their sources and uncertainty rather than being silently reconciled.

## 8. Immutable snapshots and races

Context binds campaign, timeline, viewer, scene, state revision, event cursor, and retrieval-profile version. Bundles are frozen. Provider requests persist validated provenance and the exact request for inspection. Parser/planner/narrator responses recheck scope before acceptance. Branches and later discoveries cannot enter a saved earlier perspective.

Replay reconstructs the recorded context with the original scope/profile, optional omissions, and a changed budget. It returns a noncanonical checksum and completeness result, and cannot remove required sources or write gameplay state. An explicit rerun executes the saved provider request, optionally with another configured model. It enforces campaign/user token budgets, validates the response schema, disables tools, preserves historical input, and records an idempotent diagnostic result. Output remains noncanonical and cannot commit gameplay changes; current world state is never substituted into the frozen request. Context-only previews incur no provider charge.

## 9. Summaries and rebuilds

Scene, thread, relationship, character, location, storyline, period, and campaign summaries retain canonical source IDs, hashes, versions, event cursors, exact anchors, and source uncertainty. Rebuilds resolve canonical sources rather than recursively trusting prior prose. Source changes invalidate stale summaries. Missing summaries fall back to source material. Cue-bound/forgotten memory cannot re-enter context through a summary.

Meaningful acquisition changes update active hierarchies; periodic maintenance audits them against canonical sources. Scene departure preserves bounded recent source-backed context. Repair quarantines derivatives and removes affected summaries, while committed events remain intact and are flagged for review.

## 10. Scaling and simulation tiers

Context tiers distinguish dormant, background, warm, and active-scene characters without resetting canonical identity, history, or commitments. Existing deterministic simulation retains its active/relevant/distant catch-up policy. Hot/warm/cold age bands influence optional retrieval; they do not delete old information or weaken permissions.

Full-state loading and canonical history storage still grow with campaign age. Prompt size is bounded independently. Snapshot chunks remain content-addressed. Incremental persistence skips unchanged epistemic rows; checksum ordering and an operation-local snapshot encoding cache avoid repeated work while preserving existing checksum bytes. Controller authorization reads the selected character rather than loading the entire campaign.

## 11. Developer diagnostics and repair

Creator tools expose who-knows timelines, source and rumor graphs, circularity, secret holders/suspects, access history, conflicts, tiers, immutable calls, View As, public/faction availability, inclusion/trim decisions, and why/why-not acquisition explanations. Manual operations cover propositions, knowledge/belief/observation grants, rumor exposure, facets, access, identity, spatial knowledge, packages, and repairs.

Repair previews traverse dependencies and locate committed contexts mentioning affected sources. Applying a repair records a reason, immutable before/after values, quarantined derivatives, and downstream event IDs. It never erases committed events. Repeated repair requests are idempotent. Permission and invalid-reference failures retain proper HTTP status codes and do not leak hidden content to players.

## 12. Verification

The new completion suite covers the gaps above, including source repair after actual save/load, Creator/player authorization, noncanonical replay, progressive identity, stale profiles, custody, approximate mapping, circularity, recall eligibility, faction availability, future-date isolation, and budgeted/idempotent AI replay. Existing suites cover communications, deletion, perception, hidden relationships, narration, tenant isolation, branch/save/restore, and release rehearsal. The 52 scenarios from section 18 are mapped in [SYSTEM_03_ACCEPTANCE_MATRIX.md](SYSTEM_03_ACCEPTANCE_MATRIX.md).

Focused domain and notebook regressions passed. Chromium and WebKit notebook checks passed at mobile and iPad viewport sizes, with zero axe violations and no page errors. TypeScript, JavaScript syntax, whitespace checks, and the production dependency audit passed. The dependency audit found zero vulnerabilities.

Final integrated code candidate `2ea45a482c40950a2964c203bf9baab8fab7f49b` passed **471/471 tests across 77 test files**, with zero failures and zero skips, in [CI run 37571328995](https://github.com/lexilexlevillian-crypto/VALOR/actions/runs/37571328995). That run also passed TypeScript and the production dependency audit. The release report update changes documentation only; runtime code, tests, dependencies, and migrations match that tested candidate. The final focused replay run passed 22 System 3 completion tests plus seven AI gateway tests. The integrated run also covers the existing System 4 memory code. Focused integration checks passed all 22 System 3 completion tests and 21 System 4 memory tests. WebKit notebook verification also passed.

Release target: [VALOR](https://valor-uwgb.onrender.com/app). Local release/deployment receipts are recorded in `artifacts/system03-release-verification.json` and `artifacts/system03-live-smoke.json`, including the deployed commit and live browser/API results.

## 13. Measured latency, tokens, and cost

Windows measurements from the completion fixtures:

| Fixture | Measurement |
| --- | --- |
| 50,000 in-memory event references | 329 ms assembly; 3,568 conservatively estimated input tokens |
| 50,000 persisted game events and memories | 42,656 ms initial persistence; 1,714 ms load; 275 ms context assembly; 1,759 estimated input tokens |
| 1,001 NPCs and 1,000 lore records | Ten persisted hourly turns including autosaves: 26,693 ms; unchanged 30,000 ms ceiling |
| Persisted campaign state | 27,496,770 JSON bytes |
| 10,000 deterministic resolver turns | 3,487 ms total; 100 context samples; p50 2 ms, p95 2 ms; maximum 1,448 estimated tokens |

The resolver soak preserves a meaningful promise memory through 10,000 routine waits without forcing each idle turn to create a durable memory. It executes actual deterministic action resolution and time advancement in memory; it is **not 10,000 persisted TurnKernel commits or paid model calls**. The 50,000-event database fixture synthesizes canonical event history and performs real persistence, loading, and retrieval. All these fixtures make zero external-model calls and incur zero model charges. Provider-specific production latency, token billing, and spend are not inferred from local byte estimates.

## 14. Author choices and operational limits

No world-authoring decision blocks these code paths. Campaign authors supply actual secret facets, credentials, institution rules, source reliability, starting packages, and record contents. System 3 does not invent those facts.

Browser evidence uses desktop Chromium/WebKit with phone and iPad viewports, not a physical iPad Safari session. Local backup/restore and migration rehearsals are tested; no production database restore was performed because production database credentials are unavailable in this workspace. These are explicit verification limits, not claims of completed production recovery or physical-device certification.

Stop at System 3. The deployment preserves the System 4 code that independently reached the release branch; this work adds no further System 4 features. Integration maintains source-date checks when acquired information becomes a cognitive memory.
