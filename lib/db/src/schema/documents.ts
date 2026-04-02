import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  uploadedBy: text("uploaded_by").notNull().default("system"),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull().default(0),
  documentType: text("document_type").notNull().default("general"),
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: integer("linked_entity_id").notNull(),
  linkedWorkflowId: integer("linked_workflow_id"),
  linkedStageId: integer("linked_stage_id"),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  uploadedAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;

export const DOCUMENT_TYPES = [
  "general",
  "warranty",
  "invoice",
  "approval",
  "inspection",
  "contract",
  "estimate",
  "photo",
  "manual",
  "report",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const LINKED_ENTITY_TYPES = [
  "workflow",
  "workflow_item",
  "workflow_stage",
  "asset",
] as const;

export type LinkedEntityType = (typeof LINKED_ENTITY_TYPES)[number];
