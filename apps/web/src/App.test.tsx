import { render, screen } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { App } from "./App";
import { createMockUpdater } from "./updater/mockUpdater";
import { UPDATER_KEYS } from "./updater/types";

describe("App shell", () => {
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
    expect(await screen.findByText("Local core ready")).toBeInTheDocument();
  });
});
