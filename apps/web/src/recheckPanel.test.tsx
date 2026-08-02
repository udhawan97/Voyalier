import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";
import { failingGateway, rejectWith } from "./test/helpers";

/**
 * The sweep is explicit, and its three quiet outcomes are all spoken aloud.
 *
 * A source that was skipped, one that has never been fetched, and one that
 * failed are three different things, and none of them is an all-clear. The
 * panel that collapses them into silence is the one that misleads.
 */
describe("re-check sweep", () => {
  async function openSweep(gateway = createMockGateway()) {
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    return screen.findByRole("region", {
      name: "What changed since you last looked",
    });
  }

  it("names the hosts before the click, not after", async () => {
    const panel = await openSweep();
    expect(
      within(panel).getByText(/One click contacts the same official sites/),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(/Nothing about your trip is sent/),
    ).toBeInTheDocument();
  });

  it("says a source has never been fetched rather than staying silent", async () => {
    const panel = await openSweep();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Re-check this trip" }),
    );
    // Both sources: neither has been fetched on a freshly opened fixture trip,
    // and each says so on its own line rather than one standing for both.
    expect(await within(panel).findAllByText(/never fetched/)).toHaveLength(2);
    // Nothing was refreshed, so nothing was contacted — and it says so.
    expect(
      within(panel).getByText(/Nothing needed refreshing/),
    ).toBeInTheDocument();
  });

  it("reports a failure as a failure, never as an all-clear", async () => {
    const gateway = failingGateway({
      recheckTrip: rejectWith({
        code: "advice/fetch_failed",
        message: "no official source could be reached",
      }),
    });
    const panel = await openSweep(gateway);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Re-check this trip" }),
    );
    const alert = await within(panel).findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(within(panel).queryByText(/no change/)).toBeNull();
  });
});
