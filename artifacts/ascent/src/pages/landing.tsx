import { useLocation } from "wouter";
import { Activity, BrainCircuit, Upload, TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <header className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg tracking-wider text-primary">
            ASCENT <span className="text-muted-foreground text-sm font-normal">1.0</span>
          </span>
        </div>
        <Button onClick={() => navigate("/onboarding")} variant="outline">
          Start Free Trial
        </Button>
      </header>

      <section className="relative px-8 pt-20 pb-28 max-w-5xl mx-auto text-center">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,theme(colors.primary/15%),transparent_70%)]" />
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-6">
          Operations Coach for Property Management
        </p>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
          Your properties have a story.
          <br />
          <span className="text-primary">Jordan reads it every week.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Upload your work order data and get an AI Operations Coach that finds what's
          slipping, what's repeating, and what needs your attention now — before it
          becomes a tenant complaint or an owner question.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Button size="lg" onClick={() => navigate("/onboarding")} className="gap-2">
            Start Free Trial <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          No credit card required. See your first findings in minutes.
        </p>
      </section>

      <section className="px-8 pb-28 max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-3 gap-6">
          <FeatureCard
            icon={Upload}
            title="Upload your data"
            body="Drop in a CSV export from your work order system — or load a demo dataset to explore first. No integrations to configure."
          />
          <FeatureCard
            icon={BrainCircuit}
            title="Meet your Operations Coach"
            body="Jordan reviews your data and walks you through what it found — direct, practical, no fluff. Name your coach, set your style."
          />
          <FeatureCard
            icon={TrendingUp}
            title="Get weekly insights you can act on"
            body="Every week, a fresh read on aging work orders, repeat issues, and the one thing worth doing next."
          />
        </div>
      </section>

      <footer className="border-t border-border px-8 py-8 max-w-7xl mx-auto text-center text-xs text-muted-foreground">
        Ascent 1.0 — Property Management Operations
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Upload;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-left">
      <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
