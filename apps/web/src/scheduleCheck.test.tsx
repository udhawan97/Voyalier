import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Schedule check is the deterministic, advisory itinerary review. The seeded
 * Kyoto trip has one confirmed flight and one stay that starts a night after the
 * trip begins, so the first night is an expected lodging gap.
 */
describe("schedule check", () => {
  it("surfaces the seeded lodging gap as a notice in the Blueprint", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });

    const schedule = await screen.findByRole("region", {
      name: "Schedule check",
    });
    expect(
      within(schedule).getByText(
        /No lodging is booked for the night of 2026-11-03/,
      ),
    ).toBeInTheDocument();
    expect(within(schedule).getByText("Notice")).toBeInTheDocument();
  });

  it("flags two overlapping flights as a warning through the gateway", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-03",
    });
    await gateway.addManualFact({
      tripId: trip.id,
      factType: "flight_segment",
      payload: {
        flightNumber: "AA1",
        departureLocal: "2027-04-01T09:00",
        arrivalLocal: "2027-04-01T13:00",
      },
    });
    await gateway.addManualFact({
      tripId: trip.id,
      factType: "flight_segment",
      payload: {
        flightNumber: "BB2",
        departureLocal: "2027-04-01T12:00",
        arrivalLocal: "2027-04-01T16:00",
      },
    });

    const detail = await gateway.getTrip(trip.id);
    const overlap = detail.itineraryConflicts.find(
      (conflict) => conflict.kind === "flight_overlap",
    );
    expect(overlap?.severity).toBe("warning");
    expect(overlap?.factIds).toHaveLength(2);
  });

  it("reports no conflicts for a fully-covered single-stay trip", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
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
    expect(detail.itineraryConflicts).toHaveLength(0);
  });
});
