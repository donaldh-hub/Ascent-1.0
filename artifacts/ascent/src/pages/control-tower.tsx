import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Wrench,
  Layers,
  CalendarClock,
  Server,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  AlertTriangle,
  Loader2,
  ListChecks,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignalDrill, type SignalType, type DrillRow } from "@/hooks/use-signal-drill";
import { isAssetWarrantyExpired } from "@/lib/operational-predicates";
import { useReportingMode } from "@/components/reports/use-reporting-mode";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stoplight = "green" | "yellow" | "red";

type TileId = "ohs" | "wo" | "turn" | "pm" | "asset";

interface Tile {
  id: TileId;
  title: string;
  subtitle: string;
  score: number | null;
  scoreLabel: string;
  stoplight: Stoplight;
  metrics: { label: string; value: string | number; tone?: "default" | "warn" | "bad" }[];
  icon: React.ComponentType<{ className?: string }>;
  drillSignals: { label: string; signal: SignalType; count?: number }[];
  emptyDrill?: { title: string; body: string; cta?: { label: string; href: string } };
  recordsHref?: string;
}

interface PriorityAction {
  id: string;
  label: string;
  context: string;
  count: number;
  signal?: SignalType;
  href?: string;
  severity: "critical" | "warning" | "info";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeStoplight(score: number | null): Stoplight {
  if (score == null) return "yellow";
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stoplightStyles(s: Stoplight) {
  return s === "green"
    ? {
        ring: "ring-status-green/40",
        text: "text-status-green",
        bg: "bg-status-green/10",
        border: "border-status-green/40",
        dot: "bg-status-green",
      }
    : s === "yellow"
    ? {
        ring: "ring-status-yellow/40",
        text: "text-status-yellow",
        bg: "bg-status-yellow/10",
        border: "border-status-yellow/40",
        dot: "bg-status-yellow",
      }
    : {
        ring: "ring-status-red/40",
        text: "text-status-red",
        bg: "bg-status-red/10",
        border: "border-status-red/40",
        dot: "bg-status-red",
      };
}

function severityStyles(s: PriorityAction["severity"]) {
  return s === "critical"
    ? "border-status-red/40 bg-status-red/5"
    : s === "warning"
    ? "border-status-yellow/40 bg-status-yellow/5"
    : "border-border bg-card";
}

// ─── Data Hooks ───────────────────────────────────────────────────────────────

interface WoStats {
  total: number;
  open: number;
  completed: number;
  slaMissedCount: number;
  agingCount: number;
  blockedCount: number;
  topCategory: string;
}
interface TurnStats {
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  blockedTurns: number;
  reworkTurns: number;
  notRentReadyCount: number;
  avgCompletionPct: number;
  primaryBottleneckStage: string | null;
}
interface AssetRow {
  id: number;
  installDate: string | null;
  warrantyExpiration: string | null;
  maintenanceSchedule: string | null;
  stoplight: Stoplight;
}

function useWoStats() {
  return useQuery<WoStats>({
    queryKey: ["wo-stats"],
    queryFn: async () => {
      const res = await fetch("/api/work-orders/stats");
      if (!res.ok) throw new Error("wo-stats failed");
      return res.json();
    },
  });
}
function useTurnStats() {
  return useQuery<TurnStats>({
    queryKey: ["turn-stats"],
    queryFn: async () => {
      const res = await fetch("/api/turns/stats");
      if (!res.ok) throw new Error("turn-stats failed");
      return res.json();
    },
  });
}
function useAssets() {
  return useQuery<AssetRow[]>({
    queryKey: ["assets-all"],
    queryFn: async () => {
      const res = await fetch("/api/assets");
      if (!res.ok) throw new Error("assets failed");
      return res.json();
    },
  });
}

// ─── Score Calculations ───────────────────────────────────────────────────────

function calcWoScore(s?: WoStats): number | null {
  if (!s || s.total === 0) return null;
  // Honest blend: SLA compliance (50%) + completion rate (50%), penalised for aging and blocked.
  const slaCompliance = ((s.total - s.slaMissedCount) / s.total) * 100;
  const completionRate = (s.completed / s.total) * 100;
  const agingPenalty = (s.agingCount / s.total) * 30;
  const blockedPenalty = (s.blockedCount / s.total) * 20;
  return clamp(slaCompliance * 0.5 + completionRate * 0.5 - agingPenalty - blockedPenalty);
}

function calcTurnScore(s?: TurnStats): number | null {
  if (!s || s.totalTurns === 0) return null;
  const activeBase = Math.max(1, s.activeTurns);
  const blockedRate = s.blockedTurns / activeBase;
  const reworkRate = s.reworkTurns / activeBase;
  const flowScore = clamp(s.avgCompletionPct - blockedRate * 40 - reworkRate * 15);
  return flowScore;
}

function calcAssetScore(rows?: AssetRow[]): number | null {
  if (!rows || rows.length === 0) return null;
  const total = rows.length;
  const greens = rows.filter(a => a.stoplight === "green").length;
  const reds = rows.filter(a => a.stoplight === "red").length;
  const expired = rows.filter(isAssetWarrantyExpired).length;
  const missingDocs = rows.filter(a => !a.installDate || !a.warrantyExpiration).length;
  const greenPct = (greens / total) * 100;
  const redPenalty = (reds / total) * 30;
  const expiredPenalty = (expired / total) * 20;
  const docPenalty = (missingDocs / total) * 20;
  return clamp(greenPct - redPenalty - expiredPenalty - docPenalty + 20);
}

interface PmInfo {
  score: number | null;
  totalAssets: number;
  withSchedule: number;
  missingSchedule: number;
  coveragePct: number;
}
function calcPmInfo(rows?: AssetRow[]): PmInfo {
  if (!rows || rows.length === 0) {
    return { score: null, totalAssets: 0, withSchedule: 0, missingSchedule: 0, coveragePct: 0 };
  }
  const total = rows.length;
  const withSchedule = rows.filter(
    a => a.maintenanceSchedule && a.maintenanceSchedule.trim().length > 0,
  ).length;
  const missingSchedule = total - withSchedule;
  const coveragePct = Math.round((withSchedule / total) * 100);
  // Score = coverage %, since spec says "count missing or overdue PM entries".
  return { score: coveragePct, totalAssets: total, withSchedule, missingSchedule, coveragePct };
}

// ─── Inline Drill Panel ───────────────────────────────────────────────────────

function destinationFor(signal: SignalType, row: DrillRow): string | null {
  if (row.navigateTo) return row.navigateTo;
  // Ascent 1.12.6 — append ?signal=… so the detail page filters by the SAME
  // operational signal (single source of truth). Only signals that the shared
  // selector layer can reproduce as a list filter get the query param;
  // composite signals (category_spike, stage_congestion) navigate to the
  // unfiltered detail page so we don't show a misleading "filtered" banner.
  if (signal === "sla_violations" || signal === "aging_work_orders") {
    return `/work-orders?signal=${signal}`;
  }
  if (signal === "category_spike") {
    return "/work-orders";
  }
  if (
    signal === "blocked_turns" ||
    signal === "rework_loop" ||
    signal === "not_rent_ready"
  ) {
    return `/turns?signal=${signal}`;
  }
  if (signal === "stage_congestion") {
    return "/turns";
  }
  if (signal === "expired_warranty" || signal === "expiring_soon") {
    return `/assets?signal=${signal}`;
  }
  return null;
}

function InlineDrill({
  signal,
  onClose,
}: {
  signal: SignalType;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useSignalDrill({ signal, enabled: true });
  const [, navigate] = useLocation();

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="rounded-lg border border-border bg-card mt-3" data-testid={`drill-${signal}`}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Supporting Records
            </div>
            <div className="text-base font-semibold text-foreground">
              {data?.title ?? (isLoading ? "Loading…" : signal)}
            </div>
            {data?.triggerExplanation && (
              <div className="text-xs text-muted-foreground mt-1 max-w-3xl">
                {data.triggerExplanation}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Badge variant="outline" className="text-xs" data-testid={`drill-count-${signal}`}>
                {data.total} record{data.total === 1 ? "" : "s"}
              </Badge>
            )}
            <Button size="sm" variant="ghost" onClick={onClose} data-testid={`drill-close-${signal}`}>
              Close
            </Button>
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {isLoading && (
            <div className="p-4 space-y-2">
              {[0, 1, 2, 3].map(i => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {error && (
            <div className="p-4 text-sm text-status-red flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Failed to load: {error}
            </div>
          )}
          {data && data.rows.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No records match this signal right now.
            </div>
          )}
          {data && data.rows.length > 0 && (
            <ul className="divide-y divide-border">
              {data.rows.slice(0, 50).map((row: DrillRow) => {
                const dest = destinationFor(signal, row);
                const isClickable = !!dest;
                const Inner = (
                  <>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {row.title}
                      </div>
                      {row.subtitle && (
                        <div className="text-xs text-muted-foreground truncate">{row.subtitle}</div>
                      )}
                      {row.detail && (
                        <div className="text-xs text-muted-foreground/80 mt-0.5 truncate">
                          {row.detail}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {row.badge && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            row.badgeColor === "red" && "border-status-red/40 text-status-red",
                            row.badgeColor === "yellow" &&
                              "border-status-yellow/40 text-status-yellow",
                            row.badgeColor === "green" &&
                              "border-status-green/40 text-status-green",
                            row.badgeColor === "blue" && "border-primary/40 text-primary",
                          )}
                        >
                          {row.badge}
                        </Badge>
                      )}
                      {isClickable && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                  </>
                );
                return (
                  <li key={`${signal}-${row.id}`}>
                    {isClickable ? (
                      <button
                        type="button"
                        onClick={() => navigate(dest!)}
                        className="w-full text-left px-4 py-3 hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors flex items-start justify-between gap-3"
                        data-testid={`drill-row-${signal}-${row.id}`}
                      >
                        {Inner}
                      </button>
                    ) : (
                      <div
                        className="px-4 py-3 flex items-start justify-between gap-3"
                        data-testid={`drill-row-${signal}-${row.id}`}
                      >
                        {Inner}
                      </div>
                    )}
                  </li>
                );
              })}
              {data.rows.length > 50 && (
                <li className="px-4 py-2 text-xs text-muted-foreground text-center bg-muted/20">
                  Showing first 50 of {data.rows.length}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Tile Card ────────────────────────────────────────────────────────────────

function TileCard({
  tile,
  expanded,
  activeSignal,
  onToggle,
  onPickSignal,
  onCloseDrill,
}: {
  tile: Tile;
  expanded: boolean;
  activeSignal: SignalType | null;
  onToggle: () => void;
  onPickSignal: (s: SignalType) => void;
  onCloseDrill: () => void;
}) {
  const styles = stoplightStyles(tile.stoplight);
  const Icon = tile.icon;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-all",
        expanded ? "border-primary/40 shadow-lg" : "border-border hover:border-primary/30",
      )}
      data-testid={`tile-${tile.id}`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-5"
        data-testid={`tile-toggle-${tile.id}`}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className={cn("p-2 rounded-lg", styles.bg)}>
              <Icon className={cn("h-5 w-5", styles.text)} />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">{tile.title}</div>
              <div className="text-[11px] text-muted-foreground">{tile.subtitle}</div>
            </div>
          </div>
          <div className={cn("h-2.5 w-2.5 rounded-full", styles.dot)} />
        </div>

        <div className="flex items-baseline gap-2 mb-3">
          <div className={cn("text-3xl font-bold tabular-nums", styles.text)}>
            {tile.score != null ? tile.score : "—"}
          </div>
          <div className="text-xs text-muted-foreground">{tile.scoreLabel}</div>
        </div>

        <div className="space-y-1">
          {tile.metrics.map((m, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{m.label}</span>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  m.tone === "bad" && "text-status-red",
                  m.tone === "warn" && "text-status-yellow",
                  (!m.tone || m.tone === "default") && "text-foreground",
                )}
              >
                {m.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <span className="text-[11px] text-muted-foreground">
            {expanded ? "Hide details" : "Click for breakdown"}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-border pt-4">
              {tile.drillSignals.length > 0 ? (
                <>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    Drill into supporting records
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {tile.drillSignals.map(d => {
                      const isActive = activeSignal === d.signal;
                      return (
                        <Button
                          key={d.signal}
                          size="sm"
                          variant={isActive ? "default" : "outline"}
                          onClick={() => onPickSignal(d.signal)}
                          data-testid={`drill-pick-${tile.id}-${d.signal}`}
                          className="h-8 text-xs"
                        >
                          {d.label}
                          {typeof d.count === "number" && (
                            <Badge
                              variant="secondary"
                              className="ml-1.5 text-[10px] h-4 px-1.5"
                            >
                              {d.count}
                            </Badge>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                  {tile.recordsHref && (
                    <Link
                      href={tile.recordsHref}
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      data-testid={`tile-records-link-${tile.id}`}
                    >
                      View all records <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </>
              ) : tile.emptyDrill ? (
                <div className="rounded-md border border-dashed border-border p-4 text-sm">
                  <div className="font-medium text-foreground mb-1 flex items-center gap-2">
                    <Info className="h-4 w-4 text-status-yellow" /> {tile.emptyDrill.title}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{tile.emptyDrill.body}</p>
                  {tile.emptyDrill.cta && (
                    <Link
                      href={tile.emptyDrill.cta.href}
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {tile.emptyDrill.cta.label} <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ) : null}

              <AnimatePresence>
                {activeSignal && (
                  <InlineDrill signal={activeSignal} onClose={onCloseDrill} />
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ControlTower() {
  const wo = useWoStats();
  const turn = useTurnStats();
  const asset = useAssets();
  const reportingMode = useReportingMode();
  const [, navigate] = useLocation();

  const [openTiles, setOpenTiles] = useState<Set<TileId>>(new Set());
  const [tileSignals, setTileSignals] = useState<Record<TileId, SignalType | null>>({
    ohs: null, wo: null, turn: null, pm: null, asset: null,
  });

  const toggleTile = (id: TileId) => {
    setOpenTiles(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const pickSignal = (id: TileId, sig: SignalType) => {
    setTileSignals(prev => ({ ...prev, [id]: prev[id] === sig ? null : sig }));
  };
  const closeSignal = (id: TileId) =>
    setTileSignals(prev => ({ ...prev, [id]: null }));

  // ── Compute scores from real data ──
  const woScore = calcWoScore(wo.data);
  const turnScore = calcTurnScore(turn.data);
  const assetScore = calcAssetScore(asset.data);
  const pmInfo = calcPmInfo(asset.data);
  const pmScore = pmInfo.score;

  const ohsScore = useMemo(() => {
    const parts = [woScore, turnScore, pmScore, assetScore].filter(
      (n): n is number => n != null,
    );
    if (parts.length === 0) return null;
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }, [woScore, turnScore, pmScore, assetScore]);

  // ── Asset breakdown for tile metrics ──
  const assetBreakdown = useMemo(() => {
    const rows = asset.data ?? [];
    const total = rows.length;
    // Single source of truth: shared client predicate (mirrors server WHERE).
    const expired = rows.filter(isAssetWarrantyExpired).length;
    const missingDocs = rows.filter(a => !a.installDate || !a.warrantyExpiration).length;
    const red = rows.filter(a => a.stoplight === "red").length;
    return { total, expired, missingDocs, red };
  }, [asset.data]);

  // ── Tiles ──
  const tiles: Tile[] = [
    {
      // ─────────────────────────────────────────────────────────────────────
      // TEMPORARY COMPOSITE — Operational Health (OHS)
      //
      // Ascent 1.12.6 governance lock: this tile is a derived composite of
      // the four domain scores below (WO, Turn, PM, Asset). It does NOT have
      // its own underlying record set, which is why drillSignals is empty
      // and `emptyDrill` redirects the user to the four child tiles.
      //
      // We are intentionally keeping it as a temporary composite until the
      // OHS scoring rubric is formalized in its own service module with its
      // own drill-down records. Until then: do not add drill signals here —
      // every tile in Ascent must use the shared selectors and produce a
      // record set whose count matches the headline number.
      // ─────────────────────────────────────────────────────────────────────
      id: "ohs",
      title: "Operational Health",
      subtitle: "Master score across all domains",
      score: ohsScore,
      scoreLabel: "/100",
      stoplight: computeStoplight(ohsScore),
      icon: Activity,
      metrics: [
        { label: "Work Order score", value: woScore ?? "—", tone: woScore != null && woScore < 60 ? "bad" : woScore != null && woScore < 80 ? "warn" : "default" },
        { label: "Turn score", value: turnScore ?? "—", tone: turnScore != null && turnScore < 60 ? "bad" : turnScore != null && turnScore < 80 ? "warn" : "default" },
        { label: "PM score", value: pmScore ?? "—", tone: "warn" },
        { label: "Asset score", value: assetScore ?? "—", tone: assetScore != null && assetScore < 60 ? "bad" : assetScore != null && assetScore < 80 ? "warn" : "default" },
      ],
      drillSignals: [],
      emptyDrill: {
        title: "Master Operational Health",
        body: "This score is the average of the four domain scores below. Open any of the other tiles to investigate the records driving the number.",
      },
    },
    {
      id: "wo",
      title: "Work Order Performance",
      subtitle: "Reactive maintenance throughput",
      score: woScore,
      scoreLabel: "/100",
      stoplight: computeStoplight(woScore),
      icon: Wrench,
      metrics: [
        { label: "Open work orders", value: wo.data?.open ?? 0 },
        { label: "Past 24-hour SLA", value: wo.data?.slaMissedCount ?? 0, tone: (wo.data?.slaMissedCount ?? 0) > 0 ? "bad" : "default" },
        { label: "Aging > 7 days", value: wo.data?.agingCount ?? 0, tone: (wo.data?.agingCount ?? 0) > 0 ? "warn" : "default" },
        {
          label: "Completion rate",
          value: wo.data && wo.data.total > 0
            ? `${Math.round((wo.data.completed / wo.data.total) * 100)}%`
            : "—",
        },
      ],
      drillSignals: [
        { label: "SLA Violations", signal: "sla_violations", count: wo.data?.slaMissedCount },
        { label: "Aging Work Orders", signal: "aging_work_orders", count: wo.data?.agingCount },
        { label: "Top Category Spike", signal: "category_spike" },
      ],
      recordsHref: "/work-orders",
    },
    {
      id: "turn",
      title: "Turn Performance",
      subtitle: "Unit turnover velocity",
      score: turnScore,
      scoreLabel: "/100",
      stoplight: computeStoplight(turnScore),
      icon: Layers,
      metrics: [
        { label: "Active turns", value: turn.data?.activeTurns ?? 0 },
        { label: "Blocked turns", value: turn.data?.blockedTurns ?? 0, tone: (turn.data?.blockedTurns ?? 0) > 0 ? "bad" : "default" },
        { label: "In rework", value: turn.data?.reworkTurns ?? 0, tone: (turn.data?.reworkTurns ?? 0) > 0 ? "warn" : "default" },
        {
          label: "Avg completion",
          value: turn.data ? `${turn.data.avgCompletionPct}%` : "—",
        },
      ],
      drillSignals: [
        { label: "Blocked Turns", signal: "blocked_turns", count: turn.data?.blockedTurns },
        { label: "Stage Congestion", signal: "stage_congestion" },
        { label: "Rework Loop", signal: "rework_loop", count: turn.data?.reworkTurns },
        { label: "Not Rent Ready", signal: "not_rent_ready", count: turn.data?.notRentReadyCount },
      ],
      recordsHref: "/turns",
    },
    {
      id: "pm",
      title: "PM Performance",
      subtitle: "Preventive maintenance coverage",
      score: pmScore,
      scoreLabel: pmScore != null ? "% covered" : "—",
      stoplight: computeStoplight(pmScore),
      icon: CalendarClock,
      metrics: [
        { label: "Assets with PM schedule", value: pmInfo.withSchedule },
        {
          label: "Assets missing PM",
          value: pmInfo.missingSchedule,
          tone: pmInfo.missingSchedule > 0 ? "bad" : "default",
        },
        { label: "Total assets in scope", value: pmInfo.totalAssets },
        {
          label: "Coverage",
          value: `${pmInfo.coveragePct}%`,
          tone:
            pmInfo.coveragePct < 60 ? "bad" : pmInfo.coveragePct < 80 ? "warn" : "default",
        },
      ],
      drillSignals: [],
      emptyDrill: {
        title: `${pmInfo.missingSchedule.toLocaleString()} assets without a PM schedule`,
        body:
          pmInfo.coveragePct === 0
            ? "No asset in the portfolio has a maintenance schedule recorded yet. Until a PM source is connected, every asset is treated as missing PM. Open the asset register to start populating schedules."
            : `${pmInfo.coveragePct}% of assets have a maintenance schedule. The remaining ${pmInfo.missingSchedule.toLocaleString()} need one assigned. Open the asset register to fix.`,
        cta: { label: "Open asset register", href: "/assets" },
      },
    },
    {
      id: "asset",
      title: "Asset Performance",
      subtitle: "Equipment health & documentation",
      score: assetScore,
      scoreLabel: "/100",
      stoplight: computeStoplight(assetScore),
      icon: Server,
      metrics: [
        { label: "Total assets tracked", value: assetBreakdown.total },
        {
          label: "Missing install / warranty",
          value: assetBreakdown.missingDocs,
          tone: assetBreakdown.missingDocs > 0 ? "warn" : "default",
        },
        {
          label: "Expired warranty",
          value: assetBreakdown.expired,
          tone: assetBreakdown.expired > 0 ? "bad" : "default",
        },
        {
          label: "Red stoplight",
          value: assetBreakdown.red,
          tone: assetBreakdown.red > 0 ? "bad" : "default",
        },
      ],
      drillSignals: [
        { label: "Expired Warranty", signal: "expired_warranty", count: assetBreakdown.expired },
        { label: "Expiring Soon", signal: "expiring_soon" },
      ],
      recordsHref: "/assets",
    },
  ];

  // ── Priority Actions (real, rule-based, routed) ──
  const priorityActions: PriorityAction[] = useMemo(() => {
    const list: PriorityAction[] = [];
    if (wo.data?.slaMissedCount) {
      list.push({
        id: "pa-sla",
        label: `${wo.data.slaMissedCount} work orders past 24-hour response SLA`,
        context: "Work Orders · Reactive maintenance",
        count: wo.data.slaMissedCount,
        signal: "sla_violations",
        severity: "critical",
      });
    }
    if (turn.data?.blockedTurns) {
      // Ascent 7.2.1 — adapt copy to the active Turn/WO reporting mode
      // so the operator sees the language that matches how their org
      // tracks turn progress.
      const blockedCount = turn.data.blockedTurns;
      const stage = turn.data.primaryBottleneckStage ?? "a stage";
      const mode = reportingMode.record?.mode ?? "hybrid_or_unknown";
      // HYBRID — always use conservative copy regardless of source. The
      // mode itself signals ambiguity; whether it was explicitly chosen
      // or left at default does not change that the system is not
      // permitted to assert these are definitively turns.
      const label =
        mode === "work_orders_measure_turn_progress"
          ? `${blockedCount} turn-related work orders blocked at ${stage}`
          : mode === "hybrid_or_unknown"
          ? `${blockedCount} possible turn-related records need confirmation at ${stage}`
          : `${blockedCount} turns blocked at ${stage}`;
      const context =
        mode === "work_orders_measure_turn_progress"
          ? "Work orders measuring turn progress · Stuck more than 7 days in stage"
          : mode === "hybrid_or_unknown"
          ? "Turns / WOs · Reporting mode not yet confirmed"
          : "Turns · Stuck more than 7 days in stage";
      list.push({
        id: "pa-blocked-turns",
        label,
        context,
        count: blockedCount,
        signal: "blocked_turns",
        severity: "critical",
      });
    }
    if (wo.data?.agingCount) {
      list.push({
        id: "pa-aging",
        label: `${wo.data.agingCount} work orders aging beyond 7 days`,
        context: "Work Orders · In-progress with no movement",
        count: wo.data.agingCount,
        signal: "aging_work_orders",
        severity: "warning",
      });
    }
    if (turn.data?.reworkTurns) {
      list.push({
        id: "pa-rework",
        label: `${turn.data.reworkTurns} turns in rework after failed inspection`,
        context: "Turns · Quality / handoff failures",
        count: turn.data.reworkTurns,
        signal: "rework_loop",
        severity: "warning",
      });
    }
    if (assetBreakdown.expired > 0) {
      list.push({
        id: "pa-expired-warranty",
        label: `${assetBreakdown.expired} assets with expired warranty`,
        context: "Assets · Replacement risk exposure",
        count: assetBreakdown.expired,
        signal: "expired_warranty",
        severity: "warning",
      });
    }
    if (pmInfo.missingSchedule > 0) {
      list.push({
        id: "pa-pm-missing",
        label: `${pmInfo.missingSchedule.toLocaleString()} assets without a PM schedule`,
        context: `PM · ${pmInfo.coveragePct}% portfolio coverage`,
        count: pmInfo.missingSchedule,
        href: "/assets",
        severity: pmInfo.coveragePct === 0 ? "critical" : "warning",
      });
    }
    return list;
  }, [wo.data, turn.data, assetBreakdown.expired, pmInfo.missingSchedule, pmInfo.coveragePct, reportingMode.record]);

  const [activePriority, setActivePriority] = useState<string | null>(null);

  const isLoading = wo.isLoading || turn.isLoading || asset.isLoading;
  const hasErr = wo.isError || turn.isError || asset.isError;

  return (
    <div className="px-6 py-6 max-w-[1600px] mx-auto" data-testid="control-tower-page">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Ascent 1.12.5
          </div>
          <h1 className="text-3xl font-bold text-foreground">Control Tower</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Operational status across Work Orders, Turns, Preventive Maintenance and Assets — in five seconds.
            Click any tile to drill into the records driving the score.
          </p>
        </div>
        {isLoading && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Refreshing
          </div>
        )}
      </div>

      {hasErr && (
        <div className="mb-4 rounded-lg border border-status-red/40 bg-status-red/5 p-3 text-sm text-status-red flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Failed to load one or more data sources. Some tiles
          may be incomplete.
        </div>
      )}

      {/* Tile row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {tiles.map(t => (
          <TileCard
            key={t.id}
            tile={t}
            expanded={openTiles.has(t.id)}
            activeSignal={tileSignals[t.id]}
            onToggle={() => toggleTile(t.id)}
            onPickSignal={s => pickSignal(t.id, s)}
            onCloseDrill={() => closeSignal(t.id)}
          />
        ))}
      </div>

      {/* Priority Actions */}
      <div
        className="rounded-xl border border-border bg-card overflow-hidden"
        data-testid="priority-actions"
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Priority Actions</h2>
              <p className="text-xs text-muted-foreground">
                What to address first — sorted by severity, computed from live data.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {priorityActions.length} item{priorityActions.length === 1 ? "" : "s"}
          </Badge>
        </div>

        <ul className="divide-y divide-border">
          {priorityActions.map(p => {
            const isOpen = activePriority === p.id;
            return (
              <li key={p.id} data-testid={`priority-${p.id}`}>
                <button
                  className={cn(
                    "w-full text-left px-5 py-3 flex items-center justify-between gap-4 hover:bg-muted/30 border-l-4 transition-colors",
                    severityStyles(p.severity),
                  )}
                  onClick={() => {
                    if (p.href && !p.signal) {
                      navigate(p.href);
                      return;
                    }
                    setActivePriority(prev => (prev === p.id ? null : p.id));
                  }}
                  data-testid={`priority-toggle-${p.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{p.label}</div>
                    <div className="text-xs text-muted-foreground truncate">{p.context}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.signal ? (
                      isOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )
                    ) : (
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
                <AnimatePresence>
                  {isOpen && p.signal && (
                    <div className="px-5 pb-4">
                      <InlineDrill
                        signal={p.signal}
                        onClose={() => setActivePriority(null)}
                      />
                    </div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-6 text-[11px] text-muted-foreground text-center">
        Wired against the 1.8 Integration Layer · 7.0 Master Spine · 2.5 Work Orders · 1.10 Turns
      </div>
    </div>
  );
}
