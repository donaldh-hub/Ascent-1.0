import {
  pgTable, serial, text, integer, real, jsonb, timestamp, boolean,
} from "drizzle-orm/pg-core";
import { propertiesTable, unitsTable } from "./properties";

// ─── Turn Status ──────────────────────────────────────────────────────────────

export const TURN_STATUSES = ["active", "completed", "in_rework"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

// ─── Stage Sequence ───────────────────────────────────────────────────────────

export const TURN_STAGE_SEQUENCE = [
  "Trash Out",
  "Maintenance",
  "Paint Prep",
  "Paint",
  "Flooring",
  "Cleaning",
  "Inspection",
  "Rework",
  "Completed",
] as const;

export type TurnStage = (typeof TURN_STAGE_SEQUENCE)[number];

// ─── Table ────────────────────────────────────────────────────────────────────

export const turnsTable = pgTable("turns", {
  id: serial("id").primaryKey(),

  // External identifier (from CSV: turn_id)
  turnId: text("turn_id"),

  // Physical linkage (resolved from property_name / unit_id in CSV)
  propertyId: integer("property_id").references(() => propertiesTable.id),
  unitId: integer("unit_id").references(() => unitsTable.id),

  // Raw import values (before matching)
  propertyNameRaw: text("property_name_raw"),
  unitNumber: text("unit_number"),

  // Status + stage
  turnStatus: text("turn_status").notNull().default("active"),
  currentStage: text("current_stage"),

  // Completion
  completionPercentage: real("completion_percentage").notNull().default(0),

  // Rent-ready signal
  rentReady: boolean("rent_ready").notNull().default(false),

  // Inspection
  inspectionPassed: boolean("inspection_passed").notNull().default(false),

  // Rework
  reworkRequired: boolean("rework_required").notNull().default(false),
  reworkCompleted: boolean("rework_completed").notNull().default(false),

  // Aging
  daysInStage: integer("days_in_stage").notNull().default(0),
  totalDaysOpen: integer("total_days_open").notNull().default(0),

  // Blockage
  isBlocked: boolean("is_blocked").notNull().default(false),
  blockedStage: text("blocked_stage"),

  // Explainability
  blockReason: text("block_reason"),

  // Import metadata
  importBatchId: text("import_batch_id"),
  rawData: jsonb("raw_data").$type<Record<string, string>>(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Turn = typeof turnsTable.$inferSelect;
export type InsertTurn = typeof turnsTable.$inferInsert;
