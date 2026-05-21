import {
  pgTable, serial, text, integer, jsonb, timestamp,
} from "drizzle-orm/pg-core";

/**
 * Ascent 7.2.1 — Turn / Work Order Reporting Mode
 *
 * Stores per-organization (and optionally per-property) configuration that
 * tells the reporting analysis layer how this organization tracks turn
 * progress. Three values are allowed:
 *
 *   - separate_turns_and_work_orders     — turns and WOs are independent
 *   - work_orders_measure_turn_progress  — WOs ARE the turn proof
 *   - hybrid_or_unknown                  — keep separate, flag candidates
 *
 * Organizations table does not yet exist; for now we store a singleton-style
 * default row with organizationId IS NULL. Property override is supported
 * by schema but not yet surfaced in the UI per Build 7.2.1 scope notes.
 */

export const TURN_WORK_ORDER_REPORTING_MODES = [
  "separate_turns_and_work_orders",
  "work_orders_measure_turn_progress",
  "hybrid_or_unknown",
] as const;

export type TurnWorkOrderReportingMode =
  (typeof TURN_WORK_ORDER_REPORTING_MODES)[number];

export const REPORTING_CONFIG_SOURCES = [
  "user_selected",
  "default",
  "inferred_candidate",
] as const;

export type ReportingConfigSource = (typeof REPORTING_CONFIG_SOURCES)[number];

export const reportingConfigTable = pgTable("reporting_config", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"), // nullable until orgs exist
  propertyId: integer("property_id"),         // nullable; optional override
  turnWorkOrderReportingMode: text("turn_work_order_reporting_mode")
    .notNull()
    .default("hybrid_or_unknown"),
  configuredByUserId: text("configured_by_user_id"),
  notes: text("notes"),
  source: text("source").notNull().default("default"),
  configuredAt: timestamp("configured_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ReportingConfig = typeof reportingConfigTable.$inferSelect;
export type InsertReportingConfig = typeof reportingConfigTable.$inferInsert;

/**
 * Audit log of mode changes. The spec requires that mode changes never
 * happen silently — every change must be traceable to who/when/why and
 * which analysis categories are affected by the new interpretation.
 */
export const reportingConfigAuditTable = pgTable("reporting_config_audit", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  propertyId: integer("property_id"),
  oldMode: text("old_mode"),
  newMode: text("new_mode").notNull(),
  userId: text("user_id"),
  reason: text("reason"),
  affectedAnalysisCategories: jsonb("affected_analysis_categories")
    .$type<string[]>()
    .notNull()
    .default([]),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export type ReportingConfigAudit =
  typeof reportingConfigAuditTable.$inferSelect;
export type InsertReportingConfigAudit =
  typeof reportingConfigAuditTable.$inferInsert;
