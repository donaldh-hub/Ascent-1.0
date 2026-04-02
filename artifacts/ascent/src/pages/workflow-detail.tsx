import { useParams } from "wouter";
import { 
  useGetWorkflow, 
  useListStages,
  useGetWorkflowHealth,
  Stage
} from "@workspace/api-client-react";
import { StoplightIndicator, StoplightBadge } from "@/components/stoplight";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle, CheckCircle2, Shield, Activity, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export default function WorkflowDetail() {
  const { id } = useParams();
  const workflowId = Number(id);

  const { data: workflow, isLoading: isLoadingWf } = useGetWorkflow(workflowId, {
    query: { enabled: !!workflowId, queryKey: ['workflow', workflowId] }
  });

  const { data: stages, isLoading: isLoadingStages } = useListStages(workflowId, {
    query: { enabled: !!workflowId, queryKey: ['stages', workflowId] }
  });

  const { data: health, isLoading: isLoadingHealth } = useGetWorkflowHealth(workflowId, {
    query: { enabled: !!workflowId, queryKey: ['workflowHealth', workflowId] }
  });

  if (isLoadingWf) {
    return <div className="p-8"><Skeleton className="h-12 w-64 mb-8" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!workflow) {
    return <div className="p-8 text-center">Workflow not found.</div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-card p-6 rounded-lg border border-border shadow-sm">
        <div className="flex items-center gap-4">
          <StoplightIndicator status={workflow.stoplight} size="lg" pulse={workflow.stoplight === 'red'} />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{workflow.title}</h1>
              <Badge variant="outline" className="uppercase tracking-widest">{workflow.status.replace('_', ' ')}</Badge>
            </div>
            <p className="text-muted-foreground mt-1 max-w-2xl">{workflow.description}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="font-mono">ID: {workflow.id}</span>
            {workflow.owner && <span>Owner: <span className="text-foreground font-medium">{workflow.owner}</span></span>}
          </div>
          {workflow.dueDate && (
            <div className="flex items-center gap-1 text-foreground font-medium">
              <Clock className="h-4 w-4" /> Due: {new Date(workflow.dueDate).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Pipeline View */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" /> 
                Stage Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {isLoadingStages ? (
                <Skeleton className="h-32 w-full" />
              ) : stages && stages.length > 0 ? (
                <div className="relative">
                  <div className="absolute top-5 left-8 right-8 h-1 bg-muted rounded-full overflow-hidden">
                    {/* Background line */}
                  </div>
                  
                  <div className="flex justify-between relative z-10">
                    {stages.map((stage: Stage, i: number) => {
                      const isCompleted = stage.status === 'completed';
                      const isActive = stage.status === 'in_progress';
                      const isBlocked = stage.status === 'blocked' || stage.status === 'overdue';
                      const isBottleneck = stage.isBottleneck;
                      
                      return (
                        <div key={stage.id} className="flex flex-col items-center group relative w-32">
                          <div 
                            className={cn(
                              "w-10 h-10 rounded-full border-4 flex items-center justify-center bg-background transition-all z-10",
                              isCompleted ? "border-status-green text-status-green" : 
                              isActive ? "border-primary text-primary shadow-[0_0_15px_rgba(37,99,235,0.5)] scale-110" : 
                              isBlocked ? "border-status-red text-status-red" : 
                              "border-muted text-muted-foreground"
                            )}
                          >
                            {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : 
                             isBlocked ? <AlertTriangle className="h-5 w-5" /> :
                             <span className="font-bold text-sm">{i + 1}</span>}
                          </div>
                          
                          <div className="mt-3 text-center">
                            <div className={cn("text-sm font-bold truncate max-w-full px-2", 
                              isActive ? "text-primary" : "text-foreground"
                            )}>
                              {stage.name}
                            </div>
                            <div className="text-[10px] uppercase font-semibold text-muted-foreground mt-1 tracking-wider">
                              {stage.status.replace('_', ' ')}
                            </div>
                            {isBottleneck && (
                              <div className="mt-2 inline-flex">
                                <StoplightBadge status="red" label="BOTTLENECK" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No stages defined for this workflow.</div>
              )}
            </CardContent>
          </Card>

          {/* Workflow Documents & Impact */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Documents
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {workflow.documents && workflow.documents.length > 0 ? (
                  <div className="space-y-3">
                    {workflow.documents.map(doc => (
                      <div key={doc.id} className="flex items-center gap-3 p-2 hover:bg-secondary/50 rounded-md border border-transparent hover:border-border transition-colors cursor-pointer">
                        <div className="h-8 w-8 rounded bg-primary/10 text-primary flex items-center justify-center">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="overflow-hidden">
                          <div className="text-sm font-medium truncate">{doc.filename}</div>
                          <div className="text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-6">No documents attached.</div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border border-l-4 border-l-status-yellow">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-status-yellow" /> Impact Events
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {workflow.impactEvents && workflow.impactEvents.length > 0 ? (
                  <div className="space-y-4">
                    {workflow.impactEvents.map(event => (
                      <div key={event.id} className="text-sm">
                        <div className="font-semibold text-foreground capitalize mb-1">{event.eventType.replace('_', ' ')}</div>
                        <p className="text-muted-foreground text-xs leading-relaxed">{event.description}</p>
                        {event.timeImpactDays && (
                          <div className="text-xs font-mono text-status-red mt-1">+{event.timeImpactDays} days delay</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-6">No impact events logged.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Sidebar - Health & Metrics */}
        <div className="space-y-6">
          <Card className="bg-card border-border overflow-hidden relative">
            <div className={cn("absolute top-0 left-0 w-full h-1", 
              health?.stoplight === 'red' ? "bg-status-red" : 
              health?.stoplight === 'yellow' ? "bg-status-yellow" : "bg-status-green"
            )} />
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Health Diagnostics
                <Shield className="h-5 w-5 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingHealth ? (
                <Skeleton className="h-32 w-full" />
              ) : health ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="text-5xl font-black">{health.healthScore}</div>
                    <div className="flex flex-col">
                      <span className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Overall Score</span>
                      <StoplightBadge status={health.stoplight} className="mt-1 w-fit" />
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-border/50">
                    <HealthBar label="Flow" score={health.flowScore} />
                    <HealthBar label="Risk" score={health.riskScore} inverted />
                    <HealthBar label="Execution" score={health.executionScore} />
                    <HealthBar label="Improvement" score={health.improvementScore} />
                  </div>

                  {health.recommendation && (
                    <div className="bg-secondary/50 p-4 rounded-md border border-border">
                      <h4 className="text-xs uppercase font-bold text-primary mb-1">System Recommendation</h4>
                      <p className="text-sm text-foreground">{health.recommendation}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base">Active Alerts</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 p-0">
              {workflow.alerts && workflow.alerts.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {workflow.alerts.map(alert => (
                    <div key={alert.id} className="p-4 flex gap-3">
                      <div className={cn("w-1.5 h-full rounded-full shrink-0", 
                        alert.severity === 'critical' ? "bg-status-red" : 
                        alert.severity === 'warning' ? "bg-status-yellow" : "bg-primary"
                      )} />
                      <div>
                        <div className="text-sm font-semibold mb-1">{alert.title}</div>
                        <div className="text-xs text-muted-foreground">{alert.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">No active alerts.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HealthBar({ label, score, inverted = false }: { label: string, score: number, inverted?: boolean }) {
  // If inverted, higher score is worse (e.g. Risk)
  const isGood = inverted ? score < 30 : score > 70;
  const isBad = inverted ? score > 70 : score < 40;
  
  const color = isBad ? "bg-status-red" : isGood ? "bg-status-green" : "bg-status-yellow";

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="font-mono">{score}/100</span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full", color)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
