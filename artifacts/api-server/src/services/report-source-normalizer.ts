/**
 * Ascent 7.1 — Source Normalizers
 *
 * Convert raw DB rows into NormalizedReportingRecord objects. Each normalizer
 * pulls only fields that actually exist on the underlying table; nothing is
 * fabricated. Resolution status / assignment confidence come either from
 * the row itself (work_orders) or are derived from the link state of the
 * record (turns, assets, documents, assignments).
 *
 * After normalisation, the eligibility classifier is applied so each record
 * leaves this module with its eligibility + limitations attached.
 */

import { db } from "@workspace/db";
import {
  workOrdersTable,
  turnsTable,
  assetsTable,
  documentsTable,
  assignmentsTable,
  propertiesTable,
  unitsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import type {
  NormalizedReportingRecord,
  ReportingAssignmentConfidence,
  ReportingResolutionStatus,
  ReportingSourceType,
} from "./reporting-record-contract";
import { classifyReportingEligibility } from "./reporting-eligibility-classifier";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ageFrom(d: Date | null | undefined): { ageDays: number | null; ageHours: number | null } {
  if (!d) return { ageDays: null, ageHours: null };
  const ms = Date.now() - new Date(d).getTime();
  return {
    ageHours: Math.round((ms / 3_600_000) * 10) / 10,
    ageDays: Math.round((ms / 86_400_000) * 10) / 10,
  };
}

function asResolution(v: string | null | undefined): ReportingResolutionStatus {
  if (v === "fully_resolved" || v === "partially_resolved" || v === "unresolved") return v;
  // Ascent 7.1 (architect review fix) — never silently promote unknown values
  // to fully_resolved. The conservative default for any row that did not pass
  // through the governance pipeline is partially_resolved; this still allows
  // property-level reporting but prevents over-promotion to unit-level truth.
  return "partially_resolved";
}

function asConfidence(v: string | null | undefined): ReportingAssignmentConfidence {
  if (v === "high" || v === "medium" || v === "low" || v === "none") return v;
  return "none";
}

/**
 * Derive resolution status for sources that don't carry a column for it
 * (turns, assets, documents). Mirrors governance-service.classifyResolutionState.
 */
function deriveResolutionFromLinks(propertyId: number | null, unitId: number | null): ReportingResolutionStatus {
  if (propertyId == null) return "unresolved";
  if (unitId == null) return "partially_resolved";
  return "fully_resolved";
}

/** Apply classifier and return record-with-eligibility. */
function withEligibility(rec: Omit<NormalizedReportingRecord, "reportingEligibility" | "reportingLimitations">): NormalizedReportingRecord {
  const placeholder: NormalizedReportingRecord = {
    ...rec,
    reportingEligibility: "fully_reportable",
    reportingLimitations: [],
  };
  const { eligibility, limitations } = classifyReportingEligibility(placeholder);
  return { ...placeholder, reportingEligibility: eligibility, reportingLimitations: limitations };
}

// ─── Cache: property/unit name lookups ────────────────────────────────────────

let propertyNameCache: Map<number, string> | null = null;
let unitNameCache: Map<number, string> | null = null;

async function loadPropertyNames(): Promise<Map<number, string>> {
  if (propertyNameCache) return propertyNameCache;
  const rows = await db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable);
  propertyNameCache = new Map(rows.map((r) => [r.id, r.name]));
  return propertyNameCache;
}

async function loadUnitNames(): Promise<Map<number, string>> {
  if (unitNameCache) return unitNameCache;
  const rows = await db.select({ id: unitsTable.id, unitNumber: unitsTable.unitNumber }).from(unitsTable);
  unitNameCache = new Map(rows.map((r) => [r.id, r.unitNumber]));
  return unitNameCache;
}

/** Drop caches between ingestion runs to pick up new properties/units. */
export function clearNameCaches(): void {
  propertyNameCache = null;
  unitNameCache = null;
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

export async function normalizeWorkOrders(): Promise<NormalizedReportingRecord[]> {
  const [rows, props, units] = await Promise.all([
    db.select().from(workOrdersTable),
    loadPropertyNames(),
    loadUnitNames(),
  ]);
  return rows.map((w) => {
    const opened = w.createdDate ?? w.importedAt ?? null;
    const { ageDays, ageHours } = ageFrom(opened);
    return withEligibility({
      id: `work_orders:${w.id}`,
      organizationId: null,
      sourceType: "work_orders" as ReportingSourceType,
      sourceRecordId: w.id,
      sourceFileName: w.sourceFileName ?? null,
      sourceRowIndex: w.sourceRowIndex ?? null,
      propertyId: w.propertyId,
      propertyName: w.propertyId != null ? props.get(w.propertyId) ?? w.propertyNameRaw ?? null : w.propertyNameRaw ?? null,
      unitId: w.unitId,
      unitNameOrNumber: w.unitId != null ? units.get(w.unitId) ?? w.unitNumberRaw ?? null : w.unitNumberRaw ?? null,
      workflowId: null,
      workflowItemId: w.workflowItemId,
      assetId: w.assetId,
      documentId: null,
      category: w.category,
      status: w.status,
      priority: w.priority,
      openedAt: opened,
      updatedAt: w.updatedAt,
      completedAt: w.completedDate,
      dueAt: w.scheduledDate,
      ageDays,
      ageHours,
      resolutionStatus: asResolution(w.resolutionStatus),
      // Ascent 7.1 — align reporting confidence with the 1.12.7 operational
      // confidence gate. The raw `assignmentConfidence` column reflects the
      // *import matcher's* confidence; the *operational* confidence is what
      // the Control Tower confidence filter already uses
      // (`availableForUnitRollup` / `availableForPropertyRollup`). Reporting
      // eligibility must reflect the operational view so the readiness panel
      // and the Control Tower never tell the user two different stories.
      assignmentConfidence: w.availableForUnitRollup
        ? "high"
        : w.availableForPropertyRollup
        ? "medium"
        : asConfidence(w.assignmentConfidence),
      // Ascent 7.1 — populate the operational rollup gate so the classifier
      // can hard-wire eligibility to the 1.12.7 governance flags.
      unitRollupAvailable: w.availableForUnitRollup,
      propertyRollupAvailable: w.availableForPropertyRollup,
      supportingContext: {
        slaStatus: w.slaStatus,
        rawAssignmentConfidence: w.assignmentConfidence,
        slaResponseDelayHours: w.slaResponseDelayHours,
        stage: w.stage,
        vendor: w.vendor,
        isBlocked: w.isBlocked,
        availableForPropertyRollup: w.availableForPropertyRollup,
        availableForUnitRollup: w.availableForUnitRollup,
      },
      rawPayloadReference: { table: "work_orders", id: w.id },
    });
  });
}

export async function normalizeTurns(): Promise<NormalizedReportingRecord[]> {
  const [rows, props, units] = await Promise.all([
    db.select().from(turnsTable),
    loadPropertyNames(),
    loadUnitNames(),
  ]);
  return rows.map((t) => {
    const { ageDays, ageHours } = ageFrom(t.importedAt);
    const resolution = deriveResolutionFromLinks(t.propertyId, t.unitId);
    return withEligibility({
      id: `turns:${t.id}`,
      organizationId: null,
      sourceType: "turns" as ReportingSourceType,
      sourceRecordId: t.id,
      sourceFileName: null,
      sourceRowIndex: null,
      propertyId: t.propertyId,
      propertyName: t.propertyId != null ? props.get(t.propertyId) ?? t.propertyNameRaw ?? null : t.propertyNameRaw ?? null,
      unitId: t.unitId,
      unitNameOrNumber: t.unitId != null ? units.get(t.unitId) ?? t.unitNumber ?? null : t.unitNumber ?? null,
      workflowId: null,
      workflowItemId: null,
      assetId: null,
      documentId: null,
      category: "turn",
      status: t.turnStatus,
      priority: null,
      openedAt: t.importedAt,
      updatedAt: t.updatedAt,
      completedAt: t.turnStatus === "completed" ? t.updatedAt : null,
      dueAt: null,
      ageDays,
      ageHours,
      resolutionStatus: resolution,
      assignmentConfidence: resolution === "fully_resolved" ? "high" : resolution === "partially_resolved" ? "medium" : "none",
      unitRollupAvailable: null,
      propertyRollupAvailable: null,
      supportingContext: {
        currentStage: t.currentStage,
        completionPercentage: t.completionPercentage,
        daysInStage: t.daysInStage,
        totalDaysOpen: t.totalDaysOpen,
        isBlocked: t.isBlocked,
        blockedStage: t.blockedStage,
        blockReason: t.blockReason,
      },
      rawPayloadReference: { table: "turns", id: t.id },
    });
  });
}

export async function normalizeAssets(): Promise<NormalizedReportingRecord[]> {
  const [rows, props, units] = await Promise.all([
    db.select().from(assetsTable),
    loadPropertyNames(),
    loadUnitNames(),
  ]);
  return rows.map((a) => {
    const { ageDays, ageHours } = ageFrom(a.createdAt);
    const resolution = deriveResolutionFromLinks(a.propertyId, a.unitId);
    return withEligibility({
      id: `assets:${a.id}`,
      organizationId: null,
      sourceType: "assets" as ReportingSourceType,
      sourceRecordId: a.id,
      sourceFileName: null,
      sourceRowIndex: null,
      propertyId: a.propertyId,
      propertyName: a.propertyId != null ? props.get(a.propertyId) ?? null : null,
      unitId: a.unitId,
      unitNameOrNumber: a.unitId != null ? units.get(a.unitId) ?? null : null,
      workflowId: null,
      workflowItemId: null,
      assetId: a.id,
      documentId: null,
      category: a.assetType ?? null,
      status: a.status,
      priority: null,
      openedAt: a.createdAt,
      updatedAt: a.createdAt,
      completedAt: null,
      dueAt: a.warrantyExpiration ? new Date(a.warrantyExpiration) : null,
      ageDays,
      ageHours,
      resolutionStatus: resolution,
      assignmentConfidence: resolution === "fully_resolved" ? "high" : resolution === "partially_resolved" ? "medium" : "none",
      unitRollupAvailable: null,
      propertyRollupAvailable: null,
      supportingContext: {
        manufacturer: a.model,
        model: a.model,
        serial: a.serial,
        installDate: a.installDate,
        warrantyStart: a.warrantyStart,
        warrantyExpiration: a.warrantyExpiration,
        stoplight: a.stoplight,
        healthScore: a.healthScore,
        linkageStatus: a.linkageStatus,
      },
      rawPayloadReference: { table: "assets", id: a.id },
    });
  });
}

export async function normalizeDocuments(): Promise<NormalizedReportingRecord[]> {
  const rows = await db.select().from(documentsTable);
  return rows.map((d) => {
    const { ageDays, ageHours } = ageFrom(d.uploadedAt);
    // Documents resolve via linkedEntityType/Id rather than property/unit IDs.
    // Treat "linked = fully", "no linked entity = unresolved".
    const resolution: ReportingResolutionStatus =
      d.linkedEntityType && d.linkedEntityId ? "fully_resolved" : "unresolved";
    return withEligibility({
      id: `documents:${d.id}`,
      organizationId: null,
      sourceType: "documents" as ReportingSourceType,
      sourceRecordId: d.id,
      sourceFileName: d.fileName,
      sourceRowIndex: null,
      propertyId: null,
      propertyName: null,
      unitId: null,
      unitNameOrNumber: null,
      workflowId: d.linkedWorkflowId,
      workflowItemId: null,
      assetId: d.linkedEntityType === "asset" ? d.linkedEntityId : null,
      documentId: d.id,
      category: d.documentType,
      status: d.linkedEntityType ? "linked" : "unlinked",
      priority: null,
      openedAt: d.uploadedAt,
      updatedAt: d.uploadedAt,
      completedAt: null,
      dueAt: null,
      ageDays,
      ageHours,
      resolutionStatus: resolution,
      assignmentConfidence: resolution === "fully_resolved" ? "high" : "none",
      unitRollupAvailable: null,
      propertyRollupAvailable: null,
      supportingContext: {
        linkedEntityType: d.linkedEntityType,
        linkedEntityId: d.linkedEntityId,
        linkedWorkflowId: d.linkedWorkflowId,
        fileType: d.fileType,
        fileSizeBytes: d.fileSizeBytes,
        uploadedBy: d.uploadedBy,
      },
      rawPayloadReference: { table: "documents", id: d.id },
    });
  });
}

export async function normalizeAssignments(): Promise<NormalizedReportingRecord[]> {
  const rows = await db.select().from(assignmentsTable);
  return rows.map((a) => {
    const { ageDays, ageHours } = ageFrom(a.createdAt);
    // Assignment records describe linkage themselves. Resolution = fully when
    // they actually targeted an entity AND were assigned; partial when pending;
    // unresolved when rejected.
    const resolution: ReportingResolutionStatus =
      a.status === "assigned" && a.targetEntityId != null
        ? "fully_resolved"
        : a.status === "pending"
        ? "partially_resolved"
        : "unresolved";
    return withEligibility({
      id: `assignments:${a.id}`,
      organizationId: null,
      sourceType: "assignments" as ReportingSourceType,
      sourceRecordId: a.id,
      sourceFileName: null,
      sourceRowIndex: null,
      propertyId: null,
      propertyName: null,
      unitId: null,
      unitNameOrNumber: null,
      workflowId: null,
      workflowItemId: null,
      assetId: null,
      documentId: null,
      category: a.sourceType,
      status: a.status,
      priority: null,
      openedAt: a.createdAt,
      updatedAt: a.updatedAt,
      completedAt: a.status === "assigned" ? a.updatedAt : null,
      dueAt: null,
      ageDays,
      ageHours,
      resolutionStatus: resolution,
      assignmentConfidence: asConfidence(a.confidenceLevel),
      unitRollupAvailable: null,
      propertyRollupAvailable: null,
      supportingContext: {
        targetEntityType: a.targetEntityType,
        targetEntityId: a.targetEntityId,
        assignmentMethod: a.assignmentMethod,
        explanation: a.explanation,
      },
      rawPayloadReference: { table: "assignments", id: a.id },
    });
  });
}

/**
 * Fan-out: normalise a specific source type. Returns [] for sources that are
 * not wired today (PM, workflow_items, alerts, score_snapshots) — the
 * registry's `lowDataMessage` is what surfaces in the UI.
 */
export async function normalizeBySource(sourceType: ReportingSourceType): Promise<NormalizedReportingRecord[]> {
  switch (sourceType) {
    case "work_orders":
      return normalizeWorkOrders();
    case "turns":
      return normalizeTurns();
    case "assets":
      return normalizeAssets();
    case "warranties":
      // Warranty rows are derived from asset rows that have a warranty expiration.
      return (await normalizeAssets()).filter((r) => r.dueAt != null);
    case "documents":
      return normalizeDocuments();
    case "assignments":
      return normalizeAssignments();
    case "preventative_maintenance":
    case "workflow_items":
    case "alerts":
    case "score_snapshots":
      return [];
  }
}
