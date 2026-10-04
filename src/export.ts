import Ajv2020 from "ajv/dist/2020.js";
import type { Facts, PropertyRecord, Rule } from "./contracts";
import type { OfficialChange } from "./data";
import { evaluateProperty } from "./evaluate";
import { computeChange } from "./changes";

const exportStatus = (rule: Rule, asOf: string) =>
  rule.status === "pending" || rule.status === "failed"
    ? rule.status
    : rule.effectiveDate && rule.effectiveDate.length === 10
      ? rule.effectiveDate > asOf
        ? "not_yet_effective"
        : "in_force"
      : rule.status;

export function exportRules(rules: Rule[], asOf: string) {
  // A measure whose own text ends before the query date is not current law, so it is left out.
  return rules.filter((rule) => !rule.endDate || rule.endDate >= asOf).map((rule) => ({
    team_rule_id: rule.id,
    jurisdiction: rule.jurisdiction,
    level: rule.level,
    category: rule.category,
    status: exportStatus(rule, asOf),
    title: rule.title,
    plain_language: rule.headline ?? null,
    requirement: rule.requirement,
    key_value: rule.keyValue,
    coverage_conditions: { description: rule.coverageDescription, predicate: rule.coverage },
    exemptions: rule.exemptions.length ? rule.exemptions.join("; ") : null,
    overrides: [] as string[],
    interaction: rule.yieldsToLocal
      ? "Yields to a stricter local ordinance that covers the unit (stated in the source)."
      : rule.preemptsLocal
        ? "May preempt local ordinances on the same subject; flagged for review."
        : null,
    effective_date: rule.effectiveDate,
    citation: rule.citation,
    source_doc_id: rule.sourceId,
    source_url: rule.sourceUrl,
    quoted_span: rule.quotedSpan,
    confidence: null,
    conflict_flag: rule.preemptsLocal,
    conflict_note: rule.preemptsLocal ? "Possible preemption of local ordinances; needs human review." : null,
  }));
}

export function validateRules(rules: Rule[], asOf: string, schema: Record<string, unknown>) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const records = exportRules(rules, asOf);
  const errors = records.flatMap((record) => {
    const ruleId = record.team_rule_id;
    return validate(record) ? [] : [{ ruleId, errors: structuredClone(validate.errors) }];
  });
  return { checked: records.length, passed: records.length - errors.length, errors };
}

export function exportLookups(properties: PropertyRecord[], rules: Rule[], asOf: string) {
  return {
    as_of: asOf,
    lookups: Object.fromEntries(
      properties.map((property) => [
        property.id,
        evaluateProperty(property, rules, asOf)
          .results.filter((result) => result.result !== "does_not_apply")
          .map((result) => ({
            team_rule_id: result.ruleId,
            result: result.result,
            explanation: result.explanation,
            conflict_flag: result.conflictFlag,
          })),
      ]),
    ),
  };
}

export function exportChanges(tests: OfficialChange[], properties: PropertyRecord[], rules: Rule[]) {
  return Object.fromEntries(
    tests.map((test) => {
      const report = computeChange(test, properties, rules);
      return [
        test.test_id,
        {
          affected_address_ids: report.affectedAddressIds,
          conflict_flag_address_ids: report.conflictAddressIds,
          notes: report.notes,
        },
      ];
    }),
  );
}

/** The contrast examples behind an evidence question, saved as replayable regression cases. */
export function exportEvidenceFixtures(property: PropertyRecord, rules: Rule[], asOf: string, scenario: Facts = {}) {
  const baseline = evaluateProperty(property, rules, asOf, scenario);
  return {
    kind: "restate-regression-fixtures",
    note: "Generated from the current rules. They catch regressions; they are not independent legal review.",
    propertyId: property.id,
    asOf,
    scenario,
    cases: baseline.questions.flatMap((question) =>
      question.branches.map((branch) => ({
        question: question.question,
        facts: { ...scenario, [question.field]: branch.value },
        expected: Object.fromEntries(branch.changes.map((change) => [change.ruleId, change.result])),
      })),
    ),
  };
}
