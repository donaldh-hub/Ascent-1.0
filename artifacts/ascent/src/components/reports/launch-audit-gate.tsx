import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface AuditCheck {
  checkId: string;
  label: string;
  result: "PASS" | "PARTIAL" | "FAIL";
  reason: string;
}

interface AuditResult {
  auditLabel: string;
  generatedAt: string;
  checks: AuditCheck[];
  summary: { pass: number; partial: number; fail: number; total: number };
  overallDecision: "SAFE_TO_PROMOTE" | "SAFE_WITH_CAUTION" | "NOT_SAFE_TO_PROMOTE";
  overallReason: string;
}

function CheckRow({ check }: { check: AuditCheck }) {
  const meta = {
    PASS: { icon: CheckCircle2, color: "text-status-green", badge: "border-status-green/40 text-status-green bg-status-green/10" },
    PARTIAL: { icon: AlertTriangle, color: "text-amber-500", badge: "border-amber-500/40 text-amber-600 bg-amber-500/10" },
    FAIL: { icon: XCircle, color: "text-status-red", badge: "border-status-red/40 text-status-red bg-status-red/10" },
  }[check.result];
  const Icon = meta.icon;

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0" data-testid={`audit122-check-${check.checkId}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{check.label}</span>
          <Badge variant="outline" className={`text-xs ${meta.badge}`}>{check.result}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{check.reason}</p>
      </div>
    </div>
  );
}

export function LaunchAuditGate() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runAudit = () => {
    setLoading(true);
    setError(null);
    fetch("/api/build-auditor/12-2")
      .then((r) => {
        if (!r.ok) throw new Error("Audit endpoint not available yet.");
        return r.json();
      })
      .then((d: AuditResult) => setResult(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { runAudit(); }, []);

  const decisionMeta = result
    ? ({
        SAFE_TO_PROMOTE: { label: "Safe to promote", tone: "border-status-green/40 text-status-green bg-status-green/10", icon: CheckCircle2 },
        SAFE_WITH_CAUTION: { label: "Safe with caution", tone: "border-amber-500/40 text-amber-600 bg-amber-500/10", icon: AlertTriangle },
        NOT_SAFE_TO_PROMOTE: { label: "Not safe to promote", tone: "border-status-red/40 text-status-red bg-status-red/10", icon: XCircle },
      } as const)[result.overallDecision]
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="launch-audit-gate">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Build 12.2 — Final Launch Readiness Audit Gate</h3>
        </div>
        <div className="flex items-center gap-2">
          {result && decisionMeta && (
            <Badge variant="outline" className={`text-xs ${decisionMeta.tone}`}>
              {(() => { const I = decisionMeta.icon; return <I className="w-3 h-3 mr-1 inline" />; })()}
              {decisionMeta.label}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={runAudit} disabled={loading} data-testid="run-audit122-btn">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Running…" : "Run audit"}
          </Button>
        </div>
      </div>

      {loading && !result && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50">
          <p className="font-medium">Audit not available yet</p>
          <p className="text-xs mt-0.5">{error}</p>
        </div>
      )}

      {result && (
        <>
          <p className="text-xs text-muted-foreground mb-3">{result.overallReason}</p>
          <div className="rounded-md border border-border divide-y divide-border">
            {result.checks.map((c) => <CheckRow key={c.checkId} check={c} />)}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="text-status-green font-medium">{result.summary.pass} pass</span>
            <span className="text-amber-500 font-medium">{result.summary.partial} partial</span>
            <span className="text-status-red font-medium">{result.summary.fail} fail</span>
            <span className="ml-auto">Generated {new Date(result.generatedAt).toLocaleTimeString()}</span>
          </div>
        </>
      )}
    </div>
  );
}
