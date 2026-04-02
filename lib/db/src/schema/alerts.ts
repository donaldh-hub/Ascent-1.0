import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Phase 1 – Build 4: Alert and Warning Engine
 *
 * Extended alerts table with full lifecycle, deduplication, and rule linkage.
 * Legacy fields (severity, isRead) kept for backward compatibility.
 */
export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),

  // Categorization
  type: text("type").notNull(),
  category: text("category").notNull().default("status_alert"), // status_alert | timing_alert | flow_alert | risk_alert
  level: text("level").notNull().default("informational"), // informational | warning | critical
  severity: text("severity").notNull().default("info"), // legacy compat: info | warning | critical

  // Content
  title: text("title").notNull(),
  message: text("message").notNull(),
  actionPath: text("action_path"), // e.g. "/workflows/1" — where to navigate for resolution

  // Entity linkage
  workflowId: integer("workflow_id"),
  assetId: integer("asset_id"),
  linkedItemId: integer("linked_item_id"),
  linkedStageId: integer("linked_stage_id"),

  // Deduplication key — prevents duplicate alerts for the same condition
  ruleKey: text("rule_key"),

  // Lifecycle
  status: text("status").notNull().default("active"), // active | acknowledged | resolved
  isActive: boolean("is_active").notNull().default(true),
  isRead: boolean("is_read").notNull().default(false), // legacy compat

  // Timestamps
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),

  // Extra context payload
  metadata: jsonb("metadata"),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  url: text("url"),
  detectedType: text("detected_type"),
  workflowId: integer("workflow_id"),
  stageId: integer("stage_id"),
  assetId: integer("asset_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
