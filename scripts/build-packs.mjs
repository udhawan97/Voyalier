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
// The Wikivoyage layer is the primary content and always builds. The Overture
// query needs the `duckdb` CLI with the spatial + httpfs extensions and network
// access to the Overture S3 bucket; if that is unavailable the pack is still
// written with zero places and a warning, so a run never produces a broken pack.

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const OUT_DIR = process.env.OUT_DIR ?? "dist/packs";
const RELEASE_TAG = process.env.PACK_RELEASE_TAG ?? "packs-v1";
const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE ?? "2025-01-22.0";
if (!/^[\w.-]+$/.test(OVERTURE_RELEASE)) {
  throw new Error(`Refusing unsafe OVERTURE_RELEASE: ${OVERTURE_RELEASE}`);
}
const MAX_PLACES = Number(process.env.MAX_PLACES ?? 800);
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

/** Query Overture places within a bbox via DuckDB, or [] if unavailable. */
async function fetchPlaces(bbox) {
  // Defense-in-depth: these are interpolated into SQL, so require finite numbers
  // even though they come from the trusted catalog.
  for (const key of ["west", "south", "east", "north"]) {
    if (!Number.isFinite(bbox[key])) {
      throw new Error(`Invalid bbox.${key}: ${bbox[key]}`);
    }
  }
  const source =
    `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}` +
    "/theme=places/type=place/*";
  const sql = [
    "INSTALL spatial; LOAD spatial;",
    "INSTALL httpfs; LOAD httpfs;",
    "SET s3_region='us-west-2';",
    "SELECT names.primary AS name, categories.primary AS category,",
    "       bbox.ymin AS lat, bbox.xmin AS lon",
    `FROM read_parquet('${source}', hive_partitioning=1)`,
    `WHERE bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}`,
    `  AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}`,
    "  AND names.primary IS NOT NULL",
    `LIMIT ${MAX_PLACES};`,
  ].join("\n");
  try {
    const { stdout } = await run("duckdb", ["-json", "-c", sql], {
      maxBuffer: 128 * 1024 * 1024,
    });
    const rows = JSON.parse(stdout || "[]");
    return rows
      .filter((row) => row.name && row.lat != null && row.lon != null)
      .map((row) => ({
        name: String(row.name),
        category: row.category ? String(row.category) : "place",
        lat: Number(row.lat),
        lon: Number(row.lon),
      }));
  } catch (error) {
    // Print the whole failure, not its first line. Truncating it is why every
    // published pack has carried zero places since at least 2026-07-20 without
    // anyone being able to see why: the run stays green, and the one line that
    // survives is the command rather than DuckDB's reason for refusing it.
    console.warn(
      `    ! places unavailable; writing 0 places\n${error.stderr || ""}${error.stdout || ""}${error.message}`,
    );
    return [];
  }
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

/** Split the queried places into the places layer and the amenities layer. */
export function partitionAmenities(rows) {
  const places = [];
  const amenities = [];
  for (const row of rows) {
    const kind = AMENITY_CATEGORIES.get(row.category);
    if (kind) {
      amenities.push({ name: row.name, kind, lat: row.lat, lon: row.lon });
    } else {
      places.push(row);
    }
  }
  return { places, amenities };
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
    const [article, queried] = await Promise.all([
      fetchArticle(pack.wikivoyageArticle),
      fetchPlaces(pack.bbox),
    ]);
    // One query, two layers: an amenity is a place with a category the traveler
    // needs to find on purpose, so it moves rather than being duplicated.
    const { places, amenities } = partitionAmenities(queried);
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
