import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * What a view reads, named so a mutation can say what it changed.
 *
 * Free-form by design — a scope is a string a reader and a writer agree on, and
 * the helpers below are the whole vocabulary:
 *
 * - `"trips"` — the trip list
 * - `` `trip:${id}` `` — one trip's detail and its pending candidates
 * - `` `documents:${id}` `` — one trip's imported documents
 */
export type Scope = string;

/** The trip list. */
export const tripsScope: Scope = "trips";
/** One trip's detail and pending candidates. */
export const tripScope = (tripId: string): Scope => `trip:${tripId}`;
/** One trip's imported documents. */
export const documentsScope = (tripId: string): Scope => `documents:${tripId}`;

type Listener = () => void;

/**
 * Tracks a version per scope, and who is watching each one.
 *
 * Deliberately not React state: a version bump must re-render only the views
 * reading that scope, which is what `useSyncExternalStore` gives us. Holding
 * this in a `useState` at the root is what forced the old shape — a single
 * counter drilled from `App` through `TripDetailView` into `DocumentsPanel`,
 * where any mutation anywhere refetched everything.
 */
class Revalidator {
  private versions = new Map<Scope, number>();
  private listeners = new Map<Scope, Set<Listener>>();

  version = (scope: Scope): number => this.versions.get(scope) ?? 0;

  subscribe = (scope: Scope) => (listener: Listener) => {
    let watching = this.listeners.get(scope);
    if (!watching) {
      watching = new Set();
      this.listeners.set(scope, watching);
    }
    watching.add(listener);
    return () => {
      watching.delete(listener);
      if (watching.size === 0) this.listeners.delete(scope);
    };
  };

  /** Mark `scopes` stale. Views reading them re-fetch; nothing else re-renders. */
  revalidate = (...scopes: Scope[]) => {
    for (const scope of scopes) {
      this.versions.set(scope, this.version(scope) + 1);
      // Copy: a listener may unsubscribe as it re-renders.
      for (const listener of [...(this.listeners.get(scope) ?? [])]) listener();
    }
  };

  /**
   * Re-fetch everything currently on screen.
   *
   * The retry-after-failure path, and the only caller that legitimately cannot
   * name what changed — the app just failed to reach its engine, so nothing on
   * screen is trustworthy.
   */
  revalidateAll = () => this.revalidate(...this.listeners.keys());
}

const RevalidatorContext = createContext<Revalidator | null>(null);

function useRevalidator(): Revalidator {
  const revalidator = useContext(RevalidatorContext);
  if (!revalidator) {
    throw new Error("useRevalidate must be used inside <RevalidateProvider>");
  }
  return revalidator;
}

export function RevalidateProvider({ children }: { children: ReactNode }) {
  const revalidator = useMemo(() => new Revalidator(), []);
  return (
    <RevalidatorContext.Provider value={revalidator}>
      {children}
    </RevalidatorContext.Provider>
  );
}

/**
 * A [[useAsyncData]] key that changes whenever `scope` is revalidated.
 *
 * Subscribing is what replaces the drilled prop: a view says what it reads, and
 * nothing above it has to know.
 */
export function useScopeKey(scope: Scope): string {
  const revalidator = useRevalidator();
  const subscribe = useMemo(
    () => revalidator.subscribe(scope),
    [revalidator, scope],
  );
  const version = useSyncExternalStore(subscribe, () =>
    revalidator.version(scope),
  );
  return `${scope}#${version}`;
}

/** Mark scopes stale after a mutation. Name what you changed, not everything. */
export function useRevalidate(): (...scopes: Scope[]) => void {
  return useRevalidator().revalidate;
}

/** Re-fetch everything on screen. For retry-after-failure only. */
export function useRevalidateAll(): () => void {
  const revalidator = useRevalidator();
  return useCallback(() => revalidator.revalidateAll(), [revalidator]);
}
