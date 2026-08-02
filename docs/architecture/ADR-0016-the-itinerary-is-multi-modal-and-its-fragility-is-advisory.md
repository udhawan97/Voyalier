# ADR-0016: The itinerary is multi-modal, and its fragility is advisory

- Status: Accepted
- Date: 2026-08-02

## Context

A widely shared screenshot of a competing travel app (AVARA) lists its capabilities: book
flights, trains, buses, ferries and rental cars; monitor trips in real time; suggest backup
routes; group messaging. Read against `docs/product/PRODUCT_BRIEF.md`, that list is almost
exactly this product's non-goals — "Booking or payment", "Real-time group collaboration" —
and `AGENTS.md` opens by forbidding an autonomous booking agent.

The list is still worth reading, because three of its four items name a traveller need this
workspace answers badly or not at all:

1. **The evidence model is aeroplane-shaped.** `FactType` is `FlightSegment | LodgingStay`.
   Meanwhile `TripItemKind` has carried `Rail` and `Transfer` since 0.5.0, so the
   traveller-authored lane already assumes the trip has surface legs while the evidence lane
   cannot record the confirmation for one. A Eurostar reservation is imported as a document
   and then has nowhere to go.
2. **Nothing in the tree looks forward at fragility.** `ItineraryConflictKind` reports
   overlaps and uncovered nights — states that are already wrong. No rule asks the question a
   traveller actually asks the night before: _how much slack does this connection have, and
   what falls over if this leg slips?_ A grep for connection/layover/buffer/contingency logic
   across `voyalier-core` returns nothing.
3. **Snapshots go stale silently.** Advisories, forecasts and alerts each carry a retrieval
   stamp and a staleness window, and each is refreshed one panel at a time by a traveller who
   has to remember which ones they last looked at. There is no way to ask "what changed?".

None of those three needs booking, an agent, a server, or a background daemon.

## Decision

Four decisions, recorded together because they ship together.

### 1. Confirmed facts extend to surface transport. This is evidence, never booking.

`FactType` gains `RailJourney`, `CoachJourney`, `FerryCrossing`, and `CarRental`. A confirmed
fact remains what `CONTEXT.md` says it is — a thing the traveller explicitly approved, carrying
its evidence lineage. Recording that a ferry crossing exists is the same act as recording that
a flight exists. Nothing here reserves, prices, holds, or checks availability for anything, and
no code path acquires an opinion about whether a service runs.

The four share one payload shape rather than getting four of their own: `carrierName`,
`serviceNumber`, `departurePlace`, `arrivalPlace`, on top of the existing
`departureLocal`/`arrivalLocal`/`confirmationCode`/`passengerName`. `CarRental` adds
`vehicleDescription` and reads pickup/drop-off through the same departure/arrival pair, because
a hire car is a timed journey between two places like the rest. Places are free text, not
codes: there is no IATA for a bus stop, and inventing a code space this product does not own
would be a claim about identity it cannot back.

**Airport codes stay flight-only.** `departureAirportIata`/`arrivalAirportIata` keep their
meaning, so the carbon estimate, the nearest-airport lookup and the unrecognised-airport-code
warning are untouched by this change and cannot be confused by a rail station.

Adding variants to a wire enum is additive but not free: a reader that has never heard of
`ferry_crossing` must not silently mis-read it. Both languages fail closed — Rust's
`FactType` is exhaustively matched with no catch-all, so a new variant is a compile error at
every decision point, and the TypeScript union widens in the same commit as its consumers.

### 2. The disruption playbook states exposure. It never states availability.

A new IO-free core module derives, from the confirmed facts and traveller-authored items
already in the trip, a **handoff** wherever one commitment must be met after another: leg to
leg, arrival to check-in, check-out to departure. Each handoff carries the slack between the
two in minutes and a band naming how tight that is. From those it derives which legs carry
downstream weight, and what a given slip would reach.

Three limits are load-bearing, and each is asserted by a test:

- **It never proposes an alternative service.** It does not know, and must not imply it knows,
  that another sailing exists, that a seat is free, or that a route is possible. It reports the
  traveller's own exposure over the traveller's own evidence. "Backup route" as a competitor
  means _here is another way_; here it means _here is what you would need to replace, and how
  long you would have to do it_.
- **It never enters the readiness rollup.** Like entry requirements under ADR-0006, it is
  advisory. A tight connection is not an error — some travellers book them deliberately — and
  a plan-completeness status must not turn amber because of a choice.
- **It is offline and deterministic.** No network, no model, no prediction. It never says a
  leg is _likely_ to be late; there is no delay-probability dataset here and the skeptic pass
  in `OPEN_DATA_FEATURE_CANDIDATES.md` already refused the one that exists (BTS) on
  cost/value grounds. Slack is arithmetic over times the traveller confirmed.

Handoffs are only derived between legs whose times both parse. A missing time yields no
handoff rather than an assumed one — the same rule the itinerary checks already follow.

### 3. Fallback pointers come from the workspace's own data. No carrier table is curated.

The obvious way to answer "who do I call" is a curated table of carriers' rebooking pages,
in the ADR-0006 link-only shape. **Rejected.** That shape works for entry authorities because
a government's own domain is stable and there are a few hundred of them; airlines, rail
operators, coach lines, ferry companies and hire firms number in the thousands, rebrand and
merge constantly, and the failure lands on someone standing in a terminal at 23:00. A stale
row there is worse than no row, and this product would be asserting a contact channel it has
no way to verify.

So the playbook's pointers are assembled only from material already present and already
attributed:

- the carrier **named on the traveller's own confirmation**, with the plain observation that
  the reachable number is on that confirmation — which is true, current, and not ours to get
  wrong;
- the traveller's own embassies and consulates from the bundled `missions` extract, under the
  same "somewhere to confirm, never somewhere to travel to" framing ADR-0008 set;
- alternate airports from the bundled `airports` table, by great-circle distance, labelled as
  geography rather than as a route;
- the traveller's own documents and saved resources.

Everything above already exists, is already licensed, and is already framed. The playbook adds
no new source and no new authority.

### 4. Re-checking is an explicit sweep that states its diff. It is not monitoring.

One user-initiated `recheckTrip` refreshes the trip's **stale** consent-gated snapshots and
returns a per-source report of what changed. There is no timer, no daemon, no background
thread and no wake-up: the click is the consent, exactly as it is for each panel today, and
the report names every host that was contacted.

Scope is the three sources with both a staleness clock and a change worth stating: the
advisory panel, the weather outlook, and US weather alerts. Destination facts, holidays,
place summaries and visa statistics are deliberately excluded — a bundled-fact snapshot does
not change under the traveller, and widening the sweep would mean contacting hosts the
traveller did not have in mind when they clicked.

The diff itself is a deterministic core rule over the old and new snapshots, so what counts as
a change is testable and identical in both languages. A source that is already fresh is
reported as skipped rather than silently refetched; a source that fails is reported as failed
and **keeps the old snapshot**, because a failed re-check must never read as an all-clear.
`RecheckReport` is transient — it is returned, rendered, and never stored, so an answer can
never be retrieved later as established knowledge (the rule 0.7.0's chat transcripts already
follow).

## Consequences

- Four new `FactType` variants mean four new payload validators, parser support, and a
  widened `FactLabel`; every exhaustive match in `voyalier-core` is a compile-time checklist
  of the places that had to change.
- The playbook and the re-check report are both **derived** — the playbook onto `TripDetail`
  alongside `flightEmissions` and `timeDifference`, the report as the return of one new
  gateway method. Neither adds a table, a migration, or a sealed column.
- `recheckTrip` is one new row in `packages/contracts/parity/routes.json` and the full
  lockstep train of ADR-0012.
- The product gains a surface that talks about things going wrong. The wording rule from
  ADR-0006 applies: state what the evidence says, caution where it is silent, and never
  reassure. "Your connection has 45 minutes" is a fact. "You'll be fine" is not ours to say.

## Alternatives considered

**Book, or hold, anything.** Refused by the product contract, and not a close call.

**Live inventory to propose real alternatives.** Requires licensed GDS access, a commercial
agreement, and a per-user network path — every one of which contradicts local-first, and the
first of which is already parked under "Later" in the roadmap.

**Background monitoring.** A daemon polling advisories for an active trip is the natural
reading of "monitor trips in real time". It needs a process that outlives the window, a
network path the traveller is not present for, and a notification channel — three privacy
commitments this product has not made. The explicit sweep gets most of the value for none of
that.

**Delay prediction.** Refused above: no bundleable dataset, and a probability rendered next to
a traveller's real connection would be read as a promise.
