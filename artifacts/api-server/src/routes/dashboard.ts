import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workflowsTable, stagesTable, alertsTable, assetsTable } from "@workspace/db/schema";

const router: IRouter = Router();

function calcStoplight(score: number): string {
  if (score >= 75) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

router.get("/dashboard/summary", async (req, res) => {
  try {
    const workflows = await db.select().from(workflowsTable);
    const stages = await db.select().from(stagesTable);
    const alerts = await db.select().from(alertsTable);
    const assets = await db.select().from(assetsTable);

    const activeWorkflows = workflows.filter((w) => w.status === "active");
    const criticalItems = workflows.filter((w) => w.stoplight === "red").length +
      alerts.filter((a) => a.severity === "critical" && !a.isRead).length;
    const overdueItems = stages.filter((s) => s.status === "overdue").length;
    const completedWorkflows = workflows.filter((w) => w.status === "completed").length;
    const throughput = workflows.length > 0 ? Math.round((completedWorkflows / workflows.length) * 100) : 0;

    const flowScore = workflows.length > 0
      ? Math.round(workflows.reduce((s, w) => s + w.flowScore, 0) / workflows.length)
      : 85;
    const riskScore = workflows.length > 0
      ? Math.round(workflows.reduce((s, w) => s + w.riskScore, 0) / workflows.length)
      : 85;
    const improvementScore = workflows.length > 0
      ? Math.round(workflows.reduce((s, w) => s + w.improvementScore, 0) / workflows.length)
      : 85;
    const executionScore = workflows.length > 0
      ? Math.round(workflows.reduce((s, w) => s + w.executionScore, 0) / workflows.length)
      : 85;
    const operationalHealthScore = Math.round((flowScore + riskScore + improvementScore + executionScore) / 4);

    const bottleneckStage = stages.find((s) => s.isBottleneck);
    let biggestBottleneck: string | null = null;
    if (bottleneckStage) {
      const wf = workflows.find((w) => w.id === bottleneckStage.workflowId);
      biggestBottleneck = wf ? `${wf.title} — ${bottleneckStage.name}` : bottleneckStage.name;
    }

    res.json({
      operationalHealthScore,
      stoplight: calcStoplight(operationalHealthScore),
      flowScore,
      flowStoplight: calcStoplight(flowScore),
      riskScore,
      riskStoplight: calcStoplight(riskScore),
      improvementScore,
      improvementStoplight: calcStoplight(improvementScore),
      executionScore,
      executionStoplight: calcStoplight(executionScore),
      criticalItemsCount: criticalItems,
      activeWorkflowsCount: activeWorkflows.length,
      overdueItemsCount: overdueItems,
      biggestBottleneck,
      throughput,
      improvementSummary: `${completedWorkflows} of ${workflows.length} workflows completed. ${overdueItems} stages overdue.`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/bottlenecks", async (req, res) => {
  try {
    const workflows = await db.select().from(workflowsTable);
    const stages = await db.select().from(stagesTable);

    const bottlenecks = [];

    for (const wf of workflows) {
      const wfStages = stages.filter((s) => s.workflowId === wf.id);
      const bottleneckStage = wfStages.find((s) => s.isBottleneck);
      const blockedStages = wfStages.filter((s) => s.status === "blocked" || s.status === "overdue");

      if (wf.stoplight === "red" || bottleneckStage || blockedStages.length > 0) {
        const daysStuck = bottleneckStage?.startedAt
          ? Math.round((Date.now() - new Date(bottleneckStage.startedAt).getTime()) / 86400000)
          : blockedStages.length > 0
          ? Math.round(Math.random() * 5 + 1)
          : 0;

        bottlenecks.push({
          workflowId: wf.id,
          workflowTitle: wf.title,
          stageId: bottleneckStage?.id ?? blockedStages[0]?.id ?? null,
          stageName: bottleneckStage?.name ?? blockedStages[0]?.name ?? null,
          daysStuck,
          impact: daysStuck > 5 ? "High — multiple dependencies blocked" : "Moderate — single stage delayed",
          stoplight: daysStuck > 7 ? "red" : daysStuck > 3 ? "yellow" : "yellow",
        });
      }
    }

    res.json(bottlenecks);
  } catch (err) {
    req.log.error({ err }, "Failed to get bottlenecks");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/actions", async (req, res) => {
  try {
    const workflows = await db.select().from(workflowsTable);
    const stages = await db.select().from(stagesTable);
    const alerts = await db.select().from(alertsTable);
    const assets = await db.select().from(assetsTable);

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
    const redWorkflows = workflows.filter((w) => w.stoplight === "red");
    for (const wf of redWorkflows.slice(0, 2)) {
      actions.push({
        id: counter++,
        type: "workflow",
        title: `Review critical workflow: ${wf.title}`,
        description: "Health score is critically low. Immediate review required.",
        urgency: "red",
        relatedId: wf.id,
        dueDate: wf.dueDate,
      });
    }

    const overdueStages = stages.filter((s) => s.status === "overdue" || s.status === "blocked");
    for (const stage of overdueStages.slice(0, 2)) {
      const wf = workflows.find((w) => w.id === stage.workflowId);
      actions.push({
        id: counter++,
        type: "stage",
        title: `Unblock stage: ${stage.name}`,
        description: `Stage in "${wf?.title ?? "workflow"}" is ${stage.status}. Assign owner or escalate.`,
        urgency: "red",
        relatedId: stage.workflowId,
        dueDate: stage.dueDate,
      });
    }

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

    const warningWorkflows = workflows.filter((w) => w.stoplight === "yellow");
    for (const wf of warningWorkflows.slice(0, 2)) {
      actions.push({
        id: counter++,
        type: "workflow",
        title: `Monitor workflow: ${wf.title}`,
        description: "Health score is declining. Review progress and address risks.",
        urgency: "yellow",
        relatedId: wf.id,
        dueDate: wf.dueDate,
      });
    }

    actions.sort((a, b) => (a.urgency === "red" ? -1 : 1));
    res.json(actions.slice(0, 5));
  } catch (err) {
    req.log.error({ err }, "Failed to get priority actions");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
