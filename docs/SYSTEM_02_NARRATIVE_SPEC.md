# VALOR BEHAVIOR BIBLE — SYSTEM 02
## NARRATIVE & AI STORYTELLING SYSTEM
### Comprehensive Codex / Astra Implementation Specification

**Project:** VALOR  
**Setting:** Grounded fictional American crime-drama city, 2012  
**System Type:** Behavioral / Narrative Runtime Specification

---

# EXECUTION INSTRUCTION

Implement this system as an authoritative narrative layer over VALOR's existing server-authoritative simulation. Treat every MUST, MUST NOT, SHOULD, SHOULD NOT, and hard law in this specification as a behavioral requirement unless a later explicit user revision supersedes it.

This system does not replace the existing VALOR architectural rules. It must obey these pre-existing laws:

> **DATABASE DETERMINES WHAT EXISTS. SIMULATION DETERMINES WHAT HAPPENS. AI INTERPRETS, REASONS, AND NARRATES.**

> **PLAYER AGENCY LAW:** AI must never invent voluntary player dialogue, thoughts, feelings, beliefs, decisions, intentions, consent, movement, gestures, or actions unless explicitly supplied or narrowly delegated by the player.

> **KNOWLEDGE LAW:** World Truth, Character Knowledge, Belief, Rumor, Memory, and Player Meta-Knowledge are distinct layers. Narration and NPC dialogue may use only the layer permitted by perspective and state.

> **2012 LAW:** VALOR is grounded in 2012. Do not introduce 2026 technology, slang, social-media habits, consumer devices, or cultural assumptions unless explicitly authored.

The narrator is never mechanically authoritative. It never creates durable state merely by writing it.

---

# 1. PURPOSE AND AUTHORITY

The Narrative & AI Storytelling System converts validated game state into fiction.

Inputs may include:
- validated player input;
- resolved mechanical events;
- current scene state;
- current location/environment state;
- NPC decisions and speech intent;
- player-visible knowledge;
- permitted memories;
- relevant lore;
- narrative settings;
- Game Mode / Story Mode state.

It owns presentation:
- prose wording;
- paragraph structure;
- descriptive emphasis;
- sensory emphasis;
- NPC dialogue wording where wording is not already canonical;
- scene transitions over validated time;
- summaries of validated routine activity;
- stylistic variation.

It does not own:
- action success;
- NPC decision-making;
- attraction;
- relationship state;
- injury;
- evidence;
- object existence;
- time advancement;
- location;
- player voluntary thought, emotion, dialogue, consent, or action.

A complete AI outage may degrade prose quality, but it must never corrupt canonical state. Game Mode should remain playable through structured actions and deterministic fallback wherever possible.

---

# 2. HARD NARRATIVE LAWS

## Narrative Truth Law
The narrator may phrase truth but may not determine or alter truth.

## Player Interiority Law
The narrator MUST NOT invent voluntary player-character thoughts, feelings, beliefs, attraction, guilt, jealousy, love, fear, intentions, consent, dialogue, gestures, decisions, or movement.

It MAY enrich internal state that the player explicitly authored, but it must not change the meaning or intensity.

## NPC Perspective Law
Hidden NPC thoughts, motives, and feelings remain private in ordinary Player Mode. Expose them only through behavior, dialogue, action, or an explicitly authorized alternate-POV interlude.

## Prose Continuation Law
Story Mode continues from player-authored prose rather than paraphrasing or rewriting it.

## State-First Law
Canonical state outranks dramatic pacing, pretty prose, genre expectation, romance, comedy, or cinematic action.

## Control-Handoff Law
Narration stops at the validated next meaningful player choice. Length settings never authorize the AI to narrate through a reaction window.

## Knowledge Law
Narration may state only what the active perspective can legitimately perceive, know, believe, remember, or infer.

## Style-Separation Law
Perspective, tense, description, pacing, dialogue density, metaphor, and tone change presentation only.

## Mode-Parity Law
Game Mode and Story Mode share identical simulation rules and canonical state.

## Character-Voice Law
NPC dialogue comes from individual voice profiles, not a universal model personality.

## Era Law
Narration remains 2012-correct.

## Anti-Fabrication Law
The narrator cannot create durable objects, injuries, evidence, relationships, history, geography, factions, secrets, or events for prose convenience.

## Anti-Repetition Law
The narrative layer tracks and suppresses recent semantic, stylistic, conversational, and descriptive repetition.

## Narrative Validation Law
No AI narrative enters the Chronicle before state, agency, knowledge, continuity, endpoint, and style validation.

## Fallback Law
If valid AI narration cannot be produced, deterministic safe prose must preserve gameplay.

---

# 3. DEFAULT NARRATIVE PROFILE

VALOR defaults to:
- Perspective: Third Person
- Tense: Past
- Narrative Distance: Close
- Description Density: Balanced
- Writing Style: Grounded Literary
- Dialogue Density: Balanced
- Response Length: Medium
- Pacing: Balanced
- Sensory Detail: Moderate
- Metaphor Density: Selective
- Humor Frequency: Natural
- Violence Detail: Moderate
- Emotional Detail: Balanced
- Exposition Density: Minimal-to-Balanced
- NPC Interior Access: None
- PC Interior Access: Player-authored only
- Mechanical Feedback: Standard in Game Mode / Light in Story Mode

The baseline VALOR voice is gritty, observant, physically grounded, capable of dry humor and warmth, and never generically noir or relentlessly grim.

---

# 4. STRUCTURED NARRATIVE SETTINGS

Narrative settings MUST be stored as structured data, not one freeform style prompt.

Recommended profile fields:
- id
- name
- perspective
- tense
- narrativeDistance
- descriptionDensity
- literaryIntensity
- dialogueDensity
- responseLength
- pacing
- sensoryDensity
- metaphorDensity
- humorLevel
- violenceDetail
- emotionalDetail
- expositionDensity
- mechanicalFeedbackStyle
- signedDialogueStyle
- discouragedPatterns
- forbiddenPatterns
- approvedStyleExamples
- negativeStyleExamples
- version

Player-facing values:

Perspective:
- First Person
- Second Person
- Third Person

Tense:
- Past
- Present

Narrative Distance:
- External
- Balanced
- Close
- Intimate

Description:
- Sparse
- Balanced
- Rich

Writing Style:
- Straightforward
- Grounded Literary
- Highly Literary

Dialogue:
- Low
- Balanced
- High

Response Length:
- Short
- Medium
- Long
- Very Long

Pacing:
- Fast
- Balanced
- Slow

Sensory Detail:
- Low
- Moderate
- High

Metaphor:
- Minimal
- Selective
- Frequent

Humor:
- Low
- Natural
- High

Violence Detail:
- Minimal
- Moderate
- Graphic where allowed

Emotional Detail:
- Restrained
- Balanced
- High

Exposition:
- Minimal
- Balanced
- Expanded

Mechanical Feedback:
- Narrative Only
- Light
- Standard
- Detailed

These settings combine independently.

---

# 5. STYLE PRESETS

## Standard Valor
The default profile.

## Straightforward
Third-person past, sparse-to-balanced description, direct prose, medium-short responses, minimal metaphor, fast-to-balanced pacing.

## Literary
Third-person past, rich description, grounded-to-high literary style, long responses, stronger sensory detail, selective-to-frequent metaphor.

## Dialogue Heavy
Balanced description, high dialogue density, minimal narrative interruption during conversation.

## Minimal
Sparse description, short responses, fast pacing, very little metaphor, clear action/result focus.

## Custom
All settings independently editable.

Highly Literary MUST still remain readable, spatially clear, agency-safe, and state-accurate.

---

# 6. SETTINGS HIERARCHY

Resolve preferences in this order:
1. Global User Default
2. Campaign Override
3. Playable Character Override
4. Temporary Scene Override

Most specific valid setting wins.

Changing settings affects future narration only. Existing Chronicle entries remain unchanged unless the user explicitly rerenders them.

Game Mode and Story Mode MAY have separate narrative profiles.

---

# 7. GAME MODE VS STORY MODE

## Game Mode
Game Mode is gameplay-forward. Narration should usually be shorter, clearer, mechanically legible, and action-oriented.

## Story Mode
Story Mode is collaborative-fiction-forward. It may be richer, longer, more literary, and more responsive to the player's prose cadence.

Both modes use the same canonical state and mechanics.

| Area | Game Mode | Story Mode |
|---|---|---|
| Input | Contextual actions | Freeform RP prose |
| PC dialogue | Dedicated Say/Communicate | Natural prose |
| Freeform | Other... | Native |
| Mechanics visibility | Higher | Lower |
| Narration | Usually concise | Configurable/richer |
| Canon | Same | Same |
| Mechanics | Same | Same |

---

# 8. GAME MODE COMMUNICATION: SAY / SIGN / COMMUNICATE

Game Mode MUST use a dedicated communication action.

Concept:
- Say
- Sign
- Write
- Communicate

The visible label can adapt to the PC's normal communication method.

The default should be player-authored wording.

Example:
Target: Nia
Text: “Where’s Malik?”

If the PC is nonverbal and signs:
> Nathaniel signed, *Where’s Malik?*

Recipient comprehension must be checked.

Optional modifiers:
- target;
- tone;
- volume;
- communication method;
- Quick Intent;
- Cancel.

## Auto-Phrase
Auto-Phrase is explicit delegation.

Intent:
> Ask Nia where Malik is.

Allowed:
> “Where’s Malik?”

Not allowed unless selected:
> “Where’s Malik, and don’t lie to me again.”

Auto-Phrase must not add accusation, threat, confession, promise, flirtation, or emotional disclosure beyond the selected intent.

---

# 9. POV, TENSE, AND NARRATIVE DISTANCE

Default is third-person past.

Support:
- first / second / third person;
- past / present tense.

Switching affects future narration only.

Close perspective may describe:
- visible environment;
- sound;
- smell;
- physical sensation;
- player-authored interiority;
- NPC outward behavior.

It does not grant access to hidden NPC minds.

Intimate narration may deepen already-authored PC emotion but cannot invent it.

---

# 10. PLAYER AUTHORSHIP

The player writes the protagonist. The AI writes the world back.

The player owns:
- voluntary dialogue;
- thoughts;
- feelings;
- beliefs;
- consent;
- decisions;
- intentions;
- voluntary gestures/actions.

The narrator owns:
- NPC/world response;
- validated consequences;
- environment;
- sensory information;
- presentation.

Do not narrate PC emotion as an inevitable reaction to events.

---

# 11. RESPONSE LENGTH AND CONTROL DISTANCE

Suggested internal targets:
- Short: 1–2 paragraphs
- Medium: 2–4
- Long: 4–7
- Very Long: 6–12+ only when supported

These are guidance, not quotas.

Longer narration expands depth, not decision distance.

If a reaction window occurs after 150 words, stop even in Very Long mode.

---

# 12. PARAGRAPH AND SENTENCE RHYTHM

Paragraph breaks should follow meaningful shifts:
- speaker;
- action;
- focus;
- reveal;
- pause;
- location emphasis.

Do not produce giant walls of mixed speakers and action.

Do not turn every sentence into its own paragraph.

Use sentence-length variation.

Fragments are allowed selectively for force, not as a constant gritty style.

---

# 13. SCENE RHYTHM

Scenes should vary between:
- pressure;
- silence;
- ordinary activity;
- humor;
- awkwardness;
- escalation;
- de-escalation.

Choose the most plausible next beat, not the most dramatic.

No mandatory fight, romance, confession, interruption, or cliffhanger.

---

# 14. ENVIRONMENTAL DESCRIPTION

Description is state-driven.

Use:
- location;
- current damage;
- time;
- weather;
- lighting;
- crowd;
- occupancy;
- business state;
- persistent objects.

Layer priority:
1. Immediate
2. Current
3. Structural

First entry may be fuller. Familiar locations should emphasize changes.

Do not repeat establishment prose every visit.

---

# 15. CLASS, NEIGHBORHOOD, AND MATERIAL CONDITIONS

Class should appear through:
- maintenance;
- space;
- infrastructure;
- security;
- materials;
- density;
- service quality;
- access.

Do not reduce poor neighborhoods to dirt or rich neighborhoods to beauty.

VALOR neighborhoods should feel materially distinct without stereotype.

---

# 16. DECORATIVE DETAIL

Low-stakes decorative prose may be generated if it cannot affect gameplay.

Decorative detail must not silently become:
- evidence;
- weapon;
- clue;
- durable object.

Important authored spaces should support Strict Interiors.

Flexible Interiors may allow validated promotion of low-stakes generated details into state when a player interacts with them.

---

# 17. SENSORY DETAIL

Use senses selectively.

Do not require all five senses.

Smell should be particularly restrained; do not make every Union location smell like grease, piss, smoke, bleach, and garbage.

Noise, weather, lighting, and temperature may affect gameplay when state supports it.

Established conditions persist until simulation changes them.

---

# 18. ENVIRONMENTAL PARTICIPATION

The environment may participate through real state:
- train;
- fryer;
- intercom;
- ticket printer;
- traffic;
- weather;
- alarms;
- actual phone events.

Do not generate random environmental interruptions merely to make prose feel alive.

---

# 19. 2012 FIDELITY

Maintain era-appropriate:
- smartphones/feature phones;
- BlackBerry-era devices;
- SMS/MMS;
- voicemail;
- Facebook/Twitter-era behavior;
- landlines;
- GPS units;
- cash/cards;
- physical records;
- older screens and signage.

Block accidental 2026 references unless authored.

---

# 20. NPC VOICE PROFILE

Every important NPC should support a structured voice profile covering:
- vocabulary;
- sentence length;
- formality;
- profanity;
- slang;
- dialect;
- code-switching;
- filler words;
- habitual phrases;
- interruption tendency;
- rambling;
- directness;
- evasiveness;
- lying style;
- humor;
- emotional expressiveness;
- politeness;
- occupational jargon;
- endearments;
- insults;
- name use;
- fragment use;
- professional/intimate/family registers;
- forbidden tendencies;
- sample lines.

Accent alone is not voice.

---

# 21. EDUCATION AND INTELLIGENCE

Formal grammar is not intelligence.

A poorly educated NPC can be brilliant and perceptive.

An educated NPC can swear, ramble, misunderstand, and act foolishly.

Do not mechanically equate class or grammar with intelligence.

---

# 22. DIALECT AND CODE-SWITCHING

Use readable dialect through:
- syntax;
- word choice;
- cadence;
- selective phonetic markers.

Do not turn dialect into caricature.

Allow code-switching by:
- audience;
- setting;
- professional context;
- family context;
- emotional state.

---

# 23. NPC DIALOGUE BEHAVIOR

NPCs may:
- answer;
- evade;
- lie;
- refuse;
- misunderstand;
- counter-question;
- change subject;
- remain silent;
- leave.

These behaviors must have motives.

Do not manufacture mystery with arbitrary evasiveness.

---

# 24. LYING

A liar does not automatically look guilty.

Avoid cliché tells unless character-specific.

Truthful people can look nervous.

Narration must not label a lie unless the active perspective legitimately knows it.

---

# 25. RELATIONSHIP-DEPENDENT VOICE

The same NPC should speak differently with:
- stranger;
- coworker;
- boss;
- sibling;
- lover;
- ex;
- enemy;
- police.

Familiarity may produce shorthand, nicknames, teasing, or silence.

Speech should evolve with relationship history.

---

# 26. ANTI-UNIVERSAL-AI VOICE

Not every NPC:
- quips;
- smirks;
- uses therapy language;
- understands their own feelings;
- speaks eloquently;
- flirts.

Some are awkward, boring, blunt, earnest, inarticulate, or unfunny.

That is correct behavior.

---

# 27. CONVERSATION CONTINUITY

Track:
- current topic;
- unresolved questions;
- previous answers;
- interruptions;
- unfinished sentences;
- repeated questions;
- stated positions.

NPCs must not reset conversation between turns.

Repeated questions should receive repetition-aware responses.

---

# 28. MULTILINGUAL AND NONVERBAL COMMUNICATION

Comprehension depends on actual language/sign knowledge.

Do not automatically translate unknown speech.

Partial fluency can yield partial understanding.

Sign language should be rendered as language, not as mime.

---

# 29. ACTION NARRATION

Narration receives structured resolved events.

It may not add:
- extra shots;
- extra attacks;
- extra hits;
- extra reloads;
- extra injuries;
- extra movement;
- extra object changes.

Connective motion is allowed only when it does not alter state.

---

# 30. COMBAT PROSE

Combat prioritizes:
1. result;
2. position;
3. immediate threat;
4. clarity;
5. style.

Avoid Hollywood physics.

Avoid automatic heroism.

Skill and training may shape how a validated action looks in prose but may not change the result.

---

# 31. HEALTH AND PAIN

Narrate:
- symptoms;
- known diagnosis;
- validated pain;
- involuntary effects.

Do not omnisciently diagnose hidden injury.

Pain does not authorize a voluntary PC reaction.

---

# 32. PHYSICAL AFFECTION

NPC affection follows the same agency rules as violence.

An NPC may initiate valid contact. The narrator may not write the PC reciprocating without input.

Do not automatically eroticize force or dominance.

---

# 33. TONE HIERARCHY

When tonal goals conflict:
1. grounded realism
2. character truth
3. current scene tone
4. crime drama
5. romance
6. humor
7. stylistic flourish

---

# 34. CRIME DRAMA

Crime should feel embedded in:
- money;
- witnesses;
- debt;
- evidence;
- phones;
- vehicles;
- territory;
- reputation;
- bureaucracy;
- retaliation.

Do not write criminals as generic villains or police as universally heroic/evil.

---

# 35. VIOLENCE

Violence is:
- dangerous;
- physical;
- consequential;
- often fast and messy.

Default is moderate detail.

Graphic setting permits more detail but does not require gore fixation.

Violence should alter later scene state.

---

# 36. ROMANCE

Romance is relationship-specific.

Avoid generic romance engine behavior:
- breath hitch;
- eyes darken;
- electricity;
- magnetic pull;
- automatic “mine” language;
- generic dominant-alpha behavior.

Romance should emerge from:
- history;
- practical care;
- habits;
- attraction;
- jealousy;
- memory;
- awkwardness;
- routine.

Hostility does not imply attraction.

Violence does not imply love.

---

# 37. EMOTION AND INTERNALITY

PC emotion is player-owned.

NPC internal state remains hidden unless revealed.

Prefer behavior over explicit emotion labels.

Subtext should often remain subtext.

Avoid narrator therapy-speak and amateur diagnosis.

---

# 38. EMOTIONAL CONTINUITY

Emotion has inertia.

Do not instantly reset:
- anger;
- grief;
- resentment;
- fear;
- attraction.

Apology does not automatically erase betrayal.

Confession does not force reciprocation.

High emotion can still be terse.

---

# 39. LORE INTEGRATION

Lore enters through relevance.

Valid delivery channels:
- environment;
- dialogue;
- document;
- memory;
- player question;
- record;
- media.

Retrieval is permission, not obligation.

Do not turn the Chronicle into an encyclopedia.

---

# 40. MYSTERY AND SUSPENSE

Mystery comes from genuine information limits.

Never hide obvious facts solely to create suspense.

Foreshadow only through real causal signs:
- actual plans;
- actual rumors;
- actual objects;
- schedule changes;
- state-backed behavior.

Avoid prophetic narration.

---

# 41. CLUES

Clues exist before discovery.

Discovery does not equal interpretation.

Do not visually label something as a “critical clue” by default.

Use certainty language carefully:
- known;
- suspected;
- rumored;
- inferred.

---

# 42. SOURCE BIAS

Documents, rumors, news, police reports, and NPC testimony may be wrong.

Preserve source provenance.

Narration should not flatten:
> “According to the report...”
into:
> “This is objectively what happened.”

---

# 43. REPETITION DAMPING

Track:
- exact phrases;
- semantic gesture categories;
- metaphors;
- dialogue beats;
- paragraph openings;
- endings;
- location details;
- scene structures;
- filler behaviors.

Recent prose should inform a suppression manifest.

---

# 44. DISCOURAGED GENERIC PHRASES

Strongly damp repeated use of:
- jaw clenched;
- breath hitched;
- eyes darkened;
- silence stretched;
- flicker of something;
- weight of;
- charged air;
- palpable tension;
- shiver;
- throat bob;
- lips quirked;
- for a moment;
- the kind of silence that;
- repeated almost / something / as if.

Do not treat this list as exhaustive.

---

# 45. NOIR / ROMANCE CLICHÉS

Strongly damp:
- city never sleeps;
- trouble walked in;
- streets swallowed him;
- rain washed nothing clean;
- predator/prey;
- electric touch;
- magnetic pull;
- generic primal/feral language.

---

# 46. FILLER-BEAT REPETITION

Track overuse of:
- smoking;
- sipping;
- phone buzzing;
- smirking;
- chuckling;
- leaning in doorways;
- neck rubbing.

Character signatures may recur selectively.

---

# 47. INTENTIONAL REPETITION

Allow repetition when:
- rhetorical;
- character-habitual;
- motif-driven;
- continuity-required;
- emotionally purposeful.

Varied expression inside stable identity is the goal.

---

# 48. STYLE DRIFT

Each generation should receive the current Narrative Profile.

Detect:
- POV drift;
- tense drift;
- verbosity creep;
- metaphor creep;
- cliché creep;
- therapy-speak creep;
- NPC voice convergence;
- era drift;
- genre drift.

Severe drift triggers repair.

---

# 49. MULTI-NPC SCENES

Assign temporary narrative roles:
- Primary
- Secondary
- Background

Scene role is not global importance.

Primary gets most attention.

Secondary reacts only when motivated.

Background can react collectively.

No round-robin obligation.

---

# 50. CROWD BEHAVIOR

Crowds are not hive minds.

Some flee, freeze, watch, help, ignore.

Crowd reaction must be proportional.

Do not name every background person.

Promote NPCs only when interaction or persistence requires it.

---

# 51. NPC-TO-NPC LIFE

NPCs may interact with each other.

The world must not feel like everyone faces the player.

But NPC-to-NPC conversation must not hijack play indefinitely.

Return control at meaningful intervention points.

---

# 52. SOCIAL AUDIENCE

Audience affects:
- privacy;
- shame;
- performance;
- authority;
- secret spread;
- flirtation;
- conflict.

Whispering does not guarantee secrecy.

Proximity and noise matter.

---

# 53. TIME COMPRESSION

Simulation determines actual elapsed time and interruption.

Narrative compression removes repetition, not consequence.

Routine tasks may be summarized.

Important scenes remain interactive unless explicitly skipped.

---

# 54. MONTAGE

Montage compresses validated routine sequences.

It may not invent major voluntary PC choices.

It stops when something important requires input.

---

# 55. WORK SHIFTS

Compressed work must feel occupation-specific.

Important work events break compression.

Do not repeatedly surface trivial work events unless the player selected detailed shift play.

---

# 56. TRAVEL

Travel narration preserves:
- origin;
- destination;
- mode;
- actual duration;
- passengers;
- relevant conditions.

No invented roadside events.

---

# 57. SLEEP

Do not invent dreams.

Routine sleep is concise.

Interrupt when actual events occur.

---

# 58. SCENE OPENING AND CLOSING

Openings orient without over-recap.

Closings need not manufacture finality.

No mandatory:
- punchline;
- ominous hook;
- “he didn’t look back”;
- cinematic fade.

---

# 59. NARRATIVE VALIDATION PIPELINE

Every narrative draft should pass:

1. State validation
2. Agency validation
3. Knowledge validation
4. NPC validation
5. Continuity validation
6. Endpoint validation
7. Content-boundary validation
8. POV/tense validation
9. Style/repetition validation
10. Presentation validation

---

# 60. HARD FAILURES

Must be rejected before display:
- wrong physical result;
- invented voluntary PC action;
- hidden secret leak;
- wrong location;
- nonexistent object;
- wrong injury;
- dead NPC speaking;
- invented consent;
- endpoint overrun;
- wrong attack count;
- wrong resource state;
- materially false knowledge.

---

# 61. REQUIRED / OPTIONAL / HIDDEN / UI-ONLY FACTS

Resolved event data should classify facts:

- REQUIRED
- OPTIONAL
- HIDDEN
- UI_ONLY

This helps the narrator include what matters without leaking or dumping state.

---

# 62. REPAIR AND RETRY

Use targeted repair for local violations.

Use full retry for structural violations.

Retry uses the exact same resolved event bundle.

Never reroll mechanics.

Retry count must be capped.

---

# 63. FALLBACK

After repeated failure, use deterministic safe prose.

Fallback favors correctness over beauty.

Example:
> Your shot misses. Malik moves behind the counter.

Fallback remains part of the Chronicle unless the player later regenerates its presentation.

---

# 64. STREAMING

Unvalidated streamed prose must not become canonical.

Prefer buffered or chunk-validated streaming.

Canceling generation must not reroll mechanics or partially commit prose.

---

# 65. CHRONICLE PROVENANCE

Each accepted response should record:
- turn ID;
- event IDs;
- narrative profile version;
- prompt version;
- model/config;
- validator version;
- retry count.

Narration is presentation/history, not the database of record.

---

# 66. GENERATED DETAIL CLASSES

Generated details should be classified as:
- state-backed;
- event-backed;
- authorized generated canon;
- decorative;
- invalid.

Do not let prose slowly create furniture, scars, histories, relatives, or objects through repetition.

---

# 67. CONTEXT PRIORITY

When constrained by tokens/cost, preserve:
1. current authoritative state
2. resolved events
3. player agency
4. participants/positions
5. knowledge permissions
6. NPC voice/goal
7. recent continuity
8. relationship/history
9. style settings
10. optional lore/texture

Remove optional description before required truth.

---

# 68. CREATOR / DEVELOPER CONTROLS

Developer Mode should expose:
- active narrative profile;
- scene narrative context;
- fact visibility manifest;
- current focus;
- recent suppression patterns;
- NPC voice source;
- lore sources;
- knowledge filters;
- validation failures;
- repair reasons;
- retry count;
- model/config;
- fallback usage.

Creator Studio should support:
- custom presets;
- sample prose;
- negative examples;
- forbidden phrases;
- phrase cooldowns;
- motifs;
- location detail pools;
- NPC voice samples;
- NPC forbidden tendencies;
- tone bounds.

---

# 69. PLAYER SETTINGS

Keep player-facing controls understandable:
- Perspective
- Tense
- Description
- Writing Style
- Dialogue
- Response Length
- Pacing
- Sensory Detail
- Humor
- Violence Detail
- Emotional Detail
- Exposition
- Mechanical Feedback

Do not expose advanced technical jargon in Player Mode.

---

# 70. ACCESSIBILITY

A player choosing:
- Minimal;
- Straightforward;
- Short;

must retain all essential gameplay information.

Literary prose is optional.

---

# 71. ACCEPTANCE SCENARIOS

The implementation must test at least the following:

1. Default third-person past narration remains stable.
2. First-person present works without drift.
3. Rich description increases texture without fabricating interactable objects.
4. Sparse description retains essential spatial/actionable information.
5. Game Mode Say preserves exact player dialogue.
6. Nonverbal PC uses sign/writing correctly.
7. Auto-Phrase adds no extra intent.
8. Player thought remains private and non-objective.
9. Hidden NPC attraction remains hidden.
10. NPC cannot reference knowledge they lack.
11. Lying NPC is not labeled as lying without player knowledge.
12. Unknown stain is not called blood before identification.
13. Familiar location uses delta description.
14. Persistent damage remains present.
15. Wrong POV output is repaired.
16. Invented PC forgiveness is rejected.
17. Miss narrated as hit is rejected without reroll.
18. Unknown NPC name does not leak.
19. Multi-NPC scene avoids round-robin speech.
20. NPC-to-NPC interaction does not become endless cutscene.
21. Very Long output still stops at weapon-draw reaction window.
22. Fast pacing does not alter world time.
23. Slow pacing does not invent PC interiority.
24. Dialogue-heavy mode does not make taciturn NPC verbose.
25. High humor does not make humorless NPC funny.
26. High romance does not manufacture attraction.
27. Combat prose preserves exact event count and positions.
28. NPC kiss does not create reciprocal PC kiss.
29. Work shift compression stops at important event.
30. Travel summary preserves actual passengers and time.
31. Sleep does not invent dream.
32. Retrieved lore is not dumped automatically.
33. False rumor remains rumor/belief.
34. Foreshadowing uses actual causal signs.
35. Wrong player theory is not omnisciently corrected.
36. Repetition damping suppresses recent generic cues.
37. Character signature may recur selectively.
38. Straightforward profile does not drift poetic over long play.
39. 2012 tech violations are repaired.
40. Repeated AI validation failure produces fallback without state loss.
41. Game Mode remains playable during narration outage where deterministic actions exist.
42. Story Mode preserves complex input rather than guessing unsafely during parsing outage.
43. Regenerate changes prose only.
44. Mid-campaign narrative setting changes future prose only.
45. Unknown language is not auto-translated.
46. Sign language requires recipient comprehension.
47. Publicly spoken secret can become audible knowledge.
48. Offscreen event is not narrated omnisciently.
49. Clue exists before discovery.
50. Decorative prose detail does not become evidence automatically.
51. Exact canonical NPC threat remains exact after rerender.
52. Semantic casual dialogue may be rephrased without changing meaning.

---

# 72. FINAL DEFINITION OF DONE

System 02 is complete only when:

- narrator is never mechanically authoritative;
- default third-person past works;
- POV/tense/style settings are persistent and composable;
- Game Mode and Story Mode share simulation parity;
- Game Mode communication uses dedicated Say/Sign/Communicate;
- player-authored dialogue remains exact;
- NPC voices remain distinct;
- hidden NPC internality remains hidden;
- player internality is never invented;
- environmental prose remains state-consistent;
- action prose preserves mechanics;
- crime, humor, violence, romance, and ordinary life retain grounded tone;
- romance avoids generic AI clichés;
- lore remains relevant and perspective-safe;
- mystery never relies on unfair withholding;
- semantic repetition damping works;
- long campaigns remain stylistically anchored;
- crowd scenes remain focused;
- time compression preserves consequences;
- narrative validation catches state, agency, secrecy, endpoint, and continuity violations;
- retry never rerolls mechanics;
- fallback preserves gameplay;
- Chronicle prose is never the sole owner of durable state;
- Developer Mode can inspect provenance and validation;
- all acceptance scenarios pass.

---

# 73. IMPLEMENTATION PRIORITY ORDER

When requirements compete, prioritize:

1. Canonical State Accuracy
2. Player Agency
3. Knowledge / Secrecy
4. Control Handoff
5. Critical Information Sufficiency
6. NPC Consistency
7. Scene Continuity
8. Configured Content Boundaries
9. POV / Tense
10. Tone / Style
11. Repetition / Cliché Control
12. Literary Polish

Never sacrifice a higher-ranked requirement to preserve a lower-ranked one.

---

# 74. CODEX / ASTRA EXECUTION COMMAND

When implementing this system:

1. Inspect existing VALOR Chronicle, AI, prompt, context, dialogue, style-setting, retry, validation, and rendering paths.
2. Preserve working architecture where compatible.
3. Do not build a second disconnected narration stack.
4. Add persistent structured Narrative Profiles.
5. Support separate Game Mode and Story Mode profiles.
6. Implement Game Mode Say/Sign/Communicate if missing.
7. Implement NPC voice profiles.
8. Implement state-backed scene narrative context.
9. Implement repetition/style-drift tracking.
10. Implement output validation before Chronicle acceptance.
11. Implement targeted repair and full retry.
12. Implement deterministic fallback narration.
13. Add Developer Mode narrative diagnostics.
14. Add Creator controls for examples, negative examples, motifs, phrase rules, and voice rules.
15. Add automated tests for every acceptance scenario.
16. Ensure no narrative path can directly mutate canonical state.
17. Ensure no retry path rerolls mechanics.
18. Ensure Player Mode never receives hidden narrative context.
19. Stop after this system and report:
   - files/modules changed;
   - schema/migration changes;
   - narrative profile schema;
   - Game/Story Mode behavior;
   - Say/communication behavior;
   - validator architecture;
   - repair/retry/fallback behavior;
   - Creator/Developer controls;
   - tests and results;
   - known limitations;
   - unresolved design questions.

Do not proceed to another behavioral system until explicitly instructed.

---

# END — VALOR BEHAVIOR BIBLE SYSTEM 02
## NARRATIVE & AI STORYTELLING SYSTEM
