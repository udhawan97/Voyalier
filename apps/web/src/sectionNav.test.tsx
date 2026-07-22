import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The trip page's jump chips, tested under the condition that broke them: a
 * freshly opened trip where the sections below the fold have not mounted yet.
 *
 * The shared setup stubs `IntersectionObserver` to fire immediately, which
 * mounts every `DeferredSection` and hides the bug entirely. These tests stub it
 * with one that never fires, which is what a real first visit looks like before
 * the traveler scrolls.
 */
class NeverIntersectingObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function stubDeferredSections() {
  vi.stubGlobal("IntersectionObserver", NeverIntersectingObserver);
}

/** Record which elements the page scrolled to, in order. */
function captureScrollTargets(): { ids: string[]; restore: () => void } {
  const ids: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    if (this.id) ids.push(this.id);
  };
  return {
    ids,
    restore: () => {
      Element.prototype.scrollIntoView = original;
    },
  };
}

async function openKyoto() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
}

describe("Trip section navigation", () => {
  // The audit's gap #1: clicking "AI" on a fresh trip left the traveler in the
  // middle of Prepare, because the deferred sections above the target mounted
  // mid-jump and pushed it ~1,700px further down.
  it("lands on the target section even when the sections have not mounted", async () => {
    stubDeferredSections();
    renderApp(createMockGateway());
    await openKyoto();

    // Nothing inside the AI group exists yet — this is the pre-scroll state.
    expect(
      screen.queryByRole("heading", { name: "Preview an AI request" }),
    ).toBeNull();

    const scroll = captureScrollTargets();
    fireEvent.click(screen.getByRole("link", { name: "AI" }));

    // The chip mounts its target before scrolling, so the jump has somewhere
    // stable to land.
    expect(
      await screen.findByRole("heading", { name: "Preview an AI request" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(scroll.ids).toContain("section-ai"));
    // And it never lands on a section the traveler did not ask for.
    expect(scroll.ids).not.toContain("section-prepare");
    scroll.restore();
  });

  // Gap #10: the chips never said where the traveler was.
  it("marks the chip for the section being viewed", async () => {
    renderApp(createMockGateway());
    await openKyoto();

    const ai = screen.getByRole("link", { name: "AI" });
    expect(ai).not.toHaveAttribute("aria-current");

    const scroll = captureScrollTargets();
    fireEvent.click(ai);
    await waitFor(() => expect(ai).toHaveAttribute("aria-current", "true"));
    expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute(
      "aria-current",
    );
    scroll.restore();
  });
});
