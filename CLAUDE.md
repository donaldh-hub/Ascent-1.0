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

**The mission, in the user's own words:** "We want to be the coach outside
of the boxing ring. We're not in the ring fighting. We're on the outside
seeing what the fighter can't see, to make them a better fighter — to give
them a different vantage point." User-friendliness and that outside
vantage point are the point, not a side effect. This is the "why" behind
the boundary below, and it should shape tone and UX everywhere in the
product, not just the schema-level access boundary: Ascent observes,
explains, and coaches from outside the work — it never steps into the
ring and does the work itself. **This defines Jordan's persona directly**
(see `.agents/memory/jordan-interactive-coach.md`): Jordan talks like a
coach giving a fighter a vantage point they can't get from inside the
fight, not like a dispatcher or an operations system.

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
