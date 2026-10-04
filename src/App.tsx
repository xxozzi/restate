import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  HelpCircle,
  Plus,
  Search,
  X,
} from "lucide-react";
import type {
  Bootstrap,
  Category,
  ChangeReport,
  Facts,
  FactValue,
  LookupReport,
  Outcome,
  PropertyRecord,
  Rule,
  RuleResult,
  SourceDocument,
} from "./contracts";
import { describeFact, labelFor, resolveFact } from "./facts";

/* ---------------- shared helpers ---------------- */

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "rent_increase_limits", label: "Rent increases" },
  { id: "just_cause_eviction", label: "Evictions" },
  { id: "security_deposits", label: "Security deposits" },
  { id: "application_screening_fees", label: "Application fees" },
  { id: "screening_restrictions", label: "Tenant screening" },
  { id: "algorithmic_rent_setting", label: "Rent-pricing software" },
];
const categoryLabel = (id: Category) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
const STATUS: Record<Exclude<Outcome, "does_not_apply">, { label: string; tone: string }> = {
  applies: { label: "Applies", tone: "blue" },
  unknown: { label: "Needs a fact", tone: "amber" },
  superseded: { label: "Overridden", tone: "gray" },
  not_yet_effective: { label: "Upcoming", tone: "gray" },
  pending: { label: "Proposed", tone: "gray" },
};
const ORDER: Outcome[] = ["applies", "unknown", "superseded", "not_yet_effective", "pending"];
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const place = (rule: Rule) => (rule.level === "state" ? `${rule.state} state law` : rule.jurisdiction.replace(/, \w\w$/, ""));

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `Request failed (${response.status})`);
  return data as T;
}

type View = "address" | "changes" | "sources";
type Route = { view: View; id?: string };
const readRoute = (): Route => {
  const [, view, id] = window.location.hash.split("/");
  return view === "changes" || view === "sources" ? { view, id } : { view: "address", id };
};
const writeRoute = (route: Route) => {
  const next = `#/${route.view}${route.id ? `/${route.id}` : ""}`;
  if (window.location.hash !== next) window.history.replaceState(null, "", next);
};

function Pill({ outcome, review }: { outcome: Outcome; review?: boolean }) {
  if (outcome === "does_not_apply") return null;
  const status = STATUS[outcome];
  if (outcome === "unknown" && review) return <span className="pill pill-amber">Needs review</span>;
  return <span className={`pill pill-${status.tone}`}>{status.label}</span>;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
}

function Drawer({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={`drawer${wide ? " drawer-wide" : ""}`} role="dialog" aria-modal="true">
        <button className="icon-button drawer-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {children}
      </aside>
    </div>
  );
}

/* ---------------- app shell ---------------- */

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<Route>(readRoute);
  const [openRule, setOpenRule] = useState<{ rule: Rule; result?: RuleResult } | null>(null);
  const [openSource, setOpenSource] = useState<{ id: string; highlight?: string } | null>(null);
  const [asOf, setAsOf] = useState("");

  const load = () =>
    api<Bootstrap>("/api/bootstrap")
      .then((data) => {
        setBoot(data);
        setAsOf((current) => current || data.defaultAsOf);
      })
      .catch((err: Error) => setError(err.message));
  useEffect(() => {
    load();
    const listener = () => setRoute(readRoute());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    writeRoute(route);
    setOpenRule(null);
    setOpenSource(null);
  }, [route]);

  if (error) return <div className="center-message">Couldn't load the data: {error}</div>;
  if (!boot) return <div className="center-message">Loading…</div>;
  const go = (next: Route) => setRoute(next);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => go({ view: "address" })}>
            <span className="brand-mark">(R)</span>estate
          </button>
          <nav className="tabs">
            {(["address", "changes", "sources"] as View[]).map((view) => (
              <button
                key={view}
                className={`tab${route.view === view ? " tab-active" : ""}`}
                onClick={() => go({ view })}
              >
                {view === "address" ? "Lookup" : view === "changes" ? "Law changes" : "Sources"}
              </button>
            ))}
          </nav>
          <ExportMenu asOf={asOf || boot.defaultAsOf} />
        </div>
      </header>

      <main className="page">
        {route.view === "address" && (
          <AddressView
            boot={boot}
            addressId={route.id && boot.properties.some((p) => p.id === route.id) ? route.id : boot.defaultAddressId}
            asOf={asOf || boot.defaultAsOf}
            setAsOf={setAsOf}
            onAddress={(id) => go({ view: "address", id })}
            onRule={(rule, result) => setOpenRule({ rule, result })}
          />
        )}
        {route.view === "changes" && (
          <ChangesView
            boot={boot}
            changeId={route.id ?? boot.changes[0]?.id}
            onChange={(id) => go({ view: "changes", id })}
            onAddress={(id, date) => {
              setAsOf(date);
              go({ view: "address", id });
            }}
            onRule={(rule) => setOpenRule({ rule })}
          />
        )}
        {route.view === "sources" && (
          <SourcesView boot={boot} onSource={(id) => setOpenSource({ id })} onAdded={load} />
        )}
      </main>

      <footer className="footer">
        Not legal advice. Answers come from {boot.stats.capturedSources} source documents and the public assessor sample, as of{" "}
        {formatDate(boot.defaultAsOf)}.
      </footer>

      {openRule && (
        <RuleDrawer
          rule={openRule.rule}
          result={openRule.result}
          boot={boot}
          onClose={() => setOpenRule(null)}
          onSource={(id, highlight) => {
            setOpenRule(null);
            setOpenSource({ id, highlight });
          }}
        />
      )}
      {openSource && (
        <SourceDrawer
          id={openSource.id}
          highlight={openSource.highlight}
          boot={boot}
          onClose={() => setOpenSource(null)}
          onRule={(rule) => {
            setOpenSource(null);
            setOpenRule({ rule });
          }}
        />
      )}
    </div>
  );
}

function ExportMenu({ asOf }: { asOf: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const listener = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, []);
  return (
    <div className="menu" ref={ref}>
      <button className="button button-quiet" onClick={() => setOpen(!open)}>
        <Download size={16} /> <span className="hide-small">Export</span> <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu-list">
          {[
            ["rules", "Rules", "Every extracted rule with its citation"],
            ["lookups", "Lookups", `All 500 addresses as of ${asOf}`],
            ["changes", "Change tests", "Affected addresses for T1–T5"],
          ].map(([kind, title, hint]) => (
            <a key={kind} className="menu-item" href={`/api/export/${kind}?asOf=${asOf}`} onClick={() => setOpen(false)}>
              <span>{title}</span>
              <small>{hint}</small>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- lookup ---------------- */

function AddressSearch({ boot, value, onPick }: { boot: Bootstrap; value: PropertyRecord; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return boot.properties
      .filter((p) => {
        const text = `${p.address} ${p.city ?? p.postalCity} ${p.state} ${p.id}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .slice(0, 8);
  }, [query, boot.properties]);
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQuery("");
  };
  return (
    <div className="search">
      <Search size={18} className="search-icon" />
      <input
        className="search-input"
        placeholder={`${value.address}, ${value.city ?? value.postalCity}`}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setCursor(Math.min(cursor + 1, matches.length - 1));
          else if (event.key === "ArrowUp") setCursor(Math.max(cursor - 1, 0));
          else if (event.key === "Enter" && matches[cursor]) pick(matches[cursor].id);
          else if (event.key === "Escape") setOpen(false);
        }}
        aria-label="Search the 500 sample addresses"
      />
      {open && matches.length > 0 && (
        <ul className="search-results">
          {matches.map((p, index) => (
            <li key={p.id}>
              <button
                className={`search-result${index === cursor ? " search-result-active" : ""}`}
                onMouseDown={() => pick(p.id)}
                onMouseEnter={() => setCursor(index)}
              >
                <span>{p.address}</span>
                <small>
                  {p.city ?? p.postalCity}, {p.state}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddressView({
  boot,
  addressId,
  asOf,
  setAsOf,
  onAddress,
  onRule,
}: {
  boot: Bootstrap;
  addressId: string;
  asOf: string;
  setAsOf: (date: string) => void;
  onAddress: (id: string) => void;
  onRule: (rule: Rule, result: RuleResult) => void;
}) {
  const property = boot.properties.find((p) => p.id === addressId)!;
  const [scenario, setScenario] = useState<Facts>({});
  const [report, setReport] = useState<LookupReport | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Outcome | "all">("all");
  const rulesById = useMemo(() => new Map(boot.rules.map((rule) => [rule.id, rule])), [boot.rules]);

  useEffect(() => {
    setScenario({});
    setFilter("all");
  }, [addressId]);
  useEffect(() => {
    let live = true;
    setError("");
    api<LookupReport>("/api/lookup", { addressId, asOf, facts: scenario })
      .then((data) => live && setReport(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [addressId, asOf, scenario]);

  const results = (report?.property.id === addressId ? report.results : []).filter((r) => r.result !== "does_not_apply");
  const counts = ORDER.map((outcome) => ({ outcome, count: results.filter((r) => r.result === outcome).length })).filter(
    (item) => item.count > 0,
  );
  const shown = results.filter((r) => filter === "all" || r.result === filter);

  return (
    <div className="lookup">
      <div className="lookup-bar">
        <AddressSearch boot={boot} value={property} onPick={onAddress} />
        <label className="date-field">
          <span>As of</span>
          <input type="date" value={asOf} onChange={(event) => event.target.value && setAsOf(event.target.value)} />
        </label>
      </div>

      <PropertyHeader property={property} asOf={asOf} scenario={scenario} />

      {Object.keys(scenario).length > 0 && (
        <div className="whatif">
          <span className="whatif-label">What-if</span>
          {Object.entries(scenario).map(([field, value]) => (
            <span key={field} className="chip">
              {labelFor(field)}: {formatFact(field, value)}
              <button
                aria-label={`Remove ${labelFor(field)}`}
                onClick={() => {
                  const next = { ...scenario };
                  delete next[field];
                  setScenario(next);
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <span className="whatif-note">Not from the record. The original data is unchanged.</span>
          <button className="link" onClick={() => setScenario({})}>
            Reset
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {report && report.property.id === addressId && report.questions.length > 0 && (
        <EvidenceCard
          report={report}
          rulesById={rulesById}
          onAnswer={(field, value) => setScenario({ ...scenario, [field]: value })}
        />
      )}

      <div className="filters">
        <button className={`filter${filter === "all" ? " filter-active" : ""}`} onClick={() => setFilter("all")}>
          All <span>{results.length}</span>
        </button>
        {counts.map(({ outcome, count }) => (
          <button
            key={outcome}
            className={`filter${filter === outcome ? " filter-active" : ""}`}
            onClick={() => setFilter(filter === outcome ? "all" : outcome)}
          >
            {STATUS[outcome as keyof typeof STATUS].label} <span>{count}</span>
          </button>
        ))}
      </div>

      {report && results.length === 0 && <p className="empty">No extracted rule covers this address.</p>}
      {CATEGORIES.map((category) => {
        const items = shown.filter((result) => rulesById.get(result.ruleId)?.category === category.id);
        if (!items.length) return null;
        return (
          <section key={category.id} className="group">
            <h2 className="group-title">{category.label}</h2>
            <ul className="rows">
              {items.map((result) => {
                const rule = rulesById.get(result.ruleId)!;
                return (
                  <li key={rule.id}>
                    <button className="row" onClick={() => onRule(rule, result)}>
                      <Pill outcome={result.result} review={result.missingFacts.length === 0} />
                      <span className="row-main">
                        <span className="row-title">{rule.title}</span>
                        <span className="row-sub">
                          {result.result === "applies" ? rule.requirement : result.explanation}
                        </span>
                      </span>
                      <span className="row-meta">
                        {rule.keyValue && <span className="row-value">{rule.keyValue}</span>}
                        <span className="row-place">{place(rule)}</span>
                      </span>
                      <ChevronRight size={16} className="row-chevron" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** NJ assessor rows sometimes carry the owner's mailing ZIP; only show a ZIP that fits the state. */
const plausibleZip = (p: PropertyRecord) =>
  ({ CA: /^9\d{4}$/, NJ: /^0[78]\d{3}$/, MA: /^0[12]\d{3}$/ } as Record<string, RegExp>)[p.state]?.test(p.zip) ? p.zip : "";

function formatFact(field: string, value: FactValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "legal_city") return value ? String(value) : "Outside the city";
  return String(value ?? "—").replace(/_/g, " ");
}

function PropertyHeader({ property, asOf, scenario }: { property: PropertyRecord; asOf: string; scenario: Facts }) {
  const facts = { ...property.facts, ...scenario };
  const units = resolveFact("units", facts, property.ranges, asOf);
  const year = facts.year_built;
  const city = "legal_city" in scenario ? (scenario.legal_city as string) || null : property.city;
  return (
    <section className="property">
      <div>
        <h1 className="property-address">{property.address}</h1>
        <p className="property-place">
          {city ?? property.postalCity}, {property.state} {plausibleZip(property)}
        </p>
      </div>
      <dl className="facts">
        <div className="fact" title={units.kind === "range" ? units.basis : undefined}>
          <dt>Units</dt>
          <dd>{units.kind === "missing" ? <span className="muted">Unknown</span> : describeFact(units)}</dd>
          {units.kind === "range" && <small>from use code</small>}
        </div>
        <div className="fact">
          <dt>Built</dt>
          <dd>{year ? String(year) : <span className="muted">Unknown</span>}</dd>
        </div>
        <div className="fact" title={property.jurisdictionMethod}>
          <dt>City</dt>
          <dd>
            {city ? (
              <>
                {city} <Check size={14} className="ok" />
              </>
            ) : (
              <span className="muted">Not confirmed</span>
            )}
          </dd>
          <small>{city ? "inside city limits" : `mailed as ${property.postalCity}`}</small>
        </div>
      </dl>
    </section>
  );
}

function EvidenceCard({
  report,
  rulesById,
  onAnswer,
}: {
  report: LookupReport;
  rulesById: Map<string, Rule>;
  onAnswer: (field: string, value: FactValue) => void;
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [report.property.id]);
  const question = report.questions[Math.min(index, report.questions.length - 1)];
  const applies = (changes: { result: Outcome }[]) => changes.filter((c) => c.result === "applies").length;
  return (
    <section className="evidence">
      <div className="evidence-head">
        <HelpCircle size={18} />
        <span>One missing fact decides {question.ruleIds.length === 1 ? "a rule" : `${question.ruleIds.length} rules`} here</span>
        {report.questions.length > 1 && (
          <div className="evidence-switch">
            {report.questions.map((q, i) => (
              <button key={q.id} className={i === index ? "active" : ""} onClick={() => setIndex(i)}>
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <h3 className="evidence-question">{question.question}</h3>
      <div className="branches">
        {question.branches.map((branch) => {
          const count = applies(branch.changes);
          return (
            <button key={String(branch.value)} className="branch" onClick={() => onAnswer(question.field, branch.value)}>
              <span className="branch-label">{branch.label}</span>
              <span className="branch-result">
                {count > 0
                  ? `${count} of ${branch.changes.length} apply`
                  : branch.changes.every((c) => c.result === "unknown")
                    ? "Still unsettled"
                    : `None of ${branch.changes.length} apply`}
              </span>
              <span className="branch-rules">
                {branch.changes.map((change) => (
                  <span key={change.ruleId} className={`dot dot-${change.result}`} title={`${rulesById.get(change.ruleId)?.title}: ${change.result.replace(/_/g, " ")}`} />
                ))}
              </span>
              <ArrowRight size={16} className="branch-arrow" />
            </button>
          );
        })}
      </div>
      <p className="evidence-foot">
        <strong>Where to check:</strong> {question.suggestedEvidence}{" "}
        <a
          className="link"
          href="#"
          onClick={async (event) => {
            event.preventDefault();
            const response = await fetch("/api/fixtures", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ addressId: report.property.id, asOf: report.asOf, facts: report.scenarioFacts }),
            });
            const blob = await response.blob();
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `fixtures-${report.property.id}.json`;
            link.click();
          }}
        >
          Save these cases as tests
        </a>
      </p>
    </section>
  );
}

/* ---------------- rule detail ---------------- */

function RuleDrawer({
  rule,
  result,
  boot,
  onClose,
  onSource,
}: {
  rule: Rule;
  result?: RuleResult;
  boot: Bootstrap;
  onClose: () => void;
  onSource: (id: string, highlight: string) => void;
}) {
  const doc = boot.documents.find((d) => d.id === rule.sourceId);
  return (
    <Drawer onClose={onClose}>
      <div className="drawer-body">
        <p className="eyebrow">
          {categoryLabel(rule.category)} · {place(rule)}
        </p>
        <h2 className="drawer-title">{rule.title}</h2>
        {result && (
          <div className="drawer-status">
            <Pill outcome={result.result} review={result.missingFacts.length === 0} />
            <span>{result.explanation}</span>
          </div>
        )}
        {!result && (
          <div className="drawer-status">
            <span className="pill pill-gray">{rule.status.replace(/_/g, " ")}</span>
          </div>
        )}

        <section className="block">
          <h3>What it requires</h3>
          <p>{rule.requirement}</p>
          {rule.keyValue && <p className="key-value">{rule.keyValue}</p>}
        </section>

        {result && result.trace.length > 0 && (
          <section className="block">
            <h3>How we got there</h3>
            <ul className="trace">
              {result.trace.map((step, index) => (
                <li key={index} className={`trace-${step.outcome}`}>
                  <span className="trace-icon">{step.outcome === "pass" ? <Check size={13} /> : step.outcome === "fail" ? <X size={13} /> : "?"}</span>
                  <span>
                    <strong>{step.label}.</strong> {step.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="block">
          <h3>Source</h3>
          <blockquote className="quote">{rule.quotedSpan.replace(/\s+/g, " ").trim()}</blockquote>
          <p className="source-line">
            <span>{rule.citation}</span>
            <button className="link" onClick={() => onSource(rule.sourceId, rule.quotedSpan)}>
              <FileText size={14} /> Read in context
            </button>
            {rule.sourceUrl && (
              <a className="link" href={rule.sourceUrl} target="_blank" rel="noreferrer">
                Original <ExternalLink size={13} />
              </a>
            )}
          </p>
          {doc?.retrievedAt && <p className="muted small">Retrieved {doc.retrievedAt.slice(0, 10)}. Quote checked word for word against the stored text.</p>}
        </section>

        <section className="block details">
          <h3>Details</h3>
          <dl>
            <dt>Starts</dt>
            <dd>{rule.effectiveDate ? formatDate(rule.effectiveDate.length === 10 ? rule.effectiveDate : `${rule.effectiveDate}-01`.slice(0, 10)) : "Not stated in the source"}</dd>
            {rule.endDate && (
              <>
                <dt>Ends</dt>
                <dd>{formatDate(rule.endDate)}</dd>
              </>
            )}
            <dt>Covers</dt>
            <dd>{rule.coverageDescription || "—"}</dd>
            {rule.exemptions.length > 0 && (
              <>
                <dt>Exemptions</dt>
                <dd>
                  <ul className="plain">
                    {rule.exemptions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {rule.alsoIn.length > 0 && (
              <>
                <dt>Also in</dt>
                <dd>{rule.alsoIn.join(", ")}</dd>
              </>
            )}
            {rule.warnings.length > 0 && (
              <>
                <dt>Review notes</dt>
                <dd>
                  <ul className="plain">
                    {rule.warnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            <dt>Rule ID</dt>
            <dd className="mono">{rule.id}</dd>
          </dl>
        </section>
      </div>
    </Drawer>
  );
}

/* ---------------- law changes ---------------- */

function ChangesView({
  boot,
  changeId,
  onChange,
  onAddress,
  onRule,
}: {
  boot: Bootstrap;
  changeId: string;
  onChange: (id: string) => void;
  onAddress: (id: string, date: string) => void;
  onRule: (rule: Rule) => void;
}) {
  const [report, setReport] = useState<ChangeReport | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    setReport(null);
    setError("");
    api<ChangeReport>(`/api/changes/${changeId}`)
      .then(setReport)
      .catch((err: Error) => setError(err.message));
  }, [changeId]);
  const rows = (report?.properties ?? []).filter((p) =>
    `${p.address} ${p.city ?? p.postalCity}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="split">
      <nav className="side-list">
        {boot.changes.map((change) => (
          <button
            key={change.id}
            className={`side-item${change.id === changeId ? " side-item-active" : ""}`}
            onClick={() => onChange(change.id)}
          >
            <span className="side-id">{change.id}</span>
            <span className="side-title">{change.title}</span>
            <span className="side-tag">{change.status}</span>
          </button>
        ))}
      </nav>
      <section className="change">
        {error && <p className="error">{error}</p>}
        {!report && !error && <p className="muted">Calculating…</p>}
        {report && (
          <>
            <p className="eyebrow">
              {report.id} · {report.status}
            </p>
            <h1 className="change-title">{report.title}</h1>
            <p className="change-expect">{report.description}</p>
            {report.beforeDate !== report.afterDate && (
              <p className="dates">
                {formatDate(report.beforeDate)} <ArrowRight size={14} /> {formatDate(report.afterDate)}
              </p>
            )}
            <div className="stats">
              <div className="stat">
                <span className="stat-number">{report.affectedAddressIds.length}</span>
                <span className="stat-label">addresses affected</span>
              </div>
              {report.conflictAddressIds.length > 0 && (
                <div className="stat">
                  <span className="stat-number">{report.conflictAddressIds.length}</span>
                  <span className="stat-label">flagged for a possible conflict</span>
                </div>
              )}
              {report.unresolvedCount > 0 && (
                <div className="stat">
                  <span className="stat-number">{report.unresolvedCount}</span>
                  <span className="stat-label">couldn't be settled</span>
                </div>
              )}
            </div>
            {report.ruleIds.length > 0 && (
              <div className="rule-chips">
                {report.ruleIds.map((id) => {
                  const rule = boot.rules.find((r) => r.id === id)!;
                  return (
                    <button key={id} className="chip chip-button" onClick={() => onRule(rule)}>
                      {rule.citation}
                    </button>
                  );
                })}
              </div>
            )}
            {report.properties.length > 0 ? (
              <>
                <div className="table-tools">
                  <h2 className="group-title">Affected addresses</h2>
                  <input className="small-search" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <ul className="rows">
                  {rows.slice(0, 200).map((p) => (
                    <li key={p.id}>
                      <button className="row row-compact" onClick={() => onAddress(p.id, report.afterDate)}>
                        <span className="row-main">
                          <span className="row-title">{p.address}</span>
                        </span>
                        <span className="row-meta">
                          <span className="row-place">
                            {p.city ?? p.postalCity}, {p.state}
                          </span>
                          {report.conflictAddressIds.includes(p.id) && <span className="pill pill-amber">Conflict</span>}
                        </span>
                        <ChevronRight size={16} className="row-chevron" />
                      </button>
                    </li>
                  ))}
                </ul>
                {rows.length > 200 && <p className="muted small">Showing 200 of {rows.length}. Export for the full list.</p>}
              </>
            ) : (
              <p className="empty">No address is affected.</p>
            )}
            <p className="notes">{report.notes}</p>
          </>
        )}
      </section>
    </div>
  );
}

/* ---------------- sources ---------------- */

function SourcesView({ boot, onSource, onAdded }: { boot: Bootstrap; onSource: (id: string) => void; onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("All");
  const [adding, setAdding] = useState(false);
  const docs = boot.documents.filter(
    (doc) =>
      (state === "All" || doc.jurisdiction.endsWith(state)) &&
      `${doc.id} ${doc.title} ${doc.jurisdiction}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="sources">
      <div className="sources-head">
        <div>
          <h1 className="page-title">Sources</h1>
          <p className="muted">
            {boot.stats.capturedSources} documents with text became {boot.rules.length} rules. Every rule quotes its source word for word.
          </p>
        </div>
        <button className="button" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add a law
        </button>
      </div>
      <div className="filters">
        {["All", "CA", "NJ", "MA"].map((value) => (
          <button key={value} className={`filter${state === value ? " filter-active" : ""}`} onClick={() => setState(value)}>
            {value}
          </button>
        ))}
        <input className="small-search push" placeholder="Search sources" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ul className="rows">
        {docs.map((doc) => (
          <li key={doc.id}>
            <button className="row" onClick={() => onSource(doc.id)} disabled={doc.captureStatus === "link_only"}>
              <span className="mono source-id">{doc.id}</span>
              <span className="row-main">
                <span className="row-title">{doc.title}</span>
                <span className="row-sub">{doc.jurisdiction}</span>
              </span>
              <span className="row-meta">
                {doc.captureStatus === "link_only" || doc.captureStatus === "capture_missing" ? (
                  <span className="muted small">Link only</span>
                ) : (
                  <span className="row-value">{doc.ruleCount ? `${doc.ruleCount} ${doc.ruleCount === 1 ? "rule" : "rules"}` : "No rules"}</span>
                )}
              </span>
              <ChevronRight size={16} className="row-chevron" />
            </button>
          </li>
        ))}
      </ul>
      {adding && (
        <AddLaw
          boot={boot}
          onClose={() => setAdding(false)}
          onDone={() => {
            onAdded();
          }}
        />
      )}
    </div>
  );
}

function highlight(text: string, quotes: string[]): ReactNode[] {
  const spans = quotes
    .map((quote) => ({ start: text.indexOf(quote), length: quote.length }))
    .filter((span) => span.start >= 0)
    .sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start < cursor) return;
    parts.push(text.slice(cursor, span.start));
    parts.push(
      <mark key={index} id={`q${index}`}>
        {text.slice(span.start, span.start + span.length)}
      </mark>,
    );
    cursor = span.start + span.length;
  });
  parts.push(text.slice(cursor));
  return parts;
}

function SourceDrawer({
  id,
  highlight: focus,
  boot,
  onClose,
  onRule,
}: {
  id: string;
  highlight?: string;
  boot: Bootstrap;
  onClose: () => void;
  onRule: (rule: Rule) => void;
}) {
  const [doc, setDoc] = useState<SourceDocument | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const rules = boot.rules.filter((rule) => rule.sourceId === id || rule.alsoIn.includes(id));
  useEffect(() => {
    api<SourceDocument>(`/api/sources/${id}`).then(setDoc).catch(() => undefined);
  }, [id]);
  useEffect(() => {
    if (!doc) return;
    const marks = textRef.current?.querySelectorAll("mark") ?? [];
    const target = [...marks].find((mark) => focus && mark.textContent === focus) ?? marks[0];
    target?.scrollIntoView({ block: "center" });
  }, [doc, focus]);
  const body = doc ? doc.text.replace(/^SOURCE:.*\n(RETRIEVED:.*\n)?/, "") : "";
  return (
    <Drawer onClose={onClose} wide>
      <div className="drawer-body">
        <p className="eyebrow">
          {id} · {doc?.jurisdiction}
        </p>
        <h2 className="drawer-title">{doc?.title ?? "Loading…"}</h2>
        {doc && (
          <p className="source-line">
            {doc.retrievedAt && <span className="muted">Retrieved {doc.retrievedAt.slice(0, 10)}</span>}
            {doc.url && (
              <a className="link" href={doc.url} target="_blank" rel="noreferrer">
                Original <ExternalLink size={13} />
              </a>
            )}
          </p>
        )}
        {rules.length > 0 && (
          <div className="rule-chips">
            {rules.map((rule) => (
              <button key={rule.id} className="chip chip-button" onClick={() => onRule(rule)}>
                {categoryLabel(rule.category)} · {rule.citation}
              </button>
            ))}
          </div>
        )}
        <div className="source-text" ref={textRef}>
          {doc ? highlight(body, rules.filter((r) => r.sourceId === id).map((r) => r.quotedSpan)) : null}
        </div>
      </div>
    </Drawer>
  );
}

function AddLaw({ boot, onClose, onDone }: { boot: Bootstrap; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [jurisdiction, setJurisdiction] = useState("Cambridge, MA");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ rules: Rule[] } | null>(null);
  useEscape(onClose);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ rules: Rule[] }>("/api/extract", { title, jurisdiction, url, text });
      setResult(data);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay overlay-center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <button className="icon-button drawer-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 className="drawer-title">Add a law</h2>
        {!result ? (
          <>
            <p className="muted">Paste an ordinance or statute. It's read by the same pipeline as the corpus, then every address updates.</p>
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cambridge Ord. 2026-12" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Jurisdiction</span>
                <input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="CA, NJ, MA or City, ST" />
              </label>
              <label className="field">
                <span>Link (optional)</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              </label>
            </div>
            <label className="field">
              <span>Text</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="modal-foot">
              <span className="muted small">
                {boot.liveModel
                  ? `Uses Claude Haiku. $${boot.budget.remaining.toFixed(2)} of the $${boot.budget.limit} cap left.`
                  : "No API key is configured, so extraction is unavailable."}
              </span>
              <button className="button" disabled={busy || !boot.liveModel || !title || text.length < 80} onClick={submit}>
                {busy ? "Reading…" : "Extract rules"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{result.rules.length === 1 ? "1 rule" : `${result.rules.length} rules`} extracted and added.</p>
            <ul className="plain extracted">
              {result.rules.map((rule) => (
                <li key={rule.id}>
                  <strong>{rule.title}</strong>
                  <span className="muted small">
                    {categoryLabel(rule.category)} · {rule.status.replace(/_/g, " ")}
                    {rule.effectiveDate ? ` · starts ${rule.effectiveDate}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <div className="modal-foot">
              <span />
              <button className="button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
