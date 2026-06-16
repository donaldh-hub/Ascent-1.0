import { useState, useContext } from "react";
import { Database, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JordanContext } from "@/App";

export function DemoDataPanel({ onChange }: { onChange?: () => void }) {
  const { triggerJordanCheck } = useContext(JordanContext);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState<{ workOrders: number; assets: number; properties: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/demo/load", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to load demo data");
      setCounts(data);
      setLoaded(true);
      onChange?.();
      setTimeout(() => triggerJordanCheck(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setError(null);
    try {
      const r = await fetch("/api/demo/clear", { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to clear demo data");
      setCounts(null);
      setLoaded(false);
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="demo-data-panel">
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-4 h-4 text-muted-foreground shrink-0" />
        <h3 className="font-semibold text-sm">Demo Dataset</h3>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Load 3 months of sample work orders across 2 properties to explore Ascent's reporting capabilities.
      </p>

      {counts && (
        <div className="text-xs text-muted-foreground mb-3 flex gap-3">
          <span>{counts.workOrders} work orders</span>
          <span>{counts.assets} assets</span>
          <span>{counts.properties} properties</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleLoad} disabled={loading || clearing}>
          {loading ? "Loading…" : loaded ? "Reload demo data" : "Load demo dataset"}
        </Button>
        {loaded && (
          <Button size="sm" variant="ghost" onClick={handleClear} disabled={clearing} className="text-muted-foreground">
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            {clearing ? "Clearing…" : "Clear"}
          </Button>
        )}
      </div>

      {loaded && (
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          Demo data will be replaced by your real uploads when you import actual work orders.
        </p>
      )}
    </div>
  );
}
