import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

type Point = [number, number];
type Polygon = Point[][];
type Geometry = { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };
type Place = { properties: { BASENAME: string; STATE: string }; geometry: Geometry };
let matches = new Map<string, string[]>();
let places: Place[] = [];
const fips: Record<string, string> = { CA: '06', NJ: '34', MA: '25' };

export function pointInRing(point: Point, ring: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInGeometry(point: Point, geometry: Geometry): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings => rings.length > 0 && pointInRing(point, rings[0]) && !rings.slice(1).some(ring => pointInRing(point, ring)));
}
export async function loadGeography(root: string): Promise<void> {
  matches = new Map(); places = [];
  try {
    const rows = parse(await readFile(resolve(root, 'sources/geography/census-response.csv'), 'utf8'), { relax_column_count: true, skip_empty_lines: true }) as string[][];
    matches = new Map(rows.map(row => [row[0], row]));
    places = JSON.parse(await readFile(resolve(root, 'sources/geography/incorporated-places.geojson'), 'utf8')).features;
  } catch { /* Absent cache produces explicit unresolved jurisdictions, never a guessed city. */ }
}
export function resolveJurisdiction(row: Record<string, string>): { city: string | null; method: string } {
  const match = matches.get(row.address_id);
  if (!match || match[2] !== 'Match') return { city: null, method: `Unresolved: Census ${match?.[2] || 'response unavailable'}; postal label retained separately.` };
  if (match[8] !== fips[row.state]) return { city: null, method: 'Unresolved: Census state differs from the supplied property state.' };
  if (match[3] !== 'Exact') return { city: null, method: 'Unresolved: Census returned an approximate address match requiring review.' };
  const coordinates = match[5].split(',').map(Number) as Point;
  if (coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return { city: null, method: 'Unresolved: invalid Census coordinates.' };
  const containing = places.filter(place => place.properties.STATE === fips[row.state] && pointInGeometry(coordinates, place.geometry));
  if (containing.length !== 1) return { city: null, method: 'Unresolved: coordinates do not identify exactly one supported incorporated place.' };
  return { city: containing[0].properties.BASENAME, method: 'Census exact address match + TIGERweb incorporated-place polygon; state verified. Current boundary snapshot.' };
}
