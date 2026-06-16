import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, CheckCircle2, Eye, Lightbulb, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface WatchListItem { itemId: string; description: string; pillar: string; }
interface PatternWatchItem { patternId: string; description: string; weeksSeen: number; trend: string; }
interface DataGapPrompt { gapType: string; prompt: string; benefit: string; }
interface WOSummary { totalOpen: number; openedThisWeek: number; closedThisWeek: number; aging: number; topCategory: string | null; narrative: string; }

interface WeeklySummary {
  coachName: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  workOrderCount: number;
  convergenceFlags: Array<{ propertyName: string | null; pillarCount: number; signals: Array<{ pillar: string; description: string; severity: string }>; recommendation: string }>;
  pillarSummaries: { work_orders: WOSummary; turns: { narrative: string }; compliance: { narrative: string }; pm_warranty: { repeatIssueAssets: number; narrative: string } };
  patternWatch: PatternWatchItem[];
  oneRecommendation: string;
  watchList: WatchListItem[];
  dataGapPrompts: DataGapPrompt[];
  openingStatement: string;
  closingQuestion: string;
}

const PILLAR_LABELS: Record<string, string> = {
  work_orders: "Work Orders",
  turns: "Turns",
  compliance: "Compliance",
  pm_warranty: "PM & Warranty",
};

export function WeeklySummaryPanel() {
  const [data, setData] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/coach/weekly-summary")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: WeeklySummary) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading && !data) return (
    <div className="space-y-3">
      {[0,1,2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
    </div>
  );

  if (error) return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      <p>Weekly summary unavailable. {error}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={load}>Retry</Button>
    </div>
  );

  if (!data) return null;

  const weekOf = new Date(data.weekStart).toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <div className="space-y-4" data-testid="weekly-summary-panel">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Week of {weekOf}</p>
          <p className="text-sm mt-0.5 text-muted-foreground">{data.workOrderCount} work orders in your dataset</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* Opening statement */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm leading-relaxed">{data.openingStatement}</p>
      </div>

      {/* Convergence flags — always first if present */}
      {data.convergenceFlags.length > 0 && (
        <div className="rounded-lg border border-status-red/40 bg-status-red/5 p-4 space-y-3" data-testid="convergence-flags">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-red shrink-0" />
            <span className="text-sm font-semibold text-status-red">Convergence Flag{data.convergenceFlags.length > 1 ? "s" : ""}</span>
          </div>
          {data.convergenceFlags.map((flag, i) => (
            <div key={i} className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {flag.propertyName ?? "A unit"} is appearing across {flag.pillarCount} operational areas simultaneously.
              </p>
              {flag.signals.map((s, j) => (
                <div key={j} className="flex items-start gap-2 text-xs">
                  <Badge variant="outline" className="text-xs shrink-0">{PILLAR_LABELS[s.pillar] ?? s.pillar}</Badge>
                  <span className="text-muted-foreground">{s.description}</span>
                </div>
              ))}
              <p className="text-xs font-medium">{flag.recommendation}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pillar summaries */}
      <div className="grid grid-cols-1 gap-3">
        {/* Work Orders */}
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Work Orders</p>
          <p className="text-sm leading-relaxed whitespace-pre-line">{data.pillarSummaries.work_orders.narrative}</p>
          {data.pillarSummaries.work_orders.aging > 0 && (
            <Badge variant="outline" className="mt-2 text-xs border-amber-500/40 text-amber-600 bg-amber-500/10">
              {data.pillarSummaries.work_orders.aging} aging past 14 days
            </Badge>
          )}
        </div>

        {/* PM & Warranty */}
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">PM & Warranty</p>
          <p className="text-sm leading-relaxed">{data.pillarSummaries.pm_warranty.narrative}</p>
        </div>

        {/* Turns + Compliance — compact */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Turns</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{data.pillarSummaries.turns.narrative}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Compliance</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{data.pillarSummaries.compliance.narrative}</p>
          </div>
        </div>
      </div>

      {/* Pattern watch */}
      {data.patternWatch.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pattern Watch</p>
          </div>
          {data.patternWatch.map((p) => (
            <p key={p.patternId} className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
          ))}
        </div>
      )}

      {/* ONE recommendation — most prominent */}
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">This Week's Recommendation</p>
        </div>
        <p className="text-sm leading-relaxed font-medium">{data.oneRecommendation}</p>
      </div>

      {/* Watch list */}
      {data.watchList.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Watch List</p>
          <ul className="space-y-1.5">
            {data.watchList.map((item) => (
              <li key={item.itemId} className="flex items-start gap-2 text-sm">
                <Badge variant="outline" className="text-xs shrink-0 mt-0.5">{PILLAR_LABELS[item.pillar] ?? item.pillar}</Badge>
                <span className="text-muted-foreground">{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Data gap coaching prompts */}
      {data.dataGapPrompts.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Data Coaching</p>
          {data.dataGapPrompts.map((gap) => (
            <div key={gap.gapType} className="space-y-0.5">
              <p className="text-sm text-amber-700 dark:text-amber-400">{gap.prompt}</p>
              <p className="text-xs text-muted-foreground">{gap.benefit}</p>
            </div>
          ))}
        </div>
      )}

      {/* Closing question — mandatory per spec */}
      <div className="flex items-start gap-2 px-1">
        <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground italic leading-relaxed">{data.closingQuestion}</p>
      </div>

      <p className="text-xs text-muted-foreground text-right">
        Generated {new Date(data.generatedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}
