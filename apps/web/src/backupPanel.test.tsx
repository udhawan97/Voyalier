import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

import type {
  BackupGateway,
  RestoreInspection,
  RestorePreview,
} from "./backup";
import { createUnsupportedBackup } from "./backup";
import { setLocalePreference } from "./app/locale";
import { BackupPanel } from "./views/BackupPanel";

function fakeBackup(overrides: Partial<BackupGateway> = {}): BackupGateway {
  return {
    kind: "tauri",
    exportBackup: () => Promise.resolve("/Users/traveler/voyalier-backup.vbk"),
    inspectRestore: () => Promise.resolve(null),
    confirmRestore: () => Promise.resolve(PREVIEW),
    cancelRestoreInspection: () => Promise.resolve(false),
    hasPendingRestore: () => Promise.resolve(false),
    unstageRestore: () => Promise.resolve(false),
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
  afterEach(() => setLocalePreference("en"));

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

  it("inspects, then confirms a restore before staging it", async () => {
    const inspection: RestoreInspection = {
      inspectionId: "restore_inspection_test",
      preview: PREVIEW,
    };
    const inspected: string[] = [];
    const confirmed: string[] = [];
    render(
      <BackupPanel
        backup={fakeBackup({
          inspectRestore: (passphrase) => {
            inspected.push(passphrase);
            return Promise.resolve(inspection);
          },
          confirmRestore: (id, passphrase) => {
            confirmed.push(`${id}:${passphrase}`);
            return Promise.resolve(PREVIEW);
          },
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Restore from a backup" }),
    );
    typeInto("Backup passphrase", "correct horse battery");
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect this backup" }),
    );

    await screen.findByText(/^Backup from/);
    expect(inspected).toEqual(["correct horse battery"]);
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
    expect(confirmed).toEqual([
      "restore_inspection_test:correct horse battery",
    ]);
  });

  it("surfaces a refused restore instead of staging it", async () => {
    render(
      <BackupPanel
        backup={fakeBackup({
          inspectRestore: () =>
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
      screen.getByRole("button", { name: "Inspect this backup" }),
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

  it("separates source-mode SQLite persistence from portable desktop backup", async () => {
    render(<BackupPanel backup={createUnsupportedBackup()} />);

    const explanation = await screen.findByText(
      /browser-from-source build still stores your workspace in local SQLite/i,
    );
    expect(explanation).toHaveTextContent(/portable encrypted backup/i);
    expect(explanation).not.toHaveTextContent(/no local database/i);
    expect(
      screen.queryByRole("button", { name: "Save a backup" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the same storage/capability distinction in Spanish", async () => {
    setLocalePreference("es");
    render(<BackupPanel backup={createUnsupportedBackup()} />);

    const explanation = await screen.findByText(
      /versión desde código fuente en el navegador sigue guardando tu espacio de trabajo en SQLite local/i,
    );
    expect(explanation).toHaveTextContent(
      /copia de seguridad cifrada portátil/i,
    );
    expect(explanation).not.toHaveTextContent(
      /no hay una base de datos local/i,
    );
  });
});
