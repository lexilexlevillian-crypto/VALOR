# System 3 acceptance matrix

The 52 scenarios in section 18 of the latest supplied specification map to automated domain/integration coverage below. A row can share a parameterized scenario or regression with another row; this is not a claim of 52 separately named tests. Browser checks additionally exercise notebook authoring, read-only questions, research, and accessibility in Chromium and WebKit. Exact full-suite and release results are recorded in the [implementation report](SYSTEM_03_INFORMATION_IMPLEMENTATION.md).

| # | Specification scenario | Automated evidence |
| --- | --- | --- |
| 1 | Hidden truth excluded from narrator | [Hidden murderer, planner motive, private PC fear and canary across all profiles](../tests/system03-information.test.ts) |
| 2 | Private NPC planner context | [NPC goals enter only that NPC planning purpose](../tests/system03-information.test.ts) |
| 3 | Correct player guess | [Player beliefs, OOC notes, hypotheses and no automatic truth promotion](../tests/system03-information.test.ts) |
| 4 | Direct observation | [Partial plate and individual witness perception](../tests/system03-information.test.ts) |
| 5 | Poor visual conditions | [Perception partitions, hidden failures and repeat-search protection](../tests/system03-information.test.ts) |
| 6 | Partial overhearing | [Partial previews, language barriers and fragment-only acquisition](../tests/system03-information.test.ts) |
| 7 | Phone privacy | [Lost, dead, locked and stolen phone access; game private-SMS projection](../tests/system19-phone.test.ts) |
| 8 | Text delivery vs read | [Delivery/exposure separation and later full reading](../tests/system03-information.test.ts) |
| 9 | Rumor mutation | [Briefing attendance, independent witnesses and rumor mutation](../tests/system03-completion.test.ts) |
| 10 | Circular rumor | [Circular rumor return path distinguished from ordinary forwarding](../tests/system03-completion.test.ts) |
| 11 | Independent corroboration | [Independent witness origins remain distinct](../tests/system03-completion.test.ts) |
| 12 | Public news not consumed | [Publication and individual exposure; cohort awareness](../tests/system03-information.test.ts) |
| 13 | Restricted record accessible but unread | [Record access filter and unread contents](../tests/system03-information.test.ts) |
| 14 | Unauthorized record access | [Authored institutional misuse access retains an audit](../tests/system03-information.test.ts) |
| 15 | Secret facet discovery | [Independent secret facets and declassification](../tests/system03-completion.test.ts) |
| 16 | Hidden UI leak | [Hidden current location and concealed identity excluded from maps](../tests/system03-information.test.ts) |
| 17 | Known unknown | [Unknown raw observation with later identification](../tests/system03-completion.test.ts) |
| 18 | Unknown unknown | [Hidden canaries and permission-filtered no-result responses](../tests/system03-information.test.ts) |
| 19 | Last-known location | [Stale known location preserved without learning hidden replacement](../tests/system03-information.test.ts) |
| 20 | Stale employment | [Field-specific last-known employment](../tests/system03-completion.test.ts) |
| 21 | Forged record | [False/source claims do not expose objective falsity](../tests/system03-information.test.ts) |
| 22 | Contradictory witnesses | [Conflicting records retained with source conflict](../tests/system03-information.test.ts) |
| 23 | Summary certainty preservation | [Source-backed summaries reject invented certainty](../tests/system03-information.test.ts) |
| 24 | Wrong-character memory | [Wrong-character private memory excluded across purpose profiles](../tests/system03-information.test.ts) |
| 25 | Cross-timeline isolation | [Real save branch before later discovery; immutable snapshot scope](../tests/system03-information.test.ts) |
| 26 | Developer contamination | [View As is read-only and role-restricted](../tests/system03-completion.test.ts) |
| 27 | Extreme token pressure | [Required dialogue and incomplete tiny-budget fallback](../tests/system03-completion.test.ts) |
| 28 | Semantic outage | [Semantic outage deterministic fallback](../tests/system03-information.test.ts) |
| 29 | Summary outage | [Derived hierarchy rebuilt from raw canonical sources](../tests/system03-completion.test.ts) |
| 30 | Stale summary | [Stale summaries invalidated by source hash](../tests/system03-information.test.ts) |
| 31 | Race condition | [State revision/cursor scope checks; parser/narrator regression suites](../tests/system03-information.test.ts) |
| 32 | Unsupported NPC knowledge | [Character drift flags unsupported knowledge and goals](../tests/system12-context.test.ts) |
| 33 | Unsupported shared history | [Unsupported shared history rejected; source-anchored narrative validation](../tests/system12-context.test.ts) |
| 34 | Progressive identity | [Progressive identity and source-safe aliases](../tests/system03-completion.test.ts) |
| 35 | Mistaken identity | [Mistaken identification correction preserves raw observation](../tests/system03-completion.test.ts) |
| 36 | PC belief vs OOC theory | [Freeform PC belief idempotency versus OOC speculation](../tests/system03-information.test.ts) |
| 37 | Recall query | [Cue-conditioned recall query and named-character freeform question](../tests/system03-completion.test.ts) |
| 38 | Chronicle archive vs memory | [Archive access does not mutate knowledge, clock or recall](../tests/system03-completion.test.ts) |
| 39 | Hidden relationship stat | [Player relationship projection excludes hidden metrics](../tests/system17-social-graph.test.ts) |
| 40 | Map granularity | [Approximate area cannot reveal exact pin or action target](../tests/system03-completion.test.ts) |
| 41 | Autocomplete knowledge | [First-name labels suppress surname and aliases in projection/context](../tests/system03-completion.test.ts) |
| 42 | Deleted message persistence | [Per-viewer message deletion state and phone access](../tests/system19-phone.test.ts) |
| 43 | Group briefing | [Only exposed briefing attendees acquire the claim](../tests/system03-completion.test.ts) |
| 44 | Interrupted disclosure | [Partial disclosure never acquires full proposition](../tests/system03-information.test.ts) |
| 45 | Private conversation overheard | [Hearing across a visual partition remains possible](../tests/system03-information.test.ts) |
| 46 | Declassification | [Facet declassification widens availability without acquisition](../tests/system03-completion.test.ts) |
| 47 | Dormant NPC reactivation | [Dormant context reactivation after six months preserves state](../tests/system03-completion.test.ts) |
| 48 | Large history retrieval | [50,000 persisted game events and memories; 10,000 resolver-turn soak](../tests/system03-scale.test.ts) |
| 49 | Duplicate rumor projections | [Repeat-origin confidence and summary source deduplication](../tests/system03-information.test.ts) |
| 50 | Corrupt knowledge repair | [Repair forwarded derivatives; legacy quarantine survives real persistence](../tests/system03-completion.test.ts) |
| 51 | View As tool | [Creator View As and replay preserve canonical state](../tests/system03-completion.test.ts) |
| 52 | Derived rebuild | [Equivalent incremental summary rebuild from canonical sources](../tests/system03-completion.test.ts) |
