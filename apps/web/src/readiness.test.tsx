import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Readiness is the deterministic plan-completeness rollup (logistics only). The
 * seeded Kyoto trip has a lodging gap and three pending suggestions, so it reads
 * as "Worth a look" rather than clear.
 */
describe("readiness", () => {
  it("summarizes the seeded Kyoto plan as worth a look", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });

    const readiness = await screen.findByRole("region", { name: "Readiness" });
    expect(within(readiness).getByText("Worth a look")).toBeInTheDocument();
    expect(
      within(readiness).getByText(
        /Some nights in your trip have no lodging booked/,
      ),
    ).toBeInTheDocument();
    // Scope disclaimer keeps this distinct from sourced entry/health readiness.
    expect(
      within(readiness).getByText(/Entry rules, health, and safety readiness/),
    ).toBeInTheDocument();
  });

  it("reads as on track for a fully-covered, reviewed trip via the gateway", async () => {
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
        arrivalLocal: "2027-04-01T12:00",
      },
    });
    await gateway.addManualFact({
      tripId: trip.id,
      factType: "lodging_stay",
      payload: {
        propertyName: "Test Inn",
        checkinDate: "2027-04-01",
        checkoutDate: "2027-04-05",
      },
    });

    const detail = await gateway.getTrip(trip.id);
    expect(detail.readiness.status).toBe("clear");
  });

  it("escalates to needs-attention when flights overlap", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-03",
    });
    for (const [departure, arrival] of [
      ["2027-04-01T09:00", "2027-04-01T13:00"],
      ["2027-04-01T12:00", "2027-04-01T16:00"],
    ]) {
      await gateway.addManualFact({
        tripId: trip.id,
        factType: "flight_segment",
        payload: { departureLocal: departure, arrivalLocal: arrival },
      });
    }

    const detail = await gateway.getTrip(trip.id);
    expect(detail.readiness.status).toBe("action_needed");
  });
});
