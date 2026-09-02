import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__VOYALIER_HTTP_BOOTSTRAP__;
  vi.resetModules();
});

it("selects one authenticated source gateway across StrictMode initialization", async () => {
  const bearer = "ab".repeat(32);
  Object.defineProperty(window, "__VOYALIER_HTTP_BOOTSTRAP__", {
    configurable: true,
    enumerable: false,
    value: { baseUrl: "http://127.0.0.1:49152", bearer },
  });
  const doFetch = vi.fn(async () =>
    Response.json({ status: "ok", intelligenceMode: "local", version: "test" }),
  );
  vi.stubGlobal("fetch", doFetch);
  const { selectGateway } = await import("./index");

  const first = selectGateway();
  const strictModeSecond = selectGateway();

  expect(strictModeSecond).toBe(first);
  expect("__VOYALIER_HTTP_BOOTSTRAP__" in window).toBe(false);
  await first.health();
  expect(doFetch).toHaveBeenCalledWith(
    "http://127.0.0.1:49152/api/health",
    expect.objectContaining({
      headers: { Authorization: `Bearer ${bearer}` },
    }),
  );
});
