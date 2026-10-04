import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, animate, motion } from "motion/react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Minus,
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

const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 } as const;
const SOFT_SPRING = { type: "spring", stiffness: 300, damping: 34 } as const;

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "rent_increase_limits", label: "Rent increases" },
  { id: "just_cause_eviction", label: "Evictions" },
  { id: "security_deposits", label: "Security deposits" },
  { id: "application_screening_fees", label: "Application fees" },
  { id: "screening_restrictions", label: "Tenant screening" },
  { id: "algorithmic_rent_setting", label: "Rent-pricing software" },
];
const categoryLabel = (id: Category) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
const categoryIndex = (id: Category) => CATEGORIES.findIndex((c) => c.id === id);
const STATUS: Record<Exclude<Outcome, "does_not_apply">, { label: string; tone: string }> = {
  applies: { label: "Applies", tone: "green" },
  unknown: { label: "Needs a fact", tone: "amber" },
  superseded: { label: "Overridden", tone: "gray" },
  not_yet_effective: { label: "Upcoming", tone: "blue" },
  pending: { label: "Proposed", tone: "gray" },
};
const SECTIONS: { outcome: Exclude<Outcome, "does_not_apply">; title: string }[] = [
  { outcome: "applies", title: "Applies here" },
  { outcome: "unknown", title: "Can't tell yet" },
  { outcome: "not_yet_effective", title: "Coming up" },
  { outcome: "superseded", title: "Replaced by a stricter local rule" },
  { outcome: "pending", title: "Proposed, not law yet" },
];
const STATE_NAMES: Record<string, string> = { CA: "California", NJ: "New Jersey", MA: "Massachusetts" };
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const place = (rule: Rule) =>
  rule.level === "state" ? `${STATE_NAMES[rule.state] ?? rule.state} law` : `${rule.jurisdiction.replace(/, \w\w$/, "")} law`;
const headlineOf = (rule: Rule) => rule.headline ?? rule.title;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

type View = "home" | "address" | "changes" | "sources";
type Route = { view: View; id?: string };
const readRoute = (): Route => {
  const [, view, id] = window.location.hash.split("/");
  if (view === "changes" || view === "sources") return { view, id };
  if (view === "address" && id) return { view: "address", id };
  return { view: "home" };
};
const routeHash = (route: Route) => (route.view === "home" ? "#/" : `#/${route.view}${route.id ? `/${route.id}` : ""}`);

function Pill({ outcome, review }: { outcome: Outcome; review?: boolean }) {
  if (outcome === "does_not_apply") return <span className="pill pill-gray">Doesn't apply</span>;
  const status = STATUS[outcome];
  if (outcome === "unknown" && review) return <span className="pill pill-amber">Needs review</span>;
  return <span className={`pill pill-${status.tone}`}>{status.label}</span>;
}

function StatusIcon({ outcome, size = 22 }: { outcome: Outcome; size?: number }) {
  const icon = size * 0.6;
  const content =
    outcome === "applies" ? (
      <Check size={icon} strokeWidth={2.6} />
    ) : outcome === "unknown" ? (
      <span className="status-q">?</span>
    ) : outcome === "not_yet_effective" ? (
      <Clock size={icon} strokeWidth={2.4} />
    ) : (
      <Minus size={icon} strokeWidth={2.6} />
    );
  return (
    <span className={`status-icon status-${outcome}`} style={{ width: size, height: size }} aria-hidden>
      {content}
    </span>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
}

let scrollLocks = 0;
function useScrollLock() {
  useEffect(() => {
    scrollLocks++;
    document.body.style.overflow = "hidden";
    return () => {
      scrollLocks--;
      if (!scrollLocks) document.body.style.overflow = "";
    };
  }, []);
}

/** Children rise into place one after another. */
function Reveal({ i = 0, children, className }: { i?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 + i * 0.05, duration: 0.4, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || reducedMotion()) return;
    const controls = animate(0, value, {
      duration: 0.9,
      ease: EASE,
      onUpdate: (latest) => (node.textContent = String(Math.round(latest))),
      onComplete: () => (node.textContent = String(value)),
    });
    return () => controls.stop();
  }, [value]);
  return <span ref={ref}>{value}</span>;
}

function Drawer({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  useScrollLock();
  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.aside
        className={`drawer${wide ? " drawer-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 360, damping: 40 }}
      >
        <motion.button className="icon-button drawer-close" onClick={onClose} aria-label="Close" whileTap={{ scale: 0.9 }}>
          <X size={18} />
        </motion.button>
        {children}
      </motion.aside>
    </motion.div>
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
  const [entered, setEntered] = useState<Record<string, PropertyRecord>>({});
  const [lastAddress, setLastAddress] = useState<string | null>(null);

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
    window.addEventListener("popstate", listener);
    window.addEventListener("hashchange", listener);
    return () => {
      window.removeEventListener("popstate", listener);
      window.removeEventListener("hashchange", listener);
    };
  }, []);
  const go = (next: Route) => {
    if (window.location.hash !== routeHash(next)) window.history.pushState(null, "", routeHash(next));
    setRoute(next);
  };
  const pageKey = route.view === "address" ? `address-${route.id}` : route.view;
  useEffect(() => {
    setOpenRule(null);
    setOpenSource(null);
    window.scrollTo({ top: 0 });
    if (route.view === "address" && route.id) setLastAddress(route.id);
  }, [pageKey]);

  // A typed address survives a page reload while the server still remembers it.
  useEffect(() => {
    const id = route.id;
    if (!boot || route.view !== "address" || !id?.startsWith("ADDR-") || entered[id]) return;
    api<PropertyRecord>(`/api/properties/${id}`)
      .then((found) => setEntered((current) => ({ ...current, [found.id]: found })))
      .catch(() => go({ view: "home" }));
  }, [boot, route, entered]);

  if (error) return <div className="center-message">Couldn't load the data: {error}</div>;
  if (!boot)
    return (
      <div className="center-message">
        <Loader2 size={20} className="spin" />
      </div>
    );

  const property =
    route.view === "address" && route.id ? (boot.properties.find((p) => p.id === route.id) ?? entered[route.id]) : undefined;
  const onEntered = (found: PropertyRecord) => {
    setEntered((current) => ({ ...current, [found.id]: found }));
    go({ view: "address", id: found.id });
  };
  const onAddress = (id: string) => go({ view: "address", id });
  const lookupActive = route.view === "address" || route.view === "home";

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <motion.button className="brand" onClick={() => go({ view: "home" })} whileTap={{ scale: 0.96 }}>
              <span className="brand-mark">(R)</span>estate
            </motion.button>
            <nav className="tabs">
              {(
                [
                  ["address", "Lookup"],
                  ["changes", "Law changes"],
                  ["sources", "Sources"],
                ] as [View, string][]
              ).map(([view, label]) => {
                const active = view === "address" ? lookupActive : route.view === view;
                return (
                  <button
                    key={view}
                    className={`tab${active ? " tab-active" : ""}`}
                    onClick={() =>
                      view === "address"
                        ? go(route.view !== "address" && lastAddress ? { view: "address", id: lastAddress } : { view: "home" })
                        : go({ view })
                    }
                  >
                    {active && <motion.span layoutId="tab-bg" className="tab-bg" transition={SPRING} />}
                    {label}
                  </button>
                );
              })}
            </nav>
            <ExportMenu asOf={asOf || boot.defaultAsOf} />
          </div>
        </header>

        <main className="page">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pageKey}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: EASE }}
            >
              {route.view === "home" && <HomeView boot={boot} onPick={onAddress} onEntered={onEntered} />}
              {route.view === "address" &&
                (property ? (
                  <AddressView
                    boot={boot}
                    property={property}
                    onEntered={onEntered}
                    asOf={asOf || boot.defaultAsOf}
                    setAsOf={setAsOf}
                    onAddress={onAddress}
                    onRule={(rule, result) => setOpenRule({ rule, result })}
                  />
                ) : route.id?.startsWith("ADDR-") ? (
                  <div className="center-block">
                    <Loader2 size={20} className="spin" />
                  </div>
                ) : (
                  <div className="center-block">
                    <p className="muted">That address isn't in the sample.</p>
                    <button className="link" onClick={() => go({ view: "home" })}>
                      Search again
                    </button>
                  </div>
                ))}
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
              {route.view === "sources" && <SourcesView boot={boot} onSource={(id) => setOpenSource({ id })} onAdded={load} />}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="footer">
          Not legal advice. Answers come from {boot.stats.capturedSources} source documents and the public assessor sample, as of{" "}
          {formatDate(boot.defaultAsOf)}.
        </footer>

        <AnimatePresence>
          {openRule && (
            <RuleDrawer
              key={`rule-${openRule.rule.id}`}
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
        </AnimatePresence>
        <AnimatePresence>
          {openSource && (
            <SourceDrawer
              key={`source-${openSource.id}`}
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
        </AnimatePresence>
      </div>
    </MotionConfig>
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
      <motion.button className="button button-quiet" onClick={() => setOpen(!open)} whileTap={{ scale: 0.96 }} aria-expanded={open}>
        <Download size={16} /> <span className="hide-small">Export</span>
        <motion.span className="menu-caret" animate={{ rotate: open ? 180 : 0 }} transition={SPRING}>
          <ChevronDown size={14} />
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu-list"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {[
              ["rules", "Rules", "Every extracted rule with its citation"],
              ["lookups", "Lookups", `All 500 addresses as of ${asOf}`],
              ["changes", "Change tests", "Affected addresses for T1–T5"],
            ].map(([kind, title, hint], i) => (
              <motion.a
                key={kind}
                className="menu-item"
                href={`/api/export/${kind}?asOf=${asOf}`}
                onClick={() => setOpen(false)}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 + i * 0.03, duration: 0.2 }}
              >
                <span>{title}</span>
                <small>{hint}</small>
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- home ---------------- */

function HomeView({
  boot,
  onPick,
  onEntered,
}: {
  boot: Bootstrap;
  onPick: (id: string) => void;
  onEntered: (property: PropertyRecord) => void;
}) {
  const examples = useMemo(
    () =>
      ["Berkeley", "Hoboken", "Boston"]
        .map((city) => boot.properties.find((p) => p.city === city && p.facts.year_built && p.facts.units) ?? boot.properties.find((p) => p.city === city))
        .filter((p): p is PropertyRecord => Boolean(p)),
    [boot.properties],
  );
  return (
    <div className="home">
      <motion.h1 className="home-title" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        Which rental laws apply <br className="hide-small" />
        to your home?
      </motion.h1>
      <motion.div
        className="home-search"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
      >
        <AddressSearch big autoFocus boot={boot} placeholder="Enter an address in CA, NJ or MA" onPick={onPick} onEntered={onEntered} />
      </motion.div>
      <motion.div className="home-examples" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <span>Try</span>
        {examples.map((p, i) => (
          <motion.button
            key={p.id}
            className="example"
            onClick={() => onPick(p.id)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.06, duration: 0.4, ease: EASE }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            {p.address.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())}, {p.city}
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}

/* ---------------- lookup ---------------- */

function AddressSearch({
  boot,
  placeholder,
  onPick,
  onEntered,
  big,
  autoFocus,
}: {
  boot: Bootstrap;
  placeholder: string;
  onPick: (id: string) => void;
  onEntered: (property: PropertyRecord) => void;
  big?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = useMemo(() => {
    const words = query.toLowerCase().replace(/[,.#]/g, " ").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return boot.properties
      .filter((p) => {
        const text = `${p.address} ${p.city ?? p.postalCity} ${p.state} ${p.id}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .slice(0, 6);
  }, [query, boot.properties]);
  const canLookup = query.trim().length >= 6;
  const total = matches.length + (canLookup ? 1 : 0);
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQuery("");
  };
  const lookup = async () => {
    setBusy(true);
    setError("");
    setOpen(false);
    try {
      const found = await api<PropertyRecord>("/api/geocode", { address: query });
      setQuery("");
      onEntered(found);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`search${big ? " search-big" : ""}`}>
      <Search size={big ? 20 : 18} className="search-icon" />
      <input
        className="search-input"
        placeholder={placeholder}
        value={query}
        autoFocus={autoFocus}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setCursor(0);
          setError("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setCursor(Math.min(cursor + 1, total - 1));
          else if (event.key === "ArrowUp") setCursor(Math.max(cursor - 1, 0));
          else if (event.key === "Enter") {
            if (matches[cursor]) pick(matches[cursor].id);
            else if (canLookup) lookup();
          } else if (event.key === "Escape") setOpen(false);
        }}
        aria-label="Search the sample or type any address"
      />
      <AnimatePresence>
        {busy && (
          <motion.span className="search-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Loader2 size={15} className="spin" /> Finding address
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {error && (
          <motion.p className="search-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && total > 0 && (
          <motion.ul
            className="search-results"
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.16, ease: EASE }}
          >
            {matches.map((p, index) => (
              <li key={p.id}>
                <button className="search-result" onMouseDown={() => pick(p.id)} onMouseEnter={() => setCursor(index)}>
                  {index === cursor && <motion.span layoutId="search-active" className="search-active" transition={SPRING} />}
                  <span>{p.address}</span>
                  <small>
                    {p.city ?? p.postalCity}, {p.state}
                  </small>
                </button>
              </li>
            ))}
            {canLookup && (
              <li>
                <button
                  className="search-result search-any"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    lookup();
                  }}
                  onMouseEnter={() => setCursor(matches.length)}
                >
                  {cursor === matches.length && <motion.span layoutId="search-active" className="search-active" transition={SPRING} />}
                  <span className="search-any-label">
                    <MapPin size={15} /> Look up “{query.trim()}”
                  </span>
                  <small>Any address in CA, NJ or MA</small>
                </button>
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function rowSub(rule: Rule, result: RuleResult): string {
  if (result.result === "unknown")
    return `${result.missingFacts.length ? result.explanation.replace(/\.$/, "") : "Needs a human read of the source"} · ${place(rule)}`;
  if (result.result === "not_yet_effective")
    return `${rule.effectiveDate?.length === 10 ? `Starts ${formatDate(rule.effectiveDate)}` : "Start date not set"} · ${place(rule)}`;
  return `${categoryLabel(rule.category)} · ${place(rule)}`;
}

function RuleRow({ rule, result, index, onOpen }: { rule: Rule; result: RuleResult; index: number; onOpen: () => void }) {
  const delay = Math.min(index, 12) * 0.035;
  return (
    <motion.li
      layout="position"
      layoutId={`row-${rule.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ opacity: { duration: 0.3, delay }, y: { duration: 0.4, delay, ease: EASE }, layout: SOFT_SPRING }}
    >
      <motion.button className="row" onClick={onOpen} whileTap={{ scale: 0.995 }}>
        <StatusIcon outcome={result.result} />
        <span className="row-main">
          <span className="row-title">{headlineOf(rule)}</span>
          <span className="row-sub">{rowSub(rule, result)}</span>
        </span>
        <ChevronRight size={16} className="row-chevron" />
      </motion.button>
    </motion.li>
  );
}

function AddressView({
  boot,
  property,
  onEntered,
  asOf,
  setAsOf,
  onAddress,
  onRule,
}: {
  boot: Bootstrap;
  property: PropertyRecord;
  onEntered: (property: PropertyRecord) => void;
  asOf: string;
  setAsOf: (date: string) => void;
  onAddress: (id: string) => void;
  onRule: (rule: Rule, result: RuleResult) => void;
}) {
  const addressId = property.id;
  const typed = addressId.startsWith("ADDR-");
  const [scenario, setScenario] = useState<Facts>({});
  const [report, setReport] = useState<LookupReport | null>(null);
  const [error, setError] = useState("");
  const rulesById = useMemo(() => new Map(boot.rules.map((rule) => [rule.id, rule])), [boot.rules]);

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

  const ready = report?.property.id === addressId;
  const results = (ready ? report.results : [])
    .filter((r) => r.result !== "does_not_apply" && rulesById.has(r.ruleId))
    .sort((a, b) => categoryIndex(rulesById.get(a.ruleId)!.category) - categoryIndex(rulesById.get(b.ruleId)!.category));
  const answers = Object.entries(scenario);

  return (
    <div className="lookup">
      <div className="lookup-bar">
        <AddressSearch
          boot={boot}
          placeholder={`${property.address}, ${property.city ?? property.postalCity}`}
          onPick={onAddress}
          onEntered={onEntered}
        />
        <label className="date-field">
          <span>As of</span>
          <input type="date" value={asOf} onChange={(event) => event.target.value && setAsOf(event.target.value)} />
        </label>
      </div>

      <PropertyHeader property={property} asOf={asOf} scenario={scenario} />

      <AnimatePresence initial={false}>
        {answers.length > 0 && (
          <motion.div
            className="whatif"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <div className="whatif-inner">
              <span className="whatif-label">{typed ? "Your answers" : "What-if"}</span>
              <AnimatePresence mode="popLayout" initial={false}>
                {answers.map(([field, value]) => (
                  <motion.span
                    key={field}
                    layout
                    className="chip"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={SPRING}
                  >
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
                  </motion.span>
                ))}
              </AnimatePresence>
              <span className="whatif-note">
                {typed ? "Entered by you, not from an official record." : "Not from the record. The original data is unchanged."}
              </span>
              <button className="link" onClick={() => setScenario({})}>
                Reset
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="error">{error}</p>}

      <AnimatePresence initial={false}>
        {ready && report.questions.length > 0 && (
          <motion.div
            key="evidence"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <EvidenceCard report={report} rulesById={rulesById} onAnswer={(field, value) => setScenario({ ...scenario, [field]: value })} />
          </motion.div>
        )}
      </AnimatePresence>

      {!ready && !error && (
        <div className="skeleton" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      )}
      {ready && results.length === 0 && <p className="empty">No rule in our sources covers this address.</p>}

      <LayoutGroup>
        {SECTIONS.map((section) => {
          const items = results.filter((r) => r.result === section.outcome);
          if (!items.length) return null;
          return (
            <motion.section key={section.outcome} layout="position" className="status-section" transition={{ layout: SOFT_SPRING }}>
              <div className="section-head">
                <StatusIcon outcome={section.outcome} size={20} />
                <h2>{section.title}</h2>
                <motion.span
                  key={items.length}
                  className={`section-count count-${section.outcome}`}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={SPRING}
                >
                  {items.length}
                </motion.span>
              </div>
              <ul className="rows">
                {items.map((result, index) => (
                  <RuleRow
                    key={result.ruleId}
                    rule={rulesById.get(result.ruleId)!}
                    result={result}
                    index={index}
                    onOpen={() => onRule(rulesById.get(result.ruleId)!, result)}
                  />
                ))}
              </ul>
            </motion.section>
          );
        })}
      </LayoutGroup>
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
  const unitsText = units.kind === "missing" ? null : describeFact(units);
  return (
    <section className="property">
      <div>
        <Reveal>
          <h1 className="property-address">{property.address}</h1>
        </Reveal>
        <Reveal i={1}>
          <p className="property-place">
            {city ?? property.postalCity}, {property.state} {plausibleZip(property)}
          </p>
        </Reveal>
      </div>
      <Reveal i={2}>
        <dl className="facts">
          <div className="fact" title={units.kind === "range" ? units.basis : undefined}>
            <dt>Units</dt>
            <AnimatePresence mode="wait" initial={false}>
              <motion.dd key={unitsText ?? "none"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {unitsText ?? <span className="muted">Unknown</span>}
              </motion.dd>
            </AnimatePresence>
            {units.kind === "range" && <small>from use code</small>}
          </div>
          <div className="fact">
            <dt>Built</dt>
            <AnimatePresence mode="wait" initial={false}>
              <motion.dd key={String(year ?? "none")} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {year ? String(year) : <span className="muted">Unknown</span>}
              </motion.dd>
            </AnimatePresence>
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
            <small>
              {!city
                ? `mailed as ${property.postalCity}`
                : /no local laws|outside any/.test(property.jurisdictionMethod)
                  ? "only state law loaded"
                  : "inside city limits"}
            </small>
          </div>
        </dl>
      </Reveal>
      {property.id.startsWith("ADDR-") && (
        <Reveal i={3} className="property-note">
          No assessor record for this address, so building facts start unknown. Answer the question below and the rules update.
        </Reveal>
      )}
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
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState("");
  useEffect(() => setIndex(0), [report.property.id]);
  const question = report.questions[Math.min(index, report.questions.length - 1)];
  const applies = (changes: { result: Outcome }[]) => changes.filter((c) => c.result === "applies").length;
  const count = question.ruleIds.length;
  return (
    <section className="evidence">
      <div className="evidence-head">
        <span className="evidence-kicker">One answer settles {count === 1 ? "a rule" : `${count} rules`}</span>
        {report.questions.length > 1 && (
          <div className="evidence-switch">
            {report.questions.map((q, i) => (
              <button key={q.id} className={i === index ? "active" : ""} onClick={() => setIndex(i)}>
                {i === index && <motion.span layoutId="question-switch" className="switch-bg" transition={SPRING} />}
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={question.id}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12, transition: { duration: 0.12 } }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          <h3 className="evidence-question">{question.question}</h3>
          <div className="branches">
            {question.branches.map((branch, i) => {
              const yes = applies(branch.changes);
              return (
                <motion.button
                  key={String(branch.value)}
                  className="branch"
                  onClick={() => onAnswer(question.field, branch.value)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 + i * 0.05, duration: 0.35, ease: EASE }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <span className="branch-label">{branch.label}</span>
                  <span className={`branch-result${yes > 0 ? " branch-yes" : ""}`}>
                    {yes > 0
                      ? `${yes} of ${branch.changes.length} apply`
                      : branch.changes.every((c) => c.result === "unknown")
                        ? "Still unsettled"
                        : `None of ${branch.changes.length} apply`}
                  </span>
                  <span className="branch-rules">
                    {branch.changes.map((change, d) => (
                      <motion.span
                        key={change.ruleId}
                        className={`dot dot-${change.result}`}
                        title={`${headlineOf(rulesById.get(change.ruleId)!)} (${change.result.replace(/_/g, " ")})`}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.12 + i * 0.05 + d * 0.02, ...SPRING }}
                      />
                    ))}
                  </span>
                  <ArrowRight size={16} className="branch-arrow" />
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>
      {(question.field === "units" || question.field === "year_built") && (
        <form
          className="custom"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(custom);
            const year = question.field === "year_built";
            const ok = Number.isInteger(value) && (year ? value >= 1700 && value <= new Date().getFullYear() : value >= 1 && value <= 5000);
            if (!ok) {
              setCustomError(year ? "Enter a year like 1962." : "Enter a whole number of units.");
              return;
            }
            setCustom("");
            setCustomError("");
            onAnswer(question.field, value);
          }}
        >
          <label htmlFor="custom-value">{question.field === "units" ? "Know the exact count?" : "Know the exact year?"}</label>
          <input
            id="custom-value"
            inputMode="numeric"
            placeholder={question.field === "units" ? "e.g. 12" : "e.g. 1962"}
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              setCustomError("");
            }}
          />
          <motion.button className="button button-small" disabled={!custom.trim()} whileTap={{ scale: 0.95 }}>
            Apply
          </motion.button>
          <AnimatePresence>
            {customError && (
              <motion.span className="custom-error" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                {customError}
              </motion.span>
            )}
          </AnimatePresence>
        </form>
      )}
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
        <Reveal>
          <p className="eyebrow">
            {categoryLabel(rule.category)} · {place(rule)}
          </p>
          <h2 className="drawer-title">{headlineOf(rule)}</h2>
          {rule.headline && <p className="drawer-official">{rule.title}</p>}
          <div className="drawer-status">
            {result ? (
              <>
                <Pill outcome={result.result} review={result.missingFacts.length === 0} />
                <span>{result.explanation}</span>
              </>
            ) : (
              <span className="pill pill-gray">{rule.status.replace(/_/g, " ")}</span>
            )}
          </div>
        </Reveal>

        <Reveal i={1} className="block">
          <h3>What the law says</h3>
          <p>{rule.requirement}</p>
          {rule.keyValue && <p className="key-value">{rule.keyValue}</p>}
        </Reveal>

        {result && result.trace.length > 0 && (
          <Reveal i={2} className="block">
            <h3>How we got there</h3>
            <ul className="trace">
              {result.trace.map((step, index) => (
                <motion.li
                  key={index}
                  className={`trace-${step.outcome}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + index * 0.05, duration: 0.3, ease: EASE }}
                >
                  <span className="trace-icon">
                    {step.outcome === "pass" ? <Check size={13} /> : step.outcome === "fail" ? <X size={13} /> : "?"}
                  </span>
                  <span>
                    <strong>{step.label}.</strong> {step.detail}
                  </span>
                </motion.li>
              ))}
            </ul>
          </Reveal>
        )}

        <Reveal i={3} className="block">
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
          {doc?.retrievedAt && (
            <p className="muted small">Retrieved {doc.retrievedAt.slice(0, 10)}. Quote checked word for word against the stored text.</p>
          )}
        </Reveal>

        <Reveal i={4} className="block details">
          <h3>Details</h3>
          <dl>
            <dt>Starts</dt>
            <dd>
              {rule.effectiveDate
                ? formatDate(rule.effectiveDate.length === 10 ? rule.effectiveDate : `${rule.effectiveDate}-01`.slice(0, 10))
                : "Not stated in the source"}
            </dd>
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
        </Reveal>
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
  const rows = (report?.properties ?? []).filter((p) => `${p.address} ${p.city ?? p.postalCity}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="split">
      <nav className="side-list">
        {boot.changes.map((change, i) => (
          <motion.button
            key={change.id}
            className={`side-item${change.id === changeId ? " side-item-active" : ""}`}
            onClick={() => onChange(change.id)}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: 0.35, ease: EASE }}
            whileTap={{ scale: 0.98 }}
          >
            {change.id === changeId && <motion.span layoutId="change-active" className="side-bg" transition={SPRING} />}
            <span className="side-id">{change.id}</span>
            <span className="side-title">{change.title}</span>
            <span className="side-tag">{change.status}</span>
          </motion.button>
        ))}
      </nav>
      <section className="change">
        {error && <p className="error">{error}</p>}
        <AnimatePresence mode="wait">
          {!report && !error ? (
            <motion.div key="loading" className="center-block" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Loader2 size={20} className="spin" />
            </motion.div>
          ) : report ? (
            <motion.div key={report.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}>
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
                  <span className="stat-number">
                    <CountUp value={report.affectedAddressIds.length} />
                  </span>
                  <span className="stat-label">addresses affected</span>
                </div>
                {report.conflictAddressIds.length > 0 && (
                  <div className="stat">
                    <span className="stat-number stat-amber">
                      <CountUp value={report.conflictAddressIds.length} />
                    </span>
                    <span className="stat-label">flagged for a possible conflict</span>
                  </div>
                )}
                {report.unresolvedCount > 0 && (
                  <div className="stat">
                    <span className="stat-number stat-muted">
                      <CountUp value={report.unresolvedCount} />
                    </span>
                    <span className="stat-label">couldn't be settled</span>
                  </div>
                )}
              </div>
              {report.ruleIds.length > 0 && (
                <div className="rule-chips">
                  {report.ruleIds.map((id) => {
                    const rule = boot.rules.find((r) => r.id === id)!;
                    return (
                      <motion.button key={id} className="chip chip-button" onClick={() => onRule(rule)} whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }}>
                        {rule.citation}
                      </motion.button>
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
                    {rows.slice(0, 200).map((p, i) => (
                      <motion.li
                        key={p.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 20) * 0.015, duration: 0.3, ease: EASE }}
                      >
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
                      </motion.li>
                    ))}
                  </ul>
                  {rows.length > 200 && <p className="muted small">Showing 200 of {rows.length}. Export for the full list.</p>}
                </>
              ) : (
                <p className="empty">No address is affected.</p>
              )}
              <p className="notes">{report.notes}</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
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
      (state === "All" || doc.jurisdiction.endsWith(state)) && `${doc.id} ${doc.title} ${doc.jurisdiction}`.toLowerCase().includes(query.toLowerCase()),
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
        <motion.button className="button" onClick={() => setAdding(true)} whileTap={{ scale: 0.96 }}>
          <Plus size={16} /> Add a law
        </motion.button>
      </div>
      <div className="filters">
        {["All", "CA", "NJ", "MA"].map((value) => (
          <button key={value} className={`filter${state === value ? " filter-active" : ""}`} onClick={() => setState(value)}>
            {state === value && <motion.span layoutId="source-filter" className="filter-bg" transition={SPRING} />}
            {value}
          </button>
        ))}
        <input className="small-search push" placeholder="Search sources" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <motion.ul className="rows" layout>
        <AnimatePresence initial={true} mode="popLayout">
          {docs.map((doc, i) => (
            <motion.li
              key={doc.id}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ delay: Math.min(i, 15) * 0.015, duration: 0.3, ease: EASE, layout: SOFT_SPRING }}
            >
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
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>
      <AnimatePresence>{adding && <AddLaw key="add-law" boot={boot} onClose={() => setAdding(false)} onDone={onAdded} />}</AnimatePresence>
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
    // Wait for the drawer to finish sliding in before scrolling to the quote.
    const timer = setTimeout(() => target?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" }), 350);
    return () => clearTimeout(timer);
  }, [doc, focus]);
  const body = doc ? doc.text.replace(/^SOURCE:.*\n(RETRIEVED:.*\n)?/, "") : "";
  return (
    <Drawer onClose={onClose} wide>
      <div className="drawer-body">
        <Reveal>
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
        </Reveal>
        {rules.length > 0 && (
          <Reveal i={1} className="rule-chips">
            {rules.map((rule) => (
              <motion.button key={rule.id} className="chip chip-button" onClick={() => onRule(rule)} whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }}>
                {categoryLabel(rule.category)} · {rule.citation}
              </motion.button>
            ))}
          </Reveal>
        )}
        <AnimatePresence>
          {doc && (
            <motion.div className="source-text" ref={textRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              {highlight(
                body,
                rules.filter((r) => r.sourceId === id).map((r) => r.quotedSpan),
              )}
            </motion.div>
          )}
        </AnimatePresence>
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
  useScrollLock();
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
    <motion.div
      className="overlay overlay-center"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="modal"
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={SOFT_SPRING}
        layout
      >
        <motion.button className="icon-button drawer-close" onClick={onClose} aria-label="Close" whileTap={{ scale: 0.9 }}>
          <X size={18} />
        </motion.button>
        <h2 className="drawer-title">Add a law</h2>
        <AnimatePresence mode="wait" initial={false}>
          {!result ? (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="muted modal-lede">Paste an ordinance or statute. It's read by the same pipeline as the corpus, then every address updates.</p>
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
              <AnimatePresence>
                {error && (
                  <motion.p className="error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="modal-foot">
                <span className="muted small">
                  {boot.liveModel
                    ? `Uses Claude Haiku. $${boot.budget.remaining.toFixed(2)} of the $${boot.budget.limit} cap left.`
                    : "No API key is configured, so extraction is unavailable."}
                </span>
                <motion.button
                  className="button"
                  disabled={busy || !boot.liveModel || !title || text.length < 80}
                  onClick={submit}
                  whileTap={{ scale: 0.96 }}
                >
                  {busy ? (
                    <>
                      <Loader2 size={16} className="spin" /> Reading
                    </>
                  ) : (
                    "Extract rules"
                  )}
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
              <p className="muted modal-lede">{result.rules.length === 1 ? "1 rule" : `${result.rules.length} rules`} extracted and added.</p>
              <ul className="plain extracted">
                {result.rules.map((rule, i) => (
                  <motion.li key={rule.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }}>
                    <strong>{headlineOf(rule)}</strong>
                    <span className="muted small">
                      {categoryLabel(rule.category)} · {rule.status.replace(/_/g, " ")}
                      {rule.effectiveDate ? ` · starts ${rule.effectiveDate}` : ""}
                    </span>
                  </motion.li>
                ))}
              </ul>
              <div className="modal-foot">
                <span />
                <motion.button className="button" onClick={onClose} whileTap={{ scale: 0.96 }}>
                  Done
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
