import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { App } from "./App";
import { createMockUpdater } from "./updater/mockUpdater";
import { UPDATER_KEYS } from "./updater/types";

describe("App shell", () => {
  it("offers the updates surface even while the vault is locked (D2)", async () => {
    const gateway: AppGateway = {
      ...createMockGateway(),
      getVaultStatus: () =>
        Promise.resolve({ active: false, protected: true, locked: true }),
    };
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: {
        availability: "available",
        currentVersion: "0.3.0",
        availableVersion: "0.3.1",
        notes: null,
      },
    });
    render(<App gateway={gateway} updater={updater} />);

    // The unlock gate stands in for the workspace...
    await screen.findByRole("heading", { name: "Your vault is locked" });
    // ...but a locked user can still reach the updater (it needs no trip data).
    expect(
      screen.getByRole("heading", { name: "Updates" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Update available: 0.3.1"),
    ).toBeInTheDocument();
  });

  it("shows the updated-to toast when the running build is newer than last seen", async () => {
    const updater = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "yes",
        [UPDATER_KEYS.lastSeenVersion]: "0.3.0",
      },
      onCheck: {
        availability: "upToDate",
        currentVersion: "0.3.1",
        availableVersion: null,
        notes: null,
      },
    });
    render(<App gateway={createMockGateway()} updater={updater} />);
    expect(
      await screen.findByText("Updated to Voyalier 0.3.1."),
    ).toBeInTheDocument();
  });
  it("renders the trip workspace with the seeded trips", async () => {
    render(<App gateway={createMockGateway()} />);

    expect(
      screen.getByRole("heading", { name: "Trips", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Voyalier — all trips")).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Color theme" }),
    ).toBeInTheDocument();

    // Seeded fixtures load through the injected mock gateway.
    expect(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Ready")).toBeInTheDocument();
  });

  it("restores the active trip on reload and clears it when returning home", async () => {
    const gateway = createMockGateway();
    const first = render(<App gateway={gateway} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    window.history.replaceState({}, "", "#section-plan");
    first.unmount();

    const second = render(<App gateway={gateway} />);
    expect(
      await screen.findByRole("heading", {
        name: "Kyoto autumn journey",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#section-plan");

    fireEvent.click(screen.getByRole("button", { name: "All trips" }));
    await screen.findByRole("heading", { name: "Trips", level: 1 });
    await waitFor(() => expect(window.location.hash).toBe(""));
    second.unmount();

    render(<App gateway={gateway} />);
    expect(
      screen.getByRole("heading", { name: "Trips", level: 1 }),
    ).toBeInTheDocument();
  });
});
