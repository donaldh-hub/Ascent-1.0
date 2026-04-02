/**
 * Phase 1 – Build 3: Scoring and Stoplight Engine
 *
 * Pure calculation utilities for Flow, Risk, Improvement, and Execution scores.
 * Accepts real workflow item data as input. No UI logic. No DB calls.
 * Reusable by dashboard, workflows, alerts, and all future modules.
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type Stoplight = "green" | "yellow" | "red";

export interface ScoredDimension {
  score: number; // 0–100
  stoplight: Stoplight;
  insight: string;
}

export interface WorkflowHealthResult {
  healthScore: number;
  stoplight: Stoplight;
  insight: string;
  flow: ScoredDimension;
  risk: ScoredDimension;
  improvement: ScoredDimension;
  execution: ScoredDimension;
}

export interface OperationalHealthResult {
  operationalHealthScore: number;
  stoplight: Stoplight;
  insight: string;
  flowScore: number;
  flowStoplight: Stoplight;
  flowInsight: string;
  riskScore: number;
  riskStoplight: Stoplight;
  riskInsight: string;
  improvementScore: number;
  improvementStoplight: Stoplight;
  improvementInsight: string;
  executionScore: number;
  executionStoplight: Stoplight;
  executionInsight: string;
  criticalItemsCount: number;
  biggestBottleneckWorkflow: string | null;
  biggestBottleneckStage: string | null;
}

// Raw inputs fed to the engine — taken directly from DB rows

export interface ItemInput {
  id: number;
  workflowId: number;
  stageId: number;
  title: string;
  priority: string; // "low" | "medium" | "high" | "critical"
  status: string; // "open" | "in_progress" | "completed" | "blocked"
  assignedTo: string | null;
  dueDate: string | null;
  stageEnteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface StageInput {
  id: number;
  workflowId: number;
  name: string;
  order: number;
  status: string;
  isBottleneck: boolean;
  startedAt: Date | null;
}

export interface HistoryInput {
  itemId: number;
  movedAt: Date;
}

export interface WorkflowInput {
  id: number;
  title: string;
  status: string; // "active" | "paused" | "completed" | "archived"
  stages: StageInput[];
  items: ItemInput[];
  history: HistoryInput[];
}

// ─────────────────────────────────────────────
// Stoplight Thresholds (shared, centralized)
// ─────────────────────────────────────────────

export const STOPLIGHT_THRESHOLDS = {
  GREEN: 75,
  YELLOW: 50,
} as const;

export function calcStoplight(score: number): Stoplight {
  if (score >= STOPLIGHT_THRESHOLDS.GREEN) return "green";
  if (score >= STOPLIGHT_THRESHOLDS.YELLOW) return "yellow";
  return "red";
}

// ─────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function isOverdue(item: ItemInput): boolean {
  if (!item.dueDate) return false;
  return new Date(item.dueDate).getTime() < Date.now();
}

// ─────────────────────────────────────────────
// A. FLOW CALCULATOR
//
// Measures: how freely items move through the workflow.
// Penalizes: congestion, aging items, bottleneck concentration, stagnation.
// ─────────────────────────────────────────────

export function calcFlow(wf: WorkflowInput): ScoredDimension {
  const items = wf.items;
  const openItems = items.filter((i) => i.status !== "completed");
  const stageCount = wf.stages.length;

  if (stageCount === 0) {
    return { score: 60, stoplight: "yellow", insight: "No stages defined. Flow cannot be assessed yet." };
  }

  if (openItems.length === 0 && items.length === 0) {
    return { score: 70, stoplight: "yellow", insight: "No items yet. Flow score provisional." };
  }

  let score = 100;
  const reasons: string[] = [];

  // Penalty: high open item volume relative to stages
  const itemsPerStage = stageCount > 0 ? openItems.length / stageCount : 0;
  if (itemsPerStage > 5) {
    score -= 25;
    reasons.push(`High item density (${openItems.length} open items across ${stageCount} stages).`);
  } else if (itemsPerStage > 2) {
    score -= 12;
    reasons.push(`Moderate item density (${Math.round(itemsPerStage * 10) / 10} per stage).`);
  }

  // Penalty: old items stuck in a stage
  const STAGE_AGING_THRESHOLD_DAYS = 14;
  const agingItems = openItems.filter((i) => daysSince(i.stageEnteredAt) > STAGE_AGING_THRESHOLD_DAYS);
  if (agingItems.length > 0) {
    const penalty = Math.min(30, agingItems.length * 8);
    score -= penalty;
    reasons.push(`${agingItems.length} item${agingItems.length > 1 ? "s" : ""} aging beyond ${STAGE_AGING_THRESHOLD_DAYS} days in current stage.`);
  }

  // Penalty: bottleneck concentration (2+ items in one stage)
  const stageCounts = openItems.reduce((acc, i) => {
    acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  const maxInStage = Math.max(0, ...Object.values(stageCounts));
  if (maxInStage >= 3) {
    score -= 20;
    const bottleneckStage = wf.stages.find((s) => stageCounts[s.id] === maxInStage);
    reasons.push(`Bottleneck concentration: ${maxInStage} items in "${bottleneckStage?.name ?? "one stage"}".`);
  } else if (maxInStage === 2) {
    score -= 8;
    const bottleneckStage = wf.stages.find((s) => stageCounts[s.id] === maxInStage);
    reasons.push(`Stage congestion: 2 items in "${bottleneckStage?.name ?? "one stage"}".`);
  }

  // Penalty: blocked stages from stage statuses
  const blockedStages = wf.stages.filter((s) => s.status === "blocked" || s.status === "overdue");
  if (blockedStages.length > 0) {
    score -= Math.min(20, blockedStages.length * 10);
    reasons.push(`${blockedStages.length} stage${blockedStages.length > 1 ? "s" : ""} blocked or overdue.`);
  }

  // Bonus: items are completing (good flow)
  const completedItems = items.filter((i) => i.status === "completed");
  if (completedItems.length > 0 && items.length > 0) {
    const completionRate = completedItems.length / items.length;
    if (completionRate >= 0.5) {
      score += 10;
    }
  }

  score = Math.min(100, Math.max(5, Math.round(score)));

  const insight = reasons.length > 0
    ? reasons.join(" ")
    : score >= 75
    ? "Flow is healthy. Items are moving through stages efficiently."
    : "Flow is moderate with some congestion signals.";

  return { score, stoplight: calcStoplight(score), insight };
}

// ─────────────────────────────────────────────
// B. RISK CALCULATOR
//
// Measures: exposure to failure, stagnation, and urgency.
// Note: higher raw risk burden = LOWER risk score (worse health).
// ─────────────────────────────────────────────

export function calcRisk(wf: WorkflowInput): ScoredDimension {
  const items = wf.items;
  const openItems = items.filter((i) => i.status !== "completed");

  if (openItems.length === 0 && items.length === 0) {
    return { score: 75, stoplight: "green", insight: "No items to assess. Risk is neutral pending first activity." };
  }

  let score = 100;
  const reasons: string[] = [];

  // Critical priority open items — highest risk signal
  const criticalItems = openItems.filter((i) => i.priority === "critical");
  if (criticalItems.length > 0) {
    const penalty = Math.min(45, criticalItems.length * 20);
    score -= penalty;
    reasons.push(`${criticalItems.length} critical-priority open item${criticalItems.length > 1 ? "s" : ""}.`);
  }

  // High priority open items
  const highItems = openItems.filter((i) => i.priority === "high");
  if (highItems.length > 0) {
    const penalty = Math.min(20, highItems.length * 8);
    score -= penalty;
  }

  // Overdue items
  const overdueItems = openItems.filter(isOverdue);
  if (overdueItems.length > 0) {
    const penalty = Math.min(30, overdueItems.length * 12);
    score -= penalty;
    reasons.push(`${overdueItems.length} item${overdueItems.length > 1 ? "s" : ""} past due date.`);
  }

  // Severely stuck items (30+ days in same stage)
  const STUCK_THRESHOLD = 30;
  const stuckItems = openItems.filter((i) => daysSince(i.stageEnteredAt) > STUCK_THRESHOLD);
  if (stuckItems.length > 0) {
    const penalty = Math.min(30, stuckItems.length * 15);
    score -= penalty;
    const maxDays = Math.round(Math.max(...stuckItems.map((i) => daysSince(i.stageEnteredAt))));
    reasons.push(`${stuckItems.length} item${stuckItems.length > 1 ? "s" : ""} stuck >30 days (longest: ${maxDays}d).`);
  }

  // Blocked items explicitly
  const blockedItems = openItems.filter((i) => i.status === "blocked");
  if (blockedItems.length > 0) {
    score -= Math.min(20, blockedItems.length * 10);
    reasons.push(`${blockedItems.length} item${blockedItems.length > 1 ? "s" : ""} explicitly blocked.`);
  }

  score = Math.min(100, Math.max(5, Math.round(score)));

  const insight = reasons.length > 0
    ? `Risk elevated: ${reasons.join(" ")}`
    : score >= 75
    ? "Risk is low. No critical or overdue items detected."
    : "Risk elevated due to item aging or volume.";

  return { score, stoplight: calcStoplight(score), insight };
}

// ─────────────────────────────────────────────
// C. IMPROVEMENT CALCULATOR
//
// Measures: positive momentum, completion trends, congestion reduction.
// Uses completion ratio and recent movement history.
// ─────────────────────────────────────────────

export function calcImprovement(wf: WorkflowInput): ScoredDimension {
  const items = wf.items;
  const openItems = items.filter((i) => i.status !== "completed");
  const completedItems = items.filter((i) => i.status === "completed");
  const history = wf.history;

  if (items.length === 0) {
    return { score: 60, stoplight: "yellow", insight: "No items recorded yet. Improvement score provisional." };
  }

  let score = 40; // start neutral
  const reasons: string[] = [];

  // Completion ratio — primary improvement signal
  const completionRate = items.length > 0 ? completedItems.length / items.length : 0;
  const completionBonus = Math.round(completionRate * 50);
  score += completionBonus;
  if (completionRate >= 0.5) {
    reasons.push(`Strong completion rate: ${Math.round(completionRate * 100)}% of items done.`);
  } else if (completionRate > 0) {
    reasons.push(`Completion rate ${Math.round(completionRate * 100)}% — improving over time.`);
  }

  // Recent movement momentum (history in last 7 days)
  const RECENT_DAYS = 7;
  const recentMoves = history.filter((h) => daysSince(h.movedAt) <= RECENT_DAYS).length;
  if (recentMoves > 0) {
    const momentumBonus = Math.min(15, recentMoves * 3);
    score += momentumBonus;
    reasons.push(`${recentMoves} stage movement${recentMoves > 1 ? "s" : ""} in the last 7 days.`);
  } else if (history.length > 0) {
    score -= 10;
    reasons.push("No recent movement in the last 7 days.");
  }

  // Penalty: all open items with no movement at all
  const staleItems = openItems.filter((i) => daysSince(i.updatedAt) > 21);
  if (staleItems.length > 0) {
    score -= Math.min(20, staleItems.length * 5);
    reasons.push(`${staleItems.length} stale item${staleItems.length > 1 ? "s" : ""} with no update in 21+ days.`);
  }

  score = Math.min(100, Math.max(5, Math.round(score)));

  const insight = reasons.length > 0
    ? reasons.join(" ")
    : score >= 75
    ? "Improvement is strong with steady completion and forward movement."
    : score >= 50
    ? "Improvement is moderate. Increase item throughput for better momentum."
    : "Limited improvement activity detected. More item movement needed.";

  return { score, stoplight: calcStoplight(score), insight };
}

// ─────────────────────────────────────────────
// D. EXECUTION CALCULATOR
//
// Measures: follow-through, assignment coverage, stage progression.
// ─────────────────────────────────────────────

export function calcExecution(wf: WorkflowInput): ScoredDimension {
  const items = wf.items;
  const openItems = items.filter((i) => i.status !== "completed");
  const history = wf.history;

  if (items.length === 0) {
    return { score: 60, stoplight: "yellow", insight: "No items to evaluate. Execution score provisional." };
  }

  let score = 50; // neutral start
  const reasons: string[] = [];

  // Assignment coverage
  const assignedItems = items.filter((i) => i.assignedTo && i.assignedTo.trim().length > 0);
  const assignmentRate = items.length > 0 ? assignedItems.length / items.length : 0;
  const assignmentBonus = Math.round(assignmentRate * 25);
  score += assignmentBonus;
  if (assignmentRate >= 0.8) {
    reasons.push("Strong assignment coverage.");
  } else if (assignmentRate < 0.5 && items.length > 2) {
    reasons.push(`Low assignment coverage: only ${Math.round(assignmentRate * 100)}% of items assigned.`);
  }

  // Movement history — execution requires action
  if (history.length > 0) {
    const historyBonus = Math.min(20, history.length * 2);
    score += historyBonus;
  } else if (openItems.length > 0) {
    score -= 15;
    reasons.push("No stage movement recorded yet.");
  }

  // Items with "in_progress" status — positive signal
  const inProgressItems = openItems.filter((i) => i.status === "in_progress");
  if (inProgressItems.length > 0) {
    score += Math.min(10, inProgressItems.length * 3);
  }

  // Stale items without updates — execution failure signal
  const STALE_EXECUTION_DAYS = 14;
  const staleItems = openItems.filter((i) => daysSince(i.updatedAt) > STALE_EXECUTION_DAYS);
  if (staleItems.length > 0) {
    const penalty = Math.min(25, staleItems.length * 8);
    score -= penalty;
    reasons.push(`${staleItems.length} item${staleItems.length > 1 ? "s" : ""} stale for ${STALE_EXECUTION_DAYS}+ days.`);
  }

  // Unassigned critical/high items — execution gap
  const criticalUnassigned = openItems.filter(
    (i) => (i.priority === "critical" || i.priority === "high") && (!i.assignedTo || !i.assignedTo.trim())
  );
  if (criticalUnassigned.length > 0) {
    score -= Math.min(20, criticalUnassigned.length * 8);
    reasons.push(`${criticalUnassigned.length} high/critical item${criticalUnassigned.length > 1 ? "s" : ""} unassigned.`);
  }

  score = Math.min(100, Math.max(5, Math.round(score)));

  const insight = reasons.length > 0
    ? reasons.join(" ")
    : score >= 75
    ? "Execution is strong. Items are assigned, active, and progressing."
    : score >= 50
    ? "Execution is adequate but can improve with better assignment and momentum."
    : "Execution is weak. Assign owners and move items forward.";

  return { score, stoplight: calcStoplight(score), insight };
}

// ─────────────────────────────────────────────
// WORKFLOW HEALTH FUNCTION
//
// Weighted combination of the four calculators.
// Weights: Flow 30%, Risk 30%, Execution 25%, Improvement 15%
// ─────────────────────────────────────────────

export function calcWorkflowHealth(wf: WorkflowInput): WorkflowHealthResult {
  const flow = calcFlow(wf);
  const risk = calcRisk(wf);
  const improvement = calcImprovement(wf);
  const execution = calcExecution(wf);

  const healthScore = Math.round(
    flow.score * 0.30 +
    risk.score * 0.30 +
    execution.score * 0.25 +
    improvement.score * 0.15
  );

  const stoplight = calcStoplight(healthScore);

  // Build a top-level insight that explains the primary driver
  const scores = [
    { name: "Flow", score: flow.score, insight: flow.insight },
    { name: "Risk", score: risk.score, insight: risk.insight },
    { name: "Execution", score: execution.score, insight: execution.insight },
    { name: "Improvement", score: improvement.score, insight: improvement.insight },
  ];
  const lowestDimension = scores.reduce((min, s) => (s.score < min.score ? s : min), scores[0]);
  const insight = healthScore >= 75
    ? `Workflow is healthy (score ${healthScore}). All dimensions in good standing.`
    : healthScore >= 50
    ? `Workflow needs attention (score ${healthScore}). Primary concern: ${lowestDimension.name} — ${lowestDimension.insight}`
    : `Workflow is critical (score ${healthScore}). ${lowestDimension.name} is the primary issue: ${lowestDimension.insight}`;

  return { healthScore, stoplight, insight, flow, risk, improvement, execution };
}

// ─────────────────────────────────────────────
// OPERATIONAL HEALTH ENGINE
//
// Aggregates across all active workflows.
// Each workflow's health contributes equally to operational health.
// ─────────────────────────────────────────────

export function calcOperationalHealth(
  workflows: WorkflowInput[],
  alerts: { severity: string; isRead: boolean }[] = []
): OperationalHealthResult {
  const activeWorkflows = workflows.filter((w) => w.status === "active" || w.status === "paused");

  if (activeWorkflows.length === 0) {
    return {
      operationalHealthScore: 70,
      stoplight: "yellow",
      insight: "No active workflows yet. Health is provisional pending first workflow data.",
      flowScore: 70, flowStoplight: "yellow", flowInsight: "No workflow data.",
      riskScore: 70, riskStoplight: "yellow", riskInsight: "No workflow data.",
      improvementScore: 70, improvementStoplight: "yellow", improvementInsight: "No workflow data.",
      executionScore: 70, executionStoplight: "yellow", executionInsight: "No workflow data.",
      criticalItemsCount: 0,
      biggestBottleneckWorkflow: null,
      biggestBottleneckStage: null,
    };
  }

  // Calculate health per workflow
  const workflowResults = activeWorkflows.map((wf) => ({ wf, health: calcWorkflowHealth(wf) }));

  // Aggregate scores
  const avg = (vals: number[]) => Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  const flowScore = avg(workflowResults.map((r) => r.health.flow.score));
  const riskScore = avg(workflowResults.map((r) => r.health.risk.score));
  const improvementScore = avg(workflowResults.map((r) => r.health.improvement.score));
  const executionScore = avg(workflowResults.map((r) => r.health.execution.score));

  const operationalHealthScore = Math.round(
    flowScore * 0.30 + riskScore * 0.30 + executionScore * 0.25 + improvementScore * 0.15
  );

  // Count critical items across all workflows
  const allItems = activeWorkflows.flatMap((w) => w.items);
  const criticalItemsCount = allItems.filter(
    (i) => i.status !== "completed" && (i.priority === "critical" ||
      (i.priority === "high" && daysSince(i.stageEnteredAt) > 30))
  ).length + alerts.filter((a) => a.severity === "critical" && !a.isRead).length;

  // Find biggest bottleneck: workflow with the lowest flow score and highest item concentration
  const bottleneckWorkflow = workflowResults.reduce(
    (min, r) => (r.health.flow.score < min.health.flow.score ? r : min),
    workflowResults[0]
  );

  // Find the bottleneck stage within that workflow
  let biggestBottleneckStage: string | null = null;
  if (bottleneckWorkflow) {
    const openItems = bottleneckWorkflow.wf.items.filter((i) => i.status !== "completed");
    const stageCounts = openItems.reduce((acc, i) => {
      acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    const maxCount = Math.max(0, ...Object.values(stageCounts));
    if (maxCount >= 2) {
      const bottleneckStageId = Object.keys(stageCounts).find(
        (id) => stageCounts[Number(id)] === maxCount
      );
      const stage = bottleneckWorkflow.wf.stages.find((s) => s.id === Number(bottleneckStageId));
      if (stage) biggestBottleneckStage = stage.name;
    }
  }

  // Top-level insights
  const stoplight = calcStoplight(operationalHealthScore);
  const lowestArea = [
    { name: "Flow", score: flowScore },
    { name: "Risk", score: riskScore },
    { name: "Improvement", score: improvementScore },
    { name: "Execution", score: executionScore },
  ].reduce((min, s) => (s.score < min.score ? s : min));

  const insight = stoplight === "green"
    ? `Operations are healthy. All ${activeWorkflows.length} active workflows in good standing.`
    : stoplight === "yellow"
    ? `Operations need attention. ${lowestArea.name} is the primary concern across ${activeWorkflows.length} workflows.`
    : `Operations are critical. ${lowestArea.name} is severely impacted across ${activeWorkflows.length} active workflows.`;

  // Per-dimension insights (summarize the weakest workflow's insight for each dimension)
  const flowInsight = workflowResults.reduce(
    (w, r) => (r.health.flow.score < w.health.flow.score ? r : w)
  ).health.flow.insight;
  const riskInsight = workflowResults.reduce(
    (w, r) => (r.health.risk.score < w.health.risk.score ? r : w)
  ).health.risk.insight;
  const improvementInsight = workflowResults.reduce(
    (w, r) => (r.health.improvement.score < w.health.improvement.score ? r : w)
  ).health.improvement.insight;
  const executionInsight = workflowResults.reduce(
    (w, r) => (r.health.execution.score < w.health.execution.score ? r : w)
  ).health.execution.insight;

  return {
    operationalHealthScore,
    stoplight,
    insight,
    flowScore,
    flowStoplight: calcStoplight(flowScore),
    flowInsight,
    riskScore,
    riskStoplight: calcStoplight(riskScore),
    riskInsight,
    improvementScore,
    improvementStoplight: calcStoplight(improvementScore),
    improvementInsight,
    executionScore,
    executionStoplight: calcStoplight(executionScore),
    executionInsight,
    criticalItemsCount,
    biggestBottleneckWorkflow: bottleneckWorkflow?.wf.title ?? null,
    biggestBottleneckStage,
  };
}
