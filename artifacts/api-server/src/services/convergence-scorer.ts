import { db } from "@workspace/db";
import { workOrdersTable, propertiesTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

export interface UnitSignal {
  unitId: number | null;
  propertyId: number | null;
  propertyName: string | null;
  pillars: string[];
  pillarCount: number;
  signals: Array<{
    pillar: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low";
  }>;
  convergenceScore: number;
  recommendation: string;
}

export interface ConvergenceResult {
  flags: UnitSignal[];
  elevated: UnitSignal[];
  generatedAt: string;
}

export async function scoreConvergence(): Promise<ConvergenceResult> {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const openWOs = await db
    .select({
      unitId: workOrdersTable.unitId,
      propertyId: workOrdersTable.propertyId,
      propertyName: propertiesTable.name,
      count: sql<number>`count(*)::int`,
      hasAging: sql<boolean>`bool_or(${workOrdersTable.createdAt} < ${fourteenDaysAgo.toISOString()}::timestamp)`,
    })
    .from(workOrdersTable)
    .leftJoin(propertiesTable, sql`${workOrdersTable.propertyId} = ${propertiesTable.id}`)
    .where(sql`${workOrdersTable.status} in ('submitted','assigned','in_progress') and ${workOrdersTable.unitId} is not null`)
    .groupBy(workOrdersTable.unitId, workOrdersTable.propertyId, propertiesTable.name);

  const repeatAssetUnits = await db
    .select({
      unitId: workOrdersTable.unitId,
      propertyId: workOrdersTable.propertyId,
      propertyName: propertiesTable.name,
      woCount: sql<number>`count(*)::int`,
    })
    .from(workOrdersTable)
    .leftJoin(propertiesTable, sql`${workOrdersTable.propertyId} = ${propertiesTable.id}`)
    .where(sql`${workOrdersTable.unitId} is not null and ${workOrdersTable.assetId} is not null`)
    .groupBy(workOrdersTable.unitId, workOrdersTable.propertyId, propertiesTable.name)
    .having(sql`count(*) >= 2`);

  const unitMap = new Map<string, UnitSignal>();
  const key = (u: number | null, p: number | null) => `${u ?? "x"}-${p ?? "x"}`;

  for (const wo of openWOs) {
    const k = key(wo.unitId, wo.propertyId);
    if (!unitMap.has(k)) {
      unitMap.set(k, { unitId: wo.unitId, propertyId: wo.propertyId, propertyName: wo.propertyName ?? null, pillars: [], pillarCount: 0, signals: [], convergenceScore: 0, recommendation: "" });
    }
    const u = unitMap.get(k)!;
    if (!u.pillars.includes("work_orders")) {
      u.pillars.push("work_orders");
      u.signals.push({ pillar: "work_orders", description: `${wo.count} open work order(s)${wo.hasAging ? " — at least one aging past 14 days" : ""}`, severity: wo.count >= 3 ? "high" : "medium" });
    }
  }

  for (const row of repeatAssetUnits) {
    const k = key(row.unitId, row.propertyId);
    if (!unitMap.has(k)) {
      unitMap.set(k, { unitId: row.unitId, propertyId: row.propertyId, propertyName: row.propertyName ?? null, pillars: [], pillarCount: 0, signals: [], convergenceScore: 0, recommendation: "" });
    }
    const u = unitMap.get(k)!;
    if (!u.pillars.includes("pm_warranty")) {
      u.pillars.push("pm_warranty");
      u.signals.push({ pillar: "pm_warranty", description: `${row.woCount} asset-linked work orders on this unit — repeat issue pattern`, severity: row.woCount >= 4 ? "critical" : "high" });
    }
  }

  for (const u of unitMap.values()) {
    u.pillarCount = u.pillars.length;
    const hasCritical = u.signals.some((s) => s.severity === "critical");
    const hasHigh = u.signals.some((s) => s.severity === "high");
    u.convergenceScore = u.pillarCount * 25 + (hasCritical ? 20 : hasHigh ? 10 : 0);
    u.recommendation = u.pillarCount >= 3
      ? "Full assessment recommended before next maintenance cycle."
      : `This unit is appearing across ${u.pillarCount} operational areas at once — monitor closely.`;
  }

  const all = Array.from(unitMap.values()).sort((a, b) => b.convergenceScore - a.convergenceScore);
  return { flags: all.filter((u) => u.pillarCount >= 3), elevated: all.filter((u) => u.pillarCount === 2), generatedAt: now.toISOString() };
}
