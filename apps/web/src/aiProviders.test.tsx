import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderSettings } from "./test/helpers";

async function openProviders() {
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
    await renderSettings(gateway);

    const region = await screen.findByRole("region", { name: "AI providers" });
    // Opening Settings must not touch the keychain.
    expect(calls).toBe(0);

    fireEvent.click(
      within(region).getByRole("button", { name: "Manage AI providers" }),
    );
    expect(await within(region).findByText("OpenAI")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("validates then stores a key without echoing the value", async () => {
    await renderSettings(createMockGateway());
    const region = await openProviders();

    await within(region).findByText("OpenAI");
    const openaiRow = within(region).getByText("OpenAI").closest("li")!;
    const keyField = within(openaiRow).getByLabelText("OpenAI API key");
    fireEvent.change(keyField, { target: { value: "sk-secret-value" } });
    fireEvent.click(
      within(openaiRow).getByRole("button", { name: "Validate & save" }),
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

  it("does not store a key the provider rejects, and shows why", async () => {
    await renderSettings(createMockGateway());
    const region = await openProviders();

    await within(region).findByText("OpenAI");
    const openaiRow = within(region).getByText("OpenAI").closest("li")!;
    // The mock rejects any key containing "bad".
    fireEvent.change(within(openaiRow).getByLabelText("OpenAI API key"), {
      target: { value: "sk-bad-key" },
    });
    fireEvent.click(
      within(openaiRow).getByRole("button", { name: "Validate & save" }),
    );

    expect(await within(openaiRow).findByRole("alert")).toHaveTextContent(
      /rejected/i,
    );
    // The key was not stored: no "Key stored", and the input is still offered.
    expect(within(openaiRow).queryByText("Key stored")).toBeNull();
    expect(
      within(openaiRow).getByRole("button", { name: "Validate & save" }),
    ).toBeInTheDocument();
  });

  it("guides the user to where they can get an API key", async () => {
    await renderSettings(createMockGateway());
    const region = await openProviders();

    const openaiRow = (await within(region).findByText("OpenAI")).closest(
      "li",
    )!;
    const link = within(openaiRow).getByRole("link", { name: /API keys page/ });
    expect(link).toHaveAttribute(
      "href",
      "https://platform.openai.com/api-keys",
    );
  });

  it("does not offer a key field for the on-device provider", async () => {
    await renderSettings(createMockGateway());
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
