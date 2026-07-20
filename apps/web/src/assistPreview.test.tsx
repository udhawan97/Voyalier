import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { renderApp } from "./test/helpers";

async function openTrip() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  return screen.findByRole("region", { name: "Preview an AI request" });
}

/**
 * The assist preview is the consent step: it shows exactly what would be sent,
 * built with secrets excluded by construction, and it transmits nothing.
 */
describe("AI request preview", () => {
  afterEach(() => setLocalePreference("en"));

  it("builds no preview until asked, then shows a redacted local request", async () => {
    let calls = 0;
    const base = createMockGateway();
    const gateway = {
      ...base,
      previewAssist: (
        tripId: string,
        provider: Parameters<typeof base.previewAssist>[1],
      ) => {
        calls += 1;
        return base.previewAssist(tripId, provider);
      },
    };
    renderApp(gateway);

    const region = await openTrip();
    expect(calls).toBe(0);

    fireEvent.click(
      within(region).getByRole("button", { name: "Preview request" }),
    );

    // Default provider is Ollama → the request stays on the device.
    expect(
      await within(region).findByText(/run locally on this device/i),
    ).toBeInTheDocument();
    expect(calls).toBe(1);

    // Grounded in confirmed facts, with secrets excluded by construction.
    expect(within(region).getByText(/FP18/)).toBeInTheDocument();
    expect(within(region).queryByText(/VOY182/)).toBeNull();
    expect(within(region).queryByText(/RPI731/)).toBeNull();
    expect(within(region).getByText("Confirmation codes")).toBeInTheDocument();
    expect(
      within(region).getByText("Imported document text"),
    ).toBeInTheDocument();

    // Citation of the grounding and a token estimate for cost awareness.
    expect(
      within(region).getByText(/Based on .*flight.*~\d+ tokens/),
    ).toBeInTheDocument();
  });

  it("warns and offers to send when the chosen provider is cloud", async () => {
    renderApp(createMockGateway());
    const region = await openTrip();

    fireEvent.change(within(region).getByLabelText("Provider to preview"), {
      target: { value: "openai" },
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Preview request" }),
    );

    expect(
      await within(region).findByText(/leave your device to OpenAI/i),
    ).toBeInTheDocument();
    expect(
      within(region).getByText("https://api.openai.com/v1/chat/completions"),
    ).toBeInTheDocument();
    // Cloud offers a "Send to <provider>" action, not the on-device one.
    expect(
      within(region).queryByRole("button", { name: "Run on-device assist" }),
    ).toBeNull();
    expect(
      within(region).getByRole("button", { name: "Send to OpenAI" }),
    ).toBeInTheDocument();

    // Sending without a stored key surfaces a clear, non-destructive error.
    fireEvent.click(
      within(region).getByRole("button", { name: "Send to OpenAI" }),
    );
    expect(
      await within(region).findByText(
        /Check the entered values and try again/i,
      ),
    ).toBeInTheDocument();
  });

  it("runs on-device assist and shows the reply with a non-authoritative disclaimer", async () => {
    renderApp(createMockGateway());
    const region = await openTrip();

    // Default provider is Ollama.
    fireEvent.click(
      within(region).getByRole("button", { name: "Preview request" }),
    );
    fireEvent.click(
      await within(region).findByRole("button", {
        name: "Run on-device assist",
      }),
    );

    expect(await within(region).findByText(/looks ready/i)).toBeInTheDocument();
    expect(
      within(region).getByText(/never treats this as authoritative/i),
    ).toBeInTheDocument();

    // The run is recorded in the visible activity log.
    const log = await within(region).findByRole("list", {
      name: "Assist activity log",
    });
    expect(within(log).getByText("llama3.2")).toBeInTheDocument();
  });

  it("localizes grounding and withheld field names in Spanish", async () => {
    setLocalePreference("es");
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir Kyoto autumn journey",
      }),
    );
    const region = await screen.findByRole("region", {
      name: "Vista previa de la solicitud de IA",
    });
    fireEvent.click(
      within(region).getByRole("button", {
        name: "Vista previa de la solicitud",
      }),
    );
    expect(
      await within(region).findByText(/Basado en 1 vuelo confirmado/),
    ).toBeInTheDocument();
    expect(
      within(region).getByText("Códigos de confirmación"),
    ).toBeInTheDocument();
    expect(
      within(region).getByText("Texto de documentos importados"),
    ).toBeInTheDocument();
    expect(within(region).queryByText("Confirmation codes")).toBeNull();
  });
});
