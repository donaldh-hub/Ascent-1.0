/**
 * Ascent 7.1 — Reports / Reporting Readiness Page
 *
 * The trusted intake gate. For each reportable source type:
 *   - total / fully / partial / not reportable counts
 *   - coverage %
 *   - top missing fields
 *   - recommended next action
 * Click any non-zero count to open a drill-down listing the matching records
 * and the reason each one is included or excluded.
 *
 * This page is read-only and does not write back; resolutions happen through
 * the existing review queues (Assignments, Work Orders, etc.).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  FileBarChart,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  ExternalLink,
  RefreshCw,
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
import { ReportingAnalysisSections, AnalysisSupportingRecordsSheet } from "@/components/reports/reporting-analysis-sections";
import type { AnalysisDrillContext } from "@/components/reports/reporting-analysis-sections";
import { ReportingModeAssessment } from "@/components/reports/reporting-mode-assessment";
import { NarrativeInsightsSection } from "@/components/reports/narrative-insights-section";
import { PmMappingReadinessSection } from "@/components/reports/pm-mapping-readiness-section";
import { EvidenceReportSection } from "@/components/reports/evidence-report-section";
import { AssignmentDataQualitySection } from "@/components/reports/assignment-data-quality-section";
import { ReportExportPanel } from "@/components/reports/report-export-panel";
import { ReportingAuditGate } from "@/components/reports/reporting-audit-gate";
import { ImpactSnapshotPanel } from "@/components/reports/impact-snapshot-panel";
import { PriorityActionsPanel } from "@/components/reports/priority-actions-panel";
import { TrendPatternPanel } from "@/components/reports/trend-pattern-panel";
import { ImpactAuditGate } from "@/components/reports/impact-audit-gate";
import { AssetRegistryPanel } from "@/components/reports/asset-registry-panel";
import { WarrantyIntelligencePanel } from "@/components/reports/warranty-intelligence-panel";
import { AssetPerformancePanel } from "@/components/reports/asset-performance-panel";
import { AssetAuditGate } from "@/components/reports/asset-audit-gate";
import { CustomerReadinessAuditGate } from "@/components/reports/customer-readiness-audit-gate";
import { DataQualityPanel } from "@/components/reports/data-quality-panel";
import { Build11AuditGate } from "@/components/reports/build11-audit-gate";

// ─── Types (mirror api-server/services/reporting-record-contract) ─────────────

type SourceType =
  | "work_orders"
  | "turns"
  | "preventative_maintenance"
  | "assets"
  | "warranties"
  | "documents"
  | "assignments"
  | "workflow_items"
  | "alerts"
  | "score_snapshots";

type Eligibility = "fully_reportable" | "partially_reportable" | "not_reportable";

interface ReadinessRow {
  sourceType: SourceType;
  displayName: string;
  isWiredToday: boolean;
  totalRecords: number;
  fullyReportable: number;
  partiallyReportable: number;
  notReportable: number;
  coveragePercent: number;
  topMissingFields: { code: string; count: number }[];
  recommendedNextAction: string;
  lowDataMessage: string;
}

interface IngestionSummary {
  totalRecordsReviewed: number;
  fullyReportableCount: number;
  partiallyReportableCount: number;
  notReportableCount: number;
  recordsReadyForControlTower: number;
  recordsReadyForReports: number;
  generatedAt: string;
}

interface NormalizedRecord {
  id: string;
  sourceType: SourceType;
  sourceRecordId: number | string;
  propertyId: number | null;
  propertyName: string | null;
  unitId: number | null;
  unitNameOrNumber: string | null;
  category: string | null;
  status: string | null;
  reportingEligibility: Eligibility;
  reportingLimitations: { code: string; message: string }[];
  sourceFileName: string | null;
  sourceRowIndex: number | null;
}

interface DrillContext {
  sourceType: SourceType;
  sourceLabel: string;
  eligibility: Eligibility;
}

// ─── Drill-down side panel ────────────────────────────────────────────────────

function DrillSheet({
  ctx,
  onClose,
}: {
  ctx: DrillContext | null;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<NormalizedRecord[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ctx) return;
    setLoading(true);
    setRecords(null);
    fetch(`/api/reporting-ingestion/records?sourceType=${ctx.sourceType}&eligibility=${ctx.eligibility}`)
      .then((r) => r.json())
      .then((d: { records: NormalizedRecord[] }) => setRecords(d.records ?? []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [ctx]);

  const eligibilityLabel: Record<Eligibility, string> = {
    fully_reportable: "Fully reportable",
    partially_reportable: "Partially reportable",
    not_reportable: "Not reportable",
  };

  return (
    <Sheet open={!!ctx} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="drill-sheet">
        {ctx && (
          <>
            <SheetHeader>
              <SheetTitle>
                {ctx.sourceLabel} — {eligibilityLabel[ctx.eligibility]}
              </SheetTitle>
              <SheetDescription>
                {ctx.eligibility === "fully_reportable"
                  ? "These records meet every reporting requirement and feed unit-level reports as well as the Control Tower."
                  : ctx.eligibility === "partially_reportable"
                  ? "These records still feed the Control Tower and property-level reports, but unit context is incomplete so they are held back from unit-level reports until the gaps below are resolved."
                  : "These records are preserved but excluded from all reporting truth. Resolve their context to bring them in."}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6">
              {loading && (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              )}
              {!loading && records && records.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="drill-empty">
                  No matching records.
                </p>
              )}
              {!loading && records && records.length > 0 && (
                <ul className="space-y-3" data-testid="drill-records">
                  {records.slice(0, 100).map((r) => (
                    <li
                      key={r.id}
                      className="rounded-md border border-border bg-card p-3 text-sm"
                      data-testid="drill-record-row"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {r.category ? r.category : r.sourceType} — #{r.sourceRecordId}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 space-x-2">
                            {r.propertyName && <span>Property: {r.propertyName}</span>}
                            {r.unitNameOrNumber && <span>Unit: {r.unitNameOrNumber}</span>}
                            {r.status && <span>Status: {r.status}</span>}
                          </div>
                          {r.sourceFileName && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Source: {r.sourceFileName}
                              {r.sourceRowIndex != null ? ` · row ${r.sourceRowIndex}` : ""}
                            </div>
                          )}
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

// ─── Source row ───────────────────────────────────────────────────────────────

function SourceRow({
  row,
  onDrill,
}: {
  row: ReadinessRow;
  onDrill: (eligibility: Eligibility) => void;
}) {
  const empty = row.totalRecords === 0;
  const coverageColor =
    row.coveragePercent >= 90
      ? "text-status-green"
      : row.coveragePercent >= 50
      ? "text-amber-500"
      : "text-status-red";

  return (
    <div
      className="rounded-lg border border-border bg-card p-4"
      data-testid={`readiness-row-${row.sourceType}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{row.displayName}</h3>
            {!row.isWiredToday && (
              <Badge variant="outline" className="text-xs">
                Awaiting source data
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {empty ? row.lowDataMessage : row.recommendedNextAction}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-2xl font-bold ${coverageColor}`} data-testid={`readiness-coverage-${row.sourceType}`}>
            {row.coveragePercent}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Coverage
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
        <Stat
          label="Total"
          value={row.totalRecords}
          icon={<FileBarChart className="h-3.5 w-3.5 text-muted-foreground" />}
          testid={`readiness-total-${row.sourceType}`}
        />
        <Stat
          label="Fully"
          value={row.fullyReportable}
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-status-green" />}
          clickable={row.fullyReportable > 0}
          onClick={() => onDrill("fully_reportable")}
          testid={`readiness-fully-${row.sourceType}`}
        />
        <Stat
          label="Partial"
          value={row.partiallyReportable}
          icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
          clickable={row.partiallyReportable > 0}
          onClick={() => onDrill("partially_reportable")}
          testid={`readiness-partial-${row.sourceType}`}
        />
        <Stat
          label="Not"
          value={row.notReportable}
          icon={<XCircle className="h-3.5 w-3.5 text-status-red" />}
          clickable={row.notReportable > 0}
          onClick={() => onDrill("not_reportable")}
          testid={`readiness-not-${row.sourceType}`}
        />
      </div>

      {row.topMissingFields.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Top reasons for limitation
          </div>
          <ul className="space-y-1 text-xs">
            {row.topMissingFields.map((f) => (
              <li key={f.code} className="flex items-center justify-between">
                <span className="text-muted-foreground">{prettyCode(f.code)}</span>
                <span className="font-medium">{f.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  clickable,
  onClick,
  testid,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  clickable?: boolean;
  onClick?: () => void;
  testid?: string;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-lg font-semibold mt-0.5">{value.toLocaleString()}</div>
    </>
  );
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left rounded-md p-2 hover:bg-secondary transition-colors cursor-pointer"
        data-testid={testid}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-md p-2" data-testid={testid}>
      {content}
    </div>
  );
}

function prettyCode(code: string): string {
  switch (code) {
    case "missing_property": return "Missing property link";
    case "missing_unit": return "Missing unit link";
    case "missing_asset": return "Missing asset link";
    case "missing_dates": return "Missing date fields";
    case "missing_status": return "Missing status";
    case "missing_priority": return "Missing priority";
    case "low_assignment_confidence": return "Low assignment confidence";
    case "resolution_unresolved": return "Property match failed";
    case "resolution_partial": return "Unit context incomplete";
    case "raw_only_no_match": return "Raw record, no match yet";
    default: return code.replace(/_/g, " ");
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [readiness, setReadiness] = useState<ReadinessRow[] | null>(null);
  const [summary, setSummary] = useState<IngestionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillContext | null>(null);
  const [analysisDrill, setAnalysisDrill] = useState<AnalysisDrillContext | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-ingestion/summary")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { readiness: ReadinessRow[]; summary: IngestionSummary }) => {
        setReadiness(d.readiness);
        setSummary(d.summary);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const wired = useMemo(() => readiness?.filter((r) => r.isWiredToday) ?? [], [readiness]);
  const placeholders = useMemo(() => readiness?.filter((r) => !r.isWiredToday) ?? [], [readiness]);

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileBarChart className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <Badge variant="outline" className="text-xs" title="7.1 ingestion · 7.2 analysis · 7.3 narrative insights · 8.0 impact snapshot · 8.1 priority actions · 8.2 trends · 8.3 audit gate · 9.0 asset registry · 9.1 warranty · 9.2 performance · 9.3 audit gate · 10.0 upload · 10.1 demo · 10.2 trial · 10.3 customer readiness · 11.0 ops coach · 11.1 notifications · 11.2 data quality · 11.3 audit gate">Build 7.1 + 7.2 + 7.3 + 7.5 + 7.6 + 7.7 + 7.8 + 7.9 + 8.0 + 8.1 + 8.2 + 8.3 + 9.0 + 9.1 + 9.2 + 9.3 + 10.0 + 10.1 + 10.2 + 10.3 + 11.0 + 11.1 + 11.2 + 11.3</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            The reporting intake gate. Every operational record is normalised, classified,
            and gated by data confidence before it feeds reports or the Control Tower.
            <span className="block mt-1">
              <span className="font-medium text-foreground">Fully reportable</span> records feed unit-level reports and the Control Tower.
              {" "}
              <span className="font-medium text-foreground">Partially reportable</span> records still feed the Control Tower and property-level reports — the same set the 1.12.7 confidence filter accepts.
              {" "}
              <span className="font-medium text-foreground">Not reportable</span> records are preserved but kept out of every report.
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="reports-refresh">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Build 7.8 — Report Export Panel */}
      <ReportExportPanel />

      {/* Build 7.9 — Reporting Completion Audit Gate */}
      <ReportingAuditGate />

      {/* Build 8.0 — Impact Recalculation Snapshot */}
      <ImpactSnapshotPanel />

      {/* Build 8.1 — Priority Actions */}
      <PriorityActionsPanel onDrill={setAnalysisDrill} />

      {/* Build 8.2 — Trend + Pattern Intelligence */}
      <TrendPatternPanel />

      {/* Build 8.3 — Impact Recalculation Audit Gate */}
      <ImpactAuditGate />

      {/* Build 9.0 — Asset Registry */}
      <AssetRegistryPanel />

      {/* Build 9.1 — Warranty Intelligence */}
      <WarrantyIntelligencePanel />

      {/* Build 9.2 — Asset Performance */}
      <AssetPerformancePanel />

      {/* Build 9.3 — Asset/Warranty Audit Gate */}
      <AssetAuditGate />

      {/* Build 10.3 — Customer Readiness Audit Gate */}
      <CustomerReadinessAuditGate />

      {/* Build 11.2 — Data Quality Guardrails */}
      <DataQualityPanel />

      {/* Build 11.3 — Operations Coach Audit Gate */}
      <Build11AuditGate />

      {/* Headline summary */}
      {loading && !summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-status-red/40 bg-status-red/5 p-4 text-sm text-status-red" data-testid="reports-error">
          Failed to load reporting readiness: {error}
        </div>
      )}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="reports-summary">
          <SummaryTile label="Records reviewed" value={summary.totalRecordsReviewed} />
          <SummaryTile label="Fully reportable" value={summary.fullyReportableCount} accent="text-status-green" />
          <SummaryTile label="Partially reportable" value={summary.partiallyReportableCount} accent="text-amber-500" />
          <SummaryTile label="Not reportable" value={summary.notReportableCount} accent="text-status-red" />
        </div>
      )}

      {/* Build 7.2.1 — Turn / Work Order reporting mode assessment */}
      <ReportingModeAssessment />

      {/* Build 7.2 — Reporting analysis sections */}
      <ReportingAnalysisSections onDrill={setAnalysisDrill} />

      {/* Build 7.5 — PM Mapping Readiness (lightweight; precedes narrative) */}
      <PmMappingReadinessSection onDrill={setAnalysisDrill} />

      {/* Build 7.6 — Evidence + Documentation Report */}
      <section data-testid="evidence-report-wrapper">
        <div className="mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Evidence &amp; Documentation
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Coverage, missing documentation risk, and breakdown by property, unit, and record type.
          </p>
        </div>
        <EvidenceReportSection />
      </section>

      {/* Build 7.7 — Assignment + Data Quality Report */}
      <section data-testid="assignment-dq-wrapper">
        <div className="mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Assignment &amp; Data Quality
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resolution state of ingested records — fully resolved, partial, and unresolved with review queue.
          </p>
        </div>
        <AssignmentDataQualitySection />
      </section>

      {/* Build 7.3 — Narrative Insights (placed after summary + analysis blocks per spec) */}
      <NarrativeInsightsSection onDrill={setAnalysisDrill} />

      {/* Wired sources */}
      {readiness && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Wired sources
            </h2>
            <Link href="/control-tower">
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                Open Control Tower <ArrowRight className="h-3 w-3" />
              </button>
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {wired.map((row) => (
              <SourceRow
                key={row.sourceType}
                row={row}
                onDrill={(eligibility) =>
                  setDrill({ sourceType: row.sourceType, sourceLabel: row.displayName, eligibility })
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Awaiting source data */}
      {placeholders.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Awaiting source data
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {placeholders.map((row) => (
              <div
                key={row.sourceType}
                className="rounded-lg border border-dashed border-border bg-card/50 p-4 text-sm"
                data-testid={`readiness-placeholder-${row.sourceType}`}
              >
                <div className="font-medium">{row.displayName}</div>
                <p className="text-xs text-muted-foreground mt-1">{row.lowDataMessage}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer note */}
      {summary && (
        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          Last refreshed {new Date(summary.generatedAt).toLocaleString()}.
          {" "}Strict-mode wiring audits run via{" "}
          <code className="text-[11px]">POST /api/reporting-ingestion/validate?mode=strict</code>.
          {" "}For governance contracts, see{" "}
          <Link href="/governance" className="text-primary hover:underline inline-flex items-center gap-0.5">
            Governance <ExternalLink className="h-3 w-3" />
          </Link>.
        </div>
      )}

      <DrillSheet ctx={drill} onClose={() => setDrill(null)} />
      <AnalysisSupportingRecordsSheet ctx={analysisDrill} onClose={() => setAnalysisDrill(null)} />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent ?? ""}`}>{value.toLocaleString()}</div>
    </div>
  );
}
