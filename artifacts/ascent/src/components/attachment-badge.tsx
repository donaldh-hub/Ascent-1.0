/**
 * Phase 1 – Build 6.5: Evidence Visibility Layer
 *
 * Reusable attachment signal components:
 *   AttachmentBadge — inline paperclip + count or warning
 *   EvidenceSummary — top-of-panel evidence overview with thumbnails
 */

import { Paperclip, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useListDocuments } from "@workspace/api-client-react";

// ─────────────────────────────────────────────
// AttachmentBadge
// count > 0  → solid blue badge with count
// count = 0, showWarning = true  → amber ⚠ "No docs"
// count = 0, showWarning = false → muted hollow paperclip
// ─────────────────────────────────────────────

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
  if (count > 0) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
        className={cn(
          "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded cursor-pointer",
          "bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors",
          className
        )}
        title={`${count} document${count !== 1 ? "s" : ""} attached`}
      >
        <Paperclip className="h-3 w-3" />
        <span>{count}</span>
      </button>
    );
  }

  if (showWarning) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded",
          "bg-amber-500/10 text-amber-400 border border-amber-500/20",
          className
        )}
        title="No supporting document"
      >
        <AlertTriangle className="h-3 w-3" />
        No docs
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground/40",
        "hover:text-muted-foreground transition-colors cursor-pointer",
        className
      )}
      title="No documents attached"
    >
      <Paperclip className="h-3 w-3" />
    </button>
  );
}

// ─────────────────────────────────────────────
// EvidenceSummary
// Shows at the top of ItemDetailSheet: count, thumbnails, last-added time
// ─────────────────────────────────────────────

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

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip
            className={cn(
              "h-3.5 w-3.5",
              count > 0 ? "text-blue-400" : "text-muted-foreground/40"
            )}
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Evidence
          </span>
          <span
            className={cn(
              "text-xs font-bold",
              count > 0 ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {count} {count === 1 ? "document" : "documents"}
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

      {count === 0 ? (
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
