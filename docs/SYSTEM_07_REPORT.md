# SYSTEM 07 — Character Creator and Shared Character Data

Status: implemented and tested. Work stops at System 07 pending explicit approval for System 08.

## Goal

Player characters and NPCs now use the same validated character entity architecture. The server remains authoritative for identity, appearance, background, current state, planning, knowledge, and custom Creator-authored presentation. Player-facing projections reveal only observer-permitted fields.

## Files and modules

Added:

- migrations/014_system07_character_profile.sql
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

- identity: legal name, aliases, date of birth, sex, gender, pronouns, optional identity map, nationality, authored culture context, origin location, and class context;
- appearance: structured appearance map, height, build, hair, eyes, complexion, features, scars, tattoos, disabilities, presentation, and authored social-presentation context;
- background: structured background map, family background, employer/occupation, education, and beliefs context;
- authored voice, Creator instructions, secrets, notes, mood, goals, fears, needs/health, schedule, plans, preferences, and compatibility;
- the existing attributes, skills, traits, faction, housing, money, location, condition, reproductive settings, and other state fields.

Social presentation is descriptive authored context. No universal attractiveness score or mechanic was introduced. Identity and culture fields do not automatically derive mechanics.

Every character carries characterSchemaVersion, currently version 2. Existing fields retain their prior defaults through additive parsing.

## Custom section architecture

Character records contain stable-ID custom sections and fields:

- section ID, name, parent section ID, position, visibility, help text, editability, repeatability, archive state;
- field ID, name, type (text, number, boolean, or JSON), visibility, value, help text, repeatability, and archive state.

Sections support nested parent relationships. Server validation rejects duplicate IDs, missing parents, cycles, invalid field values, and malformed visibility. Practical bounds are 1,000 sections and 1,000 fields per section to keep requests and renders safe; this is an implementation safety bound rather than a positional data model.

Presentation edits change labels, positions, and hierarchy metadata without changing IDs or values.

## Migration and backfill

Migration 014 adds character_profile_schema_versions keyed by timeline and character. It:

- backfills all existing character entities as schema version 2;
- maintains metadata for new and updated character records through database triggers;
- adds a character lookup index;
- preserves the existing entity JSON as the authoritative profile payload.

No destructive migration or data rewrite is required. The migration is additive and tested through fresh migration, restart, libSQL, and native SQLite compatibility paths. A failed entity mutation rolls back the entity, revision, event, receipt, audit, outbox, and autosave transaction using the existing game mutation boundary.

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

- identity/overview and visibility;
- reusable custom sections for Identity, Appearance, Background, Stats, Skills, Traits, Health, Inventory, Relationships, Affiliations, Knowledge, Notes, or any other Creator-defined category;
- built-in validated character data below the custom section editor;
- add, rename, reorder, duplicate, archive, and delete actions for sections and fields;
- parent-section selection for nested presentation;
- field type, visibility, help text, and value controls;
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
  - 2 passed, 0 failed.

The focused suite covers:

- player/NPC schema parity;
- identity, appearance, background, authored presentation, and current-state persistence;
- migration backfill and trigger-maintained schema metadata;
- Player Mode removal of hidden character fields;
- campaign versus Creator custom-field visibility;
- stable custom section and field IDs through rename, reorder, parent changes, save, reload, and migration;
- cycle rejection.

Regression groups:

- npm run check
  - passed.
- node --check public/app.js
  - passed.
- Foundation, migration, libSQL, and native compatibility tests
  - 10 foundation tests passed;
  - 3 libSQL tests passed;
  - 4 Turso/native compatibility tests passed.

## Manual acceptance

1. Sign in as Creator and enter Developer Mode.
2. Open Developer Studio and create a character or select an NPC.
3. Confirm the dossier exposes identity, appearance, background, state, and custom section controls.
4. Add an Identity section and a campaign-visible field; add a Creator-only field beside it.
5. Rename and reorder the section, rename the field, and save.
6. Reload Developer Studio and confirm the values remain attached to their stable IDs.
7. Duplicate the section and fields, archive one field, and delete another.
8. Create a controlled playable character and an NPC in the same location.
9. Sign in as Player and confirm only permitted character fields and custom fields appear.
10. Confirm Creator-only fields, secrets, instructions, plans, and private notes do not appear in Player Mode.
11. Attempt a cyclic custom-section parent assignment and confirm the server rejects it without changing the saved profile.
12. Confirm a malformed custom field type or invalid origin location is rejected before commit.

## Performance, accessibility, and cost

The editor uses bounded server-validated JSON and does not call an AI provider. It renders only active sections and fields, uses stable IDs instead of rebuilding values from labels, and is responsive for iPad/mobile widths. Existing 44px controls, labeled fields, visible focus rings, reduced-motion behavior, contrast themes, and keyboard navigation apply to the new controls. Long labels and stable IDs wrap rather than forcing horizontal overflow.

Large Creator profiles can still become dense if a user authorizes hundreds of sections. The practical bounds, compact field grids, and per-section controls keep that risk bounded; virtualization or search-inside-profile can be added if real authored dossiers require it.

## Genuine undecided design question

The character schema currently stores rich relationships, inventory, phone data, memories, and knowledge as separate entity systems rather than duplicating those records inside the character JSON. This preserves authoritative references and avoids divergent copies. A later Creator presentation pass may add configurable cross-system section bindings so those separate records can be reordered into a dossier without changing their ownership or canonical storage.
