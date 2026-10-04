import type {
  EvidenceBranch,
  EvidenceQuestion,
  FactValue,
  Facts,
  LookupReport,
  Outcome,
  Predicate,
  PropertyRecord,
  Rule,
  RuleResult,
  TraceStep,
} from "./contracts";
import { FIELDS, describeFact, isField, labelFor, resolveFact } from "./facts";

type Truth = true | false | null;
type PredicateResult = { value: Truth; missingFacts: string[]; trace: TraceStep[] };

const unique = <T>(values: T[]): T[] => [...new Set(values)];
const listOf = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const step = (label: string, detail: string, value: Truth): TraceStep => ({
  label,
  detail,
  outcome: value === null ? "unknown" : value ? "pass" : "fail",
});
const OPS: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gte: "≥",
  gt: ">",
  lte: "≤",
  lt: "<",
  in: "one of",
};
const show = (value: unknown) =>
  typeof value === "boolean" ? (value ? "yes" : "no") : Array.isArray(value) ? value.join(", ") : String(value);

function compareExact(
  actual: string | number | boolean,
  op: string,
  expected: string | number | boolean,
): Truth {
  if (op === "eq" || op === "neq") {
    const same =
      typeof actual === "string" && typeof expected === "string"
        ? actual.toLowerCase() === expected.toLowerCase()
        : actual === expected;
    return op === "eq" ? same : !same;
  }
  if (typeof actual !== typeof expected || typeof actual === "boolean") return null;
  if (op === "gte") return actual >= expected;
  if (op === "gt") return actual > expected;
  if (op === "lte") return actual <= expected;
  return actual < expected;
}

/** Three-valued comparison of a bounded value: true or false only when every value in the range agrees. */
function compareRange(
  min: string | number | null,
  max: string | number | null,
  op: string,
  expected: string | number | boolean,
): Truth {
  if (typeof expected === "boolean") return null;
  const lo = min, hi = max;
  if (op === "gte") return lo !== null && lo >= expected ? true : hi !== null && hi < expected ? false : null;
  if (op === "gt") return lo !== null && lo > expected ? true : hi !== null && hi <= expected ? false : null;
  if (op === "lte") return hi !== null && hi <= expected ? true : lo !== null && lo > expected ? false : null;
  if (op === "lt") return hi !== null && hi < expected ? true : lo !== null && lo >= expected ? false : null;
  const excluded = (lo !== null && lo > expected) || (hi !== null && hi < expected);
  const pinned = lo !== null && lo === hi && lo === expected;
  if (op === "eq") return pinned ? true : excluded ? false : null;
  if (op === "neq") return pinned ? false : excluded ? true : null;
  return null;
}

/** Kleene logic: a false AND or a true OR settles the result regardless of missing facts. */
export function evaluatePredicate(
  predicate: Predicate,
  property: PropertyRecord,
  facts: Facts,
  asOf: string,
): PredicateResult {
  if (predicate.op === "always")
    return { value: true, missingFacts: [], trace: [] };
  if (predicate.op === "unknown")
    return {
      value: null,
      missingFacts: [],
      trace: [step("Needs review", predicate.reason, null)],
    };
  if (predicate.op === "not") {
    const inner = evaluatePredicate(predicate.arg, property, facts, asOf);
    if (inner.value === null && inner.missingFacts.length === 0)
      // An exemption the fields can't express (e.g. hospitals, dormitories) is presumed not to apply
      // to these apartment buildings unless someone shows it does; the note keeps it visible.
      return {
        value: true,
        missingFacts: [],
        trace: inner.trace.map((item) => ({
          ...item,
          label: "Exemption not checked",
          detail: `${item.detail} Presumed not to apply to an apartment building unless shown.`,
        })),
      };
    const value = inner.value === null ? null : !inner.value;
    return {
      value,
      missingFacts: inner.missingFacts,
      trace: inner.trace.map((item) =>
        item.outcome === "unknown"
          ? item
          : {
              ...item,
              label: `${item.label} (exemption)`,
              detail: item.detail.replace("Rule asks for", "Exempt if"),
              outcome: item.outcome === "pass" ? "fail" : "pass",
            },
      ),
    };
  }
  if (predicate.op === "all" || predicate.op === "any") {
    const decisive = predicate.op !== "all";
    const results = predicate.args.map((arg) => evaluatePredicate(arg, property, facts, asOf));
    const settled = results.find((result) => result.value === decisive);
    if (settled) return { value: decisive, missingFacts: [], trace: settled.trace };
    const open = results.some((result) => result.value === null);
    return {
      value: open ? null : !decisive,
      missingFacts: open ? unique(results.flatMap((result) => result.missingFacts)) : [],
      trace: results.flatMap((result) => result.trace),
    };
  }
  if (!("field" in predicate) || !isField(predicate.field))
    return {
      value: null,
      missingFacts: [],
      trace: [step("Needs review", "Uses a condition the evaluator does not support.", null)],
    };
  const label = labelFor(predicate.field);
  const wanted = `${labelFor(predicate.field).toLowerCase()} ${OPS[predicate.op]} ${show(predicate.value)}`;
  const resolved = resolveFact(predicate.field, facts, property.ranges, asOf);
  if (resolved.kind === "missing")
    return {
      value: null,
      missingFacts: [resolved.ask],
      trace: [step(label, `Rule asks for ${wanted}; not in the record.`, null)],
    };
  let value: Truth;
  if (predicate.op === "in") {
    const options = predicate.value;
    value =
      resolved.kind === "exact"
        ? options.some((option) => compareExact(resolved.value, "eq", option) === true)
        : options.every((option) => compareRange(resolved.min, resolved.max, "neq", option) === true)
          ? false
          : null;
  } else
    value =
      resolved.kind === "exact"
        ? compareExact(resolved.value, predicate.op, predicate.value)
        : compareRange(resolved.min, resolved.max, predicate.op, predicate.value);
  const known = describeFact(resolved);
  const basis = resolved.kind === "range" || resolved.basis !== "record" ? ` (${resolved.basis})` : "";
  return {
    value,
    missingFacts:
      value === null
        ? [predicate.field === "building_age_years" || predicate.field === "certificate_of_occupancy_date"
            ? resolved.kind === "range" ? "certificate_of_occupancy_date" : "year_built"
            : predicate.field]
        : [],
    trace: [
      step(
        label,
        `Rule asks for ${wanted}; this building: ${known}${basis}.${value === null ? " That range doesn't settle it." : ""}`,
        value,
      ),
    ],
  };
}

function dateBounds(value: string | null | undefined): [string, string] | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return [value, value];
  if (/^\d{4}$/.test(value)) return [`${value}-01-01`, `${value}-12-31`];
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    return [`${value}-01`, new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)];
  }
  return null;
}
const sameCity = (a: string, b: string) =>
  a.toLowerCase().replace(/,.*$/, "").replace(/^city of\s+/, "").trim() ===
  b.toLowerCase().replace(/,.*$/, "").replace(/^city of\s+/, "").trim();

/** Evaluate one rule for one property on one date. Jurisdiction, time, and coverage are checked separately. */
export function evaluateRule(
  rule: Rule,
  property: PropertyRecord,
  asOf: string,
  scenario: Facts = {},
): RuleResult {
  const facts = { ...property.facts, ...scenario };
  const trace: TraceStep[] = [];
  const done = (result: Outcome, explanation: string, missingFacts: string[] = []): RuleResult => ({
    ruleId: rule.id,
    result,
    explanation,
    conflictFlag: false,
    missingFacts: unique(missingFacts),
    trace,
  });
  if (rule.state !== property.state)
    return done("does_not_apply", `Only applies in ${rule.state}.`);
  if (rule.status === "failed")
    return done("does_not_apply", "This proposal failed and never became law.");

  const city =
    "legal_city" in scenario ? (scenario.legal_city ? String(scenario.legal_city) : null) : property.city;
  let cityOpen = false;
  if (rule.level === "city") {
    if (!city) {
      cityOpen = true;
      trace.push(step("City", `Only applies inside ${rule.jurisdiction}; the city for this address isn't confirmed.`, null));
    } else if (!sameCity(city, rule.jurisdiction))
      return done("does_not_apply", `Only applies inside ${rule.jurisdiction}.`);
    else trace.push(step("City", `The address is inside ${rule.jurisdiction}.`, true));
  } else trace.push(step("State", `The address is in ${rule.state}.`, true));

  const coverage = evaluatePredicate(rule.coverage, property, facts, asOf);
  trace.push(...coverage.trace);
  if (coverage.value === false)
    return done("does_not_apply", "The building is outside this rule's coverage.");
  if (rule.coverage.op === "always")
    trace.push(step("Coverage", "Covers every rental property in the jurisdiction.", true));

  if (rule.status === "pending") {
    trace.push(step("Status", "Still a proposal. It is not law, whatever the date.", null));
    return done("pending", "Proposed, not law.", coverage.missingFacts);
  }
  const start = dateBounds(rule.effectiveDate);
  const end = dateBounds(rule.endDate);
  if (end && asOf > end[1]) return done("does_not_apply", `Expired ${end[1]}.`);
  if (start && asOf < start[0]) {
    trace.push(step("Effective date", `Takes effect ${start[0]}.`, false));
    return done("not_yet_effective", `Takes effect ${start[0]}.`, coverage.missingFacts);
  }
  if (!start && rule.status === "not_yet_effective") {
    trace.push(step("Effective date", "Enacted, but its start date isn't stated.", null));
    return done("not_yet_effective", "Enacted; start date not stated.", coverage.missingFacts);
  }
  if (start && asOf < start[1]) {
    trace.push(step("Effective date", `Takes effect sometime in ${rule.effectiveDate}.`, null));
    return done("unknown", `Takes effect sometime in ${rule.effectiveDate}.`, coverage.missingFacts);
  }
  trace.push(
    step(
      "Effective date",
      start ? `In effect since ${start[0]}.` : "In force; the source gives no start date.",
      true,
    ),
  );
  if (cityOpen)
    return done("unknown", `Applies only if the address is inside ${rule.jurisdiction}.`, [
      "legal_city",
      ...coverage.missingFacts,
    ]);
  if (coverage.value === null)
    return done(
      "unknown",
      coverage.missingFacts.length
        ? `Depends on ${listOf(coverage.missingFacts.map((field) => (field === "owner_occupied" ? "owner occupancy" : labelFor(field).toLowerCase())))}.`
        : "Coverage needs a human read of the source.",
      coverage.missingFacts,
    );
  return done("applies", "Covers this building.");
}

/** Interactions the sources themselves state: state rules that yield to stricter local rules, and possible preemption. */
function applyInteractions(rules: Rule[], results: RuleResult[]): RuleResult[] {
  const byId = new Map(results.map((result) => [result.ruleId, result]));
  const local = (rule: Rule) =>
    rules.filter(
      (other) => other.level === "city" && other.state === rule.state && other.category === rule.category,
    );
  for (const rule of rules) {
    const result = byId.get(rule.id)!;
    if (rule.level !== "state") continue;
    if (rule.yieldsToLocal && (result.result === "applies" || result.result === "unknown")) {
      const locals = local(rule).map((other) => ({ other, outcome: byId.get(other.id)! }));
      const governing = locals.find(({ outcome }) => outcome.result === "applies");
      const open = locals.filter(({ outcome }) => outcome.result === "unknown");
      if (governing) {
        result.result = "superseded";
        result.explanation = `A stricter local rule governs here: ${governing.other.title}.`;
        result.missingFacts = [];
        result.trace.push(step("Local rule", `${governing.other.citation} covers this building, and this state rule yields to it.`, true));
      } else if (open.length && result.result === "applies") {
        result.result = "unknown";
        result.explanation = "Applies unless the local ordinance covers this building, which isn't settled.";
        result.missingFacts = unique(open.flatMap(({ outcome }) => outcome.missingFacts));
        result.trace.push(step("Local rule", "This state rule yields to a stricter local rule if one covers the building.", null));
      }
    }
    if (rule.preemptsLocal && ["applies", "not_yet_effective", "unknown"].includes(result.result)) {
      for (const other of local(rule)) {
        const outcome = byId.get(other.id)!;
        if (!["applies", "not_yet_effective"].includes(outcome.result)) continue;
        result.conflictFlag = outcome.conflictFlag = true;
        result.trace.push(step("Possible conflict", `May preempt ${other.citation}. Flagged for human review.`, null));
        outcome.trace.push(step("Possible conflict", `${rule.citation} may preempt this local rule. Flagged for human review.`, null));
      }
    }
  }
  return results;
}

export function evaluateAll(property: PropertyRecord, rules: Rule[], asOf: string, scenario: Facts = {}): RuleResult[] {
  return applyInteractions(rules, rules.map((rule) => evaluateRule(rule, property, asOf, scenario)));
}

function addYears(date: string, years: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() + years);
  return value.toISOString().slice(0, 10);
}
function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Values just either side of every threshold the relevant rules test, expressed in the asked-about fact. */
function candidates(predicate: Predicate, field: string, asOf: string, out: FactValue[] = []): FactValue[] {
  if (predicate.op === "all" || predicate.op === "any") {
    predicate.args.forEach((arg) => candidates(arg, field, asOf, out));
    return out;
  }
  if (predicate.op === "not") return candidates(predicate.arg, field, asOf, out);
  if (!("field" in predicate)) return out;
  const target = predicate.field;
  const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
  for (const value of values) {
    if (target === field) {
      if (typeof value === "boolean") out.push(true, false);
      else if (typeof value === "number") out.push(value - 1, value, value + 1);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) out.push(shiftDay(value, -1), value, shiftDay(value, 1));
      else out.push(value, "other");
    } else if (field === "year_built") {
      if (target === "certificate_of_occupancy_date" && typeof value === "string") {
        const year = Number(value.slice(0, 4));
        out.push(year - 1, year + 1);
      } else if (target === "building_age_years" && typeof value === "number") {
        const year = Number(asOf.slice(0, 4)) - value;
        out.push(Math.floor(year) - 1, Math.ceil(year) + 1);
      }
    } else if (field === "certificate_of_occupancy_date" && target === "building_age_years" && typeof value === "number") {
      const date = addYears(asOf, -Math.round(value));
      out.push(shiftDay(date, -1), shiftDay(date, 1));
    } else if (field === "units" && target === "single_family_or_condo") out.push(1, 2);
  }
  return out;
}

function branchLabel(field: string, value: FactValue): string {
  if (field === "owner_occupied") return value ? "Owner lives there" : "Owner lives elsewhere";
  if (field === "units") return `${value} ${value === 1 ? "unit" : "units"}`;
  if (field === "year_built") return `Built ${value}`;
  if (field === "certificate_of_occupancy_date") return `First occupied ${value}`;
  if (field === "legal_city") return value ? `Inside ${value}` : "Outside the city";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replace(/_/g, " ");
}

function summarize(outcomes: Outcome[]): Outcome {
  for (const preferred of ["applies", "superseded", "not_yet_effective", "pending", "unknown"] as Outcome[])
    if (outcomes.length && outcomes.every((item) => item === preferred)) return preferred;
  return outcomes.includes("applies") ? "applies" : outcomes.includes("unknown") ? "unknown" : outcomes[0] ?? "does_not_apply";
}

/** For each missing fact that blocks a conclusion, show what each plausible answer would change. */
function evidenceQuestions(
  property: PropertyRecord,
  rules: Rule[],
  asOf: string,
  scenario: Facts,
  results: RuleResult[],
): EvidenceQuestion[] {
  const open = results.filter((result) => result.result === "unknown");
  const fields = unique(open.flatMap((result) => result.missingFacts)).filter(
    (field) => !(field in scenario),
  );
  const questions: EvidenceQuestion[] = [];
  for (const field of fields) {
    const relevant = rules.filter((rule) =>
      open.some((result) => result.ruleId === rule.id && result.missingFacts.includes(field)),
    );
    let values: FactValue[] =
      field === "legal_city"
        ? unique(relevant.map((rule) => rule.jurisdiction.replace(/,.*$/, ""))).flatMap((city) => [city, ""])
        : unique(relevant.flatMap((rule) => candidates(rule.coverage, field, asOf)));
    const range = property.ranges[field];
    values = values.filter((value) => {
      if (typeof value !== "number") return true;
      if (value < 0) return false;
      if (range?.min !== null && range?.min !== undefined && value < Number(range.min)) return false;
      if (range?.max !== null && range?.max !== undefined && value > Number(range.max)) return false;
      if (field === "year_built" && (value < 1700 || value > Number(asOf.slice(0, 4)))) return false;
      return true;
    });
    const seen = new Map<string, EvidenceBranch>();
    for (const value of values.slice(0, 16)) {
      const outcome = evaluateAll(property, rules, asOf, { ...scenario, [field]: value });
      const changes = relevant.map((rule) => ({
        ruleId: rule.id,
        result: outcome.find((item) => item.ruleId === rule.id)!.result,
      }));
      const signature = changes.map((item) => item.result).join("|");
      if (seen.has(signature)) continue;
      seen.set(signature, {
        label: branchLabel(field, value),
        value,
        result: summarize(changes.map((item) => item.result)),
        changes,
      });
    }
    const branches = [...seen.values()]
      .sort((a, b) =>
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : typeof a.value === "boolean"
            ? Number(b.value) - Number(a.value)
            : String(a.value).localeCompare(String(b.value)),
      )
      .slice(0, 4);
    if (branches.length < 2 && field !== "legal_city") continue;
    questions.push({
      id: `${property.id}:${field}`,
      field,
      label: labelFor(field),
      question: isField(field) ? FIELDS[field].question : "Is the address inside the city limits?",
      why: `${relevant.length === 1 ? "One rule" : `${relevant.length} rules`} can't be settled without it.`,
      ruleIds: relevant.map((rule) => rule.id),
      suggestedEvidence: isField(field)
        ? FIELDS[field].evidence
        : "The county assessor's parcel record or the city's official boundary map.",
      branches,
      hypothetical: true,
    });
  }
  return questions.sort((a, b) => b.ruleIds.length - a.ruleIds.length || a.field.localeCompare(b.field));
}

/** The supplied record is never modified; scenario facts are an explicit, labeled overlay. */
export function evaluateProperty(
  property: PropertyRecord,
  rules: Rule[],
  asOf: string,
  scenario: Facts = {},
): LookupReport {
  const results = evaluateAll(property, rules, asOf, scenario);
  return {
    property,
    asOf,
    results,
    questions: evidenceQuestions(property, rules, asOf, scenario, results),
    scenarioFacts: { ...scenario },
    scenario: Object.keys(scenario).length > 0,
  };
}
