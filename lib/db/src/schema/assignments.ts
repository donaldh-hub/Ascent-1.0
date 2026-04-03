import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Source types ─────────────────────────────────────────────────────────────

export const ASSIGNMENT_SOURCE_TYPES = [
  "work_order",
  "warranty",
  "service_log",
  "turn_log",
  "csv_row",
] as const;
export type AssignmentSourceType = (typeof ASSIGNMENT_SOURCE_TYPES)[number];

// ─── Confidence levels ────────────────────────────────────────────────────────

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

// ─── Statuses ─────────────────────────────────────────────────────────────────

export const ASSIGNMENT_STATUSES = ["assigned", "pending", "rejected"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// ─── Methods ──────────────────────────────────────────────────────────────────

export const ASSIGNMENT_METHODS = ["auto", "suggested", "manual"] as const;
export type AssignmentMethod = (typeof ASSIGNMENT_METHODS)[number];

// ─── Table ────────────────────────────────────────────────────────────────────

export const assignmentsTable = pgTable("assignments", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  sourceData: jsonb("source_data").$type<Record<string, unknown>>().notNull(),
  targetEntityType: text("target_entity_type"),
  targetEntityId: integer("target_entity_id"),
  confidenceLevel: text("confidence_level").notNull(),
  assignmentMethod: text("assignment_method"),
  status: text("status").notNull().default("pending"),
  explanation: text("explanation").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAssignmentSchema = createInsertSchema(assignmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignmentsTable.$inferSelect;
