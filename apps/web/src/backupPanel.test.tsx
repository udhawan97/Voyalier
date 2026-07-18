import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { BackupGateway, RestorePreview } from "./backup";
import { createUnsupportedBackup } from "./backup";
import { BackupPanel } from "./views/BackupPanel";

function fakeBackup(overrides: Partial<BackupGateway> = {}): BackupGateway {
  return {
    kind: "tauri",
    exportBackup: () => Promise.resolve("/Users/traveler/voyalier-backup.vbk"),
    stageRestore: () => Promise.resolve(null),
    hasPendingRestore: () => Promise.resolve(false),
    ...overrides,
  };
}

const PREVIEW: RestorePreview = {
  createdAt: "2026-07-18T10:00:00Z",
  appVersion: "0.4.3",
  schemaVersion: 9,
};

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/**
 * Backing up is the only thing standing between a lost laptop and lost trips,
 * so the panel has to be honest: it never claims to have saved a file it did
 * not, it refuses a passphrase the traveler cannot have meant, and it says
 * plainly that a restore has not happened yet.
 */
describe("Backup & restore panel", () => {
  it("exports with a confirmed passphrase and reports where it landed", async () => {
    const calls: string[] = [];
    render(
      <BackupPanel
        backup={fakeBackup({
          exportBackup: (passphrase) => {
            calls.push(passphrase);
            return Promise.resolve("/Users/traveler/voyalier-backup.vbk");
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a backup" }));
    typeInto("Backup passphrase", "correct horse battery");
    typeInto("Confirm backup passphrase", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Save backup" }));

    await screen.findByText(/voyalier-backup\.vbk/);
    expect(calls).toEqual(["correct horse battery"]);
  });

  it("will not export when the two passphrases disagree", async () => {
    let called = false;
    render(
      <BackupPanel
        backup={fakeBackup({
          exportBackup: () => {
            called = true;
            return Promise.resolve(null);
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a backup" }));
    typeInto("Backup passphrase", "correct horse battery");
    typeInto("Confirm backup passphrase", "correct hoarse battery");
    fireEvent.click(screen.getByRole("button", { name: "Save backup" }));

    await screen.findByText("Those passphrases don't match.");
    expect(called).toBe(false);
  });

  it("will not export a backup nobody could open", async () => {
    let called = false;
    render(
      <BackupPanel
        backup={fakeBackup({
          exportBackup: () => {
            called = true;
            return Promise.resolve(null);
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a backup" }));
    typeInto("Backup passphrase", "short");
    typeInto("Confirm backup passphrase", "short");
    fireEvent.click(screen.getByRole("button", { name: "Save backup" }));

    await screen.findByText("Use at least 8 characters.");
    expect(called).toBe(false);
  });

  it("says a cancelled picker saved nothing, rather than claiming success", async () => {
    render(
      <BackupPanel
        backup={fakeBackup({ exportBackup: () => Promise.resolve(null) })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a backup" }));
    typeInto("Backup passphrase", "correct horse battery");
    typeInto("Confirm backup passphrase", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Save backup" }));

    await screen.findByText("No backup was saved.");
  });

  it("stages a restore and says it has not happened yet", async () => {
    render(
      <BackupPanel
        backup={fakeBackup({ stageRestore: () => Promise.resolve(PREVIEW) })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Restore from a backup" }),
    );
    typeInto("Backup passphrase", "correct horse battery");
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this backup" }),
    );

    // The wording must not imply the workspace already changed, and the date
    // must read as a date rather than a raw timestamp.
    const staged = await screen.findByText(/^Ready to restore a backup from/);
    expect(staged.textContent).toMatch(/nothing has changed yet/);
    expect(staged.textContent).toContain("Jul 18, 2026");
    expect(staged.textContent).not.toContain("T10:00:00Z");
  });

  it("surfaces a refused restore instead of staging it", async () => {
    render(
      <BackupPanel
        backup={fakeBackup({
          stageRestore: () =>
            Promise.reject(
              new Error(
                "this backup was made by a newer version of Voyalier — update the app, then restore",
              ),
            ),
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Restore from a backup" }),
    );
    typeInto("Backup passphrase", "correct horse battery");
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this backup" }),
    );

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/newer version/);
  });

  it("tells a waiting restore to restart", async () => {
    render(
      <BackupPanel
        backup={fakeBackup({ hasPendingRestore: () => Promise.resolve(true) })}
      />,
    );

    await screen.findByText(
      "A restore is waiting. Quit and reopen Voyalier to finish it.",
    );
  });

  it("offers nothing to click in a plain browser, and says why", async () => {
    render(<BackupPanel backup={createUnsupportedBackup()} />);

    await waitFor(() =>
      expect(screen.getByText(/needs the desktop app/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Save a backup" }),
    ).not.toBeInTheDocument();
  });
});
