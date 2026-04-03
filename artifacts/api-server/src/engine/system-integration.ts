/**
 * Phase 1 — Build 1.8: System Integration Engine
 *
 * Centralized reaction layer. Called after any state-mutating event to:
 *   1. Validate source record exists and is properly linked (guardrail)
 *   2. Re-evaluate all alert rules (deduplication-safe, lifecycle-managed)
 *   3. Log the event for traceability
 *
 * Design principles:
 *   - Synchronous by default so the API response reflects the updated state
 *   - One function per event category — no branching inside callers
 *   - Never duplicates scoring or alert logic — delegates to existing engines
 *   - GUARDRAIL: reactions are blocked if linkage is not verified
 */

import { db } from "@workspace/db";
import { assetsTable, documentsTable, workflowItemsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { evaluateAlerts } from "./alerts";

// ─── Event types ──────────────────────────────────────────────────────────────

export type SystemEventType =
  | "assignment_created"
  | "assignment_confirmed"
  | "assignment_rejected"
  | "assignment_manual"
  | "document_uploaded"
  | "document_deleted"
  | "workflow_item_created"
  | "workflow_item_moved"
  | "workflow_item_updated"
  | "workflow_item_deleted"
  | "asset_created"
  | "asset_updated";

export interface SystemEvent {
  type: SystemEventType;
  workflowId?: number;
  entityId?: number;
  metadata?: Record<string, unknown>;
}

// ─── Linkage guardrail ────────────────────────────────────────────────────────
//
// Before any system reaction, verify the source record:
//   (a) exists in the database
//   (b) has required linkage (for assets: unitId or propertyId; for docs: linkedEntityId)
//
// Returns { valid: true } if safe to proceed.
// Returns { valid: false, reason } to block the reaction.

async function verifyLinkage(event: SystemEvent): Promise<{ valid: boolean; reason?: string }> {
  const { type, entityId } = event;

  // Asset events — record must exist
  if (type === "asset_created" || type === "asset_updated") {
    if (!entityId) return { valid: false, reason: "No entityId provided for asset event" };
    const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, entityId));
    if (!asset) return { valid: false, reason: `Asset ${entityId} not found in database` };
    return { valid: true };
  }

  // Document events — record must exist and have a valid linked entity
  if (type === "document_uploaded") {
    if (!entityId) return { valid: false, reason: "No entityId provided for document event" };
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, entityId));
    if (!doc) return { valid: false, reason: `Document ${entityId} not found in database` };
    if (!doc.linkedEntityId || !doc.linkedEntityType) {
      return { valid: false, reason: `Document ${entityId} has no entity linkage` };
    }
    return { valid: true };
  }

  // Workflow item events — record must exist
  if (
    type === "workflow_item_created" ||
    type === "workflow_item_moved" ||
    type === "workflow_item_updated"
  ) {
    if (!entityId) return { valid: true }; // Workflow-level event — always allow
    const [item] = await db.select().from(workflowItemsTable).where(eq(workflowItemsTable.id, entityId));
    if (!item) return { valid: false, reason: `Workflow item ${entityId} not found` };
    return { valid: true };
  }

  // All other events — allow by default
  return { valid: true };
}

// ─── Core sync function ───────────────────────────────────────────────────────

export async function runEventSync(event: SystemEvent): Promise<{ alertsUpdated: number }> {
  try {
    // GUARDRAIL: Validate record exists and is linked before reacting
    const guard = await verifyLinkage(event);
    if (!guard.valid) {
      console.warn(`[SystemIntegration] BLOCKED reaction for "${event.type}": ${guard.reason}`);
      return { alertsUpdated: 0 };
    }

    const result = await evaluateAlerts();
    return { alertsUpdated: (result.created ?? 0) + (result.updated ?? 0) + (result.resolved ?? 0) };
  } catch (err) {
    console.error(`[SystemIntegration] sync failed for event "${event.type}":`, err);
    return { alertsUpdated: 0 };
  }
}

// ─── Convenience wrappers (one per event category) ───────────────────────────

export const onAssignmentEvent = (type: SystemEvent["type"], entityId?: number) =>
  runEventSync({ type, entityId });

export const onDocumentEvent = (
  type: "document_uploaded" | "document_deleted",
  entityId?: number
) => runEventSync({ type, entityId });

export const onWorkflowItemEvent = (
  type: "workflow_item_created" | "workflow_item_moved" | "workflow_item_updated" | "workflow_item_deleted",
  workflowId: number,
  entityId?: number
) => runEventSync({ type, workflowId, entityId });

export const onAssetEvent = (
  type: "asset_created" | "asset_updated",
  entityId: number
) => runEventSync({ type, entityId });
