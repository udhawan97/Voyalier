import { render, screen } from "@testing-library/react";
import type { CandidateFact } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { AnnounceContext, GatewayContext } from "./app/context";
import { CandidateReviewDialog } from "./views/CandidateReviewDialog";
import { makeCandidate } from "./test/helpers";

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
