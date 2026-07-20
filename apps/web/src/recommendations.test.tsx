import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

async function openTrip() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
}

/**
 * Persona-weighted recommendations: lazy, empty until a pack is downloaded, and
 * ranked by the chosen interests with transparent provenance.
 */
describe("Recommendations", () => {
  it("guides to download a pack first, then ranks by persona", async () => {
    renderApp(createMockGateway());
    await openTrip();
    const region = await screen.findByRole("region", {
      name: "Recommendations",
    });

    // With no pack downloaded, fetching gives an empty, guiding state.
    fireEvent.click(
      within(region).getByRole("button", { name: "Get recommendations" }),
    );
    expect(
      await within(region).findByText(/download a city pack for this trip/i),
    ).toBeInTheDocument();

    // Download a pack via the city-packs panel.
    const packs = within(
      await screen.findByRole("region", { name: "Offline city data" }),
    );
    fireEvent.click(packs.getByRole("button", { name: "Browse city packs" }));
    const nashville = (await packs.findByText("Nashville")).closest("li")!;
    fireEvent.click(
      within(nashville).getByRole("button", { name: "Download for this trip" }),
    );
    await within(nashville).findByText(/offline/);

    // Pick the Foodie preset, then recommendations rank food first.
    fireEvent.click(within(region).getByRole("button", { name: "Foodie" }));
    expect(within(region).getByText("Interests not saved")).toBeInTheDocument();
    fireEvent.click(
      within(region).getByRole("button", { name: "Save interests" }),
    );
    expect(
      await within(region).findByText("Interests saved"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(region).getByRole("button", { name: "Get recommendations" }),
    );

    const list = await within(region).findByRole("list", {
      name: "Recommended places",
    });
    const items = within(list).getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    // A food place leads; provenance is shown.
    expect(within(items[0]).getByText("food")).toBeInTheDocument();
    expect(within(list).getAllByText(/Overture Maps/).length).toBeGreaterThan(
      0,
    );
    // A wildcard from a different dimension is surfaced.
    expect(within(list).getByText("wildcard")).toBeInTheDocument();

    // Saving is explicit and the result appears in the separate shortlist.
    fireEvent.click(
      within(items[0]).getByRole("button", { name: "Save place" }),
    );
    const savedPlaces = screen.getByRole("region", { name: "Saved places" });
    expect(
      await within(savedPlaces).findByText("Hattie B's Hot Chicken"),
    ).toBeInTheDocument();
  });
});
