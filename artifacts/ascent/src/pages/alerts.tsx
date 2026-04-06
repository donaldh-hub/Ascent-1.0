import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListAlerts,
  useGetAlertSummary,
  useMarkAlertRead,
  useAcknowledgeAlert,
  useResolveAlert,
  useEvaluateAlerts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell, AlertCircle, AlertTriangle, Info, CheckCircle2,
  RefreshCw, ExternalLink, Eye, ShieldCheck, Clock,
  Activity, GitBranch, BarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { Alert } from "@workspace/api-client-react";
import { DrillDownSheet } from "@/components/drill-down-sheet";
import type { SignalType } from "@/hooks/use-signal-drill";

// ─── Constants ───────────────────────────────────────────────

type TabValue = "active" | "acknowledged" | "resolved" | "all";
type LevelFilter = "all" | "critical" | "warning" | "informational";
type CategoryFilter = "all" | "status_alert" | "timing_alert" | "flow_alert" | "risk_alert";

// ─── Helpers ─────────────────────────────────────────────────

const levelConfig = {
  critical: {
    icon: AlertCircle,
    color: "text-status-red",
    bg: "bg-red-500/10",
    border: "border-l-status-red",
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-status-yellow",
    bg: "bg-yellow-500/10",
    border: "border-l-status-yellow",
    badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    label: "Warning",
  },
  informational: {
    icon: Info,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-l-blue-400",
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    label: "Info",
  },
};

const categoryConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  status_alert: { label: "Status", icon: Activity, color: "text-violet-400" },
  timing_alert: { label: "Timing", icon: Clock, color: "text-orange-400" },
  flow_alert: { label: "Flow", icon: GitBranch, color: "text-cyan-400" },
  risk_alert: { label: "Risk", icon: BarChart2, color: "text-rose-400" },
};

function getLevelConfig(level: string) {
  return levelConfig[level as keyof typeof levelConfig] ?? levelConfig.informational;
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

// ─── Alert Card ──────────────────────────────────────────────

interface AlertCardProps {
  alert: Alert;
  onMarkRead: (id: number) => void;
  onAcknowledge: (id: number) => void;
  onResolve: (id: number) => void;
  onNavigate: (path: string) => void;
}

function AlertCard({ alert, onMarkRead, onAcknowledge, onResolve, onNavigate }: AlertCardProps) {
  const cfg = getLevelConfig(alert.level ?? "informational");
  const catCfg = categoryConfig[alert.category ?? ""] ?? null;
  const LevelIcon = cfg.icon;
  const CatIcon = catCfg?.icon;
  const isResolved = alert.status === "resolved";
  const isAcknowledged = alert.status === "acknowledged";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={cn(
          "bg-card transition-all border-l-4 overflow-hidden",
          isResolved ? "opacity-50" : "",
          isAcknowledged ? "opacity-75" : "",
          !alert.isRead && !isResolved ? cfg.border : "border-l-border",
        )}
      >
        <CardContent className="p-4 flex gap-4 items-start">
          {/* Level icon */}
          <div className={cn("mt-0.5 p-2 rounded-full shrink-0", cfg.bg)}>
            <LevelIcon className={cn("h-5 w-5", cfg.color)} />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h4 className={cn(
                "text-sm font-semibold leading-snug",
                isResolved ? "text-muted-foreground" : "text-foreground"
              )}>
                {!alert.isRead && !isResolved && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary mr-2 align-middle" />
                )}
                {alert.title}
              </h4>
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                {formatRelative(alert.triggeredAt)}
              </span>
            </div>

            {/* Message */}
            <p className={cn("text-xs leading-relaxed mb-3", isResolved ? "text-muted-foreground/60" : "text-muted-foreground")}>
              {alert.message}
            </p>

            {/* Badges row */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full border",
                cfg.badge
              )}>
                {cfg.label}
              </span>
              {catCfg && CatIcon && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary border border-border flex items-center gap-1">
                  <CatIcon className={cn("h-3 w-3", catCfg.color)} />
                  <span className="text-secondary-foreground">{catCfg.label}</span>
                </span>
              )}
              {isAcknowledged && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
                  Acknowledged
                </span>
              )}
              {isResolved && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
                  Resolved
                </span>
              )}
            </div>

            {/* Action row */}
            {!isResolved && (
              <div className="flex flex-wrap gap-1.5">
                {!alert.isRead && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs px-2 text-muted-foreground"
                    onClick={() => onMarkRead(alert.id)}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Mark read
                  </Button>
                )}
                {!isAcknowledged && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs px-2 text-blue-400 hover:bg-blue-500/10"
                    onClick={() => onAcknowledge(alert.id)}
                  >
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Acknowledge
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs px-2 text-green-400 hover:bg-green-500/10"
                  onClick={() => onResolve(alert.id)}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Resolve
                </Button>
                {alert.actionPath && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs px-2 text-muted-foreground hover:text-primary"
                    onClick={() => onNavigate(alert.actionPath!)}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    View workflow
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Summary Strip ───────────────────────────────────────────

function SummaryStrip({ critical, warning, informational, unread, onDrill }: {
  critical: number; warning: number; informational: number; unread: number;
  onDrill: (signal: SignalType) => void;
}) {
  const tiles = [
    { label: "Critical", value: critical, color: "text-status-red",    bg: "bg-red-500/10",    border: "border-red-500/20",    signal: "critical_items" as SignalType },
    { label: "Warning",  value: warning,  color: "text-status-yellow", bg: "bg-yellow-500/10", border: "border-yellow-500/20", signal: "overdue_items" as SignalType },
    { label: "Info",     value: informational, color: "text-blue-400", bg: "bg-blue-500/10",   border: "border-blue-500/20",   signal: null },
    { label: "Unread",   value: unread,   color: "text-foreground",    bg: "bg-secondary",     border: "border-border",        signal: null },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {tiles.map(({ label, value, color, bg, border, signal }) =>
        signal && value > 0 ? (
          <button
            key={label}
            onClick={() => onDrill(signal)}
            className={cn("rounded-lg border p-3 text-center hover:opacity-80 transition-opacity", bg, border)}
            title={`View ${label.toLowerCase()} items in detail`}
          >
            <p className={cn("text-2xl font-bold flex items-baseline justify-center gap-1", color)}>
              {value}
              <span className="text-[11px] text-primary/50">↗</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </button>
        ) : (
          <div key={label} className={cn("rounded-lg border p-3 text-center", bg, border)}>
            <p className={cn("text-2xl font-bold", color)}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        )
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function Alerts() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabValue>("active");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [drillSignal, setDrillSignal] = useState<SignalType | null>(null);

  const { data: alerts, isLoading, refetch } = useListAlerts();
  const { data: summary, refetch: refetchSummary } = useGetAlertSummary();
  const markReadMutation = useMarkAlertRead();
  const acknowledgeMutation = useAcknowledgeAlert();
  const resolveMutation = useResolveAlert();
  const evaluateMutation = useEvaluateAlerts();

  const handleRefetch = () => {
    refetch();
    refetchSummary();
  };

  const handleMarkRead = (id: number) => {
    markReadMutation.mutate({ id }, { onSuccess: handleRefetch });
  };

  const handleAcknowledge = (id: number) => {
    acknowledgeMutation.mutate({ id }, { onSuccess: handleRefetch });
  };

  const handleResolve = (id: number) => {
    resolveMutation.mutate({ id }, { onSuccess: handleRefetch });
  };

  const handleEvaluate = () => {
    setIsEvaluating(true);
    evaluateMutation.mutate(undefined, {
      onSuccess: () => {
        handleRefetch();
        setIsEvaluating(false);
      },
      onError: () => setIsEvaluating(false),
    });
  };

  const handleNavigate = (path: string) => navigate(path);

  // Tab filtering
  const tabFiltered = (alerts ?? []).filter((a) => {
    if (tab === "active") return a.isActive && a.status === "active";
    if (tab === "acknowledged") return a.status === "acknowledged";
    if (tab === "resolved") return !a.isActive || a.status === "resolved";
    return true;
  });

  // Level + category filtering
  const filtered = tabFiltered.filter((a) => {
    if (levelFilter !== "all" && a.level !== levelFilter) return false;
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    return true;
  });

  const activeCount = (alerts ?? []).filter((a) => a.isActive && a.status === "active").length;
  const acknowledgedCount = (alerts ?? []).filter((a) => a.status === "acknowledged").length;

  const categoryOptions: { value: CategoryFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "status_alert", label: "Status" },
    { value: "timing_alert", label: "Timing" },
    { value: "flow_alert", label: "Flow" },
    { value: "risk_alert", label: "Risk" },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alert Center</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Real-time operational notifications and escalations
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleEvaluate}
          disabled={isEvaluating}
          className="gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", isEvaluating && "animate-spin")} />
          {isEvaluating ? "Running check..." : "Run alert check"}
        </Button>
      </div>

      {/* Summary strip */}
      {summary && (
        <SummaryStrip
          critical={summary.critical}
          warning={summary.warning}
          informational={summary.informational}
          unread={summary.unread}
          onDrill={setDrillSignal}
        />
      )}

      {/* Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList className="bg-secondary">
            <TabsTrigger value="active">
              Active
              {activeCount > 0 && (
                <span className="ml-1.5 bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full font-mono">
                  {activeCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="acknowledged">
              Acknowledged
              {acknowledgedCount > 0 && (
                <span className="ml-1.5 bg-blue-500/20 text-blue-400 text-xs px-1.5 py-0.5 rounded-full font-mono">
                  {acknowledgedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Level filter */}
        <div className="flex gap-1.5">
          {(["all", "critical", "warning", "informational"] as LevelFilter[]).map((l) => (
            <Button
              key={l}
              size="sm"
              variant={levelFilter === l ? "default" : "outline"}
              className={cn(
                "h-7 text-xs px-2.5 capitalize",
                l === "critical" && levelFilter !== l ? "text-status-red border-red-500/30 hover:bg-red-500/10" : "",
                l === "warning" && levelFilter !== l ? "text-status-yellow border-yellow-500/30 hover:bg-yellow-500/10" : "",
              )}
              onClick={() => setLevelFilter(l)}
            >
              {l === "all" ? "All levels" : l === "informational" ? "Info" : l.charAt(0).toUpperCase() + l.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Category filter row */}
      <div className="flex gap-1.5 flex-wrap -mt-2">
        {categoryOptions.map(({ value, label }) => {
          const catCfg = categoryConfig[value];
          const CatIcon = catCfg?.icon;
          return (
            <Button
              key={value}
              size="sm"
              variant={categoryFilter === value ? "secondary" : "ghost"}
              className={cn(
                "h-7 text-xs px-2.5 gap-1",
                categoryFilter === value ? "bg-secondary text-foreground" : "text-muted-foreground"
              )}
              onClick={() => setCategoryFilter(value)}
            >
              {CatIcon && <CatIcon className={cn("h-3 w-3", catCfg.color)} />}
              {label}
            </Button>
          );
        })}
      </div>

      {/* Count */}
      <div className="flex items-center justify-between px-1 -mt-2">
        <span className="text-xs text-muted-foreground">
          {filtered.length} alert{filtered.length !== 1 ? "s" : ""} shown
        </span>
        {(alerts ?? []).filter((a) => !a.isRead).length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 text-muted-foreground"
            onClick={() => {
              (alerts ?? []).filter((a) => !a.isRead).forEach((a) => markReadMutation.mutate({ id: a.id }));
              setTimeout(handleRefetch, 400);
            }}
          >
            <CheckCircle2 className="h-3 w-3 mr-1.5" /> Mark all read
          </Button>
        )}
      </div>

      {/* Alert list */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 flex gap-4">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground bg-card/50 rounded-lg border border-dashed border-border">
            {tab === "active" ? (
              <>
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-20 text-status-green" />
                <h3 className="text-base font-medium text-foreground">No active alerts</h3>
                <p className="mt-1 text-sm">All systems operating normally.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-2"
                  onClick={handleEvaluate}
                  disabled={isEvaluating}
                >
                  <RefreshCw className={cn("h-4 w-4", isEvaluating && "animate-spin")} />
                  Run alert check
                </Button>
              </>
            ) : (
              <>
                <Bell className="h-10 w-10 mx-auto mb-4 opacity-20" />
                <h3 className="text-base font-medium text-foreground">Nothing here</h3>
                <p className="mt-1 text-sm">No alerts match the selected filters.</p>
              </>
            )}
          </div>
        ) : (
          <AnimatePresence>
            {filtered.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onMarkRead={handleMarkRead}
                onAcknowledge={handleAcknowledge}
                onResolve={handleResolve}
                onNavigate={handleNavigate}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {drillSignal && (
        <DrillDownSheet
          signal={drillSignal}
          onClose={() => setDrillSignal(null)}
        />
      )}
    </div>
  );
}
