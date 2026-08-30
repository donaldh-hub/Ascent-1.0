import { Bot } from "lucide-react";
import { FounderControlCenter } from "@/components/agent-ops/founder-control-center";

/**
 * The Founder Control Center — Chief Operating Agent's own deliverable
 * (Build Sequence step 9). Shows company operating health, exceptions
 * that need a real decision, and consolidated incidents. Routine agent
 * activity stays out of this view by design — see the spec's "Minimum
 * Control Center" requirement.
 */
export default function AgentOpsPage() {
  return (
    <div className="space-y-6" data-testid="agent-ops-page">
      <div>
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Founder Control Center</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          What every agent is doing, what needs your decision, and nothing that doesn't.
        </p>
      </div>

      <FounderControlCenter />
    </div>
  );
}
