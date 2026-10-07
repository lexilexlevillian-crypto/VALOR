# System 5 — NPC Character and Behavior

Implemented against the supplied `VALOR_System_5_NPC_Character_and_Behavior_System_Master_Spec.docx`. Database schema: **51**. Behavior state: **1**. Rules: **npc-behavior-v1**. The implementation integrates with the current System 3, System 4, character editor and offline shell. Release evidence is recorded below.

## Using the system

In Creator mode, open **NPC Registry → select an NPC → Behavior and decisions → Open behavior editor**. Author the NPC's supported plans in its character record, then preview and publish a behavior profile. Publication activates the controller for that NPC. Existing NPCs without a published profile retain their previous planner, and existing saves without behavior state remain readable.

The editor exposes traits, values, motives, fears, habits, loyalties, need responses, boundaries, anchors, speech acts, disclosure locks and tuning. Preview evaluates disposable copies at the current time and after authored cooldowns; it does not execute actions, write a profile or advance the timeline. Publishing requires a new immutable version after the first publication. The same panel exposes freeze/resume, reevaluation, promotion, decision receipts and the schema for advanced commands.

Run the normal `npm run migrate` against the intended development database before using schema 51. The implementation tests migrate isolated fixture databases; they do not migrate a user's live database.

## Ownership and behavior

`behavior-contracts.ts` defines strict profiles, goals, decisions, runtime state, lifecycle transitions and proposal envelopes. `behavior.ts` implements deterministic selection; `simulation.ts` sends the selected authored plan through the existing domain resolver. The controller owns behavioral state only. Money, inventory, movement, relationship history, consent, observations, information transmission, memory and physiological needs retain their existing owners.

Registered plans include speech, travel, messages, calls, work, social contact, information sharing, care, relationship offers, breakup, consent withdrawal, authored crime and scene events. Domain bindings additionally invoke the existing physical, item, purchase/sale, communication, combat and pursuit owners. Crime requires explicit registration and perceived conditions; violence requires an authored severity policy and a recent perceived cause. Selecting an action is not proof it succeeded. Receipts record its outcome, source events and handoff. Travel retains a real journey, revalidates its continuation, and satisfies arrival goals only after arrival. Withdrawal calls the existing consent owner and never creates a second consent ledger. Player-directed questions, calls and offers stop managed time compression and remaining compound clauses.

Utility uses integer 0–1000 features and the specified weights: goal 250, need 150, value 150, obligation 100, social 100, risk −150, effort −50 and repetition −50. Rounding is half away from zero. Hard capability, reference, knowledge, disclosure, lifecycle and boundary gates precede scoring. Stable IDs break ties; switching requires a margin above 50. Optional weighted variation is limited to a configured near-tie band and records its seed lineage, candidates and draw. There are at most 12 eligible optional candidates, reduced to four under high stress; mandatory threat responses and bounded wait remain separate. Authored plan cooldowns still apply in addition to behavior cooldowns.

Goal dependencies are acyclic. Four goals can be active; overflow is suspended or explicitly abandoned while deadline obligations remain represented. Authoring cannot declare a goal satisfied. Recovery uses elapsed game time and integer remainders. Appraisals deduplicate perceived causes, conflict thresholds have hysteresis, and trait development requires unique evidence, an unlocked trait, a daily cap of 20 and a baseline deviation cap of 100. Published milestones can make a separately bounded development after required goals resolve with sufficient owner evidence. Ordinary development rules apply automatically from unique observations. Demographic descriptions and custom/generated origin grant no capabilities. Bias defaults to absent; an authored bias needs a named, approved, bounded rule with rationale, target attribute and provenance, and can use only a perceived, recognized attribute.

Dormant actors skip ambient decisions and wake on durable perceived communications or explicit wakes/deadlines. Wakes coalesce by actor, cause and kind. Generated crowd materialization has deterministic branch-scoped identity. Promotion preserves the same character and its external records. Consequential committed behavior promotes a generated actor once.

## Knowledge, expression and privacy

The controller requests the System 3 NPC context profile. System 3 remains the retrieval boundary for System 4 memories. Current conversation is required context; historical records compete within the configured token budget. If protected context cannot fit, the decision is blocked. The model-facing bundle contains accepted sections only, while the full context manifest remains in Creator diagnostics. The NPC, current place/rules, active plan targets and protected conversation are required; unrelated bystanders compete as whole optional records. The projection is reused within a decision, never across actors or revisions.

Decision receipts retain the context hash, manifest, dependency schema versions, profile/rules versions, feature vectors, rejected candidates, attempt ID and committed event hash. Context call IDs are deterministic so diagnostic persistence does not introduce replay differences. Shared `character.voiceProfile` remains the voice authority.

Speech uses authored wording and the existing language/perception resolver. Structured claims refer to entries the speaker possesses and that survived context selection. Full comprehension is required before claims reach a recipient. Transmission uses System 3 provenance and preserves shared rumor origins; a spoken false belief does not change canonical truth. Partial or absent comprehension does not grant the full proposition. Disclosure locks can block a claim without deleting the speaker's knowledge.

Optional network planning is implemented in behavior-planner.ts and the turn kernel. It is disabled by default and requires a published profile with planner.enabled=true, a configured direct provider ID and nonzero campaign/user budgets. The model chooses up to three distinct offered, grounded plan IDs. It receives no world-write tool. Every consequential step is revalidated by the deterministic controller and owning resolver. Mandatory reactions, pending actions and combat skip network planning.

There is at most one NPC planning request per player command, with at most one repair and a two-second total service deadline. A durable request claim is written before network I/O; duplicate or interrupted requests cannot initiate another call. Accepted results or deterministic fallback are persisted for replay. Generation, branch, revision and profile changes invalidate proposals. Requests use the shared AI gateway, audit sink and token reservation accounting. A provider failure never becomes a fictional world outcome.

Three-step routines and accepted proposals retain their completed checkpoint and stop for a player response. Domain tasks resolve only after their authored world duration. Resource leases coordinate competing attempts without transferring ownership; expiry, profile migration, repair and completion release them. Freeze suspends pending execution. Domain receipts retain checks, RNG seed/draw count and actual result. Infrastructure and invalid-duration errors roll back the transaction; recognized in-world blockers produce a failed attempt. Published profiles also replace the legacy automatic combat choice path.

## Persistence and API

Migration `051_system05_npc_behavior.sql` adds one JSON-validated behavior root per timeline and durable optional-planner request receipts. It is additive; existing schema-50 tables and migration checksums are unchanged. Normal mutations, optimistic revision checks, idempotent receipts and transaction rollback cover the root. Turn audit/write grants register it under `npc_behavior`. The older canonical 32-system inventory still calls its integration owner system 16; that numbering is separate from the supplied master specification's System 5.

Both ordinary and deduplicated snapshots include behavior. Saves, exports, imports and branches preserve profiles, goals, cooldowns, appraisals, attempts, decisions and interventions. Branching increments actor generations and invalidates pending work while retaining historical receipts and revalidatable journeys. Old schema-50 snapshots have no behavior root and remain compatible.

All routes below require Creator authority under `/game/timelines/:id/npc-behavior`:

| Method/path | Behavior |
| --- | --- |
| `GET /schema` | Strict profile/command schemas and optional planner status |
| `GET /inspect?actorId=UUID&offset=0` | Profile history, runtime, shared voice, interventions and paginated decisions |
| `POST /preview` | `{profile}`; disposable validation and decision previews |
| `POST /validate-proposal` | `{actorId,decisionId,proposal}`; validation only |
| `POST /command` | `{revision,command}` plus the normal idempotency/CSRF headers |

Commands support `publish`, `goal`, `freeze`, `reevaluate`, `promote`, `tier`, `repair`, `adapt`, `template`, `instantiate` and `materialize`. Published template versions are immutable and instances pin their versions. Referenced plans must exist on the target character. Repair cancels eligible pending work with an intervention reason; it does not erase committed domain effects.

## Verification

The evidence package uses fixture IDs s05-completion-v1 and system05-completion-v1, Node 24.21.0, Windows x64, and the repository test runner. Test output, deterministic hashes, benchmark configuration and deployment status are retained with the release record. The [acceptance evidence map](SYSTEM_05_ACCEPTANCE_MATRIX.md) connects all 126 specification cases to controller tests or the authoritative owner suites. The mapping does not claim 126 separate end-to-end fixtures or physical-device certification.

Automated coverage includes real HTTP authoring and authorization, preview, actual turn execution, domain resource contention, freeze/resume, expired reservations, failed doors, incapacitation, profile migration, milestones, scoped bias, variation/replay, interrupted routines, combat initiative and checks, planner success/outage/replay, branch isolation, fractional intervals, bounded queues, generated identity and promotion, and existing information/memory/consent/narrative owners.

The Chromium fixture publishes a profile, verifies no time advance, checks 390/820/1536-pixel layouts, collects uncaught errors and runs axe on the editor. Its inspected screenshot is artifacts/system05-creator.png.

Crowded-scene reference fixture: 82 colocated characters, 81 published profiles, no network planning, one acquisition plan and 80 quiet actors. The final measured result is recorded in the release evidence. The optimization removed redundant observer projection and made unrelated scene rows optional. This measures complete context plus decision work, not selection arithmetic alone. The 10 ms design target is not claimed as met. Overload retains mandatory work or fails explicitly; it does not silently skip it.

Operational bounds: 1,000 queued wakes per actor, 10,000 retained decision receipts per timeline, twelve optional candidates (four under high stress), three plan steps and sixteen reserved resources per task. Capacity overflow is an explicit transaction failure. Immutable saves and histories consume storage; there is no silent pruning. These bounds are visible operational limits, not an unlimited-scale guarantee.

Live AI provider credentials and paid budgets are not enabled by this feature. Network behavior is verified with injected adapters through the real gateway and database. Deterministic operation is complete with no AI configured. Physical Safari/VoiceOver and large production soak testing remain environment-specific validation.

## Release

See [release evidence](SYSTEM_05_RELEASE.md) for the exact source revision, final checks and Render deployment verification. Production targets the existing VALOR service in the user-confirmed My Workspace. Startup applies migration 051 before serving readiness. The existing external database configuration is preserved.
