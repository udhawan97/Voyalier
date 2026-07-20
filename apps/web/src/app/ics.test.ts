import type { TripBrief } from "@voyalier/contracts";

import { buildIcs, icsFilename } from "./ics";

const LABELS = {
  flightSummary: (flight: string) => `Flight ${flight}`,
  staySummary: (property: string) => `Stay — ${property}`,
  description: "Exported from Voyalier.",
};

function brief(overrides: Partial<TripBrief> = {}): TripBrief {
  return {
    title: "Kyoto autumn journey",
    origin: "Chicago",
    destination: "Kyoto",
    startDate: "2026-11-03",
    endDate: "2026-11-12",
    flights: [
      {
        airlineName: "Fictional Pacific",
        flightNumber: "FP18",
        departureAirportIata: "ORD",
        arrivalAirportIata: "NRT",
        departureLocal: "2026-11-03T11:20",
        arrivalLocal: "2026-11-04T15:10",
      },
    ],
    stays: [
      {
        propertyName: "River Paper Inn",
        address: "9 Fictional Street, Kyoto",
        checkinDate: "2026-11-04",
        checkoutDate: "2026-11-10",
      },
    ],
    tripItems: [],
    redactedFields: ["Confirmation codes", "Traveler names"],
    generatedAt: "2026-07-10T12:00:00Z",
    ...overrides,
  };
}

describe("calendar export", () => {
  it("writes a well-formed calendar with CRLF endings", () => {
    const ics = buildIcs(brief(), LABELS);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    // Every line break is CRLF, never a bare LF.
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("writes flight times as floating local, with no timezone invented", () => {
    const ics = buildIcs(brief(), LABELS);
    expect(ics).toContain("DTSTART:20261103T112000");
    expect(ics).toContain("DTEND:20261104T151000");
    // The confirmation gave a wall clock and no zone, so the file must not
    // claim UTC (a trailing Z) or guess a TZID.
    expect(ics).not.toContain("DTSTART:20261103T112000Z");
    expect(ics).not.toContain("TZID");
  });

  it("writes a stay as all-day dates covering the checkout day", () => {
    const ics = buildIcs(brief(), LABELS);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261104");
    // You are still at the hotel on checkout morning, so the block should cover
    // Nov 4 through Nov 10 inclusive — and an all-day DTEND is exclusive, so it
    // is written as the 11th. Writing the 10th would end the block a day early.
    expect(ics).toContain("DTEND;VALUE=DATE:20261111");
  });

  it("never carries a confirmation code or traveler name", () => {
    // The brief model has no field for them at all — this asserts the export
    // reads the brief and not something that could reintroduce one.
    const ics = buildIcs(brief(), LABELS);
    expect(ics).not.toMatch(/KY7M2Q|confirmationCode|passengerName|guestName/i);
  });

  it("exports scheduled manual items without their private notes", () => {
    const ics = buildIcs(
      brief({
        tripItems: [
          {
            id: "item_1",
            kind: "activity",
            title: "Tea ceremony",
            location: "Gion",
            startAt: "2026-11-05T15:00",
            endAt: "2026-11-05T16:00",
          },
        ],
      }),
      LABELS,
    );
    expect(ics).toContain("SUMMARY:Tea ceremony");
    expect(ics).toContain("DTSTART:20261105T150000");
    expect(ics).toContain("LOCATION:Gion");
    expect(ics).not.toContain("PRIVATE ACCESS CODE");
  });

  it("escapes text that would otherwise break the format", () => {
    const ics = buildIcs(
      brief({
        stays: [
          {
            propertyName: "Inn; the Best, really",
            address: "1 Back\\slash Lane\nSecond line",
            checkinDate: "2026-11-04",
            checkoutDate: "2026-11-05",
          },
        ],
      }),
      LABELS,
    );
    expect(ics).toContain("Inn\\; the Best\\, really");
    expect(ics).toContain("1 Back\\\\slash Lane\\nSecond line");
  });

  it("folds a long line and keeps continuations", () => {
    const ics = buildIcs(
      brief({
        stays: [
          {
            propertyName: "A".repeat(200),
            checkinDate: "2026-11-04",
            checkoutDate: "2026-11-05",
          },
        ],
      }),
      LABELS,
    );
    // No line may exceed 75 octets, and folded lines resume with a space.
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain("\r\n ");
  });

  it("skips entries it cannot place rather than inventing a time", () => {
    const ics = buildIcs(
      brief({
        flights: [
          { airlineName: "No Times Air", flightNumber: "NT1" },
          {
            flightNumber: "FP18",
            departureLocal: "2026-11-03T11:20",
          },
        ],
        stays: [{ propertyName: "Undated Inn" }],
      }),
      LABELS,
    );
    // Only the flight that has a departure becomes an event.
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("No Times Air");
    expect(ics).not.toContain("Undated Inn");
  });

  it("derives a safe filename from the title", () => {
    expect(icsFilename("Kyoto autumn journey")).toBe(
      "kyoto-autumn-journey.ics",
    );
    expect(icsFilename("Trip: Paris / Nice!")).toBe("trip-paris-nice.ics");
    // A title with nothing usable still yields a valid name.
    expect(icsFilename("???")).toBe("trip.ics");
  });
});
