import { BrainCircuit } from "lucide-react";
import { OperationsCoachPanel } from "@/components/coach/operations-coach-panel";

export default function CoachPage() {
  return (
    <div className="space-y-6" data-testid="coach-page">
      <div>
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Operations Coach</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          AI-powered recommendations based on your operational data.
        </p>
      </div>
      <OperationsCoachPanel />
    </div>
  );
}
