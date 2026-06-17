import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrainCircuit, X, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  id: number;
  role: "jordan" | "user" | "system";
  content: ReactNode;
}

interface Prefs {
  coachName: string;
  communicationStyle: string;
  activationCompleted: boolean;
}

interface WeeklySummary {
  openingStatement: string;
  oneRecommendation: string;
  pillars: {
    work_orders: { narrative: string };
  };
}

interface Recommendation {
  topPriority?: { description: string };
  insights?: { description: string }[];
}

interface JordanChatBubbleProps {
  forceOpen?: boolean;
  onOnboardingComplete?: () => void;
}

let nextId = 1;
const mkId = () => nextId++;

export function JordanChatBubble({ forceOpen = false, onOnboardingComplete }: JordanChatBubbleProps) {
  const [open, setOpen] = useState(forceOpen);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [coachName, setCoachName] = useState("Jordan");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "ask-name" | "ask-style" | "findings" | "closing" | "done" | "ongoing"
  >("idle");
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/coach/preferences")
      .then((r) => r.json())
      .then((p: Prefs) => {
        setPrefs(p);
        setCoachName(p.coachName || "Jordan");
        if (!p.activationCompleted && forceOpen && !startedRef.current) {
          startedRef.current = true;
          setOpen(true);
          beginOnboarding();
        } else if (p.activationCompleted) {
          setHasNew(true);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const pushMessage = (role: Message["role"], content: ReactNode, delay = 0): Promise<void> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        setMessages((prev) => [...prev, { id: mkId(), role, content }]);
        resolve();
      }, delay);
    });
  };

  const patchPrefs = async (patch: object) => {
    try {
      await fetch("/api/coach/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      /* non-blocking */
    }
  };

  const beginOnboarding = async () => {
    await pushMessage(
      "jordan",
      "Hi. I just finished reviewing your data for the first time. I'm your Operations Coach and I'm here every week to help you stay ahead of what's happening across your properties.",
      400
    );
    await pushMessage(
      "jordan",
      "Before we get into what I found, I want to ask — what would you like to call me?",
      600
    );
    setPhase("ask-name");
  };

  const submitName = async () => {
    const name = nameInput.trim() || "Jordan";
    setCoachName(name);
    setPhase("idle");
    await patchPrefs({ coachName: name });
    await pushMessage("user", name, 100);
    await pushMessage("jordan", `${name} it is. One more quick question — how do you like to receive your weekly summaries?`, 700);
    setPhase("ask-style");
  };

  const submitStyle = async (style: "bullets" | "narrative") => {
    setPhase("idle");
    await patchPrefs({ communicationStyle: style });
    await pushMessage("user", style === "bullets" ? "Bullet points" : "Written summary", 100);
    await pushMessage("jordan", "Perfect. Now let me show you what I found in your data.", 700);
    await showFindings();
  };

  const showFindings = async () => {
    try {
      const r = await fetch("/api/coach/weekly-summary");
      const summary: WeeklySummary = await r.json();
      await pushMessage("jordan", summary.openingStatement, 800);
      if (summary.pillars?.work_orders?.narrative) {
        await pushMessage("jordan", summary.pillars.work_orders.narrative, 900);
      }
      await pushMessage("jordan", summary.oneRecommendation, 900);
    } catch {
      await pushMessage("jordan", "I had trouble pulling your findings just now, but I'll keep watching your data.", 700);
    }
    await pushMessage(
      "jordan",
      "That's the picture as of today. Every week when you upload your latest data, I'll update everything you just saw. Does this match what you're seeing on the ground?",
      900
    );
    setPhase("closing");
  };

  const finishOnboarding = async () => {
    setPhase("idle");
    await patchPrefs({ activationCompleted: true });
    try {
      await fetch("/api/account/complete-onboarding", { method: "POST" });
    } catch {
      /* non-blocking */
    }
    setPhase("done");
    onOnboardingComplete?.();
  };

  const beginOngoing = async () => {
    if (messages.length > 0) return;
    await pushMessage("jordan", `Hey, it's ${coachName}. Want a quick read on what's happening, or should I tell you what to focus on this week?`, 200);
    setPhase("ongoing");
  };

  const showWeeklySummary = async () => {
    setPhase("idle");
    await pushMessage("user", "What's my weekly summary?", 100);
    try {
      const r = await fetch("/api/coach/weekly-summary");
      const summary: WeeklySummary = await r.json();
      await pushMessage("jordan", summary.openingStatement, 600);
      await pushMessage("jordan", summary.oneRecommendation, 800);
    } catch {
      await pushMessage("jordan", "I couldn't pull the latest summary just now — try again in a moment.", 600);
    }
    setPhase("ongoing");
  };

  const showFocus = async () => {
    setPhase("idle");
    await pushMessage("user", "What should I focus on this week?", 100);
    try {
      const r = await fetch("/api/coach/recommendations");
      const rec: Recommendation = await r.json();
      const top = rec.topPriority?.description ?? rec.insights?.[0]?.description ?? "Nothing urgent is flagged right now — keep the upload cadence going.";
      await pushMessage("jordan", top, 600);
    } catch {
      await pushMessage("jordan", "I couldn't pull recommendations just now — try again in a moment.", 600);
    }
    setPhase("ongoing");
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    setHasNew(false);
    if (next && prefs?.activationCompleted) {
      beginOngoing();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[380px] max-h-[600px] flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/40 shrink-0">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{coachName}</span>
              <span className="text-xs text-muted-foreground">Operations Coach</span>
            </div>
            {!forceOpen && (
              <button onClick={toggleOpen} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-[200px]">
            {messages.map((m) => (
              <ChatBubbleMessage key={m.id} role={m.role} coachName={coachName}>
                {m.content}
              </ChatBubbleMessage>
            ))}

            {phase === "ask-name" && (
              <div className="flex gap-2 pt-1 animate-in fade-in duration-300">
                <Input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Jordan"
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitName();
                  }}
                />
                <Button size="sm" onClick={submitName}>
                  That works
                </Button>
              </div>
            )}

            {phase === "ask-style" && (
              <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-300">
                <button
                  onClick={() => submitStyle("bullets")}
                  className="rounded-md border border-border p-2.5 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <p className="font-medium text-xs">Bullet points</p>
                  <p className="text-[11px] text-muted-foreground">Concise and scannable</p>
                </button>
                <button
                  onClick={() => submitStyle("narrative")}
                  className="rounded-md border border-border p-2.5 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <p className="font-medium text-xs">Written summary</p>
                  <p className="text-[11px] text-muted-foreground">Short narrative</p>
                </button>
              </div>
            )}

            {phase === "closing" && (
              <div className="pt-1 animate-in fade-in duration-300">
                <Button size="sm" onClick={finishOnboarding}>
                  Got it — let's go
                </Button>
              </div>
            )}

            {phase === "ongoing" && (
              <div className="flex flex-col gap-2 pt-1 animate-in fade-in duration-300">
                <Button size="sm" variant="outline" onClick={showWeeklySummary} className="justify-start">
                  Give me the weekly summary
                </Button>
                <Button size="sm" variant="outline" onClick={showFocus} className="justify-start">
                  What should I focus on this week?
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {!forceOpen && (
        <button
          onClick={toggleOpen}
          className={`relative h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:scale-105 transition-transform ${
            hasNew ? "animate-pulse" : ""
          }`}
          title={coachName}
        >
          {hasNew && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-status-green border-2 border-background" />
          )}
          {open ? <ChevronUp className="h-6 w-6" /> : <BrainCircuit className="h-6 w-6" />}
        </button>
      )}
    </div>
  );
}

function ChatBubbleMessage({
  role,
  coachName,
  children,
}: {
  role: Message["role"];
  coachName: string;
  children: ReactNode;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="max-w-[80%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <BrainCircuit className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}
