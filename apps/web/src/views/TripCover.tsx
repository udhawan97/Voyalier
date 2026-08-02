/**
 * The moment a trip opens.
 *
 * Everything else in this workspace is a panel doing a job. This does no job: it
 * gives the trip's own header a wash of colour that belongs to that trip, and
 * that is the point. A trip is anticipation before it is logistics, and a
 * workspace that never acknowledges that is a spreadsheet.
 *
 * **It adds no content and no landmark.** The first build put a second titled
 * block above the header, which duplicated the `<h1>` and gave the page two
 * regions with the same accessible name — an axe `landmark-unique` failure and,
 * more to the point, the same words twice. So this renders only the backdrop and
 * lets the header that already exists sit on it.
 *
 * **No photograph.** The obvious build is a picture of the destination, and it
 * was not taken: nothing in the tree stores one. `PlaceSummary` keeps the
 * article's text and URL, not its lead image, so a photographic cover would mean
 * a new fetch, a new source in the register, a new licence to display, and a new
 * consent — a lot of machinery for decoration. The wash is *derived* from the
 * destination's own name instead: deterministic, offline, free of attribution,
 * and different for every city without claiming to depict any of them.
 *
 * It is deliberately soft. A full-strength gradient behind the header would put
 * the trip's title and its two buttons on an unpredictable background, so the
 * tint stays low enough that every existing colour pairing still holds.
 * `aria-hidden` because it says nothing; there is no motion here to reduce.
 */
export function TripCover({ destination }: { destination: string }) {
  const hue = hueFor(destination);
  return (
    <div
      className="voy-cover"
      aria-hidden="true"
      // Two hues a third of the wheel apart, so the wash has depth without
      // either end drifting into the next city's colour.
      style={
        {
          "--voy-cover-hue": String(hue),
          "--voy-cover-hue-far": String((hue + 120) % 360),
        } as React.CSSProperties
      }
    />
  );
}

/**
 * A stable hue for a place name.
 *
 * A plain FNV-style fold over the code points. It only has to be deterministic
 * and well spread — the same trip must look the same on every open and on every
 * device, and two destinations should rarely collide.
 */
export function hueFor(destination: string): number {
  let hash = 2166136261;
  for (const character of destination.trim().toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}
