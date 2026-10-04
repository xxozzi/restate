import test from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../src/data.ts";
import { extractDocuments } from "../src/extract.ts";
import { exportChanges, exportLookups, validateRules } from "../src/export.ts";

// Integration checks over the real corpus, using the committed extraction cache (no API calls).
const dataset = await loadDataset();
const { rules } = await extractDocuments(dataset.documents);
const changes = exportChanges(dataset.changes, dataset.properties, rules);
const byState = (state: string) => dataset.properties.filter((p) => p.state === state).map((p) => p.id).sort();

test("every rule is schema-valid and quotes its source exactly", () => {
  assert.ok(rules.length > 30);
  assert.equal(validateRules(rules, "2026-10-01", dataset.schema).errors.length, 0);
  for (const rule of rules) {
    const source = dataset.documents.find((d) => d.id === rule.sourceId)!;
    assert.equal(source.text.slice(rule.quoteStart, rule.quoteStart + rule.quotedSpan.length), rule.quotedSpan);
  }
});

test("lookups cover all 500 addresses and omit rules that don't apply", () => {
  const output = exportLookups(dataset.properties, rules, "2026-10-01");
  assert.equal(Object.keys(output.lookups).length, 500);
  assert.ok(Object.values(output.lookups).flat().every((r) => r.result !== ("does_not_apply" as string)));
});

test("T1: the California algorithmic-pricing law takes effect for every California address", () => {
  assert.deepEqual([...changes.T1.affected_address_ids].sort(), byState("CA"));
});

test("T2: each local ban stays inside its own city and never reaches Newark", () => {
  const affected = new Set(changes.T2.affected_address_ids);
  for (const p of dataset.properties) {
    if (p.city === "Newark" || p.state !== "NJ") assert.ok(!affected.has(p.id), p.id);
    if (p.city === "Hoboken" || p.city === "Jersey City") assert.ok(affected.has(p.id), p.id);
  }
});

test("T3: the FAIR Act turns on for New Jersey and flags only Jersey City and Hoboken", () => {
  assert.deepEqual([...changes.T3.affected_address_ids].sort(), byState("NJ"));
  const cities = new Set(changes.T3.conflict_flag_address_ids.map((id) => dataset.properties.find((p) => p.id === id)!.city));
  assert.ok([...cities].every((city) => city === "Hoboken" || city === "Jersey City"));
});

test("T4 lists Massachusetts addresses only as a hypothetical; T5 is empty", () => {
  assert.deepEqual([...changes.T4.affected_address_ids].sort(), byState("MA"));
  assert.deepEqual(changes.T5.affected_address_ids, []);
  const lookups = exportLookups(dataset.properties, rules, "2026-10-01").lookups;
  const ma = dataset.properties.filter((p) => p.state === "MA");
  for (const p of ma) {
    const items = lookups[p.id];
    assert.ok(items.some((item) => item.result === "pending"));
    assert.ok(!items.some((item) => rules.find((r) => r.id === item.team_rule_id)!.status === "failed"));
  }
});
