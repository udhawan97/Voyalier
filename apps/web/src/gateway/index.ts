import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { createHttpGateway } from "./http";
import { createTauriGateway } from "./tauri";

export { createHttpGateway } from "./http";
export { createTauriGateway } from "./tauri";
export { isAppError, toAppError } from "./errors";

/**
 * Pick a transport at runtime:
 *   - VITE_MOCK=1        → in-memory mock (also used by every component test)
 *   - "__TAURI__" in window → desktop IPC bridge (never inferred from URL)
 *   - otherwise          → same-origin HTTP against the loopback core
 */
export function selectGateway(): AppGateway {
  if (import.meta.env.VITE_MOCK === "1") return createMockGateway();
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return createTauriGateway();
  }
  return createHttpGateway();
}
