import { fireEvent, screen, within } from "@testing-library/react";

import styles from "./styles.css?raw";
import { applyThemeChoice } from "./app/theme";
import { renderApp } from "./test/helpers";

describe("theme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("applies an explicit theme and clears it for system", () => {
    applyThemeChoice("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyThemeChoice("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyThemeChoice("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("the toggle updates the palette and persists the choice", async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {},
    });

    renderApp();
    const group = await screen.findByRole("radiogroup", {
      name: "Color theme",
    });
    fireEvent.click(within(group).getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(store["voyalier-theme"]).toBe("dark");
    expect(
      within(group).getByRole("radio", { name: "Dark" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("ships reduced-motion equivalents in the stylesheet", () => {
    expect(styles).toContain("prefers-reduced-motion");
  });
});
