import { describe, expect, it } from "vitest";

import {
  sourceBrowserCsp,
  validateSourceApiOrigin,
} from "./sourceBrowserSecurity";

describe("source browser CSP", () => {
  it("allows only the selected API origin and a nonce for scripts", () => {
    const policy = sourceBrowserCsp("launch-nonce", "http://127.0.0.1:49152");

    expect(policy).toContain("script-src 'self' 'nonce-launch-nonce'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("http://127.0.0.1:49152");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("http://127.0.0.1:*");
  });

  it("rejects a remote API origin", () => {
    expect(() => validateSourceApiOrigin("https://example.com")).toThrow(
      /loopback/,
    );
  });
});
