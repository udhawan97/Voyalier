import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  createMockGateway,
  type PersonaWeights,
  type SavedPlace,
} from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
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
  afterEach(() => setLocalePreference("en"));

  it("guides to download a pack first, then ranks by persona", async () => {
    const base = createMockGateway();
    let saveWeights: PersonaWeights | undefined;
    const gateway = {
      ...base,
      savePlace: (input: Parameters<typeof base.savePlace>[0]) => {
        saveWeights = input.weights;
        return base.savePlace(input);
      },
    };
    renderApp(gateway);
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
    expect(within(items[0]).getByText("Food")).toBeInTheDocument();
    expect(within(list).getAllByText(/Overture Maps/).length).toBeGreaterThan(
      0,
    );
    // A wildcard from a different dimension is surfaced.
    expect(within(list).getByText("wildcard")).toBeInTheDocument();

    // Saving is explicit and remains tied to the weights that produced this
    // list even if the controls change before the traveler saves a place.
    fireEvent.click(within(region).getByRole("button", { name: "Explorer" }));
    fireEvent.click(
      within(items[0]).getByRole("button", { name: "Save place" }),
    );
    const savedPlaces = screen.getByRole("region", { name: "Saved places" });
    expect(
      await within(savedPlaces).findByText("Hattie B's Hot Chicken"),
    ).toBeInTheDocument();
    expect(saveWeights?.food).toBe(1);
  });

  it("localizes deterministic dimensions and reasons in Spanish", async () => {
    const gateway = createMockGateway();
    await gateway.downloadPack("trip_kyoto", "jp-kyoto");
    setLocalePreference("es");
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir Kyoto autumn journey",
      }),
    );
    const region = await screen.findByRole("region", {
      name: "Recomendaciones",
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Obtener recomendaciones" }),
    );

    expect(await within(region).findByText("Comida")).toBeInTheDocument();
    expect(
      within(region).getAllByText(/Coincide con tu interés en/i).length,
    ).toBeGreaterThan(0);
    expect(within(region).queryByText(/^food$/)).not.toBeInTheDocument();
    expect(
      within(region).queryByText(/Matches your interest in/i),
    ).not.toBeInTheDocument();
  });

  it("recognizes a saved recommendation by its folded storage identity", async () => {
    const base = createMockGateway();
    await base.downloadPack("trip_kyoto", "jp-kyoto");
    const weights: PersonaWeights = {
      food: 1,
      culture: 0.5,
      nature: 0.5,
      nightlife: 0.5,
      shopping: 0.5,
    };
    const recommendation = (
      await base.getRecommendations("trip_kyoto", weights)
    )[0];
    const canonical = await base.savePlace({
      tripId: "trip_kyoto",
      recommendation,
      weights,
    });
    const foldedVariant: SavedPlace = {
      ...canonical,
      name: canonical.name.toUpperCase().replaceAll(" ", "-"),
    };
    const gateway = {
      ...base,
      getTrip: async (tripId: string) => {
        const detail = await base.getTrip(tripId);
        return { ...detail, savedPlaces: [foldedVariant] };
      },
    };

    renderApp(gateway);
    await openTrip();
    const region = await screen.findByRole("region", {
      name: "Recommendations",
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Get recommendations" }),
    );
    const saved = await waitFor(() => within(region).getByText("Saved"));
    expect(
      within(saved.closest("li")!).queryByRole("button", {
        name: "Save place",
      }),
    ).toBeNull();
  });

  it("surfaces failures while saving interests", async () => {
    const base = createMockGateway();
    const gateway = {
      ...base,
      setInterestProfile: () => Promise.reject(new Error("write refused")),
    };
    renderApp(gateway);
    await openTrip();
    const region = await screen.findByRole("region", {
      name: "Recommendations",
    });
    fireEvent.click(within(region).getByRole("button", { name: "Foodie" }));
    fireEvent.click(
      within(region).getByRole("button", { name: "Save interests" }),
    );
    expect(await within(region).findByRole("alert")).toBeInTheDocument();
  });

  it("surfaces failures while saving a recommended place", async () => {
    const base = createMockGateway();
    await base.downloadPack("trip_kyoto", "jp-kyoto");
    const gateway = {
      ...base,
      savePlace: () => Promise.reject(new Error("write refused")),
    };
    renderApp(gateway);
    await openTrip();
    const region = await screen.findByRole("region", {
      name: "Recommendations",
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Get recommendations" }),
    );
    const list = await within(region).findByRole("list", {
      name: "Recommended places",
    });
    fireEvent.click(
      within(list).getAllByRole("button", { name: "Save place" })[0],
    );
    expect(await within(region).findByRole("alert")).toBeInTheDocument();
  });
});
