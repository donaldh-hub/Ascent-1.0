import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull(),
  shareToken: text("share_token").notNull().unique(),
  siteName: text("site_name"),
  uploadCount: integer("upload_count").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUploadAt: timestamp("last_upload_at").notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;
