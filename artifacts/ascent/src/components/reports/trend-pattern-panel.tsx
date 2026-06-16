/**
 * Ascent 8.2 — Trend + Pattern Panel
 *
 * Text-based display of trend intelligence from the record pool:
 *   - Trend confidence badge
 *   - Top categories bar-style list
 *   - Properties by volume
 *   - Aging records count
 *   - Recurring bottlenecks
 *
 * No charts (Recharts not needed). Honest low-data state when
 * trendConfidence === "insufficient".
 */

import { useEffect, useState } from "react";
import {
  BarChart2,
  Clock,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryFrequency {
  category: string;
  count: number;
  percentOfTotal: number;
}

interface PropertyVolume {
  propertyId: number | null;
  propertyName: string;
  recordCount: number;
  fullyReportable: number;
  partial: number;
}

interface RecurringBottleneck {
  category: string;
  workOrderCount: number;
  turnCount: number;
  totalCount: number;
}

type TrendConfidence = "sufficient" | "directional" | "insufficient";

interface TrendPatternReport {
  generatedAt: string;
  trendWindow: string;
  trendConfidence: TrendConfidence;
  admissibleRecordCount: number;
  topCategories: CategoryFrequency[];
  propertiesByVolume: PropertyVolume[];
  agingRecords: { id: string }[];
  agingRecordCount: number;
  recurringBottlenecks: RecurringBottleneck[];
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

const CONFIDENCE_META: Record<TrendConfidence, { label: string; tone: string }> = {
  sufficient: {
    label: "Sufficient data",
    tone: "border-status-green/40 text-status-green bg-status-green/10",
  },
  directional: {
    label: "Directional (limited data)",
    tone: "border-amber-500/40 text-amber-600 bg-amber-500/10",
  },
  insufficient: {
    label: "Insufficient data",
    tone: "border-status-red/40 text-status-red bg-status-red/10",
  },
};

// ─── Bar row ─────────────────────────────────────────────────────────────────

function BarRow({ label, count, percent, max }: { label: string; count: number; percent: number; max: number }) {
  const barWidth = max === 0 ? 0 : Math.round((count / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium truncate max-w-[60%]">{label}</span>
        <span className="text-muted-foreground text-xs">{count} ({percent}%)</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TrendPatternPanel() {
  const [data, setData] = useState<TrendPatternReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const load = () => {
    setLoading(true);
    setUnavailable(false);
    fetch("/api/reporting-analysis/trends")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: TrendPatternReport) => setData(d))
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (unavailable) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="trend-panel-unavailable">
        Trend analysis available after server restart.
      </div>
    );
  }

  const confidenceMeta = data ? CONFIDENCE_META[data.trendConfidence] : null;
  const maxCategoryCount = data ? Math.max(...data.topCategories.map((c) => c.count), 1) : 1;

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="trend-pattern-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Build 8.2 — Trend + Pattern Intelligence</h3>
          {confidenceMeta && (
            <Badge variant="outline" className={`text-xs ${confidenceMeta.tone}`}>
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

      {data && data.trendConfidence === "insufficient" && (
        <div className="rounded-md bg-secondary/50 p-4 text-sm text-muted-foreground" data-testid="trend-insufficient">
          <p className="font-medium">Not enough data for trend analysis</p>
          <p className="text-xs mt-1">
            Trend analysis requires at least 10 admissible records. Currently {data.admissibleRecordCount} admissible records
            are available. Add more reportable records to unlock trend intelligence.
          </p>
        </div>
      )}

      {data && data.trendConfidence !== "insufficient" && (
        <div className="space-y-5">
          {/* Top categories */}
          {data.topCategories.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-3.5 h-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Top categories ({data.trendWindow})
                </h4>
              </div>
              <div className="space-y-3">
                {data.topCategories.map((c) => (
                  <BarRow
                    key={c.category}
                    label={c.category}
                    count={c.count}
                    percent={c.percentOfTotal}
                    max={maxCategoryCount}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Properties by volume */}
          {data.propertiesByVolume.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Properties by record volume
              </h4>
              <div className="rounded-md border border-border divide-y divide-border">
                {data.propertiesByVolume.slice(0, 8).map((p) => (
                  <div
                    key={p.propertyId ?? "__none__"}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                    data-testid={`prop-row-${p.propertyId ?? "none"}`}
                  >
                    <span className="font-medium truncate max-w-[55%]">{p.propertyName}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                      <span>{p.recordCount} records</span>
                      <span className="text-status-green">{p.fullyReportable} fully</span>
                      <span className="text-amber-500">{p.partial} partial</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Aging records */}
          <section className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Aging records (&gt;30 days, not completed)</span>
            </div>
            <Badge
              variant="outline"
              className={
                data.agingRecordCount > 0
                  ? "border-amber-500/40 text-amber-600 bg-amber-500/10"
                  : "border-status-green/40 text-status-green bg-status-green/10"
              }
            >
              {data.agingRecordCount.toLocaleString()}
            </Badge>
          </section>

          {/* Recurring bottlenecks */}
          {data.recurringBottlenecks.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Recurring bottlenecks (in both work orders &amp; turns)
              </h4>
              <ul className="space-y-1.5">
                {data.recurringBottlenecks.slice(0, 5).map((b) => (
                  <li
                    key={b.category}
                    className="flex items-center justify-between text-sm"
                    data-testid={`bottleneck-${b.category}`}
                  >
                    <span className="font-medium">{b.category}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.workOrderCount} WO · {b.turnCount} turns · {b.totalCount} total
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {data && (
        <div className="mt-3 text-xs text-muted-foreground text-right">
          {data.admissibleRecordCount} admissible records · {data.trendWindow} window ·{" "}
          Generated {new Date(data.generatedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
