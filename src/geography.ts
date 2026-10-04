import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";

type Point = [number, number];
type Polygon = Point[][];
type Geometry =
  | { type: "Polygon"; coordinates: Polygon }
  | { type: "MultiPolygon"; coordinates: Polygon[] };
type Place = {
  properties: { BASENAME: string; STATE: string };
  geometry: Geometry;
};
let matches = new Map<string, string[]>();
type Retry = { id: string; query: string; matches: { matched: string; x: number; y: number }[] };
let retries = new Map<string, Retry>();
let places: Place[] = [];
const fips: Record<string, string> = { CA: "06", NJ: "34", MA: "25" };

export function pointInRing(point: Point, ring: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
export function pointInGeometry(point: Point, geometry: Geometry): boolean {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    (rings) =>
      rings.length > 0 &&
      pointInRing(point, rings[0]) &&
      !rings.slice(1).some((ring) => pointInRing(point, ring)),
  );
}
export async function loadGeography(root: string): Promise<void> {
  matches = new Map();
  places = [];
  retries = new Map();
  try {
    const retry = JSON.parse(await readFile(resolve(root, "sources/geography/census-retry.json"), "utf8")) as { results: Retry[] };
    retries = new Map(retry.results.map((item) => [item.id, item]));
  } catch {
    /* Optional: retries only add matches for addresses the batch geocoder missed. */
  }
  try {
    const rows = parse(
      await readFile(
        resolve(root, "sources/geography/census-response.csv"),
        "utf8",
      ),
      { relax_column_count: true, skip_empty_lines: true },
    ) as string[][];
    matches = new Map(rows.map((row) => [row[0], row]));
    places = JSON.parse(
      await readFile(
        resolve(root, "sources/geography/incorporated-places.geojson"),
        "utf8",
      ),
    ).features;
  } catch {
    /* Absent cache produces explicit unresolved jurisdictions, never a guessed city. */
  }
}
const STREET_NOISE = new Set([
  "ST", "STREET", "AVE", "AV", "AVENUE", "BLVD", "RD", "ROAD", "DR", "DRIVE", "PL",
  "PLACE", "CT", "COURT", "LN", "LANE", "WAY", "TER", "TERRACE", "PKWY", "HWY",
  "N", "S", "E", "W", "NORTH", "SOUTH", "EAST", "WEST",
]);
const ORDINALS: Record<string, string> = {
  FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH",
  SIXTH: "6TH", SEVENTH: "7TH", EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH",
};
function streetTokens(address: string): string[] {
  return address
    .split(",")[0]
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .map((token) => ORDINALS[token] ?? token.replace(/^0+(?=\d)/, ""))
    .filter((token) => token && !/^\d+$/.test(token) && !STREET_NOISE.has(token));
}
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 4) return false;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] <= 2;
}
/** An approximate Census match is usable when it is clearly the same street. */
export function sameStreet(input: string, matched: string): boolean {
  const left = streetTokens(input);
  const right = streetTokens(matched);
  return left.length > 0 && left.some((token) => right.some((other) => close(token, other)));
}

function placesAt(point: Point, state: string) {
  return places.filter((place) => place.properties.STATE === fips[state] && pointInGeometry(point, place.geometry));
}

export function resolveJurisdiction(row: Record<string, string>): {
  city: string | null;
  method: string;
} {
  const first = resolveFromBatch(row);
  const retry = retries.get(row.address_id);
  if (first.city || !retry?.matches.length) return first;
  // Every candidate the retry returned must land in the same in-scope city, or the address stays unresolved.
  const cities = new Set(
    retry.matches.map((m) => {
      const inside = placesAt([m.x, m.y], row.state);
      return inside.length === 1 ? inside[0].properties.BASENAME : "";
    }),
  );
  if (cities.size !== 1 || cities.has("")) return { city: null, method: `${first.method} A retry (“${retry.query}”) gave conflicting locations.` };
  const city = [...cities][0];
  return { city, method: `Census matched the normalized address “${retry.query}”; that point lies inside the ${city} city boundary.` };
}

function resolveFromBatch(row: Record<string, string>): { city: string | null; method: string } {
  const match = matches.get(row.address_id);
  if (!match || match[2] !== "Match")
    return {
      city: null,
      method: `Not matched by the Census geocoder (${match?.[2] || "no response"}).`,
    };
  if (match[8] !== fips[row.state])
    return { city: null, method: "Census placed this address in a different state." };
  const approximate = match[3] !== "Exact";
  if (approximate && !sameStreet(match[1], match[4]))
    return {
      city: null,
      method: `Census returned a different street (${match[4]}).`,
    };
  const coordinates = match[5].split(",").map(Number) as Point;
  if (coordinates.length !== 2 || !coordinates.every(Number.isFinite))
    return { city: null, method: "Census returned no usable coordinates." };
  const containing = places.filter(
    (place) =>
      place.properties.STATE === fips[row.state] &&
      pointInGeometry(coordinates, place.geometry),
  );
  if (containing.length !== 1)
    return {
      city: null,
      method: "The geocoded point is not inside exactly one city boundary in scope.",
    };
  return {
    city: containing[0].properties.BASENAME,
    method: approximate
      ? `Census matched ${match[4]}; that point lies inside the ${containing[0].properties.BASENAME} city boundary.`
      : `Census exact match; the point lies inside the ${containing[0].properties.BASENAME} city boundary.`,
  };
}
