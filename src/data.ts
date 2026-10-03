import { readFile, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { ChangeCase, PropertyRecord, SourceDocument } from './contracts';
import { loadGeography, resolveJurisdiction } from './geography';

export interface OfficialChange {
  test_id: string; title: string; type: 'as_of' | 'boundary' | 'pending' | 'negative';
  rule_ids: string[]; as_of?: string; as_of_before?: string; as_of_after?: string;
  states?: string[]; conflict_with?: string[]; expected_behavior: string;
}
export interface Dataset { properties: PropertyRecord[]; documents: SourceDocument[]; changes: OfficialChange[]; schema: Record<string, unknown> }

function numeric(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function loadDataset(root = process.cwd()): Promise<Dataset> {
  const starter = resolve(root, 'sources/starter');
  await access(resolve(starter, 'data/sample_addresses.csv'));
  await loadGeography(root);
  const rows = parse(await readFile(resolve(starter, 'data/sample_addresses.csv'), 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const properties = rows.map(row => {
    const geography = resolveJurisdiction(row);
    return {
      id: row.address_id, address: row.street_address, postalCity: row.postal_city,
      city: geography.city, state: row.state, zip: row.zip,
      facts: { units: numeric(row.units), year_built: numeric(row.year_built), use_code: row.use_code || null, use_description: row.use_description || null, owner_occupied: null, owner_type: null, certificate_of_occupancy: null, tenancy_months: null, original_lease_expired: null, affordable_housing: null, state: row.state },
      source: row.source_dataset, retrievedAt: row.retrieved_at, jurisdictionMethod: geography.method,
    } satisfies PropertyRecord;
  });
  const manifest = parse(await readFile(resolve(starter, 'corpus/corpus_manifest.csv'), 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const documents = await Promise.all(manifest.map(async row => {
    let text = '';
    if (row.text_file) {
      const path = resolve(starter, 'corpus', row.text_file);
      if (!path.startsWith(resolve(starter, 'corpus') + '/')) throw new Error('Invalid corpus path');
      try { text = await readFile(path, 'utf8'); } catch { /* Missing captured sources remain explicit. */ }
    }
    const titleLine = text.split('\n').map(line => line.trim()).find(line => line && !/^(SOURCE:|RETRIEVED:|Skip to|Quick Links:)/i.test(line));
    let fallbackTitle = row.doc_id;
    try { fallbackTitle = decodeURIComponent(new URL(row.url).pathname.split('/').filter(Boolean).pop() || row.doc_id).replace(/[-_]/g, ' '); } catch { /* Keep source ID if upstream URL is malformed. */ }
    return {
      id: row.doc_id, title: (titleLine || fallbackTitle).slice(0, 180), jurisdiction: row.jurisdictions,
      url: row.url, retrievedAt: row.retrieved_at || '', text,
      sha256: text ? createHash('sha256').update(text).digest('hex') : '',
      captureStatus: text ? 'captured' : row.capture === 'yes' ? 'capture_missing' : row.capture,
      filename: row.text_file ? basename(row.text_file) : '',
    } satisfies SourceDocument;
  }));
  const catalog = JSON.parse(await readFile(resolve(root, 'sources/catalog.json'), 'utf8')) as { sources: { kind: string; path: string; application_id?: string; title: string; jurisdiction?: string; source_url: string; retrieved_at?: string }[] };
  for (const entry of catalog.sources.filter(item => item.kind === 'supplemental-text' && item.application_id)) {
    const text = await readFile(resolve(root, entry.path), 'utf8');
    documents.push({ id: entry.application_id!, title: entry.title, jurisdiction: entry.jurisdiction || '', url: entry.source_url, retrievedAt: entry.retrieved_at || '', text, sha256: createHash('sha256').update(text).digest('hex'), captureStatus: 'supplemental public source', filename: basename(entry.path) });
  }
  return {
    properties, documents,
    changes: JSON.parse(await readFile(resolve(starter, 'dev/change_tests.json'), 'utf8')),
    schema: JSON.parse(await readFile(resolve(starter, 'schema/rule_record.schema.json'), 'utf8')),
  };
}

export function describeChange(test: OfficialChange): ChangeCase {
  return { id: test.test_id, title: test.title, description: test.expected_behavior,
    beforeDate: test.as_of_before || test.as_of || '2026-10-01',
    afterDate: test.as_of_after || test.as_of || '2026-10-01',
    status: test.type === 'pending' ? 'Hypothetical enactment' : test.type === 'negative' ? 'Failed proposal' : test.type === 'boundary' ? 'Jurisdiction boundary' : 'Effective-date change',
  };
}
