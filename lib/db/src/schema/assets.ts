import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model"),
  serial: text("serial"),
  status: text("status").notNull().default("active"),
  stoplight: text("stoplight").notNull().default("green"),
  healthScore: real("health_score").notNull().default(100),
  installDate: text("install_date"),
  warrantyStart: text("warranty_start"),
  warrantyExpiration: text("warranty_expiration"),
  lifeExpectancyYears: real("life_expectancy_years"),
  maintenanceSchedule: text("maintenance_schedule"),
  location: text("location"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
