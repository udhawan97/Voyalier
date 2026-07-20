# Workspace notes

## Product

- Voyalier is a local-first, evidence-backed trip workspace for travelers and technical evaluators.
- The marketing site lives in `docs-site`; the application UI lives in `apps/web`.
- The primary marketing action is downloading the macOS or Windows desktop app.
- Product claims must stay bounded: Voyalier is not a booking agent and does not claim authority over visas, safety, health, prices, availability, or opening hours.

## Brand language

- Existing identity: a folded-route mark, deep indigo structure, and a vermilion waypoint.
- Existing design-system language: `Quiet Journey`, built around fold, space, waypoint, and breath.
- Confirmed evolution: `Quiet Wonder`—cinematic depth and motion without losing restraint, legibility, or trust.
- “Apple-level” means exceptional composition, typography, material detail, animation timing, and product storytelling; it does not mean copying Apple layouts or assets.

## Delivery

- Plan before implementation.
- Preserve accessibility, reduced motion, keyboard behavior, contrast, and 200% zoom.
- Verify the rendered site at desktop and mobile widths, then run the repository gate.
- Commit the implementation and merge it to `main` without absorbing unrelated working-tree changes.
