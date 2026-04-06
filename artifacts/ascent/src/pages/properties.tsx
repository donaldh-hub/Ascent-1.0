import { useLocation } from "wouter";
import {
  Building2, Activity, Shield, Zap, BarChart2,
  AlertTriangle, Clock, FileWarning, FileCheck2,
  Hash, ChevronRight, TrendingUp, TrendingDown, Minus,
  Mail, User, ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { usePortfolio, type PropertyPortfolioCard } from "@/hooks/use-portfolio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
  if (dir === "up") return <TrendingUp className="h-3.5 w-3.5 text-status-green" />;
  if (dir === "down") return <TrendingDown className="h-3.5 w-3.5 text-status-red" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function DimBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="h-1 w-full rounded-full bg-border/40 overflow-hidden">
      <motion.div
        className={cn("h-full rounded-full", color)}
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

// ── PropertyCard ──────────────────────────────────────────────────────────────

function PropertyCard({ card }: { card: PropertyPortfolioCard }) {
  const [, navigate] = useLocation();

  const dims = [
    { label: "Flow",    score: card.flowScore,        icon: Activity,  color: "bg-blue-500" },
    { label: "Risk",    score: card.riskScore,         icon: Shield,    color: "bg-status-red" },
    { label: "Execute", score: card.executionScore,    icon: Zap,       color: "bg-violet-500" },
    { label: "Improve", score: card.improvementScore,  icon: BarChart2, color: "bg-emerald-500" },
  ] as const;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "rounded-xl border bg-card flex flex-col overflow-hidden transition-shadow duration-200 hover:shadow-lg group",
        card.stoplight === "red"   ? "border-status-red/25 shadow-sm shadow-status-red/10"
        : card.stoplight === "yellow" ? "border-status-yellow/20"
        : "border-border/50",
      )}
    >
      {/* Clickable top section → Property Control Tower */}
      <button
        onClick={() => navigate(`/properties/${card.propertyId}`)}
        className="flex-1 p-5 text-left cursor-pointer hover:bg-secondary/20 transition-colors"
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "h-9 w-9 rounded-lg border flex items-center justify-center shrink-0",
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

        {/* 4-dimension scores */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {dims.map((d) => (
            <div key={d.label} className="text-center">
              <div className="text-xs text-muted-foreground mb-1">{d.label}</div>
              <div className="font-semibold text-sm tabular-nums">{d.score}</div>
              <div className="mt-1">
                <DimBar score={d.score} color={d.color} />
              </div>
            </div>
          ))}
        </div>

        {/* Signal badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
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

        {/* Documentation signal — corrected to show financial risk */}
        {card.missingDocsCount > 0 ? (
          <div className="flex items-start gap-1.5 text-xs text-status-red mb-2 leading-snug">
            <FileWarning className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Documentation: <span className="font-bold">MISSING</span>
              <span className="text-status-red/80"> (CRITICAL — cannot verify warranty or tenant liability)</span>
            </span>
          </div>
        ) : card.documentCount > 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-status-green mb-2">
            <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
            Documentation: <span className="font-bold ml-1">VERIFIED</span>
            <span className="text-muted-foreground ml-1">· {card.documentCount} on file</span>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 text-xs text-status-yellow mb-2 leading-snug">
            <FileWarning className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Documentation: <span className="font-bold">INCOMPLETE</span>
              <span className="text-status-yellow/80"> — partial coverage, some exposure exists</span>
            </span>
          </div>
        )}

        {/* Insight */}
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 border-t border-border/25 pt-2.5">
          {card.insightSummary}
        </p>

        {/* Control Tower CTA hint */}
        <div className="flex items-center gap-1 text-xs text-primary/60 mt-2 font-medium group-hover:text-primary/90 transition-colors">
          View Control Tower <ChevronRight className="h-3 w-3" />
        </div>
      </button>

      {/* Bottom bar — supervisor + view units */}
      <div className="border-t border-border/30 px-5 py-3 flex items-center justify-between gap-2 bg-secondary/20">
        {card.supervisorName ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground truncate">
              <span className="font-medium text-foreground/80">{card.supervisorName}</span>
              <span className="text-muted-foreground/60 ml-1">· Supervisor</span>
            </span>
          </div>
        ) : (
          <div />
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1 border-border/50 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            window.location.href = `/units?propertyId=${card.propertyId}`;
          }}
        >
          View Units <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </motion.div>
  );
}

// ── Loading skeletons ─────────────────────────────────────────────────────────

function PropertyCardSkeleton() {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="h-8 w-12" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="text-center space-y-1">
            <Skeleton className="h-3 w-10 mx-auto" />
            <Skeleton className="h-4 w-8 mx-auto" />
            <Skeleton className="h-1 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Properties() {
  const { data: portfolio, isLoading } = usePortfolio();

  const redCount    = portfolio?.filter((p) => p.stoplight === "red").length ?? 0;
  const yellowCount = portfolio?.filter((p) => p.stoplight === "yellow").length ?? 0;
  const greenCount  = portfolio?.filter((p) => p.stoplight === "green").length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full pb-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {isLoading
              ? "Loading property intelligence..."
              : `${portfolio?.length ?? 0} propert${(portfolio?.length ?? 0) !== 1 ? "ies" : "y"} · click a card to open Control Tower`}
          </p>
        </div>
        {!isLoading && portfolio && portfolio.length > 0 && (
          <div className="flex items-center gap-2">
            {redCount > 0 && (
              <Badge variant="outline" className="border-status-red/40 text-status-red gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-status-red animate-pulse" />
                {redCount} RED
              </Badge>
            )}
            {yellowCount > 0 && (
              <Badge variant="outline" className="border-status-yellow/40 text-status-yellow gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-status-yellow" />
                {yellowCount} YELLOW
              </Badge>
            )}
            {greenCount > 0 && (
              <Badge variant="outline" className="border-status-green/40 text-status-green gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-status-green" />
                {greenCount} GREEN
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5].map((i) => <PropertyCardSkeleton key={i} />)}
        </div>
      ) : !portfolio || portfolio.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <Building2 className="h-10 w-10 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h3 className="font-semibold text-lg mb-2">No properties with data yet</h3>
          <p className="text-sm text-muted-foreground">Properties with linked assets will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {portfolio.map((card) => (
            <PropertyCard key={card.propertyId} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
