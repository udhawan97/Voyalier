# ADR-0014: Visa statistics are read live from the authority, never bundled

- Status: Accepted
- Date: 2026-08-02

## Context

ADR-0006 rejected two shapes for visa facts: fetching live entry **rules** (canada.ca 403s
automated fetches; no machine-readable feed) and asserting requirements from a curated table —
"fees, processing times, eligibility" — because a stale row costs a traveller a fee or a trip.
Both rejections hold. But travellers plan around one number the authorities themselves publish
and update continuously: how long decisions are currently taking. The cockpit redesign
(2026-08-02 spec) needs that number without acquiring the authority ADR-0006 refuses.

The repo already ships the trust shape for exactly this: `TravelAdvice` fetches FCDO pages on
explicit user action, stores a dated copy, displays it verbatim with source, retrieval stamp,
licence attribution, visible failure states, and an age-based staleness warning. Nothing about
that shape is specific to safety advice.

## Decision

Four decisions, recorded together because they ship together.

**1. The `AdviceFetcher` seam now applies to published visa _statistics_ pages — never rules.**
`voyalier-core::visa_stats::published_times` owns the endpoint URLs and parser dispatch
(ADR-0008), takes an injected fetch, and returns a `VisaStatsSnapshot` quoting the authority's
own rows verbatim: source name, source URL, attribution/licence, retrieved-at, and the source's
own published-as-of date where it exposes one. Fetching happens only on an explicit user action
whose consent sentence names the host and the payload (nothing about the traveller leaves the
device — the page is the same for everyone). Numbers are **never bundled**: a curated string
asserting a processing time remains a defect under ADR-0006's build-failing scan, which now also
runs over the universal playbook's prose. The fallback ladder is fetched → kept copy (stamped
and age-marked past the advice staleness window) → link-only. `Fetched` provenance describes
only the direct return of a successful refresh; anything served from storage is `KeptCopy`.
Where an authority blocks automated reading (canada.ca's documented behaviour), the card says
so and links the page — an honest first-class state, not an error.

**2. Storage is one destination-keyed table, deliberately outside the trip registry.**
`visa_stats_snapshots (destination_iso2 PRIMARY KEY, payload_json, retrieved_at)`, appended as
migration step 17, retry-safe. The authority publishes one table per destination, so the row is
shared by every trip there; the traveller's nationality only highlights a row at render time and
is never stored here — nothing in the table is personal, so nothing is sealed. No
`ON DELETE CASCADE`: a snapshot outlives the trips that fetched it, a small retention footprint
("this device once researched CA") accepted knowingly; a destination edit re-resolves the
lookup key, which satisfies the intent of RETRIEVED_SNAPSHOTS invariant 5 without a
trip-scoped copy.

**3. Two rows join the data-source register.** IRCC processing times (`ca-ircc`) and UKVI
decision waiting times (`uk-ukvi`) are consent-fetched network sources and therefore
user-facing surface: `packages/contracts/parity/data-sources.json` gains both rows and its
pinned count moves 23 → 25, asserted from both languages. They are distinct endpoints from the
existing `ca-gac` and `uk-fcdo` advisory rows.

**4. The readiness self-report counts whichever guide renders.** `VisaSelfReport` previously
counted curated-journey steps only; with the universal playbook, a traveller on an uncurated
route also ticks steps, and the readiness line reports those the same way — attributed to the
traveller in the same sentence, verified by no one. A behaviour change with no wire change,
recorded here so it does not ship silently.

## Consequences

The cockpit can show the one number travellers actually plan around, in the same trust shape as
travel advice, without Voyalier ever authoring it. The cost is parser fragility against two
authorities' page shapes — contained by fixture-tested pure parsers, the kept-copy ladder, and
the rule that a parse failure is a visible fetch failure, never a silent fallback. Canada may
refuse automated reads in practice; the unfetchable state is designed in, so the feature
degrades to exactly what ships today (a link) rather than below it. The US State Dept parser is
deferred; JP/AU/NZ/KR/US ship `fetchable: false` with official links. Trend history is out of
scope — the table is overwrite-on-refresh, and keeping history is future work this key shape
does not block.
