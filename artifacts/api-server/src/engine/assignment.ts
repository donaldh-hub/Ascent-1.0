/**
 * Phase 1 — Build 1.7: Assignment Engine
 *
 * Centralized service that normalizes input records, matches them against
 * existing entities (properties + units), calculates confidence, and
 * persists confirmed assignments.
 *
 * ALL logic lives here — never inside UI components or route handlers.
 */

import { db } from "@workspace/db";
import {
  assignmentsTable,
  propertiesTable,
  unitsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import type { Property, Unit, AssignmentSourceType } from "@workspace/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low";

export interface SourceRecord {
  sourceType: AssignmentSourceType;
  /** Raw fields from the uploaded data */
  rawData: Record<string, unknown>;
  /** Hint fields already extracted by the caller */
  unitHint?: string;
  propertyHint?: string;
  descriptionHint?: string;
}

export interface MatchResult {
  unit: Unit | null;
  property: Property | null;
  confidenceLevel: ConfidenceLevel;
  explanation: string;
}

export interface ProcessResult {
  sourceType: AssignmentSourceType;
  sourceData: Record<string, unknown>;
  match: MatchResult;
  /** Only set when status is "assigned" (HIGH confidence → auto-assigned) */
  assignmentId?: number;
  status: "assigned" | "pending" | "rejected";
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize a string for comparison: trim, lowercase, collapse whitespace,
 * remove common unit-number prefixes (e.g. "unit 3b" → "3b", "apt 3b" → "3b").
 */
export function normalizeStr(s: string | null | undefined): string {
  if (!s) return "";
  let n = s.trim().toLowerCase().replace(/\s+/g, " ");
  // Strip leading prefixes like "unit ", "apt ", "suite ", "#"
  n = n.replace(/^(unit|apt|apartment|suite|room|#)\s*/i, "");
  return n;
}

/** Normalize a property name: lowercase, collapse whitespace */
function normalizeProp(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ─── String similarity ────────────────────────────────────────────────────────

/** Simple contains-check similarity for unit/property fields */
function containsMatch(a: string, b: string): boolean {
  const na = normalizeStr(a);
  const nb = normalizeStr(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Edit distance / similarity ratio (Levenshtein) for fuzzy matching */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarityRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// ─── Matching core ────────────────────────────────────────────────────────────

interface CandidateScore {
  unit: Unit;
  property: Property;
  score: number;
  exactUnit: boolean;
  exactProperty: boolean;
}

function scoreCandidate(
  unitHint: string,
  propertyHint: string,
  unit: Unit,
  property: Property
): CandidateScore {
  const normUnit = normalizeStr(unit.unitNumber);
  const normProp = normalizeProp(property.name);
  const normHintUnit = normalizeStr(unitHint);
  const normHintProp = normalizeProp(propertyHint);

  const exactUnit = normUnit === normHintUnit;
  const exactProperty = normHintProp ? normProp === normHintProp : true; // if no property hint, don't penalize

  // Similarity ratios
  const unitSim = exactUnit ? 1 : Math.max(
    similarityRatio(normUnit, normHintUnit),
    containsMatch(normUnit, normHintUnit) ? 0.8 : 0
  );

  const propSim = normHintProp
    ? exactProperty
      ? 1
      : Math.max(
          similarityRatio(normProp, normHintProp),
          containsMatch(normProp, normHintProp) ? 0.7 : 0
        )
    : 0.5; // neutral if no property hint

  const score = unitSim * 0.7 + propSim * 0.3;

  return { unit, property, score, exactUnit, exactProperty };
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export class AssignmentEngine {
  private units: Unit[] = [];
  private properties: Property[] = [];
  private propMap: Map<number, Property> = new Map();

  async loadContext(): Promise<void> {
    const [units, properties] = await Promise.all([
      db.select().from(unitsTable),
      db.select().from(propertiesTable),
    ]);
    this.units = units;
    this.properties = properties;
    this.propMap = new Map(properties.map((p) => [p.id, p]));
  }

  /**
   * Match a source record against all known units/properties.
   * Returns the best match with a confidence level and explanation.
   */
  matchRecord(record: SourceRecord): MatchResult {
    const { unitHint = "", propertyHint = "" } = record;

    if (!unitHint.trim() && !propertyHint.trim()) {
      return {
        unit: null,
        property: null,
        confidenceLevel: "low",
        explanation: "No unit or property information found in the record.",
      };
    }

    const candidates: CandidateScore[] = [];

    for (const unit of this.units) {
      const property = this.propMap.get(unit.propertyId);
      if (!property) continue;
      const scored = scoreCandidate(unitHint, propertyHint, unit, property);
      candidates.push(scored);
    }

    if (candidates.length === 0) {
      return {
        unit: null,
        property: null,
        confidenceLevel: "low",
        explanation: "No units exist in the system to match against.",
      };
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Confidence thresholds
    if (best.exactUnit && best.exactProperty) {
      return {
        unit: best.unit,
        property: best.property,
        confidenceLevel: "high",
        explanation: `Matched by exact unit number "${best.unit.unitNumber}" and property "${best.property.name}".`,
      };
    }

    if (best.exactUnit && !propertyHint.trim() && this.properties.length === 1) {
      // Only one property exists — exact unit match is enough for high confidence
      return {
        unit: best.unit,
        property: best.property,
        confidenceLevel: "high",
        explanation: `Matched by exact unit number "${best.unit.unitNumber}" (single property in system: "${best.property.name}").`,
      };
    }

    if (best.score >= 0.75) {
      const unitLabel = best.exactUnit
        ? `exact unit "${best.unit.unitNumber}"`
        : `similar unit "${best.unit.unitNumber}" (close match to "${unitHint}")`;
      const propLabel = best.exactProperty
        ? `exact property "${best.property.name}"`
        : `similar property "${best.property.name}" (close match to "${propertyHint}")`;
      return {
        unit: best.unit,
        property: best.property,
        confidenceLevel: "medium",
        explanation: `Possible match by ${unitLabel} and ${propLabel}. Confirmation required.`,
      };
    }

    if (best.score >= 0.45) {
      return {
        unit: best.unit,
        property: best.property,
        confidenceLevel: "low",
        explanation: `Weak match found: unit "${best.unit.unitNumber}" in "${best.property.name}" — not reliable enough to assign automatically.`,
      };
    }

    return {
      unit: null,
      property: null,
      confidenceLevel: "low",
      explanation: `No reliable match found for unit "${unitHint}"${propertyHint ? ` in property "${propertyHint}"` : ""}.`,
    };
  }

  /**
   * Process a batch of source records:
   * - HIGH confidence → auto-assign immediately (persist to DB)
   * - MEDIUM confidence → persist as "pending" for user confirmation
   * - LOW confidence → persist as "pending" for review queue
   */
  async processBatch(records: SourceRecord[]): Promise<ProcessResult[]> {
    await this.loadContext();
    const results: ProcessResult[] = [];

    for (const record of records) {
      const match = this.matchRecord(record);

      if (match.confidenceLevel === "high" && match.unit) {
        // AUTO-ASSIGN: persist immediately
        const [assignment] = await db.insert(assignmentsTable).values({
          sourceType: record.sourceType,
          sourceData: record.rawData,
          targetEntityType: "unit",
          targetEntityId: match.unit.id,
          confidenceLevel: "high",
          assignmentMethod: "auto",
          status: "assigned",
          explanation: match.explanation,
        }).returning();

        results.push({
          sourceType: record.sourceType,
          sourceData: record.rawData,
          match,
          assignmentId: assignment.id,
          status: "assigned",
        });
      } else {
        // MEDIUM or LOW → persist as pending
        const [assignment] = await db.insert(assignmentsTable).values({
          sourceType: record.sourceType,
          sourceData: record.rawData,
          targetEntityType: match.unit ? "unit" : null,
          targetEntityId: match.unit?.id ?? null,
          confidenceLevel: match.confidenceLevel,
          assignmentMethod: match.confidenceLevel === "medium" ? "suggested" : null,
          status: "pending",
          explanation: match.explanation,
        }).returning();

        results.push({
          sourceType: record.sourceType,
          sourceData: record.rawData,
          match,
          assignmentId: assignment.id,
          status: "pending",
        });
      }
    }

    return results;
  }

  /**
   * Confirm a suggested (medium confidence) assignment.
   * Persists the assignment as "assigned".
   */
  static async confirmAssignment(assignmentId: number): Promise<void> {
    await db.update(assignmentsTable)
      .set({ status: "assigned", assignmentMethod: "suggested", updatedAt: new Date() })
      .where(eq(assignmentsTable.id, assignmentId));
  }

  /**
   * Reject a suggested assignment — moves to review queue (stays pending but method=null).
   */
  static async rejectAssignment(assignmentId: number): Promise<void> {
    await db.update(assignmentsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(assignmentsTable.id, assignmentId));
  }

  /**
   * Manually assign a record to a specific unit.
   */
  static async manualAssign(assignmentId: number, unitId: number): Promise<void> {
    await db.update(assignmentsTable)
      .set({
        targetEntityType: "unit",
        targetEntityId: unitId,
        assignmentMethod: "manual",
        status: "assigned",
        confidenceLevel: "high",
        explanation: "Manually assigned by user.",
        updatedAt: new Date(),
      })
      .where(eq(assignmentsTable.id, assignmentId));
  }
}

// ─── CSV field extraction helpers ─────────────────────────────────────────────

/**
 * Given a CSV row (Record<string, string>), try common field names
 * to extract unit and property hints.
 */
export function extractHintsFromRow(row: Record<string, string>): {
  unitHint: string;
  propertyHint: string;
  descriptionHint: string;
} {
  const find = (...keys: string[]): string => {
    for (const key of keys) {
      const match = Object.entries(row).find(
        ([k]) => k.trim().toLowerCase().replace(/[\s_-]+/g, "") === key.toLowerCase().replace(/[\s_-]+/g, "")
      );
      if (match?.[1]?.trim()) return match[1].trim();
    }
    return "";
  };

  return {
    unitHint: find("unit", "unitnumber", "unitno", "unit_number", "apt", "apartment", "room", "suite"),
    propertyHint: find("property", "propertyname", "property_name", "building", "complex", "site"),
    descriptionHint: find("description", "notes", "comment", "details", "work", "issue", "summary"),
  };
}
