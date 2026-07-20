import { act, fireEvent, screen, within } from "@testing-library/react";
import type { WorkspaceSearchHit } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

describe("workspace search", () => {
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
});
