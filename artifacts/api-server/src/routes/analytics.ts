import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db/schema";
import { loadAllWorkflowInputs } from "../engine/loader";
import { calcWorkflowHealth, calcOperationalHealth } from "../engine/scoring";

const router: IRouter = Router();

router.get("/analytics/trends", async (req, res) => {
  try {
    const [workflowInputs, alerts] = await Promise.all([
      loadAllWorkflowInputs(),
      db.select().from(alertsTable),
    ]);

    // Compute today's real scores
    const operational = calcOperationalHealth(workflowInputs, alerts);
    const today = new Date().toISOString().split("T")[0];

    // For now, history is today only. As the system runs longer,
    // score snapshots will accumulate and populate this series.
    // We return a truthful single-point series rather than fake historical data.
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

    // Build placeholder history: today is real, past is null (no fake jitter)
    const dates: string[] = [];
    const operationalHealth: (number | null)[] = [];
    const flowScores: (number | null)[] = [];
    const riskScores: (number | null)[] = [];
    const improvementScores: (number | null)[] = [];
    const executionScores: (number | null)[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split("T")[0]);

      if (i === 0) {
        // Today — use real computed scores
        operationalHealth.push(operational.operationalHealthScore);
        flowScores.push(operational.flowScore);
        riskScores.push(operational.riskScore);
        improvementScores.push(operational.improvementScore);
        executionScores.push(operational.executionScore);
      } else {
        // Historical data not yet available
        operationalHealth.push(null);
        flowScores.push(null);
        riskScores.push(null);
        improvementScores.push(null);
        executionScores.push(null);
      }
    }

    res.json({
      dates,
      operationalHealth,
      flowScore: flowScores,
      riskScore: riskScores,
      improvementScore: improvementScores,
      executionScore: executionScores,
      hasHistoricalData: false,
      historicalNote: "Trend history accumulates as workflows are active. Current scores reflect live data.",
      currentScores: {
        operationalHealth: operational.operationalHealthScore,
        flow: operational.flowScore,
        risk: operational.riskScore,
        improvement: operational.improvementScore,
        execution: operational.executionScore,
        stoplight: operational.stoplight,
        insight: operational.insight,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get trends");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/workflow-performance", async (req, res) => {
  try {
    const [workflowInputs, alerts] = await Promise.all([
      loadAllWorkflowInputs(),
      db.select().from(alertsTable),
    ]);

    const result = workflowInputs.map((wf) => {
      const health = calcWorkflowHealth(wf);
      const openItems = wf.items.filter((i) => i.status !== "completed");
      const completedItems = wf.items.filter((i) => i.status === "completed");
      const completionRate = wf.items.length > 0
        ? Math.round((completedItems.length / wf.items.length) * 100)
        : 0;

      // Compute average stage duration from item history
      const avgItemAgeDays = openItems.length > 0
        ? Math.round(
            openItems.reduce((sum, i) => {
              return sum + (Date.now() - i.stageEnteredAt.getTime()) / (1000 * 60 * 60 * 24);
            }, 0) / openItems.length * 10
          ) / 10
        : 0;

      const wfAlerts = alerts.filter((a) => a.workflowId === wf.id);

      return {
        workflowId: wf.id,
        title: wf.title,
        status: wf.status,
        healthScore: health.healthScore,
        stoplight: health.stoplight,
        insight: health.insight,
        flowScore: health.flow.score,
        flowStoplight: health.flow.stoplight,
        riskScore: health.risk.score,
        riskStoplight: health.risk.stoplight,
        improvementScore: health.improvement.score,
        executionScore: health.execution.score,
        completionRate,
        openItemCount: openItems.length,
        totalItemCount: wf.items.length,
        avgItemAgeDays,
        stageCount: wf.stages.length,
        alertCount: wfAlerts.length,
        criticalAlertCount: wfAlerts.filter((a) => a.severity === "critical").length,
      };
    });

    // Sort by health score ascending (worst first) so attention areas are top
    result.sort((a, b) => a.healthScore - b.healthScore);

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get workflow performance");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
