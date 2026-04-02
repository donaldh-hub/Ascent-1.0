import { useState } from "react";
import { useListAlerts, useMarkAlertRead } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, AlertCircle, AlertTriangle, Info, Check, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export default function Alerts() {
  const [filter, setFilter] = useState<string>("all");
  const { data: alerts, isLoading, refetch } = useListAlerts();
  const markReadMutation = useMarkAlertRead();

  const handleMarkRead = (id: number) => {
    markReadMutation.mutate({ id }, {
      onSuccess: () => {
        refetch();
      }
    });
  };

  const handleMarkAllRead = () => {
    // In a real app we'd have a markAllRead endpoint, 
    // here we just iterate for demo purposes or wait for backend support
    alerts?.filter(a => !a.isRead).forEach(a => {
      markReadMutation.mutate({ id: a.id });
    });
    setTimeout(() => refetch(), 500);
  };

  const filteredAlerts = alerts?.filter(alert => {
    if (filter === "unread") return !alert.isRead;
    if (filter === "critical") return alert.severity === "critical";
    return true;
  });

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="h-5 w-5 text-status-red" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-status-yellow" />;
      case 'info': return <Info className="h-5 w-5 text-primary" />;
      default: return <Bell className="h-5 w-5" />;
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alert Center</h1>
          <p className="text-muted-foreground mt-1 text-sm">System notifications and escalations</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant={filter === "all" ? "default" : "outline"} 
            size="sm" onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button 
            variant={filter === "unread" ? "default" : "outline"} 
            size="sm" onClick={() => setFilter("unread")}
          >
            Unread
          </Button>
          <Button 
            variant={filter === "critical" ? "destructive" : "outline"} 
            size="sm" onClick={() => setFilter("critical")}
            className={filter !== "critical" ? "text-status-red hover:text-status-red" : ""}
          >
            Critical
          </Button>
        </div>
      </div>

      <div className="flex justify-between items-center px-1">
        <span className="text-sm text-muted-foreground font-medium">
          {filteredAlerts?.length || 0} alerts found
        </span>
        <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-xs">
          <CheckCircle2 className="h-4 w-4 mr-2" /> Mark all read
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="bg-card">
              <CardContent className="p-4 flex gap-4">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="space-y-2 w-full">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : filteredAlerts?.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground bg-card/50 rounded-lg border border-dashed border-border">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-20 text-status-green" />
            <h3 className="text-lg font-medium text-foreground">All caught up</h3>
            <p className="mt-1 text-sm">No alerts matching your criteria.</p>
          </div>
        ) : (
          <AnimatePresence>
            {filteredAlerts?.map((alert) => (
              <motion.div
                key={alert.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <Card className={cn(
                  "bg-card transition-all relative overflow-hidden",
                  !alert.isRead ? "border-l-4 border-l-primary" : "border-border opacity-70",
                  alert.severity === 'critical' && !alert.isRead ? "border-l-status-red shadow-[0_0_10px_rgba(239,68,68,0.1)]" : ""
                )}>
                  <CardContent className="p-4 flex gap-4 items-start">
                    <div className={cn(
                      "mt-1 p-2 rounded-full",
                      alert.severity === 'critical' ? "bg-red-500/10" :
                      alert.severity === 'warning' ? "bg-yellow-500/10" : "bg-primary/10"
                    )}>
                      {getSeverityIcon(alert.severity)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className={cn("text-base font-medium pr-4", !alert.isRead ? "text-foreground" : "text-muted-foreground")}>
                          {alert.title}
                        </h4>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className={cn("text-sm mb-2", !alert.isRead ? "text-muted-foreground" : "text-muted-foreground/70")}>
                        {alert.message}
                      </p>
                      <div className="flex gap-2 text-xs font-semibold">
                        <span className="bg-secondary px-2 py-0.5 rounded text-secondary-foreground uppercase tracking-wider">
                          {alert.type.replace('_', ' ')}
                        </span>
                        {alert.workflowId && <span className="bg-secondary px-2 py-0.5 rounded text-muted-foreground">WF: {alert.workflowId}</span>}
                        {alert.assetId && <span className="bg-secondary px-2 py-0.5 rounded text-muted-foreground">AST: {alert.assetId}</span>}
                      </div>
                    </div>

                    {!alert.isRead && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => handleMarkRead(alert.id)}
                        className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                        title="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
