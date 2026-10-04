import test from "node:test";
import assert from "node:assert/strict";
import { loadGeography } from "../src/geography";
import { GeocodeError, geocodeAddress, matchSample } from "../src/geocode";
import type { PropertyRecord } from "../src/contracts";

// Census geocoder responses in their real JSON shape; the network is never touched.
const census: Record<string, object> = {
  shattuck: { matchedAddress: "2180 SHATTUCK AVE, BERKELEY, CA, 94704", coordinates: { x: -122.26812, y: 37.87046 }, geographies: { "Incorporated Places": [{ BASENAME: "Berkeley" }] } },
  oakland: { matchedAddress: "1 FRANK H OGAWA PLZ, OAKLAND, CA, 94612", coordinates: { x: -122.27234, y: 37.80524 }, geographies: { "Incorporated Places": [{ BASENAME: "Oakland" }] } },
  seattle: { matchedAddress: "600 4TH AVE, SEATTLE, WA, 98104", coordinates: { x: -122.3301, y: 47.6036 }, geographies: {} },
};
globalThis.fetch = (async (url: string) => {
  const address = new URL(url).searchParams.get("address")!.toLowerCase();
  const key = Object.keys(census).find((k) => address.includes(k));
  return new Response(JSON.stringify({ result: { addressMatches: key ? [census[key]] : [] } }));
}) as typeof fetch;

test("a typed address gets its legal city from the boundary file and starts with every building fact unknown", async () => {
  await loadGeography(process.cwd());
  const berkeley = await geocodeAddress("2180 Shattuck Ave, Berkeley, CA");
  assert.equal(berkeley.city, "Berkeley");
  assert.match(berkeley.id, /^ADDR-/);
  assert.equal(berkeley.facts.units, null);
  assert.equal(berkeley.facts.year_built, null);

  const oakland = await geocodeAddress("1 Frank Ogawa Plaza, Oakland, CA");
  assert.equal(oakland.city, "Oakland");
  assert.match(oakland.jurisdictionMethod, /only California state law/);

  await assert.rejects(geocodeAddress("600 4th Ave, Seattle, WA"), (e: GeocodeError) => e.status === 422);
  await assert.rejects(geocodeAddress("nothing like an address"), (e: GeocodeError) => e.status === 404);
});

test("typing a sample building's address keeps its assessor record, including house-number ranges", () => {
  const sample = [
    { id: "A1", address: "1031-1035 CLINTON ST", state: "NJ", zip: "07030" },
    { id: "A2", address: "3151 ETON AVE", state: "CA", zip: "94705" },
  ] as PropertyRecord[];
  const typed = (address: string, state: string, zip: string) => ({ address, state, zip }) as PropertyRecord;
  assert.equal(matchSample(typed("1033 CLINTON ST", "NJ", "07030"), sample)?.id, "A1");
  assert.equal(matchSample(typed("3151 ETON AVE", "CA", "94705"), sample)?.id, "A2");
  assert.equal(matchSample(typed("3153 ETON AVE", "CA", "94705"), sample), null);
  assert.equal(matchSample(typed("1033 CLINTON ST", "NJ", "07302"), sample), null);
});
