/**
 * Ascent 7.8 — Report Export + Snapshot Panel
 *
 * Sits at the top of the Reports page. Allows users to:
 *   - Download a JSON snapshot of the full reporting state
 *   - Copy a plain-text summary to clipboard
 *
 * The snapshot includes all analysis outputs, confidence states, and a
 * disclaimer about partial data. It does not contain raw records — only
 * the analysis conclusions and their evidence counts.
 */

import { useState } from "react";
import { Download, Copy, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalysisSummary {
  analysisId: string;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  confidenceState: string;
  fullyReportableRecordCount: number;
  partiallyReportableRecordCount: number;
  excludedRecordCount: number;
  supportingRecordCount: number;
  recommendedReviewQuestion: string;
}

interface ReportSnapshot {
  snapshotVersion: string;
  generatedAt: string;
  reportingMode: string;
  analyses: AnalysisSummary[];
  disclaimer: string;
}

// ─── Plain text summary builder ───────────────────────────────────────────────

function buildPlainTextSummary(snapshot: ReportSnapshot): string {
  const date = new Date(snapshot.generatedAt).toLocaleString();
  const lines: string[] = [
    "ASCENT 1.0 — REPORT SNAPSHOT",
    `Generated: ${date}`,
    `Reporting mode: ${snapshot.reportingMode.replace(/_/g, " ")}`,
    "",
    "ANALYSES",
    "--------",
  ];
  for (const a of snapshot.analyses) {
    lines.push(`${a.title}`);
    lines.push(`  ${a.summary}`);
    lines.push(`  Confidence: ${a.confidenceState.replace(/_/g, " ")}`);
    lines.push(`  Fully reportable: ${a.fullyReportableRecordCount} | Partial: ${a.partiallyReportableRecordCount} | Excluded: ${a.excludedRecordCount}`);
    if (a.supportingRecordCount > 0) {
      lines.push(`  Supporting records: ${a.supportingRecordCount}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(snapshot.disclaimer);
  return lines.join("\n");
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReportExportPanel() {
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const fetchSnapshot = async (): Promise<ReportSnapshot | null> => {
    const r = await fetch("/api/reports/snapshot");
    if (!r.ok) throw new Error(`Snapshot failed: ${r.status}`);
    return r.json();
  };

  const handleDownload = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const snapshot = await fetchSnapshot();
      if (!snapshot) return;
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date(snapshot.generatedAt).toISOString().slice(0, 10);
      a.download = `ascent-report-snapshot-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Export failed. The report server may still be starting up.");
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async () => {
    setCopying(true);
    setExportError(null);
    try {
      const snapshot = await fetchSnapshot();
      if (!snapshot) return;
      await navigator.clipboard.writeText(buildPlainTextSummary(snapshot));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setExportError("Copy failed. Try the download option instead.");
    } finally {
      setCopying(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      data-testid="report-export-panel"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">Export Report Snapshot</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Download or copy the current reporting state — all analyses, confidence levels, and record counts.
          Partial data is labelled. Do not share as confirmed operational truth without reviewing confidence states.
        </p>
        {exportError && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" /> {exportError}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          disabled={copying}
          data-testid="copy-summary-btn"
        >
          {copied ? (
            <><Check className="w-3.5 h-3.5 mr-1 text-status-green" /> Copied</>
          ) : (
            <><Copy className="w-3.5 h-3.5 mr-1" /> {copying ? "Copying…" : "Copy summary"}</>
          )}
        </Button>
        <Button
          size="sm"
          onClick={handleDownload}
          disabled={exporting}
          data-testid="download-snapshot-btn"
        >
          <Download className="w-3.5 h-3.5 mr-1" />
          {exporting ? "Exporting…" : "Download"}
        </Button>
      </div>
    </div>
  );
}
