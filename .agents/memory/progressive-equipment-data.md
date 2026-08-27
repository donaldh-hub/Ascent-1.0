# Progressive equipment data + compounding value (parked feature)

Status: parked, not started. Flagged the same night as the flagged-issues
and interactive-Jordan features — this one is a data-model + product-
philosophy idea, not just a UI feature.

## The ask

Sites need to record structured equipment detail, at two different levels:

- **Per-unit**: does the unit have a full split AC or a wall-mounted unit?
  Does it come with a stove/refrigerator? Does it have its own hot water
  tank?
- **Per-building**: does the building have a boiler instead of individual
  tanks? A boiler implies a shared water storage system, not per-unit hot
  water tanks — these are structurally different and the system needs to
  know which one applies, not assume one.
- **Maintenance cadence per piece of equipment**: sites do PM on a
  schedule — quarterly, semi-annual, or annual — for furnaces, hot water
  tanks/boilers, AC units. The system should track when each was last
  serviced and when it's next due.

## The product philosophy behind it (important — shapes how this gets built)

User's own framing: "the longer they have the subscription and the more
information they add into the system is gonna give them stronger
responses. That's the nature of the app, essentially."

This means: don't require this data upfront. Encourage sites to add it
progressively as they do their real PM work, and design the UX so adding
detail is low-friction and clearly pays off (richer asset intelligence,
better warranty tracking, better Jordan answers) — a genuine incentive
loop, not a mandatory onboarding form. This is a retention/stickiness
mechanic as much as a data feature: value should visibly compound the
longer and more thoroughly a site uses the system.

## Connects to existing infrastructure — extend, don't duplicate

This is not a new subsystem. It should build on:
- **Asset Registry** (Build 9.0, `asset-registry-service.ts`) — assets
  already have `assetType`, `name`, `serial`, `warrantyExpiration`.
  Today's `assetType` is a generic string ("HVAC Unit") — this feature
  needs a real equipment taxonomy (split AC vs. wall unit, tank vs.
  boiler, etc.), likely structured attributes rather than a free-text
  type field, plus a way to say "no hot water tank, this building has a
  boiler" at the property/building level rather than per-unit.
- **PM Mapping Readiness** (Build 7.5, locked baseline — do not alter its
  existing alias detection/status derivation/confidence logic per
  replit.md's own lock note) — the reporting side that already classifies
  preventative-maintenance-style work orders. This feature is upstream of
  that: richer equipment data should feed better PM classification and
  scheduling, not replace or duplicate the existing PM reporting logic.
- **Warranty Intelligence** (Build 9.1) — warranty tracking already exists
  per-asset; PM due-dates are a natural sibling concept, not a new engine.

## Rough shape (not designed in detail yet)

- Extend the asset/equipment data model with structured type attributes
  (not free text) for the specific distinctions given: AC type (split/wall),
  water heating type (tank/boiler+storage), unit-level appliance presence
  (stove/fridge included y/n).
- A per-equipment "last serviced" / "next due" pair, with a configurable
  cadence (quarterly/semi-annual/annual) — probably a new field set on
  the asset record rather than a whole new table, unless PM scheduling
  needs its own history log (likely does, for "last 3 services" type
  views).
- Progressive-entry UX: low-friction prompts to add/update equipment
  detail at natural moments (e.g., while logging a PM work order for a
  unit that doesn't yet have equipment detail on file) rather than a
  big upfront form.
- Needs a design pass on the boiler-vs-tank distinction specifically —
  it's a building-level fact that changes what "per-unit hot water tank
  PM" even means for that property, so it should probably gate/adjust
  which equipment fields are even asked for on units in that building.

## Next step when picked up

Don't design this in isolation from the PM Mapping Readiness lock notes in
replit.md — read those first, since this feature sits directly upstream
of locked PM reporting logic and must not require changing it.
