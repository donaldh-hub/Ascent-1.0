/**
 * Build 2.5 — Work Order Hooks
 *
 * useWorkOrders — list work orders with optional filters
 * useWorkOrderStats — aggregate stats for dashboard intelligence
 */

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkOrder {
  id: number;
  externalId: string | null;
  propertyId: number | null;
  unitId: number | null;
  assetId: number | null;
  workflowItemId: number | null;
  category: string | null;
  description: string | null;
  priority: string;
  status: string;
  createdDate: string | null;
  firstResponseDate: string | null;
  completedDate: string | null;
  slaDeadlineHours: number;
  slaStatus: string;
  slaResponseDelayHours: number | null;
  rawData: Record<string, string> | null;
  importBatchId: string | null;
  importedAt: string;
  updatedAt: string;
  // Enriched fields
  unitNumber: string | null;
  propertyName: string | null;
}

export interface WorkOrderStats {
  total: number;
  open: number;
  completed: number;
  slaMetCount: number;
  slaMissedCount: number;
  slaPendingCount: number;
  slaComplianceRate: number;
  agingCount: number;
  topCategory: string | null;
  categories: {
    category: string;
    count: number;
    slaViolations: number;
    avgResponseHours: number | null;
    topUnit: string | null;
  }[];
}

export interface WorkOrderImportResult {
  batchId: string;
  imported: number;
  errors: number;
  slaViolations: number;
  results: {
    row: number;
    status: "imported" | "unmatched" | "error";
    workOrderId?: number;
    workflowItemId?: number;
    unitMatched: boolean;
    propertyMatched: boolean;
    slaStatus: string;
  }[];
}

export interface WorkOrderFilters {
  status?: string;
  category?: string;
  slaStatus?: string;
  propertyId?: number;
  limit?: number;
}

// ─── useWorkOrders ────────────────────────────────────────────────────────────

export function useWorkOrders(filters: WorkOrderFilters = {}) {
  const [data, setData] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = () => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.slaStatus) params.set("slaStatus", filters.slaStatus);
    if (filters.propertyId) params.set("propertyId", String(filters.propertyId));
    if (filters.limit) params.set("limit", String(filters.limit));

    setIsLoading(true);
    setError(null);

    fetch(`/api/work-orders?${params.toString()}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: WorkOrder[]) => { setData(d); setIsLoading(false); })
      .catch((e: Error) => { setError(e.message); setIsLoading(false); });
  };

  useEffect(() => { fetchData(); }, [
    filters.status, filters.category, filters.slaStatus, filters.propertyId, filters.limit,
  ]);

  return { data, isLoading, error, refetch: fetchData };
}

// ─── useWorkOrderStats ────────────────────────────────────────────────────────

export function useWorkOrderStats() {
  const [data, setData] = useState<WorkOrderStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = () => {
    setIsLoading(true);
    setError(null);

    fetch("/api/work-orders/stats")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: WorkOrderStats) => { setData(d); setIsLoading(false); })
      .catch((e: Error) => { setError(e.message); setIsLoading(false); });
  };

  useEffect(() => { fetchStats(); }, []);

  return { data, isLoading, error, refetch: fetchStats };
}

// ─── importWorkOrders ─────────────────────────────────────────────────────────

export async function importWorkOrders(
  rows: Record<string, string>[],
  options: { slaDeadlineHours?: number; createWorkflowItems?: boolean } = {}
): Promise<WorkOrderImportResult> {
  const response = await fetch("/api/work-orders/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, ...options }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}
