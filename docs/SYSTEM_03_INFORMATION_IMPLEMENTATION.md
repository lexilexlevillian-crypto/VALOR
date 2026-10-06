# System 3 context knowledge and information implementation

This report covers the supplied **VALOR System 3 Context Knowledge Information Master Spec**, including its delivery checklist. The document's SHA-256 is `b3e2d5bd02150dda54b28945dd5061c670672b7d4dacbd2d20985128abbe92b8`.

System 3 now records how information was acquired, preserves competing accounts, assembles purpose-specific context, and keeps character-facing information separate from canonical truth. Existing simulation, communication, narration, saves, NPC authoring, and the phone notebook use these boundaries. The earlier `SYSTEM_03_REPORT.md` describes the repository's historical campaign/canon numbering; this report describes the newly supplied information specification.

## 1. Modules and integration

| Files | Responsibility |
| --- | --- |
| `src/game/information-contracts.ts` | Validated propositions, acquisitions, observations, transmissions, records, active information, summaries, conflicts, cohorts, access logs, and canaries |
| `src/game/information.ts` | Acquisition, perception attempts, exposure, research, provenance, projections, belief/lead revisions, conflicts, diagnostics, retcon dependency tracing, and legacy-state adaptation |
| `src/game/information-context.ts` | Purpose profiles, permission filtering, bounded selection, immutable bundles, manifests, summary rebuilding, canary validation, and stale-response checks |
| `src/game/information-routes.ts` | Player and Creator APIs, authorization, revision checks, idempotency, research time, and developer tools |
| `src/game/engine.ts`, `model.ts`, `snapshots.ts`, `npcs.ts` | Persistence, validation, committed observation capture, scene summaries, frozen narration manifests, save/branch/import/export, and explicit NPC merge/reversal |
| `src/game/epistemics.ts`, `context.ts`, `communication.ts`, `turn-kernel.ts` | Existing projections/retrieval, individual communication reception, exact dialogue anchors, explicit PC beliefs, and canonical-event recaps |
| `src/ai/contracts.ts`, `game/ai.ts`, `ai-intent.ts`, `turn-planner.ts` | Request scope metadata, untrusted source boundaries, abstract validation defects, and response-version checks |
| `public/phone-apps.js`, `public/app.js` | Knowledge search, notes, beliefs, hypotheses, leads, assessments, research, and developer diagnostics |
| `src/app.ts`, `src/cli.ts` | Schema-49 readiness and backup/release rehearsal |
| `tests/system03-information.test.ts`, `tests/system03-information-ui.test.ts` | Acceptance, leakage, persistence, scaling, mobile, and accessibility coverage |

Existing foundation, libSQL, Turso, save, and release tests were updated for schema 49.

## 2. Database and migration

Migration **049_system03_information.sql** adds:

- `timeline_information`: one validated, timeline-local canonical information document. It includes provenance and histories, not just a cached projection.
- `information_context_manifests`: immutable call records keyed by call ID with timeline, viewer, purpose, revision, cursor, and assembled sections. An index supports timeline/viewer/version inspection.

The migration is additive. Existing facts, knowledge, beliefs, memories, events, and saved timelines remain supported. Older-schema migration fixtures can still load and author before migration 49 is applied. Readiness, export metadata, and release rehearsal now expect schema 49.

Information joins the existing content-addressed, compressed snapshot format. A branch starts with the saved canonical information and clears derived summaries. NPC merge and reversal include information state.

## 3. Propositions and character information

Propositions store subject, predicate, value, qualifiers, valid time, truth status, canon authority, secrecy, and source IDs. Character acquisitions separately store epistemic type, confidence, immediate source, origin ancestry, acquisition time, information time, last confirmation, freshness, secrecy awareness, status, and supersession.

Truth does not imply acquisition. False information can have high character confidence. An old acquisition does not silently change to the current hidden value. The legacy player projection now reports the character's confidence and acquisition source, rather than objective falsity or other recipients.

Explicit freeform statements such as `I believe Nia stole the letter.` create a private PC belief without advancing time. OOC speculation does not. The notebook also supports explicit belief, hypothesis, lead, character-note, and OOC-note authoring. Character notes have private external records; OOC notes never become character context.

## 4. Perception and observations

Existing per-listener communication checks supply channel, distance, obstruction, attention, sensory ability, and language comprehension. Meaningful observations retain their original perceived text. Partial or uncomprehended speech does not acquire the complete proposition. Seeing a partial plate does not expose its hidden characters.

The committed-event adapter records observer-filtered weapon, injury, crime, evidence, discovery, message-reading, and research effects. It uses the resolver's actual observers. It does not add every colocated NPC as a witness. Character visibility and map occupants also respect visual partitions and sensory access.

Active perception attempts are keyed by target, method, position, sensory conditions, environment, and target state. Identical attempts do not generate repeated opportunities; changed conditions permit another attempt. Hidden failures return no discovery signal. Routine dialogue remains transient; threats, promises, and open questions retain exact wording.

## 5. Transmission rumors and public awareness

Transmission records distinguish intended recipients, delivery, exposure, comprehension, and acceptance. Sending or delivering a message does not grant its contents. A fragment creates a partial observation; a subsequent full reading can acquire the full transmitted claim while preserving the fragment.

Each rumor hop retains its parent and original roots. Existing gossip actions now use this chain. Corroboration counts independent roots and does not raise confidence merely because the same story was repeated. Corrections affect only recipients who encounter them; prior belief history remains.

Publication and cohort awareness do not automatically update named NPCs. Authored cohort exposure can be materialized into a named character with deterministic selection. Institutional membership alone does not grant record contents. Public rumor visibility requires actual exposure or source ownership.

## 6. Research and record access

Research filters the record corpus before matching text. Access can require a named character, item/device, credential tag, location, and unsealed record. It never queries `world_facts` as a substitute for records. Original and amended records coexist, and acquisition dates remain separate from the source's information date.

Quick, standard, and thorough research consume 1, 10, and 30 game minutes, respectively, through the existing simulation clock. Access is audited, including authored misuse access. Query words are matched deterministically against accessible titles and text; professional phrasing does not require SQL or internal IDs. No-result responses mean no accessible match, not nonexistence or a hidden-result count.

World-specific directories, police reports, institutional permissions, and access devices must be authored as content. No real-world records or modern search service are silently introduced into the 2012 setting.

## 7. Player knowledge interface

Phone → Journal contains **What I know**, notes/leads/questions, **Find out**, observations, and read records. Knowledge search runs against the authorized character's information. Responses are paginated to at most 100 acquisitions, with bounded observation and record lists.

Known, unverified, rumored, suspected, stale, last-known, and historical distinctions survive projection. Hypotheses and leads support status, confidence, supporting sources, and contradicting sources; assessment history is retained. Marking a hypothesis verified is a character assessment and does not change World Truth.

Existing profile, map, autocomplete, and action projections remain in the permission path. Unseen current locations and hidden names are not introduced by the information module. Game Mode retains its freeform action escape hatch.

## 8. Context purposes and assembly

Separate profiles exist for narration, NPC planning, dialogue, input parsing, knowledge queries, recaps, research, investigation, memory consolidation, validation, and Creator assistance.

Assembly loads current state, applies viewer permissions, includes current events, selects relevant knowledge/observations/active threads, then considers memories, records, relationships, summaries, lore, and directives allowed by that purpose. NPC-private planner goals are limited to that NPC's planning profile. Other characters' private beliefs and OOC notes do not enter the bundle.

Every live narration/parser/planner request carries campaign, timeline, viewer, state revision, event cursor, and purpose metadata. Narration commits retain frozen information manifests. Responses are checked against the live revision and cursor before acceptance. A stale narration preserves the previously committed grounded text; a stale parser/planner result is not accepted as a new proposal.

## 9. Retrieval and budgets

Structured matches outrank optional semantic scores. Permission filtering precedes semantic ranking. An optional semantic scorer can fail without preventing deterministic retrieval.

Profiles set total budgets, category budgets, a four-turn dialogue window, and an 80-record cap. Current state/events are protected. Optional material is removed as whole records; no arbitrary text slicing is used by the new assembler. The final conservative estimate counts UTF-8 bytes, including the bundle envelope. If required material cannot fit, the manifest is marked unready instead of declaring an incomplete bundle usable.

Duplicate source records are removed without merging contradictory propositions. Existing context assembly no longer discards a competing account merely because it has the same subject/predicate. Player manifests do not report inaccessible source counts or spoiler-shaped rejected IDs.

## 10. Summaries and invalidation

Scene, thread, relationship, character, and campaign summary contracts store viewer, sources, source hash, generation version, event cursor, and retained anchors. Scene transitions automatically consolidate relevant observations and active information. Exact threats and unresolved commitments remain canonical even when a compact summary cannot include them.

Summarization is deterministic and source-preserving. A proposed summary that introduces an unsupported event is rejected. Changed source content invalidates its summary hash. Cache loss is repaired from canonical acquisitions, observations, memories, and active information. Rebuild operations never modify relationship values or World Truth. Recaps read canonical observer-filtered events rather than reconstructing state from Chronicle prose.

Retrieval is rebuilt from canonical state on demand; no persistent vector cache is a source of authority.

## 11. Information firewall

The firewall combines structural permissions, acquired text rather than hidden proposition values, viewer-safe identity labels, purpose profiles, source-backed narrative validation, canary scanning, and stale-call rejection. In-world emails, notes, dialogue, records, and imported text remain data. They cannot change tools, permissions, or instructions.

Privileged validation returns abstract defect codes. Retry prompts receive no canary value or hidden explanation. The existing narrative source validator also rejects unsupported actions, discoveries, interiority, and characterization. The canary check is an additional detector, not a claim that keyword matching alone proves arbitrary prose safe.

## 12. Branch rewind and restore

Save/export/import includes propositions, acquisitions, observations, transmissions, records, public/cohort awareness, notes, active questions, hypotheses, histories, and conflicts. Branching an earlier checkpoint restores that checkpoint's knowledge. Later discoveries remain in the parent. Derived summaries are cleared for a new timeline, while call manifests remain scoped to their original timeline.

Context scope comparison rejects mismatched campaign, timeline, viewer, revision, or cursor. An explicit Creator identity merge remaps information references and is reversible through the existing audited merge workflow.

## 13. Developer and QA tools

The Creator interface exposes information diagnostics and derived-summary invalidation. The authenticated API additionally provides:

| Tool | Endpoint or operation |
| --- | --- |
| Context manifest and exact sections | `GET /game/timelines/:id/information/context` |
| Who knows, acquisition history, observer matrix, propagation graph, conflict graph, truth comparison, freshness, and cache version | `GET /game/timelines/:id/information/diagnostics` |
| Transitive retcon impact preview | `POST /game/timelines/:id/information/retcon-preview` |
| Rebuild scene/thread/relationship/character/campaign summary | `information/developer`, operation `summary` |
| Invalidate derived summaries | operation `invalidate` |
| Inject canary secret and aliases | operation `canary` |
| Author information and exposure | operations `proposition`, `record`, `observation`, `transmission`, `exposure`, `active` |
| Background awareness and named-character materialization | operations `cohort`, `cohort-exposure` |

Retcon previews follow transitive source dependencies into acquisitions, records, observations, transmissions, memories, relationships, hypotheses, and summaries. The preview itself is read-only; deliberate canon edits use audited Creator mutations.

All developer operations require campaign Creator/admin access. Player operations require control of the character and mutations use revision checks and idempotency receipts.

## 14. Fallback behavior

Semantic retrieval failure uses structured/lexical ranking. Summarization uses deterministic source compression. Missing or ambiguous permission denies the secret. Missing derived summaries leaves canonical knowledge intact. Oversized required context is marked unusable for that call. Provider or validation failure preserves committed mechanics and grounded narration. Stale output is discarded without repeating the action.

## 15. Acceptance and regression verification

The completed dedicated System 3 suite contains **33 server/domain tests and one browser test**. It covers the specification's information boundaries through grouped scenarios rather than one superficial test per heading.

| Specification scenarios | Verification |
| --- | --- |
| Hidden murderer; private planner motive; PC private fear; privileged validator; prompt injection; secret field existence | Purpose isolation, exact/alias canaries, characterization rejection, safe source prompts, player/Creator route authorization, hidden-record absence |
| False rumor; unread text; preview fragment; language barrier; correction exposure; public news | Distinct delivery/exposure/comprehension/acceptance transitions, partial-then-full reading, immutable original observation, no unexposed acquisition |
| Rumor ancestry; source convergence; named/background population; institutional hive mind | Three-hop ancestry, repeated-root corroboration, individual cohort materialization, institution access and misuse audit |
| Partial plate; presence without witnessing; misrecognition; hidden passive failure; repeat search; changed conditions | Individual sensory conditions, partitions, recognition confidence, exact raw fragments, silent failure and attempt keys |
| Exact threat; routine dialogue; player belief; OOC speculation; notes; hypotheses | Real communication integration, zero routine durable observations, pinned exact wording, idempotent freeform belief and assessment histories |
| Last-known location; stale directory; conflicting records; amendments; no result; public record access; research expertise | Snapshot text/freshness, separate information/acquisition dates, retained conflicts, immutable amendments, accessible-corpus query and source-only results |
| Viewer-specific projections; map/profile/autocomplete/affordance leaks; progressive discovery | New identity/location tests plus existing core-turn, NPC-profile, physical-search, phone, and investigation acceptance suites |
| Canon conflict; disputed history; summary hallucination; scene closure; dormant threads; cache loss; retcon preview | Authority conflict objects, explicit disputes, source-only summaries, active anchors, regeneration and transitive impact tracing |
| Cross-branch isolation; rewind/save restore; stale calls | Real save/branch test, compressed snapshot round-trip, saved-note restoration, scope mismatch tests and the existing slow-provider regression |
| Long campaigns; prompt authority order; unknown versus absent | Bounded 100/10,000-record comparisons, protected current state, provider-size checks and explicit no-accessible-match semantics |

Initial full verification on 2026-10-06 (before the four release-completion regressions below):

| Check | Exact result |
| --- | --- |
| `npm test` | **421 passed across 73 test files; 0 failed, 0 skipped, 0 canceled, 0 TODO; exit 0** |
| Dedicated System 3 coverage within that run | **29 server/domain tests + 1 browser test passed** |
| `npm run check` | TypeScript validation passed; exit 0 |
| `node --check public/app.js` and `node --check public/phone-apps.js` | Both passed; exit 0 |
| `git diff --check` | Passed; exit 0 |
| Mobile/iPad notebook accessibility | Zero axe violations; both viewport and overflow checks passed |

The initial complete local test log is `artifacts/system03-release-verification.txt`; aggregate counts are in `artifacts/system03-verification.json`. These ignored verification artifacts are available in the workspace. The full run includes existing save/restore, release rehearsal, authorization, narration, physical simulation, and UI regressions. Deployment verification is recorded in the release addendum below.

## 16. Leakage results

Dedicated exact and alias canaries stay out of unauthorized bundles across all eleven profiles. Hidden NPC motive and private PC belief checks pass. Local validation rejects direct canary disclosure and unsupported guilty characterization while exposing only abstract defects. Existing source-anchored narration, hidden-identity, concealed-item, evidence, and knowledge-filtered affordance tests provide additional regression coverage.

No live external AI service is needed by these tests; local provider doubles exercise the same acceptance and retry boundaries.

## 17. Scaling measurements

Measurements from `artifacts/system03-release-verification.txt` on this Windows workspace:

| Fixture | Result |
| --- | --- |
| 10,000 unrelated private history records | 2,242 estimated tokens, identical to the short fixture; 7.06 ms assembly |
| Same viewer, 100 versus 10,000 memory records | 2,799 versus 2,808 estimated tokens; 392 ms for the large fixture |
| 10,000 persisted canonical source references/acquisitions | 7,051 ms initial persistence; 610 ms load; 507 ms context assembly; 3,760 estimated tokens |
| Large persisted information fixture | 9,447,989 information JSON bytes; 17,173,766 full-state JSON bytes; 23,134 snapshot-manifest bytes, excluding compressed chunks |
| Existing 1,001-NPC/1,000-lore benchmark | Ten simulated hourly turns, including autosaves: 26,749 ms; unchanged ceiling: 30,000 ms |

The 10,000-record fixtures synthesize canonical history; they do not claim that 10,000 paid AI calls or full interactive turns were executed. The large-roster benchmark performs actual simulation turns. Measurements are local and workload-dependent.

## 18. Operational accessibility and cost implications

Prompt size is bounded independently of save age. Full state and canonical information still grow with history; this implementation retains the repository's full-state loader and timeline JSON persistence. Source-linked summaries reduce prompt work, not the need to preserve canonical history. Compression and content-addressed snapshots reduce repeated storage, while manifests and access histories add audit storage.

The deterministic research, summaries, and local retrieval require no external service and incur no AI token charges. Narration continues to obey existing campaign/user budgets. The additional safe guidance is subject to those existing provider limits.

The browser test exercises the notebook at 390×844 and 820×1180. Search, authoring, time-consuming research, keyboard/accessibility labels, and horizontal overflow pass; axe reports zero violations. Mobile and iPad screenshots were inspected. Large lists are bounded and details use expandable native controls.

## 19. Author choices and stop condition

No author decision blocks the implemented code paths. Campaign content still determines actual records, credentials, institutional misuse rules, identities, propositions, source reliability, and cohort exposure. Those are authored world data rather than invented canon.

This delivery stops at the supplied System 3 specification. It does not implement the deeper autobiographical memory/decay system identified as System 4 in that document.

## Release completion addendum

The deployment review fixed maximum-size research turns: narration now records a bounded receipt while full source text and acquisitions remain intact. Summary validation indexes canonical sources once per context build; 1,000 summaries assembled in 103 ms in the focused regression. NPC goals are excluded from every non-planning information profile, even when the perspective is that NPC. Active historical acquisitions retain their Historical label. Four new regressions cover these boundaries. The PWA shell cache advances to v30, and operating instructions now identify schema 49.

Production database credentials are not available in this workspace, so no live database backup/restore rehearsal or provider-retention claim is made. Migration 049 is additive; local migration and restore rehearsals are covered by the release tests. Existing live data is retained.

Completion preflight: 43 tests passed across System 3 domain/UI, context assembly, and release-rehearsal suites, including all four new regressions. TypeScript, JavaScript syntax, and whitespace checks passed. The production dependency audit reported zero vulnerabilities. Final full-suite and live deployment evidence is saved in `artifacts/system03-completion-verification.json`, `artifacts/system03-deployment.json`, and `artifacts/system03-live-smoke.json`.
