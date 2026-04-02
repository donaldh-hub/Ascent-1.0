import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetWorkflow,
  useListStages,
  useGetWorkflowHealth,
  useListWorkflowItems,
  useCreateWorkflowItem,
  useGetWorkflowItem,
  useUpdateWorkflowItem,
  useDeleteWorkflowItem,
  useMoveWorkflowItem,
  useGetWorkflowBottleneck,
  useListAlerts,
  useAcknowledgeAlert,
  useResolveAlert,
  useListDocuments,
  WorkflowItem,
} from "@workspace/api-client-react";
import { DocumentPanel, DocumentCountBadge } from "@/components/document-panel";
import { StoplightIndicator } from "@/components/stoplight";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Plus,
  ChevronRight,
  MoreHorizontal,
  MoveRight,
  User,
  ArrowRight,
  Zap,
  TrendingUp,
  ShieldAlert,
  ClipboardList,
  History,
  Edit,
  Trash2,
  Flag,
  AlertCircle,
  Bell,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const PRIORITY_CONFIG = {
  low: { label: "Low", color: "text-slate-400", bg: "bg-slate-800", border: "border-slate-700" },
  medium: { label: "Medium", color: "text-blue-400", bg: "bg-blue-950", border: "border-blue-800" },
  high: { label: "High", color: "text-amber-400", bg: "bg-amber-950", border: "border-amber-800" },
  critical: { label: "Critical", color: "text-red-400", bg: "bg-red-950", border: "border-red-900" },
} as const;

const STATUS_CONFIG = {
  open: { label: "Open", color: "text-slate-300", dot: "bg-slate-400" },
  in_progress: { label: "In Progress", color: "text-blue-300", dot: "bg-blue-400" },
  completed: { label: "Completed", color: "text-green-300", dot: "bg-green-400" },
  blocked: { label: "Blocked", color: "text-red-300", dot: "bg-red-400" },
} as const;

const createItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  assignedTo: z.string().optional(),
  dueDate: z.string().optional(),
  stageId: z.number().optional(),
});

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.medium;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", cfg.color, cfg.bg, cfg.border)}>
      <Flag className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", cfg.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function ItemCard({
  item,
  stages,
  workflowId,
  docCount,
  onSelect,
  onMoved,
}: {
  item: WorkflowItem;
  stages: Array<{ id: number; name: string }>;
  workflowId: number;
  docCount?: number;
  onSelect: (item: WorkflowItem) => void;
  onMoved: () => void;
}) {
  const moveMutation = useMoveWorkflowItem();
  const deleteMutation = useDeleteWorkflowItem();
  const { toast } = useToast();
  const otherStages = stages.filter((s) => s.id !== item.stageId);

  function handleMove(toStageId: number, e: React.MouseEvent) {
    e.stopPropagation();
    moveMutation.mutate(
      { id: workflowId, itemId: item.id, data: { toStageId } },
      {
        onSuccess: () => { toast({ title: "Item moved" }); onMoved(); },
        onError: () => toast({ title: "Error", description: "Failed to move item.", variant: "destructive" }),
      }
    );
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    deleteMutation.mutate(
      { id: workflowId, itemId: item.id },
      { onSuccess: () => { toast({ title: "Item deleted" }); onMoved(); } }
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        "group relative rounded-lg border p-3 cursor-pointer hover:border-primary/40 transition-all",
        "bg-background/60 border-border hover:bg-card"
      )}
      onClick={() => onSelect(item)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{item.title}</p>
          {item.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {otherStages.map((s) => (
              <DropdownMenuItem key={s.id} onClick={(e) => handleMove(s.id, e)}>
                <MoveRight className="h-3.5 w-3.5 mr-2 text-primary" />
                Move to {s.name}
              </DropdownMenuItem>
            ))}
            {otherStages.length > 0 && <div className="my-1 border-t border-border" />}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <PriorityBadge priority={item.priority ?? "medium"} />
        <StatusDot status={item.status ?? "open"} />
        {item.assignedTo && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" /> {item.assignedTo}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(docCount ?? 0) > 0 && <DocumentCountBadge count={docCount ?? 0} />}
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {Math.round(item.daysInCurrentStage)}d here
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function ItemDetailSheet({
  workflowId,
  itemId,
  stages,
  open,
  onClose,
  onMoved,
}: {
  workflowId: number;
  itemId: number | null;
  stages: Array<{ id: number; name: string }>;
  open: boolean;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { data: item, isLoading } = useGetWorkflowItem(workflowId, itemId ?? 0, {
    query: { enabled: open && !!itemId, queryKey: ["item", workflowId, itemId] },
  });
  const updateMutation = useUpdateWorkflowItem();
  const moveMutation = useMoveWorkflowItem();
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAssignedTo, setEditAssignedTo] = useState("");

  function startEdit() {
    if (!item) return;
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditAssignedTo(item.assignedTo ?? "");
    setEditMode(true);
  }

  function saveEdit() {
    if (!item) return;
    updateMutation.mutate(
      {
        id: workflowId,
        itemId: item.id,
        data: { title: editTitle, description: editDescription || null, assignedTo: editAssignedTo || null },
      },
      {
        onSuccess: () => { toast({ title: "Item updated" }); setEditMode(false); onMoved(); },
      }
    );
  }

  function handleMove(toStageId: number) {
    if (!item) return;
    moveMutation.mutate(
      { id: workflowId, itemId: item.id, data: { toStageId } },
      {
        onSuccess: () => { toast({ title: "Item moved" }); onMoved(); onClose(); },
      }
    );
  }

  const currentStage = stages.find((s) => s.id === item?.stageId);
  const otherStages = stages.filter((s) => s.id !== item?.stageId);
  const historyItems = (item as any)?.history ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { setEditMode(false); onClose(); } }}>
      <SheetContent className="w-full sm:max-w-lg bg-card border-border overflow-y-auto">
        {isLoading || !item ? (
          <div className="space-y-4 pt-6">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            <SheetHeader>
              <div className="flex items-start justify-between gap-2">
                <SheetTitle className="text-left leading-snug pr-8">
                  {editMode ? (
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="text-lg font-bold" />
                  ) : item.title}
                </SheetTitle>
                <Button variant="ghost" size="icon" onClick={startEdit} className="h-7 w-7 shrink-0">
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              </div>
            </SheetHeader>

            <div className="flex flex-wrap gap-2">
              <PriorityBadge priority={item.priority ?? "medium"} />
              <StatusDot status={item.status ?? "open"} />
              {currentStage && (
                <Badge variant="outline" className="text-xs">
                  <Activity className="h-3 w-3 mr-1" /> {currentStage.name}
                </Badge>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</p>
              {editMode ? (
                <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} placeholder="Add a description..." />
              ) : (
                <p className="text-sm text-muted-foreground">{item.description || "No description."}</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Assigned To</p>
              {editMode ? (
                <Input value={editAssignedTo} onChange={(e) => setEditAssignedTo(e.target.value)} placeholder="Assign to someone..." />
              ) : (
                <p className="text-sm text-foreground">{item.assignedTo || "Unassigned"}</p>
              )}
            </div>

            {editMode && (
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Days in Stage", value: Math.round(item.daysInCurrentStage) },
                { label: "Days Open", value: Math.round(item.daysOpen) },
              ].map((m) => (
                <div key={m.label} className="rounded-lg bg-muted/20 p-3 border border-border">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-0.5">{m.value}</p>
                </div>
              ))}
            </div>

            {otherStages.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Move to Stage</p>
                <div className="flex flex-wrap gap-2">
                  {otherStages.map((s) => (
                    <Button key={s.id} variant="outline" size="sm" className="text-xs" disabled={moveMutation.isPending} onClick={() => handleMove(s.id)}>
                      <ArrowRight className="h-3 w-3 mr-1" />
                      {s.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Documents section */}
            {item && (
              <div className="border-t border-border/50 pt-4">
                <DocumentPanel
                  entityType="workflow_item"
                  entityId={item.id}
                  workflowId={workflowId}
                />
              </div>
            )}

            {historyItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <History className="h-3.5 w-3.5" /> Movement History
                </p>
                <div className="space-y-2">
                  {historyItems.map((h: any) => (
                    <div key={h.id} className="flex items-start gap-2 text-xs">
                      <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center mt-0.5 shrink-0">
                        <ChevronRight className="h-2.5 w-2.5 text-primary" />
                      </div>
                      <div>
                        <span className="text-foreground">
                          {h.fromStageName ? (
                            <>{h.fromStageName} <ArrowRight className="h-2.5 w-2.5 inline mx-0.5" /> {h.toStageName}</>
                          ) : (
                            <>Created in {h.toStageName}</>
                          )}
                        </span>
                        <span className="text-muted-foreground ml-2">{new Date(h.movedAt).toLocaleDateString()}</span>
                        {h.notes && <p className="text-muted-foreground mt-0.5 italic">{h.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
              <p>Created: {new Date(item.createdAt).toLocaleString()}</p>
              <p>Updated: {new Date(item.updatedAt).toLocaleString()}</p>
              {item.dueDate && <p className="text-amber-400">Due: {item.dueDate}</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateItemDialog({
  workflowId,
  stages,
  defaultStageId,
  onCreated,
}: {
  workflowId: number;
  stages: Array<{ id: number; name: string }>;
  defaultStageId?: number;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateWorkflowItem();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof createItemSchema>>({
    resolver: zodResolver(createItemSchema),
    defaultValues: { title: "", description: "", priority: "medium", assignedTo: "", dueDate: "", stageId: defaultStageId },
  });

  function onSubmit(data: z.infer<typeof createItemSchema>) {
    createMutation.mutate(
      {
        id: workflowId,
        data: {
          title: data.title,
          description: data.description || null,
          priority: data.priority,
          assignedTo: data.assignedTo || null,
          dueDate: data.dueDate || null,
          stageId: data.stageId ?? null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Item created" });
          setOpen(false);
          form.reset({ title: "", description: "", priority: "medium", assignedTo: "", dueDate: "", stageId: defaultStageId });
          onCreated();
        },
        onError: () => toast({ title: "Error", description: "Failed to create item.", variant: "destructive" }),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Item</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader><DialogTitle>Create Workflow Item</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel>Title *</FormLabel>
                <FormControl><Input placeholder="What needs to be done?" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Textarea placeholder="Add context..." rows={2} {...field} /></FormControl>
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="priority" render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["low", "medium", "high", "critical"] as const).map((p) => (
                        <SelectItem key={p} value={p}>{PRIORITY_CONFIG[p].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="stageId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Starting Stage</FormLabel>
                  <Select value={field.value?.toString()} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger><SelectValue placeholder="First stage" /></SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="assignedTo" render={({ field }) => (
              <FormItem>
                <FormLabel>Assigned To</FormLabel>
                <FormControl><Input placeholder="Name or role..." {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="dueDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Due Date (optional)</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Item"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkflowDetail() {
  const { id } = useParams();
  const workflowId = Number(id);
  const queryClient = useQueryClient();
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [activeStageFilter, setActiveStageFilter] = useState<number | "all">("all");

  const { data: workflow, isLoading: isLoadingWf } = useGetWorkflow(workflowId, {
    query: { enabled: !!workflowId, queryKey: ["workflow", workflowId] },
  });
  const { data: stages, isLoading: isLoadingStages } = useListStages(workflowId, {
    query: { enabled: !!workflowId, queryKey: ["stages", workflowId] },
  });
  const { data: health } = useGetWorkflowHealth(workflowId, {
    query: { enabled: !!workflowId, queryKey: ["workflowHealth", workflowId] },
  });
  const { data: items, isLoading: isLoadingItems } = useListWorkflowItems(workflowId, {
    query: { enabled: !!workflowId, queryKey: ["items", workflowId] },
  });
  const { data: bottleneck } = useGetWorkflowBottleneck(workflowId, {
    query: { enabled: !!workflowId, queryKey: ["bottleneck", workflowId] },
  });
  const { data: wfAlerts, refetch: refetchAlerts } = useListAlerts(
    { workflowId: workflowId, isActive: true } as any,
    { query: { enabled: !!workflowId, queryKey: ["alerts", workflowId] } }
  );
  const { data: workflowDocs = [] } = useListDocuments(
    { workflowId: workflowId } as any,
    { query: { enabled: !!workflowId, queryKey: ["docs", "workflow", workflowId] } }
  );
  const acknowledgeMutation = useAcknowledgeAlert();
  const resolveMutation = useResolveAlert();

  const docCountByItemId = (workflowDocs as any[]).reduce((acc: Record<number, number>, d: any) => {
    if (d.linkedEntityType === "workflow_item") {
      acc[d.linkedEntityId] = (acc[d.linkedEntityId] ?? 0) + 1;
    }
    return acc;
  }, {} as Record<number, number>);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["items", workflowId] });
    queryClient.invalidateQueries({ queryKey: ["bottleneck", workflowId] });
    queryClient.invalidateQueries({ queryKey: ["workflowHealth", workflowId] });
  }

  const stageList = (stages ?? []).sort((a, b) => a.order - b.order);
  const allItems = items ?? [];
  const openItems = allItems.filter((i) => i.status !== "completed");
  const completedItems = allItems.filter((i) => i.status === "completed");

  const filteredItems = activeStageFilter === "all" ? allItems : allItems.filter((i) => i.stageId === activeStageFilter);

  const itemsByStage = stageList.reduce((acc, stage) => {
    acc[stage.id] = openItems.filter((i) => i.stageId === stage.id);
    return acc;
  }, {} as Record<number, WorkflowItem[]>);

  if (isLoadingWf) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!workflow) {
    return <div className="p-8 text-center text-muted-foreground">Workflow not found.</div>;
  }

  const longestAging = openItems.length > 0 ? Math.round(Math.max(...openItems.map((i) => i.daysOpen))) : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-card p-5 rounded-lg border border-border">
        <div className="flex items-center gap-4">
          <StoplightIndicator status={workflow.stoplight} size="lg" pulse={workflow.stoplight === "red"} />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{workflow.title}</h1>
              <Badge variant="outline" className="uppercase tracking-wider text-xs">{workflow.status.replace("_", " ")}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{workflow.description}</p>
          </div>
        </div>
        <CreateItemDialog
          workflowId={workflowId}
          stages={stageList.map((s) => ({ id: s.id, name: s.name }))}
          onCreated={invalidateAll}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Open Items", value: openItems.length, icon: ClipboardList, color: "text-blue-400" },
          { label: "Completed", value: completedItems.length, icon: CheckCircle2, color: "text-green-400" },
          { label: "Stages", value: stageList.length, icon: Activity, color: "text-primary" },
          {
            label: "Longest Aging",
            value: longestAging != null ? `${longestAging}d` : "—",
            icon: Clock,
            color: longestAging != null && longestAging > 14 ? "text-red-400" : "text-amber-400",
          },
          {
            label: "Bottleneck",
            value: bottleneck?.hasBottleneck ? (bottleneck.bottleneckStageName ?? "Yes") : "None",
            icon: AlertTriangle,
            color: bottleneck?.hasBottleneck ? "text-amber-400" : "text-green-400",
          },
        ].map((card) => (
          <Card key={card.label} className="bg-card border-border">
            <CardContent className="p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <card.icon className={cn("h-4 w-4", card.color)} />
              </div>
              <p className={cn("text-lg font-bold truncate", card.color)}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bottleneck Insight Banner */}
      {bottleneck?.hasBottleneck && bottleneck.insights.length > 0 && (
        <Card className="bg-amber-950/30 border-amber-800/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300 mb-1">Possible Bottleneck Detected</p>
                <ul className="space-y-1">
                  {bottleneck.insights.map((insight, i) => (
                    <li key={i} className="text-sm text-amber-200/80">{insight}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stage Pipeline + Items */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Stage Pipeline
                </CardTitle>
                <Button
                  variant={activeStageFilter === "all" ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setActiveStageFilter("all")}
                >
                  All ({allItems.length})
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {isLoadingStages ? (
                <Skeleton className="h-32 w-full" />
              ) : stageList.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">No stages defined yet.</p>
              ) : (
                <div>
                  {/* Stage tabs */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-3 border-b border-border/30">
                    {stageList.map((stage, idx) => {
                      const count = itemsByStage[stage.id]?.length ?? 0;
                      const isHot = bottleneck?.bottleneckStageId === stage.id && count >= 2;
                      return (
                        <button
                          key={stage.id}
                          onClick={() => setActiveStageFilter(activeStageFilter === stage.id ? "all" : stage.id)}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap border shrink-0",
                            activeStageFilter === stage.id
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted/20 text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                          )}
                        >
                          <span className="text-[10px] opacity-60">{idx + 1}.</span>
                          {stage.name}
                          {count > 0 && (
                            <span className={cn("rounded-full px-1.5 py-0 text-[10px] font-bold min-w-[1.1rem] text-center", isHot ? "bg-amber-500 text-black" : "bg-primary/20 text-primary")}>
                              {count}
                            </span>
                          )}
                          {isHot && <AlertTriangle className="h-3 w-3 text-amber-400" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Item listing */}
                  {isLoadingItems ? (
                    <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
                  ) : activeStageFilter === "all" ? (
                    <div className="space-y-5">
                      {stageList.map((stage) => {
                        const si = itemsByStage[stage.id] ?? [];
                        const done = allItems.filter((i) => i.stageId === stage.id && i.status === "completed");
                        if (si.length === 0 && done.length === 0) return null;
                        return (
                          <div key={stage.id}>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                              {stage.name}
                              <span className="normal-case font-normal ml-2 text-muted-foreground">
                                {si.length} open{done.length > 0 ? `, ${done.length} done` : ""}
                              </span>
                            </p>
                            <AnimatePresence>
                              <div className="space-y-2">
                                {si.map((item) => (
                                  <ItemCard
                                    key={item.id}
                                    item={item}
                                    stages={stageList.map((s) => ({ id: s.id, name: s.name }))}
                                    workflowId={workflowId}
                                    docCount={docCountByItemId[item.id] ?? 0}
                                    onSelect={(i) => setSelectedItemId(i.id)}
                                    onMoved={invalidateAll}
                                  />
                                ))}
                              </div>
                            </AnimatePresence>
                          </div>
                        );
                      })}
                      {openItems.length === 0 && (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                          <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          No open items yet. Add items to start tracking work.
                        </div>
                      )}
                    </div>
                  ) : (
                    <AnimatePresence>
                      <div className="space-y-2">
                        {filteredItems.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            <ClipboardList className="h-6 w-6 mx-auto mb-2 opacity-30" />
                            No items in this stage.
                          </div>
                        ) : (
                          filteredItems.map((item) => (
                            <ItemCard
                              key={item.id}
                              item={item}
                              stages={stageList.map((s) => ({ id: s.id, name: s.name }))}
                              workflowId={workflowId}
                              docCount={docCountByItemId[item.id] ?? 0}
                              onSelect={(i) => setSelectedItemId(i.id)}
                              onMoved={invalidateAll}
                            />
                          ))
                        )}
                      </div>
                    </AnimatePresence>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          {health && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" /> Workflow Health
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {[
                  { label: "Flow", value: health.flowScore, stoplight: health.flowStoplight, insight: health.flowInsight, icon: TrendingUp },
                  { label: "Risk", value: health.riskScore, stoplight: health.riskStoplight, insight: health.riskInsight, icon: ShieldAlert },
                  { label: "Execution", value: health.executionScore, stoplight: health.executionStoplight, insight: health.executionInsight, icon: Zap },
                  { label: "Improvement", value: health.improvementScore, stoplight: health.improvementStoplight, insight: health.improvementInsight, icon: Activity },
                ].map(({ label, value, stoplight: sl, insight, icon: Icon }) => {
                  const pct = Math.min(100, Math.round(value ?? 0));
                  const barColor = pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Icon className="h-3 w-3" />{label}
                        </span>
                        <div className="flex items-center gap-2">
                          <StoplightIndicator status={sl ?? "yellow"} size="sm" />
                          <span className="text-xs font-semibold tabular-nums">{pct}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
                      </div>
                      {insight && pct < 75 && (
                        <p className="text-[10px] text-muted-foreground leading-tight">{insight}</p>
                      )}
                    </div>
                  );
                })}
                {health.insight && (
                  <p className="text-xs text-muted-foreground pt-2 border-t border-border leading-relaxed">{health.insight}</p>
                )}
              </CardContent>
            </Card>
          )}

          {bottleneck && bottleneck.stageSummary.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-primary" /> Stage Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                {bottleneck.stageSummary.map((s) => {
                  const isHot = bottleneck.bottleneckStageId === s.stageId && s.itemCount >= 2;
                  return (
                    <div key={s.stageId} className={cn(
                      "flex items-center justify-between p-2 rounded-md border text-xs",
                      isHot ? "bg-amber-950/30 border-amber-800/50" : "bg-muted/10 border-border"
                    )}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isHot && <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />}
                        <span className="truncate font-medium text-foreground">{s.stageName}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-2 text-muted-foreground">
                        <span>{s.itemCount} open</span>
                        {s.avgDaysInStage > 0 && <span>{s.avgDaysInStage}d avg</span>}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Active Alerts for this workflow */}
          {wfAlerts && wfAlerts.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  Active Alerts
                  <span className={cn(
                    "ml-1 text-xs font-mono px-1.5 py-0.5 rounded-full",
                    wfAlerts.some((a) => a.level === "critical")
                      ? "bg-red-500/20 text-red-400"
                      : "bg-yellow-500/20 text-yellow-400"
                  )}>
                    {wfAlerts.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                {wfAlerts.map((alert) => {
                  const isCritical = alert.level === "critical";
                  return (
                    <div
                      key={alert.id}
                      className={cn(
                        "flex items-start gap-2.5 p-2.5 rounded-md border text-xs",
                        isCritical ? "bg-red-950/20 border-red-900/40" : "bg-amber-950/20 border-amber-900/30"
                      )}
                    >
                      {isCritical
                        ? <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                        : <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-semibold truncate", isCritical ? "text-red-300" : "text-amber-300")}>
                          {alert.title}
                        </p>
                        <p className="text-muted-foreground mt-0.5 line-clamp-2">{alert.message}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => acknowledgeMutation.mutate({ id: alert.id }, { onSuccess: () => refetchAlerts() })}
                          className="p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                          title="Acknowledge"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => resolveMutation.mutate({ id: alert.id }, { onSuccess: () => refetchAlerts() })}
                          className="p-1 rounded hover:bg-green-500/20 text-green-400 transition-colors"
                          title="Resolve"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Item Detail Drawer */}
      <ItemDetailSheet
        workflowId={workflowId}
        itemId={selectedItemId}
        stages={stageList.map((s) => ({ id: s.id, name: s.name }))}
        open={!!selectedItemId}
        onClose={() => setSelectedItemId(null)}
        onMoved={() => {
          invalidateAll();
          queryClient.invalidateQueries({ queryKey: ["item", workflowId, selectedItemId] });
        }}
      />
    </div>
  );
}
