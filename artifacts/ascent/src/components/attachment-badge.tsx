/**
 * Phase 1 – Build 6.6: Signal Strength + Language Layer
 *
 * Reusable evidence signal components.
 * All copy comes from evidence-language.ts — never hardcode text here.
 *
 *  AttachmentBadge       — inline compound badge (all states)
 *  EvidenceBadge         — semantic badge driven by count + isCritical
 *  EvidenceWarningLabel  — standalone "⚠ Missing documentation" pill
 *  AttachmentCountBadge  — standalone "📎 {count}" pill
 *  EvidenceSummary       — top-of-panel evidence overview with thumbnails
 */

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useListDocuments } from "@workspace/api-client-react";
import {
  EVIDENCE,
  getEvidenceState,
  type EvidenceState,
} from "@/lib/evidence-language";

// ─── EvidenceWarningLabel ─────────────────────────────────────────────────────
// "⚠ Missing documentation" — amber pill

interface EvidenceWarningLabelProps {
  className?: string;
  compact?: boolean;
}

export function EvidenceWarningLabel({
  className,
  compact = false,
}: EvidenceWarningLabelProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded",
        compact
          ? "text-[10px] px-1 py-0.5"
          : "text-[10px] px-1.5 py-0.5",
        "bg-amber-500/10 text-amber-400 border border-amber-500/20",
        className
      )}
      title="No supporting documentation attached"
    >
      <AlertTriangle className="h-3 w-3 shrink-0" />
      {EVIDENCE.MISSING_CRITICAL}
    </span>
  );
}

// ─── AttachmentCountBadge ─────────────────────────────────────────────────────
// "📎 {count}" — blue solid pill

interface AttachmentCountBadgeProps {
  count: number;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}

export function AttachmentCountBadge({
  count,
  onClick,
  className,
}: AttachmentCountBadgeProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={cn(
        "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded cursor-pointer",
        "bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors",
        className
      )}
      title={EVIDENCE.DOCS_ATTACHED(count)}
    >
      {EVIDENCE.DOCS(count)}
    </button>
  );
}

// ─── EvidenceBadge ────────────────────────────────────────────────────────────
// Picks the right variant based on count + isCritical

interface EvidenceBadgeProps {
  count: number;
  isCritical?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  showMissingLabel?: boolean;
}

export function EvidenceBadge({
  count,
  isCritical = false,
  onClick,
  className,
  showMissingLabel = false,
}: EvidenceBadgeProps) {
  const state: EvidenceState = getEvidenceState(count, isCritical);

  if (state === "missing_critical") {
    return <EvidenceWarningLabel className={className} />;
  }

  if (state === "has_docs") {
    return (
      <AttachmentCountBadge count={count} onClick={onClick} className={className} />
    );
  }

  // state === "missing" (non-critical)
  if (showMissingLabel) {
    return (
      <span
        className={cn("text-xs text-muted-foreground/50", className)}
        title="No documents attached"
      >
        {EVIDENCE.MISSING}
      </span>
    );
  }

  // Compact: just a hollow paperclip icon with no text
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={cn(
        "inline-flex items-center text-xs text-muted-foreground/35",
        "hover:text-muted-foreground/60 transition-colors cursor-pointer",
        className
      )}
      title={EVIDENCE.MISSING}
    >
      📎
    </button>
  );
}

// ─── AttachmentBadge ──────────────────────────────────────────────────────────
// Backwards-compatible compound badge (used on ItemCards)
// Delegates to EvidenceBadge internally.

interface AttachmentBadgeProps {
  count: number;
  onClick?: (e: React.MouseEvent) => void;
  showWarning?: boolean;
  className?: string;
}

export function AttachmentBadge({
  count,
  onClick,
  showWarning = false,
  className,
}: AttachmentBadgeProps) {
  return (
    <EvidenceBadge
      count={count}
      isCritical={showWarning}
      onClick={onClick}
      className={className}
    />
  );
}

// ─── EvidenceSummary ──────────────────────────────────────────────────────────
// Top-of-panel evidence overview with count, thumbnails, last-added time

interface EvidenceSummaryProps {
  entityType: string;
  entityId: number;
  workflowId?: number;
  onViewAll?: () => void;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function EvidenceSummary({
  entityType,
  entityId,
  workflowId,
  onViewAll,
}: EvidenceSummaryProps) {
  const { data: docs = [], isLoading } = useListDocuments(
    {
      entityType,
      entityId: String(entityId),
      ...(workflowId ? { workflowId: String(workflowId) } : {}),
    } as any,
    { query: { queryKey: ["docs", entityType, entityId] } }
  );

  const count = docs.length;
  const imageDocs = docs
    .filter((d) => (d.fileType ?? "").startsWith("image/"))
    .slice(0, 3);
  const latestDoc = [...docs].sort(
    (a, b) =>
      new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime()
  )[0];

  if (isLoading) {
    return <Skeleton className="h-14 w-full rounded-lg" />;
  }

  const state: EvidenceState = getEvidenceState(count, false);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm",
              count > 0 ? "text-blue-400" : "text-muted-foreground/40"
            )}
          >
            📎
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Evidence
          </span>
          <span
            className={cn(
              "text-xs font-bold",
              count > 0 ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {count > 0 ? EVIDENCE.DOCS_VERBOSE(count) : EVIDENCE.MISSING}
          </span>
        </div>
        {count > 0 && onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[11px] text-primary hover:underline cursor-pointer"
          >
            View all
          </button>
        )}
      </div>

      {state === "missing" ? (
        <p className="text-[11px] text-muted-foreground mt-1.5 italic">
          No documents attached yet.
        </p>
      ) : (
        <div className="flex items-center gap-2 mt-2">
          {imageDocs.map((doc) => (
            <img
              key={doc.id}
              src={`/api/storage${doc.objectPath}`}
              alt={doc.fileName}
              className="h-9 w-9 rounded object-cover border border-border shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ))}
          {count > imageDocs.length && imageDocs.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              +{count - imageDocs.length} more
            </span>
          )}
          {latestDoc?.uploadedAt && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              Last: {timeAgo(new Date(latestDoc.uploadedAt))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
