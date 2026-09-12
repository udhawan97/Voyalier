# Voyalier concierge journeys and product audit

## Scope and evidence

Research snapshot: September 12, 2026. Source baseline: `d43a863ed39013129f402e95efef42f7b467a273`, package version `0.11.1`. This is a planning artifact, not a release assessment or a personal immigration determination. No production data, passport numbers, account credentials, or original traveler documents were inspected.

The current trip screen was inspected in a disposable `VITE_MOCK=1` in-app browser. Obscura refused loopback navigation; Safari capture failed. The visible Kyoto fixture confirmed the screen hierarchy, long Journey Board, section navigation, preparation panels, and one-passport input. Its fixed mock clock is not evidence of today's date. Hawaii trip creation fields were exercised; the browser automation did not retain date-control input, so no successful Hawaii creation is claimed. The two route analyses below are researched scenario walkthroughs, not completed app journeys. Native Safari, installed Tauri, booking websites with dates applied, and production persistence were not accepted in this pass.

Graphify was queried first, then its pointers were checked against source. Older roadmap entries sometimes describe earlier states: use current source and the later amendments, not the first checked checkbox in the roadmap.

## Existing capability inventory

| Area                        | Current evidence                                                                                         | Planning implication                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trip creation               | `apps/web/src/views/CreateTripDialog.tsx`; `crates/voyalier-core/src/types.rs::Trip`                     | Origin, destination, title, dates exist. No structured party or per-person status in Trip. Add context; do not rebuild basic creation.                                                                      |
| Current cockpit             | `TripDetailView.tsx`, `TodayPanel.tsx`, `JourneyBoard.tsx`                                               | Today, chronological Board, Blueprint, planning, readiness and research already exist. The main opportunity is hierarchy and orchestration.                                                                 |
| Travel evidence             | `types.rs`, `amendment.rs`, `journey_board.rs`; `DocumentsPanel.tsx`                                     | Confirmed air/stay/surface-travel records, review, replacement/history and restore must survive the redesign.                                                                                               |
| Planning and personal taste | `planning.rs`, `suggest.rs`, `PlanningPanel.tsx`, `Recommendations.tsx`                                  | Saved places, activities/transfers, packing and food/culture/nature/nightlife/shopping weights exist. They are not live ratings.                                                                            |
| Visa preparation            | `visa.rs`, `visa_stats.rs`, `VisaPanel.tsx`; ADR-0006 and ADR-0014                                       | There is substantial preparation machinery, official-source navigation and user-owned progress. The current route API takes destination and one nationality, not residence, transport or four people.       |
| Documents                   | `ImportDialog.tsx`, `DocumentsPanel.tsx`, `resource.rs::ResourceKind`                                    | Import reads text/HTML/email; `ResourceKind::File` explicitly stores metadata only. A reusable encrypted PDF/image wallet is a real missing capability.                                                     |
| Research                    | `resource.rs`, `service_resources.rs`, `ResourcesPanel.tsx`                                              | Link saving, tags, notes, consented readable snapshots and search exist. Extend this, preserving the distinction from reservation evidence.                                                                 |
| Destination intelligence    | `DestinationFacts.tsx`, `WeatherOutlook.tsx`, `TravelAdvice.tsx`, `PublicHolidays.tsx`, `AboutPlace.tsx` | Currency/reference exchange rates, practical country facts, tipping, clocks, weather, holidays and advisory sources already exist. A budget is different from an FX reference widget.                       |
| Maps and places             | `packs.rs`, `MapPanel.tsx`, `CityPacks.tsx`                                                              | Four Hawaii island packs are declared. Montréal is absent from the current catalog. All catalog entries currently flag offline-map capability; that does not verify published assets or installed coverage. |
| Settings                    | `SettingsView.tsx`                                                                                       | Theme, locale, local AI, cloud provider setup, prompts, updater, vault, sources and backup already have a common home. They need grouping and clearer everyday controls.                                    |
| Local operation             | `AppService`, `AdviceFetcher`, `Records`, `SecretStore`; AGENTS.md                                       | Build through existing seams. Do not put crawlers, keys or product logic into the webview.                                                                                                                  |

## Visual observations and design judgments

The observed dark trip screen uses warm charcoal, cream serif headings, fine borders, pill actions and a large gradient cover. These agree with `packages/ui/src/tokens.css`: warm paper `#f3efe4`, ink `#1a1917`, slate indigo `#46536b`, vermilion `#c34e33`, Shippori Mincho display and Zen Kaku Gothic New body. Preserve the identity and its self-hosted fonts.

The following are design judgments, not measured usability-study outcomes:

1. The first viewport emphasizes Import/Add reservation and a mostly empty Today panel. A traveler who has not booked needs a destination/party summary and a concrete next planning action.
2. The Board repeats lodging across many dates above the deeper planning/research panels. A collapsed night-span and a selected-day view would improve scanability while keeping an expandable full chronology.
3. Plan/Prepare/Visa/Discover/AI jump links expose many features in one long document. Task views with a persistent trip context would reduce repeated scrolling. Preserve old anchors and exact-record handoffs.
4. Numerous explanatory paragraphs repeat trust boundaries. Keep necessary meaning close to the relevant decision, with concise status text and expandable source detail; measure comprehension before removing any warning.
5. Passport entry asks for an ISO country code. A searchable country/document picker with readable names is a straightforward improvement. The mixed-traveler case needs separate people, not four uses of one overwritten picker.
6. A large image or 3D scene alone would not solve these problems. Spatial design should explain where the traveler stays, how far activities are, and what remains to do.

## Hawaii scenario

### Inputs and unresolved choices

The planning window is November 30–December 14, with 2026 assumed. Four travelers; a mixed-status test party consists of an Indian passport holder with H-1B status, an Indian passport holder with U.S. permanent residence, and two people described as U.S. nationals. Citizenship versus non-citizen nationality remains unconfirmed. Ages, island, budget, rooms/beds, accessibility/diet and exact flights are unknown. Treat these as planning inputs, not inferred eligibility facts. Keep reusable test fixtures anonymous.

The date meaning needs to be visible. **Checking out on December 14 is 14 nights after November 30; arriving home in Chicago on December 14 may require a different final lodging night and departure date.** An overnight return must not silently add a night or change the promised return day. No flights or availability were searched for this party.

### Recommended choice architecture

Start with a comparison of Oʻahu, Maui, Kauaʻi and Hawaiʻi Island, linking the tourism authority's island descriptions. Offer a deliberately simple single-island plan and an optional two-island plan. Oʻahu is a reasonable _design-example default_ for a city/food/beach mix, not a declaration that it is best for this party. The tourism source describes distinct island experiences and airports; do not use “Hawaii” as one airport or one walkable map region.[^1]

| Example choice         | App output                                                                      | Decisions it must surface                                                              |
| ---------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Oʻahu only             | One accommodation search scope, day clusters, selected-day map                  | Neighborhood, car-needed days, sleeping arrangements, arrival/return times             |
| Oʻahu + Hawaiʻi Island | Separate destination segments, stay searches and an inter-island transport task | Split dates, baggage, second car/transfer, second check-in, flight time and extra cost |
| Island still undecided | Island comparison and saved preferences                                         | No silently selected airport, property, timed hike or weather forecast                 |

An illustrative split is seven nights + seven nights **only if the eventual flight and check-out dates support it**. It is a suggestion the traveler accepts, not a booking or a locked itinerary. Start with one main outing per day, meal suggestions nearby, free time and a weather alternative. Do not auto-fill fourteen days with paid activities.

### Entry and preparation

For a route entirely within the United States, use a domestic-travel preparation path rather than a new U.S.-entry visa application. Link TSA's accepted identification list; the indexed official page includes foreign-government passports. The direct TSA page could not be opened in this research tool, so recheck it in the target browser before publishing detailed ID copy.[^2] If a suggested route connects outside the United States, stop treating it as a domestic-only route and re-open transit/re-entry preparation. H-1B status and a visa stamp are distinct fields; do not create a domestic visa-renewal task based solely on an expired stamp.

Include an agricultural declaration task linked to Akamai Arrival and an “items to declare” resource. Hawaii DOT's December 2025 update says the digital declaration is live on all domestic flights, while some older state pages still describe the pilot. Preserve this source-date distinction and recheck the live portal before departure rather than embedding old pilot instructions.[^3]

### Stays, activities, food and transport

The accommodation brief should ask whether four travelers need two bedrooms, separate beds, two hotel rooms, a kitchen, laundry, parking, air-conditioning and an accessible route. Compare **whole-trip totals**, including known cleaning/resort/parking/tax lines; missing amounts remain unknown. Four guests are not automatically four adults, two couples or two rooms.

For Oʻahu, link the authority's vacation-rental directory and the provider-specific destinations in the companion provider research. Do not assume an Airbnb advertisement proves local rental legality. Attach the relevant county verification source to a chosen listing; a state tax identifier and local land-use permission are different checks. Rules must be verified for the actual property and trip dates.[^4]

Food suggestions can begin with poke, shave ice, malasadas and loco moco from the tourism authority, then link restaurants and source-native ratings. Ask diet/allergy preferences; no “safe for allergy” inference from a review. These are food ideas, not claimed best restaurants.[^5]

A Diamond Head outing needs its official park/reservation link. The park page states non-resident reservations are required. A reserved date, closure notice, trail conditions and the traveler’s ability are separate facts. Never label a trail safe merely because people rated it highly.[^6]

The cockpit should expose airport → stay, local transit, car-days, parking and inter-island transfers as separate tasks. Schedule suggestions must remain conditional until operator timetables and prices are checked. For other islands, reuse the same workflow with island-specific source packs; do not reuse Oʻahu's transport assumptions.

### End-to-end target walkthrough

1. Enter route/window/party; choose island or compare islands.
2. See a concise list of decisions: return-date meaning, accommodation setup, island choice and ID checklist for each person.
3. Pick an area; open an Airbnb search or destination page with a visible summary of filters transferred and filters still to enter. Keep Expedia/hotel/direct-property alternatives one action away.
4. Save two or three candidates with personal notes. A saved listing stays “Considering.” Record total cost and cancellation deadlines only from attributed terms or user entry.
5. Book on the provider website; return to import a confirmation. Review extracted facts before marking the trip record confirmed.
6. Link the stay to its segment; resolve uncovered nights and add arrival transport. Keep inter-island transport unbooked until evidence is imported.
7. Save local food and outings; add selected ideas to dated plans. For a reservation-required park, show an explicit booking task.
8. Build the money estimate, documents, packing and offline downloads. Near travel, explicitly refresh sources; far-future weather remains seasonal context rather than a daily forecast.
9. Travel-day view opens today's ticket/document, stay address, next transfer and offline map with source ages.
10. Changes to a confirmation go through existing amendment/restore history. A canceled activity creates an unresolved task; it does not silently rearrange confirmed travel.

## Montréal scenario

Dates and party are unconfirmed. Reuse the mixed-party composition only as an **acceptance fixture**, not as a claim that the same four people are traveling. Assume air travel Chicago → Montréal for the main walkthrough and test road travel separately.

### Per-person entry branches

IRCC's entry material makes citizenship/nationality, documents and travel mode relevant. Its current country page lists India among visa-required countries; H-1B status alone should not be interpreted as Canadian admission or automatic eTA eligibility. The U.S. permanent-resident branch is distinct. For air travel, official pages agree on carrying a valid passport/accepted equivalent plus valid proof of U.S. permanent residence; IRCC describes the eTA exemption. If the two U.S. nationals are U.S. citizens, use the citizen branch; otherwise confirm the travel-document category with the official checker.[^7][^8]

The product must ask about an existing valid Canadian visa before presenting a new application. Citizenship, visa, residence and employment status cannot be collapsed into one country dropdown. Selection of a sourced pathway remains a traveler decision, not Voyalier clearing entry.

**Source conflict to preserve:** the country-entry page currently says certain U.S. permanent residents entering directly by land/water need only valid status evidence, while the eTA eligibility page says passport plus status evidence for all methods. Do not silently combine these into one universal rule. The air-travel walkthrough avoids that conflict; a road-trip flow should display the discrepancy and link the current CBSA/IRCC guidance for confirmation.[^7][^8]

### Application journey, when the traveler selects the visitor-visa route

| Stage                   | What Voyalier should explain                                                  | Evidence or next action                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Confirm route           | Check nationality, residence, travel mode, purpose and already-held documents | Open the official checker; record the source and user's selected path                                          |
| Application channel     | Use the route-specific online instructions                                    | IRCC's apply page; personalized checklist takes precedence over a universal form list                          |
| Documents               | Passport/travel-document copy and the portal's required supporting material   | Check actual portal requirements and applying-from-country instructions; store checklist-to-file links locally |
| Submit                  | Review and submit in the official portal                                      | User completes application/payment externally; stores receipt or confirmation themselves                       |
| Biometrics if requested | Follow the instruction letter and book an authorized location                 | A U.S. applicant can use the official U.S. ASC/VAC route; do not equate this with a consulate appointment      |
| Additional requests     | Interview, medical or extra evidence only if requested                        | Import the request, its deadline and source; no automatic universal checklist item                             |
| Decision/passport       | Follow passport-submission instructions if approved                           | For online applications, approval instructions can precede insertion of the visa into the passport             |
| Return of document      | Check passport/visa returned and details match                                | “Decision received” and “travel document ready” remain separate user-reported states                           |
| Travel and U.S. return  | Recheck entry/transit and return documentation                                | Keep U.S. return as a separate branch; open relevant U.S. official sources                                     |

IRCC says application purpose determines documents and the online portal supplies a personalized checklist. Do not automatically force every online applicant through the paper Guide 5256/IMM forms merely because the existing curated guide names them.[^9] The biometrics page instructs applicants to book after receiving the instruction letter and describes U.S. collection channels.[^10] The after-apply page makes interviews/additional requirements conditional and says an online applicant cannot travel until the visa is placed in the submitted passport.[^11]

### Booking order

Separate **research now**, **application itinerary evidence**, **refundable hold/booking**, and **non-refundable purchase**. These have different risks and purposes. “Book flights first for every visa” and “no travel research until approval” are both poor defaults.

For the Canada visitor-visa example, recommend researching and saving options first, following the actual application checklist for itinerary evidence, and deferring non-refundable commitments until the required travel document is ready. That last sentence is a conservative product recommendation, not a claimed universal IRCC prohibition. Whether to purchase a cancellable booking remains a traveler choice with the refund deadline visible. Do not fabricate reservations or “dummy tickets.” eTA and other-country routes need their own authority-specific instructions.

For the H-1B fixture, add an explicit U.S. return-document review before non-refundable commitments. Automatic visa revalidation is an exception with conditions, not a default re-entry promise; link the State Department explanation and direct unresolved personal cases to qualified advice. No eligibility decision was made here.[^12]

### Destination experience

Offer three area briefs: Old Montréal for historic sightseeing, Plateau/Mile End for neighborhood cafés/food, and a central transit-oriented option for easy connections. These are editorial planning alternatives, not safety scores or universally best areas. Tourisme Montréal supplies neighborhood and food context.[^13]

Food discovery starts with Montréal bagels, smoked meat and poutine, with dietary alternatives; then open the actual business website and native review source. Avoid copying stale hours or declaring one shop the winner.[^14] Surface the STM 747 airport connection as an operator resource, with current route/fare/service information checked when the traveler opens it.[^15]

For a short-term stay, include the Québec tourist-accommodation registration resource. Show registration as a property-specific verification task, not a blanket endorsement of Airbnb, Expedia or any host.[^16] Build a Montréal pack through the existing pipeline, but report it unavailable until the actual pack/map downloads exist and pass integrity checks.

For dates not yet chosen, weather, festivals, opening hours, transport schedules and timed bookings remain unverified. A winter fixture should include cold-weather alternatives and route conditions; a summer fixture should not inherit winter advice. The feature must work without pretending the travel month is known.

## Sources

All accessed or searched September 12, 2026. Publication/page dates are included where observed. Live information must be rechecked at implementation and travel time. Search-index-only evidence is labeled.

[^1]: Hawaiʻi Tourism Authority / Go Hawaiʻi, [Hawaiian Islands](https://www.gohawaii.com/islands), current page; [Planning your first trip](https://www.gohawaii.com/content/first-trip-to-hawaii).

[^2]: TSA, [Acceptable identification](https://www.tsa.gov/travel/security-screening/identification), official search-index evidence; direct open failed during research. Detailed current copy needs browser re-verification.

[^3]: Hawaiʻi DOT, [Airport travel enhancements ahead of holiday season](https://hidot.hawaii.gov/airports/state-leaders-advise-residents-on-airport-travel-enhancements-ahead-of-holiday-season/), December 2025 indexed update; [Akamai Arrival portal](https://akamaiarrival.hawaii.gov/) is the official destination linked by the state, not a completed form test.

[^4]: Go Hawaiʻi, [Oʻahu vacation rentals](https://www.gohawaii.com/islands/oahu/accommodations/vacation-rentals), discovery directory, not proof of a listing's legality. County-specific registry verification remains a per-property prerequisite.

[^5]: Go Hawaiʻi, [Culinary experiences](https://www.gohawaii.com/culinary-experiences-in-hawaii), current indexed page.

[^6]: Hawaiʻi DLNR, [Diamond Head State Monument](https://dlnr.hawaii.gov/dsp/parks/oahu/diamond-head-state-monument/), official park page opened; no reservation purchased or dated availability verified.

[^7]: IRCC, [What you need to enter Canada](https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/entry-requirements-country.html), opened current page.

[^8]: IRCC, [eTA: Who can apply](https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility.html), page details August 6, 2026; opened. Land-travel discrepancy with source 7 explicitly unresolved.

[^9]: IRCC, [How to apply for a visitor visa](https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html), opened current page; [official route checker](https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/check-visa-eta.html), linked from official material.

[^10]: IRCC, [Where to give fingerprints and photo](https://www.canada.ca/en/immigration-refugees-citizenship/services/biometrics/where-to-give.html), opened current page.

[^11]: IRCC, [After you apply](https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/after-apply-next-steps.html), page details August 28, 2026; opened.

[^12]: U.S. Department of State, [Automatic revalidation](https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/visa-expiration-date/auto-revalidate.html), current official search evidence. See also [CBP I-94 help](https://i94.cbp.dhs.gov/help). This is a pointer to conditions, not a determination for an individual.

[^13]: Tourisme Montréal, [Plateau-Mont-Royal and Mile End](https://www.mtl.org/en/city/about-montreal/neighbourhoods/plateau-and-mile-end); [Montréal neighborhoods](https://meet.mtl.org/en/blog/montreal-neighbourhoods), official tourism pages.

[^14]: Tourisme Montréal, [Musts for foodies visiting Montréal](https://www.mtl.org/en/experience/musts-for-foodies-visiting-montreal), indexed publication May 2026; [Montréal bagel](https://www.mtl.org/en/experience/the-famous-montreal-bagel).

[^15]: STM, [747 airport routes, schedule and fares](https://www.stm.info/fr/node/206), official indexed result; route availability and fares were not tested for future dates.

[^16]: Gouvernement du Québec, [Hébergement touristique](https://www.quebec.ca/tourisme-loisirs-sport/hebergement-touristique), current government entry point. Do not turn the existence of a register into an app-certified legal conclusion.
