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
    expect(within(readiness).getByText("Check soon")).toBeInTheDocument();
    expect(
      within(readiness).getByText(
        /Some nights in your trip have no lodging booked/,
      ),
    ).toBeInTheDocument();
    // Disclaimer appears on both the entry item and the scope line.
    expect(
      within(readiness).getAllByText(/never asserts\s+or clears entry/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("links entry requirements to official sources without asserting them", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const readiness = await screen.findByRole("region", { name: "Readiness" });

    // Both link-only reference items are labeled as the traveler's own check.
    expect(
      within(readiness).getByText("Entry & travel requirements"),
    ).toBeInTheDocument();
    expect(within(readiness).getByText("Health notices")).toBeInTheDocument();
    expect(within(readiness).getAllByText(/Check yourself/)).toHaveLength(2);

    // Curated official links (entry + health) open externally.
    const fcdo = within(readiness).getByRole("link", {
      name: /UK FCDO travel advice/,
    });
    expect(fcdo).toHaveAttribute(
      "href",
      "https://www.gov.uk/foreign-travel-advice",
    );
    expect(fcdo).toHaveAttribute("target", "_blank");
    expect(fcdo.getAttribute("rel")).toContain("noopener");

    const cdc = within(readiness).getByRole("link", {
      name: /US CDC — Travelers' Health/,
    });
    expect(cdc).toHaveAttribute(
      "href",
      "https://wwwnc.cdc.gov/travel/destinations/list",
    );
  });

  it("pluralizes a finding's count in the interface, not the core", async () => {
    // The core reports {code, count}; the sentence is built here. The core used
    // to decide this with format!("{singular}s"), which no locale but English
    // can follow.
    const gateway = createMockGateway();
    const [seeded] = await gateway.listTrips();
    const pendingCandidates = await gateway.listCandidates(
      seeded.id,
      "pending",
    );
    expect(pendingCandidates.length).toBeGreaterThan(1);

    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: `Open ${seeded.title}` }),
    );
    const readiness = await screen.findByRole("region", { name: "Readiness" });
    expect(
      within(readiness).getByText(
        `${pendingCandidates.length} imported suggestions waiting for review.`,
      ),
    ).toBeInTheDocument();
  });

  it("reads a single pending suggestion in the singular", async () => {
    const gateway = createMockGateway();
    const [seeded] = await gateway.listTrips();
    const pendingCandidates = await gateway.listCandidates(
      seeded.id,
      "pending",
    );
    // Resolve all but one, so the count crosses into the singular form.
    for (const candidate of pendingCandidates.slice(1)) {
      await gateway.rejectCandidate(candidate.id);
    }

    const detail = await gateway.getTrip(seeded.id);
    const pending = detail.readiness.items.find(
      (item) => item.id === "pending_review",
    );
    // The core's half of the contract: a finding and a number, no words.
    expect(pending?.finding).toEqual({ code: "pending_review", count: 1 });

    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: `Open ${seeded.title}` }),
    );
    const readiness = await screen.findByRole("region", { name: "Readiness" });
    expect(
      within(readiness).getByText("1 imported suggestion waiting for review."),
    ).toBeInTheDocument();
  });

  it("keeps the overall rollup unaffected by the link-only entry item", async () => {
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
    const entry = detail.readiness.items.find(
      (item) => item.id === "entry_requirements",
    );
    expect(entry?.status).toBe("not_checked");
    expect(entry?.links?.length).toBeGreaterThan(0);
    // Entry item is NotChecked, yet the covered/reviewed plan stays clear.
    expect(detail.readiness.status).toBe("clear");
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
