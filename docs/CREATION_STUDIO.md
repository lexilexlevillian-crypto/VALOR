# Creation Studio and game menu

The creation UI follows the OC-sheet hierarchy: essentials first, simulation and AI authoring underneath closed disclosure panels. The signed-in campaign menu uses a title-screen layout; the same visual themes extend through login, creation and play.

## Controls

- Character and NPC editors share Overview, Attributes, Background, Jobs, Skills, Personality and Appearance panels. Jobs support zero to three occupations. Additional background, detailed schedules, linked businesses, psychology notes, custom sections and template/generation tools remain available without filling the initial sheet.
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
