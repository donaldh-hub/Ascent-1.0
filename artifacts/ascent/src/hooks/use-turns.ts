/**
 * Build 1.10 — Turn Matrix Hooks
 *
 * useTurnStats     — lightweight aggregate stats
 * useTurnMatrix    — full matrix analysis (bottleneck, property breakdown, congestion)
 * useTurns         — filtered turn list
 * importTurns      — POST rows to import endpoint
 * resetTurns       — POST to reset endpoint
 */

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TurnStatus = "active" | "completed" | "in_rework";
export type AgingSeverity = "critical" | "high" | "medium" | "low";

export interface EnrichedTurn {
  id: number;
  turnId: string | null;
  propertyId: number | null;
  propertyNameRaw: string | null;
  propertyName: string;
  unitId: number | null;
  unitNumber: string | null;
  turnStatus: TurnStatus;
  currentStage: string | null;
  completionPercentage: number;
  completionCalc: number;
  rentReady: boolean;
  rentReadyCalc: boolean;
  inspectionPassed: boolean;
  reworkRequired: boolean;
  reworkCompleted: boolean;
  daysInStage: number;
  totalDaysOpen: number;
  isBlocked: boolean;
  isBlockedCalc: boolean;
  blockedStage: string | null;
  agingSeverity: AgingSeverity;
  stageIndex: number;
  isActive: boolean;
  isCompleted: boolean;
  isInRework: boolean;
  statusLabel: string;
  explanation: string;
  importBatchId: string | null;
}

export interface StageBottleneckRow {
  stage: string;
  turnCount: number;
  blockedCount: number;
  avgDaysInStage: number;
  agingSeverity: AgingSeverity;
}

export interface BottleneckAnalysis {
  primaryStage: string;
  severityScore: number;
  explanation: string;
  stageBreakdown: StageBottleneckRow[];
}

export interface PropertyTurnSummary {
  propertyId: number | null;
  propertyName: string;
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  blockedTurns: number;
  reworkTurns: number;
  notRentReady: number;
  avgCompletion: number;
  primaryBottleneckStage: string | null;
  performanceScore: number;
  explanation: string;
}

export interface TurnMatrixResult {
  hasData: boolean;
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  reworkTurns: number;
  blockedTurns: number;
  notRentReadyCount: number;
  avgCompletionPct: number;
  bottleneck: BottleneckAnalysis | null;
  propertySummaries: PropertyTurnSummary[];
  stageCongestion: StageBottleneckRow[];
  dataQuality: string;
}

export interface TurnStats {
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  blockedTurns: number;
  reworkTurns: number;
  notRentReadyCount: number;
  avgCompletionPct: number;
  primaryBottleneckStage: string | null;
  bottleneckSeverity: number;
  bottleneckExplanation: string | null;
  propertyCount: number;
  hasData: boolean;
  dataQuality: string;
}

export interface TurnListResponse {
  turns: EnrichedTurn[];
  total: number;
  hasData: boolean;
  dataQuality: string;
}

export interface TurnImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  batchId: string;
  errors: string[];
}

// ─── useTurnStats ─────────────────────────────────────────────────────────────

export function useTurnStats() {
  const [data, setData] = useState<TurnStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = () => {
    setIsLoading(true);
    fetch("/api/turns/stats")
      .then(r => r.json())
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchStats(); }, []);
  return { data, isLoading, error, refetch: fetchStats };
}

// ─── useTurnMatrix ────────────────────────────────────────────────────────────

export function useTurnMatrix() {
  const [data, setData] = useState<TurnMatrixResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatrix = () => {
    setIsLoading(true);
    fetch("/api/turns/matrix")
      .then(r => r.json())
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchMatrix(); }, []);
  return { data, isLoading, error, refetch: fetchMatrix };
}

// ─── useTurns ─────────────────────────────────────────────────────────────────

export function useTurns(filters?: {
  status?: string;
  isBlocked?: boolean;
  propertyId?: number;
  limit?: number;
}) {
  const [data, setData] = useState<TurnListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchList = () => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.isBlocked) params.set("isBlocked", "true");
    if (filters?.propertyId) params.set("propertyId", String(filters.propertyId));
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();

    setIsLoading(true);
    fetch(`/api/turns${qs ? "?" + qs : ""}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchList(); }, [
    filters?.status,
    filters?.isBlocked,
    filters?.propertyId,
    filters?.limit,
  ]);
  return { data, isLoading, error, refetch: fetchList };
}

// ─── importTurns ─────────────────────────────────────────────────────────────

export async function importTurns(rows: Record<string, string>[]): Promise<TurnImportResult> {
  const res = await fetch("/api/turns/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.statusText}`);
  return res.json();
}

// ─── resetTurns ──────────────────────────────────────────────────────────────

export async function resetTurns(): Promise<void> {
  const res = await fetch("/api/turns/reset", { method: "POST" });
  if (!res.ok) throw new Error(`Reset failed: ${res.statusText}`);
}
