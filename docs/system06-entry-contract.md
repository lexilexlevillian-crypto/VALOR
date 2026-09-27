# System 06 — Entry routes and starting-state contract

## Player entry routes

- Main Menu: Continue, campaign roster, New Game, save management, and settings.
- `GET /game/timelines/:id/roster`: returns only playable characters assigned to the account. Campaign Creators may also see unassigned playable characters.
- `GET /game/timelines/:id/start-packages`: Players receive published campaign packages with a safe summary, never the hidden definition.
- `POST /game/timelines/:id/start`: applies exactly one package to an empty timeline and records an immutable `start.character` event.

Roster cards contain an optional permitted portrait, character name, campaign, last-played timestamp, permitted location and world time, condition/status, timeline revision, and the caller-visible save summary. If a portrait or location is absent or not visible, the response returns `null` and the UI renders a neutral placeholder. Roster and API state use `no-store`; Player Mode does not preload Creator definitions.

## Creator entry routes

Creator controls are rendered only in Developer Mode and remain server role-gated:

- `POST /game/timelines/:id/start-packages` validates and stores a guided, freeform, or template package.
- `POST /game/timelines/:id/start-packages/:packageId/duplicate` copies an authorized package as a template. The UI defaults the copy to Creator-only draft.
- Freeform launch uses `POST /game/timelines/:id/start` with an inline definition and is Creator-only.

The New Game screen exposes three distinct paths: choose an existing published start, duplicate an authorized start into a template, or create from scratch. Creator mutations show a preview and confirmation before submission.

## Starting-state record

A start definition is versioned JSON stored in `campaign_start_packages.definition_json`:

```text
character: { name, description, data }
grantEntityIds: UUID[]
relationshipTemplates: RelationshipTemplate[]
reputation: { factionId, score }[]
plotHookIds: UUID[]
requiresSystems: string[]
```

`character.data` is parsed through the canonical character schema and can author base attributes, skills, traits, money, location, housing reference, and other supported character fields. Grants clone validated records and retarget ownership/participation for `item`, `vehicle`, `quest`, `housing`, `relationship`, and `job`. Items can represent clothing or a phone with contacts; vehicles, jobs, housing, and ongoing problems remain independent optional records. Relationship templates or cloned relationship records can carry authored prior ties; faction reputation is applied explicitly.

All fields are opt-in. The engine creates no vehicle, phone, family tie, balance, criminal connection, location, home, or job unless the package explicitly supplies it. Schema defaults only keep the character record valid.

## Validation and atomicity

Validation runs when a package is authored and again immediately before launch. Every reference must exist and match its expected entity kind. Grant kinds are allow-listed. `requiresSystems` is compared with both resolved `campaign.enabledSystems` and runtime switches (`needs`, `fuel`, `romance`, `intimacy`, reproductive health, rules, NPC route travel, and tactics). A disabled requirement rejects the launch with `start_package_requires_disabled_system` before persistence.

Materialization occurs inside the normal revisioned mutation transaction. Invalid references, disabled systems, a stale revision, or an already-started timeline leaves no partial protagonist or grants.

## Accessibility and responsive behavior

Roster cards use semantic definition lists, visible text labels, framed-image alternatives, 44px controls, and single-column fallbacks below tablet width. Package meaning is communicated with text chips rather than color alone. Reduced-motion, forced-colors, high-contrast, and emergency display rules remain independent of the selected aesthetic theme.

## Verification evidence

Automated coverage includes published-package filtering, freeform role enforcement, invalid grants, atomic launch, empty and 120-character rosters, safe package summaries, permitted roster continuity metadata, absence-by-default, disabled-system checks at authoring and launch, draft template duplication, TypeScript validation, browser syntax, and the existing Player/Developer and accessibility suites.
