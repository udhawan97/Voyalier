import { fireEvent, screen, within } from "@testing-library/react";
import type { AppGateway, LocalAiStatus } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, renderApp } from "./test/helpers";

async function openKyotoLocalAi() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  return screen.findByRole("region", { name: "On-device AI" });
}

/**
 * On-device AI is advisory, user-initiated detection: nothing is probed until
 * the traveler clicks Check, it never runs inference, and any failure degrades
 * to "not detected".
 */
describe("on-device AI detection", () => {
  it("does not probe until asked", async () => {
    let calls = 0;
    const gateway: AppGateway = {
      ...createMockGateway(),
      detectLocalAi: () => {
        calls += 1;
        return Promise.resolve({
          provider: "ollama",
          available: true,
          models: [{ name: "llama3.2:latest" }],
        } satisfies LocalAiStatus);
      },
    };
    renderApp(gateway);
    const region = await openKyotoLocalAi();

    // Mounting the trip detail must not trigger a probe.
    expect(calls).toBe(0);
    expect(within(region).queryByText("Available")).toBeNull();

    fireEvent.click(
      within(region).getByRole("button", { name: "Check for on-device AI" }),
    );
    expect(await within(region).findByText("Available")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("shows detected models after checking", async () => {
    renderApp(createMockGateway());
    const region = await openKyotoLocalAi();

    fireEvent.click(
      within(region).getByRole("button", { name: "Check for on-device AI" }),
    );

    expect(await within(region).findByText("Available")).toBeInTheDocument();
    expect(
      within(region).getByRole("list", { name: "Installed models" }),
    ).toBeInTheDocument();
    expect(within(region).getByText("llama3.2:latest")).toBeInTheDocument();
    expect(within(region).getByText("qwen2.5:7b")).toBeInTheDocument();
    expect(
      within(region).getByText(/Assist that uses these models is a later/),
    ).toBeInTheDocument();
  });

  it("guides installation when no runtime is detected", async () => {
    const gateway: AppGateway = {
      ...createMockGateway(),
      detectLocalAi: () =>
        Promise.resolve({
          provider: "ollama",
          available: false,
          models: [],
        } satisfies LocalAiStatus),
    };
    renderApp(gateway);
    const region = await openKyotoLocalAi();

    fireEvent.click(
      within(region).getByRole("button", { name: "Check for on-device AI" }),
    );
    expect(await within(region).findByText("Not detected")).toBeInTheDocument();
    const link = within(region).getByRole("link", { name: /Ollama/ });
    expect(link).toHaveAttribute("href", "https://ollama.com");
  });

  it("treats a detection failure as not-detected, not a crash", async () => {
    renderApp(
      failingGateway({
        detectLocalAi: () =>
          Promise.reject({ code: "transport/failure", message: "down" }),
      }),
    );
    const region = await openKyotoLocalAi();

    fireEvent.click(
      within(region).getByRole("button", { name: "Check for on-device AI" }),
    );
    expect(await within(region).findByText("Not detected")).toBeInTheDocument();
  });

  it("offers a copyable pull command but disables in-app download when not running", async () => {
    const gateway: AppGateway = {
      ...createMockGateway(),
      detectLocalAi: () =>
        Promise.resolve({
          provider: "ollama",
          available: false,
          models: [],
        } satisfies LocalAiStatus),
    };
    renderApp(gateway);
    const region = await openKyotoLocalAi();

    fireEvent.click(
      within(region).getByRole("button", { name: "Check for on-device AI" }),
    );
    await within(region).findByText("Not detected");

    const gemma = within(region).getByRole("listitem", { name: "Gemma · 12B" });
    // The exact pull command is shown for copy/paste...
    expect(
      within(gemma).getByText("ollama pull gemma4:12b-it-qat"),
    ).toBeInTheDocument();
    expect(
      within(gemma).getByRole("button", { name: "Copy command" }),
    ).toBeInTheDocument();
    // ...but downloading in-app needs a running Ollama, so it's disabled here.
    expect(
      within(gemma).getByRole("button", { name: "Download" }),
    ).toBeDisabled();
  });

  it("downloads a model in-app, then re-detects to show it installed", async () => {
    let pulled = false;
    const base = createMockGateway();
    const gateway: AppGateway = {
      ...base,
      detectLocalAi: () =>
        Promise.resolve({
          provider: "ollama",
          available: true,
          models: pulled ? [{ name: "gemma4:12b-it-qat" }] : [],
        } satisfies LocalAiStatus),
      pullLocalModel: (model) => {
        pulled = true;
        return Promise.resolve({
          ok: true,
          message: `${model} is downloaded and ready.`,
        });
      },
    };
    renderApp(gateway);
    const region = await openKyotoLocalAi();

    fireEvent.click(
      within(region).getByRole("button", { name: "Check for on-device AI" }),
    );
    // Running but empty: the "add a model" prompt and enabled Download appear.
    expect(
      await within(region).findByText(/Ollama is running/),
    ).toBeInTheDocument();
    const gemma = within(region).getByRole("listitem", { name: "Gemma · 12B" });
    fireEvent.click(within(gemma).getByRole("button", { name: "Download" }));

    // The pull triggers a re-detect that surfaces the newly installed model.
    const installed = await within(region).findByRole("list", {
      name: "Installed models",
    });
    expect(
      within(installed).getByText("gemma4:12b-it-qat"),
    ).toBeInTheDocument();
  });
});
