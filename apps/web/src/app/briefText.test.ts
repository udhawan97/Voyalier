import type { TripBrief } from "@voyalier/contracts";

import { buildBriefText, type BriefTextLabels } from "./briefText";

const labels: BriefTextLabels = {
  flights: "Flights",
  stays: "Stays",
  journeys: "Journeys",
  plans: "Plans",
  journey: "Surface journey",
  empty: "Nothing confirmed yet.",
  redaction: (fields) => `Hidden: ${fields.join(", ")}.`,
};

function brief(overrides: Partial<TripBrief> = {}): TripBrief {
  return {
    title: "Kyoto autumn journey",
    origin: "Chicago",
    destination: "Kyoto",
    startDate: "2026-11-03",
    endDate: "2026-11-10",
    flights: [],
    stays: [],
    journeys: [],
    tripItems: [],
    redactedFields: ["Confirmation codes", "Traveler names"],
    generatedAt: "2026-08-25T12:00:00Z",
    ...overrides,
  };
}

describe("redacted brief text", () => {
  it("formats the route, safe facts, journeys, and traveler plans", () => {
    const output = buildBriefText(
      brief({
        flights: [
          {
            flightNumber: "FP18",
            departureAirportIata: "ORD",
            arrivalAirportIata: "HND",
          },
        ],
        journeys: [
          {
            serviceNumber: "NX41",
            departurePlace: "Haneda",
            arrivalPlace: "Kyoto",
          },
        ],
        tripItems: [
          {
            id: "plan_1",
            kind: "activity",
            title: "Tea ceremony",
            location: "Gion",
            startAt: "2026-11-05T10:00",
          },
        ],
      }),
      labels,
    );

    expect(output).toContain("Chicago → Kyoto");
    expect(output).toContain("Flight FP18");
    expect(output).toContain("NX41");
    expect(output).toContain("Tea ceremony");
    expect(output).toContain("Hidden: Confirmation codes, Traveler names.");
  });

  it("does not read secret fields even if a malformed caller supplies them", () => {
    const output = buildBriefText(
      brief({
        flights: [
          {
            flightNumber: "FP18",
            confirmationCode: "SECRET-PNR",
            passengerName: "Jamie Traveler",
          },
        ],
        tripItems: [
          {
            id: "plan_1",
            kind: "activity",
            title: "Museum",
            notes: "Private medical detail",
          } as never,
        ],
      }),
      labels,
    );

    expect(output).not.toContain("SECRET-PNR");
    expect(output).not.toContain("Jamie Traveler");
    expect(output).not.toContain("Private medical detail");
  });

  it("uses supplied localized section and empty-state labels", () => {
    const output = buildBriefText(brief({ redactedFields: [] }), {
      ...labels,
      flights: "Vuelos",
      empty: "Todavía no hay planes confirmados.",
    });

    expect(output).toContain("Todavía no hay planes confirmados.");
    expect(output).not.toContain("Nothing confirmed yet.");
  });
});
