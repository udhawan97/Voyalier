import { fireEvent, screen } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

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
    expect(
      await screen.findByText(
        "Confirmation codes and traveler names are encrypted on this device. Add a passphrase for a second layer that protects your data even on an unlocked computer.",
        { selector: ".voy-vault__intro" },
      ),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByText(
        "Los códigos de confirmación y los nombres de los viajeros están cifrados en este dispositivo. Añade una frase de contraseña para una segunda capa que proteja tus datos incluso en una computadora desbloqueada.",
        { selector: ".voy-vault__intro" },
      ),
    ).toBeInTheDocument();
  });

  it("keeps the protected Vault sentence boundary in English and Spanish", async () => {
    const gateway = createMockGateway();
    await renderSettings({
      ...gateway,
      getVaultStatus: () =>
        Promise.resolve({ active: true, protected: true, locked: false }),
    });
    expect(
      await screen.findByText(
        "Confirmation codes and traveler names are encrypted on this device. A passphrase you chose also guards the key — Voyalier asks for it when it launches.",
        { selector: ".voy-vault__intro" },
      ),
    ).toBeInTheDocument();

    const language = screen.getByRole("combobox", { name: "Language" });
    fireEvent.change(language, { target: { value: "es" } });
    expect(
      await screen.findByText(
        "Los códigos de confirmación y los nombres de los viajeros están cifrados en este dispositivo. Una frase de contraseña que elegiste también protege la clave; Voyalier te la pedirá al iniciar.",
        { selector: ".voy-vault__intro" },
      ),
    ).toBeInTheDocument();
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
