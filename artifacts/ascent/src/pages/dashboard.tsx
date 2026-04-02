import { 
  useGetDashboardSummary, 
  useGetDashboardBottlenecks, 
  useGetDashboardActions,
  useListWorkflows
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StoplightIndicator, StoplightBadge } from "@/components/stoplight";
import { AlertTriangle, Clock, Target, Workflow, Activity, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { motion } from "framer-motion";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: bottlenecks, isLoading: isLoadingBottlenecks } = useGetDashboardBottlenecks();
  const { data: actions, isLoading: isLoadingActions } = useGetDashboardActions();
  const { data: activeWorkflows } = useListWorkflows({ status: "active" });

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time operational intelligence</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-status-green animate-pulse"></span>
          LIVE
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Main Health Score */}
        <Card className="col-span-1 md:col-span-4 bg-card border-border/50 shadow-lg relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardContent className="p-8 flex flex-col items-center justify-center h-full min-h-[280px]">
            {isLoadingSummary ? (
              <Skeleton className="h-32 w-32 rounded-full" />
            ) : (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative flex items-center justify-center"
              >
                <svg className="w-48 h-48 transform -rotate-90">
                  <circle
                    cx="96" cy="96" r="88"
                    stroke="currentColor" strokeWidth="8" fill="transparent"
                    className="text-secondary"
                  />
                  <circle
                    cx="96" cy="96" r="88"
                    stroke={summary?.stoplight === "red" ? "#ef4444" : summary?.stoplight === "yellow" ? "#eab308" : "#22c55e"} 
                    strokeWidth="8" fill="transparent"
                    strokeDasharray={2 * Math.PI * 88}
                    strokeDashoffset={2 * Math.PI * 88 * (1 - (summary?.operationalHealthScore || 0) / 100)}
                    className="transition-all duration-1000 ease-out drop-shadow-md"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-5xl font-black tracking-tighter">
                    {summary?.operationalHealthScore}
                  </span>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mt-1">
                    Health
                  </span>
                </div>
              </motion.div>
            )}
            
            <div className="mt-8 flex gap-4 w-full justify-center">
              <div className="flex flex-col items-center">
                <span className="text-xl font-bold">{summary?.criticalItemsCount ?? 0}</span>
                <span className="text-[10px] uppercase text-red-400 font-semibold tracking-wider">Critical</span>
              </div>
              <div className="w-px bg-border"></div>
              <div className="flex flex-col items-center">
                <span className="text-xl font-bold">{summary?.activeWorkflowsCount ?? 0}</span>
                <span className="text-[10px] uppercase text-primary font-semibold tracking-wider">Active</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4 Core Score Cards */}
        <div className="col-span-1 md:col-span-8 grid grid-cols-2 gap-4">
          <ScoreCard 
            title="Flow" 
            score={summary?.flowScore} 
            stoplight={summary?.flowStoplight} 
            insight={summary?.flowInsight}
            icon={Workflow}
            isLoading={isLoadingSummary}
            colorClass="text-blue-400"
          />
          <ScoreCard 
            title="Risk" 
            score={summary?.riskScore} 
            stoplight={summary?.riskStoplight} 
            insight={summary?.riskInsight}
            icon={AlertTriangle}
            isLoading={isLoadingSummary}
            colorClass="text-red-400"
          />
          <ScoreCard 
            title="Execution" 
            score={summary?.executionScore} 
            stoplight={summary?.executionStoplight}
            insight={summary?.executionInsight}
            icon={Target}
            isLoading={isLoadingSummary}
            colorClass="text-green-400"
          />
          <ScoreCard 
            title="Improvement" 
            score={summary?.improvementScore} 
            stoplight={summary?.improvementStoplight} 
            insight={summary?.improvementInsight}
            icon={Activity}
            isLoading={isLoadingSummary}
            colorClass="text-purple-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Priority Actions */}
        <Card className="bg-card border-border/50 shadow-md flex flex-col">
          <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Priority Actions</CardTitle>
              <CardDescription>Requires immediate attention</CardDescription>
            </div>
            <Target className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto max-h-[350px]">
            {isLoadingActions ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : actions && actions.length > 0 ? (
              <div className="divide-y divide-border/50">
                {actions.map((action, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    key={action.id} 
                    className="p-4 hover:bg-secondary/50 transition-colors flex items-start gap-4"
                  >
                    <StoplightIndicator status={action.urgency} size="md" className="mt-1" pulse={action.urgency === 'red'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                          {action.type}
                        </span>
                        {action.dueDate && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(action.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <h4 className="font-medium text-sm text-foreground truncate">{action.title}</h4>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{action.description}</p>
                    </div>
                    <Link href={action.type === 'workflow' || action.type === 'stage' ? `/workflows/${action.relatedId}` : action.type === 'asset' ? `/assets` : `/alerts`}>
                      <div className="h-8 w-8 rounded-full border border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all cursor-pointer">
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center h-full">
                <Activity className="h-8 w-8 mb-2 opacity-20" />
                <p>No priority actions pending.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Bottlenecks */}
        <Card className="bg-card border-border/50 shadow-md flex flex-col">
          <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Critical Bottlenecks</CardTitle>
              <CardDescription>Workflows stuck in current stage</CardDescription>
            </div>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto max-h-[350px]">
            {isLoadingBottlenecks ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : bottlenecks && bottlenecks.length > 0 ? (
              <div className="divide-y divide-border/50">
                {bottlenecks.map((bottleneck, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    key={`${bottleneck.workflowId}-${bottleneck.stageId}`} 
                    className="p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Link href={`/workflows/${bottleneck.workflowId}`} className="font-medium text-sm hover:text-primary hover:underline truncate mr-2">
                        {bottleneck.workflowTitle}
                      </Link>
                      <StoplightBadge status={bottleneck.stoplight} label={`${bottleneck.daysStuck} DAYS STUCK`} className="shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Stage:</span>
                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{bottleneck.stageName || 'Unknown'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 bg-background p-2 rounded border border-border/50">
                      <span className="font-semibold text-foreground mr-1">Impact:</span> 
                      {bottleneck.impact}
                    </p>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center h-full">
                <Activity className="h-8 w-8 mb-2 opacity-20" />
                <p>System flowing smoothly. No bottlenecks.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ScoreCard({ title, score, stoplight, insight, icon: Icon, isLoading, colorClass }: any) {
  return (
    <Card className="bg-card border-border/50 shadow-sm relative overflow-hidden group hover:border-primary/50 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-md bg-muted/50 ${colorClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="font-semibold text-sm tracking-wide text-muted-foreground uppercase">{title}</span>
          </div>
          <StoplightIndicator status={stoplight} size="sm" />
        </div>
        
        {isLoading ? (
          <Skeleton className="h-10 w-24" />
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-4xl font-bold tracking-tight">{score}</span>
              <span className="text-sm font-medium text-muted-foreground">/100</span>
            </div>
            {insight && (
              <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{insight}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
