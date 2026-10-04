import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Bootstrap, ExtractionReport, Facts, Rule, SourceDocument } from "./contracts";
import { loadDataset, describeChange } from "./data";
import { extractDocuments, getBudgetStatus, DEFAULT_AS_OF } from "./extract";
import { evaluateProperty } from "./evaluate";
import { computeChange } from "./changes";
import { exportChanges, exportEvidenceFixtures, exportLookups, exportRules, validateRules } from "./export";
import { isField } from "./facts";
import { GeocodeError, geocodeAddress, matchSample } from "./geocode";
import type { PropertyRecord } from "./contracts";

const app = express();
const server = createServer(app);
app.disable("x-powered-by");
app.use(express.json({ limit: "400kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const dataset = await loadDataset();
const importsPath = resolve("runs/imports.json");
try {
  // Sources added through the app are kept so their cached extraction replays after a restart.
  const imported = JSON.parse(await readFile(importsPath, "utf8")) as SourceDocument[];
  for (const doc of imported) if (!dataset.documents.some((d) => d.id === doc.id)) dataset.documents.push(doc);
} catch {
  /* No imported sources yet. */
}
// Startup never pays: rules are rebuilt from cached, previously validated model responses.
let { rules, report: extraction } = await extractDocuments(dataset.documents);

function queryDate(value: unknown): string {
  const date = value ?? DEFAULT_AS_OF;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    throw new Error("Use a date in YYYY-MM-DD format.");
  return date;
}
function scenarioFacts(value: unknown): Facts {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Scenario facts must be an object.");
  const facts: Facts = {};
  for (const [field, fact] of Object.entries(value)) {
    if (!isField(field) && field !== "legal_city") throw new Error(`Unknown fact: ${field}`);
    if (fact !== null && !["string", "number", "boolean"].includes(typeof fact)) throw new Error("Facts must be text, numbers or yes/no.");
    if (typeof fact === "string" && fact.length > 80) throw new Error("Fact text is too long.");
    if (typeof fact === "number" && (!Number.isFinite(fact) || fact < 0 || fact > 100_000)) throw new Error("Fact number out of range.");
    facts[field] = fact as Facts[string];
  }
  return facts;
}
// Addresses typed by users live only in memory; they are never part of the graded sample or exports.
const entered = new Map<string, PropertyRecord>();
const property = (id: unknown) => dataset.properties.find((p) => p.id === id) ?? entered.get(String(id));

app.post("/api/geocode", async (req, res) => {
  try {
    const found = await geocodeAddress(String(req.body?.address ?? ""));
    const sample = matchSample(found, dataset.properties);
    if (sample) {
      res.json(sample);
      return;
    }
    entered.set(found.id, found);
    res.json(found);
  } catch (error) {
    res.status(error instanceof GeocodeError ? error.status : 500).json({ error: (error as Error).message });
  }
});
app.get("/api/properties/:id", (req, res) => {
  const found = property(req.params.id);
  if (!found) res.status(404).json({ error: "Unknown address." });
  else res.json(found);
});

app.get("/api/bootstrap", async (_req, res) => {
  const counts = new Map<string, number>();
  for (const rule of rules) for (const id of [rule.sourceId, ...rule.alsoIn]) counts.set(id, (counts.get(id) ?? 0) + 1);
  const data: Bootstrap = {
    properties: dataset.properties,
    rules,
    documents: dataset.documents.map(({ text: _text, ...doc }) => ({ ...doc, ruleCount: counts.get(doc.id) ?? 0 })),
    changes: dataset.changes.map(describeChange),
    extraction,
    stats: {
      addresses: dataset.properties.length,
      resolvedAddresses: dataset.properties.filter((p) => p.city).length,
      cities: new Set(dataset.properties.map((p) => p.city).filter(Boolean)).size,
      states: new Set(dataset.properties.map((p) => p.state)).size,
      sources: dataset.documents.length,
      capturedSources: dataset.documents.filter((d) => d.text).length,
      rules: rules.length,
    },
    defaultAddressId:
      dataset.properties.find((p) => p.city === "Berkeley")?.id ?? dataset.properties[0].id,
    defaultAsOf: DEFAULT_AS_OF,
    liveModel: Boolean(process.env.ANTHROPIC_API_KEY),
    budget: await getBudgetStatus(),
  };
  res.json(data);
});

app.post("/api/lookup", (req, res) => {
  const found = property(req.body?.addressId);
  if (!found) {
    res.status(404).json({ error: "Pick an address from the sample." });
    return;
  }
  res.json(evaluateProperty(found, rules, queryDate(req.body.asOf), scenarioFacts(req.body.facts)));
});

app.post("/api/fixtures", (req, res) => {
  const found = property(req.body?.addressId);
  if (!found) {
    res.status(404).json({ error: "Pick an address from the sample." });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="fixtures-${found.id}.json"`);
  res.json(exportEvidenceFixtures(found, rules, queryDate(req.body.asOf), scenarioFacts(req.body.facts)));
});

app.get("/api/sources/:id", (req, res) => {
  const doc = dataset.documents.find((d) => d.id === req.params.id);
  if (!doc) res.status(404).json({ error: "Source not found." });
  else res.json(doc);
});

app.get("/api/changes/:id", (req, res) => {
  const test = dataset.changes.find((c) => c.test_id === req.params.id);
  if (!test) res.status(404).json({ error: "Change test not found." });
  else res.json(computeChange(test, dataset.properties, rules));
});

app.get("/api/export/:kind", (req, res) => {
  const asOf = queryDate(req.query.asOf);
  const output =
    req.params.kind === "rules"
      ? exportRules(rules, asOf)
      : req.params.kind === "lookups"
        ? exportLookups(dataset.properties, rules, asOf)
        : req.params.kind === "changes"
          ? exportChanges(dataset.changes, dataset.properties, rules)
          : null;
  if (!output) {
    res.status(404).json({ error: "Unknown export." });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.kind}.json"`);
  res.type("json").send(JSON.stringify(output, null, 2));
});

app.get("/api/validation", (_req, res) =>
  res.json({
    schema: validateRules(rules, DEFAULT_AS_OF, dataset.schema),
    quotes: {
      checked: rules.length,
      verbatim: rules.filter((r) => dataset.documents.find((d) => d.id === r.sourceId)?.text.includes(r.quotedSpan)).length,
    },
    addresses: { total: dataset.properties.length, cityResolved: dataset.properties.filter((p) => p.city).length },
  }),
);

let extracting = false;
/** Paste a new law and watch it become rules. This is the one endpoint that can spend money. */
app.post("/api/extract", async (req, res) => {
  if (extracting) {
    res.status(409).json({ error: "An extraction is already running." });
    return;
  }
  const { title, text, url = "", jurisdiction } = req.body ?? {};
  if (typeof title !== "string" || !title.trim() || typeof text !== "string" || text.trim().length < 80 || text.length > 120_000) {
    res.status(400).json({ error: "Give the source a title and paste between 80 and 120,000 characters of text." });
    return;
  }
  if (typeof jurisdiction !== "string" || !/^(CA|NJ|MA)$|^[A-Za-z .'-]+, (CA|NJ|MA)$/.test(jurisdiction.trim())) {
    res.status(400).json({ error: "Jurisdiction must be CA, NJ, MA, or “City, ST”." });
    return;
  }
  if (typeof url !== "string" || (url && !/^https?:\/\//.test(url))) {
    res.status(400).json({ error: "The source link must start with http:// or https://." });
    return;
  }
  const sha256 = createHash("sha256").update(text).digest("hex");
  const doc: SourceDocument = {
    id: `NEW-${sha256.slice(0, 6).toUpperCase()}`,
    title: title.trim().slice(0, 140),
    jurisdiction: jurisdiction.trim(),
    url,
    text,
    sha256,
    retrievedAt: new Date().toISOString(),
    captureStatus: "added",
    filename: "",
  };
  extracting = true;
  try {
    const result = await extractDocuments([doc], { paid: true });
    if (!result.rules.length) {
      res.status(422).json({ error: result.report.warnings[0] ?? "No rules were found in that text.", report: result.report });
      return;
    }
    if (!dataset.documents.some((d) => d.id === doc.id)) {
      dataset.documents.push(doc);
      await mkdir("runs", { recursive: true });
      await writeFile(importsPath, JSON.stringify(dataset.documents.filter((d) => d.captureStatus === "added"), null, 1));
    }
    const rebuilt = await extractDocuments(dataset.documents);
    rules = rebuilt.rules;
    extraction = rebuilt.report;
    res.json({
      document: { id: doc.id, title: doc.title },
      rules: rules.filter((rule) => rule.sourceId === doc.id || rule.alsoIn.includes(doc.id)),
      budget: await getBudgetStatus(),
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Extraction failed." });
  } finally {
    extracting = false;
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: error.message || "The request could not be completed." });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer: createVite } = await import("vite");
  const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 5173);
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`(R)estate · http://localhost:${port} · ${dataset.properties.length} addresses · ${rules.length} rules (from cache, no paid calls)`),
);
