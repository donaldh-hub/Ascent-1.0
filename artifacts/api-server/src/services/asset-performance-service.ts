/**
 * Ascent 9.2 — Asset Performance Service
 *
 * Cross-references assetsTable with workOrdersTable to identify:
 *   - Assets with repeat work orders (repeat issue tracking)
 *   - High-risk assets (many WOs + out of warranty)
 *   - Warranty opportunity missed claims (expired warranty + recent WO)
 */

import { db } from "@workspace/db";
import { assetsTable } from "@workspace/db/schema/assets";
import { workOrdersTable } from "@workspace/db/schema/work_orders";
import { propertiesTable } from "@workspace/db/schema/properties";
import { eq, sql, isNotNull } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepeatIssueAsset {
  assetId: number;
  assetName: string;
  assetType: string | null;
  propertyId: number | null;
  propertyName: string | null;
  workOrderCount: number;
  warrantyExpiration: string | null;
  warrantyStatus: "active" | "expired" | "unknown";
  stoplight: string;
  healthScore: number;
}

export interface AssetPerformanceReport {
  generatedAt: string;
  totalAssetsWithWorkOrders: number;
  topRepeatIssueAssets: RepeatIssueAsset[];
  highRiskAssets: RepeatIssueAsset[];
  warrantyOpportunities: RepeatIssueAsset[];
  confidenceState: "sufficient" | "directional" | "insufficient";
  highRiskCount: number;
  warrantyOpportunityCount: number;
}

// ─── buildAssetPerformanceReport ─────────────────────────────────────────────

export async function buildAssetPerformanceReport(): Promise<AssetPerformanceReport> {
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  // Count work orders per asset
  const woCounts = await db
    .select({
      assetId: workOrdersTable.assetId,
      count: sql<number>`count(*)::int`,
    })
    .from(workOrdersTable)
    .where(isNotNull(workOrdersTable.assetId))
    .groupBy(workOrdersTable.assetId);

  if (woCounts.length === 0) {
    return {
      generatedAt: now.toISOString(),
      totalAssetsWithWorkOrders: 0,
      topRepeatIssueAssets: [],
      highRiskAssets: [],
      warrantyOpportunities: [],
      confidenceState: "insufficient",
      highRiskCount: 0,
      warrantyOpportunityCount: 0,
    };
  }

  // Get all assets that have at least one WO
  const assetIds = woCounts
    .filter((r) => r.assetId != null)
    .map((r) => r.assetId as number);

  const assets = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      assetType: assetsTable.assetType,
      propertyId: assetsTable.propertyId,
      propertyName: propertiesTable.name,
      warrantyExpiration: assetsTable.warrantyExpiration,
      stoplight: assetsTable.stoplight,
      healthScore: assetsTable.healthScore,
    })
    .from(assetsTable)
    .leftJoin(propertiesTable, eq(assetsTable.propertyId, propertiesTable.id));

  const assetMap = new Map(assets.map((a) => [a.id, a]));

  // Build result rows
  const resultRows: RepeatIssueAsset[] = [];
  for (const wo of woCounts) {
    const assetId = wo.assetId;
    if (assetId == null) continue;
    const asset = assetMap.get(assetId);
    if (!asset) continue;

    let warrantyStatus: "active" | "expired" | "unknown" = "unknown";
    if (asset.warrantyExpiration) {
      const expDate = new Date(asset.warrantyExpiration);
      if (!isNaN(expDate.getTime())) {
        warrantyStatus = expDate >= now ? "active" : "expired";
      }
    }

    resultRows.push({
      assetId,
      assetName: asset.name,
      assetType: asset.assetType,
      propertyId: asset.propertyId,
      propertyName: asset.propertyName ?? null,
      workOrderCount: wo.count,
      warrantyExpiration: asset.warrantyExpiration,
      warrantyStatus,
      stoplight: asset.stoplight,
      healthScore: asset.healthScore,
    });
  }

  // Sort by work order count descending
  resultRows.sort((a, b) => b.workOrderCount - a.workOrderCount);

  // Repeat issue assets: >= 2 work orders
  const topRepeatIssueAssets = resultRows.filter((r) => r.workOrderCount >= 2);

  // High risk: out of warranty + multiple work orders
  const highRiskAssets = resultRows.filter(
    (r) => r.warrantyStatus === "expired" && r.workOrderCount >= 2,
  );

  // Warranty opportunities: expired warranty + had work order in last year
  // We check via a separate query for recent WOs on these assets
  const expiredWarrantyAssetIds = resultRows
    .filter((r) => r.warrantyStatus === "expired")
    .map((r) => r.assetId);

  let warrantyOpportunities: RepeatIssueAsset[] = [];
  if (expiredWarrantyAssetIds.length > 0) {
    // Check which expired-warranty assets had recent work orders
    const recentWOs = await db
      .select({ assetId: workOrdersTable.assetId })
      .from(workOrdersTable)
      .where(isNotNull(workOrdersTable.assetId));

    const recentAssetIds = new Set(
      recentWOs
        .filter((r) => r.assetId != null)
        .map((r) => r.assetId as number),
    );

    warrantyOpportunities = resultRows.filter(
      (r) =>
        r.warrantyStatus === "expired" &&
        recentAssetIds.has(r.assetId) &&
        r.warrantyExpiration != null &&
        new Date(r.warrantyExpiration) >= oneYearAgo,
    );
  }

  // Confidence: based on % of assets that have linked work orders
  const totalAssets = assets.length;
  const assetsWithWOs = assetIds.length;

  let confidenceState: "sufficient" | "directional" | "insufficient";
  if (totalAssets === 0 || assetsWithWOs === 0) {
    confidenceState = "insufficient";
  } else if (assetsWithWOs / totalAssets >= 0.3) {
    confidenceState = "sufficient";
  } else {
    confidenceState = "directional";
  }

  return {
    generatedAt: now.toISOString(),
    totalAssetsWithWorkOrders: assetsWithWOs,
    topRepeatIssueAssets,
    highRiskAssets,
    warrantyOpportunities,
    confidenceState,
    highRiskCount: highRiskAssets.length,
    warrantyOpportunityCount: warrantyOpportunities.length,
  };
}
