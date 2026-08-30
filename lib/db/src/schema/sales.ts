import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Sales Agent's lead record (Build Sequence step 8). No CRM/lead concept
 * existed in this codebase before — genuinely new, not a shadow of
 * anything. Kept to exactly the fields the job description's own
 * "Required Inputs" lists (organization profile, site count, contact,
 * pain, decision role) — no speculative CRM fields for capabilities that
 * don't exist yet (no enterprise-terms negotiation, no multi-touch
 * campaign tracking).
 */
export const LEAD_STATUSES = ["new", "qualified", "disqualified", "quoted", "converted"] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  organizationName: text("organization_name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email").notNull(),
  siteCount: integer("site_count").notNull(),
  reportAvailability: text("report_availability"),
  painDescription: text("pain_description"),
  decisionRole: text("decision_role"),
  status: text("status").notNull().default("new"),
  disqualificationReason: text("disqualification_reason"),
  quotedTierLabel: text("quoted_tier_label"),
  quotedMonthlyTotal: integer("quoted_monthly_total"),
  convertedAt: timestamp("converted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Lead = typeof leadsTable.$inferSelect;
