import { useRef, useState } from "react";
import { Upload, FileText, CheckCircle2, AlertTriangle, X, Building2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

interface UnrecognizedPropertyGroup {
  identifier: string;
  addressLines?: string[];
  workOrderCount: number;
}

interface JordanSummary {
  headline: string;
  recommendations: string[];
}

interface IngestionResult {
  totalRows: number;
  imported: number;
  errors: number;
  governance: {
    fullyResolved: number;
    partiallyResolved: number;
    unresolved: number;
  };
  unrecognizedProperties: UnrecognizedPropertyGroup[];
  jordanSummary: JordanSummary | null;
}

export function WorkOrderUploadPanel({ onSuccess }: { onSuccess?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gated, setGated] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    setGated(null);
    setResult(null);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/upload/work-orders", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 403 && data.error === "upload_gated") {
          setGated(data.message ?? "Ongoing uploads require a subscription.");
          return;
        }
        throw new Error(data.error ?? "Upload failed");
      }
      setResult(data as IngestionResult);
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.name.match(/\.(csv|txt|pdf)$/i)) {
      setError("Only CSV, TXT, or PDF files are supported.");
      return;
    }
    upload(file);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="wo-upload-panel">
      <div className="flex items-center gap-2 mb-3">
        <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
        <h3 className="font-semibold text-sm">Upload Work Orders</h3>
      </div>

      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files[0] ?? null);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        <FileText className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium">Drop a CSV or PDF file here, or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">Accepts .csv exports or PDF work order reports from your system</p>
      </div>

      {uploading && (
        <div className="mt-3 text-sm text-muted-foreground animate-pulse">
          Uploading {fileName}…
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {gated && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{gated}</span>
          </div>
          <Link href="/onboarding" className="text-xs font-medium underline underline-offset-2 ml-6">
            Go to onboarding to subscribe
          </Link>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-md border border-status-green/40 bg-status-green/5 p-3 space-y-1" data-testid="upload-result">
          <div className="flex items-center gap-2 text-sm font-medium text-status-green">
            <CheckCircle2 className="w-4 h-4" />
            Upload complete — {result.totalRows} work orders processed
          </div>
          <div className="text-xs text-muted-foreground grid grid-cols-3 gap-2 mt-2">
            <span>{result.governance.fullyResolved} fully matched</span>
            <span>{result.governance.partiallyResolved} needs unit review</span>
            <span>{result.errors} error(s)</span>
          </div>

          {result.jordanSummary && (
            <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-sm">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                <div>
                  <p className="font-medium">Jordan's take</p>
                  <p className="text-xs mt-1 text-foreground/90">{result.jordanSummary.headline}</p>
                  <ol className="mt-1.5 space-y-1 list-decimal list-inside">
                    {result.jordanSummary.recommendations.map((rec, i) => (
                      <li key={i} className="text-xs text-foreground/90">{rec}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          )}

          {result.unrecognizedProperties.length > 0 && (
            <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700">
              <div className="flex items-start gap-2">
                <Building2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">
                    This report includes {result.unrecognizedProperties.length} propert
                    {result.unrecognizedProperties.length === 1 ? "y" : "ies"} not set up in your Ascent account yet
                  </p>
                  <p className="text-xs mt-1">
                    These work orders weren't added to your dashboard. Add the property under{" "}
                    <Link href="/properties" className="underline underline-offset-2">Properties</Link> if you want Ascent to track it too.
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {result.unrecognizedProperties.map((p) => (
                      <li key={p.identifier} className="text-xs">
                        <span className="font-medium">{p.identifier}</span>
                        {p.addressLines && p.addressLines.length > 0 && <span> ({p.addressLines.join(", ")})</span>}
                        {" — "}{p.workOrderCount} work order{p.workOrderCount === 1 ? "" : "s"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-7 text-xs"
            onClick={() => { setResult(null); setFileName(null); }}
          >
            <X className="w-3 h-3 mr-1" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
