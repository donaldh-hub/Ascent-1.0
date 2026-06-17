import { useLocation } from "wouter";
import { Activity, ArrowRight, CheckCircle2, Link2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LandingDemoDashboard } from "@/components/landing/landing-demo-dashboard";
import { LandingCoachPanel } from "@/components/landing/landing-coach-panel";
import { PRICING_PLANS, PRICING_BUNDLES } from "@/lib/pricing-data";

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
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate("/pricing")} variant="ghost">
            Pricing
          </Button>
          <Button onClick={() => navigate("/onboarding")} variant="outline">
            Start Free Trial
          </Button>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative px-8 pt-16 pb-12 max-w-5xl mx-auto text-center">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,theme(colors.primary/15%),transparent_70%)]" />
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-6">
          Operations Coach for Property Management
        </p>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
          Stop managing maintenance from memory.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Ascent turns your work order data into a live operational dashboard — with proof
          behind every signal.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Button size="lg" onClick={() => navigate("/onboarding")} className="gap-2">
            Upload your first report free <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          No credit card required. See your first findings in minutes. Or scroll down to try
          the live demo below.
        </p>
      </section>

      {/* ── Live interactive demo dashboard ───────────────────────────── */}
      <section className="px-8 pb-20 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
          <LandingDemoDashboard />
          <LandingCoachPanel />
        </div>
      </section>

      {/* ── Upload prompt ──────────────────────────────────────────────── */}
      <section className="px-8 pb-20 max-w-4xl mx-auto text-center">
        <h2 className="text-3xl font-bold tracking-tight mb-4">This is what your site could look like.</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
          Upload your first work order report and Ascent will show you exactly what is
          happening, what records prove it, and what needs action first.
        </p>
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-8 text-left">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-semibold mb-2">What you get free</p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> Your real Control Tower, built from your data</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> Unlimited coach conversations about your report</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> No time limit on viewing and exploring</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-semibold mb-2">What unlocks with a subscription</p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" /> Download your report</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" /> Upload ongoing weekly data</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" /> Full operational tracking over time</li>
            </ul>
          </div>
        </div>
        <Button size="lg" onClick={() => navigate("/onboarding")} className="gap-2">
          Upload your first WO report — it's free <ArrowRight className="h-4 w-4" />
        </Button>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────── */}
      <section className="px-8 pb-20 max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight text-center mb-2">Simple pricing. No unit counts. No surprises.</h2>
        <p className="text-center text-muted-foreground mb-10">See full details on the <button onClick={() => navigate("/pricing")} className="text-primary underline">pricing page</button>.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
            <p className="text-sm font-semibold mb-1">{PRICING_PLANS.site.name}</p>
            <p className="text-2xl font-bold mb-1">${PRICING_PLANS.site.monthly}<span className="text-sm text-muted-foreground font-normal">/mo</span></p>
            <p className="text-xs text-muted-foreground">Annual ${PRICING_PLANS.site.annual}/mo</p>
          </div>
          {PRICING_BUNDLES.map((b) => (
            <div key={b.name} className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm font-semibold mb-1">{b.name}</p>
              <p className="text-2xl font-bold mb-1">${b.monthly}<span className="text-sm text-muted-foreground font-normal">/mo</span></p>
              <p className="text-xs text-muted-foreground">Annual ${b.annual}/mo</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-6 max-w-2xl mx-auto">
          Sites can be added up to your bundle limit instantly — no new subscription required.
          When you hit your bundle ceiling, one upgrade to the next tier covers it.
        </p>
      </section>

      {/* ── ROI ────────────────────────────────────────────────────────── */}
      <section className="px-8 pb-20 max-w-4xl mx-auto text-center">
        <h2 className="text-3xl font-bold tracking-tight mb-4">One warranty catch pays for the year.</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto mb-3 leading-relaxed">
          A missed warranty on a central air repair runs $800–$1,200. A hot water tank repair
          runs around $700. Ascent surfaces warranty risk before you pay out of pocket.
        </p>
        <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Know where your turns are stalling before ownership asks. Not a guess. Not a
          feeling. The records that prove it.
        </p>
      </section>

      {/* ── How sharing works ─────────────────────────────────────────── */}
      <section className="px-8 pb-20 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight text-center mb-8">Share what you found with a coworker.</h2>
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <Link2 className="h-5 w-5 text-primary mb-3" />
            <p className="font-semibold mb-2">Send a link</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Anyone with the link can view your report, chat with the coach about what they
              see, and upload their own site's data for free.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <Mail className="h-5 w-5 text-primary mb-3" />
            <p className="font-semibold mb-2">Email a coworker</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              They land on your real report — not a demo — and can explore it, ask the coach
              questions, and decide if they want to see their own site.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground text-center mt-6">
          They view. They cannot download yours. But they can upload their own data and get
          their first report free. Real data. Real signals. Real peer trust.
        </p>
      </section>

      {/* ── Footer CTA ─────────────────────────────────────────────────── */}
      <section className="px-8 pb-20 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-6">Your site is telling you something. Find out what.</h2>
        <Button size="lg" onClick={() => navigate("/onboarding")} className="gap-2">
          Upload your first WO report free <ArrowRight className="h-4 w-4" />
        </Button>
      </section>

      <footer className="border-t border-border px-8 py-8 max-w-7xl mx-auto text-center text-xs text-muted-foreground">
        Ascent 1.0 — Property Management Operations
      </footer>
    </div>
  );
}
