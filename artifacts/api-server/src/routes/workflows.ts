import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workflowsTable,
  stagesTable,
  impactEventsTable,
  alertsTable,
  documentsTable,
  workflowItemsTable,
  insertWorkflowSchema,
  insertStageSchema,
} from "@workspace/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  CreateWorkflowBody,
  UpdateWorkflowBody,
  CreateStageBody,
  UpdateStageBody,
  ListWorkflowsQueryParams,
} from "@workspace/api-zod";
import { loadWorkflowInput } from "../engine/loader";
import { calcWorkflowHealth, calcStoplight } from "../engine/scoring";

const router: IRouter = Router();

function enrichStage(stage: typeof stagesTable.$inferSelect) {
  const daysInStage = stage.startedAt
    ? Math.round((Date.now() - new Date(stage.startedAt).getTime()) / 86400000)
    : null;
  return { ...stage, daysInStage };
}

router.get("/workflows", async (req, res) => {
  try {
    const query = ListWorkflowsQueryParams.parse(req.query);
    const { loadAllWorkflowInputs } = await import("../engine/loader");
    const { calcWorkflowHealth } = await import("../engine/scoring");

    const allWorkflowInputs = await loadAllWorkflowInputs();

    const result = allWorkflowInputs
      .map((wfInput) => {
        const health = calcWorkflowHealth(wfInput);
        return {
          id: wfInput.id,
          title: wfInput.title,
          status: wfInput.status,
          healthScore: health.healthScore,
          stoplight: health.stoplight,
          insight: health.insight,
          flowScore: health.flow.score,
          riskScore: health.risk.score,
          improvementScore: health.improvement.score,
          executionScore: health.execution.score,
          stagesCount: wfInput.stages.length,
          completedStagesCount: wfInput.stages.filter((s) => s.status === "completed").length,
          openItemCount: wfInput.items.filter((i) => i.status !== "completed").length,
          totalItemCount: wfInput.items.length,
        };
      })
      .filter((w) => {
        if (query.status && w.status !== query.status) return false;
        if (query.stoplight && w.stoplight !== query.stoplight) return false;
        return true;
      });

    // Persist computed scores back to DB in background (non-blocking)
    Promise.allSettled(
      result.map((r) =>
        db.update(workflowsTable).set({
          healthScore: r.healthScore,
          stoplight: r.stoplight as "green" | "yellow" | "red",
          flowScore: r.flowScore,
          riskScore: r.riskScore,
          improvementScore: r.improvementScore,
          executionScore: r.executionScore,
          updatedAt: new Date(),
        }).where(eq(workflowsTable.id, r.id))
      )
    ).catch(() => {});

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list workflows");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/workflows", async (req, res) => {
  try {
    const body = CreateWorkflowBody.parse(req.body);
    const [workflow] = await db
      .insert(workflowsTable)
      .values({
        title: body.title,
        description: body.description ?? null,
        owner: body.owner ?? null,
        dueDate: body.dueDate ?? null,
      })
      .returning();

    res.status(201).json({
      ...workflow,
      stagesCount: 0,
      completedStagesCount: 0,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create workflow");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/workflows/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, id));
    if (!workflow) return res.status(404).json({ error: "Not found" });

    const stages = await db.select().from(stagesTable).where(eq(stagesTable.workflowId, id));
    const documents = await db.select().from(documentsTable).where(eq(documentsTable.workflowId, id));
    const alerts = await db.select().from(alertsTable).where(eq(alertsTable.workflowId, id));
    const impactEvents = await db.select().from(impactEventsTable).where(eq(impactEventsTable.workflowId, id));

    res.json({
      ...workflow,
      stagesCount: stages.length,
      completedStagesCount: stages.filter((s) => s.status === "completed").length,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
      stages: stages.map((s) => ({
        ...enrichStage(s),
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
      documents: documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
      alerts: alerts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      impactEvents: impactEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get workflow");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/workflows/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = UpdateWorkflowBody.parse(req.body);
    const [workflow] = await db
      .update(workflowsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(workflowsTable.id, id))
      .returning();

    if (!workflow) return res.status(404).json({ error: "Not found" });

    const stages = await db.select().from(stagesTable).where(eq(stagesTable.workflowId, id));
    res.json({
      ...workflow,
      stagesCount: stages.length,
      completedStagesCount: stages.filter((s) => s.status === "completed").length,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update workflow");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/workflows/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(workflowsTable).where(eq(workflowsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete workflow");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/workflows/:id/health", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const wfInput = await loadWorkflowInput(id);
    if (!wfInput) return res.status(404).json({ error: "Not found" });

    const health = calcWorkflowHealth(wfInput);

    // Persist computed scores back to DB so list queries stay fast
    await db.update(workflowsTable).set({
      healthScore: health.healthScore,
      stoplight: health.stoplight,
      flowScore: health.flow.score,
      riskScore: health.risk.score,
      improvementScore: health.improvement.score,
      executionScore: health.execution.score,
      updatedAt: new Date(),
    }).where(eq(workflowsTable.id, id));

    // Find bottleneck stage (most congested)
    const openItems = wfInput.items.filter((i) => i.status !== "completed");
    const stageCounts = openItems.reduce((acc, i) => {
      acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    const maxCount = Math.max(0, ...Object.values(stageCounts));
    const bottleneckStageId = maxCount >= 2
      ? Number(Object.keys(stageCounts).find((k) => stageCounts[Number(k)] === maxCount))
      : null;
    const bottleneckStage = bottleneckStageId
      ? wfInput.stages.find((s) => s.id === bottleneckStageId)
      : null;

    res.json({
      workflowId: id,
      healthScore: health.healthScore,
      stoplight: health.stoplight,
      insight: health.insight,
      flowScore: health.flow.score,
      flowStoplight: health.flow.stoplight,
      flowInsight: health.flow.insight,
      riskScore: health.risk.score,
      riskStoplight: health.risk.stoplight,
      riskInsight: health.risk.insight,
      improvementScore: health.improvement.score,
      improvementStoplight: health.improvement.stoplight,
      improvementInsight: health.improvement.insight,
      executionScore: health.execution.score,
      executionStoplight: health.execution.stoplight,
      executionInsight: health.execution.insight,
      bottleneckStageId: bottleneckStage?.id ?? null,
      bottleneckStageName: bottleneckStage?.name ?? null,
      openItemCount: openItems.length,
      totalItemCount: wfInput.items.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get workflow health");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/workflows/:id/stages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const stages = await db.select().from(stagesTable).where(eq(stagesTable.workflowId, id));
    res.json(
      stages
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          ...enrichStage(s),
          startedAt: s.startedAt?.toISOString() ?? null,
          completedAt: s.completedAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
        }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list stages");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/workflows/:id/stages", async (req, res) => {
  try {
    const workflowId = parseInt(req.params.id);
    const body = CreateStageBody.parse(req.body);
    const [stage] = await db
      .insert(stagesTable)
      .values({ workflowId, ...body })
      .returning();

    res.status(201).json({
      ...enrichStage(stage),
      startedAt: stage.startedAt?.toISOString() ?? null,
      completedAt: stage.completedAt?.toISOString() ?? null,
      createdAt: stage.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create stage");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/workflows/:id/stages/:stageId", async (req, res) => {
  try {
    const stageId = parseInt(req.params.stageId);
    const body = UpdateStageBody.parse(req.body);

    const updates: Record<string, unknown> = { ...body };
    if (body.status === "in_progress") updates.startedAt = new Date();
    if (body.status === "completed") updates.completedAt = new Date();
    if (body.status) {
      updates.stoplight =
        body.status === "completed"
          ? "green"
          : body.status === "blocked" || body.status === "overdue"
          ? "red"
          : body.status === "in_progress"
          ? "yellow"
          : "green";
    }

    const [stage] = await db
      .update(stagesTable)
      .set(updates)
      .where(eq(stagesTable.id, stageId))
      .returning();

    if (!stage) return res.status(404).json({ error: "Not found" });

    const workflowId = parseInt(req.params.id);
    const stages = await db.select().from(stagesTable).where(eq(stagesTable.workflowId, workflowId));
    const scores = calcWorkflowScores(stages);
    await db
      .update(workflowsTable)
      .set({ ...scores, stoplight: calcStoplight(scores.healthScore), updatedAt: new Date() })
      .where(eq(workflowsTable.id, workflowId));

    res.json({
      ...enrichStage(stage),
      startedAt: stage.startedAt?.toISOString() ?? null,
      completedAt: stage.completedAt?.toISOString() ?? null,
      createdAt: stage.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update stage");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/workflows/:id/stages/:stageId", async (req, res) => {
  try {
    const stageId = parseInt(req.params.stageId);
    await db.delete(stagesTable).where(eq(stagesTable.id, stageId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete stage");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/workflows/:id/bottleneck", async (req, res) => {
  try {
    const workflowId = parseInt(req.params.id);

    const stages = await db
      .select()
      .from(stagesTable)
      .where(eq(stagesTable.workflowId, workflowId))
      .orderBy(stagesTable.order);

    const items = await db
      .select()
      .from(workflowItemsTable)
      .where(eq(workflowItemsTable.workflowId, workflowId));

    const openItems = items.filter((i) => i.status !== "completed");

    const stageSummary = stages.map((stage) => {
      const stageItems = openItems.filter((i) => i.stageId === stage.id);
      const daysInStage = stageItems.map((i) =>
        (Date.now() - new Date(i.stageEnteredAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      const avgDays = daysInStage.length > 0 ? daysInStage.reduce((a, b) => a + b, 0) / daysInStage.length : 0;
      const oldest = daysInStage.length > 0 ? Math.max(...daysInStage) : 0;
      return {
        stageId: stage.id,
        stageName: stage.name,
        stageOrder: stage.order,
        itemCount: stageItems.length,
        avgDaysInStage: Math.round(avgDays * 10) / 10,
        oldestItemDays: Math.round(oldest * 10) / 10,
      };
    });

    // Find bottleneck stage: highest item count among open items
    const bottleneckStage = stageSummary.reduce(
      (max, s) => (s.itemCount > max.itemCount ? s : max),
      stageSummary[0] ?? { stageId: 0, stageName: "", stageOrder: 0, itemCount: 0, avgDaysInStage: 0, oldestItemDays: 0 }
    );

    // Find oldest aging item
    let oldestItem = null;
    if (openItems.length > 0) {
      const oldest = openItems.reduce((max, i) => {
        const daysInStage = (Date.now() - new Date(i.stageEnteredAt).getTime()) / (1000 * 60 * 60 * 24);
        const maxDays = (Date.now() - new Date(max.stageEnteredAt).getTime()) / (1000 * 60 * 60 * 24);
        return daysInStage > maxDays ? i : max;
      });
      const oldestStage = stages.find((s) => s.id === oldest.stageId);
      oldestItem = {
        id: oldest.id,
        title: oldest.title,
        stageId: oldest.stageId,
        stageName: oldestStage?.name ?? "Unknown",
        daysInStage: Math.round((Date.now() - new Date(oldest.stageEnteredAt).getTime()) / (1000 * 60 * 60 * 24) * 10) / 10,
      };
    }

    const hasBottleneck = bottleneckStage.itemCount >= 2 || (oldestItem?.daysInStage ?? 0) > 7;

    const insights: string[] = [];
    if (bottleneckStage.itemCount >= 2) {
      insights.push(`Stage "${bottleneckStage.stageName}" has the highest item volume (${bottleneckStage.itemCount} open items).`);
    }
    if (oldestItem && oldestItem.daysInStage > 7) {
      insights.push(`"${oldestItem.stageName}" is the oldest aging stage — item "${oldestItem.title}" has been here ${Math.round(oldestItem.daysInStage)} days.`);
    }
    if (openItems.length === 0) {
      insights.push("No open items. Workflow is clear.");
    }
    if (insights.length === 0) {
      insights.push("No significant bottlenecks detected.");
    }

    res.json({
      workflowId,
      hasBottleneck,
      bottleneckStageId: hasBottleneck ? bottleneckStage.stageId : null,
      bottleneckStageName: hasBottleneck ? bottleneckStage.stageName : null,
      bottleneckItemCount: bottleneckStage.itemCount,
      oldestItem,
      insights,
      stageSummary,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get bottleneck analysis");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
