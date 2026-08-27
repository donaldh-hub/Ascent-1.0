import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tracks each site's current pricing tier as an aggregate of everything
 * imported for it to date — not a one-time snapshot from the first
 * upload. A property tagged at 50 units on day one can genuinely be
 * revealed to have 170 units 90 days later as more/fuller reports come
 * in; this table is what lets Ascent notice that crossing and tell the
 * subscriber, rather than silently undercharging or leaving them
 * surprised. See CLAUDE.md's "Pricing" section for the decided band table
 * this is computed from — pricing-service.ts is the single place that
 * table is encoded, this table just stores the last known result.
 */
export const sitePricingTiersTable = pgTable("site_pricing_tiers", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().unique(),
  unitCount: integer("unit_count").notNull(),
  tierLabel: text("tier_label").notNull(), // e.g. "0-100", "101-200"
  dataFee: integer("data_fee").notNull(),
  monthlyTotal: integer("monthly_total").notNull(),
  lastCalculatedAt: timestamp("last_calculated_at").notNull().defaultNow(),
  // Set once the "approaching your next tier" notice has gone out for the
  // CURRENT tier, so re-imports don't re-notify every time. Cleared back to
  // null whenever the tier actually changes, so the new tier gets its own
  // fresh approach-warning later.
  approachingNotifiedAt: timestamp("approaching_notified_at"),
});

export type SitePricingTier = typeof sitePricingTiersTable.$inferSelect;
