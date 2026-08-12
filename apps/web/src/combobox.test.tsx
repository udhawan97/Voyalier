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

  it("moves to the first and last suggestion with Home and End", async () => {
    const dialog = await openCreateDialog();
    const destination = within(dialog).getByLabelText("To");

    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "a" } });
    const listbox = await within(dialog).findByRole("listbox", {
      name: "To suggestions",
    });
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);

    fireEvent.keyDown(destination, { key: "End" });
    expect(destination).toHaveAttribute(
      "aria-activedescendant",
      options.at(-1)?.id,
    );
    fireEvent.keyDown(destination, { key: "Home" });
    expect(destination).toHaveAttribute("aria-activedescendant", options[0].id);
  });

  it("selects a suggestion with a pointer and closes the list", async () => {
    const dialog = await openCreateDialog();
    const destination = within(dialog).getByLabelText("To");

    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "a" } });
    const listbox = await within(dialog).findByRole("listbox", {
      name: "To suggestions",
    });
    const option = within(listbox).getAllByRole("option")[0];
    const value = option.querySelector(".voy-combobox__value")?.textContent;
    fireEvent.mouseDown(option);

    expect(destination).toHaveValue(value);
    expect(
      within(dialog).queryByRole("listbox", { name: "To suggestions" }),
    ).toBeNull();
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

/**
 * An IME owns the arrows, Enter and Escape while it is composing.
 *
 * The suggestion list drives itself with the same keys, so without a guard it
 * took the ArrowDown meant for the candidate window and swallowed the Escape
 * meant to cancel the composition. Every form with a place or country field
 * shares this component, including the visa passport picker on a product that
 * ships a curated Japanese journey.
 */
describe("IME composition", () => {
  it("leaves the arrow keys to the input method while composing", async () => {
    const dialog = await openCreateDialog();
    const field = within(dialog).getByLabelText(/^From/);

    const composing = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composing, "isComposing", { get: () => true });
    field.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);

    // And still drives its own list once composition has ended.
    const plain = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
  });
});
