/**
 * Ascent 7.2.1 — Reporting Config Service
 *
 * Singleton-style accessor for the org-level Turn / Work Order Reporting
 * Mode. Because the `organizations` table does not yet exist, we treat
 * the "default" row (organizationId IS NULL, propertyId IS NULL) as the
 * active configuration for the whole instance.
 *
 * Every mode change must be auditable — `setReportingMode()` writes a row
 * to reporting_config_audit so we can answer "who changed the
 * interpretation and when" later.
 */

import { db } from "@workspace/db";
import {
  reportingConfigTable,
  reportingConfigAuditTable,
  type ReportingConfig,
  type ReportingConfigAudit,
  type TurnWorkOrderReportingMode,
  TURN_WORK_ORDER_REPORTING_MODES,
} from "@workspace/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

const DEFAULT_MODE: TurnWorkOrderReportingMode = "hybrid_or_unknown";

/**
 * Ascent 7.4 — Single source of truth for "what record set is driving turn
 * signals right now?". Used by /api/dashboard/summary and /api/turns/stats so
 * the client banner + gate logic never disagree about provenance. Keep this
 * here (not duplicated in routes) so future mode additions update both
 * endpoints atomically.
 */
export type TurnSignalSource = "turn_records" | "linked_work_orders" | "unknown";

export function deriveTurnSignalSource(
  mode: TurnWorkOrderReportingMode | string,
): TurnSignalSource {
  if (mode === "separate_turns_and_work_orders") return "turn_records";
  if (mode === "work_orders_measure_turn_progress") return "linked_work_orders";
  return "unknown";
}

/**
 * The analysis categories whose interpretation is affected when the
 * mode changes. Persisted on every audit row so the change is traceable
 * to what the user is about to see differently.
 */
const AFFECTED_CATEGORIES = [
  "work_order_time_allocation",
  "turn_time_allocation",
  "cross_category_pressure",
  "control_tower_priority_actions",
  "reports_page",
];

export interface ActiveReportingConfig {
  config: ReportingConfig;
  mode: TurnWorkOrderReportingMode;
  isDefault: boolean;
}

/**
 * Returns the active config, creating the default row on first call. This
 * keeps callers simple (they always get something back) while preserving
 * the spec rule that "if not answered yet, treat as hybrid_or_unknown".
 */
export async function getActiveReportingConfig(): Promise<ActiveReportingConfig> {
  const existing = await db
    .select()
    .from(reportingConfigTable)
    .where(and(isNull(reportingConfigTable.organizationId), isNull(reportingConfigTable.propertyId)))
    .limit(1);

  if (existing.length > 0) {
    const config = existing[0]!;
    return {
      config,
      mode: config.turnWorkOrderReportingMode as TurnWorkOrderReportingMode,
      isDefault: config.source === "default",
    };
  }

  const [created] = await db
    .insert(reportingConfigTable)
    .values({
      organizationId: null,
      propertyId: null,
      turnWorkOrderReportingMode: DEFAULT_MODE,
      source: "default",
      notes: "Auto-created on first access. The organization has not yet "
        + "confirmed how turn progress is tracked.",
    })
    .returning();
  return { config: created!, mode: DEFAULT_MODE, isDefault: true };
}

export interface SetReportingModeInput {
  mode: TurnWorkOrderReportingMode;
  userId?: string | null;
  notes?: string | null;
  reason?: string | null;
}

export async function setReportingMode(
  input: SetReportingModeInput,
): Promise<ActiveReportingConfig> {
  if (!TURN_WORK_ORDER_REPORTING_MODES.includes(input.mode)) {
    throw new Error(`Invalid reporting mode: ${input.mode}`);
  }

  const current = await getActiveReportingConfig();
  const oldMode = current.mode;

  const [updated] = await db
    .update(reportingConfigTable)
    .set({
      turnWorkOrderReportingMode: input.mode,
      configuredByUserId: input.userId ?? null,
      notes: input.notes ?? current.config.notes,
      source: "user_selected",
      updatedAt: new Date(),
    })
    .where(eq(reportingConfigTable.id, current.config.id))
    .returning();

  // Only audit ACTUAL changes — repeated saves of the same value are noise.
  if (oldMode !== input.mode) {
    await db.insert(reportingConfigAuditTable).values({
      organizationId: null,
      propertyId: null,
      oldMode,
      newMode: input.mode,
      userId: input.userId ?? null,
      reason: input.reason ?? null,
      affectedAnalysisCategories: AFFECTED_CATEGORIES,
    });
  }

  return {
    config: updated!,
    mode: input.mode,
    isDefault: false,
  };
}

export async function getReportingConfigAudit(
  opts: { limit?: number } = {},
): Promise<ReportingConfigAudit[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  return db
    .select()
    .from(reportingConfigAuditTable)
    .orderBy(desc(reportingConfigAuditTable.changedAt))
    .limit(limit);
}
