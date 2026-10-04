import { readFile, access } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import type {
  ChangeCase,
  FactRanges,
  PropertyRecord,
  SourceDocument,
} from "./contracts";
import { loadGeography, resolveJurisdiction } from "./geography";

export interface OfficialChange {
  test_id: string;
  title: string;
  type: "as_of" | "boundary" | "pending" | "negative";
  rule_ids: string[];
  as_of?: string;
  as_of_before?: string;
  as_of_after?: string;
  states?: string[];
  conflict_with?: string[];
  expected_behavior: string;
}
export interface Dataset {
  properties: PropertyRecord[];
  documents: SourceDocument[];
  changes: OfficialChange[];
  schema: Record<string, unknown>;
}

function numeric(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Bounds implied by the assessor's own use code when the exact value is missing.
 * Each bound cites the code it came from, so the UI can show why it is known.
 */
export function deriveRanges(row: Record<string, string>): FactRanges {
  const ranges: FactRanges = {};
  const code = (row.use_code || "").trim();
  const description = (row.use_description || "").trim();
  const label = `${code}${description ? ` “${description}”` : ""}`;
  if (numeric(row.units) === null) {
    let min: number | null = null;
    let max: number | null = null;
    let between = description.match(/(\d+)\s*(?:to|-)\s*(\d+)[\s-]*units?/i);
    if (between) [min, max] = [Number(between[1]), Number(between[2])];
    else if (/(?:fifteen|15)\s+units?\s+or\s+more/i.test(description)) min = 15;
    else if (/five or more|5\+\s*units|\(5\+/i.test(description)) min = 5;
    else if (/>\s*8[\s-]*unit/i.test(description)) min = 9;
    else if (/4 units or less/i.test(description)) max = 4;
    if (row.state === "NJ" && code === "4C") {
      // N.J.A.C. 18:12-2.2: class 2 is residential with four families or less;
      // class 4C (apartment) therefore covers five or more dwelling units.
      min = Math.max(min ?? 0, 5);
      const tokens = [...description.matchAll(/(?:^|[-\s])(\d{1,3})U(?=$|[-\s(])/g)];
      if (tokens.length === 1 && !description.includes("/")) {
        const units = Number(tokens[0][1]);
        if (units >= 5) [min, max] = [units, units];
      }
    }
    if (min !== null || max !== null)
      ranges.units = {
        min,
        max,
        basis:
          min !== null && min === max
            ? `Assessor description ${label}`
            : `Assessor use code ${label}`,
      };
  }
  return ranges;
}

export async function loadDataset(root = process.cwd()): Promise<Dataset> {
  const starter = resolve(root, "sources/starter");
  await access(resolve(starter, "data/sample_addresses.csv"));
  await loadGeography(root);
  const rows = parse(
    await readFile(resolve(starter, "data/sample_addresses.csv"), "utf8"),
    { columns: true, skip_empty_lines: true },
  ) as Record<string, string>[];
  const properties = rows.map((row) => {
    const geography = resolveJurisdiction(row);
    return {
      id: row.address_id,
      address: row.street_address,
      postalCity: row.postal_city,
      city: geography.city,
      state: row.state,
      zip: row.zip,
      facts: {
        // Organizer README §4: the sample is multifamily residential property.
        residential: true,
        units: numeric(row.units),
        year_built: numeric(row.year_built),
        use_code: row.use_code || null,
        owner_occupied: null,
        owner_type: null,
        certificate_of_occupancy_date: null,
        affordable_housing_restricted: null,
      },
      ranges: deriveRanges(row),
      useDescription: row.use_description || "",
      source: row.source_dataset,
      retrievedAt: row.retrieved_at,
      jurisdictionMethod: geography.method,
    } satisfies PropertyRecord;
  });
  const manifest = parse(
    await readFile(resolve(starter, "corpus/corpus_manifest.csv"), "utf8"),
    { columns: true, skip_empty_lines: true },
  ) as Record<string, string>[];
  const documents = await Promise.all(
    manifest.map(async (row) => {
      let text = "";
      if (row.text_file) {
        const path = resolve(starter, "corpus", row.text_file);
        if (!path.startsWith(resolve(starter, "corpus") + "/"))
          throw new Error("Invalid corpus path");
        try {
          text = await readFile(path, "utf8");
        } catch {
          /* A missing capture stays explicit. */
        }
      }
      return {
        id: row.doc_id,
        title: documentTitle(text, row.url, row.doc_id),
        jurisdiction: row.jurisdictions,
        url: row.url,
        retrievedAt: row.retrieved_at || "",
        text,
        sha256: text ? createHash("sha256").update(text).digest("hex") : "",
        captureStatus: text ? "captured" : row.capture === "yes" ? "capture_missing" : "link_only",
        filename: row.text_file ? basename(row.text_file) : "",
      } satisfies SourceDocument;
    }),
  );
  const catalog = JSON.parse(
    await readFile(resolve(root, "sources/catalog.json"), "utf8"),
  ) as {
    sources: {
      kind: string;
      path: string;
      application_id?: string;
      title: string;
      jurisdiction?: string;
      source_url: string;
      retrieved_at?: string;
    }[];
  };
  for (const entry of catalog.sources.filter(
    (item) => item.kind === "supplemental-text" && item.application_id,
  )) {
    const text = await readFile(resolve(root, entry.path), "utf8");
    documents.push({
      id: entry.application_id!,
      title: entry.title,
      jurisdiction: entry.jurisdiction || "",
      url: entry.source_url,
      retrievedAt: entry.retrieved_at || "",
      text,
      sha256: createHash("sha256").update(text).digest("hex"),
      captureStatus: "supplemental",
      filename: basename(entry.path),
    });
  }
  return {
    properties,
    documents,
    changes: JSON.parse(
      await readFile(resolve(starter, "dev/change_tests.json"), "utf8"),
    ),
    schema: JSON.parse(
      await readFile(resolve(starter, "schema/rule_record.schema.json"), "utf8"),
    ),
  };
}

function documentTitle(text: string, url: string, id: string): string {
  const lines = text
    .split("\n")
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(
      (value) =>
        value.length > 3 &&
        !/^(SOURCE:|RETRIEVED:|Skip to|Quick Links|Menu|Search|skip to content|home|accessibility)/i.test(value) &&
        !/TEL:|FAX:|EMAIL:|WEB:|@|www\.|\(\d{3}\)|\d{3}-\d{4}|Suite \d+|[\u0000-\u0008\uFFFD\uF000-\uF8FF]/i.test(value),
    );
  // Page titles like "Security Deposits | Berkeley Rent Board" are the most descriptive line when present.
  const line = lines.slice(0, 40).find((value) => / \| /.test(value) && value.length < 140) ?? lines[0];
  if (line) return line.slice(0, 140);
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || id)
      .replace(/[-_]/g, " ")
      .slice(0, 140);
  } catch {
    return id;
  }
}

export function describeChange(test: OfficialChange): ChangeCase {
  return {
    id: test.test_id,
    title: test.title,
    description: test.expected_behavior,
    beforeDate: test.as_of_before || test.as_of || "2026-10-01",
    afterDate: test.as_of_after || test.as_of || "2026-10-01",
    status:
      test.type === "pending"
        ? "If enacted"
        : test.type === "negative"
          ? "Failed proposal"
          : test.type === "boundary"
            ? "City boundary"
            : "Effective date",
  };
}
