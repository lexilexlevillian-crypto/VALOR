# SYSTEM 08 — Attributes, Skills, Checks, and Advancement

Status: implemented and tested. Work stops at System 08 pending explicit approval for System 09.

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

Skill entities now carry authored scale metadata, optional named ranks, prerequisites, oppositions, and training metadata for minutes per point, practice, cost, trainer requirements, and milestones. Character values use safe storage bounds, while effective scales are campaign- and skill-authored rather than universally fixed.

## Check contract

Creator-authored check definitions specify attribute, optional skill, difficulty, formula, roll/no-roll mode, required traits, equipment tags, context modifiers, condition modifiers, outcome mode, and outcome bands.

Each resolved check records named modifiers for attribute, skill, traits, injuries, authored context, condition state, and equipment. Totals are never the only stored explanation.

Supported outcomes are critical, success, success-at-cost, partial, failure-with-information, failure-with-consequence, impossible, and no-roll.

Existing legacy-binary behavior remains available for compatibility. Configured-bands mode enables the richer categories. Missing authored requirements produces impossible without consuming a random draw. No-roll definitions consume no draw.

The additive-die and additive-no-die formulas are explicit configuration. authored-total is a safety mode that refuses to fabricate a total when no authored resolver exists and records no-roll.

## Durable check ledger

Migration 015 adds immutable check_records linked to timeline, game event, character, optional check definition, and optional skill. Each row stores difficulty, context, die value, attribute and skill values, named modifiers, total, outcome, formula provenance, and condition/equipment provenance.

The ledger is indexed by character and event. Update and delete triggers protect history. Records are committed in the same transaction as the projection, immutable event, receipt, audit, outbox, and autosave.

## Advancement and training

The train action supports either a skill or attribute target. It enforces:

- skill prerequisites;
- present, visible trainers when required;
- authored minutes, practice, cost, and milestones;
- available cash;
- one point maximum per completed training record.

Training state preserves target, trainer, source, start time, accumulated minutes/practice/cost, requirements, milestone state, status, completion time, and notes. It cannot create instant mastery.

## API and state contracts

- POST /game/timelines/:id/turns supports check and train actions.
- POST /game/timelines/:id/settings validates formula mode, outcome mode/bands, attribute scale, and advancement settings.
- GET /game/timelines/:id/checks?characterId=... returns controlled-player or authorized Creator/Admin check history.
- GET /game/timelines/:id/view?characterId=... includes only that controlled character’s check history.
- GET /game/catalog exposes validated skill and check-definition schemas to the authorized Creator surface.

Retries with the same idempotency key return the original event and cannot create another check or reroll mechanics.

## Player Mode

Player Mode shows the controlled character’s authored attributes, skill ratings, and recent concise check outcomes. It does not expose hidden NPC mechanics, Creator-only check definitions, private modifier sources, or unauthorized character data.

The Skills / Traits page explains that ratings are authored or earned through time, cost, prerequisites, practice, and milestones.

## Developer Mode and Creator controls

Developer Studio can author skill scales/ranks, prerequisites, oppositions, training requirements, check definitions, formulas, difficulty, context, required traits/equipment, condition/context modifiers, outcome bands, attribute scales, and advancement settings. The UI cannot mutate check records or provide random seeds.

## Validation and security

- Shared schemas validate attributes, skills, training targets, skill references, prerequisites, trainer references, check definitions, formulas, and outcome bands.
- Trainer location and observer visibility are required.
- Required equipment is checked against equipped item tags.
- Check history is controller-restricted for players.
- Check records are immutable and transactionally linked to events.
- AI narration receives committed results and cannot create or revise mechanics.
- Existing revision locks, idempotency, audit, and rollback protections cover checks and advancement.

## Tests executed

Focused:

- node tests/run.ts tests/system08-mechanics.test.ts
  - 3 passed, 0 failed.

Coverage includes named modifiers, deterministic persistence, no-reroll retries, impossible/no-roll outcomes, prerequisites, trainer presence, time/cost consumption, one-point advancement, and persisted training state.

Also passed:

- npm run check;
- node --check public/app.js;
- core game and lifecycle regressions;
- foundation, migration, libSQL, and native compatibility regressions.

## Manual acceptance

1. Configure resolution rules in Developer Mode with configured-bands mode.
2. Author a skill scale, ranks, prerequisites, and training requirements.
3. Author a check definition with difficulty, context, required equipment, and outcome bands.
4. Create a playable character with a skill and trait modifier.
5. Trigger a check and inspect Skills / Traits for the result.
6. Retry the same request and confirm no second ledger row is created.
7. Train with and without the required trainer and confirm server enforcement.
8. Confirm training consumes time and money and advances at most one point.
9. Configure impossible/no-roll checks and confirm no die value is stored.
10. Confirm another player cannot read the character’s check ledger.

## Performance, accessibility, and cost

Check history is capped at 200 records per response and indexed by character/event. Resolution is deterministic and local, with no AI call. Training is bounded to 15–1,440 minutes per action.

The Player Mode mechanics panel uses existing responsive layout, labeled controls, keyboard navigation, focus rings, contrast themes, and reduced-motion behavior.

## Genuine undecided design question

The implementation deliberately refuses to invent a total for authored-total mode. A future system may add an explicitly authored deterministic formula interpreter or resolver contract. Until then, authored-total remains a safe no-roll configuration rather than silently falling back to engine-invented mathematics.
