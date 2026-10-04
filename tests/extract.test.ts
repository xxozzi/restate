import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceDocument } from "../src/contracts.ts";
import {
  checkHeadline,
  chunkText,
  consolidate,
  quotedEndDate,
  extractDocuments,
  recoverSourceQuote,
  statutoryEffectiveDate,
  validateCandidates,
  validatePredicate,
} from "../src/extract.ts";

const doc = (text: string, overrides: Partial<SourceDocument> = {}): SourceDocument => ({
  id: "T1",
  title: "Test",
  jurisdiction: "Example City, CA",
  url: "https://example.invalid",
  retrievedAt: "",
  text,
  sha256: "",
  captureStatus: "captured",
  filename: "",
  ...overrides,
});
const candidate = (overrides: Record<string, unknown> = {}) => ({
  title: "Deposit cap",
  category: "security_deposits",
  level: "city",
  status: "in_force",
  effectiveDate: null,
  effectiveDateQuote: "",
  endDate: null,
  requirement: "Deposits are capped.",
  keyValue: "1 month",
  citation: "Example Code § 1",
  quotedSpan: "A landlord may not collect more than one month of rent as a deposit.",
  coverageJson: '{"op":"always"}',
  coverageDescription: "All rentals",
  exemptions: [],
  yieldsToLocal: false,
  preemptsLocal: false,
  warnings: [],
  ...overrides,
});
const SOURCE = "Section 1.\nA landlord may not collect more than one month of rent\nas a deposit. This section takes effect on January 1, 2025.";

test("quotes are recovered across line breaks and curly quotes but never with missing words", () => {
  assert.ok(recoverSourceQuote(SOURCE, "A landlord may not collect more than one month of rent as a deposit."));
  assert.equal(recoverSourceQuote(SOURCE, "A landlord may not collect more than one month as a deposit."), null);
  const withFootnote = "engage in\n1\nor otherwise facilitate parallel pricing coordination";
  assert.ok(recoverSourceQuote(withFootnote, "engage in or otherwise facilitate parallel pricing coordination"));
});

test("only verbatim, allowlisted candidates become rules", () => {
  const ok = validateCandidates(doc(SOURCE), { rules: [candidate()] });
  assert.equal(ok.rules.length, 1);
  const invented = validateCandidates(doc(SOURCE), { rules: [candidate({ quotedSpan: "Deposits may never exceed half a month of rent." })] });
  assert.equal(invented.rules.length, 0);
  assert.equal(validatePredicate({ op: "gte", field: "units", value: 5 }), true);
  assert.equal(validatePredicate({ op: "gte", field: "landlord_mood", value: 5 }), false);
  assert.equal(validatePredicate({ op: "gte", field: "owner_occupied", value: true }), false);
});

test("an unsupported coverage form becomes 'needs review', not a guess", () => {
  const result = validateCandidates(doc(SOURCE), { rules: [candidate({ coverageJson: "units >= 5" })] });
  assert.equal(result.rules[0].coverage.op, "unknown");
});

test("a start date must be shown in the source with start-date language", () => {
  const shown = validateCandidates(doc(SOURCE), {
    rules: [candidate({ effectiveDate: "2025-01-01", effectiveDateQuote: "This section takes effect on January 1, 2025." })],
  });
  assert.equal(shown.rules[0].effectiveDate, "2025-01-01");
  const invented = validateCandidates(doc(SOURCE), { rules: [candidate({ effectiveDate: "2019-01-01", effectiveDateQuote: "" })] });
  assert.equal(invented.rules[0].effectiveDate, null);
});

test("statutory start dates are computed by code from the source's own words", () => {
  const nj = doc("approved July 20, 2026\n... This act shall take effect on the first day of\nthe twelfth month next following the date of enactment.", { jurisdiction: "NJ" });
  assert.equal(statutoryEffectiveDate(nj)?.date, "2027-07-01");
  const ca = doc("10/06/25 - Chaptered\nAn act to amend Section 16729", {
    jurisdiction: "CA",
    url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=x",
  });
  assert.equal(statutoryEffectiveDate(ca)?.date, "2026-01-01");
});

test("duplicates of one law across documents merge, with the other documents kept as references", () => {
  const a = validateCandidates(doc(SOURCE, { id: "A" }), { rules: [candidate()] }).rules;
  const b = validateCandidates(doc(SOURCE, { id: "B" }), { rules: [candidate({ citation: "Example Code §1" })] }).rules;
  const merged = consolidate([...a, ...b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].alsoIn, ["B"]);
  assert.match(merged[0].id, /-DEP-01$/);
});

test("long sources are split into overlapping parts that cover the whole text", () => {
  const text = Array.from({ length: 3000 }, (_, i) => `Line ${i} of a long statute.`).join("\n");
  const parts = chunkText(text);
  assert.ok(parts.length > 1);
  assert.equal(parts[0].start, 0);
  assert.ok(parts.at(-1)!.start + parts.at(-1)!.text.length === text.length);
});

test("startup replays the cache only and never spends money", async () => {
  process.env.RESTATE_RUNS_DIR = await mkdtemp(join(tmpdir(), "restate-"));
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
  const result = await extractDocuments([doc(SOURCE)]);
  assert.equal(result.rules.length, 0);
  assert.deepEqual(result.report.pendingDocuments, ["T1"]);
  process.env.ANTHROPIC_API_KEY = saved;
  delete process.env.RESTATE_RUNS_DIR;
});

test("a plain-language headline must speak to the renter and use only numbers found in the rule", () => {
  const rule = {
    title: "Rent Increase Notice Requirement",
    requirement: "Landlords must provide at least thirty days' written notice before a rent increase of less than 10%.",
    keyValue: null,
    quotedSpan: "at least thirty days' written advance notice",
    coverageDescription: "",
  } as unknown as Parameters<typeof checkHeadline>[0];
  assert.equal(
    checkHeadline(rule, "Your landlord must give you 30 days' written notice before raising your rent"),
    "Your landlord must give you 30 days' written notice before raising your rent.",
  );
  assert.equal(checkHeadline(rule, "Your landlord must give you 60 days' notice before raising your rent."), null);
  assert.equal(checkHeadline(rule, "Landlords must give 30 days' notice before raising rent."), null);
});

test("an end date stated in the quote is kept", () => {
  assert.equal(quotedEndDate("Effective March 30, 2020, through January 31, 2024, rent increases are prohibited"), "2024-01-31");
  assert.equal(quotedEndDate("Rent increases are limited to 3% per year."), null);
});
