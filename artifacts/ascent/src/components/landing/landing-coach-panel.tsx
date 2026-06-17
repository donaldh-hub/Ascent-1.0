import { useRef, useState, useEffect } from "react";
import { BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTER =
  "You're looking at Riverside Commons — a demo site. Click anything and ask me what it means, or ask me anything about what you're seeing here.";

export function LandingCoachPanel() {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: STARTER }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const question = input.trim();
    if (!question || sending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setSending(true);
    try {
      const r = await fetch("/api/landing-demo/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const data = await r.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer ?? "I couldn't pull an answer just now." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't reach the coach just now — try again in a moment." }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col h-[480px]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/40 shrink-0">
        <BrainCircuit className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Operations Coach</span>
        <span className="text-xs text-muted-foreground">Ask anything about this demo report</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex items-start gap-2"}>
            {m.role === "assistant" && (
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <BrainCircuit className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm"
                  : "max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm leading-relaxed"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && <div className="text-xs text-muted-foreground animate-pulse pl-8">Thinking…</div>}
      </div>

      <div className="flex gap-2 p-3 border-t border-border shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about Unit B-07, the stalled turn, anything…"
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <Button size="sm" onClick={send} disabled={sending}>
          Send
        </Button>
      </div>
    </div>
  );
}
