/**
 * Phase 1 – Build 6.5: Evidence Visibility Layer
 *
 * useDocCounts — fetch attachment counts for a batch of entity IDs in one call.
 * Returns a map: entityId → { count, hasDocuments, lastDocumentAt }
 *
 * Used by the dashboard action panel and any surface that needs bulk counts.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export interface DocCount {
  count: number;
  hasDocuments: boolean;
  lastDocumentAt: string | null;
}

export type DocCountsMap = Record<number, DocCount>;

/**
 * useWorkflowDocTotals — fetch total doc counts for multiple workflows at once.
 * Groups all docs by linkedWorkflowId (includes docs on items within the workflow).
 * Returns a map: workflowId → { count, hasDocuments, lastDocumentAt }
 */
export function useWorkflowDocTotals(
  workflowIds: number[],
  options?: { enabled?: boolean; staleTime?: number }
) {
  const stableIds = useMemo(
    () => [...new Set(workflowIds.filter((id) => id > 0))].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflowIds.join(",")]
  );

  return useQuery<DocCountsMap>({
    queryKey: ["workflow-doc-totals", stableIds.join(",")],
    queryFn: async () => {
      if (stableIds.length === 0) return {};
      const params = new URLSearchParams({ workflowIds: stableIds.join(",") });
      const res = await fetch(`/api/documents/workflow-totals?${params}`);
      if (!res.ok) return {};
      return res.json() as Promise<DocCountsMap>;
    },
    enabled: stableIds.length > 0 && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 30_000,
  });
}

export function useDocCounts(
  entityType: string,
  entityIds: number[],
  options?: { enabled?: boolean; staleTime?: number }
) {
  const stableIds = useMemo(
    () => [...new Set(entityIds.filter((id) => id > 0))].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityIds.join(",")]
  );

  return useQuery<DocCountsMap>({
    queryKey: ["doc-counts", entityType, stableIds.join(",")],
    queryFn: async () => {
      if (stableIds.length === 0) return {};
      const params = new URLSearchParams({
        entityType,
        entityIds: stableIds.join(","),
      });
      const res = await fetch(`/api/documents/counts?${params}`);
      if (!res.ok) return {};
      return res.json() as Promise<DocCountsMap>;
    },
    enabled: stableIds.length > 0 && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 30_000,
  });
}
