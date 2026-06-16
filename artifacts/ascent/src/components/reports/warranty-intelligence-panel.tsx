import { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Clock, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WarrantyAsset {
  id: number;
  name: string;
  assetType: string | null;
  propertyId: number | null;
  propertyName: string | null;
  warrantyStart: string | null;
  warrantyExpiration: string | null;
  daysUntilExpiry: number | null;
  daysExpired: number | null;
}

type ConfidenceState = "sufficient" | "directional" | "insufficient";

interface WarrantyIntelligenceReport {
  generatedAt: string;
  totalAssets: number;
  active: WarrantyAsset[];
  expired: WarrantyAsset[];
  unknown: WarrantyAsset[];
  expiringWithin90Days: WarrantyAsset[];
  opportunityFlags: WarrantyAsset[];
  confidenceState: ConfidenceState;
  activeCount: number;
  expiredCount: number;
  unknownCount: number;
  expiringWithin90DaysCount: number;
  opportunityFlagCount: number;
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

const CONFIDENCE_META: Record<ConfidenceState, { label: string; tone: string }> = {
  sufficient: {
    label: "Sufficient data",
    tone: "border-status-green/40 text-status-green bg-status-green/10",
  },
  directional: {
    label: "Directional",
    tone: "border-amber-500/40 text-amber-600 bg-amber-500/10",
  },
  insufficient: {
    label: "Insufficient data",
    tone: "border-status-red/40 text-status-red bg-status-red/10",
  },
};

// ─── Main component ───────────────────────────────────────────────────────────

export function WarrantyIntelligencePanel() {
  const [data, setData] = useState<WarrantyIntelligenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reporting-analysis/assets/warranty")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: WarrantyIntelligenceReport) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const confidenceMeta = data ? CONFIDENCE_META[data.confidenceState] : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="warranty-intelligence-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Build 9.1 — Warranty Intelligence</h3>
          {confidenceMeta && (
            <Badge variant="outline" className={`text-xs ${confidenceMeta.tone}`}>
              {confidenceMeta.label}
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
        <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50" data-testid="warranty-panel-error">
          <p className="font-medium">Warranty intelligence unavailable</p>
          <p className="text-xs mt-0.5">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* Status summary counts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-border p-3 text-center">
              <div className="text-2xl font-bold text-status-green">{data.activeCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Active</div>
            </div>
            <div className="rounded-md border border-border p-3 text-center">
              <div className="text-2xl font-bold text-status-red">{data.expiredCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Expired</div>
            </div>
            <div className="rounded-md border border-border p-3 text-center">
              <div className="text-2xl font-bold text-muted-foreground">{data.unknownCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Unknown</div>
            </div>
          </div>

          {/* Expiring within 90 days */}
          {data.expiringWithin90DaysCount > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Expiring within 90 days ({data.expiringWithin90DaysCount})
                </h4>
              </div>
              <div className="rounded-md border border-border divide-y divide-border">
                {data.expiringWithin90Days.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium truncate block">{a.name}</span>
                      {a.propertyName && (
                        <span className="text-xs text-muted-foreground">{a.propertyName}</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 bg-amber-500/10 shrink-0 ml-2">
                      {a.daysUntilExpiry}d left
                    </Badge>
                  </div>
                ))}
                {data.expiringWithin90DaysCount > 5 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                    +{data.expiringWithin90DaysCount - 5} more
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Warranty claim opportunities */}
          {data.opportunityFlagCount > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-3.5 h-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Claim opportunities ({data.opportunityFlagCount})
                </h4>
              </div>
              <div className="rounded-md border border-border divide-y divide-border">
                {data.opportunityFlags.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium truncate block">{a.name}</span>
                      {a.propertyName && (
                        <span className="text-xs text-muted-foreground">{a.propertyName}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {a.daysExpired}d ago
                    </span>
                  </div>
                ))}
                {data.opportunityFlagCount > 5 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                    +{data.opportunityFlagCount - 5} more
                  </div>
                )}
              </div>
            </section>
          )}

          {data.confidenceState === "insufficient" && (
            <p className="text-sm text-muted-foreground" data-testid="warranty-insufficient">
              Not enough warranty data. Add warranty dates to assets to unlock intelligence.
            </p>
          )}

          <div className="text-xs text-muted-foreground text-right">
            {data.totalAssets} total assets · Generated {new Date(data.generatedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
