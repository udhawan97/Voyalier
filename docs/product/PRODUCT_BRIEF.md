# Voyalier product brief

## Thesis

Voyalier is a private trip operating system. It turns fragmented research and confirmations into one trustworthy, actionable journey brief.

## Core user journey

1. Create a trip with origin, destination, dates, travelers, constraints, and preferences.
2. Receive an immediate deterministic Blueprint while source research continues in the background.
3. Review and save persona-aware recommendations.
4. Import confirmations and approve extracted facts.
5. Resolve missing bookings, conflicts, and readiness actions.
6. Use an offline Today view during travel.
7. Export a redacted brief, calendar, or encrypted trip bundle.

## Primary surfaces

Blueprint, Discover, Itinerary, Documents, Readiness, and Share.

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
its source, license, score, and reasons. Traveler constraints always override
interest preference.

## MVP non-goals

- Booking or payment
- Universal cheapest-flight or best-hotel claims
- Unrestricted social scraping
- Authoritative immigration determinations
- Price prediction
- Real-time group collaboration
