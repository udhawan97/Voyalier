import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * "Find in this trip" is deterministic local search over stored documents and
 * confirmed facts, with provenance on every hit.
 */
describe("trip search", () => {
  it("finds a confirmed fact and labels its provenance", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const search = await screen.findByRole("region", {
      name: "Find in this trip",
    });

    fireEvent.change(
      within(search).getByLabelText(
        "Search your documents and confirmed plans",
      ),
      { target: { value: "paper" } },
    );
    fireEvent.click(within(search).getByRole("button", { name: "Search" }));

    const results = await within(search).findByRole("list", {
      name: "Search results",
    });
    // Label and snippet can both carry the name when the name itself matched.
    expect(
      within(results).getAllByText("River Paper Inn").length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(results).getByText(/confirmed plan/)).toBeInTheDocument();
  });

  it("shows a friendly empty state and validates blank queries", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const search = await screen.findByRole("region", {
      name: "Find in this trip",
    });
    const input = within(search).getByLabelText(
      "Search your documents and confirmed plans",
    );

    // Blank query is caught client-side.
    fireEvent.click(within(search).getByRole("button", { name: "Search" }));
    expect(
      await within(search).findByText("Type something to search for."),
    ).toBeInTheDocument();

    // A query with no matches reports plainly.
    fireEvent.change(input, { target: { value: "zeppelin" } });
    fireEvent.click(within(search).getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(
        within(search).getByText(/No matches for “zeppelin”/),
      ).toBeInTheDocument(),
    );
  });

  it("finds imported document content through the gateway", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });
    await gateway.importDocument({
      tripId: trip.id,
      kind: "pasted_text",
      label: "Hotel email",
      content: "The airport shuttle leaves every 30 minutes from door 4.",
    });

    const hits = await gateway.searchTrip(trip.id, "shuttle");
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe("document");
    expect(hits[0].label).toBe("Hotel email");
    expect(hits[0].snippet).toContain("shuttle leaves");
  });
});
