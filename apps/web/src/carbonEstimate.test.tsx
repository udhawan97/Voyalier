import { screen } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The flight carbon estimate sits under the Blueprint's flights, computed
 * offline from their airport codes. The distinction the panel has to keep is
 * between an estimate that covers every flight and one that had to skip some —
 * a partial total presented as a whole one is the failure mode worth testing.
 */
describe("flight carbon estimate", () => {
  async function openTrip(gateway = createMockGateway()) {
    renderApp(gateway);
    (
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" })
    ).click();
    return screen.findByRole("heading", { name: "Blueprint" });
  }

  it("estimates the trip's flights and says what the number is", async () => {
    await openTrip();
    const estimate = await screen.findByText(/kg CO₂e for/);
    // A number, a flight count, and a distance — not a bare figure.
    expect(estimate).toHaveTextContent(/About [\d,]+ kg CO₂e for \d+ flights?/);
    expect(estimate).toHaveTextContent(/km/);

    // Always labelled an estimate, and the factor year is named so a stale
    // conversion factor is visible rather than silent.
    expect(screen.getByText(/Rough estimate/)).toHaveTextContent(
      /DESNZ 2026 average-passenger factors/,
    );
  });

  it("says the total is a floor when a flight could not be resolved", async () => {
    const gateway = createMockGateway();
    const trips = await gateway.listTrips();
    const trip = trips.find((candidate) => candidate.title.includes("Kyoto"))!;
    // A confirmed flight with no airport codes at all: it cannot be measured,
    // and the estimate beside it must not quietly stay a whole-trip number.
    await gateway.addManualFact({
      tripId: trip.id,
      factType: "flight_segment",
      payload: { flightNumber: "XX1" },
    });

    await openTrip(gateway);
    expect(
      await screen.findByText(/is not included|are not included/),
    ).toHaveTextContent(/the total is a floor/);
  });
});
