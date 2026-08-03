import { createMockGateway } from "@voyalier/contracts";
import { StrictMode, useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { App } from "./App";
import { Dialog } from "./components/Dialog";
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
  // The scroll container, which is also where `initialFocus="dialog"` now
  // lands — a scroller the keyboard cannot focus is one it cannot scroll.
  const body = dialog.querySelector(".voy-dialog__body") as HTMLElement;
  return { dialog, body, trigger };
}

/**
 * Every test below opens the review dialog straight from its trip-detail
 * trigger, which is the one path the shared `Dialog` handles correctly. The
 * import flow does not arrive that way: it closes one dialog and opens another
 * in a single commit, and the closing one's deferred focus restore used to fire
 * *after* the incoming dialog had focused itself — landing focus on the page
 * behind an open modal, where Tab walks the background and Esc does nothing.
 *
 * Two plain dialogs reproduce that without the import flow, so the guard lives
 * with the component that owns it.
 */
describe("dialog handoff — keyboard", () => {
  function Handoff() {
    const [open, setOpen] = useState<"first" | "second" | null>(null);
    return (
      <>
        <button type="button" onClick={() => setOpen("first")}>
          Open the first
        </button>
        {open === "first" ? (
          <Dialog
            title="First"
            onClose={() => setOpen(null)}
            footer={
              <button type="button" onClick={() => setOpen("second")}>
                Hand off
              </button>
            }
          >
            <p>first body</p>
          </Dialog>
        ) : null}
        {open === "second" ? (
          <Dialog
            title="Second"
            onClose={() => setOpen(null)}
            initialFocus="dialog"
          >
            <p>second body</p>
          </Dialog>
        ) : null}
      </>
    );
  }

  it("keeps focus inside the dialog that replaced the one it opened from", async () => {
    render(<Handoff />);
    // Focus the trigger first: the restore only has somewhere to go when the
    // element that opened the dialog is focused and still mounted, which is
    // exactly the case the import summary presents.
    const trigger = screen.getByRole("button", { name: "Open the first" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Hand off" }));

    const second = await screen.findByRole("dialog", { name: "Second" });
    // The closing dialog's restore is deferred to a microtask, so this has to
    // survive the queue draining rather than only the synchronous commit.
    await waitFor(() =>
      expect(second.contains(document.activeElement)).toBe(true),
    );
  });

  it("still answers Escape after a handoff", async () => {
    render(<Handoff />);
    const trigger = screen.getByRole("button", { name: "Open the first" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Hand off" }));
    const second = await screen.findByRole("dialog", { name: "Second" });
    await waitFor(() =>
      expect(second.contains(document.activeElement)).toBe(true),
    );

    // Escape is handled on the dialog element, so it only arrives if focus is
    // actually inside — this fails for the same reason the trap does.
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Second" })).toBeNull(),
    );
  });

  it("still returns focus to the trigger when no dialog replaced it", async () => {
    // The guard must not swallow the ordinary restore it sits next to.
    render(<Handoff />);
    const trigger = screen.getByRole("button", { name: "Open the first" });
    trigger.focus();
    fireEvent.click(trigger);
    const first = await screen.findByRole("dialog", { name: "First" });
    fireEvent.keyDown(first, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("candidate review — keyboard", () => {
  it("keeps dialog focus during the Strict Mode effect replay", async () => {
    render(
      <StrictMode>
        <App gateway={createMockGateway()} />
      </StrictMode>,
    );
    const { body } = await openReview();

    await waitFor(() => expect(document.activeElement).toBe(body));
  });

  it("opens at the dialog context and returns to the trigger on Esc", async () => {
    renderApp();
    const { dialog, body, trigger } = await openReview();

    const overlay = dialog.closest(".voy-overlay") as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(body));
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
