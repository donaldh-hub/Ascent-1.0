import { useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed to send login link");
      const data = await res.json();
      setDevLoginUrl(data.stubbed ? data.loginUrl : null);
      setStatus("sent");
    } catch {
      setError("Something went wrong. Try again.");
      setStatus("idle");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        <div className="flex items-center gap-2 justify-center">
          <Activity className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg tracking-wider text-primary">
            ASCENT <span className="text-muted-foreground text-sm font-normal">1.0</span>
          </span>
        </div>

        {status === "sent" ? (
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              If that email has an account, a login link is on its way.
            </p>
            {devLoginUrl && (
              <div className="rounded-lg border border-border bg-card p-4 text-left space-y-2">
                <p className="text-xs text-muted-foreground">
                  No email provider is configured yet, so here's the link directly:
                </p>
                <a href={devLoginUrl} className="text-sm text-primary break-all underline">
                  {devLoginUrl}
                </a>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="email"
              required
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-login-email"
            />
            <Button type="submit" className="w-full" disabled={status === "sending"} data-testid="button-send-link">
              {status === "sending" ? "Sending..." : "Email me a login link"}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
