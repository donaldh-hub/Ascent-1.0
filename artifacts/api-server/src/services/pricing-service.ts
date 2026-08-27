/**
 * Single source of truth for the decided pricing formula — see CLAUDE.md's
 * "Pricing" section. If the formula ever changes, change it here only;
 * nothing else should hardcode a band or a dollar amount.
 *
 * $40/month base + a data fee banded by unit count (unit-band pricing,
 * not true per-unit — a 125-unit property pays the same as a 200-unit
 * property in the same band).
 */
import { db } from "@workspace/db";
import { unitsTable, sitePricingTiersTable, userSiteAccessTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendPricingTierChangedEmail } from "./email-service.js";

const BASE_SUBSCRIPTION = 40;

export interface PricingTierResult {
  tierLabel: string;
  dataFee: number;
  monthlyTotal: number;
}

/** The decided band table, encoded once. */
export function calculateTierForUnitCount(unitCount: number): PricingTierResult {
  const safeCount = Math.max(0, unitCount);
  // Bands are inclusive of their upper bound (100 units is "0-100", not
  // "101-200") — Math.floor(count/100) alone would misclassify every
  // exact-multiple-of-100 count into the next band up.
  const bandIndex = Math.max(0, Math.ceil(safeCount / 100) - 1);
  const dataFee = (bandIndex + 1) * 10;
  const lowerBound = bandIndex * 100 + (bandIndex === 0 ? 0 : 1);
  const upperBound = (bandIndex + 1) * 100;
  const tierLabel = bandIndex === 0 ? `0-${upperBound}` : `${lowerBound}-${upperBound}`;

  return {
    tierLabel,
    dataFee,
    monthlyTotal: BASE_SUBSCRIPTION + dataFee,
  };
}

async function getSiteContactEmails(propertyId: number): Promise<string[]> {
  const grants = await db
    .select({ userId: userSiteAccessTable.userId })
    .from(userSiteAccessTable)
    .where(eq(userSiteAccessTable.siteId, propertyId));
  if (grants.length === 0) return [];

  const userIds = [...new Set(grants.map((g) => g.userId))];
  const users = await db.select().from(usersTable);
  return users.filter((u) => userIds.includes(u.id)).map((u) => u.email);
}

/**
 * Recomputes a site's tier from its actual current unit count (real data,
 * not a one-time estimate) and, if it has changed since the last
 * calculation, updates the stored record and notifies everyone with
 * access to that site. Called after every import batch that touches this
 * property — a site's true unit count is only ever known cumulatively, as
 * more/fuller reports come in over time.
 */
export async function recalculateSitePricingTier(propertyId: number): Promise<{ changed: boolean; tier: PricingTierResult }> {
  const unitRows = await db.select({ id: unitsTable.id }).from(unitsTable).where(eq(unitsTable.propertyId, propertyId));
  const unitCount = unitRows.length;
  const tier = calculateTierForUnitCount(unitCount);

  const [existing] = await db
    .select()
    .from(sitePricingTiersTable)
    .where(eq(sitePricingTiersTable.propertyId, propertyId))
    .limit(1);

  if (!existing) {
    await db.insert(sitePricingTiersTable).values({
      propertyId,
      unitCount,
      tierLabel: tier.tierLabel,
      dataFee: tier.dataFee,
      monthlyTotal: tier.monthlyTotal,
    });
    // First calculation for this site isn't a "change" to notify about —
    // it's the initial estimate the customer confirms during onboarding.
    return { changed: false, tier };
  }

  const changed = existing.tierLabel !== tier.tierLabel;
  if (changed) {
    await db
      .update(sitePricingTiersTable)
      .set({ unitCount, tierLabel: tier.tierLabel, dataFee: tier.dataFee, monthlyTotal: tier.monthlyTotal, lastCalculatedAt: new Date() })
      .where(eq(sitePricingTiersTable.propertyId, propertyId));

    const emails = await getSiteContactEmails(propertyId);
    for (const email of emails) {
      await sendPricingTierChangedEmail({
        to: email,
        previousTierLabel: existing.tierLabel,
        newTierLabel: tier.tierLabel,
        newMonthlyTotal: tier.monthlyTotal,
        unitCount,
      });
    }
  } else if (existing.unitCount !== unitCount) {
    // Unit count moved but stayed in the same band — update the count
    // silently, no notification needed since nothing billable changed.
    await db
      .update(sitePricingTiersTable)
      .set({ unitCount, lastCalculatedAt: new Date() })
      .where(eq(sitePricingTiersTable.propertyId, propertyId));
  }

  return { changed, tier };
}

export async function getSitePricingTier(propertyId: number) {
  const [existing] = await db
    .select()
    .from(sitePricingTiersTable)
    .where(eq(sitePricingTiersTable.propertyId, propertyId))
    .limit(1);
  return existing ?? null;
}
