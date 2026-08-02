# Multi-modal itinerary and continuity — implementation plan

ADR: `docs/architecture/ADR-0016-the-itinerary-is-multi-modal-and-its-fragility-is-advisory.md`.
Branch: `claude/voyalier-inspiration-k8yy3z`, closed with `Merge: multi-modal itinerary and continuity`.

Four features, taken as inspiration from a competing booking agent's feature list and
translated into this product's terms (see the ADR's Context for the reading). Commits land in
layer order; each step's tests are written with its code.

Order is deliberate: the evidence model widens first, so every rule written after it is written
once, over all six fact types, rather than written for flights and then widened.

## 1. `Core:` surface transport facts (types.rs, facts.rs, parser.rs)

- `FactType` gains `RailJourney`, `CoachJourney`, `FerryCrossing`, `CarRental`.
- `FactPayload` gains `carrier_name`, `service_number`, `departure_place`, `arrival_place`,
  `vehicle_description`. Airport IATA fields stay flight-only (ADR-0016 §1).
- `FactPayload::journey_field_paths()` / `car_rental_field_paths()` beside the existing two.
- `validate_fact_payload` dispatch: journey timestamps must parse. An **inverted** pair is
  deliberately _not_ rejected — a flight has never rejected one, an overnight sleeper
  legitimately reads that way, and the itinerary checks report it as an advisory finding rather
  than blocking the traveller from recording what their ticket says. Car rental reads the same
  pair as pickup/drop-off.
- `FactLabel` gains `JourneyService { mode, service }`, `JourneyRoute { mode, from, to }`,
  `Journey { mode }`, `RentalCompany { company }`, `Rental`; new `TransportMode` enum
  (`rail | coach | ferry`) so one label family covers three fact types.
- Parser: JSON-LD `TrainTrip`/`BusTrip`/`BoatTrip`/`RentalCarReservation` → candidates, plus
  fixtures under `crates/voyalier-core/fixtures/parser/` (one well-formed per mode, one
  malformed).
- Downstream exhaustive matches, each a compile error until handled: `itinerary.rs` (journey
  overlaps join flight overlaps; lodging gaps unchanged), `today.rs` (departure/arrival items
  for journeys, pickup/return for rentals), `brief.rs`, `search.rs` (`fact_search_text`,
  `fact_identity`), `readiness.rs`, `packing.rs`, `chat.rs`, `assist.rs`.
- Goldens: `assess-trip.json` gains journey-overlap cases with the count pins bumped in both
  `tests.rs` and `parity.test.ts`.

## 2. `Core:` the disruption playbook (contingency.rs)

- `build_disruption_plan(trip, facts, items) -> DisruptionPlan`, IO-free, deterministic.
- Internal `Leg` abstraction over confirmed facts (flights, journeys, rentals) and timed trip
  items, so the rule is written once per ADR-0016 §2.
- `Handoff { from, to, kind, slack_minutes, band }` wherever one commitment follows another.
  Both times must parse or no handoff is emitted. **Revised while building:** the lodging
  hand-offs in this line were dropped and the hire car's two ends took their place — see the
  ADR's amendment for why a stay cannot yield a figure in minutes.
- `HandoffBand` = `Tight | Short | Comfortable | Ample`, from fixed thresholds that differ by
  handoff kind (a flight→flight connection is not a check-out→train walk).
- `ExposedLeg` — a leg with downstream dependents and the least slack among them; carries how
  many commitments sit behind it.
- `FallbackPointer` assembled only from workspace data (ADR-0016 §3): the carrier named on the
  traveller's own confirmation, embassies from `missions`, alternate airports from `airports`,
  the traveller's own documents.
- Tests: slack arithmetic across midnight and across a date boundary; unparseable time yields
  no handoff; a same-minute handoff is `Tight`, not negative; ordering is stable; a plan over
  an empty trip is empty, not an error; **no pointer carries a URL that is not already in the
  workspace or the bundled tables**; the plan never appears in `TripAssessment`.
- `TripDetail.disruption_plan` — derived on read, `skip_deserializing`, like
  `flight_emissions`.

## 3. `Core:` the re-check diff (recheck.rs)

- `diff_advisory_panel(old, new)`, `diff_weather(old, new)`, `diff_alerts(old, new)` →
  `Vec<RecheckChange>`; deterministic, IO-free, both languages agreeing via a new
  count-pinned golden `recheck.json`.
- `RecheckSource` = `Advisories | Weather | Alerts`; `RecheckOutcome` =
  `Skipped { fresh_until } | Unchanged | Changed(Vec<RecheckChange>) | Failed { reason }`.
- Staleness windows reuse the existing per-source constants rather than inventing new ones.

## 4. `App:` service wiring

- `get_trip` derives `disruption_plan` beside `flight_emissions` — no table, no migration.
- `recheck_trip(trip_id) -> RecheckReport` in a new `service_recheck.rs`: for each in-scope
  source, skip if fresh, else fetch through the injected `AdviceFetcher`, diff against the
  stored snapshot, store only on success. A failure keeps the old snapshot and is reported.
- Tests: `FakeFetcher` success/failure/offline; a failed source keeps its snapshot and never
  reads as unchanged; a fresh source is skipped without a fetch; the report is not persisted.

## 5. `Contract:` the parity train

- `recheckTrip(tripId)` POST `/api/v1/trips/{tripId}/recheck`, command `recheck_trip`,
  payload `{"command":["tripId"],"body":null,"query":[]}`.
- Every stop: `AppService`, server route + handler, desktop command + input struct +
  `generate_handler!`, `index.ts`, `mock.ts`, both web gateways, `routes.json` row +
  `counts.shared` 82→83, `routeParity.test.ts`.
- Widened types in `index.ts` + `mock.ts`: `FactType`, the journey/rental payload interfaces,
  `FactLabel`, `DisruptionPlan`, `RecheckReport`. `mockFieldCoverage` must populate every new
  optional field — the mock drives a trip with a rail leg and a tight connection.

## 6. `Web:` the surfaces

- `PlanningPanel`/`AddFactDialog`/`FactPayloadForm`/`CandidateReviewDialog` learn the four new
  fact types; `format.ts` gains their labels; all strings through `t()` with new catalog keys
  in English and Spanish.
- New `views/DisruptionPanel.tsx` — handoffs by tightness, exposed legs, pointers. Advisory
  voice per ADR-0016 §2: no reassurance, no proposed alternative.
- New `views/RecheckPanel.tsx` — one button, the consent sentence naming the hosts, and the
  per-source outcome list.
- `views/TripCover.tsx` — **revised while building.** The `place_summary` snapshot turned out to
  store an article's text and URL, not its lead image, so there was no imagery in the workspace
  to use; and a separate titled block duplicated the `<h1>` and tripped axe's `landmark-unique`.
  What shipped is a backdrop behind the header that already exists, washed in a hue derived from
  the destination's name. No fetch, no source, no attribution, no second heading.
- Tests flat in `apps/web/src/`, named by feature: `disruptionPanel.test.tsx`,
  `recheckPanel.test.tsx`, `tripCover.test.tsx`, `multiModalFacts.test.tsx`.
- Reduced-motion, keyboard, contrast and 200% zoom preserved; the cover is decorative and
  carries no keyboard trap.

## 7. `Docs:` release discipline

- `CHANGELOG.md` Keep a Changelog entries, user-facing prose.
- Version hand-synced across the five files, `cargo update --workspace` after the bump.
- `docs/roadmap/ROADMAP.md` and `docs/product/PRODUCT_BRIEF.md` note the widened evidence
  model; `CONTEXT.md` gains the playbook's vocabulary.

## Out of scope, stated

- No booking, holding, pricing, or availability check of any kind.
- No curated carrier contact table (ADR-0016 §3 records why).
- No background monitoring, timer, or notification channel.
- No delay prediction.
- The companion-export idea (the local-first answer to group messaging) is **not** in this
  plan. It is the largest of the four takes, it touches the backup container format, and it
  deserves its own ADR.
