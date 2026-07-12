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
