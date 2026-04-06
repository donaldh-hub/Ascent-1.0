/**
 * Phase 1 — Portfolio Control Tower hook
 * Fetches /api/dashboard/portfolio — property-level aggregated health signals.
 */

import { useQuery } from "@tanstack/react-query";

export interface PropertyPortfolioCard {
  propertyId: number;
  propertyName: string;
  healthScore: number;
  stoplight: "green" | "yellow" | "red";
  flowScore: number;
  riskScore: number;
  improvementScore: number;
  executionScore: number;
  criticalItemsCount: number;
  topBottleneck: string;
  bottleneckAging: number;
  missingDocsCount: number;
  documentCount: number;
  trendDirection: "up" | "down" | "stable";
  supervisorName: string | null;
  supervisorEmail: string | null;
  insightSummary: string;
  communicationSummary: string;
  totalAssets: number;
  atRiskAssets: number;
  expiringSoonAssets: number;
  unitCoverage: number;
}

export function usePortfolio() {
  return useQuery<PropertyPortfolioCard[]>({
    queryKey: ["dashboard", "portfolio"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/portfolio");
      if (!res.ok) throw new Error("Failed to load portfolio");
      return res.json();
    },
    staleTime: 60_000,
  });
}
