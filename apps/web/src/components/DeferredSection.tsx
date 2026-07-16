import { useEffect, useRef, useState, type ReactNode } from "react";

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
  const [shown, setShown] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (shown) return;
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
  }, [shown]);

  if (shown) return <div id={id}>{children}</div>;
  return <div id={id} ref={ref} style={{ minHeight }} aria-hidden="true" />;
}
