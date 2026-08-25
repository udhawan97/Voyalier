import { afterEach, beforeEach, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import {
  createMockGateway,
  type Recommendation,
  type SavedPlace,
} from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

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
    setText() {
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
    // Pretend a WebGL context is available so the consent path renders the
    // canvas (real tile rendering still no-ops in jsdom and is verified live).
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({}) as unknown as RenderingContext,
    );
  });
  afterEach(() => {
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
      within(region).queryByRole("button", { name: "Show map" }),
    ).toBeNull();
    expect(recommendationCalls).toBe(1);
    expect(offlineMapCalls).toBe(1);
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
