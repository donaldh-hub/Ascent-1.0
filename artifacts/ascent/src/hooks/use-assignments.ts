/**
 * Build 1.7: Assignment Engine — frontend hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssignmentUnit {
  id: number;
  unitNumber: string;
  propertyId: number;
}

export interface AssignmentProperty {
  id: number;
  name: string;
  address: string | null;
}

export interface Assignment {
  id: number;
  sourceType: string;
  sourceData: Record<string, unknown>;
  targetEntityType: string | null;
  targetEntityId: number | null;
  confidenceLevel: "high" | "medium" | "low";
  assignmentMethod: string | null;
  status: "assigned" | "pending" | "rejected";
  explanation: string;
  createdAt: string;
  updatedAt: string;
  unit: AssignmentUnit | null;
  property: AssignmentProperty | null;
}

export interface ProcessResult {
  sourceType: string;
  sourceData: Record<string, unknown>;
  match: {
    unit: AssignmentUnit | null;
    property: AssignmentProperty | null;
    confidenceLevel: "high" | "medium" | "low";
    explanation: string;
  };
  assignmentId?: number;
  status: "assigned" | "pending" | "rejected";
}

export interface ProcessSummary {
  total: number;
  autoAssigned: number;
  pendingConfirmation: number;
  reviewRequired: number;
}

export interface ProcessResponse {
  results: ProcessResult[];
  summary: ProcessSummary;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAssignments(status?: string) {
  const params = status ? `?status=${status}` : "";
  return useQuery<Assignment[]>({
    queryKey: ["assignments", status ?? "all"],
    queryFn: async () => {
      const res = await fetch(`/api/assignments${params}`);
      if (!res.ok) throw new Error("Failed to fetch assignments");
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useReviewQueue() {
  return useQuery<Assignment[]>({
    queryKey: ["assignments", "review"],
    queryFn: async () => {
      const res = await fetch("/api/assignments/review");
      if (!res.ok) throw new Error("Failed to fetch review queue");
      return res.json();
    },
    staleTime: 10_000,
  });
}

export function useUnitAssignments(unitId: number) {
  return useQuery<Assignment[]>({
    queryKey: ["assignments", "unit", unitId],
    queryFn: async () => {
      const res = await fetch(`/api/assignments/unit/${unitId}`);
      if (!res.ok) throw new Error("Failed to fetch unit assignments");
      return res.json();
    },
    enabled: unitId > 0,
    staleTime: 30_000,
  });
}

export function useProcessAssignments() {
  const qc = useQueryClient();
  return useMutation<ProcessResponse, Error, { sourceType: string; rows: Record<string, string>[] }>({
    mutationFn: async (body) => {
      const res = await fetch("/api/assignments/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to process assignments");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
}

export function useConfirmAssignment() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/assignments/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to confirm assignment");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useRejectAssignment() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/assignments/${id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to reject assignment");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useManualAssign() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: number; unitId: number }>({
    mutationFn: async ({ id, unitId }) => {
      const res = await fetch(`/api/assignments/${id}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitId }),
      });
      if (!res.ok) throw new Error("Failed to manually assign");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments"] }),
  });
}
