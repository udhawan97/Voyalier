# Data-source policy

Every adapter and stored source snapshot must record:

- provider and canonical source URL;
- retrieval time and, when known, validity window;
- license and required attribution;
- caching, redistribution, and deletion restrictions;
- content hash and parser version;
- source class and confidence;
- whether the data may be sent to a model.

## Initial research candidates

| Purpose             | Candidate                                              | Foundation posture                                                              |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Places              | Overture, OpenStreetMap, Wikidata, Wikivoyage          | Evaluate licenses and attribution per field                                     |
| Maps                | MapLibre and self-hosted/regional PMTiles              | Avoid dependence on public tile infrastructure                                  |
| Weather             | Open-Meteo                                             | Non-commercial/open-source terms; self-host or contract before commercial scale |
| Advisories          | Government feeds and content APIs                      | Official source cards with citizen-context labels                               |
| Disasters           | GDACS and official geological feeds                    | Action cards, not an opaque aggregate score                                     |
| Health              | WHO outbreak information                               | Official source and date required                                               |
| Flights/hotels      | Sandbox or approved partner adapters                   | Never claim comprehensive live inventory without a contract                     |
| Community sentiment | Approved APIs, user-provided links, or licensed search | No unauthorized scraping or bulk retention                                      |

`Not checked` is a first-class state and must never be collapsed into `Clear`.

The product-visible register is
`packages/contracts/parity/data-sources.json`. Rust and React tests pin its row
count, identifiers, category, canonical URL, endpoint, license/attribution text,
and authority boundaries so the Settings screen cannot drift from the
repository policy below. The v0.5.0 register contains 20 entries grouped exactly
as built-in data, consent-fetched sources, offline downloads, and optional AI;
the UI renders those four groups from the same file.

Offline map slices use an exact dated Protomaps Basemap PMTiles build clipped to
the selected catalog bounding box. Every catalog pack is an enabled target; the
publisher steps the zoom down per pack until the archive fits under the size
cap, so a large bounding box costs detail rather than failing the run.
Pack metadata records the canonical build URL, retrieval time, ODbL-1.0
identifier, OpenStreetMap contributor attribution, byte length, zoom range, and
SHA-256. The client accepts only the trusted Protomaps HTTPS origin and verifies
the bytes before exposing bounded local range reads to MapLibre.

## Fetched official sources

Every source below is keyless, fetched Rust-side on an explicit user click, and
stored as a dated snapshot with its attribution. None may be sent to a model.
Source class for all of them is `official`; CDC notices are informational and
never clear a readiness item.

| Provider                                      | Endpoint                                                      | Licence / attribution                                                    | Notes                                                                  |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| UK Foreign, Commonwealth & Development Office | `www.gov.uk/api/content/foreign-travel-advice/{slug}`         | Open Government Licence v3.0                                             | Per-country page; curated slugs only                                   |
| U.S. Department of State                      | `cadataapi.state.gov/api/TravelAdvisories`                    | Public domain (U.S. Department of State)                                 | Full list, selected locally. **Returns `[]` to anonymous User-Agents** |
| Government of Canada — Global Affairs Canada  | `data.international.gc.ca/travel-voyage/index-alpha-eng.json` | Open Government Licence – Canada                                         | Full list keyed by ISO-3166-1 alpha-2                                  |
| Auswärtiges Amt (Germany)                     | `www.auswaertiges-amt.de/opendata/travelwarning`              | Auswärtiges Amt OpenData (Datenlizenz Deutschland – Namensnennung – 2.0) | German-language; shown untranslated                                    |
| U.S. CDC travel health notices                | `wwwnc.cdc.gov/travel/rss/notices.xml`                        | Public domain (U.S. CDC)                                                 | Informational chips, matched to the destination by name                |

Advisory levels are **source-native**. Each government's wording renders on its
own card, verbatim; levels are never compared, merged, or ranked across
governments, and no government's advice is translated. A source that cannot be
reached shows as such — its previously stored copy is kept and labelled, never
silently refreshed or blended with another government's.

## Fetched reference data

Keyless, fetched on an explicit click, stored as a dated snapshot; not
`official` source class (convenience, never a safety claim). Not sent to a
model.

| Provider                    | Endpoint                                                | Licence / attribution                           | Notes                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| European Central Bank       | `www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` | Exchange rates from the European Central Bank   | ~29 EUR-based reference rates; shown **indicative**, not a card/ATM rate                                                                                                  |
| Open-Meteo geocoding        | `geocoding-api.open-meteo.com/v1/search`                | Weather data by Open-Meteo.com (CC BY 4.0)      | Reused from weather — resolves the destination to coordinates + country + tz, and (best-effort) the trip origin's tz for the offline time difference                      |
| Nager.Date public holidays  | `date.nager.at/api/v3/PublicHolidays/{year}/{ISO2}`     | Holiday data from Nager.Date (MIT-licensed API) | Keyless; one request per trip year. Only `types` ⊇ `"Public"` kept; narrowed to the travel window on read. Informational — never clears a readiness item                  |
| Wikimedia REST page summary | `en.wikipedia.org/api/rest_v1/page/summary/{title}`     | Text under CC BY-SA 4.0; attribute Wikipedia    | Keyless; the destination's lead summary, shown verbatim with attribution + link. Disambiguation/empty pages surface as "no summary". Informational — never a safety claim |

## Traveler-supplied addresses

One network behavior in the product does not fetch a curated endpoint: fetching
what a saved research **resource** says. The address comes from the traveler, so
every other row in this document — a known provider, a pinned endpoint, a known
licence — is unavailable here by construction.

That makes the gating stricter rather than looser:

- **Two gates, not one.** A standing preference (off by default, reversible in
  one click) must be on _and_ the fetch must be asked for. With the preference
  off, no request is made at all.
- **Scheme allowlist.** Only `http` and `https` are ever fetched. `javascript:`,
  `data:`, and `file:` are rejected when the link is saved and re-checked before
  the fetch, because that second check is the one that runs on the call that
  leaves the machine.
- **Bounded and reduced.** The response is size-capped, reduced to readable text
  with script and stylesheet content dropped, and capped again on the way into
  storage. A page past the limit is stored truncated and says so.
- **Snapshot discipline, as everywhere else.** Dated, hashed, shown with its
  retrieval time and a link to the original, and never evidence — a resource
  yields no candidate fact and clears no readiness item.
- **Licence is unknown and is not claimed.** Voyalier stores a personal reading
  copy of a page the traveler chose; it does not redistribute it, and the
  interface always links the original rather than presenting the text as its
  own.
- **May reach a model, and is treated as hostile when it does.** This is the one
  fetched source class that a model may see, because grounding chat on the
  traveler's own reading is the point of keeping it. It is quoted into the
  prompt as data, under an instruction naming it untrusted and telling the model
  to ignore directions found inside it. A page that says "ignore your
  instructions" is a thing that exists.

## Bundled and computed data

No network at all. Astronomy is computed from coordinates and a date; country
facts are a compiled-in table resolved fresh from a country code on each read
(so a corrected value never goes stale in a stored snapshot).

| Data             | Origin                                                  | Licence / attribution                                              | Notes                                                                                                                                                            |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sun & moon       | Standard NOAA sunrise equation + synodic month          | —                                                                  | Computed on-device; polar day/night stated, not faked                                                                                                            |
| Country facts    | OpenStreetMap/Wikidata (CC0/ODbL) and public sources    | Compiled from OpenStreetMap/Wikidata (CC0/ODbL) and public sources | Plug/voltage/drive-side/calling-code/emergency for curated countries                                                                                             |
| Nearest airports | OurAirports                                             | Public domain (attribution optional)                               | ~3,300 scheduled-service airports (large+medium, IATA) bundled; nearest by haversine                                                                             |
| City gazetteer   | GeoNames `cities15000`                                  | CC BY 4.0 — attribution "GeoNames"                                 | ~32,000 cities (population ≥ 15,000, districts excluded) bundled; prefix + accent-folded matching, population-ranked; powers destination autocomplete            |
| World Heritage   | Wikidata (`P1435` = `Q9259`) SPARQL extract             | CC0 (Wikidata)                                                     | ~940 UNESCO sites (name, coordinates, inscription year) bundled; nearest within 150 km by haversine, derived on read. Convenience, not a complete registry       |
| Tipping norms    | Compiled from Wikivoyage and Wikipedia tipping guidance | Facts in our own words; sources cited                              | One conservative line per curated country, resolved from the country code. Framed as a rough guide, never a rule; review annually; never clears a readiness item |

## Place entry and geocoding

Origin, destination, and lodging fields offer type-ahead suggestions, but only
from **local** data: the bundled offline **gazetteer** (the world's cities from
GeoNames), the offline pack catalog, place names inside packs the user has
already downloaded, and the user's own previous trips and confirmed facts. There
is no per-keystroke network geocoding — the gazetteer is the sanctioned offline
fix.

Public **Nominatim** must not be used for autocomplete — its usage policy forbids
autocomplete-style querying. If server-backed geocoding is ever needed beyond the
bundled gazetteer, the intended path is a **self-hosted Pelias (or equivalent)
instance** under our own terms, never a shared public endpoint.
