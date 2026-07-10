import type { AppError } from "@voyalier/contracts";

import { createHttpGateway } from "./http";

/*
 * Runs the HTTP gateway against the real loopback core. Skipped unless
 * VITE_LIVE_API=1 — run at integration after Codex's core merges:
 *
 *   cargo run -p voyalier-server            # terminal 1
 *   VITE_LIVE_API=1 pnpm --filter @voyalier/web test gateway.live
 */
const LIVE = import.meta.env.VITE_LIVE_API === "1";
const BASE_URL =
  (import.meta.env.VITE_LIVE_API_URL as string | undefined) ??
  "http://127.0.0.1:8787";

describe.skipIf(!LIVE)("HTTP gateway against the live core", () => {
  const gateway = createHttpGateway({ baseUrl: BASE_URL });

  it("reports a healthy local core", async () => {
    const health = await gateway.health();
    expect(health.status).toBe("ok");
    expect(typeof health.version).toBe("string");
  });

  it("lists trips as an array of summaries", async () => {
    const trips = await gateway.listTrips();
    expect(Array.isArray(trips)).toBe(true);
  });

  it("returns a real AppError for a missing trip", async () => {
    let error: AppError | undefined;
    try {
      await gateway.getTrip("trip_does_not_exist");
    } catch (caught) {
      error = caught as AppError;
    }
    expect(error?.code).toBe("trip/not_found");
    expect(typeof error?.message).toBe("string");
  });

  it("round-trips a create → read → delete lifecycle", async () => {
    const trip = await gateway.createTrip({
      title: "Live gateway smoke",
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-05-01",
      endDate: "2027-05-08",
    });
    expect(trip.id).toBeTruthy();

    const detail = await gateway.getTrip(trip.id);
    expect(detail.trip.id).toBe(trip.id);

    await gateway.deleteTrip(trip.id);
    await expect(gateway.getTrip(trip.id)).rejects.toMatchObject({
      code: "trip/not_found",
    });
  });

  it("drives the full import → confirm → unconfirm → manual loop", async () => {
    // A JSON-LD FlightReservation the real parser extracts as a structured
    // flight candidate (verbatim local wall-clock times, no offset).
    const flightHtml = `<!doctype html><html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "FlightReservation",
        "reservationNumber": "SKY8KY",
        "underName": { "@type": "Person", "name": "Alex Example" },
        "reservationFor": {
          "@type": "Flight",
          "flightNumber": "412",
          "airline": { "@type": "Airline", "name": "Nimbus Air", "iataCode": "NB" },
          "departureAirport": { "@type": "Airport", "iataCode": "SFO" },
          "arrivalAirport": { "@type": "Airport", "iataCode": "NRT" },
          "departureTime": "2026-08-01T22:30",
          "arrivalTime": "2026-08-02T04:55"
        }
      }
      </script></head><body>Fictional booking only.</body></html>`;

    const trip = await gateway.createTrip({
      origin: "San Francisco",
      destination: "Tokyo",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
    });

    try {
      // Import → the real parser returns at least one structured flight.
      const imported = await gateway.importDocument({
        tripId: trip.id,
        kind: "html",
        label: "Flight confirmation",
        content: flightHtml,
      });
      expect(imported.candidates.length).toBeGreaterThan(0);
      const candidate = imported.candidates.find(
        (each) => each.factType === "flight_segment",
      );
      expect(candidate).toBeDefined();
      // Wall-clock time survives the round trip verbatim.
      expect(
        (candidate!.payload as { departureLocal?: string }).departureLocal,
      ).toBe("2026-08-01T22:30");

      // It shows up as pending, and its span excerpt is real evidence.
      const pending = await gateway.listCandidates(trip.id, "pending");
      expect(pending.some((each) => each.id === candidate!.id)).toBe(true);

      // Confirm (path id + body id must match — the server asserts it).
      const { confirmedFact } = await gateway.confirmCandidate({
        candidateId: candidate!.id,
      });
      expect(confirmedFact.factType).toBe("flight_segment");

      let detail = await gateway.getTrip(trip.id);
      expect(
        detail.confirmedFacts.some((fact) => fact.id === confirmedFact.id),
      ).toBe(true);

      // Unconfirm returns the candidate to pending.
      await gateway.unconfirmFact(confirmedFact.id);
      const afterUndo = await gateway.listCandidates(trip.id, "pending");
      expect(afterUndo.some((each) => each.id === candidate!.id)).toBe(true);

      // Manual add lands directly in the Blueprint.
      const manual = await gateway.addManualFact({
        tripId: trip.id,
        factType: "lodging_stay",
        payload: { propertyName: "Live Test Inn", checkinDate: "2026-08-02" },
      });
      detail = await gateway.getTrip(trip.id);
      expect(detail.confirmedFacts.some((fact) => fact.id === manual.id)).toBe(
        true,
      );
    } finally {
      await gateway.deleteTrip(trip.id);
    }
  });
});
