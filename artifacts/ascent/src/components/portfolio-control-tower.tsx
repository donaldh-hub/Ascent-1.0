/**
 * Phase 1 — Portfolio Control Tower UI
 *
 * Section components for the multi-property ranked view on the dashboard.
 * All business logic lives in the API service. This is pure display + action.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, ChevronDown, ChevronUp, TrendingUp, TrendingDown,
  Minus, AlertTriangle, Mail, Copy, CheckCircle2, Shield,
  Activity, Zap, BarChart2, FileWarning, FileCheck2,
  User, Hash, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { usePortfolio, type PropertyPortfolioCard } from "@/hooks/use-portfolio";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stoplightColor(s: "green" | "yellow" | "red") {
  return s === "green"
    ? "text-status-green"
    : s === "yellow"
    ? "text-status-yellow"
    : "text-status-red";
}

function stoplightBg(s: "green" | "yellow" | "red") {
  return s === "green"
    ? "bg-status-green/10 border-status-green/30"
    : s === "yellow"
    ? "bg-status-yellow/10 border-status-yellow/30"
    : "bg-status-red/10 border-status-red/30";
}

function stoplightDot(s: "green" | "yellow" | "red") {
  return s === "green"
    ? "bg-status-green"
    : s === "yellow"
    ? "bg-status-yellow animate-pulse"
    : "bg-status-red animate-pulse";
}

function TrendIcon({ dir }: { dir: "up" | "down" | "stable" }) {
  if (dir === "up") return <TrendingUp className="h-3.5 w-3.5 text-status-green" />;
  if (dir === "down") return <TrendingDown className="h-3.5 w-3.5 text-status-red" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="h-1 w-full rounded-full bg-border/40 overflow-hidden">
      <motion.div
        className={cn("h-full rounded-full", color)}
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}

// ── PropertyCardHeader ─────────────────────────────────────────────────────────

function PropertyCardHeader({ card }: { card: PropertyPortfolioCard }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          "h-8 w-8 rounded-lg border flex items-center justify-center shrink-0",
          stoplightBg(card.stoplight),
        )}>
          <Building2 className={cn("h-4 w-4", stoplightColor(card.stoplight))} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground text-sm leading-tight">{card.propertyName}</span>
            <TrendIcon dir={card.trendDirection} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("w-2 h-2 rounded-full shrink-0", stoplightDot(card.stoplight))} />
            <span className="text-xs text-muted-foreground capitalize">{card.stoplight}</span>
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={cn("text-2xl font-bold tabular-nums", stoplightColor(card.stoplight))}>
          {card.healthScore}
        </div>
        <div className="text-xs text-muted-foreground">/ 100</div>
      </div>
    </div>
  );
}

// ── PropertyMetricsRow ────────────────────────────────────────────────────────

function PropertyMetricsRow({ card }: { card: PropertyPortfolioCard }) {
  const dims = [
    { label: "Flow", score: card.flowScore, icon: Activity, color: "bg-blue-500" },
    { label: "Risk", score: card.riskScore, icon: Shield, color: "bg-status-red" },
    { label: "Execute", score: card.executionScore, icon: Zap, color: "bg-violet-500" },
    { label: "Improve", score: card.improvementScore, icon: BarChart2, color: "bg-emerald-500" },
  ] as const;

  return (
    <div className="grid grid-cols-4 gap-2 mt-3">
      {dims.map((d) => (
        <div key={d.label} className="text-center">
          <div className="text-xs text-muted-foreground mb-1">{d.label}</div>
          <div className="font-semibold text-sm tabular-nums">{d.score}</div>
          <div className="mt-1">
            <ScoreBar score={d.score} color={d.color} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── PropertySignalsBlock ──────────────────────────────────────────────────────

function PropertySignalsBlock({ card }: { card: PropertyPortfolioCard }) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {card.criticalItemsCount > 0 && (
        <span className="inline-flex items-center gap-1 text-xs bg-status-red/10 text-status-red border border-status-red/25 rounded-full px-2 py-0.5">
          <AlertTriangle className="h-3 w-3" />
          {card.criticalItemsCount} critical
        </span>
      )}
      <span className="inline-flex items-center gap-1 text-xs bg-secondary/60 text-muted-foreground border border-border/40 rounded-full px-2 py-0.5">
        <Hash className="h-3 w-3" />
        {card.topBottleneck}
      </span>
      {card.bottleneckAging > 0 && (
        <span className="inline-flex items-center gap-1 text-xs bg-status-yellow/10 text-status-yellow border border-status-yellow/25 rounded-full px-2 py-0.5">
          <Clock className="h-3 w-3" />
          {card.bottleneckAging}d aging
        </span>
      )}
    </div>
  );
}

// ── Evidence line ─────────────────────────────────────────────────────────────

function PropertyEvidenceLine({ card }: { card: PropertyPortfolioCard }) {
  if (card.missingDocsCount > 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-status-yellow mt-2">
        <FileWarning className="h-3.5 w-3.5 shrink-0" />
        Missing documentation ({card.missingDocsCount} critical asset{card.missingDocsCount !== 1 ? "s" : ""})
      </div>
    );
  }
  if (card.documentCount > 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
        <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-status-green" />
        {card.documentCount} documents on file
      </div>
    );
  }
  return null;
}

// ── PropertyInsightText ───────────────────────────────────────────────────────

function PropertyInsightText({ text }: { text: string }) {
  return (
    <div className="mt-3 text-xs text-muted-foreground leading-relaxed border-t border-border/30 pt-2.5">
      {text}
    </div>
  );
}

// ── SupervisorActionBlock ─────────────────────────────────────────────────────

function SupervisorActionBlock({ card }: { card: PropertyPortfolioCard }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const subject = encodeURIComponent(
    `${card.propertyName} — ${card.topBottleneck} / Risk Alert`,
  );
  const body = encodeURIComponent(
    `Hi ${card.supervisorName ?? "Supervisor"},\n\n` +
    `I'm reaching out regarding ${card.propertyName}.\n\n` +
    `Current Status: ${card.healthScore}/100 (${card.stoplight.toUpperCase()})\n` +
    `Active Risk: ${card.atRiskAssets} assets with expired warranty\n` +
    `Critical Alerts: ${card.criticalItemsCount}\n` +
    `Missing Documentation: ${card.missingDocsCount} critical assets\n\n` +
    `Insight: ${card.insightSummary}\n\n` +
    `Please review and provide an update on:\n` +
    `1. ${card.topBottleneck} — cause and current status\n` +
    `2. Documentation status for flagged assets\n` +
    `3. Resolution timeline\n\n` +
    `— Sent from Ascent 1.0`,
  );
  const mailtoHref = `mailto:${card.supervisorEmail}?subject=${subject}&body=${body}`;

  function handleCopy() {
    navigator.clipboard.writeText(card.communicationSummary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ description: "Summary copied to clipboard" });
    });
  }

  if (!card.supervisorName && !card.supervisorEmail) return null;

  return (
    <div className="mt-4 pt-3.5 border-t border-border/40">
      <div className="flex items-center gap-2 mb-3">
        <User className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">{card.supervisorName}</span>
        <span className="text-xs text-muted-foreground">· Maintenance Supervisor</span>
      </div>
      <div className="flex gap-2">
        <a href={mailtoHref} className="flex-1">
          <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10">
            <Mail className="h-3.5 w-3.5" />
            Email Supervisor
          </Button>
        </a>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5 border-border/40"
          onClick={handleCopy}
        >
          {copied
            ? <><CheckCircle2 className="h-3.5 w-3.5 text-status-green" /> Copied</>
            : <><Copy className="h-3.5 w-3.5" /> Copy Summary</>}
        </Button>
      </div>
    </div>
  );
}

// ── SupervisorActionSlim — visible in default collapsed card state ─────────────

function SupervisorActionSlim({ card }: { card: PropertyPortfolioCard }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const subject = encodeURIComponent(
    `${card.propertyName} — ${card.topBottleneck} / Risk Alert`,
  );
  const body = encodeURIComponent(
    `Hi ${card.supervisorName ?? "Supervisor"},\n\n` +
    `I'm reaching out regarding ${card.propertyName}.\n\n` +
    `Current Status: ${card.healthScore}/100 (${card.stoplight.toUpperCase()})\n` +
    `Active Risk: ${card.atRiskAssets} assets with expired warranty\n` +
    `Critical Alerts: ${card.criticalItemsCount}\n` +
    `Missing Documentation: ${card.missingDocsCount} critical assets\n\n` +
    `Insight: ${card.insightSummary}\n\n` +
    `Please review and provide an update on:\n` +
    `1. ${card.topBottleneck} — cause and current status\n` +
    `2. Documentation status for flagged assets\n` +
    `3. Resolution timeline\n\n` +
    `— Sent from Ascent 1.0`,
  );
  const mailtoHref = `mailto:${card.supervisorEmail}?subject=${subject}&body=${body}`;

  function handleCopy() {
    navigator.clipboard.writeText(card.communicationSummary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ description: "Summary copied to clipboard" });
    });
  }

  if (!card.supervisorName && !card.supervisorEmail) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground truncate">
          <span className="font-medium text-foreground/80">{card.supervisorName}</span>
          <span className="ml-1 text-muted-foreground/60">· Supervisor</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <a href={mailtoHref}>
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10 px-2.5">
            <Mail className="h-3 w-3" />
            Email
          </Button>
        </a>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1 border-border/40 px-2.5"
          onClick={handleCopy}
        >
          {copied
            ? <><CheckCircle2 className="h-3 w-3 text-status-green" /> Copied</>
            : <><Copy className="h-3 w-3" /> Copy</>}
        </Button>
      </div>
    </div>
  );
}

// ── PropertyExpandedView ──────────────────────────────────────────────────────

function PropertyExpandedView({ card }: { card: PropertyPortfolioCard }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden"
    >
      <div className="pt-4 border-t border-border/40 mt-4 space-y-4">

        {/* WorkflowBreakdownSection */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Top Issue</div>
          <div className="rounded-md bg-secondary/40 border border-border/30 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", stoplightColor(card.stoplight))} />
              <div>
                <div className="text-sm font-medium">{card.topBottleneck}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{card.insightSummary}</div>
              </div>
            </div>
          </div>
        </div>

        {/* UnitImpactSection */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Total Assets", value: card.totalAssets, color: "text-foreground" },
            { label: "Expired Warranty", value: card.atRiskAssets, color: card.atRiskAssets > 0 ? "text-status-red" : "text-foreground" },
            { label: "Expiring Soon", value: card.expiringSoonAssets, color: card.expiringSoonAssets > 0 ? "text-status-yellow" : "text-foreground" },
          ].map((m) => (
            <div key={m.label} className="rounded-md bg-secondary/30 border border-border/30 px-2.5 py-2 text-center">
              <div className={cn("text-lg font-bold tabular-nums", m.color)}>{m.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{m.label}</div>
            </div>
          ))}
        </div>

        {/* DocumentWarningSection */}
        <div className="rounded-md bg-secondary/30 border border-border/30 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileCheck2 className="h-3.5 w-3.5" />
              <span>Documents on file</span>
            </div>
            <span className="font-semibold">{card.documentCount}</span>
          </div>
          {card.missingDocsCount > 0 && (
            <div className="flex items-center justify-between text-xs mt-1.5">
              <div className="flex items-center gap-1.5 text-status-yellow">
                <FileWarning className="h-3.5 w-3.5" />
                <span>Missing (critical assets)</span>
              </div>
              <span className="font-semibold text-status-yellow">{card.missingDocsCount}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs mt-1.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              <span>Unit coverage</span>
            </div>
            <span className="font-semibold">{card.unitCoverage}%</span>
          </div>
        </div>

        {/* SupervisorActionBlock */}
        <SupervisorActionBlock card={card} />
      </div>
    </motion.div>
  );
}

// ── PropertyCard ─────────────────────────────────────────────────────────────

function PropertyCard({ card }: { card: PropertyPortfolioCard }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      className={cn(
        "rounded-xl border bg-card p-4 transition-shadow duration-200",
        card.stoplight === "red"
          ? "border-status-red/25 shadow-sm shadow-status-red/10"
          : card.stoplight === "yellow"
          ? "border-status-yellow/20"
          : "border-border/50",
      )}
    >
      <PropertyCardHeader card={card} />
      <PropertyMetricsRow card={card} />
      <PropertySignalsBlock card={card} />
      <PropertyEvidenceLine card={card} />
      <PropertyInsightText text={card.insightSummary} />

      {/* Supervisor action — always visible in collapsed state */}
      <SupervisorActionSlim card={card} />

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 border-t border-border/20 pt-2.5"
      >
        {expanded ? (
          <><ChevronUp className="h-3.5 w-3.5" /> Collapse</>
        ) : (
          <><ChevronDown className="h-3.5 w-3.5" /> Asset breakdown & full outreach</>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && <PropertyExpandedView key="expanded" card={card} />}
      </AnimatePresence>
    </motion.div>
  );
}

// ── PortfolioControlTowerSection ──────────────────────────────────────────────

export function PortfolioControlTowerSection() {
  const { data: portfolio, isLoading } = usePortfolio();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <SectionHeader loading />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 rounded-xl border border-border/40 bg-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!portfolio || portfolio.length === 0) {
    return (
      <div className="space-y-3">
        <SectionHeader />
        <div className="rounded-xl border border-border/40 bg-card p-8 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No properties available</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Properties with linked assets will appear here.</p>
        </div>
      </div>
    );
  }

  const redCount = portfolio.filter((p) => p.stoplight === "red").length;
  const yellowCount = portfolio.filter((p) => p.stoplight === "yellow").length;

  return (
    <div className="space-y-4">
      <SectionHeader redCount={redCount} yellowCount={yellowCount} total={portfolio.length} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {portfolio.map((card, i) => (
          <motion.div
            key={card.propertyId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
          >
            <PropertyCard card={card} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  redCount = 0,
  yellowCount = 0,
  total = 0,
  loading = false,
}: {
  redCount?: number;
  yellowCount?: number;
  total?: number;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Building2 className="h-4 w-4 text-primary/80" />
        <span className="font-semibold text-sm">Portfolio Control Tower</span>
        {!loading && total > 0 && (
          <span className="text-xs text-muted-foreground">{total} properties</span>
        )}
      </div>
      {!loading && (redCount > 0 || yellowCount > 0) && (
        <div className="flex items-center gap-2">
          {redCount > 0 && (
            <Badge variant="outline" className="text-status-red border-status-red/30 bg-status-red/5 text-xs h-5 px-2">
              {redCount} RED
            </Badge>
          )}
          {yellowCount > 0 && (
            <Badge variant="outline" className="text-status-yellow border-status-yellow/30 bg-status-yellow/5 text-xs h-5 px-2">
              {yellowCount} YELLOW
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
