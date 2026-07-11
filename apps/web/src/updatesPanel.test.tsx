import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { UpdaterContext } from "./app/context";
import { createMockUpdater } from "./updater/mockUpdater";
import { UPDATER_KEYS, type UpdaterGateway } from "./updater/types";
import { createUnsupportedUpdater } from "./updater/unsupportedUpdater";
import { useUpdater } from "./updater/useUpdater";
import { UpdatesPanel } from "./views/UpdatesPanel";

/** Mounts the App-level hook and provides it to the panel, like App.tsx does. */
function Harness({ updater }: { updater: UpdaterGateway }) {
  const controller = useUpdater(updater);
  return (
    <UpdaterContext.Provider value={controller}>
      <UpdatesPanel />
    </UpdaterContext.Provider>
  );
}

const available = (version: string) =>
  ({
    availability: "available" as const,
    currentVersion: "0.3.0",
    availableVersion: version,
    notes: "See https://example.com/notes",
  }) satisfies import("./updater/types").UpdateStatus;

describe("UpdatesPanel", () => {
  it("asks for consent, then checks and reports up to date", async () => {
    const updater = createMockUpdater({
      onCheck: {
        availability: "upToDate",
        currentVersion: "0.3.0",
        availableVersion: null,
        notes: null,
      },
    });
    render(<Harness updater={updater} />);

    expect(
      await screen.findByText("Check for updates automatically?"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, check automatically" }),
    );
    expect(
      await screen.findByText("You're on the latest version (0.3.0)."),
    ).toBeInTheDocument();
    expect(updater.store.get(UPDATER_KEYS.consent)).toBe("yes");
  });

  it("surfaces an available update with inert notes and skip/un-skip", async () => {
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
    });
    render(<Harness updater={updater} />);

    expect(
      await screen.findByText("Update available: 0.3.1"),
    ).toBeInTheDocument();
    // Notes render under the "unverified" label as inert text (no link element).
    expect(
      screen.getByText("Notes from GitHub (unverified)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("See https://example.com/notes"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /example\.com/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Skip this version" }));
    expect(
      await screen.findByText("You skipped this version."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Un-skip" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Skip this version" }),
      ).toBeInTheDocument(),
    );
  });

  it("installs and lands on a staged restart prompt", async () => {
    const updater = createMockUpdater({
      platform: "macos",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
      progress: [{ downloaded: 50, total: 100 }],
    });
    render(<Harness updater={updater} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Download and install" }),
    );
    expect(await screen.findByText("Update installed")).toBeInTheDocument();
    expect(
      screen.getByText("Restart Voyalier to finish updating to 0.3.1."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart Voyalier" }));
    await waitFor(() => expect(updater.relaunchCalls).toBe(1));
    expect(updater.backupCalls).toEqual(["v0.3.1"]);
  });

  it("shows a staged update at mount with a restart button", async () => {
    const updater = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "no",
        [UPDATER_KEYS.stagedVersion]: "0.3.1",
      },
    });
    render(<Harness updater={updater} />);
    expect(
      await screen.findByRole("button", { name: "Restart Voyalier" }),
    ).toBeInTheDocument();
  });

  it("shows an honest error with a releases link when the check fails", async () => {
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: new Error("boom"),
    });
    render(<Harness updater={updater} />);

    expect(
      await screen.findByText(
        "Couldn't check for updates — GitHub may be busy or unreachable.",
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View releases on GitHub/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/udhawan97/Voyalier/releases",
    );
  });

  it("shows the honest dual copy when updates are unsupported", async () => {
    render(
      <Harness
        updater={createUnsupportedUpdater({ currentVersion: "0.3.0" })}
      />,
    );
    expect(
      await screen.findByText("In-app updates aren't available here"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Running from source/)).toBeInTheDocument();
  });
});
