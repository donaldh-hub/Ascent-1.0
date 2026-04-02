import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workflowsTable,
  stagesTable,
  impactEventsTable,
  alertsTable,
  documentsTable,
  insertWorkflowSchema,
  insertStageSchema,
} from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  CreateWorkflowBody,
  UpdateWorkflowBody,
  CreateStageBody,
  UpdateStageBody,
  ListWorkflowsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function calcStoplight(score: number): string {
  if (score >= 75) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

function calcWorkflowScores(stages: typeof stagesTable.$inferSelect[]) {
  if (stages.length === 0) {
    return { flowScore: 80, riskScore: 80, improvementScore: 80, executionScore: 80, healthScore: 80 };
  }
  const completed = stages.filter((s) => s.status === "completed").length;
  const blocked = stages.filter((s) => s.status === "blocked").length;
  const overdue = stages.filter((s) => s.status === "overdue").length;
  const bottlenecks = stages.filter((s) => s.isBottleneck).length;
  const total = stages.length;

  const completionRate = completed / total;
  const flowScore = Math.round(Math.max(10, (completionRate * 100) - blocked * 20 - bottlenecks * 15));
  const riskScore = Math.round(Math.max(10, 100 - overdue * 25 - blocked * 15));
  const improvementScore = Math.round(Math.max(10, completionRate * 90 + 10));
  const executionScore = Math.round(Math.max(10, (completionRate * 100) - overdue * 20));
  const healthScore = Math.round((flowScore + riskScore + improvementScore + executionScore) / 4);

  return { flowScore, riskScore, improvementScore, executionScore, healthScore };
}

function enrichStage(stage: typeof stagesTable.$inferSelect) {
  const daysInStage = stage.startedAt
    ? Math.round((Date.now() - new Date(stage.startedAt).getTime()) / 86400000)
    : null;
  return { ...stage, daysInStage };
}

router.get("/workflows", async (req, res) => {
  try {
    const query = ListWorkflowsQueryParams.parse(req.query);
    let rows = await db.select().from(workflowsTable);

    if (query.status) rows = rows.filter((w) => w.status === query.status);
    if (query.stoplight) rows = rows.filter((w) => w.stoplight === query.stoplight);

    const allStages = await db.select().from(stagesTable);
    const result = rows.map((w) => {
      const stages = allStages.filter((s) => s.workflowId === w.id);
      return {
        ...w,
        stagesCount: stages.length,
        completedStagesCount: stages.filter((s) => s.status === "completed").length,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      };
    });

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
    const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, id));
    if (!workflow) return res.status(404).json({ error: "Not found" });

    const stages = await db.select().from(stagesTable).where(eq(stagesTable.workflowId, id));
    const scores = calcWorkflowScores(stages);
    const stoplight = calcStoplight(scores.healthScore);

    const bottleneck = stages.find((s) => s.isBottleneck);
    const overdueStages = stages.filter((s) => s.status === "overdue").length;
    const totalDelayDays = stages.reduce((acc, s) => {
      if (s.startedAt && (s.status === "blocked" || s.status === "overdue")) {
        return acc + Math.round((Date.now() - new Date(s.startedAt).getTime()) / 86400000);
      }
      return acc;
    }, 0);

    let recommendation = "Workflow is on track.";
    if (scores.healthScore < 50) recommendation = "Critical: multiple stages blocked or overdue. Immediate action required.";
    else if (scores.healthScore < 75) recommendation = "Warning: bottlenecks detected. Review blocked stages and reassign if needed.";

    res.json({
      workflowId: id,
      ...scores,
      stoplight,
      totalDelayDays,
      estimatedCostImpact: totalDelayDays * 500,
      bottleneckStageId: bottleneck?.id ?? null,
      bottleneckStageName: bottleneck?.name ?? null,
      recommendation,
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

export default router;
