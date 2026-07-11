import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The Today panel summarizes where the trip stands and what's next. The mock's
 * fixed "today" places the Kyoto trip in the future.
 */
describe("Today panel", () => {
  it("shows the trip phase and the next upcoming anchor", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });

    const today = await screen.findByRole("region", { name: "Today" });

    // Future trip → an "upcoming" phase and no plans today.
    expect(within(today).getByText(/Starts in \d+ days/)).toBeInTheDocument();
    expect(within(today).getByText("No plans for today.")).toBeInTheDocument();

    // The next anchor is the outbound flight departure.
    expect(within(today).getByText("Next")).toBeInTheDocument();
    expect(within(today).getByText(/Depart —.*FP18/)).toBeInTheDocument();
  });
});
