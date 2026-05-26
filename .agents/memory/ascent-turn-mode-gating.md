---
name: Ascent turn reporting-mode gating
description: How the Turn/Work-Order Reporting Mode (Build 7.2.1) must gate confident turn signals across the Ascent UI when mode is Unknown.
---

# Rule
When the active reporting mode is `hybrid_or_unknown` (a.k.a. Unknown), every confident turn conclusion in the Ascent app must be suppressed — not just the dedicated Turn tile. That includes:
- the Turn tile score + drill signals on `/control-tower`
- the `turnScore` contribution to the OHS composite (and the "Turn score" metric line inside the OHS tile)
- the stats strip, Bottleneck Intelligence, Stage Congestion, Property Breakdown, and Turn Records list on `/turns`
- any turn-derived priority actions

**Why:** Gating only the headline tile leaks confidence into adjacent surfaces (the OHS composite re-derives a number from `turnScore`; `/turns` aggregates keep rendering "30 blocked / 10 in rework"). Code review caught this regression in Build 7.4 — the spec language is "no confident turn conclusions when mode is Unknown", which is a property of the whole UI, not one tile.

**How to apply:**
- Use `gateTurnConfidentSignals(mode)` from `artifacts/ascent/src/components/reports/turn-language.ts` everywhere — never re-implement the check.
- When adding any new turn visual that aggregates or scores, wrap it in `!turnGated && …` and add a comment naming the rule.
- Composite scores (OHS, future master scores) must filter out turn-derived parts when gated.
- Mode → signal-source mapping must come from `deriveTurnSignalSource()` in `artifacts/api-server/src/services/reporting-config-service.ts` — do not duplicate the if-chain in routes.
