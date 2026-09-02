import { createContext, useContext } from "react";
import type { AppError, AppGateway, VaultStatus } from "@voyalier/contracts";

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
 * The shell owns the one truthful view of engine reachability. Shared async
 * hooks report only normalized transport outcomes here; storage, validation,
 * and domain failures stay local to the surface that can explain them.
 */
export interface TransportHealthReporter {
  reportTransportSuccess: () => void;
  reportTransportFailure: (error: AppError) => void;
}

const NOOP_TRANSPORT_HEALTH: TransportHealthReporter = {
  reportTransportSuccess: () => {},
  reportTransportFailure: () => {},
};

export const TransportHealthContext = createContext<TransportHealthReporter>(
  NOOP_TRANSPORT_HEALTH,
);

export function useTransportHealth(): TransportHealthReporter {
  return useContext(TransportHealthContext);
}

/**
 * How many times the engine has answered since the app started.
 *
 * A counter rather than a flag, because what consumers need is the *edge*: a
 * failure they are still showing has been disproved. `useAsyncAction` used to
 * hold its error until the next run, so a traveler who retried successfully got
 * a topbar reading Ready above a banner still insisting the engine was
 * unreachable.
 *
 * Deliberately separate from the reporter above, whose object identity has to
 * stay stable — `useAsyncData` keys an effect on it, and folding a changing
 * number into it would refetch every panel on screen on every recovery.
 * Defaults to 0 and never moves without a provider, which is the honest answer
 * for a hook rendered on its own.
 */
export const TransportRecoveryContext = createContext(0);

export function useTransportRecovery(): number {
  return useContext(TransportRecoveryContext);
}

/** One shared read of vault status, owned by the shell and retained on failure. */
export interface VaultStatusSnapshot {
  status: "loading" | "success" | "error";
  data: VaultStatus | undefined;
  error: AppError | undefined;
}

export interface VaultStatusReader extends VaultStatusSnapshot {
  reload: () => void;
}

const NOOP_VAULT_STATUS: VaultStatusReader = {
  status: "loading",
  data: undefined,
  error: undefined,
  reload: () => {},
};

export const VaultStatusContext =
  createContext<VaultStatusReader>(NOOP_VAULT_STATUS);

export function useVaultStatus(): VaultStatusReader {
  return useContext(VaultStatusContext);
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
