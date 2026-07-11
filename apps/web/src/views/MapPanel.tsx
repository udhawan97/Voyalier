import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PersonaWeights, Recommendation } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { Button } from "../components/Button";

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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [shown, setShown] = useState(false);
  const [places, setPlaces] = useState<Recommendation[]>([]);

  async function show() {
    setShown(true);
    try {
      setPlaces(await gateway.getRecommendations(tripId, BALANCED));
    } catch {
      // Markers are a bonus; the basemap still renders without them.
    }
  }

  // Initialize the map once the container is shown.
  useEffect(() => {
    if (!shown || !containerRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
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
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    if (center) {
      new maplibregl.Marker()
        .setLngLat([center.lon, center.lat])
        .setPopup(new maplibregl.Popup({ offset: 16 }).setText(center.name))
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
  }, [shown, center]);

  // Plot recommended places and fit to them when they load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || places.length === 0) return;
    const plot = () => {
      const bounds = new maplibregl.LngLatBounds();
      for (const place of places) {
        new maplibregl.Marker({ color: "#c34e33" })
          .setLngLat([place.lon, place.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 16 }).setText(
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
  }, [places]);

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
