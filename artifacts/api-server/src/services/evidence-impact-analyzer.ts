/**
 * Ascent 7.2 — Evidence / Documentation Impact Analyzer
 *
 * Measures whether operational claims (work orders, turns, assets) are
 * backed by supporting documents. Missing evidence is surfaced as a
 * confidence-reduction signal — never as a blocking error.
 *
 * Today the documents source has zero rows wired, so this engine reports
 * the honest empty state. When documents arrive, the same analysis fires
 * across work_orders + turns + assets joined to documents.
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import {
  type AnalysisOutput,
  type ContributingFactor,
  buildReportabilityBasis,
  deriveConfidenceState,
  emptyAnalysis,
  makeAnalysisId,
} from "./analysis-output-contract.js";
import {
  computeDateRange,
  partitionByEligibility,
  summarizeMissingFields,
} from "./supporting-record-mapper.js";

const SURFACES = ["reports_page", "control_tower", "operational_health_tile"] as const;
const MIN_FOR_CONFIRMED = 5;

export function analyseEvidence(input: {
  documents: NormalizedReportingRecord[];
  /** Operational records that *could* have supporting evidence. */
  operationalRecords: NormalizedReportingRecord[];
}): AnalysisOutput[] {
  const docPart = partitionByEligibility(input.documents);
  const opPart = partitionByEligibility(input.operationalRecords);

  if (input.operationalRecords.length === 0) {
    return [
      emptyAnalysis({
        analysisType: "evidence_impact",
        sourceCategory: "documents",
        title: "Evidence & documentation impact",
        summary:
          "No operational records were available to evaluate documentation coverage.",
        excludedRecordCount: 0,
        compatibleSurfaces: [...SURFACES],
        recommendedReviewQuestion:
          "Ingest work orders, turns, and asset records so documentation coverage can be measured.",
      }),
    ];
  }

  // Linkage check: a normalized document carries linkedEntityType/Id in its
  // supportingContext. We resolve documents per source type for the rough
  // coverage calculation. This is intentionally a count — Build 7.3 will
  // produce the narrative; we only produce the analysis.
  const docsByLink = new Map<string, string[]>(); // "work_orders:42" -> [docIds]
  for (const d of docPart.admissible) {
    const t = d.supportingContext?.linkedEntityType as string | undefined;
    const i = d.supportingContext?.linkedEntityId as number | string | undefined;
    if (!t || i == null) continue;
    const key = `${linkTypeToSource(t)}:${i}`;
    if (!docsByLink.has(key)) docsByLink.set(key, []);
    docsByLink.get(key)!.push(d.id);
  }

  const opAdmissible = opPart.admissible;
  const withEvidence = opAdmissible.filter((r) => docsByLink.has(r.id));
  const withoutEvidence = opAdmissible.filter((r) => !docsByLink.has(r.id));

  const factors: ContributingFactor[] = [
    {
      label: "Records with supporting documents",
      displayValue: `${withEvidence.length} records`,
      numericValue: withEvidence.length,
      count: withEvidence.length,
      supportingRecordIds: withEvidence.map((r) => r.id),
    },
    {
      label: "Records without supporting documents",
      displayValue: `${withoutEvidence.length} records`,
      numericValue: withoutEvidence.length,
      count: withoutEvidence.length,
      supportingRecordIds: withoutEvidence.slice(0, 200).map((r) => r.id),
    },
  ];

  const coverage = opAdmissible.length === 0 ? 0 : Math.round((withEvidence.length / opAdmissible.length) * 100);
  const now = new Date().toISOString();
  // Confidence here is bounded by the document source as well as the
  // operational source. If no documents exist at all, evidence analysis
  // is insufficient regardless of how many ops records we have.
  const confidenceState = docPart.admissible.length === 0
    ? "insufficient_data"
    : deriveConfidenceState({
        fullyReportable: docPart.fully.length,
        partiallyReportable: docPart.partial.length + opPart.partial.length,
        minimumFullyForConfirmed: MIN_FOR_CONFIRMED,
      });

  return [
    {
      analysisId: makeAnalysisId("evidence_impact", "documentation-coverage"),
      analysisType: "evidence_impact",
      sourceCategory: "documents",
      organizationId: null,
      propertyId: null,
      unitId: null,
      dateRange: computeDateRange(opAdmissible),
      title: "Documentation coverage of operational records",
      summary:
        docPart.admissible.length === 0
          ? `No documents are currently ingested. ${opAdmissible.length} operational record(s) have no evidence attached — confidence in their supporting proof is reduced until documents are uploaded.`
          : `${coverage}% of admissible operational records have at least one supporting document (${withEvidence.length} of ${opAdmissible.length}).`,
      metricValue: coverage,
      metricUnit: "% records with evidence",
      comparisonValue: null,
      trendDirection: null,
      timeAllocationShare: null,
      estimatedTimeImpactHours: null,
      bottleneckStage: null,
      primaryCategory: null,
      contributingFactors: factors,
      confidenceState,
      reportabilityBasis: buildReportabilityBasis({
        fullyReportable: docPart.fully.length,
        partiallyReportable: docPart.partial.length,
        excluded: docPart.excluded.length,
      }),
      fullyReportableRecordCount: docPart.fully.length,
      partiallyReportableRecordCount: docPart.partial.length,
      excludedRecordCount: docPart.excluded.length,
      missingFields: summarizeMissingFields(opAdmissible),
      // Cap both id list and count together so the UI is truthful:
      // "View N supporting records" must equal what the drill returns.
      supportingRecordIds: withoutEvidence.slice(0, 200).map((r) => r.id),
      supportingRecordCount: Math.min(withoutEvidence.length, 200),
      recommendedReviewQuestion:
        "Which records should have supporting documentation attached before being relied on in reports?",
      compatibleSurfaces: [...SURFACES],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * Documents reference entities via `documents.linked_entity_type` which is a
 * free-text column. Build 7.2's contract requires the producer to write one
 * of the canonical NormalizedReportingRecord source prefixes (work_orders,
 * turns, assets). For resilience we also accept the singular form a writer
 * might naively use. Today the documents table is empty so no historical
 * data depends on either spelling — any new writer MUST use the plural
 * canonical form to ensure evidence matching succeeds.
 */
const ALLOWED_DOCUMENT_LINK_TYPES = new Set([
  "work_orders",
  "turns",
  "assets",
  // Resilience aliases — accept singular but normalise to plural.
  "work_order",
  "turn",
  "asset",
]);

function linkTypeToSource(linkType: string): string {
  if (!ALLOWED_DOCUMENT_LINK_TYPES.has(linkType)) return linkType;
  switch (linkType) {
    case "work_order": return "work_orders";
    case "turn": return "turns";
    case "asset": return "assets";
    default: return linkType;
  }
}
