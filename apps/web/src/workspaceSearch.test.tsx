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
import { renderApp } from "./test/helpers";

describe("workspace search", () => {
  afterEach(() => setLocalePreference("en"));

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
