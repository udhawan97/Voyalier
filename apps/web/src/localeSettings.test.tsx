import { fireEvent, screen } from "@testing-library/react";

import { setLocalePreference } from "./app/locale";
import { renderSettings } from "./test/helpers";

describe("language preference", () => {
  afterEach(() => setLocalePreference("en"));

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
});
