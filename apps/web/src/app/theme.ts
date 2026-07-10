import { useCallback, useEffect, useState } from "react";

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

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoiceState] = useState<ThemeChoice>(readThemeChoice);

  useEffect(() => {
    applyThemeChoice(choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    persistThemeChoice(next);
    setChoiceState(next);
  }, []);

  return [choice, setChoice];
}
