/**
 * Phase 1 — Build 1.8: System Integration Engine
 *
 * Centralized reaction layer. Called after any state-mutating event to:
 *   1. Re-evaluate all alert rules (deduplication-safe, lifecycle-managed)
 *   2. Log the event for traceability
 *
 * Design principles:
 *   - Synchronous by default so the API response reflects the updated state
 *   - One function per event category — no branching inside callers
 *   - Never duplicates scoring or alert logic — delegates to existing engines
 */

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
  | "workflow_item_deleted";

export interface SystemEvent {
  type: SystemEventType;
  workflowId?: number;
  entityId?: number;
  metadata?: Record<string, unknown>;
}

// ─── Core sync function ───────────────────────────────────────────────────────

/**
 * Run a full system sync after a state-mutating event.
 *
 * This is intentionally synchronous (await it before sending responses) so
 * that the client receives an already-consistent system state.
 *
 * Fast path: alert evaluation typically < 100 ms.
 */
export async function runEventSync(event: SystemEvent): Promise<{ alertsUpdated: number }> {
  try {
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

export const onDocumentEvent = (type: "document_uploaded" | "document_deleted", entityId?: number) =>
  runEventSync({ type, entityId });

export const onWorkflowItemEvent = (
  type: "workflow_item_created" | "workflow_item_moved" | "workflow_item_updated" | "workflow_item_deleted",
  workflowId: number,
  entityId?: number
) => runEventSync({ type, workflowId, entityId });
