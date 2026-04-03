/**
 * Phase 1 — Build 1.7: Assignment Engine — Review Queue
 * Route: /assignments/review
 */

import { useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, AlertTriangle, CheckCircle2, XCircle,
  Hash, Building2, Info, ClipboardCheck, RefreshCw,
  ChevronRight, ThumbsUp, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useReviewQueue, useManualAssign, useRejectAssignment,
  type Assignment,
} from "@/hooks/use-assignments";
import { useListUnits, useListProperties } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sourceTypeLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, confidence }: { status: string; confidence: string }) {
  if (status === "rejected") {
    return <Badge variant="outline" className="text-destructive border-destructive/30 text-xs">Rejected</Badge>;
  }
  if (confidence === "medium") {
    return <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-xs">Awaiting confirmation</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground text-xs">No match found</Badge>;
}

// ─── Manual assignment selector ───────────────────────────────────────────────

function ManualAssignForm({
  assignmentId,
  onDone,
}: {
  assignmentId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const { data: properties = [] } = useListProperties();
  const { data: units = [] } = useListUnits({});
  const manualAssign = useManualAssign();

  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);

  const filteredUnits = selectedPropertyId
    ? units.filter((u) => u.propertyId === selectedPropertyId)
    : units;

  async function handleAssign() {
    if (!selectedUnitId) return;
    try {
      await manualAssign.mutateAsync({ id: assignmentId, unitId: selectedUnitId });
      toast({ title: "Manually assigned", description: "Record has been linked to the unit." });
      onDone();
    } catch {
      toast({ title: "Failed to assign", variant: "destructive" });
    }
  }

  return (
    <div className="mt-3 p-4 bg-secondary/20 rounded-lg border border-border space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Manual Assignment</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Property</label>
          <select
            value={selectedPropertyId ?? ""}
            onChange={(e) => {
              setSelectedPropertyId(e.target.value ? Number(e.target.value) : null);
              setSelectedUnitId(null);
            }}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Unit</label>
          <select
            value={selectedUnitId ?? ""}
            onChange={(e) => setSelectedUnitId(e.target.value ? Number(e.target.value) : null)}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Select unit…</option>
            {filteredUnits.map((u) => (
              <option key={u.id} value={u.id}>{u.unitNumber}</option>
            ))}
          </select>
        </div>
      </div>
      <Button
        size="sm"
        className="w-full"
        disabled={!selectedUnitId || manualAssign.isPending}
        onClick={handleAssign}
      >
        {manualAssign.isPending ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Assigning…</>
        ) : (
          <><ThumbsUp className="h-4 w-4 mr-2" /> Assign to this unit</>
        )}
      </Button>
    </div>
  );
}

// ─── Review item ──────────────────────────────────────────────────────────────

function ReviewItem({ item }: { item: Assignment }) {
  const [expanded, setExpanded] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const { toast } = useToast();
  const rejectMutation = useRejectAssignment();

  const sourceData = item.sourceData as Record<string, string>;
  const topFields = Object.entries(sourceData).filter(([, v]) => v).slice(0, 4);

  async function handleReject() {
    try {
      await rejectMutation.mutateAsync(item.id);
      toast({ title: "Dismissed", description: "Record has been moved out of the queue." });
    } catch {
      toast({ title: "Failed to dismiss", variant: "destructive" });
    }
  }

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="shrink-0 mt-0.5">
          {item.status === "rejected" ? (
            <XCircle className="h-5 w-5 text-muted-foreground/40" />
          ) : item.confidenceLevel === "medium" ? (
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase">
              {sourceTypeLabel(item.sourceType)}
            </span>
            <StatusBadge status={item.status} confidence={item.confidenceLevel} />
            <span className="text-xs text-muted-foreground ml-auto">{fmtDate(item.createdAt)}</span>
          </div>

          {/* Source data preview */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {topFields.map(([k, v]) => (
              <span key={k} className="text-sm">
                <span className="text-muted-foreground text-xs">{k}:</span>{" "}
                <span className="font-medium">{v}</span>
              </span>
            ))}
          </div>

          {/* Suggested match (medium confidence) */}
          {item.unit && item.status !== "rejected" && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
              <Hash className="h-3 w-3" /> Suggested: Unit {item.unit.unitNumber}
              {item.property && <span>· {item.property.name}</span>}
            </div>
          )}

          {/* Explanation */}
          <div className="flex items-start gap-1.5 mt-1.5">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground italic">{item.explanation}</p>
          </div>

          {/* Actions */}
          {item.status !== "rejected" && (
            <div className="flex items-center gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => setShowAssignForm(!showAssignForm)}
              >
                <Hash className="h-3.5 w-3.5 mr-1" />
                Assign manually
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-3 text-xs text-muted-foreground hover:text-destructive"
                onClick={handleReject}
                disabled={rejectMutation.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Dismiss
              </Button>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1"
              >
                {expanded ? "Less" : "More"} detail
                <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
              </button>
            </div>
          )}

          {/* Expanded source data */}
          {expanded && (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(sourceData).map(([k, v]) => v ? (
                <span key={k} className="text-xs bg-secondary px-2 py-0.5 rounded">
                  <span className="text-muted-foreground">{k}:</span> {v}
                </span>
              ) : null)}
            </div>
          )}

          {/* Manual assign form */}
          {showAssignForm && (
            <ManualAssignForm
              assignmentId={item.id}
              onDone={() => setShowAssignForm(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssignmentsReview() {
  const [, navigate] = useLocation();
  const { data: queue = [], isLoading, refetch } = useReviewQueue();

  const pending = queue.filter((q) => q.status === "pending");
  const rejected = queue.filter((q) => q.status === "rejected");

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">

      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/assignments")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Assignment Engine
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Records that could not be automatically matched — assign them manually.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      {!isLoading && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="font-medium text-amber-400">{pending.length}</span>
            <span className="text-muted-foreground">pending</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm">
            <XCircle className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{rejected.length}</span>
            <span className="text-muted-foreground">dismissed</span>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="border border-border rounded-xl p-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto mb-3 animate-spin opacity-50" />
          <p className="text-sm">Loading review queue…</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && pending.length === 0 && (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-4 text-status-green opacity-60" />
          <h3 className="font-semibold text-lg mb-2">Queue is clear</h3>
          <p className="text-muted-foreground text-sm">
            No records are waiting for manual assignment.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/assignments")}>
            <ClipboardCheck className="h-4 w-4 mr-2" /> Upload more records
          </Button>
        </div>
      )}

      {/* Pending records */}
      {pending.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-secondary/20 flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold">{pending.length} record{pending.length !== 1 ? "s" : ""} awaiting assignment</span>
          </div>
          <div className="divide-y divide-border">
            {pending.map((item) => (
              <ReviewItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Dismissed records */}
      {rejected.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden opacity-60">
          <div className="px-5 py-3.5 border-b border-border bg-secondary/20 flex items-center gap-2.5">
            <XCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{rejected.length} dismissed</span>
          </div>
          <div className="divide-y divide-border">
            {rejected.map((item) => (
              <ReviewItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
