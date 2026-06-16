/**
 * Ascent 9.0 — Asset Registry Service
 *
 * Queries assetsTable joined to propertiesTable and unitsTable for names.
 * Returns structured registry data and summary aggregates.
 */

import { db } from "@workspace/db";
import { assetsTable, propertiesTable, unitsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssetRegistryRow {
  id: number;
  name: string;
  assetType: string | null;
  propertyId: number | null;
  propertyName: string | null;
  unitId: number | null;
  unitNameOrNumber: string | null;
  status: string;
  stoplight: string;
  healthScore: number;
  installDate: string | null;
  warrantyStart: string | null;
  warrantyExpiration: string | null;
  lifeExpectancyYears: number | null;
  location: string | null;
  model: string | null;
  serial: string | null;
  manufacturer: string | null;
  maintenanceSchedule: string | null;
  linkageStatus: string;
}

export interface AssetRegistrySummary {
  totalAssets: number;
  byProperty: Array<{ propertyId: number | null; propertyName: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byType: Array<{ assetType: string; count: number }>;
  byStoplight: Array<{ stoplight: string; count: number }>;
}

// ─── getAssetRegistry ─────────────────────────────────────────────────────────

export async function getAssetRegistry(limit = 100, offset = 0): Promise<AssetRegistryRow[]> {
  const rows = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      assetType: assetsTable.assetType,
      propertyId: assetsTable.propertyId,
      propertyName: propertiesTable.name,
      unitId: assetsTable.unitId,
      unitNameOrNumber: unitsTable.unitNumber,
      status: assetsTable.status,
      stoplight: assetsTable.stoplight,
      healthScore: assetsTable.healthScore,
      installDate: assetsTable.installDate,
      warrantyStart: assetsTable.warrantyStart,
      warrantyExpiration: assetsTable.warrantyExpiration,
      lifeExpectancyYears: assetsTable.lifeExpectancyYears,
      location: assetsTable.location,
      model: assetsTable.model,
      serial: assetsTable.serial,
      maintenanceSchedule: assetsTable.maintenanceSchedule,
      linkageStatus: assetsTable.linkageStatus,
    })
    .from(assetsTable)
    .leftJoin(propertiesTable, eq(assetsTable.propertyId, propertiesTable.id))
    .leftJoin(unitsTable, eq(assetsTable.unitId, unitsTable.id))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    assetType: r.assetType,
    propertyId: r.propertyId,
    propertyName: r.propertyName ?? null,
    unitId: r.unitId,
    unitNameOrNumber: r.unitNameOrNumber ?? null,
    status: r.status,
    stoplight: r.stoplight,
    healthScore: r.healthScore,
    installDate: r.installDate,
    warrantyStart: r.warrantyStart,
    warrantyExpiration: r.warrantyExpiration,
    lifeExpectancyYears: r.lifeExpectancyYears,
    location: r.location,
    model: r.model,
    serial: r.serial,
    manufacturer: null, // not in schema — honest null
    maintenanceSchedule: r.maintenanceSchedule,
    linkageStatus: r.linkageStatus,
  }));
}

// ─── getAssetProfile ──────────────────────────────────────────────────────────

export async function getAssetProfile(assetId: number): Promise<AssetRegistryRow | null> {
  const rows = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      assetType: assetsTable.assetType,
      propertyId: assetsTable.propertyId,
      propertyName: propertiesTable.name,
      unitId: assetsTable.unitId,
      unitNameOrNumber: unitsTable.unitNumber,
      status: assetsTable.status,
      stoplight: assetsTable.stoplight,
      healthScore: assetsTable.healthScore,
      installDate: assetsTable.installDate,
      warrantyStart: assetsTable.warrantyStart,
      warrantyExpiration: assetsTable.warrantyExpiration,
      lifeExpectancyYears: assetsTable.lifeExpectancyYears,
      location: assetsTable.location,
      model: assetsTable.model,
      serial: assetsTable.serial,
      maintenanceSchedule: assetsTable.maintenanceSchedule,
      linkageStatus: assetsTable.linkageStatus,
    })
    .from(assetsTable)
    .leftJoin(propertiesTable, eq(assetsTable.propertyId, propertiesTable.id))
    .leftJoin(unitsTable, eq(assetsTable.unitId, unitsTable.id))
    .where(eq(assetsTable.id, assetId))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    assetType: r.assetType,
    propertyId: r.propertyId,
    propertyName: r.propertyName ?? null,
    unitId: r.unitId,
    unitNameOrNumber: r.unitNameOrNumber ?? null,
    status: r.status,
    stoplight: r.stoplight,
    healthScore: r.healthScore,
    installDate: r.installDate,
    warrantyStart: r.warrantyStart,
    warrantyExpiration: r.warrantyExpiration,
    lifeExpectancyYears: r.lifeExpectancyYears,
    location: r.location,
    model: r.model,
    serial: r.serial,
    manufacturer: null,
    maintenanceSchedule: r.maintenanceSchedule,
    linkageStatus: r.linkageStatus,
  };
}

// ─── summarizeAssetRegistry ───────────────────────────────────────────────────

export async function summarizeAssetRegistry(): Promise<AssetRegistrySummary> {
  const [allAssets, byStatusRaw, byTypeRaw, byStoplightRaw] = await Promise.all([
    db
      .select({
        id: assetsTable.id,
        propertyId: assetsTable.propertyId,
        propertyName: propertiesTable.name,
      })
      .from(assetsTable)
      .leftJoin(propertiesTable, eq(assetsTable.propertyId, propertiesTable.id)),

    db
      .select({
        status: assetsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(assetsTable)
      .groupBy(assetsTable.status),

    db
      .select({
        assetType: assetsTable.assetType,
        count: sql<number>`count(*)::int`,
      })
      .from(assetsTable)
      .groupBy(assetsTable.assetType),

    db
      .select({
        stoplight: assetsTable.stoplight,
        count: sql<number>`count(*)::int`,
      })
      .from(assetsTable)
      .groupBy(assetsTable.stoplight),
  ]);

  // Aggregate by property
  const propertyMap = new Map<string, { propertyId: number | null; propertyName: string; count: number }>();
  for (const row of allAssets) {
    const key = String(row.propertyId ?? "__none__");
    const existing = propertyMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      propertyMap.set(key, {
        propertyId: row.propertyId,
        propertyName: row.propertyName ?? "Unknown property",
        count: 1,
      });
    }
  }

  const byProperty = Array.from(propertyMap.values()).sort((a, b) => b.count - a.count);

  return {
    totalAssets: allAssets.length,
    byProperty,
    byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r.count })),
    byType: byTypeRaw
      .map((r) => ({ assetType: r.assetType ?? "Unknown", count: r.count }))
      .sort((a, b) => b.count - a.count),
    byStoplight: byStoplightRaw.map((r) => ({ stoplight: r.stoplight, count: r.count })),
  };
}
