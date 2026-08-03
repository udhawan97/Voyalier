# Voyalier public-surface overhaul implementation plan

Date: 2026-08-02
Status: approved
Release target: none — documentation and public presentation only

## Goal

Make the README and documentation website feel like the current Voyalier app:
calm, nocturnal, exact, and evidence-led. Give a lay reader a quick route from
“what is this?” to a trustworthy platform download, while keeping the product’s
local-first and non-authoritative boundaries explicit.

## Locked design system

- Direction: **Quiet Transit** — the app’s dark charcoal workbench, warm ivory
  type, indigo structure, and restrained vermilion action colour.
- Marketing macrostructure: **Workbench**, replacing the prior Feature Stack.
- Documentation genres: **Long Document** for explanations and **Index-first**
  for downloads.
- Typography: Shippori Mincho for display and Zen Kaku Gothic New for interface
  and body text, matching the shipped app.
- Navigation: N5 Floating Pill, replacing the previous N9 Edge-aligned Minimal.
- Footer: Ft1 Mast-headed, replacing the previous Ft5 Statement.
- Hero: H2 Split Diptych, 7/5 ratio, real product capture, hairline divider.
- Product tour: F2 Sticky-scroll Stack, three real app states, left-pinned copy.
- Download surface: F6 Product Card Grid, 3-up, landscape, one explicit action
  per operating system.
- Signature detail: a folded-route ledger line connects the page’s product
  states. It is functional wayfinding, not decorative illustration.
- Motion: one restrained initial reveal plus button press feedback; all spatial
  motion collapses under `prefers-reduced-motion`.

## Scope

### Create

- `docs-site/design.md` as the public-surface design contract and export ledger.
- A reusable Astro download component with inline, coherent platform icons.
- A README website banner SVG using the existing Voyalier mark.
- A current visa-cockpit screenshot captured from the disposable sample trip.

### Modify

- `README.md` into an icon-led, layperson-first product and download guide.
- `tokens.css`, `.hallmark/preflight.json`, and `.hallmark/log.json` to lock and
  record the new design system.
- The docs landing page and its stylesheet.
- The Starlight custom stylesheet, introduction, and download pages.
- The three existing product screenshots with current disposable-runtime proof.
- The three existing explanatory SVG diagrams and the Open Graph preview.

### Delete

- Nothing. Existing public URLs and brand marks remain stable.

## Product-trust constraints

- Do not imply autonomous booking, monitoring, or authority over visas, safety,
  health, prices, availability, or opening hours.
- Separate the repository’s current source version from the latest published
  stable installer. Never label an unpublished source version as downloadable.
- Direct download discovery is progressive: the static page always links to the
  GitHub Releases fallback, then client-side code may replace it with the latest
  matching `.dmg`, setup `.exe`, or `.msi` asset.
- Remote AI stays optional, previewed, consent-gated, and clearly separate from
  the local-first workflow.
- Screenshots use fictional disposable sample data. No personal workspace or
  provider credentials enter public assets.
- GitHub Pages remains a marketing and documentation surface; it does not claim
  to host Voyalier’s local backend.

## Implementation sequence

1. Capture and normalize current runtime screenshots from a disposable backend.
2. Establish `design.md` and public tokens before page-level styling.
3. Build the reusable download deck and redesign the landing/download pages.
4. Restructure the README around download, product proof, trust, architecture,
   and expandable setup/troubleshooting sections.
5. Redraw the public SVG diagrams and regenerate the Open Graph image.
6. Validate source contracts, production builds, links, console, keyboard use,
   and 320/375/414/768/1440 responsive surfaces.
7. Run Graphify’s incremental update and a scoped public-surface query.
8. Run the mandatory two-round council: four independent reviewers per round,
   fix every blocker, and only then push the branch.

## Verification

- `git diff --check`
- `./scripts/check.sh`
- `pnpm --dir docs-site build`
- Hallmark’s 58-gate slop test after reading the contract and gate definitions.
- Browser proof at 320×812, 375×812, 414×896, 768×1024, and 1440×900.
- No horizontal overflow, wrapped primary affordances, broken internal links,
  unhandled download-fetch failures, or site console errors.
- Current screenshots visually inspected after capture.
- `graphify update .` followed by one scoped public-surface query.

## Commit and delivery discipline

The plan lands before implementation. Subsequent commits remain documentation
scoped and preserve unrelated work. The final push is to
`stay-calm-its-codex/public-surface-overhaul`; there is no merge, tag, release,
or deployment in this task.
