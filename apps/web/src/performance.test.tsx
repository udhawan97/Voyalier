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

describe("review performance", () => {
  it("renders a 50-candidate review list in under 100ms", () => {
    const candidates = Array.from({ length: 50 }, (_, index) =>
      makeCandidate(index),
    );

    // Warm up React/jsdom code paths so we measure render cost, not cold JIT.
    renderReview([makeCandidate(0)]).unmount();

    // Best of several warm renders: the minimum reflects the true render cost,
    // free of GC/scheduling spikes that make a single wall-clock read flaky.
    let best = Infinity;
    let view = renderReview(candidates);
    for (let run = 0; run < 5; run += 1) {
      view.unmount();
      const start = performance.now();
      view = renderReview(candidates);
      best = Math.min(best, performance.now() - start);
    }

    // Every candidate rendered — no pathological O(n²) or truncation.
    expect(screen.getAllByRole("button", { name: "Confirm" })).toHaveLength(50);
    expect(best).toBeLessThan(100);
    view.unmount();
  });
});
