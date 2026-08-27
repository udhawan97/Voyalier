import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { renderApp } from "./test/helpers";

/**
 * The playbook states exposure and stops.
 *
 * The fixture Kyoto trip lands at 16:05 and boards a train at 16:50, so there is
 * a real 45-minute hand-off to talk about without inventing a defect.
 */
describe("disruption playbook", () => {
  afterEach(() => setLocalePreference("en"));

  async function openPlaybook() {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    return screen.findByRole("region", { name: "If something slips" });
  }

  it("reports the real slack and names the leg it comes off", async () => {
    const panel = await openPlaybook();
    expect(within(panel).getByText("Recorded gap: 45 min")).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/tight|comfortable|ample/i);
    expect(
      within(panel).getByText(/between Flight FP18 and Train NX41/),
    ).toBeInTheDocument();
  });

  it("opens each record behind a hand-off", async () => {
    const panel = await openPlaybook();
    const handoff = within(panel)
      .getByText(/between Flight FP18 and Train NX41/)
      .closest("li");
    expect(handoff).not.toBeNull();
    const actions = within(handoff!).getAllByRole("button");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toHaveAccessibleName("Show record: Flight FP18");
    expect(actions[1]).toHaveAccessibleName("Show record: Train NX41");
    expect(actions.every((action) => action.tabIndex === 0)).toBe(true);
    fireEvent.click(
      within(handoff!).getByRole("button", {
        name: "Show record: Flight FP18",
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "confirmed_fact",
      ),
    );
    expect(document.activeElement).toHaveTextContent("FP18");

    fireEvent.click(
      within(handoff!).getByRole("button", {
        name: "Show record: Train NX41",
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveTextContent("NX41"),
    );
  });

  it("opens the exposed leg's record without predicting lateness", async () => {
    const panel = await openPlaybook();
    const exposed = within(panel)
      .getByText(/nearest hand-off recorded after Flight FP18 has a 45 min gap/)
      .closest("li");
    expect(exposed).not.toBeNull();
    fireEvent.click(
      within(exposed!).getByRole("button", {
        name: "Show record: Flight FP18",
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveTextContent("FP18"),
    );
    expect(
      within(panel).getAllByRole("button", {
        name: "Show record: Flight FP18",
      }).length,
    ).toBeGreaterThan(1);
  });

  it("opens an operator record without inventing contact details", async () => {
    const panel = await openPlaybook();
    // Every pointer is about something the traveler already holds — one per
    // operator their own confirmations name, and nothing else.
    const carriers = within(panel).getAllByText(
      /is the operator recorded on this fact/,
    );
    expect(carriers).toHaveLength(2);
    expect(carriers[0].textContent).toMatch(/Fictional Pacific/);
    expect(carriers[1].textContent).toMatch(/Fictional Rail/);
    // The whole point of ADR-0016 §3: no curated carrier contact channel.
    expect(within(panel).queryByRole("link")).toBeNull();
    const railPointer = carriers[1].closest("li");
    expect(railPointer).not.toBeNull();
    fireEvent.click(
      within(railPointer!).getByRole("button", {
        name: "Show record: Fictional Rail",
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveTextContent("NX41"),
    );
    // And no language that implies another service exists or that it will be OK.
    expect(panel.textContent).not.toMatch(
      /instead|rebook|alternative route|you'?ll be fine|phone|number that reaches/i,
    );
  });

  it("keeps geography and diplomatic pointers as text-only context", async () => {
    const base = createMockGateway();
    const gateway = {
      ...base,
      getTrip: async (tripId: string) => {
        const detail = await base.getTrip(tripId);
        return {
          ...detail,
          disruptionPlan: {
            ...detail.disruptionPlan,
            pointers: [
              ...detail.disruptionPlan.pointers,
              {
                code: "alternate_airport" as const,
                name: "Osaka Itami Airport",
                iata: "ITM",
                distanceKm: 38,
              },
              {
                code: "diplomatic_mission" as const,
                sendingCountry: "United States",
                hostCountry: "Japan",
                city: "Tokyo",
                kind: "embassy" as const,
              },
            ],
          },
        };
      },
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const panel = await screen.findByRole("region", {
      name: "If something slips",
    });

    const airport = within(panel)
      .getByText(/Geography only/)
      .closest("li");
    const mission = within(panel)
      .getByText(/foreign ministry before going/)
      .closest("li");
    expect(airport).not.toBeNull();
    expect(mission).not.toBeNull();
    expect(within(airport!).queryByRole("button")).toBeNull();
    expect(within(mission!).queryByRole("button")).toBeNull();
  });

  it("localizes confirmation actions while preserving source values", async () => {
    class NeverIntersects {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", NeverIntersects);
    setLocalePreference("es");
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Abrir Kyoto autumn journey" }),
    );
    const panel = await screen.findByRole("region", {
      name: "Si algo se retrasa",
    });
    expect(
      within(panel).getAllByRole("button", {
        name: "Mostrar registro: Vuelo FP18",
      }).length,
    ).toBeGreaterThan(1);
  });

  it("falls back honestly when a projected confirmation disappeared", async () => {
    const base = createMockGateway();
    const initial = await base.getTrip("trip_kyoto");
    const missingId = initial.disruptionPlan.handoffs[0].fromFactId;
    const gateway = {
      ...base,
      getTrip: async (tripId: string) => {
        const detail = await base.getTrip(tripId);
        return {
          ...detail,
          confirmedFacts: detail.confirmedFacts.filter(
            (fact) => fact.id !== missingId,
          ),
        };
      },
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const panel = await screen.findByRole("region", {
      name: "If something slips",
    });
    const handoff = within(panel)
      .getByText(/between Flight FP18 and Train NX41/)
      .closest("li");
    expect(handoff).not.toBeNull();
    fireEvent.click(
      within(handoff!).getByRole("button", {
        name: "Show record: Flight FP18",
      }),
    );

    await waitFor(
      () => expect(document.getElementById("blueprint-title")).toHaveFocus(),
      { timeout: 2_000 },
    );
    expect(
      screen.getByText(
        "That confirmed reservation is no longer available. Blueprint opened.",
      ),
    ).toBeInTheDocument();
    expect(globalThis.location.href).not.toContain(missingId);
  });

  it("is advisory — it raises no readiness action", async () => {
    await openPlaybook();
    const readiness = await screen.findByRole("region", { name: "Readiness" });
    expect(within(readiness).queryByText(/If something slips/)).toBeNull();
  });
});
