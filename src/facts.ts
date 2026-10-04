import type { FactRanges, FactValue, Facts } from "./contracts";

/** The only property facts a rule may test. Shared by extraction, evaluation and the UI. */
export const FIELDS = {
  units: {
    type: "number",
    label: "Units",
    question: "How many units are in the building?",
    evidence: "The assessor record, the building's permit history, or the rent registry.",
    prompt: "number of dwelling units in the building/property",
  },
  year_built: {
    type: "number",
    label: "Year built",
    question: "When was the building built?",
    evidence: "The assessor record or the original building permit.",
    prompt: "construction year",
  },
  certificate_of_occupancy_date: {
    type: "date",
    label: "Certificate of occupancy",
    question: "When was the first certificate of occupancy issued?",
    evidence: "The city's building department record for the first certificate of occupancy.",
    prompt:
      "ISO date the first certificate of occupancy was issued (use this for 'certificate of occupancy before X' cutoffs)",
  },
  building_age_years: {
    type: "number",
    label: "Building age",
    question: "How long ago was the first certificate of occupancy issued?",
    evidence: "The city's building department record for the first certificate of occupancy.",
    prompt:
      "years since the first certificate of occupancy, as of the query date (use for rolling rules like 'issued within the previous 15 years')",
  },
  single_family_or_condo: {
    type: "boolean",
    label: "Single-family or condo",
    question: "Is this a single-family home or a separately sold condo?",
    evidence: "The assessor's property class.",
    prompt: "true for a single-family home or individually owned condominium unit",
  },
  owner_occupied: {
    type: "boolean",
    label: "Owner lives there",
    question: "Does the owner live in the building?",
    evidence: "A homestead or owner-occupancy record, or a statement from the owner.",
    prompt: "the owner lives in one of the units",
  },
  owner_type: {
    type: "string",
    label: "Owner type",
    question: "Who owns the building?",
    evidence: "The deed or the assessor's owner record.",
    prompt:
      "one of: natural_person, corporation, reit, llc, public_entity, nonprofit",
  },
  affordable_housing_restricted: {
    type: "boolean",
    label: "Deed-restricted affordable",
    question: "Is the building deed-restricted affordable housing?",
    evidence: "A recorded regulatory agreement or the housing agency's list.",
    prompt: "deed-restricted or regulatory-agreement affordable housing",
  },
  residential: {
    type: "boolean",
    label: "Residential rental",
    question: "Is this a residential rental property?",
    evidence: "The assessor's use code.",
    prompt: "residential rental housing (always true in this dataset)",
  },
} as const;
export type Field = keyof typeof FIELDS;
export const FIELD_NAMES = Object.keys(FIELDS) as Field[];
export const isField = (value: string): value is Field => value in FIELDS;
export const labelFor = (field: string) =>
  field === "legal_city"
    ? "City"
    : isField(field)
      ? FIELDS[field].label
      : field.replace(/_/g, " ");

export type Resolved =
  | { kind: "exact"; value: string | number | boolean; basis: string }
  | {
      kind: "range";
      min: string | number | null;
      max: string | number | null;
      basis: string;
    }
  | { kind: "missing"; ask: string };

const DAY = 86_400_000;
const years = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
  (365.2425 * DAY);
const present = (value: FactValue | undefined): value is string | number | boolean =>
  value !== null && value !== undefined && !(typeof value === "string" && !value.trim());

/** Resolve a fact to an exact value, known bounds, or "missing" plus the question that would settle it. */
export function resolveFact(
  field: string,
  facts: Facts,
  ranges: FactRanges,
  asOf: string,
): Resolved {
  const value = facts[field];
  if (present(value)) return { kind: "exact", value, basis: "record" };
  if (field === "certificate_of_occupancy_date") {
    if (present(facts.year_built) && typeof facts.year_built === "number")
      return {
        kind: "range",
        min: `${facts.year_built}-01-01`,
        max: `${facts.year_built}-12-31`,
        basis: `Built ${facts.year_built}`,
      };
    return { kind: "missing", ask: "year_built" };
  }
  if (field === "building_age_years") {
    const issued = resolveFact("certificate_of_occupancy_date", facts, ranges, asOf);
    if (issued.kind === "missing") return issued;
    if (issued.kind === "exact")
      return {
        kind: "exact",
        value: years(String(issued.value), asOf),
        basis: issued.basis,
      };
    return {
      kind: "range",
      min: issued.max === null ? null : years(String(issued.max), asOf),
      max: issued.min === null ? null : years(String(issued.min), asOf),
      basis: issued.basis,
    };
  }
  if (field === "single_family_or_condo") {
    const units = resolveFact("units", facts, ranges, asOf);
    if (units.kind === "exact")
      return { kind: "exact", value: units.value === 1, basis: "unit count" };
    if (units.kind === "range") {
      if (units.min !== null && Number(units.min) >= 2)
        return { kind: "exact", value: false, basis: units.basis };
      if (units.max !== null && Number(units.max) <= 1)
        return { kind: "exact", value: true, basis: units.basis };
    }
    return { kind: "missing", ask: "units" };
  }
  if (field === "affordable_housing_restricted")
    // Exemptions must be established by the owner; none appears in the assessor record.
    return { kind: "exact", value: false, basis: "no affordability restriction in the record" };
  const range = ranges[field];
  if (range) return { kind: "range", min: range.min, max: range.max, basis: range.basis };
  return { kind: "missing", ask: field };
}

export function describeFact(resolved: Resolved): string {
  if (resolved.kind === "missing") return "Not in the record";
  if (resolved.kind === "exact")
    return typeof resolved.value === "boolean"
      ? resolved.value
        ? "Yes"
        : "No"
      : typeof resolved.value === "number" && !Number.isInteger(resolved.value)
        ? resolved.value.toFixed(1)
        : String(resolved.value);
  const fmt = (v: string | number) =>
    typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v);
  if (resolved.min !== null && resolved.max !== null)
    return resolved.min === resolved.max
      ? fmt(resolved.min)
      : `${fmt(resolved.min)}–${fmt(resolved.max)}`;
  if (resolved.min !== null) return `${fmt(resolved.min)} or more`;
  return `${fmt(resolved.max!)} or fewer`;
}
