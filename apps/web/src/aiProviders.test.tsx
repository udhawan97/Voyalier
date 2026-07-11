import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

async function openProviders() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  const region = await screen.findByRole("region", { name: "AI providers" });
  fireEvent.click(
    within(region).getByRole("button", { name: "Manage AI providers" }),
  );
  return region;
}

/**
 * BYOK provider config: lazy (no keychain touch until asked), keys are
 * write-only (entered, never rendered back), and Ollama needs none.
 */
describe("AI providers (BYOK)", () => {
  it("does not read providers until asked", async () => {
    let calls = 0;
    const base = createMockGateway();
    const gateway = {
      ...base,
      listProviders: () => {
        calls += 1;
        return base.listProviders();
      },
    };
    renderApp(gateway);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const region = await screen.findByRole("region", { name: "AI providers" });
    expect(calls).toBe(0);

    fireEvent.click(
      within(region).getByRole("button", { name: "Manage AI providers" }),
    );
    expect(await within(region).findByText("OpenAI")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("stores a key and shows it as stored without echoing the value", async () => {
    renderApp(createMockGateway());
    const region = await openProviders();

    await within(region).findByText("OpenAI");
    const openaiRow = within(region).getByText("OpenAI").closest("li")!;
    const keyField = within(openaiRow).getByLabelText("OpenAI API key");
    fireEvent.change(keyField, { target: { value: "sk-secret-value" } });
    fireEvent.click(
      within(openaiRow).getByRole("button", { name: "Save key" }),
    );

    expect(
      await within(openaiRow).findByText("Key stored"),
    ).toBeInTheDocument();
    // The key value must never be rendered back anywhere in the panel.
    expect(within(region).queryByText(/sk-secret-value/)).toBeNull();
    // A remove control replaces the input.
    expect(
      within(openaiRow).getByRole("button", { name: "Remove key" }),
    ).toBeInTheDocument();
  });

  it("does not offer a key field for the on-device provider", async () => {
    renderApp(createMockGateway());
    const region = await openProviders();

    const ollamaRow = (
      await within(region).findByText("Ollama (on-device)")
    ).closest("li")!;
    expect(within(ollamaRow).getByText("On-device")).toBeInTheDocument();
    expect(
      within(ollamaRow).getByText(/Runs locally on this device/),
    ).toBeInTheDocument();
    expect(within(ollamaRow).queryByLabelText(/API key/)).toBeNull();
  });
});
