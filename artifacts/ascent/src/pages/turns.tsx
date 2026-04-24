/**
 * Build 1.10 — Turn Matrix Engine
 * Turns page: real-time turn matrix with bottleneck intelligence, property
 * breakdown, stage congestion map, and CSV ingestion.
 */

import { useState, useRef, useMemo } from "react";
import { useSearch } from "wouter";
import { TURN_SIGNAL_LABELS } from "@/lib/operational-predicates";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  RefreshCw,
  Upload,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Repeat2,
  Home,
  Activity,
  TrendingUp,
  TrendingDown,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useTurnMatrix,
  useTurnStats,
  useTurns,
  importTurns,
  resetTurns,
  type EnrichedTurn,
  type AgingSeverity,
} from "@/hooks/use-turns";
import { cn } from "@/lib/utils";
import Papa from "papaparse";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ORDER = [
  "Trash Out",
  "Maintenance",
  "Paint Prep",
  "Paint",
  "Flooring",
  "Cleaning",
  "Inspection",
  "Rework",
  "Completed",
] as const;

const STAGE_COLORS: Record<string, string> = {
  "Trash Out":   "bg-slate-500",
  "Maintenance": "bg-blue-500",
  "Paint Prep":  "bg-indigo-500",
  "Paint":       "bg-violet-500",
  "Flooring":    "bg-orange-500",
  "Cleaning":    "bg-teal-500",
  "Inspection":  "bg-amber-500",
  "Rework":      "bg-red-500",
  "Completed":   "bg-green-500",
};

const SEVERITY_COLORS: Record<AgingSeverity, { badge: string; text: string; ring: string }> = {
  critical: { badge: "bg-red-500/15 text-red-400 border-red-500/30",     text: "text-red-400",    ring: "ring-red-500/30" },
  high:     { badge: "bg-orange-500/15 text-orange-400 border-orange-500/30", text: "text-orange-400", ring: "ring-orange-500/30" },
  medium:   { badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",  text: "text-amber-400",  ring: "ring-amber-500/30" },
  low:      { badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",    text: "text-blue-400",   ring: "ring-blue-500/20" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageProgressBar({ completionPct, stage, isBlocked }: {
  completionPct: number;
  stage: string | null;
  isBlocked: boolean;
}) {
  const pct = Math.min(100, Math.max(0, completionPct));
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct === 100 ? "bg-green-500" : isBlocked ? "bg-red-400" : "bg-primary/70"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("text-[10px] tabular-nums w-7 text-right shrink-0",
        pct === 100 ? "text-green-400" : isBlocked ? "text-red-400" : "text-muted-foreground"
      )}>
        {pct}%
      </span>
    </div>
  );
}

function TurnStatusBadge({ turn }: { turn: EnrichedTurn }) {
  if (turn.isCompleted && turn.rentReadyCalc) {
    return <Badge className="text-[10px] py-0 bg-green-500/15 text-green-400 border-green-500/30">Rent Ready</Badge>;
  }
  if (turn.isBlockedCalc) {
    return <Badge className="text-[10px] py-0 bg-red-500/15 text-red-400 border-red-500/30">Blocked</Badge>;
  }
  if (turn.isInRework) {
    return <Badge className="text-[10px] py-0 bg-orange-500/15 text-orange-400 border-orange-500/30">Rework</Badge>;
  }
  if (turn.isCompleted) {
    return <Badge className="text-[10px] py-0 bg-teal-500/15 text-teal-400 border-teal-500/30">Completed</Badge>;
  }
  const sc = SEVERITY_COLORS[turn.agingSeverity];
  return <Badge className={cn("text-[10px] py-0", sc.badge)}>{turn.agingSeverity === "low" ? "Active" : `Aging ${turn.agingSeverity}`}</Badge>;
}

// ─── CSV Upload Panel ─────────────────────────────────────────────────────────

function CsvUploadPanel({ onImportDone }: { onImportDone: () => void }) {
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const result = await importTurns(parsed.data);
      toast({
        title: `Imported ${result.imported} turns`,
        description: result.skipped > 0 ? `${result.skipped} rows skipped.` : undefined,
      });
      onImportDone();
    } catch (err: unknown) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleReset() {
    if (!confirm("Delete all turn data? This cannot be undone.")) return;
    setResetting(true);
    try {
      await resetTurns();
      toast({ title: "All turn data deleted" });
      onImportDone();
    } catch {
      toast({ title: "Reset failed", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">CSV Import</span>
          <span className="text-[10px] text-muted-foreground">turn_id · property_name · unit_id · current_stage · …</span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 flex items-center gap-3 border-t border-border/40 bg-muted/10">
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                id="turns-csv-upload"
                onChange={handleFile}
              />
              <label htmlFor="turns-csv-upload">
                <Button size="sm" variant="secondary" asChild disabled={importing}>
                  <span className="cursor-pointer flex items-center gap-2">
                    {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {importing ? "Importing…" : "Upload CSV"}
                  </span>
                </Button>
              </label>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                Reset Data
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">
                Required: turn_id, property_name, unit_id, turn_status, current_stage
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Turns() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [blockedFilter, setBlockedFilter] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Ascent 1.12.6 — operational signal from URL (?signal=…). Single source of
  // truth via /api/turns?signal=… so detail-page count == tile == drill.
  const search = useSearch();
  const signal = useMemo(() => {
    const p = new URLSearchParams(search);
    return p.get("signal");
  }, [search]);
  const signalLabel =
    signal && TURN_SIGNAL_LABELS[signal] ? TURN_SIGNAL_LABELS[signal] : null;

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useTurnStats();
  const { data: matrix, isLoading: matrixLoading, refetch: refetchMatrix } = useTurnMatrix();
  const { data: turnList, isLoading: listLoading, refetch: refetchList } = useTurns({
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(blockedFilter ? { isBlocked: true } : {}),
    ...(signal ? { signal } : {}),
    limit: 200,
  });

  function refresh() {
    refetchStats();
    refetchMatrix();
    refetchList();
    setRefreshKey(k => k + 1);
  }

  const hasData = stats?.hasData ?? false;
  const turns = turnList?.turns ?? [];

  // ── Stats Strip ──
  const statCards = [
    {
      label: "TOTAL TURNS",
      value: stats?.totalTurns ?? 0,
      sub: "portfolio",
      color: "text-foreground",
      loading: statsLoading,
    },
    {
      label: "ACTIVE",
      value: (stats?.activeTurns ?? 0) + (stats?.reworkTurns ?? 0),
      sub: "in progress",
      color: "text-blue-400",
      loading: statsLoading,
    },
    {
      label: "BLOCKED",
      value: stats?.blockedTurns ?? 0,
      sub: "past threshold",
      color: stats && stats.blockedTurns > 0 ? "text-red-400" : "text-foreground",
      loading: statsLoading,
    },
    {
      label: "NOT RENT READY",
      value: stats?.notRentReadyCount ?? 0,
      sub: "units unavailable",
      color: stats && stats.notRentReadyCount > 0 ? "text-orange-400" : "text-foreground",
      loading: statsLoading,
    },
    {
      label: "AVG COMPLETION",
      value: (stats?.avgCompletionPct ?? 0) + "%",
      sub: "active turns",
      color: "text-foreground",
      loading: statsLoading,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1280px]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Turn Matrix</h1>
            <p className="text-[11px] text-muted-foreground">
              Make-ready intelligence · stage tracking · bottleneck detection · rent-ready status
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-2 text-xs">
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {/* ── Signal banner (Ascent 1.12.6 — Control Tower drill-in) ── */}
      {signalLabel && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Filtered by Control Tower signal:</span>
            <span className="text-primary font-bold">{signalLabel}</span>
            <span className="text-muted-foreground">
              · {turns.length} turn{turns.length === 1 ? "" : "s"}
            </span>
          </div>
          <a
            href={`${import.meta.env.BASE_URL}turns`}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Clear filter
          </a>
        </div>
      )}

      {/* ── CSV Upload ── */}
      <CsvUploadPanel onImportDone={refresh} />

      {/* ── Empty State ── */}
      {!statsLoading && !hasData && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <Layers className="h-12 w-12 text-muted-foreground/30" />
          <div>
            <p className="text-base font-semibold text-foreground/70">No turn data loaded</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upload a CSV file with turn/make-ready data to activate the Turn Matrix Engine.
            </p>
          </div>
        </div>
      )}

      {/* ── Stats Strip ── */}
      {(statsLoading || hasData) && (
        <div className="grid grid-cols-5 gap-3">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
              {card.loading ? (
                <Skeleton className="h-8 w-16 mb-1" />
              ) : (
                <p className={cn("text-2xl font-black tabular-nums", card.color)}>{card.value}</p>
              )}
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{card.label}</p>
              <p className="text-[10px] text-muted-foreground/70">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Bottleneck Intelligence ── */}
      {(matrixLoading || (hasData && matrix)) && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-3">Bottleneck Intelligence</p>
          <div className="grid grid-cols-3 gap-3 mb-3">

            {/* Primary Bottleneck */}
            <div className="col-span-1 rounded-xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="h-4 w-4 text-orange-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Primary Bottleneck</span>
              </div>
              {matrixLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : matrix?.bottleneck ? (
                <>
                  <p className="text-xl font-black text-orange-400">{matrix.bottleneck.primaryStage}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{matrix.bottleneck.explanation}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 rounded-full bg-muted/30 flex-1 overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full" style={{ width: `${matrix.bottleneck.severityScore}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{matrix.bottleneck.severityScore}/100</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No bottleneck detected</p>
              )}
            </div>

            {/* Blocked Turns */}
            <div className="col-span-1 rounded-xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Blocked Turns</span>
              </div>
              {matrixLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <p className={cn("text-3xl font-black tabular-nums", matrix && matrix.blockedTurns > 0 ? "text-red-400" : "text-foreground")}>
                    {matrix?.blockedTurns ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {matrix?.blockedTurns === 0
                      ? "No turns past threshold."
                      : `${matrix?.blockedTurns} turns exceed the 7-day stage threshold.`}
                  </p>
                </>
              )}
            </div>

            {/* Rework / Inspection */}
            <div className="col-span-1 rounded-xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Repeat2 className="h-4 w-4 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rework Active</span>
              </div>
              {matrixLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <p className={cn("text-3xl font-black tabular-nums", matrix && matrix.reworkTurns > 0 ? "text-amber-400" : "text-foreground")}>
                    {matrix?.reworkTurns ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {matrix?.reworkTurns === 0
                      ? "No active rework."
                      : `${matrix?.reworkTurns} turns in rework — execution risk elevated.`}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Stage Congestion Map */}
          {(matrixLoading || (matrix?.stageCongestion && matrix.stageCongestion.length > 0)) && (
            <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/40 bg-muted/20">
                <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Stage Congestion Map</span>
              </div>
              <div className="grid grid-cols-4 gap-0 divide-x divide-border/20">
                {matrixLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="px-4 py-3"><Skeleton className="h-10 w-full" /></div>
                    ))
                  : matrix?.stageCongestion.slice(0, 4).map((row) => {
                      const dotColor = STAGE_COLORS[row.stage] ?? "bg-muted";
                      const sc = SEVERITY_COLORS[row.agingSeverity];
                      return (
                        <div key={row.stage} className="px-4 py-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
                            <span className="text-[11px] font-semibold text-foreground">{row.stage}</span>
                            {row.blockedCount > 0 && (
                              <Badge className="text-[9px] py-0 ml-auto bg-red-500/15 text-red-400 border-red-500/30">
                                {row.blockedCount} blocked
                              </Badge>
                            )}
                          </div>
                          <p className={cn("text-lg font-black tabular-nums", sc.text)}>{row.turnCount}</p>
                          <p className="text-[10px] text-muted-foreground">Avg {row.avgDaysInStage}d in stage</p>
                        </div>
                      );
                    })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Property Breakdown ── */}
      {(matrixLoading || (hasData && matrix?.propertySummaries && matrix.propertySummaries.length > 0)) && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-3">Property Breakdown</p>
          <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px_130px] px-4 py-2 border-b border-border/40 bg-muted/20">
              {["Property", "Total", "Blocked", "Rework", "Not Ready", "Avg %", "Performance"].map(h => (
                <span key={h} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{h}</span>
              ))}
            </div>
            <div className="divide-y divide-border/10">
              {matrixLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="px-4 py-3"><Skeleton className="h-6 w-full" /></div>
                  ))
                : matrix?.propertySummaries.map(prop => (
                    <div key={prop.propertyName} className="grid grid-cols-[1fr_80px_80px_80px_80px_80px_130px] items-center px-4 py-3 hover:bg-muted/10 transition-colors">
                      <div>
                        <p className="text-xs font-semibold text-foreground">{prop.propertyName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {prop.primaryBottleneckStage ? `${prop.primaryBottleneckStage} bottleneck` : prop.explanation}
                        </p>
                      </div>
                      <span className="text-xs tabular-nums text-foreground/70">{prop.totalTurns}</span>
                      <span className={cn("text-xs tabular-nums font-semibold", prop.blockedTurns > 0 ? "text-red-400" : "text-foreground/70")}>
                        {prop.blockedTurns}
                      </span>
                      <span className={cn("text-xs tabular-nums font-semibold", prop.reworkTurns > 0 ? "text-amber-400" : "text-foreground/70")}>
                        {prop.reworkTurns}
                      </span>
                      <span className={cn("text-xs tabular-nums font-semibold", prop.notRentReady > 0 ? "text-orange-400" : "text-green-400")}>
                        {prop.notRentReady}
                      </span>
                      <span className="text-xs tabular-nums text-foreground/70">{prop.avgCompletion}%</span>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-muted/30 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", prop.performanceScore >= 70 ? "bg-green-500" : prop.performanceScore >= 40 ? "bg-amber-500" : "bg-red-500")}
                            style={{ width: `${prop.performanceScore}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">{prop.performanceScore}</span>
                      </div>
                    </div>
                  ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Turn List ── */}
      {(listLoading || hasData) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Turn Records</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-border/60 overflow-hidden bg-card/60">
                {(["all", "active", "in_rework", "completed"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-medium transition-colors",
                      statusFilter === s ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s === "all" ? "All" : s === "in_rework" ? "Rework" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setBlockedFilter(v => !v)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors",
                  blockedFilter
                    ? "bg-red-500/15 text-red-400 border-red-500/30"
                    : "border-border/60 text-muted-foreground hover:text-foreground bg-card/60"
                )}
              >
                <ShieldAlert className="h-3 w-3" />
                Blocked Only
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border/60 overflow-hidden bg-card/40">
            <div className="grid grid-cols-[60px_1fr_90px_100px_90px_60px_160px_auto] px-4 py-2 border-b border-border/40 bg-muted/20">
              {["ID", "Property / Unit", "Stage", "Status", "Completion", "Days", "Stage Progress", ""].map(h => (
                <span key={h} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{h}</span>
              ))}
            </div>
            <div className="divide-y divide-border/10">
              {listLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="px-4 py-3"><Skeleton className="h-8 w-full" /></div>
                  ))
                : turns.length === 0
                ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No turns match current filters.
                    </div>
                  )
                : turns.map(turn => {
                    const stageDot = STAGE_COLORS[turn.currentStage ?? ""] ?? "bg-muted";
                    return (
                      <div
                        key={turn.id}
                        className={cn(
                          "grid grid-cols-[60px_1fr_90px_100px_90px_60px_160px_auto] items-center px-4 py-2.5 hover:bg-muted/10 transition-colors",
                          turn.isBlockedCalc && "bg-red-500/[0.03]",
                          turn.isInRework && "bg-orange-500/[0.03]",
                        )}
                      >
                        {/* ID */}
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {turn.turnId ?? `#${turn.id}`}
                        </span>

                        {/* Property / Unit */}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{turn.propertyName}</p>
                          <p className="text-[10px] text-muted-foreground">Unit {turn.unitNumber ?? turn.unitId ?? "—"}</p>
                        </div>

                        {/* Stage */}
                        <div className="flex items-center gap-1.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", stageDot)} />
                          <span className="text-[11px] text-foreground/80 truncate">{turn.currentStage ?? "—"}</span>
                        </div>

                        {/* Status badge */}
                        <TurnStatusBadge turn={turn} />

                        {/* Completion */}
                        <span className={cn(
                          "text-xs tabular-nums font-semibold",
                          turn.completionCalc === 100 ? "text-green-400" : turn.isBlockedCalc ? "text-red-400" : "text-foreground/80"
                        )}>
                          {turn.completionCalc}%
                        </span>

                        {/* Days in stage */}
                        <span className={cn(
                          "text-xs tabular-nums",
                          turn.daysInStage > 14 ? "text-red-400 font-semibold" : turn.daysInStage > 7 ? "text-orange-400" : "text-muted-foreground"
                        )}>
                          {turn.daysInStage}d
                        </span>

                        {/* Stage progress bar */}
                        <StageProgressBar
                          completionPct={turn.completionCalc}
                          stage={turn.currentStage}
                          isBlocked={turn.isBlockedCalc}
                        />

                        {/* Explanation tooltip-style */}
                        <div className="flex items-center justify-end">
                          {turn.isBlockedCalc && (
                            <span title={turn.explanation}>
                              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                            </span>
                          )}
                          {turn.inspectionPassed && (
                            <span title="Inspection passed">
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                            </span>
                          )}
                          {turn.reworkRequired && !turn.reworkCompleted && (
                            <span title="Rework required">
                              <Repeat2 className="h-3.5 w-3.5 text-amber-400" />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>

          {/* Foot: data quality notice */}
          {(stats?.dataQuality) && (
            <div className="flex items-center gap-2 mt-2 px-1">
              <Info className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              <p className="text-[10px] text-muted-foreground/60">{stats.dataQuality}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
