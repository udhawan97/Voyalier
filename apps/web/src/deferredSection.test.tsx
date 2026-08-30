import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";

import {
  DeferredMountProvider,
  DeferredSection,
  useMountSection,
} from "./components/DeferredSection";

/**
 * The wrapper that keeps the long trip page from fetching everything at once.
 *
 * These drive the observer by hand — the browser's job is to decide *when* an
 * element is on screen; ours is to do the right thing when it says so, and to
 * keep the section reachable in the meantime.
 */
describe("DeferredSection", () => {
  /** An observer whose callback we fire on demand. */
  function controllable() {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      active: boolean;
    }> = [];
    class Controlled {
      private readonly observer: (typeof observers)[number];

      constructor(callback: IntersectionObserverCallback) {
        this.observer = { callback, active: true };
        observers.push(this.observer);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        this.observer.active = false;
      }
    }
    vi.stubGlobal("IntersectionObserver", Controlled);
    return {
      arrive: () =>
        act(() => {
          for (const observer of observers.filter((item) => item.active)) {
            observer.callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              {} as IntersectionObserver,
            );
          }
        }),
    };
  }

  it("holds a placeholder until the section is reached, then mounts once", () => {
    const observer = controllable();
    render(
      <DeferredSection id="section-test">
        <p>Expensive content</p>
      </DeferredSection>,
    );

    expect(screen.queryByText("Expensive content")).toBeNull();
    observer.arrive();
    expect(screen.getByText("Expensive content")).toBeInTheDocument();
  });

  it("keeps its id in both states, so a jump link always has a target", () => {
    // This is what lets the section nav work: a chip must be able to jump to a
    // section that has not mounted, and landing there is what mounts it.
    const observer = controllable();
    const { container } = render(
      <DeferredSection id="section-test">
        <p>Expensive content</p>
      </DeferredSection>,
    );

    expect(container.querySelector("#section-test")).not.toBeNull();
    observer.arrive();
    expect(container.querySelector("#section-test")).not.toBeNull();
  });

  it("leaves the placeholder visible to assistive tech", () => {
    // The placeholder is the section nav's jump target. Hiding it with
    // aria-hidden would make those chips silently fail for screen-reader users
    // while still appearing to work for everyone else.
    controllable();
    const { container } = render(
      <DeferredSection id="section-test">
        <p>Expensive content</p>
      </DeferredSection>,
    );
    expect(
      container.querySelector("#section-test")?.getAttribute("aria-hidden"),
    ).toBeNull();
  });

  it("reserves height so the page does not jolt when it mounts", () => {
    controllable();
    const { container } = render(
      <DeferredSection id="section-test" minHeight="14rem">
        <p>Expensive content</p>
      </DeferredSection>,
    );
    expect(
      container.querySelector<HTMLElement>("#section-test")?.style.minHeight,
    ).toBe("14rem");
  });

  it("renders immediately where there is no observer at all", () => {
    // An engine without IntersectionObserver should get an eager page, never a
    // permanently empty one.
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <DeferredSection id="section-test">
        <p>Expensive content</p>
      </DeferredSection>,
    );
    expect(screen.getByText("Expensive content")).toBeInTheDocument();
  });

  it("can mount one requested section without waking its siblings", () => {
    const observer = controllable();
    function Harness() {
      const mountSection = useMountSection();
      return (
        <>
          <button onClick={() => mountSection("section-target")}>Reveal</button>
          <DeferredSection id="section-target">
            <p>Target content</p>
          </DeferredSection>
          <DeferredSection id="section-sibling">
            <p>Sibling content</p>
          </DeferredSection>
        </>
      );
    }
    render(
      <DeferredMountProvider>
        <Harness />
      </DeferredMountProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    expect(screen.getByText("Target content")).toBeInTheDocument();
    // A programmatic focus/scroll can put adjacent placeholders inside their
    // observer margin. They must remain dormant for the targeted handoff.
    observer.arrive();
    expect(screen.queryByText("Sibling content")).toBeNull();

    // Manual scrolling is fresh intent, so ordinary proximity deferral resumes.
    fireEvent.wheel(window);
    observer.arrive();
    expect(screen.getByText("Sibling content")).toBeInTheDocument();
  });
});
