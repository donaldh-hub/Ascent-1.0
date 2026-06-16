import { useRef, useState, useContext } from "react";
import { Upload, FileText, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JordanContext } from "@/App";

interface IngestionResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export function WorkOrderUploadPanel({ onSuccess }: { onSuccess?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const { triggerJordanCheck } = useContext(JordanContext);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/upload/work-orders", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Upload failed");
      setResult(data as IngestionResult);
      onSuccess?.();
      // Brief pause so the user sees "Upload complete", then Jordan appears
      setTimeout(() => triggerJordanCheck(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setError("Only CSV or TXT files are supported.");
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
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        <FileText className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium">Drop a CSV file here, or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">Accepts .csv exports from your work order system</p>
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

      {result && (
        <div className="mt-3 rounded-md border border-status-green/40 bg-status-green/5 p-3 space-y-1" data-testid="upload-result">
          <div className="flex items-center gap-2 text-sm font-medium text-status-green">
            <CheckCircle2 className="w-4 h-4" />
            Upload complete — {result.totalRows} rows processed
          </div>
          <div className="text-xs text-muted-foreground grid grid-cols-3 gap-2 mt-2">
            <span>{result.inserted} inserted</span>
            <span>{result.updated} updated</span>
            <span>{result.skipped} skipped</span>
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-amber-600 cursor-pointer">{result.errors.length} row error(s)</summary>
              <ul className="mt-1 space-y-0.5">
                {result.errors.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-xs text-muted-foreground">{e}</li>
                ))}
              </ul>
            </details>
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
