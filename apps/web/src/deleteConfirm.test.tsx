import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Deleting a trip is guarded by a type-to-confirm word. The accepted word is
 * derived from the localized field (its placeholder), not a hardcoded English
 * literal — so the check always matches the word the UI actually asks for.
 */
describe("delete-trip confirmation", () => {
  it("enables Delete only when the word the field asks for is typed", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete this trip?",
    });
    const input = within(dialog).getByLabelText<HTMLInputElement>(
      "Type delete to confirm",
    );
    const confirm = within(dialog).getByRole("button", { name: "Delete trip" });

    expect(confirm).toBeDisabled();

    // A wrong word does not enable it.
    fireEvent.change(input, { target: { value: "remove" } });
    expect(confirm).toBeDisabled();

    // The exact word the field asks for (its placeholder) enables it.
    const required = input.getAttribute("placeholder") ?? "";
    expect(required).not.toBe("");
    fireEvent.change(input, { target: { value: required } });
    expect(confirm).toBeEnabled();
  });
});
