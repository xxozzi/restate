/**
 * Paid, cached extraction over the corpus.  npm run extract [-- D024 D069 ...]
 * Every response is cached by exact text, so a rerun only pays for documents that changed.
 * --force D079 D027 re-asks those documents with the current prompt.
 */
import "dotenv/config";
import { loadDataset } from "./data";
import { extractDocuments, getBudgetStatus } from "./extract";

const dataset = await loadDataset();
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const documents = only.length
  ? dataset.documents.filter((doc) => only.includes(doc.id))
  : dataset.documents;
const before = await getBudgetStatus();
console.log(`Budget: $${before.spent.toFixed(4)} spent of $${before.limit} cap.`);
const { rules, report } = await extractDocuments(documents, {
  paid: true,
  force: process.argv.includes("--force") ? only : [],
  concurrency: Number(process.env.EXTRACT_CONCURRENCY || 4),
  onProgress: (message) => console.log(message),
});
const after = await getBudgetStatus();
console.log(
  `\n${rules.length} rules from ${report.documentsProcessed}/${report.documentsWithText} documents. ` +
    `This run cost $${(after.spent - before.spent).toFixed(4)}; total $${after.spent.toFixed(4)} of $${after.limit}.`,
);
if (report.pendingDocuments.length)
  console.log(`Not extracted: ${report.pendingDocuments.join(", ")}`);
const rejected = report.warnings.filter((warning) => /Candidate \d+/.test(warning));
if (rejected.length) console.log(`\n${rejected.length} candidate notes:\n${rejected.slice(0, 40).join("\n")}`);
