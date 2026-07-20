# Voyalier product brief

## Thesis

Voyalier is a private trip operating system. It turns fragmented research and confirmations into one trustworthy, actionable journey brief.

## Core user journey

1. Create a trip with origin, destination, dates, and preferences.
2. Receive an immediate deterministic Blueprint; fetch connected research only
   through an explicit action.
3. Review and save persona-aware recommendations without treating them as
   reservations.
4. Import confirmations and approve extracted facts.
5. Build an explicit packing checklist and add traveler-authored activities,
   rail legs, or transfers in a separate planning lane.
6. Resolve missing bookings, confirmed-plan conflicts, planning notices, and
   readiness actions.
7. Search every local trip with source provenance and use an offline Today view
   during travel.
8. Export a redacted brief, calendar, or encrypted workspace backup.

## Primary surfaces

Blueprint, Discover, Plan, Documents, Readiness, Search, Settings, and Share.

## Persona weights

Recommendations are shaped by five adjustable interest weights over a shared,
downloaded-pack candidate pool (per [ADR-0003](../architecture/ADR-0003-phase2-contract.md),
which replaced hard-coded named personas with tunable weights):

- Food
- Culture
- Nature
- Nightlife
- Shopping

Presets (Balanced, Foodie, Explorer) are just starting points for those weights.
Scoring is a transparent deterministic rule — not a model — and each pick keeps
its source, license, score, and reasons. Weights persist per trip; saving a place
snapshots its provenance, and only an explicit promotion creates a manual plan
item. Traveler constraints always override interest preference.

## MVP non-goals

- Booking or payment
- Universal cheapest-flight or best-hotel claims
- Unrestricted social scraping
- Authoritative immigration determinations
- Price prediction
- Real-time group collaboration
