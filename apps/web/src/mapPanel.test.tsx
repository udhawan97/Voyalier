import { afterEach, beforeEach, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMockGateway,
  type Recommendation,
  type SavedPlace,
} from "@voyalier/contracts";

import { renderApp } from "./test/helpers";
import { setLocalePreference } from "./app/locale";
import { setThemeChoice } from "./app/theme";

const maplibreMocks = vi.hoisted(() => ({
  markerColors: [] as string[],
  popupTexts: [] as string[],
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => {
  class FakeMap {
    addControl() {}
    isStyleLoaded() {
      return true;
    }
    fitBounds() {}
    once(_event: string, callback: () => void) {
      callback();
    }
    off() {}
    resize() {}
    remove() {}
  }
  class FakeMarker {
    constructor(options?: { color?: string }) {
      if (options?.color) maplibreMocks.markerColors.push(options.color);
    }
    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  class FakePopup {
    setText(text: string) {
      maplibreMocks.popupTexts.push(text);
      return this;
    }
  }
  class FakeLngLatBounds {
    extend() {
      return this;
    }
  }
  const maplibre = {
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    LngLatBounds: FakeLngLatBounds,
    NavigationControl: class {},
    addProtocol: vi.fn(),
    removeProtocol: vi.fn(),
  };
  return { ...maplibre, default: maplibre };
});

async function openMap() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  return screen.findByRole("region", { name: "Map" });
}

/**
 * The map is consent-gated: nothing is fetched until "Show map" is clicked.
 * Actual tile rendering needs WebGL and is verified live in the browser; here
 * we assert the consent seam and the request-on-consent. jsdom has no WebGL, so
 * the consent test stubs a context; a separate test covers the graceful
 * no-WebGL message.
 */
describe("Map panel", () => {
  beforeEach(() => {
    maplibreMocks.markerColors.length = 0;
    maplibreMocks.popupTexts.length = 0;
    // Pretend a WebGL context is available so the consent path renders the
    // canvas (real tile rendering still no-ops in jsdom and is verified live).
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({}) as unknown as RenderingContext,
    );
  });
  afterEach(() => {
    setLocalePreference("en");
    setThemeChoice("system");
    document.documentElement.style.removeProperty("--voy-vermilion");
    document.documentElement.style.removeProperty("--voy-indigo");
    vi.restoreAllMocks();
  });

  it("fetches nothing until asked, then requests places and the offline map on consent", async () => {
    let recommendationCalls = 0;
    let offlineMapCalls = 0;
    const base = createMockGateway();
    const gateway = {
      ...base,
      getRecommendations: (
        tripId: string,
        weights: Parameters<typeof base.getRecommendations>[1],
      ) => {
        recommendationCalls += 1;
        return base.getRecommendations(tripId, weights);
      },
      getOfflineMap: (tripId: string) => {
        offlineMapCalls += 1;
        return base.getOfflineMap(tripId);
      },
    };
    renderApp(gateway);

    const region = await openMap();
    // Lazy: the "Show map" affordance is present and nothing has been fetched.
    const showButton = within(region).getByRole("button", { name: "Show map" });
    expect(
      within(region).getByText(/OpenFreeMap receives tile requests/),
    ).toHaveTextContent(
      /can reflect destination and saved-place coordinates.*place names, notes, and itinerary records are not sent/,
    );
    expect(recommendationCalls).toBe(0);
    expect(offlineMapCalls).toBe(0);

    fireEvent.click(showButton);

    // The click is the consent: the map frame + attribution appear and places
    // are requested. (Tiles need WebGL and are verified live.)
    expect(
      await within(region).findByRole("application", { name: "Trip map" }),
    ).toBeInTheDocument();
    expect(within(region).getByText(/OpenFreeMap/)).toBeInTheDocument();
    expect(
      within(region).getByText(
        /Online tile requests reveal the displayed area/,
      ),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("button", { name: "Show map" }),
    ).toBeNull();
    expect(recommendationCalls).toBe(1);
    expect(offlineMapCalls).toBe(1);
  });

  it("rebuilds markers for unavailable storage, system theme, explicit theme, and locale changes", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    let colorSchemeListener: ((event: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        () =>
          ({
            matches: false,
            media: "(prefers-color-scheme: dark)",
            onchange: null,
            addEventListener: (
              _type: string,
              listener: (event: MediaQueryListEvent) => void,
            ) => {
              colorSchemeListener = listener;
            },
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as MediaQueryList,
      ),
    );
    const base = createMockGateway();
    const savedPlace: SavedPlace = {
      id: "saved_market",
      tripId: "trip_kyoto",
      packId: "jp-kyoto",
      sourcePackAvailable: true,
      name: "Nishiki Market",
      category: "food",
      dimension: "food",
      lat: 35.005,
      lon: 135.764,
      source: "Overture Maps",
      license: "ODbL 1.0",
      reasons: ["food"],
      wildcard: false,
      notes: "",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const suggestion: Recommendation = {
      packId: "jp-kyoto",
      name: "Kyoto Station",
      category: "travel",
      dimension: "culture",
      lat: 34.9858,
      lon: 135.7588,
      source: "Overture Maps",
      license: "ODbL 1.0",
      score: 0.8,
      reasons: ["culture"],
      wildcard: false,
    };
    const gateway = {
      ...base,
      getTrip: async (tripId: string) => ({
        ...(await base.getTrip(tripId)),
        savedPlaces: [savedPlace],
      }),
      getRecommendations: () => Promise.resolve([suggestion]),
    };
    document.documentElement.style.setProperty("--voy-vermilion", "#aa1100");
    document.documentElement.style.setProperty("--voy-indigo", "#0011aa");
    renderApp(gateway);

    const region = await openMap();
    fireEvent.click(within(region).getByRole("button", { name: "Show map" }));
    await waitFor(() =>
      expect(maplibreMocks.markerColors).toEqual(
        expect.arrayContaining(["#aa1100", "#0011aa"]),
      ),
    );

    document.documentElement.style.setProperty("--voy-vermilion", "#bb2200");
    document.documentElement.style.setProperty("--voy-indigo", "#1122bb");
    act(() => colorSchemeListener?.({} as MediaQueryListEvent));
    await waitFor(() =>
      expect(maplibreMocks.markerColors).toEqual(
        expect.arrayContaining(["#bb2200", "#1122bb"]),
      ),
    );

    document.documentElement.style.setProperty("--voy-vermilion", "#cc3300");
    document.documentElement.style.setProperty("--voy-indigo", "#2233cc");
    act(() => setThemeChoice("dark"));
    await waitFor(() =>
      expect(maplibreMocks.markerColors).toEqual(
        expect.arrayContaining(["#cc3300", "#2233cc"]),
      ),
    );

    maplibreMocks.popupTexts.length = 0;
    act(() => setLocalePreference("es"));
    await waitFor(() =>
      expect(maplibreMocks.popupTexts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Lugar guardado"),
          expect.stringContaining("Lugar sugerido"),
        ]),
      ),
    );
  });

  it("keeps saved places visible when recommendation loading fails", async () => {
    const base = createMockGateway();
    const savedPlace: SavedPlace = {
      id: "saved_fushimi",
      tripId: "trip_kyoto",
      packId: "jp-kyoto",
      sourcePackAvailable: false,
      name: "Fushimi Inari",
      category: "culture",
      dimension: "culture",
      lat: 34.9671,
      lon: 135.7727,
      source: "Overture Maps",
      license: "ODbL 1.0",
      reasons: ["culture"],
      wildcard: false,
      notes: "",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const gateway = {
      ...base,
      getTrip: async (tripId: string) => ({
        ...(await base.getTrip(tripId)),
        savedPlaces: [savedPlace],
      }),
      getRecommendations: () => Promise.reject(new Error("pack unavailable")),
    };
    renderApp(gateway);

    const region = await openMap();
    fireEvent.click(within(region).getByRole("button", { name: "Show map" }));

    const points = await within(region).findByRole("list", {
      name: "Places shown on the map",
    });
    expect(within(points).getByText("Fushimi Inari")).toBeInTheDocument();
    expect(within(points).getByText(/Saved place/)).toBeInTheDocument();
  });

  it("plots a saved recommendation once and lets the saved state win", async () => {
    const base = createMockGateway();
    const savedPlace: SavedPlace = {
      id: "saved_market",
      tripId: "trip_kyoto",
      packId: "jp-kyoto",
      sourcePackAvailable: true,
      name: "Nishiki Market",
      category: "food",
      dimension: "food",
      lat: 35.005,
      lon: 135.764,
      source: "Overture Maps",
      license: "ODbL 1.0",
      reasons: ["food"],
      wildcard: false,
      notes: "",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const duplicate: Recommendation = {
      packId: savedPlace.packId,
      name: "  NISHIKI   MARKET ",
      category: savedPlace.category,
      dimension: savedPlace.dimension,
      lat: savedPlace.lat,
      lon: savedPlace.lon,
      source: savedPlace.source,
      license: savedPlace.license,
      score: 1,
      reasons: ["food"],
      wildcard: false,
    };
    const gateway = {
      ...base,
      getTrip: async (tripId: string) => ({
        ...(await base.getTrip(tripId)),
        savedPlaces: [savedPlace],
      }),
      getRecommendations: () => Promise.resolve([duplicate]),
    };
    renderApp(gateway);

    const region = await openMap();
    fireEvent.click(within(region).getByRole("button", { name: "Show map" }));

    const points = await within(region).findByRole("list", {
      name: "Places shown on the map",
    });
    expect(within(points).getAllByRole("listitem")).toHaveLength(1);
    expect(within(points).getByText("Nishiki Market")).toBeInTheDocument();
    expect(within(points).getByText(/Saved place/)).toBeInTheDocument();
  });

  it("shows a graceful message when WebGL is unavailable", async () => {
    // Override the beforeEach stub: no WebGL context on this device.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    renderApp(createMockGateway());

    const region = await openMap();
    fireEvent.click(within(region).getByRole("button", { name: "Show map" }));

    expect(
      await within(region).findByText(/can't show the map/),
    ).toBeInTheDocument();
    // No broken empty canvas is shown in place of the map.
    expect(
      within(region).queryByRole("application", { name: "Trip map" }),
    ).toBeNull();
  });
});
