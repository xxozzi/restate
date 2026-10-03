import test from 'node:test';
import assert from 'node:assert/strict';
import type { Predicate, PropertyRecord, Rule } from '../src/contracts.ts';
import { evaluateProperty, evaluateRule } from '../src/evaluate.ts';

const asOf = '2026-10-01';
const unitsThreshold: Predicate = { op: 'gte', field: 'units', value: 6 };

function property(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: 'test-address', address: '100 Example Street', postalCity: 'Example City',
    city: 'Example City', state: 'CA', zip: '00000', facts: {},
    source: 'Independent synthetic evaluator fixture', retrievedAt: asOf,
    jurisdictionMethod: 'Explicit fixture legal-city boundary', ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'example-rule', title: 'Synthetic six-unit requirement',
    category: 'just_cause_eviction', jurisdiction: 'Example City', state: 'CA',
    level: 'city', status: 'in_force', effectiveDate: '2026-01-01',
    requirement: 'Synthetic test requirement; not a statement of law.',
    coverage: unitsThreshold, coverageDescription: 'Buildings with at least six units',
    exemptions: [], sourceId: 'synthetic-document', citation: 'Synthetic § 1',
    sourceUrl: 'https://example.invalid/synthetic-fixture',
    quotedSpan: 'This synthetic requirement covers buildings with at least six units.',
    quoteStart: 0, extractionMethod: 'pattern', reviewStatus: 'unreviewed',
    warnings: [], ...overrides,
  };
}

test('a false AND condition resolves the whole conjunction regardless of unknown operand order', () => {
  const knownFalse: Predicate = { op: 'eq', field: 'owner_occupied', value: false };
  for (const args of [[unitsThreshold, knownFalse], [knownFalse, unitsThreshold]]) {
    const result = evaluateRule(rule({ coverage: { op: 'all', args } }),
      property({ facts: { owner_occupied: true } }), asOf);
    assert.equal(result.result, 'does_not_apply');
    assert.deepEqual(result.missingFacts, []);
  }
});

test('a true OR condition resolves the whole disjunction regardless of unknown operand order', () => {
  const knownTrue: Predicate = { op: 'eq', field: 'owner_occupied', value: false };
  for (const args of [[unitsThreshold, knownTrue], [knownTrue, unitsThreshold]]) {
    const result = evaluateRule(rule({ coverage: { op: 'any', args } }),
      property({ facts: { owner_occupied: false } }), asOf);
    assert.equal(result.result, 'applies');
    assert.deepEqual(result.missingFacts, []);
  }
});

test('negating an unknown condition preserves uncertainty', () => {
  const result = evaluateRule(rule({ coverage: { op: 'not', arg: unitsThreshold } }), property(), asOf);
  assert.equal(result.result, 'unknown');
  assert.deepEqual(result.missingFacts, ['units']);
});

test('null facts do not coerce to zero or false in comparisons', () => {
  const comparisons: Predicate[] = [
    { op: 'gte', field: 'units', value: 0 },
    { op: 'lte', field: 'units', value: 0 },
    { op: 'eq', field: 'units', value: 0 },
    { op: 'neq', field: 'units', value: 0 },
    { op: 'eq', field: 'units', value: false },
  ];
  for (const coverage of comparisons) {
    const result = evaluateRule(rule({ coverage }), property({ facts: { units: null } }), asOf);
    assert.equal(result.result, 'unknown');
    assert.deepEqual(result.missingFacts, ['units']);
  }
});

test('unknown unit count produces two contrasting, explicitly hypothetical threshold examples', () => {
  const report = evaluateProperty(property(), [rule()], asOf);
  assert.equal(report.results[0]?.result, 'unknown');
  assert.deepEqual(report.results[0]?.missingFacts, ['units']);
  const question = report.questions.find(item => item.field === 'units');
  assert.ok(question, 'A missing fact should lead to a relevant evidence question');
  assert.equal(question.hypothetical, true);
  assert.equal(question.minimality, 'suggested');
  assert.equal(question.branches.find(branch => branch.value === 5)?.result, 'does_not_apply');
  assert.equal(question.branches.find(branch => branch.value === 6)?.result, 'applies');
});

test('known below-threshold units exclude a rule without unnecessary evidence questions', () => {
  const report = evaluateProperty(property({ facts: { units: 5 } }), [rule()], asOf);
  assert.ok(report.results.every(result => result.result === 'does_not_apply'));
  assert.equal(report.questions.length, 0);
  assert.equal(evaluateRule(rule(), property({ facts: { units: 5 } }), asOf).result, 'does_not_apply');
});

test('the exact threshold is inclusive', () => {
  assert.equal(evaluateRule(rule(), property({ facts: { units: 6 } }), asOf).result, 'applies');
});

test('legal city controls geography even when the postal city matches the rule', () => {
  const result = evaluateRule(rule(), property({
    city: 'Neighbor City', postalCity: 'Example City', facts: { units: 6 },
  }), asOf);
  assert.equal(result.result, 'does_not_apply');
});

test('a known legal city applies even when postal city names differ', () => {
  const result = evaluateRule(rule(), property({
    city: 'Example City', postalCity: 'Regional Postal Name', facts: { units: 6 },
  }), asOf);
  assert.equal(result.result, 'applies');
});

test('unknown legal city does not borrow a matching postal city', () => {
  const report = evaluateProperty(property({ city: null, facts: { units: 6 } }), [rule()], asOf);
  assert.equal(report.results[0]?.result, 'unknown');
  assert.ok(report.results[0]?.missingFacts.includes('legal_city'));
  assert.ok(report.questions.some(question => question.field === 'legal_city'));
});

test('an unrelated state is excluded even if the legal city is unknown', () => {
  const address = property({ state: 'NY', city: null, facts: { units: 6 } });
  assert.equal(evaluateRule(rule(), address, asOf).result, 'does_not_apply');
  const report = evaluateProperty(address, [rule()], asOf);
  assert.ok(report.results.every(result => result.result === 'does_not_apply'));
  assert.equal(report.questions.length, 0);
});

test('state-level coverage does not require a known city', () => {
  const result = evaluateRule(rule({ level: 'state', jurisdiction: 'California' }),
    property({ city: null, facts: { units: 6 } }), asOf);
  assert.equal(result.result, 'applies');
});

test('effective dates have an exact inclusive boundary', () => {
  const dated = rule({ effectiveDate: '2026-10-01', coverage: { op: 'always' } });
  assert.equal(evaluateRule(dated, property(), '2026-09-30').result, 'not_yet_effective');
  assert.equal(evaluateRule(dated, property(), '2026-10-01').result, 'applies');
  assert.equal(evaluateRule(dated, property(), '2026-10-02').result, 'applies');
});

test('a partially specified effective month cannot establish applicability within that month', () => {
  const result = evaluateRule(rule({ effectiveDate: '2026-10', coverage: { op: 'always' } }),
    property(), '2026-10-15');
  assert.equal(result.result, 'unknown');
});

test('a pending proposal remains pending after its proposed effective date', () => {
  const pending = rule({ status: 'pending', effectiveDate: '2026-01-01', coverage: { op: 'always' } });
  assert.equal(evaluateRule(pending, property(), '2027-01-01').result, 'pending');
});

test('a failed proposal is excluded regardless of its listed date', () => {
  const failed = rule({ status: 'failed', effectiveDate: '2026-01-01', coverage: { op: 'always' } });
  assert.equal(evaluateRule(failed, property(), '2027-01-01').result, 'does_not_apply');
});

test('an explicitly superseding applicable rule supersedes only its named predecessor', () => {
  const rules = [
    rule({ id: 'old', coverage: { op: 'always' } }),
    rule({ id: 'new', coverage: { op: 'always' }, supersedes: ['old'] }),
    rule({ id: 'unrelated', coverage: { op: 'always' } }),
  ];
  const results = evaluateProperty(property(), rules, asOf).results;
  assert.equal(results.find(result => result.ruleId === 'old')?.result, 'superseded');
  assert.equal(results.find(result => result.ruleId === 'new')?.result, 'applies');
  assert.equal(results.find(result => result.ruleId === 'unrelated')?.result, 'applies');
});

test('a future replacement does not supersede the current rule early', () => {
  const results = evaluateProperty(property(), [
    rule({ id: 'old', coverage: { op: 'always' } }),
    rule({ id: 'new', coverage: { op: 'always' }, effectiveDate: '2027-01-01', supersedes: ['old'] }),
  ], asOf).results;
  assert.equal(results.find(result => result.ruleId === 'old')?.result, 'applies');
  assert.equal(results.find(result => result.ruleId === 'new')?.result, 'not_yet_effective');
});

test('city-level rules do not automatically supersede state-level rules', () => {
  const results = evaluateProperty(property({ facts: { units: 6 } }), [
    rule({ id: 'state', level: 'state', jurisdiction: 'California' }),
    rule({ id: 'city' }),
  ], asOf).results;
  assert.equal(results.find(result => result.ruleId === 'state')?.result, 'applies');
  assert.equal(results.find(result => result.ruleId === 'city')?.result, 'applies');
});

test('explicit conflict flags require both linked rules to apply', () => {
  const first = rule({ id: 'first', coverage: { op: 'always' }, conflictsWith: ['second'] });
  const second = rule({ id: 'second' });
  const known = evaluateProperty(property({ facts: { units: 6 } }), [first, second], asOf).results;
  assert.equal(known.find(result => result.ruleId === 'first')?.conflictFlag, true);
  assert.equal(known.find(result => result.ruleId === 'second')?.conflictFlag, true);
  const unknown = evaluateProperty(property(), [first, second], asOf).results;
  assert.ok(unknown.every(result => result.conflictFlag === false));
  const excluded = evaluateProperty(property({ facts: { units: 5 } }), [first, second], asOf).results;
  assert.ok(excluded.every(result => result.conflictFlag === false));
});

test('scenario facts affect hypothetical results without mutating source facts or rules', () => {
  const address = property();
  const rules = [rule()];
  const originalAddress = structuredClone(address);
  const originalRules = structuredClone(rules);
  const report = evaluateProperty(address, rules, asOf, { units: 6 });
  assert.equal(report.results[0]?.result, 'applies');
  assert.equal(report.scenario, true);
  assert.deepEqual(report.scenarioFacts, { units: 6 });
  assert.deepEqual(address, originalAddress);
  assert.deepEqual(report.property, originalAddress);
  assert.deepEqual(rules, originalRules);
  assert.equal(evaluateProperty(address, rules, asOf).results[0]?.result, 'unknown');
});

test('resolving one missing fact keeps other relevant missing conditions unknown', () => {
  const multiple = rule({ coverage: { op: 'all', args: [
    unitsThreshold, { op: 'eq', field: 'owner_occupied', value: false },
  ] } });
  const report = evaluateProperty(property(), [multiple], asOf);
  const unitQuestion = report.questions.find(question => question.field === 'units');
  assert.ok(unitQuestion);
  assert.equal(unitQuestion.branches.find(branch => branch.value === 6)?.result, 'unknown');
  assert.equal(unitQuestion.branches.find(branch => branch.value === 5)?.result, 'does_not_apply');
  const partial = evaluateProperty(property(), [multiple], asOf, { units: 6 });
  assert.equal(partial.results[0]?.result, 'unknown');
  assert.deepEqual(partial.results[0]?.missingFacts, ['owner_occupied']);
});

test('hypothetical legal-city evidence resolves geographic uncertainty without changing the address', () => {
  const address = property({ city: null, facts: { units: 6 } });
  const original = structuredClone(address);
  assert.equal(evaluateProperty(address, [rule()], asOf,
    { legal_city: 'Example City' }).results[0]?.result, 'applies');
  const elsewhere = evaluateProperty(address, [rule()], asOf, { legal_city: 'Neighbor City' });
  assert.ok(elsewhere.results.every(result => result.result === 'does_not_apply'));
  assert.deepEqual(address, original);
});
