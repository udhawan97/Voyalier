import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const MountAllContext = createContext(false);
const MountAllSetterContext = createContext<(() => void) | null>(null);

/**
 * Lets one control announce "mount every deferred section now".
 *
 * Deferral is an idle-time optimisation, and a traveler who clicks a jump chip
 * has said they want that part of the page. Mounting on demand is what makes
 * the jump land: sections *above* the target can no longer grow from
 * placeholder to full height after the browser has already chosen where to
 * stop scrolling.
 */
export function DeferredMountProvider({ children }: { children: ReactNode }) {
  const [mountAll, setMountAll] = useState(false);
  const mountAllSections = useCallback(() => setMountAll(true), []);
  return (
    <MountAllContext.Provider value={mountAll}>
      <MountAllSetterContext.Provider value={mountAllSections}>
        {children}
      </MountAllSetterContext.Provider>
    </MountAllContext.Provider>
  );
}

/**
 * Mount every deferred section under the nearest provider.
 *
 * A no-op outside a provider, so a section can still be rendered on its own
 * (a test, or a future screen that has no jump nav) without a crash.
 */
export function useMountAllSections(): () => void {
  const setter = useContext(MountAllSetterContext);
  return useCallback(() => setter?.(), [setter]);
}

/**
 * Mount a section only once it is near the viewport.
 *
 * The trip page is long, and several sections fetch on mount — advice countries,
 * pack suggestions, downloaded packs, notes, documents. Opening a trip fired all
 * of them at once, for panels most travelers never scrolled to. This holds a
 * fixed-height placeholder until the section is close, then mounts it once and
 * stops watching.
 *
 * The wrapper keeps its `id` in both states, which is what lets the section nav
 * work: a chip must be able to jump to a section that has not mounted yet, and
 * landing there is exactly what triggers the mount.
 *
 * Where `IntersectionObserver` does not exist (an old engine, or a test that has
 * not stubbed it), it renders immediately — being eager is a worse page, never a
 * broken one.
 */
export function DeferredSection({
  id,
  minHeight = "10rem",
  children,
}: {
  id: string;
  /** Reserved space, so deferred content does not jolt the page as it mounts. */
  minHeight?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mountAll = useContext(MountAllContext);
  const [shown, setShown] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (shown || mountAll) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      // Start early enough that the section is ready by the time it is read.
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, mountAll]);

  if (shown || mountAll) return <div id={id}>{children}</div>;
  // Deliberately NOT aria-hidden. This element is the section nav's jump target,
  // and hiding it from assistive tech would make those chips silently fail for
  // screen-reader users while appearing to work for everyone else. It is an
  // empty box either way, so hiding it buys nothing.
  return <div id={id} ref={ref} style={{ minHeight }} />;
}
