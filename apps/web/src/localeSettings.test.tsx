import { fireEvent, screen } from "@testing-library/react";

import { APP_LOCALE, setLocalePreference } from "./app/locale";
import { renderApp, renderSettings } from "./test/helpers";

describe("language preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setLocalePreference("en");
  });

  it("re-renders the visible interface immediately in Spanish", async () => {
    setLocalePreference("en");
    await renderSettings();
    const language = screen.getByRole("combobox", { name: "Language" });
    language.focus();
    fireEvent.change(language, {
      target: { value: "es" },
    });
    expect(
      await screen.findByRole("heading", { name: "Configuración", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fuentes de datos y licencias"),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
    expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveFocus();
  });

  it("localizes trip status badges", async () => {
    setLocalePreference("es");
    renderApp();
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("keeps the browser region when System is selected", () => {
    const language = vi.spyOn(navigator, "language", "get");
    language.mockReturnValue("en-GB");
    setLocalePreference("system");
    expect(APP_LOCALE).toBe("en-GB");
    expect(document.documentElement.lang).toBe("en");

    language.mockReturnValue("es-MX");
    setLocalePreference("system");
    expect(APP_LOCALE).toBe("es-MX");
    expect(document.documentElement.lang).toBe("es");
  });
});
