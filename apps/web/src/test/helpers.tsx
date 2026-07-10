import { render } from "@testing-library/react";
import type { AppError, AppGateway, CandidateFact } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { App } from "../App";

/** Render the whole app against a gateway (a fresh mock by default). */
export function renderApp(gateway: AppGateway = createMockGateway()) {
  return render(<App gateway={gateway} />);
}

/** A mock gateway with specific operations overridden to reject. */
export function failingGateway(overrides: Partial<AppGateway>): AppGateway {
  return { ...createMockGateway(), ...overrides };
}

export function rejectWith(error: AppError): () => Promise<never> {
  return () => Promise.reject(error);
}

/** Build a synthetic pending candidate for perf/injection scenarios. */
export function makeCandidate(
  index: number,
  overrides: Partial<CandidateFact> = {},
): CandidateFact {
  return {
    id: `candidate_synth_${index}`,
    tripId: "trip_kyoto",
    documentId: "document_synth",
    parserRunId: "parser_run_synth",
    factType: index % 2 === 0 ? "flight_segment" : "lodging_stay",
    payload:
      index % 2 === 0
        ? {
            airlineName: "Synthetic Air",
            flightNumber: `SY${100 + index}`,
            departureAirportIata: "ORD",
            arrivalAirportIata: "NRT",
            departureLocal: "2026-11-03T10:00",
            arrivalLocal: "2026-11-04T14:00",
            confirmationCode: `CODE${index}`,
          }
        : {
            propertyName: `Synthetic Inn ${index}`,
            address: `${index} Test Street`,
            checkinDate: "2026-11-04",
            checkoutDate: "2026-11-10",
          },
    method: index % 3 === 0 ? "inferred" : "structured",
    fieldSpans: [
      {
        fieldPath: index % 2 === 0 ? "payload.flightNumber" : "payload.propertyName",
        start: 0,
        end: 5,
        excerpt: `Evidence excerpt for candidate ${index}.`,
      },
    ],
    warnings: index % 4 === 0 ? ["missing_dates"] : [],
    status: "pending",
    createdAt: "2026-07-09T15:20:00Z",
    resolvedAt: null,
    ...overrides,
  };
}
