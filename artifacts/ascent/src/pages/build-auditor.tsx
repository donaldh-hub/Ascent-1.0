/**
 * Ascent Build Auditor — internal /dev/build-auditor page.
 *
 * Not customer-facing. Lives under /dev so it never collides with a real
 * customer route. Runs the auditor via POST /api/build-auditor/run and
 * renders the full 10-section markdown report plus the next-prompt block
 * with copy-to-clipboard, alongside a recent-audits sidebar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldAlert,
  PlayCircle,
  ClipboardCopy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RotateCw,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

type CheckStatus = "pass" | "partial" | "fail" | "manual";
type CheckSeverity = "low" | "medium" | "high" | "critical";

interface CheckResult {
  id: string;
  category: "route_integrity" | "data_flow" | "build_checklist" | "wiring" | "product_promise";
  title: string;
  status: CheckStatus;
  severity: CheckSeverity;
  expected: string;
  observed: string;
  notes?: string;
}

interface ManualTest {
  id: string;
  name: string;
  clickPath: string;
  expected: string;
  evidence: string;
  passCriteria: string;
  failCriteria: string;
}

interface AuditBundle {
  id?: number;
  createdAt?: string;
  buildLabel: string;
  generatedAt: string;
  status: "pass" | "partial" | "fail" | "needs_manual_verification";
  summary: string;
  counts: { pass: number; partial: number; fail: number; manual: number };
  checks: CheckResult[];
  manualTests: ManualTest[];
  reportMarkdown: string;
  nextPromptMarkdown: string;
}

interface HistoryItem {
  id: number;
  createdAt: string;
  buildLabel: string;
  status: AuditBundle["status"];
  summary: string;
  passCount: number;
  partialCount: number;
  failCount: number;
  manualCount: number;
}

const STATUS_META: Record<AuditBundle["status"], { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  pass: { label: "PASS", tone: "bg-status-green/15 text-status-green border-status-green/40", Icon: CheckCircle2 },
  partial: { label: "PARTIAL", tone: "bg-amber-500/15 text-amber-500 border-amber-500/40", Icon: AlertTriangle },
  fail: { label: "FAIL", tone: "bg-status-red/15 text-status-red border-status-red/40", Icon: XCircle },
  needs_manual_verification: {
    label: "NEEDS MANUAL VERIFICATION",
    tone: "bg-sky-500/15 text-sky-500 border-sky-500/40",
    Icon: HelpCircle,
  },
};

const CHECK_STATUS_META: Record<CheckStatus, { label: string; tone: string }> = {
  pass: { label: "Pass", tone: "bg-status-green/15 text-status-green border-status-green/40" },
  partial: { label: "Partial", tone: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  fail: { label: "Fail", tone: "bg-status-red/15 text-status-red border-status-red/40" },
  manual: { label: "Manual", tone: "bg-sky-500/15 text-sky-500 border-sky-500/40" },
};

const SEV_META: Record<CheckSeverity, string> = {
  low: "text-muted-foreground",
  medium: "text-amber-500",
  high: "text-orange-500",
  critical: "text-status-red",
};

const CATEGORY_TITLES: Record<CheckResult["category"], string> = {
  route_integrity: "Route Integrity",
  data_flow: "Data Flow",
  build_checklist: "Build Checklist (Requirement Match)",
  wiring: "Wiring Validation",
  product_promise: "Ascent Product Promise",
};

export default function BuildAuditorPage() {
  const [buildLabel, setBuildLabel] = useState<string>(defaultBuildLabel());
  const [running, setRunning] = useState(false);
  const [bundle, setBundle] = useState<AuditBundle | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/build-auditor/history");
      if (!res.ok) return;
      const data = (await res.json()) as { audits: HistoryItem[] };
      setHistory(data.audits);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const runAudit = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/build-auditor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildLabel }),
      });
      if (!res.ok) throw new Error(`audit run failed (HTTP ${res.status})`);
      const data = (await res.json()) as AuditBundle;
      setBundle(data);
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [buildLabel, loadHistory]);

  const openHistorical = useCallback(async (id: number) => {
    setError(null);
    try {
      const res = await fetch(`/api/build-auditor/${id}`);
      if (!res.ok) throw new Error(`failed to load audit #${id}`);
      const row = await res.json();
      // The stored row shape mirrors the DB columns; rebuild a bundle-like view.
      setBundle({
        id: row.id,
        createdAt: row.createdAt,
        buildLabel: row.buildLabel,
        generatedAt: row.createdAt,
        status: row.status,
        summary: row.summary,
        counts: {
          pass: row.passCount,
          partial: row.partialCount,
          fail: row.failCount,
          manual: row.manualCount,
        },
        checks: row.checkResults,
        manualTests: [],
        reportMarkdown: row.reportMarkdown,
        nextPromptMarkdown: row.nextPromptMarkdown,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="build-auditor-page">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-amber-500" />
          <h1 className="text-2xl font-bold tracking-tight">Ascent Build Auditor</h1>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            Internal · dev only
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Runs live route, data, build-checklist, wiring, and product-promise
          checks against this running instance. Use after every build layer to
          prevent false completion. Not customer-facing.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
        <div className="flex-1 min-w-0">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            Build label
          </label>
          <Input
            value={buildLabel}
            onChange={(e) => setBuildLabel(e.target.value)}
            placeholder="e.g. Build 7.3.1 — narrative cleanup"
            data-testid="build-auditor-label"
          />
        </div>
        <Button
          onClick={runAudit}
          disabled={running}
          className="shrink-0"
          data-testid="build-auditor-run"
        >
          {running ? (
            <>
              <RotateCw className="h-4 w-4 mr-2 animate-spin" /> Running…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4 mr-2" /> Run audit
            </>
          )}
        </Button>
      </div>

      {error && (
        <div
          className="rounded-md border border-status-red/40 bg-status-red/5 p-3 text-sm text-status-red"
          data-testid="build-auditor-error"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <main className="space-y-6 min-w-0">
          {running && !bundle && <Skeleton className="h-64 w-full" />}
          {!running && !bundle && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No audit loaded yet. Click <strong>Run audit</strong> to evaluate the
              current build, or open a recent audit from the right.
            </div>
          )}
          {bundle && <AuditReport bundle={bundle} copy={copy} copied={copied} />}
        </main>

        <aside className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent audits
          </h2>
          {history.length === 0 && (
            <div className="text-xs text-muted-foreground italic">No audits yet.</div>
          )}
          {history.map((h) => {
            const meta = STATUS_META[h.status];
            return (
              <button
                key={h.id}
                onClick={() => openHistorical(h.id)}
                className="w-full text-left rounded-md border border-border bg-card hover:bg-secondary/40 p-3 transition-colors"
                data-testid={`build-auditor-history-${h.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{h.buildLabel}</span>
                  <Badge variant="outline" className={`text-[10px] ${meta.tone}`}>
                    {meta.label}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {new Date(h.createdAt).toLocaleString()} · {h.summary}
                </div>
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function AuditReport({
  bundle,
  copy,
  copied,
}: {
  bundle: AuditBundle;
  copy: (text: string, key: string) => void;
  copied: string | null;
}) {
  const meta = STATUS_META[bundle.status];
  const Icon = meta.Icon;
  const byCategory = useMemo(() => {
    const map = new Map<CheckResult["category"], CheckResult[]>();
    for (const c of bundle.checks) {
      const arr = map.get(c.category) ?? [];
      arr.push(c);
      map.set(c.category, arr);
    }
    return map;
  }, [bundle.checks]);

  const problems = useMemo(
    () => bundle.checks.filter((c) => c.status === "fail" || c.status === "partial"),
    [bundle.checks],
  );

  return (
    <div className="space-y-6">
      {/* Status hero */}
      <div className={`rounded-lg border-2 p-4 ${meta.tone}`} data-testid="build-auditor-status">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-5 w-5" />
              <span className="text-base font-bold tracking-wider uppercase">{meta.label}</span>
            </div>
            <div className="text-sm">{bundle.summary}</div>
            <div className="text-xs opacity-80 mt-1">
              {bundle.buildLabel} · generated {new Date(bundle.generatedAt).toLocaleString()}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs shrink-0">
            <CountPill label="Pass" value={bundle.counts.pass} tone="text-status-green" />
            <CountPill label="Partial" value={bundle.counts.partial} tone="text-amber-500" />
            <CountPill label="Fail" value={bundle.counts.fail} tone="text-status-red" />
            <CountPill label="Manual" value={bundle.counts.manual} tone="text-sky-500" />
          </div>
        </div>
      </div>

      {/* Problems first per spec */}
      {problems.length > 0 && (
        <Section title="Problems Found" testId="build-auditor-problems">
          <ul className="space-y-2">
            {problems
              .slice()
              .sort((a, b) => sevRank(b.severity) - sevRank(a.severity))
              .map((p) => (
                <li key={p.id} className="rounded-md border border-border bg-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs ${SEV_META[p.severity]}`}>{p.severity}</span>
                      <Badge variant="outline" className={`text-[10px] ${CHECK_STATUS_META[p.status].tone}`}>
                        {CHECK_STATUS_META[p.status].label}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    <div><span className="font-semibold">Expected:</span> {p.expected}</div>
                    <div><span className="font-semibold">Observed:</span> {p.observed}</div>
                    {p.notes && <div><span className="font-semibold">Notes:</span> {p.notes}</div>}
                  </div>
                </li>
              ))}
          </ul>
        </Section>
      )}

      {/* Each category */}
      {(["build_checklist", "wiring", "route_integrity", "data_flow", "product_promise"] as const).map((cat) => {
        const items = byCategory.get(cat) ?? [];
        if (items.length === 0) return null;
        return (
          <Section key={cat} title={CATEGORY_TITLES[cat]} testId={`build-auditor-cat-${cat}`}>
            <ul className="space-y-2">
              {items.map((c) => (
                <li key={c.id} className="rounded-md border border-border bg-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{c.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs ${SEV_META[c.severity]}`}>{c.severity}</span>
                      <Badge variant="outline" className={`text-[10px] ${CHECK_STATUS_META[c.status].tone}`}>
                        {CHECK_STATUS_META[c.status].label}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <div><span className="font-semibold">Expected:</span> {c.expected}</div>
                    <div><span className="font-semibold">Observed:</span> {c.observed}</div>
                    {c.notes && <div className="text-amber-600 dark:text-amber-400"><span className="font-semibold">Notes:</span> {c.notes}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      {/* Manual test plan */}
      {bundle.manualTests.length > 0 && (
        <Section title="Screenshot / Manual Evidence Needed" testId="build-auditor-manual">
          <ul className="space-y-2">
            {bundle.manualTests.map((t) => (
              <li key={t.id} className="rounded-md border border-border bg-card p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Eye className="h-4 w-4 text-muted-foreground" /> {t.name}
                </div>
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  <div><span className="font-semibold">Click path:</span> {t.clickPath}</div>
                  <div><span className="font-semibold">Expected:</span> {t.expected}</div>
                  <div><span className="font-semibold">Evidence:</span> {t.evidence}</div>
                  <div><span className="font-semibold">Pass:</span> {t.passCriteria}</div>
                  <div><span className="font-semibold">Fail:</span> {t.failCriteria}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Markdown report */}
      <Section
        title="Full Markdown Report"
        testId="build-auditor-markdown"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(bundle.reportMarkdown, "report")}
            data-testid="build-auditor-copy-report"
          >
            <ClipboardCopy className="h-3.5 w-3.5 mr-1" />
            {copied === "report" ? "Copied" : "Copy"}
          </Button>
        }
      >
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap bg-secondary/30 rounded-md p-3 max-h-[400px] overflow-auto">
          {bundle.reportMarkdown}
        </pre>
      </Section>

      {/* Next prompt */}
      <Section
        title="Next Replit Prompt"
        testId="build-auditor-next-prompt"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(bundle.nextPromptMarkdown, "prompt")}
            data-testid="build-auditor-copy-prompt"
          >
            <ClipboardCopy className="h-3.5 w-3.5 mr-1" />
            {copied === "prompt" ? "Copied" : "Copy"}
          </Button>
        }
      >
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap bg-secondary/30 rounded-md p-3 max-h-[400px] overflow-auto">
          {bundle.nextPromptMarkdown}
        </pre>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
  action,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CountPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md bg-background/40 border border-border/40 px-2 py-1 text-center">
      <div className={`text-base font-bold ${tone}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function sevRank(s: CheckSeverity): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}

function defaultBuildLabel(): string {
  const d = new Date();
  return `Audit ${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}
