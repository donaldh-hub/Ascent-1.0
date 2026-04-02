/**
 * Data loader: assembles WorkflowInput objects from DB data for use by the scoring engine.
 * Keeps all DB access outside the pure scoring functions.
 */

import { db } from "@workspace/db";
import {
  workflowsTable,
  stagesTable,
  workflowItemsTable,
  workflowItemHistoryTable,
  alertsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { WorkflowInput, ItemInput, StageInput, HistoryInput } from "./scoring";

export async function loadWorkflowInput(workflowId: number): Promise<WorkflowInput | null> {
  const [workflow] = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId));

  if (!workflow) return null;

  const stages = await db.select().from(stagesTable).where(eq(stagesTable.workflowId, workflowId));
  const items = await db.select().from(workflowItemsTable).where(eq(workflowItemsTable.workflowId, workflowId));
  const history = await db.select().from(workflowItemHistoryTable);

  const itemIds = items.map((i) => i.id);
  const relevantHistory = history.filter((h) => itemIds.includes(h.itemId));

  return {
    id: workflow.id,
    title: workflow.title,
    status: workflow.status,
    stages: stages.map((s): StageInput => ({
      id: s.id,
      workflowId: s.workflowId,
      name: s.name,
      order: s.order,
      status: s.status,
      isBottleneck: s.isBottleneck,
      startedAt: s.startedAt ?? null,
    })),
    items: items.map((i): ItemInput => ({
      id: i.id,
      workflowId: i.workflowId,
      stageId: i.stageId,
      title: i.title,
      priority: i.priority,
      status: i.status,
      assignedTo: i.assignedTo ?? null,
      dueDate: i.dueDate ?? null,
      stageEnteredAt: i.stageEnteredAt,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
    history: relevantHistory.map((h): HistoryInput => ({
      itemId: h.itemId,
      movedAt: h.movedAt,
    })),
  };
}

export async function loadAllWorkflowInputs(): Promise<WorkflowInput[]> {
  const allWorkflows = await db.select().from(workflowsTable);
  const allStages = await db.select().from(stagesTable);
  const allItems = await db.select().from(workflowItemsTable);
  const allHistory = await db.select().from(workflowItemHistoryTable);

  return allWorkflows.map((workflow): WorkflowInput => {
    const stages = allStages.filter((s) => s.workflowId === workflow.id);
    const items = allItems.filter((i) => i.workflowId === workflow.id);
    const itemIds = items.map((i) => i.id);
    const history = allHistory.filter((h) => itemIds.includes(h.itemId));

    return {
      id: workflow.id,
      title: workflow.title,
      status: workflow.status,
      stages: stages.map((s): StageInput => ({
        id: s.id,
        workflowId: s.workflowId,
        name: s.name,
        order: s.order,
        status: s.status,
        isBottleneck: s.isBottleneck,
        startedAt: s.startedAt ?? null,
      })),
      items: items.map((i): ItemInput => ({
        id: i.id,
        workflowId: i.workflowId,
        stageId: i.stageId,
        title: i.title,
        priority: i.priority,
        status: i.status,
        assignedTo: i.assignedTo ?? null,
        dueDate: i.dueDate ?? null,
        stageEnteredAt: i.stageEnteredAt,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      })),
      history: history.map((h): HistoryInput => ({
        itemId: h.itemId,
        movedAt: h.movedAt,
      })),
    };
  });
}

export async function loadAlerts() {
  return db.select().from(alertsTable);
}
