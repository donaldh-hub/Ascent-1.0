/**
 * Phase 1 — Portfolio Control Tower Service
 *
 * Aggregates per-property health signals from assets + alerts.
 * Reuses scoring engine outputs. No UI logic. No DB mutations.
 * Sorted by urgency: RED → YELLOW → GREEN.
 */

import { db } from "@workspace/db";
import {
  propertiesTable,
  assetsTable,
  alertsTable,
  documentsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { calcStoplight, type Stoplight } from "../engine/scoring";
import { getReplacementCost } from "../lib/cost-lookup";

export interface PropertyPortfolioCard {
  propertyId: number;
  propertyName: string;
  healthScore: number;
  stoplight: Stoplight;
  flowScore: number;
  riskScore: number;
  improvementScore: number;
  executionScore: number;
  criticalItemsCount: number;
  topBottleneck: string;
  bottleneckAging: number;
  missingDocsCount: number;
  documentCount: number;
  trendDirection: "up" | "down" | "stable";
  supervisorName: string | null;
  supervisorEmail: string | null;
  insightSummary: string;
  communicationSummary: string;
  // Detail payload for expanded view
  totalAssets: number;
  atRiskAssets: number;
  expiringSoonAssets: number;
  unitCoverage: number;
  // Financial Intelligence (Build 1.9)
  totalAssetCost: number | null;
  expiredWarrantyCost: number | null;
  expiringSoonCost: number | null;
}

const STOPLIGHT_ORDER: Record<Stoplight, number> = { red: 0, yellow: 1, green: 2 };

export async function buildPortfolioControlTower(): Promise<PropertyPortfolioCard[]> {
  const [properties, assets, alerts, docs] = await Promise.all([
    db.select().from(propertiesTable),
    db.select({
      id: assetsTable.id,
      propertyId: assetsTable.propertyId,
      healthScore: assetsTable.healthScore,
      warrantyExpiration: assetsTable.warrantyExpiration,
      unitId: assetsTable.unitId,
      assetType: assetsTable.assetType,
    }).from(assetsTable),
    db.select({
      id: alertsTable.id,
      level: alertsTable.level,
      assetId: alertsTable.assetId,
    }).from(alertsTable).where(eq(alertsTable.isActive, true)),
    db.select({
      linkedEntityType: documentsTable.linkedEntityType,
      linkedEntityId: documentsTable.linkedEntityId,
    }).from(documentsTable),
  ]);

  const today = new Date();
  const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  // ── Build lookup maps ──────────────────────────────────────────────────────

  const assetsByProperty = new Map<number, typeof assets>();
  for (const a of assets) {
    if (a.propertyId == null) continue;
    const list = assetsByProperty.get(a.propertyId) ?? [];
    list.push(a);
    assetsByProperty.set(a.propertyId, list);
  }

  const docCountByAsset = new Map<number, number>();
  for (const d of docs) {
    if (d.linkedEntityType === "asset") {
      docCountByAsset.set(d.linkedEntityId, (docCountByAsset.get(d.linkedEntityId) ?? 0) + 1);
    }
  }

  const criticalAlertsByAsset = new Map<number, number>();
  for (const al of alerts) {
    if (al.assetId == null) continue;
    if (al.level === "critical") {
      criticalAlertsByAsset.set(al.assetId, (criticalAlertsByAsset.get(al.assetId) ?? 0) + 1);
    }
  }

  const CRITICAL_ASSET_TYPES = new Set(["HVAC", "Elevator", "Boiler", "Fire Panel"]);

  const results: PropertyPortfolioCard[] = [];

  for (const prop of properties) {
    const propAssets = assetsByProperty.get(prop.id) ?? [];
    const total = propAssets.length;
    if (total === 0) continue;

    let atRisk = 0;
    let expiringSoon = 0;
    let sumHealth = 0;
    let docCount = 0;
    let missingDocs = 0;
    let unlinked = 0;
    let criticalItemsCount = 0;
    let oldestExpiredDays = 0;
    let sumTotalCost = 0;
    let sumExpiredCost = 0;
    let sumExpiringSoonCost = 0;
    let hasCostData = false;

    const typeRiskCount = new Map<string, number>();

    for (const a of propAssets) {
      sumHealth += a.healthScore ?? 100;
      if (a.unitId == null) unlinked++;

      const assetCost = getReplacementCost(a.assetType);
      if (assetCost != null) {
        sumTotalCost += assetCost;
        hasCostData = true;
      }

      if (a.warrantyExpiration) {
        const exp = new Date(a.warrantyExpiration);
        if (exp < today) {
          atRisk++;
          const days = (today.getTime() - exp.getTime()) / (1000 * 60 * 60 * 24);
          if (days > oldestExpiredDays) oldestExpiredDays = days;
          const typ = a.assetType ?? "Equipment";
          typeRiskCount.set(typ, (typeRiskCount.get(typ) ?? 0) + 1);
          if (assetCost != null) sumExpiredCost += assetCost;
        } else if (exp < ninetyDays) {
          expiringSoon++;
          if (assetCost != null) sumExpiringSoonCost += assetCost;
        }
      }

      const dc = docCountByAsset.get(a.id) ?? 0;
      docCount += dc;
      if (dc === 0 && a.assetType && CRITICAL_ASSET_TYPES.has(a.assetType)) missingDocs++;
      criticalItemsCount += criticalAlertsByAsset.get(a.id) ?? 0;
    }

    const avgHealth = Math.round(sumHealth / total);

    // ── Per-property dimension scores ─────────────────────────────────────────
    const riskRate = atRisk / total;
    const riskScore = Math.max(5, Math.round(100 - riskRate * 120));

    const healthyFraction = (total - atRisk - expiringSoon * 0.5) / total;
    const flowScore = Math.max(5, Math.round(healthyFraction * 100));

    const improvementScore = atRisk === 0
      ? 85
      : Math.max(10, Math.round(100 - riskRate * 60 - (expiringSoon / Math.max(1, total)) * 20));

    const unitCoverage = Math.round(((total - unlinked) / total) * 100);
    const executionScore = Math.max(10, unitCoverage);

    const healthScore = Math.round(
      0.30 * flowScore +
      0.30 * riskScore +
      0.25 * executionScore +
      0.15 * improvementScore,
    );
    const stoplight = calcStoplight(healthScore);

    // ── Trend ─────────────────────────────────────────────────────────────────
    let trendDirection: "up" | "down" | "stable" = "stable";
    if (atRisk === 0 && expiringSoon === 0) trendDirection = "up";
    else if (expiringSoon > atRisk * 1.5) trendDirection = "down";

    // ── Top bottleneck ────────────────────────────────────────────────────────
    let topBottleneck = "Warranty compliance";
    if (typeRiskCount.size > 0) {
      const sorted = [...typeRiskCount.entries()].sort((a, b) => b[1] - a[1]);
      topBottleneck = `${sorted[0][0]} warranty expiry`;
    }

    // ── Insight text ──────────────────────────────────────────────────────────
    let insightSummary: string;
    if (atRisk === 0 && expiringSoon === 0) {
      insightSummary = `All ${total} assets are within warranty. Execution coverage is at ${unitCoverage}%. No active risk signals.`;
    } else if (atRisk > 0) {
      const pct = Math.round((atRisk / total) * 100);
      const critSuffix = criticalItemsCount > 0 ? ` ${criticalItemsCount} critical alerts active.` : "";
      insightSummary = `Risk elevated due to expired warranties — ${atRisk} of ${total} assets (${pct}%) past expiry.${critSuffix} ${topBottleneck} is the primary driver.`;
    } else {
      insightSummary = `${expiringSoon} assets approaching warranty expiry within 90 days. Flow reduced due to impending compliance gap.`;
    }

    // ── Communication summary (email/clipboard body) ──────────────────────────
    const communicationSummary = [
      `Property: ${prop.name}`,
      `Health Score: ${healthScore}/100 (${stoplight.toUpperCase()})`,
      ``,
      `Assets: ${total} total | ${atRisk} expired warranty | ${expiringSoon} expiring soon`,
      `Critical Alerts: ${criticalItemsCount}`,
      `Top Concern: ${topBottleneck}`,
      `Oldest Expired: ${Math.round(oldestExpiredDays)} days ago`,
      `Missing Documentation: ${missingDocs} critical asset${missingDocs !== 1 ? "s" : ""}`,
      ``,
      `Insight: ${insightSummary}`,
    ].join("\n");

    results.push({
      propertyId: prop.id,
      propertyName: prop.name,
      healthScore,
      stoplight,
      flowScore,
      riskScore,
      improvementScore,
      executionScore,
      criticalItemsCount,
      topBottleneck,
      bottleneckAging: Math.round(oldestExpiredDays),
      missingDocsCount: missingDocs,
      documentCount: docCount,
      trendDirection,
      supervisorName: prop.supervisorName ?? null,
      supervisorEmail: prop.supervisorEmail ?? null,
      insightSummary,
      communicationSummary,
      totalAssets: total,
      atRiskAssets: atRisk,
      expiringSoonAssets: expiringSoon,
      unitCoverage,
      totalAssetCost: hasCostData ? sumTotalCost : null,
      expiredWarrantyCost: hasCostData && atRisk > 0 ? sumExpiredCost : null,
      expiringSoonCost: hasCostData && expiringSoon > 0 ? sumExpiringSoonCost : null,
    });
  }

  // Sort: RED → YELLOW → GREEN, then by risk → aging → critical within group
  results.sort((a, b) => {
    const orderDiff = STOPLIGHT_ORDER[a.stoplight] - STOPLIGHT_ORDER[b.stoplight];
    if (orderDiff !== 0) return orderDiff;
    if (a.riskScore !== b.riskScore) return a.riskScore - b.riskScore;
    if (b.bottleneckAging !== a.bottleneckAging) return b.bottleneckAging - a.bottleneckAging;
    return b.criticalItemsCount - a.criticalItemsCount;
  });

  return results;
}
