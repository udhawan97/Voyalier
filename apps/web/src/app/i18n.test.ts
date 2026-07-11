import { t } from "./i18n";

/**
 * The message catalog foundation. English is the source of truth today, so `t()`
 * returns the canonical copy; these lock in interpolation and missing-variable
 * behavior so translations can be added without surprises.
 */
describe("i18n message catalog", () => {
  it("returns the English copy for a key", () => {
    expect(t("vault.section")).toBe("Encryption");
    expect(t("vault.state.on")).toBe("Passphrase protection is on.");
    expect(t("vault.unlock.title")).toBe("Your vault is locked");
  });

  it("interpolates named variables", () => {
    expect(t("vault.error.tooShort", { min: 8 })).toBe(
      "Use at least 8 characters.",
    );
    expect(t("vault.newPassphrase.placeholder", { min: 8 })).toBe(
      "New passphrase (8+ characters)",
    );
  });

  it("leaves an unknown placeholder untouched rather than blanking it", () => {
    // A caller that forgets a variable keeps the visible token instead of
    // rendering "undefined".
    expect(t("vault.error.tooShort")).toBe("Use at least {min} characters.");
  });
});
