import { createContext, useContext } from "react";
import type { AppGateway } from "@voyalier/contracts";

import type { UpdaterController } from "../updater/useUpdater";

/** The active transport, injected at the app root (and by tests). */
export const GatewayContext = createContext<AppGateway | null>(null);

export function useGateway(): AppGateway {
  const gateway = useContext(GatewayContext);
  if (!gateway) {
    throw new Error("useGateway must be used within a GatewayContext provider");
  }
  return gateway;
}

/** Announce an async result to assistive tech via a polite live region. */
export type AnnounceFn = (message: string) => void;

export const AnnounceContext = createContext<AnnounceFn>(() => {});

export function useAnnounce(): AnnounceFn {
  return useContext(AnnounceContext);
}

/**
 * The App-level updater state machine, provided once at the root so the panel
 * (and later the topbar pill) share one controller — auto-check and staged
 * state must not be duplicated per mount.
 */
export const UpdaterContext = createContext<UpdaterController | null>(null);

export function useUpdaterController(): UpdaterController {
  const controller = useContext(UpdaterContext);
  if (!controller) {
    throw new Error(
      "useUpdaterController must be used within an UpdaterContext",
    );
  }
  return controller;
}
