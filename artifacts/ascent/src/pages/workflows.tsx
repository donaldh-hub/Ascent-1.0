import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListWorkflows,
  useCreateWorkflow,
  useCreateStage,
  useListAlerts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StoplightIndicator, StoplightBadge } from "@/components/stoplight";
import { Search, Plus, Trash2, GripVertical, GitBranch, Calendar, AlertCircle, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useWorkflowDocTotals } from "@/hooks/use-doc-counts";
import { EVIDENCE, isDocMissingAlert } from "@/lib/evidence-language";

interface StageEntry {
  name: string;
  order: number;
}

const workflowSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  owner: z.string().optional(),
});

function StageBuilder({
  stages,
  onChange,
}: {
  stages: StageEntry[];
  onChange: (stages: StageEntry[]) => void;
}) {
  function addStage() {
    onChange([...stages, { name: "", order: stages.length + 1 }]);
  }

  function updateName(idx: number, name: string) {
    const updated = stages.map((s, i) => (i === idx ? { ...s, name } : s));
    onChange(updated);
  }

  function removeStage(idx: number) {
    const updated = stages.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 }));
    onChange(updated);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium">Stages <span className="text-destructive">*</span></p>
        <span className="text-xs text-muted-foreground">{stages.length} stage{stages.length !== 1 ? "s" : ""}</span>
      </div>
      {stages.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Add at least one stage to define the workflow.</p>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-muted-foreground w-6 shrink-0 justify-end">
                <GripVertical className="h-3 w-3 opacity-40" />
                {idx + 1}.
              </span>
              <Input
                placeholder={`Stage ${idx + 1} name`}
                value={stage.name}
                onChange={(e) => updateName(idx, e.target.value)}
                className="bg-background h-8 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeStage(idx)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="w-full text-xs mt-1" onClick={addStage}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add Stage
      </Button>
    </div>
  );
}

export default function Workflows() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [stages, setStages] = useState<StageEntry[]>([
    { name: "", order: 1 },
    { name: "", order: 2 },
    { name: "", order: 3 },
  ]);
  const [stageError, setStageError] = useState<string | null>(null);

  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: workflows, isLoading, refetch } = useListWorkflows();
  const { data: alerts } = useListAlerts({ isActive: true } as any);
  const createMutation = useCreateWorkflow();
  const createStageMutation = useCreateStage();

  const form = useForm<z.infer<typeof workflowSchema>>({
    resolver: zodResolver(workflowSchema),
    defaultValues: { title: "", description: "", owner: "" },
  });

  async function onSubmit(data: z.infer<typeof workflowSchema>) {
    const validStages = stages.filter((s) => s.name.trim().length > 0);
    if (validStages.length === 0) {
      setStageError("Add at least one stage with a name.");
      return;
    }
    setStageError(null);

    createMutation.mutate(
      { data: { title: data.title, description: data.description || null, owner: data.owner || null } },
      {
        onSuccess: async (workflow) => {
          // Create all stages for the new workflow
          for (let i = 0; i < validStages.length; i++) {
            await new Promise<void>((resolve) => {
              createStageMutation.mutate(
                {
                  id: workflow.id,
                  data: { name: validStages[i].name, order: i + 1, status: "pending" },
                },
                { onSettled: () => resolve() }
              );
            });
          }
          toast({ title: "Workflow created", description: `${workflow.title} with ${validStages.length} stages.` });
          setCreateOpen(false);
          form.reset();
          setStages([{ name: "", order: 1 }, { name: "", order: 2 }, { name: "", order: 3 }]);
          refetch();
          navigate(`/workflows/${workflow.id}`);
        },
        onError: () => toast({ title: "Error", description: "Failed to create workflow.", variant: "destructive" }),
      }
    );
  }

  const filteredWorkflows = workflows?.filter((wf) => {
    if (search && !wf.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus === "active" && wf.status !== "active") return false;
    if (filterStatus === "at_risk" && wf.stoplight !== "red") return false;
    return true;
  });

  const allWorkflowIds = (workflows ?? []).map((wf) => wf.id);
  const { data: wfDocTotals = {} } = useWorkflowDocTotals(allWorkflowIds);

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground mt-1 text-sm">Active processes and operational pipelines</p>
        </div>

        <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) { setStageError(null); } }}>
          <DialogTrigger asChild>
            <Button className="font-semibold tracking-wide">
              <Plus className="mr-2 h-4 w-4" /> NEW WORKFLOW
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg bg-card border-border max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Initialize Workflow</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workflow Title *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Q3 Server Migration" {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Brief overview of this workflow..." rows={2} {...field} className="bg-background resize-none" />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="owner" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Owner / Team</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Engineering Team" {...field} className="bg-background" />
                    </FormControl>
                  </FormItem>
                )} />

                <div className="pt-1 border-t border-border">
                  <StageBuilder stages={stages} onChange={setStages} />
                  {stageError && <p className="text-xs text-destructive mt-1">{stageError}</p>}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Initialize"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            className="pl-9 bg-card border-border"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {[
            { key: "all", label: "All" },
            { key: "active", label: "Active" },
            { key: "at_risk", label: "At Risk" },
          ].map(({ key, label }) => (
            <Button
              key={key}
              variant={filterStatus === key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus(key)}
              className={cn(key === "at_risk" && filterStatus !== "at_risk" && "text-red-400")}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Workflow List */}
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-card">
              <CardContent className="p-6">
                <Skeleton className="h-6 w-64 mb-2" />
                <Skeleton className="h-4 w-full max-w-sm" />
              </CardContent>
            </Card>
          ))
        ) : filteredWorkflows?.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg bg-card/50">
            <GitBranch className="h-12 w-12 text-muted-foreground opacity-20 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">No workflows found</h3>
            <p className="text-muted-foreground mt-1 text-sm">Adjust your filters or create a new workflow.</p>
          </div>
        ) : (
          filteredWorkflows?.map((workflow, index) => (
            <motion.div
              key={workflow.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
            >
              <Link href={`/workflows/${workflow.id}`}>
                <Card className="bg-card border-border/50 hover:border-primary/40 hover:bg-secondary/20 transition-all cursor-pointer group">
                  <CardContent className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <StoplightIndicator
                        status={workflow.stoplight}
                        size="lg"
                        className="mt-1 shrink-0"
                        pulse={workflow.stoplight === "red"}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-bold text-lg group-hover:text-primary transition-colors truncate">
                            {workflow.title}
                          </h3>
                          <span className="text-xs uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground font-semibold shrink-0">
                            {workflow.status.replace("_", " ")}
                          </span>
                          {(() => {
                            const wfAlerts = (alerts ?? []).filter((a) => a.workflowId === workflow.id);
                            const docMissingAlerts = wfAlerts.filter(isDocMissingAlert);
                            const otherCritAlerts = wfAlerts.filter(
                              (a) => a.level === "critical" && !isDocMissingAlert(a)
                            );
                            const warnCount = wfAlerts.filter((a) => a.level === "warning").length;
                            return (
                              <>
                                {docMissingAlerts.length > 0 && (
                                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold shrink-0">
                                    <AlertTriangle className="h-3 w-3" />
                                    {EVIDENCE.MISSING_ITEMS(docMissingAlerts.length)}
                                  </span>
                                )}
                                {otherCritAlerts.length > 0 && (
                                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 font-semibold shrink-0">
                                    <AlertCircle className="h-3 w-3" /> {otherCritAlerts.length} critical
                                  </span>
                                )}
                                {docMissingAlerts.length === 0 && otherCritAlerts.length === 0 && warnCount > 0 && (
                                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 font-semibold shrink-0">
                                    <AlertTriangle className="h-3 w-3" /> {warnCount} warning{warnCount !== 1 ? "s" : ""}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1 max-w-xl">
                          {workflow.description || "No description provided."}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground font-medium">
                          {workflow.owner && (
                            <span>Owner: <span className="text-foreground">{workflow.owner}</span></span>
                          )}
                          {workflow.dueDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(workflow.dueDate).toLocaleDateString()}
                            </span>
                          )}
                          <span>{workflow.stagesCount} stage{workflow.stagesCount !== 1 ? "s" : ""}</span>
                          {(() => {
                            const docInfo = (wfDocTotals as any)[workflow.id];
                            if (!docInfo) return null;
                            const wfAlerts = (alerts ?? []).filter((a) => a.workflowId === workflow.id);
                            const hasDocMissingAlert = wfAlerts.some(isDocMissingAlert);
                            if (docInfo.count > 0) {
                              return (
                                <span className="flex items-center gap-1 text-blue-400">
                                  {EVIDENCE.DOCS_VERBOSE(docInfo.count)}
                                </span>
                              );
                            }
                            if (hasDocMissingAlert) {
                              return (
                                <span className="flex items-center gap-1 text-amber-400 font-medium">
                                  {EVIDENCE.MISSING_CRITICAL}
                                </span>
                              );
                            }
                            return (
                              <span className="text-muted-foreground/50">
                                {EVIDENCE.MISSING}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    <div className="w-full md:w-56 flex flex-col gap-2 shrink-0">
                      <div className="flex justify-between text-xs font-semibold mb-1">
                        <span>Stage Progress</span>
                        <span>{workflow.completedStagesCount} / {workflow.stagesCount}</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: `${workflow.stagesCount > 0 ? (workflow.completedStagesCount / workflow.stagesCount) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <div className="text-xs font-mono">
                          HLTH:{" "}
                          <span className={
                            workflow.healthScore >= 75 ? "text-green-400" :
                            workflow.healthScore >= 50 ? "text-amber-400" : "text-red-400"
                          }>
                            {workflow.healthScore}
                          </span>
                        </div>
                        <StoplightBadge status={workflow.stoplight} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
