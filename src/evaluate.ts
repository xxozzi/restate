import type { EvidenceQuestion, FactValue, Facts, LookupReport, Outcome, Predicate, PropertyRecord, Rule, RuleResult, TraceStep } from './contracts.js';

type PredicateResult = { value: true | false | null; missingFacts: string[]; trace: TraceStep[] };
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const text = (value: unknown): string => String(value ?? '').trim();
const normalized = (value: unknown): string => text(value).toLocaleLowerCase('en-US');
const labelFor = (field: string): string => ({ units: 'Unit count', year_built: 'Construction year', legal_city: 'Legal municipality', owner_type: 'Owner type', owner_occupied: 'Owner occupancy', certificate_of_occupancy_date: 'Certificate of occupancy date', certificate_date: 'Certificate of occupancy date' }[field] ?? field.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));
const step = (label: string, detail: string, value: boolean | null): TraceStep => ({ label, detail, outcome: value === null ? 'unknown' : value ? 'pass' : 'fail' });
const same = (left: FactValue, right: FactValue): boolean => typeof left === 'string' && typeof right === 'string' ? normalized(left) === normalized(right) : left === right;
const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** Three-valued logic: a decisive false AND / true OR removes irrelevant missing facts. */
export function evaluatePredicate(predicate: Predicate, facts: Facts): PredicateResult {
  if (predicate.op === 'always') return { value: true, missingFacts: [], trace: [step('Coverage', 'No additional property condition was extracted.', true)] };
  if (predicate.op === 'unknown') return { value: null, missingFacts: [], trace: [step('Unresolved interpretation', predicate.reason, null)] };
  if (predicate.op === 'not') {
    const inner = evaluatePredicate(predicate.arg, facts);
    const value = inner.value === null ? null : !inner.value;
    return { ...inner, value, trace: [...inner.trace, step('Negated condition', value === null ? 'The underlying condition remains unresolved.' : `The underlying condition is ${inner.value}; its negation is ${value}.`, value)] };
  }
  if (predicate.op === 'all' || predicate.op === 'any') {
    const results: PredicateResult[] = [];
    const decisive = predicate.op === 'all' ? false : true;
    for (const argument of predicate.args) {
      const result = evaluatePredicate(argument, facts);
      results.push(result);
      if (result.value === decisive) return { value: decisive, missingFacts: [], trace: [...results.flatMap(item => item.trace), step('Combined coverage', predicate.op === 'all' ? 'One required condition is false; other missing facts cannot change this conclusion.' : 'One sufficient condition is true; other missing facts cannot change this conclusion.', decisive)] };
    }
    const unresolved = results.some(item => item.value === null);
    return { value: unresolved ? null : !decisive, missingFacts: unresolved ? unique(results.flatMap(item => item.missingFacts)) : [], trace: results.flatMap(item => item.trace) };
  }
  if (!('field' in predicate)) return { value: null, missingFacts: [], trace: [step('Unsupported condition', 'This condition needs interpretation review.', null)] };
  const actual = facts[predicate.field];
  const label = labelFor(predicate.field);
  if (actual === null || actual === undefined || (typeof actual === 'string' && !actual.trim())) return { value: null, missingFacts: [predicate.field], trace: [step(label, `${label} is missing; it has not been treated as zero, false, or an exemption.`, null)] };
  let value: boolean;
  if (predicate.op === 'in') {
    if (!predicate.value.some(option => typeof option === typeof actual)) return { value: null, missingFacts: [predicate.field], trace: [step(label, `Recorded value ${JSON.stringify(actual)} has the wrong type for this condition.`, null)] };
    value = predicate.value.some(option => same(actual, option));
  } else {
    if (typeof actual !== typeof predicate.value || (typeof actual === 'number' && !Number.isFinite(actual))) return { value: null, missingFacts: [predicate.field], trace: [step(label, `Recorded value ${JSON.stringify(actual)} has the wrong type for this condition.`, null)] };
    if (predicate.op === 'eq' || predicate.op === 'neq') value = predicate.op === 'eq' ? same(actual, predicate.value) : !same(actual, predicate.value);
    else if (typeof actual === 'number' && typeof predicate.value === 'number') value = compare(actual, predicate.op, predicate.value);
    else if (typeof actual === 'string' && typeof predicate.value === 'string' && exactDate(actual) && exactDate(predicate.value)) value = compare(actual, predicate.op, predicate.value);
    else return { value: null, missingFacts: [], trace: [step(label, 'Ordered comparisons require finite numbers or complete ISO calendar dates. This condition needs interpretation review.', null)] };
  }
  return { value, missingFacts: [], trace: [step(label, `${JSON.stringify(actual)} ${predicate.op} ${JSON.stringify(predicate.value)} → ${value ? 'satisfied' : 'not satisfied'}.`, value)] };
}

function compare(left: number | string, op: 'gte' | 'gt' | 'lte' | 'lt', right: number | string): boolean {
  if (op === 'gte') return left >= right;
  if (op === 'gt') return left > right;
  if (op === 'lte') return left <= right;
  return left < right;
}

function exactDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dateBounds(value: string | null | undefined): [string, string] | null {
  if (!value) return null;
  if (exactDate(value)) return [value, value];
  if (/^\d{4}$/.test(value)) return [`${value}-01-01`, `${value}-12-31`];
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return [`${value}-01`, last];
  }
  return null;
}

function stateCode(value: string): string {
  return ({ california: 'ca', 'new jersey': 'nj', massachusetts: 'ma' }[normalized(value)] ?? normalized(value));
}

function cityName(value: string): string {
  return normalized(value).replace(/^city of\s+/, '').replace(/,\s*(ca|nj|ma|california|new jersey|massachusetts)$/, '');
}

function sourceTrace(rule: Rule): TraceStep[] {
  return [step('Source record', rule.quotedSpan.trim() ? `A quotation is recorded at offset ${rule.quoteStart}. Presence of a quotation does not establish that it supports the interpretation. ${rule.extractionMethod === 'pattern' ? 'Extracted with limited pattern matching.' : 'Extracted by a language model.'} Interpretation requires review.` : 'No supporting quotation was recorded; source support is unresolved.', rule.quotedSpan.trim() ? true : null), ...rule.warnings.map(warning => step('Extraction limitation', warning, null))];
}

/** Evaluate one extracted rule; scope and status are separate from source interpretation. */
export function evaluateRule(rule: Rule, property: PropertyRecord, asOf: string, facts?: Facts): RuleResult {
  const values = { ...property.facts, ...(facts ?? {}) };
  const trace: TraceStep[] = [];
  const finish = (result: Outcome, explanation: string, missingFacts: string[] = []): RuleResult => ({ ruleId: rule.id, result, explanation, conflictFlag: false, missingFacts: unique(missingFacts), trace: [...trace, ...sourceTrace(rule)] });
  if (stateCode(rule.state) !== stateCode(property.state)) return finish('does_not_apply', 'The property is outside this rule’s state jurisdiction.');
  trace.push(step('State jurisdiction', `${property.state} matches ${rule.state}.`, true));
  if (rule.status === 'failed') return finish('does_not_apply', 'This proposal failed; it creates no operative requirement.');

  const city = has(values, 'legal_city') ? typeof values.legal_city === 'string' && values.legal_city.trim() ? values.legal_city : null : property.city;
  let missingCity = false;
  if (rule.level === 'city') {
    if (!city) {
      missingCity = true;
      trace.push(step('Legal municipality', 'The legal municipality is unresolved. Mailing city has not been substituted.', null));
    } else if (cityName(city) !== cityName(rule.jurisdiction)) return finish('does_not_apply', `The resolved legal municipality (${city}) is outside ${rule.jurisdiction}.`);
    else trace.push(step('Legal municipality', `${city} matches ${rule.jurisdiction}${has(values, 'legal_city') ? ' in this hypothetical scenario' : ''}.`, true));
  }

  const coverage = evaluatePredicate(rule.coverage, values);
  trace.push(...coverage.trace);
  if (coverage.value === false) return finish('does_not_apply', 'A required coverage condition is not satisfied.');
  if (missingCity) return finish('unknown', 'Confirm the legal municipality before applying this city rule; the mailing address alone does not establish jurisdiction.', ['legal_city', ...coverage.missingFacts]);
  if (rule.status === 'pending') {
    trace.push(step('Legislative status', 'Pending proposal. Advancing the query date does not enact legislation.', null));
    return finish('pending', `This proposal remains pending and is not treated as an enacted obligation.${coverage.value === null ? ' Property coverage is also unresolved.' : ''}`, coverage.missingFacts);
  }
  if (!exactDate(asOf)) return finish('unknown', 'A valid complete as-of date (YYYY-MM-DD) is required.', coverage.missingFacts);
  const start = dateBounds(rule.effectiveDate);
  const end = dateBounds(rule.endDate);
  if (rule.endDate && !end) return finish('unknown', 'The recorded end date cannot be interpreted reliably.', coverage.missingFacts);
  if (end && asOf > end[1]) return finish('does_not_apply', `The recorded rule period ended by ${end[1]}.`);
  if (end && asOf >= end[0] && end[0] !== end[1]) return finish('unknown', `The partial end date (${rule.endDate}) does not establish whether the rule was still in effect on ${asOf}.`, coverage.missingFacts);
  if (!start) return finish('unknown', 'The effective date is missing or unsupported; temporal applicability needs source review.', coverage.missingFacts);
  if (asOf < start[0]) {
    trace.push(step('Effective date', `The earliest supported effective date is ${start[0]}; the query date is ${asOf}.`, false));
    return finish('not_yet_effective', `The enacted rule is not yet effective on ${asOf}.${coverage.value === null ? ' Property coverage is also unresolved.' : ''}`, coverage.missingFacts);
  }
  if (asOf < start[1]) return finish('unknown', `The partial effective date (${rule.effectiveDate}) does not resolve applicability on ${asOf}.`, coverage.missingFacts);
  trace.push(step('Effective date', `The effective-date condition is satisfied on ${asOf}.`, true));
  if (!rule.quotedSpan.trim() || rule.quoteStart < 0) return finish('unknown', 'No located supporting quotation is available; this interpretation needs source review.', coverage.missingFacts);
  if (coverage.value === null) return finish('unknown', coverage.missingFacts.length ? `Coverage depends on missing or unusable evidence: ${coverage.missingFacts.map(labelFor).join(', ')}.` : 'The extracted coverage condition requires interpretation review.', coverage.missingFacts);
  return finish('applies', 'The extracted coverage, legal-jurisdiction, and effective-date conditions are satisfied. Source interpretation remains subject to review.');
}

function applyInteractions(rules: Rule[], results: RuleResult[]): RuleResult[] {
  const byId = new Map(results.map(result => [result.ruleId, result]));
  const applicable = new Map(rules.filter(rule => byId.get(rule.id)?.result === 'applies').map(rule => [rule.id, rule]));
  const reaches = (from: string, target: string, visited = new Set<string>()): boolean => {
    if (visited.has(from)) return false;
    visited.add(from);
    return (applicable.get(from)?.supersedes ?? []).some(id => id === target || reaches(id, target, visited));
  };
  for (const rule of applicable.values()) {
    for (const id of rule.supersedes ?? []) {
      if (!applicable.has(id) || id === rule.id) continue;
      const previous = byId.get(id)!;
      if (reaches(id, rule.id)) {
        previous.conflictFlag = true;
        byId.get(rule.id)!.conflictFlag = true;
        previous.trace.push(step('Declared precedence conflict', 'The extracted supersession declarations form a cycle and need review.', null));
      } else {
        previous.result = 'superseded';
        previous.explanation = `An explicit extracted declaration says ${rule.title} (${rule.id}) supersedes this rule within the evaluated scope. The declaration requires source review.`;
        previous.trace.push(step('Declared supersession', `${rule.id} is applicable and explicitly names ${id}.`, true));
      }
    }
  }
  for (const rule of applicable.values()) {
    if (byId.get(rule.id)?.result !== 'applies') continue;
    for (const id of rule.conflictsWith ?? []) {
      if (id === rule.id || byId.get(id)?.result !== 'applies') continue;
      for (const result of [byId.get(rule.id)!, byId.get(id)!]) {
        result.conflictFlag = true;
        result.trace.push(step('Declared conflict', `The extracted rules ${rule.id} and ${id} explicitly conflict and both apply to this scenario; no general local-over-state precedence is assumed.`, null));
      }
    }
  }
  return results;
}

const evidenceFor = (field: string): string => {
  if (field === 'legal_city') return 'Confirm the parcel against an authoritative municipal boundary or assessor record; a mailing city is insufficient.';
  if (field === 'units') return 'Check the assessor’s property record, approved unit schedule, or permit record for the relevant building.';
  if (field === 'year_built') return 'Check the construction record. If the law uses occupancy dates, a construction year alone does not establish the exact date.';
  if (/occupancy|certificate/.test(field)) return 'Obtain the dated certificate of occupancy or the relevant official occupancy record.';
  if (/owner/.test(field)) return 'Check ownership/entity records and evidence of the particular ownership or occupancy condition; the sample does not establish these facts.';
  return 'Obtain a dated authoritative record supporting this fact; record its source separately from the original sample.';
};

function nextDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function candidates(predicate: Predicate, field: string): FactValue[] {
  if (predicate.op === 'all' || predicate.op === 'any') return predicate.args.flatMap(argument => candidates(argument, field));
  if (predicate.op === 'not') return candidates(predicate.arg, field);
  if (!('field' in predicate) || predicate.field !== field) return [];
  if (predicate.op === 'in') return predicate.value.slice(0, 4);
  const value = predicate.value;
  if (typeof value === 'boolean') return [value, !value];
  if (typeof value === 'number') {
    const increment = Number.isInteger(value) ? 1 : Math.pow(10, -Math.min(6, (String(value).split('.')[1] ?? '').length));
    return [value - increment, value, value + increment].filter(number => Number.isFinite(number) && (!(field === 'units' || field === 'year_built') || number >= 0));
  }
  if (exactDate(value)) return [nextDate(value, -1), value, nextDate(value, 1)];
  return [value];
}

function evaluateAll(property: PropertyRecord, rules: Rule[], asOf: string, facts: Facts): RuleResult[] {
  return applyInteractions(rules, rules.map(rule => evaluateRule(rule, property, asOf, facts)));
}

function evidenceQuestions(property: PropertyRecord, rules: Rule[], asOf: string, facts: Facts, results: RuleResult[]): EvidenceQuestion[] {
  const fields = unique(results.filter(result => result.result === 'unknown').flatMap(result => result.missingFacts));
  return fields.map<EvidenceQuestion>(field => {
    const relevant = rules.filter(rule => results.some(result => result.ruleId === rule.id && result.result === 'unknown' && result.missingFacts.includes(field)));
    const possible = unique(relevant.flatMap(rule => field === 'legal_city' ? [rule.jurisdiction] : candidates(rule.coverage, field))).slice(0, 12);
    const examined = possible.map(value => {
      const evaluated = evaluateAll(property, rules, asOf, { ...facts, [field]: value });
      const affected = relevant.map(rule => evaluated.find(result => result.ruleId === rule.id)!);
      return { value, affected, signature: affected.map(result => result.result).join('|') };
    });
    // Keep a bounded set of distinct outcome patterns, including unresolved completions.
    const selected = examined.filter((item, index) => examined.findIndex(other => other.signature === item.signature) === index).slice(0, 4);
    if (selected.length === 1 && examined.length > 1) selected.push(examined.find(item => !same(item.value, selected[0].value))!);
    const branches = selected.map(item => {
      const outcomes = unique(item.affected.map(result => result.result));
      const result: Outcome = outcomes.length === 1 ? outcomes[0] : outcomes.includes('unknown') ? 'unknown' : outcomes.includes('applies') ? 'applies' : outcomes[0];
      return { label: `${labelFor(field)}: ${String(item.value)}`, value: item.value, result, explanation: item.affected.map(outcome => `${relevant.find(rule => rule.id === outcome.ruleId)!.title}: ${outcome.result.replace(/_/g, ' ')}. ${outcome.explanation}`).join(' ') };
    });
    return {
      id: `evidence:${property.id}:${field}`,
      field,
      label: labelFor(field),
      question: `What is the supported ${labelFor(field).toLowerCase()} for this property?`,
      why: `This fact participates in ${relevant.length} unresolved ${relevant.length === 1 ? 'rule' : 'rules'}.${branches.some(branch => branch.result === 'unknown') ? ' Other missing facts or interpretation gaps may still prevent a conclusion after it is supplied.' : ''} These bounded examples are suggestions, not a proven minimal evidence set.`,
      ruleIds: relevant.map(rule => rule.id),
      suggestedEvidence: evidenceFor(field),
      branches,
      hypothetical: true,
      minimality: 'suggested',
    };
  }).sort((left, right) => right.ruleIds.length - left.ruleIds.length || left.field.localeCompare(right.field));
}

/** Original property records are never modified; overlays represent explicit scenarios. */
export function evaluateProperty(property: PropertyRecord, rules: Rule[], asOf: string, scenarioFacts: Facts = {}): LookupReport {
  const facts = { ...property.facts, ...scenarioFacts };
  const results = evaluateAll(property, rules, asOf, facts);
  return {
    property,
    asOf,
    results,
    questions: evidenceQuestions(property, rules, asOf, facts, results),
    scenarioFacts: { ...scenarioFacts },
    scenario: Object.keys(scenarioFacts).length > 0,
    coverageNote: 'Results apply only to the supplied, extracted rule collection and recorded property facts. Missing rules or source captures are not proof that no protection applies. Quotations and automated interpretations require review. Hypothetical evidence changes no original record. Not legal advice.',
  };
}
