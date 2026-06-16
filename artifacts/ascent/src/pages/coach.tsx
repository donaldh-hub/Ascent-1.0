import { useEffect, useState } from "react";
import { BrainCircuit } from "lucide-react";
import { JordanActivationFlow } from "@/components/coach/jordan-activation-flow";
import { WeeklySummaryPanel } from "@/components/coach/weekly-summary-panel";
import { OperationsCoachPanel } from "@/components/coach/operations-coach-panel";

interface Prefs {
  coachName: string;
  activationCompleted: boolean;
}

export default function CoachPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPrefs = () => {
    setLoading(true);
    fetch("/api/coach/preferences")
      .then((r) => r.json())
      .then((d: Prefs) => setPrefs(d))
      .catch(() => setPrefs({ coachName: "Jordan", activationCompleted: true }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadPrefs(); }, []);

  if (loading) return null;

  if (prefs && !prefs.activationCompleted) {
    return <JordanActivationFlow onComplete={loadPrefs} />;
  }

  const coachName = prefs?.coachName ?? "Jordan";

  return (
    <div className="space-y-6" data-testid="coach-page">
      <div>
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">{coachName}</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Your Operations Coach — working from your data, every week.
        </p>
      </div>
      <WeeklySummaryPanel />
      <OperationsCoachPanel />
    </div>
  );
}
