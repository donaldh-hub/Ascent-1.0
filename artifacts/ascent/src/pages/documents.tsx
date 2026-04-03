import { useState } from "react";
import { useLocation } from "wouter";
import {
  FileText, Search, Upload, Building2, GitBranch,
  Server, Hash, ChevronRight, Filter, Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListDocuments } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// ─── Entity meta ──────────────────────────────────────────────────────────────

const ENTITY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  workflow: { label: "Workflow", icon: GitBranch, color: "text-blue-400" },
  workflow_item: { label: "Work Item", icon: GitBranch, color: "text-blue-300" },
  workflow_stage: { label: "Stage", icon: GitBranch, color: "text-blue-200" },
  asset: { label: "Asset", icon: Server, color: "text-amber-400" },
  unit: { label: "Unit", icon: Hash, color: "text-primary" },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  general: "General",
  warranty: "Warranty",
  inspection: "Inspection",
  compliance: "Compliance",
  invoice: "Invoice",
  contract: "Contract",
  photo: "Photo",
  report: "Report",
  permit: "Permit",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
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

function entityNavPath(entityType: string, entityId: number, linkedWorkflowId?: number | null): string | null {
  switch (entityType) {
    case "unit": return `/units/${entityId}`;
    case "workflow": return `/workflows/${entityId}`;
    case "workflow_item":
    case "workflow_stage":
      return linkedWorkflowId ? `/workflows/${linkedWorkflowId}` : null;
    case "asset": return `/assets`;
    default: return null;
  }
}

// ─── Document row ─────────────────────────────────────────────────────────────

interface DocRowProps {
  doc: {
    id: number;
    fileName: string;
    documentType: string;
    linkedEntityType: string;
    linkedEntityId: number;
    linkedWorkflowId?: number | null;
    uploadedBy: string;
    uploadedAt: string;
    objectPath: string;
  };
  onClick: () => void;
}

function DocRow({ doc, onClick }: DocRowProps) {
  const meta = ENTITY_META[doc.linkedEntityType] ?? {
    label: doc.linkedEntityType, icon: FileText, color: "text-muted-foreground",
  };
  const Icon = meta.icon;
  const docTypeLabel = DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-secondary/20 transition-colors text-left group border-b border-border last:border-0"
    >
      <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
        <FileText className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{doc.fileName}</span>
          <Badge variant="outline" className="text-xs shrink-0">
            {docTypeLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className={cn("flex items-center gap-1 text-xs", meta.color)}>
            <Icon className="h-3 w-3" />
            {meta.label} #{doc.linkedEntityId}
          </span>
          <span className="text-xs text-muted-foreground">
            by {doc.uploadedBy}
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {timeAgo(doc.uploadedAt)}
          </span>
        </div>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const ALL_ENTITY_TYPES = ["all", "unit", "workflow", "workflow_item", "workflow_stage", "asset"];

export default function Documents() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");

  const { data: docs = [], isLoading } = useListDocuments(
    {},
    { query: { queryKey: ["documents", "all"], staleTime: 30_000 } }
  );

  const filtered = docs.filter((doc) => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      doc.fileName.toLowerCase().includes(q) ||
      doc.documentType.toLowerCase().includes(q) ||
      doc.uploadedBy?.toLowerCase().includes(q) ||
      doc.linkedEntityType.toLowerCase().includes(q);
    const matchesType = entityFilter === "all" || doc.linkedEntityType === entityFilter;
    return matchesSearch && matchesType;
  });

  const totalByType = ALL_ENTITY_TYPES.slice(1).reduce<Record<string, number>>((acc, t) => {
    acc[t] = docs.filter((d) => d.linkedEntityType === t).length;
    return acc;
  }, {});

  function handleDocClick(doc: typeof docs[number]) {
    const path = entityNavPath(doc.linkedEntityType, doc.linkedEntityId, doc.linkedWorkflowId);
    if (path) navigate(path);
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {docs.length} document{docs.length !== 1 ? "s" : ""} across all entities
          </p>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {ALL_ENTITY_TYPES.map((type) => {
          const isActive = entityFilter === type;
          const count = type === "all" ? docs.length : (totalByType[type] ?? 0);
          const meta = type === "all" ? null : ENTITY_META[type];
          return (
            <button
              key={type}
              onClick={() => setEntityFilter(type)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              )}
            >
              {meta && <meta.icon className={cn("h-3 w-3", meta.color)} />}
              {type === "all" ? "All" : ENTITY_META[type]?.label ?? type}
              <span className={cn(
                "ml-0.5 px-1.5 py-0.5 rounded-full text-xs",
                isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by filename, type, or uploader..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Document list */}
      {isLoading ? (
        <div className="border border-border rounded-xl">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-0 animate-pulse">
              <div className="h-9 w-9 rounded-lg bg-secondary shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-secondary rounded w-1/3" />
                <div className="h-2 bg-secondary/50 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <FileText className="h-10 w-10 mx-auto mb-4 text-muted-foreground opacity-40" />
          <h3 className="font-semibold text-lg mb-2">No documents yet</h3>
          <p className="text-muted-foreground text-sm mb-4 max-w-sm mx-auto">
            Documents uploaded to workflows, units, and assets will appear here.
            Start by opening a unit or workflow and attaching a file.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => navigate("/units")}>
              <Hash className="h-4 w-4 mr-2" /> Go to Units
            </Button>
            <Button variant="outline" onClick={() => navigate("/workflows")}>
              <GitBranch className="h-4 w-4 mr-2" /> Go to Workflows
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-border rounded-xl p-10 text-center text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p>No documents match your search.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-secondary/20 px-5 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {filtered.length} document{filtered.length !== 1 ? "s" : ""}
              {entityFilter !== "all" && ` · ${ENTITY_META[entityFilter]?.label ?? entityFilter}`}
            </span>
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="divide-y divide-border">
            {filtered
              .slice()
              .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
              .map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  onClick={() => handleDocClick(doc)}
                />
              ))}
          </div>
        </div>
      )}

    </div>
  );
}
