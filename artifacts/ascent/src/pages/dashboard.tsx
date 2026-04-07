import { useState } from "react";
import type React from "react";
import {
  useGetDashboardIntelligence,
  useGetDashboardSummary,
  useListDocuments,
  type DashboardIntelligence,
  type IntelligenceAction,
  type WorkflowSpotlightEntry,
  type TrendSignal,
  type TurnStats,
} from "@workspace/api-client-react";
import { DrillDownSheet, ClickableSignal } from "@/components/drill-down-sheet";
import type { SignalType } from "@/hooks/use-signal-drill";
import { useDocCounts } from "@/hooks/use-doc-counts";
import { PortfolioControlTowerSection } from "@/components/portfolio-control-tower";
import { AttachmentBadge } from "@/components/attachment-badge";
import { EVIDENCE } from "@/lib/evidence-language";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StoplightIndicator, StoplightBadge } from "@/components/stoplight";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Clock,
  Target,
  Workflow,
  Activity,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
  TrendingUp,
  TrendingDown,
  Zap,
  ShieldAlert,
  Package,
  Users,
  ChevronDown,
  X,
  BarChart2,
  Wrench,
  AlertCircle,
  RefreshCw,
  Home,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

function getStoplightColor(sl: string | undefined) {
  if (sl === "red") return "#ef4444";
  if (sl === "yellow") return "#eab308";
  return "#22c55e";
}

function severityLabel(value: number, type: "critical" | "overdue" | "throughput" | "age"): string {
  if (type === "throughput") {
    if (value === 0) return "CRITICAL — no progress";
    if (value < 25) return "SEVERE";
    if (value < 50) return "HIGH";
    if (value < 75) return "MODERATE";
    return "LOW";
  }
  if (type === "age") {
    if (value > 200) return "SEVERE — systemic slowdown";
    if (value > 90)  return "HIGH — escalation required";
    if (value > 30)  return "MODERATE — review needed";
    return "LOW";
  }
  // critical / overdue counts
  if (value > 200) return "SEVERE — immediate action required";
  if (value > 100) return "HIGH — escalation required";
  if (value > 50)  return "HIGH — requires immediate attention";
  if (value > 20)  return "MODERATE — review needed";
  return "LOW";
}

function urgencyBg(urgency: string) {
  if (urgency === "critical") return "border-red-500/40 bg-red-500/5";
  if (urgency === "high") return "border-amber-500/40 bg-amber-500/5";
  return "border-border/50 bg-transparent";
}

function urgencyLabel(urgency: string) {
  if (urgency === "critical") return "text-red-400";
  if (urgency === "high") return "text-amber-400";
  return "text-muted-foreground";
}

function categoryIcon(category: string) {
  switch (category) {
    case "critical_item": return <ShieldAlert className="h-3.5 w-3.5" />;
    case "bottleneck": return <Activity className="h-3.5 w-3.5" />;
    case "overdue": return <Clock className="h-3.5 w-3.5" />;
    case "unassigned": return <Users className="h-3.5 w-3.5" />;
    case "aging": return <Package className="h-3.5 w-3.5" />;
    default: return <AlertTriangle className="h-3.5 w-3.5" />;
  }
}

// ─────────────────────────────────────────────
// Skeleton components
// ─────────────────────────────────────────────

function HealthGaugeSkeleton() {
  return <Skeleton className="h-48 w-48 rounded-full" />;
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

type DrillState = { signal: SignalType; workflowId?: number; stageId?: number } | null;

function computeOrgTurnScores(ts: NonNullable<ReturnType<typeof useGetDashboardIntelligence>["data"]>["turnStats"]) {
  if (!ts || !ts.hasData || ts.totalTurns === 0) return null;
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const blockedRate = ts.blockedTurns / ts.totalTurns;
  const reworkRate = ts.reworkTurns / ts.totalTurns;
  const notRentReadyRate = ts.notRentReadyCount / ts.totalTurns;
  const completedRate = ts.completedTurns / ts.totalTurns;
  const rentReadyRate = 1 - notRentReadyRate;
  const flowScore = clamp(ts.avgCompletionPct - blockedRate * 40 - reworkRate * 15);
  const riskScore = clamp(100 - (blockedRate * 50 + notRentReadyRate * 30 + reworkRate * 20));
  const executionScore = clamp(ts.avgCompletionPct * 0.5 + completedRate * 100 * 0.5);
  const improvementScore = clamp(completedRate * 60 + rentReadyRate * 40);
  const ohsScore = Math.round(flowScore * 0.30 + riskScore * 0.30 + executionScore * 0.25 + improvementScore * 0.15);
  const stoplight = ohsScore >= 75 ? "green" : ohsScore >= 50 ? "yellow" : "red";
  return { flowScore, riskScore, executionScore, improvementScore, ohsScore, stoplight };
}

function dimStoplight(score: number): string {
  return score >= 75 ? "green" : score >= 50 ? "yellow" : "red";
}

export default function Dashboard() {
  const { data: intel, isLoading } = useGetDashboardIntelligence();
  const { data: summary } = useGetDashboardSummary();
  const [activeMetric, setActiveMetric] = useState<"flow" | "risk" | "execution" | "improvement" | null>(null);
  const [drillState, setDrillState] = useState<DrillState>(null);

  const snap = intel?.executiveSnapshot;

  const ts = intel?.turnStats ?? null;
  const turnScores = ts?.hasData ? computeOrgTurnScores(ts) : null;
  const displayOHS = turnScores?.ohsScore ?? snap?.operationalHealthScore ?? 0;
  const displayStoplight = turnScores?.stoplight ?? snap?.stoplight;

  const turnFlowInsight = ts?.hasData
    ? `${ts.avgCompletionPct}% avg completion · ${ts.blockedTurns} turns blocked at "${ts.primaryBottleneckStage ?? "primary stage"}" · ${ts.reworkTurns} in rework`
    : undefined;
  const turnRiskInsight = ts?.hasData
    ? `${ts.blockedTurns} blocked turns · ${ts.notRentReadyCount} units not rent-ready · ${ts.reworkTurns} in rework loop`
    : undefined;
  const turnExecInsight = ts?.hasData
    ? `${ts.completedTurns} of ${ts.totalTurns} turns completed · ${ts.avgCompletionPct}% avg stage completion across ${ts.propertyCount} properties`
    : undefined;
  const turnImprovInsight = ts?.hasData
    ? `${ts.completedTurns} turns completed · ${Math.round(((ts.totalTurns - ts.notRentReadyCount) / ts.totalTurns) * 100)}% rent-ready rate`
    : undefined;

  function toggleMetric(key: "flow" | "risk" | "execution" | "improvement") {
    setActiveMetric((prev) => (prev === key ? null : key));
  }

  function openDrill(signal: SignalType, opts?: { workflowId?: number; stageId?: number }) {
    setDrillState({ signal, ...opts });
  }

  function closeDrill() {
    setDrillState(null);
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full pb-8">
      {/* ─── Page Header ─── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Control Tower</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Operational intelligence · real-time
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          LIVE
          {intel?.generatedAt && (
            <span className="ml-2 opacity-50">
              {new Date(intel.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ─── Row 1: Health Gauge + 4 Score Cards ─── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Health Gauge */}
        <Card className="col-span-1 md:col-span-4 bg-card border-border/50 shadow-lg relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardContent className="p-8 flex flex-col items-center justify-center h-full min-h-[280px]">
            {isLoading ? (
              <HealthGaugeSkeleton />
            ) : (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative flex items-center justify-center"
              >
                <svg className="w-48 h-48 transform -rotate-90">
                  <circle
                    cx="96" cy="96" r="88"
                    stroke="currentColor" strokeWidth="8" fill="transparent"
                    className="text-secondary"
                  />
                  <circle
                    cx="96" cy="96" r="88"
                    stroke={getStoplightColor(displayStoplight)}
                    strokeWidth="8" fill="transparent"
                    strokeDasharray={2 * Math.PI * 88}
                    strokeDashoffset={
                      2 * Math.PI * 88 * (1 - displayOHS / 100)
                    }
                    className="transition-all duration-1000 ease-out drop-shadow-md"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-5xl font-black tracking-tighter">
                    {displayOHS || "—"}
                  </span>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mt-1">
                    OHS
                  </span>
                </div>
              </motion.div>
            )}

            <div className="mt-6 grid grid-cols-3 gap-3 w-full text-center">
              {ts?.hasData ? (
                <>
                  <StatPill
                    value={ts.blockedTurns}
                    label="Blocked"
                    color="text-red-400"
                    isLoading={isLoading}
                    onClick={!isLoading && ts.blockedTurns > 0 ? () => openDrill("blocked_turns") : undefined}
                  />
                  <StatPill
                    value={ts.activeTurns}
                    label="Active"
                    color="text-blue-400"
                    isLoading={isLoading}
                  />
                  <StatPill
                    value={ts.notRentReadyCount}
                    label="Not Ready"
                    color="text-amber-400"
                    isLoading={isLoading}
                    onClick={!isLoading && ts.notRentReadyCount > 0 ? () => openDrill("not_rent_ready") : undefined}
                  />
                </>
              ) : (
                <>
                  <StatPill
                    value={snap?.criticalItemsCount ?? 0}
                    label="Critical"
                    color="text-red-400"
                    isLoading={isLoading}
                    onClick={!isLoading && (snap?.criticalItemsCount ?? 0) > 0 ? () => openDrill("critical_items") : undefined}
                  />
                  <StatPill
                    value={snap?.activeWorkflowsCount ?? 0}
                    label="Active"
                    color="text-blue-400"
                    isLoading={isLoading}
                    onClick={!isLoading && (snap?.activeWorkflowsCount ?? 0) > 0 ? () => openDrill("at_risk_workflows") : undefined}
                  />
                  <StatPill
                    value={snap?.overdueItemsCount ?? 0}
                    label="Overdue"
                    color="text-amber-400"
                    isLoading={isLoading}
                    onClick={!isLoading && (snap?.overdueItemsCount ?? 0) > 0 ? () => openDrill("overdue_items") : undefined}
                  />
                </>
              )}
            </div>

            {(ts?.hasData || snap?.insight) && (
              <p className="text-[11px] text-muted-foreground mt-4 text-center leading-relaxed line-clamp-3">
                {ts?.hasData
                  ? `${ts.totalTurns} turns across ${ts.propertyCount} properties — ${ts.blockedTurns} blocked, ${ts.notRentReadyCount} units not rent-ready, ${ts.avgCompletionPct}% avg completion`
                  : snap!.insight}
              </p>
            )}

            {/* DRIVEN BY block */}
            {(ts?.hasData || snap) && (
              <div className="mt-4 w-full rounded-lg bg-secondary/50 border border-border/40 px-3 py-3 text-left">
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
                  Driven By
                </p>
                <ul className="space-y-1.5">
                  {ts?.hasData ? (
                    <>
                      {ts.blockedTurns > 0 && (
                        <li className="flex items-start gap-2 text-xs">
                          <span className="text-status-red font-bold mt-0.5">•</span>
                          <span className="text-foreground/80">
                            <ClickableSignal
                              onClick={() => openDrill("blocked_turns")}
                              className="px-1 py-0.5 rounded"
                              title="View blocked turns"
                            >
                              <span className="font-semibold text-status-red">{ts.blockedTurns} turns blocked</span>
                            </ClickableSignal>
                          </span>
                        </li>
                      )}
                      {ts.notRentReadyCount > 0 && (
                        <li className="flex items-start gap-2 text-xs">
                          <span className="text-status-yellow font-bold mt-0.5">•</span>
                          <span className="text-foreground/80">
                            <ClickableSignal
                              onClick={() => openDrill("not_rent_ready")}
                              className="px-1 py-0.5 rounded"
                              title="View not-rent-ready units"
                            >
                              <span className="font-semibold text-status-yellow">{ts.notRentReadyCount} units not rent-ready</span>
                            </ClickableSignal>
                          </span>
                        </li>
                      )}
                      {ts.primaryBottleneckStage && (
                        <li className="flex items-start gap-2 text-xs">
                          <span className="text-status-red font-bold mt-0.5">•</span>
                          <span className="text-foreground/75 leading-snug">
                            <span className="font-semibold text-foreground/90">{ts.primaryBottleneckStage}</span>
                            {" "}stage bottleneck — highest turn congestion
                          </span>
                        </li>
                      )}
                      {ts.reworkTurns > 0 && (
                        <li className="flex items-start gap-2 text-xs">
                          <span className="text-amber-400 font-bold mt-0.5">•</span>
                          <span className="text-foreground/80">
                            <ClickableSignal
                              onClick={() => openDrill("rework_loop")}
                              className="px-1 py-0.5 rounded"
                              title="View rework turns"
                            >
                              <span className="font-semibold text-amber-400">{ts.reworkTurns} turns in rework</span>
                            </ClickableSignal>
                          </span>
                        </li>
                      )}
                    </>
                  ) : (
                    <>
                      <li className="flex items-start gap-2 text-xs">
                        <span className="text-status-red font-bold mt-0.5">•</span>
                        <span className="text-foreground/80">
                          <ClickableSignal
                            onClick={() => openDrill("critical_items")}
                            className="px-1 py-0.5 rounded"
                            title="View critical turns"
                            disabled={snap?.criticalItemsCount === 0}
                          >
                            <span className="font-semibold text-status-red">{snap?.criticalItemsCount} critical turns</span>
                          </ClickableSignal>
                        </span>
                      </li>
                      <li className="flex items-start gap-2 text-xs">
                        <span className="text-status-yellow font-bold mt-0.5">•</span>
                        <span className="text-foreground/80">
                          <ClickableSignal
                            onClick={() => openDrill("overdue_items")}
                            className="px-1 py-0.5 rounded"
                            title="View overdue turns"
                            disabled={snap?.overdueItemsCount === 0}
                          >
                            <span className="font-semibold text-status-yellow">{snap?.overdueItemsCount} overdue turns</span>
                          </ClickableSignal>
                        </span>
                      </li>
                      {intel?.primaryBottleneck && (
                        <li className="flex items-start gap-2 text-xs">
                          <span className="text-status-red font-bold mt-0.5">•</span>
                          <span className="text-foreground/75 leading-snug">
                            <span className="font-semibold text-foreground/90">{intel.primaryBottleneck.workflowTitle}</span> bottleneck
                            <span className="text-muted-foreground"> ({intel.primaryBottleneck.maxAgeDays}d max age)</span>
                          </span>
                        </li>
                      )}
                    </>
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4 Dimension Score Cards — clickable */}
        <div className="col-span-1 md:col-span-8 grid grid-cols-2 gap-4">
          <ScoreCard
            title="Flow"
            metricKey="flow"
            score={turnScores?.flowScore ?? summary?.flowScore}
            stoplight={turnScores ? dimStoplight(turnScores.flowScore) : summary?.flowStoplight}
            insight={turnFlowInsight ?? summary?.flowInsight}
            icon={Workflow}
            isLoading={isLoading}
            colorClass="text-blue-400"
            isActive={activeMetric === "flow"}
            onClick={() => toggleMetric("flow")}
          />
          <ScoreCard
            title="Risk"
            metricKey="risk"
            score={turnScores?.riskScore ?? summary?.riskScore}
            stoplight={turnScores ? dimStoplight(turnScores.riskScore) : summary?.riskStoplight}
            insight={turnRiskInsight ?? summary?.riskInsight}
            icon={AlertTriangle}
            isLoading={isLoading}
            colorClass="text-red-400"
            isActive={activeMetric === "risk"}
            onClick={() => toggleMetric("risk")}
          />
          <ScoreCard
            title="Execution"
            metricKey="execution"
            score={turnScores?.executionScore ?? summary?.executionScore}
            stoplight={turnScores ? dimStoplight(turnScores.executionScore) : summary?.executionStoplight}
            insight={turnExecInsight ?? summary?.executionInsight}
            icon={Target}
            isLoading={isLoading}
            colorClass="text-green-400"
            isActive={activeMetric === "execution"}
            onClick={() => toggleMetric("execution")}
          />
          <ScoreCard
            title="Improvement"
            metricKey="improvement"
            score={turnScores?.improvementScore ?? summary?.improvementScore}
            stoplight={turnScores ? dimStoplight(turnScores.improvementScore) : summary?.improvementStoplight}
            insight={turnImprovInsight ?? summary?.improvementInsight}
            icon={Activity}
            isLoading={isLoading}
            colorClass="text-purple-400"
            isActive={activeMetric === "improvement"}
            onClick={() => toggleMetric("improvement")}
          />
        </div>
      </div>

      {/* ─── Metric Reveal Section (inline, below score cards) ─── */}
      <AnimatePresence initial={false}>
        {activeMetric && (
          <MetricRevealSection
            key={activeMetric}
            metric={activeMetric}
            intel={intel ?? null}
            summary={summary ?? null}
            onClose={() => setActiveMetric(null)}
            onDrill={openDrill}
          />
        )}
      </AnimatePresence>

      {/* ─── Row 2: Turn Signal Strip ─── */}
      <TurnInsightStrip turnStats={intel?.turnStats} isLoading={isLoading} />

      {/* ─── Row 3: Actions + Turn Bottleneck ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionPanel actions={intel?.actions ?? []} isLoading={isLoading} />
        <TurnBottleneckPanel turnStats={intel?.turnStats} isLoading={isLoading} />
      </div>

      {/* ─── Row 4: Stage Distribution + Turn Aging ─── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="col-span-1 md:col-span-5">
          <StageDistributionChart
            rows={intel?.stageDistribution ?? []}
            isLoading={isLoading}
          />
        </div>
        <div className="col-span-1 md:col-span-7">
          <TurnAgingPanel
            turnStats={intel?.turnStats}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ─── Row 5a: Priority Panel ─── */}
      {(intel?.woTopPriorities?.length ?? 0) > 0 && (
        <Card className="border-border/60">
          <CardHeader className="px-5 py-4 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Operational Priorities</span>
                <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px]">
                  Top {intel?.woTopPriorities?.length}
                </Badge>
              </div>
              <Link href="/work-orders">
                <span className="text-[10px] text-primary/60 hover:text-primary flex items-center gap-1 cursor-pointer">
                  All work orders <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {intel?.woTopPriorities?.map((p, idx) => {
              const tierColors: Record<string, { border: string; badge: string; rank: string; scoreText: string }> = {
                critical: { border: "border-l-red-500", badge: "bg-red-500/15 text-red-400 border-red-500/30", rank: "bg-red-500/15 text-red-400", scoreText: "text-red-400" },
                high:     { border: "border-l-orange-500", badge: "bg-orange-500/15 text-orange-400 border-orange-500/30", rank: "bg-orange-500/15 text-orange-400", scoreText: "text-orange-400" },
                medium:   { border: "border-l-amber-500", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", rank: "bg-amber-500/15 text-amber-400", scoreText: "text-amber-400" },
                low:      { border: "border-l-blue-500", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20", rank: "bg-blue-500/10 text-blue-400", scoreText: "text-blue-400" },
              };
              const tc = tierColors[p.tier] ?? tierColors.medium;
              return (
                <div key={p.rank} className={cn(
                  "flex items-start gap-4 px-5 py-4 border-l-4",
                  tc.border,
                  idx < (intel?.woTopPriorities?.length ?? 0) - 1 && "border-b border-border/30"
                )}>
                  <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 mt-0.5", tc.rank)}>
                    #{p.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{p.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.reason}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className={cn("text-2xl font-black tabular-nums", tc.scoreText)}>
                          {Math.round(p.impactScore)}
                        </div>
                        <span className="text-[9px] text-muted-foreground uppercase tracking-wider">impact</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={cn("text-[10px] py-0", tc.badge)}>
                        {p.tier}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{p.count} open · {p.blockedCount} blocked</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ─── Row 5: Work Order Intelligence ─── */}
      {(intel?.workOrderStats?.total ?? 0) > 0 && (
        <Card className="border-border/60">
          <CardHeader className="px-5 py-4 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Work Order Intelligence</span>
                <Badge className="bg-muted/50 text-muted-foreground border-border text-[10px]">
                  {intel?.workOrderStats?.total} total
                </Badge>
              </div>
              <Link href="/work-orders">
                <span className="text-[10px] text-primary/60 hover:text-primary flex items-center gap-1 cursor-pointer">
                  Manage work orders <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="grid grid-cols-4 gap-4">
              {/* Blocked Turns */}
              <ClickableSignal
                onClick={() => openDrill("blocked_turns")}
                className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/60 p-4"
                disabled={(intel?.workOrderStats?.blockedTurnCount ?? 0) === 0}
                title="View blocked turns"
              >
                <div className="flex items-center gap-2 mb-1">
                  <ShieldAlert className="h-4 w-4 text-red-400" />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Blocked Turns</span>
                  {(intel?.workOrderStats?.blockedTurnCount ?? 0) > 0 && <span className="ml-auto text-[10px] text-primary/50">↗</span>}
                </div>
                <span className={cn("text-3xl font-black tabular-nums", (intel?.workOrderStats?.blockedTurnCount ?? 0) > 0 ? "text-red-400" : "text-muted-foreground")}>
                  {intel?.workOrderStats?.blockedTurnCount ?? 0}
                </span>
                <span className="text-xs text-muted-foreground">
                  {intel?.workOrderStats?.topBottleneckStage ? `Top: ${intel.workOrderStats.topBottleneckStage}` : "no blocked turns"}
                </span>
              </ClickableSignal>

              {/* SLA Violations */}
              <ClickableSignal
                onClick={() => openDrill("sla_violations")}
                className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/60 p-4"
                disabled={(intel?.workOrderStats?.slaMissedCount ?? 0) === 0}
                title="View SLA violations"
              >
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">SLA Violations</span>
                  {(intel?.workOrderStats?.slaMissedCount ?? 0) > 0 && <span className="ml-auto text-[10px] text-primary/50">↗</span>}
                </div>
                <span className={cn("text-3xl font-black tabular-nums", (intel?.workOrderStats?.slaMissedCount ?? 0) > 0 ? "text-red-400" : "text-muted-foreground")}>
                  {intel?.workOrderStats?.slaMissedCount ?? 0}
                </span>
                <span className="text-xs text-muted-foreground">missed 24h response SLA</span>
              </ClickableSignal>

              {/* Aging Work Orders */}
              <ClickableSignal
                onClick={() => openDrill("aging_work_orders")}
                className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/60 p-4"
                disabled={(intel?.workOrderStats?.agingCount ?? 0) === 0}
                title="View aging work orders"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Aging WOs</span>
                  {(intel?.workOrderStats?.agingCount ?? 0) > 0 && <span className="ml-auto text-[10px] text-primary/50">↗</span>}
                </div>
                <span className={cn("text-3xl font-black tabular-nums", (intel?.workOrderStats?.agingCount ?? 0) > 0 ? "text-amber-400" : "text-muted-foreground")}>
                  {intel?.workOrderStats?.agingCount ?? 0}
                </span>
                <span className="text-xs text-muted-foreground">in-progress 7+ days</span>
              </ClickableSignal>

              {/* SLA Compliance Rate */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart2 className="h-4 w-4 text-blue-400" />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">SLA Compliance</span>
                </div>
                <span className={cn("text-3xl font-black tabular-nums", (intel?.workOrderStats?.slaComplianceRate ?? 100) < 75 ? "text-red-400" : "text-green-400")}>
                  {intel?.workOrderStats?.slaComplianceRate ?? 100}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {intel?.workOrderStats?.topCategory ? `Top: ${intel.workOrderStats.topCategory}` : "of work orders met SLA"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Row 6: Portfolio Control Tower ─── */}
      <PortfolioControlTowerSection />

      {/* ─── Drill-Down Sheet ─── */}
      {drillState && (
        <DrillDownSheet
          signal={drillState.signal}
          workflowId={drillState.workflowId}
          stageId={drillState.stageId}
          open={true}
          onClose={closeDrill}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StatPill({
  value,
  label,
  color,
  isLoading,
  onClick,
}: {
  value: number;
  label: string;
  color: string;
  isLoading: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <div className="flex flex-col items-center gap-0.5">
      {isLoading ? (
        <Skeleton className="h-6 w-8" />
      ) : (
        <span className={`text-xl font-bold ${color}`}>{value}</span>
      )}
      <span className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">
        {label}
      </span>
    </div>
  );

  if (!onClick) return inner;

  return (
    <button
      onClick={onClick}
      title={`View ${label.toLowerCase()} records`}
      className="flex flex-col items-center gap-0.5 cursor-pointer rounded-lg px-2 py-1 hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {isLoading ? (
        <Skeleton className="h-6 w-8" />
      ) : (
        <span className={`text-xl font-bold ${color}`}>{value}</span>
      )}
      <span className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider flex items-center gap-0.5">
        {label}
        <span className="text-[9px] text-primary/40">↗</span>
      </span>
    </button>
  );
}

function ScoreCard({
  title,
  metricKey,
  score,
  stoplight,
  insight,
  icon: Icon,
  isLoading,
  colorClass,
  isActive,
  onClick,
}: {
  title: string;
  metricKey: string;
  score?: number;
  stoplight?: string;
  insight?: string;
  icon: React.ElementType;
  isLoading: boolean;
  colorClass: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={!isLoading ? onClick : undefined}
      className={cn(
        "bg-card shadow-sm relative overflow-hidden transition-all duration-200 cursor-pointer select-none",
        isActive
          ? "border-primary/60 ring-1 ring-primary/20 shadow-md"
          : "border-border/50 hover:border-primary/40 hover:shadow-md",
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-md bg-muted/50 ${colorClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="font-semibold text-sm tracking-wide text-muted-foreground uppercase">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <StoplightIndicator status={stoplight} size="sm" />
            <span className={cn(
              "transition-transform duration-200",
              isActive ? "rotate-180" : "rotate-0",
            )}>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-10 w-24" />
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-4xl font-bold tracking-tight">{score}</span>
              <span className="text-sm font-medium text-muted-foreground">/100</span>
            </div>
            {insight && (
              <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                {insight}
              </p>
            )}
            {!isActive && (
              <p className="text-[10px] text-primary/50 mt-2 font-medium">Click to reveal drivers →</p>
            )}
          </>
        )}
      </CardContent>
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 rounded-b" />
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────
// MetricRevealSection
// Inline diagnostic panel — appears below score cards on click
// ─────────────────────────────────────────────

type MetricKey = "flow" | "risk" | "execution" | "improvement";

function MetricRevealSection({
  metric,
  intel,
  summary,
  onClose,
  onDrill,
}: {
  metric: MetricKey;
  intel: DashboardIntelligence | null;
  summary: any;
  onClose: () => void;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const bottleneck = intel?.primaryBottleneck;
  const spotlight = intel?.workflowSpotlight ?? [];
  const actions = intel?.actions ?? [];
  const snap = intel?.executiveSnapshot;
  const trends = intel?.trends ?? [];
  const turnStats = intel?.turnStats ?? null;

  // ── Per-metric config ──
  const revealFlowWhy = turnStats?.hasData
    ? `${turnStats.avgCompletionPct}% avg turn completion · ${turnStats.blockedTurns} turns blocked at "${turnStats.primaryBottleneckStage ?? "primary stage"}" · ${turnStats.reworkTurns} turns in rework`
    : (summary?.flowInsight ?? "Flow analysis unavailable.");
  const revealRiskWhy = turnStats?.hasData
    ? `${turnStats.blockedTurns} blocked turns · ${turnStats.notRentReadyCount} units not rent-ready · ${turnStats.reworkTurns} in rework loop`
    : (summary?.riskInsight ?? "Risk analysis unavailable.");
  const revealExecWhy = turnStats?.hasData
    ? `${turnStats.completedTurns} of ${turnStats.totalTurns} turns completed · ${turnStats.avgCompletionPct}% avg stage completion · ${turnStats.notRentReadyCount} units not yet leasable`
    : (summary?.executionInsight ?? "Execution analysis unavailable.");
  const revealImprovWhy = turnStats?.hasData
    ? `${turnStats.completedTurns} turns completed · ${Math.round(((turnStats.totalTurns - turnStats.notRentReadyCount) / turnStats.totalTurns) * 100)}% rent-ready rate across ${turnStats.propertyCount} properties`
    : (summary?.improvementInsight ?? "Improvement analysis unavailable.");

  const config: Record<MetricKey, {
    title: string;
    why: string;
    accentClass: string;
    borderClass: string;
    bgClass: string;
    headerColor: string;
  }> = {
    flow: {
      title: "FLOW — Why Movement is Constrained",
      why: revealFlowWhy,
      accentClass: "bg-blue-500",
      borderClass: "border-blue-500/50",
      bgClass: "bg-blue-500/5",
      headerColor: "text-blue-400",
    },
    risk: {
      title: "RISK — Why Exposure is Elevated",
      why: revealRiskWhy,
      accentClass: "bg-red-500",
      borderClass: "border-red-500/50",
      bgClass: "bg-red-500/5",
      headerColor: "text-red-400",
    },
    execution: {
      title: "EXECUTION — Why Progress is Low",
      why: revealExecWhy,
      accentClass: "bg-green-500",
      borderClass: "border-green-500/50",
      bgClass: "bg-green-500/5",
      headerColor: "text-green-400",
    },
    improvement: {
      title: "IMPROVEMENT — Trend Analysis",
      why: revealImprovWhy,
      accentClass: "bg-purple-500",
      borderClass: "border-purple-500/50",
      bgClass: "bg-purple-500/5",
      headerColor: "text-purple-400",
    },
  };

  const cfg = config[metric];

  // ── PRIMARY CAUSE (derived from real data, turn-first when available) ──
  let primaryCause = cfg.why;
  if (metric === "flow") {
    if (turnStats?.hasData) {
      primaryCause = `${turnStats.blockedTurns} turns blocked at "${turnStats.primaryBottleneckStage ?? "primary stage"}" stage · ${Math.round(100 - turnStats.avgCompletionPct)}% of active turns incomplete · ${turnStats.reworkTurns} turns in rework`;
    } else if (bottleneck) {
      primaryCause = `${bottleneck.itemCount} stages congested in "${bottleneck.stageName}" (${bottleneck.workflowTitle}) — ${bottleneck.maxAgeDays}d max age`;
    }
  } else if (metric === "risk") {
    if (turnStats?.hasData) {
      const rentReadyRate = turnStats.totalTurns > 0
        ? Math.round(((turnStats.totalTurns - turnStats.notRentReadyCount) / turnStats.totalTurns) * 100)
        : 0;
      primaryCause = `${turnStats.blockedTurns} blocked turns · ${turnStats.reworkTurns} in rework · ${turnStats.notRentReadyCount} units not rent-ready (${rentReadyRate}% rent-ready rate)`;
    } else if (snap) {
      const redCount = spotlight.filter((w) => w.concernLevel === "critical").length;
      primaryCause = `${snap.overdueItemsCount} overdue units · active exposure across ${redCount} at-risk propert${redCount !== 1 ? "ies" : "y"}`;
    }
  } else if (metric === "execution") {
    if (turnStats?.hasData) {
      const rentReadyRate = turnStats.totalTurns > 0
        ? Math.round(((turnStats.totalTurns - turnStats.notRentReadyCount) / turnStats.totalTurns) * 100)
        : 0;
      primaryCause = `${rentReadyRate}% rent-ready rate · ${turnStats.completedTurns} of ${turnStats.totalTurns} turns completed · ${turnStats.notRentReadyCount} units not yet leasable`;
    } else if (snap) {
      if (snap.longestAgingItem) {
        primaryCause = `${snap.overdueItemsCount} units overdue — longest stuck ${snap.longestAgingItem.daysInStage}d in stage`;
      } else {
        primaryCause = `${snap.overdueItemsCount} overdue units contributing to execution drag`;
      }
    }
  } else if (metric === "improvement") {
    if (turnStats?.hasData) {
      const rentReadyRate = turnStats.totalTurns > 0
        ? Math.round(((turnStats.totalTurns - turnStats.notRentReadyCount) / turnStats.totalTurns) * 100)
        : 0;
      primaryCause = `${turnStats.completedTurns} turns completed · ${rentReadyRate}% rent-ready rate · ${turnStats.totalTurns - turnStats.completedTurns} turns still in progress`;
    } else {
      const completionTrend = trends.find((t) => t.label === "Completion Activity");
      if (completionTrend) {
        primaryCause = `Completion trend ${completionTrend.direction} — ${completionTrend.value}`;
      }
    }
  }

  // ── RECOMMENDED ACTION (derived from real data, turn-aware) ──
  let recommendedAction = "";
  if (metric === "flow") {
    if (turnStats?.hasData && turnStats.blockedTurns > 0) {
      recommendedAction = `Unblock ${turnStats.blockedTurns} turns stalled at ${turnStats.primaryBottleneckStage ?? "primary stage"} — review delay reasons and escalate vendor/maintenance dependencies`;
    } else if (bottleneck) {
      recommendedAction = `Escalate the top ${Math.min(3, bottleneck.itemCount)} aging turns at "${bottleneck.stageName}" stage immediately to restore flow`;
    } else {
      recommendedAction = "Review stage assignments and unblock turns stalled beyond 7 days";
    }
  } else if (metric === "risk") {
    const missingCount = actions.filter((a) => a.missingDocs).length;
    if (turnStats?.hasData && turnStats.blockedTurns + turnStats.reworkTurns > 0) {
      recommendedAction = `Resolve ${turnStats.blockedTurns} blocked and ${turnStats.reworkTurns} rework turns — ${turnStats.notRentReadyCount} units remain unleasable until cleared`;
    } else if (missingCount > 0) {
      recommendedAction = `Address ${snap?.criticalItemsCount ?? 0} critical turns immediately — prioritize the ${missingCount} missing documentation case${missingCount !== 1 ? "s" : ""} first`;
    } else {
      recommendedAction = `Address ${snap?.criticalItemsCount ?? 0} critical turns immediately, starting with the highest-priority overdue cases`;
    }
  } else if (metric === "execution") {
    if (turnStats?.hasData && turnStats.notRentReadyCount > 0) {
      recommendedAction = `Clear ${turnStats.notRentReadyCount} not-rent-ready units — focus on resolving blocked turns first, then push inspection-failed units through rework`;
    } else if (snap?.longestAgingItem) {
      recommendedAction = `Assign ownership to open turns and resolve the longest-stalled turn first (stuck ${snap.longestAgingItem.daysInStage}d in stage)`;
    } else {
      recommendedAction = "Assign ownership to all unassigned turns and review completion blockers across active properties";
    }
  } else if (metric === "improvement") {
    const completionTrend = trends.find((t) => t.label === "Completion Activity");
    if (completionTrend?.direction === "down") {
      recommendedAction = "Prioritize clearing overdue backlog to reverse declining trend — focus on completing in-progress turns before adding new ones";
    } else if (completionTrend?.direction === "stable") {
      recommendedAction = "Push 2–3 near-complete turns to completion this week to build momentum and improve trend";
    } else {
      recommendedAction = "Maintain current momentum — close out oldest turns and reduce turn stage congestion to sustain improvement";
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
      className={cn(
        "rounded-xl border-2 overflow-hidden shadow-md",
        cfg.borderClass,
        cfg.bgClass,
      )}
    >
      {/* Metric color accent bar */}
      <div className={cn("h-1 w-full", cfg.accentClass)} />

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className={cn("text-sm font-bold tracking-wide", cfg.headerColor)}>
            {cfg.title}
          </h3>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 border border-border/40 rounded-md px-2 py-1 shrink-0 ml-4"
          >
            <X className="h-3 w-3" /> Close
          </button>
        </div>

        {/* PRIMARY CAUSE */}
        <div className={cn(
          "rounded-lg border px-4 py-3 flex items-start gap-3",
          cfg.borderClass.replace("/50", "/30"),
          "bg-background/70",
        )}>
          <div className="shrink-0 mt-0.5">
            <div className={cn("w-2 h-2 rounded-full mt-1", cfg.accentClass)} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
              Primary Cause
            </p>
            <p className="text-sm font-semibold text-foreground leading-snug">{primaryCause}</p>
          </div>
        </div>

        {/* Insight context */}
        <div className="rounded-lg bg-background/50 border border-border/25 px-4 py-2.5">
          <p className="text-xs text-muted-foreground leading-relaxed">{cfg.why}</p>
        </div>

        {/* Per-metric detail rows */}
        {metric === "flow" && (
          <FlowReveal bottleneck={bottleneck} spotlight={spotlight} trends={trends} turnStats={turnStats} onDrill={onDrill} />
        )}
        {metric === "risk" && (
          <RiskReveal actions={actions} spotlight={spotlight} summary={summary} turnStats={turnStats} onDrill={onDrill} />
        )}
        {metric === "execution" && (
          <ExecutionReveal snap={snap} trends={trends} spotlight={spotlight} summary={summary} turnStats={turnStats} onDrill={onDrill} />
        )}
        {metric === "improvement" && (
          <ImprovementReveal snap={snap} trends={trends} summary={summary} turnStats={turnStats} onDrill={onDrill} />
        )}

        {/* RECOMMENDED ACTION */}
        {recommendedAction && (
          <div className="rounded-lg bg-background/80 border border-border/50 px-4 py-3 flex items-start gap-3">
            <Zap className={cn("h-4 w-4 shrink-0 mt-0.5", cfg.headerColor)} />
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
                Recommended Action
              </p>
              <p className="text-sm text-foreground/90 leading-snug">{recommendedAction}</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Flow Reveal ───────────────────────────────────────────────────────────────

function FlowReveal({
  bottleneck,
  spotlight,
  trends,
  turnStats,
  onDrill,
}: {
  bottleneck: DashboardIntelligence["primaryBottleneck"];
  spotlight: WorkflowSpotlightEntry[];
  trends: TrendSignal[];
  turnStats: TurnStats | null | undefined;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const congestionTrend = trends.find((t) => t.label === "Stage Congestion");
  const agingTrend = trends.find((t) => t.label === "Aging Items");

  return (
    <div className="space-y-3">
      {/* Turn-derived inputs (first-class) */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-blue-400/70 mb-2 flex items-center gap-1.5">
          <Wrench className="h-3 w-3" /> Turn-Derived Inputs
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RevealCard label="Turn Pipeline Status" icon={Activity}>
            {turnStats?.hasData ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("blocked_turns")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  disabled={turnStats.blockedTurns === 0}
                  title="View blocked turn records"
                >
                  <p className="text-2xl font-bold text-status-red tabular-nums">{turnStats.blockedTurns}</p>
                  <p className="text-[10px] font-bold uppercase text-status-red/80 tracking-wide">turns blocked</p>
                </ClickableSignal>
                <p className="text-xs text-muted-foreground mt-1">{turnStats.avgCompletionPct}% avg completion · {turnStats.activeTurns} active</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No turn data — import a Turn Matrix to enable turn-based flow signals.</p>
            )}
          </RevealCard>

          <RevealCard label="Primary Turn Bottleneck" icon={TrendingDown}>
            {turnStats?.hasData && turnStats.primaryBottleneckStage ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("stage_congestion")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  title="View congested stage"
                >
                  <p className="font-semibold text-sm">{turnStats.primaryBottleneckStage}</p>
                  {turnStats.blockedTurns > 0 && (
                    <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">↗</p>
                  )}
                </ClickableSignal>
                {turnStats.bottleneckExplanation && (
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{turnStats.bottleneckExplanation}</p>
                )}
              </>
            ) : turnStats?.hasData ? (
              <p className="text-xs text-muted-foreground">No turn bottleneck detected.</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">Not connected.</p>
            )}
          </RevealCard>

          <RevealCard label="Bottleneck Stage Impact" icon={Workflow}>
            {spotlight.filter((w) => w.hasBottleneck).length > 0 ? (
              <ul className="space-y-1.5">
                {spotlight.filter((w) => w.hasBottleneck).slice(0, 3).map((w) => (
                  <li key={w.workflowId} className="flex items-center justify-between text-xs">
                    <span className="text-foreground/80 truncate max-w-[120px]">{w.title}</span>
                    <span className="text-muted-foreground shrink-0 ml-1">{w.openItems} open turns</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No stages with active bottlenecks.</p>
            )}
          </RevealCard>
        </div>
      </div>

      {/* Turn stage congestion signals */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60 mb-2">Turn Stage Congestion Signals</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RevealCard label="Top Turn Stage Bottleneck" icon={Activity}>
            {bottleneck ? (
              <>
                <p className="font-semibold text-sm">{bottleneck.stageName}</p>
                <p className="text-xs text-muted-foreground mt-1">{bottleneck.workflowTitle}</p>
                <div className="mt-2 space-y-1">
                  <div className="text-xs">
                    <ClickableSignal
                      onClick={() => onDrill("bottleneck_items", {
                        workflowId: bottleneck.workflowId,
                        stageId: bottleneck.stageId ?? undefined,
                      })}
                      className="px-1 py-0.5 rounded"
                      title="View stuck turns in this stage"
                      disabled={bottleneck.itemCount === 0}
                    >
                      <span className="text-status-red font-semibold">{bottleneck.itemCount} turns stuck</span>
                      {bottleneck.itemCount > 0 && <span className="ml-1 text-[10px] text-primary/50">↗</span>}
                    </ClickableSignal>
                  </div>
                  <div className="text-xs">
                    <span className="font-medium text-foreground/80">{bottleneck.maxAgeDays}d max age</span>
                    <span className="ml-1.5 text-[10px] text-status-red/80 font-semibold uppercase">
                      ({severityLabel(bottleneck.maxAgeDays, "age")})
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No active bottleneck detected.</p>
            )}
          </RevealCard>

          <RevealCard label="Stage Congestion Signal" icon={TrendingDown}>
            {congestionTrend ? (
              <>
                <p className="font-semibold text-sm">{congestionTrend.value}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{congestionTrend.explanation}</p>
              </>
            ) : agingTrend ? (
              <>
                <p className="font-semibold text-sm">{agingTrend.value}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{agingTrend.explanation}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No congestion signal.</p>
            )}
          </RevealCard>
        </div>
      </div>
    </div>
  );
}

// ── Risk Reveal ───────────────────────────────────────────────────────────────

function RiskReveal({
  actions,
  spotlight,
  summary,
  turnStats,
  onDrill,
}: {
  actions: IntelligenceAction[];
  spotlight: WorkflowSpotlightEntry[];
  summary: any;
  turnStats: TurnStats | null | undefined;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const criticalActions = actions.filter((a) => a.urgency === "critical");
  const missingDocActions = actions.filter((a) => a.missingDocs);
  const redWorkflows = spotlight.filter((w) => w.concernLevel === "critical");

  return (
    <div className="space-y-3">
      {/* Turn-derived risk inputs (first-class) */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-red-400/70 mb-2 flex items-center gap-1.5">
          <Wrench className="h-3 w-3" /> Turn-Derived Risk Inputs
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RevealCard label="Blocked Turns" icon={AlertCircle}>
            {turnStats?.hasData ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("blocked_turns")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  disabled={turnStats.blockedTurns === 0}
                  title="View blocked turn records"
                >
                  <p className="text-2xl font-bold text-status-red tabular-nums flex items-baseline gap-1">
                    {turnStats.blockedTurns}
                    {turnStats.blockedTurns > 0 && <span className="text-[11px] text-primary/50">↗</span>}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">
                    {turnStats.blockedTurns > 0 ? "ACTIVE BLOCKAGES" : "NO BLOCKS"}
                  </p>
                </ClickableSignal>
                <p className="text-xs text-muted-foreground mt-1">turns with confirmed gate or dependency</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">This card is not yet connected to turn-derived inputs.</p>
            )}
          </RevealCard>

          <RevealCard label="Rework Loop" icon={AlertTriangle}>
            {turnStats?.hasData ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("rework_loop")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  disabled={turnStats.reworkTurns === 0}
                  title="View rework turns"
                >
                  <p className="text-2xl font-bold text-amber-400 tabular-nums flex items-baseline gap-1">
                    {turnStats.reworkTurns}
                    {turnStats.reworkTurns > 0 && <span className="text-[11px] text-primary/50">↗</span>}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-amber-400/80 mt-0.5 tracking-wide">
                    {turnStats.reworkTurns > 0 ? "INSPECTION FAILS" : "NO REWORK"}
                  </p>
                </ClickableSignal>
                <p className="text-xs text-muted-foreground mt-1">units failed inspection · re-entering pipeline</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">This card is not yet connected to turn-derived inputs.</p>
            )}
          </RevealCard>

          <RevealCard label="Not Rent-Ready" icon={ShieldAlert}>
            {turnStats?.hasData ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("not_rent_ready")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  disabled={turnStats.notRentReadyCount === 0}
                  title="View not-rent-ready units"
                >
                  <p className="text-2xl font-bold text-status-red tabular-nums flex items-baseline gap-1">
                    {turnStats.notRentReadyCount}
                    {turnStats.notRentReadyCount > 0 && <span className="text-[11px] text-primary/50">↗</span>}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">
                    units not leasable
                  </p>
                </ClickableSignal>
                <p className="text-xs text-muted-foreground mt-1">active turns missing rent-ready status</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">This card is not yet connected to turn-derived inputs.</p>
            )}
          </RevealCard>
        </div>
      </div>

      {/* Turn risk signals */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60 mb-2">Turn Risk Signals</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RevealCard label="Blocked Turns" icon={ShieldAlert}>
            <ClickableSignal
              onClick={() => onDrill("blocked_turns")}
              className="block px-1 py-0.5 rounded -mx-1"
              disabled={(turnStats?.blockedTurns ?? 0) === 0}
              title="View blocked turns"
            >
              <p className="text-2xl font-bold text-status-red tabular-nums flex items-baseline gap-1">
                {turnStats?.blockedTurns ?? 0}
                {(turnStats?.blockedTurns ?? 0) > 0 && <span className="text-[11px] text-primary/50">↗</span>}
              </p>
              <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">
                {severityLabel(turnStats?.blockedTurns ?? 0, "critical")}
              </p>
            </ClickableSignal>
            <p className="text-xs text-muted-foreground mt-1">turns stalled in stage</p>
            {(turnStats?.reworkTurns ?? 0) > 0 && (
              <p className="text-xs text-status-red/80 mt-2 leading-snug">
                {turnStats!.reworkTurns} additional turn{turnStats!.reworkTurns !== 1 ? "s" : ""} in rework
              </p>
            )}
          </RevealCard>

          <RevealCard label="Not Rent-Ready Units" icon={Clock}>
            <ClickableSignal
              onClick={() => onDrill("not_rent_ready")}
              className="block px-1 py-0.5 rounded -mx-1"
              disabled={(turnStats?.notRentReadyCount ?? 0) === 0}
              title="View not-rent-ready units"
            >
              <p className="text-2xl font-bold text-status-yellow tabular-nums flex items-baseline gap-1">
                {turnStats?.notRentReadyCount ?? 0}
                {(turnStats?.notRentReadyCount ?? 0) > 0 && <span className="text-[11px] text-primary/50">↗</span>}
              </p>
              <p className="text-[10px] font-bold uppercase text-status-yellow/80 mt-0.5 tracking-wide">
                {severityLabel(turnStats?.notRentReadyCount ?? 0, "overdue")} backlog
              </p>
            </ClickableSignal>
            <p className="text-xs text-muted-foreground mt-1">units not yet rent-ready</p>
            {missingDocActions.length > 0 && (
              <p className="text-xs text-status-yellow/80 mt-2 leading-snug">
                {missingDocActions.length} turn{missingDocActions.length !== 1 ? "s" : ""} with documentation issues
              </p>
            )}
          </RevealCard>

          <RevealCard label="At-Risk Properties" icon={AlertTriangle}>
            {redWorkflows.length > 0 ? (
              <ul className="space-y-1.5">
                {redWorkflows.slice(0, 3).map((w) => (
                  <li key={w.workflowId} className="text-xs">
                    <span className="text-foreground/80 font-medium">{w.title}</span>
                    <p className="text-muted-foreground leading-tight mt-0.5">{w.concernReason}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No properties at critical risk.</p>
            )}
          </RevealCard>
        </div>
      </div>
    </div>
  );
}

// ── Execution Reveal ──────────────────────────────────────────────────────────

function ExecutionReveal({
  snap,
  trends,
  spotlight,
  summary,
  turnStats,
  onDrill,
}: {
  snap: DashboardIntelligence["executiveSnapshot"] | undefined;
  trends: TrendSignal[];
  spotlight: WorkflowSpotlightEntry[];
  summary: any;
  turnStats: TurnStats | null | undefined;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const completionTrend = trends.find((t) => t.label === "Completion Activity");
  const overdueTrend = trends.find((t) => t.label === "Overdue Items");
  const staleWorkflows = spotlight.filter((w) => w.openItems > 0 && w.criticalItems === 0);

  const rentReadyRate = turnStats?.hasData && turnStats.totalTurns > 0
    ? Math.round(((turnStats.totalTurns - turnStats.notRentReadyCount) / turnStats.totalTurns) * 100)
    : null;

  return (
    <div className="space-y-3">
      {/* Turn-derived execution inputs (first-class) */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-green-400/70 mb-2 flex items-center gap-1.5">
          <Wrench className="h-3 w-3" /> Turn-Derived Execution Inputs
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RevealCard label="Rent-Ready Rate" icon={Target}>
            {turnStats?.hasData ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("not_rent_ready")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  disabled={turnStats.notRentReadyCount === 0}
                  title="View not-rent-ready units"
                >
                  <p className={`text-2xl font-bold tabular-nums flex items-baseline gap-1 ${(rentReadyRate ?? 0) < 50 ? "text-status-red" : (rentReadyRate ?? 0) < 80 ? "text-status-yellow" : "text-status-green"}`}>
                    {rentReadyRate ?? 0}%
                    {turnStats.notRentReadyCount > 0 && <span className="text-[11px] text-primary/50">↗</span>}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">
                    {severityLabel(rentReadyRate ?? 0, "throughput")}
                  </p>
                </ClickableSignal>
                <p className="text-xs text-muted-foreground mt-1">{turnStats.notRentReadyCount} units not yet leasable</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">This card is not yet connected to turn-derived inputs.</p>
            )}
          </RevealCard>

          <RevealCard label="Turn Completion" icon={Activity}>
            {turnStats?.hasData ? (
              <>
                <p className="text-2xl font-bold tabular-nums">{turnStats.avgCompletionPct}%</p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">avg turn progress</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {turnStats.completedTurns} of {turnStats.totalTurns} turns complete
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">This card is not yet connected to turn-derived inputs.</p>
            )}
          </RevealCard>

          <RevealCard label="Execution Blockers" icon={Clock}>
            {turnStats?.hasData ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("blocked_turns")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  disabled={turnStats.blockedTurns === 0}
                  title="View blocked turns"
                >
                  <p className="text-2xl font-bold text-status-red tabular-nums flex items-baseline gap-1">
                    {turnStats.blockedTurns}
                    {turnStats.blockedTurns > 0 && <span className="text-[11px] text-primary/50">↗</span>}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">blocked turns</p>
                </ClickableSignal>
                {turnStats.reworkTurns > 0 && (
                  <p className="text-xs text-amber-400/80 mt-1">{turnStats.reworkTurns} additional in rework</p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">This card is not yet connected to turn-derived inputs.</p>
            )}
          </RevealCard>
        </div>
      </div>

      {/* Turn execution signals */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60 mb-2">Turn Execution Signals</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RevealCard label="Turn Completion Rate" icon={Target}>
            <p className="text-2xl font-bold tabular-nums">{snap?.throughputPercent ?? 0}%</p>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">
              {severityLabel(snap?.throughputPercent ?? 0, "throughput")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{snap?.throughputLabel ?? "turns completed"}</p>
            {completionTrend && (
              <p className="text-xs text-muted-foreground mt-2 leading-snug">{completionTrend.explanation}</p>
            )}
          </RevealCard>

          <RevealCard label="Movement Consistency" icon={Activity}>
            {snap?.longestAgingItem ? (
              <>
                <p className="text-xs text-muted-foreground mb-1">Longest stalled turn:</p>
                <p className="text-sm font-semibold leading-snug text-foreground/80">{snap.longestAgingItem.title}</p>
                <div className="flex gap-2 mt-1.5 text-xs">
                  <span className="text-status-red font-medium">{snap.longestAgingItem.daysInStage}d</span>
                  <span className="text-muted-foreground">{snap.longestAgingItem.workflowTitle}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No severely stalled turns detected.</p>
            )}
          </RevealCard>

          <RevealCard label="Responsiveness Gaps" icon={Clock}>
            {overdueTrend ? (
              <>
                <p className="font-semibold text-sm">{overdueTrend.value}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{overdueTrend.explanation}</p>
              </>
            ) : staleWorkflows.length > 0 ? (
              <>
                <ClickableSignal
                  onClick={() => onDrill("stale_items")}
                  className="block px-1 py-0.5 rounded -mx-1"
                  title="View stalled turns"
                >
                  <p className="text-2xl font-bold tabular-nums text-amber-400 flex items-baseline gap-1">
                    {staleWorkflows.length}
                    <span className="text-[11px] text-primary/50">↗</span>
                  </p>
                  <p className="text-[10px] font-bold uppercase text-amber-400/80 mt-0.5 tracking-wide">stalled stages</p>
                </ClickableSignal>
                <p className="text-xs text-muted-foreground mt-1">with open turns, no critical escalation</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No responsiveness gaps detected.</p>
            )}
          </RevealCard>
        </div>
      </div>
    </div>
  );
}

// ── Improvement Reveal ────────────────────────────────────────────────────────

function ImprovementReveal({
  snap,
  trends,
  summary,
  turnStats,
  onDrill,
}: {
  snap: DashboardIntelligence["executiveSnapshot"] | undefined;
  trends: TrendSignal[];
  summary: any;
  turnStats: TurnStats | null | undefined;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const completionTrend = trends.find((t) => t.label === "Completion Activity");
  const agingTrend = trends.find((t) => t.label === "Aging Items");

  return (
    <div className="space-y-3">
      {/* Turn-derived improvement status — explicitly not connected */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-purple-400/70 mb-2 flex items-center gap-1.5">
          <Wrench className="h-3 w-3" /> Turn-Derived Improvement Inputs
        </p>
        <div className="rounded-lg border border-border/40 bg-background/60 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Not Yet Connected</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This card is not yet connected to turn-derived inputs. Improvement scoring requires historical turn trend data — velocity over time, stage progression rates, and rework cycle reduction — which accumulates after multiple Turn Matrix imports.
            </p>
            {turnStats?.hasData && (
              <p className="text-xs text-muted-foreground/70 mt-2 leading-relaxed">
                Current data: {turnStats.totalTurns} turns across {turnStats.propertyCount} propert{turnStats.propertyCount !== 1 ? "ies" : "y"} · {turnStats.avgCompletionPct}% avg completion. Import additional snapshots to enable trend analysis.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Turn improvement signals */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60 mb-2">Turn Improvement Signals</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RevealCard label="Trend Direction" icon={TrendingUp}>
            {completionTrend ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  {completionTrend.direction === "up" ? (
                    <TrendingUp className="h-5 w-5 text-status-green" />
                  ) : completionTrend.direction === "down" ? (
                    <TrendingDown className="h-5 w-5 text-status-red" />
                  ) : (
                    <Minus className="h-5 w-5 text-muted-foreground" />
                  )}
                  <span className="font-semibold text-sm capitalize">{completionTrend.direction}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">{completionTrend.explanation}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Trend data not yet available.</p>
            )}
          </RevealCard>

          <RevealCard label="Completion Momentum" icon={Zap}>
            <p className="text-2xl font-bold tabular-nums">{snap?.throughputPercent ?? 0}%</p>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">
              {severityLabel(snap?.throughputPercent ?? 0, "throughput")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{snap?.improvementSignal ?? "No signal available"}</p>
          </RevealCard>

          <RevealCard label="Recovery vs Decline" icon={BarChart2}>
            {agingTrend ? (
              <>
                <p className="font-semibold text-sm">{agingTrend.value}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{agingTrend.explanation}</p>
              </>
            ) : snap?.longestAgingItem ? (
              <>
                <p className="text-xs text-muted-foreground mb-1">Oldest unresolved turn:</p>
                <p className="text-sm font-semibold">{snap.longestAgingItem.title}</p>
                <p className="text-xs text-status-red mt-1">{snap.longestAgingItem.daysInStage}d in stage</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No recovery signal available.</p>
            )}
          </RevealCard>
        </div>
      </div>
    </div>
  );
}

// ── Shared reveal card wrapper ─────────────────────────────────────────────────

function RevealCard({ label, icon: Icon, children }: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-background/70 border border-border/40 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      {children}
    </div>
  );
}

function TurnInsightStrip({
  turnStats,
  isLoading,
}: {
  turnStats: TurnStats | null | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  const total = turnStats?.totalTurns ?? 0;
  const active = turnStats?.activeTurns ?? 0;
  const completed = turnStats?.completedTurns ?? 0;
  const blocked = turnStats?.blockedTurns ?? 0;
  const rework = turnStats?.reworkTurns ?? 0;
  const notRentReady = turnStats?.notRentReadyCount ?? 0;
  const avgCompletion = turnStats?.avgCompletionPct ?? 0;

  const blockedPct = active > 0 ? Math.round((blocked / active) * 100) : 0;
  const nrrPct = total > 0 ? Math.round((notRentReady / total) * 100) : 0;
  const reworkPct = total > 0 ? Math.round((rework / total) * 100) : 0;

  const pills = [
    {
      label: "Turn Completion",
      value: `${completed} completed`,
      sub: `${avgCompletion}% avg stage completion`,
      direction: avgCompletion >= 60 ? "up" : avgCompletion >= 35 ? "stable" : "down",
      colorKey: avgCompletion >= 60 ? "green" : avgCompletion >= 35 ? "yellow" : "red",
    },
    {
      label: "Blocked Turns",
      value: `${blocked} blocked`,
      sub: `${blockedPct}% of ${active} active turns`,
      direction: blocked === 0 ? "up" : blockedPct <= 15 ? "stable" : "down",
      colorKey: blocked === 0 ? "green" : blockedPct <= 15 ? "yellow" : "red",
    },
    {
      label: "Not Rent-Ready",
      value: `${notRentReady} units`,
      sub: `${nrrPct}% of ${total} total turns`,
      direction: nrrPct <= 20 ? "up" : nrrPct <= 50 ? "stable" : "down",
      colorKey: nrrPct <= 20 ? "green" : nrrPct <= 50 ? "yellow" : "red",
    },
    {
      label: "Rework Loop",
      value: `${rework} in rework`,
      sub: `${reworkPct}% of total turns affected`,
      direction: rework === 0 ? "up" : reworkPct <= 10 ? "stable" : "down",
      colorKey: rework === 0 ? "green" : reworkPct <= 10 ? "yellow" : "red",
    },
  ];

  const iconBgClass = (c: string) =>
    c === "green" ? "bg-green-500/15 text-green-400" :
    c === "red"   ? "bg-red-500/15 text-red-400" :
                    "bg-amber-500/15 text-amber-400";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {pills.map((p, i) => (
        <motion.div
          key={p.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <Card className="bg-card border-border/50 hover:border-primary/30 transition-colors">
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`mt-0.5 rounded-full p-1.5 ${iconBgClass(p.colorKey)}`}>
                {p.direction === "up" ? (
                  <TrendingUp className="h-3 w-3" />
                ) : p.direction === "down" ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {p.label}
                </p>
                <p className="text-sm font-semibold mt-0.5 truncate">{p.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight line-clamp-2">
                  {p.sub}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function ActionPanel({
  actions,
  isLoading,
}: {
  actions: IntelligenceAction[];
  isLoading: boolean;
}) {
  const actionItemIds = actions
    .map((a) => Number((a.metadata as any)?.itemId))
    .filter((id) => id > 0);

  const { data: docCountsData = {} } = useDocCounts("workflow_item", actionItemIds);

  const criticalMissingDocCount = actions.filter((a) => {
    const itemId = Number((a.metadata as any)?.itemId);
    return a.urgency === "critical" && itemId > 0 && (docCountsData[itemId]?.count ?? 0) === 0;
  }).length;

  return (
    <Card className="bg-card border-border/50 shadow-md flex flex-col h-full">
      <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            Priority Actions
          </CardTitle>
          <CardDescription>Requires immediate attention</CardDescription>
          {criticalMissingDocCount > 0 && (
            <p className="text-[11px] text-amber-400 mt-1 font-medium">
              {EVIDENCE.MISSING_ITEMS_COUNT(criticalMissingDocCount)}
            </p>
          )}
        </div>
        {actions.filter((a) => a.urgency === "critical").length > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {actions.filter((a) => a.urgency === "critical").length} CRITICAL
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-auto max-h-[360px]">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center h-full">
            <Activity className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-sm">No priority actions pending.</p>
            <p className="text-xs mt-1 opacity-60">System operating smoothly.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {actions.map((action, i) => {
              const itemId = Number((action.metadata as any)?.itemId);
              const docCount = itemId > 0 ? (docCountsData[itemId]?.count ?? 0) : null;
              return (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className={`p-4 hover:bg-secondary/50 transition-colors flex items-start gap-3 border-l-2 ${
                    action.urgency === "critical"
                      ? "border-l-red-500"
                      : action.urgency === "high"
                      ? "border-l-amber-500"
                      : "border-l-border"
                  }`}
                >
                  <div
                    className={`mt-0.5 p-1.5 rounded-md ${
                      action.urgency === "critical"
                        ? "bg-red-500/15 text-red-400"
                        : action.urgency === "high"
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {categoryIcon(action.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${urgencyLabel(action.urgency)}`}
                      >
                        {action.urgency}
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                        {action.category.replace("_", " ")}
                      </span>
                      {docCount !== null && (
                        <AttachmentBadge
                          count={docCount}
                          showWarning={action.urgency === "critical" && docCount === 0}
                        />
                      )}
                    </div>
                    <h4 className="font-semibold text-sm text-foreground leading-snug">
                      {action.title}
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                      {action.reason}
                    </p>
                  </div>
                  <Link href={action.actionPath}>
                    <div className="h-7 w-7 rounded-full border border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all cursor-pointer shrink-0">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TurnBottleneckPanel({
  turnStats,
  isLoading,
}: {
  turnStats: TurnStats | null | undefined;
  isLoading: boolean;
}) {
  const stageName = turnStats?.primaryBottleneckStage ?? null;
  const blocked = turnStats?.blockedTurns ?? 0;
  const total = turnStats?.totalTurns ?? 0;
  const active = turnStats?.activeTurns ?? 0;
  const rework = turnStats?.reworkTurns ?? 0;
  const notRentReady = turnStats?.notRentReadyCount ?? 0;
  const avgCompletion = turnStats?.avgCompletionPct ?? 0;
  const blockedPct = active > 0 ? Math.round((blocked / active) * 100) : 0;
  const hasCritical = blocked > 10 || blockedPct > 25;

  return (
    <Card className="bg-card border-border/50 shadow-md flex flex-col h-full">
      <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Primary Turn Bottleneck
          </CardTitle>
          <CardDescription>Most constraining turn stage</CardDescription>
        </div>
        {turnStats?.hasData && (
          <StoplightBadge
            status={hasCritical ? "red" : blocked > 0 ? "yellow" : "green"}
            label={hasCritical ? "RED" : blocked > 0 ? "YELLOW" : "GREEN"}
          />
        )}
      </CardHeader>
      <CardContent className="p-5 flex-1 flex flex-col gap-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !turnStats?.hasData || !stageName ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-8">
            <Activity className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-sm">No turn bottleneck data available.</p>
            <p className="text-xs mt-1 opacity-60">Import turn matrix data to enable.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-base">{stageName}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">Stage:</span>
                  <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                    {stageName}
                  </span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{total} total turns</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <span className="text-2xl font-bold text-status-red">{blocked}</span>
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider mt-0.5">
                  Blocked Turns
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <span className={`text-2xl font-bold ${blockedPct > 25 ? "text-red-400" : "text-amber-400"}`}>
                  {blockedPct}%
                </span>
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider mt-0.5">
                  Of Active
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <span className="text-2xl font-bold">{avgCompletion}%</span>
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider mt-0.5">
                  Avg Complete
                </p>
              </div>
            </div>

            <div className="bg-background rounded-lg border border-border/50 p-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">Impact: </span>
                {stageName} stage is blocking {blocked} of {active} active turns, delaying {notRentReady} unit{notRentReady !== 1 ? "s" : ""} from reaching rent-ready status.
                {rework > 0 && ` ${rework} additional turn${rework !== 1 ? "s" : ""} in rework loop.`}
              </p>
            </div>

            <div className={`rounded-lg border p-3 ${hasCritical ? "border-red-500/40 bg-red-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
              <p className="text-[11px] leading-relaxed">
                <span className={`font-semibold ${hasCritical ? "text-red-400" : "text-amber-400"}`}>
                  Recommendation:{" "}
                </span>
                Prioritize clearing the {stageName} bottleneck — assign resources to unblock {blocked} stalled turn{blocked !== 1 ? "s" : ""} and accelerate {notRentReady} unit{notRentReady !== 1 ? "s" : ""} toward rent-ready status.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StageDistributionChart({
  rows,
  isLoading,
}: {
  rows: DashboardIntelligence["stageDistribution"];
  isLoading: boolean;
}) {
  // Aggregate by workflow+stage, top 12 by openItems
  const chartData = [...rows]
    .sort((a, b) => b.openItems - a.openItems)
    .slice(0, 12)
    .map((r) => ({
      name: r.stageName.length > 12 ? r.stageName.slice(0, 12) + "…" : r.stageName,
      fullName: r.stageName,
      workflow: r.workflowTitle,
      open: r.openItems,
      completed: r.completedItems,
      isBottleneck: r.isBottleneck,
    }));

  return (
    <Card className="bg-card border-border/50 shadow-sm h-full">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base">Stage Distribution</CardTitle>
        <CardDescription>Open turns per stage · top stages shown</CardDescription>
      </CardHeader>
      <CardContent className="pt-4 pb-2">
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : chartData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
            No active stage data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chartData}
              margin={{ top: 0, right: 0, bottom: 40, left: -10 }}
              barSize={22}
            >
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                angle={-40}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  fontSize: "11px",
                  borderRadius: "8px",
                }}
                formatter={(value: any, name: string) => [
                  value,
                  name === "open" ? "Open Items" : "Completed",
                ]}
                labelFormatter={(_, payload) => {
                  const d = payload?.[0]?.payload;
                  return d ? `${d.fullName} · ${d.workflow}` : "";
                }}
              />
              <Bar dataKey="open" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      entry.isBottleneck
                        ? "#ef4444"
                        : entry.open >= 3
                        ? "#eab308"
                        : "#3b82f6"
                    }
                    opacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {!isLoading && chartData.some((d) => d.isBottleneck) && (
          <div className="flex items-center gap-2 mt-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-500 opacity-80 shrink-0" />
            <span className="text-[10px] text-muted-foreground">Red = current bottleneck stage</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TurnAgingPanel({
  turnStats,
  isLoading,
}: {
  turnStats: TurnStats | null | undefined;
  isLoading: boolean;
}) {
  const blocked = turnStats?.blockedTurns ?? 0;
  const total = turnStats?.totalTurns ?? 0;
  const active = turnStats?.activeTurns ?? 0;
  const rework = turnStats?.reworkTurns ?? 0;
  const notRentReady = turnStats?.notRentReadyCount ?? 0;
  const avgCompletion = turnStats?.avgCompletionPct ?? 0;
  const stageName = turnStats?.primaryBottleneckStage ?? "Unknown Stage";

  const agingPct = active > 0 ? Math.round((blocked / active) * 100) : 0;
  const reworkPct = total > 0 ? Math.round((rework / total) * 100) : 0;
  const nrrPct = total > 0 ? Math.round((notRentReady / total) * 100) : 0;

  const rows = [
    {
      label: "Blocked (≥7d in stage)",
      count: blocked,
      pct: agingPct,
      ofLabel: `of ${active} active`,
      severity: blocked > 10 ? "red" : blocked > 0 ? "yellow" : "green",
      Icon: AlertTriangle,
    },
    {
      label: "In Rework Loop",
      count: rework,
      pct: reworkPct,
      ofLabel: `of ${total} total`,
      severity: rework > 10 ? "red" : rework > 0 ? "yellow" : "green",
      Icon: RefreshCw,
    },
    {
      label: "Not Rent-Ready",
      count: notRentReady,
      pct: nrrPct,
      ofLabel: `of ${total} units`,
      severity: nrrPct > 50 ? "red" : nrrPct > 20 ? "yellow" : "green",
      Icon: Home,
    },
  ] as const;

  return (
    <Card className="bg-card border-border/50 shadow-sm h-full">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base">Turn Aging &amp; Backlog</CardTitle>
        <CardDescription>Stalled turns · rework loop · not rent-ready</CardDescription>
      </CardHeader>
      <CardContent className="p-0 overflow-auto max-h-[330px]">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !turnStats?.hasData ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No turn data available. Import turn matrix to enable.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {rows.map((row, i) => {
              const sColor = row.severity === "red" ? "text-red-400" : row.severity === "yellow" ? "text-amber-400" : "text-green-400";
              const sBg = row.severity === "red" ? "bg-red-500/10" : row.severity === "yellow" ? "bg-amber-500/10" : "bg-green-500/10";
              return (
                <motion.div
                  key={row.label}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-center gap-4 px-4 py-4 hover:bg-secondary/50 transition-colors"
                >
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${sBg}`}>
                    <row.Icon className={`h-4 w-4 ${sColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground/80">{row.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {row.ofLabel} · top stage: {stageName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xl font-bold tabular-nums ${sColor}`}>{row.count}</p>
                    <p className="text-[10px] text-muted-foreground">{row.pct}%</p>
                  </div>
                </motion.div>
              );
            })}

            <div className="px-4 py-4 bg-secondary/20">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60 mb-2">Completion Snapshot</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-secondary rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-green-500/60 rounded-full transition-all"
                    style={{ width: `${avgCompletion}%` }}
                  />
                </div>
                <span className="text-xs font-semibold tabular-nums w-12 text-right">{avgCompletion}%</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{total} total turns · avg stage completion</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
