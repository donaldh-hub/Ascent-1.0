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

## Combined idea logged 2026-10-01 — resident app as a separate product

Status: **combined / parked**. Came from Path B above + the user's
thinking out loud the same night: a resident-facing photo app could be
its own product and its own revenue line (residents, and possibly
insurance companies), separate from Ascent.

How it stays clean with the positioning boundary: the resident app is a
different product that does the capture. Ascent stays the intelligence
layer and only receives inspection data a property is authorized to see,
the same way it receives Yardi/RealPage exports. Ascent's identity does
not change.

Open questions before any spend:
- Who pays: resident, property, or insurer? Unverified — no market
  research done yet. Validate by talking to 2–3 renters-insurance agents
  and a few residents before building.
- Resident photos are personal data. Sharing them with insurers or a
  property needs explicit resident consent and a privacy policy.
- Tension with the earlier "no fourth product" call (limited money,
  support, and marketing). Decide sequencing: Ascent Path A first, resident
  app later, is the lower-cost order.
- Cross-product idea → also belongs in the Drive Bridge folder (core.md §4).

## Direction update 2026-10-01 — business-only, office side

User's direction: sell to property management companies only. Staff (not
residents) take the photos; Ascent does the move-in vs move-out
comparison and explains what changed. This is Path A plus a staff photo
upload channel — an intelligence layer on top of what sites already do.
Resident app stays parked as a possible later separate product.

Guardrails that keep it in bounds (flag if a design crosses them):
- Photo capture is an *upload channel* (like CSV/email ingestion), not a
  scheduling or inspection-task manager. No assigning inspections, due
  dates per tech, or dispatch.
- Output is findings + evidence ("possible damage, kitchen counter, 0.82,
  photos attached"). No deposit charges or billing line items — the
  office takes findings into its PMS to charge.
- No auto-created work orders. Ascent can say "this looks like repair
  work"; the site creates the work order in its own system.
- Repair cost *estimates* as context for turn-cost intelligence are a
  gray area — decide explicitly before building.

## Combined idea 2026-10-01 — one photo engine, three markets

Status: **combined / parked**. User's "same process, different outcome"
framing: build the photo-comparison engine once, sell it three ways.
1. Property management companies — inside Ascent (direction above).
2. Renters-insurance companies — white-label/add-on for a modest fee.
3. Public/residents — "get your security deposit back" consumer app.

Strategic flags (unresolved, user decides):
- **Sides conflict.** Markets 1 and 3 are opposite sides of a deposit
  dispute. A PM client may not trust Ascent if the same company sells
  tenants a tool to contest its deductions. If 3 happens, use a separate
  brand/company name and keep data fully separate (no tenant photos
  flowing into a landlord's Ascent, or the reverse, without consent).
- **Shared code, separate products.** Share only the comparison engine
  (photo pair -> change label + confidence + explanation). Each market
  gets its own app shell, data store, and terms.
- **Insurance** = long sales cycles, compliance and security review.
  Consumer = marketing spend and support. Both unverified — no market
  research done.
- Sequencing (cheapest first): photo test -> Ascent Path A -> one
  insurance conversation -> consumer app only if Ascent is earning.

## Decisions 2026-10-01 — focus locked to property management side

- **Resident/consumer version: parked.** Kept in memory (sections above),
  revisit later. Not in scope now.
- **Focus: property management companies, office side only.**
- **Charges and costs are the organization's call.** Ascent does not
  estimate repair costs or charges. Resolves the gray area above: Ascent
  reports what changed + evidence; the org decides what to charge in its
  own system.
- **Baseline = make-ready completion photos.** Sites are starting (not
  yet standard) to photograph units when the turn is finished, before
  move-in. That set is the baseline — it ties naturally to turn
  completion (`turnsTable`, stage `Completed`).
- **Tenancy length varies (1–4+ years).** The baseline must be stored
  durably and still be comparable years later.

Design implications (not built):
- Baseline set links to unit + the turn that produced it + tenancy start.
  Move-out set compares against the most recent baseline for that unit.
- Wear expectation should scale with time in unit — 4 years of normal
  wear looks different from 1 year. Show tenancy length beside every
  finding.
- **Differentiator:** work orders during the tenancy explain changes.
  If carpet was replaced in year 2 via a work order, a different carpet
  at move-out is the property's own repair, not damage. Ascent already
  holds work-order history; no inspection app without it can do this.
- Friction targets: room-by-room capture with the baseline photo shown
  as a guide for angle, photos auto-attached to unit (no file naming),
  bulk upload from a phone.
- Storage: photos kept for years -> retention policy and storage cost to
  decide before launch.
