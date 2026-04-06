import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export interface AssetCount {
  count: number;
  atRisk: number;
  expiringSoon: number;
}

export type AssetCountsMap = Record<number, AssetCount>;

export function useAssetCounts(
  unitIds: number[],
  options?: { enabled?: boolean; staleTime?: number }
) {
  const stableIds = useMemo(
    () => [...new Set(unitIds.filter((id) => id > 0))].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unitIds.join(",")]
  );

  return useQuery<AssetCountsMap>({
    queryKey: ["asset-counts", stableIds.join(",")],
    queryFn: async () => {
      if (stableIds.length === 0) return {};
      const params = new URLSearchParams({ unitIds: stableIds.join(",") });
      const res = await fetch(`/api/assets/unit-counts?${params}`);
      if (!res.ok) return {};
      return res.json() as Promise<AssetCountsMap>;
    },
    enabled: stableIds.length > 0 && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 30_000,
  });
}
