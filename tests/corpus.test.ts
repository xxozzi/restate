import test from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../src/data";
import { extractDocuments } from "../src/extract";
import {
  exportChanges,
  exportLookups,
  exportEvidenceFixtures,
  validateRules,
} from "../src/export";
import { evaluateProperty } from "../src/evaluate";

const dataset = await loadDataset();
const { rules } = await extractDocuments(dataset.documents, {
  useModel: false,
});

test("the complete bounded corpus exports every supplied ID with schema-valid source spans", () => {
  assert.equal(dataset.properties.length, 500);
  assert.equal(dataset.documents.length, 94);
  assert.equal(dataset.documents.filter((d) => d.text).length, 61);
  assert.equal(dataset.properties.filter((p) => p.city).length, 374);
  assert.equal(
    validateRules(rules, "2026-10-01", dataset.schema).errors.length,
    0,
  );
  for (const rule of rules) {
    const source = dataset.documents.find((d) => d.id === rule.sourceId)!;
    assert.equal(
      source.text.slice(
        rule.quoteStart,
        rule.quoteStart + rule.quotedSpan.length,
      ),
      rule.quotedSpan,
    );
  }
  const output = exportLookups(dataset.properties, rules, "2026-10-01");
  assert.deepEqual(
    Object.keys(output.lookups).sort(),
    dataset.properties.map((p) => p.id).sort(),
  );
  assert.ok(
    Object.values(output.lookups)
      .flat()
      .every((r) => r.result !== "does_not_apply"),
  );
});

test("future NJ date and failed MA petition are derived from sources without expected-address lists", () => {
  const changes = exportChanges(dataset.changes, dataset.properties, rules);
  assert.deepEqual(Object.keys(changes), ["T1", "T2", "T3", "T4", "T5"]);
  assert.equal(changes.T3.affected_address_ids.length, 140);
  assert.deepEqual(changes.T5.affected_address_ids, []);
  const failure = rules.find(
    (r) =>
      r.sourceId === "SUP-MA-CELLA" && r.category === "rent_increase_limits",
  );
  assert.equal(failure?.status, "failed");
});

test("generated evidence fixtures reproduce scenario outcomes without mutating supplied facts", () => {
  const property = dataset.properties.find((p) => p.id === "A0002")!;
  const before = structuredClone(property);
  const output = exportEvidenceFixtures(property, rules, "2026-10-01");
  assert.equal(output.independentlyReviewed, false);
  assert.ok(output.cases.length > 0);
  for (const item of output.cases)
    assert.deepEqual(
      evaluateProperty(property, rules, "2026-10-01", item.facts).results,
      item.results,
    );
  assert.deepEqual(property, before);
});

test("saved contrast fixtures retain every already-supplied scenario fact", () => {
  const property=dataset.properties.find(p=>p.id==='A0008')!;
  const output=exportEvidenceFixtures(property,rules,'2026-10-01',{owner_occupied:true});
  assert.equal(output.scenarioFacts.owner_occupied,true);
  assert.ok(output.cases.length>0);
  for(const item of output.cases) assert.deepEqual(item.results,evaluateProperty(property,rules,'2026-10-01',item.facts).results);
});
