/*
 * Ambient declaration for the global Tauri bridge.
 *
 * ADR-0002 temporarily sets `app.withGlobalTauri = true`, exposing
 * `window.__TAURI__.core.invoke` so the web package can reach the desktop
 * command bridge without depending on `@tauri-apps/api` during the contract
 * freeze. Detection is `"__TAURI__" in window` — never location protocol/host.
 */

interface TauriBridge {
  core: {
    invoke<T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T>;
  };
  /**
   * The event API (present under `withGlobalTauri`). The updater uses it to
   * receive streamed `updater://progress` events emitted from Rust.
   */
  event?: {
    listen<T = unknown>(
      event: string,
      handler: (event: { payload: T }) => void,
    ): Promise<() => void>;
  };
}

interface Window {
  __TAURI__?: TauriBridge;
}
