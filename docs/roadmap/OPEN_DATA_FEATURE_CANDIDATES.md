# Open-data feature candidates

Researched 2026-07-17. Three research passes (app map, geo/content sources, transport/utility sources) plus one adversarial verification pass that re-checked licenses, live endpoints, and architecture fit. This is a **candidate list, not a commitment** — confidence means "can be built on free/open data within the current architecture," not priority.

Companion to [ROADMAP.md](ROADMAP.md). Ground rules every candidate was judged against (see [DATA_SOURCES.md](../data/DATA_SOURCES.md), [ADR-0003](../architecture/ADR-0003-phase2-contract.md)):

- Network only on explicit user consent, fetched Rust-side with identifying User-Agent, stored as a dated attributed snapshot.
- Static data bundles at build time or ships via the existing pack pipeline (GitHub Releases).
- Trust ordering holds: community/scraped data is informational only, never clears a readiness item.
- Every new gateway capability is a lockstep TS + Rust + mock + parity change — so candidates are grouped into **seams**, not one-off methods.

## Tier 1 — High confidence

| # | Feature | Data source | License | Notes |
|---|---------|-------------|---------|-------|
| 1 | **Multi-government advisory panel** (US + CA + DE beside existing UK) | US State Dept Consular Affairs JSON API (`cadataapi.state.gov/api/TravelAdvisories`); Canada `data.international.gc.ca/travel-voyage/index-alpha-eng.json`; Germany Auswärtiges Amt OpenData | US public domain; OGL-Canada; DL-DE (pin exact attribution) | Verified live, keyless, 2026-07-17. US WAF returns `[]` to anonymous UAs — the identifying-UA fetcher policy is load-bearing. Advisory level is embedded in the Title string. **Overturns ADR-0003's "US: link-only, no feed exists" — needs an explicit owner re-decision first.** |
| 2 | **CDC travel health notices** | `wwwnc.cdc.gov/travel/rss/notices.xml` (verified live) | US public domain | Titles + links only → readiness health chips with deep links. |
| 3 | **Currency snapshot card** | ECB daily reference-rate XML (keyless) or Frankfurter (keyless, self-hostable) | Facts; attribute ECB | Daily cached snapshot, offline conversion, cross-rates computed locally. Only ~30 EUR-cross majors — design a "no rate available" state. Label as indicative, not card/ATM rate. |
| 4 | **Day astro: sunrise / sunset / golden hour / moon phase** | Offline Rust crates (`practical-astronomy-rust`, `sunrise-sunset-calculator`) | MIT-class | Zero network, zero license surface. Cheapest real value on the list. |
| 5 | **Airport enrichment** (autocomplete, nearest airport, distances) | OurAirports CSVs, bundled | Public domain | Nightly-updated upstream. Decision needed: OurAirports vs mwgg/Airports as the *single* airport dataset (also feeds #13). |
| 6 | **Trip CO₂ estimates** | UK DESNZ/DEFRA 2025 conversion factors + great-circle distance from #5 | OGL v3 (commercial reuse explicitly OK) | Offline. Label as estimate; factors update annually (2025 cut flight factors materially — re-sync yearly). |
| 7 | **Offline map expansion to all packs** | `pmtiles extract` from Protomaps daily planet builds, rehosted on the app's GitHub Releases | ODbL produced work; OSM attribution | Protomaps docs explicitly endorse copy-to-own-storage (hotlinking discouraged). Extends the existing Nashville pattern; already on ROADMAP.md. |
| 8 | **World-Heritage badges** | Wikidata build-time SPARQL extract (P1435 = Q9259: name, coords, year, image) | CC0 | Do **not** use UNESCO's syndication feed — it is permission-gated. Wikidata route verified working from a plain fetcher. |
| 9 | **Weather deepening**: climate normals ("typical weather for these dates", "best time to visit"), UV + air-quality layers | Open-Meteo historical / climate / air-quality APIs (same provider as existing forecast) | CC BY 4.0 | Same seam, same terms → cheapest marginal contract change. ⚠ Non-commercial cliff, see below. Pollen coverage is Europe-only. |
| 10 | **Richer pack POI layers**: ATMs, pharmacies, toilets, drinking water, viewpoints, `opening_hours` | OSM/Overture data added in the existing pack build pipeline | ODbL (own layer manifest) | No live Overpass from user machines — its usage policy is hostile to distributed apps, and the pipeline route is cleaner. Layered per-license manifest precedent already exists in packs. |

## Tier 2 — Medium-high confidence

| # | Feature | Data source | License | Notes |
|---|---------|-------------|---------|-------|
| 11 | **Public holidays during trip** (+ school terms) | Nager.Date hosted API (keyless, advertises no rate limits); OpenHolidays API for school holidays (34 countries) | MIT code; OpenHolidays data claimed ODbL — verify before bundling | Nager self-hosting is sponsorware (license key required) — no clean exit if the free host degrades; snapshot caching mitigates. |
| 12 | **Country-facts card** (plugs/voltage, driving side, calling code, languages, currency, emergency numbers) | Wikidata P2853/P2884 build-time extract (193/193 sovereign-state coverage verified); mledoze/countries; Android AOSP emergency-number DB | CC0; ODbL (bundle as separate attributed data layer, don't bake into a permissive crate); Apache-2.0 | All bundled, fully offline. |
| 13 | **Dual-clock itinerary / jet-lag view** ("lands 07:10 local / 23:10 home") | IANA tzdb via `chrono-tz`/`jiff`; IATA→tz from the airport dataset; city→tz from GeoNames | Public domain; MIT/CC BY | Skip `tzf-rs` boundary polygons (tens of MB for a lookup the airport/city datasets already answer). Also fixes the `.ics` floating-time story. |
| 14 | **"About this place" cards** | Wikimedia REST page-summary + lead image, consent-gated per click, snapshot-stored | CC BY-SA display + attribution | Rate limits are a non-issue at consent-gated volume. Scope to places **outside** existing packs — pack cities already ship Wikivoyage prose; don't build a second prose pipeline for the same screen. |
| 15 | **Packing-list generator** | Offline rules over climate normals (#9) + trip facts | — | Feasibility trivial; risk is product quality (bad rules), not data. Depends on #9. Was on the old deferred list for scope, not data, reasons. |
| 16 | **Bundled offline gazetteer** for destination autocomplete | GeoNames `cities15000` (~3 MB) or `cities500` (~13 MB) | CC BY 4.0 | DATA_SOURCES.md forbids network autocomplete — a bundled gazetteer is the sanctioned fix, giving country/timezone/population per city. Complements (doesn't replace) the Open-Meteo geocode used for weather. |
| 17 | **Wikivoyage listings in packs**: See/Do/Eat/Sleep POIs with coordinates, "Stay safe"/"Get around" sections | Parse `{{see}}`/`{{do}}`/`{{eat}}`/`{{sleep}}` templates from the enwikivoyage dump (~130 MB compressed) in the pack pipeline | CC BY-SA 4.0 (display + attribution; not relicensing) | The messiest engineering job here — wikitext template parsing has a long tail of garbage. Keep it strictly pipeline-side. The old `wikivoyage-listings` extractor is dead (2020); parse the dump directly. |
| 18 | **Elevation / terrain for hiking days** | Copernicus DEM GLO-30/90 COGs from AWS Open Data (no auth), fetched per-region in the pack pipeline; Mapterhorn terrain PMTiles pair with the map stack | Copernicus free license, attribution | Prefer this over Open-Meteo's elevation API — no reason to re-couple a hiking feature to the non-commercial cliff. |
| 19 | **US weather alerts** | NWS `api.weather.gov` (keyless, UA required) | US public domain | Solid but US-only, which caps value. Fits the advisories seam. |
| 20 | **Tipping-norms card** | Hand-curated facts table sourced from Wikipedia / Wikivoyage prose | Facts in own words; cite sources | No maintained open dataset exists. Informational only; risk is staleness/cultural nuance — review annually. |

## Cut in the skeptic pass

- **Visa-requirement chip** (medium): passport-index scrapes (ilyankou repo is alive, updated 2026-02; imorte is a fork) carry MIT labels that cannot launder Arton Capital's underlying data rights; EU database right murky; wrong-visa harm is real. Link-only to official sources is the defensible shape.
- **Aurora outlook** (medium): NOAA SWPC data is clean public domain, but a full contract change for a sliver of trips fails cost/value. If ever: a field on the weather seam, not a capability.
- **Walking/driving route legs** (medium): FOSSGIS public OSRM/Valhalla instances are revocable community infrastructure — wrong dependency for a mass-distributed binary. Great-circle by default; self-host Valhalla if routing ever becomes core.
- **US flight-delay stats, BTS** (medium): public domain but the bulk-CSV + route-matching pipeline dwarfs the value of an "often delayed" chip.
- **GTFS transit awareness** (killed): Mobility Database catalog is genuinely CC0/keyless, but feed URLs rot, per-feed licenses are heterogeneous (some NC/registration-gated), and national feeds run to hundreds of MB — parsing that on a laptop to say "Tokyo has a metro" is disproportionate. **Salvage**: precompute a tiny per-city transit summary (modes, lines, airport links) in the pack pipeline.

## Cross-cutting decisions

1. **Seam grouping** (keeps contract-change cost sane):
   - *Advisories seam* (extends existing advice): #1, #2, #19.
   - *Weather seam* (extends existing weather): #9, #15 on top, aurora-if-ever.
   - *Bundled destination-facts card* (one new capability): #4, #5, #12, #13, #16 (+ #3 as its one small network fetch).
   - *Pack pipeline* (no gateway change beyond pack schema): #7, #8, #10, #17, #18, transit-summary salvage.
2. **Open-Meteo monetization cliff**: the free tier is non-commercial-only. Free beta with per-user consent-gated calls is compliant today; the moment the app charges money it is a commercial product regardless of whose machine calls — paid API or AGPL self-host required. DATA_SOURCES.md already prescribes this; treat it as a launch-blocking checklist item for any paid tier.
3. **ADR-0003 re-decision**: the US "link-only" decision rested on "no machine-readable feed exists," which is now false. Revisit explicitly before building #1.
4. **One airport dataset**: pick OurAirports (public domain, no tz column) + tz from GeoNames, or mwgg/Airports (MIT, has tz). Don't bundle both.
5. **Licenses screen**: shipping these means a consolidated in-app "Data sources & licenses" page covering public domain / CC0 / CC BY / CC BY-SA / ODbL / OGL / DL-DE attributions. The pack layer-manifest precedent generalizes.
