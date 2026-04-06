import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { assetsTable, unitsTable, propertiesTable } from "@workspace/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { CreateAssetBody, UpdateAssetBody, ListAssetsQueryParams } from "@workspace/api-zod";
import { onAssetEvent } from "../engine/system-integration";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcWarrantyDays(warrantyExpiration: string | null): number | null {
  if (!warrantyExpiration) return null;
  const diff = new Date(warrantyExpiration).getTime() - Date.now();
  return Math.round(diff / 86400000);
}

function enrichAsset(asset: typeof assetsTable.$inferSelect) {
  const warrantyDaysRemaining = calcWarrantyDays(asset.warrantyExpiration);
  return { ...asset, warrantyDaysRemaining, createdAt: asset.createdAt.toISOString() };
}

// ─── Resolve unitId + propertyId from context fields ─────────────────────────
// Returns { unitId, propertyId, linkageStatus, location } given property/unit strings.

async function resolveUnitLinkage(propertyName: string, unitNumber: string): Promise<{
  unitId: number | null;
  propertyId: number | null;
  linkageStatus: string;
  location: string;
}> {
  const location = `${propertyName}, Unit ${unitNumber}`;

  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.name, propertyName));

  if (!property) {
    return { unitId: null, propertyId: null, linkageStatus: "unlinked", location };
  }

  const [unit] = await db
    .select()
    .from(unitsTable)
    .where(and(eq(unitsTable.propertyId, property.id), eq(unitsTable.unitNumber, unitNumber)));

  if (!unit) {
    return { unitId: null, propertyId: property.id, linkageStatus: "unlinked", location };
  }

  return { unitId: unit.id, propertyId: property.id, linkageStatus: "linked", location };
}

// ─── GET /assets ──────────────────────────────────────────────────────────────

router.get("/assets", async (req, res) => {
  try {
    const query = ListAssetsQueryParams.parse(req.query);
    const { unitId, propertyId, linkageStatus } = req.query as Record<string, string>;

    let rows = await db.select().from(assetsTable);

    if (query.status) rows = rows.filter((a) => a.status === query.status);
    if (unitId) rows = rows.filter((a) => a.unitId === parseInt(unitId));
    if (propertyId) rows = rows.filter((a) => a.propertyId === parseInt(propertyId));
    if (linkageStatus) rows = rows.filter((a) => a.linkageStatus === linkageStatus);

    res.json(rows.map(enrichAsset));
  } catch (err) {
    req.log.error({ err }, "Failed to list assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /assets/unit-counts ──────────────────────────────────────────────────
// Bulk asset counts by unit ID — same pattern as /documents/counts.
// Query: ?unitIds=1,2,3
// Returns: Record<unitId, { count, atRisk, expiringSoon }>

router.get("/assets/unit-counts", async (req, res) => {
  try {
    const { unitIds } = req.query as { unitIds?: string };
    if (!unitIds) { res.json({}); return; }

    const ids = unitIds.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
    if (ids.length === 0) { res.json({}); return; }

    const rows = await db
      .select()
      .from(assetsTable)
      .where(
        ids.length === 1
          ? eq(assetsTable.unitId, ids[0])
          : inArray(assetsTable.unitId, ids)
      );

    const today = new Date();
    const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

    const result: Record<number, { count: number; atRisk: number; expiringSoon: number }> = {};
    for (const id of ids) {
      const unitAssets = rows.filter((a) => a.unitId === id);
      let atRisk = 0;
      let expiringSoon = 0;
      for (const a of unitAssets) {
        if (!a.warrantyExpiration) continue;
        const exp = new Date(a.warrantyExpiration);
        if (exp < today) atRisk++;
        else if (exp < ninetyDays) expiringSoon++;
      }
      result[id] = { count: unitAssets.length, atRisk, expiringSoon };
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get unit asset counts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /assets/validate-unit-sync ──────────────────────────────────────────
// Cross-checks Asset Registry vs unit_id FK linkage for consistency.
// Returns any units where counts diverge between surfaces.

router.get("/assets/validate-unit-sync", async (req, res) => {
  try {
    const allAssets = await db.select({
      id: assetsTable.id,
      unitId: assetsTable.unitId,
      linkageStatus: assetsTable.linkageStatus,
    }).from(assetsTable);

    const unlinked = allAssets.filter((a) => !a.unitId);
    const linked = allAssets.filter((a) => a.unitId);

    const unitCounts: Record<number, number> = {};
    for (const a of linked) {
      unitCounts[a.unitId!] = (unitCounts[a.unitId!] ?? 0) + 1;
    }

    const inconsistencies: string[] = [];
    if (unlinked.length > 0) {
      inconsistencies.push(`${unlinked.length} assets have no unit_id`);
    }

    res.json({
      totalAssets: allAssets.length,
      linked: linked.length,
      unlinked: unlinked.length,
      uniqueUnitsWithAssets: Object.keys(unitCounts).length,
      inconsistencies,
      consistent: inconsistencies.length === 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to validate unit sync");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /assets/unit/:unitId ─────────────────────────────────────────────────

router.get("/assets/unit/:unitId", async (req, res) => {
  try {
    const unitId = parseInt(req.params.unitId, 10);
    if (isNaN(unitId)) {
      res.status(400).json({ error: "Invalid unit ID" });
      return;
    }
    const rows = await db.select().from(assetsTable).where(eq(assetsTable.unitId, unitId));
    res.json(rows.map(enrichAsset));
  } catch (err) {
    req.log.error({ err }, "Failed to list unit assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /assets/warranties ───────────────────────────────────────────────────

router.get("/assets/warranties", async (req, res) => {
  try {
    const assets = await db.select().from(assetsTable);
    const result = assets.map((a) => {
      const daysRemaining = calcWarrantyDays(a.warrantyExpiration);
      let status: string;
      let stoplight: string;

      if (!a.warrantyExpiration) {
        status = "unknown";
        stoplight = "yellow";
      } else if (daysRemaining !== null && daysRemaining < 0) {
        status = "expired";
        stoplight = "red";
      } else if (daysRemaining !== null && daysRemaining <= 90) {
        status = "expiring_soon";
        stoplight = "yellow";
      } else {
        status = "active";
        stoplight = "green";
      }

      return {
        assetId: a.id,
        assetName: a.name,
        warrantyExpiration: a.warrantyExpiration,
        daysRemaining,
        status,
        stoplight,
        unitId: a.unitId,
        propertyId: a.propertyId,
      };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get warranty status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /assets ─────────────────────────────────────────────────────────────
// Standard single-asset creation with optional context resolution.

router.post("/assets", async (req, res) => {
  try {
    const body = CreateAssetBody.parse(req.body);
    const { propertyName, unitNumber, ...rest } = body as typeof body & {
      propertyName?: string;
      unitNumber?: string;
    };

    let linkageFields: Partial<typeof assetsTable.$inferInsert> = {};
    if (propertyName && unitNumber) {
      const resolved = await resolveUnitLinkage(propertyName, unitNumber);
      linkageFields = {
        unitId: resolved.unitId ?? undefined,
        propertyId: resolved.propertyId ?? undefined,
        linkageStatus: resolved.linkageStatus,
        location: resolved.location,
      };
    }

    const [asset] = await db.insert(assetsTable).values({ ...rest, ...linkageFields }).returning();

    // Fire event ONLY after confirmed persistence
    await onAssetEvent("asset_created", asset.id);

    res.status(201).json(enrichAsset(asset));
  } catch (err) {
    req.log.error({ err }, "Failed to create asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /assets/import ─────────────────────────────────────────────────────
// Batch ingestion pipeline: normalize → match → deduplicate → persist → event.

router.post("/assets/import", async (req, res) => {
  try {
    const { records } = req.body as {
      records: Array<{
        name: string;
        serial?: string;
        assetType?: string;
        propertyName?: string;
        unitNumber?: string;
        installDate?: string;
        warrantyExpiration?: string;
        lifeExpectancyYears?: number;
        status?: string;
      }>;
    };

    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ error: "records array is required" });
      return;
    }

    const results = {
      created: 0,
      skipped_duplicate: 0,
      linked: 0,
      unlinked: 0,
      errors: [] as string[],
    };

    for (const record of records) {
      try {
        // Step 1: Normalize
        const name = (record.name ?? "").trim();
        if (!name) { results.errors.push("Missing name"); continue; }

        const serial = record.serial?.trim() || null;

        // Step 2: Deduplication — skip if serial already exists for this unit
        if (serial) {
          const existing = await db
            .select()
            .from(assetsTable)
            .where(eq(assetsTable.serial, serial));
          if (existing.length > 0) {
            results.skipped_duplicate++;
            continue;
          }
        }

        // Step 3: Match to unit/property context
        let linkageFields: Partial<typeof assetsTable.$inferInsert> = { linkageStatus: "unlinked" };
        if (record.propertyName && record.unitNumber) {
          const resolved = await resolveUnitLinkage(record.propertyName, record.unitNumber);
          linkageFields = {
            unitId: resolved.unitId ?? undefined,
            propertyId: resolved.propertyId ?? undefined,
            linkageStatus: resolved.linkageStatus,
            location: resolved.location,
          };
        }

        // Step 4: Compute health + stoplight from warranty dates
        const TODAY = new Date();
        const SIX_MONTHS = new Date(TODAY.getTime() + 90 * 24 * 60 * 60 * 1000);
        let status = "active";
        let stoplight = "green";
        let healthScore = 100;

        if (record.warrantyExpiration) {
          const exp = new Date(record.warrantyExpiration);
          const install = record.installDate ? new Date(record.installDate) : TODAY;
          const totalMs = exp.getTime() - install.getTime();
          const remainingMs = exp.getTime() - TODAY.getTime();

          if (exp < TODAY) {
            status = "at_risk"; stoplight = "red"; healthScore = 0;
          } else if (exp < SIX_MONTHS) {
            stoplight = "yellow";
            healthScore = Math.max(0, Math.round((remainingMs / totalMs) * 100));
          } else {
            healthScore = Math.max(0, Math.min(100, Math.round((remainingMs / totalMs) * 100)));
          }
        }

        // Step 5: Persist — only create after all validation passes
        const [asset] = await db.insert(assetsTable).values({
          name,
          serial,
          assetType: record.assetType ?? null,
          status,
          stoplight,
          healthScore,
          installDate: record.installDate ?? null,
          warrantyExpiration: record.warrantyExpiration ?? null,
          lifeExpectancyYears: record.lifeExpectancyYears ?? null,
          ...linkageFields,
        }).returning();

        // Step 6: Fire event ONLY after persistence confirmed
        await onAssetEvent("asset_created", asset.id);

        results.created++;
        if (linkageFields.linkageStatus === "linked") results.linked++;
        else results.unlinked++;

      } catch (recordErr: any) {
        results.errors.push(recordErr.message ?? "Unknown error");
      }
    }

    res.status(201).json(results);
  } catch (err) {
    req.log.error({ err }, "Failed to import assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /assets/reconcile ───────────────────────────────────────────────────
// Backfill linkage for any assets missing unitId/propertyId.

router.post("/assets/reconcile", async (req, res) => {
  try {
    const unlinked = await db
      .select()
      .from(assetsTable)
      .where(isNull(assetsTable.unitId));

    let fixed = 0;
    const LOCATION_RE = /^(.+),\s*Unit\s+(\S+)$/i;

    for (const asset of unlinked) {
      if (!asset.location) continue;
      const m = LOCATION_RE.exec(asset.location);
      if (!m) continue;

      const propertyName = m[1].trim();
      const unitNumber = m[2].trim();
      const resolved = await resolveUnitLinkage(propertyName, unitNumber);

      if (resolved.unitId) {
        await db.update(assetsTable)
          .set({
            unitId: resolved.unitId,
            propertyId: resolved.propertyId ?? undefined,
            linkageStatus: "linked",
          })
          .where(eq(assetsTable.id, asset.id));
        fixed++;
      }
    }

    res.json({ scanned: unlinked.length, fixed });
  } catch (err) {
    req.log.error({ err }, "Failed to reconcile assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /assets/:id ─────────────────────────────────────────────────────────

router.get("/assets/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
    if (!asset) return res.status(404).json({ error: "Not found" });
    res.json(enrichAsset(asset));
  } catch (err) {
    req.log.error({ err }, "Failed to get asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /assets/:id ──────────────────────────────────────────────────────────

router.put("/assets/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = UpdateAssetBody.parse(req.body);
    const [asset] = await db.update(assetsTable).set(body).where(eq(assetsTable.id, id)).returning();
    if (!asset) return res.status(404).json({ error: "Not found" });
    res.json(enrichAsset(asset));
  } catch (err) {
    req.log.error({ err }, "Failed to update asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /assets/:id ───────────────────────────────────────────────────────

router.delete("/assets/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(assetsTable).where(eq(assetsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
