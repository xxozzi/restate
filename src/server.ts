import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Bootstrap, Facts, Rule, SourceDocument, ExtractionReport } from './contracts';
import { loadDataset, describeChange } from './data';
import { extractDocuments, getBudgetStatus } from './extract';
import { evaluateProperty } from './evaluate';
import { computeChange } from './changes';
import { exportChanges, exportLookups, exportRules, validateRules } from './export';

const app = express();
const server = createServer(app);
app.disable('x-powered-by');
app.use(express.json({ limit: '300kb' }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
const dataset = await loadDataset();
const initial = await extractDocuments(dataset.documents, { useModel: false });
let rules = initial.rules;
let extraction: ExtractionReport = initial.report;
const runDir = resolve('runs/current');
await mkdir(runDir, { recursive: true });

// Only validated same-source model results can replace pattern candidates on restart.
try {
  const persisted = JSON.parse(await readFile(resolve(runDir, 'model-results.json'), 'utf8')) as { documents: SourceDocument[]; rules: Rule[] };
  const valid = persisted.rules.filter(rule => {
    const doc = dataset.documents.find(d => d.id === rule.sourceId) || persisted.documents.find(d => d.id === rule.sourceId);
    return doc && doc.text.includes(rule.quotedSpan) && rule.quotedSpan.length >= 20 && rule.extractionMethod === 'model';
  });
  const ids = new Set(valid.map(rule => rule.sourceId));
  rules = [...rules.filter(rule => !ids.has(rule.sourceId)), ...valid];
  for (const doc of persisted.documents) if (!dataset.documents.some(d => d.id === doc.id)) dataset.documents.push(doc);
} catch { /* First startup intentionally has no paid or persisted model run. */ }

const defaultAsOf = '2026-10-01';
function queryDate(value: unknown): string {
  const date = value ?? defaultAsOf;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Enter a valid date in YYYY-MM-DD format.');
  return date;
}
function safeFacts(value: unknown): Facts {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scenario facts must be a JSON object.');
  const facts: Facts = {};
  for (const [field, fact] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,60}$/.test(field) || ['constructor', 'prototype', '__proto__', 'state'].includes(field)) throw new Error('Invalid scenario field.');
    if (fact !== null && typeof fact !== 'string' && typeof fact !== 'number' && typeof fact !== 'boolean') throw new Error('Scenario values must be text, numbers, booleans, or null.');
    if (typeof fact === 'string' && fact.length > 150) throw new Error('Scenario text is too long.');
    if (typeof fact === 'number' && (!Number.isFinite(fact) || fact < 0 || fact > 1_000_000)) throw new Error('Scenario numbers must be finite and nonnegative.');
    facts[field] = fact;
  }
  return facts;
}
function summaryReport(): ExtractionReport {
  return { ...extraction, rulesExtracted: rules.length, quotedRules: rules.filter(rule => dataset.documents.find(doc => doc.id === rule.sourceId)?.text.includes(rule.quotedSpan)).length };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, name: '(R)estate', paidCallsOnStartup: false }));
app.get('/api/budget', async (_req, res) => res.json(await getBudgetStatus()));
app.get('/api/bootstrap', async (_req, res) => {
  const data: Bootstrap = {
    properties: dataset.properties, rules,
    documents: dataset.documents.map(({ text: _text, ...doc }) => doc),
    changes: dataset.changes.map(describeChange), extraction: summaryReport(),
    stats: { addresses: dataset.properties.length, cities: new Set(dataset.properties.map(p => p.city).filter(Boolean)).size, states: new Set(dataset.properties.map(p => p.state)).size, sources: dataset.documents.length, capturedSources: dataset.documents.filter(d => d.text).length, rules: rules.length },
    defaultAddressId: dataset.properties.find(p => p.id === 'A0005')?.id || dataset.properties[0].id,
    defaultAsOf, capabilities: { liveModel: Boolean(process.env.ANTHROPIC_API_KEY), provider: process.env.ANTHROPIC_API_KEY ? 'Anthropic' : null },
  };
  res.json({ ...data, budget: await getBudgetStatus() });
});
app.post('/api/lookup', (req, res) => {
  const property = dataset.properties.find(p => p.id === req.body?.addressId);
  if (!property) { res.status(404).json({ error: 'Choose an address from the supplied sample.' }); return; }
  const report = evaluateProperty(property, rules, queryDate(req.body.asOf), safeFacts(req.body.facts));
  res.json(report);
});
app.get('/api/sources/:id', (req, res) => {
  const doc = dataset.documents.find(d => d.id === req.params.id);
  if (!doc) { res.status(404).json({ error: 'Source not found.' }); return; }
  res.json(doc);
});
app.get('/api/changes/:id', (req, res) => {
  const change = dataset.changes.find(c => c.test_id === req.params.id);
  if (!change) { res.status(404).json({ error: 'Change case not found.' }); return; }
  res.json(computeChange(change, dataset.properties, rules));
});
app.get('/api/export/:kind', async (req, res) => {
  const asOf = queryDate(req.query.asOf);
  const kind = req.params.kind;
  let output: unknown;
  if (kind === 'rules') {
    const validation = validateRules(rules, asOf, dataset.schema);
    if (validation.errors.length) { res.status(422).json({ error: 'Rule validation failed; export withheld.', validation }); return; }
    const records = exportRules(rules, asOf);
    output = req.query.envelope === 'template' ? { rules: records } : records;
  } else if (kind === 'lookups') output = exportLookups(dataset.properties, rules, asOf);
  else if (kind === 'changes') output = exportChanges(dataset.changes, dataset.properties, rules);
  else { res.status(404).json({ error: 'Unknown export.' }); return; }
  const serialized = JSON.stringify(output, null, 2);
  await writeFile(resolve(runDir, `${kind}.json`), serialized + '\n');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}.json"`);
  res.type('json').send(serialized);
});
app.get('/api/validation', (_req, res) => res.json({
  schema: validateRules(rules, defaultAsOf, dataset.schema),
  citationPresence: { checked: rules.length, passed: rules.filter(r => dataset.documents.find(d => d.id === r.sourceId)?.text.includes(r.quotedSpan)).length },
  jurisdiction: { total: dataset.properties.length, resolved: dataset.properties.filter(p => p.city).length },
  independentlyReviewedAccuracy: null,
  note: 'Team-created structural and provenance checks, not an official score or legal-accuracy certification.',
}));
let extractionInProgress = false;
app.post('/api/extract', async (req, res) => {
  if (extractionInProgress) { res.status(409).json({ error: 'An extraction is already running. Please wait for it to finish.' }); return; }
  let doc = typeof req.body?.sourceId === 'string' ? dataset.documents.find(d => d.id === req.body.sourceId) : undefined;
  if (!doc) {
    const { title, text, url = '', jurisdiction = '', state = '' } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || typeof text !== 'string' || text.trim().length < 40 || text.length > 180_000) { res.status(400).json({ error: 'Provide a title and between 40 and 180,000 characters of source text.' }); return; }
    if (typeof jurisdiction !== 'string' || !jurisdiction.trim()) { res.status(400).json({ error: 'Provide the source jurisdiction, such as CA or Berkeley, CA.' }); return; }
    if (typeof url !== 'string' || (url && !/^https?:\/\//.test(url))) { res.status(400).json({ error: 'Use an http(s) source URL or leave it empty.' }); return; }
    const sha256 = createHash('sha256').update(text).digest('hex');
    doc = { id: `import-${sha256.slice(0, 12)}`, title: title.trim().slice(0, 180), jurisdiction: jurisdiction.includes(',') || /^(CA|NJ|MA)$/.test(jurisdiction) ? jurisdiction : `${jurisdiction}, ${state}`, url, text, sha256, retrievedAt: new Date().toISOString(), captureStatus: 'user-provided-public-text', filename: '' };
  }
  if (!doc.text) { res.status(422).json({ error: 'This source has no captured text. Supply its permitted public text before extraction.' }); return; }
  const useModel = req.body.useModel !== false && Boolean(process.env.ANTHROPIC_API_KEY);
  extractionInProgress = true;
  try {
    const result = await extractDocuments([doc], { useModel });
    if (!result.rules.length) { res.status(422).json({ error: 'No supported rules were extracted. Existing rules have been retained.', report: result.report }); return; }
    const validation = validateRules(result.rules, defaultAsOf, dataset.schema);
    if (validation.errors.length) { res.status(422).json({ error: 'Extracted candidates failed the organizer schema. Existing rules have been retained.', validation }); return; }
    rules = [...rules.filter(rule => rule.sourceId !== doc!.id), ...result.rules];
    if (!dataset.documents.some(source => source.id === doc!.id)) dataset.documents.push(doc);
    extraction = result.report;
    await writeFile(resolve(runDir, 'model-results.json'), JSON.stringify({ documents: dataset.documents.filter(d => d.id.startsWith('import-')), rules: rules.filter(r => r.extractionMethod === 'model') }, null, 2));
    res.json({ ...result, budget: await getBudgetStatus() });
  } finally { extractionInProgress = false; }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: error.message || 'The request could not be completed.' });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 5173);
server.listen(port, '127.0.0.1', () => console.log(`(R)estate · http://127.0.0.1:${port} · ${dataset.properties.length} addresses · ${rules.length} candidate rules · no paid startup calls`));
