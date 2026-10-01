# Move-In / Move-Out Inspection Intelligence (parked idea)

Logged 2026-10-01 · Lane: Ascent 1.0 · Status: **parked** · Waiting on:
(1) the cheap photo-pair test, (2) the user's call on the positioning
conflict below · Connects to: Turn Performance tile, work orders,
Asset Registry / `progressive-equipment-data.md`, documentation integrity,
`flagged-issues-feature.md`, `jordan-interactive-coach.md`.

## The original idea (from a chat strategy session)

A module inside Ascent (not a fourth product). Resident does a guided
room-by-room move-in checklist with photos and signs off; at move-out
the app shows the move-in photo beside the new one. Office dashboard
lists units due; AI pairs photos, labels "normal wear" vs "possible
damage," drafts a line item with a repair estimate. Staff approve before
anything reaches a resident. Reuse ideas: flagged damage auto-creates a
work order, repair cost feeds turn cost/time, appliance photos feed asset
and warranty records. Park: Jai coaching residents through move-out.

## Positioning conflict — flagged, NOT decided (core.md §3)

CLAUDE.md locks Ascent as a Maintenance Intelligence Layer. Three parts of
the original idea cross that line as written:

| Original piece | Locked rule it hits |
|---|---|
| Resident-facing checklist app, resident sign-off | "Communicate with residents" |
| Drafted damage charges / deposit line items | "Collect rent or maintain ledgers" (deposits live in Yardi/RealPage) |
| Flagged damage auto-creates a work order in Ascent | "Create and dispatch work orders" |

Only the user can change the boundary. Two paths:

- **A — Stay in bounds (recommended).** Ascent *ingests* inspection
  records and photos the site already captures (its PMS, an inspection
  app, or a manual upload) and analyzes them. Same loop as flagged
  issues: Ascent identifies and explains -> the org acts in its own
  system -> Ascent measures whether it improved.
- **B — Change the boundary.** Resident capture + charge drafting become
  part of Ascent. That is an operations product, with resident support,
  deposit-law liability, and competition with existing inspection apps.
  If wanted at all, it fits better as a separate product later.

## Path A design sketch (from reading the repo, no code written)

Builds on what exists — extend, don't duplicate:
- `turnsTable` already has an `Inspection` stage and `inspectionPassed`.
- `documentsTable` already supports `documentType` `inspection`/`photo`
  and `linkedEntityType` `unit` -> photos need no new storage table.
- `REPORTING_SOURCE_REGISTRY` (`reporting-source-registry.ts`) -> add an
  `inspections` source so it flows through the shared ingestion pipeline
  (see `ingestion-connection-ladder.md`).

New tables (proposed):
1. `inspections` — unit, property, turn link (nullable), type
   (`move_in`/`move_out`), inspected_at, source, import_batch_id, raw_data.
2. `inspection_items` — inspection, room, item, recorded condition,
   photo document id, note.
3. `inspection_comparisons` — move-in item, move-out item, change label
   (`no_change`/`normal_wear`/`possible_damage`/`unclear`), confidence
   0–1, model version, explanation text, `review_status`
   (`unreviewed`/`confirmed`/`rejected`), reviewed_by, reviewed_at.
   AI suggests, a person confirms — the "human in the loop" survives in
   Path A as a review of the *finding*, not approval of a charge.

Intelligence it produces (what makes it Ascent):
- Documentation integrity: move-outs with no matching move-in record or
  photos (pure data check, no AI needed).
- Turn pressure: units where confirmed damage lines up with long
  `Maintenance`/`Rework` days or high turn cost.
- Repeat patterns: same room/item damaged across turns in a unit or
  building (ties to repeat-unit detection).
- Asset evidence: appliance/finish condition over time -> Asset Registry.
- Jordan example: "Unit 204's move-out shows possible damage in 3 of 6
  rooms. Its last two turns ran 9+ days in Maintenance. Review whether
  move-in documentation was complete before treating this as an
  isolated turn."

Must respect: turn reporting-mode gating (`ascent-turn-mode-gating.md`) —
inspection-derived turn signals are suppressed when mode is Unknown.
Wear-vs-damage rules must be site-controlled settings, not hard-coded,
and state deposit law must be verified per state before any of this is
shown as anything stronger than an observation.

## Smallest testable version (about one week, after the photo test)

1. Run the photo test first: 5–10 real move-in/move-out pairs (names and
   personal items removed) compared in chat. Record hit/miss per pair.
   If the comparison is unreliable, stop — don't build the AI part.
2. Week build: `inspections` + `inspection_items` tables, CSV/PDF upload
   through the existing ingestion pipeline, and ONE signal — the
   documentation-integrity check (move-outs missing a move-in). No AI,
   no photos compared yet. Proves the data path end to end.
3. Next step: `inspection_comparisons` + the reviewed AI comparison.

## Assumptions to correct
- Sites already capture inspection photos somewhere (PMS or app).
- Turns can be linked to inspections by property + unit + date window.
- No resident ever logs into Ascent.
