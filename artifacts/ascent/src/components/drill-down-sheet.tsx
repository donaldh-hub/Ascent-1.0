/**
 * DrillDownSheet — Universal Signal Drill-Down Panel
 *
 * Renders a right-side Sheet that shows real supporting data for any signal.
 * Usage:
 *   <DrillDownSheet signal="critical_items" open={open} onClose={() => setOpen(false)} />
 *   <DrillDownSheet signal="expired_warranty" propertyId={5} open={open} onClose={...} />
 */

import type React from "react";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSignalDrill, type SignalType, type DrillRow } from "@/hooks/use-signal-drill";
import {
  ShieldAlert,
  Clock,
  Package,
  AlertTriangle,
  Activity,
  Workflow,
  ArrowRight,
  Info,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DrillDownSheetProps {
  signal: SignalType;
  propertyId?: number;
  workflowId?: number;
  stageId?: number;
  open?: boolean;
  onClose: () => void;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function badgeClass(color?: string): string {
  if (color === "red") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (color === "yellow") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (color === "green") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (color === "blue") return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return "bg-muted text-muted-foreground border-border/40";
}

function rowTypeIcon(rowType: DrillRow["rowType"]): React.ReactElement {
  if (rowType === "asset") return <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (rowType === "alert") return <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (rowType === "item") return <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  return <Workflow className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

// ─── Currency formatter ───────────────────────────────────────────────────────

function fmtCost(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

// ─── Row component ────────────────────────────────────────────────────────────

function DrillRowCard({ row, onNavigate }: { row: DrillRow; onNavigate: (path: string) => void }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card px-4 py-3 flex items-start justify-between gap-3 hover:border-border/70 transition-colors">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <div className="mt-0.5 shrink-0">
          {rowTypeIcon(row.rowType)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground leading-tight truncate">{row.title}</p>
            {row.badge && (
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded border",
                  badgeClass(row.badgeColor),
                )}
              >
                {row.badge}
              </span>
            )}
            {row.cost != null && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border bg-muted/40 text-muted-foreground border-border/40">
                {fmtCost(row.cost)}
              </span>
            )}
            {row.rowType === "asset" && row.cost == null && (
              <span className="text-[10px] text-muted-foreground/50 italic">Cost N/A</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.subtitle}</p>
          <p className="text-xs text-foreground/60 mt-0.5 leading-snug">{row.detail}</p>
        </div>
      </div>
      {row.navigateTo && (
        <button
          onClick={() => onNavigate(row.navigateTo!)}
          className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-primary/70 hover:text-primary transition-colors whitespace-nowrap mt-0.5"
        >
          View
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DrillDownSheet({
  signal,
  propertyId,
  workflowId,
  stageId,
  open = true,
  onClose,
}: DrillDownSheetProps) {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useSignalDrill({
    signal,
    propertyId,
    workflowId,
    stageId,
    enabled: open,
  });

  function handleNavigate(path: string) {
    onClose();
    navigate(path);
  }

  const signalIcons: Record<SignalType, React.ReactElement> = {
    expired_warranty: <ShieldAlert className="h-4 w-4 text-red-400" />,
    expiring_soon: <Clock className="h-4 w-4 text-amber-400" />,
    critical_items: <AlertTriangle className="h-4 w-4 text-red-400" />,
    overdue_items: <Clock className="h-4 w-4 text-amber-400" />,
    bottleneck_items: <Activity className="h-4 w-4 text-blue-400" />,
    stale_items: <Clock className="h-4 w-4 text-amber-400" />,
    at_risk_workflows: <ShieldAlert className="h-4 w-4 text-red-400" />,
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col p-0 gap-0"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            {signalIcons[signal]}
            <SheetTitle className="text-base font-bold">
              {isLoading ? "Loading..." : data?.title ?? "Drill Down"}
            </SheetTitle>
          </div>
          {data && !isLoading && (
            <SheetDescription asChild>
              <div className="space-y-2 mt-1">
                {/* Count confirmation */}
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-2xl font-black tabular-nums",
                      data.total === 0
                        ? "text-muted-foreground"
                        : signal.includes("expir") || signal.includes("overdue") || signal.includes("stale")
                          ? "text-amber-400"
                          : "text-red-400",
                    )}
                  >
                    {data.total}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    record{data.total !== 1 ? "s" : ""} match this condition
                  </span>
                </div>
              </div>
            </SheetDescription>
          )}
        </SheetHeader>

        {/* Why this was triggered */}
        {data && !isLoading && (
          <div className="px-5 py-3 border-b border-border/30 bg-muted/30 shrink-0">
            <div className="flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">{data.triggerExplanation}</p>
            </div>
          </div>
        )}

        {/* Rows list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
              ))}
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
              <HelpCircle className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Failed to load data</p>
              <p className="text-xs text-muted-foreground/70">{error}</p>
            </div>
          )}

          {!isLoading && !error && data && data.rows.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2 py-8">
              <div className="rounded-full bg-emerald-500/10 p-3">
                <Activity className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-foreground">No records match this condition</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
                No data currently supports this signal. The system may be operating normally or data is not yet available.
              </p>
            </div>
          )}

          {!isLoading && !error && data && data.rows.length > 0 && (
            <div className="space-y-2">
              {data.rows.map((row) => (
                <DrillRowCard
                  key={`${row.rowType}-${row.id}`}
                  row={row}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer — count + total exposure */}
        {data && !isLoading && data.rows.length > 0 && (
          <div className="px-5 py-3 border-t border-border/40 shrink-0 space-y-1.5">
            {data.totalCost != null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total Replacement Exposure</span>
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {fmtCost(data.totalCost)}
                </span>
              </div>
            )}
            {data.totalCost != null && data.costMatchedCount != null && data.costMatchedCount < data.total && (
              <p className="text-[10px] text-muted-foreground/60">
                Cost data available for {data.costMatchedCount} of {data.total} assets · {data.total - data.costMatchedCount} without pricing
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/60 text-center">
              {data.total} record{data.total !== 1 ? "s" : ""} · Click View to navigate
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Clickable signal trigger wrapper ────────────────────────────────────────

interface ClickableSignalProps {
  onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}

export function ClickableSignal({
  onClick,
  children,
  className,
  disabled,
  title,
}: ClickableSignalProps) {
  if (disabled) return <>{children}</>;
  return (
    <button
      onClick={onClick}
      title={title ?? "Click to see supporting records"}
      className={cn(
        "cursor-pointer rounded transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}
