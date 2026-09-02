import { afterEach, describe, expect, it } from "vitest";

import { consumeSourceBootstrap } from "./sourceBootstrap";

afterEach(() => {
  delete window.__VOYALIER_HTTP_BOOTSTRAP__;
});

describe("source browser bootstrap", () => {
  it("consumes and removes a valid loopback launch credential", () => {
    const bearer = "ab".repeat(32);
    Object.defineProperty(window, "__VOYALIER_HTTP_BOOTSTRAP__", {
      configurable: true,
      enumerable: false,
      value: { baseUrl: "http://127.0.0.1:49152", bearer },
    });

    expect(consumeSourceBootstrap()).toEqual({
      baseUrl: "http://127.0.0.1:49152",
      bearer,
    });
    expect("__VOYALIER_HTTP_BOOTSTRAP__" in window).toBe(false);
    expect(consumeSourceBootstrap()).toBeUndefined();
  });

  it("rejects a non-loopback API without leaving the credential on window", () => {
    window.__VOYALIER_HTTP_BOOTSTRAP__ = {
      baseUrl: "https://example.com",
      bearer: "ab".repeat(32),
    };

    expect(() => consumeSourceBootstrap()).toThrow(/loopback/);
    expect("__VOYALIER_HTTP_BOOTSTRAP__" in window).toBe(false);
  });
});
