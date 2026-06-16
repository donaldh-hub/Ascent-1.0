/**
 * Ascent 7.6 — Evidence Context Analyzer
 *
 * Breaks evidence coverage down by operational context:
 *   - by property (how documented is each property's records?)
 *   - by unit (which units are underdocumented?)
 *   - by document type (what kinds of proof exist?)
 *   - by linked entity type (work orders vs turns vs assets vs PM)
 *
 * Also produces the Missing Documentation report: which operational records
 * have zero supporting documents, ranked by risk context.
 *
 * Does NOT re-run eligibility classification — it reads the already-partitioned
 * NormalizedReportingRecord pool from the orchestrator.
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import { partitionByEligibility } from "./supporting-record-mapper.js";

// ─── Output shapes ────────────────────────────────────────────────────────────

export interface EvidenceContextRow {
  contextKey: string;
  contextLabel: string;
  totalOperationalRecords: number;
  recordsWithEvidence: number;
  recordsWithoutEvidence: number;
  coveragePercent: number;
  /** IDs of operational records without evidence — capped at 100 for the UI. */
  missingDocRecordIds: string[];
  missingDocRecordCount: number;
}

export interface MissingDocRecord {
  recordId: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyId: number | null;
  propertyName: string | null;
  unitId: number | null;
  unitNameOrNumber: string | null;
  category: string | null;
  status: string | null;
  /** Higher = needs documentation more urgently. */
  riskScore: number;
  riskReason: string;
}

export interface EvidenceContextReport {
  generatedAt: string;
  /** Evidence counts grouped by property. */
  byProperty: EvidenceContextRow[];
  /** Evidence counts grouped by unit (only units with ≥1 operational record). */
  byUnit: EvidenceContextRow[];
  /** Evidence counts grouped by entity type (work_orders / turns / assets / etc). */
  byEntityType: EvidenceContextRow[];
  /** Flat list of operational records with zero supporting documents. */
  missingDocs: MissingDocRecord[];
  missingDocCount: number;
  /** Overall org-level summary. */
  summary: {
    totalOperationalRecords: number;
    withEvidence: number;
    withoutEvidence: number;
    coveragePercent: number;
    documentTypeBreakdown: { type: string; count: number }[];
  };
}

// ─── Risk scoring ─────────────────────────────────────────────────────────────

/**
 * Score 0-100: how urgently does this record need documentation?
 * Fully-resolved records without docs rank higher than partials.
 * Assets rank higher than work orders (physical proof matters more).
 */
function scoreRisk(r: NormalizedReportingRecord): { score: number; reason: string } {
  let score = 0;
  let reason = "No supporting documents attached";

  if (r.reportingEligibility === "fully_reportable") {
    score += 50;
    reason = "Fully reportable record with no supporting documentation";
  } else if (r.reportingEligibility === "partially_reportable") {
    score += 25;
  }

  if (r.sourceType === "assets") {
    score += 30;
    reason = `Asset record with no documentation (physical verification risk)`;
  } else if (r.sourceType === "turns") {
    score += 20;
    reason = `Turn record without supporting documentation`;
  } else if (r.sourceType === "work_orders") {
    score += 15;
  } else if (r.sourceType === "preventative_maintenance") {
    score += 20;
    reason = `PM record without completion documentation`;
  }

  if (r.ageDays != null && r.ageDays > 30) {
    score += 10;
    reason += ` — record is ${Math.round(r.ageDays)} days old`;
  }

  return { score: Math.min(score, 100), reason };
}

// ─── Main analyzer ────────────────────────────────────────────────────────────

export function analyseEvidenceByContext(input: {
  documents: NormalizedReportingRecord[];
  operationalRecords: NormalizedReportingRecord[];
}): EvidenceContextReport {
  const now = new Date().toISOString();
  const docPart = partitionByEligibility(input.documents);
  const opPart = partitionByEligibility(input.operationalRecords);
  const opAdmissible = opPart.admissible;

  // Build document linkage map: "work_orders:42" -> docIds[]
  const docsByLink = new Map<string, string[]>();
  for (const d of docPart.admissible) {
    const t = d.supportingContext?.linkedEntityType as string | undefined;
    const i = d.supportingContext?.linkedEntityId as number | string | undefined;
    if (!t || i == null) continue;
    const key = `${normalizeEntityType(t)}:${i}`;
    if (!docsByLink.has(key)) docsByLink.set(key, []);
    docsByLink.get(key)!.push(d.id);
  }

  // Document type breakdown — stored in NormalizedReportingRecord.category
  // (normalizeDocuments maps documentType → category)
  const docTypeCounts = new Map<string, number>();
  for (const d of input.documents) {
    const t = d.category ?? "general";
    docTypeCounts.set(t, (docTypeCounts.get(t) ?? 0) + 1);
  }
  const documentTypeBreakdown = [...docTypeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const withEvidence = opAdmissible.filter((r) => docsByLink.has(r.id));
  const withoutEvidence = opAdmissible.filter((r) => !docsByLink.has(r.id));
  const totalOp = opAdmissible.length;
  const coverage = totalOp === 0 ? 0 : Math.round((withEvidence.length / totalOp) * 100);

  // ── By property ──────────────────────────────────────────────────────────────
  const propMap = new Map<string, { label: string; all: NormalizedReportingRecord[]; with: NormalizedReportingRecord[] }>();
  for (const r of opAdmissible) {
    const key = r.propertyId != null ? String(r.propertyId) : "__none__";
    const label = r.propertyName ?? (r.propertyId != null ? `Property ${r.propertyId}` : "No property");
    if (!propMap.has(key)) propMap.set(key, { label, all: [], with: [] });
    propMap.get(key)!.all.push(r);
    if (docsByLink.has(r.id)) propMap.get(key)!.with.push(r);
  }
  const byProperty: EvidenceContextRow[] = [...propMap.entries()].map(([key, v]) => {
    const without = v.all.filter((r) => !docsByLink.has(r.id));
    return {
      contextKey: key,
      contextLabel: v.label,
      totalOperationalRecords: v.all.length,
      recordsWithEvidence: v.with.length,
      recordsWithoutEvidence: without.length,
      coveragePercent: v.all.length === 0 ? 0 : Math.round((v.with.length / v.all.length) * 100),
      missingDocRecordIds: without.slice(0, 100).map((r) => r.id),
      missingDocRecordCount: without.length,
    };
  }).sort((a, b) => a.coveragePercent - b.coveragePercent);

  // ── By unit ──────────────────────────────────────────────────────────────────
  const unitMap = new Map<string, { label: string; all: NormalizedReportingRecord[]; with: NormalizedReportingRecord[] }>();
  for (const r of opAdmissible) {
    if (r.unitId == null) continue;
    const key = String(r.unitId);
    const label = r.unitNameOrNumber ?? `Unit ${r.unitId}`;
    if (!unitMap.has(key)) unitMap.set(key, { label, all: [], with: [] });
    unitMap.get(key)!.all.push(r);
    if (docsByLink.has(r.id)) unitMap.get(key)!.with.push(r);
  }
  const byUnit: EvidenceContextRow[] = [...unitMap.entries()].map(([key, v]) => {
    const without = v.all.filter((r) => !docsByLink.has(r.id));
    return {
      contextKey: key,
      contextLabel: v.label,
      totalOperationalRecords: v.all.length,
      recordsWithEvidence: v.with.length,
      recordsWithoutEvidence: without.length,
      coveragePercent: v.all.length === 0 ? 0 : Math.round((v.with.length / v.all.length) * 100),
      missingDocRecordIds: without.slice(0, 100).map((r) => r.id),
      missingDocRecordCount: without.length,
    };
  }).sort((a, b) => a.coveragePercent - b.coveragePercent);

  // ── By entity type ────────────────────────────────────────────────────────────
  const entityTypeMap = new Map<string, { all: NormalizedReportingRecord[]; with: NormalizedReportingRecord[] }>();
  for (const r of opAdmissible) {
    const key = r.sourceType;
    if (!entityTypeMap.has(key)) entityTypeMap.set(key, { all: [], with: [] });
    entityTypeMap.get(key)!.all.push(r);
    if (docsByLink.has(r.id)) entityTypeMap.get(key)!.with.push(r);
  }
  const byEntityType: EvidenceContextRow[] = [...entityTypeMap.entries()].map(([key, v]) => {
    const without = v.all.filter((r) => !docsByLink.has(r.id));
    return {
      contextKey: key,
      contextLabel: entityTypeLabel(key),
      totalOperationalRecords: v.all.length,
      recordsWithEvidence: v.with.length,
      recordsWithoutEvidence: without.length,
      coveragePercent: v.all.length === 0 ? 0 : Math.round((v.with.length / v.all.length) * 100),
      missingDocRecordIds: without.slice(0, 100).map((r) => r.id),
      missingDocRecordCount: without.length,
    };
  }).sort((a, b) => a.coveragePercent - b.coveragePercent);

  // ── Missing docs report ───────────────────────────────────────────────────────
  const missingDocs: MissingDocRecord[] = withoutEvidence
    .map((r) => {
      const { score, reason } = scoreRisk(r);
      return {
        recordId: r.id,
        sourceType: r.sourceType,
        sourceRecordId: r.sourceRecordId,
        propertyId: r.propertyId,
        propertyName: r.propertyName,
        unitId: r.unitId,
        unitNameOrNumber: r.unitNameOrNumber,
        category: r.category,
        status: r.status,
        riskScore: score,
        riskReason: reason,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);

  return {
    generatedAt: now,
    byProperty,
    byUnit,
    byEntityType,
    missingDocs: missingDocs.slice(0, 200),
    missingDocCount: missingDocs.length,
    summary: {
      totalOperationalRecords: totalOp,
      withEvidence: withEvidence.length,
      withoutEvidence: withoutEvidence.length,
      coveragePercent: coverage,
      documentTypeBreakdown,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeEntityType(t: string): string {
  switch (t) {
    case "work_order": return "work_orders";
    case "turn": return "turns";
    case "asset": return "assets";
    default: return t;
  }
}

function entityTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case "work_orders": return "Work Orders";
    case "turns": return "Turns";
    case "assets": return "Assets";
    case "preventative_maintenance": return "Preventative Maintenance";
    case "documents": return "Documents";
    case "assignments": return "Assignments";
    default: return sourceType.replace(/_/g, " ");
  }
}
