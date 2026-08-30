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
const MountedSectionsContext = createContext<ReadonlySet<string>>(new Set());
const MountSectionSetterContext = createContext<
  ((sectionId: string) => void) | null
>(null);
const ExclusiveSectionContext = createContext<string | null>(null);

const SCROLL_INTENT_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

/**
 * Lets controls request every deferred section or one named section.
 *
 * Deferral is an idle-time optimisation, and a traveler who clicks a jump chip
 * has said they want that part of the page. Mounting on demand is what makes
 * the jump land: sections *above* the target can no longer grow from
 * placeholder to full height after the browser has already chosen where to
 * stop scrolling.
 */
export function DeferredMountProvider({ children }: { children: ReactNode }) {
  const [mountAll, setMountAll] = useState(false);
  const [exclusiveSection, setExclusiveSection] = useState<string | null>(null);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const mountAllSections = useCallback(() => {
    setExclusiveSection(null);
    setMountAll(true);
  }, []);
  const mountSection = useCallback((sectionId: string) => {
    // Keep adjacent observers dormant through the programmatic scroll that
    // follows an exact search handoff. Without this, a document near the end
    // of Prepare can pull Visa, Discover and AI inside their 300px margins.
    setExclusiveSection(sectionId);
    setMountedSections((current) => {
      if (current.has(sectionId)) return current;
      const next = new Set(current);
      next.add(sectionId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!exclusiveSection || typeof window === "undefined") return;
    const release = () => setExclusiveSection(null);
    const releaseForKeyboardScroll = (event: KeyboardEvent) => {
      if (!SCROLL_INTENT_KEYS.has(event.key)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      release();
    };
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", releaseForKeyboardScroll);
    return () => {
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", releaseForKeyboardScroll);
    };
  }, [exclusiveSection]);

  return (
    <MountAllContext.Provider value={mountAll}>
      <MountAllSetterContext.Provider value={mountAllSections}>
        <MountedSectionsContext.Provider value={mountedSections}>
          <MountSectionSetterContext.Provider value={mountSection}>
            <ExclusiveSectionContext.Provider value={exclusiveSection}>
              {children}
            </ExclusiveSectionContext.Provider>
          </MountSectionSetterContext.Provider>
        </MountedSectionsContext.Provider>
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

/** Mount one deferred section without waking its network-owning siblings. */
export function useMountSection(): (sectionId: string) => void {
  const setter = useContext(MountSectionSetterContext);
  return useCallback((sectionId: string) => setter?.(sectionId), [setter]);
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
  const mountThisSection = useContext(MountedSectionsContext).has(id);
  const exclusiveSection = useContext(ExclusiveSectionContext);
  const suppressAutomaticMount =
    exclusiveSection !== null && exclusiveSection !== id;
  const [shown, setShown] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (shown || mountAll || mountThisSection || suppressAutomaticMount) return;
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
  }, [shown, mountAll, mountThisSection, suppressAutomaticMount]);

  if (shown || mountAll || mountThisSection)
    return <div id={id}>{children}</div>;
  // Deliberately NOT aria-hidden. This element is the section nav's jump target,
  // and hiding it from assistive tech would make those chips silently fail for
  // screen-reader users while appearing to work for everyone else. It is an
  // empty box either way, so hiding it buys nothing.
  return <div id={id} ref={ref} style={{ minHeight }} />;
}
