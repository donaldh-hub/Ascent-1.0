import { pgTable, serial, text, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workflowsTable = pgTable("workflows", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  stoplight: text("stoplight").notNull().default("green"),
  flowScore: real("flow_score").notNull().default(80),
  riskScore: real("risk_score").notNull().default(80),
  improvementScore: real("improvement_score").notNull().default(80),
  executionScore: real("execution_score").notNull().default(80),
  healthScore: real("health_score").notNull().default(80),
  owner: text("owner"),
  dueDate: text("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWorkflowSchema = createInsertSchema(workflowsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflowsTable.$inferSelect;

export const stagesTable = pgTable("stages", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull(),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  status: text("status").notNull().default("pending"),
  stoplight: text("stoplight").notNull().default("green"),
  owner: text("owner"),
  dueDate: text("due_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  isBottleneck: boolean("is_bottleneck").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStageSchema = createInsertSchema(stagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStage = z.infer<typeof insertStageSchema>;
export type Stage = typeof stagesTable.$inferSelect;

export const impactEventsTable = pgTable("impact_events", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull(),
  eventType: text("event_type").notNull(),
  description: text("description").notNull(),
  costImpact: real("cost_impact"),
  timeImpactDays: real("time_impact_days"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertImpactEventSchema = createInsertSchema(impactEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertImpactEvent = z.infer<typeof insertImpactEventSchema>;
export type ImpactEvent = typeof impactEventsTable.$inferSelect;

export const workflowItemsTable = pgTable("workflow_items", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull(),
  stageId: integer("stage_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  assignedTo: text("assigned_to"),
  dueDate: text("due_date"),
  stageEnteredAt: timestamp("stage_entered_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWorkflowItemSchema = createInsertSchema(workflowItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  stageEnteredAt: true,
});
export type InsertWorkflowItem = z.infer<typeof insertWorkflowItemSchema>;
export type WorkflowItem = typeof workflowItemsTable.$inferSelect;

export const workflowItemHistoryTable = pgTable("workflow_item_history", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  fromStageId: integer("from_stage_id"),
  toStageId: integer("to_stage_id").notNull(),
  movedBy: text("moved_by"),
  notes: text("notes"),
  movedAt: timestamp("moved_at").notNull().defaultNow(),
});

export const insertWorkflowItemHistorySchema = createInsertSchema(workflowItemHistoryTable).omit({
  id: true,
  movedAt: true,
});
export type InsertWorkflowItemHistory = z.infer<typeof insertWorkflowItemHistorySchema>;
export type WorkflowItemHistory = typeof workflowItemHistoryTable.$inferSelect;
