/**
 * Ascent 7.2.1 — Turn / Work Order Reporting Mode Assessment
 *
 * Renders:
 *   1. An indicator strip ("Turn / Work Order Reporting Mode: <label> · Change")
 *      that sits above the analysis sections.
 *   2. A modal containing the three mode options + helper copy. The modal
 *      auto-opens when source === 'default' so the operator is prompted
 *      on first visit. Otherwise it opens only when the user clicks Change.
 */

import { useEffect, useState } from "react";
import { Settings2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useReportingMode,
  REPORTING_MODE_LABELS,
  REPORTING_MODE_HELPER,
  type ReportingModeValue,
} from "./use-reporting-mode";

const MODE_OPTIONS: ReportingModeValue[] = [
  "separate_turns_and_work_orders",
  "work_orders_measure_turn_progress",
  "hybrid_or_unknown",
];

export function ReportingModeAssessment() {
  const { record, loading, error, setMode } = useReportingMode();
  const [open, setOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  const [pending, setPending] = useState<ReportingModeValue | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Auto-open exactly once on first visit when the mode is still the
  // system default and the operator has not made a choice.
  useEffect(() => {
    if (!autoOpened && record && record.source === "default") {
      setOpen(true);
      setAutoOpened(true);
    }
  }, [record, autoOpened]);

  useEffect(() => {
    if (open && record) setPending(record.mode);
    if (!open) setSaveError(null);
  }, [open, record]);

  const onSave = async () => {
    if (!pending) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setMode({ mode: pending, reason: "User confirmed via Reports assessment" });
      setOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
        data-testid="reporting-mode-indicator"
      >
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="uppercase tracking-wider text-muted-foreground">
          Turn / Work Order Reporting Mode:
        </span>
        <span className="font-semibold" data-testid="reporting-mode-label">
          {loading
            ? "Loading…"
            : record
            ? REPORTING_MODE_LABELS[record.mode]
            : "Unavailable"}
        </span>
        {record?.isDefault && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            Needs confirmation
          </span>
        )}
        {error && (
          <span className="text-status-red flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {error}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={() => setOpen(true)}
          data-testid="reporting-mode-change"
        >
          Change
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-xl"
          data-testid="reporting-mode-dialog"
        >
          <DialogHeader>
            <DialogTitle>Turn / Work Order Reporting Mode</DialogTitle>
            <DialogDescription>
              Tell Ascent how this organization tracks unit turns versus work
              orders. The choice shapes how reporting analyses interpret your
              data — it does not move any records or rebuild any history.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {MODE_OPTIONS.map((value) => {
              const selected = pending === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPending(value)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                  data-testid={`reporting-mode-option-${value}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm">
                      {REPORTING_MODE_LABELS[value]}
                    </div>
                    {selected && (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {REPORTING_MODE_HELPER[value]}
                  </div>
                </button>
              );
            })}
          </div>

          {saveError && (
            <div className="text-xs text-status-red flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {saveError}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={onSave}
              disabled={saving || !pending || pending === record?.mode}
              data-testid="reporting-mode-save"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Save reporting mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
