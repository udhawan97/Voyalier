import assert from "node:assert/strict";
import test from "node:test";

import { partitionAmenities } from "./build-packs.mjs";

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
