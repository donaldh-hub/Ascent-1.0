import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ServiceCheck {
  service: string;
  status: "ok" | "degraded" | "down";
  latencyMs?: number;
  detail?: string;
}

interface HealthReport {
  status: "healthy" | "degraded" | "down";
  checkedAt: string;
  version: string;
  services: ServiceCheck[];
  databaseConnected: boolean;
  workOrderCount: number;
  assetCount: number;
  propertyCount: number;
}

const STATUS_META = {
  healthy: {
    label: "Healthy",
    tone: "border-status-green/40 text-status-green bg-status-green/10",
    icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    tone: "border-amber-500/40 text-amber-600 bg-amber-500/10",
    icon: AlertTriangle,
  },
  down: {
    label: "Down",
    tone: "border-status-red/40 text-status-red bg-status-red/10",
    icon: XCircle,
  },
} as const;

const SVC_ICON = {
  ok: <CheckCircle2 className="w-4 h-4 text-status-green" />,
  degraded: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  down: <XCircle className="w-4 h-4 text-status-red" />,
};

export function SystemHealthPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/health/detailed")
      .then((r) => r.json())
      .then((d: HealthReport) => setReport(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const meta = report ? STATUS_META[report.status] : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="system-health-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">System Health</h3>
          {report && <span className="text-xs text-muted-foreground">v{report.version}</span>}
        </div>
        <div className="flex items-center gap-2">
          {report && meta && (
            <Badge variant="outline" className={`text-xs ${meta.tone}`}>
              {(() => { const I = meta.icon; return <I className="w-3 h-3 mr-1 inline" />; })()}
              {meta.label}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="health-refresh-btn">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Refresh"}
          </Button>
        </div>
      </div>

      {loading && !report && (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50">
          <p className="font-medium">Health check unavailable</p>
          <p className="text-xs mt-0.5">{error}</p>
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Tile label="DB Connected" value={report.databaseConnected ? "Yes" : "No"} accent={report.databaseConnected ? "text-status-green" : "text-status-red"} />
            <Tile label="Work Orders" value={report.workOrderCount.toLocaleString()} />
            <Tile label="Assets" value={report.assetCount.toLocaleString()} />
            <Tile label="Properties" value={report.propertyCount.toLocaleString()} />
          </div>

          {report.services.length > 0 && (
            <div className="rounded-md border border-border divide-y divide-border">
              {report.services.map((svc) => (
                <div key={svc.service} className="flex items-center gap-3 px-3 py-2.5" data-testid={`health-svc-${svc.service}`}>
                  {SVC_ICON[svc.status]}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium capitalize">{svc.service}</span>
                    {svc.detail && <p className="text-xs text-muted-foreground mt-0.5 truncate">{svc.detail}</p>}
                  </div>
                  {svc.latencyMs !== undefined && (
                    <span className="text-xs text-muted-foreground shrink-0">{svc.latencyMs}ms</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 text-xs text-muted-foreground">
            Last checked {new Date(report.checkedAt).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
