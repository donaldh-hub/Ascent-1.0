import { useQuery } from "@tanstack/react-query";

export type UnitHistoryEventType = "unit_created" | "document_uploaded";

export interface UnitHistoryEvent {
  id: string;
  eventType: UnitHistoryEventType;
  title: string;
  description: string;
  timestamp: string;
  actor: string;
  meta: Record<string, unknown>;
}

export interface UnitHistory {
  unitId: number;
  events: UnitHistoryEvent[];
  documentCount: number;
  workItemCount: number;
  assetCount: number;
  latestActivityAt: string | null;
}

export function useUnitHistory(unitId: number, options?: { enabled?: boolean }) {
  return useQuery<UnitHistory>({
    queryKey: ["unit-history", unitId],
    queryFn: async () => {
      const res = await fetch(`/api/units/${unitId}/history`);
      if (!res.ok) throw new Error("Failed to fetch unit history");
      return res.json() as Promise<UnitHistory>;
    },
    enabled: unitId > 0 && (options?.enabled ?? true),
    staleTime: 30_000,
  });
}
