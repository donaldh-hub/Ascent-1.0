/**
 * Phase 1 — Build 1.7: Assignment Engine — Main Upload + Processing Page
 * Route: /assignments
 */

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileText, CheckCircle2, AlertTriangle, HelpCircle,
  ChevronRight, X, Search, Layers, RefreshCw, ClipboardCheck,
  ThumbsUp, ThumbsDown, ArrowRight, Info, Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useProcessAssignments, useConfirmAssignment, useRejectAssignment,
  useAssignments, type ProcessResult, type ProcessSummary,
} from "@/hooks/use-assignments";
import { useSystemSync } from "@/hooks/use-system-sync";
import { cn } from "@/lib/utils";

// ─── Source type config ───────────────────────────────────────────────────────

const SOURCE_TYPES = [
  { value: "work_order", label: "Work Order" },
  { value: "warranty", label: "Warranty Record" },
  { value: "service_log", label: "Service Log" },
  { value: "turn_log", label: "Turn / Make-Ready" },
  { value: "csv_row", label: "Generic CSV" },
] as const;

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const config = {
    high: { label: "Auto-assigned", className: "bg-status-green/15 text-status-green border-status-green/30" },
    medium: { label: "Needs review", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    low: { label: "No match", className: "bg-destructive/15 text-destructive border-destructive/30" },
  }[level];
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold border", config.className)}>
      {config.label}
    </span>
  );
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

// ─── Result row ───────────────────────────────────────────────────────────────

function ResultRow({
  result, onConfirm, onReject, isConfirming, isRejecting,
}: {
  result: ProcessResult & { assignmentId: number };
  onConfirm: () => void;
  onReject: () => void;
  isConfirming: boolean;
  isRejecting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = result.sourceData as Record<string, string>;
  const firstFields = Object.entries(data).slice(0, 3);

  return (
    <div className={cn(
      "border-b border-border last:border-0",
      result.status === "assigned" && "bg-status-green/5",
      result.match.confidenceLevel === "medium" && result.status === "pending" && "bg-amber-500/5",
      result.match.confidenceLevel === "low" && "bg-destructive/5",
    )}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Confidence icon */}
        <div className="shrink-0">
          {result.status === "assigned" ? (
            <CheckCircle2 className="h-5 w-5 text-status-green" />
          ) : result.match.confidenceLevel === "medium" ? (
            <HelpCircle className="h-5 w-5 text-amber-400" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          )}
        </div>

        {/* Record summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {firstFields.map(([k, v]) => v ? (
              <span key={k} className="text-xs">
                <span className="text-muted-foreground">{k}:</span>{" "}
                <span className="font-medium">{v}</span>
              </span>
            ) : null)}
          </div>
          {result.match.unit && (
            <div className="text-xs text-primary/80 font-medium mt-0.5 flex items-center gap-1">
              <Hash className="h-3 w-3 shrink-0" />
              Unit {result.match.unit.unitNumber}
              {result.match.property && (
                <><span className="text-muted-foreground font-normal">—</span> {result.match.property.name}</>
              )}
            </div>
          )}
        </div>

        {/* Badge + actions */}
        <div className="flex items-center gap-2 shrink-0">
          <ConfidenceBadge level={result.match.confidenceLevel} />

          {result.match.confidenceLevel === "medium" && result.status === "pending" && (
            <>
              <Button
                size="sm" variant="outline"
                className="text-status-green border-status-green/40 hover:bg-status-green/10 h-7 px-2"
                disabled={isConfirming || isRejecting}
                onClick={onConfirm}
              >
                <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                {isConfirming ? "..." : "Confirm"}
              </Button>
              <Button
                size="sm" variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10 h-7 px-2"
                disabled={isConfirming || isRejecting}
                onClick={onReject}
              >
                <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                {isRejecting ? "..." : "Reject"}
              </Button>
            </>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
          </button>
        </div>
      </div>

      {/* Expanded explanation */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 border-t border-border bg-secondary/10">
              <div className="flex items-start gap-2 mt-3">
                <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground italic">{result.match.explanation}</p>
              </div>
              {Object.entries(data).length > 3 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(data).map(([k, v]) => v ? (
                    <span key={k} className="text-xs bg-secondary px-2 py-0.5 rounded">
                      <span className="text-muted-foreground">{k}:</span> {v}
                    </span>
                  ) : null)}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ summary }: { summary: ProcessSummary }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-status-green/10 border border-status-green/20 rounded-lg px-4 py-3 text-center">
        <div className="text-2xl font-bold text-status-green">{summary.autoAssigned}</div>
        <div className="text-xs text-muted-foreground mt-0.5">Auto-assigned</div>
      </div>
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-center">
        <div className="text-2xl font-bold text-amber-400">{summary.pendingConfirmation}</div>
        <div className="text-xs text-muted-foreground mt-0.5">Need confirmation</div>
      </div>
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 text-center">
        <div className="text-2xl font-bold text-destructive">{summary.reviewRequired}</div>
        <div className="text-xs text-muted-foreground mt-0.5">Review required</div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Assignments() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [sourceType, setSourceType] = useState<string>("work_order");
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [results, setResults] = useState<(ProcessResult & { assignmentId: number })[]>([]);
  const [summary, setSummary] = useState<ProcessSummary | null>(null);
  const [search, setSearch] = useState("");

  const processMutation = useProcessAssignments();
  const confirmMutation = useConfirmAssignment();
  const rejectMutation = useRejectAssignment();
  const { sync } = useSystemSync();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      setResults([]);
      setSummary(null);
    };
    reader.readAsText(file);
    // reset file input so the same file can be re-selected
    e.target.value = "";
  }

  async function handleProcess() {
    if (csvRows.length === 0) return;
    try {
      const response = await processMutation.mutateAsync({ sourceType, rows: csvRows });
      const enriched = response.results.map((r, i) => ({
        ...r,
        assignmentId: r.assignmentId ?? -(i + 1),
      }));
      setResults(enriched);
      setSummary(response.summary);
      sync({
        type: "assignment_processed",
        autoAssigned: response.summary.autoAssigned,
        pendingConfirmation: response.summary.pendingConfirmation,
      });
    } catch {
      toast({ title: "Processing failed", description: "Please try again.", variant: "destructive" });
    }
  }

  async function handleConfirm(id: number, idx: number) {
    try {
      await confirmMutation.mutateAsync(id);
      const result = results[idx];
      setResults((prev) => prev.map((r, i) => i === idx ? { ...r, status: "assigned" } : r));
      setSummary((prev) => prev ? {
        ...prev,
        autoAssigned: prev.autoAssigned + 1,
        pendingConfirmation: prev.pendingConfirmation - 1,
      } : prev);
      sync({
        type: "assignment_confirmed",
        unitNumber: result?.match?.unit?.unitNumber,
        sourceType: result?.sourceType,
      });
    } catch {
      toast({ title: "Failed to confirm", variant: "destructive" });
    }
  }

  async function handleReject(id: number, idx: number) {
    try {
      await rejectMutation.mutateAsync(id);
      setResults((prev) => prev.map((r, i) => i === idx ? { ...r, status: "rejected" as const } : r));
      setSummary((prev) => prev ? {
        ...prev,
        pendingConfirmation: prev.pendingConfirmation - 1,
        reviewRequired: prev.reviewRequired + 1,
      } : prev);
      sync({ type: "assignment_rejected" });
    } catch {
      toast({ title: "Failed to reject", variant: "destructive" });
    }
  }

  const filteredResults = results.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const dataStr = JSON.stringify(r.sourceData).toLowerCase();
    const matchStr = `${r.match.unit?.unitNumber ?? ""} ${r.match.property?.name ?? ""}`.toLowerCase();
    return dataStr.includes(q) || matchStr.includes(q);
  });

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assignment Engine</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Upload structured data and the engine will match records to units automatically.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/assignments/review")}>
          <ClipboardCheck className="h-4 w-4 mr-2" /> Review Queue
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Upload section */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-secondary/20 flex items-center gap-2.5">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Upload Records</span>
        </div>
        <div className="p-5 space-y-4">
          {/* Source type */}
          <div>
            <label className="text-sm font-medium mb-2 block">Record type</label>
            <div className="flex flex-wrap gap-2">
              {SOURCE_TYPES.map((st) => (
                <button
                  key={st.value}
                  onClick={() => setSourceType(st.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm border transition-colors",
                    sourceType === st.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* CSV upload */}
          {csvRows.length === 0 ? (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium">Click to upload a CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">
                Include columns like: unit, unit_number, property, address, description
              </p>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            </div>
          ) : (
            <div className="space-y-3">
              {/* File info */}
              <div className="flex items-center justify-between bg-secondary/30 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{csvFileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {csvRows.length} rows · {csvHeaders.length} columns: {csvHeaders.slice(0, 4).join(", ")}{csvHeaders.length > 4 ? "…" : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => { setCsvRows([]); setCsvHeaders([]); setCsvFileName(""); setResults([]); setSummary(null); }}
                  >
                    <X className="h-4 w-4 mr-1" /> Clear
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleProcess}
                    disabled={processMutation.isPending}
                  >
                    {processMutation.isPending ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
                    ) : (
                      <><Layers className="h-4 w-4 mr-2" /> Run Assignment</>
                    )}
                  </Button>
                </div>
              </div>

              {/* Preview */}
              {results.length === 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-secondary/20 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Preview — first 3 rows
                  </div>
                  <div className="divide-y divide-border">
                    {csvRows.slice(0, 3).map((row, i) => (
                      <div key={i} className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1">
                        {Object.entries(row).slice(0, 5).map(([k, v]) => (
                          <span key={k} className="text-xs">
                            <span className="text-muted-foreground">{k}:</span>{" "}
                            <span className="font-medium">{v || <span className="italic text-muted-foreground/50">empty</span>}</span>
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {summary && (
        <AnimatePresence mode="wait">
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Summary */}
            <SummaryBar summary={summary} />

            {/* Review queue CTA if needed */}
            {(summary.reviewRequired > 0) && (
              <div className="flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="text-muted-foreground">
                  {summary.reviewRequired} record{summary.reviewRequired !== 1 ? "s" : ""} could not be matched automatically.
                </span>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => navigate("/assignments/review")}>
                  Go to Review <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            )}

            {/* Search */}
            {results.length > 5 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search results..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}

            {/* Result rows */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="bg-secondary/20 px-4 py-2.5 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {filteredResults.length} record{filteredResults.length !== 1 ? "s" : ""}
              </div>
              <div className="divide-y divide-border">
                {filteredResults.map((result, idx) => (
                  <ResultRow
                    key={result.assignmentId}
                    result={result}
                    onConfirm={() => handleConfirm(result.assignmentId, idx)}
                    onReject={() => handleReject(result.assignmentId, idx)}
                    isConfirming={confirmMutation.isPending}
                    isRejecting={rejectMutation.isPending}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Empty state when no file and no results */}
      {csvRows.length === 0 && results.length === 0 && (
        <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center text-muted-foreground">
          <Layers className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-sm mb-1">No records uploaded yet</p>
          <p className="text-xs max-w-xs mx-auto">
            Upload a CSV file with your work orders, warranty records, service logs, or turn records to get started.
          </p>
        </div>
      )}
    </div>
  );
}
