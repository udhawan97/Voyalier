import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";
import { describe, expect, it, vi } from "vitest";

import { GatewayContext } from "./app/context";
import { ImportDialog } from "./views/ImportDialog";

describe("ImportDialog — email format", () => {
  it("offers an Email format with its own hint and sends kind=email", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-10",
    });
    const importSpy = vi.spyOn(gateway, "importDocument");

    render(
      <GatewayContext.Provider value={gateway}>
        <ImportDialog
          tripId={trip.id}
          onClose={() => {}}
          onImported={() => {}}
          onReview={() => {}}
        />
      </GatewayContext.Provider>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Email" }));
    // Selecting Email swaps in the email-specific placeholder.
    const field = screen.getByPlaceholderText(
      /Paste the whole confirmation email/,
    );
    fireEvent.change(field, {
      target: {
        value:
          "From: a@b.com\r\nSubject: Flight\r\nContent-Type: text/plain\r\n\r\nConfirmation CODE7\nRoute SFO-NRT",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(importSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "email" }),
      ),
    );
  });

  it("keeps Import disabled until there is something to import", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-10",
    });

    render(
      <GatewayContext.Provider value={gateway}>
        <ImportDialog
          tripId={trip.id}
          onClose={() => {}}
          onImported={() => {}}
          onReview={() => {}}
        />
      </GatewayContext.Provider>,
    );

    const importButton = screen.getByRole("button", { name: "Import" });
    // Empty form: the button is disabled, so it can't look clickable-but-dead.
    expect(importButton).toBeDisabled();
    // A file picker is offered alongside pasting.
    expect(
      screen.getByRole("button", { name: "Choose a file" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "Confirmation content." },
    });
    expect(importButton).toBeEnabled();

    // Whitespace-only content does not count.
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "   " },
    });
    expect(importButton).toBeDisabled();
  });

  it("loads a chosen file on-device, inferring the format from its extension", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-10",
    });
    const importSpy = vi.spyOn(gateway, "importDocument");

    render(
      <GatewayContext.Provider value={gateway}>
        <ImportDialog
          tripId={trip.id}
          onClose={() => {}}
          onImported={() => {}}
          onReview={() => {}}
        />
      </GatewayContext.Provider>,
    );

    // The dialog portals to document.body, so query the document.
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(
      [
        "From: a@b.com\r\nSubject: Flight\r\nContent-Type: text/plain\r\n\r\nConfirmation CODE7",
      ],
      "booking.eml",
      { type: "message/rfc822" },
    );
    fireEvent.change(fileInput, { target: { files: [file] } });

    // The file's text lands in the same content area; format infers to Email.
    const content =
      await screen.findByLabelText<HTMLTextAreaElement>("Content");
    await waitFor(() => expect(content.value).toContain("CODE7"));
    expect(screen.getByRole("radio", { name: "Email" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(importSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "email", content: expect.any(String) }),
      ),
    );
  });
});

describe("ImportDialog — the audited repairs", () => {
  async function mount(overrides: Record<string, unknown> = {}) {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "London",
      destination: "Tokyo",
      startDate: "2026-10-12",
      endDate: "2026-10-22",
    });
    render(
      <GatewayContext.Provider value={gateway}>
        <ImportDialog
          tripId={trip.id}
          onClose={() => {}}
          onImported={() => {}}
          onReview={() => {}}
          onAddByHand={() => {}}
          {...overrides}
        />
      </GatewayContext.Provider>,
    );
    return { gateway, trip };
  }

  it("moves the traveler to the reason a duplicate import did nothing", async () => {
    const { gateway, trip } = await mount();
    const content = "Confirmation DUPE1\nRoute SFO-NRT";
    await gateway.importDocument({
      tripId: trip.id,
      kind: "pasted_text",
      content,
    });

    fireEvent.change(screen.getByLabelText(/Content/), {
      target: { value: content },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    // The banner renders at the top of a body the traveler may have scrolled
    // past, so appearing is not enough — focus has to land on it.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Already imported");
    await waitFor(() =>
      expect(document.activeElement?.contains(alert)).toBe(true),
    );
  });

  it("offers to read a pasted booking page as HTML rather than switching it", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/Content/), {
      target: {
        value:
          '<html><body><div class="seg">Flight</div><script type="application/ld+json">{"@type":"FlightReservation"}</script></body></html>',
      },
    });

    // Offered — the format still says Plain text until the traveler agrees,
    // because the format chooses the parser.
    expect(screen.getByRole("radio", { name: "Plain text" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Read it as HTML" }));
    expect(screen.getByRole("radio", { name: "HTML" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("counts a label the way the rest of the app counts, and says when it is too long", async () => {
    await mount();
    // Content first: Import is also disabled while the document is empty, and
    // this test is about the label.
    fireEvent.change(screen.getByLabelText(/Content/), {
      target: { value: "Confirmation ABC123" },
    });
    const label = screen.getByLabelText(/Label/);
    // 200 astral characters: 400 UTF-16 code units, which the browser's own
    // maxLength would have cut in half without a word.
    fireEvent.change(label, { target: { value: "🌍".repeat(200) } });

    expect((label as HTMLInputElement).value).toHaveLength(400);
    expect(screen.queryByText(/Shorten the label/)).toBeNull();
    expect(screen.getByRole("button", { name: "Import" })).not.toBeDisabled();

    fireEvent.change(label, { target: { value: "🌍".repeat(201) } });
    expect(screen.getByText(/Shorten the label/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("offers a way onward when a document yields nothing", async () => {
    const onAddByHand = vi.fn();
    await mount({ onAddByHand });
    fireEvent.change(screen.getByLabelText(/Content/), {
      target: { value: "Just checking in about our plans. Nothing booked." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText(/No new suggestions were found/);
    fireEvent.click(
      screen.getByRole("button", { name: /Add a flight or stay by hand/ }),
    );
    expect(onAddByHand).toHaveBeenCalled();
  });
});
