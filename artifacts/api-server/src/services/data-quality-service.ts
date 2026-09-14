import { db } from "@workspace/db";
import { workOrdersTable, assetsTable, propertiesTable } from "@workspace/db/schema";
import { sql, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface DataQualityIssue {
  issueId: string;
  severity: "blocking" | "warning" | "suggestion";
  category: "work_orders" | "assets" | "properties" | "assignments";
  title: string;
  detail: string;
  count: number;
  resolution: string;
}

export interface DataQualityReport {
  generatedAt: string;
  overallHealth: "healthy" | "degraded" | "critical";
  issues: DataQualityIssue[];
  blockingCount: number;
  warningCount: number;
  totalRecordsChecked: number;
}

export async function runDataQualityCheck(): Promise<DataQualityReport> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const issues: DataQualityIssue[] = [];

  const [woTotalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable);
  const [assetTotalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(assetsTable);
  const [propTotalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable);

  const woTotal = woTotalRow?.count ?? 0;
  const assetTotal = assetTotalRow?.count ?? 0;
  const propTotal = propTotalRow?.count ?? 0;
  const totalRecordsChecked = woTotal + assetTotal + propTotal;

  // ── WOs missing status ────────────────────────────────────────────────────
  const [missingStatusRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.status} is null or ${workOrdersTable.status} = ''`);

  const missingStatus = missingStatusRow?.count ?? 0;
  if (missingStatus > 0) {
    issues.push({
      issueId: randomUUID(),
      severity: "warning",
      category: "work_orders",
      title: "Work orders missing status",
      detail: `${missingStatus} work order${missingStatus > 1 ? "s" : ""} have no status value, which prevents accurate open/closed tracking.`,
      count: missingStatus,
      resolution: "Update the status field in your source system and re-upload, or use the Work Orders page to set statuses manually.",
    });
  }

  // ── WOs missing category ──────────────────────────────────────────────────
  const [missingCategoryRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.category} is null or ${workOrdersTable.category} = ''`);

  const missingCategory = missingCategoryRow?.count ?? 0;
  if (missingCategory > 0) {
    issues.push({
      issueId: randomUUID(),
      severity: "suggestion",
      category: "work_orders",
      title: "Work orders missing category",
      detail: `${missingCategory} work order${missingCategory > 1 ? "s" : ""} have no category. Category tagging improves trend analysis and coaching insights.`,
      count: missingCategory,
      resolution: "Add a category column to your CSV exports (e.g. HVAC, Plumbing, Electrical) and re-upload.",
    });
  }

  // ── Duplicate work orders (same external id + property) ──────────────────
  const dupeGroups = await db
    .select({
      externalId: workOrdersTable.externalId,
      propertyId: workOrdersTable.propertyId,
      count: sql<number>`count(*)::int`,
    })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.externalId} is not null and ${workOrdersTable.externalId} != '' and ${workOrdersTable.propertyId} is not null`)
    .groupBy(workOrdersTable.externalId, workOrdersTable.propertyId)
    .having(sql`count(*) > 1`);

  const duplicateExtraRows = dupeGroups.reduce((sum, g) => sum + (g.count - 1), 0);
  if (duplicateExtraRows > 0) {
    issues.push({
      issueId: randomUUID(),
      severity: "warning",
      category: "work_orders",
      title: "Duplicate work orders detected",
      detail: `${dupeGroups.length} work order${dupeGroups.length > 1 ? "s" : ""} on ${dupeGroups.length > 1 ? "have" : "has"} the same external ID recorded more than once for the same property (${duplicateExtraRows} redundant record${duplicateExtraRows > 1 ? "s" : ""} total). This can double-count work in portfolio metrics.`,
      count: duplicateExtraRows,
      resolution: "Review and remove the redundant records on the Work Orders page. New uploads are now checked for this automatically.",
    });
  }

  // ── Work orders with reversed/impossible dates ────────────────────────────
  const [reversedDatesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`
      (${workOrdersTable.firstResponseDate} is not null and ${workOrdersTable.createdDate} is not null and ${workOrdersTable.firstResponseDate} < ${workOrdersTable.createdDate})
      or (${workOrdersTable.completedDate} is not null and ${workOrdersTable.createdDate} is not null and ${workOrdersTable.completedDate} < ${workOrdersTable.createdDate})
    `);

  const reversedDates = reversedDatesRow?.count ?? 0;
  if (reversedDates > 0) {
    issues.push({
      issueId: randomUUID(),
      severity: "warning",
      category: "work_orders",
      title: "Work orders with dates out of order",
      detail: `${reversedDates} work order${reversedDates > 1 ? "s show" : " shows"} a response or completion date earlier than the creation date — almost always a date format mismatch in the source file, not a real record. These are excluded from SLA compliance until corrected.`,
      count: reversedDates,
      resolution: "Check the date columns in your source export for a format mismatch (e.g. day/month swapped) and re-upload, or correct the dates on the Work Orders page.",
    });
  }

  // ── Assets with no property linked ────────────────────────────────────────
  const [unlinkedAssetsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(isNull(assetsTable.propertyId));

  const unlinkedAssets = unlinkedAssetsRow?.count ?? 0;
  if (unlinkedAssets > 0) {
    issues.push({
      issueId: randomUUID(),
      severity: "warning",
      category: "assets",
      title: "Assets not linked to a property",
      detail: `${unlinkedAssets} asset${unlinkedAssets > 1 ? "s" : ""} have no property association, which excludes them from property-level performance reports.`,
      count: unlinkedAssets,
      resolution: "Edit these assets to assign a property, or include a property column in your asset upload file.",
    });
  }

  // ── Properties with zero work orders ──────────────────────────────────────
  const propWoCounts = await db
    .select({
      propertyId: propertiesTable.id,
      woCount: sql<number>`count(${workOrdersTable.id})::int`,
    })
    .from(propertiesTable)
    .leftJoin(workOrdersTable, sql`${workOrdersTable.propertyId} = ${propertiesTable.id}`)
    .groupBy(propertiesTable.id)
    .having(sql`count(${workOrdersTable.id}) = 0`);

  const emptyProps = propWoCounts.length;
  if (emptyProps > 0) {
    issues.push({
      issueId: randomUUID(),
      severity: "suggestion",
      category: "properties",
      title: "Properties with no work orders",
      detail: `${emptyProps} propert${emptyProps > 1 ? "ies" : "y"} have no associated work orders, which may indicate unmatched records or unmapped properties.`,
      count: emptyProps,
      resolution: "Verify property names in your work order uploads match the properties in the system. Use the Upload page to re-import with corrected data.",
    });
  }

  // ── Stale open WOs (open > 30 days) ──────────────────────────────────────
  const [staleOpenRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(
      sql`${workOrdersTable.status} in ('submitted', 'assigned', 'in_progress') and ${workOrdersTable.createdDate} < ${thirtyDaysAgo.toISOString()}`
    );

  const staleOpen = staleOpenRow?.count ?? 0;
  if (staleOpen > 0) {
    issues.push({
      issueId: randomUUID(),
      severity: "warning",
      category: "work_orders",
      title: "Stale open work orders",
      detail: `${staleOpen} work order${staleOpen > 1 ? "s" : ""} have been open for more than 30 days without being completed or cancelled.`,
      count: staleOpen,
      resolution: "Review these work orders for blockers or abandonments. Close or cancel items that are no longer actionable.",
    });
  }

  const blockingCount = issues.filter((i) => i.severity === "blocking").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  const overallHealth: "healthy" | "degraded" | "critical" =
    blockingCount > 0 ? "critical" : warningCount > 3 ? "degraded" : "healthy";

  return {
    generatedAt: now.toISOString(),
    overallHealth,
    issues,
    blockingCount,
    warningCount,
    totalRecordsChecked,
  };
}
