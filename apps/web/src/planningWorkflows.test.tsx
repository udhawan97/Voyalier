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
      within(tea.closest("li")!).getByRole("button", { name: "Edit" }),
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

    // The confirmed itinerary is unchanged: manual plans use their own record
    // type and never inherit booking authority.
    expect(screen.queryByText("Flight Tea ceremony")).not.toBeInTheDocument();
  });
});
