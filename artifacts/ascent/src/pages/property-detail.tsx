/**
 * Property Control Tower
 * Per-property health view — reuses portfolio data, scoped to one property.
 */

import { useLocation } from "wouter";
import {
  Building2, ArrowLeft, Activity, Shield, Zap, BarChart2,
  AlertTriangle, Clock, FileWarning, FileCheck2, Hash,
  TrendingUp, TrendingDown, Minus, Mail, Copy, CheckCircle2,
  User, ArrowRight, Server, Layers,
} from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePortfolio, type PropertyPortfolioCard } from "@/hooks/use-portfolio";
import { useListUnits } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stoplightColor(s: "green" | "yellow" | "red") {
  return s === "green" ? "text-status-green"
    : s === "yellow" ? "text-status-yellow"
    : "text-status-red";
}

function stoplightBg(s: "green" | "yellow" | "red") {
  return s === "green" ? "bg-status-green/10 border-status-green/30"
    : s === "yellow" ? "bg-status-yellow/10 border-status-yellow/30"
    : "bg-status-red/10 border-status-red/30";
}

function stoplightDot(s: "green" | "yellow" | "red") {
  return s === "green" ? "bg-status-green"
    : s === "yellow" ? "bg-status-yellow animate-pulse"
    : "bg-status-red animate-pulse";
}

function TrendIcon({ dir }: { dir: "up" | "down" | "stable" }) {
  if (dir === "up") return <TrendingUp className="h-4 w-4 text-status-green" />;
  if (dir === "down") return <TrendingDown className="h-4 w-4 text-status-red" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-border/40 overflow-hidden">
      <motion.div
        className={cn("h-full rounded-full", color)}
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}

// ── Health gauge ──────────────────────────────────────────────────────────────

function HealthGauge({ card }: { card: PropertyPortfolioCard }) {
  const color = card.stoplight === "red" ? "#ef4444"
    : card.stoplight === "yellow" ? "#eab308"
    : "#22c55e";

  const r = 64;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - card.healthScore / 100);

  return (
    <div className="flex items-center justify-center">
      <div className="relative flex items-center justify-center">
        <svg width="160" height="160" className="-rotate-90">
          <circle cx="80" cy="80" r={r} stroke="#374151" strokeWidth="8" fill="transparent" strokeDasharray={circ} />
          <circle
            cx="80" cy="80" r={r}
            stroke={color} strokeWidth="8" fill="transparent"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className={cn("text-4xl font-black tabular-nums", stoplightColor(card.stoplight))}>
            {card.healthScore}
          </span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-0.5">
            Health
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Supervisor block ──────────────────────────────────────────────────────────

function SupervisorBlock({ card }: { card: PropertyPortfolioCard }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const subject = encodeURIComponent(`${card.propertyName} — ${card.topBottleneck} / Risk Alert`);
  const body = encodeURIComponent(
    `Hi ${card.supervisorName ?? "Supervisor"},\n\n` +
    `I'm reaching out regarding ${card.propertyName}.\n\n` +
    `Current Status: ${card.healthScore}/100 (${card.stoplight.toUpperCase()})\n` +
    `Active Risk: ${card.atRiskAssets} assets with expired warranty\n` +
    `Critical Alerts: ${card.criticalItemsCount}\n` +
    `Missing Documentation: ${card.missingDocsCount} critical assets\n\n` +
    `Insight: ${card.insightSummary}\n\n` +
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

  if (!card.supervisorName) return null;

  return (
    <div className="rounded-xl border border-border/40 bg-card p-5">
      <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-3">
        Supervisor Outreach
      </p>
      <div className="flex items-center gap-2 mb-4">
        <User className="h-4 w-4 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-semibold">{card.supervisorName}</p>
          {card.supervisorEmail && (
            <p className="text-xs text-muted-foreground">{card.supervisorEmail}</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <a href={mailtoHref} className="flex-1">
          <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10">
            <Mail className="h-3.5 w-3.5" />
            Email Supervisor
          </Button>
        </a>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-border/40" onClick={handleCopy}>
          {copied
            ? <><CheckCircle2 className="h-3.5 w-3.5 text-status-green" /> Copied</>
            : <><Copy className="h-3.5 w-3.5" /> Copy Summary</>}
        </Button>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

function PropertyControlTower({ card, propertyId }: { card: PropertyPortfolioCard; propertyId: number }) {
  const [, navigate] = useLocation();
  const { data: allUnits = [] } = useListUnits({});
  const propertyUnits = allUnits.filter((u) => u.propertyId === propertyId);

  const dims = [
    { label: "Flow",        score: card.flowScore,       icon: Activity,  color: "bg-blue-500",    desc: "Stage movement & throughput" },
    { label: "Risk",        score: card.riskScore,        icon: Shield,    color: "bg-status-red",  desc: "Asset exposure & critical items" },
    { label: "Execution",   score: card.executionScore,   icon: Zap,       color: "bg-violet-500",  desc: "Completion rate & responsiveness" },
    { label: "Improvement", score: card.improvementScore, icon: BarChart2, color: "bg-emerald-500", desc: "Recovery trend & momentum" },
  ] as const;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-8">
      {/* Back + header */}
      <div>
        <button
          onClick={() => navigate("/properties")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All Properties
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className={cn(
              "h-12 w-12 rounded-xl border flex items-center justify-center shrink-0",
              stoplightBg(card.stoplight),
            )}>
              <Building2 className={cn("h-6 w-6", stoplightColor(card.stoplight))} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{card.propertyName}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn("w-2 h-2 rounded-full shrink-0", stoplightDot(card.stoplight))} />
                <span className="text-xs text-muted-foreground capitalize font-medium">{card.stoplight}</span>
                <span className="text-muted-foreground/40">·</span>
                <TrendIcon dir={card.trendDirection} />
                <span className="text-xs text-muted-foreground capitalize">{card.trendDirection}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-xs text-muted-foreground">{propertyUnits.length} units</span>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-border/50"
            onClick={() => window.location.href = `/units?propertyId=${card.propertyId}`}
          >
            <Layers className="h-4 w-4" />
            View {propertyUnits.length} Units
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Top row: gauge + 4 dimensions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Gauge card */}
        <div className="rounded-xl border border-border/50 bg-card p-5 flex flex-col items-center justify-center">
          <HealthGauge card={card} />
          <p className="text-xs text-muted-foreground mt-3 text-center leading-relaxed line-clamp-3">
            {card.insightSummary}
          </p>
        </div>

        {/* Dimension grid */}
        <div className="md:col-span-2 grid grid-cols-2 gap-3">
          {dims.map((d) => (
            <div key={d.label} className="rounded-xl border border-border/40 bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn("p-1.5 rounded-md", d.color.replace("bg-", "bg-") + "/20")}>
                  <d.icon className={cn("h-3.5 w-3.5", d.color.replace("bg-", "text-"))} />
                </div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  {d.label}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-3xl font-bold tabular-nums">{d.score}</span>
                <span className="text-sm text-muted-foreground">/100</span>
              </div>
              <ScoreBar score={d.score} color={d.color} />
              <p className="text-[10px] text-muted-foreground mt-1.5">{d.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Asset health row */}
      <div className="rounded-xl border border-border/50 bg-card p-5">
        <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-4">
          Asset Health
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Assets",      value: card.totalAssets,      color: "text-foreground" },
            { label: "Expired Warranty",  value: card.atRiskAssets,     color: card.atRiskAssets > 0 ? "text-status-red" : "text-foreground" },
            { label: "Expiring (90d)",    value: card.expiringSoonAssets, color: card.expiringSoonAssets > 0 ? "text-status-yellow" : "text-foreground" },
            { label: "Unit Coverage",     value: `${card.unitCoverage}%`, color: "text-foreground" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center">
              <div className={cn("text-xl font-bold tabular-nums", m.color)}>{m.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Signals + bottleneck */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Operational signals */}
        <div className="rounded-xl border border-border/50 bg-card p-5">
          <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-4">
            Operational Signals
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Critical Items</span>
              </div>
              <span className={cn("font-semibold tabular-nums", card.criticalItemsCount > 0 ? "text-status-red" : "text-foreground")}>
                {card.criticalItemsCount}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Hash className="h-4 w-4 shrink-0" />
                <span>Top Bottleneck</span>
              </div>
              <span className="font-medium text-foreground/80 text-xs text-right max-w-[160px] truncate">
                {card.topBottleneck}
              </span>
            </div>
            {card.bottleneckAging > 0 && (
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>Bottleneck Aging</span>
                </div>
                <span className="font-semibold text-status-yellow">{card.bottleneckAging}d</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                {card.missingDocsCount > 0
                  ? <FileWarning className="h-4 w-4 shrink-0 text-status-yellow" />
                  : <FileCheck2 className="h-4 w-4 shrink-0 text-status-green" />}
                <span>Documentation</span>
              </div>
              <span className={cn("font-medium text-xs", card.missingDocsCount > 0 ? "text-status-yellow" : "text-status-green")}>
                {card.missingDocsCount > 0
                  ? `${card.missingDocsCount} missing`
                  : `${card.documentCount} on file`}
              </span>
            </div>
          </div>
        </div>

        {/* Supervisor outreach */}
        <SupervisorBlock card={card} />
      </div>
    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────────────────────

export default function PropertyDetail({ params }: { params: { id: string } }) {
  const propertyId = parseInt(params.id, 10);
  const { data: portfolio, isLoading } = usePortfolio();
  const [, navigate] = useLocation();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-8">
        <div className="space-y-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Skeleton className="h-56 rounded-xl" />
          <div className="md:col-span-2 grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  const card = portfolio?.find((p) => p.propertyId === propertyId);

  if (!card) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Building2 className="h-10 w-10 text-muted-foreground opacity-30" />
        <p className="text-muted-foreground text-sm">Property not found or has no asset data yet.</p>
        <Button variant="outline" onClick={() => navigate("/properties")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Properties
        </Button>
      </div>
    );
  }

  return <PropertyControlTower card={card} propertyId={propertyId} />;
}
