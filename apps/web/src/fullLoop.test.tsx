import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The whole loop against the stateful mock: create a trip, open the seeded
 * Kyoto Blueprint, import a document, review a suggestion, confirm it, watch the
 * Blueprint and pending count update, then unconfirm and watch them revert.
 */
describe("full trip loop", () => {
  it("creates, imports, reviews, confirms, and unconfirms", async () => {
    renderApp(createMockGateway());

    // --- Trip list: seeded fixtures load ---
    const kyotoCard = await screen.findByRole("button", {
      name: "Open Kyoto autumn journey",
    });
    expect(kyotoCard).toBeInTheDocument();
    expect(
      screen.getByLabelText("3 pending suggestions"),
    ).toBeInTheDocument();

    // --- Create a trip ---
    fireEvent.click(screen.getByRole("button", { name: "Create a trip" }));
    const createDialog = await screen.findByRole("dialog", {
      name: "Create a trip",
    });
    fireEvent.change(within(createDialog).getByLabelText("From"), {
      target: { value: "Chicago" },
    });
    fireEvent.change(within(createDialog).getByLabelText("To"), {
      target: { value: "Rome" },
    });
    fireEvent.change(within(createDialog).getByLabelText("Start date"), {
      target: { value: "2027-06-01" },
    });
    fireEvent.change(within(createDialog).getByLabelText("End date"), {
      target: { value: "2027-06-05" },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create trip" }));

    expect(
      await screen.findByRole("button", { name: "Open Chicago → Rome" }),
    ).toBeInTheDocument();

    // --- Open the Kyoto Blueprint ---
    fireEvent.click(
      screen.getByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Kyoto autumn journey",
        level: 1,
      }),
    ).toBeInTheDocument();
    // Seeded confirmed facts appear in the Blueprint.
    expect(await screen.findByText("Flight FP18")).toBeInTheDocument();
    expect(
      screen.getByText("River Paper Inn", { selector: ".voy-fact__title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Review 3 suggestions/ }),
    ).toBeInTheDocument();

    // --- Import a document (mock yields no candidates) ---
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const importDialog = await screen.findByRole("dialog", {
      name: "Import a document",
    });
    fireEvent.change(within(importDialog).getByLabelText("Content"), {
      target: { value: "Booking confirmation: nothing structured here." },
    });
    fireEvent.click(within(importDialog).getByRole("button", { name: "Import" }));
    expect(
      await screen.findByText(/No new suggestions were found/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // --- Review and confirm the clean flight candidate ---
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    );
    const reviewDialog = await screen.findByRole("dialog", {
      name: "Review suggestions",
    });
    const flightCard = within(reviewDialog)
      .getByText("Flight NS204")
      .closest("li") as HTMLElement;
    fireEvent.click(within(flightCard).getByRole("button", { name: "Confirm" }));

    // Queue shrinks to two remaining.
    await waitFor(() =>
      expect(
        within(reviewDialog).getByText(/2 suggestions to review/),
      ).toBeInTheDocument(),
    );
    fireEvent.click(within(reviewDialog).getByRole("button", { name: "Close" }));

    // --- Blueprint reflects the new confirmed fact and lower pending count ---
    expect(await screen.findByText("Flight NS204")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Review 2 suggestions/ }),
    ).toBeInTheDocument();

    // --- Unconfirm it: fact leaves, pending count reverts ---
    const ns204Fact = screen
      .getByText("Flight NS204")
      .closest("article") as HTMLElement;
    fireEvent.click(within(ns204Fact).getByRole("button", { name: "Unconfirm" }));

    await waitFor(() =>
      expect(screen.queryByText("Flight NS204")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    ).toBeInTheDocument();
  });
});
