/**
 * Share + email a coworker.
 *
 * "Share this report" generates a view-only public link tied to the
 * visitor's anonymous session (see backend /api/share/generate). "Email
 * this report" is a stubbed send — no real email provider is wired up yet,
 * so we are upfront in the UI that sending isn't live.
 */
import { useState } from "react";
import { Share2, Copy, Check, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ShareReportPanel() {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const [emailOpen, setEmailOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [emailConfirmation, setEmailConfirmation] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const generateShareLink = async (): Promise<string | null> => {
    setGenerating(true);
    setShareError(null);
    try {
      const r = await fetch("/api/share/generate", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to generate link");
      const url = `${window.location.origin}${data.shareUrl}`;
      setShareUrl(url);
      return url;
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Failed to generate share link.");
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    const url = shareUrl ?? (await generateShareLink());
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenEmail = async () => {
    setEmailOpen(true);
    setEmailConfirmation(null);
    setEmailError(null);
    if (!shareUrl) await generateShareLink();
  };

  const handleSendEmail = async () => {
    setSending(true);
    setEmailError(null);
    try {
      const recipients = emails
        .split(/[,\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);
      if (recipients.length === 0) {
        setEmailError("Enter at least one email address.");
        return;
      }
      const r = await fetch("/api/share/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipients, note: note || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to queue email");
      setEmailConfirmation(
        "Email queued (sending isn't live yet in this environment, but a coworker visiting the share link will see your real report).",
      );
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Failed to queue email.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy} disabled={generating} data-testid="share-report-btn">
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 mr-1 text-status-green" /> Link copied
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5 mr-1" /> {generating ? "Generating…" : "Share this report"}
            </>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={handleOpenEmail} data-testid="email-report-btn">
          <Mail className="w-3.5 h-3.5 mr-1" /> Email this report
        </Button>
      </div>

      {shareError && <p className="text-xs text-amber-600">{shareError}</p>}
      {shareUrl && !emailOpen && (
        <p className="text-xs text-muted-foreground break-all">{shareUrl}</p>
      )}

      {emailOpen && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-md" data-testid="email-report-modal">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Email this report</p>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEmailOpen(false)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sending isn't live yet in this environment — this will log the send and the recipient can still view
            your real report via the link.
          </p>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            placeholder="coworker@example.com, another@example.com"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            placeholder="Optional note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {emailError && <p className="text-xs text-amber-600">{emailError}</p>}
          {emailConfirmation && <p className="text-xs text-status-green">{emailConfirmation}</p>}
          <Button size="sm" onClick={handleSendEmail} disabled={sending} className="w-full">
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}
