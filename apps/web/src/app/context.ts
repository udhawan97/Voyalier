import { createContext, useContext } from "react";
import type { AppGateway } from "@voyalier/contracts";

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
