import { useEffect, useState } from "react";
import {
  BrainCircuit,
  RefreshCw,
  Lock,
  Wrench,
  ShieldCheck,
  Zap,
  DollarSign,
  Users,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface CoachInsight {
  insightId: string;
  category: "maintenance" | "compliance" | "efficiency" | "cost" | "staffing";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  finding: string;
  recommendation: string;
  impactEstimate: string;
  evidenceSummary: string;
  propertyName?: string;
}

interface CoachReport {
  generatedAt: string;
  coachUnlocked: boolean;
  workOrderCount: number;
  unlockThreshold: number;
  insights: CoachInsight[];
  topPriority: CoachInsight | null;
  summary: string;
  confidenceNote: string;
}

const categoryMeta: Record<CoachInsight["category"], { icon: React.ElementType; label: string }> = {
  maintenance: { icon: Wrench, label: "Maintenance" },
  compliance: { icon: ShieldCheck, label: "Compliance" },
  efficiency: { icon: Zap, label: "Efficiency" },
  cost: { icon: DollarSign, label: "Cost" },
  staffing: { icon: Users, label: "Staffing" },
};

const priorityMeta: Record<CoachInsight["priority"], { tone: string; label: string }> = {
  critical: { tone: "border-status-red/40 text-status-red bg-status-red/10", label: "Critical" },
  high: { tone: "border-amber-500/40 text-amber-600 bg-amber-500/10", label: "High" },
  medium: { tone: "border-blue-500/40 text-blue-500 bg-blue-500/10", label: "Medium" },
  low: { tone: "border-border text-muted-foreground bg-secondary/50", label: "Low" },
};

function InsightCard({ insight, featured = false }: { insight: CoachInsight; featured?: boolean }) {
  const cat = categoryMeta[insight.category];
  const pri = priorityMeta[insight.priority];
  const CatIcon = cat.icon;

  return (
    <div
      className={`rounded-lg border p-4 ${featured ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}
      data-testid={`coach-insight-${insight.insightId}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-md p-1.5 ${featured ? "bg-primary/10" : "bg-secondary"}`}>
          <CatIcon className={`h-4 w-4 ${featured ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold">{insight.title}</span>
            <Badge variant="outline" className={`text-xs ${pri.tone}`}>{pri.label}</Badge>
            <Badge variant="outline" className="text-xs">{cat.label}</Badge>
            {insight.propertyName && (
              <Badge variant="outline" className="text-xs text-muted-foreground">{insight.propertyName}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{insight.finding}</p>
          <div className="mt-3 rounded-md bg-secondary/60 p-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <ChevronRight className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-sm">{insight.recommendation}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="text-status-green font-medium">{insight.impactEstimate}</span>
            <span>·</span>
            <span>{insight.evidenceSummary}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OperationsCoachPanel() {
  const [report, setReport] = useState<CoachReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/coach/recommendations")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: CoachReport) => setReport(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading && !report) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-status-red/30 bg-status-red/5 p-4 text-sm text-status-red">
        Failed to load Operations Coach: {error}
      </div>
    );
  }

  if (!report) return null;

  if (!report.coachUnlocked) {
    const pct = Math.min(100, Math.round((report.workOrderCount / report.unlockThreshold) * 100));
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center space-y-4" data-testid="coach-locked">
        <div className="flex justify-center">
          <div className="rounded-full bg-secondary p-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-lg">Operations Coach is locked</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{report.summary}</p>
        </div>
        <div className="max-w-xs mx-auto space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{report.workOrderCount} work orders</span>
            <span>{report.unlockThreshold} needed</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{pct}% to unlock</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
    );
  }

  const remaining = report.insights.slice(1);

  return (
    <div className="space-y-4" data-testid="coach-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{report.summary}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="coach-refresh">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {report.topPriority && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Top Priority
          </div>
          <InsightCard insight={report.topPriority} featured />
        </div>
      )}

      {remaining.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Additional Insights
          </div>
          <div className="space-y-3">
            {remaining.map((insight) => (
              <InsightCard key={insight.insightId} insight={insight} />
            ))}
          </div>
        </div>
      )}

      {report.insights.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No significant patterns detected at this time. Keep uploading data for more targeted insights.
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t border-border pt-3">
        {report.confidenceNote} · Generated {new Date(report.generatedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}
