import {
  createMockGateway,
  type AppGateway,
  type ConfirmedFactVersion,
} from "@voyalier/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { makeCandidate, renderTrip } from "./test/helpers";

describe("explicit amendment review", () => {
  it("shows the current/imported diff and forwards Replace explicitly", async () => {
    const base = createMockGateway();
    const detail = await base.getTrip("trip_kyoto");
    const current = detail.confirmedFacts.find(
      (fact) => fact.id === "fact_kyoto_outbound",
    )!;
    const candidate = makeCandidate(90, {
      id: "candidate_amendment",
      factType: current.factType,
      payload: { ...current.payload, arrivalLocal: "2026-11-04T17:20" },
      amendsFactId: current.id,
    });
    const confirmCandidate = vi.fn(async (input) => ({
      candidate: {
        ...candidate,
        status: "confirmed" as const,
        resolvedAt: "now",
      },
      confirmedFact: {
        ...current,
        id: "fact_replacement",
        payload: candidate.payload,
      },
    }));
    const gateway: AppGateway = {
      ...base,
      getTrip: async () => ({
        ...detail,
        pendingCandidateCount: 1,
      }),
      listCandidates: async () => [candidate],
      confirmCandidate,
    };

    await renderTrip(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 1 suggestion/ }),
    );
    expect(
      await screen.findByRole("region", { name: "Possible amendment" }),
    ).toHaveTextContent("4:05 PM");
    expect(
      screen.getByRole("region", { name: "Possible amendment" }),
    ).toHaveTextContent("5:20 PM");

    fireEvent.click(
      screen.getByRole("button", { name: /Replace current version/ }),
    );
    await waitFor(() =>
      expect(confirmCandidate).toHaveBeenCalledWith({
        candidateId: candidate.id,
        amendmentAction: "replace",
      }),
    );
  });

  it("restores an inactive approved version through the append-only action", async () => {
    const base = createMockGateway();
    const detail = await base.getTrip("trip_kyoto");
    const current = detail.confirmedFacts[0];
    const previous: ConfirmedFactVersion = {
      ...current,
      id: "fact_previous",
      active: false,
      revision: 0,
      reason: "initial",
      lineageRootId: "fact_previous",
    };
    const currentVersion: ConfirmedFactVersion = {
      ...current,
      active: true,
      revision: 1,
      reason: "amendment",
      lineageRootId: "fact_previous",
      supersedesFactId: previous.id,
    };
    const restoreFactVersion = vi.fn(async () => current);
    const gateway: AppGateway = {
      ...base,
      getTrip: async () => ({
        ...detail,
        factVersions: [previous, currentVersion],
      }),
      restoreFactVersion,
    };

    await renderTrip(gateway);
    fireEvent.click(await screen.findByText("1 previous approved version"));
    fireEvent.click(
      screen.getByRole("button", { name: /Restore approved version/ }),
    );
    await waitFor(() =>
      expect(restoreFactVersion).toHaveBeenCalledWith({ factId: previous.id }),
    );
  });
});
