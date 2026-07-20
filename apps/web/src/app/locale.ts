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
  return value === "system" ? systemLocale() : value;
}

/** Live ESM binding retained for the existing date/number format helpers. */
export let APP_LOCALE: string = resolveLocale(preference);

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
  document.documentElement.lang = APP_LOCALE.split("-")[0];
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function localeSnapshot(): string {
  return `${preference}:${APP_LOCALE}`;
}
