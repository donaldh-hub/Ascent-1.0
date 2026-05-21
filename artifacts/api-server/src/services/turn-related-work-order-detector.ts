/**
 * Ascent 7.2.1 — Turn-Related Work Order Detector
 *
 * Given a normalized work-order record, decides whether it might be
 * representing a unit turn rather than a stand-alone maintenance task.
 *
 * The detector NEVER mutates the record and NEVER merges anything. It
 * only returns a structured opinion that the analysis layer uses to
 * label, group, or set aside the record according to the active
 * reporting mode.
 *
 * Confidence levels:
 *
 *   confirmed_turn_related   — at least one hard signal (linked turnId
 *                              OR stage in TURN_STAGE_SEQUENCE AND a
 *                              turn-style category).
 *   likely_turn_related      — explicit turn category ("Turn", "Make
 *                              Ready", "Turnover", "Vacant Prep").
 *   possible_turn_related    — soft signals only: turn-stage keyword,
 *                              description mention, etc.
 *   not_turn_related         — none of the above.
 *
 * needsConfirmation = true iff confidence is "possible_turn_related".
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import { TURN_STAGE_SEQUENCE } from "@workspace/db/schema";

export type TurnRelationConfidence =
  | "confirmed_turn_related"
  | "likely_turn_related"
  | "possible_turn_related"
  | "not_turn_related";

export interface TurnRelationOpinion {
  isTurnRelatedCandidate: boolean;
  turnRelationConfidence: TurnRelationConfidence;
  turnRelationReason: string;
  linkedTurnId: string | null;
  linkedUnitId: number | null;
  linkedPropertyId: number | null;
  stageMapping: string | null;
  needsConfirmation: boolean;
}

const HARD_TURN_CATEGORIES = new Set([
  "turn",
  "make ready",
  "make-ready",
  "makeready",
  "turnover",
  "vacant prep",
  "vacant turn",
]);

const SOFT_TURN_CATEGORIES = new Set([
  "punch",
  "punch list",
  "paint",
  "flooring",
  "cleaning",
  "inspection",
  "rework",
  "trash out",
  "trashout",
  "maintenance", // soft: maintenance overlaps but is a turn stage too
  "paint prep",
]);

const TURN_DESCRIPTION_REGEX =
  /\b(turn(over)?|make[\s-]?ready|vacant\s+prep|punch\s*list|rent[\s-]?ready)\b/i;

const STAGE_LOOKUP = new Set(
  TURN_STAGE_SEQUENCE.map((s) => s.toLowerCase()),
);

export function detectTurnRelation(
  record: NormalizedReportingRecord,
): TurnRelationOpinion {
  if (record.sourceType !== "work_orders") {
    return {
      isTurnRelatedCandidate: false,
      turnRelationConfidence: "not_turn_related",
      turnRelationReason: "Not a work order.",
      linkedTurnId: null,
      linkedUnitId: null,
      linkedPropertyId: null,
      stageMapping: null,
      needsConfirmation: false,
    };
  }

  const ctx = record.supportingContext as Record<string, unknown>;
  const stage =
    typeof ctx.stage === "string" && ctx.stage.trim().length > 0
      ? ctx.stage.trim()
      : null;
  const linkedTurnId =
    typeof ctx.turnId === "string" && ctx.turnId.trim().length > 0
      ? ctx.turnId.trim()
      : extractTurnIdFromRaw(ctx);
  const stageMapping =
    stage && STAGE_LOOKUP.has(stage.toLowerCase()) ? stage : null;

  const category = (record.category ?? "").trim().toLowerCase();
  const description = describeOf(ctx);

  // Hard signals
  if (linkedTurnId) {
    return opinion({
      confidence: "confirmed_turn_related",
      reason: `Linked to turn ${linkedTurnId}.`,
      linkedTurnId,
      record,
      stageMapping,
    });
  }
  if (stageMapping && HARD_TURN_CATEGORIES.has(category)) {
    return opinion({
      confidence: "confirmed_turn_related",
      reason: `Turn category "${record.category}" + turn stage "${stageMapping}".`,
      linkedTurnId: null,
      record,
      stageMapping,
    });
  }

  // Likely signals
  if (HARD_TURN_CATEGORIES.has(category)) {
    return opinion({
      confidence: "likely_turn_related",
      reason: `Category "${record.category}" matches a turn category.`,
      linkedTurnId: null,
      record,
      stageMapping,
    });
  }

  // Possible / soft signals
  if (stageMapping) {
    return opinion({
      confidence: "possible_turn_related",
      reason: `Stage "${stageMapping}" maps to a turn stage but no turn category or linkage.`,
      linkedTurnId: null,
      record,
      stageMapping,
    });
  }
  if (SOFT_TURN_CATEGORIES.has(category)) {
    return opinion({
      confidence: "possible_turn_related",
      reason: `Category "${record.category}" overlaps with common turn stages.`,
      linkedTurnId: null,
      record,
      stageMapping,
    });
  }
  if (description && TURN_DESCRIPTION_REGEX.test(description)) {
    return opinion({
      confidence: "possible_turn_related",
      reason: `Description mentions turn-related work.`,
      linkedTurnId: null,
      record,
      stageMapping,
    });
  }

  return {
    isTurnRelatedCandidate: false,
    turnRelationConfidence: "not_turn_related",
    turnRelationReason: "No turn signals present.",
    linkedTurnId: null,
    linkedUnitId: record.unitId,
    linkedPropertyId: record.propertyId,
    stageMapping: null,
    needsConfirmation: false,
  };
}

function opinion(args: {
  confidence: TurnRelationConfidence;
  reason: string;
  linkedTurnId: string | null;
  record: NormalizedReportingRecord;
  stageMapping: string | null;
}): TurnRelationOpinion {
  return {
    isTurnRelatedCandidate: true,
    turnRelationConfidence: args.confidence,
    turnRelationReason: args.reason,
    linkedTurnId: args.linkedTurnId,
    linkedUnitId: args.record.unitId,
    linkedPropertyId: args.record.propertyId,
    stageMapping: args.stageMapping,
    needsConfirmation: args.confidence === "possible_turn_related",
  };
}

function describeOf(ctx: Record<string, unknown>): string | null {
  if (typeof ctx.description === "string") return ctx.description;
  return null;
}

/**
 * Some imports carry the turn id under nested raw payloads instead of a
 * normalized field. Best-effort extraction without making assumptions.
 */
function extractTurnIdFromRaw(ctx: Record<string, unknown>): string | null {
  const raw = ctx.rawData;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const candidates = ["turn_id", "turnId", "TurnId", "Turn ID"];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

// ─── Bulk helpers ─────────────────────────────────────────────────────────────

export interface TurnRelationBreakdown {
  confirmed: NormalizedReportingRecord[];
  likely: NormalizedReportingRecord[];
  possible: NormalizedReportingRecord[];
  notRelated: NormalizedReportingRecord[];
}

export function partitionWorkOrdersByTurnRelation(
  records: NormalizedReportingRecord[],
): TurnRelationBreakdown {
  const out: TurnRelationBreakdown = {
    confirmed: [],
    likely: [],
    possible: [],
    notRelated: [],
  };
  for (const r of records) {
    if (r.sourceType !== "work_orders") continue;
    const op = detectTurnRelation(r);
    switch (op.turnRelationConfidence) {
      case "confirmed_turn_related":
        out.confirmed.push(r);
        break;
      case "likely_turn_related":
        out.likely.push(r);
        break;
      case "possible_turn_related":
        out.possible.push(r);
        break;
      case "not_turn_related":
        out.notRelated.push(r);
        break;
    }
  }
  return out;
}
