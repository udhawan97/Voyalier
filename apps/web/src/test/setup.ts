import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no IntersectionObserver, and `DeferredSection` renders eagerly when
 * it is missing — which would make every test silently exercise the eager path
 * and never the real one.
 *
 * So tests get an observer that reports "on screen" immediately: deferred
 * sections mount, and tests read the page the way a user who has scrolled would.
 * A test that cares about deferral (the call-count budget) stubs this with one
 * that never fires — see performance.test.tsx.
 */
// A double, not an implementation: it carries only what DeferredSection calls,
// so it deliberately does not satisfy the full DOM interface.
class ImmediateIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.IntersectionObserver =
  ImmediateIntersectionObserver as unknown as typeof IntersectionObserver;

afterEach(() => {
  vi.unstubAllGlobals();
});
