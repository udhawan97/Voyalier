import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * "About this place" fetches a short Wikipedia summary on an explicit click and
 * shows it under CC BY-SA with attribution and a link back — never as
 * Voyalier's own words.
 */
describe("about this place", () => {
  async function openAbout() {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    return screen.findByRole("region", { name: "About this place" });
  }

  it("fetches a summary and attributes it to Wikipedia", async () => {
    const panel = await openAbout();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Fetch a summary" }),
    );
    // The summary prose appears, plus a CC BY-SA attribution and a link back.
    expect(
      await within(panel).findByText(/well-known destination/),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/CC BY-SA/)).toBeInTheDocument();
    const link = within(panel).getByRole("link", {
      name: /Read more about Kyoto/,
    });
    expect(link).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Kyoto");
  });
});
