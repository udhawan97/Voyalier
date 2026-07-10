import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ImportResult } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, makeCandidate, renderApp } from "./test/helpers";

async function openKyotoReview() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Review 3 suggestions/ }),
  );
  return screen.findByRole("dialog", { name: "Review suggestions" });
}

function cardByTitle(dialog: HTMLElement, title: string): HTMLElement {
  return within(dialog)
    .getByText(title, { selector: ".voy-review__title" })
    .closest("li") as HTMLElement;
}

describe("review hardening", () => {
  it("opens review with the freshly imported candidates, not the reloaded pending list", async () => {
    // The imported candidate is distinct from anything in the mock store, so it
    // can only appear if the dialog receives the import result directly (the
    // fix), rather than the trip's reloaded pending list.
    const imported = makeCandidate(0, {
      id: "candidate_freshly_imported",
      tripId: "trip_kyoto",
    });
    const result: ImportResult = {
      document: {
        id: "document_new",
        tripId: "trip_kyoto",
        kind: "html",
        label: "Imported HTML",
        contentHash: "hash",
        charCount: 42,
        importedAt: "2026-07-10T12:00:05Z",
      },
      parserRunId: "parser_run_new",
      candidates: [imported],
    };
    const gateway = failingGateway({
      importDocument: () => Promise.resolve(result),
    });

    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const importDialog = await screen.findByRole("dialog", {
      name: "Import a document",
    });
    fireEvent.change(within(importDialog).getByLabelText("Content"), {
      target: { value: "<html>fixture</html>" },
    });
    fireEvent.click(within(importDialog).getByRole("button", { name: "Import" }));

    const reviewButton = await screen.findByRole("button", {
      name: /Review 1 suggestion/,
    });
    fireEvent.click(reviewButton);

    const reviewDialog = await screen.findByRole("dialog", {
      name: "Review suggestions",
    });
    // makeCandidate(0) → flight "SY100"; present only because it was passed through.
    expect(within(reviewDialog).getByText("Flight SY100")).toBeInTheDocument();
  });

  it("disables the other actions while a confirm is in flight", async () => {
    const gateway = createMockGateway({ latencyMs: 40 });
    renderApp(gateway);
    const dialog = await openKyotoReview();
    const flightCard = cardByTitle(dialog, "Flight NS204");

    fireEvent.click(within(flightCard).getByRole("button", { name: "Confirm" }));

    // Mid-flight: the sibling actions must not be clickable.
    expect(within(flightCard).getByRole("button", { name: "Dismiss" })).toBeDisabled();
    expect(
      within(flightCard).getByRole("button", { name: "Edit & confirm" }),
    ).toBeDisabled();

    // Let it settle so the queue shrinks and no act() warning leaks.
    await waitFor(() =>
      expect(
        within(dialog).getByText(/2 suggestions to review/),
      ).toBeInTheDocument(),
    );
  });

  it("keeps focus on the next card even when it is mid-edit", async () => {
    renderApp();
    const dialog = await openKyotoReview();

    // Put the second card (lodging) into edit mode first.
    const lodgingCard = cardByTitle(dialog, "Maple Lantern House");
    fireEvent.click(
      within(lodgingCard).getByRole("button", { name: "Edit & confirm" }),
    );
    const saveButton = within(lodgingCard).getByRole("button", {
      name: "Save & confirm",
    });

    // Resolve the first card; focus should land on the next card's primary
    // button, which is now "Save & confirm" (not a missing "Confirm").
    const flightCard = cardByTitle(dialog, "Flight NS204");
    fireEvent.click(within(flightCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(document.activeElement).toBe(saveButton));
  });

  it("links the start-date field to the date-range error for screen readers", async () => {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Create a trip" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a trip" });
    fireEvent.change(within(dialog).getByLabelText("From"), {
      target: { value: "Chicago" },
    });
    fireEvent.change(within(dialog).getByLabelText("To"), {
      target: { value: "Kyoto" },
    });
    // Leave dates empty → dates error fires on submit.
    fireEvent.click(within(dialog).getByRole("button", { name: "Create trip" }));

    const start = await within(dialog).findByLabelText("Start date");
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(start).toHaveAttribute("aria-describedby", "trip-end-error");
    expect(within(dialog).getByRole("alert")).toHaveAttribute(
      "id",
      "trip-end-error",
    );
  });
});
