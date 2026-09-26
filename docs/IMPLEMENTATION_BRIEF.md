VALOR - COMPLETE CODEX / ASTRA SYSTEM IMPLEMENTATION PROMPTS
Grounded 2012 Modern American Text RPG

PURPOSE

Build VALOR as a persistent, grounded, realistic crime-drama and dark-romance text RPG set in the fictional American city of Valor in or around 2012. It is a sandbox, not a fantasy game and not a chat application. The Creator authors the city's canon; engine code must never hardcode the user's neighborhoods, gangs, families, police departments, businesses, or story canon.

MASTER ARCHITECTURAL RULE

DATABASE DETERMINES WHAT EXISTS. SIMULATION DETERMINES WHAT HAPPENS. AI INTERPRETS, REASONS, AND NARRATES.

The server and simulation are authoritative. The client is a presentation and input surface. AI is never authoritative state, never silently changes canonical facts, never rolls mechanics, and never creates items, injuries, evidence, relationships, money, travel, or history outside validated tool calls. All durable state is database-backed, versioned, and migration-safe.

GLOBAL EXECUTION RULE FOR EVERY SYSTEM

Implement ONE numbered SYSTEM completely. Run its tests, preserve backward compatibility, report the result, and STOP. Do not begin the next numbered SYSTEM until explicitly instructed. Use existing project conventions where sound; do not perform broad rewrites merely to make code look cleaner. Create migrations for persistent schema changes. Do not store authoritative game data only in source, seed files, localStorage, prompts, or the client.

When a requirement depends on undecided mathematics, policy, content rating, jurisdiction, or canon, expose a safe configurable rule and report the underspecification. Do not invent canon or pretend an unresolved formula is final. Prefer stable IDs, explicit ownership, auditability, validation, deterministic simulation, graceful failure, and content authored through Creator.

AI PLAYER-AGENCY LAW

Never invent a player's voluntary dialogue, thoughts, feelings, beliefs, decisions, intentions, consent, movement, gestures, or actions unless the player explicitly supplied or delegated them. Never make a relationship meter declare what the player feels. The narrator may describe mechanically supported external consequences, involuntary physical/sensory effects, and the words/actions of NPCs. If an ambiguous action needs a choice, present the consequence and wait for player input.

WORLD TRUTH AND POV SEPARATION

Keep separate, queryable layers for: (1) World Truth - authoritative facts and events; (2) Character Knowledge - facts a character has reasonably learned; (3) Beliefs - possibly false, stale, biased, or inferred propositions with confidence and source; and (4) Memories - episodic, subjective records with salience, decay, privacy, and provenance. AI context must receive only information valid for the relevant observer and narrative perspective.

2012 REALISM LAW

No supernatural assumptions, magic, fantasy calendar, heroic armor, medieval transport, or future technology. Support era-appropriate smartphones, feature phones, SMS/MMS, calls, voicemail, email, Facebook/Twitter-era social media, computers, GPS, CCTV where plausible, cash/cards, landlines, public transit, and physical records. Do not assume 2026 apps, device capabilities, surveillance coverage, or instant universal information.

SYSTEM INDEX

01 Foundation, Persistence, Authority, Authentication, and Security
02 Valor Client Shell, Chronicle, Navigation, and PWA
03 AI Gateway, Context, Narrative Control, and Transactional Story Turns
04 Canon, Lore, Memory, Knowledge, Beliefs, Story Cards, and Retrieval
05 Characters, Character Creator, Attributes, Skills, Traits, and Backgrounds
06 NPC Autonomy, Schedules, Goals, Group Dynamics, and Living World Simulation
07 Relationships, Family, Romance, Consent, Sex Settings, and Social Dynamics
08 Persistent Objects, Inventory, Clothing, Weapons, Firearms, Phones, and Vehicles
09 Health, Injury, Medicine, Substances, Death, and Corpses
10 Checks, Combat, Violence, Restraint, Chases, and Tactical Presentation
11 Time, Weather, Locations, Travel, Map, and Spatial Rules
12 Economy, Work, Housing, Businesses, Money, and Daily Life
13 Crime, Police, Law, Evidence, Investigation, Reputation, and Factions
14 Quests, Dynamic Events, Watchers, Rumors, Journal, and Case Files
15 Campaigns, Saves, Timelines, Difficulty, Settings, and Recovery
16 Creator, Developer Mode, Administration, Debugging, Import, and Export
17 Integrated Quality Gates, AI Safety, Cost Controls, Accessibility, and Performance
18 Final Acceptance, Deployment, Operations, and Regression Protection

######################################################################
SYSTEM 01 - FOUNDATION, PERSISTENCE, AUTHORITY, AUTHENTICATION, AND SECURITY

SYSTEM EXECUTION INSTRUCTION
Establish the durable, server-authoritative application foundation before feature work.

PHASE 1 - CODE: DOMAIN AND DATABASE FOUNDATION
GOAL: Create a normalized, extensible campaign/world/content model with UUID/stable IDs, timestamps, ownership, visibility, revision/version fields, archival state, and audit metadata.
REQUIREMENTS: Separate reusable Creator content from campaign-instanced state. Use migrations, foreign keys, transactions, soft archive where history matters, and immutable event/audit records where state changes need explanation. Every custom field and section must retain stable identity after rename or reorder.
TESTING: Migration up/down or compatible forward migration tests; persistence across restart; ownership/tenant isolation tests.

PHASE 2 - CODE: SERVER AUTHORITY AND SECURITY
GOAL: Define authenticated user, Creator/admin, player, and future restricted-view roles. Authorize every server mutation and query by campaign, role, and knowledge/visibility policy.
REQUIREMENTS: Validate inputs server-side; use secure session/token handling, rate limits, CSRF protection as applicable, parameterized data access, secret management, structured logs with redaction, audit logs for Creator/admin changes, backups, and least privilege. Never trust client IDs, clocks, mechanics, or AI claims.
DO NOT: Put secrets in prompts/client bundles; expose hidden NPC fields through API payloads; use localStorage as canonical storage.

PHASE 3 - CODE: CORE EVENT AND SIMULATION CONTRACTS
GOAL: Define typed commands, validated domain events, projections, idempotency keys, transaction boundaries, deterministic random-seed/audit support, and notification hooks.
FINAL REPORT: Schema/modules added, migration status, authority boundaries, tests run, deferred decisions.

######################################################################
SYSTEM 02 - VALOR CLIENT SHELL, CHRONICLE, NAVIGATION, AND PWA

SYSTEM EXECUTION INSTRUCTION
Build an iPad-first responsive shell with a coherent Valor visual direction: dark charcoal/black, dirty off-white, muted industrial surfaces, restrained amber/red warnings, and sparse file-folder, police-report, newspaper, diner, or night-neon texture. It must feel like a 2012 urban crime drama, not fantasy, cyberpunk, SaaS, chat bubbles, gacha, or medieval ornament.

PHASE 1 - CODE: APPLICATION SHELL
GOAL: Build Main Menu, New Game, existing playable-character roster, Creator entry, and authenticated campaign selection.
REQUIREMENTS: Touch targets, keyboard support, reduced motion, high contrast, responsive portrait/landscape layouts, offline-safe read shell/PWA caching where appropriate, and clear loading/error/reconnect states.

PHASE 2 - CODE: CHRONICLE AND GAME NAVIGATION
GOAL: Create prose-first Chronicle with command/action composer, turn history, scene header, current time/location, visible choices as optional affordances, and non-chat-bubble narration.
REQUIREMENTS: Navigate Character, Inventory, Equipment, Phone, Map/location browser, Relationships, Journal/Case Files, Lore, Skills, Traits, Health, Vehicles, Jobs/Money, Settings, Save/Load, Combat, Loot/Search, and business interfaces. Render only player-permitted knowledge.

PHASE 3 - CODE: UI QUALITY GATE
TESTING: iPad viewport, keyboard, screen reader, offline/reconnect, long prose, large roster, and hidden-data leakage tests.
FINAL REPORT: Screens delivered, accessibility/PWA checks, known visual decisions.

######################################################################
SYSTEM 03 - AI GATEWAY, CONTEXT, NARRATIVE CONTROL, AND TRANSACTIONAL STORY TURNS

SYSTEM EXECUTION INSTRUCTION
Create provider-agnostic AI orchestration. AI can propose interpretation/narration and invoke narrow validated tools; it cannot directly mutate authoritative state.

PHASE 1 - CODE: PROVIDER-AGNOSTIC GATEWAY
GOAL: Create adapter interfaces for multiple model providers, model selection, streaming, structured outputs, retries, timeouts, budgeting, redaction, and observability without hardwiring one vendor.
REQUIREMENTS: Store prompts/templates/version metadata separately from secrets. Validate all structured model output against schemas. Fallback safely on provider failure.

PHASE 2 - CODE: CONTEXT ENGINE AND NARRATIVE CONTROL ENGINE
GOAL: Assemble bounded, relevance-ranked context from current scene, World Truth, permitted knowledge/beliefs/memories, Story Cards, active directives, relationships, goals, event history, and retrieved lore.
REQUIREMENTS: Token budgets, source/provenance labels, recency and salience, semantic plus structured retrieval, repetition damping, continuity checks, character-drift detection, style directives, safety/content settings, and conflict resolution favoring authoritative data. Narrative directives may control pacing, focus, tension, POV, and content limits but never override player agency or truth.

PHASE 3 - CODE: STORY-TURN PIPELINE
GOAL: Implement input -> intent parse/proposal -> server validation -> deterministic simulation/check resolution -> emitted events -> context build -> AI narration -> output validation -> commit/projection.
REQUIREMENTS: Retry narration without rerolling mechanics; idempotency; tool-call allowlists; transaction rollback on invalid mutation; transcript/event correlation; human-readable failure recovery. AI may ask a clarifying question rather than guess a voluntary action.
TESTING: Provider failure, malformed output, retry-without-reroll, agency violations, hidden-fact leakage, repeated-prose, and concurrent turn tests.
FINAL REPORT: Gateway contract, turn trace example, costs/limits, test results.

######################################################################
SYSTEM 04 - CANON, LORE, MEMORY, KNOWLEDGE, BELIEFS, STORY CARDS, AND RETRIEVAL

SYSTEM EXECUTION INSTRUCTION
Implement the epistemic backbone. Creator-authored canon is data, never engine code.

PHASE 1 - CODE: LORE AND CANON RECORDS
GOAL: Support versioned lore for city/districts, organizations, families, laws, history, businesses, people, rumors, and authored rules with tags, links, visibility, validity period, source, and custom Creator sections.

PHASE 2 - CODE: KNOWLEDGE, BELIEF, AND MEMORY
GOAL: Record who knows, suspects, remembers, forgot, misremembers, witnessed, was told, or believes each proposition; include confidence, source, secrecy, timestamp, decay/refresh, and correction.
REQUIREMENTS: NPC-to-NPC information transfer must be modeled or event-supported. Police knowledge, rumor, and actual truth remain distinct.

PHASE 3 - CODE: RETRIEVAL AND STORY CONTINUITY
GOAL: Implement semantic retrieval plus exact filters, Story Cards with activation conditions/priority/expiry, memory salience, timeline-aware retrieval, conversation continuity, and contradiction detection.
DO NOT: Surface secrets merely because they are semantically relevant; let generated prose become canon without validation.
FINAL REPORT: Retrieval policy, privacy tests, memory lifecycle behavior.

######################################################################
SYSTEM 05 - CHARACTERS, CHARACTER CREATOR, ATTRIBUTES, SKILLS, TRAITS, AND BACKGROUNDS

SYSTEM EXECUTION INSTRUCTION
Build one rich shared Character architecture for playable characters and NPCs. Character Creator must create both; saving an NPC puts it in a persistent, Creator-visible NPC List. Future player-facing restrictions must be supported now.

PHASE 1 - CODE: SHARED CHARACTER RECORD
GOAL: Persist identity/name/aliases, DOB/age, sex/gender/pronouns, appearance, height/build, hair/eyes/complexion/features/scars/tattoos/disabilities, presentation and socially interpreted attractiveness without universal beauty scoring; ethnicity/culture only as authored identity/context, nationality, origin/neighborhood, class, family/background, occupation/employer, education, religion/beliefs, home, finances, possessions, vehicles, phone/contact data where in-world appropriate, location, schedule, mood, goals/fears/needs, secrets, voice, AI behavioral instructions, and planning state.

PHASE 2 - CODE: CREATOR FORMS AND CUSTOMIZATION
GOAL: Supply identity, appearance, background, stats, skills, traits, health, inventory, relationships, factions, knowledge, memories, and notes editors plus unlimited Creator-defined sections/subsections/fields.
REQUIREMENTS: Add/rename/reorder/edit/duplicate/archive/delete sections and fields without losing values; stable field IDs; field types/validation/visibility; templates; import-safe defaults; no source editing required.

PHASE 3 - CODE: ATTRIBUTES, SKILLS, AND TRAITS
GOAL: Use Strength, Agility, Endurance, Intellect, Perception, Presence, Will. Provide configurable realistic skills: hand-to-hand, firearms by family/proficiency, melee/improvised, driving, athletics, stealth, lockpicking, pickpocketing, burglary, streetwise, deception, persuasion, intimidation, empathy/insight, investigation, search, first aid, mechanics, 2012-era electronics/computers, cooking, job/trade skills, academics, literacy, languages, police procedure, law, criminal knowledge.
REQUIREMENTS: Do not finalize dice math unless authored. Build a trait catalog architecture and initial Creator-editable catalog: physical (size/build, weak/strong, athletic, graceful/clumsy, scarred, intimidating/distinctive appearance, authored limitations); personality (cunning through commitment-averse, including impulsive, patient, manipulative, charming, anxious, loyal, jealous, protective, cruel, brave, reckless, honest, secretive, flirtatious, romantic); experience (untrained/trained/experienced/veteran, street fighter, boxer, grappler, martial arts, firearms, police, military where supported, criminal, driver, mechanic, medic); social (connected/respected/feared/notorious, class, affiliation, record/ex-con/informant/snitch reputation). Traits support descriptive or costed advantage/disadvantage modes, caps, anti-exploit refunds, opposition, prerequisite, combination, acquisition/loss, hidden/permanent state, mechanical modifiers, and AI guidance.
TESTING: Existing NPC persistence after schema/UI change; skill/trait prerequisite tests; player/NPC parity.
FINAL REPORT: Character schema, catalog coverage, unresolved mechanics.

######################################################################
SYSTEM 06 - NPC AUTONOMY, SCHEDULES, GOALS, GROUP DYNAMICS, AND LIVING WORLD SIMULATION

SYSTEM EXECUTION INSTRUCTION
NPCs persist and act offscreen. Use tiered deterministic simulation; reserve AI reasoning for meaningful, bounded moments.

PHASE 1 - CODE: NPC LIFE MODEL
GOAL: Model schedule, work, sleep, travel, needs, routine locations, current activity, goals, capabilities, funds/items, affiliations, relationships, memories, mood, and planning state.

PHASE 2 - CODE: TIERED SIMULATION
GOAL: Simulate active scene NPCs in detail, nearby/relevant NPCs at medium fidelity, and distant NPCs through deterministic schedule/event catch-up. Handle missed time and fast-forward without full-world AI calls.
REQUIREMENTS: NPCs may socialize, form/break relationships, work, travel, pursue goals, commit crimes, become injured/arrested/killed, and react only to information/capability they possess. Group dynamics include leadership, cohesion, conflict, witnesses, and contagion of mood/rumor.

PHASE 3 - CODE: INITIATIVE AND DRIFT CONTROL
GOAL: Event-driven NPC initiative creates messages, visits, offers, threats, romance moves, fights, or offscreen outcomes where context warrants. Detect behavior/personality drift and prevent action spam/repetition.
TESTING: Catch-up determinism, no omniscience, NPC-to-NPC continuity, performance under large rosters.
FINAL REPORT: Simulation tiers, budget behavior, sample timeline.

######################################################################
SYSTEM 07 - RELATIONSHIPS, FAMILY, ROMANCE, CONSENT, SEX SETTINGS, AND SOCIAL DYNAMICS

SYSTEM EXECUTION INSTRUCTION
Make relationships systemic, history-driven, and independent of the player while preserving absolute player consent and agency.

PHASE 1 - CODE: RELATIONSHIP MODEL
GOAL: Track directional attraction, affection, trust, respect, attachment, familiarity, desire, jealousy, resentment, fear, loyalty, dependency, labels, history, secrets, boundaries, and emotional inertia. Support family, friendship, rivalry, enemies, crushes, dating, casual intimacy if enabled, lovers, commitment, cohabitation, marriage, affairs, breakup/reconciliation, unrequited/secret/multiple/poly dynamics, exes, and toxic/abusive relationship narratives without endorsing them.

PHASE 2 - CODE: ROMANTIC AUTONOMY AND CONTENT SETTINGS
GOAL: Model preferences, compatibility, appearance/presentation, behavior, reputation, history, and context as influences, never guarantees. NPCs can initiate plausible flirting, dates, confessions, exclusivity talks, proposals, jealousy, confrontation, breakup, reconciliation, and intimacy advances.
REQUIREMENTS: Player must explicitly choose voluntary romantic/sexual actions and consent. Content rating/mature-content settings gate depiction and options; core play cannot require explicit sexual material. NPC-to-NPC romance proceeds under same simulation rules.

PHASE 3 - CODE: SOCIAL CONSEQUENCES
GOAL: Connect family, friendships, affiliations, rumor, reputation, safety, housing, jobs, crime, and scenes without collapsing values into a single affinity meter.
TESTING: Directionality, consent, secret visibility, inertia, no authored player emotion, NPC-only relationship progression.
FINAL REPORT: Relationship states, content gates, test evidence.

######################################################################
SYSTEM 08 - PERSISTENT OBJECTS, INVENTORY, CLOTHING, WEAPONS, FIREARMS, PHONES, AND VEHICLES

SYSTEM EXECUTION INSTRUCTION
All tangible objects are persistent instances with provenance, condition, location/container/owner, visibility, and event history. Prose cannot create ammunition, keys, cash, or evidence.

PHASE 1 - CODE: ITEM AND INVENTORY CORE
GOAL: Support clothing, jewelry, wallets/IDs, keys, cash/cards, documents, food/drink, medicine/drugs, tools, containers, computers/cameras/storage media, weapons, ammunition, and authored custom item types. Model stacks only where valid, capacity, concealment, wear, damage, transfer, search, theft, receipts, and persistent ownership.

PHASE 2 - CODE: FIREARMS AND WEAPONS
GOAL: Model individual firearm instances, compatible ammunition/magazines, loaded state, remaining rounds, condition, carry/concealment, serial/identifying information if authored, and realistic proficiency effects. Support melee/improvised weapons and authored ballistic protection coverage; no magical armor abstractions.

PHASE 3 - CODE: PHONES AND VEHICLES
GOAL: Phones retain contacts, calls, SMS/MMS, voicemail, photos/records where supported, ownership, battery/condition if enabled, and access/privacy. Vehicles retain ownership, keys/access, fuel setting, damage, storage/trunk, plate/registration, occupants, location, theft status, and travel/chase/evidence hooks. Support cars, trucks, motorcycles, buses, taxis, and transit as authored.
TESTING: Transfer atomicity, ammo conservation, phone privacy, vehicle location/evidence persistence.
FINAL REPORT: Object invariants and integrations.

######################################################################
SYSTEM 09 - HEALTH, INJURY, MEDICINE, SUBSTANCES, DEATH, AND CORPSES

SYSTEM EXECUTION INSTRUCTION
Health is persistent, grounded, consequential, and mechanically supported; no magical healing.

PHASE 1 - CODE: BODY AND CONDITION MODEL
GOAL: Model hidden underlying health/body locations as appropriate; cuts, punctures/gunshots, burns, blunt trauma, fractures, internal injury, blood loss, pain, fatigue, infection, illness, poison/overdose, unconsciousness, scarring, permanent injury, and disability effects.

PHASE 2 - CODE: TREATMENT AND SUBSTANCES
GOAL: Support first aid, medication, hospital/EMS, bed rest, recovery time, treatment quality, intoxication, alcohol, authored drugs/medications, withdrawal/overdose where enabled, and NPC care decisions.

PHASE 3 - CODE: DEATH AND AFTERMATH
GOAL: Make incapacitation/death persistent, handle corpses, belongings, witnesses, evidence, identification, notification, funeral/estate hooks where authored, and configurable post-death/continue options. Death cannot be casually undone.
TESTING: Wound persistence across saves, treatment time advance, death/evidence integration, health privacy.
FINAL REPORT: Conditions modeled, opt-in intensity choices, unresolved math.

######################################################################
SYSTEM 10 - CHECKS, COMBAT, VIOLENCE, RESTRAINT, CHASES, AND TACTICAL PRESENTATION

SYSTEM EXECUTION INSTRUCTION
Implement dangerous, realistic conflict. Do not invent final dice formulas; make resolution interfaces/configuration explicit.

PHASE 1 - CODE: CHECK RESOLUTION
GOAL: Build auditable checks using attributes, skills, traits, conditions, tools, difficulty, situational effects, and deterministic/random records. Weapon unfamiliarity imposes appropriate effects; experience is relevant but not blanket omnipotence.

PHASE 2 - CODE: COMBAT STATE MACHINE
GOAL: Support initiation, initiative, turns/action economy, movement/position, inspect/look environmental discovery, target/body targeting, attacks, defense/dodge/block/parry where plausible, grappling, restraint/handcuffs, shoves, disarms, improvised/environmental attacks, melee, firearms, reloads, cover, range, line of fire, multiple actors, morale, surrender, fleeing, knockouts, incapacitation, wounds, blood loss, and return to roleplay.

PHASE 3 - CODE: CHASES AND PRESENTATION
GOAL: Support foot/vehicle chases with terrain, traffic, vehicle condition, driver skill, risk, witnesses, and consequences. Present tactical facts without leaking hidden information or forcing player action.
TESTING: Ammunition/accounting, cover/line-of-fire, restraint legality hooks, no reroll on narration retry, replay/audit.
FINAL REPORT: Combat contracts, configuration points, test scenarios.

######################################################################
SYSTEM 11 - TIME, WEATHER, LOCATIONS, TRAVEL, MAP, AND SPATIAL RULES

SYSTEM EXECUTION INSTRUCTION
Create a 2012-configurable real-world-style calendar and location hierarchy without hardcoded Valor canon.

PHASE 1 - CODE: TIME AND WEATHER
GOAL: Model year/month/day/hour/minute, seasons, day/night, dialogue/action/travel/combat time, wait/sleep/fast-forward, schedules, business hours, holidays, date triggers, weather, and healing time. Campaign configuration determines starting date/year and rules.

PHASE 2 - CODE: LOCATION AND TRAVEL
GOAL: Support city -> district/neighborhood -> street/block -> building/business/home -> room/interior; roads/highways/surrounding areas, discoverability, access rules, distance/time, walking, vehicles, transit, taxis, and random/dynamic encounters. Map is optional enhancement; text/location browser is always complete.
REQUIREMENTS: Pixel distance is not authoritative unless Creator maps it to data. Track actor/object/vehicle locations and travel events.

PHASE 3 - CODE: SPATIAL QUALITY GATE
TESTING: Time advancement, schedule arrival, closed business, travel interruption, unknown-location filtering, map fallback.
FINAL REPORT: Time semantics and spatial invariants.

######################################################################
SYSTEM 12 - ECONOMY, WORK, HOUSING, BUSINESSES, MONEY, AND DAILY LIFE

SYSTEM EXECUTION INSTRUCTION
Implement a plausible 2012 USD economy and configurable daily-life simulation without forcing every campaign into survival micromanagement.

PHASE 1 - CODE: MONEY AND BUSINESS
GOAL: Dollars/cents, cash, bank/card abstractions appropriate to 2012, prices and neighborhood modifiers, receipts/transactions, merchant inventories, supply/scarcity, purchases/sales, fences, contraband, stolen goods, and anti-infinite-money protections.

PHASE 2 - CODE: JOBS, HOUSING, AND ROUTINES
GOAL: Jobs/shifts/wages, employers, rent/bills, housing, stores, restaurants/bars, business hours, cooking, laundry, and property access. Connect to NPC schedules and economic consequences.

PHASE 3 - CODE: OPTIONAL NEEDS
GOAL: Configurable hunger, thirst, sleep, hygiene, exhaustion, disease, alcohol/drugs, and, if explicitly enabled and relevant, menstruation/pregnancy. Defaults and difficulty settings must clearly state enabled simulation intensity.
TESTING: Transaction consistency, shift/time integration, merchant stock, optional-needs disablement.
FINAL REPORT: Economy safeguards and default settings.

######################################################################
SYSTEM 13 - CRIME, POLICE, LAW, EVIDENCE, INVESTIGATION, REPUTATION, AND FACTIONS

SYSTEM EXECUTION INSTRUCTION
Build a rich modern crime system. Police never magically know a crime.

PHASE 1 - CODE: CRIME, WITNESS, AND EVIDENCE MODEL
GOAL: Track criminal acts, victims, witnesses, reports/911 dispatch hooks, descriptions, rumors, stolen property, weapons, blood, shell casings, fingerprints/DNA where plausible, CCTV, phones/call records where legally/investigatively obtained, vehicles/plates, informants, chain of custody, discovery, movement, contamination, concealment, destruction, and event linkage.

PHASE 2 - CODE: POLICE AND JUSTICE FLOW
GOAL: Separate truth from police knowledge. Support authored agencies/officers, calls/dispatch, investigation/case files, suspects, leads, warrants/searches, arrests, handcuffs/restraint, booking, jail, bail, interrogation, charges, prosecution/trial/sentencing, probation/parole as expandable systems. Model authority/jurisdiction through Creator data rather than assumptions.

PHASE 3 - CODE: FACTIONS AND HEAT
GOAL: Model gangs, police units, families, businesses, criminal networks, public reputation, heat/wanted attention, retaliation, rewards/bounties where appropriate, and authored corruption as particular behavior, never a universal rule.
TESTING: Knowledge separation, evidence persistence/chain, legal search gating, witness reliability, false accusation paths.
FINAL REPORT: Case/evidence architecture and limits.

######################################################################
SYSTEM 14 - QUESTS, DYNAMIC EVENTS, WATCHERS, RUMORS, JOURNAL, AND CASE FILES

SYSTEM EXECUTION INSTRUCTION
The world creates situations even when the player ignores them. Do not rely on MMO-style quest markers.

PHASE 1 - CODE: STORYLINES AND EVENTS
GOAL: Support authored storylines, hidden objectives, branches, timed/failed outcomes, unconventional solutions, NPC-created problems, crimes, faction conflict, romance, work, random encounters, and AI-assisted proposals validated by rules.

PHASE 2 - CODE: WATCHERS AND EVENT ENGINE
GOAL: Implement event-driven Watchers with conditions over time, locations, people, relationships, inventory, evidence, knowledge, and world state; priorities, cooldowns, expiry, conflicts, and idempotent execution. Watchers trigger deterministic changes and may request AI narration, never the reverse.

PHASE 3 - CODE: RUMORS, JOURNAL, AND CASE FILES
GOAL: Present player-permitted journal/event history, rumor reliability, discovered clues, cases, leads, objectives, outcomes, and unanswered threads. Keep hidden solution state hidden.
TESTING: Ignored event progression, watcher duplicate prevention, timeline branch isolation, knowledge-filtered journal.
FINAL REPORT: Authoring workflow, event trace, guardrails.

######################################################################
SYSTEM 15 - CAMPAIGNS, SAVES, TIMELINES, DIFFICULTY, SETTINGS, AND RECOVERY

SYSTEM EXECUTION INSTRUCTION
Protect player history. A timeline branch never destroys its parent.

PHASE 1 - CODE: CAMPAIGN AND SAVE MODEL
GOAL: Multiple characters/campaigns, manual/autosaves, named saves/timestamps/thumbnails where feasible, checkpoints, duplicate campaign, rollback policy, and campaign settings.

PHASE 2 - CODE: TIMELINE BRANCHING
GOAL: Implement CREATE NEW TIMELINE FROM HERE, restoring a chosen historical point into a named child timeline while preserving Timeline A. Store lineage, turn/event cut point, immutable snapshot/event references, branch-safe projections, and compare/select UI.

PHASE 3 - CODE: RECOVERY AND PORTABILITY
GOAL: Backups, export/import, schema migration, validation, corruption detection/recovery, save compatibility reports, and difficulty/content/simulation settings with clear effect scope.
TESTING: Branch after many turns, autosave recovery, migration of old save, malformed import, parent preservation.
FINAL REPORT: Save guarantees, limits, recovery test results.

######################################################################
SYSTEM 16 - CREATOR, DEVELOPER MODE, ADMINISTRATION, DEBUGGING, IMPORT, AND EXPORT

SYSTEM EXECUTION INSTRUCTION
Creator is a first-class application, not a seed-data editor. All authored content persists through updates and migrations.

PHASE 1 - CODE: CREATOR CONTENT STUDIO
GOAL: Create/edit/archive/duplicate/version playable characters, NPCs, traits, skills, backgrounds, occupations, factions/gangs/police units, relationships/families, locations, businesses, items/firearms/ammunition/clothing, vehicles/phones, lore, rumors, laws/crimes, quests/events, Story Cards, Watchers, and world-state content without source edits.
REQUIREMENTS: Persistent NPC List, filters/search, bulk-safe actions, templates, preview, validation, references/impact view, and normal-player visibility policy. Unlimited custom sections/subsections/fields where practical.

PHASE 2 - CODE: DEVELOPER/ADMIN OBSERVABILITY
GOAL: Authorized tools for event timeline, state inspection, simulation trace, AI context/source inspection, prompt/version trace, retries, error logs, test fixtures, and safe repair commands. Clearly separate read/debug tools from destructive mutations; audit every privileged change.

PHASE 3 - CODE: IMPORT/EXPORT
GOAL: Versioned portable exports with schemas, references, media/asset strategy, dry-run import, ID mapping/conflict policy, validation, and rollback. Never overwrite live content silently.
TESTING: Creator record survives migration; reference integrity after rename/reorder/import; role isolation; export/import round trip.
FINAL REPORT: Creator coverage, admin safeguards, import compatibility.

######################################################################
SYSTEM 17 - INTEGRATED QUALITY GATES, AI SAFETY, COST CONTROLS, ACCESSIBILITY, AND PERFORMANCE

SYSTEM EXECUTION INSTRUCTION
Harden the integrated product before final release work.

PHASE 1 - CODE: INTEGRATION QUALITY GATES
GOAL: Test a full turn across character, time, travel, NPC schedule, relationship, item, health, crime/evidence, event, save/timeline, and narration paths. Maintain acceptance fixtures for canonical scenarios without hardcoding Valor content.

PHASE 2 - CODE: AI SAFETY AND COST GOVERNANCE
GOAL: Per-campaign/user budgets, model routing, token/context caps, caching where safe, queue/concurrency controls, circuit breakers, spend telemetry, PII minimization/redaction, prompt injection resistance for imported content, tool permission boundaries, and content settings enforcement.

PHASE 3 - CODE: PERFORMANCE AND ACCESSIBILITY
GOAL: Profile large NPC/lore/event sets, retrieval latency, simulation catch-up, autosave, and iPad memory/network behavior. Meet keyboard, screen-reader, contrast, touch, reduced-motion, error-message, and long-prose standards.
TESTING: Load, soak, adversarial AI output, permission leakage, offline/reconnect, accessibility audit, cost-limit behavior.
FINAL REPORT: Measured targets/results, remaining risks, remediation plan.

######################################################################
SYSTEM 18 - FINAL ACCEPTANCE, DEPLOYMENT, OPERATIONS, AND REGRESSION PROTECTION

SYSTEM EXECUTION INSTRUCTION
Prepare a deployable, maintainable VALOR build only after prior systems pass their gates.

PHASE 1 - CODE: RELEASE READINESS
GOAL: Production configuration, environment validation, secret rotation plan, migrations/backups/restore rehearsal, deployment rollback strategy, health checks, monitoring, error tracking, and privacy/security review.

PHASE 2 - CODE: END-TO-END ACCEPTANCE
GOAL: Validate: create a playable character and NPC; persist/update them; play a non-forced prose turn; travel and advance time; see NPC offscreen effects; form a knowledge-limited relationship; use phone/vehicle/item; resolve injury/conflict; create evidence and an investigation; trigger an event; save, branch a timeline, restore, export/import; and confirm no fantasy or post-2012 assumptions appear by default.

PHASE 3 - CODE: REGRESSION PROTECTION AND HANDOFF
GOAL: Add CI checks for migrations, domain invariants, authorization, API contracts, deterministic simulation, AI structured-output validation, critical UI flows, and regression fixtures. Document local/dev/staging/production setup, operational runbooks, data migration policy, and known intentionally unresolved configuration choices.
DO NOT: Declare completion while migrations, privacy, player agency, state authority, branch preservation, or core acceptance scenarios fail.
FINAL REPORT: Deployment status, exact tests/checks run, acceptance evidence, known limitations, and the single recommended next implementation priority.

END OF VALOR COMPLETE CODEX / ASTRA SYSTEM IMPLEMENTATION PROMPTS
