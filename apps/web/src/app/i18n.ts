import { APP_LOCALE } from "./format";

/**
 * Minimal message catalog — the localization-readiness foundation.
 *
 * UI strings are keyed by stable ids, with English as the source of truth today.
 * Additional locales are additive (a partial catalog keyed by the same ids), and
 * lookups fall back along the locale chain to English, so a missing translation
 * never leaves a blank. `{name}` placeholders are interpolated by [[t]].
 *
 * Components move onto `t()` incrementally; the vault UI is the reference. Adding
 * a translated locale later is a data-only change — no component edits.
 */

type Vars = Record<string, string | number>;

// English catalog: the current, canonical copy. Values are verbatim so moving a
// component onto t() changes no rendered text.
const en = {
  "vault.section": "Encryption",
  "vault.inactive":
    "A device keychain isn't available here, so sensitive fields are stored as plaintext and a passphrase can't be added. On macOS and Windows, Voyalier encrypts them automatically.",
  "vault.intro.base":
    "Confirmation codes and traveler names are encrypted on this device.",
  "vault.intro.protected":
    " A passphrase you chose also guards the key — Voyalier asks for it when it launches.",
  "vault.intro.unprotected":
    " Add a passphrase for a second layer that protects your data even on an unlocked computer.",
  "vault.state.on": "Passphrase protection is on.",
  "vault.state.off": "Passphrase protection is off.",
  "vault.currentPassphrase": "Current passphrase",
  "vault.currentPassphrase.placeholder": "Enter your current passphrase",
  "vault.newPassphrase": "New passphrase",
  "vault.newPassphrase.placeholder": "New passphrase ({min}+ characters)",
  "vault.confirmPassphrase": "Confirm passphrase",
  "vault.confirmPassphrase.placeholder": "Confirm passphrase",
  "vault.warn.noRecovery":
    "There is no recovery if you forget it — Voyalier can't reset a passphrase it never stores.",
  "vault.action.add": "Add a passphrase",
  "vault.action.set": "Set passphrase",
  "vault.action.remove": "Remove passphrase",
  "vault.action.cancel": "Cancel",
  "vault.error.tooShort": "Use at least {min} characters.",
  "vault.error.mismatch": "The two passphrases don't match.",
  "vault.error.generic": "That didn't work.",
  "vault.announce.set": "Passphrase set.",
  "vault.announce.removed": "Passphrase removed.",
  "vault.unlock.title": "Your vault is locked",
  "vault.unlock.intro":
    "Enter your passphrase to open this workspace. It's used only on this device to unlock your encrypted trip data.",
  "vault.unlock.passphrase": "Passphrase",
  "vault.unlock.action": "Unlock",
  "vault.unlock.error": "That passphrase didn't work.",
} as const;

export type MessageKey = keyof typeof en;

// Registry of locales. English is always present; others are added here.
const catalogs: Record<string, Partial<Record<MessageKey, string>>> = { en };

/** "fr-FR" → ["fr-fr", "fr", "en"]; always ends at English. */
function localeChain(locale: string): string[] {
  const parts = locale.toLowerCase().split("-");
  const chain: string[] = [];
  for (let count = parts.length; count > 0; count -= 1) {
    chain.push(parts.slice(0, count).join("-"));
  }
  if (!chain.includes("en")) chain.push("en");
  return chain;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Translate a message key for the active locale, interpolating `{name}` vars.
 * Falls back along the locale chain to the English source, which is exhaustive,
 * so a value is always returned.
 */
export function t(key: MessageKey, vars?: Vars): string {
  for (const locale of localeChain(APP_LOCALE)) {
    const value = catalogs[locale]?.[key];
    if (value != null) return interpolate(value, vars);
  }
  return interpolate(en[key], vars);
}
