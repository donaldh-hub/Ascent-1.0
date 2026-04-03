/**
 * Phase 1 — Build 1.8: Frontend System Sync Hook
 *
 * Central reaction layer for the frontend. After any mutation:
 *   1. Invalidates all relevant React Query caches by URL prefix
 *   2. Shows a contextual, cause → effect toast message
 *
 * Usage:
 *   const { sync } = useSystemSync();
 *   // after a mutation succeeds:
 *   sync({ type: "workflow_item_moved", fromStage: "Open", toStage: "In Review", workflowId: 3 });
 */

import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ─── Event shape ──────────────────────────────────────────────────────────────

export type SystemEventType =
  | "document_uploaded"
  | "document_deleted"
  | "workflow_item_created"
  | "workflow_item_moved"
  | "workflow_item_updated"
  | "workflow_item_deleted"
  | "assignment_processed"
  | "assignment_confirmed"
  | "assignment_rejected"
  | "assignment_manual";

export interface SystemSyncEvent {
  type: SystemEventType;
  /** Used for contextual messages */
  fileName?: string;
  entityType?: string;
  itemTitle?: string;
  fromStage?: string;
  toStage?: string;
  unitNumber?: string;
  sourceType?: string;
  autoAssigned?: number;
  pendingConfirmation?: number;
  workflowId?: number;
}

// ─── Contextual messages (cause → effect language) ────────────────────────────

function getMessage(event: SystemSyncEvent): { title: string; description: string } {
  switch (event.type) {
    case "document_uploaded":
      return {
        title: "Document added — evidence updated",
        description: event.fileName
          ? `${event.fileName} attached${event.entityType ? ` to ${event.entityType.replace(/_/g, " ")}` : ""}. Alerts re-evaluated.`
          : "Evidence status updated. Alerts re-evaluated.",
      };
    case "document_deleted":
      return {
        title: "Document removed",
        description: event.fileName ? `${event.fileName} removed from evidence.` : "Document removed.",
      };
    case "workflow_item_created":
      return {
        title: "Item added — workflow updated",
        description: `"${event.itemTitle ?? "Item"}" added to workflow. Health score recalculating.`,
      };
    case "workflow_item_moved":
      return {
        title: "Item moved — health recalculated",
        description:
          event.fromStage && event.toStage
            ? `${event.fromStage} → ${event.toStage}. Bottleneck and scoring updated.`
            : "Stage changed. Workflow health and alerts updated.",
      };
    case "workflow_item_updated":
      return {
        title: "Item updated — alerts re-evaluated",
        description: `"${event.itemTitle ?? "Item"}" updated. Risk and timing alerts checked.`,
      };
    case "workflow_item_deleted":
      return {
        title: "Item removed — workflow recalculated",
        description: "Health score and bottleneck detection updated.",
      };
    case "assignment_processed":
      return {
        title: `${event.autoAssigned ?? 0} record${(event.autoAssigned ?? 0) !== 1 ? "s" : ""} auto-assigned`,
        description:
          (event.pendingConfirmation ?? 0) > 0
            ? `${event.pendingConfirmation} record${event.pendingConfirmation !== 1 ? "s" : ""} need confirmation. Unit histories updated.`
            : "All records processed. Unit histories and alerts updated.",
      };
    case "assignment_confirmed":
      return {
        title: `Record assigned to Unit ${event.unitNumber ?? "—"}`,
        description: `${event.sourceType ? event.sourceType.replace(/_/g, " ") + " record" : "Record"} linked. Unit history and alerts updated.`,
      };
    case "assignment_rejected":
      return {
        title: "Record moved to review queue",
        description: "You can manually assign this record at any time.",
      };
    case "assignment_manual":
      return {
        title: `Manually assigned to Unit ${event.unitNumber ?? "—"}`,
        description: "Record linked. Unit history and alerts updated.",
      };
    default:
      return { title: "System updated", description: "Changes synchronized." };
  }
}

// ─── Query invalidation map ───────────────────────────────────────────────────

/**
 * URL prefixes to invalidate for each event type.
 * React Query keys for generated hooks are URL strings like `/api/dashboard/intelligence`.
 * We match by prefix so all related sub-queries are covered.
 */
const INVALIDATION_MAP: Record<SystemEventType, string[]> = {
  document_uploaded: [
    "/api/documents",
    "/api/alerts",
    "/api/dashboard",
    "/api/units",
  ],
  document_deleted: [
    "/api/documents",
    "/api/alerts",
    "/api/dashboard",
    "/api/units",
  ],
  workflow_item_created: [
    "/api/workflows",
    "/api/dashboard",
    "/api/alerts",
  ],
  workflow_item_moved: [
    "/api/workflows",
    "/api/dashboard",
    "/api/alerts",
  ],
  workflow_item_updated: [
    "/api/workflows",
    "/api/dashboard",
    "/api/alerts",
  ],
  workflow_item_deleted: [
    "/api/workflows",
    "/api/dashboard",
    "/api/alerts",
  ],
  assignment_processed: [
    "/api/assignments",
    "/api/units",
    "/api/alerts",
    "/api/dashboard",
  ],
  assignment_confirmed: [
    "/api/assignments",
    "/api/units",
    "/api/alerts",
    "/api/dashboard",
  ],
  assignment_rejected: [
    "/api/assignments",
  ],
  assignment_manual: [
    "/api/assignments",
    "/api/units",
    "/api/alerts",
    "/api/dashboard",
  ],
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSystemSync() {
  const qc = useQueryClient();
  const { toast } = useToast();

  function sync(event: SystemSyncEvent) {
    // 1. Invalidate relevant React Query caches by URL prefix
    const prefixes = INVALIDATION_MAP[event.type] ?? [];
    qc.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        if (typeof key !== "string") return false;
        return prefixes.some(
          (prefix) => key === prefix || key.startsWith(prefix + "/") || key.startsWith(prefix + "?")
        );
      },
    });

    // Also invalidate custom (non-generated) query keys
    const customPrefixes: Record<SystemEventType, string[][]> = {
      document_uploaded: [["documents"], ["alerts"], ["dashboard"], ["units"]],
      document_deleted: [["documents"], ["alerts"], ["dashboard"], ["units"]],
      workflow_item_created: [["workflows"], ["dashboard"], ["alerts"]],
      workflow_item_moved: [["workflows"], ["dashboard"], ["alerts"]],
      workflow_item_updated: [["workflows"], ["dashboard"], ["alerts"]],
      workflow_item_deleted: [["workflows"], ["dashboard"], ["alerts"]],
      assignment_processed: [["assignments"], ["units"], ["alerts"], ["dashboard"]],
      assignment_confirmed: [["assignments"], ["units"], ["alerts"], ["dashboard"]],
      assignment_rejected: [["assignments"]],
      assignment_manual: [["assignments"], ["units"], ["alerts"], ["dashboard"]],
    };

    const custom = customPrefixes[event.type] ?? [];
    for (const key of custom) {
      qc.invalidateQueries({ queryKey: key });
    }

    // 2. Show contextual toast
    const { title, description } = getMessage(event);
    toast({ title, description });
  }

  return { sync };
}
