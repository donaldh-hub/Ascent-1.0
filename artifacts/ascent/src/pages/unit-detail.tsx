import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Hash, Building2, Calendar, FileText, Briefcase, Server,
  Clock, PlusCircle, Upload, AlertCircle, Info, ChevronRight,
  Shield, ShieldOff, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useListUnits, useListProperties, useListDocuments } from "@workspace/api-client-react";
import { useUnitHistory, type UnitHistoryEvent } from "@/hooks/use-unit-history";
import { DocumentPanel } from "@/components/document-panel";
import { cn } from "@/lib/utils";

// ─── Unit assets hook ─────────────────────────────────────────────────────────

interface UnitAsset {
  id: number;
  name: string;
  assetType: string | null;
  serial: string | null;
  status: string;
  stoplight: string;
  healthScore: number;
  installDate: string | null;
  warrantyExpiration: string | null;
  warrantyDaysRemaining: number | null;
  location: string | null;
}

function useUnitAssets(unitId: number) {
  return useQuery<UnitAsset[]>({
    queryKey: ["assets", "unit", unitId],
    queryFn: async () => {
      const res = await fetch(`/api/assets/unit/${unitId}`);
      if (!res.ok) throw new Error("Failed to fetch unit assets");
      return res.json();
    },
    enabled: unitId > 0,
    staleTime: 60_000,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function timeAgo(s: string) {
  const diff = Date.now() - new Date(s).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return fmtDate(s);
}

// ─── Insight strip ───────────────────────────────────────────────────────────

function InsightStrip({ docCount, workCount, latestAt }: {
  docCount: number;
  workCount: number;
  latestAt: string | null;
}) {
  if (docCount === 0 && workCount === 0) {
    return (
      <div className="flex items-start gap-2.5 bg-secondary/30 border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>No work history has been recorded for this unit yet.</span>
      </div>
    );
  }

  const parts: string[] = [];
  if (workCount > 0) parts.push(`${workCount} related work item${workCount !== 1 ? "s" : ""} recorded.`);
  if (docCount > 0) parts.push(`${docCount} document${docCount !== 1 ? "s are" : " is"} attached to unit activity.`);
  if (latestAt && (docCount > 0 || workCount > 0)) {
    const isDoc = docCount > 0 && workCount === 0;
    parts.push(`Latest activity${isDoc ? " was a document upload" : ""}: ${timeAgo(latestAt)}.`);
  }

  return (
    <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 text-sm text-foreground">
      <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
      <span>{parts.join(" ")}</span>
    </div>
  );
}

// ─── Quick snapshot ───────────────────────────────────────────────────────────

function SnapshotCard({ icon: Icon, value, label, sub }: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  unit_created: { icon: PlusCircle, color: "text-primary", label: "Unit added" },
  document_uploaded: { icon: Upload, color: "text-status-green", label: "Document" },
};

function TimelineEvent({ event }: { event: UnitHistoryEvent }) {
  const meta = EVENT_META[event.eventType] ?? { icon: Clock, color: "text-muted-foreground", label: "Event" };
  const Icon = meta.icon;
  return (
    <div className="flex gap-3 py-3">
      <div className={cn("h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5", meta.color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{event.title}</span>
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(event.timestamp)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs py-0">{meta.label}</Badge>
          <span className="text-xs text-muted-foreground">{event.actor}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center gap-2.5 bg-secondary/20">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

function EmptySection({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="px-5 py-8 text-center text-muted-foreground">
      <AlertCircle className="h-6 w-6 mx-auto mb-2 opacity-30" />
      <p className="text-sm font-medium">{message}</p>
      {sub && <p className="text-xs mt-1 max-w-xs mx-auto">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UnitDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const unitId = parseInt(id, 10);

  const { data: units = [], isLoading: unitsLoading } = useListUnits({});
  const { data: properties = [] } = useListProperties();
  const { data: history, isLoading: historyLoading } = useUnitHistory(unitId);
  const { data: unitDocs = [] } = useListDocuments(
    { entityType: "unit", entityId: unitId },
    { query: { queryKey: ["documents", "unit", unitId] } }
  );
  const { data: unitAssets = [], isLoading: assetsLoading } = useUnitAssets(unitId);

  const unit = units.find((u) => u.id === unitId);
  const property = properties.find((p) => p.id === unit?.propertyId);

  if (!unitsLoading && !unit) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Hash className="h-10 w-10 mb-4 opacity-30" />
        <p className="font-medium">Unit not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/units")}>
          Back to Units
        </Button>
      </div>
    );
  }

  const docCount = history?.documentCount ?? 0;
  const workCount = history?.workItemCount ?? 0;
  const assetCount = history?.assetCount ?? 0;
  const latestAt = history?.latestActivityAt ?? null;

  const metaEntries = unit?.metadata && typeof unit.metadata === "object"
    ? Object.entries(unit.metadata as Record<string, unknown>).filter(([, v]) => v !== null && v !== "")
    : [];

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto w-full">

      {/* Back nav */}
      <button
        onClick={() => navigate("/units")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm w-fit"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Units
      </button>

      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Hash className="h-7 w-7 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">Unit {unit?.unitNumber ?? "…"}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
            {property && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4" />
                {property.name}
                {property.address && <span className="text-muted-foreground/60">· {property.address}</span>}
              </span>
            )}
            {unit && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Added {fmtDate(unit.createdAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Insight strip ── */}
      {!historyLoading && (
        <InsightStrip docCount={docCount} workCount={workCount} latestAt={latestAt} />
      )}

      {/* ── Snapshot ── */}
      <div className="grid grid-cols-3 gap-3">
        <SnapshotCard icon={Briefcase} value={workCount} label="Work Items"
          sub={workCount === 0 ? "None linked yet" : `${workCount} item${workCount !== 1 ? "s" : ""}`} />
        <SnapshotCard icon={FileText} value={docCount} label="Documents"
          sub={docCount === 0 ? "No uploads yet" : `${docCount} uploaded`} />
        <SnapshotCard icon={Server} value={assetCount} label="Assets"
          sub={assetCount === 0 ? "None linked yet" : `${assetCount} tracked`} />
      </div>

      {/* ── Unit details ── */}
      {(property || metaEntries.length > 0) && (
        <Section title="Unit Details" icon={Hash}>
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-muted-foreground">Unit number</span>
              <span className="text-sm font-medium">{unit?.unitNumber}</span>
            </div>
            {property && (
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground">Property</span>
                <span className="text-sm font-medium">{property.name}</span>
              </div>
            )}
            {property?.address && (
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground">Address</span>
                <span className="text-sm font-medium">{property.address}</span>
              </div>
            )}
            {metaEntries.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                <span className="text-sm font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── History timeline ── */}
      <Section title="Activity History" icon={Clock}>
        {historyLoading ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">Loading history…</div>
        ) : !history || history.events.length === 0 ? (
          <EmptySection
            message="No activity recorded yet"
            sub="Events like document uploads and work item changes will appear here."
          />
        ) : (
          <div className="px-5 divide-y divide-border">
            {history.events.map((event) => (
              <TimelineEvent key={event.id} event={event} />
            ))}
          </div>
        )}
      </Section>

      {/* ── Documents ── */}
      <Section title="Documents & Evidence" icon={FileText}>
        <div className="p-4">
          <DocumentPanel entityType="unit" entityId={unitId} />
        </div>
      </Section>

      {/* ── Work items ── */}
      <Section title="Related Work" icon={Briefcase}>
        <EmptySection
          message="No work items linked to this unit yet"
          sub="Work items will appear here once they are assigned to this unit in a future update."
        />
        <div className="px-5 pb-4">
          <Button variant="outline" size="sm" onClick={() => navigate("/workflows")} className="w-full">
            View All Workflows <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </Section>

      {/* ── Assets ── */}
      <Section title={`Assets${unitAssets.length > 0 ? ` (${unitAssets.length})` : ""}`} icon={Server}>
        {assetsLoading ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">Loading assets…</div>
        ) : unitAssets.length === 0 ? (
          <>
            <EmptySection
              message="No assets linked to this unit"
              sub="Assets tracked for this unit will appear here once registered."
            />
            <div className="px-5 pb-4">
              <Button variant="outline" size="sm" onClick={() => navigate("/assets")} className="w-full">
                View All Assets <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </>
        ) : (
          <div className="divide-y divide-border">
            {unitAssets.map((asset) => {
              const warrantyExpired = asset.warrantyDaysRemaining !== null && asset.warrantyDaysRemaining < 0;
              const warrantyExpiringSoon = !warrantyExpired && asset.warrantyDaysRemaining !== null && asset.warrantyDaysRemaining <= 90;
              const WarrantyIcon = warrantyExpired ? ShieldOff : warrantyExpiringSoon ? ShieldAlert : Shield;
              const warrantyColor = warrantyExpired
                ? "text-red-400"
                : warrantyExpiringSoon
                ? "text-yellow-400"
                : "text-green-400";

              return (
                <div key={asset.id} className="flex items-center gap-4 px-5 py-4">
                  <div className={cn(
                    "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                    asset.stoplight === "red" ? "bg-red-500/10" :
                    asset.stoplight === "yellow" ? "bg-yellow-500/10" : "bg-green-500/10"
                  )}>
                    <Server className={cn("h-4 w-4",
                      asset.stoplight === "red" ? "text-red-400" :
                      asset.stoplight === "yellow" ? "text-yellow-400" : "text-green-400"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{asset.assetType ?? asset.name}</span>
                      {asset.serial && (
                        <span className="text-xs text-muted-foreground font-mono">{asset.serial}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <WarrantyIcon className={cn("h-3 w-3", warrantyColor)} />
                        {warrantyExpired
                          ? `Warranty expired ${Math.abs(asset.warrantyDaysRemaining!)}d ago`
                          : asset.warrantyDaysRemaining !== null
                          ? `${asset.warrantyDaysRemaining}d warranty remaining`
                          : "No warranty data"}
                      </span>
                      {asset.healthScore !== undefined && (
                        <span>Health {asset.healthScore}/100</span>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-xs shrink-0",
                      warrantyExpired ? "border-red-500/30 text-red-400" :
                      warrantyExpiringSoon ? "border-yellow-500/30 text-yellow-400" :
                      "border-green-500/30 text-green-400"
                    )}
                  >
                    {warrantyExpired ? "At Risk" : warrantyExpiringSoon ? "Expiring Soon" : "Active"}
                  </Badge>
                </div>
              );
            })}
            <div className="px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => navigate("/assets")} className="w-full">
                View All Assets <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Section>

    </div>
  );
}
