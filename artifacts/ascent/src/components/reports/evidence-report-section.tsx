/**
 * Ascent 7.6 — Evidence + Documentation Report Section
 *
 * Dedicated report section for the Reports page. Shows:
 *   - Org-level coverage summary
 *   - Missing documentation report (ranked by risk)
 *   - Coverage breakdown by property, unit, and entity type
 *   - Drill-down sheet for any context row
 *
 * Connects to:
 *   GET /api/reporting-analysis/evidence/by-context
 *   GET /api/reporting-analysis/evidence/missing-docs
 */

import { useEffect, useState } from "react";
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvidenceContextRow {
  contextKey: string;
  contextLabel: string;
  totalOperationalRecords: number;
  recordsWithEvidence: number;
  recordsWithoutEvidence: number;
  coveragePercent: number;
  missingDocRecordIds: string[];
  missingDocRecordCount: number;
}

interface MissingDocRecord {
  recordId: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyId: number | null;
  propertyName: string | null;
  unitId: number | null;
  unitNameOrNumber: string | null;
  category: string | null;
  status: string | null;
  riskScore: number;
  riskReason: string;
}

interface EvidenceContextReport {
  generatedAt: string;
  byProperty: EvidenceContextRow[];
  byUnit: EvidenceContextRow[];
  byEntityType: EvidenceContextRow[];
  missingDocs: MissingDocRecord[];
  missingDocCount: number;
  summary: {
    totalOperationalRecords: number;
    withEvidence: number;
    withoutEvidence: number;
    coveragePercent: number;
    documentTypeBreakdown: { type: string; count: number }[];
  };
}

// ─── Coverage bar ─────────────────────────────────────────────────────────────

function CoverageBar({ percent }: { percent: number }) {
  const color =
    percent >= 75
      ? "bg-status-green"
      : percent >= 40
      ? "bg-amber-500"
      : "bg-status-red";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums w-8 text-right text-muted-foreground">
        {percent}%
      </span>
    </div>
  );
}

// ─── Risk badge ───────────────────────────────────────────────────────────────

function RiskBadge({ score }: { score: number }) {
  if (score >= 70) {
    return (
      <Badge variant="outline" className="text-xs border-status-red/50 text-status-red bg-status-red/10">
        High risk
      </Badge>
    );
  }
  if (score >= 40) {
    return (
      <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600 bg-amber-500/10">
        Medium risk
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      Low risk
    </Badge>
  );
}

// ─── Context breakdown table ──────────────────────────────────────────────────

function ContextBreakdown({
  title,
  rows,
  onDrill,
}: {
  title: string;
  rows: EvidenceContextRow[];
  onDrill: (row: EvidenceContextRow) => void;
}) {
  const [open, setOpen] = useState(true);

  if (rows.length === 0) {
    return null;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-sm font-semibold text-foreground w-full text-left py-1">
          {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
          {title}
          <span className="text-xs font-normal text-muted-foreground ml-1">({rows.length})</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2">
          {rows.map((row) => (
            <div
              key={row.contextKey}
              className="rounded-md border border-border bg-card px-3 py-2.5"
              data-testid={`evidence-context-row-${row.contextKey}`}
            >
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <span className="text-sm font-medium truncate">{row.contextLabel}</span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {row.recordsWithEvidence} / {row.totalOperationalRecords} records
                </span>
              </div>
              <CoverageBar percent={row.coveragePercent} />
              {row.missingDocRecordCount > 0 && (
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    {row.missingDocRecordCount} record{row.missingDocRecordCount !== 1 ? "s" : ""} missing documentation
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => onDrill(row)}
                    data-testid={`evidence-drill-${row.contextKey}`}
                  >
                    View <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Drill sheet ──────────────────────────────────────────────────────────────

function EvidenceDrillSheet({
  ctx,
  allMissing,
  onClose,
}: {
  ctx: EvidenceContextRow | null;
  allMissing: MissingDocRecord[];
  onClose: () => void;
}) {
  if (!ctx) return null;

  const records = allMissing.filter((r) => ctx.missingDocRecordIds.includes(r.recordId));

  return (
    <Sheet open={!!ctx} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="evidence-drill-sheet">
        <SheetHeader>
          <SheetTitle>{ctx.contextLabel} — Missing Documentation</SheetTitle>
          <SheetDescription>
            {ctx.missingDocRecordCount} operational record{ctx.missingDocRecordCount !== 1 ? "s" : ""} in this context have no supporting documents.
            Records are ranked by documentation risk.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-3">
          {records.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="evidence-drill-empty">
              No records to display.
            </p>
          )}
          {records.map((r) => (
            <div
              key={r.recordId}
              className="rounded-md border border-border bg-card p-3 text-sm"
              data-testid="evidence-missing-record-row"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {r.sourceType.replace(/_/g, " ")} — #{r.sourceRecordId}
                    {r.category ? ` · ${r.category}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-x-2">
                    {r.propertyName && <span>Property: {r.propertyName}</span>}
                    {r.unitNameOrNumber && <span>Unit: {r.unitNameOrNumber}</span>}
                    {r.status && <span>Status: {r.status}</span>}
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                    {r.riskReason}
                  </p>
                </div>
                <RiskBadge score={r.riskScore} />
              </div>
            </div>
          ))}
          {ctx.missingDocRecordCount > records.length && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Showing {records.length} of {ctx.missingDocRecordCount} records. Use the missing docs report to see all.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EvidenceReportSection() {
  const [report, setReport] = useState<EvidenceContextReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillCtx, setDrillCtx] = useState<EvidenceContextRow | null>(null);
  const [showAllMissing, setShowAllMissing] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-analysis/evidence/by-context")
      .then((r) => r.json())
      .then((d: EvidenceContextReport) => setReport(d))
      .catch(() => setError("Failed to load evidence report."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-3" data-testid="evidence-report-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between" data-testid="evidence-report-error">
        <p className="text-sm text-muted-foreground">{error ?? "No data available."}</p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const { summary } = report;
  const coverageColor =
    summary.coveragePercent >= 75
      ? "text-status-green"
      : summary.coveragePercent >= 40
      ? "text-amber-500"
      : "text-status-red";

  const visibleMissing = showAllMissing ? report.missingDocs : report.missingDocs.slice(0, 5);

  return (
    <div className="space-y-5" data-testid="evidence-report-section">

      {/* ── Summary card ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-4" data-testid="evidence-coverage-summary">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <h3 className="font-semibold text-sm">Documentation Coverage</h3>
          </div>
          {summary.totalOperationalRecords > 0 ? (
            summary.coveragePercent >= 75 ? (
              <Badge variant="outline" className="text-xs border-status-green/40 text-status-green bg-status-green/10">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Good coverage
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 bg-amber-500/10">
                <AlertTriangle className="w-3 h-3 mr-1" /> Gaps present
              </Badge>
            )
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              No operational records
            </Badge>
          )}
        </div>

        {summary.totalOperationalRecords === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">
            No operational records have been ingested yet. Upload work orders, turns, assets, or PM records to see documentation coverage.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mt-2">
              <span className={`font-semibold ${coverageColor}`}>{summary.coveragePercent}%</span> of admissible operational records
              ({summary.withEvidence} of {summary.totalOperationalRecords}) have at least one supporting document.
            </p>

            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border border-border bg-secondary/30 p-2">
                <div className="text-lg font-bold text-foreground">{summary.withEvidence}</div>
                <div className="text-xs text-muted-foreground">With documents</div>
              </div>
              <div className="rounded-md border border-border bg-secondary/30 p-2">
                <div className="text-lg font-bold text-amber-500">{summary.withoutEvidence}</div>
                <div className="text-xs text-muted-foreground">Missing docs</div>
              </div>
              <div className="rounded-md border border-border bg-secondary/30 p-2">
                <div className="text-lg font-bold text-foreground">{summary.totalOperationalRecords}</div>
                <div className="text-xs text-muted-foreground">Total records</div>
              </div>
            </div>

            {summary.documentTypeBreakdown.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground font-medium mb-1.5">Document types on file</p>
                <div className="flex flex-wrap gap-1.5">
                  {summary.documentTypeBreakdown.map(({ type, count }) => (
                    <Badge key={type} variant="outline" className="text-xs">
                      {type} · {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Missing documentation report ──────────────────────────────────────── */}
      {report.missingDocCount > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4" data-testid="missing-docs-report">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <h3 className="font-semibold text-sm">Missing Documentation</h3>
              <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600">
                {report.missingDocCount} record{report.missingDocCount !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            These operational records have no supporting documents. Ranked by documentation risk — high-risk records feed into executive reporting without proof.
          </p>
          <div className="space-y-2">
            {visibleMissing.map((r) => (
              <div
                key={r.recordId}
                className="rounded-md border border-border bg-card p-3 text-sm"
                data-testid="missing-doc-row"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {r.sourceType.replace(/_/g, " ")} — #{r.sourceRecordId}
                      {r.category ? ` · ${r.category}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
                      {r.propertyName && <span>{r.propertyName}</span>}
                      {r.unitNameOrNumber && <span>Unit {r.unitNameOrNumber}</span>}
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{r.riskReason}</p>
                  </div>
                  <RiskBadge score={r.riskScore} />
                </div>
              </div>
            ))}
          </div>
          {report.missingDocCount > 5 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs"
              onClick={() => setShowAllMissing((v) => !v)}
            >
              {showAllMissing
                ? "Show fewer"
                : `Show all ${report.missingDocCount} records`}
            </Button>
          )}
        </div>
      )}

      {/* ── Context breakdowns ────────────────────────────────────────────────── */}
      {summary.totalOperationalRecords > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4" data-testid="evidence-breakdown-panels">
          <h3 className="font-semibold text-sm">Coverage Breakdown</h3>

          <ContextBreakdown
            title="By Property"
            rows={report.byProperty}
            onDrill={setDrillCtx}
          />

          <ContextBreakdown
            title="By Unit"
            rows={report.byUnit}
            onDrill={setDrillCtx}
          />

          <ContextBreakdown
            title="By Record Type"
            rows={report.byEntityType}
            onDrill={setDrillCtx}
          />
        </div>
      )}

      {/* ── Drill sheet ───────────────────────────────────────────────────────── */}
      <EvidenceDrillSheet
        ctx={drillCtx}
        allMissing={report.missingDocs}
        onClose={() => setDrillCtx(null)}
      />
    </div>
  );
}
