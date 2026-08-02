import { fireEvent, screen, within } from "@testing-library/react";
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

  it("says what is stacked behind the exposed leg", async () => {
    const panel = await openPlaybook();
    expect(
      within(panel).getByText(/Flight FP18 can run 45 min late/),
    ).toBeInTheDocument();
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
    // And no language that implies another service exists or that it will be OK.
    expect(panel.textContent).not.toMatch(
      /instead|rebook|alternative route|you'?ll be fine/i,
    );
  });

  it("is advisory — it raises no readiness action", async () => {
    await openPlaybook();
    const readiness = await screen.findByRole("region", { name: "Readiness" });
    expect(within(readiness).queryByText(/If something slips/)).toBeNull();
  });
});
