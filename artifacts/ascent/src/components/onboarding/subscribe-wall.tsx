import { useState } from "react";
import { BrainCircuit, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  coachName?: string;
  onSubscribed: () => void;
}

export function SubscribeWall({ coachName = "Jordan", onSubscribed }: Props) {
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      await fetch("/api/account/subscribe", { method: "POST" });
    } catch {
      /* mock flow — proceed regardless */
    }
    setLoading(false);
    onSubscribed();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <BrainCircuit className="w-6 h-6 text-primary" />
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
            Operations Coach
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          You've met {coachName}. Ready to keep the conversation going?
        </h1>

        <p className="text-base text-muted-foreground leading-relaxed">
          Subscribing unlocks your full Operations Coach, weekly summaries, and the
          complete reporting dashboard — Control Tower, work orders, turns, and everything
          {" "}{coachName} watches week over week. No surprises, no hard sell — just the
          rest of what you came here for.
        </p>

        <div className="rounded-lg border border-border bg-card p-4 text-left space-y-2">
          <FeatureLine text="Weekly summaries from your real data" />
          <FeatureLine text="Full Operations Coach recommendations" />
          <FeatureLine text="Complete reporting dashboard and Control Tower" />
        </div>

        <Button size="lg" onClick={handleSubscribe} disabled={loading} className="w-full">
          {loading ? "Subscribing…" : "Subscribe"}
        </Button>
      </div>
    </div>
  );
}

function FeatureLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <CheckCircle2 className="h-4 w-4 text-status-green shrink-0" />
      <span>{text}</span>
    </div>
  );
}
