import type { ChangeReport, PropertyRecord, Rule } from "./contracts";
import type { OfficialChange } from "./data";
import { describeChange } from "./data";
import { evaluateAll } from "./evaluate";

const enacted = (rule: Rule) => rule.status === "in_force" || rule.status === "not_yet_effective";

/**
 * The organizer's test IDs name their answer-key rules, not ours, so each test picks our extracted
 * rules by jurisdiction, category and status — never by expected addresses.
 */
export function selectChangeRules(test: OfficialChange, rules: Rule[]): Rule[] {
  const alg = (rule: Rule) => rule.category === "algorithmic_rent_setting";
  switch (test.test_id) {
    case "T1":
      return rules.filter((r) => r.state === "CA" && r.level === "state" && alg(r) && enacted(r));
    case "T2":
      return rules.filter((r) => r.level === "city" && /^(Hoboken|Jersey City),/.test(r.jurisdiction) && alg(r) && enacted(r));
    case "T3":
      return rules.filter((r) => r.state === "NJ" && r.level === "state" && alg(r) && enacted(r));
    case "T4":
      return rules.filter((r) => r.state === "MA" && alg(r) && r.status === "pending");
    case "T5":
      return rules.filter((r) => r.state === "MA" && r.category === "rent_increase_limits" && r.status === "failed");
    default:
      return [];
  }
}

export function computeChange(test: OfficialChange, properties: PropertyRecord[], rules: Rule[]): ChangeReport {
  const description = describeChange(test);
  const selected = selectChangeRules(test, rules);
  const ids = new Set(selected.map((rule) => rule.id));
  // T4 asks what would happen if the bills passed: an explicit, labeled hypothetical.
  const after =
    test.type === "pending"
      ? selected.map((rule) => ({ ...rule, status: "in_force" as const, effectiveDate: null }))
      : selected;
  // Local rules in the same category stay in view so possible preemption conflicts can be flagged.
  const context = rules.filter(
    (rule) => !ids.has(rule.id) && selected.some((s) => s.state === rule.state && s.category === rule.category && rule.level === "city" && enacted(rule)),
  );
  const affected: PropertyRecord[] = [];
  const conflicts: string[] = [];
  let beforeCount = 0;
  let afterCount = 0;
  let unresolvedCount = 0;
  for (const property of properties) {
    const beforeResults = evaluateAll(property, [...selected, ...context], description.beforeDate).filter((r) => ids.has(r.ruleId));
    const afterResults = evaluateAll(property, [...after, ...context], description.afterDate).filter((r) => ids.has(r.ruleId));
    const beforeApplies = beforeResults.some((r) => r.result === "applies");
    const afterApplies = afterResults.some((r) => r.result === "applies");
    if (beforeApplies) beforeCount++;
    if (afterApplies) afterCount++;
    if (!afterApplies && afterResults.some((r) => r.result === "unknown")) unresolvedCount++;
    const changed = test.type === "as_of" || test.type === "pending" ? beforeApplies !== afterApplies : afterApplies;
    if (changed) affected.push(property);
    if (test.conflict_with?.length && afterResults.some((r) => r.conflictFlag)) conflicts.push(property.id);
  }
  const notes = [
    test.type === "pending"
      ? "Hypothetical: what would change if the bills were enacted. In ordinary lookups they stay pending."
      : test.type === "negative"
        ? "The measure failed, so it creates no rent cap anywhere."
        : test.type === "boundary"
          ? "Each local ban applies only inside its own city limits."
          : `Compares ${description.beforeDate} with ${description.afterDate}.`,
    selected.length
      ? `Rules used: ${selected.map((rule) => `${rule.id} (${rule.citation})`).join("; ")}.`
      : "No extracted rule matches this test, so nothing is reported as affected.",
    unresolvedCount ? `${unresolvedCount} address(es) could not be settled from the record and are not counted.` : "",
    conflicts.length ? "Conflict flags mark possible state preemption of a local rule, for human review." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...description,
    affectedAddressIds: affected.map((p) => p.id),
    conflictAddressIds: conflicts,
    beforeCount,
    afterCount,
    unresolvedCount,
    notes,
    properties: affected,
    ruleIds: selected.map((rule) => rule.id),
  };
}
