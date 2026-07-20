import { fireEvent, screen, within } from "@testing-library/react";

import { failingGateway, rejectWith, renderApp } from "./test/helpers";

async function openKyoto() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
}

async function fillAndSubmitCreate() {
  fireEvent.click(await screen.findByRole("button", { name: "Create a trip" }));
  const dialog = await screen.findByRole("dialog", { name: "Create a trip" });
  fireEvent.change(within(dialog).getByLabelText("From"), {
    target: { value: "Chicago" },
  });
  fireEvent.change(within(dialog).getByLabelText("To"), {
    target: { value: "Kyoto" },
  });
  fireEvent.change(within(dialog).getByLabelText("Start date"), {
    target: { value: "2027-06-01" },
  });
  fireEvent.change(within(dialog).getByLabelText("End date"), {
    target: { value: "2027-06-05" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create trip" }));
  return dialog;
}

async function submitImport() {
  fireEvent.click(await screen.findByRole("button", { name: "Import" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Import a document",
  });
  fireEvent.change(within(dialog).getByLabelText("Content"), {
    target: { value: "Some confirmation content." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
  return dialog;
}

describe("AppError rendered states", () => {
  it("validation/invalid_input maps to the offending field", async () => {
    renderApp(
      failingGateway({
        createTrip: rejectWith({
          code: "validation/invalid_input",
          message: "origin must be between 1 and 120 characters",
          details: { field: "origin" },
        }),
      }),
    );
    await fillAndSubmitCreate();
    expect(
      await screen.findByText("Enter a valid trip origin."),
    ).toBeInTheDocument();
  });

  it("validation/invalid_date_range renders on the date fields", async () => {
    renderApp(
      failingGateway({
        createTrip: rejectWith({
          code: "validation/invalid_date_range",
          message: "startDate must be on or before endDate",
        }),
      }),
    );
    await fillAndSubmitCreate();
    expect(
      await screen.findByText("Use a valid date range with the start first."),
    ).toBeInTheDocument();
  });

  it("trip/not_found shows a recovery state in the Blueprint", async () => {
    renderApp(
      failingGateway({
        getTrip: rejectWith({ code: "trip/not_found", message: "gone" }),
      }),
    );
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" });
    fireEvent.click(
      screen.getByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    expect(
      await screen.findByText("This trip is no longer here"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to trips" }),
    ).toBeInTheDocument();
  });

  it("candidate/not_found surfaces on the review card", async () => {
    renderApp(
      failingGateway({
        confirmCandidate: rejectWith({
          code: "candidate/not_found",
          message: "missing",
        }),
      }),
    );
    await openKyoto();
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review suggestions",
    });
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Confirm" })[0],
    );
    expect(
      await within(dialog).findByText("This suggestion is no longer here"),
    ).toBeInTheDocument();
  });

  it("candidate/already_resolved surfaces on dismiss", async () => {
    renderApp(
      failingGateway({
        rejectCandidate: rejectWith({
          code: "candidate/already_resolved",
          message: "resolved",
        }),
      }),
    );
    await openKyoto();
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review suggestions",
    });
    // Dismiss is a two-step confirm: arm, then confirm.
    const dismiss = within(dialog).getAllByRole("button", {
      name: "Dismiss",
    })[0];
    fireEvent.click(dismiss);
    fireEvent.click(dismiss);
    expect(
      await within(dialog).findByText("Already resolved"),
    ).toBeInTheDocument();
  });

  it("shows a failed archive on the trip list too, not just to the reader", async () => {
    renderApp(
      failingGateway({
        archiveTrip: rejectWith({ code: "storage/failure", message: "disk" }),
      }),
    );
    const card = (
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" })
    ).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Archive" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Local storage is unavailable");
  });

  it("shows a failed archive to the eye, not just the screen reader", async () => {
    // These header actions used to only announce their failures, so a sighted
    // user watched the button un-busy itself and saw nothing.
    renderApp(
      failingGateway({
        archiveTrip: rejectWith({ code: "storage/failure", message: "disk" }),
      }),
    );
    await openKyoto();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Local storage is unavailable");
  });

  it("fact/not_found is announced when unconfirming", async () => {
    renderApp(
      failingGateway({
        unconfirmFact: rejectWith({ code: "fact/not_found", message: "gone" }),
      }),
    );
    await openKyoto();
    const factCard = (await screen.findByText("Flight FP18")).closest(
      "article",
    ) as HTMLElement;
    // FP18 is a hand-entered (manual) fact, so the action is a "Remove" that
    // takes a two-step confirm (arm, then confirm).
    const remove = within(factCard).getByRole("button", { name: "Remove" });
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(
      await screen.findByText("This fact is no longer here"),
    ).toBeInTheDocument();
  });

  it("document/too_large renders inline in import", async () => {
    renderApp(
      failingGateway({
        importDocument: rejectWith({
          code: "document/too_large",
          message: "too big",
        }),
      }),
    );
    await openKyoto();
    await submitImport();
    expect(
      await screen.findByText(/over the 1,000,000 character limit/),
    ).toBeInTheDocument();
  });

  it("document/duplicate warns without exposing the internal document id", async () => {
    renderApp(
      failingGateway({
        importDocument: rejectWith({
          code: "document/duplicate",
          message: "dupe",
          details: { existingDocumentId: "document_kyoto_confirmations" },
        }),
      }),
    );
    await openKyoto();
    await submitImport();
    expect(await screen.findByText("Already imported")).toBeInTheDocument();
    // The internal document id is a debug token and must not reach the user.
    expect(
      screen.queryByText(/document_kyoto_confirmations/),
    ).not.toBeInTheDocument();
  });

  it("document/empty renders inline in import", async () => {
    renderApp(
      failingGateway({
        importDocument: rejectWith({
          code: "document/empty",
          message: "empty",
        }),
      }),
    );
    await openKyoto();
    await submitImport();
    expect(
      await screen.findByText("The pasted content was empty."),
    ).toBeInTheDocument();
  });

  it("storage/failure renders a retryable banner on the trip list", async () => {
    renderApp(
      failingGateway({
        listTrips: rejectWith({ code: "storage/failure", message: "disk" }),
      }),
    );
    expect(
      await screen.findByText("Local storage is unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("transport/failure shows the offline banner", async () => {
    renderApp(
      failingGateway({
        health: rejectWith({ code: "transport/failure", message: "down" }),
      }),
    );
    expect(
      await screen.findByText("Voyalier can't reach its engine"),
    ).toBeInTheDocument();
  });

  it("internal/unexpected renders a generic recovery banner", async () => {
    renderApp(
      failingGateway({
        listTrips: rejectWith({
          code: "internal/unexpected",
          message: "boom",
        }),
      }),
    );
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});
