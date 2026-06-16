import { useEffect, useState } from "react";
import { TrendingUp, Lock, Unlock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TrialReadinessReport {
  dataScore: number;
  workOrderCount: number;
  propertyCount: number;
  hasEnoughData: boolean;
  recommendation: string;
  nextStep: "upload_more" | "explore_reports" | "ready_to_convert";
  coachUnlockThreshold: number;
  coachUnlocked: boolean;
}

export function TrialReadinessPanel({ onRefresh }: { onRefresh?: number }) {
  const [data, setData] = useState<TrialReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/trial/readiness")
      .then((r) => r.json())
      .then((d: TrialReadinessReport) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [onRefresh]);

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }

  if (!data) return null;

  const coachPct = Math.min(100, Math.round((data.workOrderCount / data.coachUnlockThreshold) * 100));

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="trial-readiness-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Data Readiness</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-7 px-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Score bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Data score</span>
          <span className="text-xs font-medium">{data.dataScore}/100</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${data.dataScore}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">{data.recommendation}</p>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {data.workOrderCount} work orders · {data.propertyCount} {data.propertyCount === 1 ? "property" : "properties"}
        </span>
        <div className="flex items-center gap-1.5">
          {data.coachUnlocked ? (
            <><Unlock className="w-3.5 h-3.5 text-status-green" /><span className="text-status-green font-medium">Coach active</span></>
          ) : (
            <><Lock className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">Coach: {coachPct}% unlocked</span></>
          )}
        </div>
      </div>

      {data.nextStep === "ready_to_convert" && (
        <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary font-medium">
          Upgrade to compare across all properties and unlock advanced hub intelligence →
        </div>
      )}
    </div>
  );
}
