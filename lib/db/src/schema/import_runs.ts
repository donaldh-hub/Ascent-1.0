import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const importRunsTable = pgTable("import_runs", {
  id: serial("id").primaryKey(),

  batchId: text("batch_id").notNull().unique(),
  importMode: text("import_mode").notNull().default("flexible"), // 'flexible' | 'strict'
  sourceFileName: text("source_file_name"),
  entityType: text("entity_type").notNull().default("work_order"), // for future extension

  // Row counts by resolution state
  totalRows: integer("total_rows").notNull().default(0),
  fullyResolvedCount: integer("fully_resolved_count").notNull().default(0),
  partiallyResolvedCount: integer("partially_resolved_count").notNull().default(0),
  unresolvedCount: integer("unresolved_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),

  // Supplemental summary (SLA, block stats)
  summaryData: jsonb("summary_data").$type<Record<string, unknown>>(),

  // Strict mode verdict
  strictVerdict: text("strict_verdict"), // 'verified' | 'partial' | 'not_valid' | null

  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type ImportRun = typeof importRunsTable.$inferSelect;
export type InsertImportRun = typeof importRunsTable.$inferInsert;
