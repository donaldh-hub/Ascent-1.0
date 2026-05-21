/**
 * Ascent 7.2.1 — Reporting Mode hook
 *
 * Lightweight client-side cache for the active Turn / Work Order
 * Reporting Mode. Used by both the Reports page indicator strip and the
 * Control Tower Priority Actions copy so they stay in lock-step.
 */

import { useCallback, useEffect, useState } from "react";

export type ReportingModeValue =
  | "separate_turns_and_work_orders"
  | "work_orders_measure_turn_progress"
  | "hybrid_or_unknown";

export interface ReportingModeRecord {
  mode: ReportingModeValue;
  source: string;
  isDefault: boolean;
  organizationId: number | null;
  propertyId: number | null;
  configuredByUserId: string | null;
  configuredAt: string;
  updatedAt: string;
  notes: string | null;
}

export const REPORTING_MODE_LABELS: Record<ReportingModeValue, string> = {
  separate_turns_and_work_orders: "Separate turns and work orders",
  work_orders_measure_turn_progress: "Work orders measure turn progress",
  hybrid_or_unknown: "Hybrid / not yet confirmed",
};

export const REPORTING_MODE_HELPER: Record<ReportingModeValue, string> = {
  separate_turns_and_work_orders:
    "Turn records live in the turns table; work orders stay in the work-order table. " +
    "Any imported WO category called 'Turn' is treated as a work order category only.",
  work_orders_measure_turn_progress:
    "This organization tracks turn progress through work orders (Turn / Make Ready / Punch / Paint etc.). " +
    "Turn-related work orders are surfaced as turn evidence alongside native turn records.",
  hybrid_or_unknown:
    "Default. Both turn records and turn-related work orders are kept separate but the " +
    "system flags potential turn-related work orders that still need confirmation.",
};

export function useReportingMode(): {
  record: ReportingModeRecord | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  setMode: (input: {
    mode: ReportingModeValue;
    notes?: string;
    reason?: string;
    userId?: string;
  }) => Promise<void>;
} {
  const [record, setRecord] = useState<ReportingModeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-config")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ReportingModeRecord) => setRecord(d))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refetch, [refetch]);

  const setMode = useCallback(
    async (input: {
      mode: ReportingModeValue;
      notes?: string;
      reason?: string;
      userId?: string;
    }) => {
      const res = await fetch("/api/reporting-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      refetch();
    },
    [refetch],
  );

  return { record, loading, error, refetch, setMode };
}
