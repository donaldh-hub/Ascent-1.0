/**
 * Ascent 1.12.7 — Governance Audit Page (Admin)
 *
 * Surface for the system-enforcement layer:
 *   - Live audit report from /api/governance/audit
 *   - Symmetry check status per locked signal
 *   - Metric contracts (registry view)
 *   - System law / non-negotiable rules
 *
 * Read-only. If audit shows FAIL, a build has drifted from the
 * shared service layer and must be reverted or refactored.
 */
import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Activity, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type AllowedConsumer =
  | "control_tower"
  | "priority_actions"
  | "drill_endpoint"
  | "list_endpoint"
  | "detail_page"
  | "reporting"
  | "alert_engine";

interface MetricContract {
  signal: string;
  domain: "work_order" | "turn" | "asset";
  name: string;
  inputs: string[];
  rule: string;
  output: "count" | "count+rows" | "count+rows+cost";
  selectors: string[];
  allowedConsumers: AllowedConsumer[];
  confidence: "reportable" | "fully_resolved" | "all" | null;
  symmetryLocked: boolean;
}

interface SymmetryCheck {
  signal: string;
  domain: MetricContract["domain"];
  pathA_selectorCount: number;
  pathB_predicateCount: number;
  pathC_listEndpointCount: number | null;
  match: boolean;
  delta: number;
  notes: string[];
  durationMs: number;
}

interface AuditReport {
  generatedAt: string;
  contractsTotal: number;
  symmetryLockedTotal: number;
  symmetryChecksPassed: number;
  symmetryChecksFailed: number;
  overallStatus: "pass" | "fail";
  contracts: MetricContract[];
  symmetryChecks: SymmetryCheck[];
  systemLaw: string[];
}

export default function GovernancePage() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/governance/audit")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: AuditReport) => {
        setReport(d);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6 p-6" data-testid="page-governance">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Build 1.12.7 — System Enforcement Layer
          </div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2 mt-1">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Governance &amp; Audit
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Live proof that every operational metric in the system is sourced from the
            shared selector layer and that Control Tower remains the single source of truth.
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm" data-testid="btn-rerun-audit">
          Re-run audit
        </Button>
      </div>

      {/* Status banner */}
      {loading && <Skeleton className="h-24 w-full" />}
      {error && (
        <div className="border border-status-red/50 bg-status-red/10 rounded-lg p-4 text-sm text-status-red">
          Audit failed: {error}
        </div>
      )}

      {report && (
        <>
          <div
            className={
              "rounded-lg border p-4 flex items-center gap-4 " +
              (report.overallStatus === "pass"
                ? "border-status-green/50 bg-status-green/10"
                : "border-status-red/50 bg-status-red/10")
            }
            data-testid="audit-status-banner"
          >
            {report.overallStatus === "pass" ? (
              <ShieldCheck className="h-8 w-8 text-status-green shrink-0" />
            ) : (
              <ShieldAlert className="h-8 w-8 text-status-red shrink-0" />
            )}
            <div className="flex-1">
              <div className="text-base font-semibold">
                {report.overallStatus === "pass"
                  ? "System invariants intact"
                  : "Governance drift detected"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {report.symmetryChecksPassed} of {report.symmetryLockedTotal} symmetry checks
                passed · {report.contractsTotal} contracts registered · last run{" "}
                {new Date(report.generatedAt).toLocaleString()}
              </div>
            </div>
            <Badge
              variant={report.overallStatus === "pass" ? "default" : "destructive"}
              className="text-xs uppercase"
              data-testid="audit-status-badge"
            >
              {report.overallStatus}
            </Badge>
          </div>

          {/* Symmetry check table */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Control Tower Symmetry Checks
            </h2>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                    <th className="px-4 py-2">Signal</th>
                    <th className="px-4 py-2">Domain</th>
                    <th className="px-4 py-2 text-right">Selector (SQL)</th>
                    <th className="px-4 py-2 text-right">Predicate (JS)</th>
                    <th className="px-4 py-2 text-right">Δ</th>
                    <th className="px-4 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.symmetryChecks.map(c => (
                    <tr
                      key={c.signal}
                      className="border-b border-border last:border-0"
                      data-testid={`symmetry-row-${c.signal}`}
                    >
                      <td className="px-4 py-2 font-medium text-foreground">{c.signal}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.domain}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {c.pathA_selectorCount}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {c.pathB_predicateCount}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {c.delta}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={c.match ? "default" : "destructive"}
                          className="text-xs"
                          data-testid={`symmetry-result-${c.signal}`}
                        >
                          {c.match ? "MATCH" : "DRIFT"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Contracts */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Metric Contracts ({report.contracts.length})
            </h2>
            <div className="grid gap-3">
              {report.contracts.map(c => (
                <div
                  key={c.signal}
                  className="rounded-lg border border-border bg-card p-4 space-y-2"
                  data-testid={`contract-${c.signal}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-foreground">{c.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.signal}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{c.domain}</Badge>
                      {c.symmetryLocked && (
                        <Badge variant="default" className="text-xs">locked</Badge>
                      )}
                      {c.confidence && (
                        <Badge variant="secondary" className="text-xs">
                          confidence: {c.confidence}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground/80">Rule:</span> {c.rule}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground/80">Selectors:</span>{" "}
                    <span className="font-mono">{c.selectors.join(", ")}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-foreground/80 font-semibold">Allowed consumers:</span>
                    {c.allowedConsumers.map(consumer => (
                      <Badge key={consumer} variant="outline" className="text-[10px] font-mono">
                        {consumer}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* System law */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">System Law (non-negotiable)</h2>
            <ol className="rounded-lg border border-border bg-card p-4 space-y-2 text-sm list-decimal list-inside">
              {report.systemLaw.map((rule, i) => (
                <li key={i} className="text-foreground/90">{rule}</li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
