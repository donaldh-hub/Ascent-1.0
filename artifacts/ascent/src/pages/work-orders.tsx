/**
 * Build 2.5 — Work Orders Page
 *
 * Route: /work-orders
 * Features:
 * - Stats summary header (total, SLA compliance, open, aging)
 * - Intelligence signal tiles (SLA violations, aging WOs, category spike)
 * - CSV ingestion panel (multi-step: upload → preview/map → import → results)
 * - Work orders list table with filters
 */

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wrench, Upload, FileText, CheckCircle2, AlertTriangle,
  Clock, RefreshCw, ChevronRight, X, Filter, TrendingDown,
  AlertCircle, BarChart2, ChevronDown, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DrillDownSheet, ClickableSignal } from "@/components/drill-down-sheet";
import type { SignalType } from "@/hooks/use-signal-drill";
import {
  useWorkOrders, useWorkOrderStats, importWorkOrders,
  type WorkOrder, type WorkOrderImportResult,
} from "@/hooks/use-work-orders";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type DrillState = { signal: SignalType } | null;

// ─── CSV parsing (same as assignments.tsx) ────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return { headers: [], rows: [] };
  // Handle quoted fields
  function splitLine(line: string): string[] {
    const result: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(field.trim()); field = ""; }
      else { field += ch; }
    }
    result.push(field.trim());
    return result;
  }
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

// ─── Status badge helpers ─────────────────────────────────────────────────────

function SlaStatusBadge({ status }: { status: string }) {
  if (status === "met") return <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px] py-0">SLA Met</Badge>;
  if (status === "missed") return <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px] py-0">SLA Missed</Badge>;
  return <Badge className="bg-muted/50 text-muted-foreground border-border text-[10px] py-0">Pending</Badge>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-500/15 text-red-400 border-red-500/30",
    high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    medium: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    low: "bg-muted/50 text-muted-foreground border-border",
  };
  return (
    <Badge className={cn("text-[10px] py-0", map[priority] ?? map.medium)}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-green-500/15 text-green-400 border-green-500/30",
    in_progress: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    assigned: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    submitted: "bg-muted/50 text-muted-foreground border-border",
    cancelled: "bg-muted/30 text-muted-foreground border-border",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <Badge className={cn("text-[10px] py-0", map[status] ?? "bg-muted/50 text-muted-foreground border-border")}>
      {label}
    </Badge>
  );
}

// ─── Signal tile ──────────────────────────────────────────────────────────────

function SignalTile({
  label, value, subLabel, icon: Icon, accent, onClick, disabled,
}: {
  label: string;
  value: string | number;
  subLabel: string;
  icon: React.ElementType;
  accent: "red" | "yellow" | "blue";
  onClick: () => void;
  disabled?: boolean;
}) {
  const colors = {
    red: "text-red-400",
    yellow: "text-amber-400",
    blue: "text-blue-400",
  };
  const inner = (
    <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-card/60 p-4 w-full h-full">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-4 w-4", colors[accent])} />
        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{label}</span>
        {!disabled && <span className="ml-auto text-[10px] text-primary/50">↗</span>}
      </div>
      <span className={cn("text-3xl font-black tabular-nums", disabled ? "text-muted-foreground" : colors[accent])}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{subLabel}</span>
    </div>
  );
  if (disabled) return inner;
  return (
    <ClickableSignal onClick={onClick} disabled={false} title={`View ${label}`} className="w-full">
      {inner}
    </ClickableSignal>
  );
}

// ─── CSV Upload Panel ─────────────────────────────────────────────────────────

type UploadStep = "upload" | "preview" | "importing" | "results";

function CSVUploadPanel({ onImportComplete }: { onImportComplete: () => void }) {
  const [step, setStep] = useState<UploadStep>("upload");
  const [isDragOver, setIsDragOver] = useState(false);
  const [parsedData, setParsedData] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<WorkOrderImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const REQUIRED_FIELDS = ["work_order_id", "category", "description", "created_date"];
  const OPTIONAL_FIELDS = ["priority", "status", "first_response_date", "completed_date", "property_name", "unit_number"];
  const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

  const handleFile = useCallback((file: File) => {
    if (!file.name.match(/\.(csv|txt)$/i)) {
      toast({ title: "Invalid file type", description: "Please upload a CSV file.", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.rows.length === 0) {
        toast({ title: "Empty file", description: "No data rows found.", variant: "destructive" });
        return;
      }
      setParsedData(parsed);

      // Auto-detect column mapping
      const autoMap: Record<string, string> = {};
      const fieldAliases: Record<string, string[]> = {
        work_order_id: ["work_order_id", "wo_id", "id", "order_id", "ticket_id", "wo#"],
        property_name: ["property_name", "property", "building", "site"],
        unit_number: ["unit_number", "unit", "apt", "apartment"],
        category: ["category", "type", "issue_type", "work_type"],
        description: ["description", "desc", "notes", "details", "summary"],
        priority: ["priority", "urgency", "severity"],
        created_date: ["created_date", "created_at", "date_created", "submitted_date", "date"],
        first_response_date: ["first_response_date", "response_date", "assigned_date"],
        completed_date: ["completed_date", "closed_date", "completion_date", "resolved_date"],
        status: ["status", "state", "wo_status"],
      };
      for (const [field, aliases] of Object.entries(fieldAliases)) {
        const match = parsed.headers.find(h =>
          aliases.includes(h.toLowerCase().trim().replace(/[\s-]+/g, "_"))
        );
        if (match) autoMap[field] = match;
      }
      setColumnMapping(autoMap);
      setStep("preview");
    };
    reader.readAsText(file);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleImport = async () => {
    if (!parsedData) return;

    // Re-map rows using column mapping
    const remapped = parsedData.rows.map(row => {
      const out: Record<string, string> = {};
      for (const [field, csvCol] of Object.entries(columnMapping)) {
        if (csvCol && row[csvCol] !== undefined) out[field] = row[csvCol];
      }
      // Also include unmapped columns
      for (const [k, v] of Object.entries(row)) {
        if (!Object.values(columnMapping).includes(k)) out[k] = v;
      }
      return out;
    });

    setIsImporting(true);
    setStep("importing");
    try {
      const result = await importWorkOrders(remapped, { createWorkflowItems: true });
      setImportResult(result);
      setStep("results");
      onImportComplete();
      toast({ title: "Import complete", description: `${result.imported} work orders imported.` });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" });
      setStep("preview");
    } finally {
      setIsImporting(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setParsedData(null);
    setFileName(null);
    setImportResult(null);
    setColumnMapping({});
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="px-5 py-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Import Work Orders via CSV</span>
          </div>
          <div className="flex items-center gap-2">
            {step !== "upload" && (
              <>
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold border", step === "preview" ? "bg-primary/10 text-primary border-primary/30" : "bg-muted/30 text-muted-foreground border-border")}>Preview</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold border", step === "importing" || step === "results" ? "bg-primary/10 text-primary border-primary/30" : "bg-muted/30 text-muted-foreground border-border")}>Import</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold border", step === "results" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-muted/30 text-muted-foreground border-border")}>Results</span>
              </>
            )}
            {step !== "upload" && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={reset}><X className="h-3 w-3" /></Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <AnimatePresence mode="wait">
          {/* ── Step 1: Upload ── */}
          {step === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors",
                  isDragOver ? "border-primary/50 bg-primary/5" : "border-border/50 hover:border-primary/30 hover:bg-muted/20"
                )}
              >
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">Drop your CSV file here</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse — supports work order exports from any system</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 mt-1">
                  {["work_order_id", "category", "description", "created_date"].map(f => (
                    <span key={f} className="text-[10px] bg-muted/50 text-muted-foreground px-2 py-0.5 rounded-full font-mono">{f}</span>
                  ))}
                  <span className="text-[10px] text-muted-foreground px-2 py-0.5">+ optional fields</span>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

              {/* Sample CSV template */}
              <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-border/40">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sample CSV format</p>
                <code className="text-[10px] text-muted-foreground font-mono leading-relaxed">
                  work_order_id,category,description,priority,status,created_date,first_response_date,unit_number,property_name<br />
                  WO-001,Plumbing,Leaking faucet in bathroom,medium,in_progress,2026-03-01,2026-03-01 14:30,101,Riverside Apartments<br />
                  WO-002,HVAC,AC not cooling,high,completed,2026-02-15,2026-02-15 09:00,204,Parkview Gardens
                </code>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Preview + Column Mapping ── */}
          {step === "preview" && parsedData && (
            <motion.div key="preview" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold">{fileName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {parsedData.rows.length} rows detected · {parsedData.headers.length} columns
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={reset}>Change file</Button>
                  <Button size="sm" onClick={handleImport}>
                    Import {parsedData.rows.length} rows
                    <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </div>
              </div>

              {/* Column mapping */}
              <div className="mb-4">
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">Column Mapping</p>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_FIELDS.map(field => {
                    const isRequired = REQUIRED_FIELDS.includes(field);
                    const mapped = columnMapping[field];
                    const isMapped = !!mapped;
                    return (
                      <div key={field} className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border text-xs",
                        isMapped ? "bg-card border-border/60" : isRequired ? "bg-destructive/5 border-destructive/30" : "bg-muted/20 border-border/40"
                      )}>
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-[10px] text-muted-foreground">{field}</span>
                          {isRequired && <span className="text-destructive text-[10px] ml-1">*</span>}
                        </div>
                        {isMapped ? (
                          <span className="text-primary text-[10px] font-semibold truncate max-w-[100px]">← {mapped}</span>
                        ) : (
                          <span className="text-muted-foreground/50 text-[10px]">not mapped</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      {parsedData.headers.slice(0, 6).map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                      ))}
                      {parsedData.headers.length > 6 && <th className="px-3 py-2 text-muted-foreground/50">+{parsedData.headers.length - 6} more</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-b border-border/20 hover:bg-muted/10">
                        {parsedData.headers.slice(0, 6).map(h => (
                          <td key={h} className="px-3 py-2 text-muted-foreground truncate max-w-[150px]">{row[h] || "—"}</td>
                        ))}
                        {parsedData.headers.length > 6 && <td className="px-3 py-2 text-muted-foreground/30">…</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.rows.length > 5 && (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground bg-muted/20">
                    + {parsedData.rows.length - 5} more rows
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Importing ── */}
          {step === "importing" && (
            <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-8">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <RefreshCw className="h-6 w-6 text-primary animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Processing work orders…</p>
                <p className="text-xs text-muted-foreground mt-1">Computing SLA status, matching units, creating workflow items</p>
              </div>
            </motion.div>
          )}

          {/* ── Step 4: Results ── */}
          {step === "results" && importResult && (
            <motion.div key="results" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="rounded-lg border border-border/60 bg-card p-3 text-center">
                  <div className="text-2xl font-black tabular-nums text-foreground">{importResult.imported}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Imported</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-card p-3 text-center">
                  <div className={cn("text-2xl font-black tabular-nums", importResult.slaViolations > 0 ? "text-red-400" : "text-green-400")}>
                    {importResult.slaViolations}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">SLA Violations</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-card p-3 text-center">
                  <div className="text-2xl font-black tabular-nums text-green-400">
                    {importResult.results.filter(r => r.unitMatched).length}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Units Matched</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-card p-3 text-center">
                  <div className={cn("text-2xl font-black tabular-nums", importResult.errors > 0 ? "text-amber-400" : "text-muted-foreground")}>
                    {importResult.errors}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Errors</div>
                </div>
              </div>

              {importResult.slaViolations > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/5 border border-red-500/20 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-400">
                    {importResult.slaViolations} work orders exceeded the 24h response SLA. Review the SLA Violations signal above for details.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset}>Import another file</Button>
                <Button variant="ghost" size="sm" onClick={onImportComplete}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Refresh list
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// ─── Work Order Row ───────────────────────────────────────────────────────────

function WorkOrderRow({ wo }: { wo: WorkOrder }) {
  const createdDate = wo.createdDate
    ? new Date(wo.createdDate).toLocaleDateString()
    : "—";
  const daysOpen = wo.createdDate && wo.status !== "completed" && wo.status !== "cancelled"
    ? Math.round((Date.now() - new Date(wo.createdDate).getTime()) / 86_400_000)
    : null;

  return (
    <tr className="border-b border-border/20 hover:bg-muted/10 transition-colors">
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-foreground truncate max-w-[240px]">
            {wo.description?.slice(0, 60) ?? wo.category ?? "Work Order"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {wo.externalId ? `#${wo.externalId}` : `ID ${wo.id}`}
            {wo.propertyName ? ` · ${wo.propertyName}` : ""}
            {wo.unitNumber ? ` · Unit ${wo.unitNumber}` : ""}
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span className="text-xs text-muted-foreground">{wo.category ?? "—"}</span>
      </td>
      <td className="px-4 py-2.5"><PriorityBadge priority={wo.priority} /></td>
      <td className="px-4 py-2.5"><StatusBadge status={wo.status} /></td>
      <td className="px-4 py-2.5"><SlaStatusBadge status={wo.slaStatus} /></td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{createdDate}</span>
          {daysOpen !== null && daysOpen >= 7 && (
            <span className="text-[10px] text-amber-400">{daysOpen}d open</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkOrders() {
  const [drillState, setDrillState] = useState<DrillState>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useWorkOrderStats();

  const filters = statusFilter !== "all" ? { status: statusFilter } : {};
  const { data: workOrders, isLoading: listLoading, refetch: refetchList } = useWorkOrders({ ...filters, limit: 200 });

  const refresh = () => {
    refetchStats();
    refetchList();
    setRefreshKey(k => k + 1);
  };

  function openDrill(signal: SignalType) {
    setDrillState({ signal });
  }

  function closeDrill() {
    setDrillState(null);
  }

  const slaViolations = stats?.slaMissedCount ?? 0;
  const agingCount = stats?.agingCount ?? 0;
  const topCategory = stats?.topCategory ?? null;
  const topCategoryCount = stats?.categories?.[0]?.count ?? 0;
  const slaComplianceRate = stats?.slaComplianceRate ?? 100;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6 text-primary" />
            Work Orders
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            SLA tracking · category intelligence · CSV ingestion
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* ── Stats Strip ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Work Orders", value: stats?.total ?? 0, sub: "all time", accent: "blue" as const },
          { label: "Open", value: stats?.open ?? 0, sub: "active", accent: "yellow" as const },
          { label: "SLA Compliance", value: statsLoading ? "—" : `${slaComplianceRate}%`, sub: "response rate", accent: slaComplianceRate < 75 ? "red" as const : "blue" as const },
          { label: "Completed", value: stats?.completed ?? 0, sub: "resolved", accent: "blue" as const },
        ].map(item => (
          <Card key={item.label} className="border-border/60">
            <CardContent className="p-4">
              {statsLoading ? (
                <Skeleton className="h-8 w-16 mb-1" />
              ) : (
                <div className={cn("text-2xl font-black tabular-nums", {
                  "text-red-400": item.accent === "red",
                  "text-amber-400": item.accent === "yellow",
                  "text-foreground": item.accent === "blue",
                })}>
                  {item.value}
                </div>
              )}
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-1">{item.label}</div>
              <div className="text-[10px] text-muted-foreground/60">{item.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Intelligence Signals ── */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-3">Intelligence Signals</p>
        <div className="grid grid-cols-3 gap-4">
          <SignalTile
            label="SLA Violations"
            value={statsLoading ? "—" : slaViolations}
            subLabel="work orders missed 24h SLA"
            icon={AlertCircle}
            accent="red"
            onClick={() => openDrill("sla_violations")}
            disabled={slaViolations === 0}
          />
          <SignalTile
            label="Aging Work Orders"
            value={statsLoading ? "—" : agingCount}
            subLabel="in-progress for 7+ days"
            icon={Clock}
            accent="yellow"
            onClick={() => openDrill("aging_work_orders")}
            disabled={agingCount === 0}
          />
          <SignalTile
            label="Category Spike"
            value={statsLoading ? "—" : (topCategory ? `${topCategoryCount}x ${topCategory}` : "None")}
            subLabel={topCategory ? "highest-volume open category" : "no data yet"}
            icon={BarChart2}
            accent="blue"
            onClick={() => openDrill("category_spike")}
            disabled={!topCategory || topCategoryCount === 0}
          />
        </div>
      </div>

      {/* ── CSV Upload Panel ── */}
      <CSVUploadPanel onImportComplete={refresh} />

      {/* ── Work Orders List ── */}
      <Card className="border-border/60">
        <CardHeader className="px-5 py-4 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Work Orders</span>
              {!listLoading && (
                <Badge className="bg-muted/50 text-muted-foreground border-border text-[10px]">
                  {workOrders.length}
                </Badge>
              )}
            </div>
            {/* Status filter */}
            <div className="flex gap-1.5">
              {["all", "submitted", "assigned", "in_progress", "completed"].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "text-[10px] px-2.5 py-1 rounded-full font-semibold border transition-colors",
                    statusFilter === s
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted/30 text-muted-foreground border-border hover:border-primary/20"
                  )}
                >
                  {s === "all" ? "All" : s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {listLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : workOrders.length === 0 ? (
            <div className="py-12 text-center">
              <Wrench className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No work orders found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Import a CSV file above to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Description</th>
                    <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Category</th>
                    <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Priority</th>
                    <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-muted-foreground">SLA</th>
                    <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map(wo => <WorkOrderRow key={wo.id} wo={wo} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Drill-Down Sheet ── */}
      {drillState && (
        <DrillDownSheet
          signal={drillState.signal}
          open={true}
          onClose={closeDrill}
        />
      )}
    </div>
  );
}
