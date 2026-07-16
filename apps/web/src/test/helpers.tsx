import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { AppError, AppGateway, CandidateFact } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { App } from "../App";

/**
 * Run axe-core over the whole test document and return readable summaries of any
 * accessibility violations. Dialogs render in a portal on `document.body`, so
 * scanning the body catches them too. `color-contrast` is disabled because jsdom
 * computes no layout or colors; the document language is set to match the
 * production `index.html` so the harness itself is not flagged.
 */
export async function findA11yViolations(): Promise<string[]> {
  document.documentElement.lang = "en";
  const results = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n  ` +
      violation.nodes.map((node) => node.target.join(" ")).join("\n  "),
  );
}

/** Render the whole app against a gateway (a fresh mock by default). */
export function renderApp(gateway: AppGateway = createMockGateway()) {
  return render(<App gateway={gateway} />);
}

/**
 * Render the app and land on Settings, which is where every workspace-wide panel
 * lives (Appearance, the three AI panels, Updates, Encryption). Reaching them via
 * the topbar gear is the only route a user has, so tests take it too.
 */
export async function renderSettings(
  gateway: AppGateway = createMockGateway(),
) {
  const view = renderApp(gateway);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings", level: 1 });
  return view;
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
        fieldPath:
          index % 2 === 0 ? "payload.flightNumber" : "payload.propertyName",
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
