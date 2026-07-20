import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

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
    renderApp(createMockGateway());

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

    // Itinerary detail is present in the brief.
    expect(await within(dialog).findByText("Flight FP18")).toBeInTheDocument();
    expect(within(dialog).getByText("River Paper Inn")).toBeInTheDocument();

    // Secrets are excluded from the brief (scoped to the dialog — the Blueprint
    // behind it still shows the traveler their own codes).
    expect(within(dialog).queryByText(/VOY182/)).toBeNull();
    expect(within(dialog).queryByText(/RPI731/)).toBeNull();

    // The redaction is disclosed.
    expect(
      within(dialog).getByText(/Hidden from this brief/),
    ).toBeInTheDocument();
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
