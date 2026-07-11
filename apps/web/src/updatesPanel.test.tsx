import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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

  it("uses the Windows per-platform install copy", async () => {
    const updater = createMockUpdater({
      platform: "windows",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
    });
    render(<Harness updater={updater} />);
    expect(
      await screen.findByRole("button", { name: "Update and restart" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Voyalier will close, update, and reopen (under a minute).",
      ),
    ).toBeInTheDocument();
  });

  it("renders a labelled progressbar with the download percentage", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updater = createMockUpdater({
      platform: "macos",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
      progress: [{ downloaded: 50, total: 100 }],
      hold,
    });
    render(<Harness updater={updater} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Download and install" }),
    );

    const bar = await screen.findByRole("progressbar", {
      name: "Update download progress",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("50% downloaded")).toBeInTheDocument();

    release();
    await act(async () => {
      await Promise.resolve();
    });
    await screen.findByText("Update installed");
  });

  it("shows an indeterminate bar when the download size is unknown", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updater = createMockUpdater({
      platform: "macos",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
      progress: [{ downloaded: 4096, total: null }],
      hold,
    });
    render(<Harness updater={updater} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Download and install" }),
    );

    const bar = await screen.findByRole("progressbar", {
      name: "Update download progress",
    });
    // No total → no aria-valuenow, and the indeterminate copy is shown.
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("Downloading…")).toBeInTheDocument();
    release();
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("shows the disabled notice for a development build", async () => {
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: {
        availability: "disabled",
        currentVersion: "0.3.0",
        availableVersion: null,
        notes: null,
      },
    });
    render(<Harness updater={updater} />);
    expect(
      await screen.findByText(
        "This is a development build — in-app updates are disabled.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the offline error copy when the browser is offline", async () => {
    const original = Object.getOwnPropertyDescriptor(
      window.navigator,
      "onLine",
    );
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });
    try {
      const updater = createMockUpdater({
        settings: { [UPDATER_KEYS.consent]: "yes" },
        onCheck: new Error("offline"),
      });
      render(<Harness updater={updater} />);
      expect(
        await screen.findByText("You're offline. Reconnect and try again."),
      ).toBeInTheDocument();
    } finally {
      if (original) {
        Object.defineProperty(window.navigator, "onLine", original);
      }
    }
  });

  it("reverses the auto-check consent with the panel toggle (D1)", async () => {
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: {
        availability: "upToDate",
        currentVersion: "0.3.0",
        availableVersion: null,
        notes: null,
      },
    });
    render(<Harness updater={updater} />);
    await screen.findByText("You're on the latest version (0.3.0).");

    const toggle = screen.getByRole("checkbox", {
      name: "Check for updates automatically",
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(updater.store.get(UPDATER_KEYS.consent)).toBe("no"),
    );
    expect(toggle).not.toBeChecked();
  });

  it("clears update backups from the panel footer", async () => {
    const updater = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: {
        availability: "upToDate",
        currentVersion: "0.3.0",
        availableVersion: null,
        notes: null,
      },
    });
    await updater.backup("v0.3.0"); // an existing snapshot to clear
    render(<Harness updater={updater} />);
    await screen.findByText("You're on the latest version (0.3.0).");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear update backups" }),
    );
    await waitFor(() => expect(updater.clearBackupsCalls).toBe(1));
    expect(updater.backupCalls).toEqual([]);
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
