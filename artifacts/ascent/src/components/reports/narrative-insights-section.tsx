/**
 * Ascent 7.3 — Narrative Insights Section
 *
 * Renders the bundle returned by /api/narrative-insights. Each card is
 * clickable: clicking opens the existing AnalysisSupportingRecordsSheet
 * keyed on the insight's sourceAnalysisId, so every count on screen can
 * be traced to the exact records that produced it.
 *
 * Empty / low-data state is honest — when the bundle reports isEmpty it
 * shows the upload/reportability counters with the exact spec wording.
 */

import { useEffect, useState } from "react";
import {
  Sparkles,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  CircleSlash,
  Eye,
  ArrowRight,
  ShieldAlert,
  Activity,
  Layers,
  ClipboardList,
  Wrench,
  Home,
  FileText,
  UserCheck,
  Boxes,
  TimerReset,
  HelpCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalysisDrillContext } from "./reporting-analysis-sections";

// ─── Types ────────────────────────────────────────────────────────────────────

type InsightCategory =
  | "work_order_performance"
  | "turn_performance"
  | "preventative_maintenance_readiness"
  | "asset_warranty_readiness"
  | "assignment_coverage"
  | "evidence_documentation_gaps"
  | "time_allocation"
  | "bottleneck_detection"
  | "risk_pattern"
  | "data_quality_reporting_readiness";

type InsightSeverity =
  | "informational"
  | "watch"
  | "needs_review"
  | "priority"
  | "critical";

type InsightConfidence = "high" | "medium" | "low";

type InsightDataSupport =
  | "fully_supported"
  | "partially_supported"
  | "directional_only"
  | "not_enough_data";

interface NarrativeInsight {
  insightId: string;
  sourceAnalysisId: string;
  reportType: string;
  insightCategory: InsightCategory;
  insightSeverity: InsightSeverity;
  confidenceLevel: InsightConfidence;
  dataSupportLevel: InsightDataSupport;
  headline: string;
  plainLanguageSummary: string;
  operationalWhyItMatters: string;
  supportingRecordCount: number;
  supportingRecordIds: string[];
  sourceMetricsUsed: string[];
  reportabilityBreakdown: {
    fullyReportableCount: number;
    partiallyReportableCount: number;
    notReportableYetCount: number;
    totalRecordsReviewed: number;
    percentFullyReportable: number;
    limitationText: string | null;
  };
  limitationText: string | null;
  recommendedReviewQuestion: string;
  suggestedNextStep: string;
}

interface NarrativeInsightsBundle {
  insights: NarrativeInsight[];
  emptyState: {
    isEmpty: boolean;
    message: string;
    recordsUploaded: number;
    fullyReportableRecords: number;
    partiallyReportableRecords: number;
    notReportableYetRecords: number;
    missingFieldsBlockingInsights: string[];
    suggestedNextUpload: string;
  };
  reportingMode: string;
  reportingModeSummary?: { mode: string };
  generatedAt: string;
}

// ─── Visual helpers ───────────────────────────────────────────────────────────

const SEVERITY_META: Record<
  InsightSeverity,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  informational: {
    label: "Informational",
    tone: "border-border bg-secondary text-muted-foreground",
    icon: CircleSlash,
  },
  watch: {
    label: "Watch",
    tone: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    icon: Eye,
  },
  needs_review: {
    label: "Needs Review",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
  },
  priority: {
    label: "Priority",
    tone: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    icon: TimerReset,
  },
  critical: {
    label: "Critical",
    tone: "border-status-red/40 bg-status-red/10 text-status-red",
    icon: ShieldAlert,
  },
};

const CONFIDENCE_META: Record<InsightConfidence, { label: string; tone: string }> = {
  high: { label: "High confidence", tone: "border-status-green/40 bg-status-green/10 text-status-green" },
  medium: { label: "Medium confidence", tone: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  low: { label: "Low confidence", tone: "border-border bg-secondary text-muted-foreground" },
};

const CATEGORY_META: Record<
  InsightCategory,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  work_order_performance: { label: "Work Order Performance", icon: Wrench },
  turn_performance: { label: "Turn Performance", icon: Home },
  preventative_maintenance_readiness: { label: "Preventative Maintenance", icon: ClipboardList },
  asset_warranty_readiness: { label: "Asset & Warranty", icon: Boxes },
  assignment_coverage: { label: "Assignment Coverage", icon: UserCheck },
  evidence_documentation_gaps: { label: "Evidence & Documentation", icon: FileText },
  time_allocation: { label: "Time Allocation", icon: Activity },
  bottleneck_detection: { label: "Bottleneck", icon: TimerReset },
  risk_pattern: { label: "Risk Pattern", icon: Layers },
  data_quality_reporting_readiness: { label: "Reporting Readiness", icon: HelpCircle },
};

const SUPPORT_LABEL: Record<InsightDataSupport, string> = {
  fully_supported: "Fully supported",
  partially_supported: "Partially supported",
  directional_only: "Directional only",
  not_enough_data: "Not enough data",
};

// ─── Card ─────────────────────────────────────────────────────────────────────

function InsightCard({
  insight,
  onDrill,
}: {
  insight: NarrativeInsight;
  onDrill: (ctx: AnalysisDrillContext) => void;
}) {
  const sev = SEVERITY_META[insight.insightSeverity];
  const conf = CONFIDENCE_META[insight.confidenceLevel];
  const cat = CATEGORY_META[insight.insightCategory];
  const SevIcon = sev.icon;
  const CatIcon = cat.icon;

  const clickable = insight.supportingRecordCount > 0;
  const handleOpen = () => {
    if (!clickable) return;
    onDrill({
      analysisId: insight.sourceAnalysisId,
      analysisTitle: insight.headline,
    });
  };

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : -1}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={`rounded-lg border border-border bg-card p-4 space-y-3 transition-colors ${
        clickable ? "cursor-pointer hover:border-primary/40" : "opacity-90"
      }`}
      data-testid={`narrative-insight-card-${insight.insightId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            <CatIcon className="h-3 w-3" />
            <span>{cat.label}</span>
            <span aria-hidden="true">·</span>
            <span>{insight.reportType}</span>
          </div>
          <h3 className="font-semibold leading-tight">{insight.headline}</h3>
        </div>
        <div
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${sev.tone}`}
          data-testid={`narrative-insight-severity-${insight.insightId}`}
        >
          <SevIcon className="h-3 w-3" />
          {sev.label}
        </div>
      </div>

      <p className="text-sm text-foreground/90">{insight.plainLanguageSummary}</p>

      <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2 text-xs">
        <div className="flex items-start gap-2">
          <span className="uppercase tracking-wider text-muted-foreground shrink-0">Why it matters:</span>
          <span className="text-foreground/80">{insight.operationalWhyItMatters}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="uppercase tracking-wider text-muted-foreground shrink-0">Review question:</span>
          <span className="italic text-foreground/80">{insight.recommendedReviewQuestion}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="uppercase tracking-wider text-muted-foreground shrink-0">Next step:</span>
          <span className="text-foreground/80">{insight.suggestedNextStep}</span>
        </div>
      </div>

      {insight.limitationText && (
        <div
          className="text-[11px] rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-amber-700 dark:text-amber-400"
          data-testid={`narrative-insight-limitation-${insight.insightId}`}
        >
          <AlertTriangle className="inline h-3 w-3 mr-1" />
          {insight.limitationText}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${conf.tone}`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {conf.label}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {SUPPORT_LABEL[insight.dataSupportLevel]}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {insight.reportabilityBreakdown.percentFullyReportable}% fully reportable
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 h-7 text-xs"
          disabled={!clickable}
          onClick={(e) => {
            e.stopPropagation();
            handleOpen();
          }}
          data-testid={`narrative-insight-drill-${insight.insightId}`}
        >
          {clickable
            ? `View ${insight.supportingRecordCount} record${insight.supportingRecordCount === 1 ? "" : "s"}`
            : "No supporting records"}
          {clickable && <ArrowRight className="h-3 w-3 ml-1" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function NarrativeInsightsSection({
  onDrill,
}: {
  onDrill: (ctx: AnalysisDrillContext) => void;
}) {
  const [bundle, setBundle] = useState<NarrativeInsightsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/narrative-insights")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: NarrativeInsightsBundle) => setBundle(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Hide readiness-only insights when there are real operational insights
  // — the bundle-level empty state covers low-data explanation; we don't
  // want to crowd the section with one readiness card per analysis.
  const operationalInsights =
    bundle?.insights.filter(
      (i) => i.dataSupportLevel !== "not_enough_data",
    ) ?? [];
  const readinessInsights =
    bundle?.insights.filter(
      (i) => i.dataSupportLevel === "not_enough_data",
    ) ?? [];

  return (
    <section data-testid="narrative-insights-section">
      <div className="rounded-lg border-2 border-primary/30 bg-primary/[0.03] p-4 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-base font-bold uppercase tracking-wider">
                Narrative insights — Build 7.3
              </h2>
            </div>
            <p className="text-xs text-muted-foreground max-w-3xl leading-snug">
              Plain-language operational insights generated from the report
              analysis above, the underlying data confidence, and the supporting
              records — every card links back to the exact records that
              produced it.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            className="h-7 text-xs shrink-0"
            data-testid="narrative-insights-refresh"
          >
            <RotateCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        {bundle && !bundle.emptyState.isEmpty && (
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] mt-3"
            data-testid="narrative-readiness-summary"
          >
            <ReadinessStat
              label="Fully supported"
              value={bundle.insights.filter((i) => i.dataSupportLevel === "fully_supported").length}
              tone="text-status-green"
            />
            <ReadinessStat
              label="Partially supported"
              value={bundle.insights.filter((i) => i.dataSupportLevel === "partially_supported").length}
              tone="text-amber-500"
            />
            <ReadinessStat
              label="Directional only"
              value={bundle.insights.filter((i) => i.dataSupportLevel === "directional_only").length}
              tone="text-sky-500"
            />
            <ReadinessStat
              label="Blocked by missing data"
              value={bundle.insights.filter((i) => i.dataSupportLevel === "not_enough_data").length}
              tone="text-muted-foreground"
            />
          </div>
        )}
      </div>

      {error && (
        <div
          className="rounded-lg border border-status-red/40 bg-status-red/5 p-3 text-sm text-status-red"
          data-testid="narrative-insights-error"
        >
          Failed to load narrative insights: {error}
        </div>
      )}

      {loading && !bundle && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}
        </div>
      )}

      {bundle && bundle.emptyState.isEmpty && (
        <div
          className="rounded-lg border border-border bg-card p-4 space-y-3"
          data-testid="narrative-insights-empty"
        >
          <p className="text-sm">{bundle.emptyState.message}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <ReadinessStat label="Records uploaded" value={bundle.emptyState.recordsUploaded} />
            <ReadinessStat label="Fully reportable" value={bundle.emptyState.fullyReportableRecords} tone="text-status-green" />
            <ReadinessStat label="Partially reportable" value={bundle.emptyState.partiallyReportableRecords} tone="text-amber-500" />
            <ReadinessStat label="Not reportable yet" value={bundle.emptyState.notReportableYetRecords} tone="text-status-red" />
          </div>
          {bundle.emptyState.missingFieldsBlockingInsights.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="uppercase tracking-wider">Blocking gaps:</span>{" "}
              {bundle.emptyState.missingFieldsBlockingInsights.map((c) => c.replace(/_/g, " ")).join(" · ")}
            </div>
          )}
          <p className="text-xs italic text-muted-foreground">
            Suggested next step: {bundle.emptyState.suggestedNextUpload}
          </p>
        </div>
      )}

      {bundle && !bundle.emptyState.isEmpty && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="narrative-insights-grid">
            {operationalInsights.map((i) => (
              <InsightCard key={i.insightId} insight={i} onDrill={onDrill} />
            ))}
          </div>
          {readinessInsights.length > 0 && (
            <details className="text-xs" data-testid="narrative-insights-readiness">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {readinessInsights.length} reporting-readiness note(s) — areas waiting on more complete data
              </summary>
              <ul className="mt-2 space-y-1 pl-4 list-disc text-muted-foreground">
                {readinessInsights.map((i) => (
                  <li key={i.insightId}>
                    <span className="font-medium text-foreground">{i.headline}</span>
                    {i.limitationText && <> — {i.limitationText}</>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="text-[11px] text-muted-foreground italic">
            Generated {new Date(bundle.generatedAt).toLocaleString()}.
            Every insight links to the exact supporting records that produced it.
            Click any card to open the proof set.
          </div>
        </div>
      )}
    </section>
  );
}

function ReadinessStat({ label, value, tone = "text-foreground" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md bg-secondary/40 px-2 py-1.5">
      <div className="uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-semibold ${tone}`}>{value.toLocaleString()}</div>
    </div>
  );
}
