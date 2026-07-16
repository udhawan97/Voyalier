import { fireEvent, render, screen } from "@testing-library/react";
import type { AppGateway, CandidateFact } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { AnnounceContext, GatewayContext } from "./app/context";
import { CandidateReviewDialog } from "./views/CandidateReviewDialog";
import { makeCandidate, renderApp } from "./test/helpers";

function renderReview(candidates: CandidateFact[]) {
  const gateway = createMockGateway();
  return render(
    <GatewayContext.Provider value={gateway}>
      <AnnounceContext.Provider value={() => {}}>
        <CandidateReviewDialog
          candidates={candidates}
          onClose={() => {}}
          onResolved={() => {}}
        />
      </AnnounceContext.Provider>
    </GatewayContext.Provider>,
  );
}

/** Best of several warm renders — the minimum drops GC/scheduling spikes. */
function bestRenderMs(count: number, runs = 5): number {
  const candidates = Array.from({ length: count }, (_, index) =>
    makeCandidate(index),
  );
  renderReview(candidates).unmount(); // warm up code paths
  let best = Infinity;
  let view = renderReview(candidates);
  for (let run = 0; run < runs; run += 1) {
    view.unmount();
    const start = performance.now();
    view = renderReview(candidates);
    best = Math.min(best, performance.now() - start);
  }
  view.unmount();
  return best;
}

/**
 * A budget, not a benchmark.
 *
 * Opening a trip used to fire ~8 gateway calls before the traveler did anything,
 * because every below-fold panel fetched on mount — advice countries, pack
 * suggestions, downloaded packs, notes, documents — for sections most people
 * never scroll to. Deferring them is only worth anything if it stays deferred,
 * so the count is asserted rather than trusted.
 */
describe("trip open budget", () => {
  /** Count every gateway method a render reaches for. */
  function countingGateway(calls: string[]): AppGateway {
    const base = createMockGateway();
    return new Proxy(base, {
      get(target, prop: string, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(prop);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as AppGateway;
  }

  it("fetches no more than five times before the traveler acts", async () => {
    // Unlike the rest of the suite, this test wants the real deferred behaviour:
    // an observer that never reports anything on screen, so below-fold sections
    // stay as placeholders exactly as they do on a freshly opened trip.
    class NeverIntersects {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", NeverIntersects);

    const calls: string[] = [];
    renderApp(countingGateway(calls));
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    // Let any fetch a mounted panel would fire actually land.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // App-level calls happen once for the whole session, not per trip open.
    const perTrip = calls.filter(
      (call) => !["listTrips", "getVaultStatus", "health"].includes(call),
    );
    expect(
      perTrip.length,
      `too many calls on trip open: ${perTrip.join(", ")}`,
    ).toBeLessThanOrEqual(5);
  });

  it("still mounts the deferred sections once they are reached", async () => {
    // The saving must not come from dropping the sections. With the suite's
    // default observer (reports on screen immediately), they are all there.
    const calls: string[] = [];
    renderApp(countingGateway(calls));
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    expect(
      await screen.findByRole("region", { name: "Imported documents" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: "Offline city data" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: "Preview an AI request" }),
    ).toBeInTheDocument();
  });
});

describe("review performance", () => {
  it("mounts all 50 candidates", () => {
    const candidates = Array.from({ length: 50 }, (_, index) =>
      makeCandidate(index),
    );
    renderReview(candidates);
    expect(screen.getAllByRole("button", { name: "Confirm" })).toHaveLength(50);
  });

  it("keeps render cost ~linear in candidate count (no O(n²)/thrash)", () => {
    // The <100ms budget is the real-browser target (verified manually — 50 cards
    // paint instantly). In jsdom-on-CI the absolute number is machine-dependent,
    // so instead we assert the property that a regression would break: 5× the
    // candidates must not cost anywhere near 25× (quadratic). Because fixed
    // render overhead is shared, this ratio self-normalizes across hardware —
    // on a slow runner BOTH measurements rise together.
    const base = bestRenderMs(10);
    const big = bestRenderMs(50);

    // 10× + a fixed cushion tolerates timer noise while still failing a
    // super-linear blowup (which would push `big` toward 25× `base`).
    expect(big).toBeLessThan(base * 10 + 40);
  });
});
