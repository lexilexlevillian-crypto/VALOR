# SYSTEM 09 — Trait Catalog, Backgrounds, and Custom Fields

Status: implemented and tested.

## Goal

VALOR now supports broad characterization without turning descriptive identity or presentation into automatic power. Traits are Creator-authored records shared by player and NPC characters. A trait has no mechanic unless an explicit scoped effect says so.

## Trait definition contract

Trait records persist:

- description, category, tags, media, sections, and visibility;
- prerequisites, oppositions, and multi-trait combinations;
- acquisition mode and requirements;
- loss mode, requirements, refund declaration, and notes;
- permanence and whether the trait can be acquired;
- descriptive or costed mode, advantage/disadvantage direction, and cost;
- generation weight, grouping tags, and required background tags;
- any number of explicitly authored effects.

Each effect has a stable ID/name/key plus an effect type, scope, stacking rule, conflict behavior, operation, numeric value, and description. Supported effect hooks are:

- scoped check modifier;
- choice unlock or restriction;
- need-rate change;
- simultaneous schedule priority;
- NPC plan priority;
- contextual social first-impression descriptor;
- descriptive flavor only.

Combination effects activate only when all referenced traits are present. Conflicting `reject` effects cannot coexist when their scopes overlap. Other groups resolve deterministically through stack, highest, lowest, or unique behavior with suppress/replace policy.

Legacy scoped check modifiers remain compatible. Experience check effects must name a skill or context; labels such as police training cannot become blanket forensic, computer, legal, or investigation expertise.

## Visibility and social presentation

Creator-hidden traits participate in checks and deterministic simulation but are removed from a Player Mode owner sheet. Creator-only `traitEffectTrace` records identify the trait and effect that changed schedule, needs, first-impression context, or NPC plan priority. Player projections remove that trace, and player check history redacts hidden modifier source identities.

First-impression effects require an observer context and store prose descriptors rather than changing a universal attraction score. Seed descriptions for intimidating, distinctive, class, reputation, and similar social labels explicitly state that interpretation depends on observer and context and is not an objective moral or attraction value.

## Balance and refund controls

Campaign settings define:

- total trait cap;
- costed advantage cap;
- costed disadvantage cap;
- disadvantage-credit cap;
- refund policy (`none` or `capped-current`);
- overall trait budget.

Descriptive traits must cost zero. Advantages use positive costs and disadvantages use negative costs. With `capped-current`, disadvantage credit exists only while the disadvantage remains on the character and is capped before it offsets current advantages. No spendable point wallet is created, so add/remove cycles cannot mint permanent refunds. Removing the credit source causes the complete current selection to be revalidated atomically.

Permanent or `loss.mode = never` traits cannot be removed through ordinary Creator edits. Acquisition metadata distinguishes Creator, earned, or either paths; ordinary edits cannot silently grant a trait declared earned-only.

## Realistic editable seed catalog

Catalog installation seeds editable examples across:

- physical: short/tall, slim/stocky/overweight, weak/strong, athletic, graceful/clumsy, scarred, intimidating or distinctive appearance, and an authored chronic limitation;
- personality: cunning, observant, impulsive/patient, calculating, manipulative, charming, anxious, suspicious/trusting, loyal, jealous, protective, compassionate/callous, brave, reckless, disciplined, vindictive, honest/deceptive, romantic, and commitment-averse;
- experience: street fighter, boxer, grappler, firearms, police, military, criminal, driving, mechanic, and medic experience;
- social: connected, respected, feared, notorious, affluent/poor/working-class, affiliated, criminal record, ex-convict, informant, and snitch reputation.

Seeds are descriptive and grant no mechanic by default. Opposition pairs and generation grouping tags prevent obvious contradictions. Police, military, firearms, criminal, ex-convict, informant, and snitch entries require matching template background tags before generation.

## Weighted NPC templates

`traitTemplate` is a Creator-editable entity with background tags, category weights, required/excluded trait IDs, minimum/maximum selection size, a template budget, category caps, generation-tag caps, and hidden-trait policy.

Generation is deterministic for a supplied seed and weighted without becoming an unvalidated random pile. Every tentative addition passes prerequisites, oppositions, effect conflicts, background gates, group/category caps, and point policy. An unsatisfiable template fails atomically.

Catalog installation supplies:

- `Grounded civilian traits`, which excludes specialized backgrounds through background gates;
- `Police-background traits`, which explicitly carries police/firearms background tags and requires Police training.

Creator Studio exposes a reviewed NPC-only generation action. The server commits the replacement through revision, idempotency, audit, event, outbox, and autosave boundaries.

## Runtime hooks and provenance

- Checks consume scoped trait effects as named modifier entries with source IDs in the immutable check ledger.
- Action choice restrictions are checked before mutation.
- Need rates resolve per need with a nonnegative final multiplier.
- Simultaneous schedule entries and NPC plans use authored priority deltas.
- Successful NPC decisions retain Creator-only trait/effect source traces.
- Contextual first impressions add descriptive relationship history without modifying attraction or morality.
- Flavor effects remain prose metadata and do not acquire hidden mechanics.

## API and Creator workflow

- `GET /game/catalog` exposes strict trait and `traitTemplate` JSON Schemas.
- `POST /game/timelines/:id/catalog` installs the editable seed records and templates.
- `POST /game/timelines/:id/entities` and `/entities/bulk` author traits, templates, and character assignments through shared validation.
- `POST /game/timelines/:id/traits/generate` accepts `{revision, characterId, templateId, seed}` for an NPC.
- Developer simulation preview exposes authorized behavior traces without persisting them.
- Player Mode never loads Creator-hidden trait definitions or trait decision traces.

No database migration is required: traits, templates, assignments, and trace state use the existing versioned entity JSON and export/save contracts. Stable entity/effect IDs survive label edits.

## Tests executed

Focused:

- `node tests/run.ts tests/system09-traits.test.ts`
  - 5 passed, 0 failed.

Coverage includes opposition and effect-conflict rejection, disadvantage caps and add/remove refund exploits, deterministic weighted generation, background gating, contradiction-safe selection, audited NPC assignment, AI priority source tracing, hidden Player Mode filtering, contextual first-impression behavior, and the requested realistic seed families.

Also passed:

- `npm run check`;
- `node --check public/app.js`;
- `npm test`: 125 passed, 0 failed;
- System 07 character/profile regressions;
- System 08 check/training regressions;
- lifecycle regressions.

## Deliberate balancing decisions

The engine does not assign universal costs, final point budgets, automatic trait mechanics, objective beauty, morality, or attraction rules. Creators author those campaign-specific choices. Seed traits are safe descriptive vocabulary; scoped effects and cost policies are opt-in and auditable.
