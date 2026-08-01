import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { App } from "./App";
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
  // The hash and the restored trip are real browser state, so a test that sets
  // them has to put them back whether or not it reached its own cleanup.
  afterEach(() => {
    window.location.hash = "";
    sessionStorage.clear();
  });

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

  /**
   * The same failure on the path a reload takes.
   *
   * Measured on the running product: a cold load of `/#section-ai` stopped with
   * the AI section 3,520px below the fold and the nav marking Prepare current,
   * because the effect scrolled against the placeholder layout and every
   * section above the target then mounted and pushed it down. The chips were
   * fixed for this in 0.5.2; the load path kept a bare setTimeout(0).
   */
  it("lands on the section named in the URL on a cold load", async () => {
    stubDeferredSections();
    // A reload restores the trip from session storage, so the workspace opens
    // straight onto the trip page with the hash still in the address bar.
    sessionStorage.setItem("voyalier-active-trip", "trip_kyoto");
    window.location.hash = "#section-ai";

    const scroll = captureScrollTargets();
    // Strict Mode on purpose. The first version of this fix claimed the hash
    // before scheduling its scroll, so the strict teardown cancelled the only
    // timer and the remount declined to schedule another — the link did nothing
    // at all in development, and a plain render never showed it.
    render(
      <StrictMode>
        <App gateway={createMockGateway()} />
      </StrictMode>,
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });

    expect(
      await screen.findByRole("heading", { name: "Preview an AI request" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(scroll.ids).toContain("section-ai"));
    // And the nav agrees with the address bar, rather than marking whichever
    // section the browser happened to stop in.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "AI" })).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    scroll.restore();
  });

  // Gap #10: the chips never said where the traveler was.
  it("marks the chip for the section being viewed", async () => {
    // Deliberately blind the observer. The shared setup's stub reports every
    // section as intersecting at once, and jsdom gives them all a top of 0, so
    // which one the nav calls current is decided by an unstable sort — this
    // test is about the click, not about scroll tracking.
    stubDeferredSections();
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

  it("offers a named continuation control only while sections overflow", async () => {
    stubDeferredSections();
    renderApp(createMockGateway());
    await openKyoto();

    const nav = screen.getByRole("navigation", {
      name: "Jump to a section",
    });
    let scrollLeft = 0;
    Object.defineProperties(nav, {
      clientWidth: { configurable: true, get: () => 280 },
      scrollWidth: { configurable: true, get: () => 322 },
      scrollLeft: {
        configurable: true,
        get: () => scrollLeft,
        set: (value: number) => {
          scrollLeft = value;
        },
      },
    });
    Object.defineProperty(nav, "scrollBy", {
      configurable: true,
      value: vi.fn(({ left }: ScrollToOptions) => {
        scrollLeft += Number(left ?? 0);
        fireEvent.scroll(nav);
      }),
    });
    fireEvent(window, new Event("resize"));

    const more = await screen.findByRole("button", {
      name: "Show more trip sections",
    });
    fireEvent.click(more);
    expect(nav.scrollBy).toHaveBeenCalled();

    scrollLeft = 42;
    fireEvent.scroll(nav);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Show more trip sections" }),
      ).toBeNull(),
    );
  });
});
