import { Router } from "express";
import { db } from "@workspace/db";
import {
  workflowItemsTable,
  workflowItemHistoryTable,
  stagesTable,
  insertWorkflowItemSchema,
} from "@workspace/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

const router = Router({ mergeParams: true });

function daysAgo(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

async function enrichItem(item: typeof workflowItemsTable.$inferSelect, stage?: typeof stagesTable.$inferSelect) {
  const stageName = stage ? stage.name : "Unknown";
  return {
    ...item,
    stageName,
    daysInCurrentStage: daysAgo(new Date(item.stageEnteredAt)),
    daysOpen: daysAgo(new Date(item.createdAt)),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    stageEnteredAt: item.stageEnteredAt.toISOString(),
  };
}

// GET /workflows/:id/items
router.get("/", async (req, res) => {
  const workflowId = Number(req.params.id);
  const { stageId, priority, status } = req.query;

  const conditions = [eq(workflowItemsTable.workflowId, workflowId)];
  if (stageId) conditions.push(eq(workflowItemsTable.stageId, Number(stageId)));
  if (priority) conditions.push(eq(workflowItemsTable.priority, String(priority)));
  if (status) conditions.push(eq(workflowItemsTable.status, String(status)));

  const items = await db
    .select()
    .from(workflowItemsTable)
    .where(and(...conditions))
    .orderBy(desc(workflowItemsTable.createdAt));

  const stages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.workflowId, workflowId));
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  const enriched = await Promise.all(items.map((i) => enrichItem(i, stageMap.get(i.stageId))));
  res.json(enriched);
});

// POST /workflows/:id/items
router.post("/", async (req, res) => {
  const workflowId = Number(req.params.id);
  const body = req.body;

  // Default to first stage if no stageId provided
  let stageId = body.stageId;
  if (!stageId) {
    const [firstStage] = await db
      .select()
      .from(stagesTable)
      .where(eq(stagesTable.workflowId, workflowId))
      .orderBy(stagesTable.order)
      .limit(1);
    if (!firstStage) {
      return res.status(400).json({ error: "Workflow has no stages" });
    }
    stageId = firstStage.id;
  }

  const insertData = insertWorkflowItemSchema.parse({
    workflowId,
    stageId,
    title: body.title,
    description: body.description ?? null,
    priority: body.priority ?? "medium",
    status: "open",
    assignedTo: body.assignedTo ?? null,
    dueDate: body.dueDate ?? null,
  });

  const [item] = await db.insert(workflowItemsTable).values(insertData).returning();

  // Log initial stage entry in history
  await db.insert(workflowItemHistoryTable).values({
    itemId: item.id,
    fromStageId: null,
    toStageId: item.stageId,
    movedBy: "system",
    notes: "Item created",
  });

  const [stage] = await db.select().from(stagesTable).where(eq(stagesTable.id, item.stageId));
  res.status(201).json(await enrichItem(item, stage));
});

// GET /workflows/:id/items/:itemId
router.get("/:itemId", async (req, res) => {
  const itemId = Number(req.params.itemId);
  const workflowId = Number(req.params.id);

  const [item] = await db
    .select()
    .from(workflowItemsTable)
    .where(and(eq(workflowItemsTable.id, itemId), eq(workflowItemsTable.workflowId, workflowId)));

  if (!item) return res.status(404).json({ error: "Item not found" });

  const [stage] = await db.select().from(stagesTable).where(eq(stagesTable.id, item.stageId));

  const historyRows = await db
    .select()
    .from(workflowItemHistoryTable)
    .where(eq(workflowItemHistoryTable.itemId, itemId))
    .orderBy(workflowItemHistoryTable.movedAt);

  // Get stage names for history
  const allStages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.workflowId, workflowId));
  const stageMap = new Map(allStages.map((s) => [s.id, s]));

  const history = historyRows.map((h) => ({
    ...h,
    fromStageName: h.fromStageId ? (stageMap.get(h.fromStageId)?.name ?? null) : null,
    toStageName: stageMap.get(h.toStageId)?.name ?? "Unknown",
    movedAt: h.movedAt.toISOString(),
  }));

  const enriched = await enrichItem(item, stage);
  res.json({ ...enriched, history });
});

// PUT /workflows/:id/items/:itemId
router.put("/:itemId", async (req, res) => {
  const itemId = Number(req.params.itemId);
  const workflowId = Number(req.params.id);
  const body = req.body;

  const validPriorities = ["low", "medium", "high", "critical"];
  const validStatuses = ["open", "in_progress", "completed", "blocked"];
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = String(body.title);
  if (body.description !== undefined) data.description = body.description ?? null;
  if (body.priority !== undefined && validPriorities.includes(body.priority)) data.priority = body.priority;
  if (body.status !== undefined && validStatuses.includes(body.status)) data.status = body.status;
  if (body.assignedTo !== undefined) data.assignedTo = body.assignedTo ?? null;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ?? null;

  const [item] = await db
    .update(workflowItemsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(workflowItemsTable.id, itemId), eq(workflowItemsTable.workflowId, workflowId)))
    .returning();

  if (!item) return res.status(404).json({ error: "Item not found" });

  const [stage] = await db.select().from(stagesTable).where(eq(stagesTable.id, item.stageId));
  res.json(await enrichItem(item, stage));
});

// DELETE /workflows/:id/items/:itemId
router.delete("/:itemId", async (req, res) => {
  const itemId = Number(req.params.itemId);
  const workflowId = Number(req.params.id);

  await db
    .delete(workflowItemHistoryTable)
    .where(eq(workflowItemHistoryTable.itemId, itemId));

  const [deleted] = await db
    .delete(workflowItemsTable)
    .where(and(eq(workflowItemsTable.id, itemId), eq(workflowItemsTable.workflowId, workflowId)))
    .returning();

  if (!deleted) return res.status(404).json({ error: "Item not found" });
  res.status(204).send();
});

// POST /workflows/:id/items/:itemId/move
router.post("/:itemId/move", async (req, res) => {
  const itemId = Number(req.params.itemId);
  const workflowId = Number(req.params.id);
  const { toStageId, notes, movedBy } = req.body;

  if (!toStageId) return res.status(400).json({ error: "toStageId is required" });

  const [item] = await db
    .select()
    .from(workflowItemsTable)
    .where(and(eq(workflowItemsTable.id, itemId), eq(workflowItemsTable.workflowId, workflowId)));

  if (!item) return res.status(404).json({ error: "Item not found" });

  // Verify target stage exists in this workflow
  const [targetStage] = await db
    .select()
    .from(stagesTable)
    .where(and(eq(stagesTable.id, toStageId), eq(stagesTable.workflowId, workflowId)));

  if (!targetStage) return res.status(400).json({ error: "Target stage not found in this workflow" });

  // Get all stages to check if this is the final stage
  const allStages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.workflowId, workflowId))
    .orderBy(stagesTable.order);
  const finalStage = allStages[allStages.length - 1];
  const isFinalStage = finalStage && targetStage.id === finalStage.id;

  // Log history
  await db.insert(workflowItemHistoryTable).values({
    itemId,
    fromStageId: item.stageId,
    toStageId,
    movedBy: movedBy ?? "user",
    notes: notes ?? null,
  });

  // Update item
  const [updated] = await db
    .update(workflowItemsTable)
    .set({
      stageId: toStageId,
      stageEnteredAt: new Date(),
      updatedAt: new Date(),
      status: isFinalStage ? "completed" : item.status === "completed" ? "open" : item.status,
    })
    .where(eq(workflowItemsTable.id, itemId))
    .returning();

  res.json(await enrichItem(updated, targetStage));
});

// GET /workflows/:id/items/:itemId/history
router.get("/:itemId/history", async (req, res) => {
  const itemId = Number(req.params.itemId);
  const workflowId = Number(req.params.id);

  const allStages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.workflowId, workflowId));
  const stageMap = new Map(allStages.map((s) => [s.id, s]));

  const history = await db
    .select()
    .from(workflowItemHistoryTable)
    .where(eq(workflowItemHistoryTable.itemId, itemId))
    .orderBy(workflowItemHistoryTable.movedAt);

  res.json(
    history.map((h) => ({
      ...h,
      fromStageName: h.fromStageId ? (stageMap.get(h.fromStageId)?.name ?? null) : null,
      toStageName: stageMap.get(h.toStageId)?.name ?? "Unknown",
      movedAt: h.movedAt.toISOString(),
    }))
  );
});

export default router;
