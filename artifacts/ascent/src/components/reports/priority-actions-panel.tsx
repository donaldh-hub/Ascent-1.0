/**
 * Ascent 8.1 — Priority Actions Panel
 *
 * Shows the top priority actions ranked by urgency and record count.
 * Each action links to the AnalysisSupportingRecordsSheet via analysisId.
 *
 * Falls back to /api/reporting-analysis/all if the dedicated endpoint fails.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Info,
  RefreshCw,
  Zap,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalysisDrillContext } from "@/components/reports/reporting-analysis-sections";

// ─── Types ────────────────────────────────────────────────────────────────────

type PriorityActionUrgency = "critical" | "warning" | "info";

interface PriorityAction {
  rank: number;
  category: string;
  title: string;
  reason: string;
  recordCount: number;
  urgency: PriorityActionUrgency;
  analysisId: string;
}

interface PriorityActionList {
  generatedAt: string;
  actions: PriorityAction[];
  totalActionsConsidered: number;
}

// ─── Urgency styles ───────────────────────────────────────────────────────────

const URGENCY_META: Record<
  PriorityActionUrgency,
  { icon: React.ElementType; badge: string; text: string; label: string }
> = {
  critical: {
    icon: AlertTriangle,
    badge: "border-status-red/40 text-status-red bg-status-red/10",
    text: "text-status-red",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    badge: "border-amber-500/40 text-amber-600 bg-amber-500/10",
    text: "text-amber-500",
    label: "Warning",
  },
  info: {
    icon: Info,
    badge: "border-blue-500/40 text-blue-600 bg-blue-500/10",
    text: "text-blue-500",
    label: "Info",
  },
};

// ─── Action row ───────────────────────────────────────────────────────────────

function ActionRow({
  action,
  onDrill,
}: {
  action: PriorityAction;
  onDrill: (ctx: AnalysisDrillContext) => void;
}) {
  const meta = URGENCY_META[action.urgency];
  const Icon = meta.icon;

  return (
    <div
      className="flex items-start gap-3 py-3 border-b border-border last:border-0"
      data-testid={`priority-action-${action.rank}`}
    >
      {/* Rank */}
      <div className="shrink-0 w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[11px] font-bold text-muted-foreground mt-0.5">
        {action.rank}
      </div>

      {/* Icon */}
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.text}`} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{action.title}</span>
          <Badge variant="outline" className={`text-xs ${meta.badge}`}>
            {meta.label}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {action.recordCount.toLocaleString()} records
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{action.reason}</p>
      </div>

      {/* View records */}
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs"
        onClick={() =>
          onDrill({ analysisId: action.analysisId, analysisTitle: action.title })
        }
        data-testid={`priority-action-drill-${action.rank}`}
      >
        View records <ArrowRight className="w-3 h-3 ml-1" />
      </Button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PriorityActionsPanel({
  onDrill,
}: {
  onDrill: (ctx: AnalysisDrillContext) => void;
}) {
  const [data, setData] = useState<PriorityActionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);

    fetch("/api/reporting-analysis/priority-actions")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PriorityActionList) => setData(d))
      .catch(() => {
        // Fallback: derive a basic list from /all
        fetch("/api/reporting-analysis/all")
          .then((r) => r.json())
          .then((bundle: Record<string, unknown>) => {
            // Collect all analyses from the bundle
            const categories = ["workOrders", "turns", "pm", "assets", "evidence", "assignments", "crossCategory"];
            const allAnalyses: Array<{
              analysisId: string;
              title: string;
              sourceCategory: string;
              supportingRecordCount: number;
              confidenceState: string;
            }> = [];
            for (const cat of categories) {
              const arr = bundle[cat];
              if (Array.isArray(arr)) {
                for (const a of arr) {
                  if (
                    a &&
                    typeof a === "object" &&
                    a.confidenceState !== "insufficient_data" &&
                    (a.supportingRecordCount ?? 0) > 0
                  ) {
                    allAnalyses.push(a);
                  }
                }
              }
            }
            allAnalyses.sort((a, b) => b.supportingRecordCount - a.supportingRecordCount);
            const actions: PriorityAction[] = allAnalyses.slice(0, 10).map((a, i) => ({
              rank: i + 1,
              category: a.sourceCategory,
              title: a.title,
              reason: `${a.supportingRecordCount} records contribute to this analysis (derived via fallback).`,
              recordCount: a.supportingRecordCount,
              urgency: a.confidenceState === "qualified_analysis" ? "warning" : "info",
              analysisId: a.analysisId,
            }));
            setData({
              generatedAt: new Date().toISOString(),
              actions,
              totalActionsConsidered: allAnalyses.length,
            });
          })
          .catch((e: Error) => setError(e.message));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="priority-actions-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Build 8.1 — Priority Actions</h3>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {loading && !data && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      )}

      {error && (
        <p className="text-sm text-muted-foreground" data-testid="priority-actions-error">
          Priority actions unavailable: {error}
        </p>
      )}

      {data && data.actions.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="priority-actions-empty">
          No priority actions at this time — all reporting signals are within normal thresholds.
        </p>
      )}

      {data && data.actions.length > 0 && (
        <>
          <div className="rounded-md border border-border" data-testid="priority-actions-list">
            <div className="divide-y divide-border px-3">
              {data.actions.map((action) => (
                <ActionRow key={action.analysisId} action={action} onDrill={onDrill} />
              ))}
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground text-right">
            {data.totalActionsConsidered} analysis output(s) considered ·{" "}
            Generated {new Date(data.generatedAt).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}
