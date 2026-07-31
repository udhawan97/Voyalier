import assert from "node:assert/strict";
import test from "node:test";

import { fetchPlaces, partitionAmenities } from "./build-packs.mjs";

/**
 * The amenities layer is carved out of the same Overture query as the places
 * layer. The risk worth a test is a category allowlist that matches nothing —
 * that would publish an empty third layer and look like a working feature.
 */
test("moves known amenity categories out of the places layer", () => {
  const rows = [
    {
      name: "Ryman Auditorium",
      category: "music_venue",
      lat: 36.16,
      lon: -86.77,
    },
    { name: "Bank of Somewhere", category: "atms", lat: 36.17, lon: -86.78 },
    { name: "Corner Pharmacy", category: "pharmacy", lat: 36.18, lon: -86.79 },
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
    { name: "General Hospital", category: "hospital", lat: 36.22, lon: -86.83 },
    {
      name: "St Emergency",
      category: "emergency_room",
      lat: 36.23,
      lon: -86.84,
    },
  ];
  const { places, amenities } = partitionAmenities(rows);

  // An amenity moves rather than being duplicated into both layers.
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "Ryman Auditorium");
  assert.equal(amenities.length, 7);

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
  // Coordinates and names survive the move.
  assert.deepEqual(amenities[0], {
    name: "Bank of Somewhere",
    kind: "atm",
    lat: 36.17,
    lon: -86.78,
  });
});

test("leaves an unknown category in places rather than dropping it", () => {
  const { places, amenities } = partitionAmenities([
    {
      name: "Somewhere New",
      category: "a_category_overture_added",
      lat: 1,
      lon: 2,
    },
    // Overture's own decorative fountain, which is not drinking water. It must
    // stay an ordinary place rather than become an amenity kind.
    { name: "Plaza Fountain", category: "fountain", lat: 3, lon: 4 },
  ]);
  assert.equal(amenities.length, 0);
  assert.equal(places.length, 2);
});

test("handles an empty query without inventing a layer", () => {
  const { places, amenities } = partitionAmenities([]);
  assert.deepEqual(places, []);
  assert.deepEqual(amenities, []);
});

/**
 * The publisher must fail rather than write a pack with no places in it.
 *
 * This is the regression that shipped: a pruned Overture release made every
 * query fail, the handler swallowed it and returned [], the run went green, and
 * every published pack carried zero places for ten days. A pack that downloads
 * successfully and contains nothing is worse than a failed publish, because
 * nothing surfaces it.
 */
test("refuses to publish when the Overture query fails", async () => {
  await assert.rejects(
    // A release that cannot exist reproduces exactly what a pruned one does:
    // DuckDB refuses the read. Pinned explicitly rather than relying on the
    // ambient default, so this says the same thing on a machine with DuckDB
    // installed and a live release as on one without either.
    () =>
      fetchPlaces(
        { west: -87.06, south: 36.03, east: -86.62, north: 36.41 },
        "0000-00-00.0",
      ),
    (error) => {
      assert.match(error.message, /Refusing to publish a pack with no places/);
      // The message has to name the release, because "which release" is the
      // question a reader will have and the reason it broke.
      assert.match(error.message, /Release queried:/);
      return true;
    },
  );
});

test("rejects a malformed bbox before it reaches SQL", async () => {
  await assert.rejects(
    () =>
      fetchPlaces({
        west: "-87.06; DROP TABLE",
        south: 36.03,
        east: -86.62,
        north: 36.41,
      }),
    /Invalid bbox\.west/,
  );
});
