import Ajv2020 from 'ajv/dist/2020.js';
import type { PropertyRecord, Rule } from './contracts';
import type { OfficialChange } from './data';
import { evaluateProperty } from './evaluate';
import { computeChange } from './changes';

export function exportRules(rules: Rule[], asOf: string) {
  return rules.map(rule => ({
    team_rule_id: rule.id,
    jurisdiction: rule.level === 'state' ? rule.state : rule.jurisdiction.includes(',') ? rule.jurisdiction : `${rule.jurisdiction}, ${rule.state}`,
    level: rule.level, category: rule.category,
    status: rule.status === 'pending' || rule.status === 'failed' ? rule.status : rule.effectiveDate && rule.effectiveDate.length === 10 ? (rule.effectiveDate > asOf ? 'not_yet_effective' : 'in_force') : rule.status,
    title: rule.title, requirement: rule.requirement,
    coverage_conditions: { description: rule.coverageDescription, predicate: rule.coverage },
    exemptions: rule.exemptions.length ? rule.exemptions.join('; ') : null,
    overrides: rule.supersedes || [], interaction: rule.supersedes?.length ? 'Source-supported supersession; see cited rule.' : null,
    effective_date: rule.effectiveDate, citation: rule.citation, source_doc_id: rule.sourceId,
    source_url: rule.sourceUrl, quoted_span: rule.quotedSpan,
    confidence: null, conflict_flag: Boolean(rule.conflictsWith?.length),
    conflict_note: rule.conflictsWith?.length ? 'Possible interaction requires human review.' : null,
  }));
}

export function validateRules(rules: Rule[], asOf: string, schema: Record<string, unknown>) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const records = exportRules(rules, asOf);
  const errors = records.flatMap(record => {
    const ruleId = record.team_rule_id;
    return validate(record) ? [] : [{ ruleId, errors: structuredClone(validate.errors) }];
  });
  return { checked: records.length, passed: records.length - errors.length, errors };
}

export function exportLookups(properties: PropertyRecord[], rules: Rule[], asOf: string) {
  const lookups = Object.fromEntries(properties.map(property => [property.id, evaluateProperty(property, rules, asOf).results.filter(result => result.result !== 'does_not_apply').map(result => ({
    team_rule_id: result.ruleId, result: result.result, explanation: result.explanation, conflict_flag: result.conflictFlag,
  }))]));
  return { as_of: asOf, lookups };
}

export function exportChanges(tests: OfficialChange[], properties: PropertyRecord[], rules: Rule[]) {
  return Object.fromEntries(tests.map(test => {
    const report = computeChange(test, properties, rules);
    return [test.test_id, { affected_address_ids: report.affectedAddressIds, conflict_flag_address_ids: report.conflictAddressIds, notes: report.notes }];
  }));
}
