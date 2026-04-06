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
} from "@workspace/api-client-react";
import { DrillDownSheet, ClickableSignal } from "@/components/drill-down-sheet";
import type { SignalType } from "@/hooks/use-signal-drill";
import { useDocCounts } from "@/hooks/use-doc-counts";
import { PortfolioControlTowerSection } from "@/components/portfolio-control-tower";
import { usePortfolio } from "@/hooks/use-portfolio";
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

function concernBorder(level: string) {
  if (level === "critical") return "border-red-500/60";
  if (level === "warning") return "border-amber-500/60";
  return "border-border/50";
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

const fmtCost = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function Dashboard() {
  const { data: intel, isLoading } = useGetDashboardIntelligence();
  const { data: summary } = useGetDashboardSummary();
  const { data: portfolioCards = [] } = usePortfolio();

  const portfolioExpiredCost = portfolioCards.reduce<number | null>((acc, c) => {
    if (c.expiredWarrantyCost == null) return acc;
    return (acc ?? 0) + c.expiredWarrantyCost;
  }, null);
  const portfolioExpiringSoonCost = portfolioCards.reduce<number | null>((acc, c) => {
    if (c.expiringSoonCost == null) return acc;
    return (acc ?? 0) + c.expiringSoonCost;
  }, null);
  const portfolioTotalAssetCost = portfolioCards.reduce<number | null>((acc, c) => {
    if (c.totalAssetCost == null) return acc;
    return (acc ?? 0) + c.totalAssetCost;
  }, null);
  const [activeMetric, setActiveMetric] = useState<"flow" | "risk" | "execution" | "improvement" | null>(null);
  const [drillState, setDrillState] = useState<DrillState>(null);

  const snap = intel?.executiveSnapshot;

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
                    stroke={getStoplightColor(snap?.stoplight)}
                    strokeWidth="8" fill="transparent"
                    strokeDasharray={2 * Math.PI * 88}
                    strokeDashoffset={
                      2 * Math.PI * 88 * (1 - (snap?.operationalHealthScore ?? 0) / 100)
                    }
                    className="transition-all duration-1000 ease-out drop-shadow-md"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-5xl font-black tracking-tighter">
                    {snap?.operationalHealthScore ?? "—"}
                  </span>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mt-1">
                    OHS
                  </span>
                </div>
              </motion.div>
            )}

            <div className="mt-6 grid grid-cols-3 gap-3 w-full text-center">
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
            </div>

            {snap?.insight && (
              <p className="text-[11px] text-muted-foreground mt-4 text-center leading-relaxed line-clamp-3">
                {snap.insight}
              </p>
            )}

            {/* DRIVEN BY block */}
            {snap && (
              <div className="mt-4 w-full rounded-lg bg-secondary/50 border border-border/40 px-3 py-3 text-left">
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
                  Driven By
                </p>
                <ul className="space-y-1.5">
                  <li className="flex items-start gap-2 text-xs">
                    <span className="text-status-red font-bold mt-0.5">•</span>
                    <span className="text-foreground/80">
                      <ClickableSignal
                        onClick={() => openDrill("critical_items")}
                        className="px-1 py-0.5 rounded"
                        title="View critical items"
                        disabled={snap.criticalItemsCount === 0}
                      >
                        <span className="font-semibold text-status-red">{snap.criticalItemsCount} critical items</span>
                      </ClickableSignal>
                    </span>
                  </li>
                  <li className="flex items-start gap-2 text-xs">
                    <span className="text-status-yellow font-bold mt-0.5">•</span>
                    <span className="text-foreground/80">
                      <ClickableSignal
                        onClick={() => openDrill("overdue_items")}
                        className="px-1 py-0.5 rounded"
                        title="View overdue items"
                        disabled={snap.overdueItemsCount === 0}
                      >
                        <span className="font-semibold text-status-yellow">{snap.overdueItemsCount} overdue items</span>
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
            score={summary?.flowScore}
            stoplight={summary?.flowStoplight}
            insight={summary?.flowInsight}
            icon={Workflow}
            isLoading={isLoading}
            colorClass="text-blue-400"
            isActive={activeMetric === "flow"}
            onClick={() => toggleMetric("flow")}
          />
          <ScoreCard
            title="Risk"
            metricKey="risk"
            score={summary?.riskScore}
            stoplight={summary?.riskStoplight}
            insight={summary?.riskInsight}
            icon={AlertTriangle}
            isLoading={isLoading}
            colorClass="text-red-400"
            isActive={activeMetric === "risk"}
            onClick={() => toggleMetric("risk")}
          />
          <ScoreCard
            title="Execution"
            metricKey="execution"
            score={summary?.executionScore}
            stoplight={summary?.executionStoplight}
            insight={summary?.executionInsight}
            icon={Target}
            isLoading={isLoading}
            colorClass="text-green-400"
            isActive={activeMetric === "execution"}
            onClick={() => toggleMetric("execution")}
          />
          <ScoreCard
            title="Improvement"
            metricKey="improvement"
            score={summary?.improvementScore}
            stoplight={summary?.improvementStoplight}
            insight={summary?.improvementInsight}
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

      {/* ─── Row 2: Trend Signals ─── */}
      <TrendSignalStrip trends={intel?.trends ?? []} isLoading={isLoading} />

      {/* ─── Row 3: Actions + Bottleneck Story ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionPanel actions={intel?.actions ?? []} isLoading={isLoading} />
        <BottleneckPanel bottleneck={intel?.primaryBottleneck ?? null} isLoading={isLoading} />
      </div>

      {/* ─── Row 3b: Asset Health Pulse ─── */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2 pt-4 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Asset Health Pulse</CardTitle>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Live · persisted FK linkage
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col">
              <span className="text-2xl font-black tracking-tight">
                {summary?.totalAssets ?? <Skeleton className="h-7 w-10 inline-block" />}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">Total assets</span>
            </div>
            <ClickableSignal
              onClick={() => openDrill("expired_warranty")}
              className="flex flex-col px-2 py-1 -mx-2 -my-1 rounded-lg"
              disabled={(summary?.atRiskAssets ?? 0) === 0}
              title="View expired warranty assets"
            >
              <span className={`text-2xl font-black tracking-tight ${(summary?.atRiskAssets ?? 0) > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                {summary?.atRiskAssets ?? 0}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 text-red-400" />
                At risk (expired)
                {(summary?.atRiskAssets ?? 0) > 0 && <span className="text-[10px] text-primary/50 ml-1">↗</span>}
              </span>
            </ClickableSignal>
            <ClickableSignal
              onClick={() => openDrill("expiring_soon")}
              className="flex flex-col px-2 py-1 -mx-2 -my-1 rounded-lg"
              disabled={(summary?.expiringSoonAssets ?? 0) === 0}
              title="View assets expiring soon"
            >
              <span className={`text-2xl font-black tracking-tight ${(summary?.expiringSoonAssets ?? 0) > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                {summary?.expiringSoonAssets ?? 0}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Clock className="h-3 w-3 text-amber-400" />
                Expiring soon (90d)
                {(summary?.expiringSoonAssets ?? 0) > 0 && <span className="text-[10px] text-primary/50 ml-1">↗</span>}
              </span>
            </ClickableSignal>
          </div>

          {/* Financial exposure strip */}
          {(portfolioExpiredCost != null || portfolioExpiringSoonCost != null || portfolioTotalAssetCost != null) && (
            <div className="mt-4 pt-4 border-t border-border/40">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-3">Replacement Exposure</p>
              <div className="grid grid-cols-3 gap-3">
                {portfolioTotalAssetCost != null && (
                  <div>
                    <div className="text-sm font-bold tabular-nums text-foreground">{fmtCost(portfolioTotalAssetCost)}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Total portfolio value</div>
                  </div>
                )}
                {portfolioExpiredCost != null ? (
                  <ClickableSignal
                    onClick={() => openDrill("expired_warranty")}
                    className="px-1 py-0.5 -mx-1 rounded"
                    title="View expired warranty exposure"
                  >
                    <div className="text-sm font-bold tabular-nums text-red-400">{fmtCost(portfolioExpiredCost)}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
                      Expired exposure <span className="text-[9px] text-primary/50">↗</span>
                    </div>
                  </ClickableSignal>
                ) : (
                  <div />
                )}
                {portfolioExpiringSoonCost != null ? (
                  <ClickableSignal
                    onClick={() => openDrill("expiring_soon")}
                    className="px-1 py-0.5 -mx-1 rounded"
                    title="View 90-day expiry risk"
                  >
                    <div className="text-sm font-bold tabular-nums text-amber-400">{fmtCost(portfolioExpiringSoonCost)}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
                      90d at risk <span className="text-[9px] text-primary/50">↗</span>
                    </div>
                  </ClickableSignal>
                ) : (
                  <div />
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Row 4: Stage Distribution + Spotlight ─── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="col-span-1 md:col-span-5">
          <StageDistributionChart
            rows={intel?.stageDistribution ?? []}
            isLoading={isLoading}
          />
        </div>
        <div className="col-span-1 md:col-span-7">
          <WorkflowSpotlight
            entries={intel?.workflowSpotlight ?? []}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ─── Row 5: Portfolio Control Tower ─── */}
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

  // ── Per-metric config ──
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
      why: summary?.flowInsight ?? "Flow analysis unavailable.",
      accentClass: "bg-blue-500",
      borderClass: "border-blue-500/50",
      bgClass: "bg-blue-500/5",
      headerColor: "text-blue-400",
    },
    risk: {
      title: "RISK — Why Exposure is Elevated",
      why: summary?.riskInsight ?? "Risk analysis unavailable.",
      accentClass: "bg-red-500",
      borderClass: "border-red-500/50",
      bgClass: "bg-red-500/5",
      headerColor: "text-red-400",
    },
    execution: {
      title: "EXECUTION — Why Progress is Low",
      why: summary?.executionInsight ?? "Execution analysis unavailable.",
      accentClass: "bg-green-500",
      borderClass: "border-green-500/50",
      bgClass: "bg-green-500/5",
      headerColor: "text-green-400",
    },
    improvement: {
      title: "IMPROVEMENT — Trend Analysis",
      why: summary?.improvementInsight ?? "Improvement analysis unavailable.",
      accentClass: "bg-purple-500",
      borderClass: "border-purple-500/50",
      bgClass: "bg-purple-500/5",
      headerColor: "text-purple-400",
    },
  };

  const cfg = config[metric];

  // ── PRIMARY CAUSE (derived from real data) ──
  let primaryCause = cfg.why;
  if (metric === "flow" && bottleneck) {
    primaryCause = `${bottleneck.itemCount} items stuck in "${bottleneck.stageName}" stage (${bottleneck.workflowTitle}) — ${bottleneck.maxAgeDays}d max age`;
  } else if (metric === "risk" && snap) {
    const redCount = spotlight.filter((w) => w.concernLevel === "critical").length;
    primaryCause = `${snap.criticalItemsCount} critical-priority items open with ${snap.overdueItemsCount} past due date — active exposure across ${redCount} at-risk workflow${redCount !== 1 ? "s" : ""}`;
  } else if (metric === "execution" && snap) {
    if (snap.longestAgingItem) {
      primaryCause = `${snap.throughputPercent}% workflow completion rate — longest item stuck ${snap.longestAgingItem.daysInStage}d in "${snap.longestAgingItem.workflowTitle}"`;
    } else {
      primaryCause = `${snap.throughputPercent}% workflow completion rate — ${snap.overdueItemsCount} overdue items contributing to execution drag`;
    }
  } else if (metric === "improvement") {
    const completionTrend = trends.find((t) => t.label === "Completion Activity");
    if (completionTrend && snap) {
      primaryCause = `Completion trend ${completionTrend.direction} — ${completionTrend.value} with ${snap.throughputPercent}% overall throughput`;
    }
  }

  // ── RECOMMENDED ACTION (derived from real data) ──
  let recommendedAction = "";
  if (metric === "flow") {
    if (bottleneck) {
      recommendedAction = `Escalate the top ${Math.min(3, bottleneck.itemCount)} aging items in "${bottleneck.stageName}" immediately to restore flow`;
    } else {
      recommendedAction = "Review stage assignments and reassign items stuck beyond 7 days";
    }
  } else if (metric === "risk") {
    const missingCount = actions.filter((a) => a.missingDocs).length;
    if (missingCount > 0) {
      recommendedAction = `Address ${snap?.criticalItemsCount ?? 0} critical items immediately — prioritize the ${missingCount} missing documentation case${missingCount !== 1 ? "s" : ""} first`;
    } else {
      recommendedAction = `Address ${snap?.criticalItemsCount ?? 0} critical items immediately, starting with the highest-priority overdue cases`;
    }
  } else if (metric === "execution") {
    if (snap?.longestAgingItem) {
      recommendedAction = `Assign ownership to all open items and resolve "${snap.longestAgingItem.title}" first (stuck ${snap.longestAgingItem.daysInStage}d in stage)`;
    } else {
      recommendedAction = "Assign ownership to all unassigned items and review completion blockers across active workflows";
    }
  } else if (metric === "improvement") {
    const completionTrend = trends.find((t) => t.label === "Completion Activity");
    if (completionTrend?.direction === "down") {
      recommendedAction = "Prioritize clearing overdue backlog to reverse declining trend — focus on completing in-flight items before adding new ones";
    } else if (completionTrend?.direction === "stable") {
      recommendedAction = "Push 2–3 near-complete workflows to completion this week to build momentum and improve trend";
    } else {
      recommendedAction = "Maintain current momentum — close out oldest open items and reduce stage congestion to sustain improvement";
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
          <FlowReveal bottleneck={bottleneck} spotlight={spotlight} trends={trends} onDrill={onDrill} />
        )}
        {metric === "risk" && (
          <RiskReveal actions={actions} spotlight={spotlight} summary={summary} onDrill={onDrill} />
        )}
        {metric === "execution" && (
          <ExecutionReveal snap={snap} trends={trends} spotlight={spotlight} summary={summary} onDrill={onDrill} />
        )}
        {metric === "improvement" && (
          <ImprovementReveal snap={snap} trends={trends} summary={summary} onDrill={onDrill} />
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
  onDrill,
}: {
  bottleneck: DashboardIntelligence["primaryBottleneck"];
  spotlight: WorkflowSpotlightEntry[];
  trends: TrendSignal[];
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const congestionTrend = trends.find((t) => t.label === "Stage Congestion");
  const agingTrend = trends.find((t) => t.label === "Aging Items");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Top bottleneck */}
      <RevealCard label="Top Bottleneck Stage" icon={Activity}>
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
                  title="View stuck items in this stage"
                  disabled={bottleneck.itemCount === 0}
                >
                  <span className="text-status-red font-semibold">{bottleneck.itemCount} items stuck</span>
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

      {/* Congestion trend */}
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

      {/* Affected workflows */}
      <RevealCard label="Affected Workflows" icon={Workflow}>
        {spotlight.filter((w) => w.hasBottleneck).length > 0 ? (
          <ul className="space-y-1.5">
            {spotlight.filter((w) => w.hasBottleneck).slice(0, 3).map((w) => (
              <li key={w.workflowId} className="flex items-center justify-between text-xs">
                <span className="text-foreground/80 truncate max-w-[120px]">{w.title}</span>
                <span className="text-muted-foreground shrink-0 ml-1">{w.openItems} open</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No workflows with active bottlenecks.</p>
        )}
      </RevealCard>
    </div>
  );
}

// ── Risk Reveal ───────────────────────────────────────────────────────────────

function RiskReveal({
  actions,
  spotlight,
  summary,
  onDrill,
}: {
  actions: IntelligenceAction[];
  spotlight: WorkflowSpotlightEntry[];
  summary: any;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const criticalActions = actions.filter((a) => a.urgency === "critical");
  const overdueActions = actions.filter((a) => a.category === "overdue");
  const missingDocActions = actions.filter((a) => a.missingDocs);
  const redWorkflows = spotlight.filter((w) => w.concernLevel === "critical");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <RevealCard label="Critical Items" icon={ShieldAlert}>
        <ClickableSignal
          onClick={() => onDrill("critical_items")}
          className="block px-1 py-0.5 rounded -mx-1"
          disabled={(summary?.criticalItemsCount ?? 0) === 0}
          title="View critical items"
        >
          <p className="text-2xl font-bold text-status-red tabular-nums flex items-baseline gap-1">
            {summary?.criticalItemsCount ?? 0}
            {(summary?.criticalItemsCount ?? 0) > 0 && <span className="text-[11px] text-primary/50">↗</span>}
          </p>
          <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">
            {severityLabel(summary?.criticalItemsCount ?? 0, "critical")}
          </p>
        </ClickableSignal>
        <p className="text-xs text-muted-foreground mt-1">open critical-priority items</p>
        {criticalActions.length > 0 && (
          <p className="text-xs text-status-red/80 mt-2 leading-snug">
            {criticalActions.length} action{criticalActions.length !== 1 ? "s" : ""} flagged critical
          </p>
        )}
      </RevealCard>

      <RevealCard label="Overdue Items" icon={Clock}>
        <ClickableSignal
          onClick={() => onDrill("overdue_items")}
          className="block px-1 py-0.5 rounded -mx-1"
          disabled={(summary?.overdueItemsCount ?? 0) === 0}
          title="View overdue items"
        >
          <p className="text-2xl font-bold text-status-yellow tabular-nums flex items-baseline gap-1">
            {summary?.overdueItemsCount ?? 0}
            {(summary?.overdueItemsCount ?? 0) > 0 && <span className="text-[11px] text-primary/50">↗</span>}
          </p>
          <p className="text-[10px] font-bold uppercase text-status-yellow/80 mt-0.5 tracking-wide">
            {severityLabel(summary?.overdueItemsCount ?? 0, "overdue")} backlog
          </p>
        </ClickableSignal>
        <p className="text-xs text-muted-foreground mt-1">items past their due date</p>
        {missingDocActions.length > 0 && (
          <p className="text-xs text-status-yellow/80 mt-2 leading-snug">
            {missingDocActions.length} critical item{missingDocActions.length !== 1 ? "s" : ""} missing documentation
          </p>
        )}
      </RevealCard>

      <RevealCard label="At-Risk Workflows" icon={AlertTriangle}>
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
          <p className="text-xs text-muted-foreground">No workflows at critical risk level.</p>
        )}
      </RevealCard>
    </div>
  );
}

// ── Execution Reveal ──────────────────────────────────────────────────────────

function ExecutionReveal({
  snap,
  trends,
  spotlight,
  summary,
  onDrill,
}: {
  snap: DashboardIntelligence["executiveSnapshot"] | undefined;
  trends: TrendSignal[];
  spotlight: WorkflowSpotlightEntry[];
  summary: any;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const completionTrend = trends.find((t) => t.label === "Completion Activity");
  const overdueTrend = trends.find((t) => t.label === "Overdue Items");
  const staleWorkflows = spotlight.filter((w) => w.openItems > 0 && w.criticalItems === 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <RevealCard label="Completion Rate" icon={Target}>
        <p className="text-2xl font-bold tabular-nums">{snap?.throughputPercent ?? 0}%</p>
        <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">
          {severityLabel(snap?.throughputPercent ?? 0, "throughput")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{snap?.throughputLabel ?? "workflows completed"}</p>
        {completionTrend && (
          <p className="text-xs text-muted-foreground mt-2 leading-snug">{completionTrend.explanation}</p>
        )}
      </RevealCard>

      <RevealCard label="Movement Consistency" icon={Activity}>
        {snap?.longestAgingItem ? (
          <>
            <p className="text-xs text-muted-foreground mb-1">Longest stuck item:</p>
            <p className="text-sm font-semibold leading-snug text-foreground/80">{snap.longestAgingItem.title}</p>
            <div className="flex gap-2 mt-1.5 text-xs">
              <span className="text-status-red font-medium">{snap.longestAgingItem.daysInStage}d</span>
              <span className="text-muted-foreground">{snap.longestAgingItem.workflowTitle}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No severely stale items detected.</p>
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
              title="View stale workflow items"
            >
              <p className="text-2xl font-bold tabular-nums text-amber-400 flex items-baseline gap-1">
                {staleWorkflows.length}
                <span className="text-[11px] text-primary/50">↗</span>
              </p>
              <p className="text-[10px] font-bold uppercase text-amber-400/80 mt-0.5 tracking-wide">stale workflows</p>
            </ClickableSignal>
            <p className="text-xs text-muted-foreground mt-1">
              with open items, no critical escalation
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No responsiveness gaps detected.</p>
        )}
      </RevealCard>
    </div>
  );
}

// ── Improvement Reveal ────────────────────────────────────────────────────────

function ImprovementReveal({
  snap,
  trends,
  summary,
  onDrill,
}: {
  snap: DashboardIntelligence["executiveSnapshot"] | undefined;
  trends: TrendSignal[];
  summary: any;
  onDrill: (signal: SignalType, opts?: { workflowId?: number; stageId?: number }) => void;
}) {
  const completionTrend = trends.find((t) => t.label === "Completion Activity");
  const agingTrend = trends.find((t) => t.label === "Aging Items");

  return (
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
            <p className="text-xs text-muted-foreground mb-1">Oldest unresolved item:</p>
            <p className="text-sm font-semibold">{snap.longestAgingItem.title}</p>
            <p className="text-xs text-status-red mt-1">{snap.longestAgingItem.daysInStage}d in stage</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No recovery signal available.</p>
        )}
      </RevealCard>
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

function TrendSignalStrip({
  trends,
  isLoading,
}: {
  trends: TrendSignal[];
  isLoading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {isLoading
        ? Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))
        : trends.map((t, i) => (
            <motion.div
              key={t.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="bg-card border-border/50 hover:border-primary/30 transition-colors">
                <CardContent className="p-4 flex items-start gap-3">
                  <div
                    className={`mt-0.5 rounded-full p-1.5 ${
                      t.direction === "up"
                        ? "bg-green-500/15 text-green-400"
                        : t.direction === "down"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t.direction === "up" ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : t.direction === "down" ? (
                      <TrendingDown className="h-3 w-3" />
                    ) : (
                      <Minus className="h-3 w-3" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {t.label}
                    </p>
                    <p className="text-sm font-semibold mt-0.5 truncate">{t.value}</p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-tight line-clamp-2">
                      {t.explanation}
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

function BottleneckPanel({
  bottleneck,
  isLoading,
}: {
  bottleneck: DashboardIntelligence["primaryBottleneck"];
  isLoading: boolean;
}) {
  const { data: bnDocs = [] } = useListDocuments(
    { workflowId: bottleneck?.workflowId } as any,
    { query: { enabled: !!bottleneck?.workflowId, queryKey: ["docs", "bn", bottleneck?.workflowId] } }
  );
  const bnDocCount = (bnDocs as any[]).length;

  return (
    <Card className="bg-card border-border/50 shadow-md flex flex-col h-full">
      <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Primary Bottleneck
          </CardTitle>
          <CardDescription>Most constraining workflow stage</CardDescription>
        </div>
        {bottleneck && (
          <StoplightBadge
            status={bottleneck.stoplight as any}
            label={bottleneck.stoplight.toUpperCase()}
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
        ) : !bottleneck ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-8">
            <Activity className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-sm">No critical bottlenecks detected.</p>
            <p className="text-xs mt-1 opacity-60">Work is flowing through stages.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <Link
                  href={`/workflows/${bottleneck.workflowId}`}
                  className="font-semibold text-base hover:text-primary hover:underline"
                >
                  {bottleneck.workflowTitle}
                </Link>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">Stage:</span>
                  <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                    {bottleneck.stageName}
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <span className="text-2xl font-bold">{bottleneck.itemCount}</span>
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider mt-0.5">
                  Items
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <span
                  className={`text-2xl font-bold ${bottleneck.maxAgeDays > 14 ? "text-red-400" : "text-amber-400"}`}
                >
                  {bottleneck.maxAgeDays}d
                </span>
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider mt-0.5">
                  Max Age
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <span className="text-2xl font-bold">{bottleneck.avgAgeDays}d</span>
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider mt-0.5">
                  Avg Age
                </p>
              </div>
            </div>

            {/* Impact summary */}
            <div className="bg-background rounded-lg border border-border/50 p-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">Impact: </span>
                {bottleneck.impactSummary}
              </p>
              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/30">
                <span
                  className={`text-[10px] font-medium ${bnDocCount > 0 ? "text-muted-foreground" : "text-amber-400/80"}`}
                >
                  {bnDocCount > 0
                    ? EVIDENCE.DOCS_SUPPORTED(bnDocCount)
                    : EVIDENCE.NO_DOCS_RISK}
                </span>
              </div>
            </div>

            {/* Recommendation */}
            <div
              className={`rounded-lg border p-3 ${
                bottleneck.hasCritical
                  ? "border-red-500/40 bg-red-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
              }`}
            >
              <p className="text-[11px] leading-relaxed">
                <span
                  className={`font-semibold ${bottleneck.hasCritical ? "text-red-400" : "text-amber-400"}`}
                >
                  Recommendation:{" "}
                </span>
                {bottleneck.recommendation}
              </p>
            </div>

            <Link href={`/workflows/${bottleneck.workflowId}`}>
              <div className="flex items-center justify-end gap-1.5 text-xs text-primary hover:underline cursor-pointer mt-auto">
                View workflow
                <ArrowRight className="h-3 w-3" />
              </div>
            </Link>
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
        <CardDescription>Open items per stage · top stages shown</CardDescription>
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

function WorkflowSpotlight({
  entries,
  isLoading,
}: {
  entries: WorkflowSpotlightEntry[];
  isLoading: boolean;
}) {
  return (
    <Card className="bg-card border-border/50 shadow-sm h-full">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base">Workflow Spotlight</CardTitle>
        <CardDescription>Active workflows ranked by concern</CardDescription>
      </CardHeader>
      <CardContent className="p-0 overflow-auto max-h-[330px]">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No active workflows
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {entries.map((entry, i) => (
              <motion.div
                key={entry.workflowId}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className={`flex items-center gap-4 px-4 py-3 hover:bg-secondary/50 transition-colors border-l-2 ${concernBorder(entry.concernLevel)}`}
              >
                {/* Score ring */}
                <div className="relative flex items-center justify-center shrink-0">
                  <svg className="w-10 h-10 -rotate-90">
                    <circle cx="20" cy="20" r="16" stroke="hsl(var(--secondary))" strokeWidth="3" fill="none" />
                    <circle
                      cx="20" cy="20" r="16"
                      stroke={getStoplightColor(entry.stoplight)}
                      strokeWidth="3" fill="none"
                      strokeDasharray={2 * Math.PI * 16}
                      strokeDashoffset={2 * Math.PI * 16 * (1 - entry.healthScore / 100)}
                    />
                  </svg>
                  <span className="absolute text-[10px] font-bold">{entry.healthScore}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <Link
                    href={`/workflows/${entry.workflowId}`}
                    className="font-semibold text-sm hover:text-primary hover:underline truncate block"
                  >
                    {entry.title}
                  </Link>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {entry.concernReason}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                  {entry.criticalItems > 0 && (
                    <span className="flex items-center gap-0.5 text-red-400 font-semibold">
                      <AlertTriangle className="h-3 w-3" />
                      {entry.criticalItems}
                    </span>
                  )}
                  {entry.overdueItems > 0 && (
                    <span className="flex items-center gap-0.5 text-amber-400 font-semibold">
                      <Clock className="h-3 w-3" />
                      {entry.overdueItems}
                    </span>
                  )}
                  <span className="text-muted-foreground">{entry.openItems} open</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
