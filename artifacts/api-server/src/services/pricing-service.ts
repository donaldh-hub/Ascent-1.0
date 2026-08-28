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
import { unitsTable, sitePricingTiersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendPricingTierChangedEmail, sendApproachingTierEmail } from "./email-service.js";
import { getSiteContacts } from "./access-service.js";

const BASE_SUBSCRIPTION = 40;

// Once a site's unique-unit count reaches this fraction of its current
// tier's ceiling, the subscriber gets an early "you're approaching your
// next tier" notice — before the change actually happens, never after.
const APPROACHING_THRESHOLD_FRACTION = 0.8;

export interface PricingTierResult {
  tierLabel: string;
  dataFee: number;
  monthlyTotal: number;
  /** Unit count at which this tier ends and the next one begins. */
  upperBound: number;
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
    upperBound,
  };
}

/** The next month boundary — billing changes take effect on the next cycle, never retroactively. */
function nextBillingCycleLabel(): string {
  const now = new Date();
  const firstOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return firstOfNextMonth.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

async function getSiteContactEmails(propertyId: number): Promise<string[]> {
  const contacts = await getSiteContacts([propertyId]);
  return contacts.map((c) => c.email);
}

/**
 * Recomputes a site's tier from its actual current unit count (real data,
 * not a one-time estimate) and, if it has changed since the last
 * calculation, updates the stored record and notifies everyone with
 * access to that site. Called after every import batch that touches this
 * property — a site's true unit count is only ever known cumulatively, as
 * more/fuller reports come in over time.
 *
 * Unit count itself is deduplicated upstream: units are keyed on
 * (propertyId, unitNumber) with numeric-normalized matching in
 * resolveUnit() (work-order-service.ts), so the same unit reported twice —
 * or reported as "101" in one file and "Apt 101" in another — is one row,
 * one count, not two. That's the "stable identity" protection this
 * calculation relies on.
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
    const previousTier = calculateTierForUnitCount(existing.unitCount);
    await db
      .update(sitePricingTiersTable)
      .set({
        unitCount,
        tierLabel: tier.tierLabel,
        dataFee: tier.dataFee,
        monthlyTotal: tier.monthlyTotal,
        lastCalculatedAt: new Date(),
        approachingNotifiedAt: null, // fresh tier gets its own approach-warning later
      })
      .where(eq(sitePricingTiersTable.propertyId, propertyId));

    const emails = await getSiteContactEmails(propertyId);
    const effectiveDate = nextBillingCycleLabel();
    for (const email of emails) {
      await sendPricingTierChangedEmail({
        to: email,
        previousTierLabel: existing.tierLabel,
        newTierLabel: tier.tierLabel,
        previousUnitCount: existing.unitCount,
        unitCount,
        previousMonthlyTotal: previousTier.monthlyTotal,
        newMonthlyTotal: tier.monthlyTotal,
        effectiveDate,
      });
    }
  } else {
    const approachingNow = unitCount >= tier.upperBound * APPROACHING_THRESHOLD_FRACTION;
    const shouldNotifyApproaching = approachingNow && !existing.approachingNotifiedAt;

    if (shouldNotifyApproaching) {
      const nextTier = calculateTierForUnitCount(tier.upperBound + 1);
      const emails = await getSiteContactEmails(propertyId);
      for (const email of emails) {
        await sendApproachingTierEmail({
          to: email,
          unitCount,
          currentThreshold: tier.upperBound,
          nextTierLabel: nextTier.tierLabel,
        });
      }
    }

    if (existing.unitCount !== unitCount || shouldNotifyApproaching) {
      // Unit count moved but stayed in the same band — update the count
      // (and the approach-notice flag, if just sent) with no tier-change
      // notification, since nothing billable changed yet.
      await db
        .update(sitePricingTiersTable)
        .set({
          unitCount,
          lastCalculatedAt: new Date(),
          ...(shouldNotifyApproaching ? { approachingNotifiedAt: new Date() } : {}),
        })
        .where(eq(sitePricingTiersTable.propertyId, propertyId));
    }
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

export interface PricingDashboard {
  propertyId: number;
  unitCount: number;
  tierLabel: string;
  dataFee: number;
  monthlyTotal: number;
  nextTierThreshold: number;
  unitsRemainingBeforeNextTier: number;
  approachingNextTier: boolean;
  lastCalculatedAt: string;
}

/**
 * Full subscriber-facing view of a site's pricing: current standing, how
 * close it is to the next tier, and when it was last checked — every
 * number the dashboard needs to make the calculation visible and
 * verifiable, per the decided Data-Tier Monitor spec.
 */
export async function getPricingDashboard(propertyId: number): Promise<PricingDashboard> {
  const { tier } = await recalculateSitePricingTier(propertyId);
  const unitRows = await db.select({ id: unitsTable.id }).from(unitsTable).where(eq(unitsTable.propertyId, propertyId));
  const unitCount = unitRows.length;
  const stored = await getSitePricingTier(propertyId);

  return {
    propertyId,
    unitCount,
    tierLabel: tier.tierLabel,
    dataFee: tier.dataFee,
    monthlyTotal: tier.monthlyTotal,
    nextTierThreshold: tier.upperBound,
    unitsRemainingBeforeNextTier: Math.max(0, tier.upperBound - unitCount),
    approachingNextTier: unitCount >= tier.upperBound * APPROACHING_THRESHOLD_FRACTION,
    lastCalculatedAt: (stored?.lastCalculatedAt ?? new Date()).toISOString(),
  };
}
