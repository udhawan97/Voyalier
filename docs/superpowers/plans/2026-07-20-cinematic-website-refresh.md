# Cinematic website refresh implementation plan

Date: 2026-07-20
Status: approved
Source workflow: `workflows/cinematic-website-refresh.md`

## Goal

Turn Voyalier's public entrance into a cinematic, high-craft product story while preserving its established brand, accessibility, local-first truthfulness, documentation readability, and dependency discipline.

## Design system

- Hallmark genre: atmospheric, constrained by Voyalier's existing `Quiet Journey` system.
- Macrostructure: Feature Stack.
- Theme: custom `Quiet Wonder`—washi daylight chapters, deep-sumi night chapters, ai-indigo structure, and scarce shu-vermilion waypoints.
- Typography: Shippori Mincho display + Zen Kaku Gothic New UI/body.
- Navigation: N9 edge-aligned minimal.
- Footer: Ft5 statement.
- Enrichment: H9 custom illustration centerpiece, Tier-B hand-built SVG/CSS.
- Motion vocabulary: folded-route parallax, sticky screenshot focus, closing-mark resolve. Transform and opacity only.

## File-level scope

Create:

- `.hallmark/preflight.json`—cached design pre-flight evidence.
- `.hallmark/log.json`—Hallmark diversification record.
- `tokens.css`—portable public-site design tokens required by the selected design discipline.
- `docs-site/src/components/FoldedRouteArtifact.astro`—accessible decorative hero artwork with no external runtime.

Modify:

- `docs-site/src/pages/index.astro`—new semantic page composition and progressive-enhancement script.
- `docs-site/src/styles/landing.css`—custom Quiet Wonder system, responsive Feature Stack, and motion fallbacks.
- `docs-site/src/styles/custom.css`—subtle shared Starlight chrome and download-page handoff styling; article bodies remain restrained.
- `docs-site/src/content/docs/download.mdx`—clearer platform decision and homepage return path without changing verified installation claims.
- `README.md`—prominent public-site entry and wording aligned with the refreshed experience.
- `workflows/cinematic-website-refresh.md` and `NOTES.md`—resolved workflow and vocabulary.

Delete: none.

## Implementation sequence

### 1. Lock the plan

- Commit this plan, workflow, notes, and pre-flight cache before production edits.
- Preserve all unrelated worktree changes; stage only explicitly scoped files.

### 2. Build the visual foundation

- Export all used color, type, spacing, rule, radius, duration, and easing tokens to root `tokens.css`.
- Import the token set from the landing stylesheet without altering the application's token package.
- Keep every color and font reference tokenized; use OKLCH in the new public-site palette.

### 3. Recompose the homepage

- Replace the current static hero with the folded-route artifact, concise primary action, and honest product principles.
- Convert the product tour into a desktop sticky Feature Stack using the three real Voyalier screenshots.
- Preserve the evidence, journey, and architecture diagrams as proof, but vary their composition instead of repeating framed cards.
- End with the folded mark resolving into a single download invitation and statement footer.
- Keep all claims grounded in existing code, tests, README, and documentation.

### 4. Progressive interaction

- Use a small inline module script with `requestAnimationFrame`, `IntersectionObserver`, and CSS custom properties; add no dependency.
- Treat motion as enhancement. Without JavaScript, every section and screenshot remains visible and readable.
- Disable pointer parallax for coarse pointers and spatial scroll effects for reduced motion and narrow layouts.

### 5. Documentation handoff

- Keep Starlight article layout calm.
- Improve shared header/focus/detail polish without turning docs pages into marketing scenes.
- Make the download page's platform choices and verified warning guidance easier to scan.
- Update README with direct website/download/docs routes and the `Quiet Wonder` public-site language.

## Verification

Focused during implementation:

```bash
pnpm --filter @voyalier/docs build
git diff --check
```

Rendered QA:

- Desktop: 1440 × 1000.
- Tablet: 768 × 1024.
- Mobile: 414 × 896, 375 × 812, and 320 × 700.
- Confirm no horizontal overflow, clipped clickable copy, missing images, console errors, or unreadable sticky states.
- Verify keyboard focus order, skip navigation, reduced-motion rendering, and 200% zoom behavior.
- Inspect homepage and download page screenshots, not source alone.

Final gates:

```bash
./scripts/check.sh
git diff --check
pnpm audit --prod
```

Then run the requested code-review discipline against the plan commit, correct material findings, commit the implementation, merge to `main`, push, wait for GitHub Pages, and inspect the deployed homepage and download page.

## Acceptance criteria

- The hero is unmistakably Voyalier and visibly dimensional without copying Apple or using fabricated imagery.
- Three signature motion moments work smoothly and have equivalent still/fade experiences.
- Product screenshots are real, crisp, and legible; diagrams remain accessible with accurate alt text.
- Documentation remains faster to read than the marketing page is to admire.
- No new runtime dependency, remote font, telemetry, hosted service, background request, or product claim is introduced.
- The complete repository gate passes and the merged live surface matches the local verified build.
