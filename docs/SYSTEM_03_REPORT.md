# SYSTEM 03 — Campaigns, World Configuration, and Canon Boundaries

## Result

System 03 establishes a Creator-authored, data-driven setting boundary. Campaign policy is stored as validated defaults plus explicit overrides. Reusable canon remains world-scoped, revisioned, snapshot-backed, and explicitly bindable to campaigns and timelines. No Valor city, neighborhood, faction, agency, family, law, culture, or named setting record was added to engine code.

## Files and modules

- migrations/010_system03_campaign_canon.sql
  - Adds campaign configuration, canon metadata/link, immutable revision snapshot, campaign/timeline/event binding, indexes, triggers, and System 01 artifact-registry backfill.
- src/campaign-config.ts
  - Defines strict configuration schemas, nested override merging, timezone validation, defaults, and stored-config parsing.
- src/domain.ts
  - Creates campaign configuration rows; provides authorized configuration reads/writes; manages canon metadata, links, revisions, publication/archive status, and campaign bindings.
- src/app.ts
  - Adds authenticated campaign configuration and world/canon routes.
- src/game/engine.ts
  - Starts new timelines from resolved campaign configuration and records canon revision provenance on timeline, branch/import, and committed event paths.
- tests/system03-campaign-canon.test.ts
  - Covers configuration resolution, Creator authorization, conflicting worlds, publication/archive/revision snapshots, timeline isolation, and event provenance.
- Migration count assertions in the existing foundation/libSQL/Turso tests now expect migration 010.

## Data and authority boundaries

Campaign configuration contains:

- start clock and timezone;
- calendar definition;
- arbitrary enabled-system flags;
- difficulty label;
- content rating and mature-content boundary;
- needs and injury intensity;
- an authored law-enforcement profile reference/posture;
- technology availability and service variability;
- travel abstraction;
- save behavior;
- UI default preferences.

Defaults and overrides are stored separately. Overrides are recursively merged and revalidated; invalid timezones, unknown fields, malformed calendar entries, or unsupported policy values are rejected.

Canon records are metadata around existing reusable world records. They carry stable record IDs, creator slugs, aliases, source status, validity dates, revisions, and normalized dependent-record links. A canon revision stores immutable record/field/section snapshots. Publishing or archiving a revision never mutates older snapshots. Campaigns bind to a published revision, new timelines copy that binding, and committed game events record the revision used. Branches and imports preserve their source timeline binding.

## API contracts

- GET /campaigns/:campaignId/config
- POST /campaigns/:campaignId/config
  - body: expectedRevision, overrides, optional reason
- GET /worlds/:worldId/canon/records
- POST /worlds/:worldId/canon/records
- GET /worlds/:worldId/canon/revisions
- POST /worlds/:worldId/canon/revisions
- POST /worlds/:worldId/canon/revisions/:revisionId/status
- GET /campaigns/:campaignId/canon
- POST /campaigns/:campaignId/canon

World canon mutation routes require the world owner/Creator scope. Campaign configuration and binding mutations require a privileged campaign role. Reads remain membership/ownership scoped. All mutations use existing idempotency, transaction, optimistic revision, domain-event, audit, request-correlation, and redaction boundaries.

## Player Mode and Developer Mode

Player-facing callers can read the resolved campaign configuration and their permitted world/campaign records, but cannot see Creator-only canon metadata or mutate policy. No new visual UI was added in this system; presentation work remains outside the campaign/canon boundary.

Developer/Creator callers use the same server APIs with privileged scope. Published/draft/archived status, revision snapshots, source IDs, links, and binding provenance are explicit and suitable for a read-first diagnostic view. No debug-only client state is authoritative.

## Validation and security

- Canon record IDs must belong to the requested world; cross-world revision membership is rejected.
- Campaign bindings must reference a published revision from that campaign’s source world.
- Immutable revision snapshots cannot be updated or deleted by SQL triggers.
- Campaign configuration writes use expected config revision and server-side role checks.
- Canon and configuration mutations emit immutable domain events and audit before/after context.
- No engine branch depends on a named city, neighborhood, faction, agency, culture, or law record.
- The model does not derive ethnicity, culture, morality, attractiveness, or criminality from canon fields.

## Tests

- npm run check passes.
- Focused System 03 test run passes: 2 tests, 0 failures.
- The existing API migration suite passes against migration 010.
- Full suite runner passes: 90 tests, 0 failures.

## Manual acceptance

1. Create two worlds with same canon slug but conflicting city records.
2. Create one campaign from each world.
3. Publish one revision per world and bind each campaign.
4. Start both timelines; verify each timeline has only its world’s revision ID.
5. Revise and archive the first world’s revision; verify its immutable snapshot still contains the old record data.
6. Commit an event in an existing timeline; verify event_canon_bindings retains the timeline’s original revision.
7. Attempt a player configuration write or cross-world canon binding; verify rejection.

## Performance, accessibility, and cost

Configuration reads are one indexed campaign lookup plus schema parsing. Canon revision creation performs bounded snapshot work proportional to selected records and is not performed during UI rendering or every turn. Revision snapshots increase storage linearly with authored snapshot size; no automatic deletion is enabled. This pass adds no external AI calls, paid services, or bitmap/UI assets. Accessibility impact is unchanged because no new visual surface was introduced.

## Open decisions

- The exact content of a campaign’s calendar, technology feature map, law profile, and named canon records remains Creator data rather than an engine default.
- The final Player Mode presentation of campaign settings and canon-safe world browsing belongs to the later UI/content systems.
