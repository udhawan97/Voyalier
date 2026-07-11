import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { findA11yViolations, renderApp } from "./test/helpers";

/**
 * Automated accessibility gate. Renders the key surfaces and asserts axe-core
 * finds no violations, so regressions (missing labels, ARIA misuse, broken
 * landmarks, bad heading order) fail the build. Color contrast is checked
 * separately in the browser, since jsdom cannot compute it.
 */
describe("accessibility", () => {
  it("the trip list (home) has no violations", async () => {
    renderApp(createMockGateway());
    await screen.findByRole("heading", { name: "Trips", level: 1 });
    // The lazy vault panel loads its status asynchronously; wait for it.
    await screen.findByRole("region", { name: "Encryption" });

    const violations = await findA11yViolations();
    expect(violations, violations.join("\n\n")).toEqual([]);
  });

  it("the create-trip dialog has no violations", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a trip" }),
    );
    await screen.findByRole("dialog", { name: "Create a trip" });

    const violations = await findA11yViolations();
    expect(violations, violations.join("\n\n")).toEqual([]);
  });

  it("the trip detail view has no violations", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });

    const violations = await findA11yViolations();
    expect(violations, violations.join("\n\n")).toEqual([]);
  });

  it("the vault unlock gate has no violations", async () => {
    const base = createMockGateway();
    const gateway = {
      ...base,
      getVaultStatus: () =>
        Promise.resolve({ active: false, protected: true, locked: true }),
    };
    renderApp(gateway);
    const region = await screen.findByRole("region", {
      name: "Your vault is locked",
    });
    expect(within(region).getByLabelText("Passphrase")).toBeInTheDocument();

    const violations = await findA11yViolations();
    expect(violations, violations.join("\n\n")).toEqual([]);
  });
});
