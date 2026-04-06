import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workflowsTable, stagesTable, alertsTable, assetsTable, workflowItemsTable } from "@workspace/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { loadAllWorkflowInputs, loadAlerts } from "../engine/loader";
import { calcOperationalHealth, calcStoplight } from "../engine/scoring";
import { buildDashboardIntelligence } from "../engine/intelligence";
import { buildPortfolioControlTower } from "../services/portfolio_control_tower";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res) => {
  try {
    const [workflowInputs, alerts, allAssets] = await Promise.all([
      loadAllWorkflowInputs(),
      loadAlerts(),
      db.select({
        id: assetsTable.id,
        warrantyExpiration: assetsTable.warrantyExpiration,
        unitId: assetsTable.unitId,
      }).from(assetsTable),
    ]);

    // ── Asset health metrics (single authoritative pass) ─────────────────────
    const today = new Date();
    const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
    let atRiskAssets = 0;
    let expiringSoonAssets = 0;
    for (const a of allAssets) {
      if (!a.warrantyExpiration) continue;
      const exp = new Date(a.warrantyExpiration);
      if (exp < today) atRiskAssets++;
      else if (exp < ninetyDays) expiringSoonAssets++;
    }

    const operational = calcOperationalHealth(workflowInputs, alerts);

    // Count open items across all workflows
    const allOpenItems = workflowInputs.flatMap((w) =>
      w.items.filter((i) => i.status !== "completed")
    );

    const activeWorkflowsCount = workflowInputs.filter(
      (w) => w.status === "active" || w.status === "paused"
    ).length;

    const completedWorkflows = workflowInputs.filter((w) => w.status === "completed").length;
    const throughput = workflowInputs.length > 0
      ? Math.round((completedWorkflows / workflowInputs.length) * 100)
      : 0;

    const overdueCount = allOpenItems.filter((i) => {
      if (!i.dueDate) return false;
      return new Date(i.dueDate).getTime() < Date.now();
    }).length;

    const improvementSummary = operational.insight;

    // Build biggest bottleneck description
    let biggestBottleneck: string | null = null;
    if (operational.biggestBottleneckWorkflow && operational.biggestBottleneckStage) {
      biggestBottleneck = `${operational.biggestBottleneckWorkflow} — ${operational.biggestBottleneckStage}`;
    } else if (operational.biggestBottleneckWorkflow) {
      biggestBottleneck = operational.biggestBottleneckWorkflow;
    }

    res.json({
      operationalHealthScore: operational.operationalHealthScore,
      stoplight: operational.stoplight,
      insight: operational.insight,
      flowScore: operational.flowScore,
      flowStoplight: operational.flowStoplight,
      flowInsight: operational.flowInsight,
      riskScore: operational.riskScore,
      riskStoplight: operational.riskStoplight,
      riskInsight: operational.riskInsight,
      improvementScore: operational.improvementScore,
      improvementStoplight: operational.improvementStoplight,
      improvementInsight: operational.improvementInsight,
      executionScore: operational.executionScore,
      executionStoplight: operational.executionStoplight,
      executionInsight: operational.executionInsight,
      criticalItemsCount: operational.criticalItemsCount,
      activeWorkflowsCount,
      overdueItemsCount: overdueCount,
      biggestBottleneck,
      throughput,
      improvementSummary,
      // ── Asset health (all from persisted unit_id FK) ──────────────────────
      totalAssets: allAssets.length,
      atRiskAssets,
      expiringSoonAssets,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/bottlenecks", async (req, res) => {
  try {
    const workflowInputs = await loadAllWorkflowInputs();

    const bottlenecks: {
      workflowId: number;
      workflowTitle: string;
      stageId: number | null;
      stageName: string | null;
      daysStuck: number;
      impact: string;
      stoplight: string;
      openItemCount: number;
      insight: string;
    }[] = [];

    for (const wf of workflowInputs) {
      const openItems = wf.items.filter((i) => i.status !== "completed");
      if (openItems.length === 0) continue;

      // Find most congested stage
      const stageCounts = openItems.reduce((acc, i) => {
        acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      const maxCount = Math.max(0, ...Object.values(stageCounts));
      if (maxCount < 1) continue;

      // Find oldest item in the congested stage
      const bottleneckStageId = Object.keys(stageCounts).find(
        (id) => stageCounts[Number(id)] === maxCount
      );
      const stage = wf.stages.find((s) => s.id === Number(bottleneckStageId));

      const stageItems = openItems.filter((i) => i.stageId === Number(bottleneckStageId));
      const oldestDays = stageItems.length > 0
        ? Math.round(Math.max(...stageItems.map((i) =>
            (Date.now() - i.stageEnteredAt.getTime()) / (1000 * 60 * 60 * 24)
          )))
        : 0;

      const hasCritical = stageItems.some((i) => i.priority === "critical");
      const stoplight = hasCritical || oldestDays > 14 ? "red" : oldestDays > 7 ? "yellow" : "yellow";

      const impact = hasCritical
        ? "Critical — contains critical-priority items"
        : maxCount >= 3
        ? "High — multiple items concentrated in one stage"
        : "Moderate — stage congestion detected";

      const insight = stage
        ? `"${stage.name}" has ${maxCount} open item${maxCount > 1 ? "s" : ""}, oldest aged ${oldestDays} day${oldestDays !== 1 ? "s" : ""}.`
        : "Bottleneck stage identified.";

      // Only surface genuine bottlenecks (2+ items OR old items)
      if (maxCount >= 2 || oldestDays > 7) {
        bottlenecks.push({
          workflowId: wf.id,
          workflowTitle: wf.title,
          stageId: stage?.id ?? null,
          stageName: stage?.name ?? null,
          daysStuck: oldestDays,
          impact,
          stoplight,
          openItemCount: maxCount,
          insight,
        });
      }
    }

    // Sort by severity: critical first, then days stuck
    bottlenecks.sort((a, b) => {
      if (a.stoplight === "red" && b.stoplight !== "red") return -1;
      if (b.stoplight === "red" && a.stoplight !== "red") return 1;
      return b.daysStuck - a.daysStuck;
    });

    res.json(bottlenecks);
  } catch (err) {
    req.log.error({ err }, "Failed to get bottlenecks");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/actions", async (req, res) => {
  try {
    const [workflowInputs, alerts] = await Promise.all([
      loadAllWorkflowInputs(),
      loadAlerts(),
    ]);

    const actions: {
      id: number;
      type: string;
      title: string;
      description: string;
      urgency: string;
      relatedId: number;
      dueDate: string | null;
    }[] = [];

    let counter = 1;

    // Critical items across workflows
    for (const wf of workflowInputs) {
      const critItems = wf.items.filter(
        (i) => i.status !== "completed" && i.priority === "critical"
      );
      for (const item of critItems.slice(0, 2)) {
        const stage = wf.stages.find((s) => s.id === item.stageId);
        actions.push({
          id: counter++,
          type: "workflow_item",
          title: `Critical item: ${item.title}`,
          description: `In "${wf.title}" — ${stage?.name ?? "unknown stage"}. Needs immediate attention.`,
          urgency: "red",
          relatedId: wf.id,
          dueDate: item.dueDate,
        });
      }
    }

    // Workflows with very low health scores
    for (const wf of workflowInputs.filter((w) => w.status === "active")) {
      const openItems = wf.items.filter((i) => i.status !== "completed");
      const hasOldItems = openItems.some(
        (i) => (Date.now() - i.stageEnteredAt.getTime()) / (1000 * 60 * 60 * 24) > 30
      );
      if (hasOldItems) {
        actions.push({
          id: counter++,
          type: "workflow",
          title: `Review aging items: ${wf.title}`,
          description: "One or more items have been stuck in a stage for 30+ days.",
          urgency: "red",
          relatedId: wf.id,
          dueDate: null,
        });
      }
    }

    // Unread critical alerts
    const criticalAlerts = alerts.filter((a) => a.severity === "critical" && !a.isRead);
    for (const alert of criticalAlerts.slice(0, 2)) {
      actions.push({
        id: counter++,
        type: "alert",
        title: alert.title,
        description: alert.message,
        urgency: "red",
        relatedId: alert.id,
        dueDate: null,
      });
    }

    // Workflows with high-priority unassigned items
    for (const wf of workflowInputs) {
      const unassignedHigh = wf.items.filter(
        (i) => i.status !== "completed" &&
          (i.priority === "high" || i.priority === "critical") &&
          (!i.assignedTo || !i.assignedTo.trim())
      );
      if (unassignedHigh.length > 0) {
        actions.push({
          id: counter++,
          type: "workflow",
          title: `Assign owners: ${wf.title}`,
          description: `${unassignedHigh.length} high/critical item${unassignedHigh.length > 1 ? "s" : ""} without an assigned owner.`,
          urgency: "yellow",
          relatedId: wf.id,
          dueDate: null,
        });
      }
    }

    // Warning alerts
    const warnAlerts = alerts.filter((a) => a.severity === "warning" && !a.isRead);
    for (const alert of warnAlerts.slice(0, 1)) {
      actions.push({
        id: counter++,
        type: "alert",
        title: alert.title,
        description: alert.message,
        urgency: "yellow",
        relatedId: alert.id,
        dueDate: null,
      });
    }

    actions.sort((a, b) => {
      const urgencyOrder: Record<string, number> = { red: 0, yellow: 1, green: 2 };
      return (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2);
    });

    res.json(actions.slice(0, 6));
  } catch (err) {
    req.log.error({ err }, "Failed to get priority actions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/intelligence", async (req, res) => {
  try {
    const intelligence = await buildDashboardIntelligence();
    res.json(intelligence);
  } catch (err) {
    req.log.error({ err }, "Failed to build dashboard intelligence");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/portfolio", async (req, res) => {
  try {
    const portfolio = await buildPortfolioControlTower();
    res.json(portfolio);
  } catch (err) {
    req.log.error({ err }, "Failed to build portfolio control tower");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
