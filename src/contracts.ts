export type FactValue = string | number | boolean | null;
export type Facts = Record<string, FactValue>;
export type Category =
  | "rent_increase_limits"
  | "just_cause_eviction"
  | "security_deposits"
  | "application_screening_fees"
  | "screening_restrictions"
  | "algorithmic_rent_setting";
export type RuleStatus =
  "in_force" | "not_yet_effective" | "pending" | "failed";
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
  coverage: Predicate;
  coverageDescription: string;
  exemptions: string[];
  sourceId: string;
  citation: string;
  sourceUrl: string;
  quotedSpan: string;
  quoteStart: number;
  extractionMethod: "model" | "pattern";
  reviewStatus: "unreviewed" | "needs_review";
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
export interface EvidenceQuestion {
  id: string;
  field: string;
  label: string;
  question: string;
  why: string;
  ruleIds: string[];
  suggestedEvidence: string;
  branches: {
    label: string;
    value: FactValue;
    result: Outcome;
    explanation: string;
  }[];
  hypothetical: true;
  minimality: "suggested";
}
export interface LookupReport {
  property: PropertyRecord;
  asOf: string;
  results: RuleResult[];
  questions: EvidenceQuestion[];
  scenarioFacts: Facts;
  scenario: boolean;
  coverageNote: string;
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
  notes: string;
  properties: PropertyRecord[];
  ruleIds: string[];
}
export interface ExtractionReport {
  mode: "model" | "pattern";
  provider: string | null;
  model: string | null;
  createdAt: string;
  documentsProcessed: number;
  rulesExtracted: number;
  quotedRules: number;
  warnings: string[];
}
export interface Bootstrap {
  budget?: {
    limit: number;
    spent: number;
    reserved: number;
    remaining: number;
    usageEstimate: number;
    uncertain: number;
  };
  properties: PropertyRecord[];
  rules: Rule[];
  documents: Omit<SourceDocument, "text">[];
  changes: ChangeCase[];
  extraction: ExtractionReport;
  stats: {
    addresses: number;
    cities: number;
    states: number;
    sources: number;
    capturedSources: number;
    rules: number;
  };
  defaultAddressId: string;
  defaultAsOf: string;
  capabilities: { liveModel: boolean; provider: string | null };
}
