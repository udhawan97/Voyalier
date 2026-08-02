# ADR-0013: City-pack selection preserves source confidence

Status: accepted, 2026-08-01

Supersedes nothing. Extends the city-pack failure posture in
`docs/architecture/MAPS.md`.

## The gap

The pack builder currently runs one Overture query for every city, applies an
unordered `LIMIT 800`, and then splits the surviving rows into places and
amenities. That makes the file technically valid while undermining both layers:

- an unordered limit cuts on provider scan order, so the selected rows can
  cluster in one part of the bounding box rather than represent the city;
- ordinary places consume the shared budget before sparse practical amenities
  can reach it; and
- the query can retrieve the provider's confidence value to choose rows, but
  the pack model has nowhere to retain it.

The last point is a trust-boundary problem. Provider output is untrusted, but
when Voyalier uses provider confidence it must preserve that value rather than
turning it into an invisible implementation detail.

## Decision

The builder issues two bounded queries against the same Overture release and
city bounding box:

1. Traveler-relevant places use a documented category allowlist and their own
   limit.
2. Practical amenities use the existing closed category-to-`AmenityKind` map
   and a separate, smaller limit.

Both queries order by provider confidence descending before applying the
limit. Name, provider category, latitude, and longitude complete the order so
two runs over the same source data serialize the same visible rows in the same
order. The category predicate is shared verbatim between the generated SQL and
the JavaScript behavior test.

`PackPlace` and `PackAmenity` gain an optional `sourceConfidence` field.
Newly built packs retain a finite Overture confidence value when one is
present. Existing downloaded packs remain readable because a missing field
deserializes as `None`. Persona recommendation score remains a separate value:
it says how a place matches traveler-selected interests, not how strongly the
provider's sources agree that the place exists.

A city query that yields no valid places stops publication. An empty amenity
query warns and continues because a valid city can legitimately have no mapped
amenity in this small closed set, while the successful place query already
proves the release and bounding box were readable.

## Why the category lists remain separate

The pack allowlist and the deterministic persona ranker answer different
questions. The pack decides what is worth carrying offline; the ranker decides
what can be scored against five interest dimensions. Accommodation belongs in
the pack because it feeds property-name suggestions, but it has no honest
persona dimension. Practical amenities belong in their own layer and never
compete for the place budget.

The two lists therefore remain intentionally distinct. Tests pin representative
overlap and representative differences so a future edit cannot make one a
silent accidental copy of the other.

## What this deliberately does not do

- It does not publish or replace any `packs-v1` asset. Source integration and
  release publication remain separate gates.
- It does not choose Overture's latest release automatically. A moving input
  would make an unrepeated build change silently; the existing explicit release
  input and loud stale-release failure remain.
- It does not migrate Overture taxonomy fields in the same repair. Provider
  taxonomy evolution needs its own fixture-backed migration and a current
  source audit rather than an opportunistic query rewrite.
- It does not use provider confidence as a readiness claim or persona score.
  The value is retained as provenance and used only to make a bounded source
  selection deterministic.

## Consequences

- Pack JSON gains backwards-compatible optional fields and the Rust parser must
  test both old and new shapes.
- The publisher makes one additional Overture query per city and may produce a
  larger amenities layer. The limits remain explicit and configurable.
- Category eligibility is a maintained provider rule. Adding or removing a
  category requires a builder test and a changelog explanation.
- A valid but empty place result becomes a failed publication instead of a
  downloadable pack that looks healthy and ranks nothing.
