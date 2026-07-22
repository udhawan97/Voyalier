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
  it("explains the required text before either blank planning submission", async () => {
    renderApp(createMockGateway());
    await openKyoto();

    const packing = await screen.findByRole("region", {
      name: "Packing checklist",
    });
    const customInput = within(packing).getByLabelText("Custom item");
    const packingForm = customInput.closest("form")!;
    expect(
      within(packingForm).getByRole("button", { name: "Add" }),
    ).toBeDisabled();
    expect(
      within(packingForm).getByText("Enter an item to enable Add."),
    ).toBeVisible();

    fireEvent.change(customInput, { target: { value: "  Museum pass  " } });
    expect(
      within(packingForm).getByRole("button", { name: "Add" }),
    ).toBeEnabled();

    const items = screen.getByRole("region", {
      name: "Activities & transfers",
    });
    const name = within(items).getByLabelText("Name");
    fireEvent.submit(name.closest("form")!);

    expect(
      await within(items).findByText("Enter a name before adding this plan."),
    ).toHaveAttribute("role", "alert");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(name);

    fireEvent.change(name, { target: { value: "Tea ceremony" } });
    expect(
      within(items).queryByText("Enter a name before adding this plan."),
    ).not.toBeInTheDocument();
  });

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
    expect(tea.closest("li")).toHaveTextContent("Nov 5, 2026 · 10:00");
    expect(tea.closest("li")).not.toHaveTextContent("2026-11-05T10:00");
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
    const recommendation = (
      await gateway.getRecommendations("trip_kyoto", {
        food: 1,
        culture: 0.5,
        nature: 0.5,
        nightlife: 0.5,
        shopping: 0.5,
      })
    )[0];
    const weights = {
      food: 1,
      culture: 0.5,
      nature: 0.5,
      nightlife: 0.5,
      shopping: 0.5,
    };
    const savedRecord = await gateway.savePlace({
      tripId: "trip_kyoto",
      recommendation: {
        ...recommendation,
        source: "Forged source",
        license: "Forged license",
        reasons: ["Forged reason"],
      },
      weights,
    });
    expect(savedRecord).toMatchObject({
      source: "Overture Maps",
      license: "CDLA-Permissive-2.0",
      reasons: recommendation.reasons,
    });
    const duplicate = await gateway.savePlace({
      tripId: "trip_kyoto",
      recommendation: {
        ...recommendation,
        name: recommendation.name.toLowerCase(),
      },
      weights,
    });
    expect(duplicate.id).toBe(savedRecord.id);
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
    expect(
      detail.tripItems.find((item) => item.title.includes("breakfast")),
    ).toMatchObject({ savedPlaceId: expect.any(String) });
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

  it("requires a deliberate second click before deleting planning records", async () => {
    const gateway = createMockGateway();
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
    await gateway.addPackingItem({
      tripId: "trip_kyoto",
      label: "Paper tickets",
    });
    await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "rail",
      title: "Airport express",
    });
    renderApp(gateway);
    await openKyoto();

    for (const name of [
      `Remove ${recommendation.name}`,
      "Remove Paper tickets",
      "Remove Airport express",
    ]) {
      const remove = screen.getByRole("button", { name });
      fireEvent.click(remove);
      expect(
        screen.getByRole("button", { name: `${name} — sure?` }),
      ).toBeInTheDocument();
      expect(screen.getByText(name.replace("Remove ", ""))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: `${name} — sure?` }));
      await waitFor(() =>
        expect(
          screen.queryByText(name.replace("Remove ", "")),
        ).not.toBeInTheDocument(),
      );
    }
  });

  // The audit's gap #2: killing the engine mid-action left a bare error line
  // floating after every planning card, the topbar still claiming "Ready", and
  // no way to retry. The recovery machinery existed; this panel just never
  // joined it.
  it("reports a failed planning write at its own section, with a retry", async () => {
    let fail = true;
    // One mock instance: the retry has to land in the same workspace the view
    // reads back from, or the assertion passes for the wrong reason.
    const mock = createMockGateway();
    renderApp({
      ...mock,
      addPackingItem: (input) =>
        fail
          ? Promise.reject({
              code: "transport/failure",
              message: "The local core could not be reached.",
            })
          : mock.addPackingItem(input),
    });
    await openKyoto();

    const packing = await screen.findByRole("region", {
      name: "Packing checklist",
    });
    const customInput = within(packing).getByLabelText("Custom item");
    fireEvent.change(customInput, { target: { value: "Rain jacket" } });
    fireEvent.click(
      within(customInput.closest("form")!).getByRole("button", { name: "Add" }),
    );

    // The failure is owned by the section whose control failed.
    const alert = await within(packing).findByRole("alert");
    expect(alert).toHaveTextContent(/engine/i);
    // The typed value survives a failed write.
    expect((customInput as HTMLInputElement).value).toBe("Rain jacket");
    // And the app-level status stops claiming everything is fine.
    expect(await screen.findByText("Offline")).toBeInTheDocument();

    // One click retries the same write once the engine is back.
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await within(packing).findByText("Rain jacket")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(packing).queryByRole("alert")).toBeNull(),
    );
  });
});
