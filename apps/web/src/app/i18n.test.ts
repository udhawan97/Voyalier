import { catalogs, plural, t } from "./i18n";
import { APP_LOCALE, setLocalePreference } from "./locale";
import register from "@voyalier/contracts/parity/data-sources.json";

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
    expect(plural("search.matches", 10000, { query: "mapa" })).toBe(
      "10.000 coincidencias para mapa.",
    );
  });

  it("resolves the system preference through a regional Spanish locale", () => {
    const language = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("es-MX");
    setLocalePreference("system");

    expect(APP_LOCALE).toBe("es-MX");
    expect(document.documentElement.lang).toBe("es");
    expect(t("settings.title")).toBe("Configuración");

    language.mockRestore();
  });

  it("keeps an unsupported system locale while falling back to English copy", () => {
    const language = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("fr-FR");
    setLocalePreference("system");

    expect(APP_LOCALE).toBe("fr-FR");
    expect(document.documentElement.lang).toBe("en");
    expect(t("settings.title")).toBe("Settings");

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

  it("catalogs every product-authored source boundary", () => {
    for (const source of register.sources) {
      for (const field of ["use", "network", "authority"]) {
        const key = `dataSources.${source.id}.${field}`;
        expect(key in catalogs.en, key).toBe(true);
        expect(key in catalogs.es, key).toBe(true);
      }
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

  it("names both instruments in the exempt heading, in every locale", () => {
    // "Neither is published for this passport" began mid-thought: the two it
    // meant live in sibling strings that render on their own branches, so an
    // electronic travel authorization was named nowhere the reader could see.
    // ADR-0006 also forbids turning a publication state into an entry outcome,
    // so this must stay a sentence about what was published.
    expect(t("visa.path.exempt")).toBe(
      "Neither a visa nor an electronic travel authorization is published for this passport",
    );

    setLocalePreference("es");
    expect(t("visa.path.exempt")).toBe(
      "No se publica ni visado ni autorización electrónica de viaje para este pasaporte",
    );

    for (const locale of ["en", "es"] as const) {
      const copy = catalogs[locale]["visa.path.exempt"];
      // Never an eligibility claim — the failure mode ADR-0006's amendment names
      // is someone reading "no visa required" and arriving without one.
      for (const forbidden of [
        "visa-free",
        "sin visado",
        "no visa is required",
        "no requiere visado",
      ]) {
        expect(copy.toLowerCase(), locale).not.toContain(forbidden);
      }
    }
  });

  it("distinguishes visa checklist totals from visible guide steps", () => {
    expect(plural("visa.progress", 4, { done: 0, total: 1 })).toBe(
      "Checklist: 0 of 1 complete across 4 guide steps. Voyalier has not verified any item.",
    );

    setLocalePreference("es");
    expect(plural("visa.progress", 1, { done: 0, total: 1 })).toBe(
      "Lista: 0 de 1 completado en 1 paso de la guía. Voyalier no ha verificado ningún elemento.",
    );
  });
});
