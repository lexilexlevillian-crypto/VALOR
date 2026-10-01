# Creation Studio and game menu

The creation UI follows the OC-sheet hierarchy: essentials first, simulation and AI authoring underneath closed disclosure panels. The signed-in campaign menu uses a title-screen layout; the same visual themes extend through login, creation and play.

The title screen keeps the VALOR wordmark and decoration, with New Life, Load Life, and About Valor inside the same card. The top bar contains only navigation, campaign context, mode and connection status. Main menu, Creation Studio, Style and High Visibility are in the navigation sidebar, opened with the menu icon before play or on phones. Campaign and timeline selection happen on separate screens. Gameplay sidebar entries require an actively selected character and are absent from the title screen, roster, New Life, and authoring screens. Creation Studio has separate People, Lore & stories, Places, Objects & media, Skills & systems, and World & diagnostics pages; advanced tools are not mixed into record creation.

Characters, NPCs, and freeform New Life creation share the reference-sheet layout: Overview notes beside identity fields; Stats bars beside descriptive ratings; Background choices/history beside zero to three job columns; Skills bubbles; Personality notes beside characterization and psychology; and Appearance fields beside prose. Phone layouts stack the pairs and job cards, while iPad and desktop use available space for columns. No attribute scale, permission, or database schema is changed by this layout.

## Controls

- Character and NPC editors share Overview, Stats, Background, Occupation, Skills, Personality and Appearance panels. Jobs support zero to three occupations. Detailed schedules, linked businesses, additional background properties, custom sections and template/generation tools remain available underneath. Suggested dropdown values are optional; custom authored text remains supported.
- Other entity types use the same Record / Essentials / More details pattern. New Game uses visual attributes and authored skill selection instead of requiring JSON for those fields.
- Section question marks support hover, keyboard focus, tap and Escape. Collapsible details describe their purpose when opened. Touch controls retain larger targets; mobile sheets stack without horizontal scrolling.
- Attributes use segmented range controls; skills and descriptive ratings use bubbles. Each has an exact numeric input. Attributes follow the campaign scale; skill choices reference actual authored skill records and their individual scales. Visual segments do not impose a new rating scale or convert stored values.
- Saving still requires existing server validation and explicit review. Collapsing a panel does not erase its values. UI hiding is not authorization: Developer Mode and server-side observer filtering remain unchanged.

## Style

The Style button in navigation opens the palette and background chooser without replacing an unsaved creation draft. Signed-in colors use the existing revisioned account preference API and respect campaign restrictions. Signed-out selection is device-local. Background pattern, animation, extra card decorations and reduced motion are device preferences; operating-system reduced motion and emergency high visibility are also respected. Background controls are also available in Settings.

All fifteen palettes now use pastel surfaces with dark, readable text: green, rose pink, purple, blue, coral, peach, aqua, pearl, baby pink, baby blue, butter yellow, lavender, mint, apricot and lemon. Existing theme IDs remain unchanged for saved preferences and campaign policies. Baby pink follows the supplied palette: #ffebef, #ffd1dc, lightpink (#ffb6c1), and #ff99aa, with darker accessible text and controls.

Every color supports hearts (default), stars, checkerboard and leopard print independently. Original SVG masks take their color from the palette. Hearts and stars drift gently by default; the Animate hearts & stars checkbox turns animation off and remembers that choice. Checkerboard and leopard never animate. Both the app's Reduce motion setting and operating-system reduced motion stop animation even when the animation checkbox is on. Emergency high visibility and forced-colors mode hide decorative wallpaper. No third-party images, fonts, tracking or generated mockup screenshots are loaded by the application.

## Verification

`npm run check` and `npm test` include existing database, authorization, simulation and browser coverage. `tests/creation-ui.test.ts` verifies custom fractional scales, authored skill IDs, keyboard/tap help, pastel contrast, responsive layouts, theme persistence and the survival of private notes/background/job data across a reviewed save. Browser screenshots are local, ignored artifacts, not game assets.

`tests/background-ui.test.ts` checks all sixty palette/background combinations, exact pink tokens, menu placement, navigation focus, preference persistence, offline controls, motion overrides and accessibility at phone, tablet and desktop sizes.

`studio.js`, `studio.css` and `backgrounds.js` are same-origin static assets included in the versioned offline shell. Authenticated API responses and game state remain uncached.
