import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface DataQualityIssue {
  issueId: string;
  severity: "blocking" | "warning" | "suggestion";
  category: "work_orders" | "assets" | "properties" | "assignments";
  title: string;
  detail: string;
  count: number;
  resolution: string;
}

interface DataQualityReport {
  generatedAt: string;
  overallHealth: "healthy" | "degraded" | "critical";
  issues: DataQualityIssue[];
  blockingCount: number;
  warningCount: number;
  totalRecordsChecked: number;
}

const severityMeta: Record<DataQualityIssue["severity"], { icon: React.ElementType; color: string; badge: string; label: string }> = {
  blocking: { icon: XCircle, color: "text-status-red", badge: "border-status-red/40 text-status-red bg-status-red/10", label: "Blocking" },
  warning: { icon: AlertTriangle, color: "text-amber-500", badge: "border-amber-500/40 text-amber-600 bg-amber-500/10", label: "Warning" },
  suggestion: { icon: CheckCircle2, color: "text-blue-400", badge: "border-blue-400/40 text-blue-400 bg-blue-400/10", label: "Suggestion" },
};

const healthMeta: Record<DataQualityReport["overallHealth"], { label: string; badge: string; icon: React.ElementType }> = {
  healthy: { label: "Healthy", badge: "border-status-green/40 text-status-green bg-status-green/10", icon: CheckCircle2 },
  degraded: { label: "Degraded", badge: "border-amber-500/40 text-amber-600 bg-amber-500/10", icon: AlertTriangle },
  critical: { label: "Critical", badge: "border-status-red/40 text-status-red bg-status-red/10", icon: XCircle },
};

const categoryLabel: Record<DataQualityIssue["category"], string> = {
  work_orders: "Work Orders",
  assets: "Assets",
  properties: "Properties",
  assignments: "Assignments",
};

function IssueRow({ issue }: { issue: DataQualityIssue }) {
  const [expanded, setExpanded] = useState(false);
  const meta = severityMeta[issue.severity];
  const SevIcon = meta.icon;

  return (
    <div className="border-b border-border last:border-0" data-testid={`dq-issue-${issue.issueId}`}>
      <button
        type="button"
        className="w-full flex items-start gap-3 py-3 text-left hover:bg-secondary/30 px-3 rounded transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <SevIcon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{issue.title}</span>
            <Badge variant="outline" className={`text-xs ${meta.badge}`}>{meta.label}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">{categoryLabel[issue.category]}</Badge>
            <span className="text-xs text-muted-foreground ml-auto">{issue.count} record{issue.count !== 1 ? "s" : ""}</span>
          </div>
          {!expanded && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{issue.detail}</p>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="pb-3 px-3 pl-10 space-y-2">
          <p className="text-sm text-muted-foreground">{issue.detail}</p>
          <div className="rounded-md bg-secondary/60 p-3">
            <p className="text-xs font-medium text-foreground mb-0.5">Resolution</p>
            <p className="text-xs text-muted-foreground">{issue.resolution}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function DataQualityPanel() {
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/data-quality/check")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DataQualityReport) => setReport(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const health = report ? healthMeta[report.overallHealth] : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="data-quality-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Data Quality</h3>
        </div>
        <div className="flex items-center gap-2">
          {report && health && (
            <Badge variant="outline" className={`text-xs ${health.badge}`}>
              {(() => { const I = health.icon; return <I className="w-3 h-3 mr-1 inline" />; })()}
              {health.label}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="dq-refresh">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Refresh"}
          </Button>
        </div>
      </div>

      {loading && !report && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50">
          <p className="font-medium">Data quality check not available</p>
          <p className="text-xs mt-0.5">{error}</p>
        </div>
      )}

      {report && (
        <>
          {report.issues.length === 0 ? (
            <div className="text-sm text-status-green text-center py-4">
              No data quality issues detected.
            </div>
          ) : (
            <div className="rounded-md border border-border">
              {report.issues.map((issue) => (
                <IssueRow key={issue.issueId} issue={issue} />
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="text-status-red font-medium">{report.blockingCount} blocking</span>
            <span className="text-amber-500 font-medium">{report.warningCount} warning{report.warningCount !== 1 ? "s" : ""}</span>
            <span className="ml-auto">{report.totalRecordsChecked.toLocaleString()} records checked · {new Date(report.generatedAt).toLocaleTimeString()}</span>
          </div>
        </>
      )}
    </div>
  );
}
