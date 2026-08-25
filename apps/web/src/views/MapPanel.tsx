import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Map as MaplibreMap,
  Marker as MaplibreMarker,
  StyleSpecification,
} from "maplibre-gl";
import type { Source as PmtilesSource } from "pmtiles";
import type {
  AppGateway,
  OfflineMapArchive,
  PersonaWeights,
  Recommendation,
  SavedPlace,
} from "@voyalier/contracts";
import { savedPlaceIdentity } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { t } from "../app/i18n";
import { useTheme } from "../app/theme";
import { SectionTitle } from "../components/primitives";
import { MapIcon } from "../components/icons";
import { Button } from "../components/Button";

// MapLibre GL is ~1 MB — far larger than the rest of the app. The map is
// consent-gated, so the library (and its CSS) is loaded on demand the first time
// a user clicks "Show map", keeping it out of the initial bundle entirely.
type Maplibre = typeof import("maplibre-gl");
type Pmtiles = typeof import("pmtiles");

// OpenFreeMap Liberty: a free, no-API-key vector basemap (OpenStreetMap data).
// The offline path is a per-pack PMTiles extract read via the pmtiles protocol.
export const OPENFREEMAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";

class GatewayPmtilesSource implements PmtilesSource {
  constructor(
    private readonly gateway: AppGateway,
    private readonly tripId: string,
    private readonly archive: OfflineMapArchive,
  ) {}

  getKey(): string {
    return `voyalier-${this.archive.packId}-${this.archive.sha256}`;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<{ data: ArrayBuffer; etag: string }> {
    signal?.throwIfAborted();
    const chunk = await this.gateway.readOfflineMapRange(
      this.tripId,
      this.archive.packId,
      offset,
      length,
    );
    signal?.throwIfAborted();
    const binary = atob(chunk.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { data: bytes.buffer, etag: chunk.etag };
  }
}

function cssColor(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

/** A label-free local style: no glyph, sprite, or tile request can leave the app. */
function offlineStyle(
  sourceKey: string,
  attribution: string,
): StyleSpecification {
  const paper = cssColor("--voy-paper", "#f3efe4");
  const elevated = cssColor("--voy-paper-raised", "#fbf8ef");
  const ink = cssColor("--voy-ink", "#1a1917");
  const muted = cssColor("--voy-ink-muted", "#6f6a61");
  const accent = cssColor("--voy-vermilion", "#c34e33");
  return {
    version: 8,
    name: "Voyalier offline basemap",
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${sourceKey}`,
        attribution,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": paper },
      },
      {
        id: "earth",
        type: "fill",
        source: "protomaps",
        "source-layer": "earth",
        paint: { "fill-color": paper },
      },
      {
        id: "landcover",
        type: "fill",
        source: "protomaps",
        "source-layer": "landcover",
        paint: { "fill-color": elevated, "fill-opacity": 0.75 },
      },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        paint: { "fill-color": elevated, "fill-opacity": 0.45 },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": cssColor("--voy-ai-soft", "#d7e1e8") },
      },
      {
        id: "buildings",
        type: "fill",
        source: "protomaps",
        "source-layer": "buildings",
        minzoom: 11,
        paint: { "fill-color": muted, "fill-opacity": 0.22 },
      },
      {
        id: "roads",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: {
          "line-color": ink,
          "line-opacity": 0.42,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 15, 2.4],
        },
      },
      {
        id: "boundaries",
        type: "line",
        source: "protomaps",
        "source-layer": "boundaries",
        paint: { "line-color": accent, "line-opacity": 0.35, "line-width": 1 },
      },
    ],
  };
}

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

interface MapPoint {
  name: string;
  category: string;
  lat: number;
  lon: number;
  saved: boolean;
}

function pointKey(point: Pick<MapPoint, "name" | "lat" | "lon">): string {
  return `${savedPlaceIdentity(point.name)}:${point.lat}:${point.lon}`;
}

/** Saved points lead; an identical recommendation never draws a second marker. */
export function mapPoints(
  savedPlaces: SavedPlace[],
  recommendations: Recommendation[],
): MapPoint[] {
  const points: MapPoint[] = savedPlaces.map((place) => ({
    name: place.name,
    category: place.category,
    lat: place.lat,
    lon: place.lon,
    saved: true,
  }));
  const seen = new Set(points.map(pointKey));
  for (const recommendation of recommendations) {
    if (seen.has(pointKey(recommendation))) continue;
    points.push({
      name: recommendation.name,
      category: recommendation.category,
      lat: recommendation.lat,
      lon: recommendation.lon,
      saved: false,
    });
  }
  return points;
}

/** Whether the environment can create a WebGL context (MapLibre needs one). */
function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * A consent-gated map of the trip's destination and recommended places.
 * Showing it fetches map tiles from OpenFreeMap (an explicit network request,
 * like the weather outlook). Those requests disclose the displayed area, which
 * can reflect destination or saved-place coordinates, but do not carry place
 * names, notes, or structured itinerary records. Markers come from local saved
 * places and downloaded-pack recommendations.
 */
export function MapPanel({
  tripId,
  center,
  savedPlaces,
}: {
  tripId: string;
  center?: MapCenter;
  savedPlaces: SavedPlace[];
}) {
  const gateway = useGateway();
  const [themeChoice] = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const pointMarkersRef = useRef<MaplibreMarker[]>([]);
  const [ml, setMl] = useState<Maplibre | null>(null);
  const [pm, setPm] = useState<Pmtiles | null>(null);
  const [offlineMap, setOfflineMap] = useState<OfflineMapArchive | null>(null);
  const [shown, setShown] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const points = useMemo(
    () => mapPoints(savedPlaces, recommendations),
    [savedPlaces, recommendations],
  );
  // A visible reason the canvas is empty: "load" (library failed to import) or
  // "webgl" (the map couldn't initialize). null means no error.
  const [failure, setFailure] = useState<"load" | "webgl" | null>(null);

  async function show() {
    setShown(true);
    // Detect the common failure (no WebGL: headless, disabled, or unsupported)
    // up front so the reason is visible instead of a silent empty frame.
    if (!webglSupported()) {
      setFailure("webgl");
      return;
    }
    setFailure(null);
    // Request markers straight away, independent of the (heavier) map library.
    const placesPromise = gateway
      .getRecommendations(tripId, BALANCED)
      .catch(() => [] as Recommendation[]); // markers are a bonus
    const offlineMapPromise = gateway.getOfflineMap(tripId).catch(() => null);
    try {
      const [mod, , archive] = await Promise.all([
        import("maplibre-gl"),
        import("maplibre-gl/dist/maplibre-gl.css"),
        offlineMapPromise,
      ]);
      // The bundler's CJS interop puts the namespace under `default`; fall back
      // to the module itself if a future ESM build exposes it at the top level.
      const lib = ((mod as { default?: Maplibre }).default ?? mod) as Maplibre;
      setOfflineMap(archive);
      setPm(archive ? await import("pmtiles") : null);
      setMl(() => lib);
    } catch {
      // The map library failed to load — tell the user rather than leaving a
      // silent empty frame; the rest of the trip view is unaffected.
      setFailure("load");
    }
    setRecommendations(await placesPromise);
  }

  // Initialize the map once the container is shown and the library has loaded.
  useEffect(() => {
    if (!shown || !ml || !containerRef.current || mapRef.current) return;
    let map: MaplibreMap;
    let protocolRegistered = false;
    try {
      let style: string | StyleSpecification = OPENFREEMAP_STYLE_URL;
      if (offlineMap && pm) {
        const source = new GatewayPmtilesSource(gateway, tripId, offlineMap);
        const archive = new pm.PMTiles(source);
        const protocol = new pm.Protocol();
        protocol.add(archive);
        ml.addProtocol("pmtiles", protocol.tile);
        protocolRegistered = true;
        style = offlineStyle(source.getKey(), offlineMap.attribution);
      }
      map = new ml.Map({
        container: containerRef.current,
        style,
        center: center
          ? [center.lon, center.lat]
          : offlineMap
            ? [
                (offlineMap.bbox.west + offlineMap.bbox.east) / 2,
                (offlineMap.bbox.south + offlineMap.bbox.north) / 2,
              ]
            : [10, 30],
        zoom: center || offlineMap ? 10 : 1.4,
      });
    } catch {
      if (protocolRegistered) ml.removeProtocol("pmtiles");
      const failureFrame = requestAnimationFrame(() => setFailure("load"));
      return () => cancelAnimationFrame(failureFrame);
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
      if (protocolRegistered) ml.removeProtocol("pmtiles");
      mapRef.current = null;
    };
  }, [shown, ml, pm, offlineMap, center, gateway, tripId]);

  // Plot the traveler's saved shortlist first, then unsaved recommendations.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ml || points.length === 0) return;
    const plot = () => {
      pointMarkersRef.current.forEach((marker) => marker.remove());
      pointMarkersRef.current = [];
      // Read resolved brand colors so both marker roles follow the active theme
      // instead of freezing a light-mode hex.
      const savedColor =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--voy-vermilion")
          .trim() || "#c34e33";
      const suggestedColor =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--voy-indigo")
          .trim() || "#46536b";
      const bounds = new ml.LngLatBounds();
      for (const point of points) {
        const marker = new ml.Marker({
          color: point.saved ? savedColor : suggestedColor,
        })
          .setLngLat([point.lon, point.lat])
          .setPopup(
            new ml.Popup({ offset: 16 }).setText(
              `${point.name} · ${point.category} · ${t(
                point.saved ? "map.point.saved" : "map.point.suggested",
              )}`,
            ),
          )
          .addTo(map);
        pointMarkersRef.current.push(marker);
        bounds.extend([point.lon, point.lat]);
      }
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
    };
    if (map.isStyleLoaded()) plot();
    else map.once("load", plot);
    return () => {
      map.off("load", plot);
      pointMarkersRef.current.forEach((marker) => marker.remove());
      pointMarkersRef.current = [];
    };
  }, [points, ml, themeChoice]);

  return (
    <section className="voy-map" aria-labelledby="map-title">
      <SectionTitle id="map-title" icon={<MapIcon />}>
        {t("map.title")}
      </SectionTitle>

      {!shown ? (
        <>
          <p className="voy-map__intro">{t("map.intro")}</p>
          <Button variant="secondary" onClick={show}>
            {t("map.show")}
          </Button>
        </>
      ) : failure ? (
        <div className="voy-map__failure" role="status">
          <p>
            {failure === "webgl" ? t("map.error.webgl") : t("map.error.load")}
          </p>
          {failure === "load" ? (
            <Button variant="secondary" onClick={show}>
              {t("action.retry")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            className="voy-map__canvas"
            role="application"
            aria-label={t("map.aria")}
          />
          <p className="voy-map__scope">
            {offlineMap
              ? t("map.scope.offline", { source: offlineMap.sourceName })
              : t("map.scope")}
            {points.length === 0 ? t("map.scope.empty") : ""}
          </p>
        </>
      )}

      {shown && points.length > 0 ? (
        <>
          <div className="voy-map__legend" aria-label={t("map.legend.aria")}>
            <span>
              <i
                className="voy-map__dot voy-map__dot--saved"
                aria-hidden="true"
              />
              {t("map.point.saved")}
            </span>
            <span>
              <i
                className="voy-map__dot voy-map__dot--suggested"
                aria-hidden="true"
              />
              {t("map.point.suggested")}
            </span>
          </div>
          <details className="voy-map__points">
            <summary>
              {t("map.points.summary", { count: points.length })}
            </summary>
            <ul aria-label={t("map.points.aria")}>
              {points.map((point) => (
                <li key={pointKey(point)}>
                  <strong>{point.name}</strong>
                  <span>
                    {t(point.saved ? "map.point.saved" : "map.point.suggested")}
                    {` · ${point.category}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}
