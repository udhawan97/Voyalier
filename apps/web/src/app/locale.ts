export type LocalePreference = "system" | "en" | "es";

const STORAGE_KEY = "voyalier.locale";
const listeners = new Set<() => void>();

function systemLocale(): string {
  return (typeof navigator !== "undefined" && navigator.language) || "en-US";
}

function storedPreference(): LocalePreference {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value === "en" || value === "es" || value === "system"
      ? value
      : "system";
  } catch {
    return "system";
  }
}

let preference = storedPreference();

function resolveLocale(value: LocalePreference): string {
  if (value !== "system") return value;
  try {
    // Preserve the browser's region so System formats en-GB, es-MX, and other
    // locales as the traveler configured them. Message lookup still falls
    // through the exhaustive Spanish/English catalogs by language subtag.
    return Intl.getCanonicalLocales(systemLocale())[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}

/** Live ESM binding retained for the existing date/number format helpers. */
export let APP_LOCALE: string = resolveLocale(preference);

function applyDocumentLanguage(): void {
  if (typeof document !== "undefined") {
    // Only Spanish has a shipped non-English catalog. An unsupported system
    // locale keeps its region for Intl formatting, but the visible copy falls
    // back to English, so assistive technology must be told `en`.
    document.documentElement.lang = APP_LOCALE.toLowerCase().startsWith("es")
      ? "es"
      : "en";
  }
}

applyDocumentLanguage();

export function getLocalePreference(): LocalePreference {
  return preference;
}

export function setLocalePreference(value: LocalePreference): void {
  preference = value;
  APP_LOCALE = resolveLocale(value);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable in privacy modes; the session still switches.
  }
  applyDocumentLanguage();
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function localeSnapshot(): string {
  return `${preference}:${APP_LOCALE}`;
}
