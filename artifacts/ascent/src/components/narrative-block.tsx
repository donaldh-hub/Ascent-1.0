import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import type { TurnNarrative } from "@/lib/turn-narratives";
import { ClickableSignal } from "@/components/drill-down-sheet";

interface NarrativeBlockProps {
  narrative: TurnNarrative;
  onDrill: (signal: string) => void;
  accentColor?: "blue" | "red" | "green" | "purple" | "amber";
  compact?: boolean;
}

const accentConfig = {
  blue:   { border: "border-blue-500/30",   bg: "bg-blue-500/5",   label: "text-blue-400/80",   action: "text-blue-400" },
  red:    { border: "border-red-500/30",     bg: "bg-red-500/5",    label: "text-red-400/80",     action: "text-red-400" },
  green:  { border: "border-green-500/30",   bg: "bg-green-500/5",  label: "text-green-400/80",   action: "text-green-400" },
  purple: { border: "border-purple-500/30",  bg: "bg-purple-500/5", label: "text-purple-400/80",  action: "text-purple-400" },
  amber:  { border: "border-amber-500/30",   bg: "bg-amber-500/5",  label: "text-amber-400/80",   action: "text-amber-400" },
};

export function NarrativeBlock({ narrative, onDrill, accentColor = "amber", compact = false }: NarrativeBlockProps) {
  const c = accentConfig[accentColor];

  const rows: { key: string; label: string; text: string; isAction?: boolean }[] = compact
    ? [
        { key: "what", label: "WHAT", text: narrative.what },
        { key: "action", label: "ACTION", text: narrative.action, isAction: true },
      ]
    : [
        { key: "what",   label: "WHAT",   text: narrative.what },
        { key: "why",    label: "WHY",    text: narrative.why },
        { key: "impact", label: "IMPACT", text: narrative.impact },
        { key: "action", label: "ACTION", text: narrative.action, isAction: true },
      ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border ${c.border} ${c.bg} p-4 space-y-2.5`}
    >
      {rows.map((row) => (
        <div key={row.key} className="flex items-start gap-3">
          <span className={`text-[10px] uppercase tracking-wider font-bold w-14 shrink-0 mt-0.5 ${row.isAction ? c.label : "text-muted-foreground/60"}`}>
            {row.label}
          </span>
          {row.isAction ? (
            <ClickableSignal
              onClick={() => narrative.primaryCount > 0 ? onDrill(narrative.drillSignal) : undefined}
              disabled={narrative.primaryCount === 0}
              className="px-0 py-0 inline"
              title={narrative.primaryCount > 0 ? `View ${narrative.primaryCount} affected turns` : "No turns to drill into"}
            >
              <span className={`text-xs font-semibold ${c.action} leading-snug flex items-center gap-1`}>
                <Zap className="h-3 w-3 shrink-0" />
                {row.text}
                {narrative.primaryCount > 0 && <span className="text-[10px] text-primary/50 ml-0.5">↗</span>}
              </span>
            </ClickableSignal>
          ) : (
            <p className={`text-xs leading-snug ${row.key === "what" ? "font-semibold text-foreground" : "text-foreground/80"}`}>
              {row.text}
            </p>
          )}
        </div>
      ))}
    </motion.div>
  );
}
