/**
 * Workspace backup and restore.
 *
 * Like the updater, this is a desktop-only capability that bypasses the
 * cross-transport `AppGateway`: it touches the local database file, the OS
 * keychain, and native file pickers, none of which mean anything over HTTP.
 * The webview never reads or writes a file — it asks a Rust command to, and the
 * command opens the picker and does the IO itself.
 */

/** What a staged backup says about itself, so the traveler can confirm it. */
export interface RestorePreview {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
}

/** Opaque process-local handle for a read-only inspected backup. */
export interface RestoreInspection {
  inspectionId: string;
  preview: RestorePreview;
}

export interface BackupGateway {
  /** "unsupported" outside the desktop app, which the panel shows plainly. */
  kind: "tauri" | "unsupported";
  /**
   * Write an encrypted backup. Resolves to the chosen path, or `null` when the
   * traveler cancelled the picker — cancelling is a normal outcome, not an error.
   */
  exportBackup(passphrase: string): Promise<string | null>;
  /** Read and preview a chosen backup without creating pending restore state. */
  inspectRestore(passphrase: string): Promise<RestoreInspection | null>;
  /** Consume one inspected artifact and stage exactly one generation. */
  confirmRestore(
    inspectionId: string,
    passphrase: string,
  ): Promise<RestorePreview>;
  /** Discard an in-memory inspection session. */
  cancelRestoreInspection(inspectionId: string): Promise<boolean>;
  /** Whether a staged restore is waiting, so the UI can prompt for a restart. */
  hasPendingRestore(): Promise<boolean>;
  /** Remove the exact staged generation, without touching the live workspace. */
  unstageRestore(): Promise<boolean>;
}
