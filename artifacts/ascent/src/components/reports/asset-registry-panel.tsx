import { useEffect, useState } from "react";
import { Package, RefreshCw, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssetRegistrySummary {
  totalAssets: number;
  byProperty: Array<{ propertyId: number | null; propertyName: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byType: Array<{ assetType: string; count: number }>;
  byStoplight: Array<{ stoplight: string; count: number }>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AssetRegistryPanel() {
  const [data, setData] = useState<AssetRegistrySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-analysis/assets/registry")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: AssetRegistrySummary) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const missingWarrantyCount = data
    ? (data.byStoplight.find((s) => s.stoplight === "red")?.count ?? 0)
    : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="asset-registry-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Build 9.0 — Asset Registry</h3>
          {data && (
            <Badge variant="outline" className="text-xs">
              {data.totalAssets.toLocaleString()} assets
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {loading && !data && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50" data-testid="asset-registry-error">
          <p className="font-medium">Asset registry unavailable</p>
          <p className="text-xs mt-0.5">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {missingWarrantyCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-600" data-testid="missing-warranty-warning">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{missingWarrantyCount} asset(s) in red stoplight status</span>
            </div>
          )}

          {/* By property */}
          {data.byProperty.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                By property
              </h4>
              <div className="rounded-md border border-border divide-y divide-border">
                {data.byProperty.slice(0, 8).map((p) => (
                  <div
                    key={p.propertyId ?? "__none__"}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span className="font-medium truncate max-w-[65%]">{p.propertyName}</span>
                    <span className="text-xs text-muted-foreground">{p.count} assets</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* By status */}
            {data.byStatus.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  By status
                </h4>
                <ul className="space-y-1">
                  {data.byStatus.map((s) => (
                    <li key={s.status} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground capitalize">{s.status}</span>
                      <span className="font-medium">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* By type */}
            {data.byType.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  By type
                </h4>
                <ul className="space-y-1">
                  {data.byType.slice(0, 6).map((t) => (
                    <li key={t.assetType} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate max-w-[60%]">{t.assetType}</span>
                      <span className="font-medium">{t.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {data.totalAssets === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="asset-registry-empty">
              No assets found in the registry.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
