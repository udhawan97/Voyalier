#!/usr/bin/env node
// Build city-pack contents from the catalog emitted by voyalier-core.
//
// Usage:
//   cargo run -p voyalier-core --example pack_catalog > catalog.json
//   node scripts/build-packs.mjs catalog.json
//
// For each pack it writes dist/packs/<id>.json = { packId, places, articles }
// and a dist/packs/manifest.json with per-layer licenses. Two data sources,
// each under its own license:
//   - places:   Overture Maps (CDLA-Permissive-2.0), queried via DuckDB and
//               clipped to the pack's bounding box.
//   - articles: Wikivoyage (CC BY-SA 3.0), fetched via the MediaWiki API.
//
// The Overture query needs the `duckdb` CLI with the spatial + httpfs
// extensions and network access to the Overture S3 bucket. If it fails or
// produces no places, the run FAILS rather than publishing a pack that looks
// healthy and ranks nothing. The publisher is manual and re-runnable, so a loud
// failure costs one re-run while a silent one costs every download.
//
// Overture prunes old releases from S3 — only the newest couple survive — so
// OVERTURE_RELEASE goes stale on its own. Check
// https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/
//
// Places and amenities are queried SEPARATELY, each ordered by Overture's
// `confidence` and capped by its own limit. One unordered `LIMIT 800` over the
// whole bbox used to build both layers, and all three of its properties were
// wrong at once:
//
//   - No ORDER BY meant the limit cut on parquet scan order, which is spatial.
//     Every pack was therefore the first corner of its bounding box rather than
//     a selection from it: jp-kyoto stopped at latitude 35.025 of a box reaching
//     35.10 and covered ~40% of its own area, so Kinkaku-ji, Kiyomizu-dera,
//     Fushimi Inari, Nijō Castle and Kyoto Station were all absent from the
//     Kyoto pack. An ORDER BY forces the whole box to be ranked before the cut.
//   - No category filter meant the 800 slots were spent on whatever sits in that
//     corner. 49% of jp-kyoto's places were categories the persona ranking
//     discards outright (`roofing`, `construction_services`, `hair_salon`), and
//     its own first row was a roof-tile contractor.
//   - Sharing one budget starved the amenities layer, because amenities are rare
//     next to ordinary businesses: the sixteen published packs sum to exactly
//     800 rows each, of which sg-singapore got 1 amenity and four others got
//     4–6. A layer for finding a toilet on the ground needs its own limit.

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const OUT_DIR = process.env.OUT_DIR ?? "dist/packs";
const RELEASE_TAG = process.env.PACK_RELEASE_TAG ?? "packs-v1";
const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE ?? "2026-07-22.0";
if (!/^[\w.-]+$/.test(OVERTURE_RELEASE)) {
  throw new Error(`Refusing unsafe OVERTURE_RELEASE: ${OVERTURE_RELEASE}`);
}
const MAX_PLACES = Number(process.env.MAX_PLACES ?? 800);
// The amenities layer gets its own budget rather than the remainder of the
// places one. Amenities are sparse next to ordinary businesses, so a shared
// limit is exhausted before many of them are reached — which is how a city pack
// shipped a single ATM. This is a cap, not a target: most boxes return fewer.
const MAX_AMENITIES = Number(process.env.MAX_AMENITIES ?? 400);
const USER_AGENT =
  "Voyalier-pack-builder/0.1 (+https://github.com/udhawan97/Voyalier)";

/** Fetch a Wikivoyage article's plain-text extract via the MediaWiki API. */
async function fetchArticle(title) {
  const api =
    "https://en.wikivoyage.org/w/api.php?action=query&prop=extracts" +
    "&explaintext=1&redirects=1&format=json&titles=" +
    encodeURIComponent(title);
  const response = await fetch(api, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Wikivoyage HTTP ${response.status} for ${title}`);
  }
  const data = await response.json();
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0] ?? {};
  return {
    title: page.title ?? title,
    sourceUrl: `https://en.wikivoyage.org/wiki/${encodeURIComponent(title)}`,
    text: (page.extract ?? "").trim(),
  };
}

// Overture place categories that make up the amenities layer, mapped onto the
// small closed set voyalier-core defines. Category codes are verbatim from
// Overture's published taxonomy (overture_categories.csv) rather than guessed —
// a filter that matches nothing would ship an empty layer silently.
//
// There is deliberately no drinking-water kind: Overture's `fountain` is
// decorative and sits under attractions, and `drinking_water_dispenser` is a
// business-to-business supplier of water coolers. Neither is a public tap.
const AMENITY_CATEGORIES = new Map([
  ["atms", "atm"],
  ["pharmacy", "pharmacy"],
  ["public_toilet", "toilet"],
  ["public_restrooms", "toilet"],
  ["lookout", "viewpoint"],
  ["hospital", "hospital"],
  ["emergency_room", "hospital"],
]);

// What a traveler opens a city pack to find, as keywords matched against
// Overture's leaf category names (`japanese_restaurant`, `buddhist_temple`).
//
// This is an ALLOW list, not a deny list, because the junk is the long tail:
// across the sixteen published packs these rows carry 975 distinct categories,
// and the ones worth carrying are a minority of them. A deny list would need a
// new entry every time Overture adds a trade, and the miss would be silent.
//
// It is deliberately NOT a mirror of `dimension_for` in
// crates/voyalier-core/src/recommend.rs, which is the ranking's filter. That
// list is narrower than a pack should be: it deliberately scores no
// accommodation at all, while hotels here feed `suggest_field` property names
// that the ranking never sees.
// Kept hand-wrapped: this is a grouped word list, not code, and one token per
// line hides the grouping that says at a glance what a pack may carry.
// prettier-ignore
const TRAVELER_CATEGORY_TOKENS = [
  // eat and drink
  "restaurant", "cafe", "coffee", "bakery", "bar", "pub", "brewery", "winery",
  "distillery", "bistro", "eatery", "diner", "deli", "food", "izakaya",
  "sushi", "ramen", "noodle", "noodles", "pizzeria", "pizza", "steakhouse",
  "buffet", "brasserie", "creperie", "tavern", "taverna", "patisserie",
  "confectionery", "dessert", "desserts", "gelato", "creamery", "juice",
  "cocktail", "wine", "beer", "sake", "grill", "tapas", "dining", "teahouse",
  // culture and sights
  "museum", "gallery", "galleries", "art", "arts", "landmark", "landmarks",
  "monument", "memorial", "theatre", "theater", "cultural", "culture",
  "heritage", "historical", "historic", "history", "temple", "shrine",
  "church", "cathedral", "mosque", "synagogue", "basilica", "chapel",
  "monastery", "castle", "palace", "fort", "fortress", "ruins",
  "archaeological", "observatory", "planetarium", "aquarium", "zoo",
  "library", "opera", "cinema", "exhibition", "attraction", "attractions",
  "sightseeing", "tours", "tour",
  // nature and outdoors
  "park", "parks", "garden", "gardens", "beach", "beaches", "trail", "trails",
  "hiking", "viewpoint", "nature", "forest", "mountain", "lake", "river",
  "waterfall", "island", "botanical", "scenic", "campground", "camping",
  "marina", "harbor", "harbour", "bay", "cliff", "volcano", "spring",
  "springs", "onsen", "reserve", "wildlife", "sanctuary", "canyon", "glacier",
  // nightlife and unwinding
  "club", "nightlife", "nightclub", "night", "lounge", "karaoke", "cabaret",
  "spa", "spas",
  // shopping
  "shop", "shops", "shopping", "store", "stores", "retail", "market",
  "markets", "mall", "boutique", "bazaar", "souvenir", "souvenirs",
  // where a traveler sleeps. These score nothing in the persona ranking; they
  // are here for the pack-place property-name suggestions.
  "accommodation", "hotel", "hostel", "motel", "inn", "ryokan", "resort",
  "lodge", "lodging", "guesthouse", "campsite", "holiday", "breakfast",
];

// Defense-in-depth: both lists are interpolated into SQL below, so constrain
// them to the shape they are documented to have rather than trusting the edit
// that adds the next entry.
for (const token of TRAVELER_CATEGORY_TOKENS) {
  if (!/^[a-z]+$/.test(token)) {
    throw new Error(`Refusing unsafe category keyword: ${token}`);
  }
}
for (const code of AMENITY_CATEGORIES.keys()) {
  if (!/^[a-z_]+$/.test(code)) {
    throw new Error(`Refusing unsafe amenity category: ${code}`);
  }
}

// A keyword matches only where a category *token* ends — immediately before an
// underscore or at the end of the string. Plain substring matching is what
// makes `dimension_for` file a `barber` under nightlife (it contains "bar") and
// an `apartment_building` under culture (it contains "art"); anchoring the
// right-hand edge costs one regex group and excludes both, while still
// catching the closed compounds a token split would miss (`supermarket`,
// `bookstore`, `nightclub`). Shared verbatim between the SQL and the JS
// predicate so the filter CI applies is the one the tests exercise.
const RELEVANT_CATEGORY_PATTERN = `(${TRAVELER_CATEGORY_TOKENS.join("|")})(_|$)`;
const RELEVANT_CATEGORY_RE = new RegExp(RELEVANT_CATEGORY_PATTERN);

/** True when a place category is worth one of a pack's limited place slots. */
export function isTravelerRelevant(category) {
  return RELEVANT_CATEGORY_RE.test(category ?? "");
}

const AMENITY_SQL_LIST = [...AMENITY_CATEGORIES.keys()]
  .map((code) => `'${code}'`)
  .join(", ");

/**
 * Build one bbox-clipped Overture query.
 *
 * `ORDER BY confidence` is the part that matters most: without it the LIMIT
 * cuts on parquet scan order, which is spatial, so a pack becomes one corner of
 * its own bounding box. Ordering forces the whole box to be ranked first, and
 * ranks it by Overture's own agreement-between-sources score, so the rows that
 * survive the cut are the best-attested ones across the city rather than
 * whichever corner the scan happened to start in. The visible output fields
 * complete the order so a rebuild over the same release is reproducible.
 */
function overtureQuery(bbox, categoryPredicate, limit, release) {
  // Defense-in-depth: these are interpolated into SQL, so require finite numbers
  // even though they come from the trusted catalog.
  for (const key of ["west", "south", "east", "north"]) {
    if (!Number.isFinite(bbox[key])) {
      throw new Error(`Invalid bbox.${key}: ${bbox[key]}`);
    }
  }
  if (!/^[\w.-]+$/.test(release)) {
    throw new Error(`Refusing unsafe Overture release: ${release}`);
  }
  const source =
    `s3://overturemaps-us-west-2/release/${release}` +
    "/theme=places/type=place/*";
  return [
    "INSTALL spatial; LOAD spatial;",
    "INSTALL httpfs; LOAD httpfs;",
    "SET s3_region='us-west-2';",
    "SELECT names.primary AS name, categories.primary AS category, confidence,",
    "       bbox.ymin AS lat, bbox.xmin AS lon",
    `FROM read_parquet('${source}', hive_partitioning=1)`,
    `WHERE bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}`,
    `  AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}`,
    "  AND names.primary IS NOT NULL",
    "  AND categories.primary IS NOT NULL",
    `  AND ${categoryPredicate}`,
    // COALESCE rather than trusting a NULL sort position: an unscored row
    // ranks last, never first. The remaining visible fields make ties stable;
    // rows identical across all of them serialize identically in either order.
    "ORDER BY COALESCE(confidence, 0) DESC, name, categories.primary, bbox.ymin, bbox.xmin",
    `LIMIT ${limit};`,
  ].join("\n");
}

function queryFailure(bbox, release, detail) {
  return new Error(
    `Overture places query failed for ${JSON.stringify(bbox)}. ` +
      `Refusing to publish a pack with no places.\n` +
      `Release queried: ${release} — releases are pruned, so check ` +
      `https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/ ` +
      `for one that still exists.\n${detail}`,
  );
}

/** Run one Overture query, returning valid named rows with coordinates. */
async function runOverture(sql, bbox, release, deps) {
  let stdout;
  try {
    ({ stdout } = await deps.run("duckdb", ["-json", "-c", sql], {
      maxBuffer: 128 * 1024 * 1024,
    }));
  } catch (error) {
    throw queryFailure(
      bbox,
      release,
      `${error.stderr || ""}${error.stdout || ""}${error.message}`,
    );
  }
  // The exit code is not enough on its own. DuckDB 1.5.5 on Linux exits
  // non-zero when it cannot read the S3 prefix, but the Homebrew build on
  // macOS prints the same "IO Error: No files found" to stdout and exits 0 —
  // so trusting the exit code alone silently yields zero places on one machine
  // and a loud failure on another. A successful `-json` SELECT always prints a
  // JSON array, even for no rows, so anything else is a failure.
  let rows;
  try {
    rows = JSON.parse(stdout || "");
  } catch {
    throw queryFailure(bbox, release, stdout || "(no output)");
  }
  if (!Array.isArray(rows)) {
    throw queryFailure(bbox, release, `Expected a JSON array, got: ${stdout}`);
  }
  return rows.filter(
    (row) => row.name && row.category && row.lat != null && row.lon != null,
  );
}

function sourceConfidence(row) {
  if (row.confidence == null) return {};
  const confidence = Number(row.confidence);
  return Number.isFinite(confidence) ? { sourceConfidence: confidence } : {};
}

/** Query a bbox's traveler-relevant places. Throws if it yields none. */
export async function fetchPlaces(
  bbox,
  { run: execute = run, release = OVERTURE_RELEASE } = {},
) {
  const sql = overtureQuery(
    bbox,
    // The amenity categories are excluded explicitly rather than relying on the
    // keyword list to miss them, so the two layers cannot both carry a row no
    // matter how the keywords are edited later.
    `regexp_matches(categories.primary, '${RELEVANT_CATEGORY_PATTERN}')` +
      `\n  AND categories.primary NOT IN (${AMENITY_SQL_LIST})`,
    MAX_PLACES,
    release,
  );
  const places = (await runOverture(sql, bbox, release, { run: execute })).map(
    (row) => ({
      name: String(row.name),
      category: String(row.category),
      ...sourceConfidence(row),
      lat: Number(row.lat),
      lon: Number(row.lon),
    }),
  );
  // A successful query returning nothing is the same broken pack as a failed
  // one, and no error to read. Every bbox in the catalog is a real city, so
  // zero rows means the query or the bbox is wrong, not that the city is empty.
  if (places.length === 0) {
    throw queryFailure(
      bbox,
      release,
      "Overture returned 0 valid traveler places. Publishing that pack would " +
        "ship an empty places layer that looks identical to a working one.",
    );
  }
  return places;
}

/**
 * Query a bbox's practical amenities, normalized onto the kinds core defines.
 *
 * Unlike places, an empty result warns rather than stopping the run. Zero
 * places cannot be legitimate — every catalog bbox is a real city — but zero
 * amenities can be: a rural island box may genuinely have no mapped public
 * toilet, and the places query succeeding already proves the release and the
 * bucket are reachable. Failing here would block a whole publish over a
 * secondary layer.
 */
export async function fetchAmenities(
  bbox,
  { run: execute = run, release = OVERTURE_RELEASE } = {},
) {
  const sql = overtureQuery(
    bbox,
    `categories.primary IN (${AMENITY_SQL_LIST})`,
    MAX_AMENITIES,
    release,
  );
  return (
    (await runOverture(sql, bbox, release, { run: execute }))
      .map((row) => ({
        name: String(row.name),
        kind: AMENITY_CATEGORIES.get(String(row.category)),
        ...sourceConfidence(row),
        lat: Number(row.lat),
        lon: Number(row.lon),
      }))
      // An unmapped category cannot come back through the `IN` filter above, and
      // is dropped anyway because the cost of being wrong is not a bad pin: a
      // missing `kind` serializes to an absent key, which fails `PackAmenity` on
      // the Rust side and makes the whole pack unreadable rather than this row.
      .filter((amenity) => amenity.kind)
  );
}

async function main() {
  const catalogPath = process.argv[2];
  const catalog = JSON.parse(
    catalogPath
      ? await readFile(catalogPath, "utf8")
      : await readFile(0, "utf8"), // stdin
  );

  await mkdir(OUT_DIR, { recursive: true });
  const manifestPacks = [];

  for (const pack of catalog) {
    console.log(`• ${pack.id} (${pack.name})`);
    // Two queries, two layers, two budgets: an amenity is a place a traveler
    // needs to find on purpose, and it loses every time it competes with
    // ordinary businesses for the same slots.
    const [article, places, amenities] = await Promise.all([
      fetchArticle(pack.wikivoyageArticle),
      fetchPlaces(pack.bbox),
      fetchAmenities(pack.bbox),
    ]);
    if (amenities.length === 0) {
      console.warn(
        `    ! no amenities in this bbox — the pack publishes without a ` +
          `toilet, pharmacy or ATM layer`,
      );
    }
    const content = {
      packId: pack.id,
      places,
      amenities,
      articles: article.text ? [article] : [],
    };
    await writeFile(
      path.join(OUT_DIR, `${pack.id}.json`),
      JSON.stringify(content),
    );
    console.log(
      `    ${places.length} places, ${amenities.length} amenities, ` +
        `${content.articles.length} article(s)`,
    );
    manifestPacks.push({
      id: pack.id,
      name: pack.name,
      region: pack.region,
      placeCount: places.length,
      amenityCount: amenities.length,
      articleCount: content.articles.length,
      layers: pack.layers,
    });
  }

  const manifest = {
    releaseTag: RELEASE_TAG,
    overtureRelease: OVERTURE_RELEASE,
    packs: manifestPacks,
  };
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`\nWrote ${manifestPacks.length} packs + manifest to ${OUT_DIR}`);
}

// Only build when run as a script. Importing it — which the tests beside it do
// — must not start a run against S3, the pattern build-offline-map.mjs uses.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
