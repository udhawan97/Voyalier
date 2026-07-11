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
 * we assert the consent seam and the request-on-consent, which are
 * environment-independent (the component degrades gracefully without WebGL).
 */
describe("Map panel", () => {
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
});
