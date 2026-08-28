import { useState } from "react";
import { Mail, Copy, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EmailDraft {
  subject: string;
  body: string;
  suggestedRecipients: { name: string | null; email: string }[];
}

/**
 * Jordan drafts, the human sends — same pattern as the Supervisor Outreach
 * card on the Property Control Tower. Ascent never sends this itself; the
 * mailto link just pre-fills the user's own email client so they review
 * and send it under their own name.
 */
export function EmailDraftCard({ draft }: { draft: EmailDraft }) {
  const [copied, setCopied] = useState(false);

  const toAddresses = draft.suggestedRecipients.map((r) => r.email).join(",");
  const mailtoHref = `mailto:${encodeURIComponent(toAddresses)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;

  function handleCopy() {
    navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
        Draft email — review before sending
      </p>
      <p className="text-sm font-semibold text-foreground">{draft.subject}</p>
      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{draft.body}</p>
      {draft.suggestedRecipients.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          To: {draft.suggestedRecipients.map((r) => r.name || r.email).join(", ")}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <a href={mailtoHref} className="flex-1">
          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5">
            <Mail className="h-3 w-3" />
            Open in Email
          </Button>
        </a>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 shrink-0" onClick={handleCopy}>
          {copied ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-status-green" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
