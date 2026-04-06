import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const propertiesTable = pgTable("properties", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  supervisorName: text("supervisor_name"),
  supervisorEmail: text("supervisor_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPropertySchema = createInsertSchema(propertiesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof propertiesTable.$inferSelect;

export const unitsTable = pgTable("units", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  unitNumber: text("unit_number").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUnitSchema = createInsertSchema(unitsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type Unit = typeof unitsTable.$inferSelect;
