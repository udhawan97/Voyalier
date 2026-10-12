import wire from "@voyalier/contracts/fixtures/profile-date-assist-wire.json";
import type { AppGateway, ConciergeProfile } from "@voyalier/contracts";
import { createHttpGateway } from "./gateway/http";
import { createTauriGateway } from "./gateway/tauri";

// Hand-maintained fixture; explicit typed construction pins optional nested
// profile fields as well as the adapter's wrapper keys (ADR-0023).
function profileInput(): ConciergeProfile {
  const input = wire.setConciergeProfile.args.input;
  return {
    tripId: input.tripId,
    revision: input.revision,
    preferences: {
      partySize: input.preferences.partySize,
      pace: "slow",
      carPreference: "unset",
      baseCurrency: input.preferences.baseCurrency,
      budgetIsPerPerson: input.preferences.budgetIsPerPerson,
    },
    travelers: [],
    taskProgress: [],
    costs: [],
    walletLinks: [],
    providerHandoffs: [],
  };
}

async function dispatch(gateway: AppGateway) {
  await gateway.setConciergeProfile(profileInput());
  await gateway.getToday(
    wire.getToday.args.input.tripId,
    wire.getToday.args.input.referenceDate,
  );
  await gateway.runAssist(
    wire.runAssist.args.input.tripId,
    "ollama",
    wire.runAssist.args.input.approvalToken,
  );
}

it("pins profile revision, explicit Today date and assist commitment on Tauri", async () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const gateway = createTauriGateway({ invoke });
  await dispatch(gateway);
  const steps = [wire.setConciergeProfile, wire.getToday, wire.runAssist];
  expect(steps).toHaveLength(3);
  expect(invoke.mock.calls).toEqual(
    steps.map((step) => [step.command, step.args]),
  );
  await gateway.getToday("trip_fixture");
  expect(invoke).toHaveBeenLastCalledWith("get_today", {
    input: { tripId: "trip_fixture" },
  });
});

it("pins the same supplied values on HTTP and omits the legacy Today query", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    void url;
    void init;
    return Response.json({});
  });
  const gateway = createHttpGateway({
    baseUrl: "http://127.0.0.1:8787",
    fetch: fetcher,
  });
  await dispatch(gateway);
  expect(fetcher.mock.calls).toHaveLength(3);
  expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe(
    "/api/v1/trips/trip_fixture/concierge",
  );
  expect(fetcher.mock.calls[0][1]?.method).toBe("PUT");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(
    wire.setConciergeProfile.args.input,
  );
  expect(
    new URL(String(fetcher.mock.calls[1][0])).searchParams.get("referenceDate"),
  ).toBe(wire.getToday.args.input.referenceDate);
  expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
    provider: "ollama",
    approvalToken: wire.runAssist.args.input.approvalToken,
  });
  await gateway.getToday("trip_fixture");
  expect(new URL(String(fetcher.mock.calls[3][0])).search).toBe("");
});
