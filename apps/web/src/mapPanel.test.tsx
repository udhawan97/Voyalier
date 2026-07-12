import { afterEach, beforeEach, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

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

  it("fetches nothing until asked, then requests places on consent", async () => {
    let calls = 0;
    const base = createMockGateway();
    const gateway = {
      ...base,
      getRecommendations: (
        tripId: string,
        weights: Parameters<typeof base.getRecommendations>[1],
      ) => {
        calls += 1;
        return base.getRecommendations(tripId, weights);
      },
    };
    renderApp(gateway);

    const region = await openMap();
    // Lazy: the "Show map" affordance is present and nothing has been fetched.
    const showButton = within(region).getByRole("button", { name: "Show map" });
    expect(calls).toBe(0);

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
    expect(calls).toBe(1);
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
