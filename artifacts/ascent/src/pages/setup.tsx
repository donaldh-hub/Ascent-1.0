/**
 * Build 1.5 (Activation Flow Patch)
 *
 * Guided first-run setup: Property → Unit intake → Complete.
 * Completion is derived from real data (via useSetupStatus in App.tsx).
 * NO localStorage — no manual toggles.
 */

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Building2, Plus, Upload, CheckCircle2, ChevronRight,
  X, AlertTriangle, FileText, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useListProperties, useCreateProperty,
  useListUnits, useCreateUnit, useImportUnits,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type Step = "welcome" | "property" | "units" | "complete";
type UnitMethod = "manual" | "csv";

interface ParsedRow {
  unitNumber: string;
  [key: string]: string;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

// ─── Audit helpers (extensible) ───────────────────────────────────────────────

function trackEvent(event: string, meta?: Record<string, unknown>) {
  console.info(`[Ascent Setup] ${event}`, meta ?? "");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Setup() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("welcome");
  const [propertyName, setPropertyName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [createdPropertyId, setCreatedPropertyId] = useState<number | null>(null);
  const [createdPropertyName, setCreatedPropertyName] = useState("");

  const [unitMethod, setUnitMethod] = useState<UnitMethod | null>(null);
  const [manualUnits, setManualUnits] = useState<string[]>([""]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<string>("");
  const [csvFileName, setCsvFileName] = useState("");
  const [csvPreviewConfirmed, setCsvPreviewConfirmed] = useState(false);
  const [unitsCreatedCount, setUnitsCreatedCount] = useState(0);

  const fileRef = useRef<HTMLInputElement>(null);

  const createProperty = useCreateProperty();
  const createUnit = useCreateUnit();
  const importUnits = useImportUnits();

  const { data: allUnits } = useListUnits(
    { propertyId: createdPropertyId ?? undefined },
    { query: { enabled: step === "complete" && createdPropertyId !== null } }
  );

  // ── Step: Create property ──────────────────────────────────────────────────

  async function handleCreateProperty() {
    if (!propertyName.trim()) return;
    try {
      const prop = await createProperty.mutateAsync({
        data: { name: propertyName.trim(), address: propertyAddress.trim() || undefined },
      });
      setCreatedPropertyId(prop.id);
      setCreatedPropertyName(prop.name);
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      trackEvent("property_created", { propertyId: prop.id, name: prop.name });
      setStep("units");
    } catch {
      toast({ title: "Error", description: "Failed to create property. Please try again.", variant: "destructive" });
    }
  }

  // ── Step: CSV import ───────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      const guessedCol = parsed.headers.find((h) =>
        /unit|number|name|id|apt|room/i.test(h)
      ) ?? parsed.headers[0] ?? "";
      setCsvMapping(guessedCol);
      setCsvPreviewConfirmed(false);
    };
    reader.readAsText(file);
  }

  async function handleImportCSV() {
    if (!createdPropertyId || !csvMapping) return;
    const units = csvRows
      .map((row) => ({ unitNumber: row[csvMapping]?.trim() }))
      .filter((u): u is { unitNumber: string } => !!u.unitNumber);
    try {
      const result = await importUnits.mutateAsync({ data: { propertyId: createdPropertyId, units } });
      setUnitsCreatedCount(result.imported);
      queryClient.invalidateQueries({ queryKey: ["/api/units"] });
      trackEvent("units_created", { method: "csv", count: result.imported });
      setStep("complete");
      trackEvent("setup_completed");
    } catch {
      toast({ title: "Error", description: "Failed to import units.", variant: "destructive" });
    }
  }

  // ── Step: Manual units ─────────────────────────────────────────────────────

  async function handleManualSubmit() {
    if (!createdPropertyId) return;
    const valid = manualUnits.map((u) => u.trim()).filter(Boolean);
    if (valid.length === 0) {
      toast({ title: "Add at least one unit", variant: "destructive" });
      return;
    }
    let count = 0;
    for (const unitNumber of valid) {
      try {
        await createUnit.mutateAsync({ data: { propertyId: createdPropertyId, unitNumber } });
        count++;
      } catch {
        // skip duplicates silently
      }
    }
    setUnitsCreatedCount(count);
    queryClient.invalidateQueries({ queryKey: ["/api/units"] });
    trackEvent("units_created", { method: "manual", count });
    setStep("complete");
    trackEvent("setup_completed");
  }

  // ── Finish ─────────────────────────────────────────────────────────────────

  function handleFinish() {
    // Completion is derived from real data in useSetupStatus — no localStorage needed.
    // Invalidate queries so the gate check reflects the new state immediately.
    queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
    queryClient.invalidateQueries({ queryKey: ["/api/units"] });
    navigate("/units");
  }

  const totalUnits = allUnits?.length ?? unitsCreatedCount;

  // ── Render ─────────────────────────────────────────────────────────────────

  const STEPS: Step[] = ["welcome", "property", "units", "complete"];
  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <Activity className="h-7 w-7 text-primary" />
          <span className="font-bold text-xl tracking-wider text-primary">
            ASCENT <span className="text-muted-foreground text-sm font-normal">1.0</span>
          </span>
        </div>

        {/* Progress indicator */}
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all duration-300 ${
                s === step
                  ? "w-6 bg-primary"
                  : i < stepIdx
                  ? "w-2 bg-primary/60"
                  : "w-2 bg-border"
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">

          {/* ── Welcome ── */}
          {step === "welcome" && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="bg-card border border-border rounded-xl p-8 text-center shadow-xl"
            >
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Activity className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-3">Let's set up your system</h1>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                We'll walk you through creating your first property and adding your units.
                This becomes the foundation everything else connects to.
              </p>
              <Button
                size="lg"
                className="w-full"
                onClick={() => { trackEvent("setup_started"); setStep("property"); }}
              >
                Start Setup <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {/* ── Property ── */}
          {step === "property" && (
            <motion.div
              key="property"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="bg-card border border-border rounded-xl p-8 shadow-xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Create your first property</h2>
                  <p className="text-sm text-muted-foreground">You can add more later</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Property name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    placeholder="e.g. Riverside Apartments"
                    value={propertyName}
                    onChange={(e) => setPropertyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateProperty()}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Address <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    placeholder="e.g. 123 Main Street, Springfield"
                    value={propertyAddress}
                    onChange={(e) => setPropertyAddress(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateProperty()}
                  />
                </div>
              </div>
              <Button
                size="lg"
                className="w-full mt-6"
                disabled={!propertyName.trim() || createProperty.isPending}
                onClick={handleCreateProperty}
              >
                {createProperty.isPending ? "Creating..." : "Continue"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {/* ── Units ── */}
          {step === "units" && (
            <motion.div
              key="units"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="bg-card border border-border rounded-xl p-8 shadow-xl"
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold">Add units to {createdPropertyName}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  At least one unit is required to activate your system.
                </p>
              </div>

              {/* Method selector */}
              {!unitMethod && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setUnitMethod("csv")}
                    className="border border-border rounded-lg p-4 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                  >
                    <Upload className="h-5 w-5 text-muted-foreground group-hover:text-primary mb-2 transition-colors" />
                    <div className="font-medium text-sm">Upload CSV</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Import a spreadsheet or roster</div>
                  </button>
                  <button
                    onClick={() => setUnitMethod("manual")}
                    className="border border-border rounded-lg p-4 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                  >
                    <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary mb-2 transition-colors" />
                    <div className="font-medium text-sm">Manual entry</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Type unit numbers directly</div>
                  </button>
                </div>
              )}

              {/* CSV flow */}
              {unitMethod === "csv" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={() => { setUnitMethod(null); setCsvRows([]); setCsvHeaders([]); }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-medium">CSV Upload</span>
                  </div>

                  {csvRows.length === 0 ? (
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    >
                      <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm font-medium">Click to upload a CSV file</p>
                      <p className="text-xs text-muted-foreground mt-1">Accepts any CSV or spreadsheet export</p>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".csv,.txt"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>{csvFileName}</span>
                        <span className="text-xs">· {csvRows.length} rows</span>
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-1.5 block">
                          Which column is the unit number?
                        </label>
                        <select
                          value={csvMapping}
                          onChange={(e) => setCsvMapping(e.target.value)}
                          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                        >
                          {csvHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      {csvMapping && (
                        <div className="border border-border rounded-lg overflow-hidden">
                          <div className="bg-secondary/30 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Preview — first 5 rows
                          </div>
                          <div className="divide-y divide-border">
                            {csvRows.slice(0, 5).map((row, i) => (
                              <div key={i} className="px-3 py-2 text-sm flex items-center gap-2">
                                <span className="font-medium">
                                  {row[csvMapping] || (
                                    <span className="text-muted-foreground italic">empty</span>
                                  )}
                                </span>
                                {!row[csvMapping] && (
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                )}
                              </div>
                            ))}
                            {csvRows.length > 5 && (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                …and {csvRows.length - 5} more
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {!csvPreviewConfirmed ? (
                        <Button className="w-full" onClick={() => setCsvPreviewConfirmed(true)}>
                          Looks good — import {csvRows.filter((r) => r[csvMapping]?.trim()).length} units
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          disabled={importUnits.isPending}
                          onClick={handleImportCSV}
                        >
                          {importUnits.isPending ? "Importing..." : "Confirm import"}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Manual flow */}
              {unitMethod === "manual" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={() => setUnitMethod(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-medium">Manual entry</span>
                  </div>
                  <div id="manual-unit-inputs" className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {manualUnits.map((u, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          placeholder={`Unit ${i + 1}`}
                          value={u}
                          onChange={(e) => {
                            const next = [...manualUnits];
                            next[i] = e.target.value;
                            setManualUnits(next);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setManualUnits([...manualUnits, ""]);
                              setTimeout(() => {
                                const inputs = document.querySelectorAll<HTMLInputElement>("#manual-unit-inputs input");
                                inputs[inputs.length - 1]?.focus();
                              }, 10);
                            }
                          }}
                          autoFocus={i === manualUnits.length - 1 && i > 0}
                        />
                        {manualUnits.length > 1 && (
                          <button
                            onClick={() => setManualUnits(manualUnits.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setManualUnits([...manualUnits, ""])}
                  >
                    <Plus className="h-4 w-4 mr-2" /> Add another unit
                  </Button>
                  <Button
                    className="w-full"
                    disabled={createUnit.isPending || manualUnits.filter((u) => u.trim()).length === 0}
                    onClick={handleManualSubmit}
                  >
                    {createUnit.isPending
                      ? "Saving..."
                      : `Add ${manualUnits.filter((u) => u.trim()).length} unit${manualUnits.filter((u) => u.trim()).length !== 1 ? "s" : ""}`}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Complete ── */}
          {step === "complete" && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="bg-card border border-border rounded-xl p-8 text-center shadow-xl"
            >
              <div className="h-16 w-16 rounded-full bg-status-green/10 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-8 w-8 text-status-green" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Your system is now active</h1>
              <p className="text-muted-foreground mb-8">Everything is connected and ready to go.</p>

              <div className="grid grid-cols-2 gap-3 mb-8">
                <div className="bg-secondary/40 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-primary mb-1">1</div>
                  <div className="text-sm text-muted-foreground">Property created</div>
                  <div className="text-xs font-medium mt-1 truncate">{createdPropertyName}</div>
                </div>
                <div className="bg-secondary/40 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-primary mb-1">{totalUnits}</div>
                  <div className="text-sm text-muted-foreground">
                    {totalUnits === 1 ? "Unit added" : "Units added"}
                  </div>
                </div>
              </div>

              <Button size="lg" className="w-full" onClick={handleFinish}>
                Go to Units <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
