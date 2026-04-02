import { useState } from "react";
import { Link } from "wouter";
import { 
  useListWorkflows, 
  useCreateWorkflow,
  WorkflowStatus,
  Stoplight
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StoplightIndicator, StoplightBadge } from "@/components/stoplight";
import { Search, Plus, Filter, Calendar } from "lucide-react";
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

const workflowSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  owner: z.string().optional(),
});

export default function Workflows() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  
  const { data: workflows, isLoading, refetch } = useListWorkflows();
  const createMutation = useCreateWorkflow();
  const [createOpen, setCreateOpen] = useState(false);

  const form = useForm<z.infer<typeof workflowSchema>>({
    resolver: zodResolver(workflowSchema),
    defaultValues: {
      title: "",
      description: "",
      owner: "",
    },
  });

  const onSubmit = (data: z.infer<typeof workflowSchema>) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        setCreateOpen(false);
        form.reset();
        refetch();
      }
    });
  };

  const filteredWorkflows = workflows?.filter(wf => {
    if (search && !wf.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus !== "all" && wf.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground mt-1 text-sm">Active processes and pipelines</p>
        </div>
        
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="font-semibold tracking-wide">
              <Plus className="mr-2 h-4 w-4" /> NEW WORKFLOW
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border">
            <DialogHeader>
              <DialogTitle>Initialize Workflow</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Q3 Server Migration" {...field} className="bg-background" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input placeholder="Brief overview" {...field} className="bg-background" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="owner"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Owner</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Engineering Team" {...field} className="bg-background" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Initialize"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search workflows..." 
            className="pl-9 bg-card border-border"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
          <Button 
            variant={filterStatus === "all" ? "default" : "outline"} 
            size="sm"
            onClick={() => setFilterStatus("all")}
          >
            All
          </Button>
          <Button 
            variant={filterStatus === "active" ? "default" : "outline"} 
            size="sm"
            onClick={() => setFilterStatus("active")}
          >
            Active
          </Button>
          <Button 
            variant={filterStatus === "at_risk" ? "default" : "outline"} 
            size="sm"
            onClick={() => setFilterStatus("at_risk")}
            className={filterStatus === "at_risk" ? "bg-red-500 hover:bg-red-600 text-white" : "text-red-400"}
          >
            At Risk
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="bg-card">
              <CardContent className="p-6 flex items-center justify-between">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))
        ) : filteredWorkflows?.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg bg-card/50">
            <Workflow className="h-12 w-12 text-muted-foreground opacity-20 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">No workflows found</h3>
            <p className="text-muted-foreground mt-1">Adjust filters or create a new workflow to get started.</p>
          </div>
        ) : (
          filteredWorkflows?.map((workflow, index) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              key={workflow.id}
            >
              <Link href={`/workflows/${workflow.id}`}>
                <Card className="bg-card border-border/50 hover:border-primary/40 hover:bg-secondary/20 transition-all cursor-pointer group">
                  <CardContent className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="flex items-start gap-4 flex-1">
                      <StoplightIndicator status={workflow.stoplight} size="lg" className="mt-1 shrink-0" pulse={workflow.stoplight === 'red'} />
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="font-bold text-lg group-hover:text-primary transition-colors">
                            {workflow.title}
                          </h3>
                          <span className="text-xs uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
                            {workflow.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1 max-w-xl">
                          {workflow.description || "No description provided."}
                        </p>
                        
                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground font-medium">
                          {workflow.owner && (
                            <span>Owner: <span className="text-foreground">{workflow.owner}</span></span>
                          )}
                          {workflow.dueDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(workflow.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
                      <div className="flex justify-between text-xs font-semibold mb-1">
                        <span>Progress</span>
                        <span>{workflow.completedStagesCount} / {workflow.stagesCount} Stages</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary" 
                          style={{ width: `${workflow.stagesCount > 0 ? (workflow.completedStagesCount / workflow.stagesCount) * 100 : 0}%` }}
                        />
                      </div>
                      
                      <div className="flex justify-between items-center mt-2">
                        <div className="text-xs font-mono">
                          HLTH: <span className={
                            workflow.healthScore > 80 ? "text-status-green" : 
                            workflow.healthScore > 50 ? "text-status-yellow" : "text-status-red"
                          }>{workflow.healthScore}</span>
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
