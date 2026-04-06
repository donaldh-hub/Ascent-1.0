/**
 * Property Control Tower
 * Per-property health view — reuses portfolio data, scoped to one property.
 * Clickable dimension cards with full diagnostic reveal (mirrors main Control Tower).
 */

import type React from "react";
import { useLocation } from "wouter";
import {
  Building2, ArrowLeft, Activity, Shield, Zap, BarChart2,
  AlertTriangle, Clock, FileWarning, FileCheck2, Hash,
  TrendingUp, TrendingDown, Minus, Mail, Copy, CheckCircle2,
  User, ArrowRight, Layers, ChevronDown, X, ShieldAlert,
  Package, Target, Workflow,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePortfolio, type PropertyPortfolioCard } from "@/hooks/use-portfolio";
import { useListUnits } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DrillDownSheet, ClickableSignal } from "@/components/drill-down-sheet";
import type { SignalType } from "@/hooks/use-signal-drill";

// ── Types ─────────────────────────────────────────────────────────────────────

type MetricKey = "flow" | "risk" | "execution" | "improvement";

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

function severityLabel(value: number, type: "score" | "count" | "age" | "coverage"): string {
  if (type === "score") {
    if (value < 40) return "CRITICAL";
    if (value < 60) return "SEVERE";
    if (value < 75) return "HIGH";
    if (value < 88) return "MODERATE";
    return "LOW";
  }
  if (type === "age") {
    if (value > 200) return "SEVERE — systemic slowdown";
    if (value > 90)  return "HIGH — escalation required";
    if (value > 30)  return "MODERATE — review needed";
    return "LOW";
  }
  if (type === "coverage") {
    if (value < 50) return "CRITICAL — high exposure";
    if (value < 75) return "HIGH — gaps detected";
    if (value < 90) return "MODERATE";
    return "GOOD";
  }
  // count
  if (value === 0) return "CLEAR";
  if (value > 20) return "SEVERE";
  if (value > 10) return "HIGH";
  if (value > 5)  return "MODERATE";
  return "LOW";
}

// ── Documentation status helper (corrected to show financial risk) ─────────────

function docStatus(card: PropertyPortfolioCard): {
  level: "red" | "yellow" | "green";
  label: string;
  detail: string;
} {
  if (card.missingDocsCount > 0) {
    return {
      level: "red",
      label: "MISSING",
      detail: `CRITICAL — cannot verify warranty or tenant liability on ${card.missingDocsCount} critical asset${card.missingDocsCount !== 1 ? "s" : ""}`,
    };
  }
  if (card.documentCount === 0) {
    return {
      level: "yellow",
      label: "INCOMPLETE",
      detail: "Partial coverage — some exposure exists, unable to fully verify warranty status",
    };
  }
  return {
    level: "green",
    label: "VERIFIED",
    detail: `${card.documentCount} document${card.documentCount !== 1 ? "s" : ""} on file — warranty and tenant liability verifiable`,
  };
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

// ── Reveal card shell ──────────────────────────────────────────────────────────

function RevealCard({ label, icon: Icon, children }: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-background/70 border border-border/40 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      {children}
    </div>
  );
}

// ── Per-metric reveal content (scoped to this property) ───────────────────────

function FlowReveal({ card }: { card: PropertyPortfolioCard }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <RevealCard label="Top Bottleneck" icon={Activity}>
        <p className="font-semibold text-sm">{card.topBottleneck}</p>
        {card.bottleneckAging > 0 && (
          <div className="mt-1.5 space-y-0.5">
            <p className="text-xs">
              <span className="text-status-red font-semibold">{card.bottleneckAging}d</span>
              <span className="text-muted-foreground ml-1">aging</span>
            </p>
            <p className="text-[10px] font-bold uppercase text-status-red/80 tracking-wide">
              {severityLabel(card.bottleneckAging, "age")}
            </p>
          </div>
        )}
      </RevealCard>

      <RevealCard label="Asset Exposure" icon={Package}>
        <p className="text-2xl font-bold tabular-nums">
          {card.atRiskAssets}
          <span className="text-sm font-normal text-muted-foreground ml-1">/ {card.totalAssets}</span>
        </p>
        <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">
          {severityLabel(card.atRiskAssets, "count")} — expired warranty
        </p>
        <p className="text-xs text-muted-foreground mt-1">assets with expired warranty contributing to bottleneck</p>
      </RevealCard>

      <RevealCard label="Unit Coverage" icon={Layers}>
        <p className="text-2xl font-bold tabular-nums">{card.unitCoverage}%</p>
        <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">
          {severityLabel(card.unitCoverage, "coverage")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">of units have active asset coverage</p>
      </RevealCard>
    </div>
  );
}

function RiskReveal({ card }: { card: PropertyPortfolioCard }) {
  const doc = docStatus(card);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <RevealCard label="Critical Items" icon={ShieldAlert}>
        <p className="text-2xl font-bold text-status-red tabular-nums">{card.criticalItemsCount}</p>
        <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">
          {severityLabel(card.criticalItemsCount, "count")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">open critical-priority items at this property</p>
      </RevealCard>

      <RevealCard label="Expired Warranty" icon={Clock}>
        <p className="text-2xl font-bold text-status-yellow tabular-nums">{card.atRiskAssets}</p>
        <p className="text-[10px] font-bold uppercase text-status-yellow/80 mt-0.5 tracking-wide">
          {severityLabel(card.atRiskAssets, "count")} — expired
        </p>
        <p className="text-xs text-muted-foreground mt-1">assets past warranty expiry</p>
        {card.expiringSoonAssets > 0 && (
          <p className="text-xs text-status-yellow/80 mt-1.5">
            +{card.expiringSoonAssets} expiring within 90 days
          </p>
        )}
      </RevealCard>

      <RevealCard label="Documentation Risk" icon={doc.level === "red" ? FileWarning : FileCheck2}>
        <p className={cn(
          "text-sm font-bold tracking-wide",
          doc.level === "red" ? "text-status-red"
          : doc.level === "yellow" ? "text-status-yellow"
          : "text-status-green"
        )}>
          {doc.label}
        </p>
        <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
          Documentation: {doc.label} ({doc.detail})
        </p>
      </RevealCard>
    </div>
  );
}

function ExecutionReveal({ card }: { card: PropertyPortfolioCard }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <RevealCard label="Execution Score" icon={Target}>
        <p className="text-2xl font-bold tabular-nums">{card.executionScore}</p>
        <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">
          {severityLabel(100 - card.executionScore, "score")} pressure
        </p>
        <p className="text-xs text-muted-foreground mt-1">completion rate and response effectiveness</p>
      </RevealCard>

      <RevealCard label="Critical Backlog" icon={AlertTriangle}>
        <p className="text-2xl font-bold tabular-nums">{card.criticalItemsCount}</p>
        <p className="text-[10px] font-bold uppercase text-status-red/80 mt-0.5 tracking-wide">
          {severityLabel(card.criticalItemsCount, "count")} backlog
        </p>
        <p className="text-xs text-muted-foreground mt-1">unresolved critical items reducing execution capacity</p>
      </RevealCard>

      <RevealCard label="Bottleneck Stage" icon={Workflow}>
        <p className="font-semibold text-sm">{card.topBottleneck}</p>
        {card.bottleneckAging > 0 && (
          <>
            <p className="text-xs text-muted-foreground mt-1">longest aging: <span className="text-status-yellow font-medium">{card.bottleneckAging}d</span></p>
          </>
        )}
        <p className="text-xs text-muted-foreground mt-1 leading-snug">primary stage slowing execution throughput</p>
      </RevealCard>
    </div>
  );
}

function ImprovementReveal({ card }: { card: PropertyPortfolioCard }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <RevealCard label="Trend Direction" icon={TrendingUp}>
        <div className="flex items-center gap-2 mb-1">
          {card.trendDirection === "up" ? (
            <TrendingUp className="h-5 w-5 text-status-green" />
          ) : card.trendDirection === "down" ? (
            <TrendingDown className="h-5 w-5 text-status-red" />
          ) : (
            <Minus className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="font-semibold text-sm capitalize">{card.trendDirection}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          {card.trendDirection === "up"
            ? "Property health is improving — maintain momentum"
            : card.trendDirection === "down"
            ? "Health declining — address critical items to reverse"
            : "Stable performance — push near-complete items to completion"}
        </p>
      </RevealCard>

      <RevealCard label="Recovery Signal" icon={Activity}>
        <p className="text-2xl font-bold tabular-nums">{card.improvementScore}</p>
        <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5 tracking-wide">
          {severityLabel(100 - card.improvementScore, "score")} recovery drag
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {card.improvementScore >= 80
            ? "Strong recovery momentum at this property"
            : "Recovery below target — review asset expiry backlog"}
        </p>
      </RevealCard>

      <RevealCard label="Expiry Outlook" icon={Clock}>
        <p className="text-2xl font-bold tabular-nums text-status-yellow">{card.expiringSoonAssets}</p>
        <p className="text-[10px] font-bold uppercase text-status-yellow/80 mt-0.5 tracking-wide">
          expiring in 90 days
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {card.expiringSoonAssets > 0
            ? "Address before expiry to prevent risk score from falling"
            : "No near-term expirations — good recovery window"}
        </p>
      </RevealCard>
    </div>
  );
}

// ── Property Metric Reveal Section ────────────────────────────────────────────

function PropertyMetricRevealSection({
  metric,
  card,
  onClose,
}: {
  metric: MetricKey;
  card: PropertyPortfolioCard;
  onClose: () => void;
}) {
  const doc = docStatus(card);

  const config: Record<MetricKey, {
    title: string;
    accentClass: string;
    borderClass: string;
    bgClass: string;
    headerColor: string;
  }> = {
    flow: {
      title: "FLOW — Why Movement is Constrained",
      accentClass: "bg-blue-500",
      borderClass: "border-blue-500/50",
      bgClass: "bg-blue-500/5",
      headerColor: "text-blue-400",
    },
    risk: {
      title: "RISK — Why Exposure is Elevated",
      accentClass: "bg-red-500",
      borderClass: "border-red-500/50",
      bgClass: "bg-red-500/5",
      headerColor: "text-red-400",
    },
    execution: {
      title: "EXECUTION — Why Progress is Low",
      accentClass: "bg-violet-500",
      borderClass: "border-violet-500/50",
      bgClass: "bg-violet-500/5",
      headerColor: "text-violet-400",
    },
    improvement: {
      title: "IMPROVEMENT — Trend Analysis",
      accentClass: "bg-emerald-500",
      borderClass: "border-emerald-500/50",
      bgClass: "bg-emerald-500/5",
      headerColor: "text-emerald-400",
    },
  };

  const cfg = config[metric];

  // ── PRIMARY CAUSE (derived from property data) ──
  let primaryCause = "";
  let recommendedAction = "";

  if (metric === "flow") {
    if (card.bottleneckAging > 0) {
      primaryCause = `${card.atRiskAssets} expired-warranty assets creating "${card.topBottleneck}" bottleneck — ${card.bottleneckAging}d max age accumulating`;
    } else {
      primaryCause = `"${card.topBottleneck}" is the primary flow constraint — ${card.atRiskAssets} expired assets contributing to slowdown`;
    }
    recommendedAction = `Escalate the "${card.topBottleneck}" stage at ${card.propertyName} — address the ${Math.min(card.atRiskAssets, 5)} highest-priority expired-warranty assets first to restore flow`;
  } else if (metric === "risk") {
    if (card.missingDocsCount > 0) {
      primaryCause = `Missing documentation on ${card.missingDocsCount} critical asset${card.missingDocsCount !== 1 ? "s" : ""} — unable to verify warranty or tenant liability`;
    } else {
      primaryCause = `${card.atRiskAssets} assets with expired warranty — ${card.criticalItemsCount} critical items open at ${card.propertyName}`;
    }
    if (card.missingDocsCount > 0) {
      recommendedAction = `Address documentation gaps first — upload warranty and service records for ${card.missingDocsCount} critical asset${card.missingDocsCount !== 1 ? "s" : ""} to restore liability coverage`;
    } else {
      recommendedAction = `Review ${card.atRiskAssets} expired-warranty assets and initiate renewal for the highest-risk items — prioritize ${card.criticalItemsCount} critical items`;
    }
  } else if (metric === "execution") {
    primaryCause = `${card.executionScore}/100 execution score at ${card.propertyName} — ${card.criticalItemsCount} critical items and "${card.topBottleneck}" stage creating completion drag`;
    recommendedAction = `Assign ownership to all open items — resolve "${card.topBottleneck}" stage congestion and clear ${card.criticalItemsCount} critical backlog items`;
  } else if (metric === "improvement") {
    const trendText = card.trendDirection === "down" ? "declining" : card.trendDirection === "up" ? "improving" : "stable";
    primaryCause = `${card.propertyName} trend is ${trendText} (${card.improvementScore}/100 improvement score) — ${card.expiringSoonAssets} assets expiring in 90 days represent forward risk`;
    if (card.trendDirection === "down") {
      recommendedAction = "Prioritize clearing the critical backlog to reverse declining trend — complete near-ready items and address expiring assets before they become failures";
    } else if (card.trendDirection === "stable") {
      recommendedAction = "Push 2–3 near-complete items to resolution and renew expiring warranties to build positive momentum";
    } else {
      recommendedAction = "Maintain current momentum — lock in gains by addressing expiring warranties before they impact future scores";
    }
  }

  // Insight text based on metric
  const insightText = metric === "risk" && card.missingDocsCount > 0
    ? `Documentation: MISSING (CRITICAL — cannot verify warranty or tenant liability). ${card.insightSummary}`
    : card.insightSummary;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
      className={cn("rounded-xl border-2 overflow-hidden shadow-md", cfg.borderClass, cfg.bgClass)}
    >
      <div className={cn("h-1 w-full", cfg.accentClass)} />
      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className={cn("text-sm font-bold tracking-wide", cfg.headerColor)}>
            {cfg.title}
          </h3>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 border border-border/40 rounded-md px-2 py-1 shrink-0 ml-4"
          >
            <X className="h-3 w-3" /> Close
          </button>
        </div>

        {/* PRIMARY CAUSE */}
        <div className={cn(
          "rounded-lg border px-4 py-3 flex items-start gap-3",
          cfg.borderClass.replace("/50", "/30"),
          "bg-background/70",
        )}>
          <div className="shrink-0 mt-0.5">
            <div className={cn("w-2 h-2 rounded-full mt-1", cfg.accentClass)} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
              Primary Cause
            </p>
            <p className="text-sm font-semibold text-foreground leading-snug">{primaryCause}</p>
          </div>
        </div>

        {/* Insight context */}
        <div className="rounded-lg bg-background/50 border border-border/25 px-4 py-2.5">
          <p className="text-xs text-muted-foreground leading-relaxed">{insightText}</p>
        </div>

        {/* Per-metric reveal rows */}
        {metric === "flow" && <FlowReveal card={card} />}
        {metric === "risk" && <RiskReveal card={card} />}
        {metric === "execution" && <ExecutionReveal card={card} />}
        {metric === "improvement" && <ImprovementReveal card={card} />}

        {/* RECOMMENDED ACTION */}
        {recommendedAction && (
          <div className="rounded-lg bg-background/80 border border-border/50 px-4 py-3 flex items-start gap-3">
            <Zap className={cn("h-4 w-4 shrink-0 mt-0.5", cfg.headerColor)} />
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
                Recommended Action
              </p>
              <p className="text-sm text-foreground/90 leading-snug">{recommendedAction}</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Clickable dimension card ───────────────────────────────────────────────────

function DimCard({
  metricKey,
  label,
  score,
  icon: Icon,
  colorClass,
  barColor,
  desc,
  isActive,
  onClick,
}: {
  metricKey: MetricKey;
  label: string;
  score: number;
  icon: React.ElementType;
  colorClass: string;
  barColor: string;
  desc: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-card p-4 text-left w-full cursor-pointer transition-all duration-200 select-none",
        isActive
          ? "border-primary/60 ring-1 ring-primary/20 shadow-md"
          : "border-border/40 hover:border-primary/40 hover:shadow-md",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded-md bg-muted/50", colorClass)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            {label}
          </span>
        </div>
        <span className={cn(
          "transition-transform duration-200",
          isActive ? "rotate-180" : "rotate-0",
        )}>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </div>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-3xl font-bold tabular-nums">{score}</span>
        <span className="text-sm text-muted-foreground">/100</span>
      </div>
      <ScoreBar score={score} color={barColor} />
      <p className="text-[10px] text-muted-foreground mt-1.5">{desc}</p>
      {!isActive && (
        <p className="text-[10px] text-primary/50 mt-2 font-medium">Click to reveal drivers →</p>
      )}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 rounded-b pointer-events-none" />
      )}
    </button>
  );
}

// ── Supervisor block ──────────────────────────────────────────────────────────

function SupervisorBlock({ card }: { card: PropertyPortfolioCard }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const doc = docStatus(card);

  const subject = encodeURIComponent(`${card.propertyName} — ${card.topBottleneck} / Risk Alert`);
  const body = encodeURIComponent(
    `Hi ${card.supervisorName ?? "Supervisor"},\n\n` +
    `I'm reaching out regarding ${card.propertyName}.\n\n` +
    `Current Status: ${card.healthScore}/100 (${card.stoplight.toUpperCase()})\n` +
    `Active Risk: ${card.atRiskAssets} assets with expired warranty\n` +
    `Critical Alerts: ${card.criticalItemsCount}\n` +
    `Documentation: ${doc.label} (${doc.detail})\n\n` +
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

type DrillState = { signal: SignalType; propertyId?: number } | null;

function PropertyControlTower({ card, propertyId }: { card: PropertyPortfolioCard; propertyId: number }) {
  const [, navigate] = useLocation();
  const { data: allUnits = [] } = useListUnits({});
  const propertyUnits = allUnits.filter((u) => u.propertyId === propertyId);
  const [activeMetric, setActiveMetric] = useState<MetricKey | null>(null);
  const [drillState, setDrillState] = useState<DrillState>(null);

  const doc = docStatus(card);

  function toggleMetric(key: MetricKey) {
    setActiveMetric((prev) => (prev === key ? null : key));
  }

  function openDrill(signal: SignalType, scoped = true) {
    setDrillState({ signal, propertyId: scoped ? propertyId : undefined });
  }

  function closeDrill() {
    setDrillState(null);
  }

  const dimCards = [
    { key: "flow"        as MetricKey, label: "Flow",        score: card.flowScore,        icon: Activity,  colorClass: "text-blue-400",    barColor: "bg-blue-500",    desc: "Stage movement & throughput" },
    { key: "risk"        as MetricKey, label: "Risk",        score: card.riskScore,        icon: Shield,    colorClass: "text-red-400",     barColor: "bg-status-red",  desc: "Asset exposure & critical items" },
    { key: "execution"   as MetricKey, label: "Execution",   score: card.executionScore,   icon: Zap,       colorClass: "text-violet-400",  barColor: "bg-violet-500",  desc: "Completion rate & responsiveness" },
    { key: "improvement" as MetricKey, label: "Improvement", score: card.improvementScore, icon: BarChart2, colorClass: "text-emerald-400", barColor: "bg-emerald-500", desc: "Recovery trend & momentum" },
  ] as const;

  return (
    <>
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

      {/* Top row: gauge + 4 dimension score cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Gauge card */}
        <div className="rounded-xl border border-border/50 bg-card p-5 flex flex-col items-center justify-center">
          <HealthGauge card={card} />
          <p className="text-xs text-muted-foreground mt-3 text-center leading-relaxed line-clamp-3">
            {card.insightSummary}
          </p>
          {/* Driven-by block */}
          <div className="mt-4 w-full rounded-lg bg-secondary/50 border border-border/40 px-3 py-3 text-left">
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
              Driven By
            </p>
            <ul className="space-y-1.5">
              <li className="flex items-start gap-2 text-xs">
                <span className="text-status-red font-bold mt-0.5">•</span>
                <span className="text-foreground/80">
                  <span className="font-semibold text-status-red">{card.atRiskAssets} expired warranty</span>
                  <span className="text-muted-foreground"> assets</span>
                </span>
              </li>
              {card.criticalItemsCount > 0 && (
                <li className="flex items-start gap-2 text-xs">
                  <span className="text-status-red font-bold mt-0.5">•</span>
                  <span className="text-foreground/80">
                    <span className="font-semibold text-status-red">{card.criticalItemsCount} critical items</span>
                    <span className="text-muted-foreground"> open</span>
                  </span>
                </li>
              )}
              <li className="flex items-start gap-2 text-xs">
                <span className="text-status-yellow font-bold mt-0.5">•</span>
                <span className="text-foreground/80">
                  <span className="font-semibold text-status-yellow">{card.topBottleneck}</span>
                  <span className="text-muted-foreground">
                    {card.bottleneckAging > 0 ? ` (${card.bottleneckAging}d aging)` : " bottleneck"}
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Clickable dimension cards */}
        <div className="md:col-span-2 grid grid-cols-2 gap-3">
          {dimCards.map((d) => (
            <div key={d.key} className="relative">
              <DimCard
                metricKey={d.key}
                label={d.label}
                score={d.score}
                icon={d.icon}
                colorClass={d.colorClass}
                barColor={d.barColor}
                desc={d.desc}
                isActive={activeMetric === d.key}
                onClick={() => toggleMetric(d.key)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Inline metric reveal section */}
      <AnimatePresence initial={false}>
        {activeMetric && (
          <PropertyMetricRevealSection
            key={activeMetric}
            metric={activeMetric}
            card={card}
            onClose={() => setActiveMetric(null)}
          />
        )}
      </AnimatePresence>

      {/* Asset health row */}
      <div className="rounded-xl border border-border/50 bg-card p-5">
        <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-4">
          Asset Health
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center">
              <div className="text-xl font-bold tabular-nums text-foreground">{card.totalAssets}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Assets</div>
            </div>

            <ClickableSignal
              onClick={() => openDrill("expired_warranty")}
              className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center w-full block"
              disabled={card.atRiskAssets === 0}
              title="View expired warranty assets"
            >
              <div className={cn("text-xl font-bold tabular-nums flex items-baseline justify-center gap-1", card.atRiskAssets > 0 ? "text-status-red" : "text-foreground")}>
                {card.atRiskAssets}
                {card.atRiskAssets > 0 && <span className="text-[11px] text-primary/50">↗</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Expired Warranty</div>
              {card.expiredWarrantyCost != null && card.atRiskAssets > 0 && (
                <div className="text-[10px] font-semibold text-status-red/70 mt-1 tabular-nums">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(card.expiredWarrantyCost)} exposure
                </div>
              )}
            </ClickableSignal>

            <ClickableSignal
              onClick={() => openDrill("expiring_soon")}
              className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center w-full block"
              disabled={card.expiringSoonAssets === 0}
              title="View assets expiring soon"
            >
              <div className={cn("text-xl font-bold tabular-nums flex items-baseline justify-center gap-1", card.expiringSoonAssets > 0 ? "text-status-yellow" : "text-foreground")}>
                {card.expiringSoonAssets}
                {card.expiringSoonAssets > 0 && <span className="text-[11px] text-primary/50">↗</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Expiring (90d)</div>
              {card.expiringSoonCost != null && card.expiringSoonAssets > 0 && (
                <div className="text-[10px] font-semibold text-status-yellow/70 mt-1 tabular-nums">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(card.expiringSoonCost)} at risk
                </div>
              )}
            </ClickableSignal>

            <div className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center">
              <div className="text-xl font-bold tabular-nums text-foreground">{card.unitCoverage}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">Unit Coverage</div>
            </div>
        </div>
      </div>

      {/* Financial Intelligence */}
      {(card.totalAssetCost != null || card.expiredWarrantyCost != null || card.expiringSoonCost != null) && (
        <div className="rounded-xl border border-border/50 bg-card p-5">
          <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-4">
            Financial Intelligence
          </p>
          <div className="grid grid-cols-3 gap-4">
            {card.totalAssetCost != null && (
              <div className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center">
                <div className="text-lg font-bold tabular-nums text-foreground">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(card.totalAssetCost)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Total Asset Value</div>
              </div>
            )}
            {card.expiredWarrantyCost != null ? (
              <ClickableSignal
                onClick={() => openDrill("expired_warranty")}
                className="rounded-lg bg-secondary/30 border border-red-500/20 px-3 py-3 text-center w-full block"
                title="View expired warranty assets"
              >
                <div className="text-lg font-bold tabular-nums text-status-red">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(card.expiredWarrantyCost)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  Expired Exposure <span className="text-[10px] text-primary/50">↗</span>
                </div>
              </ClickableSignal>
            ) : (
              <div className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center">
                <div className="text-lg font-bold tabular-nums text-muted-foreground">—</div>
                <div className="text-xs text-muted-foreground mt-0.5">Expired Exposure</div>
              </div>
            )}
            {card.expiringSoonCost != null ? (
              <ClickableSignal
                onClick={() => openDrill("expiring_soon")}
                className="rounded-lg bg-secondary/30 border border-yellow-500/20 px-3 py-3 text-center w-full block"
                title="View assets expiring soon"
              >
                <div className="text-lg font-bold tabular-nums text-status-yellow">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(card.expiringSoonCost)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  90d Risk <span className="text-[10px] text-primary/50">↗</span>
                </div>
              </ClickableSignal>
            ) : (
              <div className="rounded-lg bg-secondary/30 border border-border/30 px-3 py-3 text-center">
                <div className="text-lg font-bold tabular-nums text-muted-foreground">—</div>
                <div className="text-xs text-muted-foreground mt-0.5">90d Risk</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Signals + supervisor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Operational signals with corrected doc risk */}
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
              <ClickableSignal
                onClick={() => openDrill("critical_items", false)}
                className="px-1.5 py-0.5 rounded"
                disabled={card.criticalItemsCount === 0}
                title="View critical items"
              >
                <span className={cn("font-semibold tabular-nums flex items-center gap-0.5", card.criticalItemsCount > 0 ? "text-status-red" : "text-foreground")}>
                  {card.criticalItemsCount}
                  {card.criticalItemsCount > 0 && <span className="text-[10px] text-primary/50">↗</span>}
                </span>
              </ClickableSignal>
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

            {/* Corrected documentation signal */}
            <div className="border-t border-border/20 pt-3 mt-1">
              <div className="flex items-start justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                  {doc.level === "red"
                    ? <FileWarning className="h-4 w-4 shrink-0 text-status-red" />
                    : doc.level === "yellow"
                    ? <FileWarning className="h-4 w-4 shrink-0 text-status-yellow" />
                    : <FileCheck2 className="h-4 w-4 shrink-0 text-status-green" />}
                  <span>Documentation</span>
                </div>
                <div className="text-right">
                  <span className={cn(
                    "font-bold text-xs uppercase tracking-wide",
                    doc.level === "red" ? "text-status-red"
                    : doc.level === "yellow" ? "text-status-yellow"
                    : "text-status-green",
                  )}>
                    {doc.label}
                  </span>
                  <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px] leading-snug text-right">
                    {doc.detail}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Supervisor outreach */}
        <SupervisorBlock card={card} />
      </div>
    </div>

    {/* Drill-down panel */}
    {drillState && (
      <DrillDownSheet
        signal={drillState.signal}
        propertyId={drillState.propertyId}
        onClose={closeDrill}
      />
    )}
    </>
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
