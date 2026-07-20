import {
  APP_LOCALE,
  formatDate,
  formatDateIn,
  formatDateRange,
  formatDateTimeLocal,
  formatTimeLocal,
} from "./format";
import { setLocalePreference } from "./locale";

/**
 * Date formatting is now locale-aware (via Intl) but must keep the contract's
 * wall-clock semantics: the calendar day never shifts, and the default (en-US)
 * output is unchanged.
 */
describe("date formatting", () => {
  it("keeps the familiar en-US output", () => {
    expect(formatDateIn("2027-04-01", "en-US")).toBe("Apr 1, 2027");
    expect(formatDateIn("2026-11-03", "en-US")).toBe("Nov 3, 2026");
  });

  it("never shifts the calendar day (anchored to UTC)", () => {
    // A day-boundary date must format as that same day regardless of the host
    // timezone — the old bug this guards against was Date() offsetting it.
    expect(formatDateIn("2026-01-01", "en-US")).toBe("Jan 1, 2026");
    expect(formatDateIn("2026-12-31", "en-US")).toBe("Dec 31, 2026");
  });

  it("localizes month names for other locales", () => {
    const value = "2027-04-01";
    const en = formatDateIn(value, "en-US");
    const fr = formatDateIn(value, "fr-FR");
    // Genuinely locale-dependent output, without asserting a brittle exact
    // string (ICU wording varies by runtime).
    expect(fr).not.toBe(en);
    expect(fr).not.toBe(value);
    expect(fr).toContain("2027");
  });

  it("returns unparseable input verbatim", () => {
    expect(formatDateIn("not-a-date", "en-US")).toBe("not-a-date");
    expect(formatDate("")).toBe("");
  });

  it("localizes wall-clock time without shifting it", () => {
    setLocalePreference("en");
    expect(formatDateTimeLocal("2026-11-03T11:20")).toBe(
      `${formatDate("2026-11-03")} · 11:20 AM`,
    );
    const english = formatTimeLocal("13:05");
    setLocalePreference("es");
    const spanish = formatTimeLocal("13:05");
    expect(english).toMatch(/1:05\sPM/i);
    expect(spanish).toContain("13:05");
    expect(spanish).not.toBe(english);
    setLocalePreference("en");
    // No "T" → falls back to a plain date.
    expect(formatDateTimeLocal("2026-11-03")).toBe(formatDate("2026-11-03"));
  });

  it("renders a date range with the active locale", () => {
    expect(formatDateRange("2027-04-01", "2027-04-10")).toBe(
      `${formatDate("2027-04-01")} – ${formatDate("2027-04-10")}`,
    );
  });

  it("resolves a usable default locale", () => {
    expect(APP_LOCALE).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
  });
});
