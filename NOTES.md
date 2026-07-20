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

## Planning language

- A recommendation remains a suggestion until the traveler explicitly saves it.
- A saved place belongs to a per-trip shortlist. Scheduling it is a separate,
  explicit promotion into a trip item.
- Trip item is the canonical term for a manual activity, rail journey, or
  transfer. It is traveler-authored planning data, not a confirmed fact.
- Packing suggestions are computed from evidence; packing items are traveler-owned
  checklist entries. Suggestions never add, check, rewrite, or delete items.
- Interest profile is the canonical term for the five persisted recommendation
  weights. Avoid persona when referring to stored trip data.
- New traveler-authored planning text follows the vault and encrypted-backup
  rules. Planning notes remain outside AI prompts.

## v0.5.0 delivery

- Ship saved places and interest profiles, packing checklists, a data-source
  register, workspace search, manual trip items, additional verified offline
  maps, and the first complete Spanish interface in one minor release.
- Implement as independent vertical slices with red-before-green tests at the
  confirmed public seams.
- Merge only after the full gate and two-axis review; publish only after exact-SHA
  CI, signed updater artifacts, checksums, live docs, and packaged-app checks.
