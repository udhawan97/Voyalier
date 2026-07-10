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
