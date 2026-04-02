import { useState } from "react";
import { useGetAnalyticsTrends, useGetWorkflowPerformance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StoplightBadge } from "@/components/stoplight";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from "recharts";

export default function Analytics() {
  const [days, setDays] = useState("30");
  const { data: trends, isLoading: isTrendsLoading } = useGetAnalyticsTrends({ days: Number(days) });
  const { data: performance, isLoading: isPerfLoading } = useGetWorkflowPerformance();

  // Transform trend data for recharts
  const chartData = trends ? trends.dates.map((date, i) => ({
    date: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    health: trends.operationalHealth[i],
    flow: trends.flowScore[i],
    risk: trends.riskScore[i],
    execution: trends.executionScore[i]
  })) : [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full pb-12">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics & Trends</h1>
          <p className="text-muted-foreground mt-1 text-sm">Historical operational performance</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[150px] bg-card border-border">
            <SelectValue placeholder="Select timeframe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 Days</SelectItem>
            <SelectItem value="30">Last 30 Days</SelectItem>
            <SelectItem value="90">Last 90 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-card border-border shadow-md">
        <CardHeader>
          <CardTitle>System Health Trend</CardTitle>
          <CardDescription>Overall operational health over time</CardDescription>
        </CardHeader>
        <CardContent>
          {isTrendsLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Line type="monotone" dataKey="health" name="Operational Health" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Component Scores</CardTitle>
            <CardDescription>Flow, Risk, and Execution tracking</CardDescription>
          </CardHeader>
          <CardContent>
            {isTrendsLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Line type="monotone" dataKey="flow" name="Flow" stroke="#60a5fa" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="risk" name="Risk (Lower is Better)" stroke="#f87171" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="execution" name="Execution" stroke="#4ade80" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Workflow Performance Board</CardTitle>
            <CardDescription>Top active workflows by completion rate</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isPerfLoading ? (
              <div className="p-6"><Skeleton className="h-48 w-full" /></div>
            ) : (
              <div className="overflow-auto max-h-[280px]">
                <Table>
                  <TableHeader className="bg-secondary/50 sticky top-0">
                    <TableRow className="border-border/50">
                      <TableHead>Workflow</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Completion %</TableHead>
                      <TableHead className="text-right">Bottlenecks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performance?.slice(0, 5).map((perf) => (
                      <TableRow key={perf.workflowId} className="border-border/50 hover:bg-secondary/20">
                        <TableCell className="font-medium truncate max-w-[150px]">{perf.title}</TableCell>
                        <TableCell>
                          <StoplightBadge status={perf.stoplight} label={perf.healthScore.toString()} className="px-1.5" />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-muted rounded-full">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${perf.completionRate}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{perf.completionRate}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={perf.bottleneckCount > 0 ? "text-status-red font-bold" : "text-muted-foreground"}>
                            {perf.bottleneckCount}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
