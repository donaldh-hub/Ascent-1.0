import {
  pgTable, serial, text, integer, real, jsonb, timestamp, boolean,
} from "drizzle-orm/pg-core";
import { propertiesTable, unitsTable } from "./properties";
import { assetsTable } from "./assets";

// ─── Work Order Status ────────────────────────────────────────────────────────

export const WORK_ORDER_STATUSES = [
  "submitted",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

// ─── SLA Status ───────────────────────────────────────────────────────────────

export const SLA_STATUSES = ["pending", "met", "missed"] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];

// ─── Priority ─────────────────────────────────────────────────────────────────

export const WORK_ORDER_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

// ─── Table ────────────────────────────────────────────────────────────────────

export const workOrdersTable = pgTable("work_orders", {
  id: serial("id").primaryKey(),

  // External identifier from source system / CSV
  externalId: text("external_id"),

  // Physical linkage
  propertyId: integer("property_id").references(() => propertiesTable.id),
  unitId: integer("unit_id").references(() => unitsTable.id),
  assetId: integer("asset_id").references(() => assetsTable.id),

  // Workflow linkage (created after import)
  workflowItemId: integer("workflow_item_id"),

  // Core fields
  category: text("category"),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("submitted"),
  assignedTo: text("assigned_to"),
  notes: text("notes"),

  // Hierarchical context from import
  regionName: text("region_name"),
  propertyNameRaw: text("property_name_raw"),  // original CSV value before matching
  unitNumberRaw: text("unit_number_raw"),       // original CSV value

  // Turn context
  turnId: text("turn_id"),

  // Timeline
  createdDate: timestamp("created_date"),
  scheduledDate: timestamp("scheduled_date"),
  firstResponseDate: timestamp("first_response_date"),
  completedDate: timestamp("completed_date"),

  // Labor hours
  estimatedHours: real("estimated_hours"),
  actualHours: real("actual_hours"),

  // SLA
  slaDeadlineHours: integer("sla_deadline_hours").notNull().default(24),
  slaStatus: text("sla_status").notNull().default("pending"),
  slaResponseDelayHours: real("sla_response_delay_hours"),

  // Turn stage tracking
  stage: text("stage"),             // e.g. "Flooring", "Maintenance", "Inspection"
  stageStatus: text("stage_status"), // in_progress | completed | not_started
  daysInStage: integer("days_in_stage"),

  // Blockage
  isBlocked: boolean("is_blocked").notNull().default(false),
  delayReason: text("delay_reason"),
  vendor: text("vendor"),

  // Bottleneck intelligence
  bottleneckFlag: boolean("bottleneck_flag").notNull().default(false),
  bottleneckType: text("bottleneck_type"), // stage_congestion | blocked_gate_stage | rework_loop | inspection_queue | vendor_delay | none
  aggregationScope: text("aggregation_scope"),

  // Flags
  isSystemGenerated: boolean("is_system_generated").notNull().default(false),

  // Raw source data (original CSV row)
  rawData: jsonb("raw_data").$type<Record<string, string>>(),

  // Import metadata
  importBatchId: text("import_batch_id"),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkOrder = typeof workOrdersTable.$inferSelect;
export type InsertWorkOrder = typeof workOrdersTable.$inferInsert;
