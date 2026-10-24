@core.md

# Ascent 1.0 — Agent Instructions

## Workflow
Code is written and pushed to GitHub from Claude Code sessions, then
deployed from here — same pattern as the rest of the Hardaway AI
ecosystem. See `core.md` for the standing operating rules (verification
standards, hard constraints, memory practices) that apply before any
activity in this repo.

## Project-specific add-ons

### Positioning boundary — Maintenance Intelligence Layer, not an operations platform

This is locked positioning per core.md Section 3 ("Ascent 1.0's
positioning, any locked language") — flag a proposed change to this
boundary, don't make it unilaterally.

**The mission, in full (the user's own words, refined the same night):**

> Ascent is the coach outside the ring.

The maintenance team is inside the ring — handling work orders, turns,
emergencies, staffing shortages, and resident needs in real time. They
are too close to the action to see everything. Ascent does not throw the
punches. Ascent watches the entire fight. It sees where the team is
losing time, which problems keep returning, what is draining capacity,
where documentation is breaking down, which properties or units are
creating hidden pressure, what the team is doing well, and what must
change before the next round. Then Ascent gives the manager clear,
evidence-backed guidance: "Here is what I'm seeing. Here is why it
matters. Here are the records that prove it. Here is what you should
examine next."

**Mission statement:** Ascent 1.0 gives maintenance leaders the outside
perspective they cannot get while managing the work — turning existing
operational records into clear, explainable intelligence that helps
teams see problems earlier, make better decisions, and continuously
improve.

**The clearest positioning statements** (use these, don't paraphrase them
into something vaguer): "Your maintenance team works inside the
operation. Ascent stands outside it — seeing patterns, risks, and
opportunities the team may be too close to recognize." Or more simply:
"You manage the work. Ascent helps you see the fight."

**The user-friendly promise — this is specific, not a vibe.** Being
user-friendly does not mean fewer buttons. It means the user should never
need to be a data analyst, a software engineer, a reporting specialist,
an AI expert, or an enterprise systems administrator to get value. They
upload the records they already have and understand: (1) what is
happening, (2) why it is happening, (3) what evidence supports it, (4)
what deserves attention first, (5) what question to ask their team next.
Any feature or UI decision that requires the user to think like one of
those five excluded roles is working against the mission, not toward it.

This is the "why" behind the boundary below, and it should shape tone and
UX everywhere in the product, not just the schema-level access boundary:
Ascent observes, explains, and coaches from outside the work — it never
steps into the ring and does the work itself.

**Ascent 1.0 remains a Maintenance Intelligence Layer, not a maintenance
operations platform.** The product promise: "Your system records the
work. Ascent reveals what the work means."

Ascent will **not** become the place where teams:
- Create and dispatch work orders
- Schedule technicians
- Communicate with residents
- Manage vendors and invoices
- Collect rent or maintain ledgers
- Replace Yardi, RealPage, Voyager, AppFolio, or Entrata
- Run daily maintenance operations

Those systems manage the work. Ascent analyzes what the work reveals.

**What Ascent owns** — receiving operational records and answering: what
is happening; where performance is breaking down; why; which records
prove it; what deserves attention first; what question leadership should
ask next; and whether performance improved after a problem was addressed.
This covers work-order/turn/PM/asset & warranty intelligence, staffing and
workload signals, repeat-unit detection, bottleneck identification,
documentation integrity, risk/trend analysis, portfolio comparisons,
explainable recommendations, and Jordan's grounded analysis.

**Uploads, emailed reports, and future APIs are just different ways of
feeding Ascent information — none of them changes its identity** as an
intelligence layer, not an operations system (see
`.agents/memory/ingestion-connection-ladder.md`).

**Jordan's precise role** (full detail in
`.agents/memory/jordan-interactive-coach.md`): Jordan is the corner
coach, not a dispatcher or maintenance supervisor. It reads the Control
Tower, explains the score, points to supporting records, identifies
blind spots, answers follow-up questions, helps interpret patterns,
compares reporting periods, and measures whether previous decisions
produced improvement. Jordan never says "I completed that work order."
It says something like: "This unit has generated four plumbing-related
work orders in 60 days. Three were closed without a documented cause.
Before treating the latest request as isolated, review the repair
history and determine whether the team is addressing symptoms instead of
the underlying failure." That is coaching through intelligence, not task
management — the distinction is load-bearing for every response Jordan
ever gives.

**This constrains the flagged-issues feature specifically** (see
`.agents/memory/flagged-issues-feature.md`): flagged issues must stay an
intelligence function, not turn into a maintenance-management or team-
communication feature. The loop is: Ascent identifies and explains the
issue -> Ascent shares the intelligence with an authorized person -> the
organization handles execution in its existing operating system (Yardi/
RealPage/etc.), not inside Ascent -> Ascent later measures whether the
underlying signals improved. Do not design an open-ended discussion/
ticketing thread that lets Ascent become a second place to manage the
work itself — a lighter acknowledgment/response mechanism is fine, an
execution-tracking system is not.

### Pricing — decided, locked per core.md Section 3

Decided (not a draft, not one of several options under consideration):
**$40/month base subscription plus a data fee, banded by the property's
unit count** — unit-band pricing, not true per-unit pricing (a 125-unit
property pays the same as a 200-unit property in the same band).

| Site size | Base | Data fee | Monthly total |
|---|---|---|---|
| 0–100 units | $40 | $10 | $50 |
| 101–200 units | $40 | $20 | $60 |
| 201–300 units | $40 | $30 | $70 |
| 301–400 units | $40 | $40 | $80 |
| 401–500 units | $40 | $50 | $90 |
| each additional 100 units | $40 | +$10 | +$10 |

**Customer-facing language (use this, don't paraphrase it looser):**
"Ascent starts at $40 per month, plus a site data fee. Your data fee is
based on your property's 100-unit range and is established during your
First Snapshot."

**Mechanism**: the first uploaded report estimates the site's unit-count
band; the customer then confirms the property's actual total unit count
before the price is finalized. This is a real feature to build (count
units from the uploaded report, show the estimated tier, get the
customer's confirmation), not just page copy — and as of this decision,
no real billing/payment processor is wired up anywhere in either repo
(see `.agents/memory/`'s earlier "simple bridge first, real billing
later" call), so implementing this today means showing the correct
price and capturing the confirmed tier, not collecting payment.

**This supersedes what's currently live.** `donaldh-hub/Ascent-Website`'s
`pricing.tsx` still shows a different structure (Free / "Starting at
$50/mo" / "Add properties as needed" / custom regional) as of this
decision — that page needs to be rebuilt to this table, not left as a
second, conflicting pricing surface.
