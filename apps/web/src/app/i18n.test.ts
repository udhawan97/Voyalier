import { catalogs, plural, t } from "./i18n";
import { APP_LOCALE, setLocalePreference } from "./locale";

/**
 * The message catalog foundation. English is the source of truth today, so `t()`
 * returns the canonical copy; these lock in interpolation and missing-variable
 * behavior so translations can be added without surprises.
 */
describe("i18n message catalog", () => {
  afterEach(() => setLocalePreference("en"));

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

  it("switches to the complete Spanish catalog without a reload", () => {
    setLocalePreference("es");
    expect(t("settings.title")).toBe("Configuración");
    expect(t("planning.packing.title")).toBe("Lista de equipaje");
  });

  it("resolves the system preference through a regional Spanish locale", () => {
    const language = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("es-MX");
    setLocalePreference("system");

    expect(APP_LOCALE).toBe("es-MX");
    expect(t("settings.title")).toBe("Configuración");

    language.mockRestore();
  });

  it("keeps exact key and placeholder parity in Spanish", () => {
    expect(Object.keys(catalogs.es)).toEqual(Object.keys(catalogs.en));
    expect(Object.values(catalogs.es).every((value) => value.trim())).toBe(
      true,
    );

    const placeholders = (value: string) =>
      [...value.matchAll(/\{\w+\}/g)].map(([token]) => token).sort();
    for (const key of Object.keys(catalogs.en) as Array<
      keyof typeof catalogs.en
    >) {
      expect(placeholders(catalogs.es[key]), key).toEqual(
        placeholders(catalogs.en[key]),
      );
    }
  });

  it("ships both plural forms for every plural message", () => {
    const keys = new Set(Object.keys(catalogs.en));
    for (const key of keys) {
      if (!key.endsWith(".one")) continue;
      const base = key.slice(0, -4);
      expect(keys.has(`${base}.other`), base).toBe(true);
      expect(`${base}.one` in catalogs.es, base).toBe(true);
      expect(`${base}.other` in catalogs.es, base).toBe(true);
    }

    setLocalePreference("es");
    expect(plural("tripcard.facts", 1)).toBe("dato confirmado");
    expect(plural("tripcard.facts", 2)).toBe("datos confirmados");
  });
});
