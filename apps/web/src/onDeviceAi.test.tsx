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
      within(region).getByText(/always on this device, always opt-in/),
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
});
