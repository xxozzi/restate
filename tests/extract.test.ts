import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractDocuments,
  extractPatternRules,
  getBudgetStatus,
  validateModelRules,
  validatePredicate,
} from "../src/extract";
import type { SourceDocument } from "../src/contracts";

const text =
  "The ordinance prohibits algorithmic rent pricing for residential rental properties. It takes effect on January 1, 2027.";
const doc: SourceDocument = {
  id: "test",
  title: "Synthetic test ordinance",
  jurisdiction: "CA",
  url: "https://example.org/test",
  retrievedAt: "2026-10-03",
  text,
  sha256: createHash("sha256").update(text).digest("hex"),
  captureStatus: "synthetic-test",
  filename: "",
};
const response = {
  rules: [
    {
      title: "Algorithmic pricing restriction",
      category: "algorithmic_rent_setting",
      status: "not_yet_effective",
      effectiveDate: "2027-01-01",
      endDate: null,
      requirement: "Prohibits algorithmic rent pricing.",
      coverageJson: '{"op":"always"}',
      coverageDescription: "Residential rentals.",
      exemptions: [],
      citation: "Synthetic ordinance",
      quotedSpan: text,
      warnings: [],
    },
  ],
  warnings: [],
};

test("automatic baseline preserves exact source quotes and explicit effective date", () => {
  const rules = extractPatternRules(doc);
  assert.ok(rules.length > 0);
  assert.equal(rules[0].effectiveDate, "2027-01-01");
  assert.ok(rules.every((rule) => doc.text.includes(rule.quotedSpan)));
  assert.ok(
    rules.every(
      (rule) =>
        rule.extractionMethod === "pattern" &&
        rule.reviewStatus === "needs_review",
    ),
  );
});
test("model candidates need exact evidence and an allowlisted predicate", () => {
  assert.equal(validateModelRules(doc, response).rules.length, 1);
  assert.equal(
    validateModelRules(doc, {
      rules: [
        {
          ...response.rules[0],
          quotedSpan: "This sentence was never present in the source.",
        },
      ],
    }).rules.length,
    0,
  );
  assert.equal(
    validateModelRules(doc, {
      rules: [
        {
          ...response.rules[0],
          coverageJson: '{"op":"execute","code":"process.exit()"}',
        },
      ],
    }).rules.length,
    0,
  );
  assert.equal(
    validateModelRules(doc, {
      rules: [{ ...response.rules[0], effectiveDate: "2027-02-30" }],
    }).rules.length,
    0,
  );
  assert.equal(
    validatePredicate({ op: "gte", field: "__proto__", value: 0 }),
    false,
  );
});
test("paid extraction is opt-in, bounded before sending, metered, and cached", async () => {
  const directory = await mkdtemp(join(tmpdir(), "restate-budget-test-"));
  const previous = {
    key: process.env.ANTHROPIC_API_KEY,
    budget: process.env.ANTHROPIC_BUDGET_USD,
    runs: process.env.RESTATE_RUNS_DIR,
    model: process.env.ANTHROPIC_MODEL,
    fetch: globalThis.fetch,
  };
  let calls = 0;
  process.env.ANTHROPIC_API_KEY = "test-placeholder-key";
  process.env.ANTHROPIC_BUDGET_USD = "0";
  process.env.RESTATE_RUNS_DIR = directory;
  process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(response) }],
        usage: { input_tokens: 100, output_tokens: 100 },
        stop_reason: "end_turn",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    await extractDocuments([doc], { useModel: false });
    assert.equal(calls, 0);
    const blocked = await extractDocuments([doc], { useModel: true });
    assert.equal(calls, 0);
    assert.ok(
      blocked.report.warnings.some((w) => w.includes("budget exhausted")),
    );
    process.env.ANTHROPIC_BUDGET_USD = "2";
    const first = await extractDocuments([doc], { useModel: true });
    assert.equal(calls, 1);
    assert.equal(first.report.mode, "model");
    const status = await getBudgetStatus();
    assert.ok(status.spent >= 0.0006 && status.spent < 0.000602);
    assert.equal(status.reserved, 0);
    await extractDocuments([doc], { useModel: true });
    assert.equal(calls, 1);
    process.env.ANTHROPIC_MODEL = "unpriced-model";
    await extractDocuments([{ ...doc, id: "other" }], { useModel: true });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of Object.entries({
      ANTHROPIC_API_KEY: previous.key,
      ANTHROPIC_BUDGET_USD: previous.budget,
      RESTATE_RUNS_DIR: previous.runs,
      ANTHROPIC_MODEL: previous.model,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("source alignment recovers exact whitespace but never fills omitted words", async () => {
  const { recoverSourceQuote } = await import("../src/extract");
  const source = "The applicant’s criminal\nrecord shall not be requested.";
  assert.equal(
    recoverSourceQuote(
      source,
      "The applicant's criminal record shall not be requested.",
    ),
    source,
  );
  assert.equal(
    recoverSourceQuote(
      source,
      "The applicant's criminal ... shall not be requested.",
    ),
    null,
  );
  assert.equal(
    recoverSourceQuote(source, "The criminal record may be requested."),
    null,
  );
});

test("an independently parsed commencement clause overrides an invented model date", () => {
  const sourceText =
    "Algorithmic rent pricing is prohibited. This act shall take effect on the first day of the twelfth month next following the date of enactment. Approved July 20, 2026.";
  const source = { ...doc, text: sourceText };
  const result = validateModelRules(source, {
    rules: [
      {
        ...response.rules[0],
        effectiveDate: "2027-07-20",
        quotedSpan: sourceText,
      },
    ],
  });
  assert.equal(result.rules[0].effectiveDate, "2027-07-01");
  assert.equal(result.rules[0].status, "not_yet_effective");
  const unsupported = validateModelRules(
    {
      ...doc,
      text: "Algorithmic rent pricing is prohibited. Passed April 14, 2020.",
    },
    {
      rules: [
        {
          ...response.rules[0],
          quotedSpan: "Algorithmic rent pricing is prohibited.",
          effectiveDate: "2020-04-14",
        },
      ],
    },
  );
  assert.equal(unsupported.rules[0].effectiveDate, null);
});

test("a failed ballot measure is not treated as an operative rent cap", () => {
  const source = {
    ...doc,
    title: "Court opinion on Initiative Petition 25-21",
    text: "The rent control petition was reviewed. Accordingly, art. 48 bars placement of the petition on the November 2026 Statewide election ballot.",
  };
  assert.ok(
    extractPatternRules(source).every((rule) => rule.status === "failed"),
  );
});
