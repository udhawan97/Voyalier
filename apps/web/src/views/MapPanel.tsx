import { useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { PersonaWeights, Recommendation } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { Button } from "../components/Button";

// MapLibre GL is ~1 MB — far larger than the rest of the app. The map is
// consent-gated, so the library (and its CSS) is loaded on demand the first time
// a user clicks "Show map", keeping it out of the initial bundle entirely.
type Maplibre = typeof import("maplibre-gl");

// OpenFreeMap Liberty: a free, no-API-key vector basemap (OpenStreetMap data).
// The offline path is a per-pack PMTiles extract read via the pmtiles protocol.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const BALANCED: PersonaWeights = {
  food: 0.5,
  culture: 0.5,
  nature: 0.5,
  nightlife: 0.5,
  shopping: 0.5,
};

export interface MapCenter {
  lat: number;
  lon: number;
  name: string;
}

/**
 * A consent-gated map of the trip's destination and recommended places.
 * Showing it fetches map tiles from OpenFreeMap (an explicit network request,
 * like the weather outlook); nothing about the trip is sent. Markers come from
 * the trip's downloaded-pack recommendations; the view centers on the
 * weather-geocoded destination when available.
 */
export function MapPanel({
  tripId,
  center,
}: {
  tripId: string;
  center?: MapCenter;
}) {
  const gateway = useGateway();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [ml, setMl] = useState<Maplibre | null>(null);
  const [shown, setShown] = useState(false);
  const [places, setPlaces] = useState<Recommendation[]>([]);

  async function show() {
    setShown(true);
    // Request markers straight away, independent of the (heavier) map library.
    const placesPromise = gateway
      .getRecommendations(tripId, BALANCED)
      .catch(() => [] as Recommendation[]); // markers are a bonus
    try {
      const [mod] = await Promise.all([
        import("maplibre-gl"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);
      // The bundler's CJS interop puts the namespace under `default`; fall back
      // to the module itself if a future ESM build exposes it at the top level.
      const lib = ((mod as { default?: Maplibre }).default ?? mod) as Maplibre;
      setMl(() => lib);
    } catch {
      // The map library failed to load — leave the frame empty rather than
      // crashing; the rest of the trip view is unaffected.
    }
    setPlaces(await placesPromise);
  }

  // Initialize the map once the container is shown and the library has loaded.
  useEffect(() => {
    if (!shown || !ml || !containerRef.current || mapRef.current) return;
    let map: MaplibreMap;
    try {
      map = new ml.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: center ? [center.lon, center.lat] : [10, 30],
        zoom: center ? 10 : 1.4,
      });
    } catch {
      // No WebGL (e.g. a headless/test environment) — leave the frame empty
      // rather than crashing; the rest of the trip view is unaffected.
      return;
    }
    map.addControl(new ml.NavigationControl({}), "top-right");
    if (center) {
      new ml.Marker()
        .setLngLat([center.lon, center.lat])
        .setPopup(new ml.Popup({ offset: 16 }).setText(center.name))
        .addTo(map);
    }
    mapRef.current = map;
    // The map can initialize with a zero-size internal transform if the
    // container isn't laid out yet, which stops it from requesting any tiles.
    // Resize once layout has settled so it picks up the real viewport.
    const frame = requestAnimationFrame(() => mapRef.current?.resize());
    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapRef.current = null;
    };
  }, [shown, ml, center]);

  // Plot recommended places and fit to them when they load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ml || places.length === 0) return;
    const plot = () => {
      const bounds = new ml.LngLatBounds();
      for (const place of places) {
        new ml.Marker({ color: "#c34e33" })
          .setLngLat([place.lon, place.lat])
          .setPopup(
            new ml.Popup({ offset: 16 }).setText(
              `${place.name} · ${place.category}`,
            ),
          )
          .addTo(map);
        bounds.extend([place.lon, place.lat]);
      }
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
    };
    if (map.isStyleLoaded()) plot();
    else map.once("load", plot);
  }, [places, ml]);

  return (
    <section className="voy-map" aria-labelledby="map-title">
      <h2 id="map-title" className="voy-map__title">
        Map
      </h2>

      {!shown ? (
        <>
          <p className="voy-map__intro">
            See your destination and recommended places on a map. Showing it
            fetches map tiles from OpenFreeMap — an explicit, one-time network
            request, like the weather outlook. Nothing about your trip is sent.
          </p>
          <Button variant="secondary" onClick={show}>
            Show map
          </Button>
        </>
      ) : (
        <>
          <div
            ref={containerRef}
            className="voy-map__canvas"
            role="application"
            aria-label="Trip map"
          />
          <p className="voy-map__scope">
            Basemap © OpenFreeMap · map data © OpenStreetMap contributors.
            {places.length === 0
              ? " Download a city pack and get recommendations to see places here."
              : ""}
          </p>
        </>
      )}
    </section>
  );
}
