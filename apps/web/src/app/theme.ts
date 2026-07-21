import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "voyalier-theme";
const CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && CHOICES.includes(stored as ThemeChoice)) {
      return stored as ThemeChoice;
    }
  } catch {
    // localStorage may be unavailable (private mode) — fall back to system.
  }
  return "system";
}

/**
 * "system" removes the attribute so the prefers-color-scheme media query drives
 * the palette; an explicit choice stamps data-theme on <html>, winning by
 * specificity (see tokens.css).
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
}

function persistThemeChoice(choice: ThemeChoice): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, choice);
  } catch {
    // Ignore persistence failures — the choice still applies this session.
  }
}

const listeners = new Set<() => void>();

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  globalThis.addEventListener?.("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", handleStorage);
  };
}

export function setThemeChoice(next: ThemeChoice): void {
  persistThemeChoice(next);
  applyThemeChoice(next);
  listeners.forEach((listener) => listener());
}

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const choice = useSyncExternalStore(
    subscribeTheme,
    readThemeChoice,
    readThemeChoice,
  );

  useEffect(() => {
    applyThemeChoice(choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setThemeChoice(next);
  }, []);

  return [choice, setChoice];
}
