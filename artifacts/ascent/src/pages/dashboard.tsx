import {
  useGetDashboardIntelligence,
  useGetDashboardSummary,
  useListDocuments,
  type DashboardIntelligence,
  type IntelligenceAction,
  type WorkflowSpotlightEntry,
  type TrendSignal,
} from "@workspace/api-client-react";
import { useDocCounts } from "@/hooks/use-doc-counts";
import { AttachmentBadge } from "@/components/attachment-badge";
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
  Paperclip,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
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

export default function Dashboard() {
  const { data: intel, isLoading } = useGetDashboardIntelligence();
  const { data: summary } = useGetDashboardSummary();

  const snap = intel?.executiveSnapshot;

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
              />
              <StatPill
                value={snap?.activeWorkflowsCount ?? 0}
                label="Active"
                color="text-blue-400"
                isLoading={isLoading}
              />
              <StatPill
                value={snap?.overdueItemsCount ?? 0}
                label="Overdue"
                color="text-amber-400"
                isLoading={isLoading}
              />
            </div>

            {snap?.insight && (
              <p className="text-[11px] text-muted-foreground mt-4 text-center leading-relaxed line-clamp-3">
                {snap.insight}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 4 Dimension Score Cards */}
        <div className="col-span-1 md:col-span-8 grid grid-cols-2 gap-4">
          <ScoreCard
            title="Flow"
            score={summary?.flowScore}
            stoplight={summary?.flowStoplight}
            insight={summary?.flowInsight}
            icon={Workflow}
            isLoading={isLoading}
            colorClass="text-blue-400"
          />
          <ScoreCard
            title="Risk"
            score={summary?.riskScore}
            stoplight={summary?.riskStoplight}
            insight={summary?.riskInsight}
            icon={AlertTriangle}
            isLoading={isLoading}
            colorClass="text-red-400"
          />
          <ScoreCard
            title="Execution"
            score={summary?.executionScore}
            stoplight={summary?.executionStoplight}
            insight={summary?.executionInsight}
            icon={Target}
            isLoading={isLoading}
            colorClass="text-green-400"
          />
          <ScoreCard
            title="Improvement"
            score={summary?.improvementScore}
            stoplight={summary?.improvementStoplight}
            insight={summary?.improvementInsight}
            icon={Activity}
            isLoading={isLoading}
            colorClass="text-purple-400"
          />
        </div>
      </div>

      {/* ─── Row 2: Trend Signals ─── */}
      <TrendSignalStrip trends={intel?.trends ?? []} isLoading={isLoading} />

      {/* ─── Row 3: Actions + Bottleneck Story ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionPanel actions={intel?.actions ?? []} isLoading={isLoading} />
        <BottleneckPanel bottleneck={intel?.primaryBottleneck ?? null} isLoading={isLoading} />
      </div>

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
}: {
  value: number;
  label: string;
  color: string;
  isLoading: boolean;
}) {
  return (
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
}

function ScoreCard({
  title,
  score,
  stoplight,
  insight,
  icon: Icon,
  isLoading,
  colorClass,
}: any) {
  return (
    <Card className="bg-card border-border/50 shadow-sm relative overflow-hidden group hover:border-primary/50 transition-colors">
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
          <StoplightIndicator status={stoplight} size="sm" />
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
          </>
        )}
      </CardContent>
    </Card>
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
            <p className="text-[11px] text-amber-400 mt-1 flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {criticalMissingDocCount} critical item{criticalMissingDocCount > 1 ? "s" : ""} missing documentation
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
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/30">
                <Paperclip className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                <span className={`text-[10px] ${bnDocCount > 0 ? "text-muted-foreground" : "text-amber-500/80"}`}>
                  {bnDocCount > 0
                    ? `${bnDocCount} document${bnDocCount > 1 ? "s" : ""} attached to this workflow`
                    : "No documentation linked to this workflow"}
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
