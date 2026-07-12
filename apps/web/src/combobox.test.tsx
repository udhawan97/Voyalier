import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { findA11yViolations, renderApp } from "./test/helpers";

async function openCreateDialog() {
  renderApp();
  fireEvent.click(await screen.findByRole("button", { name: "Create a trip" }));
  return screen.findByRole("dialog", { name: "Create a trip" });
}

/**
 * Origin/destination use the accessible combobox: free text always works, local
 * suggestions (offline pack catalog + prior trips) never gate typing, and the
 * whole thing is keyboard- and screen-reader-navigable.
 */
describe("Combobox (origin/destination entry)", () => {
  it("suggests matching places as you type and selects with the keyboard", async () => {
    const dialog = await openCreateDialog();
    const destination = within(dialog).getByLabelText("To");

    // Typing "kyo" surfaces the catalog's Kyoto pack as a suggestion.
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "kyo" } });

    const listbox = await within(dialog).findByRole("listbox", {
      name: "To suggestions",
    });
    const option = within(listbox).getByRole("option", { name: /Kyoto/ });
    expect(destination).toHaveAttribute("aria-expanded", "true");

    // ArrowDown activates the option (via aria-activedescendant), Enter commits.
    fireEvent.keyDown(destination, { key: "ArrowDown" });
    expect(destination).toHaveAttribute(
      "aria-activedescendant",
      option.getAttribute("id"),
    );
    fireEvent.keyDown(destination, { key: "Enter" });

    expect(destination).toHaveValue("Kyoto");
    expect(
      within(dialog).queryByRole("listbox", { name: "To suggestions" }),
    ).toBeNull();
  });

  it("keeps free text that matches nothing, with no dangling listbox", async () => {
    const dialog = await openCreateDialog();
    const destination = within(dialog).getByLabelText("To");

    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "Zznowhere" } });

    // Give the debounced fetch time to resolve to an empty result.
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("listbox", { name: "To suggestions" }),
      ).toBeNull(),
    );
    expect(destination).toHaveValue("Zznowhere");
  });

  it("Escape closes the open listbox without changing the value", async () => {
    const dialog = await openCreateDialog();
    const destination = within(dialog).getByLabelText("To");

    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "kyo" } });
    await within(dialog).findByRole("listbox", { name: "To suggestions" });

    fireEvent.keyDown(destination, { key: "Escape" });
    expect(
      within(dialog).queryByRole("listbox", { name: "To suggestions" }),
    ).toBeNull();
    expect(destination).toHaveValue("kyo");
  });

  it("has no accessibility violations while suggestions are open", async () => {
    const dialog = await openCreateDialog();
    const destination = within(dialog).getByLabelText("To");
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "kyo" } });
    await within(dialog).findByRole("listbox", { name: "To suggestions" });

    expect(await findA11yViolations()).toEqual([]);
  });
});
