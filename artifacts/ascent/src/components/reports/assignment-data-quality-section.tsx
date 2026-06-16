/**
 * Ascent 7.7 — Assignment + Data Quality Reporting Section
 *
 * Reports on trust quality: how much operational data is fully resolved,
 * partially resolved, or unresolved. Surfaces the review queue — records
 * that need attention before they feed reporting conclusions.
 *
 * Uses the existing /api/reporting-analysis/all assignments data.
 * Does not reinvent the assignment engine — only reports its output.
 */

import { useEffect, useState } from "react";
import {
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowRight,
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContributingFactor {
  label: string;
  displayValue: string;
  numericValue: number;
  count?: number;
  supportingRecordIds?: string[];
}

interface AnalysisOutput {
  analysisId: string;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  contributingFactors: ContributingFactor[];
  confidenceState: "confirmed_analysis" | "qualified_analysis" | "insufficient_data";
  fullyReportableRecordCount: number;
  partiallyReportableRecordCount: number;
  excludedRecordCount: number;
  supportingRecordIds: string[];
  supportingRecordCount: number;
  recommendedReviewQuestion: string;
}

interface SupportingRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  unitNameOrNumber: string | null;
  category: string | null;
  status: string | null;
  reportingEligibility: string;
  reportingLimitations: { code: string; message: string }[];
  inclusionReason: string | null;
}

// ─── Drill sheet ──────────────────────────────────────────────────────────────

function ReviewQueueSheet({
  analysisId: aid,
  title,
  open,
  onClose,
}: {
  analysisId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<SupportingRecord[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !aid) return;
    setLoading(true);
    setRecords(null);
    fetch(`/api/reporting-analysis/supporting-records?analysisId=${encodeURIComponent(aid)}`)
      .then((r) => r.json())
      .then((d: { records: SupportingRecord[] }) => setRecords(d.records ?? []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [open, aid]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="review-queue-sheet">
        <SheetHeader>
          <SheetTitle>{title} — Review Queue</SheetTitle>
          <SheetDescription>
            Records that are partially resolved or unresolved. Resolve these to lift reporting confidence across all analyses.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-3">
          {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          {!loading && records?.length === 0 && (
            <p className="text-sm text-muted-foreground">No records in review queue.</p>
          )}
          {!loading && records && records.length > 0 && (
            <ul className="space-y-3" data-testid="review-queue-records">
              {records.slice(0, 100).map((r) => (
                <li key={r.id} className="rounded-md border border-border bg-card p-3 text-sm" data-testid="review-queue-row">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {r.category ?? r.sourceType} — #{r.sourceRecordId}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
                        {r.propertyName && <span>{r.propertyName}</span>}
                        {r.unitNameOrNumber && <span>Unit {r.unitNameOrNumber}</span>}
                        {r.status && <span>Status: {r.status}</span>}
                      </div>
                      {r.reportingLimitations.length > 0 && (
                        <ul className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 space-y-0.5">
                          {r.reportingLimitations.map((l) => (
                            <li key={l.code}>• {l.message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-xs ${
                        r.reportingEligibility === "fully_reportable"
                          ? "border-status-green/40 text-status-green"
                          : r.reportingEligibility === "partially_reportable"
                          ? "border-amber-500/40 text-amber-600"
                          : "border-status-red/40 text-status-red"
                      }`}
                    >
                      {r.reportingEligibility.replace(/_/g, " ")}
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
      </SheetContent>
    </Sheet>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  accent,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: number;
  accent?: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || value === 0}
      className="rounded-md border border-border bg-secondary/30 p-3 text-center disabled:cursor-default disabled:opacity-60 hover:enabled:bg-secondary/60 transition-colors"
      data-testid={`data-quality-stat-${label.toLowerCase().replace(/\s/g, "-")}`}
    >
      <Icon className={`w-4 h-4 mx-auto mb-1 ${accent ?? "text-muted-foreground"}`} />
      <div className={`text-xl font-bold ${accent ?? "text-foreground"}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AssignmentDataQualitySection() {
  const [analysis, setAnalysis] = useState<AnalysisOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-analysis/all")
      .then((r) => r.json())
      .then((bundle: { assignments: AnalysisOutput[] }) => {
        const a = bundle.assignments?.[0] ?? null;
        setAnalysis(a);
      })
      .catch(() => setError("Failed to load assignment data quality report."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-3" data-testid="assignment-dq-loading">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between" data-testid="assignment-dq-error">
        <p className="text-sm text-muted-foreground">{error ?? "No assignment data available."}</p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const fully = analysis.fullyReportableRecordCount;
  const partial = analysis.partiallyReportableRecordCount;
  const excluded = analysis.excludedRecordCount;
  const total = fully + partial + excluded;
  const reviewCount = partial + excluded;

  const confidenceMeta = {
    confirmed_analysis: { label: "Confirmed", tone: "border-status-green/40 text-status-green bg-status-green/10", icon: CheckCircle2 },
    qualified_analysis: { label: "Partially supported", tone: "border-amber-500/40 text-amber-600 bg-amber-500/10", icon: AlertTriangle },
    insufficient_data: { label: "Not enough data", tone: "border-border text-muted-foreground bg-secondary", icon: AlertTriangle },
  }[analysis.confidenceState];

  const ConfIcon = confidenceMeta.icon;

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4" data-testid="assignment-dq-section">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">{analysis.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{analysis.summary}</p>
            </div>
          </div>
          <Badge variant="outline" className={`shrink-0 text-xs ${confidenceMeta.tone}`}>
            <ConfIcon className="w-3 h-3 mr-1" />
            {confidenceMeta.label}
          </Badge>
        </div>

        {/* Stat tiles */}
        {total > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <StatTile
              label="Fully resolved"
              value={fully}
              accent="text-status-green"
              icon={CheckCircle2}
            />
            <StatTile
              label="Partial — review queue"
              value={partial}
              accent="text-amber-500"
              icon={AlertTriangle}
              onClick={reviewCount > 0 ? () => setDrillOpen(true) : undefined}
            />
            <StatTile
              label="Unresolved"
              value={excluded}
              accent="text-status-red"
              icon={XCircle}
              onClick={reviewCount > 0 ? () => setDrillOpen(true) : undefined}
            />
          </div>
        )}

        {/* Review queue CTA */}
        {reviewCount > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {reviewCount} record{reviewCount !== 1 ? "s" : ""} in review queue
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {analysis.recommendedReviewQuestion}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs border-amber-500/40 text-amber-600"
              onClick={() => setDrillOpen(true)}
              data-testid="open-review-queue"
            >
              Open queue <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        )}

        {total === 0 && (
          <p className="text-sm text-muted-foreground">
            No assignment records yet. Upload operational data so the assignment engine can establish coverage.
          </p>
        )}
      </div>

      {/* Drill sheet */}
      <ReviewQueueSheet
        analysisId={analysis.analysisId}
        title={analysis.title}
        open={drillOpen}
        onClose={() => setDrillOpen(false)}
      />
    </>
  );
}
