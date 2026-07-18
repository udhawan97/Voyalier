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

export interface BackupGateway {
  /** "unsupported" outside the desktop app, which the panel shows plainly. */
  kind: "tauri" | "unsupported";
  /**
   * Write an encrypted backup. Resolves to the chosen path, or `null` when the
   * traveler cancelled the picker — cancelling is a normal outcome, not an error.
   */
  exportBackup(passphrase: string): Promise<string | null>;
  /**
   * Validate a chosen backup and stage it for the next launch. Resolves to a
   * preview, or `null` when the picker was cancelled. Nothing in the live
   * workspace changes until the app restarts.
   */
  stageRestore(passphrase: string): Promise<RestorePreview | null>;
  /** Whether a staged restore is waiting, so the UI can prompt for a restart. */
  hasPendingRestore(): Promise<boolean>;
}
