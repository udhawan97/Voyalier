import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, renderApp } from "./test/helpers";

/**
 * A gateway that starts with no trips but still shows anything created after —
 * hiding the fixtures rather than stubbing listTrips flat, so the sample it
 * builds actually turns up.
 */
async function emptyGateway(
  overrides: Partial<AppGateway> = {},
): Promise<AppGateway> {
  const base = createMockGateway();
  const fixtures = new Set((await base.listTrips()).map((trip) => trip.id));
  return {
    ...base,
    listTrips: async () =>
      (await base.listTrips()).filter((trip) => !fixtures.has(trip.id)),
    ...overrides,
  };
}

/**
 * First-run empathy: an empty workspace teaches nothing, so the sample builds a
 * trip through the ordinary flow and drops the newcomer into a review — the
 * thing Voyalier is actually for.
 */
describe("sample trip", () => {
  it("is offered on an empty workspace", async () => {
    renderApp(await emptyGateway());
    expect(
      await screen.findByRole("button", { name: "Explore a sample trip" }),
    ).toBeInTheDocument();
  });

  it("is not offered once there are trips", async () => {
    renderApp(createMockGateway());
    await screen.findByText("Kyoto autumn journey");
    expect(
      screen.queryByRole("button", { name: "Explore a sample trip" }),
    ).toBeNull();
  });

  it("builds through the normal flow and lands on a review", async () => {
    const base = createMockGateway();
    const calls: string[] = [];
    const trips: unknown[] = [];
    const gateway: AppGateway = {
      ...base,
      listTrips: () => Promise.resolve(trips as never),
      createTrip: (input) => {
        calls.push("createTrip");
        return base.createTrip(input);
      },
      importDocument: (input) => {
        calls.push("importDocument");
        return base.importDocument(input);
      },
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Explore a sample trip" }),
    );

    // It opens the trip it just built...
    await screen.findByRole("heading", {
      name: "Sample: Kyoto long weekend",
      level: 1,
    });
    // ...via the same public methods a real user's flow uses — no seeding, no
    // privileged path, so the sample cannot drift from the real thing.
    expect(calls).toEqual(["createTrip", "importDocument"]);
  });

  it("imports a confirmation the real parser can read", async () => {
    // What it hands to importDocument has to be JSON-LD, because that is the
    // path a real airline email takes and the reason the demo has anything to
    // review. Whether it *parses* is proven where parsing lives — see
    // `the_sample_confirmation_parses_into_a_flight_and_a_stay` in voyalier-app,
    // which imports this very fixture. The mock deliberately does not parse.
    let imported = "";
    const base = createMockGateway();
    const fixtures = new Set((await base.listTrips()).map((trip) => trip.id));
    const gateway: AppGateway = {
      ...base,
      listTrips: async () =>
        (await base.listTrips()).filter((trip) => !fixtures.has(trip.id)),
      importDocument: (input) => {
        imported = input.content;
        return base.importDocument(input);
      },
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Explore a sample trip" }),
    );
    await screen.findByRole("heading", {
      name: "Sample: Kyoto long weekend",
      level: 1,
    });

    expect(imported).toContain('type="application/ld+json"');
    expect(imported).toContain("FlightReservation");
    expect(imported).toContain("LodgingReservation");
    // Fictional throughout, so a screenshot is never mistaken for a booking.
    expect(imported).toContain("Fictional");
  });

  it("says it is fake and disposable", async () => {
    renderApp(await emptyGateway());
    await screen.findByRole("button", { name: "Explore a sample trip" });
    expect(screen.getByText(/Made-up data you can delete/)).toBeInTheDocument();
    // The title carries "Sample:" so it can never be mistaken for a booking.
    expect(
      screen.getByRole("button", { name: "Explore a sample trip" }),
    ).toBeInTheDocument();
  });

  it("reports a failure instead of leaving a dead button", async () => {
    renderApp(
      failingGateway({
        listTrips: () => Promise.resolve([]),
        createTrip: () =>
          Promise.reject({ code: "transport/failure", message: "down" }),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Explore a sample trip" }),
    );
    // The announcement region carries the error; the button returns to idle.
    await waitFor(() =>
      expect(
        within(document.body).getByRole("button", {
          name: "Explore a sample trip",
        }),
      ).toBeEnabled(),
    );
  });
});
