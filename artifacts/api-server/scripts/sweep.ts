/**
 * System Sweep / Demo Reset Script
 *
 * Clears all test/demo data while preserving system structure.
 *
 * PRESERVES: properties, units, database schema, all engines
 * CLEARS: workflows, stages, items, item history, impact events,
 *         alerts, documents (+ GCS files), assignments, assets
 *
 * Usage: pnpm --filter @workspace/api-server tsx scripts/sweep.ts
 */

import { db } from "@workspace/db";
import {
  workflowItemHistoryTable,
  workflowItemsTable,
  impactEventsTable,
  stagesTable,
  workflowsTable,
  alertsTable,
  documentsTable,
  assignmentsTable,
  assetsTable,
} from "@workspace/db/schema";

const SIDECAR = "http://127.0.0.1:1106";

// ─── GCS file deletion ────────────────────────────────────────────────────────

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error(`Invalid object path: ${path}`);
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function deleteGCSFile(objectPath: string): Promise<void> {
  try {
    let resolvedPath = objectPath;

    if (objectPath.startsWith("/objects/")) {
      const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
      const entityId = objectPath.slice("/objects/".length);
      resolvedPath = `${privateDir.endsWith("/") ? privateDir : privateDir + "/"}${entityId}`;
    }

    const { bucketName, objectName } = parseObjectPath(resolvedPath);

    const signRes = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method: "DELETE",
        expires_at: new Date(Date.now() + 120_000).toISOString(),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!signRes.ok) {
      console.warn(`  ⚠ Could not sign delete URL for ${objectPath} (${signRes.status})`);
      return;
    }

    const { signed_url } = await signRes.json();
    const delRes = await fetch(signed_url, { method: "DELETE", signal: AbortSignal.timeout(15_000) });

    if (delRes.ok || delRes.status === 404) {
      console.log(`  ✓ GCS object deleted: ${objectPath}`);
    } else {
      console.warn(`  ⚠ GCS delete returned ${delRes.status} for ${objectPath}`);
    }
  } catch (err: any) {
    console.warn(`  ⚠ GCS delete failed (non-fatal): ${err.message}`);
  }
}

// ─── Main sweep ───────────────────────────────────────────────────────────────

async function sweep() {
  console.log("=".repeat(60));
  console.log("ASCENT 1.0 — SYSTEM SWEEP / DEMO RESET");
  console.log("=".repeat(60));
  console.log();

  // 1. Collect document paths before clearing records
  console.log("► Step 1: Collecting document object paths...");
  const docs = await db.select({ id: documentsTable.id, objectPath: documentsTable.objectPath }).from(documentsTable);
  console.log(`  Found ${docs.length} document record(s).`);

  // 2. Delete GCS objects (best-effort)
  if (docs.length > 0) {
    console.log("► Step 2: Deleting files from object storage...");
    for (const doc of docs) {
      await deleteGCSFile(doc.objectPath);
    }
  } else {
    console.log("► Step 2: No files to delete from object storage.");
  }

  // 3. Clear DB tables in correct dependency order
  console.log("► Step 3: Clearing database tables...");

  await db.delete(workflowItemHistoryTable);
  console.log("  ✓ workflow_item_history");

  await db.delete(workflowItemsTable);
  console.log("  ✓ workflow_items");

  await db.delete(impactEventsTable);
  console.log("  ✓ impact_events");

  await db.delete(stagesTable);
  console.log("  ✓ stages");

  await db.delete(workflowsTable);
  console.log("  ✓ workflows");

  await db.delete(alertsTable);
  console.log("  ✓ alerts");

  await db.delete(assignmentsTable);
  console.log("  ✓ assignments");

  await db.delete(documentsTable);
  console.log("  ✓ documents");

  await db.delete(assetsTable);
  console.log("  ✓ assets");

  console.log();
  console.log("=".repeat(60));
  console.log("SWEEP COMPLETE — System ready for clean demo.");
  console.log("=".repeat(60));
  console.log();
  console.log("PRESERVED:");
  console.log("  ✓ All properties and units");
  console.log("  ✓ Database schema and structure");
  console.log("  ✓ All system engines (workflow, scoring, alert, assignment, sync)");
  console.log();
  console.log("CLEARED:");
  console.log("  ✓ Workflows, stages, items, item history, impact events");
  console.log("  ✓ All alerts (active + historical)");
  console.log("  ✓ All assignments and review queue");
  console.log("  ✓ All documents and object storage files");
  console.log("  ✓ All assets");
  console.log("=".repeat(60));
}

sweep()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nSWEEP FAILED:", err);
    process.exit(1);
  });
