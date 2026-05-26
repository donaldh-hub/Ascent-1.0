/**
 * Ascent 7.5 — PM Data Mapping Layer
 *
 * Pure helpers that turn raw maintenance text (category, status, dates) into
 * stable PM operational vocabulary. No DB, no IO — every function here is
 * deterministic so the normalizer, analysis engine, and auditor can share
 * one source of truth.
 *
 * Build 7.5 scope:
 *   - Identify which work_order rows are actually PM (alias matching).
 *   - Normalize PM category into a stable list.
 *   - Normalize PM status into a stable list.
 *   - Compute mapping confidence + per-record mapping warnings.
 *
 * Build 7.5 does NOT compute PM scoring, PM recommendations, or PM
 * predictions. That is reserved for Build 7.6+ (PM Rules Layer).
 *
 * PM LANGUAGE RULE (spec §15): never call PM records "turns" or
 * "work orders". This module emits only PM vocabulary.
 */

// ─── Stable PM operational vocabulary ────────────────────────────────────────

export const PM_CATEGORIES = [
  "HVAC",
  "Plumbing",
  "Electrical",
  "Appliance",
  "Life Safety",
  "Exterior",
  "Interior",
  "Grounds",
  "Building Systems",
  "Unit Inspection",
  "Other",
] as const;
export type PmCategory = (typeof PM_CATEGORIES)[number];

export const PM_STATUSES = [
  "Completed",
  "Scheduled",
  "Due Soon",
  "Overdue",
  "Deferred",
  "Canceled",
  "Unknown",
] as const;
export type PmStatus = (typeof PM_STATUSES)[number];

export type PmMappingConfidence = "high" | "medium" | "low";

/**
 * Stable warning codes — UI groups by code, auditor counts by code.
 * Plain-English message is returned alongside for drill-downs.
 */
export const PM_WARNING_CODES = [
  "missing_property",
  "missing_unit",
  "missing_pm_task",
  "missing_pm_category",
  "pm_category_unknown",
  "missing_due_date",
  "missing_completed_date",
  "pm_status_unknown",
  "pm_conflicting_dates",
  "pm_review_required",
] as const;
export type PmWarningCode = (typeof PM_WARNING_CODES)[number];

export interface PmWarning {
  code: PmWarningCode;
  message: string;
}

const PM_WARNING_LABELS: Record<PmWarningCode, string> = {
  missing_property: "Property link is missing.",
  missing_unit: "Unit link is missing.",
  missing_pm_task: "PM task name is missing.",
  missing_pm_category: "PM category is missing.",
  pm_category_unknown: "PM category did not match a known category.",
  missing_due_date: "Due date is missing.",
  missing_completed_date: "Completed date is missing.",
  pm_status_unknown: "PM status could not be confidently determined.",
  pm_conflicting_dates: "Status and date fields disagree (review required).",
  pm_review_required: "Record requires manual review before reporting.",
};

export function pmWarning(code: PmWarningCode): PmWarning {
  return { code, message: PM_WARNING_LABELS[code] };
}

// ─── PM detection (which work_order rows are actually PM?) ───────────────────

/**
 * Patterns that mark a source row as preventative maintenance.
 *
 * Spec §3 (field aliases) + architect 7.5 review: the prior version used a
 * bare "inspection" / "maintenance task" substring match, which would sweep
 * REACTIVE rows like "Move-out Inspection", "Damage Inspection",
 * "Emergency Maintenance Task" into PM and double-count them under both the
 * work_orders and preventative_maintenance views. Patterns are now anchored
 * to clearly-preventative qualifiers (preventative/preventive/routine/
 * annual/semi-annual/quarterly/monthly/scheduled).
 */
const PM_CATEGORY_PATTERNS: RegExp[] = [
  /\bpm\b/i,
  /\bpreventative\b/i,
  /\bpreventive\b/i,
  /\b(preventative|preventive|routine|annual|semi-?annual|quarterly|monthly|scheduled)\s+inspection\b/i,
  /\b(preventative|preventive|routine|scheduled)\s+maintenance\s+task\b/i,
  /\bservice\s+task\b/i,
  /\bscheduled\s+maintenance\b/i,
];

export function looksLikePmCategory(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim();
  if (v.length === 0) return false;
  return PM_CATEGORY_PATTERNS.some((re) => re.test(v));
}

// ─── Category normalization (spec §4) ────────────────────────────────────────

const PM_CATEGORY_ALIASES: Array<[RegExp, PmCategory]> = [
  [/\bhvac\b|air\s?cond|furnace|heater|boiler|thermostat|ventilation/i, "HVAC"],
  [/\bplumb|water heater|drain|leak|faucet|toilet|pipe/i, "Plumbing"],
  [/electric|breaker|outlet|wiring|panel|lighting/i, "Electrical"],
  [/appliance|refrigerator|fridge|dishwasher|stove|oven|microwave|washer|dryer|disposal/i, "Appliance"],
  [/life\s?safety|fire|smoke|extinguisher|alarm|sprinkler|co\s?detector|carbon monoxide/i, "Life Safety"],
  [/exterior|roof|siding|gutter|paint(ing)?\s*ext|window.*ext/i, "Exterior"],
  [/interior|paint(ing)?\s*int|drywall|caulk|seal(ing)?/i, "Interior"],
  [/grounds|landscape|landscaping|lawn|tree|shrub|irrigation|sprinkler\s+system/i, "Grounds"],
  [/building\s?system|elevator|generator|pump|fire\s?pump|hvac\s+system/i, "Building Systems"],
  [/unit\s?inspection|move[-\s]?in|move[-\s]?out|annual\s+inspection|walk(\-?through)?/i, "Unit Inspection"],
];

/**
 * Map a raw category/task string to a stable PmCategory. Returns "Other"
 * when no alias matches — the caller decides whether to attach a
 * "pm_category_unknown" warning based on whether the raw text was empty
 * vs. unrecognized.
 */
export function normalizePmCategory(raw: string | null | undefined): PmCategory {
  if (!raw) return "Other";
  const v = raw.trim();
  if (v.length === 0) return "Other";
  for (const [re, cat] of PM_CATEGORY_ALIASES) {
    if (re.test(v)) return cat;
  }
  return "Other";
}

// ─── Status normalization (spec §5) ──────────────────────────────────────────

const DUE_SOON_WINDOW_DAYS = 7;

export interface PmStatusInput {
  rawStatus: string | null | undefined;
  dueAt: Date | null;
  completedAt: Date | null;
  now?: Date;
}

export interface PmStatusResult {
  status: PmStatus;
  /** True when raw status & dates point in different directions (e.g.
   *  status="completed" but no completedAt; status="scheduled" with a
   *  populated completedAt). Caller should emit pm_conflicting_dates. */
  conflicting: boolean;
}

/**
 * Derive a stable PM status from the raw status text + due/completed dates.
 * Conservative: never invent completion. Spec §5, §6, §13 (no fake completion).
 */
export function normalizePmStatus(input: PmStatusInput): PmStatusResult {
  const now = input.now ?? new Date();
  const raw = (input.rawStatus ?? "").trim().toLowerCase();

  const explicitlyCanceled = raw === "cancelled" || raw === "canceled";
  const explicitlyDeferred = raw === "deferred" || raw === "on hold" || raw === "postponed";
  const explicitlyCompleted = raw === "completed" || raw === "complete" || raw === "done" || raw === "closed";

  if (explicitlyCanceled) {
    // A canceled record with a completed date is contradictory.
    return { status: "Canceled", conflicting: input.completedAt != null };
  }
  if (explicitlyDeferred) {
    return { status: "Deferred", conflicting: false };
  }

  // Completed wins when there is real evidence (a completed date), per spec §5.
  if (input.completedAt != null) {
    // Disagreement: completed date exists but status text says scheduled/open.
    const conflicting =
      raw.length > 0 &&
      !explicitlyCompleted &&
      (raw.includes("scheduled") || raw.includes("open") || raw.includes("in progress"));
    return { status: "Completed", conflicting };
  }

  // Spec §13 (no fake completion): when raw text claims "completed" but no
  // completedAt exists, we MUST NOT bucket the record as Completed. Demote
  // to Unknown and surface the contradiction so the operator can repair the
  // upstream record. Falling through to dueAt evaluation would also lie
  // ("Overdue" / "Scheduled" implies open), so Unknown is the only honest
  // bucket here.
  if (explicitlyCompleted) {
    return { status: "Unknown", conflicting: true };
  }

  if (input.dueAt != null) {
    const dueMs = input.dueAt.getTime();
    const nowMs = now.getTime();
    if (dueMs < nowMs) return { status: "Overdue", conflicting: false };
    const daysUntil = (dueMs - nowMs) / 86_400_000;
    if (daysUntil <= DUE_SOON_WINDOW_DAYS) return { status: "Due Soon", conflicting: false };
    return { status: "Scheduled", conflicting: false };
  }

  return { status: "Unknown", conflicting: false };
}

// ─── Mapping confidence (spec §9) ────────────────────────────────────────────

export interface PmConfidenceInput {
  propertyId: number | null;
  unitId: number | null;
  pmTaskOrCategoryRaw: string | null;
  normalizedCategory: PmCategory;
  normalizedStatus: PmStatus;
  dueAt: Date | null;
  completedAt: Date | null;
}

/**
 * Derive mapping confidence. Conservative — never auto-upgrades (spec §9).
 *
 *   high   = property + unit + category + ≥1 date + status known
 *   low    = no property OR (category="Other" AND raw was empty) OR no dates
 *   medium = everything else
 */
export function derivePmMappingConfidence(input: PmConfidenceInput): PmMappingConfidence {
  if (input.propertyId == null) return "low";

  const categoryUsable =
    input.normalizedCategory !== "Other" || (input.pmTaskOrCategoryRaw ?? "").trim().length > 0;
  const hasAnyDate = input.dueAt != null || input.completedAt != null;
  const statusKnown = input.normalizedStatus !== "Unknown";

  if (!categoryUsable || !hasAnyDate) return "low";

  if (
    input.unitId != null &&
    input.normalizedCategory !== "Other" &&
    hasAnyDate &&
    statusKnown
  ) {
    return "high";
  }
  return "medium";
}

// ─── Warning aggregation ────────────────────────────────────────────────────

export interface PmWarningInput {
  propertyId: number | null;
  unitId: number | null;
  pmTaskOrCategoryRaw: string | null;
  normalizedCategory: PmCategory;
  normalizedStatus: PmStatus;
  dueAt: Date | null;
  completedAt: Date | null;
  statusConflict: boolean;
  confidence: PmMappingConfidence;
}

export function collectPmWarnings(input: PmWarningInput): PmWarning[] {
  const warnings: PmWarning[] = [];
  const rawHasText = (input.pmTaskOrCategoryRaw ?? "").trim().length > 0;

  if (input.propertyId == null) warnings.push(pmWarning("missing_property"));
  if (input.unitId == null) warnings.push(pmWarning("missing_unit"));
  if (!rawHasText) {
    warnings.push(pmWarning("missing_pm_task"));
    warnings.push(pmWarning("missing_pm_category"));
  } else if (input.normalizedCategory === "Other") {
    warnings.push(pmWarning("pm_category_unknown"));
  }
  if (input.dueAt == null) warnings.push(pmWarning("missing_due_date"));
  if (input.completedAt == null && input.normalizedStatus !== "Completed") {
    warnings.push(pmWarning("missing_completed_date"));
  }
  if (input.normalizedStatus === "Unknown") warnings.push(pmWarning("pm_status_unknown"));
  if (input.statusConflict) warnings.push(pmWarning("pm_conflicting_dates"));
  if (input.confidence === "low") warnings.push(pmWarning("pm_review_required"));

  return warnings;
}
