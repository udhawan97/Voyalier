import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

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
  });

  it("warns when the chosen provider would leave the device", async () => {
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
  });
});
