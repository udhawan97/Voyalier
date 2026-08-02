import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAmenities,
  fetchPlaces,
  isTravelerRelevant,
} from "./build-packs.mjs";

const BBOX = { west: 139.6, south: 35.6, east: 139.8, north: 35.8 };

/** Capture the SQL a fetch issues, answering with `rows`. */
function capture(rows = []) {
  const seen = [];
  const run = async (_command, args) => {
    seen.push(args[args.length - 1]);
    return { stdout: JSON.stringify(rows) };
  };
  return { run, seen };
}

/**
 * A places query that fails or produces nothing must stop the run. The injected
 * runner keeps the regression deterministic and independent of the network or
 * whichever Overture releases happen to exist today.
 */
test("a failed Overture query stops the run rather than publishing 0 places", async () => {
  const failure = new Error("Command failed: duckdb -json -c INSTALL spatial;");
  failure.stderr =
    'IO Error: No files found that match the pattern "s3://overturemaps-us-west-2/release/2025-01-22.0/theme=places/type=place/*"';
  await assert.rejects(
    () =>
      fetchPlaces(BBOX, {
        run: () => Promise.reject(failure),
        release: "2025-01-22.0",
      }),
    (error) => {
      // The whole reason survives — truncating it to the first line is what
      // made this look like an `INSTALL spatial` failure for ten days.
      assert.match(error.message, /No files found/);
      // And it names the knob to turn, the way the offline-map builder does
      // for its equally prunable Protomaps pin.
      assert.match(error.message, /Release queried: 2025-01-22\.0/);
      return true;
    },
  );
});

test("DuckDB output that is not JSON fails even when the command exits 0", async () => {
  await assert.rejects(
    () =>
      fetchPlaces(BBOX, {
        run: async () => ({ stdout: "IO Error: No files found" }),
      }),
    /IO Error: No files found/,
  );
});

test("an empty result set stops the run too — a real city bbox always has places", async () => {
  await assert.rejects(
    () => fetchPlaces(BBOX, { run: async () => ({ stdout: "[]" }) }),
    /0 valid traveler places/,
  );
});

test("a query that returns rows still returns them", async () => {
  const rows = await fetchPlaces(BBOX, {
    run: async () => ({
      stdout: JSON.stringify([
        {
          name: "Sensō-ji",
          category: "buddhist_temple",
          confidence: 0.91,
          lat: 35.71,
          lon: 139.79,
        },
        { name: "No coords", category: "attraction", lat: null, lon: null },
        { name: "No category", category: null, lat: 35.7, lon: 139.7 },
      ]),
    }),
  });
  assert.deepEqual(rows, [
    {
      name: "Sensō-ji",
      category: "buddhist_temple",
      sourceConfidence: 0.91,
      lat: 35.71,
      lon: 139.79,
    },
  ]);
});
/**
 * The published packs made all three properties of the old single query
 * visible at once. Each pack summed to exactly 800 rows, so the limit was
 * always the binding constraint; with no ORDER BY it cut on parquet scan
 * order, which is spatial, so jp-kyoto stopped at latitude 35.025 of a box
 * reaching 35.10 and contained none of Kinkaku-ji, Kiyomizu-dera, Fushimi
 * Inari or Nijō Castle; and with no category filter half of what it did keep
 * was trades. These tests pin the three properties that fix that.
 */
test("the places query ranks the whole bbox before the limit cuts it", async () => {
  const { run, seen } = capture([
    {
      name: "Kinkaku-ji",
      category: "buddhist_temple",
      lat: 35.03,
      lon: 135.72,
    },
  ]);
  await fetchPlaces(BBOX, { run });

  assert.equal(seen.length, 1);
  const sql = seen[0];
  // Without an ORDER BY, LIMIT takes whatever the parquet scan reached first —
  // which is one geographic corner of the box, not a selection from it.
  assert.match(
    sql,
    /ORDER BY COALESCE\(confidence, 0\) DESC, name, categories\.primary, bbox\.ymin, bbox\.xmin/,
  );
  // And the limit must still be there: ordering an unbounded scan is not the
  // fix, ordering *before* the cut is.
  assert.match(sql, /LIMIT 800;/);
});

test("the places query spends its slots on traveler categories only", async () => {
  const { run, seen } = capture([
    {
      name: "Kinkaku-ji",
      category: "buddhist_temple",
      lat: 35.03,
      lon: 135.72,
    },
  ]);
  await fetchPlaces(BBOX, { run });
  const sql = seen[0];

  assert.match(sql, /regexp_matches\(categories\.primary/);
  // The pattern is anchored at a token's right-hand edge, so `roofing` and
  // `hair_salon` cannot buy a slot the way they did in the published packs.
  assert.match(sql, /\(_\|\$\)/);
});

test("the two layers query separately, so amenities never lose the budget race", async () => {
  const places = capture([
    {
      name: "Kinkaku-ji",
      category: "buddhist_temple",
      lat: 35.03,
      lon: 135.72,
    },
  ]);
  const amenities = capture([
    { name: "Corner Pharmacy", category: "pharmacy", lat: 35.7, lon: 139.7 },
  ]);
  await fetchPlaces(BBOX, { run: places.run });
  await fetchAmenities(BBOX, { run: amenities.run });

  // Each layer carries its own limit. Sharing one is why sg-singapore
  // published a single amenity and four other packs published four to six.
  assert.match(places.seen[0], /LIMIT 800;/);
  assert.match(amenities.seen[0], /LIMIT 400;/);
  // The amenities query asks for the amenity categories...
  assert.match(
    amenities.seen[0],
    /categories\.primary IN \('atms', 'pharmacy'/,
  );
  // ...and the places query excludes exactly those, so no row is carried by
  // both layers however the keyword list is edited later.
  assert.match(
    places.seen[0],
    /categories\.primary NOT IN \('atms', 'pharmacy'/,
  );
});

/**
 * The amenities layer is normalized onto the closed set voyalier-core defines.
 * The risk worth a test is a category allowlist that matches nothing — that
 * would publish an empty third layer and look like a working feature.
 */
test("amenity categories are normalized onto core's closed kind set", async () => {
  const amenities = await fetchAmenities(BBOX, {
    run: async () => ({
      stdout: JSON.stringify([
        {
          name: "Bank of Somewhere",
          category: "atms",
          confidence: 0.86,
          lat: 36.17,
          lon: -86.78,
        },
        {
          name: "Corner Pharmacy",
          category: "pharmacy",
          lat: 36.18,
          lon: -86.79,
        },
        {
          name: "Park Restrooms",
          category: "public_toilet",
          lat: 36.19,
          lon: -86.8,
        },
        {
          name: "City Restrooms",
          category: "public_restrooms",
          lat: 36.2,
          lon: -86.81,
        },
        { name: "River Lookout", category: "lookout", lat: 36.21, lon: -86.82 },
        {
          name: "General Hospital",
          category: "hospital",
          lat: 36.22,
          lon: -86.83,
        },
        {
          name: "St Emergency",
          category: "emergency_room",
          lat: 36.23,
          lon: -86.84,
        },
      ]),
    }),
  });

  // Two source categories collapse onto one kind, twice over.
  assert.deepEqual(
    amenities.map((amenity) => amenity.kind),
    [
      "atm",
      "pharmacy",
      "toilet",
      "toilet",
      "viewpoint",
      "hospital",
      "hospital",
    ],
  );
  // Coordinates and names survive the mapping.
  assert.deepEqual(amenities[0], {
    name: "Bank of Somewhere",
    kind: "atm",
    sourceConfidence: 0.86,
    lat: 36.17,
    lon: -86.78,
  });
});

test("an unmapped amenity category is dropped rather than shipped without a kind", async () => {
  const amenities = await fetchAmenities(BBOX, {
    run: async () => ({
      stdout: JSON.stringify([
        {
          name: "Corner Pharmacy",
          category: "pharmacy",
          lat: 36.18,
          lon: -86.79,
        },
        // A missing `kind` serializes to an absent key, which fails PackAmenity
        // on the Rust side and takes the whole pack down with it.
        {
          name: "Something New",
          category: "a_category_overture_added",
          lat: 1,
          lon: 2,
        },
      ]),
    }),
  });
  assert.deepEqual(
    amenities.map((amenity) => amenity.name),
    ["Corner Pharmacy"],
  );
});

test("an empty amenities result publishes the pack — unlike an empty places one", async () => {
  // Zero places cannot be legitimate; zero amenities can, and the places query
  // succeeding already proves the release and bucket are reachable.
  assert.deepEqual(
    await fetchAmenities(BBOX, { run: async () => ({ stdout: "[]" }) }),
    [],
  );
});

/**
 * The relevance predicate is shared verbatim with the SQL, so these cases are
 * the ones CI actually applies. The categories below are real: every one was
 * observed in the 12,596 place rows of the sixteen published packs.
 */
test("keeps what a traveler opens a pack to find", () => {
  for (const category of [
    "japanese_restaurant",
    "cafe",
    "buddhist_temple", // a Kyoto pack must carry and rank it
    "shinto_shrine",
    "landmark_and_historical_building",
    "art_gallery",
    "national_park",
    "beach",
    "supermarket", // a closed compound a token split would miss
    "bookstore",
    "hotel", // scores nothing in the ranking; feeds property-name suggestions
    "bed_and_breakfast",
  ]) {
    assert.equal(isTravelerRelevant(category), true, category);
  }
});

test("drops the trades that filled the published packs", () => {
  for (const category of [
    "roofing", // jp-kyoto's actual first place, a roof-tile contractor
    "construction_services",
    "real_estate_agent",
    "hair_salon",
    "professional_services",
    "freight_and_cargo_service",
    // These are negative controls mirrored by the recommendation ranker.
    "barber",
    "apartment_building",
    // The amenity categories belong to the other layer.
    "pharmacy",
    "public_toilet",
    "lookout",
  ]) {
    assert.equal(isTravelerRelevant(category), false, category);
  }
});

test("treats a missing category as not relevant rather than throwing", () => {
  assert.equal(isTravelerRelevant(null), false);
  assert.equal(isTravelerRelevant(undefined), false);
  assert.equal(isTravelerRelevant(""), false);
});

test("rejects a malformed bbox before it reaches SQL", async () => {
  let ran = false;
  await assert.rejects(
    () =>
      fetchPlaces(
        {
          west: "-87.06; DROP TABLE",
          south: 36.03,
          east: -86.62,
          north: 36.41,
        },
        {
          run: async () => {
            ran = true;
            return { stdout: "[]" };
          },
        },
      ),
    /Invalid bbox\.west/,
  );
  assert.equal(ran, false);
});
