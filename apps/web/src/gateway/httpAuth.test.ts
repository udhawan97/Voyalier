import { describe, expect, it, vi } from "vitest";

import { createHttpGateway } from "./http";

describe("HTTP gateway authorization", () => {
  it("sends the per-launch bearer to the selected API origin", async () => {
    const doFetch = vi.fn(async () =>
      Response.json({ status: "ok", intelligenceMode: "local" }),
    );
    const gateway = createHttpGateway({
      baseUrl: "http://127.0.0.1:49152",
      authToken: "secret-launch-token",
      fetch: doFetch as typeof fetch,
    });

    await gateway.health();

    expect(doFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:49152/api/health",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret-launch-token" },
      }),
    );
  });
});
