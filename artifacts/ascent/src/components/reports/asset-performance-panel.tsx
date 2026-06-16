import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface RepeatIssueAsset {
  assetId: number;
  name: string;
  propertyName: string;
  workOrderCount: number;
  lastWorkOrderDate: string;
  riskLevel: "high" | "medium" | "low";
}

interface AssetPerformanceReport {
  totalAssetsWithWorkOrders: number;
  highRiskCount: number;
  warrantyOpportunityCount: number;
  topRepeatIssueAssets: RepeatIssueAsset[];
  confidenceState: "confirmed_analysis" | "qualified_analysis" | "insufficient_data";
}

const RISK_META = {
  high: { badge: "border-status-red/40 text-status-red bg-status-red/10", label: "High" },
  medium: { badge: "border-amber-500/40 text-amber-600 bg-amber-500/10", label: "Medium" },
  low: { badge: "border-status-green/40 text-status-green bg-status-green/10", label: "Low" },
};

const CONFIDENCE_META = {
  confirmed_analysis: { badge: "border-status-green/40 text-status-green bg-status-green/10", label: "Confirmed" },
  qualified_analysis: { badge: "border-amber-500/40 text-amber-600 bg-amber-500/10", label: "Qualified" },
  insufficient_data: { badge: "border-muted text-muted-foreground bg-secondary/50", label: "Insufficient data" },
};

export function AssetPerformancePanel() {
  const [data, setData] = useState<AssetPerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-analysis/assets/performance")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: AssetPerformanceReport) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const confidenceMeta = data ? CONFIDENCE_META[data.confidenceState] : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="asset-performance-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Build 9.2 — Asset Performance</h3>
          {confidenceMeta && (
            <Badge variant="outline" className={`text-xs ${confidenceMeta.badge}`}>
              {confidenceMeta.label}
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {loading && !data && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50" data-testid="asset-performance-error">
          <p className="font-medium">Asset performance unavailable</p>
          <p className="text-xs mt-0.5">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={load}>Retry</Button>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-border p-3 text-center">
              <p className="text-2xl font-bold">{data.totalAssetsWithWorkOrders}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Assets with WOs</p>
            </div>
            <div className="rounded-md border border-status-red/40 bg-status-red/5 p-3 text-center">
              <p className="text-2xl font-bold text-status-red">{data.highRiskCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">High risk</p>
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{data.warrantyOpportunityCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Warranty opps</p>
            </div>
          </div>

          {data.topRepeatIssueAssets.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Repeat issue assets
              </h4>
              <div className="rounded-md border border-border divide-y divide-border">
                {data.topRepeatIssueAssets.slice(0, 8).map((a) => {
                  const rm = RISK_META[a.riskLevel];
                  return (
                    <div key={a.assetId} className="flex items-center justify-between px-3 py-2.5 gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        <p className="text-xs text-muted-foreground">{a.propertyName}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{a.workOrderCount} WOs</span>
                        <Badge variant="outline" className={`text-xs ${rm.badge}`}>{rm.label}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {data.topRepeatIssueAssets.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="asset-performance-empty">
              No repeat issue assets found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
