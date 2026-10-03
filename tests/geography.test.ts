import test from "node:test";
import assert from "node:assert/strict";
import {
  pointInGeometry,
  loadGeography,
  resolveJurisdiction,
} from "../src/geography";

test("incorporated-place geometry excludes holes and accepts separate multipolygon islands", () => {
  assert.equal(
    pointInGeometry([1, 1], {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 3],
          [2, 2],
        ],
      ],
    }),
    true,
  );
  assert.equal(
    pointInGeometry([2.5, 2.5], {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 3],
          [2, 2],
        ],
      ],
    }),
    false,
  );
  assert.equal(
    pointInGeometry([11, 11], {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
        ],
        [
          [
            [10, 10],
            [12, 10],
            [12, 12],
            [10, 12],
            [10, 10],
          ],
        ],
      ],
    }),
    true,
  );
});
test("missing geocoder data never silently promotes postal city into legal city", async () => {
  await loadGeography("/nonexistent-restate-geography-test");
  assert.equal(
    resolveJurisdiction({
      address_id: "test",
      postal_city: "Hoboken",
      state: "NJ",
    }).city,
    null,
  );
});
