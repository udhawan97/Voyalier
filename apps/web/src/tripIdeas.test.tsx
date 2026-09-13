import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

describe("undated trip ideas", () => {
  it("saves Chicago to Montréal without dates, then converts it explicitly", async () => {
    const gateway = createMockGateway();
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a trip" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("From"), {
      target: { value: "Chicago" },
    });
    fireEvent.change(within(dialog).getByLabelText("To"), {
      target: { value: "Montréal" },
    });
    fireEvent.change(within(dialog).getByLabelText("Travelers"), {
      target: { value: "4" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save trip idea" }),
    );

    const idea = await screen.findByRole("heading", {
      name: "Chicago → Montréal",
    });
    const card = idea.closest("article")!;
    expect(within(card).getByText("Dates undecided")).toBeInTheDocument();
    expect(
      within(card).getByText(/No inventory or availability search/),
    ).toBeInTheDocument();
    expect(await gateway.listTripIntents()).toHaveLength(1);

    fireEvent.change(within(card).getByLabelText("Start"), {
      target: { value: "2027-05-01" },
    });
    fireEvent.change(within(card).getByLabelText("End"), {
      target: { value: "2027-05-08" },
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "Build dated trip" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Chicago → Montréal",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(await gateway.listTripIntents()).toHaveLength(0);
    const trips = await gateway.listTrips();
    const converted = trips.find((trip) => trip.destination === "Montréal")!;
    const workspace = await gateway.getConciergeWorkspace(converted.id);
    expect(workspace.profile.preferences.partySize).toBe(4);
  });
});
