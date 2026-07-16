import { render, screen } from "@testing-library/react";
import { act } from "react";

import { DeferredSection } from "./components/DeferredSection";

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
    const observers: IntersectionObserverCallback[] = [];
    class Controlled {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", Controlled);
    return {
      arrive: () =>
        act(() => {
          for (const callback of observers) {
            callback(
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
});
