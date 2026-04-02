import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { assetsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { CreateAssetBody, UpdateAssetBody, ListAssetsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

function calcWarrantyDays(warrantyExpiration: string | null): number | null {
  if (!warrantyExpiration) return null;
  const diff = new Date(warrantyExpiration).getTime() - Date.now();
  return Math.round(diff / 86400000);
}

function enrichAsset(asset: typeof assetsTable.$inferSelect) {
  const warrantyDaysRemaining = calcWarrantyDays(asset.warrantyExpiration);
  return { ...asset, warrantyDaysRemaining, createdAt: asset.createdAt.toISOString() };
}

router.get("/assets", async (req, res) => {
  try {
    const query = ListAssetsQueryParams.parse(req.query);
    let rows = await db.select().from(assetsTable);
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    res.json(rows.map(enrichAsset));
  } catch (err) {
    req.log.error({ err }, "Failed to list assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/assets", async (req, res) => {
  try {
    const body = CreateAssetBody.parse(req.body);
    const [asset] = await db.insert(assetsTable).values(body).returning();
    res.status(201).json(enrichAsset(asset));
  } catch (err) {
    req.log.error({ err }, "Failed to create asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

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
      };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get warranty status");
    res.status(500).json({ error: "Internal server error" });
  }
});

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
