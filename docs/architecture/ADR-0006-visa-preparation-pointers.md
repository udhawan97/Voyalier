# ADR-0006: Visa preparation points at authorities, never speaks for them

- Status: Accepted
- Date: 2026-07-28

## Context

`AGENTS.md` forbids Voyalier from claiming authority over visas. `readiness.rs` has held an
`EntryRequirements` item at a permanent `NotChecked` since Phase 1 precisely so that nothing in the
product can imply an entry decision, and its header names the missing work: sourced readiness "must
be quoted from identified sources, never inferred here or by a model."

Travellers still have to do the work, and the work is where the errors happen. The errors are not
usually about the rules — they are about execution. A form filled in a browser instead of Adobe
Reader produces no barcode and gets rejected. A photo cropped to the national passport specification
fails the destination's digital specification. A bank balance funded last week reads as borrowed.
None of that is published as a requirement, because none of it is a requirement; it is the folklore
of getting through the process, and it is exactly what a first-time applicant lacks.

Two shapes were rejected. Fetching live entry rules is not available: `canada.ca` returns HTTP 403
to automated fetches and IRCC publishes no machine-readable feed, so the `AdviceFetcher` seam does
not apply. Asserting requirements from a curated table — fees, processing times, eligibility — was
rejected on the contract: it is the most useful-looking option and the one where a stale row costs a
traveller a fee or a trip.

## Decision

Voyalier ships **visa preparation**, not visa advice.

- **Every factual claim about a requirement is a link. Every sentence Voyalier authors is a
  translation of the authority's own term, or a caution about a common execution mistake.** This
  split is the binding constraint and is enforceable by review: a curated string that asserts a fee,
  a processing time, an eligibility outcome, or an amount of money is a defect.
- **Entry paths are quoted, not derived.** `EntryPathQuote` carries the authority's name, the page
  the list was read from, and a `curated_as_of` stamp. `EntryPath::Unknown` is a first-class result:
  for a curated destination that publishes conditions rather than an answer, the traveller gets that
  destination's official links and no journey. An **uncurated destination** yields no quote at all —
  there is no authority to name, and naming one anyway is the fallback this bullet forbids. See the
  2026-07-29 amendment.
- **High-value branches are asked, never answered.** Where an authority publishes a cheaper
  alternative path with moving eligibility — Canada's eTA-X list is the motivating case — Voyalier
  raises the question prominently and links the list. Raising it is worth more than the whole rest
  of the guide; answering it would be the exact overreach this ADR exists to prevent.
- **Curated data is compiled in and resolved fresh on every read**, following `tipping.rs`, so a
  corrected row never freezes into a stored snapshot.
- **Traveller progress is user-owned and never becomes evidence.** Following ADR-0005, a checklist
  row exists only after an explicit tick or note, exactly as `PackingItem` does.
- **Readiness is untouched.** `EntryRequirements` stays `NotChecked` forever and stays excluded from
  the overall rollup. It gains only a sub-line reporting the traveller's own count, attributed to
  the traveller in the same sentence: Voyalier has verified nothing.
- **Nationality is sealed at rest.** It is personal data, and traveller notes on visa documents will
  contain application numbers. Both go in `SEALED_COLUMNS` with read and write paths wired.

## Consequences

Voyalier can help materially with the highest-friction task in a trip without acquiring an authority
it has consistently refused. The value is concentrated in the folklore — the four high-value steps
in the Canada journey — which is durable in a way that fees and processing times are not.

The cost is that the guide reads less confidently than a competitor that simply states requirements,
and that adding a destination is genuine curation work rather than a data import. That is the
intended trade: the second destination journey is the test of whether the abstraction holds, and it
should be added deliberately.

Curated content carries a `language` tag and is English-only at first. The interface marks it up so
a non-English reader is not misled about what has been translated.

## Amendment (2026-07-29): an uncurated destination yields no quote

The original wording said "an uncurated pair yields official links and no journey" without
distinguishing an uncurated **pair** from an uncurated **destination**, and `entry_path` was
implemented to satisfy the sentence literally: every branch returned a quote, and the only curated
destination's authority filled in for the rest. A browser audit of 0.6.0 found a London → Tokyo trip
attributed to Immigration, Refugees and Citizenship Canada and linking canada.ca as "the official
source" — Voyalier speaking for an authority with no connection to the traveller's route, which is
the precise thing this ADR exists to prevent.

`entry_path` now returns `Option<EntryPathQuote>`, and an uncurated destination returns `None`, so an
`EntryPathQuote` cannot be constructed without a real authority behind it. The two branches that keep
their quote both have a curated destination and remain correct: a nationality whose conditions the
authority publishes rather than answers, and a malformed nationality code — in both, the named
authority genuinely governs the trip.

`VisaPrep.entryPath` was already optional, so the wire contract is unchanged and no version of it is
broken. The interface gains a state that says an authority has not been curated for this destination,
and offers no link where it has none to offer.
