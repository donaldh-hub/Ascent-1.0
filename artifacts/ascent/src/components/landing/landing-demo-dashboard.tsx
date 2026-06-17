import { useEffect, useState } from "react";
import { Wrench, Layers, CalendarClock, Server, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Stoplight = "green" | "yellow" | "red";

interface ControlTowerData {
  siteName: string;
  woStats: { total: number; open: number; slaMissedCount: number; agingCount: number; topCategory: string };
  woCategoryBreakdown: Record<string, number>;
  turnStats: { totalTurns: number; activeTurns: number; blockedTurns: number; avgCompletionPct: number };
  turns: { unitId: string; day: number; stoplight: Stoplight; status: string }[];
  pmTasks: { task: string; building: string; daysOverdue: number }[];
  assets: { id: number; unitId: string; name: string; stoplight: Stoplight; warrantyStatus: string }[];
  priorityActions: { id: string; label: string; context: string; severity: "critical" | "warning" | "info"; unitId: string | null }[];
}

interface UnitDetail {
  unitId: string;
  building: string;
  summary: string;
  records: string[];
}

function stoplightStyles(s: Stoplight) {
  return s === "green"
    ? { text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/40", dot: "bg-status-green" }
    : s === "yellow"
    ? { text: "text-status-yellow", bg: "bg-status-yellow/10", border: "border-status-yellow/40", dot: "bg-status-yellow" }
    : { text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/40", dot: "bg-status-red" };
}

function Tile({
  icon: Icon,
  title,
  stoplight,
  metrics,
  units,
  onUnitClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  stoplight: Stoplight;
  metrics: { label: string; value: string | number }[];
  units: string[];
  onUnitClick: (unitId: string) => void;
}) {
  const styles = stoplightStyles(stoplight);
  return (
    <div className={cn("rounded-lg border p-4 space-y-3", styles.border, styles.bg)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
        <span className={cn("h-2.5 w-2.5 rounded-full", styles.dot)} />
      </div>
      <div className="space-y-1">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{m.label}</span>
            <span className="font-medium">{m.value}</span>
          </div>
        ))}
      </div>
      {units.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {units.map((u) => (
            <button
              key={u}
              onClick={() => onUnitClick(u)}
              className={cn("text-xs px-2 py-1 rounded-md border hover:opacity-80 transition-opacity", styles.border, styles.text)}
            >
              Unit {u}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LandingDemoDashboard() {
  const [data, setData] = useState<ControlTowerData | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<UnitDetail | null>(null);
  const [loadingUnit, setLoadingUnit] = useState(false);

  useEffect(() => {
    fetch("/api/landing-demo/control-tower")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const openUnit = (unitId: string) => {
    setLoadingUnit(true);
    fetch(`/api/landing-demo/units/${unitId}`)
      .then((r) => r.json())
      .then((d) => setSelectedUnit(d))
      .catch(() => {})
      .finally(() => setLoadingUnit(false));
  };

  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Loading demo dashboard…
      </div>
    );
  }

  const woStoplight: Stoplight = data.woStats.slaMissedCount >= 5 ? "red" : data.woStats.slaMissedCount > 0 ? "yellow" : "green";
  const turnStoplight: Stoplight = data.turns.some((t) => t.stoplight === "red") ? "yellow" : "green";
  const pmStoplight: Stoplight = data.pmTasks.length > 0 ? "yellow" : "green";
  const assetStoplight: Stoplight = data.assets.some((a) => a.stoplight === "red") ? "red" : "yellow";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground bg-secondary px-2.5 py-1 rounded-md">
          Demo site — {data.siteName}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile
          icon={Wrench}
          title="Work Order Performance"
          stoplight={woStoplight}
          metrics={[
            { label: "Open work orders", value: data.woStats.open },
            { label: "Past due", value: data.woStats.slaMissedCount },
            { label: "Top category", value: data.woStats.topCategory },
          ]}
          units={["B-07", "C-03"]}
          onUnitClick={openUnit}
        />
        <Tile
          icon={Layers}
          title="Turn Performance"
          stoplight={turnStoplight}
          metrics={[
            { label: "Active turns", value: data.turnStats.activeTurns },
            { label: "Avg completion", value: `${data.turnStats.avgCompletionPct}%` },
          ]}
          units={data.turns.filter((t) => t.stoplight !== "green").map((t) => t.unitId)}
          onUnitClick={openUnit}
        />
        <Tile
          icon={CalendarClock}
          title="PM Performance"
          stoplight={pmStoplight}
          metrics={data.pmTasks.map((t) => ({ label: t.building, value: `${t.daysOverdue}d overdue` }))}
          units={[]}
          onUnitClick={openUnit}
        />
        <Tile
          icon={Server}
          title="Asset Performance"
          stoplight={assetStoplight}
          metrics={[{ label: "Warranty risk flags", value: data.assets.length }]}
          units={data.assets.map((a) => a.unitId)}
          onUnitClick={openUnit}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-sm mb-3">Priority Actions</h3>
        <div className="space-y-2">
          {data.priorityActions.map((a) => (
            <button
              key={a.id}
              onClick={() => a.unitId && openUnit(a.unitId)}
              disabled={!a.unitId}
              className={cn(
                "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
                a.severity === "critical" ? "border-status-red/40 bg-status-red/5" : "border-status-yellow/40 bg-status-yellow/5",
                a.unitId && "hover:opacity-80 cursor-pointer"
              )}
            >
              <div className="font-medium">{a.label}</div>
              <div className="text-xs text-muted-foreground">{a.context}</div>
            </button>
          ))}
        </div>
      </div>

      {(selectedUnit || loadingUnit) && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setSelectedUnit(null)}>
          <div
            className="max-w-lg w-full rounded-lg border border-border bg-card p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {loadingUnit ? "Loading…" : `Unit ${selectedUnit?.unitId} — ${selectedUnit?.building}`}
              </h3>
              <button onClick={() => setSelectedUnit(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {selectedUnit && (
              <>
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{selectedUnit.summary}</span>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {selectedUnit.records.map((r, i) => (
                    <li key={i} className="rounded-md bg-secondary/50 px-3 py-2">{r}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
