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

2. **Offline / per-pack — PMTiles.** Nashville is the first complete vertical
   slice. The `Build city packs` workflow pins and verifies the PMTiles CLI,
   extracts `us-nashville.pmtiles` from an exact dated Protomaps build, verifies
   the archive, and publishes it beside pack JSON containing byte length,
   SHA-256, source URL, fetched time, zoom range, license, and attribution. The
   core refuses unknown sources, bad metadata, oversized archives, or bytes that
   do not match the descriptor before storing the file atomically.

   The webview receives neither a filesystem path nor a broad asset-protocol
   capability. A custom PMTiles source asks the existing app gateway for bounded
   byte ranges (maximum 4 MiB), and the Rust side seeks and reads those ranges
   from the verified archive. The local style contains no remote glyph, sprite,
   or tile URLs. When a compatible local archive is present, the map prefers it;
   otherwise the explicit Show map action uses OpenFreeMap. Other city packs
   continue to use that online fallback until their own extracts are enabled.

## What the map shows

- The trip's destination (centered on the weather-geocoded coordinates when a
  weather outlook has been fetched).
- Recommended places from a downloaded city pack, as markers with popups.

## Attribution

The online basemap credits OpenFreeMap and OpenStreetMap contributors. The
offline Nashville archive records Protomaps as the source, ODbL-1.0 as its
database license, and OpenStreetMap contributor attribution in both pack JSON
and the manifest. Overture and Wikivoyage layers keep their own per-layer
licenses (see the pack manifest).

## Privacy

The map initializes only on the explicit "Show map" click. With a verified
Nashville archive, tile reads stay on-device. Without one, OpenFreeMap requests
carry only the map viewport (never trip data). There is no telemetry.
