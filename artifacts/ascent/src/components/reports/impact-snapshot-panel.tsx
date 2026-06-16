/**
 * Ascent 8.0 — Impact Snapshot Panel
 *
 * Shows the current recalculation impact snapshot:
 * - Amber banner if stale records detected
 * - Clickable counts for recent changes, completion impact, missing evidence
 * - Each count opens a sheet listing the relevant records
 *
 * Fallback: if the endpoint fails, shows a graceful unavailability message.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Activity,
  FileX,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StalenessRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string | null;
  ageDays: number;
  updatedAt: string;
}

interface RecentChangeRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string | null;
  ageDays: number;
}

interface CompletionImpactRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string;
  completedAt: string | null;
  affectedAnalysisCategories: string[];
}

interface MissingEvidenceRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string | null;
  riskScore: number;
  riskReason: string;
}

interface ImpactSnapshot {
  generatedAt: string;
  staleness: StalenessRecord[];
  stalenessCount: number;
  recentChanges: RecentChangeRecord[];
  recentChangesCount: number;
  completionImpact: CompletionImpactRecord[];
  completionImpactCount: number;
  missingEvidenceImpact: MissingEvidenceRecord[];
  missingEvidenceImpactCount: number;
  recalculationNeeded: boolean;
  staleCalculationWarning: string | null;
}

type DrillType = "recent_changes" | "completion_impact" | "missing_evidence" | "staleness";

// ─── Drill sheet ──────────────────────────────────────────────────────────────

function RecordRow({ label, sub, badge }: { label: string; sub: string; badge?: string }) {
  return (
    <li className="rounded-md border border-border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
        </div>
        {badge && (
          <Badge variant="outline" className="shrink-0 text-xs">{badge}</Badge>
        )}
      </div>
    </li>
  );
}

function ImpactDrillSheet({
  type,
  snapshot,
  onClose,
}: {
  type: DrillType | null;
  snapshot: ImpactSnapshot | null;
  onClose: () => void;
}) {
  if (!type || !snapshot) return null;

  const config: Record<DrillType, { title: string; description: string }> = {
    recent_changes: {
      title: "Recent Changes",
      description: "Records updated within the last 7 days. These may affect current analysis scores.",
    },
    completion_impact: {
      title: "Recently Completed Records",
      description: "Records that moved to a completed or resolved status in the last 7 days.",
    },
    missing_evidence: {
      title: "Missing Evidence — by Risk",
      description: "Admissible records without supporting documentation, ranked by risk score.",
    },
    staleness: {
      title: "Stale Records",
      description: "Records not updated in over 7 days and still in a non-terminal status.",
    },
  };

  const { title, description } = config[type];

  return (
    <Sheet open={!!type} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          {type === "recent_changes" && (
            <ul className="space-y-2">
              {snapshot.recentChanges.length === 0 && (
                <li className="text-sm text-muted-foreground">No recent changes in the last 7 days.</li>
              )}
              {snapshot.recentChanges.map((r) => (
                <RecordRow
                  key={r.id}
                  label={`${r.sourceType.replace(/_/g, " ")} #${r.sourceRecordId}`}
                  sub={[r.propertyName, r.status, `${r.ageDays}d old`].filter(Boolean).join(" · ")}
                />
              ))}
            </ul>
          )}
          {type === "completion_impact" && (
            <ul className="space-y-2">
              {snapshot.completionImpact.length === 0 && (
                <li className="text-sm text-muted-foreground">No records completed in the last 7 days.</li>
              )}
              {snapshot.completionImpact.map((r) => (
                <RecordRow
                  key={r.id}
                  label={`${r.sourceType.replace(/_/g, " ")} #${r.sourceRecordId}`}
                  sub={[
                    r.propertyName,
                    `Status: ${r.status}`,
                    r.affectedAnalysisCategories.length > 0
                      ? `Affects: ${r.affectedAnalysisCategories.join(", ")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={r.status}
                />
              ))}
            </ul>
          )}
          {type === "missing_evidence" && (
            <ul className="space-y-2">
              {snapshot.missingEvidenceImpact.length === 0 && (
                <li className="text-sm text-muted-foreground">No missing evidence records found.</li>
              )}
              {snapshot.missingEvidenceImpact.slice(0, 50).map((r) => (
                <RecordRow
                  key={r.id}
                  label={`${r.sourceType.replace(/_/g, " ")} #${r.sourceRecordId}`}
                  sub={[r.propertyName, r.riskReason].filter(Boolean).join(" · ")}
                  badge={`Risk ${r.riskScore}`}
                />
              ))}
              {snapshot.missingEvidenceImpactCount > 50 && (
                <li className="text-xs text-muted-foreground text-center pt-2">
                  Showing 50 of {snapshot.missingEvidenceImpactCount} records.
                </li>
              )}
            </ul>
          )}
          {type === "staleness" && (
            <ul className="space-y-2">
              {snapshot.staleness.length === 0 && (
                <li className="text-sm text-muted-foreground">No stale records detected.</li>
              )}
              {snapshot.staleness.map((r) => (
                <RecordRow
                  key={r.id}
                  label={`${r.sourceType.replace(/_/g, " ")} #${r.sourceRecordId}`}
                  sub={[r.propertyName, `Status: ${r.status ?? "unknown"}`, `${r.ageDays}d old`]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Count tile ───────────────────────────────────────────────────────────────

function CountTile({
  icon,
  label,
  value,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onClick: () => void;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-md border border-border bg-card p-3 hover:bg-secondary transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${accent ?? ""}`}>{value.toLocaleString()}</div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ImpactSnapshotPanel() {
  const [snapshot, setSnapshot] = useState<ImpactSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [drill, setDrill] = useState<DrillType | null>(null);

  const load = () => {
    setLoading(true);
    setUnavailable(false);
    fetch("/api/reporting-analysis/impact/snapshot")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ImpactSnapshot) => setSnapshot(d))
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (unavailable) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="impact-snapshot-unavailable">
        Impact analysis available after server restart.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="impact-snapshot-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Build 8.0 — Impact Recalculation Snapshot</h3>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {loading && !snapshot && (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {snapshot && (
        <>
          {/* Stale warning banner */}
          {snapshot.recalculationNeeded && snapshot.staleCalculationWarning && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400" data-testid="stale-warning">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{snapshot.staleCalculationWarning}</span>
            </div>
          )}

          {!snapshot.recalculationNeeded && (
            <div className="mb-4 flex items-center gap-2 text-sm text-status-green" data-testid="no-staleness">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>No stale records detected — recalculation not needed.</span>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CountTile
              icon={<TrendingUp className="w-3.5 h-3.5 text-blue-500" />}
              label="Recent changes"
              value={snapshot.recentChangesCount}
              onClick={() => setDrill("recent_changes")}
              accent="text-blue-600 dark:text-blue-400"
            />
            <CountTile
              icon={<CheckCircle2 className="w-3.5 h-3.5 text-status-green" />}
              label="Completion impact"
              value={snapshot.completionImpactCount}
              onClick={() => setDrill("completion_impact")}
              accent="text-status-green"
            />
            <CountTile
              icon={<FileX className="w-3.5 h-3.5 text-amber-500" />}
              label="Missing evidence"
              value={snapshot.missingEvidenceImpactCount}
              onClick={() => setDrill("missing_evidence")}
              accent="text-amber-500"
            />
            <CountTile
              icon={<AlertTriangle className="w-3.5 h-3.5 text-status-red" />}
              label="Stale records"
              value={snapshot.stalenessCount}
              onClick={() => setDrill("staleness")}
              accent={snapshot.stalenessCount > 0 ? "text-status-red" : ""}
            />
          </div>

          <div className="mt-2 text-xs text-muted-foreground text-right">
            Generated {new Date(snapshot.generatedAt).toLocaleTimeString()}
          </div>
        </>
      )}

      <ImpactDrillSheet
        type={drill}
        snapshot={snapshot}
        onClose={() => setDrill(null)}
      />
    </div>
  );
}
