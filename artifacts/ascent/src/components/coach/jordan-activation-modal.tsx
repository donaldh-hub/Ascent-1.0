import { useState } from "react";
import { BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "intro" | "style" | "walkthrough";

interface Props {
  onComplete: () => void;
}

export function JordanActivationModal({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [coachName, setCoachName] = useState("Jordan");
  const [saving, setSaving] = useState(false);

  const save = async (patch: object, next?: Step) => {
    setSaving(true);
    try {
      await fetch("/api/coach/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch { /* non-blocking */ }
    setSaving(false);
    if (next) setStep(next);
    else onComplete();
  };

  return (
    // Full-screen overlay — sits above everything
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <BrainCircuit className="w-5 h-5 text-primary" />
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
            Operations Coach
          </span>
        </div>

        {step === "intro" && (
          <div className="space-y-5 animate-in fade-in duration-500">
            <p className="text-lg leading-relaxed">
              Hi. I just finished reviewing your data for the first time. I'm your Operations Coach and I'm here every week to help you stay ahead of what's happening across your properties.
            </p>
            <p className="text-base text-muted-foreground leading-relaxed">
              Before we get into what I found, I want to ask — what would you like to call me? I'll be working with you closely and it's easier if we're on a first-name basis.
            </p>
            <div className="flex gap-3">
              <Input
                value={coachName}
                onChange={(e) => setCoachName(e.target.value)}
                placeholder="Jordan"
                className="max-w-xs"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && coachName.trim())
                    save({ coachName: coachName.trim() }, "style");
                }}
              />
              <Button
                onClick={() => save({ coachName: coachName.trim() || "Jordan" }, "style")}
                disabled={saving || !coachName.trim()}
              >
                That works
              </Button>
            </div>
          </div>
        )}

        {step === "style" && (
          <div className="space-y-5 animate-in fade-in duration-500">
            <p className="text-lg leading-relaxed">
              {coachName} it is. One more quick question before we get started — how do you like to receive your weekly summaries?
            </p>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => save({ communicationStyle: "bullets" }, "walkthrough")}
                disabled={saving}
                className="rounded-lg border border-border p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <p className="font-semibold text-sm mb-1">Bullet points</p>
                <p className="text-xs text-muted-foreground">Concise and scannable — read in two minutes</p>
              </button>
              <button
                onClick={() => save({ communicationStyle: "narrative" }, "walkthrough")}
                disabled={saving}
                className="rounded-lg border border-border p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <p className="font-semibold text-sm mb-1">Written summary</p>
                <p className="text-xs text-muted-foreground">Short narrative that tells the full story</p>
              </button>
            </div>
          </div>
        )}

        {step === "walkthrough" && (
          <div className="space-y-5 animate-in fade-in duration-500">
            <p className="text-lg leading-relaxed">
              Perfect. Now let me show you what I found in your data. I want to be straightforward with you — there are things that need your attention soon, at least one thing that needs your attention now, and a few patterns I'm already starting to watch.
            </p>
            <p className="text-base text-muted-foreground">
              Want me to walk you through it?
            </p>
            <Button
              size="lg"
              onClick={() => save({ activationCompleted: true })}
              disabled={saving}
            >
              Let's go
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
