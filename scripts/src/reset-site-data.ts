/**
 * Deliberately destructive, deliberately not wired into any UI button or
 * API route. Run this by hand (`pnpm --filter @workspace/scripts run
 * reset-site-data`) only when you actually mean to wipe every property/
 * work-order/asset/etc. record before importing fresh real data.
 *
 * Does NOT touch: users, user_site_access, login_tokens, user_sessions,
 * account_status (the access-control system), reporting_config,
 * coach_preferences, coach_weekly_summaries, build_audits — none of that
 * is "site data," and none of it should be lost here.
 *
 * workflows/stages are included even though they're structural scaffolding
 * (not per-record data) because they're recreated on demand via
 * getOrCreateWorkOrdersWorkflow() the next time a work order is created —
 * wiping them is safe and avoids leaving a stale "Work Orders" workflow
 * pointing at deleted stages.
 */
import { db } from "@workspace/db";
import {
  impactEventsTable,
  workflowItemHistoryTable,
  workflowItemsTable,
  stagesTable,
  workflowsTable,
  documentsTable,
  alertsTable,
  assignmentsTable,
  importRunsTable,
  turnsTable,
  assetsTable,
  workOrdersTable,
  unitsTable,
  propertiesTable,
} from "@workspace/db/schema";

async function resetSiteData() {
  console.log("Resetting all site data — this deletes every property, unit, work order, turn, asset, and related record.");

  // Children before parents, though nothing here has enforced FK
  // constraints — this order is for logical cleanliness, not correctness.
  await db.delete(impactEventsTable);
  await db.delete(workflowItemHistoryTable);
  await db.delete(workflowItemsTable);
  await db.delete(stagesTable);
  await db.delete(workflowsTable);
  await db.delete(documentsTable);
  await db.delete(alertsTable);
  await db.delete(assignmentsTable);
  await db.delete(importRunsTable);
  await db.delete(turnsTable);
  await db.delete(assetsTable);
  await db.delete(workOrdersTable);
  await db.delete(unitsTable);
  await db.delete(propertiesTable);

  console.log("Done. All site data cleared. Users, access grants, and account/hub config were left untouched.");
}

resetSiteData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
  });
