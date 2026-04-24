/**
 * Import Governance Service
 * Phase 1 — Dual-Mode Controlled Ingestion
 *
 * Classifies every imported row into one of three resolution states:
 *   FULLY_RESOLVED     — property + unit matched; full downstream participation
 *   PARTIALLY_RESOLVED — property matched, unit did not resolve; limited participation
 *   UNRESOLVED         — property did not match; intake-only, no dashboard truth
 *
 * Wraps (does not replace) the assignment engine.
 */

import { db } from "@workspace/db";
import { importRunsTable, workOrdersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
// Ascent 1.12.7 — single source of truth for SLA-violation detection.
import { isWoSlaViolation } from "./operational-selectors";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportMode = "flexible" | "strict";

export type ResolutionStatus = "fully_resolved" | "partially_resolved" | "unresolved";

export type AssignmentConfidence = "high" | "medium" | "low" | "none";

export type PropertyMatchStatus = "matched" | "fuzzy" | "created" | "unmatched";

export type UnitMatchStatus = "matched" | "unmatched" | "skipped";

export type StrictVerdict = "verified" | "partial" | "not_valid";

export interface GovernanceFields {
  importMode: ImportMode;
  resolutionStatus: ResolutionStatus;
  assignmentConfidence: AssignmentConfidence;
  propertyMatchStatus: PropertyMatchStatus;
  unitMatchStatus: UnitMatchStatus;
  governanceNotes: string;
  excludedFromStrictWiring: boolean;
  availableForPropertyRollup: boolean;
  availableForUnitRollup: boolean;
  sourceFileName?: string;
  sourceRowIndex?: number;
}

export interface ImportRowContext {
  mode: ImportMode;
  propertyId: number | null;
  unitId: number | null;
  propertyConfidence: string;   // from existing resolveProperty(): 'exact' | 'fuzzy' | 'created' | 'none'
  unitNumberRaw?: string | null;
  sourceFileName?: string;
  sourceRowIndex?: number;
}

export interface ImportRunSummary {
  batchId: string;
  mode: ImportMode;
  sourceFileName?: string | null;
  totalRows: number;
  fullyResolved: number;
  partiallyResolved: number;
  unresolved: number;
  errors: number;
  readyForFullWiring: number;
  needsUnitConfirmation: number;
  needsReview: number;
  strictVerdict?: StrictVerdict | null;
  slaViolations: number;
  blockedCount: number;
}

// ─── Core Classification ──────────────────────────────────────────────────────

/**
 * Classify a single imported row into a resolution state.
 * This is the single source of truth for governance decisions.
 */
export function classifyResolutionState(ctx: ImportRowContext): ResolutionStatus {
  const { propertyId, unitId, propertyConfidence } = ctx;

  // A "created" property is not a real match — treat as unresolved
  // (resolveProperty auto-creates properties for unknown names)
  if (propertyConfidence === "created" || propertyConfidence === "none" || !propertyId) {
    return "unresolved";
  }

  // FULLY RESOLVED: property confidently matched AND unit resolved
  if (propertyId && unitId) {
    // In strict mode, fuzzy property matches are only partial
    if (ctx.mode === "strict" && propertyConfidence === "fuzzy") {
      return "partially_resolved";
    }
    return "fully_resolved";
  }

  // PARTIALLY RESOLVED: property matched but unit didn't resolve
  return "partially_resolved";
}

/**
 * Map the existing resolveProperty confidence string to our match status enum.
 */
function mapPropertyMatchStatus(confidence: string): PropertyMatchStatus {
  if (confidence === "exact" || confidence === "high") return "matched";
  if (confidence === "fuzzy" || confidence === "medium") return "fuzzy";
  if (confidence === "created") return "created";
  return "unmatched";
}

/**
 * Determine unit match status based on resolution inputs.
 */
function mapUnitMatchStatus(unitId: number | null, unitNumberRaw?: string | null): UnitMatchStatus {
  if (unitId) return "matched";
  if (!unitNumberRaw) return "skipped";
  return "unmatched";
}

/**
 * Determine overall assignment confidence from property + unit match.
 */
function computeAssignmentConfidence(
  propertyMatchStatus: PropertyMatchStatus,
  unitMatchStatus: UnitMatchStatus,
): AssignmentConfidence {
  if (propertyMatchStatus === "matched" && unitMatchStatus === "matched") return "high";
  if (propertyMatchStatus === "matched" && unitMatchStatus === "skipped") return "medium";
  if (propertyMatchStatus === "fuzzy" && unitMatchStatus === "matched") return "medium";
  if (propertyMatchStatus === "fuzzy" || unitMatchStatus === "unmatched") return "low";
  if (propertyMatchStatus === "created") return "low";
  return "none";
}

/**
 * Generate a human-readable governance note for internal audit trail.
 */
function buildGovernanceNotes(
  resolutionStatus: ResolutionStatus,
  propertyMatchStatus: PropertyMatchStatus,
  unitMatchStatus: UnitMatchStatus,
  mode: ImportMode,
): string {
  const parts: string[] = [];

  if (mode === "strict") parts.push("[STRICT]");

  if (resolutionStatus === "fully_resolved") {
    parts.push(`Property: ${propertyMatchStatus}. Unit: ${unitMatchStatus}. Fully wired.`);
  } else if (resolutionStatus === "partially_resolved") {
    parts.push(`Property: ${propertyMatchStatus}.`);
    if (unitMatchStatus === "unmatched") parts.push("Unit did not resolve — excluded from unit-level truth.");
    if (unitMatchStatus === "skipped") parts.push("No unit provided — property-level only.");
    parts.push("Available for property rollup only.");
  } else {
    parts.push("Property did not match.");
    parts.push("Routed to review queue. Not included in dashboard truth.");
  }

  return parts.join(" ");
}

/**
 * Compute all governance fields for one imported row.
 * Call this after property and unit resolution is complete.
 */
export function computeGovernanceFields(ctx: ImportRowContext): GovernanceFields {
  const resolutionStatus = classifyResolutionState(ctx);
  const propertyMatchStatus = mapPropertyMatchStatus(ctx.propertyConfidence);
  const unitMatchStatus = mapUnitMatchStatus(ctx.unitId, ctx.unitNumberRaw);
  const assignmentConfidence = computeAssignmentConfidence(propertyMatchStatus, unitMatchStatus);
  const governanceNotes = buildGovernanceNotes(resolutionStatus, propertyMatchStatus, unitMatchStatus, ctx.mode);

  // Downstream eligibility flags
  const availableForPropertyRollup = resolutionStatus !== "unresolved";
  const availableForUnitRollup = resolutionStatus === "fully_resolved";
  const excludedFromStrictWiring = resolutionStatus !== "fully_resolved";

  return {
    importMode: ctx.mode,
    resolutionStatus,
    assignmentConfidence,
    propertyMatchStatus,
    unitMatchStatus,
    governanceNotes,
    excludedFromStrictWiring,
    availableForPropertyRollup,
    availableForUnitRollup,
    sourceFileName: ctx.sourceFileName,
    sourceRowIndex: ctx.sourceRowIndex,
  };
}

// ─── Strict Mode Verdict ──────────────────────────────────────────────────────

/**
 * Determine the strict-mode verdict for an import run.
 */
export function computeStrictVerdict(
  fullyResolved: number,
  total: number,
  errors: number,
): StrictVerdict {
  if (total === 0 || errors === total) return "not_valid";
  const eligibleRate = fullyResolved / (total - errors);
  if (eligibleRate >= 0.90) return "verified";
  if (eligibleRate >= 0.50) return "partial";
  return "not_valid";
}

// ─── Import Run Persistence ───────────────────────────────────────────────────

/**
 * Record the completed import run in the import_runs table.
 */
export async function recordImportRun(params: {
  batchId: string;
  mode: ImportMode;
  sourceFileName?: string;
  totalRows: number;
  fullyResolvedCount: number;
  partiallyResolvedCount: number;
  unresolvedCount: number;
  errorCount: number;
  summaryData?: Record<string, unknown>;
}): Promise<void> {
  const strictVerdict =
    params.mode === "strict"
      ? computeStrictVerdict(params.fullyResolvedCount, params.totalRows, params.errorCount)
      : null;

  await db.insert(importRunsTable).values({
    batchId: params.batchId,
    importMode: params.mode,
    sourceFileName: params.sourceFileName ?? null,
    entityType: "work_order",
    totalRows: params.totalRows,
    fullyResolvedCount: params.fullyResolvedCount,
    partiallyResolvedCount: params.partiallyResolvedCount,
    unresolvedCount: params.unresolvedCount,
    errorCount: params.errorCount,
    summaryData: params.summaryData ?? null,
    strictVerdict,
    startedAt: new Date(),
    completedAt: new Date(),
  });
}

// ─── Import Run Summary ───────────────────────────────────────────────────────

/**
 * Retrieve the import governance summary for a completed batch.
 */
export async function getImportSummary(batchId: string): Promise<ImportRunSummary | null> {
  const [run] = await db
    .select()
    .from(importRunsTable)
    .where(eq(importRunsTable.batchId, batchId));

  if (!run) return null;

  // Supplement with live WO counts if needed
  const wos = await db
    .select({
      slaStatus: workOrdersTable.slaStatus,
      isBlocked: workOrdersTable.isBlocked,
    })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.importBatchId, batchId));

  const slaViolations = wos.filter(w => isWoSlaViolation(w)).length;
  const blockedCount = wos.filter(w => w.isBlocked).length;

  return {
    batchId: run.batchId,
    mode: (run.importMode as ImportMode) ?? "flexible",
    sourceFileName: run.sourceFileName,
    totalRows: run.totalRows,
    fullyResolved: run.fullyResolvedCount,
    partiallyResolved: run.partiallyResolvedCount,
    unresolved: run.unresolvedCount,
    errors: run.errorCount,
    readyForFullWiring: run.fullyResolvedCount,
    needsUnitConfirmation: run.partiallyResolvedCount,
    needsReview: run.unresolvedCount,
    strictVerdict: (run.strictVerdict as StrictVerdict | null) ?? null,
    slaViolations,
    blockedCount,
  };
}
