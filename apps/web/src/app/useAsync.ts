import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError } from "@voyalier/contracts";

import { toAppError } from "../gateway";

export type AsyncStatus = "loading" | "success" | "error";

export interface AsyncData<T> {
  status: AsyncStatus;
  /** Previous data is retained across reloads for a calmer transition. */
  data: T | undefined;
  error: AppError | undefined;
  reload: () => void;
}

interface Settled<T> {
  runKey: string;
  status: "success" | "error";
  data: T | undefined;
  error: AppError | undefined;
}

/**
 * Load async data and track loading/success/error. `key` must encode every input
 * the loader depends on (e.g. `${tripId}:${reloadKey}`); a change re-runs it.
 * Loading is derived (the settled result is stale for the current run), so the
 * effect only ever calls setState from its async callbacks — never synchronously.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  key: string,
): AsyncData<T> {
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const runKey = `${key}::${tick}`;

  const [settled, setSettled] = useState<Settled<T>>({
    runKey: "",
    status: "success",
    data: undefined,
    error: undefined,
  });

  useEffect(() => {
    let active = true;
    loaderRef.current().then(
      (data) => {
        if (active) {
          setSettled({ runKey, status: "success", data, error: undefined });
        }
      },
      (error) => {
        if (active) {
          setSettled((prev) => ({
            runKey,
            status: "error",
            data: prev.data,
            error: toAppError(error),
          }));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [runKey]);

  const isCurrent = settled.runKey === runKey;
  return {
    status: isCurrent ? settled.status : "loading",
    data: settled.data,
    error: isCurrent ? settled.error : undefined,
    reload,
  };
}

export interface AsyncAction<Args extends unknown[]> {
  /** Run it. Never rejects — a failure lands in `error`. */
  run: (...args: Args) => Promise<void>;
  /** True while a run is in flight; feed it to a Button's `busy`. */
  busy: boolean;
  /** The last failure, normalized. Undefined once a new run starts. */
  error: AppError | undefined;
}

/**
 * Run a mutation and track busy/error — the write half of [[useAsyncData]].
 *
 * Every view needed this and none had it, so 23 of them re-derived the same
 * `setError(null)` → `setBusy(true)` → try/catch/finally by hand. Three
 * inconsistent error shapes grew up around those copies, including one that only
 * announced failures to screen readers, so a sighted user saw a button
 * un-busy itself and nothing else.
 *
 * Failures are normalized through `toAppError`, so callers stop casting
 * `caught as AppError` over a value that might be a `TypeError` from their own
 * non-gateway code.
 *
 * `onSuccess` receives the result and the original arguments — that is where a
 * view puts its own state update and its announcement.
 */
export function useAsyncAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
  onSuccess?: (result: T, ...args: Args) => void,
): AsyncAction<Args> {
  const actionRef = useRef(action);
  const successRef = useRef(onSuccess);
  useEffect(() => {
    actionRef.current = action;
    successRef.current = onSuccess;
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);

  const run = useCallback(async (...args: Args) => {
    setError(undefined);
    setBusy(true);
    try {
      const result = await actionRef.current(...args);
      // A view that navigated away mid-run must not be written to, but its
      // success handler still owns whatever the run produced.
      if (mounted.current) {
        successRef.current?.(result, ...args);
      }
    } catch (caught) {
      if (mounted.current) {
        // Both transports already normalize at their boundary, so a value that
        // is not an AppError by the time it reaches here came from the view's
        // own code — a TypeError while building an .ics file is not the local
        // core being unreachable, which is what the transport default would
        // have claimed.
        setError(toAppError(caught, "internal/unexpected"));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }, []);

  return { run, busy, error };
}
