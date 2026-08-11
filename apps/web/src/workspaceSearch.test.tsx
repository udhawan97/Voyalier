import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { WorkspaceSearchHit } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { openFixtureTrip, renderApp } from "./test/helpers";
import { tripSectionForSearchSource } from "./views/TripDetailView";

describe("workspace search", () => {
  afterEach(() => setLocalePreference("en"));

  it("maps every search source to its durable owning section", () => {
    expect(tripSectionForSearchSource("document")).toBe("section-prepare");
    expect(tripSectionForSearchSource("note")).toBe("section-prepare");
    expect(tripSectionForSearchSource("confirmed_fact")).toBe("section-plan");
    expect(tripSectionForSearchSource("saved_place")).toBe("section-plan");
    expect(tripSectionForSearchSource("trip_item")).toBe("section-plan");
  });

  it("matches any query word and ranks records covering more words", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "Maple museum route");
    await gateway.setTripNotes("trip_lisbon", "Maple viewpoints");

    const hits = await gateway.searchWorkspace("maple museum");

    expect(hits.filter((hit) => hit.source === "note")).toHaveLength(2);
    expect(hits[0].tripId).toBe("trip_kyoto");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("does not let an older slow response replace a newer query", async () => {
    const base = createMockGateway();
    let resolveOld!: (hits: WorkspaceSearchHit[]) => void;
    const gateway = {
      ...base,
      searchWorkspace: (query: string) =>
        query === "Fjord"
          ? new Promise<WorkspaceSearchHit[]>((resolve) => {
              resolveOld = resolve;
            })
          : base.searchWorkspace(query),
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    const input = screen.getByLabelText("Search all trips");
    const submit = screen.getByRole("button", { name: "Search" });
    fireEvent.change(input, { target: { value: "Fjord" } });
    fireEvent.click(submit);
    fireEvent.change(input, { target: { value: "Maple Lantern" } });
    fireEvent.click(submit);
    expect(await screen.findByText("Kyoto autumn journey")).toBeInTheDocument();

    await act(async () => {
      resolveOld([
        {
          source: "note",
          tripId: "trip_oslo",
          tripTitle: "Archived Oslo notes",
          tripStatus: "archived",
          tripUpdatedAt: "2026-01-01T00:00:00Z",
          recordId: "old-note",
          label: "Old response",
          snippet: "Fjord",
          score: 1,
        },
      ]);
    });
    expect(screen.queryByText("Old response")).not.toBeInTheDocument();
  });

  it("finds local records across trips and opens the owning trip", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    await screen.findByRole("heading", { name: "Search workspace" });

    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Maple Lantern" },
    });

    expect(await screen.findByText("Kyoto autumn journey")).toBeInTheDocument();
    const result = screen.getByText("Kyoto autumn journey").closest("button")!;
    expect(within(result).getByText("Source document")).toBeInTheDocument();
    expect(within(result).getByText(/Trip updated/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Kyoto confirmations/i }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Kyoto autumn journey",
        level: 1,
      }),
    ).toBeInTheDocument();
  });

  it("labels archived results and their source kind", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_oslo", "Fjord museum ideas");
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Fjord" },
    });

    const result = (await screen.findByText("Archived Oslo notes")).closest(
      "button",
    )!;
    expect(within(result).getAllByText("Trip notes")).toHaveLength(2);
    expect(within(result).getByText("Archived trip")).toBeInTheDocument();
  });

  it("moves focus to the matching traveler-owned record", async () => {
    const gateway = createMockGateway();
    const item = await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Ceramics workshop",
      location: "Gion",
      startAt: "2026-11-05T10:00",
      endAt: "2026-11-05T12:00",
    });
    expect(await gateway.searchWorkspace("2026-11-05T10:00")).toEqual(
      expect.arrayContaining([expect.objectContaining({ recordId: item.id })]),
    );
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Ceramics workshop" },
    });
    const result = await screen.findByRole("button", {
      name: /Ceramics workshop.*Kyoto autumn journey/,
    });
    fireEvent.click(result);

    const target = await screen.findByTestId(
      `search-target-trip_item-${item.id}`,
    );
    await waitFor(() => expect(target).toHaveFocus());

    const custom = screen.getByLabelText("Custom item");
    const form = custom.closest("form")!;
    const add = within(form).getByRole("button", { name: "Add" });
    fireEvent.change(custom, { target: { value: "Revalidation marker" } });
    add.focus();
    fireEvent.click(add);
    await screen.findByText("Revalidation marker");
    expect(add).toHaveFocus();
  });

  /**
   * A search target is transient, but its owning section is durable navigation.
   *
   * Opening a Plan result from Visa used to focus the right record while
   * carrying `#section-visa` into the new URL. The target hid the conflict until
   * reload, when it disappeared and the stale hash moved the traveler back to
   * Visa. Keep the record id and query out of the URL, but make the section
   * truthful enough to survive reload.
   */
  it("writes the owning Plan section when a same-trip result opens", async () => {
    const gateway = createMockGateway();
    const item = await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Evening walk",
      location: "Gion",
      startAt: "2026-11-05T18:00",
      endAt: "2026-11-05T19:00",
    });
    const first = renderApp(gateway);
    await openFixtureTrip();
    window.history.replaceState(null, "", "/?trip=trip_kyoto#section-visa");

    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "Evening walk" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Evening walk.*Kyoto autumn journey/,
      }),
    );

    const target = await screen.findByTestId(
      `search-target-trip_item-${item.id}`,
    );
    await waitFor(() => expect(target).toHaveFocus());
    expect(window.location.search).toBe("?trip=trip_kyoto");
    expect(window.location.hash).toBe("#section-plan");
    expect(window.location.href).not.toContain(item.id);
    expect(window.location.href).not.toContain("Evening%20walk");

    // A reload rebuilds the view from the URL without a transient target. The
    // URL must therefore retain the truthful section on its own.
    first.unmount();
    renderApp(gateway);
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    expect(window.location.hash).toBe("#section-plan");
  });

  it("writes Prepare when a result opens a different trip's note", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_oslo", "Fjord museum ideas");
    renderApp(gateway);
    await openFixtureTrip();
    window.history.replaceState(null, "", "/?trip=trip_kyoto#section-visa");

    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "Fjord museum" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Archived Oslo notes.*Trip notes/,
      }),
    );

    await screen.findByRole("heading", {
      name: "Archived Oslo notes",
      level: 1,
    });
    await waitFor(() => expect(window.location.search).toBe("?trip=trip_oslo"));
    expect(window.location.hash).toBe("#section-prepare");
  });

  it("localizes product-owned result labels while preserving source text", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "Museo del papel");
    await gateway.downloadPack("trip_kyoto", "jp-kyoto");
    const weights = {
      food: 1,
      culture: 0.5,
      nature: 0.5,
      nightlife: 0.5,
      shopping: 0.5,
    };
    const recommendation = (
      await gateway.getRecommendations("trip_kyoto", weights)
    )[0];
    await gateway.savePlace({
      tripId: "trip_kyoto",
      recommendation,
      weights,
    });
    setLocalePreference("es");
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Buscar en el espacio de trabajo",
      }),
    );
    fireEvent.change(screen.getByLabelText("Buscar en todos los viajes"), {
      target: { value: "Museo" },
    });

    const result = (await screen.findByText("Kyoto autumn journey")).closest(
      "button",
    )!;
    expect(within(result).getAllByText("Notas del viaje")).toHaveLength(2);
    expect(within(result).queryByText("Trip notes")).not.toBeInTheDocument();
    expect(result.textContent).not.toContain("Trip notes");
    expect(
      (await gateway.searchWorkspace("Trip notes")).filter(
        (hit) => hit.source === "note",
      ),
    ).toHaveLength(0);
    expect(await gateway.searchWorkspace("propertyName")).toHaveLength(0);
    expect(await gateway.searchWorkspace("confirmationCode")).toHaveLength(0);
    expect(await gateway.searchWorkspace("Matches your interest")).toHaveLength(
      0,
    );
  });

  // The audit's gap #11: every flight and stay result was headed "Confirmed
  // fact", spending its one line on the word the interface already prints
  // beside it instead of naming which fact matched.
  it("names a confirmed-fact result with the traveler's own data", async () => {
    const gateway = createMockGateway();
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "FP18" },
    });

    // The headline names the fact; the raw matched text stays underneath as
    // the evidence for why it matched.
    const heading = await screen.findByText("ORD → HND");
    expect(heading.tagName).toBe("STRONG");
    const result = heading.closest("button")!;
    // The source kind is still stated, just no longer as the headline.
    expect(result.textContent).toContain("Confirmed fact");

    // The gateway carries identifying data, never a product noun.
    const hits = await gateway.searchWorkspace("FP18");
    const fact = hits.find((hit) => hit.source === "confirmed_fact")!;
    expect(fact.label).not.toBe("Confirmed fact");
    expect(fact.label).toBe("ORD → HND");
  });
});

/**
 * Every other top-level view — the trip list, a trip, Settings, the vault
 * unlock — hand-rolls its own `h1`. This one used `SectionTitle`, which renders
 * an `h2` because it titles sections inside a page, so the search view was the
 * only destination in the app with no top-level heading at all.
 *
 * Asserted on the level directly rather than through axe: `findA11yViolations`
 * runs axe against `document.body`, and axe skips page-level rules such as
 * `page-has-heading-one` when the context is not the whole document — so an
 * accessibility sweep would have gone on passing either way.
 */
describe("workspace search heading", () => {
  it("titles itself with the page's h1", async () => {
    renderApp(createMockGateway());
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));

    expect(
      await screen.findByRole("heading", {
        name: "Search workspace",
        level: 1,
      }),
    ).toBeInTheDocument();
  });

  it("offers a way forward when nothing matches", async () => {
    renderApp(createMockGateway());
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "zzzznotathing" },
    });

    expect(
      await screen.findByText("No matches in this workspace."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Search covers imported documents/),
    ).toBeInTheDocument();
  });
});
