# Public-site theme toggle implementation plan

Date: 2026-07-20
Status: approved

## Goal

Add an accessible, persistent appearance control to Voyalier's public homepage while preserving the existing Quiet Wonder composition and sharing one theme preference with the Starlight documentation site.

## Design contract

- Use one compact three-state control: System, Light, and Dark.
- Reuse Starlight's existing `starlight-theme` storage key so the homepage and documentation stay in sync.
- Restore the resolved theme in the document head before first paint to prevent a light-theme flash.
- Follow operating-system changes while System is selected.
- Keep the existing warm-paper and deep-sumi palette; dark mode changes elevation and contrast, not the brand hue.
- Use a hand-built SVG icon and existing type, color, spacing, radius, focus, and motion tokens.
- Preserve keyboard access, screen-reader naming, 44 px touch targets, reduced motion, 200% zoom, and no-JavaScript readability.

## File-level scope

Create:

- `docs-site/src/components/ThemeToggle.astro` — semantic control, icon states, persisted preference, and system-theme listener.
- `docs-site/src/components/ThemeToggle.preview.astro` — temporary eight-state visual test wrapper; remove before committing production work.

Modify:

- `tokens.css` — explicit dark semantic tokens and component status tokens.
- `docs-site/src/pages/index.astro` — pre-paint theme restoration and nav placement.
- `docs-site/src/styles/landing.css` — dual-theme surfaces, control states, responsive nav behavior, and dark-section rhythm.

Delete:

- `docs-site/src/components/ThemeToggle.preview.astro` after rendered state review.

## Implementation sequence

### 1. Establish one preference contract

- Parse only `light` and `dark` as explicit stored choices; missing or invalid storage means System.
- Resolve System through `prefers-color-scheme` and set `data-theme` to the actual light or dark value.
- Keep the control label, title, state text, and SVG icon synchronized without announcing decorative changes.
- If persistence fails, apply the selected theme for the current page and expose a quiet error state on the control.

### 2. Build the dark palette

- Add theme-specific semantic aliases in the root token file using OKLCH values already present in the Quiet Wonder palette.
- Make elevated surfaces lighter in dark mode and preserve the indigo/vermilion hierarchy.
- Explicitly pair every changed surface with an appropriate text color.
- Keep the existing night chapters distinct from newly darkened paper chapters.

### 3. Finish the component states

- Style default, hover, focus-visible, active, disabled, loading, error, and success states.
- Keep focus appearance instant and at least 3:1 against both themes.
- Use only color, opacity, and transform transitions; collapse motion for reduced-motion users.
- Render the temporary state wrapper and inspect every state before deleting it.

### 4. Verify the real surface

- Confirm System, Light, and Dark on the homepage with reload persistence and operating-system changes.
- Navigate from the homepage to Starlight docs and back to prove preference continuity.
- Inspect 1440 px, 768 px, 414 px, 375 px, and 320 px widths for overflow, wrapping, contrast, and icon clarity.
- Verify keyboard focus order, accessible names, reduced motion, 200% zoom, and no console errors.

## Verification

Focused:

```bash
pnpm --filter @voyalier/docs build
git diff --check
```

Final:

```bash
./scripts/check.sh
git diff --check
pnpm audit --prod
```

## Acceptance criteria

- The homepage offers a discoverable System/Light/Dark appearance control without crowding the edge-aligned navigation.
- The chosen preference survives reloads and is shared with the documentation site's built-in theme selector.
- The correct theme is applied before first paint.
- Every homepage chapter, artifact, image caption, link, and control remains legible in both themes.
- The control is fully operable by keyboard and touch and exposes an accurate accessible name.
- No runtime dependency, network request, analytics event, product claim, or application behavior is added.
