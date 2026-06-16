/**
 * Ascent 9.1 — Warranty Intelligence Service
 *
 * Derives warranty intelligence from assetsTable columns:
 *   warrantyStart, warrantyExpiration
 * No separate warranty table exists — all derived from asset rows.
 */

import { db } from "@workspace/db";
import { assetsTable } from "@workspace/db/schema/assets";
import { propertiesTable } from "@workspace/db/schema/properties";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WarrantyAsset {
  id: number;
  name: string;
  assetType: string | null;
  propertyId: number | null;
  propertyName: string | null;
  warrantyStart: string | null;
  warrantyExpiration: string | null;
  daysUntilExpiry: number | null;
  daysExpired: number | null;
}

export interface WarrantyIntelligenceReport {
  generatedAt: string;
  totalAssets: number;
  active: WarrantyAsset[];
  expired: WarrantyAsset[];
  unknown: WarrantyAsset[];
  expiringWithin90Days: WarrantyAsset[];
  opportunityFlags: WarrantyAsset[];
  confidenceState: "sufficient" | "directional" | "insufficient";
  activeCount: number;
  expiredCount: number;
  unknownCount: number;
  expiringWithin90DaysCount: number;
  opportunityFlagCount: number;
}

// ─── analyzeWarrantyIntelligence ──────────────────────────────────────────────

export async function analyzeWarrantyIntelligence(): Promise<WarrantyIntelligenceReport> {
  const rows = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      assetType: assetsTable.assetType,
      propertyId: assetsTable.propertyId,
      propertyName: propertiesTable.name,
      warrantyStart: assetsTable.warrantyStart,
      warrantyExpiration: assetsTable.warrantyExpiration,
    })
    .from(assetsTable)
    .leftJoin(propertiesTable, eq(assetsTable.propertyId, propertiesTable.id));

  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const active: WarrantyAsset[] = [];
  const expired: WarrantyAsset[] = [];
  const unknown: WarrantyAsset[] = [];

  for (const row of rows) {
    const asset: WarrantyAsset = {
      id: row.id,
      name: row.name,
      assetType: row.assetType,
      propertyId: row.propertyId,
      propertyName: row.propertyName ?? null,
      warrantyStart: row.warrantyStart,
      warrantyExpiration: row.warrantyExpiration,
      daysUntilExpiry: null,
      daysExpired: null,
    };

    if (!row.warrantyExpiration) {
      unknown.push(asset);
      continue;
    }

    const expDate = new Date(row.warrantyExpiration);
    if (isNaN(expDate.getTime())) {
      unknown.push(asset);
      continue;
    }

    const diffMs = expDate.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays >= 0) {
      asset.daysUntilExpiry = diffDays;
      active.push(asset);
    } else {
      asset.daysExpired = Math.abs(diffDays);
      expired.push(asset);
    }
  }

  // Expiring within 90 days (subset of active)
  const expiringWithin90Days = active.filter(
    (a) => a.daysUntilExpiry !== null && a.daysUntilExpiry <= 90,
  );

  // Opportunity flags: expired but still within 1 year past expiry (claim window)
  const opportunityFlags = expired.filter((a) => {
    if (!a.warrantyExpiration) return false;
    const expDate = new Date(a.warrantyExpiration);
    return expDate >= oneYearAgo;
  });

  // Confidence based on how many assets have warranty data
  const withData = active.length + expired.length;
  const total = rows.length;
  let confidenceState: "sufficient" | "directional" | "insufficient";
  if (total === 0) {
    confidenceState = "insufficient";
  } else if (withData / total >= 0.5) {
    confidenceState = "sufficient";
  } else if (withData > 0) {
    confidenceState = "directional";
  } else {
    confidenceState = "insufficient";
  }

  return {
    generatedAt: now.toISOString(),
    totalAssets: total,
    active,
    expired,
    unknown,
    expiringWithin90Days,
    opportunityFlags,
    confidenceState,
    activeCount: active.length,
    expiredCount: expired.length,
    unknownCount: unknown.length,
    expiringWithin90DaysCount: expiringWithin90Days.length,
    opportunityFlagCount: opportunityFlags.length,
  };
}
