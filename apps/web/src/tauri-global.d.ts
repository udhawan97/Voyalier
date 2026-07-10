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
}

interface Window {
  __TAURI__?: TauriBridge;
}
