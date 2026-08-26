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
        stays: [
          {
            propertyName: "Paper Lantern Inn",
            address: "Gion, Kyoto",
            checkinDate: "2026-11-03",
            checkoutDate: "2026-11-10",
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
          {
            id: "plan_2",
            kind: "activity",
            title: "Undated garden idea",
            location: "Northern Kyoto",
          },
        ],
      }),
      labels,
    );

    expect(output).toContain("Chicago → Kyoto");
    expect(output).toContain("Flight FP18");
    expect(output).toContain("Paper Lantern Inn");
    expect(output).toContain("NX41");
    expect(output).toContain("Tea ceremony");
    expect(output).toContain("Undated garden idea");
    expect(output).toContain("Hidden: Confirmation codes, Traveler names.");
  });

  it("does not read secret fields even if a malformed caller supplies them", () => {
    const malformed = brief({
      flights: [
        {
          flightNumber: "FP18",
          confirmationCode: "SECRET-PNR",
          passengerName: "Jamie Traveler",
        },
      ],
      stays: [
        {
          propertyName: "Paper Lantern Inn",
          confirmationCode: "STAY-SECRET",
          passengerName: "Another Traveler",
        } as never,
      ],
      tripItems: [
        {
          id: "plan_1",
          kind: "activity",
          title: "Museum",
          notes: "Private medical detail",
        } as never,
      ],
    }) as TripBrief & {
      importedDocumentText: string;
      privateTripNotes: string;
      resources: Array<{ content: string }>;
    };
    malformed.importedDocumentText = "Imported private body";
    malformed.privateTripNotes = "Private top-level note";
    malformed.resources = [{ content: "Saved resource body" }];
    const output = buildBriefText(malformed, labels);

    expect(output).not.toContain("SECRET-PNR");
    expect(output).not.toContain("Jamie Traveler");
    expect(output).not.toContain("Private medical detail");
    expect(output).not.toContain("STAY-SECRET");
    expect(output).not.toContain("Another Traveler");
    expect(output).not.toContain("Imported private body");
    expect(output).not.toContain("Private top-level note");
    expect(output).not.toContain("Saved resource body");
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
