import { render, screen, waitFor } from "@testing-library/react";

import { UpdaterContext } from "./app/context";
import { UpdatePill } from "./components/UpdatePill";
import { createMockUpdater } from "./updater/mockUpdater";
import { UPDATER_KEYS, type UpdaterGateway } from "./updater/types";
import type { UpdateStatus } from "./updater/types";
import { useUpdater } from "./updater/useUpdater";

function Harness({ updater }: { updater: UpdaterGateway }) {
  const controller = useUpdater(updater);
  return (
    <UpdaterContext.Provider value={controller}>
      <UpdatePill />
    </UpdaterContext.Provider>
  );
}

const available: UpdateStatus = {
  availability: "available",
  currentVersion: "0.3.0",
  availableVersion: "0.3.1",
  notes: null,
};

describe("UpdatePill", () => {
  it("shows the available pill when an update is offered", async () => {
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available,
    });
    render(<Harness updater={updater} />);
    expect(
      await screen.findByRole("button", { name: "Update available" }),
    ).toBeInTheDocument();
  });

  it("shows the restart pill when an update is staged", async () => {
    const updater = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "no",
        [UPDATER_KEYS.stagedVersion]: "0.3.1",
      },
    });
    render(<Harness updater={updater} />);
    expect(
      await screen.findByRole("button", { name: "Restart to update" }),
    ).toBeInTheDocument();
  });

  it("renders nothing when up to date", async () => {
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: {
        availability: "upToDate",
        currentVersion: "0.3.0",
        availableVersion: null,
        notes: null,
      },
    });
    const { container } = render(<Harness updater={updater} />);
    await waitFor(() =>
      expect(container.querySelector(".voy-updatepill")).toBeNull(),
    );
  });

  it("renders nothing without an updater controller (topbar in isolation)", () => {
    const { container } = render(<UpdatePill />);
    expect(container.firstChild).toBeNull();
  });
});
