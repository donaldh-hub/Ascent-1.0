/**
 * Ascent 7.1 — Normalized Reporting Record Contract
 *
 * The single shape every reporting source normalizes into. Reports, the
 * Reporting Readiness panel, and drill-downs all consume this contract so
 * dashboards and Control Tower stay aligned with one operational language.
 *
 * Rules (per Build 7.1 spec):
 *   - Use real fields where available.
 *   - Do not invent missing property, unit, asset, or workflow links.
 *   - Preserve raw source text if a match is incomplete.
 *   - Keep report readiness separate from raw data existence.
 */

export type ReportingSourceType =
  | "work_orders"
  | "turns"
  | "preventative_maintenance"
  | "assets"
  | "warranties"
  | "documents"
  | "assignments"
  | "workflow_items"
  | "alerts"
  | "score_snapshots";

export type ReportingResolutionStatus =
  | "fully_resolved"
  | "partially_resolved"
  | "unresolved";

export type ReportingAssignmentConfidence =
  | "high"
  | "medium"
  | "low"
  | "none";

export type ReportingEligibility =
  | "fully_reportable"
  | "partially_reportable"
  | "not_reportable";

/**
 * Reasons a record was downgraded out of FULLY_REPORTABLE. Stable codes so
 * the readiness UI can render consistent labels and the audit log can
 * aggregate counts.
 */
export type ReportingLimitationCode =
  | "missing_property"
  | "missing_unit"
  | "missing_asset"
  | "missing_dates"
  | "missing_status"
  | "missing_priority"
  | "low_assignment_confidence"
  | "resolution_unresolved"
  | "resolution_partial"
  | "raw_only_no_match";

export interface ReportingLimitation {
  code: ReportingLimitationCode;
  message: string;
}

/**
 * Normalized reporting record. Spec §3 — every reporting source produces
 * objects matching this shape.
 */
export interface NormalizedReportingRecord {
  id: string;                    // synthetic stable id: `${sourceType}:${sourceRecordId}`
  organizationId: number | null; // single-tenant today; reserved for multi-tenant
  sourceType: ReportingSourceType;
  sourceRecordId: number | string;
  sourceFileName: string | null;
  sourceRowIndex: number | null;

  propertyId: number | null;
  propertyName: string | null;
  unitId: number | null;
  unitNameOrNumber: string | null;

  workflowId: number | null;
  workflowItemId: number | null;
  assetId: number | null;
  documentId: number | null;

  category: string | null;
  status: string | null;
  priority: string | null;

  openedAt: Date | null;        // created_at / created_date / opened_at
  updatedAt: Date | null;
  completedAt: Date | null;
  dueAt: Date | null;
  ageDays: number | null;
  ageHours: number | null;

  resolutionStatus: ReportingResolutionStatus;
  assignmentConfidence: ReportingAssignmentConfidence;
  reportingEligibility: ReportingEligibility;
  reportingLimitations: ReportingLimitation[];

  /**
   * Ascent 7.1 — operational rollup flags (mirrors the 1.12.7 confidence
   * filter columns on work_orders). When present on a record they are the
   * AUTHORITATIVE source of truth for eligibility and over-rule the generic
   * resolution+confidence path. Null for sources that do not carry these
   * flags (turns, assets, documents, …).
   */
  unitRollupAvailable: boolean | null;
  propertyRollupAvailable: boolean | null;

  /** Free-form supporting context (e.g. SLA status, stage, vendor) — for drill-down only. */
  supportingContext: Record<string, unknown>;
  /** Stable opaque pointer back to the raw row for audit trail. */
  rawPayloadReference: { table: string; id: number | string };
}

export const REPORTING_LIMITATION_LABELS: Record<ReportingLimitationCode, string> = {
  missing_property: "Property link is missing.",
  missing_unit: "Unit link is missing.",
  missing_asset: "Asset link is missing.",
  missing_dates: "Required date fields are missing.",
  missing_status: "Status field is missing.",
  missing_priority: "Priority field is missing.",
  low_assignment_confidence: "Assignment confidence is low.",
  resolution_unresolved: "Property match failed; record is in review.",
  resolution_partial: "Unit context is incomplete; property-level only.",
  raw_only_no_match: "Record exists in raw form but is not yet matched.",
};
