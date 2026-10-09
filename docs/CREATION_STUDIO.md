# Creation Studio and game menu

## City guide and balanced starting lives

About Valor contains the supplied city document in regional pages, a searchable place directory, and the supplied map recolored at display time. Source wording is preserved. The serif typography uses Georgia/Times as a map-inspired approximation, not an identified original font.

The occupation list supplies 33 workplaces with matching player roles and additional supervisory NPC roles. Existing custom workplace/position values are preserved. Profile occupations alone do not create wages or employment contracts; those remain campaign job records.

New playable characters and launched lives receive 35 attribute points (10 per full campaign-scale bar), 12 skill points (5 per full skill-scale bar), and 6 trait points with at most 6 disadvantage refunds. Unused points are allowed. Background dropdowns grant stated skill ratings without adding attribute bonuses. Medicine, Surgery, and First aid are separate catalog skills. NPCs have no point-spending or trait-count caps; valid scales, references, prerequisites, oppositions and effect conflicts still apply.

Trait, skill and background pools show descriptions and effects before selection. Ordinary players can customize public start-package builds and profile occupations. Starts with private trait or skill choices are protected. Validation and persistence use the existing atomic, permission-checked start workflow.

Reviewed catalog installation upgrades untouched stock trait descriptors to mechanical, costed definitions while preserving IDs and custom effects. This remains an explicit audited Creator action; deployment does not silently rewrite live catalogs. Existing legal trait counts and selections are retained when the upgrade adjusts campaign allowances. Newly created lives still have the independent starting budgets.

The creation UI follows the OC-sheet hierarchy: essentials first, simulation and AI authoring underneath closed disclosure panels. The signed-in campaign menu uses a title-screen layout; the same visual themes extend through login, creation and play.

The title screen keeps the VALOR wordmark and decoration, with New Life, Load Life, and About Valor inside the same card. The top bar contains only navigation, campaign context, mode. Main menu, Creation Studio, Style and High Visibility are in the navigation sidebar, opened with the menu icon before play or on phones. Campaign and timeline selection happen on separate screens. Gameplay sidebar entries require an actively selected character and are absent from the title screen, roster, New Life, and authoring screens. Creation Studio has separate People, Lore & stories, Places, Objects & media, Skills & systems, and World & diagnostics pages; advanced tools are not mixed into record creation.

Characters, NPCs, and freeform New Life creation share the reference-sheet layout: Overview notes beside identity fields; twelve stat bars in two columns of six; Background choices/history beside zero to three job columns; Skills bubbles; Personality notes beside characterization and psychology; and Appearance fields beside prose. The twelve-bar grid stays balanced on phones, with compact stacked labels. Other pairs and job cards stack when needed. The seven gameplay attributes retain the campaign scale and the five descriptive ratings retain their 0–10 scale; grouping them visually does not change their mechanics.

All creation areas is beneath the registry search in the editor sidebar; the redundant hidden-registry badge is removed. Creation Studio, Style and High Visibility sit together at the bottom of the main navigation, directly above Sign out.

## Controls

- Character and NPC editors share Overview, Stats, Background, Occupation, Skills, Personality and Appearance panels. Jobs support zero to three occupations. Detailed schedules, linked businesses, additional background properties, custom sections and template/generation tools remain available underneath. Suggested dropdown values are optional; custom authored text remains supported.
- Other entity types use the same Record / Essentials / More details pattern. New Game uses visual attributes and authored skill selection instead of requiring JSON for those fields.
- Section question marks support hover, keyboard focus, tap and Escape. Collapsible details describe their purpose when opened. Touch controls retain larger targets; mobile sheets stack without horizontal scrolling.
- Attributes use segmented range controls; skills and descriptive ratings use bubbles. Each has an exact numeric input. Attributes follow the campaign scale; skill choices reference actual authored skill records and their individual scales. Visual segments do not impose a new rating scale or convert stored values.
- Saving still requires existing server validation and explicit review. Collapsing a panel does not erase its values. UI hiding is not authorization: Developer Mode and server-side observer filtering remain unchanged.
- More details includes a getting-started checklist and separate topics for personal history, appearance, place/money, health, AI writing, relationships, routines and access. Fields have persistent plain-language instructions, examples, units and ranges connected with aria-describedby. Optional record links have a None option; routine times use a clock input and routine days use weekday checkboxes. System-managed history is kept in a separate, closed section with a warning; no saved fields are removed.

## Style

The Style button in navigation opens the palette and background chooser without replacing an unsaved creation draft. Signed-in colors use the existing revisioned account preference API and respect campaign restrictions. Signed-out selection is device-local. Background pattern, animation, extra card decorations and reduced motion are device preferences; operating-system reduced motion and emergency high visibility are also respected. Background controls are also available in Settings.

The chooser has ten restored neon palettes (green, pink, purple, blue, red, amber, cyan, black-and-white, orange, yellow) and five distinct pastels (baby pink, baby blue, butter yellow, lavender, mint). Red uses #ff0000 on black, not coral or pink. Existing theme IDs remain unchanged for saved preferences and campaign policies. Baby pink retains the supplied palette: #ffebef, #ffd1dc, lightpink (#ffb6c1), and #ff99aa. Bow decorations are removed, and section headers have no decorative glyph competing with help buttons.

Every color supports hearts (default), stars, checkerboard and leopard print independently. Original SVG masks take their color from the palette. Hearts and stars drift gently by default; the Animate hearts & stars checkbox turns animation off and remembers that choice. Checkerboard and leopard never animate. Both the app's Reduce motion setting and operating-system reduced motion stop animation even when the animation checkbox is on. Emergency high visibility and forced-colors mode hide decorative wallpaper. No third-party images, fonts, tracking or generated mockup screenshots are loaded by the application.

## Verification

`npm run check` and `npm test` include existing database, authorization, simulation and browser coverage. `tests/creation-ui.test.ts` verifies custom fractional scales, authored skill IDs, keyboard/tap help, pastel contrast, responsive layouts, theme persistence and the survival of private notes/background/job data across a reviewed save. Browser screenshots are local, ignored artifacts, not game assets.

`tests/background-ui.test.ts` checks all sixty palette/background combinations, exact pink tokens, menu placement, navigation focus, preference persistence, offline controls, motion overrides and accessibility at phone, tablet and desktop sizes.

`studio.js`, `studio.css` and `backgrounds.js` are same-origin static assets included in the versioned offline shell. Authenticated API responses and game state remain uncached.
# Shared Valor world and private lives

In Developer Mode, open **Creation Studio** once and choose **Set up a fresh Valor world** or expand **Use work I already created** to select a clean authoring timeline. Existing content is not deleted or moved. A timeline containing a player character cannot become the master source.

After setup, Creation Studio always opens this source. Saved NPCs, places, lore, settings and published starts become the starting content for every **new** life. New Life creates a private copy automatically; players never need to create a campaign or receive Creator membership. Each life has its own events, characters, clock and saves. Existing lives stay on their starting version: later author edits do not overwrite player history. Legacy campaigns remain available through Load Life.

World settings is in the sidebar for developers. Common controls explain their effects; advanced simulation settings are collapsed. Review and save before changes apply. Fresh worlds use Washington's `America/Los_Angeles` timezone (including daylight saving time). Existing source settings are preserved until edited; the Pacific-time button changes the display/schedule timezone without moving the saved instant.

The fresh-world option creates an authoring workspace, editable skill/trait catalog and a basic customizable start. It does not invent NPCs or employment contracts. Choosing a residence creates the corresponding residential locations and walking links using the approved editable floor-plan defaults. Existing authored work can be selected instead. Public starts are copied server-side; private notes remain protected by the existing observer permissions. Player lives receive player membership only, even if the account can author another world.

Map water is transparent; only the opaque map artwork receives theme color. Region introductions precede district descriptions. Intimacy remains off or non-graphic fade-to-black with existing age/consent checks.

## Background training and skill statuses

Primary background and Backgrounds 2–4 are dropdowns in the existing sheet, not a separate selection pool. The choices include military, education, medical, service, trade, and automotive backgrounds. Existing written slots remain available as saved history without invented bonuses. Earlier originChoice values move into the primary slot when edited.

Each background grants at least one fitting skill at half a bar for free, without adding attribute bonuses. Some backgrounds grant a smaller secondary skill rating. They do not issue equipment, cash, employment or legal powers. Multiple grants for the same skill use the highest floor, never a sum. Fractions follow each skill's authored scale and round down to a valid step.

Player skill points pay only for ratings above the granted floor (five points per full bar). Removing a choice removes its free portion while keeping paid improvements; it cannot bank free points. Server startup independently resolves and saves grants, including authored starts that skip customization. NPCs retain unlimited budgets. Grants are starting training, not a cap on later progression.

Training traits such as Medic and Mechanic grant half a bar in their linked skill. Athletic grants Athletics. Trait cards explain their actual modifiers, scoped effects, free training, cost/refund, conflicts and permanence. Refunds remain capped at six for players. Custom creators can author skillGrants using a skill ID and a fraction from zero to one. Untouched older stock traits support the new grants; custom mechanics are preserved.

Stock skills have readable descriptions. At half a bar, **Trained** adds +2 to checks using that skill, recorded in the check breakdown. Trained Athletics also reduces ordinary time-based fatigue buildup by 15% when needs are enabled. This is not injury resistance and does not reduce combat exertion. Custom skill definitions are not automatically assigned these stock statuses.

Regression tests cover overlaps, fractional scales, paid upgrades, removal, public-only grants, persisted launches, actual check/fatigue effects, legacy histories and responsive accessible controls.
