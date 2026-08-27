import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * A conversation thread with Jordan for one user. Kept separate from
 * coach_weekly_summaries/coach_preferences — those are the templated
 * summary system; this is the real interactive conversation.
 */
export const jordanConversationsTable = pgTable("jordan_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type JordanConversation = typeof jordanConversationsTable.$inferSelect;

/**
 * One message in a conversation. `toolCalls` records which tools Jordan
 * invoked and what they returned for an assistant message — kept for
 * auditability: every concrete claim Jordan makes should be traceable
 * back to a real tool result, not free-generation, and this is the record
 * that proves it happened that way.
 */
export const jordanMessagesTable = pgTable("jordan_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls").$type<{ name: string; input: unknown; result: unknown }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type JordanMessage = typeof jordanMessagesTable.$inferSelect;
