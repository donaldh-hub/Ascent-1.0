/**
 * Ascent 7.2 — Reporting Analysis Sections
 *
 * Renders the analysis bundle produced by /api/reporting-analysis/all as
 * one section per category. Each card shows:
 *   - title + summary
 *   - confidence badge (Confirmed / Qualified / Insufficient Data)
 *   - headline metric (where available)
 *   - fully / partial / excluded counts (the honesty layer)
 *   - top contributing factors with their own counts
 *   - "View supporting records" button → opens drill sheet
 *
 * The drill sheet hits /api/reporting-analysis/supporting-records to
 * hydrate the same record IDs the engine used to draw its conclusion.
 */

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  CircleSlash,
  RotateCw,
  ArrowRight,
  Wrench,
  Home,
  ClipboardList,
  Boxes,
  FileText,
  UserCheck,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

// ─── Types (mirror api-server/services/analysis-output-contract) ──────────────

export type ConfidenceState = "confirmed_analysis" | "qualified_analysis" | "insufficient_data";

type AnalysisType =
  | "work_order_time_allocation"
  | "turn_time_allocation"
  | "pm_time_allocation"
  | "asset_warranty_risk"
  | "evidence_impact"
  | "assignment_coverage"
  | "cross_category_pressure";

interface ContributingFactor {
  label: string;
  displayValue: string;
  numericValue: number;
  count?: number;
  supportingRecordIds?: string[];
}

interface AnalysisOutput {
  analysisId: string;
  analysisType: AnalysisType;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  contributingFactors: ContributingFactor[];
  confidenceState: ConfidenceState;
  reportabilityBasis: { admitted: string[]; explanation: string };
  fullyReportableRecordCount: number;
  partiallyReportableRecordCount: number;
  excludedRecordCount: number;
  missingFields: string[];
  supportingRecordIds: string[];
  supportingRecordCount: number;
  recommendedReviewQuestion: string;
  bottleneckStage: string | null;
  primaryCategory: string | null;
}

interface AnalysisBundle {
  workOrders: AnalysisOutput[];
  turns: AnalysisOutput[];
  pm: AnalysisOutput[];
  assets: AnalysisOutput[];
  evidence: AnalysisOutput[];
  assignments: AnalysisOutput[];
  crossCategory: AnalysisOutput[];
  generatedAt: string;
}

export interface AnalysisDrillContext {
  analysisId: string;
  analysisTitle: string;
}

// ─── Visual helpers ───────────────────────────────────────────────────────────

const CONFIDENCE_META: Record<
  ConfidenceState,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  confirmed_analysis: {
    label: "Confirmed analysis",
    tone: "border-status-green/40 bg-status-green/10 text-status-green",
    icon: CheckCircle2,
  },
  qualified_analysis: {
    label: "Qualified analysis",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
  },
  insufficient_data: {
    label: "Insufficient data",
    tone: "border-border bg-secondary text-muted-foreground",
    icon: CircleSlash,
  },
};

const SECTION_META: Record<
  string,
  { title: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  workOrders: {
    title: "Work Order Time Allocation",
    description: "Where work order attention is concentrated, and which records prove it.",
    icon: Wrench,
  },
  turns: {
    title: "Turn / Make-Ready Time",
    description: "Which stage is slowing release and where vacant days are accumulating.",
    icon: Home,
  },
  pm: {
    title: "Preventative Maintenance",
    description: "PM coverage. Activates when PM logs are ingested.",
    icon: ClipboardList,
  },
  assets: {
    title: "Asset & Warranty Risk",
    description: "Foundation for Build 9 — asset distribution and out-of-warranty exposure.",
    icon: Boxes,
  },
  evidence: {
    title: "Evidence & Documentation",
    description: "How many operational claims are backed by supporting documents.",
    icon: FileText,
  },
  assignments: {
    title: "Assignment Coverage",
    description: "How much data is fully attributed to the right operational context.",
    icon: UserCheck,
  },
  crossCategory: {
    title: "Cross-Category Pressure",
    description: "Where pressure may be concentrating across categories. Review with supporting records.",
    icon: Layers,
  },
};

const SECTION_ORDER: (keyof AnalysisBundle)[] = [
  "workOrders",
  "turns",
  "pm",
  "assets",
  "evidence",
  "assignments",
  "crossCategory",
];

function prettyLimitationCode(code: string): string {
  switch (code) {
    case "missing_property": return "missing property";
    case "missing_unit": return "missing unit";
    case "missing_asset": return "missing asset";
    case "missing_dates": return "missing dates";
    case "missing_status": return "missing status";
    case "missing_priority": return "missing priority";
    case "low_assignment_confidence": return "low assignment confidence";
    case "resolution_unresolved": return "unresolved match";
    case "resolution_partial": return "partial match";
    case "raw_only_no_match": return "raw, unmatched";
    default: return code.replace(/_/g, " ");
  }
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function AnalysisCard({
  analysis,
  onDrill,
}: {
  analysis: AnalysisOutput;
  onDrill: (ctx: AnalysisDrillContext) => void;
}) {
  const meta = CONFIDENCE_META[analysis.confidenceState];
  const Icon = meta.icon;

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 space-y-3"
      data-testid={`analysis-card-${analysis.analysisId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">{analysis.title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{analysis.summary}</p>
        </div>
        <div
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}
          data-testid={`analysis-confidence-${analysis.analysisId}`}
          title={analysis.reportabilityBasis.explanation}
        >
          <Icon className="h-3 w-3" />
          {meta.label}
        </div>
      </div>

      {analysis.metricValue != null && (
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold">
            {analysis.metricValue.toLocaleString()}
          </div>
          {analysis.metricUnit && (
            <div className="text-xs text-muted-foreground">{analysis.metricUnit}</div>
          )}
        </div>
      )}

      {analysis.contributingFactors.length > 0 && (
        <ul className="space-y-1 text-xs" data-testid={`analysis-factors-${analysis.analysisId}`}>
          {analysis.contributingFactors.slice(0, 5).map((f) => (
            <li
              key={f.label}
              className="flex items-center justify-between rounded-md px-2 py-1 bg-secondary/40"
            >
              <span className="truncate text-muted-foreground">{f.label}</span>
              <span className="font-medium ml-2 shrink-0">{f.displayValue}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-border">
        <CountStat label="Fully" value={analysis.fullyReportableRecordCount} tone="text-status-green" />
        <CountStat label="Partial" value={analysis.partiallyReportableRecordCount} tone="text-amber-500" />
        <CountStat label="Excluded" value={analysis.excludedRecordCount} tone="text-muted-foreground" />
      </div>

      {analysis.missingFields.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wider">Top gaps:</span>{" "}
          {analysis.missingFields.slice(0, 3).map(prettyLimitationCode).join(" · ")}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-[11px] text-muted-foreground italic truncate" title={analysis.recommendedReviewQuestion}>
          {analysis.recommendedReviewQuestion}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 h-7 text-xs"
          disabled={analysis.supportingRecordCount === 0}
          onClick={() =>
            onDrill({ analysisId: analysis.analysisId, analysisTitle: analysis.title })
          }
          data-testid={`analysis-drill-${analysis.analysisId}`}
        >
          {analysis.supportingRecordCount > 0
            ? `View ${analysis.supportingRecordCount} supporting record${analysis.supportingRecordCount === 1 ? "" : "s"}`
            : "No supporting records"}
          {analysis.supportingRecordCount > 0 && <ArrowRight className="h-3 w-3 ml-1" />}
        </Button>
      </div>
    </div>
  );
}

function CountStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md bg-secondary/40 px-2 py-1.5">
      <div className="uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-semibold ${tone}`}>{value.toLocaleString()}</div>
    </div>
  );
}

// ─── Top-level sections wrapper ───────────────────────────────────────────────

export function ReportingAnalysisSections({
  onDrill,
}: {
  onDrill: (ctx: AnalysisDrillContext) => void;
}) {
  const [bundle, setBundle] = useState<AnalysisBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-analysis/all")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: AnalysisBundle) => setBundle(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <section data-testid="reporting-analysis-sections">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Reporting analysis — Build 7.2
          </h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={loading}
          className="h-7 text-xs"
          data-testid="analysis-refresh"
        >
          <RotateCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div
          className="rounded-lg border border-status-red/40 bg-status-red/5 p-3 text-sm text-status-red"
          data-testid="analysis-error"
        >
          Failed to load reporting analysis: {error}
        </div>
      )}

      {loading && !bundle && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}
        </div>
      )}

      {bundle && (
        <div className="space-y-6">
          {SECTION_ORDER.map((key) => {
            const items = bundle[key] as AnalysisOutput[];
            const meta = SECTION_META[key as string]!;
            const Icon = meta.icon;
            return (
              <div key={key} data-testid={`analysis-section-${key}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">{meta.title}</h3>
                  <Badge variant="outline" className="text-[10px]">
                    {items.length} analysis{items.length === 1 ? "" : "es"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{meta.description}</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {items.map((a) => (
                    <AnalysisCard key={a.analysisId} analysis={a} onDrill={onDrill} />
                  ))}
                </div>
              </div>
            );
          })}
          <div className="text-[11px] text-muted-foreground italic">
            Analysis generated {new Date(bundle.generatedAt).toLocaleString()}.
            Confirmed analyses use fully reportable records only. Qualified analyses include
            partially reportable records and label which gaps weakened the conclusion.
            Insufficient analyses honestly state that not enough reportable data is available yet.
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Drill sheet (supporting records for a single analysis) ──────────────────

interface SupportingRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  unitNameOrNumber: string | null;
  category: string | null;
  status: string | null;
  reportingEligibility: "fully_reportable" | "partially_reportable" | "not_reportable";
  reportingLimitations: { code: string; message: string }[];
}

export function AnalysisSupportingRecordsSheet({
  ctx,
  onClose,
}: {
  ctx: AnalysisDrillContext | null;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<SupportingRecord[] | null>(null);
  const [meta, setMeta] = useState<{
    confidenceState: ConfidenceState;
    supportingRecordCount: number;
    returnedCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ctx) return;
    setLoading(true);
    setRecords(null);
    setMeta(null);
    fetch(`/api/reporting-analysis/supporting-records?analysisId=${encodeURIComponent(ctx.analysisId)}`)
      .then((r) => r.json())
      .then((d) => {
        setRecords(d.records ?? []);
        setMeta({
          confidenceState: d.confidenceState,
          supportingRecordCount: d.supportingRecordCount,
          returnedCount: d.returnedCount,
        });
      })
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [ctx]);

  return (
    <Sheet open={!!ctx} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="analysis-drill-sheet"
      >
        {ctx && (
          <>
            <SheetHeader>
              <SheetTitle>{ctx.analysisTitle}</SheetTitle>
              <SheetDescription>
                Every record below was used to draw this conclusion. Click any record back
                in its source area (Work Orders, Turns, Assets, etc.) to take action.
                {meta && (
                  <span className="block mt-2 text-xs">
                    Confidence: <strong>{CONFIDENCE_META[meta.confidenceState].label}</strong>{" "}
                    · {meta.returnedCount} of {meta.supportingRecordCount} record(s) shown.
                  </span>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6">
              {loading && (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              )}
              {!loading && records && records.length === 0 && (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="analysis-drill-empty"
                >
                  No supporting records returned. This usually means the analysis is in an
                  Insufficient Data state — upload more complete records to strengthen it.
                </p>
              )}
              {!loading && records && records.length > 0 && (
                <ul className="space-y-3" data-testid="analysis-drill-records">
                  {records.slice(0, 100).map((r) => (
                    <li
                      key={r.id}
                      className="rounded-md border border-border bg-card p-3 text-sm"
                      data-testid="analysis-drill-record-row"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {(r.category ?? r.sourceType) + ` — #${r.sourceRecordId}`}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 space-x-2">
                            {r.propertyName && <span>Property: {r.propertyName}</span>}
                            {r.unitNameOrNumber && <span>Unit: {r.unitNameOrNumber}</span>}
                            {r.status && <span>Status: {r.status}</span>}
                          </div>
                          {r.reportingLimitations.length > 0 && (
                            <ul className="mt-2 text-xs text-amber-600 dark:text-amber-400 space-y-0.5">
                              {r.reportingLimitations.map((l) => (
                                <li key={l.code}>• {l.message}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {r.reportingEligibility.replace("_", " ")}
                        </Badge>
                      </div>
                    </li>
                  ))}
                  {records.length > 100 && (
                    <li className="text-xs text-muted-foreground text-center pt-2">
                      Showing first 100 of {records.length} records.
                    </li>
                  )}
                </ul>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
