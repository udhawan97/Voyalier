import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  createMockGateway,
  type AppGateway,
  type ItineraryConflict,
} from "@voyalier/contracts";
import { vi } from "vitest";

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

  it("jumps from a planned-item conflict to each traveler-authored plan", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-03",
    });
    const morning = await gateway.createTripItem({
      tripId: trip.id,
      kind: "activity",
      title: "Morning museum",
      startAt: "2027-04-02T09:00",
      endAt: "2027-04-02T12:00",
    });
    await gateway.createTripItem({
      tripId: trip.id,
      kind: "activity",
      title: "Market walk",
      startAt: "2027-04-02T11:00",
      endAt: "2027-04-02T13:00",
    });

    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: `Open ${trip.title}` }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Morning museum" }),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId(`search-target-trip_item-${morning.id}`),
      ),
    );
  });

  it("falls back to the named plan heading when a conflict target disappeared", async () => {
    const gateway = createMockGateway();
    const getTrip = gateway.getTrip.bind(gateway);
    vi.spyOn(gateway, "getTrip").mockImplementation(async (tripId) => {
      const detail = await getTrip(tripId);
      const stale: ItineraryConflict = {
        kind: "planned_item_overlap",
        severity: "notice",
        factIds: [],
        subjects: [],
        plannedItemIds: ["stale_first", "stale_second"],
        plannedItemTitles: ["Morning museum", "Market walk"],
      };
      return { ...detail, itineraryConflicts: [stale] };
    });

    renderApp(gateway as AppGateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Morning museum" }),
    );

    const fallback = document.getElementById("manual-plan-title")!;
    await waitFor(() => expect(document.activeElement).toBe(fallback), {
      timeout: 1_500,
    });
    expect(document.body).toHaveTextContent(
      "That trip item is no longer available. Trip plan opened.",
    );
    expect(document.body).not.toHaveTextContent("stale_first");
  });
});
