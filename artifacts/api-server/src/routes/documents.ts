import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { documentsTable, insertDocumentSchema } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

// ─── Request presigned upload URL ───────────────────────────────────────────

router.post("/storage/uploads/request-url", async (req, res) => {
  const { name, size, contentType } = req.body as {
    name?: string;
    size?: number;
    contentType?: string;
  };

  if (!name || !contentType) {
    res.status(400).json({ error: "name and contentType are required" });
    return;
  }

  try {
    const storage = new ObjectStorageService();
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);

    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, "Failed to generate upload URL");
    res.status(500).json({ error: "Upload URL generation failed" });
  }
});

// ─── Serve stored objects ────────────────────────────────────────────────────

router.get("/storage/objects/{*objectPath}", async (req, res) => {
  const objectPath = "/" + ((req.params as any).objectPath ?? "");
  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(objectPath);
    const response = await storage.downloadObject(file);
    const arrayBuffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("Content-Type") ?? "application/octet-stream");
    const cacheHeader = response.headers.get("Cache-Control");
    if (cacheHeader) res.setHeader("Cache-Control", cacheHeader);
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    if (err?.name === "ObjectNotFoundError") {
      res.status(404).json({ error: "Object not found" });
    } else {
      req.log.error({ err }, "Failed to serve object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  }
});

// ─── Bulk attachment counts ──────────────────────────────────────────────────
// GET /api/documents/counts?entityType=workflow_item&entityIds=1,2,3
// Returns: Record<entityId, { count, hasDocuments, lastDocumentAt }>

router.get("/documents/counts", async (req, res) => {
  const { entityType, entityIds } = req.query as { entityType?: string; entityIds?: string };

  if (!entityType || !entityIds) {
    res.json({});
    return;
  }

  const ids = entityIds
    .split(",")
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) {
    res.json({});
    return;
  }

  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.linkedEntityType, entityType),
          inArray(documentsTable.linkedEntityId, ids)
        )
      );

    const result: Record<
      number,
      { count: number; hasDocuments: boolean; lastDocumentAt: string | null }
    > = {};

    for (const id of ids) {
      const entityDocs = docs.filter((d) => d.linkedEntityId === id);
      const sorted = [...entityDocs].sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
      result[id] = {
        count: entityDocs.length,
        hasDocuments: entityDocs.length > 0,
        lastDocumentAt: sorted[0]?.uploadedAt
          ? new Date(sorted[0].uploadedAt).toISOString()
          : null,
      };
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get document counts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Per-workflow total doc counts ───────────────────────────────────────────
// GET /api/documents/workflow-totals?workflowIds=1,2,3
// Returns: Record<workflowId, { count, hasDocuments, lastDocumentAt }>

router.get("/documents/workflow-totals", async (req, res) => {
  const { workflowIds } = req.query as { workflowIds?: string };

  if (!workflowIds) {
    res.json({});
    return;
  }

  const ids = workflowIds
    .split(",")
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) {
    res.json({});
    return;
  }

  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(inArray(documentsTable.linkedWorkflowId, ids));

    const result: Record<
      number,
      { count: number; hasDocuments: boolean; lastDocumentAt: string | null }
    > = {};

    for (const id of ids) {
      const wfDocs = docs.filter((d) => d.linkedWorkflowId === id);
      const sorted = [...wfDocs].sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
      result[id] = {
        count: wfDocs.length,
        hasDocuments: wfDocs.length > 0,
        lastDocumentAt: sorted[0]?.uploadedAt
          ? new Date(sorted[0].uploadedAt).toISOString()
          : null,
      };
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get workflow document totals");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Create document record ──────────────────────────────────────────────────

router.post("/documents", async (req, res) => {
  const parse = insertDocumentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid document data", issues: parse.error.issues });
    return;
  }

  try {
    const [doc] = await db.insert(documentsTable).values(parse.data).returning();
    res.status(201).json(doc);
  } catch (err) {
    req.log.error({ err }, "Failed to create document record");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── List documents by entity ────────────────────────────────────────────────

router.get("/documents", async (req, res) => {
  const { entityType, entityId, workflowId } = req.query as {
    entityType?: string;
    entityId?: string;
    workflowId?: string;
  };

  try {
    let docs;
    if (entityType && entityId) {
      docs = await db
        .select()
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.linkedEntityType, entityType),
            eq(documentsTable.linkedEntityId, Number(entityId))
          )
        )
        .orderBy(documentsTable.uploadedAt);
    } else if (workflowId) {
      docs = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.linkedWorkflowId, Number(workflowId)))
        .orderBy(documentsTable.uploadedAt);
    } else {
      docs = await db
        .select()
        .from(documentsTable)
        .orderBy(documentsTable.uploadedAt);
    }
    res.json(docs);
  } catch (err) {
    req.log.error({ err }, "Failed to list documents");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Get single document ─────────────────────────────────────────────────────

router.get("/documents/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json(doc);
  } catch (err) {
    req.log.error({ err }, "Failed to get document");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Delete document ─────────────────────────────────────────────────────────

router.delete("/documents/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    // Optionally delete from GCS (best-effort)
    try {
      const storage = new ObjectStorageService();
      const file = await storage.getObjectEntityFile(doc.objectPath);
      await file.delete();
    } catch (_) {
      // Non-fatal — object may already be gone
    }

    await db.delete(documentsTable).where(eq(documentsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete document");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
