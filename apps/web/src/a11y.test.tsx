import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import {
  findA11yViolations,
  renderApp,
  renderSettings,
  renderTrip,
} from "./test/helpers";

/**
 * The lists that render the same control once per row, and the row each repeats.
 *
 * Selected by class rather than by role: these rows carry no role or accessible
 * name of their own that separates them from the rest of a very long page, and
 * the alternative — naming the verbs each list happens to use — is exactly the
 * shape that kept the trip-card guard below from ever reaching them.
 */
const REPEATED_ROWS: { surface: string; row: string }[] = [
  { surface: "confirmed facts", row: "article.voy-fact" },
  { surface: "imported documents", row: "li.voy-doc" },
  { surface: "city packs", row: "li.voy-packs__row" },
  { surface: "recommended places", row: "li.voy-recs__row" },
  { surface: "candidates under review", row: "li.voy-review" },
];

/** What a rotor hears for one control: its label, or failing that its words. */
function controlName(control: HTMLElement): string {
  return control.getAttribute("aria-label") ?? control.textContent ?? "";
}

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

  it("controls in a repeated list name the row they act on", async () => {
    // The same guarantee as the trip cards, everywhere else a control repeats.
    // The test above is a list of verbs inside `role="article"`, so it never
    // reached the other lists that render a bare "Remove", "Confirm" or "Save
    // place" once per row. This asserts the property instead of the vocabulary:
    // within one list, no two controls may carry the same accessible name.
    await renderTrip();
    // Both of these lists are earned, not volunteered: packs are listed on
    // request, and recommendations need a downloaded pack to draw from. An
    // untouched trip page renders neither, which is what the emptiness
    // assertions below are guarding against.
    const packs = within(
      await screen.findByRole("region", { name: "Offline city data" }),
    );
    fireEvent.click(packs.getByRole("button", { name: "Browse city packs" }));
    const nashville = (await packs.findByText("Nashville")).closest("li")!;
    fireEvent.click(
      within(nashville).getByRole("button", { name: /^Download/ }),
    );
    await within(nashville).findByText(/offline/);

    const recs = within(
      await screen.findByRole("region", { name: "Recommendations" }),
    );
    fireEvent.click(recs.getByRole("button", { name: "Get recommendations" }));
    await screen.findByRole("list", { name: "Recommended places" });
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    );
    await screen.findByRole("dialog", { name: "Review suggestions" });

    for (const { surface, row } of REPEATED_ROWS) {
      // The dialog portals onto the body, so the whole document is the scope.
      const rows = [...document.body.querySelectorAll<HTMLElement>(row)];
      // A list of one proves nothing about repetition, and a list of none
      // would let this pass by rendering nothing at all.
      expect(rows.length, `${surface}: nothing repeated`).toBeGreaterThan(1);

      const names = rows.flatMap((item) =>
        within(item).queryAllByRole("button").map(controlName),
      );
      expect(names.length, `${surface}: no controls`).toBeGreaterThan(1);

      const shared = [
        ...new Set(names.filter((name, at) => names.indexOf(name) !== at)),
      ];
      expect(
        shared,
        `${surface}: a rotor cannot separate ${shared.join(" | ")}`,
      ).toEqual([]);
    }
  });

  it("provider controls name the provider they act on", async () => {
    // The same rule as above, on the one surface the trip page cannot reach.
    // Both controls here are per-provider and both are gated behind a stored
    // key, so the state has to be driven before there is anything to check.
    await renderSettings(createMockGateway());
    const providers = within(
      await screen.findByRole("region", { name: "AI providers" }),
    );
    fireEvent.click(
      providers.getByRole("button", { name: "Manage AI providers" }),
    );

    for (const provider of ["OpenAI", "Anthropic"]) {
      const row = (await providers.findByText(provider)).closest(
        "li",
      ) as HTMLElement;
      fireEvent.change(within(row).getByLabelText(`${provider} API key`), {
        target: { value: `key-for-${provider}` },
      });
      fireEvent.click(
        within(row).getByRole("button", { name: "Validate & save" }),
      );
      await within(row).findByText("Key stored");
    }

    const rows = [
      ...document.body.querySelectorAll<HTMLElement>("li.voy-providers__row"),
    ];
    const names = rows.flatMap((row) =>
      within(row).queryAllByRole("button").map(controlName),
    );
    const shared = [
      ...new Set(names.filter((name, at) => names.indexOf(name) !== at)),
    ];
    expect(shared, `a rotor cannot separate ${shared.join(" | ")}`).toEqual([]);
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
