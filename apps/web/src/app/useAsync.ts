import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError } from "@voyalier/contracts";

import { toAppError } from "../gateway";
import { useTransportHealth, useTransportRecovery } from "./context";

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
 * the loader depends on; a change re-runs it. For anything a mutation can
 * invalidate, get the key from `useScopeKey` — it encodes the scope's version,
 * so a `revalidate` of that scope re-runs this loader and nothing else.
 *
 * Loading is derived (the settled result is stale for the current run), so the
 * effect only ever calls setState from its async callbacks — never synchronously.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  key: string,
): AsyncData<T> {
  const transportHealth = useTransportHealth();
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
          transportHealth.reportTransportSuccess();
          setSettled({ runKey, status: "success", data, error: undefined });
        }
      },
      (caught) => {
        if (active) {
          const error = toAppError(caught);
          transportHealth.reportTransportFailure(error);
          setSettled((prev) => ({
            runKey,
            status: "error",
            data: prev.data,
            error,
          }));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [runKey, transportHealth]);

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
 * view puts its own state update and its announcement. It fires only for the
 * most recent run, so a view can call `run` on every keystroke without
 * threading a request id of its own.
 */
export function useAsyncAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
  onSuccess?: (result: T, ...args: Args) => void,
  onFailure?: (error: AppError, ...args: Args) => void,
): AsyncAction<Args> {
  const transportHealth = useTransportHealth();
  const actionRef = useRef(action);
  const successRef = useRef(onSuccess);
  const failureRef = useRef(onFailure);
  useEffect(() => {
    actionRef.current = action;
    successRef.current = onSuccess;
    failureRef.current = onFailure;
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Overlapping runs settle in the order the transport answers, not the order
  // they were started, so the slower *older* run was winning. Two clicks on
  // Recommendations with the sliders moved between them wrote the earlier list
  // and then persisted the earlier weights onto the saved place — silently,
  // because both runs succeeded. Views that noticed rebuilt this counter on top
  // of the hook; it belongs here, once.
  const latest = useRef(0);

  const [busy, setBusy] = useState(false);
  /** The failure, and how many recoveries had happened when it was recorded. */
  const [failure, setFailure] = useState<
    { error: AppError; recoveries: number } | undefined
  >(undefined);

  /**
   * A transport failure stops being true once the engine answers again.
   *
   * Derived rather than cleared, so no effect has to write state: the failure
   * is kept with the recovery count it was recorded at, and a later count means
   * it has been disproved. It used to survive until the next `run`, so a
   * traveler who archived a trip with the engine down, restarted it and pressed
   * Retry got a topbar reading Ready above a banner still insisting the engine
   * could not be reached — with no Retry of its own and no way to dismiss it.
   *
   * Only `transport/failure` expires. Every other code is about the request
   * itself and is not disproved by the engine coming back.
   */
  const recoveries = useTransportRecovery();
  const recoveriesRef = useRef(recoveries);
  useEffect(() => {
    recoveriesRef.current = recoveries;
  });
  const error =
    failure &&
    (failure.error.code !== "transport/failure" ||
      recoveries <= failure.recoveries)
      ? failure.error
      : undefined;

  const run = useCallback(
    async (...args: Args) => {
      const runId = latest.current + 1;
      latest.current = runId;
      /** Still the run whose result the view should see. */
      const current = () => mounted.current && latest.current === runId;

      setFailure(undefined);
      setBusy(true);
      try {
        const result = await actionRef.current(...args);
        // A view that navigated away mid-run must not be written to, and
        // neither must one whose result a later run has already superseded.
        if (current()) {
          transportHealth.reportTransportSuccess();
          successRef.current?.(result, ...args);
        }
      } catch (caught) {
        if (current()) {
          // Both transports already normalize at their boundary, so a value that
          // is not an AppError by the time it reaches here came from the view's
          // own code — a TypeError while building an .ics file is not the local
          // core being unreachable, which is what the transport default would
          // have claimed.
          const error = toAppError(caught, "internal/unexpected");
          transportHealth.reportTransportFailure(error);
          setFailure({ error, recoveries: recoveriesRef.current });
          failureRef.current?.(error, ...args);
        }
      } finally {
        // A superseded run leaves `busy` alone: the run that superseded it is
        // still going, and the view is still waiting on something.
        if (current()) {
          setBusy(false);
        }
      }
    },
    [transportHealth],
  );

  return { run, busy, error };
}
