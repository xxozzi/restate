import test from "node:test";
import assert from "node:assert/strict";
import type { Predicate, PropertyRecord, Rule } from "../src/contracts.ts";
import { evaluateAll, evaluateProperty, evaluateRule } from "../src/evaluate.ts";

// Synthetic fixtures: these test the evaluator's logic, not any real law.
const asOf = "2026-10-01";
const sixUnits: Predicate = { op: "gte", field: "units", value: 6 };

function property(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: "P1",
    address: "100 Example St",
    postalCity: "Example City",
    city: "Example City",
    state: "CA",
    zip: "90000",
    facts: { residential: true, units: null, year_built: null },
    ranges: {},
    useDescription: "",
    source: "fixture",
    retrievedAt: asOf,
    jurisdictionMethod: "fixture",
    ...overrides,
  };
}
function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "R1",
    title: "Synthetic rule",
    category: "just_cause_eviction",
    jurisdiction: "Example City, CA",
    state: "CA",
    level: "city",
    status: "in_force",
    effectiveDate: "2026-01-01",
    requirement: "Synthetic.",
    keyValue: null,
    coverage: sixUnits,
    coverageDescription: "",
    exemptions: [],
    sourceId: "S1",
    alsoIn: [],
    citation: "Synthetic § 1",
    sourceUrl: "",
    quotedSpan: "This synthetic rule covers buildings with six or more units.",
    quoteStart: 0,
    extractionMethod: "model",
    yieldsToLocal: false,
    preemptsLocal: false,
    warnings: [],
    ...overrides,
  };
}

test("a missing fact is unknown, never zero or false", () => {
  const result = evaluateRule(rule(), property(), asOf);
  assert.equal(result.result, "unknown");
  assert.deepEqual(result.missingFacts, ["units"]);
});

test("a false AND settles the answer even when other facts are missing", () => {
  const coverage: Predicate = { op: "all", args: [sixUnits, { op: "eq", field: "owner_occupied", value: false }] };
  const result = evaluateRule(rule({ coverage }), property({ facts: { owner_occupied: true } }), asOf);
  assert.equal(result.result, "does_not_apply");
});

test("a unit range from the use code settles a threshold it clears", () => {
  const ranged = property({ ranges: { units: { min: 7, max: 30, basis: "APT 7-30 UNITS" } } });
  assert.equal(evaluateRule(rule(), ranged, asOf).result, "applies");
  const straddles = property({ ranges: { units: { min: 5, max: 14, basis: "5 to 14" } } });
  assert.equal(evaluateRule(rule(), straddles, asOf).result, "unknown");
});

test("an owner-occupied small-building exemption cannot apply to a five-plus building", () => {
  const coverage: Predicate = {
    op: "not",
    arg: { op: "all", args: [{ op: "eq", field: "owner_occupied", value: true }, { op: "lte", field: "units", value: 2 }] },
  };
  const fivePlus = property({ ranges: { units: { min: 5, max: null, basis: "class 4C" } } });
  assert.equal(evaluateRule(rule({ coverage }), fivePlus, asOf).result, "applies");
});

test("certificate-of-occupancy cutoffs use the construction year, and the cutoff year stays unknown", () => {
  const coverage: Predicate = { op: "lt", field: "certificate_of_occupancy_date", value: "1979-06-14" };
  const result = (year: number) =>
    evaluateRule(rule({ coverage }), property({ facts: { year_built: year } }), asOf).result;
  assert.equal(result(1962), "applies");
  assert.equal(result(1979), "unknown");
  assert.equal(result(1985), "does_not_apply");
});

test("rolling building-age exemptions are measured from the query date", () => {
  const coverage: Predicate = { op: "not", arg: { op: "lt", field: "building_age_years", value: 15 } };
  const at = (year: number, date = asOf) =>
    evaluateRule(rule({ coverage }), property({ facts: { year_built: year } }), date).result;
  assert.equal(at(2000), "applies");
  assert.equal(at(2020), "does_not_apply");
  assert.equal(at(2011), "unknown");
});

test("start dates are inclusive and pending proposals never become law by date", () => {
  assert.equal(evaluateRule(rule({ coverage: { op: "always" } }), property(), "2025-12-31").result, "not_yet_effective");
  assert.equal(evaluateRule(rule({ coverage: { op: "always" } }), property(), "2026-01-01").result, "applies");
  const proposal = rule({ coverage: { op: "always" }, status: "pending", effectiveDate: "2020-01-01" });
  assert.equal(evaluateRule(proposal, property(), "2030-01-01").result, "pending");
  assert.equal(evaluateRule(rule({ status: "failed" }), property(), asOf).result, "does_not_apply");
});

test("an in-force rule without a stated start date still applies", () => {
  const result = evaluateRule(rule({ coverage: { op: "always" }, effectiveDate: null }), property(), asOf);
  assert.equal(result.result, "applies");
});

test("city rules need the legal city; the mailing city is never substituted", () => {
  const unresolved = property({ city: null, postalCity: "Example City" });
  const result = evaluateRule(rule({ coverage: { op: "always" } }), unresolved, asOf);
  assert.equal(result.result, "unknown");
  assert.ok(result.missingFacts.includes("legal_city"));
  const elsewhere = property({ city: "Other City" });
  assert.equal(evaluateRule(rule({ coverage: { op: "always" } }), elsewhere, asOf).result, "does_not_apply");
  const state = rule({ level: "state", jurisdiction: "CA", coverage: { op: "always" } });
  assert.equal(evaluateRule(state, unresolved, asOf).result, "applies");
});

test("a state rule that yields to stricter local rules is superseded only where the local rule applies", () => {
  const state = rule({ id: "STATE", level: "state", jurisdiction: "CA", coverage: { op: "always" }, yieldsToLocal: true, category: "rent_increase_limits" });
  const local = rule({ id: "LOCAL", category: "rent_increase_limits", coverage: { op: "lt", field: "year_built", value: 1980 } });
  const outcome = (year: number | null) =>
    evaluateAll(property({ facts: { year_built: year } }), [state, local], asOf).find((r) => r.ruleId === "STATE")!.result;
  assert.equal(outcome(1960), "superseded");
  assert.equal(outcome(1990), "applies");
  assert.equal(outcome(null), "unknown");
});

test("possible preemption flags both rules for review without deciding the conflict", () => {
  const state = rule({ id: "STATE", level: "state", jurisdiction: "CA", coverage: { op: "always" }, preemptsLocal: true, effectiveDate: "2027-07-01" });
  const local = rule({ id: "LOCAL", coverage: { op: "always" } });
  const results = evaluateAll(property(), [state, local], asOf);
  assert.ok(results.every((r) => r.conflictFlag));
  assert.equal(results.find((r) => r.ruleId === "LOCAL")!.result, "applies");
});

test("evidence questions show what each answer would change, without touching the record", () => {
  const p = property();
  const report = evaluateProperty(p, [rule()], asOf);
  const question = report.questions.find((q) => q.field === "units")!;
  assert.ok(question.branches.some((b) => b.result === "applies"));
  assert.ok(question.branches.some((b) => b.result === "does_not_apply"));
  assert.equal(p.facts.units, null);
  const answered = evaluateProperty(p, [rule()], asOf, { units: 6 });
  assert.equal(answered.results[0].result, "applies");
  assert.equal(answered.questions.length, 0);
});

test("evidence answers respect bounds already known from the use code", () => {
  const p = property({ ranges: { units: { min: 5, max: 14, basis: "5 to 14" } } });
  const report = evaluateProperty(p, [rule({ coverage: { op: "gte", field: "units", value: 10 } })], asOf);
  const values = report.questions[0].branches.map((b) => b.value as number);
  assert.ok(values.every((v) => v >= 5 && v <= 14));
});
