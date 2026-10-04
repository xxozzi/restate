/** Writes the three submission files (and a validation summary) to submission/. Free: uses cached extraction. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadDataset } from "./data";
import { extractDocuments, DEFAULT_AS_OF } from "./extract";
import { exportChanges, exportLookups, exportRules, validateRules } from "./export";

const dataset = await loadDataset();
const { rules, report } = await extractDocuments(dataset.documents);
const out = resolve("submission");
await mkdir(out, { recursive: true });
const write = (name: string, value: unknown) => writeFile(resolve(out, name), JSON.stringify(value, null, 2) + "\n");

const schema = validateRules(rules, DEFAULT_AS_OF, dataset.schema);
if (schema.errors.length) {
  console.error(JSON.stringify(schema.errors, null, 2));
  throw new Error(`${schema.errors.length} rule(s) fail the organizer schema; nothing written.`);
}
const lookups = exportLookups(dataset.properties, rules, DEFAULT_AS_OF);
const changes = exportChanges(dataset.changes, dataset.properties, rules);
await write("rules.json", exportRules(rules, DEFAULT_AS_OF));
await write("lookups.json", lookups);
await write("changes.json", changes);

const counts: Record<string, number> = {};
for (const items of Object.values(lookups.lookups)) for (const item of items) counts[item.result] = (counts[item.result] ?? 0) + 1;
const summary = {
  createdAt: new Date().toISOString(),
  asOf: DEFAULT_AS_OF,
  model: report.model,
  rules: rules.length,
  documentsWithRules: report.documentsProcessed,
  documentsWithText: report.documentsWithText,
  documentsNotExtracted: report.pendingDocuments,
  schemaValid: `${schema.passed}/${schema.checked}`,
  quotesVerbatim: `${report.quotedRules}/${rules.length}`,
  addresses: dataset.properties.length,
  addressesWithCity: dataset.properties.filter((p) => p.city).length,
  lookupResults: counts,
  changeTests: Object.fromEntries(
    Object.entries(changes).map(([id, value]) => [id, { affected: value.affected_address_ids.length, conflicts: value.conflict_flag_address_ids.length }]),
  ),
};
await write("validation.json", summary);
console.log(JSON.stringify(summary, null, 2));
