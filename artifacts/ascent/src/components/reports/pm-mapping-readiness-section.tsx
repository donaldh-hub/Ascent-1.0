/**
 * Ascent 7.5 — PM Mapping Readiness Section
 *
 * Lightweight section on /reports that surfaces the PM Data Mapping Layer
 * output. Build 7.5 scope (spec §UI rules):
 *   - mapping readiness, NOT final PM performance
 *   - clear low-data state
 *   - clickable supporting-record drill (reuses the existing
 *     AnalysisSupportingRecordsSheet from Build 7.2)
 *   - PM-only language; no work-order or turn vocabulary
 *
 * This section does NOT visually imply Build 7.6 / 7.7 / 7.8 PM
 * intelligence exists yet.
 */
import { useEffect, useState } from "react";
import { ClipboardList, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalysisDrillContext } from "@/components/reports/reporting-analysis-sections";

interface ContributingFactor {
  label: string;
  displayValue: string;
  numericValue: number;
  count?: number;
  supportingRecordIds?: string[];
}

interface PmAnalysis {
  analysisId: string;
  analysisType: string;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  fullyReportableRecordCount: number;
  partiallyReportableRecordCount: number;
  excludedRecordCount: number;
  supportingRecordIds: string[];
  supportingRecordCount: number;
  contributingFactors: ContributingFactor[];
  recommendedReviewQuestion: string;
  confidenceState:
    | "confirmed_analysis"
    | "qualified_analysis"
    | "insufficient_data";
}

interface Bundle {
  pm: PmAnalysis[];
}

export function PmMappingReadinessSection({
  onDrill,
}: {
  onDrill: (ctx: AnalysisDrillContext) => void;
}) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reporting-analysis/all")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: Bundle) => {
        if (!cancelled) setBundle(j);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick the PM mapping readiness analysis (Build 7.5 emits exactly one).
  const pm = bundle?.pm?.[0] ?? null;

  return (
    <section data-testid="pm-mapping-readiness-section" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            PM mapping readiness
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Build 7.5 — preventative maintenance records mapped, classified, and
            prepared for future PM reporting. This view shows mapping readiness,
            not final PM performance.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="rounded-lg border border-status-red/40 bg-status-red/5 p-3 text-xs text-status-red"
          data-testid="pm-mapping-error"
        >
          Failed to load PM mapping readiness: {error}
        </div>
      )}

      {!bundle && !error && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {pm && pm.supportingRecordCount === 0 && (
        <div
          className="rounded-lg border border-dashed border-border bg-card/50 p-4 text-sm"
          data-testid="pm-mapping-empty"
        >
          <div className="font-medium">No preventative maintenance records mapped yet</div>
          <p className="text-xs text-muted-foreground mt-1">
            Upload PM logs or inspection records to begin PM reporting readiness.
            PM records are recognized when their category indicates preventative
            maintenance (PM, inspection, preventative maintenance, etc.).
          </p>
        </div>
      )}

      {pm && pm.supportingRecordCount > 0 && (
        <>
          {/* Mapping readiness tiles */}
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
            data-testid="pm-mapping-tiles"
          >
            <ReadinessTile
              label="PM records mapped"
              value={pm.supportingRecordCount}
              testId="pm-tile-total"
            />
            <ReadinessTile
              label="Fully reportable"
              value={pm.fullyReportableRecordCount}
              accent="text-status-green"
              testId="pm-tile-fully"
            />
            <ReadinessTile
              label="Partially reportable"
              value={pm.partiallyReportableRecordCount}
              accent="text-amber-500"
              testId="pm-tile-partial"
            />
            <ReadinessTile
              label="Not reportable yet"
              value={pm.excludedRecordCount}
              accent="text-status-red"
              testId="pm-tile-not"
            />
          </div>

          {/* Summary + drill-through */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{pm.title}</div>
                <p className="text-xs text-muted-foreground mt-1">{pm.summary}</p>
              </div>
              <Badge
                variant="outline"
                className="shrink-0"
                data-testid="pm-confidence-badge"
              >
                {confidenceLabel(pm.confidenceState)}
              </Badge>
            </div>

            <Button
              variant="outline"
              size="sm"
              data-testid="pm-mapping-drill"
              onClick={() =>
                onDrill({
                  analysisId: pm.analysisId,
                  analysisTitle: pm.title,
                })
              }
            >
              View {pm.supportingRecordCount} mapped PM record(s)
            </Button>

            {pm.recommendedReviewQuestion && (
              <p className="text-xs text-muted-foreground italic">
                {pm.recommendedReviewQuestion}
              </p>
            )}
          </div>

          {/* Top mapping warnings — PM-only vocabulary */}
          {pm.contributingFactors.filter((f) => isWarningFactor(f)).length >
            0 && (
            <div
              className="rounded-lg border border-border bg-card p-4"
              data-testid="pm-mapping-warnings"
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Common mapping warnings
              </div>
              <ul className="space-y-1.5">
                {pm.contributingFactors
                  .filter((f) => isWarningFactor(f))
                  .slice(0, 8)
                  .map((f) => (
                    <li
                      key={f.label}
                      className="flex items-center justify-between gap-3 text-sm"
                      data-testid={`pm-warning-row-${f.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      <span>{f.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {f.displayValue}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReadinessTile({
  label,
  value,
  accent,
  testId,
}: {
  label: string;
  value: number;
  accent?: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-4"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${accent ?? ""}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function confidenceLabel(s: PmAnalysis["confidenceState"]): string {
  switch (s) {
    case "confirmed_analysis":
      return "Confirmed";
    case "qualified_analysis":
      return "Qualified";
    case "insufficient_data":
    default:
      return "Insufficient data";
  }
}

/** Distinguish category factors from warning factors so the warnings tile
 *  only shows operator-actionable mapping issues, not the category breakdown. */
function isWarningFactor(f: ContributingFactor): boolean {
  return !/^Category:/i.test(f.label);
}
