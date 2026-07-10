# Design system

## Direction: Quiet Journey

Japanese-inspired restraint is expressed through negative space, rhythm, material warmth, and precision—not literal cultural symbols.

## The folded-route mark

The identity is one itinerary strip folded once at the valley: a V of descent and return, with a lone vermilion waypoint just past the fold. Three ideas govern it:

- **折 One strip, folded** — a single map closing gently around a place; two flat inks, no gradients.
- **間 Ma, the interval** — nothing touches; the pause between the fold and the waypoint carries the meaning.
- **朱 The waypoint** — muted shu vermilion is the only warm note in the system, so it never has to shout.

This mark supersedes the earlier Wayline V (2026-07): the same journey idea (descent, return, arrival), rebuilt as flat folded planes so it survives at 28 px, inverts cleanly on sumi, and gives the product a construction grammar (hairlines, folds, waypoints) rather than a one-off illustration. Assets live in `packages/brand/src/` — mark, dark mark, lockups, app icon.

## Foundation palette

- Washi paper: `#f3efe4`
- Warm ivory (raised surfaces): `#faf7ef`
- Sumi ink: `#1a1917`
- Ai indigo: `#46536b`
- Shu vermilion accent: `#c34e33`
- Brushed silver: `#a9a69c`

Dark mode uses deep sumi (`#171614`) and warm off-white (`#f2ede1`) rather than pure black and white; the fold softens to `#93a0b8`. A functional moss green remains available for product status semantics but is not part of the brand palette.

## Typography

- UI: Zen Kaku Gothic New, falling back to Inter/system sans.
- Display and kanji accents: Shippori Mincho, falling back to system serifs.
- The wordmark is letterspaced Zen Kaku Gothic New 500 (`0.34em`).

## Motion: 息, breath

The mark draws once and settles: ink traces the route, the traveler arrives, the paper exhales — then a long stillness. Frequent interactions use only opacity and transform. Every animation has a reduced-motion equivalent, and no meaningful status is communicated by motion alone.

## Accessibility gates

WCAG 2.2 AA, keyboard completeness, visible focus, text/icon/color status redundancy, 44-pixel targets, 200% zoom, reduced motion, and a nonvisual equivalent for maps or radar graphics.
