import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderApp } from "./test/helpers";

async function openReview() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  const trigger = await screen.findByRole("button", {
    name: /Review 3 suggestions/,
  });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", {
    name: "Review suggestions",
  });
  return { dialog, trigger };
}

describe("candidate review — keyboard", () => {
  it("opens at the dialog context and returns to the trigger on Esc", async () => {
    renderApp();
    const { dialog, trigger } = await openReview();

    const overlay = dialog.closest(".voy-overlay") as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(overlay.scrollTop).toBe(0);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Review suggestions" }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("traps Tab and Shift+Tab within the dialog", async () => {
    renderApp();
    const { dialog } = await openReview();

    const headerClose = within(dialog).getByRole("button", {
      name: "Close dialog",
    });
    const footerClose = within(dialog).getByRole("button", { name: "Close" });

    // Shift+Tab from the first focusable wraps to the last.
    headerClose.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(footerClose);

    // Tab from the last focusable wraps to the first.
    footerClose.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(headerClose);
  });

  it("completes confirm-then-close entirely by keyboard", async () => {
    renderApp();
    const { dialog } = await openReview();

    const firstConfirm = within(dialog).getAllByRole("button", {
      name: "Confirm",
    })[0];
    fireEvent.click(firstConfirm);

    await waitFor(() =>
      expect(
        within(dialog).getByText(/2 suggestions to review/),
      ).toBeInTheDocument(),
    );

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Review suggestions" }),
    ).toBeNull();
    // Blueprint reflects the confirmation.
    expect(
      await screen.findByRole("button", { name: /Review 2 suggestions/ }),
    ).toBeInTheDocument();
  });

  it("returns to stable Blueprint context when the final trigger disappears", async () => {
    renderApp();
    const { dialog } = await openReview();

    for (const remaining of [2, 1]) {
      fireEvent.click(
        within(dialog).getAllByRole("button", { name: "Confirm" })[0],
      );
      await waitFor(() =>
        expect(
          within(dialog).getByText(
            new RegExp(`${remaining} suggestions? to review`),
          ),
        ).toBeInTheDocument(),
      );
    }

    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Confirm" })[0],
    );
    await within(dialog).findByText("All caught up");
    await screen.findByText(
      "No suggestions waiting. Import a document to find more.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    const blueprint = document.getElementById("blueprint-title")!;
    await waitFor(() => expect(document.activeElement).toBe(blueprint));
    expect(document.activeElement).not.toBe(document.body);
  });
});
