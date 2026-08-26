import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";
import { vi } from "vitest";

import { setLocalePreference } from "./app/locale";
import { renderApp } from "./test/helpers";

/**
 * The shareable brief is produced already-redacted by the gateway. The seeded
 * Kyoto facts carry confirmation codes (VOY182, RPI731) that must never appear
 * in the brief, even though the traveler's own Blueprint behind it still shows
 * them.
 */
describe("shareable brief", () => {
  afterEach(() => setLocalePreference("en"));

  it("renders a redacted brief with confirmation codes removed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const gateway = createMockGateway();
    const getTripBrief = vi.spyOn(gateway, "getTripBrief");
    renderApp(gateway);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Share brief" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Shareable brief",
    });
    expect(getTripBrief).toHaveBeenCalledTimes(1);

    // Itinerary detail is present in the brief.
    expect(await within(dialog).findByText("Flight FP18")).toBeInTheDocument();
    expect(within(dialog).getByText("River Paper Inn")).toBeInTheDocument();
    expect(within(dialog).getByText("NX41")).toBeInTheDocument();

    // Secrets are excluded from the brief (scoped to the dialog — the Blueprint
    // behind it still shows the traveler their own codes).
    expect(within(dialog).queryByText(/VOY182/)).toBeNull();
    expect(within(dialog).queryByText(/RPI731/)).toBeNull();

    // The redaction is disclosed.
    expect(
      within(dialog).getByText(/Hidden from this brief/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy brief" }));
    expect(
      await within(dialog).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("NX41");
    expect(copied).not.toContain("VOY182");
    expect(copied).not.toContain("RAIL55");
    expect(getTripBrief).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable clipboard without claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Share brief" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Shareable brief",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy brief" }));
    expect(
      within(dialog).getByText(/Clipboard access is unavailable/),
    ).toHaveAttribute("role", "status");
    expect(within(dialog).queryByRole("button", { name: "Copied" })).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Print / Save as PDF" }),
    ).toBeEnabled();
  });

  it("reports a denied clipboard write without claiming success", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Share brief" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Shareable brief",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy brief" }));
    expect(
      await within(dialog).findByText(/Clipboard access is unavailable/),
    ).toHaveAttribute("role", "status");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByRole("button", { name: "Copied" })).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Print / Save as PDF" }),
    ).toBeEnabled();
  });

  it("excludes traveler names and confirmation codes at the gateway", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });
    await gateway.addManualFact({
      tripId: trip.id,
      factType: "flight_segment",
      payload: {
        flightNumber: "AA1",
        departureLocal: "2027-04-01T09:00",
        confirmationCode: "SECRET-PNR",
        passengerName: "Jamie Traveler",
      },
    });

    const brief = await gateway.getTripBrief(trip.id);
    const serialized = JSON.stringify(brief);
    expect(serialized).not.toContain("SECRET-PNR");
    expect(serialized).not.toContain("Jamie Traveler");
    expect(serialized).toContain("AA1");
    expect(brief.redactedFields).toContain("Confirmation codes");
  });

  it("localizes the redaction disclosure without changing source data", async () => {
    setLocalePreference("es");
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir Kyoto autumn journey",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Compartir resumen" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Resumen para compartir",
    });
    expect(
      within(dialog).getByText(
        /Oculto en este resumen: códigos de confirmación, nombres de los viajeros\./,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Confirmation codes/)).toBeNull();
  });
});
