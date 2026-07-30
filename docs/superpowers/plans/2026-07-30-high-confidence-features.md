# High-confidence features (0.7.0)

`docs/roadmap/OPEN_DATA_FEATURE_CANDIDATES.md` closed 2026-07-29 with four candidates and four named
gaps still open. This plan takes seven of them. It does not take the two the roadmap still argues
against — Wikivoyage listings (#17) and Copernicus terrain (#18) — and the reason is unchanged from
2026-07-17: both are heavy pipeline work whose output cannot be verified from a working tree, and
neither has a seam to land on.

## What makes these high-confidence

Every item below either lands on a seam that already exists or changes no seam at all. That is the
whole selection rule. `DestinationFactsSnapshot` already absorbed astro, airports, heritage,
holidays and currency without a new gateway method, so golden hour and languages are fields on a
type the transports already carry. CO₂ is derived at read time from confirmed facts, like the astro
day beside it. Airport autocomplete widens an argument on a method that already exists.

Two items do move a contract. School terms extends the public-holidays snapshot with a second
network source, and the POI layer changes the pack schema and adds a license row. Neither adds an
`AppGateway` method, so `packages/contracts/parity/routes.json` does not move — which is what keeps
seven features inside one branch rather than seven.

The visa work moves no code shape at all. It is curation behind a gate that already exists.

## The seven

### 1 — Golden hour (`astro.rs`)

`compute_astro_day` already solves the NOAA sunrise equation for a solar altitude of −0.833°. Golden
hour is the same solve at +6°: the hour-angle at that altitude gives the instants the sun crosses it,
and the morning window runs sunrise → that crossing, the evening window the mirror. One extra
`cos_omega` evaluation, no new astronomy.

The polar branches are the whole risk. At a latitude where the sun never reaches +6° there is no
golden hour even though the sun rises, so the +6° solve can fail while the −0.833° solve succeeds.
That case yields `None` for both windows on a `Normal` day — it is not a polar state and must not be
reported as one.

### 2 — Languages (`facts.rs`)

`COUNTRY_FACTS` is a hand-written `const` table of 40 rows, not a generated extract, so this is data
entry rather than a pipeline change. Languages are carried as the country's official or nationally
recognized language names, which is a fact of the same kind as driving side and calling code — and
like them it is bundled, offline, and cannot go stale in a stored row because country facts are
resolved fresh on every read.

### 3 — Trip CO₂ (`airports.rs`, new `co2.rs`)

Both inputs already ship. Confirmed flights carry `departure_airport_iata`/`arrival_airport_iata`;
the bundled OurAirports table carries IATA plus coordinates but is only ever scanned by distance, so
`airport_by_iata` is the missing lookup.

The estimate is great-circle distance × a UK DESNZ/DEFRA per-passenger-km factor chosen by haul
band. It is labelled an estimate everywhere it appears, and a flight whose IATA codes are absent or
unknown contributes nothing rather than a guess — a trip with one unresolvable leg reports a partial
estimate and says so, rather than silently under-reporting. Factors are dated in the table and
carry a review note; DESNZ re-issues them annually.

### 4 — Airport autocomplete (`suggest.rs`, `service_packs.rs`)

`suggest_field_values` refuses every field except `address` and `propertyName`. Adding
`departureAirport`/`arrivalAirport` draws on the bundled table via a new `SuggestionSource::Airport`,
matching on IATA code and airport name. This is the roadmap's #5 gap and needs no gateway change —
the method, its route, and its Tauri command all already exist.

### 5 — Offline maps for the remaining twelve packs (`packs.rs`)

`offline_map_available` is hardcoded to four ids. It is read by `scripts/build-offline-map.mjs` off
the dumped catalog, so flipping it is what _enables_ building the other twelve — and it is also the
disclosure the download UI shows before a traveler commits to the payload.

That ordering is the only real risk here and it is a product risk, not a code one: between the merge
and the `packs.yml` run, the catalog promises twelve archives the `packs-v1` release does not have.
`get_offline_map` reads the descriptor out of the downloaded pack body, so a missing archive
degrades to no map rather than an error — but the disclosure would still have lied. The workflow run
is therefore part of this change, not follow-up work.

### 6 — School terms (`holidays.rs`)

OpenHolidays publishes school-holiday ranges for 34 countries through a keyless API. It extends the
existing public-holidays snapshot rather than adding a capability: same trip-window narrowing, same
dated-and-attributed snapshot, same staleness rule.

Two honest limits ship with it. Coverage is a subset of the countries public holidays already cover,
so the panel must distinguish "no school holidays in your window" from "this country is not
covered". And school terms are informational texture — busier trains, fuller museums — never a
readiness input.

### 7 — Third pack POI layer (`packs.rs`, `scripts/build-packs.mjs`)

A third layer beside places and articles: ATMs, pharmacies, toilets, drinking water, viewpoints,
from the same Overture query already running in the pack pipeline. It changes the pack schema, so
`parse_pack_content` must keep reading a two-layer pack — every pack already published is two-layer,
and packs are downloaded by travelers who have not upgraded.

The layer carries its own license row rather than inheriting the places layer's, following the
precedent the layer manifest already sets.

### 8 — Japan visa journey (`visa.rs`)

Read against MOFA on 2026-07-30. Three findings shaped the curation:

**Japan publishes no electronic authorization.** The entry paths that exist are exemption and visa.
JAPAN eVISA is an online _application channel_ for the same short-term-stay visa, and it is keyed on
the applicant's country of **residence**, not nationality — so it is a link inside the visa-required
journey, never an `EntryPath::ElectronicAuthorization`. Mapping it to one would have told a
British citizen resident in a non-eligible country that they have an authorization route they do not.

**Most of the exemption table is conditional.** Of the 74 countries and regions MOFA lists, eighteen
carry notes that make exemption conditional on passport type or on prior registration — ICAO
ePassport for one group, registration with a Japanese mission for Indonesia and Qatar, a personal ID
number for Taiwan, SAR/BNO passports for Hong Kong and Macao, MRP for three more, and an
old-version-passport rule for Uruguay. Every one of these resolves to `EntryPath::Unknown` with
official links, exactly as Canada's conditional list does. Note 8 is _not_ such a condition — it
governs extending a stay past 90 days, so those nationalities remain plainly exempt.

**Processing time is published and must not be quoted.** The MOFA index states an approximate
processing time and links a fees page. ADR-0006 forbids curated prose from carrying either, and the
existing test enforces it. Both are links.

ADR-0006 is amended in place: it currently reads as though Canada is the only curated destination.

## Order

Layer order per `AGENTS.md`, smallest blast radius first: the four core-only items (1–4), then the
catalog flag (5), then the two that move a contract (6–7), then curation (8). Each lands as its own
`Core:`/`Core+app:`/`Web:` commit, red-before-green, and the branch closes with `Merge:`.

`make check` is the gate. `pnpm audit --prod` and the credential grep are not in it and are checked
by hand. The `packs.yml` run happens after the merge, because it publishes off `main`'s catalog.

## Deliberately not taken

- **Wikivoyage listings (#17)** and **Copernicus terrain (#18).** Unchanged reasoning; both are
  pipeline projects whose result cannot be seen from here.
- **Pollen** on the weather seam. Europe-only, and it deepens the Open-Meteo dependency that
  `OPEN_DATA_FEATURE_CANDIDATES.md` §2 already flags as the largest single-provider exposure in the
  product.
- **Visa destinations beyond Japan.** Each one is a fresh reading of a fresh authority. Two in one
  branch would halve the attention each gets, and this is the highest-harm content in the app.
