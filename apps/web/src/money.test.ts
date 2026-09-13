import { describe, expect, it } from "vitest";
import {
  currencyMinorDigits,
  formatMinorAmount,
  parseMinorAmount,
} from "./app/money";

describe("exact concierge money", () => {
  it("preserves currencies with zero, two and three minor digits", () => {
    expect(currencyMinorDigits("JPY")).toBe(0);
    expect(currencyMinorDigits("USD")).toBe(2);
    expect(currencyMinorDigits("KWD")).toBe(3);
    expect(parseMinorAmount("1234", "JPY")).toBe(1234);
    expect(() => parseMinorAmount("1.005", "USD")).toThrow("2 decimal");
    expect(parseMinorAmount("1.234", "KWD")).toBe(1234);
    expect(formatMinorAmount(1234, "KWD")).toContain("1.234");
  });

  it("refuses excess precision and unsafe integer storage", () => {
    expect(() => parseMinorAmount("1.2", "JPY")).toThrow("0 decimal");
    expect(() => parseMinorAmount("9007199254740992", "USD")).toThrow(
      "too large",
    );
  });
});
