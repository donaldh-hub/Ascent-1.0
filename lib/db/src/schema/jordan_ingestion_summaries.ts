import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Jordan's one-shot explanation of a report upload — generated right after
 * ingestion completes, grounded in the same tool results Jordan's
 * conversational mode uses (jordan-tools.ts). Persisted (not just returned
 * in the upload response) so Control Tower can keep showing "what this
 * means" after the upload toast is gone, not just at the moment of upload.
 */
export const jordanIngestionSummariesTable = pgTable("jordan_ingestion_summaries", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  propertyIds: jsonb("property_ids").$type<number[]>().notNull().default([]),
  headline: text("headline").notNull(),
  recommendations: jsonb("recommendations").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type JordanIngestionSummary = typeof jordanIngestionSummariesTable.$inferSelect;
