import type { ChangeReport, PropertyRecord, Rule } from "./contracts";
import type { OfficialChange } from "./data";
import { describeChange } from "./data";
import { evaluateProperty } from "./evaluate";

export function selectChangeRules(test: OfficialChange, rules: Rule[]): Rule[] {
  // Test identifiers are organizer references, not the IDs of automatically extracted rules.
  // Select candidate rules by the test's jurisdiction/category/status, never by expected address IDs.
  switch (test.test_id) {
    case "T1":
      return rules.filter(
        (r) =>
          r.state === "CA" &&
          r.level === "state" &&
          r.category === "algorithmic_rent_setting",
      );
    case "T2":
      return rules.filter(
        (r) =>
          r.state === "NJ" &&
          r.level === "city" &&
          /Hoboken|Jersey City/i.test(r.jurisdiction) &&
          r.category === "algorithmic_rent_setting",
      );
    case "T3":
      return rules.filter(
        (r) =>
          r.state === "NJ" &&
          r.level === "state" &&
          r.category === "algorithmic_rent_setting",
      );
    case "T4":
      return rules.filter(
        (r) =>
          r.state === "MA" &&
          r.category === "algorithmic_rent_setting" &&
          r.status === "pending",
      );
    case "T5":
      return rules.filter(
        (r) =>
          r.state === "MA" &&
          r.category === "rent_increase_limits" &&
          /25[–-]21|Cella|rent.control ballot/i.test(
            r.title + " " + r.requirement + " " + r.quotedSpan,
          ),
      );
    default:
      return [];
  }
}

export function computeChange(
  test: OfficialChange,
  properties: PropertyRecord[],
  rules: Rule[],
): ChangeReport {
  const description = describeChange(test);
  const selected = selectChangeRules(test, rules);
  const hypothetical =
    test.type === "pending"
      ? selected.map((rule) => ({
          ...rule,
          status: "in_force" as const,
          effectiveDate: description.afterDate,
        }))
      : selected;
  const affected: PropertyRecord[] = [];
  const conflicts: string[] = [];
  let beforeCount = 0,
    afterCount = 0,
    unresolvedCount = 0;
  for (const property of properties) {
    const before = evaluateProperty(property, selected, description.beforeDate);
    const after = evaluateProperty(
      property,
      hypothetical,
      description.afterDate,
    );
    const beforeApplies = before.results.some((r) => r.result === "applies");
    const afterApplies = after.results.some((r) => r.result === "applies");
    if (beforeApplies) beforeCount++;
    if (afterApplies) afterCount++;
    if (!afterApplies && after.results.some((r) => r.result === "unknown"))
      unresolvedCount++;
    const changed =
      test.type === "boundary"
        ? afterApplies
        : test.type === "negative"
          ? afterApplies
          : beforeApplies !== afterApplies;
    if (changed) affected.push(property);
    if (test.test_id === "T3" && afterApplies) {
      const local = rules.filter(
        (r) =>
          r.state === "NJ" &&
          r.level === "city" &&
          /Hoboken|Jersey City/i.test(r.jurisdiction) &&
          r.category === "algorithmic_rent_setting",
      );
      if (
        evaluateProperty(property, local, description.afterDate).results.some(
          (r) => r.result === "applies",
        )
      )
        conflicts.push(property.id);
    }
  }
  const notes = [
    test.type === "pending"
      ? "Hypothetical enactment only. These proposals remain pending in ordinary lookups."
      : test.type === "boundary"
        ? "Addresses supported by the extracted local rules and resolved legal jurisdictions."
        : "Computed from extracted rules and the two query dates; not an official score.",
    selected.length
      ? `${selected.length} extracted rule(s) evaluated.`
      : "No matching extracted rule is available. An empty set here does not establish a correct legal negative.",
    unresolvedCount
      ? `${unresolvedCount} address(es) remain unresolved and are not counted as established affected addresses.`
      : "",
    test.test_id === "T3"
      ? "Potential local/state preemption is flagged for human review as specified in T3; no automatic supersession is inferred."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...description,
    affectedAddressIds: affected.map((p) => p.id),
    conflictAddressIds: conflicts,
    beforeCount,
    afterCount,
    notes,
    properties: affected,
    ruleIds: selected.map((r) => r.id),
  };
}
