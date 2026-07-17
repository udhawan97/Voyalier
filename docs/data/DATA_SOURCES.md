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

The first offline map slice uses an exact dated Protomaps Basemap PMTiles build
clipped to Nashville's catalog bounding box. Pack metadata records the canonical
build URL, retrieval time, ODbL-1.0 identifier, OpenStreetMap contributor
attribution, byte length, zoom range, and SHA-256. The client accepts only the
trusted Protomaps HTTPS origin and verifies the bytes before exposing bounded
local range reads to MapLibre.

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

| Provider              | Endpoint                                                | Licence / attribution                         | Notes                                                                        |
| --------------------- | ------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| European Central Bank | `www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` | Exchange rates from the European Central Bank | ~29 EUR-based reference rates; shown **indicative**, not a card/ATM rate     |
| Open-Meteo geocoding  | `geocoding-api.open-meteo.com/v1/search`                | Weather data by Open-Meteo.com (CC BY 4.0)    | Reused from weather — resolves the destination to coordinates + country + tz |

## Bundled and computed data

No network at all. Astronomy is computed from coordinates and a date; country
facts are a compiled-in table resolved fresh from a country code on each read
(so a corrected value never goes stale in a stored snapshot).

| Data          | Origin                                               | Licence / attribution                                              | Notes                                                                |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Sun & moon    | Standard NOAA sunrise equation + synodic month       | —                                                                  | Computed on-device; polar day/night stated, not faked                |
| Country facts | OpenStreetMap/Wikidata (CC0/ODbL) and public sources | Compiled from OpenStreetMap/Wikidata (CC0/ODbL) and public sources | Plug/voltage/drive-side/calling-code/emergency for curated countries |

## Place entry and geocoding

Origin, destination, and lodging fields offer type-ahead suggestions, but only
from **local** data: the offline pack catalog, place names inside packs the user
has already downloaded, and the user's own previously confirmed facts. There is
no per-keystroke network geocoding.

Public **Nominatim** must not be used for autocomplete — its usage policy forbids
autocomplete-style querying. If server-backed geocoding is needed later, the
intended path is a **self-hosted Pelias (or equivalent) instance** under our own
terms, never a shared public endpoint. Until then, suggestions stay offline and
pack-backed.
