# System 5 acceptance evidence map

Source: the supplied NPC Character and Behavior System master specification, cases T001–T126. This map identifies executable controller fixtures and the existing authoritative owner regressions. A row points to evidence for that requirement; it does not imply a separately reproduced end-to-end scenario for every ID. Fixtures that combine requirements retain the case IDs in their names. See SYSTEM_05_RELEASE.md for actual pass/fail totals and measured performance.

The optional model has no free-form expression or biography-write channel. Unsupported generation is rejected by strict schemas, while template/materialization creates validated owner records; this is the applicable generation path for T002, T086 and T093. Consent, custody, memory, disclosure, voice and narration remain covered by their actual owners rather than duplicate System 5 implementations. T116 combines the 2012 integrated game fixture with the communication, work, belief and memory suites.

| Case | Requirement | Evidence level | Executable fixtures |
| --- | --- | --- | --- |
| T001 | AI mutation rejection | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T002 | Entity invention | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T003 | Outcome separation | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T004 | Atomic provider failure | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T005 | Duplicate decision | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T006 | Stale revision | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T007 | Persuasion preserves choice | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T008 | Intimate consent | Owner and shared-policy integration | [system18-romance-consent.test.ts](../tests/system18-romance-consent.test.ts) |
| T009 | Custody agency | Owner and shared-policy integration | [system27-law.test.ts](../tests/system27-law.test.ts) |
| T010 | Interrupted compound plan | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T011 | Mode parity | Owner and shared-policy integration | [core-turn-kernel.test.ts](../tests/core-turn-kernel.test.ts) |
| T012 | Regeneration invariance | Owner and shared-policy integration | [core-turn-kernel.test.ts](../tests/core-turn-kernel.test.ts) |
| T013 | Freeform parity | Owner and shared-policy integration | [core-turn-kernel.test.ts](../tests/core-turn-kernel.test.ts) |
| T014 | Developer constraint enforcement | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T015 | Hidden observer pair | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T016 | False belief action | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T017 | Actor isolation | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T018 | Memory versus truth | Owner and shared-policy integration | [system04-memory.test.ts](../tests/system04-memory.test.ts) |
| T019 | Recall failure | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T020 | Distorted recall | Owner and shared-policy integration | [system04-memory.test.ts](../tests/system04-memory.test.ts) |
| T021 | Delayed message | Owner and shared-policy integration | [system19-phone.test.ts](../tests/system19-phone.test.ts) |
| T022 | Alias recognition | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T023 | Validation error secrecy | Owner and shared-policy integration | [core-turn-kernel.test.ts](../tests/core-turn-kernel.test.ts) |
| T024 | Cross-branch recall | Owner and shared-policy integration | [system04-memory.test.ts](../tests/system04-memory.test.ts) |
| T025 | Forgotten detail | Owner and shared-policy integration | [system04-memory.test.ts](../tests/system04-memory.test.ts) |
| T026 | Unsupported phone feature | Owner and shared-policy integration | [system19-phone.test.ts](../tests/system19-phone.test.ts) |
| T027 | Period speech | Owner and shared-policy integration | [core-turn-boundaries.test.ts](../tests/core-turn-boundaries.test.ts) |
| T028 | Technology exception | Owner and shared-policy integration | [system19-phone.test.ts](../tests/system19-phone.test.ts) |
| T029 | Prompt injection in memory | Owner and shared-policy integration | [system03-information.test.ts](../tests/system03-information.test.ts) |
| T030 | Trait range validation | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T031 | Hard versus soft priority | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T032 | Supported exception | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T033 | Goal completion evidence | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T034 | Goal cycle | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T035 | Goal overflow | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T036 | Need ownership | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T037 | Duplicate appraisal | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T038 | Time partition recovery | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T039 | Interface time freeze | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [core-turn-kernel.test.ts](../tests/core-turn-kernel.test.ts) |
| T040 | Mood independence | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T041 | Stress budget | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T042 | Locked development | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T043 | Drift cap | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T044 | Milestone development | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T045 | Directional relationship | Owner and shared-policy integration | [system17-social-graph.test.ts](../tests/system17-social-graph.test.ts) |
| T046 | Limited agreement | Owner and shared-policy integration | [system18-romance-consent.test.ts](../tests/system18-romance-consent.test.ts) |
| T047 | Revoked boundary | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T048 | Refusal repetition | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T049 | Material new evidence | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T050 | Deceptive claim separation | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T051 | Mistake is not automatic deception | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T052 | Disclosure gate | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T053 | Bias absent by default | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T054 | Authored bias scope | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T055 | Escalation cause | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T056 | Hysteresis | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T057 | Self preservation | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T058 | Incapacity invalidation | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T059 | Lost pursuit target | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system24-tactical.test.ts](../tests/system24-tactical.test.ts) |
| T060 | Cessation continuity | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T061 | Utility arithmetic | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T062 | Tie resolution | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T063 | Switch margin | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T064 | Optional variation replay | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T065 | Candidate budget | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T066 | Planner outage | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T067 | Late planner response | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T068 | Plan depth and cycle | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T069 | Model replay | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T070 | Context cache isolation | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system03-information.test.ts](../tests/system03-information.test.ts) |
| T071 | Reaction handoff | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T072 | No artificial warning | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T073 | Equal-time resource contention | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T074 | Reservation expiry | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T075 | Partial task resumption | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T076 | No-progress recovery | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T077 | Schedule feasibility | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T078 | Role permission | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T079 | Routine interruption | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T080 | Faction knowledge | Owner and shared-policy integration | [system03-information.test.ts](../tests/system03-information.test.ts) |
| T081 | Compressed interval parity | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T082 | Dormant activation | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T083 | Pending reaction downgrade | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T084 | Offscreen consequence | Owner and shared-policy integration | [system16-npc-autonomy.test.ts](../tests/system16-npc-autonomy.test.ts) |
| T085 | Local agency under load | Owner and shared-policy integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T086 | Generation referential integrity | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts), [system15-npc-registry.test.ts](../tests/system15-npc-registry.test.ts) |
| T087 | Concurrent promotion | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T088 | Promotion continuity | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T089 | Crowd materialization | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T090 | Demotion history | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T091 | Generated and custom parity | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T092 | Missed communication | Owner and shared-policy integration | [system19-phone.test.ts](../tests/system19-phone.test.ts) |
| T093 | Speech promise insertion | Owner and shared-policy integration | [system02-narrative.test.ts](../tests/system02-narrative.test.ts) |
| T094 | Gesture mutation | Owner and shared-policy integration | [system02-narrative.test.ts](../tests/system02-narrative.test.ts) |
| T095 | Exact utterance retention | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T096 | Voice capability | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T097 | Creator conflict | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T098 | Template publication | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T099 | In-flight migration | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T100 | Inspector access | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T101 | Save/load recovery | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T102 | Crash after commit | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T103 | Outbox duplicate | Owner and shared-policy integration | [system04-memory.test.ts](../tests/system04-memory.test.ts) |
| T104 | Narration outage | Owner and shared-policy integration | [core-turn-kernel.test.ts](../tests/core-turn-kernel.test.ts) |
| T105 | Branch invalidation | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T106 | No valid fallback | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T107 | Audited correction | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T108 | Privileged text injection | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T109 | Full decision determinism | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T110 | Interval partition property | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T111 | Knowledge noninterference property | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T112 | Agency property | Owner and shared-policy integration | [core-turn-kernel.test.ts](../tests/core-turn-kernel.test.ts) |
| T113 | Resource conservation property | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T114 | Load and degradation | Controller integration | [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T115 | Content migration suite | Owner and shared-policy integration | [system15-npc-registry.test.ts](../tests/system15-npc-registry.test.ts) |
| T116 | End to end 2012 scene | Owner and shared-policy integration | [game.test.ts](../tests/game.test.ts) |
| T117 | Retrieval ownership | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system05-completion.test.ts](../tests/system05-completion.test.ts) |
| T118 | Live conversation priority | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T119 | Player interior privacy | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T120 | Critical memory crash recovery | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts), [system04-memory.test.ts](../tests/system04-memory.test.ts) |
| T121 | Shared voice contract | Owner and shared-policy integration | [system02-narrative.test.ts](../tests/system02-narrative.test.ts) |
| T122 | Group participation | Owner and shared-policy integration | [system02-narrative.test.ts](../tests/system02-narrative.test.ts) |
| T123 | Rumor ancestry | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T124 | Narrative defaults and overrides | Owner and shared-policy integration | [system02-narrative.test.ts](../tests/system02-narrative.test.ts) |
| T125 | Protected context minimum | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
| T126 | Consent owner parity | Controller integration | [system05-behavior.test.ts](../tests/system05-behavior.test.ts) |
