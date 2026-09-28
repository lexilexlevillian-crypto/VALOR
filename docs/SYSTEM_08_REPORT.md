# SYSTEM 08 — Attributes, Skills, Checks, and Advancement

Status: implemented and tested.

## Goal

VALOR now has configurable, auditable attribute and skill mechanics without making the AI the owner of rolls or outcomes. Existing deterministic turn resolution remains compatible, while Creator-authored check definitions expose richer outcome categories and named modifier provenance.

## Files and modules

Added:

- migrations/015_system08_checks.sql
- tests/system08-mechanics.test.ts
- docs/SYSTEM_08_REPORT.md

Changed:

- src/game/model.ts
- src/game/actions.ts
- src/game/engine.ts
- src/game/routes.ts
- public/app.js
- tests/foundation.test.ts
- tests/libsql.test.ts
- tests/turso.test.ts

## Attributes and skills

The seven attributes remain Strength, Agility, Endurance, Intellect, Perception, Presence, and Will.

The editable skill catalog covers hand-to-hand, handgun/rifle/shotgun firearm families, melee, improvised weapons, driving, athletics, stealth, lockpicking, pickpocketing, burglary, streetwise, deception, persuasion, intimidation, empathy/insight, investigation, search, first aid, mechanics, 2012 electronics/computers, cooking, trades, academics, literacy, languages, police procedure, law, and criminal knowledge.

Skill entities carry authored scale metadata, optional named ranks, prerequisites, oppositions, and training metadata for instruction time, distinct practice time, cost, trainer requirements, and milestones. Attribute settings carry the same configurable min/max/step and optional rank metadata. Character values use only broad storage-safety bounds; active values are validated against the authored scale and step rather than a universal final range.

Experience capability uses scoped check modifiers. A modifier may target an attribute, one skill record, and/or named contexts. Unscoped legacy modifiers are rejected on experience records, so Police experience cannot silently become a bonus to unrelated investigation, computers, law, or forensic work.

## Check contract

Creator-authored check definitions specify attribute, optional skill, difficulty, formula, roll/no-roll mode, required traits, equipment tags, context modifiers, condition modifiers, outcome mode, and outcome bands.

Each resolved check stores attribute input, skill input, random input, difficulty, and typed named modifiers for traits, injuries, authored context, condition state, and equipment. Provenance includes the authored formula, outcome mode and bands, margin, resolution reason, requirements, selected skill, and attribute. Totals are never the only stored explanation.

Supported outcomes are critical, success, success-at-cost, partial, failure-with-information, failure-with-consequence, impossible, and no-roll.

Existing legacy-binary behavior remains available for compatibility. Configured-bands mode enables the richer categories. Missing authored requirements produces impossible without consuming a random draw. No-roll definitions consume no draw.

Outcome bands are validated in order so they cannot overlap nonsensically. The additive-die and additive-no-die formulas are explicit configuration. authored-total is a safety mode that refuses to fabricate a total when no authored resolver exists and records no-roll with that reason.

## Durable check ledger

Migration 015 adds immutable check_records linked to timeline, game event, character, optional check definition, and optional skill. Each row stores difficulty, context, die value, attribute and skill values, named modifiers, total, outcome, formula provenance, and condition/equipment provenance.

The ledger is indexed by character and event. Update and delete triggers protect history. Records are committed in the same transaction as the projection, immutable event, receipt, audit, outbox, and autosave.

## Advancement and training

The train action supports either a skill or attribute target. It enforces:

- skill prerequisites;
- present, visible trainers for required instruction and a persisted trainer or explicit/self-directed source;
- separate instruction and practice sessions;
- authored instruction minutes, practice minutes, proportional instruction cost, and narrative milestones;
- available cash;
- one authored scale step maximum per completed training record.

Training state preserves target, trainer, source, start time, accumulated instruction/practice/cost, requirements, milestone state, status, completion time, and notes. Missing practice or milestones leaves the record active rather than granting mastery.

## API and state contracts

- POST /game/timelines/:id/turns supports check and train actions.
- POST /game/timelines/:id/settings validates formula mode, outcome mode/bands, attribute scale, and advancement settings.
- GET /game/timelines/:id/checks?characterId=... returns controlled-player or authorized Creator/Admin check history.
- GET /game/timelines/:id/view?characterId=... includes only that controlled character’s check history.
- GET /game/catalog exposes validated skill and check-definition schemas to the authorized Creator surface.

Retries with the same idempotency key return the original event and cannot create another check or reroll mechanics.

## Player Mode

Player Mode shows the controlled character’s authored attributes, skill ratings, and expandable recent check outcomes. Each row explains attribute, skill, die/random input, context, difficulty, named modifiers, margin, and resolution reason. It does not expose hidden NPC mechanics, Creator-only check definitions, or the identities of private modifier sources; private sources remain numerically auditable under a redacted label.

The Skills / Traits page explains that ratings are authored or earned through time, cost, prerequisites, practice, and milestones.

## Developer Mode and Creator controls

Developer Studio can author skill and attribute scales/ranks, prerequisites, oppositions, scoped trait modifiers, instruction/practice requirements, check definitions, formulas, difficulty, context, required traits/equipment, condition/context modifiers, outcome bands, and advancement settings. The UI cannot mutate check records or provide random seeds.

## Validation and security

- Shared schemas validate attributes, skills, training targets, skill references, prerequisites, trainer references, check definitions, formulas, and outcome bands.
- Character values must fit their authored scale and step across Creator edits, starts, imports, saves, and simulation persistence.
- Experience modifiers require an explicit skill/attribute/context scope.
- Trainer location and observer visibility are required.
- Required equipment is checked against equipped item tags.
- Check history is controller-restricted for players.
- Check records are immutable and transactionally linked to events.
- AI narration receives committed results and cannot create or revise mechanics.
- Existing revision locks, idempotency, audit, and rollback protections cover checks and advancement.

## Tests executed

Focused:

- node tests/run.ts tests/system08-mechanics.test.ts
  - 7 passed, 0 failed.

Coverage includes every result category, named typed modifiers, full provenance, deterministic persistence, no-reroll retries, impossible/no-roll outcomes, scoped police capability, hidden-source redaction, catalog coverage, prerequisites, trainer/source persistence, separate instruction/practice, proportional cost, milestones, authored scale steps, and persisted training state.

Also passed:

- npm run check;
- node --check public/app.js;
- npm test: 120 passed, 0 failed, including core game/lifecycle, foundation,
  migration, libSQL, and native compatibility regressions.

## Manual acceptance

1. Configure resolution rules in Developer Mode with configured-bands mode.
2. Author a skill scale, ranks, prerequisites, and training requirements.
3. Author a check definition with difficulty, context, required equipment, and outcome bands.
4. Create a playable character with a skill and trait modifier.
5. Trigger a check and inspect Skills / Traits for the result.
6. Retry the same request and confirm no second ledger row is created.
7. Train with and without the required trainer and confirm server enforcement.
8. Complete instruction and practice separately, satisfy a milestone, and confirm time/cost/source persistence and advancement of exactly one authored step.
9. Configure impossible/no-roll checks and confirm no die value is stored.
10. Confirm another player cannot read the character’s check ledger.

## Performance, accessibility, and cost

Check history is capped at 200 records per response and indexed by character/event. Resolution is deterministic and local, with no AI call. Training is bounded to 15–1,440 minutes per action.

The Player Mode mechanics panel uses existing responsive layout, labeled controls, keyboard navigation, focus rings, contrast themes, and reduced-motion behavior.

## Genuine undecided design question

The implementation deliberately does not select final dice mathematics. Campaign rules or each check definition must choose additive-die or additive-no-die. The authored-total mode refuses to invent a total until a future explicitly authored deterministic formula interpreter or resolver contract exists; it records no-roll with `authored-resolver-unavailable` rather than silently falling back.
