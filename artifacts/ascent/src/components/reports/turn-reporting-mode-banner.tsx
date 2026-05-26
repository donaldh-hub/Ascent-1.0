/**
 * Ascent 7.4 — Turn Reporting Mode Banner
 *
 * Surfaces the active Turn / Work Order Reporting Mode (Build 7.2.1) on
 * every page that shows turn visuals. Always renders the exact addendum
 * phrasing for the active mode so the operator can never miss which
 * measurement model the metrics on the page are using.
 *
 * In Unknown mode, the banner doubles as the configuration prompt — the
 * Configure button links to /reports where the existing
 * ReportingModeAssessment modal lives.
 */

import { Settings2, AlertTriangle, CheckCircle2, Workflow } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  useReportingMode,
  REPORTING_MODE_LABELS,
  type ReportingModeValue,
} from "./use-reporting-mode";
import { TURN_MODE_PHRASING } from "./turn-language";

function modeIcon(mode: ReportingModeValue | undefined) {
  if (mode === "separate_turns_and_work_orders")
    return <CheckCircle2 className="h-4 w-4 text-status-green shrink-0" />;
  if (mode === "work_orders_measure_turn_progress")
    return <Workflow className="h-4 w-4 text-primary shrink-0" />;
  return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
}

export interface TurnReportingModeBannerProps {
  /** Optional surface tag used only for the data-testid */
  surface?: "control-tower" | "turns" | "reports";
}

export function TurnReportingModeBanner({
  surface = "reports",
}: TurnReportingModeBannerProps) {
  const { record, loading } = useReportingMode();
  const mode = record?.mode;
  const phrasing = mode ? TURN_MODE_PHRASING[mode] : null;
  const label = mode ? REPORTING_MODE_LABELS[mode] : "Loading…";
  const isUnknown = !mode || mode === "hybrid_or_unknown";

  return (
    <div
      className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm"
      data-testid={`turn-reporting-mode-banner-${surface}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Turn / Work Order Reporting Mode
        </span>
        <span className="flex items-center gap-1.5">
          {modeIcon(mode)}
          <span
            className="font-semibold"
            data-testid={`turn-reporting-mode-banner-label-${surface}`}
          >
            {loading ? "Loading…" : label}
          </span>
        </span>
        {isUnknown && (
          <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
            <Link href="/reports">Configure now →</Link>
          </Button>
        )}
      </div>
      {phrasing && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`turn-reporting-mode-banner-phrasing-${surface}`}
        >
          {phrasing}
        </p>
      )}
    </div>
  );
}
