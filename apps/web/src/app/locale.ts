/**
 * The active display locale, resolved once. In a browser this is the user's
 * language; elsewhere (Node, tests) it falls back to `en-US` for deterministic
 * output. Kept in its own module so both the formatters and the message catalog
 * can depend on it without importing each other.
 */
export const APP_LOCALE: string =
  (typeof navigator !== "undefined" && navigator.language) || "en-US";
