import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { findA11yViolations, renderApp, renderSettings } from "./test/helpers";

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

    const violations = await findA11yViolations();
    expect(violations, violations.join("\n\n")).toEqual([]);
  });

  it("repeated trip-card controls name the trip they act on", async () => {
    // axe passes this surface: every control has a name, and WCAG nowhere
    // requires those names to be unique. But the list renders one Archive and
    // one Delete per card, so a rotor reads "Archive, Delete, Archive,
    // Delete" — and Delete is the destructive one. The Open control in this
    // same card was already given the title; these two were not, which is the
    // inconsistency rather than a rule being broken.
    renderApp(createMockGateway());
    await screen.findByRole("heading", { name: "Trips", level: 1 });

    const cards = await screen.findAllByRole("article");
    expect(cards.length).toBeGreaterThan(1);

    for (const card of cards) {
      // An archived card offers Unarchive in place of Archive, so match either
      // rather than assuming the list is showing only active trips.
      for (const action of ["(?:Un)?[Aa]rchive", "Delete"]) {
        const named = within(card).queryByRole("button", {
          name: new RegExp(`^${action} .`),
        });
        expect(
          named,
          `${action} must name its trip; card offers: ${within(card)
            .getAllByRole("button")
            .map(
              (button) =>
                button.getAttribute("aria-label") ?? button.textContent,
            )
            .join(" | ")}`,
        ).not.toBeNull();
      }
    }
  });

  it("the settings view has no violations", async () => {
    await renderSettings(createMockGateway());
    // The lazy vault panel loads its status asynchronously; wait for it, so the
    // scan covers the panel rather than its placeholder.
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

  it("the suggestion review dialog has no violations", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    );
    await screen.findByRole("dialog", { name: "Review suggestions" });

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
