# SYSTEM 07 — Character Creator and Shared Character Data

Status: implemented and tested.

## Goal

Player characters and NPCs now use the same validated character entity architecture. The server remains authoritative for identity, appearance, background, current state, planning, knowledge, and custom Creator-authored presentation. Player-facing projections reveal only observer-permitted fields.

## Files and modules

Added:

- migrations/014_system07_character_profile.sql
- migrations/020_system07_character_templates.sql
- tests/system07-character.test.ts
- docs/SYSTEM_07_REPORT.md

Changed:

- src/game/model.ts
- src/game/epistemics.ts
- public/app.js
- public/style.css
- tests/foundation.test.ts
- tests/libsql.test.ts
- tests/turso.test.ts

## Character schema

The validated character data contract now includes:

- identity: legal name, aliases, date of birth, authored age, sex, gender, pronouns, optional identity map, nationality, authored culture/ethnicity context, origin location/neighborhood, and class context;
- appearance: structured appearance map, rich descriptive prose, height, build, hair, eyes, complexion, features, scars, tattoos, disabilities, presentation, and contextual social interpretation;
- background: structured background map, family background, employer/occupation, education, and beliefs context;
- authored voice, Creator instructions, AI behavior, secrets, notes, mood, goals, fears, needs/health, schedule, plans, preferences, and compatibility;
- the existing attributes, skills, traits, faction, housing, money, location, condition, reproductive settings, and other state fields.

Social presentation and attractiveness context are descriptive, authored prose. No universal attractiveness score or mechanic was introduced. Identity and culture fields do not automatically derive mechanics.

Every character carries characterSchemaVersion, currently version 3. Existing fields retain their prior defaults through additive parsing and migration.

## Custom section architecture

Character records contain stable-ID custom sections and fields:

- section ID, name, reusable dossier category, parent section ID, position, visibility, help text, editability, repeatability, archive state;
- field ID, name, position, type (text, number, boolean, or JSON), biographical/current/subjective classification, visibility, value, help text, editability, repeatability, and archive state.

Sections support nested parent relationships. Server validation rejects duplicate IDs, missing parents, cycles, invalid field values, and malformed visibility. Practical bounds are 1,000 sections and 1,000 fields per section to keep requests and renders safe; this is an implementation safety bound rather than a positional data model.

Presentation edits change labels, positions, subsection ownership, and hierarchy metadata without changing IDs or values. Repeatable fields use typed arrays; schema-v2 scalar values remain readable and are normalized by the v3 Creator editor.

World-owned profile templates snapshot these stable-ID section definitions with blank defaults, not a source character's personal values. Applying a template keeps the current value contract for every matching field ID, even when the template moves or relabels it. Fields omitted by the template remain persisted as archived fields/sections, so replacement is non-destructive.

## Migration and backfill

Migration 014 adds character_profile_schema_versions keyed by timeline and character. Migration 020:

- advances existing character entities and metadata to schema version 3;
- replaces the profile-version triggers so new and updated characters remain at version 3;
- adds world-owned character_profile_templates with active-name uniqueness and lookup indexes;
- preserves the existing entity JSON as the authoritative profile payload.

The migration is forward-only and changes only the character schema-version marker inside existing JSON; authored values are not rewritten or dropped. It is tested through fresh migration, restart, libSQL, and native SQLite compatibility paths. A failed entity mutation rolls back the entity, revision, event, receipt, audit, outbox, and autosave transaction using the existing game mutation boundary.

## API and state contracts

System 07 uses the existing authoritative entity contracts:

- POST /game/timelines/:id/entities
  - Creator/Admin only;
  - accepts a complete character entity plus current timeline revision and idempotency key;
  - validates the complete profile and all references before commit.
- POST /game/timelines/:id/entities/bulk
  - Creator/Admin only;
  - validates staged cross-record references for NPC/player creation in one transaction.
- GET /game/timelines/:id/developer/overview
  - authorized Creator/Developer view of full character records and custom fields.
- GET /game/timelines/:id/view?characterId=...
  - controlled-player view projected through observer permissions.
- GET/POST /game/timelines/:id/character-profile-templates
  - lists or creates reusable world-owned dossier layouts for authorized Creators.
- POST /game/timelines/:id/character-profile-templates/use
  - applies a replacement layout through the audited, optimistic, idempotent mutation boundary;
  - preserves matching stable-ID values and archives omitted values.

The server stores complete entity data. The browser editor only edits a draft and refreshes from the authoritative response after save.

## Player Mode behavior

Player Mode:

- shows the player’s permitted dossier, including authored identity and appearance fields that are visible in context;
- shows custom sections only when their section and field visibility permit the current observer;
- omits Creator-only fields, hidden instructions, secrets, private planning state, private culture/background notes, and non-permitted custom fields;
- never receives the Creator registry or unfiltered character payload;
- does not infer a player’s feelings, identity, culture, attractiveness, or decisions from profile data.

NPC presentation remains a projection of known data. Exact hidden state stays server-side.

## Developer Mode and Creator workflow

Developer Studio uses the same editor for player and NPC records. Character editing is organized as a dossier with:

- explicit Biography, Appearance, Current State, Mechanics, and Subjective Notes regions;
- reusable custom sections for Identity, Appearance, Background, Stats, Skills, Traits, Health, Inventory, Relationships, Affiliations, Knowledge, Notes, or any other Creator-defined category;
- built-in validated character data below the custom section editor;
- add, rename, reorder, duplicate, archive, and delete actions for sections and fields;
- parent-section selection for nested presentation;
- field order, subsection destination, type, fact/state/note class, visibility, help text, editability, repeatability, and value controls;
- reusable dossier-template save and reviewed replacement controls;
- stable-ID display to make persistence explicit.

Existing record duplication assigns a new entity ID, and record archive remains subject to reference protection. State repairs and privileged edits continue through the existing server-side role checks, revision checks, audit, and transaction boundary.

## Validation and security

- Player and NPC records share the same Zod schema and validateEntity path.
- Origin locations, scheduled locations, skills, traits, faction IDs, and other references are type-checked.
- Character controller assignment requires campaign membership.
- Trait prerequisites, opposition, permanent traits, and trait budget are still enforced on character edits.
- Custom section parent cycles and invalid field types are rejected.
- Archived custom sections and fields are not projected.
- Character visibility is filtered before Player Mode response serialization.
- SQL remains parameterized; Creator access is server-authorized, not UI-authorized.
- The existing request correlation, idempotency, revision, audit, and rollback mechanisms cover profile mutations.

## Tests executed

Focused:

- node tests/run.ts tests/system07-character.test.ts
  - 4 passed, 0 failed.

The focused suite covers:

- player/NPC schema parity;
- identity, appearance, background, authored presentation, and current-state persistence;
- migration backfill and trigger-maintained schema metadata;
- Player Mode removal of hidden character fields;
- campaign versus Creator custom-field visibility;
- stable custom section and field IDs through rename, reorder, parent changes, save, reload, and migration;
- stable field values through cross-subsection moves and template replacement;
- archival preservation for values omitted by a replacement template;
- typed repeatable fields plus field position, editability, and classification metadata;
- cycle rejection.

Regression groups:

- npm run check: passed.
- node --check public/app.js: passed.
- npm test: 116 passed, 0 failed, including browser, foundation/migration, libSQL, native SQLite/Turso compatibility, visibility, and integrated gameplay groups.

## Manual acceptance

1. Sign in as Creator and enter Developer Mode.
2. Open Developer Studio and create a character or select an NPC.
3. Confirm the dossier exposes identity, appearance, background, state, and custom section controls.
4. Add an Identity section and a campaign-visible field; add a Creator-only field beside it.
5. Rename and reorder the section, rename the field, and save.
6. Reload Developer Studio and confirm the values remain attached to their stable IDs.
7. Move a field to another subsection, toggle editability/repeatability, duplicate the section and fields, archive one field, and delete another.
8. Save the persisted dossier as a reusable template, change and save a matching field value, then reapply the template and confirm the value remains.
9. Create a controlled playable character and an NPC in the same location.
10. Sign in as Player and confirm only permitted character fields and custom fields appear.
11. Confirm Creator-only fields, secrets, instructions, AI behavior, plans, and private notes do not appear in Player Mode.
12. Attempt a cyclic custom-section parent assignment and confirm the server rejects it without changing the saved profile.
13. Confirm a malformed repeated field value or invalid origin location is rejected before commit.

## Performance, accessibility, and cost

The editor uses bounded server-validated JSON and does not call an AI provider. It renders only active sections and fields, uses stable IDs instead of rebuilding values from labels, and is responsive for iPad/mobile widths. Existing 44px controls, labeled fields, visible focus rings, reduced-motion behavior, contrast themes, and keyboard navigation apply to the new controls. Long labels and stable IDs wrap rather than forcing horizontal overflow.

Large Creator profiles can still become dense if a user authorizes hundreds of sections. The practical bounds, compact field grids, and per-section controls keep that risk bounded; virtualization or search-inside-profile can be added if real authored dossiers require it.

## Cross-system ownership

Rich relationships, inventory, possessions, vehicles, phone/contact data, memories, knowledge, affiliations, and housing remain referenced authoritative records rather than duplicated character JSON. Relationship and phone contact entries reference character IDs, never display names. Dossier categories provide coherent presentation while preserving those ownership boundaries and avoiding divergent copies.
