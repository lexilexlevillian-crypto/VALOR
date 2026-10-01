# Creation Studio and game menu

The creation UI follows the OC-sheet hierarchy: essentials first, simulation and AI authoring underneath closed disclosure panels. The signed-in campaign menu uses a title-screen layout; the same visual themes extend through login, creation and play.

The title screen keeps the VALOR wordmark and decoration, with just New Life, Load Life, and About Valor underneath. Campaign and timeline selection happen on separate screens. Gameplay sidebar entries require an actively selected character and are absent from the title screen, roster, New Life, and authoring screens. Creation Studio has separate People, Lore & stories, Places, Objects & media, Skills & systems, and World & diagnostics pages; advanced tools are not mixed into record creation.

Characters, NPCs, and freeform New Life creation share the reference-sheet layout: Overview notes beside identity fields; Stats bars beside descriptive ratings; Background choices/history beside zero to three job columns; Skills bubbles; Personality notes beside characterization and psychology; and Appearance fields beside prose. Phone layouts stack the pairs and job cards, while iPad and desktop use available space for columns. No attribute scale, permission, or database schema is changed by this layout.

## Controls

- Character and NPC editors share Overview, Stats, Background, Occupation, Skills, Personality and Appearance panels. Jobs support zero to three occupations. Detailed schedules, linked businesses, additional background properties, custom sections and template/generation tools remain available underneath. Suggested dropdown values are optional; custom authored text remains supported.
- Other entity types use the same Record / Essentials / More details pattern. New Game uses visual attributes and authored skill selection instead of requiring JSON for those fields.
- Section question marks support hover, keyboard focus, tap and Escape. Collapsible details describe their purpose when opened. Touch controls retain larger targets; mobile sheets stack without horizontal scrolling.
- Attributes use segmented range controls; skills and descriptive ratings use bubbles. Each has an exact numeric input. Attributes follow the campaign scale; skill choices reference actual authored skill records and their individual scales. Visual segments do not impose a new rating scale or convert stored values.
- Saving still requires existing server validation and explicit review. Collapsing a panel does not erase its values. UI hiding is not authorization: Developer Mode and server-side observer filtering remain unchanged.

## Style

The Style button opens the palette chooser without replacing an unsaved creation draft. Signed-in choices use the existing revisioned account preference API and respect campaign restrictions. Signed-out selection is device-local. Decorations and reduced motion are device preferences; operating-system reduced motion and emergency high visibility are also respected.

Fifteen palettes: green, pink, purple, blue, red, amber, cyan, chrome, orange and yellow neon; baby pink, baby blue, butter yellow, lavender and mint soft themes. Soft themes use light panels, gentle gradients and bow/heart accents. Neon themes use dark panels, luminous borders and star accents. No third-party images, fonts, tracking or generated mockup screenshots are loaded by the application.

## Verification

`npm run check` and `npm test` include existing database, authorization, simulation and browser coverage. `tests/creation-ui.test.ts` verifies custom fractional scales, authored skill IDs, keyboard/tap help, pastel contrast, responsive layouts, theme persistence and the survival of private notes/background/job data across a reviewed save. Browser screenshots are local, ignored artifacts, not game assets.

`studio.js` and `studio.css` are same-origin static assets included in the versioned offline shell. Authenticated API responses and game state remain uncached.
