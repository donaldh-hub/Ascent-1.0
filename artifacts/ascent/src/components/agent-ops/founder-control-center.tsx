import type React from "react";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, Activity, Users, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface OperatingHealth {
  jobsByState: Record<string, number>;
  openExceptionsBySeverity: Record<string, number>;
  openExceptionsByAgent: Record<string, number>;
  qualityDecisions: { released: number; blocked: number };
  supportCasesByStatus: Record<string, number>;
  leadsByStatus: Record<string, number>;
  manualInterventionRate: number;
  generatedAt: string;
}

interface FounderAlert {
  exceptionId: number;
  agentId: string;
  severity: string;
  whatHappened: string;
  whyItMatters: string;
  whatAgentsAlreadyDid: string[];
  optionsAvailable: string[];
  recommendation: string | null;
  decisionRequested: string;
  deadline: string | null;
}

interface FounderBriefing {
  urgent: FounderAlert[];
  scheduled: FounderAlert[];
}

interface AgentIncident {
  id: number;
  title: string;
  severity: string;
  status: string;
  exceptionIds: number[];
  agentIds: string[];
  createdAt: string;
}

const SEVERITY_TONE: Record<string, string> = {
  critical: "border-status-red/40 text-status-red bg-status-red/10",
  high: "border-status-red/40 text-status-red bg-status-red/10",
  medium: "border-amber-500/40 text-amber-600 bg-amber-500/10",
  low: "border-border text-muted-foreground bg-secondary/50",
};

function severityBadge(severity: string) {
  return (
    <Badge variant="outline" className={cn("text-xs uppercase tracking-wide", SEVERITY_TONE[severity] ?? SEVERITY_TONE.low)}>
      {severity}
    </Badge>
  );
}

function Tile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold mt-0.5", accent ?? "")}>{value}</div>
    </div>
  );
}

export function FounderControlCenter() {
  const [health, setHealth] = useState<OperatingHealth | null>(null);
  const [briefing, setBriefing] = useState<FounderBriefing | null>(null);
  const [incidents, setIncidents] = useState<AgentIncident[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/agent-ops/health").then((r) => r.json()),
      fetch("/api/agent-ops/briefing").then((r) => r.json()),
      fetch("/api/agent-ops/incidents").then((r) => r.json()),
    ])
      .then(([h, b, i]) => {
        setHealth(h);
        setBriefing(b);
        setIncidents(i.incidents ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const totalJobs = health ? Object.values(health.jobsByState).reduce((a, b) => a + b, 0) : 0;
  const openExceptionCount = health ? Object.values(health.openExceptionsBySeverity).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6" data-testid="founder-control-center">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
            <h3 className="font-semibold text-sm">Company Operating Health</h3>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="control-center-refresh-btn">
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", loading && "animate-spin")} />
            {loading ? "Checking…" : "Refresh"}
          </Button>
        </div>

        {loading && !health && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        )}

        {error && (
          <div className="text-sm text-muted-foreground p-3 rounded-md bg-secondary/50">
            <p className="font-medium">Operating health unavailable</p>
            <p className="text-xs mt-0.5">{error}</p>
          </div>
        )}

        {health && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <Tile label="Total Jobs" value={totalJobs.toLocaleString()} />
              <Tile
                label="Open Exceptions"
                value={openExceptionCount}
                accent={openExceptionCount > 0 ? "text-status-red" : "text-status-green"}
              />
              <Tile label="Manual Intervention Rate" value={`${Math.round(health.manualInterventionRate * 100)}%`} />
              <Tile label="Quality Released / Blocked" value={`${health.qualityDecisions.released} / ${health.qualityDecisions.blocked}`} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(health.jobsByState).map(([state, count]) => (
                <Tile key={state} label={state.replace(/_/g, " ")} value={count} />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Last computed {new Date(health.generatedAt).toLocaleTimeString()} — routine jobs stay out of this view; only counts by state are shown here.
            </p>
          </>
        )}
      </div>

      <BriefingSection title="Requires Your Decision" icon={ShieldAlert} alerts={briefing?.urgent} loading={loading} onDecided={load} />
      <BriefingSection title="Scheduled Review" icon={Radio} alerts={briefing?.scheduled} loading={loading} onDecided={load} />

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-sm">Consolidated Incidents</h3>
        </div>
        {incidents && incidents.length === 0 && (
          <p className="text-sm text-muted-foreground">No open incidents — related exceptions are consolidated here once two or more come from the same agent.</p>
        )}
        {incidents && incidents.length > 0 && (
          <div className="rounded-md border border-border divide-y divide-border">
            {incidents.map((incident) => (
              <div key={incident.id} className="flex items-center gap-3 px-3 py-2.5">
                {severityBadge(incident.severity)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{incident.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{incident.exceptionIds.length} exception(s) · opened {new Date(incident.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BriefingSection({
  title,
  icon: Icon,
  alerts,
  loading,
  onDecided,
}: {
  title: string;
  icon: React.ElementType;
  alerts?: FounderAlert[];
  loading: boolean;
  onDecided: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <h3 className="font-semibold text-sm">{title}</h3>
        {alerts && <span className="text-xs text-muted-foreground">({alerts.length})</span>}
      </div>

      {loading && !alerts && (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      )}

      {alerts && alerts.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="w-4 h-4 text-status-green" />
          Nothing here — every field below traces to a real exception an agent raised, so an empty list means none exist right now.
        </div>
      )}

      <div className="space-y-3">
        {alerts?.map((alert) => (
          <FounderAlertCard key={alert.exceptionId} alert={alert} onDecided={onDecided} />
        ))}
      </div>
    </div>
  );
}

function FounderAlertCard({ alert, onDecided }: { alert: FounderAlert; onDecided: () => void }) {
  const [decision, setDecision] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitDecision() {
    if (!decision.trim() || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/agent-ops/founder-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exceptionId: alert.exceptionId, decision: decision.trim() }),
      });
      if (r.ok) onDecided();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3 space-y-2" data-testid={`founder-alert-${alert.exceptionId}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {severityBadge(alert.severity)}
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{alert.agentId}</span>
        {alert.deadline && <span className="text-xs text-muted-foreground ml-auto">Due {new Date(alert.deadline).toLocaleString()}</span>}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">What happened</p>
        <p className="text-sm text-foreground">{alert.whatHappened}</p>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Why it matters</p>
        <p className="text-sm text-muted-foreground">{alert.whyItMatters}</p>
      </div>

      {alert.whatAgentsAlreadyDid.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">What the agents already did</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            {alert.whatAgentsAlreadyDid.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {alert.optionsAvailable.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Available options</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            {alert.optionsAvailable.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}

      {alert.recommendation && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Recommendation</p>
          <p className="text-sm text-foreground">{alert.recommendation}</p>
        </div>
      )}

      <div className="rounded-md bg-secondary/40 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Decision requested</p>
        <p className="text-sm text-foreground mb-2">{alert.decisionRequested}</p>
        <div className="flex gap-2">
          <Input
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            placeholder="Record your decision..."
            className="h-8 text-sm"
            disabled={submitting}
          />
          <Button size="sm" className="h-8 shrink-0" onClick={submitDecision} disabled={submitting || !decision.trim()}>
            {submitting ? <AlertTriangle className="h-3.5 w-3.5 animate-pulse" /> : "Decide"}
          </Button>
        </div>
      </div>
    </div>
  );
}
