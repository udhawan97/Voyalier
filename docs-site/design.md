# Quiet Transit — Voyalier public design system

Status: locked on 2026-08-02; travel-day continuity amendment on 2026-08-27
Scope: marketing landing page, Starlight documentation, public diagrams, social
preview, and README presentation.

## Intent

Quiet Transit makes the public surface feel like the current Voyalier app. It is
dark when the app is dark, warm rather than black, precise rather than clinical,
and explicit about the line between evidence and suggestion. The page should
feel like a journey ledger laid open on a desk—not a travel agency, a booking
engine, or an AI oracle.

## Structural system

- Marketing macrostructure: **Workbench**. Claims sit beside real product
  states; proof is never pushed into a decorative mockup.
- Documentation: **Long Document**. Reading measure stays below 65 characters
  and explanation outranks decoration.
- Downloads: **Index-first**. The operating-system decision comes before install
  detail.
- Navigation: **N5 Floating Pill** — content-sized, detached, solid with a quiet
  blur. Previous public navigation was N9; this build changes the archetype.
- Footer: **Ft1 Mast-headed** — a single strong brand close with only useful
  destinations. Previous public footer was Ft5.
- Hero: **H2 Split Diptych** — 7/5 copy-to-proof ratio, real screenshot, hairline
  divider, no fake application chrome.
- Product tour: **F2 Sticky-scroll Stack** — left-pinned explanation, five
  current screenshots in reading order.
- Downloads: **F6 Product Card Grid** — 3-up, landscape, uniform products, one
  primary action per platform.
- Signature: a folded-route evidence register carries
  `source → review → plan → return` through the page. Today and disruption views
  close the loop by returning to the local record that produced the projection.
  Each stop names the trust state and continuity promise; it is wayfinding, not
  ambient art.

## Voice

Short, concrete, and calm. Name the object and the action: “Review what the
document suggested,” not “Unlock seamless confidence.” Never claim booking,
background monitoring, cheapest prices, availability, health/safety authority,
or visa decisions. “Official source” always means a link the traveler must
confirm, not authority Voyalier inherits.

## Typography

- Display: Shippori Mincho 500/600, roman only.
- Body and controls: Zen Kaku Gothic New 400/500/700.
- Outlier: system monospace for file extensions, checksums, and version labels
  only. It is not a third body face.
- Ratio: major third. Display caps at 5.25rem. Body is at least 1rem with 1.6
  leading. Long copy is 45–65 characters wide.
- Headings never use gradient text, decorative italic, or skipped levels.

## Colour and elevation

The source of truth is [`../tokens.css`](../tokens.css). The public palette maps
the app’s light and dark values into perceptual OKLCH roles.

- Charcoal `paper` and raised charcoal `paper-2` carry the dark surface.
- Warm ivory `ink` holds readable copy.
- Indigo identifies structure, links, and trusted context.
- Vermilion is a waypoint: download, pending review, or an explicit action.
- Cards gain elevation through surface lightness. Coloured glows are prohibited.
- Every accent-filled control uses `--color-accent-ink`; every dark surface sets
  its own foreground colour.

## Spacing, shape, and rules

- Four-point spacing ladder, from 0.25rem to 10rem.
- Page gutter is fluid; the content ceiling is 90rem.
- Product captures use one hairline and a 1.25rem radius—the same restrained
  softness as the app. No card-in-card framing.
- Primary touch targets are at least 44×44 CSS pixels.

## Motion and interaction

Workbench motion is limited to two primitives: one page-load reveal and a
1-pixel button press. Download discovery changes text and links without moving
layout. Focus rings appear instantly. `prefers-reduced-motion` removes spatial
movement and leaves the final state visible.

All downloadable cards start as honest GitHub Releases links. Client-side
release discovery may upgrade those links to exact assets. Failure preserves the
fallback and exposes a readable status; it never leaves a dead control.

## Responsive contract

- Required widths: 320, 375, 414, 768, and 1440 CSS pixels.
- `html` and `body` use `overflow-x: clip`.
- Image tracks use `minmax(0, 1fr)`.
- The hero and sticky product tour become a natural single-column reading order
  below 60rem; sticky behavior is removed.
- Navigation keeps the wordmark and Download action on phones; secondary links
  are removed from the visible rail.
- Clickable labels stay on one line. Every image has dimensions and useful alt
  text; below-the-fold images load lazily.

## Brand and imagery

Keep the existing folded-route logo and app icon. Product UI is shown only with
real screenshots from a disposable fictional workspace. Travel-day captures
must show populated local projections and no personal data; disruption captures
must preserve the panel's non-predictive language. Do not redraw browser,
desktop, or terminal chrome. Diagrams share one stroke family, charcoal/ivory
surfaces, indigo structure, and one vermilion waypoint.

## Exports

### CSS source of truth

`tokens.css` contains the complete runtime token set and is imported before
page-level rules.

### Tailwind v4

```css
@theme {
  --color-paper: oklch(95.6% 0.017 87);
  --color-paper-2: oklch(98.1% 0.012 87);
  --color-paper-3: oklch(92.7% 0.019 87);
  --color-ink: oklch(20.5% 0.008 78);
  --color-ink-2: oklch(35% 0.011 78);
  --color-muted: oklch(45.5% 0.012 78);
  --color-rule: oklch(76% 0.016 87);
  --color-accent: oklch(55% 0.16 35);
  --color-accent-ink: oklch(98% 0.01 87);
  --color-focus: oklch(47% 0.16 257);
  --font-display: "Shippori Mincho", ui-serif, Georgia, serif;
  --font-body: "Zen Kaku Gothic New", ui-sans-serif, system-ui, sans-serif;
  --font-outlier: ui-monospace, "SF Mono", Menlo, monospace;
  --spacing-3xs: 0.25rem;
  --spacing-2xs: 0.5rem;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 3rem;
  --spacing-2xl: 4.5rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.25rem;
  --text-xl: 1.953rem;
  --radius-card: 1.25rem;
  --radius-pill: 999px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(95.6% 0.017 87)", "$type": "color" },
    "paper-2": { "$value": "oklch(98.1% 0.012 87)", "$type": "color" },
    "paper-3": { "$value": "oklch(92.7% 0.019 87)", "$type": "color" },
    "ink": { "$value": "oklch(20.5% 0.008 78)", "$type": "color" },
    "ink-2": { "$value": "oklch(35% 0.011 78)", "$type": "color" },
    "muted": { "$value": "oklch(45.5% 0.012 78)", "$type": "color" },
    "rule": { "$value": "oklch(76% 0.016 87)", "$type": "color" },
    "accent": { "$value": "oklch(55% 0.16 35)", "$type": "color" },
    "accent-ink": { "$value": "oklch(98% 0.01 87)", "$type": "color" },
    "focus": { "$value": "oklch(47% 0.16 257)", "$type": "color" }
  },
  "font": {
    "display": {
      "$value": "Shippori Mincho, ui-serif, Georgia, serif",
      "$type": "fontFamily"
    },
    "body": {
      "$value": "Zen Kaku Gothic New, ui-sans-serif, system-ui, sans-serif",
      "$type": "fontFamily"
    },
    "outlier": {
      "$value": "ui-monospace, SF Mono, Menlo, monospace",
      "$type": "fontFamily"
    }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" },
    "xl": { "$value": "3rem", "$type": "dimension" },
    "2xl": { "$value": "4.5rem", "$type": "dimension" }
  },
  "duration": {
    "micro": { "$value": "120ms", "$type": "duration" },
    "short": { "$value": "220ms", "$type": "duration" },
    "long": { "$value": "420ms", "$type": "duration" }
  }
}
```

### shadcn/ui variables

```css
:root {
  --background: 95.6% 0.017 87;
  --foreground: 20.5% 0.008 78;
  --card: 98.1% 0.012 87;
  --card-foreground: 20.5% 0.008 78;
  --popover: 98.1% 0.012 87;
  --popover-foreground: 20.5% 0.008 78;
  --primary: 55% 0.16 35;
  --primary-foreground: 98% 0.01 87;
  --secondary: 92.7% 0.019 87;
  --secondary-foreground: 35% 0.011 78;
  --muted: 76% 0.016 87;
  --muted-foreground: 45.5% 0.012 78;
  --accent: 55% 0.16 35;
  --accent-foreground: 98% 0.01 87;
  --destructive: 55% 0.16 35;
  --destructive-foreground: 98% 0.01 87;
  --border: 76% 0.016 87;
  --input: 76% 0.016 87;
  --ring: 47% 0.16 257;
  --radius: 1.25rem;
}
```
