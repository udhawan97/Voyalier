# Maps and tiles

Voyalier's map is [MapLibre GL JS](https://maplibre.org/) — an open-source,
WebGL vector renderer with no proprietary lock-in. The map is consent-gated:
showing it is an explicit, one-time network request (like the weather outlook),
and nothing about the trip is ever sent to the tile server.

## Tile sources (tiered)

1. **Default basemap — OpenFreeMap.** The map's default style is
   [OpenFreeMap Liberty](https://openfreemap.org/) (`https://tiles.openfreemap.org/styles/liberty`):
   free, **no API key**, no usage limits, OpenStreetMap-derived vector tiles
   served under CC-BY. It is fully self-hostable, which keeps the door open to
   dropping in our own hosted tiles without changing the app.

2. **Offline / per-pack — PMTiles.** The intended offline path (and the
   original product thesis) is [PMTiles](https://protomaps.com/): a single-file
   tile archive read by MapLibre via the `pmtiles://` protocol using HTTP range
   requests — so a whole basemap can be served from one static file without a
   tile server, and a downloaded pack's map works fully offline. The
   `Build city packs` workflow (`.github/workflows/packs.yml`) is where each
   pack's PMTiles extract (clipped to its bounding box, built from a Protomaps
   planet build or an OSM extract via `tippecanoe` + `pmtiles`) is produced and
   published to the `packs-v1` release, alongside the pack's place data. When a
   pack is present, the map prefers its local PMTiles; otherwise it falls back
   to the OpenFreeMap basemap.

## What the map shows

- The trip's destination (centered on the weather-geocoded coordinates when a
  weather outlook has been fetched).
- Recommended places from a downloaded city pack, as markers with popups.

## Attribution

The basemap credits OpenFreeMap and OpenStreetMap contributors, surfaced by
MapLibre's attribution control and a scope line under the map. Overture and
Wikivoyage layers in packs keep their own per-layer licenses (see the pack
manifest).

## Privacy

Tiles are fetched only on the explicit "Show map" click. Requests carry only
the map viewport (never trip data). There is no telemetry. A fully offline map
becomes possible once a pack's PMTiles are downloaded.
