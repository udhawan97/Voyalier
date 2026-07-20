import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

async function openKyoto() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
}

describe("traveler-owned planning workflows", () => {
  it("adds checklist items explicitly and keeps manual activities out of confirmed facts", async () => {
    renderApp(createMockGateway());
    await openKyoto();

    const packing = await screen.findByRole("region", {
      name: "Packing checklist",
    });
    fireEvent.change(within(packing).getByLabelText("Custom item"), {
      target: { value: "Museum pass" },
    });
    fireEvent.click(within(packing).getByRole("button", { name: "Add" }));
    const checkbox = await within(packing).findByRole("checkbox", {
      name: "Museum pass",
    });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Museum pass" }),
      ).toBeChecked(),
    );
    fireEvent.click(
      within(packing).getByRole("button", { name: "Rename Museum pass" }),
    );
    fireEvent.change(within(packing).getByLabelText("Packing item name"), {
      target: { value: "Museum and rail passes" },
    });
    fireEvent.click(
      within(packing).getByRole("button", { name: "Save packing item" }),
    );
    expect(
      await within(packing).findByRole("checkbox", {
        name: "Museum and rail passes",
      }),
    ).toBeChecked();

    const items = screen.getByRole("region", {
      name: "Activities & transfers",
    });
    fireEvent.change(within(items).getByLabelText("Name"), {
      target: { value: "Tea ceremony" },
    });
    fireEvent.change(within(items).getByLabelText("Location (optional)"), {
      target: { value: "Gion" },
    });
    fireEvent.change(within(items).getByLabelText("Start (optional)"), {
      target: { value: "2026-11-05T10:00" },
    });
    fireEvent.change(within(items).getByLabelText("End (optional)"), {
      target: { value: "2026-11-05T12:00" },
    });
    fireEvent.click(within(items).getByRole("button", { name: "Add to plan" }));
    const tea = await within(items).findByText("Tea ceremony");
    fireEvent.click(
      within(tea.closest("li")!).getByRole("button", {
        name: "Edit Tea ceremony",
      }),
    );
    fireEvent.change(within(items).getByLabelText("Name"), {
      target: { value: "Private tea ceremony" },
    });
    fireEvent.click(
      within(items).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await within(items).findByText("Private tea ceremony"),
    ).toBeInTheDocument();

    fireEvent.change(within(items).getByLabelText("Name"), {
      target: { value: "Museum visit" },
    });
    fireEvent.change(within(items).getByLabelText("Start (optional)"), {
      target: { value: "2026-11-05T11:00" },
    });
    fireEvent.change(within(items).getByLabelText("End (optional)"), {
      target: { value: "2026-11-05T13:00" },
    });
    fireEvent.click(within(items).getByRole("button", { name: "Add to plan" }));
    expect(
      await screen.findByText(/Private tea ceremony.*Museum visit.*overlap/),
    ).toBeInTheDocument();

    fireEvent.change(within(items).getByLabelText("Name"), {
      target: { value: "Airport transfer" },
    });
    fireEvent.change(within(items).getByLabelText("Start (optional)"), {
      target: { value: "2026-11-03T10:00" },
    });
    fireEvent.change(within(items).getByLabelText("End (optional)"), {
      target: { value: "2026-11-03T13:00" },
    });
    fireEvent.click(within(items).getByRole("button", { name: "Add to plan" }));
    expect(
      await screen.findByText(
        (content) =>
          content.includes("Airport transfer") && content.includes("FP18"),
      ),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole("region", { name: "Today" })).findByText(
        /Airport transfer.*10:00/,
      ),
    ).toBeInTheDocument();

    // The confirmed itinerary is unchanged: manual plans use their own record
    // type and never inherit booking authority.
    expect(screen.queryByText("Flight Tea ceremony")).not.toBeInTheDocument();
  });

  it("prefills a saved place without writing until the traveler submits", async () => {
    const gateway = createMockGateway();
    await gateway.downloadPack("trip_kyoto", "jp-kyoto");
    const recommendation = (await gateway.getRecommendations("trip_kyoto", {
      food: 1,
      culture: 0.5,
      nature: 0.5,
      nightlife: 0.5,
      shopping: 0.5,
    }))[0];
    await gateway.savePlace({
      tripId: "trip_kyoto",
      recommendation,
    });
    renderApp(gateway);
    await openKyoto();

    const saved = screen.getByRole("region", { name: "Saved places" });
    const place = (await within(saved).findByText(recommendation.name)).closest(
      "li",
    )!;
    fireEvent.click(
      within(place).getByRole("button", {
        name: `Add ${recommendation.name} to plan`,
      }),
    );

    const items = screen.getByRole("region", {
      name: "Activities & transfers",
    });
    expect(within(items).getByLabelText("Name")).toHaveValue(
      recommendation.name,
    );
    expect(
      within(items).queryByText(recommendation.name),
    ).not.toBeInTheDocument();

    fireEvent.click(within(items).getByRole("button", { name: "Add to plan" }));
    const planned = await within(items).findByText(recommendation.name);
    fireEvent.click(
      within(planned.closest("li")!).getByRole("button", {
        name: `Edit ${recommendation.name}`,
      }),
    );
    fireEvent.change(within(items).getByLabelText("Name"), {
      target: { value: `${recommendation.name} breakfast` },
    });
    fireEvent.click(
      within(items).getByRole("button", { name: "Save changes" }),
    );

    const detail = await gateway.getTrip("trip_kyoto");
    expect(detail.tripItems.find((item) => item.title.includes("breakfast")))
      .toMatchObject({ savedPlaceId: expect.any(String) });
  });

  it("offers brief and calendar checkpoints for a manual-only trip", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Paris",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });
    await gateway.createTripItem({
      tripId: trip.id,
      kind: "activity",
      title: "Traveler-authored walk",
      startAt: "2027-04-02T09:00",
      endAt: "2027-04-02T10:00",
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: `Open ${trip.title}` }),
    );

    expect(
      await screen.findByRole("button", { name: "Share brief" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export calendar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Schedule check" }),
    ).toBeInTheDocument();
  });
});
