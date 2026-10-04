import { createHash } from "node:crypto";
import type { PropertyRecord } from "./contracts";
import { cityAt, streetTokens } from "./geography";

export const STATES: Record<string, string> = { CA: "California", NJ: "New Jersey", MA: "Massachusetts" };

export class GeocodeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface CensusMatch {
  matchedAddress: string;
  coordinates: { x: number; y: number };
  geographies?: Record<string, { BASENAME?: string; NAME?: string }[]>;
}

const titleCase = (value: string) => value.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** A typed address that is one of the sample buildings keeps that building's assessor record. */
export function matchSample(found: PropertyRecord, sample: PropertyRecord[]): PropertyRecord | null {
  const number = Number(found.address.match(/^(\d+)\s/)?.[1]);
  if (!number) return null;
  const street = streetTokens(found.address).join(" ");
  return (
    sample.find((p) => {
      if (p.state !== found.state || (p.zip && found.zip && p.zip.slice(0, 5) !== found.zip.slice(0, 5))) return false;
      const house = p.address.match(/^(\d+)(?:\s*-\s*(\d+))?\s/);
      if (!house) return false;
      const [low, high] = [Number(house[1]), Number(house[2] ?? house[1])];
      return number >= low && number <= high && streetTokens(p.address).join(" ") === street;
    }) ?? null
  );
}
const cache = new Map<string, PropertyRecord>();

/**
 * Turn any typed address into a property the evaluator can use: the Census geocoder finds it,
 * the official city boundaries decide its legal city, and every building fact starts unknown.
 */
export async function geocodeAddress(input: string): Promise<PropertyRecord> {
  const query = input.replace(/\s+/g, " ").trim();
  if (query.length < 6 || query.length > 200) throw new GeocodeError("Type a street address with its city and state.", 400);
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const base = process.env.CENSUS_GEOCODER_URL || "https://geocoding.geo.census.gov";
  const url =
    `${base}/geocoder/geographies/onelineaddress?address=${encodeURIComponent(query)}` +
    "&benchmark=Public_AR_Current&vintage=Current_Current&layers=28&format=json";
  let data: { result?: { addressMatches?: CensusMatch[] } };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(String(response.status));
    data = (await response.json()) as typeof data;
  } catch {
    throw new GeocodeError("Couldn't reach the Census geocoder. Check the internet connection and try again.", 502);
  }
  const match = data.result?.addressMatches?.[0];
  if (!match) throw new GeocodeError("The Census geocoder couldn't find that address. Include the city and state.", 404);
  const [street, postal = "", state = "", zip = ""] = match.matchedAddress.split(",").map((part) => part.trim());
  if (!STATES[state])
    throw new GeocodeError(
      "That address is outside California, New Jersey and Massachusetts, the only states with laws loaded.",
      422,
    );
  const point: [number, number] = [match.coordinates.x, match.coordinates.y];
  const inScope = cityAt(point, state);
  const place = match.geographies?.["Incorporated Places"]?.[0];
  const placeName = place?.BASENAME || place?.NAME?.replace(/ (city|town|borough|township)$/i, "") || null;
  const city = inScope ?? placeName ?? "Unincorporated area";
  const property: PropertyRecord = {
    id: `ADDR-${createHash("sha256").update(match.matchedAddress).digest("hex").slice(0, 8).toUpperCase()}`,
    address: street,
    postalCity: titleCase(postal),
    city,
    state,
    zip,
    facts: {
      residential: true,
      units: null,
      year_built: null,
      owner_occupied: null,
      owner_type: null,
      certificate_of_occupancy_date: null,
      affordable_housing_restricted: null,
    },
    ranges: {},
    useDescription: "",
    source: "Census Geocoder (live lookup); no assessor record",
    retrievedAt: new Date().toISOString(),
    jurisdictionMethod: inScope
      ? `Census matched ${match.matchedAddress}; that point lies inside the ${inScope} city boundary.`
      : placeName
        ? `Census places this in ${placeName}, which has no local laws loaded, so only ${STATES[state]} state law is checked.`
        : `Census places this outside any incorporated city, so only ${STATES[state]} state law is checked.`,
  };
  cache.set(key, property);
  return property;
}
