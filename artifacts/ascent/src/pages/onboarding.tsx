import { useState } from "react";
import { useLocation } from "wouter";
import { Activity } from "lucide-react";
import { WorkOrderUploadPanel } from "@/components/upload/work-order-upload-panel";
import { DemoDataPanel } from "@/components/upload/demo-data-panel";
import { JordanChatBubble } from "@/components/coach/jordan-chat-bubble";
import { SubscribeWall } from "@/components/onboarding/subscribe-wall";

export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const [uploaded, setUploaded] = useState(false);
  const [walkthroughDone, setWalkthroughDone] = useState(false);

  if (walkthroughDone) {
    return (
      <SubscribeWall onSubscribed={() => navigate("/control-tower")} />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-8 py-6 max-w-3xl mx-auto">
        <Activity className="h-6 w-6 text-primary" />
        <span className="font-bold text-lg tracking-wider text-primary">
          ASCENT <span className="text-muted-foreground text-sm font-normal">1.0</span>
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-8 pb-24 space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Let's get your first report in front of Jordan
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            Upload a work order export or load a demo dataset. As soon as your data is in,
            Jordan reviews it and walks you through what it found.
          </p>
        </div>

        <WorkOrderUploadPanel onSuccess={() => setUploaded(true)} />

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex-1 border-t border-border" />
          <span>OR</span>
          <div className="flex-1 border-t border-border" />
        </div>

        <div>
          <p className="text-sm text-muted-foreground mb-3">Explore with a demo dataset instead</p>
          <DemoDataPanel onChange={() => setUploaded(true)} />
        </div>
      </main>

      {uploaded && (
        <JordanChatBubble forceOpen onOnboardingComplete={() => setWalkthroughDone(true)} />
      )}
    </div>
  );
}
