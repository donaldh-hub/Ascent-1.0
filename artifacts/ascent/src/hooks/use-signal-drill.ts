/**
 * useSignalDrill — Signal-to-Query Hook
 *
 * Fetches structured drill-down data from /api/drill for a given signal type.
 * Pass `enabled: false` until the user actually opens the panel (lazy loading).
 */

import { useState, useEffect } from "react";

export type SignalType =
  | "expired_warranty"
  | "expiring_soon"
  | "critical_items"
  | "overdue_items"
  | "bottleneck_items"
  | "stale_items"
  | "at_risk_workflows"
  | "sla_violations"
  | "aging_work_orders"
  | "category_spike"
  | "blocked_turns"
  | "stage_congestion"
  | "rework_loop"
  | "not_rent_ready";

export type BadgeColor = "red" | "yellow" | "green" | "blue";

export interface DrillRow {
  id: number;
  rowType: "asset" | "alert" | "item" | "workflow";
  title: string;
  subtitle: string;
  detail: string;
  badge?: string;
  badgeColor?: BadgeColor;
  navigateTo?: string;
  cost?: number | null;
  meta: Record<string, unknown>;
}

export interface DrillData {
  signal: SignalType;
  title: string;
  total: number;
  totalCost?: number | null;
  costMatchedCount?: number;
  triggerExplanation: string;
  rows: DrillRow[];
}

export interface SignalDrillParams {
  signal: SignalType;
  propertyId?: number;
  workflowId?: number;
  stageId?: number;
  stage?: string;
  enabled?: boolean;
}

export function useSignalDrill({
  signal,
  propertyId,
  workflowId,
  stageId,
  stage,
  enabled = true,
}: SignalDrillParams): { data: DrillData | null; isLoading: boolean; error: string | null } {
  const [data, setData] = useState<DrillData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const params = new URLSearchParams({ signal });
    if (propertyId != null) params.set("propertyId", String(propertyId));
    if (workflowId != null) params.set("workflowId", String(workflowId));
    if (stageId != null) params.set("stageId", String(stageId));
    if (stage != null) params.set("stage", stage);

    setIsLoading(true);
    setError(null);

    fetch(`/api/drill?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DrillData) => {
        setData(d);
        setIsLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setIsLoading(false);
      });
  }, [enabled, signal, propertyId, workflowId, stageId]);

  return { data, isLoading, error };
}
