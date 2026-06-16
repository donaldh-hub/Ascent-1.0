import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ReadinessItem {
  itemId: string;
  category: "data" | "features" | "infrastructure" | "product";
  label: string;
  status: "ready" | "partial" | "not_ready";
  detail: string;
  blocker: boolean;
}

interface LaunchReadinessReport {
  generatedAt: string;
  overallStatus: "launch_ready" | "nearly_ready" | "not_ready";
  readyCount: number;
  partialCount: number;
  notReadyCount: number;
  blockerCount: number;
  items: ReadinessItem[];
  launchRecommendation: string;
}

const OVERALL_META = {
  launch_ready: {
    label: "LAUNCH READY",
    tone: "border-status-green/40 text-status-green bg-status-green/10",
    icon: CheckCircle2,
  },
  nearly_ready: {
    label: "NEARLY READY",
    tone: "border-amber-500/40 text-amber-600 bg-amber-500/10",
    icon: AlertTriangle,
  },
  not_ready: {
    label: "NOT READY",
    tone: "border-status-red/40 text-status-red bg-status-red/10",
    icon: XCircle,
  },
} as const;

const ITEM_META = {
  ready: { icon: CheckCircle2, color: "text-status-green", badge: "border-status-green/40 text-status-green bg-status-green/10" },
  partial: { icon: AlertTriangle, color: "text-amber-500", badge: "border-amber-500/40 text-amber-600 bg-amber-500/10" },
  not_ready: { icon: XCircle, color: "text-status-red", badge: "border-status-red/40 text-status-red bg-status-red/10" },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  data: "Data",
  features: "Features",
  infrastructure: "Infrastructure",
  product: "Product",
};

function ItemRow({ item }: { item: ReadinessItem }) {
  const meta = ITEM_META[item.status];
  const Icon = meta.icon;
  return (
    <div
      className={`flex items-start gap-3 py-2.5 border-b border-border last:border-0 ${item.blocker && item.status !== "ready" ? "bg-status-red/5" : ""}`}
      data-testid={`readiness-item-${item.itemId}`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{item.label}</span>
          <Badge variant="outline" className={`text-xs ${meta.badge}`}>
            {item.status.replace("_", " ")}
          </Badge>
          {item.blocker && (
            <Badge variant="outline" className="text-xs border-status-red/40 text-status-red bg-status-red/10">
              Required
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
      </div>
    </div>
  );
}

export function LaunchReadinessPanel() {
  const [report, setReport] = useState<LaunchReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/launch/readiness")
      .then((r) => r.json())
      .then((d: LaunchReadinessReport) => setReport(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const overall = report ? OVERALL_META[report.overallStatus] : null;

  const grouped = report
    ? (["data", "features", "infrastructure", "product"] as const).map((cat) => ({
        category: cat,
        items: report.items.filter((i) => i.category === cat),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="launch-readiness-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Launch Readiness</h3>
        </div>
        <div className="flex items-center gap-2">
          {report && overall && (
            <Badge variant="outline" className={`text-xs font-bold ${overall.tone}`}>
              {(() => { const I = overall.icon; return <I className="w-3 h-3 mr-1 inline" />; })()}
              {overall.label}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="launch-readiness-refresh-btn">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Refresh"}
          </Button>
        </div>
      </div>

      {loading && !report && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50">
          <p className="font-medium">Launch readiness unavailable</p>
          <p className="text-xs mt-0.5">{error}</p>
        </div>
      )}

      {report && (
        <>
          <p className="text-xs text-muted-foreground mb-3">{report.launchRecommendation}</p>

          <div className="grid grid-cols-4 gap-2 mb-4 text-center">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-status-green">{report.readyCount}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ready</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-amber-500">{report.partialCount}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Partial</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-status-red">{report.notReadyCount}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Not Ready</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-status-red">{report.blockerCount}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Blockers</div>
            </div>
          </div>

          <div className="space-y-4">
            {grouped.map(({ category, items }) => (
              <div key={category}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  {CATEGORY_LABELS[category]}
                </div>
                <div className="rounded-md border border-border divide-y divide-border">
                  {items.map((item) => <ItemRow key={item.itemId} item={item} />)}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            Generated {new Date(report.generatedAt).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}
