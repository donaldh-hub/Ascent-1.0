/**
 * Build 7 — Master Spine: Reporting + Analytics Backbone
 *
 * Centralized reporting service that reads from existing shared engines.
 * Design principles:
 * - Real data only — no fabricated trends or placeholder metrics
 * - Reuse scoring, intelligence, and document engines — never duplicate logic
 * - Every insight must be grounded in a supporting count or condition
 * - Honest about data limits — "trend not yet available" beats fake lines
 */

import { db } from "@workspace/db";
import {
  documentsTable,
  assignmentsTable,
  alertsTable,
  workflowsTable,
  workflowItemsTable,
} from "@workspace/db/schema";
import { and, gte, lte, count, eq } from "drizzle-orm";
import { loadAllWorkflowInputs, loadAlerts } from "../engine/loader";
import { calcWorkflowHealth, calcOperationalHealth } from "../engine/scoring";
import { getWorkOrderStats } from "./work-order-service";
import { getTurnStats } from "./turn-matrix-service";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportFilter {
  days: number;
  propertyId?: number;
  workflowId?: number;
}

export type InsightSeverity = "critical" | "warning" | "info";
export type InsightCategory =
  | "bottleneck"
  | "risk"
  | "evidence"
  | "assignment"
  | "timing"
  | "health"
  | "turns"
  | "work_orders";

export interface ReportInsight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  text: string;
  supportingCount?: number;
  drillSignal?: string;
}

export interface ReportSection {
  title: string;
  type: "metrics" | "analysis" | "table" | "empty";
  data: Record<string, unknown>;
  emptyMessage?: string;
}

export interface ReportOutput {
  reportId: string;
  reportType: string;
  scope: string;
  dateRange: { days: number; from: string; to: string; label: string };
  filtersApplied: ReportFilter;
  generatedAt: string;
  summaryMetrics: Record<string, number | string | null>;
  insights: ReportInsight[];
  supportingRecordsCount: number;
  hasHistoricalData: boolean;
  dataNote: string | null;
  sections: ReportSection[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Date Range Helper
// ─────────────────────────────────────────────────────────────────────────────

function getDateRange(days: number): { from: Date; to: Date; label: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const label =
    days === 7 ? "Last 7 Days" : days === 30 ? "Last 30 Days" : days === 90 ? "Last 90 Days" : `Last ${days} Days`;
  return { from, to, label };
}

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis Blocks — Reusable building pieces for all reports
// ─────────────────────────────────────────────────────────────────────────────

export interface BottleneckAnalysis {
  primaryStage: string | null;
  primaryWorkflow: string | null;
  itemsStuck: number;
  longestAgingDays: number;
  topDelayedItem: string | null;
  stageConcentration: Array<{ stage: string; count: number; avgDays: number }>;
  hasData: boolean;
}

export async function buildBottleneckAnalysis(): Promise<BottleneckAnalysis> {
  const workflowInputs = await loadAllWorkflowInputs();
  const stageMap: Record<string, { count: number; totalDays: number; workflow: string }> = {};

  let longestAgingDays = 0;
  let topDelayedItem: string | null = null;
  let primaryStage: string | null = null;
  let primaryWorkflow: string | null = null;
  let itemsStuck = 0;

  for (const wf of workflowInputs) {
    if (wf.status === "completed") continue;
    for (const item of wf.items) {
      if (item.status === "completed") continue;
      const stage = wf.stages.find((s) => s.id === item.stageId);
      const stageName = stage?.name ?? "Unknown";
      const days = daysSince(item.stageEnteredAt);

      if (!stageMap[stageName]) stageMap[stageName] = { count: 0, totalDays: 0, workflow: wf.title };
      stageMap[stageName].count++;
      stageMap[stageName].totalDays += days;

      if (days >= 7) {
        itemsStuck++;
        if (days > longestAgingDays) {
          longestAgingDays = days;
          topDelayedItem = item.title;
          primaryStage = stageName;
          primaryWorkflow = wf.title;
        }
      }
    }
  }

  const concentration = Object.entries(stageMap)
    .map(([stage, { count, totalDays, workflow }]) => ({
      stage,
      count,
      avgDays: count > 0 ? Math.round((totalDays / count) * 10) / 10 : 0,
      workflow,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Primary bottleneck = stage with most items stuck
  if (concentration.length > 0 && !primaryStage) {
    primaryStage = concentration[0].stage;
    primaryWorkflow = concentration[0].workflow;
  }

  return {
    primaryStage,
    primaryWorkflow,
    itemsStuck,
    longestAgingDays: Math.round(longestAgingDays),
    topDelayedItem,
    stageConcentration: concentration,
    hasData: concentration.length > 0,
  };
}

export interface TimingAnalysis {
  avgOpenDaysAll: number;
  longestOpenDays: number;
  longestOpenItem: string | null;
  itemsOver7Days: number;
  itemsOver14Days: number;
  itemsOver30Days: number;
  recentlyCompleted: number;
  hasData: boolean;
}

export async function buildTimingAnalysis(filter: ReportFilter): Promise<TimingAnalysis> {
  const workflowInputs = await loadAllWorkflowInputs();
  const { from } = getDateRange(filter.days);

  const openItems = workflowInputs
    .filter((wf) => !filter.workflowId || wf.id === filter.workflowId)
    .flatMap((wf) => wf.items.filter((i) => i.status !== "completed"));

  const recentlyCompleted = workflowInputs
    .flatMap((wf) => wf.items.filter((i) => i.status === "completed" && i.updatedAt >= from))
    .length;

  if (openItems.length === 0) {
    return {
      avgOpenDaysAll: 0,
      longestOpenDays: 0,
      longestOpenItem: null,
      itemsOver7Days: 0,
      itemsOver14Days: 0,
      itemsOver30Days: 0,
      recentlyCompleted,
      hasData: false,
    };
  }

  let longestOpenDays = 0;
  let longestOpenItem: string | null = null;
  let totalDays = 0;
  let over7 = 0;
  let over14 = 0;
  let over30 = 0;

  for (const item of openItems) {
    const d = daysSince(item.stageEnteredAt);
    totalDays += d;
    if (d > longestOpenDays) {
      longestOpenDays = d;
      longestOpenItem = item.title;
    }
    if (d > 7) over7++;
    if (d > 14) over14++;
    if (d > 30) over30++;
  }

  return {
    avgOpenDaysAll: Math.round((totalDays / openItems.length) * 10) / 10,
    longestOpenDays: Math.round(longestOpenDays),
    longestOpenItem,
    itemsOver7Days: over7,
    itemsOver14Days: over14,
    itemsOver30Days: over30,
    recentlyCompleted,
    hasData: true,
  };
}

export interface RiskAnalysis {
  redWorkflowCount: number;
  yellowWorkflowCount: number;
  criticalItemCount: number;
  criticalAlertCount: number;
  overdueItemCount: number;
  agingExposureCount: number;
  topRiskWorkflow: string | null;
  hasData: boolean;
}

export async function buildRiskAnalysis(): Promise<RiskAnalysis> {
  const [workflowInputs, alerts] = await Promise.all([loadAllWorkflowInputs(), loadAlerts()]);

  let redWorkflowCount = 0;
  let yellowWorkflowCount = 0;
  let criticalItemCount = 0;
  let overdueItemCount = 0;
  let agingExposureCount = 0;
  let topRiskWorkflow: string | null = null;
  let lowestScore = Infinity;

  for (const wf of workflowInputs) {
    if (wf.status === "completed") continue;
    const health = calcWorkflowHealth(wf);
    if (health.stoplight === "red") {
      redWorkflowCount++;
      if (health.healthScore < lowestScore) {
        lowestScore = health.healthScore;
        topRiskWorkflow = wf.title;
      }
    }
    if (health.stoplight === "yellow") yellowWorkflowCount++;
    for (const item of wf.items) {
      if (item.status === "completed") continue;
      if (item.priority === "critical") criticalItemCount++;
      if (item.dueDate && new Date(item.dueDate).getTime() < Date.now()) overdueItemCount++;
      if (daysSince(item.stageEnteredAt) > 21) agingExposureCount++;
    }
  }

  const criticalAlertCount = alerts.filter((a) => a.severity === "critical").length;

  return {
    redWorkflowCount,
    yellowWorkflowCount,
    criticalItemCount,
    criticalAlertCount,
    overdueItemCount,
    agingExposureCount,
    topRiskWorkflow,
    hasData: workflowInputs.filter((w) => w.status !== "completed").length > 0,
  };
}

export interface EvidenceAnalysis {
  totalDocuments: number;
  workflowLinkedDocs: number;
  itemLinkedDocs: number;
  docsByType: Record<string, number>;
  workflowsWithDocs: number;
  criticalItemsWithoutDocs: number;
  recentDocCount: number;
  hasData: boolean;
}

export async function buildEvidenceAnalysis(filter: ReportFilter): Promise<EvidenceAnalysis> {
  const { from } = getDateRange(filter.days);
  const [allDocs, workflowInputs] = await Promise.all([
    db.select().from(documentsTable),
    loadAllWorkflowInputs(),
  ]);

  const recentDocs = allDocs.filter((d) => d.uploadedAt >= from);
  const workflowLinkedDocs = allDocs.filter((d) => d.linkedEntityType === "workflow").length;
  const itemLinkedDocs = allDocs.filter((d) => d.linkedEntityType === "workflow_item").length;

  const docsByType: Record<string, number> = {};
  for (const doc of allDocs) {
    docsByType[doc.documentType] = (docsByType[doc.documentType] ?? 0) + 1;
  }

  const workflowsWithDocs = new Set(
    allDocs
      .filter((d) => d.linkedEntityType === "workflow" && d.linkedWorkflowId)
      .map((d) => d.linkedWorkflowId)
  ).size;

  // Critical items without any linked documents
  const documentedItemIds = new Set(
    allDocs.filter((d) => d.linkedEntityType === "workflow_item").map((d) => d.linkedEntityId)
  );
  let criticalItemsWithoutDocs = 0;
  for (const wf of workflowInputs) {
    for (const item of wf.items) {
      if (item.status === "completed") continue;
      if (item.priority === "critical" && !documentedItemIds.has(item.id)) {
        criticalItemsWithoutDocs++;
      }
    }
  }

  return {
    totalDocuments: allDocs.length,
    workflowLinkedDocs,
    itemLinkedDocs,
    docsByType,
    workflowsWithDocs,
    criticalItemsWithoutDocs,
    recentDocCount: recentDocs.length,
    hasData: allDocs.length > 0,
  };
}

export interface AssignmentAnalysis {
  totalAssignments: number;
  assignedCount: number;
  pendingCount: number;
  rejectedCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  autoMatchedCount: number;
  manualReviewCount: number;
  coveragePercent: number;
  bySourceType: Record<string, number>;
  hasData: boolean;
}

export async function buildAssignmentAnalysis(): Promise<AssignmentAnalysis> {
  const assignments = await db.select().from(assignmentsTable);

  if (assignments.length === 0) {
    return {
      totalAssignments: 0,
      assignedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      highConfidenceCount: 0,
      mediumConfidenceCount: 0,
      lowConfidenceCount: 0,
      autoMatchedCount: 0,
      manualReviewCount: 0,
      coveragePercent: 0,
      bySourceType: {},
      hasData: false,
    };
  }

  const assignedCount = assignments.filter((a) => a.status === "assigned").length;
  const pendingCount = assignments.filter((a) => a.status === "pending").length;
  const rejectedCount = assignments.filter((a) => a.status === "rejected").length;
  const highConfidenceCount = assignments.filter((a) => a.confidenceLevel === "high").length;
  const mediumConfidenceCount = assignments.filter((a) => a.confidenceLevel === "medium").length;
  const lowConfidenceCount = assignments.filter((a) => a.confidenceLevel === "low").length;
  const autoMatchedCount = assignments.filter((a) => a.assignmentMethod === "auto").length;
  const manualReviewCount = assignments.filter((a) => a.status === "pending").length;

  const bySourceType: Record<string, number> = {};
  for (const a of assignments) {
    bySourceType[a.sourceType] = (bySourceType[a.sourceType] ?? 0) + 1;
  }

  const coveragePercent =
    assignments.length > 0 ? Math.round((assignedCount / assignments.length) * 100) : 0;

  return {
    totalAssignments: assignments.length,
    assignedCount,
    pendingCount,
    rejectedCount,
    highConfidenceCount,
    mediumConfidenceCount,
    lowConfidenceCount,
    autoMatchedCount,
    manualReviewCount,
    coveragePercent,
    bySourceType,
    hasData: assignments.length > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight Generator — plain language from real metrics, never invented
// ─────────────────────────────────────────────────────────────────────────────

function generateOperationalInsights(
  operationalScore: number,
  bottleneck: BottleneckAnalysis,
  risk: RiskAnalysis,
  timing: TimingAnalysis
): ReportInsight[] {
  const insights: ReportInsight[] = [];

  if (operationalScore < 40) {
    insights.push({
      id: "health_critical",
      category: "health",
      severity: "critical",
      text: `Operational health is critically low at ${operationalScore}/100. Immediate attention is required.`,
    });
  } else if (operationalScore < 65) {
    insights.push({
      id: "health_warning",
      category: "health",
      severity: "warning",
      text: `Operational health is below target at ${operationalScore}/100. Multiple areas require intervention.`,
    });
  } else {
    insights.push({
      id: "health_info",
      category: "health",
      severity: "info",
      text: `Operational health score is ${operationalScore}/100. Monitor for sustained improvement.`,
    });
  }

  if (bottleneck.primaryStage && bottleneck.itemsStuck > 0) {
    const sev: InsightSeverity = bottleneck.itemsStuck > 10 ? "critical" : bottleneck.itemsStuck > 4 ? "warning" : "info";
    insights.push({
      id: "bottleneck_primary",
      category: "bottleneck",
      severity: sev,
      text: `${bottleneck.primaryStage} is the primary bottleneck — ${bottleneck.itemsStuck} item${bottleneck.itemsStuck !== 1 ? "s" : ""} stuck beyond 7 days.`,
      supportingCount: bottleneck.itemsStuck,
      drillSignal: "blocked_turns",
    });
  }

  if (risk.redWorkflowCount > 0) {
    insights.push({
      id: "risk_red_workflows",
      category: "risk",
      severity: "critical",
      text: `${risk.redWorkflowCount} workflow${risk.redWorkflowCount !== 1 ? "s are" : " is"} in red — critical risk concentration requires escalation.`,
      supportingCount: risk.redWorkflowCount,
    });
  }

  if (risk.criticalItemCount > 0) {
    insights.push({
      id: "risk_critical_items",
      category: "risk",
      severity: risk.criticalItemCount > 5 ? "critical" : "warning",
      text: `${risk.criticalItemCount} critical-priority item${risk.criticalItemCount !== 1 ? "s" : ""} remain open and unresolved.`,
      supportingCount: risk.criticalItemCount,
      drillSignal: "critical_items",
    });
  }

  if (timing.itemsOver14Days > 0) {
    insights.push({
      id: "timing_aging",
      category: "timing",
      severity: timing.itemsOver14Days > 5 ? "warning" : "info",
      text: `${timing.itemsOver14Days} open item${timing.itemsOver14Days !== 1 ? "s" : ""} ha${timing.itemsOver14Days !== 1 ? "ve" : "s"} exceeded 14 days without resolution.`,
      supportingCount: timing.itemsOver14Days,
      drillSignal: "aging_work_orders",
    });
  }

  if (timing.recentlyCompleted > 0) {
    insights.push({
      id: "timing_velocity",
      category: "timing",
      severity: "info",
      text: `${timing.recentlyCompleted} item${timing.recentlyCompleted !== 1 ? "s" : ""} completed recently — positive execution signal.`,
      supportingCount: timing.recentlyCompleted,
    });
  }

  return insights;
}

function generateDocumentInsights(evidence: EvidenceAnalysis): ReportInsight[] {
  const insights: ReportInsight[] = [];

  if (!evidence.hasData) {
    insights.push({
      id: "evidence_empty",
      category: "evidence",
      severity: "info",
      text: "No documents uploaded yet. Evidence coverage will build as records are documented.",
    });
    return insights;
  }

  if (evidence.criticalItemsWithoutDocs > 0) {
    insights.push({
      id: "evidence_critical_gap",
      category: "evidence",
      severity: evidence.criticalItemsWithoutDocs > 3 ? "critical" : "warning",
      text: `${evidence.criticalItemsWithoutDocs} critical item${evidence.criticalItemsWithoutDocs !== 1 ? "s" : ""} lack${evidence.criticalItemsWithoutDocs === 1 ? "s" : ""} supporting documentation.`,
      supportingCount: evidence.criticalItemsWithoutDocs,
    });
  }

  if (evidence.workflowsWithDocs > 0) {
    insights.push({
      id: "evidence_coverage",
      category: "evidence",
      severity: "info",
      text: `${evidence.workflowsWithDocs} workflow${evidence.workflowsWithDocs !== 1 ? "s" : ""} ha${evidence.workflowsWithDocs !== 1 ? "ve" : "s"} documented evidence on file.`,
      supportingCount: evidence.workflowsWithDocs,
    });
  }

  if (evidence.recentDocCount > 0) {
    insights.push({
      id: "evidence_recent",
      category: "evidence",
      severity: "info",
      text: `${evidence.recentDocCount} document${evidence.recentDocCount !== 1 ? "s" : ""} uploaded in the selected timeframe.`,
      supportingCount: evidence.recentDocCount,
    });
  }

  return insights;
}

function generateAssignmentInsights(analysis: AssignmentAnalysis): ReportInsight[] {
  const insights: ReportInsight[] = [];

  if (!analysis.hasData) {
    insights.push({
      id: "assignment_empty",
      category: "assignment",
      severity: "info",
      text: "No imported records in the assignment queue yet. Coverage will build as records are imported.",
    });
    return insights;
  }

  if (analysis.coveragePercent >= 80) {
    insights.push({
      id: "assignment_strong",
      category: "assignment",
      severity: "info",
      text: `Assignment coverage is strong at ${analysis.coveragePercent}% — ${analysis.assignedCount} of ${analysis.totalAssignments} records matched.`,
      supportingCount: analysis.assignedCount,
    });
  } else if (analysis.coveragePercent >= 50) {
    insights.push({
      id: "assignment_moderate",
      category: "assignment",
      severity: "warning",
      text: `Assignment coverage is moderate at ${analysis.coveragePercent}%. ${analysis.pendingCount} record${analysis.pendingCount !== 1 ? "s" : ""} still need review.`,
      supportingCount: analysis.pendingCount,
    });
  } else {
    insights.push({
      id: "assignment_low",
      category: "assignment",
      severity: "critical",
      text: `Assignment coverage is low at ${analysis.coveragePercent}%. ${analysis.pendingCount} record${analysis.pendingCount !== 1 ? "s" : ""} are unresolved in the queue.`,
      supportingCount: analysis.pendingCount,
    });
  }

  if (analysis.lowConfidenceCount > 0) {
    insights.push({
      id: "assignment_confidence",
      category: "assignment",
      severity: "warning",
      text: `${analysis.lowConfidenceCount} record${analysis.lowConfidenceCount !== 1 ? "s" : ""} matched at low confidence — manual review recommended.`,
      supportingCount: analysis.lowConfidenceCount,
    });
  }

  return insights;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Builders
// ─────────────────────────────────────────────────────────────────────────────

export async function buildOperationalReport(filter: ReportFilter): Promise<ReportOutput> {
  const range = getDateRange(filter.days);
  const [workflowInputs, alerts, woStats, turnStats, bottleneck, risk, timing] = await Promise.all([
    loadAllWorkflowInputs(),
    loadAlerts(),
    getWorkOrderStats(),
    getTurnStats(),
    buildBottleneckAnalysis(),
    buildRiskAnalysis(),
    buildTimingAnalysis(filter),
  ]);

  const operational = calcOperationalHealth(workflowInputs, alerts);
  const activeWorkflows = workflowInputs.filter((w) => w.status === "active" || w.status === "paused");
  const completedWorkflows = workflowInputs.filter((w) => w.status === "completed");
  const allOpenItems = workflowInputs.flatMap((w) => w.items.filter((i) => i.status !== "completed"));
  const criticalItems = allOpenItems.filter(
    (i) => i.priority === "critical" || (i.dueDate && new Date(i.dueDate) < new Date())
  );

  const insights = generateOperationalInsights(
    operational.operationalHealthScore,
    bottleneck,
    risk,
    timing
  );

  // Turn-related insights
  if (turnStats.blockedTurns > 0) {
    insights.push({
      id: "turns_blocked",
      category: "turns",
      severity: turnStats.blockedTurns > 20 ? "critical" : "warning",
      text: `${turnStats.blockedTurns} turn${turnStats.blockedTurns !== 1 ? "s" : ""} blocked at ${turnStats.primaryBottleneckStage ?? "an unresolved stage"} — impacting unit availability.`,
      supportingCount: turnStats.blockedTurns,
      drillSignal: "blocked_turns",
    });
  }

  if (woStats.slaMissedCount > 0) {
    insights.push({
      id: "wo_sla",
      category: "work_orders",
      severity: woStats.slaMissedCount > 20 ? "critical" : "warning",
      text: `${woStats.slaMissedCount} work order${woStats.slaMissedCount !== 1 ? "s" : ""} past response SLA — escalation risk is elevated.`,
      supportingCount: woStats.slaMissedCount,
      drillSignal: "sla_violations",
    });
  }

  return {
    reportId: `operational_${Date.now()}`,
    reportType: "operational",
    scope: "organization",
    dateRange: {
      days: filter.days,
      from: isoDate(range.from),
      to: isoDate(range.to),
      label: range.label,
    },
    filtersApplied: filter,
    generatedAt: new Date().toISOString(),
    summaryMetrics: {
      operationalHealthScore: operational.operationalHealthScore,
      operationalStoplight: operational.stoplight,
      activeWorkflows: activeWorkflows.length,
      completedWorkflows: completedWorkflows.length,
      openItems: allOpenItems.length,
      criticalItems: criticalItems.length,
      criticalAlerts: alerts.filter((a) => a.severity === "critical").length,
      bottleneckStage: bottleneck.primaryStage,
      totalWorkOrders: woStats.total,
      openWorkOrders: woStats.open,
      slaMissedCount: woStats.slaMissedCount,
      totalTurns: turnStats.totalTurns,
      blockedTurns: turnStats.blockedTurns,
      activeTurns: turnStats.activeTurns,
    },
    insights,
    supportingRecordsCount: allOpenItems.length + alerts.length,
    hasHistoricalData: false,
    dataNote: "Report reflects live operational snapshot. Historical trend data accumulates over time.",
    sections: [
      {
        title: "Operational Health",
        type: "metrics",
        data: {
          score: operational.operationalHealthScore,
          stoplight: operational.stoplight,
          flowScore: operational.flowScore,
          riskScore: operational.riskScore,
          executionScore: operational.executionScore,
          improvementScore: operational.improvementScore,
          insight: operational.insight,
        },
      },
      {
        title: "Bottleneck Analysis",
        type: "analysis",
        data: bottleneck,
        emptyMessage: "No bottleneck data available — all items are progressing normally.",
      },
      {
        title: "Risk Concentration",
        type: "analysis",
        data: risk,
        emptyMessage: "No significant risk signals detected.",
      },
      {
        title: "Timing Analysis",
        type: "analysis",
        data: timing,
        emptyMessage: "No open items with extended aging.",
      },
    ],
  };
}

export async function buildWorkflowReport(filter: ReportFilter): Promise<ReportOutput> {
  const range = getDateRange(filter.days);
  const [workflowInputs, alerts] = await Promise.all([loadAllWorkflowInputs(), loadAlerts()]);

  const wfData = workflowInputs.map((wf) => {
    const health = calcWorkflowHealth(wf);
    const openItems = wf.items.filter((i) => i.status !== "completed");
    const completedItems = wf.items.filter((i) => i.status === "completed");
    const criticalItems = openItems.filter((i) => i.priority === "critical");
    const overdueItems = openItems.filter(
      (i) => i.dueDate && new Date(i.dueDate).getTime() < Date.now()
    );
    const bottleneckStage = wf.stages.find((s) => s.isBottleneck)?.name ?? null;
    const avgAgeDays =
      openItems.length > 0
        ? Math.round(
            (openItems.reduce((s, i) => s + daysSince(i.stageEnteredAt), 0) / openItems.length) * 10
          ) / 10
        : 0;
    const wfAlerts = alerts.filter((a) => a.workflowId === wf.id);

    return {
      workflowId: wf.id,
      title: wf.title,
      status: wf.status,
      healthScore: health.healthScore,
      stoplight: health.stoplight,
      flowScore: health.flow.score,
      riskScore: health.risk.score,
      executionScore: health.execution.score,
      openItems: openItems.length,
      completedItems: completedItems.length,
      criticalItems: criticalItems.length,
      overdueItems: overdueItems.length,
      completionRate:
        wf.items.length > 0
          ? Math.round((completedItems.length / wf.items.length) * 100)
          : 0,
      avgAgeDays,
      bottleneckStage,
      alertCount: wfAlerts.length,
    };
  });

  const activeWfs = wfData.filter((w) => w.status !== "completed");
  const redCount = activeWfs.filter((w) => w.stoplight === "red").length;
  const yellowCount = activeWfs.filter((w) => w.stoplight === "yellow").length;
  const avgHealth =
    activeWfs.length > 0
      ? Math.round(activeWfs.reduce((s, w) => s + w.healthScore, 0) / activeWfs.length)
      : 0;

  const insights: ReportInsight[] = [];

  if (redCount > 0) {
    insights.push({
      id: "wf_red",
      category: "risk",
      severity: "critical",
      text: `${redCount} workflow${redCount !== 1 ? "s" : ""} in red status. These represent the highest failure risk and need immediate action.`,
      supportingCount: redCount,
    });
  }

  const worstWf = activeWfs.sort((a, b) => a.healthScore - b.healthScore)[0];
  if (worstWf && worstWf.healthScore < 50) {
    insights.push({
      id: "wf_worst",
      category: "bottleneck",
      severity: "warning",
      text: `"${worstWf.title}" has the lowest health at ${worstWf.healthScore}/100 — completion rate is ${worstWf.completionRate}%.`,
    });
  }

  const bottleneckedWfs = activeWfs.filter((w) => w.bottleneckStage);
  if (bottleneckedWfs.length > 0) {
    insights.push({
      id: "wf_bottlenecks",
      category: "bottleneck",
      severity: bottleneckedWfs.length > 2 ? "warning" : "info",
      text: `${bottleneckedWfs.length} workflow${bottleneckedWfs.length !== 1 ? "s" : ""} ha${bottleneckedWfs.length !== 1 ? "ve" : "s"} an active bottleneck stage flagged.`,
      supportingCount: bottleneckedWfs.length,
    });
  }

  if (activeWfs.length === 0) {
    insights.push({
      id: "wf_empty",
      category: "health",
      severity: "info",
      text: "No active workflows found. Reporting will strengthen as workflows are created and activated.",
    });
  }

  return {
    reportId: `workflow_${Date.now()}`,
    reportType: "workflow-summary",
    scope: "organization",
    dateRange: {
      days: filter.days,
      from: isoDate(range.from),
      to: isoDate(range.to),
      label: range.label,
    },
    filtersApplied: filter,
    generatedAt: new Date().toISOString(),
    summaryMetrics: {
      totalWorkflows: wfData.length,
      activeWorkflows: activeWfs.length,
      completedWorkflows: wfData.filter((w) => w.status === "completed").length,
      redWorkflows: redCount,
      yellowWorkflows: yellowCount,
      greenWorkflows: activeWfs.filter((w) => w.stoplight === "green").length,
      avgHealthScore: avgHealth,
    },
    insights,
    supportingRecordsCount: wfData.length,
    hasHistoricalData: false,
    dataNote:
      activeWfs.length === 0
        ? "No reportable workflow history yet. Reporting will strengthen as more operational activity is recorded."
        : null,
    sections: [
      {
        title: "Workflow Performance",
        type: "table",
        data: { rows: wfData.sort((a, b) => a.healthScore - b.healthScore) },
        emptyMessage: "No workflows to report on yet.",
      },
    ],
  };
}

export async function buildDocumentReport(filter: ReportFilter): Promise<ReportOutput> {
  const range = getDateRange(filter.days);
  const evidence = await buildEvidenceAnalysis(filter);
  const insights = generateDocumentInsights(evidence);

  return {
    reportId: `document_${Date.now()}`,
    reportType: "document-coverage",
    scope: "organization",
    dateRange: {
      days: filter.days,
      from: isoDate(range.from),
      to: isoDate(range.to),
      label: range.label,
    },
    filtersApplied: filter,
    generatedAt: new Date().toISOString(),
    summaryMetrics: {
      totalDocuments: evidence.totalDocuments,
      workflowLinkedDocs: evidence.workflowLinkedDocs,
      itemLinkedDocs: evidence.itemLinkedDocs,
      workflowsWithDocs: evidence.workflowsWithDocs,
      criticalItemsWithoutDocs: evidence.criticalItemsWithoutDocs,
      recentDocCount: evidence.recentDocCount,
    },
    insights,
    supportingRecordsCount: evidence.totalDocuments,
    hasHistoricalData: false,
    dataNote: !evidence.hasData
      ? "No documents uploaded yet. Evidence coverage will build as records are documented."
      : null,
    sections: [
      {
        title: "Document Coverage",
        type: "metrics",
        data: {
          totalDocuments: evidence.totalDocuments,
          byType: evidence.docsByType,
          workflowLinked: evidence.workflowLinkedDocs,
          itemLinked: evidence.itemLinkedDocs,
          recentUploads: evidence.recentDocCount,
        },
        emptyMessage: "No documents on file.",
      },
    ],
  };
}

export async function buildAssignmentReport(filter: ReportFilter): Promise<ReportOutput> {
  const range = getDateRange(filter.days);
  const analysis = await buildAssignmentAnalysis();
  const insights = generateAssignmentInsights(analysis);

  return {
    reportId: `assignment_${Date.now()}`,
    reportType: "assignment-coverage",
    scope: "organization",
    dateRange: {
      days: filter.days,
      from: isoDate(range.from),
      to: isoDate(range.to),
      label: range.label,
    },
    filtersApplied: filter,
    generatedAt: new Date().toISOString(),
    summaryMetrics: {
      totalAssignments: analysis.totalAssignments,
      assignedCount: analysis.assignedCount,
      pendingCount: analysis.pendingCount,
      rejectedCount: analysis.rejectedCount,
      coveragePercent: analysis.coveragePercent,
      highConfidenceCount: analysis.highConfidenceCount,
      mediumConfidenceCount: analysis.mediumConfidenceCount,
      lowConfidenceCount: analysis.lowConfidenceCount,
      autoMatchedCount: analysis.autoMatchedCount,
    },
    insights,
    supportingRecordsCount: analysis.totalAssignments,
    hasHistoricalData: false,
    dataNote: !analysis.hasData
      ? "No imported records in the assignment queue yet. Coverage will build as records are imported."
      : null,
    sections: [
      {
        title: "Assignment Coverage",
        type: "metrics",
        data: {
          total: analysis.totalAssignments,
          assigned: analysis.assignedCount,
          pending: analysis.pendingCount,
          rejected: analysis.rejectedCount,
          coveragePercent: analysis.coveragePercent,
          bySourceType: analysis.bySourceType,
          confidence: {
            high: analysis.highConfidenceCount,
            medium: analysis.mediumConfidenceCount,
            low: analysis.lowConfidenceCount,
          },
        },
        emptyMessage: "No assignment records found.",
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Registry — defines available report types and their metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportDefinition {
  reportType: string;
  title: string;
  description: string;
  scope: string;
  category: string;
  builder: (filter: ReportFilter) => Promise<ReportOutput>;
}

export const REPORT_REGISTRY: ReportDefinition[] = [
  {
    reportType: "operational",
    title: "Operational Health Report",
    description: "Overall portfolio health, bottleneck concentration, risk signals, and timing analysis.",
    scope: "organization",
    category: "operational",
    builder: buildOperationalReport,
  },
  {
    reportType: "workflow-summary",
    title: "Workflow Performance Summary",
    description: "Stage-by-stage performance, health scores, and completion tracking across all workflows.",
    scope: "organization",
    category: "workflow",
    builder: buildWorkflowReport,
  },
  {
    reportType: "document-coverage",
    title: "Evidence & Documentation Report",
    description: "Document coverage analysis, critical item documentation gaps, and evidence activity.",
    scope: "organization",
    category: "evidence",
    builder: buildDocumentReport,
  },
  {
    reportType: "assignment-coverage",
    title: "Assignment & Data Quality Report",
    description: "Import record matching, confidence distribution, and data linkage coverage.",
    scope: "organization",
    category: "assignment",
    builder: buildAssignmentReport,
  },
];
