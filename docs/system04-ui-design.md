# System 04 — UI design system and theme engine

## Delivered visual language

VALOR uses compact utility labels, thin framed surfaces, luminous one-pixel dividers, readable serif display type, and touch-safe controls. The reusable browser primitives are `panel`, field labels, tabs, dividers, stat bars, framed images, compact navigation, profile sheets, and profile-wall regions. Character/NPC profiles use OVERVIEW, APPEARANCE, STATS, and BACKGROUND regions; Character Creator separates RECORD, OVERVIEW, STATS, BACKGROUND, SYSTEM, and custom profile sections.

Decorative accents are small, optional, and theme-specific. They can be disabled independently. No brand assets or bitmap page backgrounds are used.

## Semantic token contract

Every palette supplies: `base`, `surface`, `raised`, `text`, `muted`, `border`, `glow`, `selected`, `success`, `warning`, `danger`, `focus`, and `chart`. Theme values are written to `--theme-*` custom properties; UI code consumes semantic aliases such as `--base` and `--focus`. This gives the accessibility layer a clean override boundary without changing the saved aesthetic.

The shipped families are Neon Green Terminal, Neon Pink Scene, Neon Purple Night, Neon Blue Electric, Neon Red Heat, Neon Amber, Neon Cyan, Neon White/Chrome, Soft Baby Pink, Soft Baby Blue, and Soft Butter Yellow. Soft themes use light surfaces with dark foregrounds. Each picker tile renders a miniature live-token preview of base, surface, text, border, and glow.

User theme selection is stored by the server with optimistic revision control. A Creator may set the campaign recommendation and allowed list. If a user's palette is disallowed, the recommendation is applied without overwriting the user's stored preference.

## Accessibility evidence

- All theme text/surface pairs are checked at 4.5:1 or better; focus/surface and border/surface pairs are checked at 3:1 or better.
- Controls maintain a 44px minimum target and visible token-driven focus rings.
- Stat bars expose progressbar name, minimum, maximum, and current value; success, warning, and danger remain text-labeled rather than color-only.
- `prefers-reduced-motion`, `prefers-contrast`, and forced-colors rules are present.
- High-contrast and emergency high-visibility modes are device-persisted semantic overrides. They do not change the account palette or campaign recommendation. The emergency control is available on sign-in and authenticated top bars.
- Decorative accents and background textures can be disabled; emergency mode removes textures and glow shadows.
- The iPad browser flow completed keyboard, touch, overflow, reduced-motion, offline-shell, and axe checks without an assertion failure. On this Windows host, the test runner reported `EPERM` only while deleting its temporary fixture directory during teardown.

## Offline behavior

The service-worker cache was advanced to `valor-shell-v7`, covering the updated stylesheet, application module, and theme engine without caching session or API data.
