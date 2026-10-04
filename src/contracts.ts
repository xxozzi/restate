export type FactValue = string | number | boolean | null;
export type Facts = Record<string, FactValue>;

/** A fact known only within bounds, e.g. "5 or more units" from an assessor use code. */
export interface FactRange {
  min: number | string | null;
  max: number | string | null;
  basis: string;
}
export type FactRanges = Record<string, FactRange>;

export type Category =
  | "rent_increase_limits"
  | "just_cause_eviction"
  | "security_deposits"
  | "application_screening_fees"
  | "screening_restrictions"
  | "algorithmic_rent_setting";
export type RuleStatus = "in_force" | "not_yet_effective" | "pending" | "failed";
export type Outcome =
  | "applies"
  | "unknown"
  | "superseded"
  | "not_yet_effective"
  | "pending"
  | "does_not_apply";

export type Predicate =
  | { op: "all" | "any"; args: Predicate[] }
  | { op: "not"; arg: Predicate }
  | {
      op: "eq" | "neq" | "gte" | "gt" | "lte" | "lt";
      field: string;
      value: string | number | boolean;
    }
  | { op: "in"; field: string; value: (string | number)[] }
  | { op: "unknown"; reason: string }
  | { op: "always" };

export interface SourceDocument {
  id: string;
  title: string;
  jurisdiction: string;
  url: string;
  retrievedAt: string;
  text: string;
  sha256: string;
  captureStatus: string;
  filename: string;
}

export interface PropertyRecord {
  id: string;
  address: string;
  postalCity: string;
  city: string | null;
  state: string;
  zip: string;
  facts: Facts;
  /** Bounds derived from public assessor codes when the exact value is missing. */
  ranges: FactRanges;
  useDescription: string;
  source: string;
  retrievedAt: string;
  jurisdictionMethod: string;
}

export interface Rule {
  id: string;
  title: string;
  category: Category;
  jurisdiction: string;
  state: string;
  level: "state" | "city";
  status: RuleStatus;
  effectiveDate: string | null;
  endDate?: string | null;
  requirement: string;
  keyValue: string | null;
  coverage: Predicate;
  coverageDescription: string;
  exemptions: string[];
  sourceId: string;
  /** Other documents whose extraction produced the same rule (same citation). */
  alsoIn: string[];
  citation: string;
  sourceUrl: string;
  quotedSpan: string;
  quoteStart: number;
  extractionMethod: "model";
  /** State rule that the source says yields where a stricter local rule covers the unit. */
  yieldsToLocal: boolean;
  /** State rule whose source signals possible preemption of local rules in this category. */
  preemptsLocal: boolean;
  supersedes?: string[];
  conflictsWith?: string[];
  warnings: string[];
}

export interface TraceStep {
  label: string;
  detail: string;
  outcome: "pass" | "fail" | "unknown";
}
export interface RuleResult {
  ruleId: string;
  result: Outcome;
  explanation: string;
  conflictFlag: boolean;
  missingFacts: string[];
  trace: TraceStep[];
}
export interface EvidenceBranch {
  label: string;
  value: FactValue;
  result: Outcome;
  changes: { ruleId: string; result: Outcome }[];
}
export interface EvidenceQuestion {
  id: string;
  field: string;
  label: string;
  question: string;
  why: string;
  ruleIds: string[];
  suggestedEvidence: string;
  branches: EvidenceBranch[];
  hypothetical: true;
}
export interface LookupReport {
  property: PropertyRecord;
  asOf: string;
  results: RuleResult[];
  questions: EvidenceQuestion[];
  scenarioFacts: Facts;
  scenario: boolean;
}
export interface ChangeCase {
  id: string;
  title: string;
  description: string;
  beforeDate: string;
  afterDate: string;
  status: string;
}
export interface ChangeReport extends ChangeCase {
  affectedAddressIds: string[];
  conflictAddressIds: string[];
  beforeCount: number;
  afterCount: number;
  unresolvedCount: number;
  notes: string;
  properties: PropertyRecord[];
  ruleIds: string[];
}
export interface ExtractionReport {
  model: string | null;
  createdAt: string;
  documentsProcessed: number;
  documentsWithText: number;
  rulesExtracted: number;
  quotedRules: number;
  pendingDocuments: string[];
  warnings: string[];
}
export interface BudgetStatus {
  limit: number;
  spent: number;
  reserved: number;
  remaining: number;
}
export interface Bootstrap {
  budget: BudgetStatus;
  properties: PropertyRecord[];
  rules: Rule[];
  documents: (Omit<SourceDocument, "text"> & { ruleCount: number })[];
  changes: ChangeCase[];
  extraction: ExtractionReport;
  stats: {
    addresses: number;
    resolvedAddresses: number;
    cities: number;
    states: number;
    sources: number;
    capturedSources: number;
    rules: number;
  };
  defaultAddressId: string;
  defaultAsOf: string;
  liveModel: boolean;
}
