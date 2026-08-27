import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The playbook states exposure and stops.
 *
 * The fixture Kyoto trip lands at 16:05 and boards a train at 16:50, so there is
 * a real 45-minute hand-off to talk about without inventing a defect.
 */
describe("disruption playbook", () => {
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
    expect(within(panel).getByText("45 min")).toBeInTheDocument();
    // 45 minutes off a flight is tight; the band is secondary to the number.
    expect(within(panel).getByText("tight")).toBeInTheDocument();
    expect(
      within(panel).getByText(/between Flight FP18 and Train NX41/),
    ).toBeInTheDocument();
  });

  it("opens each confirmation behind a hand-off", async () => {
    const panel = await openPlaybook();
    const handoff = within(panel)
      .getByText(/between Flight FP18 and Train NX41/)
      .closest("li");
    expect(handoff).not.toBeNull();
    fireEvent.click(
      within(handoff!).getByRole("button", {
        name: "Show confirmation: Flight FP18",
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
        name: "Show confirmation: Train NX41",
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveTextContent("NX41"),
    );
  });

  it("says what is stacked behind the exposed leg", async () => {
    const panel = await openPlaybook();
    expect(
      within(panel).getByText(/Flight FP18 can run 45 min late/),
    ).toBeInTheDocument();
    expect(
      within(panel).getAllByRole("button", {
        name: "Show confirmation: Flight FP18",
      }).length,
    ).toBeGreaterThan(1);
  });

  it("never proposes an alternative service and never links out", async () => {
    const panel = await openPlaybook();
    // Every pointer is about something the traveler already holds — one per
    // operator their own confirmations name, and nothing else.
    const carriers = within(panel).getAllByText(
      /the number that reaches them is on your own confirmation/,
    );
    expect(carriers).toHaveLength(2);
    expect(carriers[0].textContent).toMatch(/Fictional Pacific/);
    expect(carriers[1].textContent).toMatch(/Fictional Rail/);
    // The whole point of ADR-0016 §3: no curated carrier contact channel.
    expect(within(panel).queryByRole("link")).toBeNull();
    expect(
      within(panel).getByRole("button", {
        name: "Show confirmation: Fictional Rail",
      }),
    ).toBeInTheDocument();
    // And no language that implies another service exists or that it will be OK.
    expect(panel.textContent).not.toMatch(
      /instead|rebook|alternative route|you'?ll be fine/i,
    );
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
        name: "Show confirmation: Flight FP18",
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
