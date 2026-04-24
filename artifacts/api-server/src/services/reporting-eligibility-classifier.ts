/**
 * Ascent 7.1 — Reporting Eligibility Classifier
 *
 * Single decision function for whether a normalized reporting record is
 * fully / partially / not reportable. Generalises the work-order specific
 * `isWorkOrderReportable` (Ascent 1.12.7) across every source type.
 *
 * Rules in priority order:
 *  1. Resolution status not accepted by source       → not_reportable
 *  2. Required field missing                         → not_reportable (or partial when only unit missing)
 *  3. Assignment confidence below threshold          → partially_reportable
 *  4. Resolution_status = partially_resolved          → partially_reportable
 *  5. Otherwise                                      → fully_reportable
 *
 * The classifier never invents data — it only reads what the normalizer placed
 * on the record.
 */

import type {
  NormalizedReportingRecord,
  ReportingEligibility,
  ReportingLimitation,
  ReportingLimitationCode,
} from "./reporting-record-contract";
import { REPORTING_LIMITATION_LABELS } from "./reporting-record-contract";
import { getSourceDefinition } from "./reporting-source-registry";

const CONFIDENCE_RANK: Record<NormalizedReportingRecord["assignmentConfidence"], number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

function reqRank(min: "high" | "medium" | "any" | "none"): number {
  if (min === "high") return 3;
  if (min === "medium") return 2;
  return 0; // "any" / "none" — no minimum
}

function lim(code: ReportingLimitationCode): ReportingLimitation {
  return { code, message: REPORTING_LIMITATION_LABELS[code] };
}

/**
 * Inspect a normalized record's required-field surface against the registry.
 * The normalizer is responsible for pulling the underlying values onto the
 * record (e.g. propertyId, status, openedAt) — this function simply asks
 * "is the value populated?".
 */
/**
 * Map every legal required-field name in the registry to the predicate that
 * checks whether the normalised record actually carries that value, plus the
 * limitation code emitted on absence. If a registry adds a required field
 * that is NOT in this map the build will throw at startup — that is an
 * intentional contract guard and prevents the registry/classifier drift the
 * architect flagged in the 7.1 review.
 */
const REQUIRED_FIELD_CHECKS: Record<
  string,
  { isPresent: (r: NormalizedReportingRecord) => boolean; code: ReportingLimitationCode }
> = {
  propertyId: { isPresent: (r) => r.propertyId != null, code: "missing_property" },
  unitId: { isPresent: (r) => r.unitId != null, code: "missing_unit" },
  assetId: { isPresent: (r) => r.assetId != null, code: "missing_asset" },
  category: { isPresent: (r) => !!r.category, code: "missing_status" },
  status: { isPresent: (r) => !!r.status, code: "missing_status" },
  turnStatus: { isPresent: (r) => !!r.status, code: "missing_status" },
  currentStage: { isPresent: (r) => !!r.supportingContext?.currentStage, code: "missing_status" },
  priority: { isPresent: (r) => !!r.priority, code: "missing_priority" },
  createdDate: { isPresent: (r) => r.openedAt != null, code: "missing_dates" },
  scheduledDate: { isPresent: (r) => r.openedAt != null || r.dueAt != null, code: "missing_dates" },
  warrantyExpiration: { isPresent: (r) => r.dueAt != null, code: "missing_dates" },
  // Documents
  linkedEntityType: { isPresent: (r) => !!r.supportingContext?.linkedEntityType, code: "missing_status" },
  linkedEntityId: { isPresent: (r) => r.supportingContext?.linkedEntityId != null, code: "missing_status" },
  fileName: { isPresent: (r) => !!r.sourceFileName, code: "missing_status" },
  // Assets
  name: { isPresent: (r) => !!r.category || r.supportingContext?.name != null, code: "missing_status" },
  assetType: { isPresent: (r) => !!r.category, code: "missing_status" },
  // Assignments
  sourceType: { isPresent: (r) => !!r.category, code: "missing_status" },
  confidenceLevel: { isPresent: (r) => r.assignmentConfidence !== "none", code: "low_assignment_confidence" },
  // PM / workflow / score (placeholder mappings for not-yet-wired sources)
  pmType: { isPresent: (r) => !!r.category, code: "missing_status" },
  workflowId: { isPresent: (r) => r.workflowId != null, code: "missing_status" },
  type: { isPresent: (r) => !!r.category, code: "missing_status" },
  level: { isPresent: (r) => !!r.priority, code: "missing_priority" },
  snapshotDate: { isPresent: (r) => r.openedAt != null, code: "missing_dates" },
};

function findFieldGaps(record: NormalizedReportingRecord): ReportingLimitationCode[] {
  const def = getSourceDefinition(record.sourceType);
  const gaps: ReportingLimitationCode[] = [];
  for (const field of def.requiredFields) {
    const check = REQUIRED_FIELD_CHECKS[field];
    if (!check) {
      throw new Error(
        `[reporting-eligibility-classifier] Required field "${field}" on source "${record.sourceType}" ` +
          `has no mapping in REQUIRED_FIELD_CHECKS. Add an entry or remove the field from the registry.`,
      );
    }
    if (!check.isPresent(record)) gaps.push(check.code);
  }
  return Array.from(new Set(gaps));
}

export interface ClassifierResult {
  eligibility: ReportingEligibility;
  limitations: ReportingLimitation[];
}

export function classifyReportingEligibility(record: NormalizedReportingRecord): ClassifierResult {
  const def = getSourceDefinition(record.sourceType);
  const limitations: ReportingLimitation[] = [];

  // ── 0. AUTHORITATIVE 1.12.7 GOVERNANCE GATE ────────────────────────────
  // When a record carries the rollup flags (today: work_orders), they are
  // the SOURCE OF TRUTH for eligibility and override the generic
  // resolution+confidence path entirely. The Control Tower's confidence
  // filter (`workOrderConfidenceWhere`) reads the same flags, so this
  // mapping guarantees Reports and the Control Tower can never disagree.
  //
  // Field-level gaps detected by findFieldGaps() are still attached as
  // ADVISORY limitations (so the drill-down explains what's missing) but
  // they do NOT downgrade the eligibility — the rollup flags already
  // encode the upstream governance decision.
  if (record.unitRollupAvailable !== null && record.propertyRollupAvailable !== null) {
    const advisoryGaps = findFieldGaps(record).map(lim);
    if (record.unitRollupAvailable === true) {
      return { eligibility: "fully_reportable", limitations: advisoryGaps };
    }
    if (record.propertyRollupAvailable === true) {
      return {
        eligibility: "partially_reportable",
        limitations: [lim("resolution_partial"), ...advisoryGaps],
      };
    }
    return {
      eligibility: "not_reportable",
      limitations: [lim("resolution_unresolved"), ...advisoryGaps],
    };
  }

  // 1. Resolution acceptance
  if (!def.acceptedResolutionStates.includes(record.resolutionStatus)) {
    if (record.resolutionStatus === "unresolved") limitations.push(lim("resolution_unresolved"));
    return { eligibility: "not_reportable", limitations };
  }

  // 2. Required-field gaps. Missing property → not_reportable; missing unit
  //    only → partially_reportable (still rolls up to property).
  const gaps = findFieldGaps(record);
  if (gaps.includes("missing_property")) {
    limitations.push(lim("missing_property"));
    return { eligibility: "not_reportable", limitations };
  }
  for (const g of gaps) limitations.push(lim(g));

  const onlySoftGaps = gaps.length > 0 && gaps.every((g) => g === "missing_unit");

  // 3. Resolution = partial → partial.
  if (record.resolutionStatus === "partially_resolved") {
    limitations.push(lim("resolution_partial"));
    return { eligibility: "partially_reportable", limitations };
  }

  // 4. Assignment confidence threshold.
  const required = reqRank(def.assignmentRequirements);
  const have = CONFIDENCE_RANK[record.assignmentConfidence];
  if (required > 0 && have < required) {
    limitations.push(lim("low_assignment_confidence"));
    return { eligibility: "partially_reportable", limitations };
  }

  // 5. Soft gaps demote to partial.
  if (onlySoftGaps) {
    return { eligibility: "partially_reportable", limitations };
  }

  // 6. Other gaps demote to partial (e.g. missing dates / status / priority).
  if (gaps.length > 0) {
    return { eligibility: "partially_reportable", limitations };
  }

  return { eligibility: "fully_reportable", limitations: [] };
}
