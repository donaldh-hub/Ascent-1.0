import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * One record per inbound-email webhook delivery. `messageId` (the email's
 * standard Message-ID header, globally unique per message) is the
 * duplicate-ingestion guard — a webhook retry or a forwarded copy of the
 * same email never gets processed twice. Kept even for rejected/duplicate
 * deliveries so there's a real audit trail of what arrived and why it was
 * or wasn't ingested.
 */
export const inboundEmailsTable = pgTable("inbound_emails", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().unique(),
  fromEmail: text("from_email").notNull(),
  subject: text("subject"),
  userId: integer("user_id"), // resolved sender, null if unknown sender
  status: text("status").notNull(), // "processed" | "rejected" | "duplicate"
  rejectionReason: text("rejection_reason"),
  ingestionResult: jsonb("ingestion_result").$type<Record<string, unknown>>(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

export type InboundEmail = typeof inboundEmailsTable.$inferSelect;
