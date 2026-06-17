import { useLocation } from "wouter";
import { Activity, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRICING_PLANS, PRICING_BUNDLES } from "@/lib/pricing-data";

const FAQ = [
  {
    q: "Is pricing per unit or per site?",
    a: "Per site. One flat price covers the whole property regardless of unit count.",
  },
  {
    q: "What happens when I add a site to a bundle?",
    a: "Sites can be added up to your bundle limit instantly — no new subscription required.",
  },
  {
    q: "What happens when I hit my bundle ceiling?",
    a: "One upgrade to the next tier covers it. No need to juggle multiple subscriptions.",
  },
  {
    q: "Is the first report really free?",
    a: "Yes. Upload your first work order report and see your real Control Tower, with no time limit on viewing it and no credit card required.",
  },
];

export default function PricingPage() {
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
          <Button onClick={() => navigate("/landing")} variant="ghost">
            Home
          </Button>
          <Button onClick={() => navigate("/onboarding")} variant="outline">
            Start Free Trial
          </Button>
        </div>
      </header>

      <section className="px-8 pt-12 pb-16 max-w-4xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          Simple pricing. No unit counts. No surprises.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Every plan starts with a free first report. Subscribe when you're ready to track
          ongoing data, download reports, and add more sites.
        </p>
      </section>

      <section className="px-8 pb-16 max-w-5xl mx-auto">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-6">
            <p className="text-sm font-semibold mb-1">{PRICING_PLANS.site.name}</p>
            <p className="text-3xl font-bold mb-1">
              ${PRICING_PLANS.site.monthly}
              <span className="text-sm text-muted-foreground font-normal">/mo</span>
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Annual ${PRICING_PLANS.site.annual}/mo
            </p>
            <p className="text-xs text-muted-foreground">One site, fully tracked.</p>
          </div>
          {PRICING_BUNDLES.map((b) => (
            <div key={b.name} className="rounded-lg border border-border bg-card p-6">
              <p className="text-sm font-semibold mb-1">{b.name}</p>
              <p className="text-3xl font-bold mb-1">
                ${b.monthly}
                <span className="text-sm text-muted-foreground font-normal">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground mb-4">Annual ${b.annual}/mo</p>
              <p className="text-xs text-muted-foreground">Add sites instantly up to your limit.</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-6 max-w-2xl mx-auto">
          Sites can be added up to your bundle limit instantly — no new subscription required.
          When you hit your bundle ceiling, one upgrade to the next tier covers it. Annual plans
          save 10%.
        </p>
      </section>

      <section className="px-8 pb-16 max-w-3xl mx-auto">
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-semibold mb-3">What's included in every plan</p>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> Your real
              Control Tower, built from your data
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> Unlimited
              coach conversations about your report
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> Ongoing
              weekly uploads and full operational tracking over time
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> Downloadable
              reports
            </li>
          </ul>
        </div>
      </section>

      <section className="px-8 pb-20 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold tracking-tight text-center mb-8">
          Frequently asked questions
        </h2>
        <div className="space-y-4">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-lg border border-border bg-card p-5">
              <p className="font-semibold mb-1.5">{item.q}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-8 pb-20 max-w-3xl mx-auto text-center">
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
