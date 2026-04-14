import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetOperationalReport,
  useGetWorkflowReport,
  useGetDocumentReport,
  useGetAssignmentReport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  Link2,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportInsight {
  id: string;
  category: string;
  severity: "critical" | "warning" | "info";
  text: string;
  supportingCount?: number;
  drillSignal?: string;
}

interface ReportOutput {
  reportId: string;
  reportType: string;
  scope: string;
  dateRange: { days: number; from: string; to: string; label: string };
  generatedAt: string;
  summaryMetrics: Record<string, number | string | null>;
  insights: ReportInsight[];
  supportingRecordsCount: number;
  hasHistoricalData: boolean;
  dataNote: string | null;
  sections: Array<{ title: string; type: string; data: Record<string, unknown>; emptyMessage?: string }>;
}

// ─── Report Tab Config ────────────────────────────────────────────────────────

type ReportTab = "operational" | "workflow" | "evidence" | "assignment";

const TABS: { key: ReportTab; label: string; icon: React.ReactNode; description: string }[] = [
  {
    key: "operational",
    label: "Operational",
    icon: <Activity className="w-4 h-4" />,
    description: "Portfolio health, bottlenecks & risk signals",
  },
  {
    key: "workflow",
    label: "Workflow",
    icon: <Wrench className="w-4 h-4" />,
    description: "Workflow performance & completion tracking",
  },
  {
    key: "evidence",
    label: "Evidence",
    icon: <FileText className="w-4 h-4" />,
    description: "Document coverage & documentation gaps",
  },
  {
    key: "assignment",
    label: "Assignment",
    icon: <Link2 className="w-4 h-4" />,
    description: "Data quality & import matching coverage",
  },
];

// ─── Insight Severity Helpers ─────────────────────────────────────────────────

function severityBadge(severity: "critical" | "warning" | "info") {
  if (severity === "critical")
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] font-semibold uppercase tracking-wide px-1.5">
        Critical
      </Badge>
    );
  if (severity === "warning")
    return (
      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] font-semibold uppercase tracking-wide px-1.5">
        Warning
      </Badge>
    );
  return (
    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] font-semibold uppercase tracking-wide px-1.5">
      Info
    </Badge>
  );
}

function severityIcon(severity: "critical" | "warning" | "info") {
  if (severity === "critical") return <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />;
  if (severity === "warning") return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />;
  return <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />;
}

function categoryIcon(category: string) {
  const map: Record<string, React.ReactNode> = {
    bottleneck: <TrendingDown className="w-3.5 h-3.5" />,
    risk: <ShieldAlert className="w-3.5 h-3.5" />,
    health: <Activity className="w-3.5 h-3.5" />,
    timing: <Clock className="w-3.5 h-3.5" />,
    turns: <Zap className="w-3.5 h-3.5" />,
    work_orders: <Wrench className="w-3.5 h-3.5" />,
    evidence: <FileText className="w-3.5 h-3.5" />,
    assignment: <Link2 className="w-3.5 h-3.5" />,
  };
  return map[category] ?? <Info className="w-3.5 h-3.5" />;
}

// ─── Shared Insight List ──────────────────────────────────────────────────────

function InsightList({ insights, navigate }: { insights: ReportInsight[]; navigate: (path: string) => void }) {
  if (!insights || insights.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No insights to report for this timeframe.
      </div>
    );
  }

  const sorted = [...insights].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="space-y-2">
      {sorted.map((insight, i) => (
        <motion.div
          key={insight.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          className={`flex items-start gap-3 p-3 rounded-lg border ${
            insight.severity === "critical"
              ? "border-red-500/25 bg-red-500/5"
              : insight.severity === "warning"
              ? "border-amber-500/20 bg-amber-500/5"
              : "border-border/50 bg-secondary/20"
          }`}
        >
          {severityIcon(insight.severity)}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                {categoryIcon(insight.category)}
                {insight.category.replace(/_/g, " ")}
              </span>
              {severityBadge(insight.severity)}
              {insight.supportingCount !== undefined && (
                <span className="text-[10px] text-muted-foreground">
                  {insight.supportingCount.toLocaleString()} records
                </span>
              )}
            </div>
            <p className="text-sm text-foreground leading-snug">{insight.text}</p>
          </div>
          {insight.drillSignal && (
            <button
              onClick={() => navigate("/")}
              className="shrink-0 mt-0.5 text-primary hover:text-primary/80 transition-colors"
              title="View in Control Tower"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// ─── Metric Grid ──────────────────────────────────────────────────────────────

function MetricGrid({
  metrics,
}: {
  metrics: Array<{ label: string; value: string | number | null; accent?: string; note?: string }>;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className="bg-secondary/30 rounded-lg p-3 border border-border/40">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{m.label}</div>
          <div className={`text-xl font-bold tabular-nums ${m.accent ?? "text-foreground"}`}>
            {m.value ?? "—"}
          </div>
          {m.note && <div className="text-[10px] text-muted-foreground mt-0.5">{m.note}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton Loader ──────────────────────────────────────────────────────────

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-4 w-40" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ─── Data Note Banner ─────────────────────────────────────────────────────────

function DataNoteBanner({ note }: { note: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-sm text-muted-foreground">
      <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
      <span>{note}</span>
    </div>
  );
}

// ─── Stoplight Chip ───────────────────────────────────────────────────────────

function StoplightChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    red: "bg-red-500/20 text-red-400 border-red-500/30",
    yellow: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    green: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${map[status] ?? map.yellow}`}>
      {status}
    </span>
  );
}

// ─── Report Panels ─────────────────────────────────────────────────────────────

function OperationalReportPanel({ report }: { report: ReportOutput }) {
  const [, navigate] = useLocation();
  const m = report.summaryMetrics;
  const healthSection = report.sections.find((s) => s.title === "Operational Health")?.data;
  const bottleneckSection = report.sections.find((s) => s.title === "Bottleneck Analysis")?.data;
  const timingSection = report.sections.find((s) => s.title === "Timing Analysis")?.data;

  return (
    <div className="space-y-6">
      <MetricGrid
        metrics={[
          {
            label: "OHS Score",
            value: `${m.operationalHealthScore}/100`,
            accent:
              (m.operationalHealthScore as number) < 40
                ? "text-red-400"
                : (m.operationalHealthScore as number) < 65
                ? "text-amber-400"
                : "text-green-400",
          },
          { label: "Active Workflows", value: m.activeWorkflows },
          { label: "Open Items", value: m.openItems as number, accent: "text-amber-400" },
          { label: "Critical Items", value: m.criticalItems as number, accent: "text-red-400" },
          { label: "Active Turns", value: m.activeTurns },
          { label: "Blocked Turns", value: m.blockedTurns as number, accent: (m.blockedTurns as number) > 0 ? "text-red-400" : undefined },
          { label: "Work Orders", value: m.totalWorkOrders },
          { label: "SLA Breaches", value: m.slaMissedCount as number, accent: (m.slaMissedCount as number) > 0 ? "text-red-400" : undefined },
        ]}
      />

      {healthSection && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Health Breakdown</h3>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {(["flow", "risk", "execution", "improvement"] as const).map((dim) => {
              const scoreKey = `${dim}Score` as keyof typeof healthSection;
              const score = healthSection[scoreKey] as number;
              return (
                <div key={dim} className="bg-secondary/20 border border-border/40 rounded-lg p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{dim}</div>
                  <div
                    className={`text-lg font-bold tabular-nums ${
                      score < 40 ? "text-red-400" : score < 65 ? "text-amber-400" : "text-green-400"
                    }`}
                  >
                    {Math.round(score)}/100
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bottleneckSection && (bottleneckSection.hasData as boolean) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Bottleneck Analysis</h3>
          <div className="p-4 rounded-lg bg-secondary/30 border border-border/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Primary Bottleneck:{" "}
                <span className="text-amber-400">{bottleneckSection.primaryStage as string ?? "—"}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {bottleneckSection.itemsStuck as number} items stuck ≥7 days
              </span>
            </div>
            {(bottleneckSection.stageConcentration as Array<{ stage: string; count: number; avgDays: number }>)
              .slice(0, 3)
              .map((row) => (
                <div key={row.stage} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-24 shrink-0 font-medium text-foreground">{row.stage}</div>
                  <div className="flex-1 h-1.5 bg-secondary rounded-full">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{
                        width: `${Math.min(
                          ((row.count /
                            Math.max(
                              ...((bottleneckSection.stageConcentration as Array<{ count: number }>).map(
                                (r) => r.count
                              ))
                            )) *
                            100),
                          100
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="w-10 text-right">{row.count}</span>
                  <span className="w-16 text-right">{row.avgDays}d avg</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {timingSection && (timingSection.hasData as boolean) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Timing Exposure</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-secondary/20 border border-border/40 text-center">
              <div className="text-xs text-muted-foreground mb-1">Avg Open Days</div>
              <div className="text-lg font-bold text-amber-400">{timingSection.avgOpenDaysAll as number}d</div>
            </div>
            <div className="p-3 rounded-lg bg-secondary/20 border border-border/40 text-center">
              <div className="text-xs text-muted-foreground mb-1">Over 14 Days</div>
              <div className="text-lg font-bold text-red-400">{timingSection.itemsOver14Days as number}</div>
            </div>
            <div className="p-3 rounded-lg bg-secondary/20 border border-border/40 text-center">
              <div className="text-xs text-muted-foreground mb-1">Completed Recently</div>
              <div className="text-lg font-bold text-green-400">{timingSection.recentlyCompleted as number}</div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Operational Insights</h3>
        <InsightList insights={report.insights} navigate={navigate} />
      </div>
    </div>
  );
}

function WorkflowReportPanel({ report }: { report: ReportOutput }) {
  const [, navigate] = useLocation();
  const m = report.summaryMetrics;
  const rows = (report.sections.find((s) => s.title === "Workflow Performance")?.data?.rows as Array<{
    workflowId: number;
    title: string;
    status: string;
    healthScore: number;
    stoplight: string;
    completionRate: number;
    openItems: number;
    criticalItems: number;
    avgAgeDays: number;
    bottleneckStage: string | null;
  }>) ?? [];

  return (
    <div className="space-y-6">
      <MetricGrid
        metrics={[
          { label: "Total Workflows", value: m.totalWorkflows },
          { label: "Active", value: m.activeWorkflows },
          { label: "Completed", value: m.completedWorkflows, accent: "text-green-400" },
          { label: "Avg Health", value: `${m.avgHealthScore}/100` },
          { label: "Red Status", value: m.redWorkflows as number, accent: (m.redWorkflows as number) > 0 ? "text-red-400" : undefined },
          { label: "Yellow Status", value: m.yellowWorkflows as number, accent: (m.yellowWorkflows as number) > 0 ? "text-amber-400" : undefined },
          { label: "Green Status", value: m.greenWorkflows as number, accent: (m.greenWorkflows as number) > 0 ? "text-green-400" : undefined },
        ]}
      />

      {rows.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Performance Board{" "}
            <span className="text-muted-foreground/60 font-normal normal-case">— worst first</span>
          </h3>
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-0 text-[10px] text-muted-foreground uppercase tracking-wider bg-secondary/30 px-4 py-2">
              <span>Workflow</span>
              <span className="w-16 text-center">Status</span>
              <span className="w-20 text-right">Health</span>
              <span className="w-20 text-right">Complete</span>
              <span className="w-20 text-right">Open</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.workflowId}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-0 items-center px-4 py-3 border-t border-border/30 hover:bg-secondary/20 transition-colors cursor-pointer"
                onClick={() => navigate(`/workflows/${row.workflowId}`)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{row.title}</div>
                  {row.bottleneckStage && (
                    <div className="text-[10px] text-amber-400">Bottleneck: {row.bottleneckStage}</div>
                  )}
                </div>
                <div className="w-16 flex justify-center">
                  <StoplightChip status={row.stoplight} />
                </div>
                <div
                  className={`w-20 text-right font-bold text-sm tabular-nums ${
                    row.healthScore < 40
                      ? "text-red-400"
                      : row.healthScore < 65
                      ? "text-amber-400"
                      : "text-green-400"
                  }`}
                >
                  {row.healthScore}/100
                </div>
                <div className="w-20 text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <div className="w-10 h-1.5 bg-muted rounded-full">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${row.completionRate}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{row.completionRate}%</span>
                  </div>
                </div>
                <div className="w-20 text-right">
                  <span className={row.openItems > 0 ? "text-amber-400 text-sm font-semibold" : "text-muted-foreground text-sm"}>
                    {row.openItems}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-8 text-center text-muted-foreground text-sm">
          No active workflows to report on yet.
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Workflow Insights</h3>
        <InsightList insights={report.insights} navigate={navigate} />
      </div>
    </div>
  );
}

function EvidenceReportPanel({ report }: { report: ReportOutput }) {
  const [, navigate] = useLocation();
  const m = report.summaryMetrics;
  const coverageSection = report.sections.find((s) => s.title === "Document Coverage")?.data;
  const byType = (coverageSection?.byType as Record<string, number>) ?? {};
  const typeEntries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const totalDocs = m.totalDocuments as number;

  return (
    <div className="space-y-6">
      <MetricGrid
        metrics={[
          { label: "Total Documents", value: totalDocs },
          { label: "Workflow-Linked", value: m.workflowLinkedDocs },
          { label: "Item-Linked", value: m.itemLinkedDocs },
          { label: "Recent Uploads", value: m.recentDocCount, note: `in ${report.dateRange.label.toLowerCase()}` },
          { label: "Workflows Covered", value: m.workflowsWithDocs },
          {
            label: "Critical Gaps",
            value: m.criticalItemsWithoutDocs as number,
            accent: (m.criticalItemsWithoutDocs as number) > 0 ? "text-red-400" : "text-green-400",
            note: "critical items no docs",
          },
        ]}
      />

      {typeEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Document Types</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {typeEntries.map(([type, count]) => (
              <div
                key={type}
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/20 border border-border/40"
              >
                <span className="text-sm capitalize">{type.replace(/_/g, " ")}</span>
                <span className="text-sm font-bold tabular-nums text-primary">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalDocs === 0 && (
        <div className="py-8 text-center text-muted-foreground text-sm space-y-2">
          <FileText className="w-8 h-8 mx-auto opacity-30" />
          <p>No documents uploaded yet.</p>
          <p className="text-xs">Evidence coverage will build as records are documented.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/documents")}>
            Go to Documents
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Evidence Insights</h3>
        <InsightList insights={report.insights} navigate={navigate} />
      </div>
    </div>
  );
}

function AssignmentReportPanel({ report }: { report: ReportOutput }) {
  const [, navigate] = useLocation();
  const m = report.summaryMetrics;
  const coverageSection = report.sections.find((s) => s.title === "Assignment Coverage")?.data;
  const bySource = (coverageSection?.bySourceType as Record<string, number>) ?? {};
  const confidence = (coverageSection?.confidence as { high: number; medium: number; low: number }) ?? { high: 0, medium: 0, low: 0 };
  const sourceEntries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <MetricGrid
        metrics={[
          { label: "Total Records", value: m.totalAssignments },
          {
            label: "Coverage",
            value: `${m.coveragePercent}%`,
            accent:
              (m.coveragePercent as number) >= 80
                ? "text-green-400"
                : (m.coveragePercent as number) >= 50
                ? "text-amber-400"
                : "text-red-400",
          },
          { label: "Assigned", value: m.assignedCount, accent: "text-green-400" },
          { label: "Pending Review", value: m.pendingCount as number, accent: (m.pendingCount as number) > 0 ? "text-amber-400" : undefined },
          { label: "Auto-Matched", value: m.autoMatchedCount },
          { label: "High Confidence", value: m.highConfidenceCount, accent: "text-green-400" },
          { label: "Medium Confidence", value: m.mediumConfidenceCount },
          { label: "Low Confidence", value: m.lowConfidenceCount as number, accent: (m.lowConfidenceCount as number) > 0 ? "text-amber-400" : undefined },
        ]}
      />

      {(m.totalAssignments as number) > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Confidence Distribution</h3>
          <div className="p-4 rounded-lg bg-secondary/30 border border-border/50 space-y-3">
            {(
              [
                { label: "High", count: confidence.high, color: "bg-green-500" },
                { label: "Medium", count: confidence.medium, color: "bg-amber-500" },
                { label: "Low", count: confidence.low, color: "bg-red-500" },
              ] as const
            ).map((row) => {
              const pct =
                (m.totalAssignments as number) > 0
                  ? Math.round((row.count / (m.totalAssignments as number)) * 100)
                  : 0;
              return (
                <div key={row.label} className="flex items-center gap-3 text-sm">
                  <div className="w-14 text-muted-foreground">{row.label}</div>
                  <div className="flex-1 h-2 bg-secondary rounded-full">
                    <div className={`h-full ${row.color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-8 text-right tabular-nums font-semibold">{row.count}</div>
                  <div className="w-10 text-right text-muted-foreground text-xs">{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sourceEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">By Source Type</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {sourceEntries.map(([type, count]) => (
              <div
                key={type}
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/20 border border-border/40"
              >
                <span className="text-sm capitalize">{type.replace(/_/g, " ")}</span>
                <span className="text-sm font-bold tabular-nums text-primary">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(m.totalAssignments as number) === 0 && (
        <div className="py-8 text-center text-muted-foreground text-sm space-y-2">
          <Link2 className="w-8 h-8 mx-auto opacity-30" />
          <p>No imported records in the assignment queue yet.</p>
          <p className="text-xs">Coverage will build as records are imported and matched.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/assignments-review")}>
            Go to Assignments
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Assignment Insights</h3>
        <InsightList insights={report.insights} navigate={navigate} />
      </div>
    </div>
  );
}

// ─── Main Analytics Page ──────────────────────────────────────────────────────

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<ReportTab>("operational");
  const [days, setDays] = useState("30");
  const daysNum = Number(days);

  const { data: opReport, isLoading: opLoading } = useGetOperationalReport({ days: daysNum });
  const { data: wfReport, isLoading: wfLoading } = useGetWorkflowReport({ days: daysNum });
  const { data: docReport, isLoading: docLoading } = useGetDocumentReport({ days: daysNum });
  const { data: assignReport, isLoading: assignLoading } = useGetAssignmentReport({ days: daysNum });

  const reportMap = {
    operational: { data: opReport, isLoading: opLoading },
    workflow: { data: wfReport, isLoading: wfLoading },
    evidence: { data: docReport, isLoading: docLoading },
    assignment: { data: assignReport, isLoading: assignLoading },
  };

  const active = reportMap[activeTab];
  const report = active.data as ReportOutput | undefined;
  const isLoading = active.isLoading;

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full pb-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics & Reports</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Live operational reporting · grounded in real system data
          </p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[150px] bg-card border-border">
            <SelectValue placeholder="Timeframe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 Days</SelectItem>
            <SelectItem value="30">Last 30 Days</SelectItem>
            <SelectItem value="90">Last 90 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tab Strip */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-secondary/30"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Report Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab + days}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <Card className="bg-card border-border shadow-md">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {TABS.find((t) => t.key === activeTab)?.icon}
                    <CardTitle>
                      {
                        {
                          operational: "Operational Health Report",
                          workflow: "Workflow Performance Summary",
                          evidence: "Evidence & Documentation Report",
                          assignment: "Assignment & Data Quality Report",
                        }[activeTab]
                      }
                    </CardTitle>
                  </div>
                  <CardDescription>
                    {TABS.find((t) => t.key === activeTab)?.description}
                    {report && !isLoading && (
                      <span className="ml-2 text-muted-foreground/60">
                        · {report.dateRange.label} ·{" "}
                        {report.supportingRecordsCount.toLocaleString()} supporting records
                      </span>
                    )}
                  </CardDescription>
                </div>
                {report && !isLoading && (
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Generated</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(report.generatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
                <ReportSkeleton />
              ) : !report ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p>Unable to load report. Please try again.</p>
                </div>
              ) : (
                <>
                  {report.dataNote && <DataNoteBanner note={report.dataNote} />}
                  {activeTab === "operational" && <OperationalReportPanel report={report} />}
                  {activeTab === "workflow" && <WorkflowReportPanel report={report} />}
                  {activeTab === "evidence" && <EvidenceReportPanel report={report} />}
                  {activeTab === "assignment" && <AssignmentReportPanel report={report} />}
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </AnimatePresence>

      {/* Trend History Notice */}
      <Card className="bg-card border-border/40">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Historical Trend Data</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                Trend history accumulates as the system runs. Current reports reflect live operational
                snapshots. Score series and pattern data will strengthen over time.{" "}
                <span className="text-muted-foreground">
                  "Reporting will strengthen as more operational activity is recorded."
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
