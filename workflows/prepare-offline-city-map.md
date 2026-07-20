# Prepare additional offline city maps

Status: ready for implementation

## Trigger

The catalog marks another city as offline-map capable and the owner deliberately
runs the pack publisher for the release's pinned Protomaps build.

## Outcome

Every catalog city advertised as offline-map capable has a published, verified,
bounded PMTiles archive and descriptor that the app can download and range-read
without online tile requests.

## Confirmed behavior

- The publisher builds **all** catalog entries marked offline-map capable in one
  run. Publishing a new city must not clobber descriptors for previously enabled
  cities.
- v0.5.0 adds Tokyo and Paris after each archive passes the existing 128 MiB cap,
  PMTiles header verification, SHA-256 check, and public-asset download check.
  If either archive exceeds the cap, narrow that pack's documented bbox or lower
  its maximum zoom transparently; do not bypass the cap or substitute a city.
- The catalog flag, mock, pack JSON, release manifest, UI copy, map documentation,
  roadmap, and public docs change together.
- Download remains explicit. Online OpenFreeMap remains the labelled fallback
  when a compatible archive is absent.
- `packs-v1` remains a prerelease so it cannot shadow the stable updater release.

## Boundaries

- No background prefetching, hotlinking of Protomaps as the app's storage, or
  claim of complete POI/opening-hours/safety coverage.
- Archive size is disclosed before download and may vary by city.
- Map source, ODbL license, attribution, build URL/date, byte count, zoom range,
  and digest remain attached to every archive.

## Checkpoint

The owner-triggered workflow dispatch is the publication checkpoint. App-side
download remains a separate traveler checkpoint.

## Verification

- Script tests prove multi-city output retains every descriptor and rejects
  unknown, duplicate, oversized, or unverifiable archives.
- Publisher runs `pmtiles verify`, records headers, and uploads all enabled maps.
- Release verification downloads each new JSON/PMTiles pair, compares byte count
  and SHA-256, and checks `releases/latest` still names the stable app release.
- Packaged-app QA proves one new city renders with the network disabled.

## Definition of done

Nashville, Kyoto, Tokyo, and Paris are all advertised, published, integrity-
checked, downloadable, locally rendered, documented, and isolated from the
stable updater release.
