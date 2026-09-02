import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { createHttpGateway } from "./http";
import { createTauriGateway } from "./tauri";
import { consumeSourceBootstrap } from "../sourceBootstrap";

export { createHttpGateway } from "./http";
export { createTauriGateway } from "./tauri";
export { isAppError, toAppError } from "./errors";

let sourceGateway: AppGateway | undefined;

/**
 * Pick a transport at runtime:
 *   - VITE_MOCK=1        → in-memory mock (also used by every component test)
 *   - "__TAURI__" in window → desktop IPC bridge (never inferred from URL)
 *   - otherwise          → authenticated HTTP from the managed source browser
 */
export function selectGateway(): AppGateway {
  if (import.meta.env.VITE_MOCK === "1") return createMockGateway();
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return createTauriGateway();
  }
  if (sourceGateway) return sourceGateway;
  const bootstrap = consumeSourceBootstrap();
  if (!bootstrap) {
    throw new Error(
      "Voyalier source mode must be opened by `make dev`; no launch credential was provided.",
    );
  }
  sourceGateway = createHttpGateway({
    baseUrl: bootstrap.baseUrl,
    authToken: bootstrap.bearer,
  });
  return sourceGateway;
}
