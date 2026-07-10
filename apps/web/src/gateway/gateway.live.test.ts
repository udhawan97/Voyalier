import type { AppError } from "@voyalier/contracts";

import { createHttpGateway } from "./http";

/*
 * Runs the HTTP gateway against the real loopback core. Skipped unless
 * VITE_LIVE_API=1 — run at integration after Codex's core merges:
 *
 *   cargo run -p voyalier-server            # terminal 1
 *   VITE_LIVE_API=1 pnpm --filter @voyalier/web test gateway.live
 */
const LIVE = import.meta.env.VITE_LIVE_API === "1";
const BASE_URL =
  (import.meta.env.VITE_LIVE_API_URL as string | undefined) ??
  "http://127.0.0.1:8787";

describe.skipIf(!LIVE)("HTTP gateway against the live core", () => {
  const gateway = createHttpGateway({ baseUrl: BASE_URL });

  it("reports a healthy local core", async () => {
    const health = await gateway.health();
    expect(health.status).toBe("ok");
    expect(typeof health.version).toBe("string");
  });

  it("lists trips as an array of summaries", async () => {
    const trips = await gateway.listTrips();
    expect(Array.isArray(trips)).toBe(true);
  });

  it("returns a real AppError for a missing trip", async () => {
    let error: AppError | undefined;
    try {
      await gateway.getTrip("trip_does_not_exist");
    } catch (caught) {
      error = caught as AppError;
    }
    expect(error?.code).toBe("trip/not_found");
    expect(typeof error?.message).toBe("string");
  });

  it("round-trips a create → read → delete lifecycle", async () => {
    const trip = await gateway.createTrip({
      title: "Live gateway smoke",
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-05-01",
      endDate: "2027-05-08",
    });
    expect(trip.id).toBeTruthy();

    const detail = await gateway.getTrip(trip.id);
    expect(detail.trip.id).toBe(trip.id);

    await gateway.deleteTrip(trip.id);
    await expect(gateway.getTrip(trip.id)).rejects.toMatchObject({
      code: "trip/not_found",
    });
  });
});
