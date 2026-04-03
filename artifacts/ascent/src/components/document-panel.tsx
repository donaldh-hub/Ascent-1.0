/**
 * DocumentPanel — Evidence and document attachment panel
 *
 * Used inline inside ItemDetailSheet and any other entity detail view.
 * Supports upload, preview, type-tagging, and deletion.
 */

import { useState, useRef, useCallback } from "react";
import { useListDocuments, useCreateDocument, useDeleteDocument } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSystemSync } from "@/hooks/use-system-sync";
import {
  Paperclip,
  Upload,
  Trash2,
  Eye,
  FileText,
  Image,
  X,
  Loader2,
  Camera,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DOCUMENT_TYPES = [
  { value: "general", label: "General" },
  { value: "photo", label: "Photo" },
  { value: "inspection", label: "Inspection Report" },
  { value: "warranty", label: "Warranty" },
  { value: "invoice", label: "Invoice" },
  { value: "approval", label: "Approval" },
  { value: "contract", label: "Contract" },
  { value: "estimate", label: "Estimate" },
  { value: "manual", label: "Manual" },
  { value: "report", label: "Report" },
] as const;

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isImage(fileType: string) {
  return fileType.startsWith("image/");
}

function isPdf(fileType: string) {
  return fileType === "application/pdf";
}

function docTypeLabel(type: string) {
  return DOCUMENT_TYPES.find((d) => d.value === type)?.label ?? type;
}

function docTypeBadgeClass(type: string) {
  switch (type) {
    case "warranty": return "border-blue-500/40 text-blue-400";
    case "invoice": return "border-amber-500/40 text-amber-400";
    case "approval": return "border-green-500/40 text-green-400";
    case "inspection": return "border-purple-500/40 text-purple-400";
    case "contract": return "border-red-500/40 text-red-400";
    case "photo": return "border-sky-500/40 text-sky-400";
    default: return "border-border text-muted-foreground";
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────
// Document Preview Modal
// ─────────────────────────────────────────────

function PreviewModal({
  doc,
  onClose,
}: {
  doc: { id: number; fileName: string; fileType: string; objectPath: string } | null;
  onClose: () => void;
}) {
  const src = doc ? `/api/storage${doc.objectPath}` : "";

  return (
    <Dialog open={!!doc} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl w-full p-0 overflow-hidden bg-card border-border">
        <DialogHeader className="px-5 py-3 border-b border-border flex flex-row items-center justify-between">
          <DialogTitle className="text-sm font-semibold truncate pr-8">
            {doc?.fileName}
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center bg-black/20 min-h-[300px] max-h-[70vh] overflow-auto">
          {doc && isImage(doc.fileType) ? (
            <img
              src={src}
              alt={doc.fileName}
              className="max-w-full max-h-[65vh] object-contain"
            />
          ) : doc && isPdf(doc.fileType) ? (
            <iframe
              src={src}
              title={doc.fileName}
              className="w-full h-[65vh]"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <FileText className="h-12 w-12 opacity-30" />
              <p className="text-sm">Preview not available for this file type.</p>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="text-primary text-sm underline"
              >
                Download file
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// Upload Panel (inline form)
// ─────────────────────────────────────────────

function UploadForm({
  entityType,
  entityId,
  workflowId,
  stageId,
  onUploaded,
  onCancel,
}: {
  entityType: string;
  entityId: number;
  workflowId: number;
  stageId?: number;
  onUploaded: () => void;
  onCancel: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("general");
  const [notes, setNotes] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const createDocMutation = useCreateDocument();
  const { toast } = useToast();

  const { sync } = useSystemSync();
  const { uploadFile, isUploading, progress } = useUpload({
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  function handleFileSelect(file: File) {
    setSelectedFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  async function handleSubmit() {
    if (!selectedFile) return;

    const uploadResult = await uploadFile(selectedFile);
    if (!uploadResult) return;

    createDocMutation.mutate(
      {
        data: {
          objectPath: uploadResult.objectPath,
          fileName: selectedFile.name,
          fileType: selectedFile.type || "application/octet-stream",
          fileSizeBytes: selectedFile.size,
          documentType: docType,
          linkedEntityType: entityType,
          linkedEntityId: entityId,
          linkedWorkflowId: workflowId,
          linkedStageId: stageId ?? null,
          notes: notes.trim() || null,
          uploadedBy: "Ops Director",
        },
      },
      {
        onSuccess: () => {
          sync({ type: "document_uploaded", fileName: selectedFile.name, entityType });
          onUploaded();
        },
        onError: () => {
          toast({ title: "Save failed", description: "Document uploaded but metadata could not be saved.", variant: "destructive" });
        },
      }
    );
  }

  const isSubmitting = isUploading || createDocMutation.isPending;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-3 bg-secondary/40 rounded-lg p-3 border border-border"
    >
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
          isDragOver
            ? "border-primary bg-primary/5"
            : selectedFile
            ? "border-green-500/60 bg-green-500/5"
            : "border-border hover:border-primary/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
        />
        {selectedFile ? (
          <div className="flex items-center justify-center gap-2">
            {isImage(selectedFile.type) ? (
              <Image className="h-4 w-4 text-green-400" />
            ) : (
              <FileText className="h-4 w-4 text-green-400" />
            )}
            <span className="text-sm font-medium text-green-400 truncate max-w-48">
              {selectedFile.name}
            </span>
            <span className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</span>
            <button
              className="ml-1 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div>
            <Upload className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground opacity-50" />
            <p className="text-xs text-muted-foreground">
              Drag & drop or click to upload
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              PDF, JPG, PNG, WebP
            </p>
          </div>
        )}
      </div>

      {/* Camera capture (mobile-friendly) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full text-xs h-7"
        onClick={() => cameraInputRef.current?.click()}
      >
        <Camera className="h-3.5 w-3.5 mr-1.5" />
        Take Photo
      </Button>

      {/* Document type */}
      <Select value={docType} onValueChange={setDocType}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Document type" />
        </SelectTrigger>
        <SelectContent>
          {DOCUMENT_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value} className="text-xs">
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Notes */}
      <Textarea
        placeholder="Optional notes..."
        rows={2}
        className="text-xs resize-none"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {/* Upload progress */}
      {isUploading && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uploading...</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-8 text-xs"
          onClick={handleSubmit}
          disabled={!selectedFile || isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-1.5" />
          )}
          {isUploading ? "Uploading…" : createDocMutation.isPending ? "Saving…" : "Attach"}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Main DocumentPanel component
// ─────────────────────────────────────────────

export interface DocumentPanelProps {
  entityType: string;
  entityId: number;
  workflowId: number;
  stageId?: number;
  compact?: boolean;
}

export function DocumentPanel({
  entityType,
  entityId,
  workflowId,
  stageId,
  compact = false,
}: DocumentPanelProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const { toast } = useToast();

  const {
    data: documents = [],
    isLoading,
    refetch,
  } = useListDocuments(
    { entityType, entityId },
    { query: { queryKey: ["documents", entityType, entityId] } }
  );

  const deleteDocMutation = useDeleteDocument();
  const { sync: syncSystem } = useSystemSync();

  function handleDelete(id: number, name: string, e: React.MouseEvent) {
    e.stopPropagation();
    deleteDocMutation.mutate(
      { id },
      {
        onSuccess: () => {
          syncSystem({ type: "document_deleted", fileName: name });
          refetch();
        },
        onError: () => {
          toast({ title: "Delete failed", variant: "destructive" });
        },
      }
    );
  }

  function handleUploaded() {
    setShowUpload(false);
    refetch();
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Documents
          {documents.length > 0 && (
            <span className="ml-1 bg-muted px-1.5 py-0.5 rounded text-foreground font-bold">
              {documents.length}
            </span>
          )}
        </p>
        {!showUpload && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-primary"
            onClick={() => setShowUpload(true)}
          >
            <Upload className="h-3 w-3 mr-1" />
            Attach
          </Button>
        )}
      </div>

      {/* Upload form */}
      <AnimatePresence>
        {showUpload && (
          <UploadForm
            entityType={entityType}
            entityId={entityId}
            workflowId={workflowId}
            stageId={stageId}
            onUploaded={handleUploaded}
            onCancel={() => setShowUpload(false)}
          />
        )}
      </AnimatePresence>

      {/* Document list */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : documents.length === 0 && !showUpload ? (
        <div
          className="rounded-lg border border-dashed border-border/70 p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setShowUpload(true)}
        >
          <Paperclip className="h-5 w-5 mx-auto mb-1.5 opacity-20" />
          <p className="text-xs text-muted-foreground">No documents attached yet</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            Click to attach a file
          </p>
        </div>
      ) : (
        <AnimatePresence>
          <div className="space-y-1.5">
            {documents.map((doc: any, i: number) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/50 hover:bg-secondary/50 transition-colors group"
              >
                {/* File icon */}
                <div className="shrink-0 p-1.5 rounded bg-muted/50">
                  {isImage(doc.fileType) ? (
                    <Image className="h-3.5 w-3.5 text-sky-400" />
                  ) : isPdf(doc.fileType) ? (
                    <FileText className="h-3.5 w-3.5 text-red-400" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {doc.fileName}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 h-4 font-medium ${docTypeBadgeClass(doc.documentType)}`}
                    >
                      {docTypeLabel(doc.documentType)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(doc.uploadedAt).toLocaleDateString()}
                    </span>
                    {doc.fileSizeBytes > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        · {formatBytes(doc.fileSizeBytes)}
                      </span>
                    )}
                  </div>
                  {doc.notes && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate italic">
                      {doc.notes}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setPreviewDoc(doc)}
                    title="Preview"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(doc.id, doc.fileName, e)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Preview modal */}
      <PreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────
// Document count badge (for item cards)
// ─────────────────────────────────────────────

export function DocumentCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
      <Paperclip className="h-2.5 w-2.5" />
      {count}
    </span>
  );
}
