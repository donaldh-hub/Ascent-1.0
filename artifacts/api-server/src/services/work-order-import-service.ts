/**
 * Single source of truth for turning parsed report rows into work orders.
 *
 * This is the REAL ingestion pipeline — per-row property/unit resolution
 * (resolveProperty/resolveUnit), governance classification, SLA
 * computation, workflow-item creation, import-run recording, and pricing-
 * tier recalculation. It was previously inlined in the POST
 * /work-orders/import route handler; it's extracted here so every delivery
 * method (manual upload, inbound email, and any future API) runs through
 * the exact same resolution/governance logic — never a simpler shortcut
 * that skips per-row property/unit matching (that gap is what let emailed
 * reports silently avoid pricing recalculation before this existed).
 *
 * Callers are responsible for turning their source format (browser-parsed
 * CSV, an email attachment, ...) into `Record<string, string>[]` rows
 * keyed by original header text — extractField() does its own
 * alias-based lookup per field, so header naming doesn't need to be
 * normalized upfront.
 */
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { workOrdersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { isWoSlaViolation } from "./operational-selectors";
import {
  extractField,
  parseDate,
  parseBool,
  parseFloat2,
  parseInt2,
  normalizePriority,
  normalizeStatus,
  normalizeCategory,
  computeSla,
  DEFAULT_SLA_HOURS,
  getOrCreateWorkOrdersWorkflow,
  createWorkflowItemForWorkOrder,
  resolveProperty,
  resolveUnit,
} from "./work-order-service";
import { computeGovernanceFields, recordImportRun, type ImportMode } from "./governance-service";
import { runBillingRecalcInline } from "./agent-runtime/agents/billing-agent.js";

interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

const consoleLogger: MinimalLogger = {
  info: (obj, msg) => console.log(msg ?? "", obj),
  warn: (obj, msg) => console.warn(msg ?? "", obj),
};

export interface ImportWorkOrderRowsOptions {
  rows: Record<string, string>[];
  slaDeadlineHours?: number;
  createWorkflowItems?: boolean;
  importMode?: ImportMode;
  sourceFileName?: string;
  log?: MinimalLogger;
}

export interface ImportRowResult {
  row: number;
  status: "imported" | "error";
  workOrderId?: number;
  workflowItemId?: number;
  unitMatched: boolean;
  propertyMatched: boolean;
  propertyConfidence?: string;
  slaStatus: string;
  isBlocked: boolean;
  bottleneckType?: string | null;
  resolutionStatus?: "fully_resolved" | "partially_resolved" | "unresolved";
  assignmentConfidence?: "high" | "medium" | "low" | "none";
}

export interface ImportWorkOrderRowsResult {
  batchId: string;
  imported: number;
  errors: number;
  slaViolations: number;
  blockedCount: number;
  governance: {
    mode: ImportMode;
    totalRows: number;
    fullyResolved: number;
    partiallyResolved: number;
    unresolved: number;
    readyForFullWiring: number;
    needsUnitConfirmation: number;
    needsReview: number;
    slaViolations: number;
    blockedCount: number;
  };
  results: ImportRowResult[];
  touchedPropertyIds: number[];
}

export async function importWorkOrderRows({
  rows,
  slaDeadlineHours = DEFAULT_SLA_HOURS,
  createWorkflowItems = true,
  importMode = "flexible",
  sourceFileName,
  log = consoleLogger,
}: ImportWorkOrderRowsOptions): Promise<ImportWorkOrderRowsResult> {
  const batchId = randomUUID();

  let fullyResolvedCount = 0;
  let partiallyResolvedCount = 0;
  let unresolvedCount = 0;

  const propertyCache = new Map<string, { propertyId: number | null; confidence: string }>();

  const wfData = createWorkflowItems ? await getOrCreateWorkOrdersWorkflow() : null;

  const results: ImportRowResult[] = [];

  let importedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];

    try {
      const externalId       = extractField(raw, "work_order_id");
      const categoryRaw      = extractField(raw, "category");
      const description      = extractField(raw, "description");
      const priorityRaw      = extractField(raw, "priority");
      const statusRaw        = extractField(raw, "status");
      const assignedTo       = extractField(raw, "assigned_to");
      const notesRaw         = extractField(raw, "notes");

      const regionName       = extractField(raw, "region_name");
      const propertyNameRaw  = extractField(raw, "property_name");
      const unitNumberRaw    = extractField(raw, "unit_number");
      const turnId           = extractField(raw, "turn_id");

      const createdRaw       = extractField(raw, "created_date");
      const scheduledRaw     = extractField(raw, "scheduled_date");
      const responseRaw      = extractField(raw, "first_response_date");
      const completedRaw     = extractField(raw, "completed_date");

      const estimatedHours   = parseFloat2(extractField(raw, "estimated_hours"));
      const actualHours      = parseFloat2(extractField(raw, "actual_hours"));

      const stage            = extractField(raw, "stage");
      const stageStatus      = extractField(raw, "stage_status");
      const daysInStage      = parseInt2(extractField(raw, "days_in_stage"));

      const isBlocked        = parseBool(extractField(raw, "is_blocked"));
      const delayReason      = extractField(raw, "delay_reason");
      const vendor           = extractField(raw, "vendor");

      const bottleneckFlag   = parseBool(extractField(raw, "bottleneck_flag"));
      const bottleneckType   = extractField(raw, "bottleneck_type") ?? null;
      const aggregationScope = extractField(raw, "aggregation_scope");

      const category         = normalizeCategory(categoryRaw);
      const priority         = normalizePriority(priorityRaw);
      const status           = normalizeStatus(statusRaw ?? (completedRaw ? "completed" : undefined));
      const createdDate      = parseDate(createdRaw);
      const scheduledDate    = parseDate(scheduledRaw);
      const firstResponseDate = parseDate(responseRaw);
      const completedDate    = parseDate(completedRaw);

      let propertyId: number | null = null;
      let propertyConfidence = "none";

      if (propertyNameRaw) {
        const cacheKey = propertyNameRaw.toLowerCase().trim();
        if (propertyCache.has(cacheKey)) {
          const cached = propertyCache.get(cacheKey)!;
          propertyId = cached.propertyId;
          propertyConfidence = cached.confidence;
        } else {
          const resolved = await resolveProperty(propertyNameRaw);
          propertyId = resolved.propertyId;
          propertyConfidence = resolved.confidence;
          propertyCache.set(cacheKey, { propertyId, confidence: propertyConfidence });
        }
      }

      let unitId: number | null = null;
      if (unitNumberRaw && propertyId) {
        unitId = await resolveUnit(unitNumberRaw, propertyId);
      }

      const gov = computeGovernanceFields({
        mode: importMode,
        propertyId,
        unitId,
        propertyConfidence,
        unitNumberRaw,
        sourceFileName,
        sourceRowIndex: i,
      });

      if (gov.resolutionStatus === "fully_resolved") fullyResolvedCount++;
      else if (gov.resolutionStatus === "partially_resolved") partiallyResolvedCount++;
      else unresolvedCount++;

      const sla = computeSla(createdDate, firstResponseDate, slaDeadlineHours);

      const [wo] = await db.insert(workOrdersTable).values({
        externalId: externalId ?? null,
        propertyId,
        unitId,
        assetId: null,
        workflowItemId: null,

        category,
        description: description ?? null,
        priority,
        status,
        assignedTo: assignedTo ?? null,
        notes: notesRaw ?? null,

        regionName: regionName ?? null,
        propertyNameRaw: propertyNameRaw ?? null,
        unitNumberRaw: unitNumberRaw ?? null,
        turnId: turnId ?? null,

        createdDate,
        scheduledDate,
        firstResponseDate,
        completedDate,

        estimatedHours,
        actualHours,

        slaDeadlineHours,
        slaStatus: sla.status,
        slaResponseDelayHours: sla.delayHours,

        stage: stage ?? null,
        stageStatus: stageStatus ?? null,
        daysInStage,

        isBlocked,
        delayReason: delayReason ?? null,
        vendor: vendor ?? null,

        bottleneckFlag,
        bottleneckType: bottleneckType ?? null,
        aggregationScope: aggregationScope ?? null,

        importMode: gov.importMode,
        resolutionStatus: gov.resolutionStatus,
        assignmentConfidence: gov.assignmentConfidence,
        propertyMatchStatus: gov.propertyMatchStatus,
        unitMatchStatus: gov.unitMatchStatus,
        sourceFileName: gov.sourceFileName ?? null,
        sourceRowIndex: gov.sourceRowIndex ?? null,
        governanceNotes: gov.governanceNotes,
        excludedFromStrictWiring: gov.excludedFromStrictWiring,
        availableForPropertyRollup: gov.availableForPropertyRollup,
        availableForUnitRollup: gov.availableForUnitRollup,

        rawData: raw,
        importBatchId: batchId,
        importedAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      let workflowItemId: number | undefined;
      if (createWorkflowItems && wfData) {
        const itemId = await createWorkflowItemForWorkOrder(wo, wfData);
        if (itemId) {
          await db.update(workOrdersTable)
            .set({ workflowItemId: itemId })
            .where(eq(workOrdersTable.id, wo.id));
          workflowItemId = itemId;
        }
      }

      importedCount++;
      results.push({
        row: i,
        status: "imported",
        workOrderId: wo.id,
        workflowItemId,
        unitMatched: unitId !== null,
        propertyMatched: propertyId !== null,
        propertyConfidence,
        slaStatus: sla.status,
        isBlocked,
        bottleneckType,
        resolutionStatus: gov.resolutionStatus,
        assignmentConfidence: gov.assignmentConfidence,
      });
    } catch (err) {
      log.warn({ err, row: i }, "Failed to import work order row");
      errorCount++;
      results.push({
        row: i,
        status: "error",
        unitMatched: false,
        propertyMatched: false,
        slaStatus: "pending",
        isBlocked: false,
        resolutionStatus: "unresolved" as const,
        assignmentConfidence: "none" as const,
      });
    }
  }

  const slaViolations = results.filter(r => isWoSlaViolation(r)).length;
  const blockedCount = results.filter(r => r.isBlocked).length;

  await recordImportRun({
    batchId,
    mode: importMode,
    sourceFileName,
    totalRows: rows.length,
    fullyResolvedCount,
    partiallyResolvedCount,
    unresolvedCount,
    errorCount,
    summaryData: { slaViolations, blockedCount },
  });

  log.info(
    { importedCount, errorCount, batchId, blockedCount, fullyResolvedCount, partiallyResolvedCount, unresolvedCount },
    "Work orders imported with governance classification"
  );

  // A site's true unit count is only ever known cumulatively — recheck every
  // property this batch actually touched. Errors here shouldn't fail the import.
  const touchedPropertyIds = [...new Set(
    Array.from(propertyCache.values()).map((c) => c.propertyId).filter((id): id is number => id !== null),
  )];
  for (const propertyId of touchedPropertyIds) {
    try {
      await runBillingRecalcInline(propertyId);
    } catch (err) {
      log.warn({ err, propertyId }, "Failed to recalculate site pricing tier");
    }
  }

  const governance = {
    mode: importMode,
    totalRows: rows.length,
    fullyResolved: fullyResolvedCount,
    partiallyResolved: partiallyResolvedCount,
    unresolved: unresolvedCount,
    readyForFullWiring: fullyResolvedCount,
    needsUnitConfirmation: partiallyResolvedCount,
    needsReview: unresolvedCount,
    slaViolations,
    blockedCount,
  };

  return {
    batchId,
    imported: importedCount,
    errors: errorCount,
    slaViolations,
    blockedCount,
    governance,
    results,
    touchedPropertyIds,
  };
}
