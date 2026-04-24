/**
 * Build 2.5 — Work Order Hooks (Extended: Turn + Bottleneck Layer)
 *
 * useWorkOrders — list work orders with optional filters
 * useWorkOrderStats — aggregate stats including bottleneck intelligence
 * importWorkOrders — POST rows to import endpoint
 * resetWorkOrders — POST to reset endpoint (clear all WO data)
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
  assignedTo: string | null;
  notes: string | null;

  // Hierarchy
  regionName: string | null;
  propertyNameRaw: string | null;
  unitNumberRaw: string | null;
  turnId: string | null;

  // Timeline
  createdDate: string | null;
  scheduledDate: string | null;
  firstResponseDate: string | null;
  completedDate: string | null;

  // Labor
  estimatedHours: number | null;
  actualHours: number | null;

  // SLA
  slaDeadlineHours: number;
  slaStatus: string;
  slaResponseDelayHours: number | null;

  // Turn stage
  stage: string | null;
  stageStatus: string | null;
  daysInStage: number | null;

  // Blockage
  isBlocked: boolean;
  delayReason: string | null;
  vendor: string | null;

  // Bottleneck
  bottleneckFlag: boolean;
  bottleneckType: string | null;
  aggregationScope: string | null;

  // Import metadata
  rawData: Record<string, string> | null;
  importBatchId: string | null;
  importedAt: string;
  updatedAt: string;

  // Governance
  importMode: string | null;
  resolutionStatus: "fully_resolved" | "partially_resolved" | "unresolved" | null;
  assignmentConfidence: "high" | "medium" | "low" | "none" | null;
  propertyMatchStatus: string | null;
  unitMatchStatus: string | null;
  sourceFileName: string | null;
  governanceNotes: string | null;
  excludedFromStrictWiring: boolean;
  availableForPropertyRollup: boolean;
  availableForUnitRollup: boolean;

  // Enriched
  unitNumber: string | null;
  propertyName: string | null;
}

export interface StageCongestion {
  stage: string;
  blockedCount: number;
  avgDaysInStage: number;
  properties: string[];
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
  blockedCount: number;
  blockedTurnCount: number;
  topCategory: string | null;
  topBottleneckStage: string | null;
  topBottleneckType: string | null;
  categories: {
    category: string;
    count: number;
    slaViolations: number;
    avgResponseHours: number | null;
    topUnit: string | null;
    blockedCount: number;
  }[];
  stageCongestion: StageCongestion[];
}

export interface GovernanceSummary {
  mode: "flexible" | "strict";
  totalRows: number;
  fullyResolved: number;
  partiallyResolved: number;
  unresolved: number;
  readyForFullWiring: number;
  needsUnitConfirmation: number;
  needsReview: number;
  slaViolations: number;
  blockedCount: number;
}

export interface WorkOrderImportResult {
  batchId: string;
  imported: number;
  errors: number;
  slaViolations: number;
  blockedCount: number;
  governance: GovernanceSummary;
  results: {
    row: number;
    status: "imported" | "error";
    workOrderId?: number;
    workflowItemId?: number;
    unitMatched: boolean;
    propertyMatched: boolean;
    propertyConfidence?: string;
    slaStatus: string;
    isBlocked: boolean;
    bottleneckType?: string | null;
    resolutionStatus?: "fully_resolved" | "partially_resolved" | "unresolved";
    assignmentConfidence?: "high" | "medium" | "low" | "none";
  }[];
}

export interface WorkOrderFilters {
  status?: string;
  category?: string;
  slaStatus?: string;
  propertyId?: number;
  isBlocked?: boolean;
  bottleneckType?: string;
  stage?: string;
  regionName?: string;
  limit?: number;
  /**
   * Operational signal — see operational-selectors.ts.
   * Valid: "sla_violations" | "aging_work_orders" | "blocked_work_orders".
   */
  signal?: string;
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
    if (filters.isBlocked) params.set("isBlocked", "true");
    if (filters.bottleneckType) params.set("bottleneckType", filters.bottleneckType);
    if (filters.stage) params.set("stage", filters.stage);
    if (filters.regionName) params.set("regionName", filters.regionName);
    if (filters.signal) params.set("signal", filters.signal);
    if (filters.limit) params.set("limit", String(filters.limit));

    setIsLoading(true);
    setError(null);

    fetch(`/api/work-orders?${params.toString()}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: WorkOrder[]) => { setData(d); setIsLoading(false); })
      .catch((e: Error) => { setError(e.message); setIsLoading(false); });
  };

  useEffect(() => { fetchData(); }, [
    filters.status, filters.category, filters.slaStatus, filters.propertyId,
    filters.isBlocked, filters.bottleneckType, filters.stage, filters.regionName, filters.limit,
    filters.signal,
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
  options: {
    slaDeadlineHours?: number;
    createWorkflowItems?: boolean;
    importMode?: "flexible" | "strict";
    sourceFileName?: string;
  } = {}
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

// ─── resetWorkOrders ──────────────────────────────────────────────────────────

export async function resetWorkOrders(): Promise<{ success: boolean; deleted: Record<string, number> }> {
  const response = await fetch("/api/work-orders/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

// ─── Impact types ─────────────────────────────────────────────────────────────

export type ImpactTier = "low" | "medium" | "high" | "critical";

export interface TopPriority {
  rank: number;
  label: string;
  category: string;
  propertyName: string;
  impactScore: number;
  tier: ImpactTier;
  count: number;
  blockedCount: number;
  reason: string;
  contributingIds: number[];
}

export interface PropertyImpact {
  propertyId: number | null;
  propertyName: string;
  totalImpact: number;
  avgImpact: number;
  count: number;
  blockedCount: number;
  rank: number;
  primaryCategory: string;
  tier: ImpactTier;
  explanation: string;
}

export interface CategoryImpact {
  category: string;
  totalImpact: number;
  avgImpact: number;
  count: number;
  blockedCount: number;
  blockedRatio: number;
  tier: ImpactTier;
  explanation: string;
  topContributors: { id: number; description: string | null; impactScore: number; propertyName: string | null }[];
}

export interface WorkOrderImpactAnalysis {
  generatedAt: string;
  totalImpact: number;
  avgImpact: number;
  topPriorities: TopPriority[];
  categoryImpact: CategoryImpact[];
  propertyImpact: PropertyImpact[];
  rows: WorkOrderImpactRow[];
  hasData: boolean;
}

export interface WorkOrderImpactRow {
  id: number;
  externalId: string | null;
  category: string;
  description: string | null;
  priority: string;
  status: string;
  isBlocked: boolean;
  bottleneckType: string | null;
  stage: string | null;
  daysInStage: number | null;
  propertyName: string | null;
  unitId: number | null;
  turnId: string | null;
  delayReason: string | null;
  slaStatus: string;
  impactScore: number;
  impactTier: ImpactTier;
  explanation: string;
}

// ─── useWorkOrderImpact ───────────────────────────────────────────────────────

export function useWorkOrderImpact() {
  const [data, setData] = useState<WorkOrderImpactAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchImpact = () => {
    setIsLoading(true);
    setError(null);

    fetch("/api/work-orders/impact")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: WorkOrderImpactAnalysis) => { setData(d); setIsLoading(false); })
      .catch((e: Error) => { setError(e.message); setIsLoading(false); });
  };

  useEffect(() => { fetchImpact(); }, []);

  return { data, isLoading, error, refetch: fetchImpact };
}
