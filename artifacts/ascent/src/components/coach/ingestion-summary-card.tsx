import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

interface IngestionSummary {
  headline: string;
  recommendations: string[];
  createdAt: string;
}

/**
 * Jordan's explanation of the most recent report upload — persisted
 * separately from the upload flow itself (jordan-ingestion-summary.ts)
 * so it keeps showing on Control Tower after the upload toast is gone,
 * not just at the moment of upload. Renders nothing until a real upload
 * has produced one; the Control Tower's own tiles/cards are unaffected
 * either way — this only adds the "what does this mean" layer on top.
 */
export function IngestionSummaryCard() {
  const [data, setData] = useState<IngestionSummary | null>(null);

  useEffect(() => {
    fetch("/api/coach/ingestion-summary/latest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: IngestionSummary | null) => setData(d))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  return (
    <div
      className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-4"
      data-testid="jordan-ingestion-summary"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Jordan's take on your latest upload</h2>
      </div>
      <p className="text-sm text-foreground/90">{data.headline}</p>
      <ol className="mt-2 space-y-1 list-decimal list-inside">
        {data.recommendations.map((rec, i) => (
          <li key={i} className="text-xs text-muted-foreground">{rec}</li>
        ))}
      </ol>
    </div>
  );
}
