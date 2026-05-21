/**
 * Ascent 7.2.1 — Reporting Config Routes
 *
 *   GET  /api/reporting-config         — returns the active singleton row.
 *   PUT  /api/reporting-config         — updates the mode; emits an audit row.
 *   GET  /api/reporting-config/audit   — recent mode-change audit entries.
 *
 * Every mode change writes to `reporting_config_audit`. The PUT handler
 * never silently re-saves the same value; the audit log only carries true
 * state transitions, so it doubles as a tidy change history.
 */

import { Router, type IRouter } from "express";
import {
  getActiveReportingConfig,
  setReportingMode,
  getReportingConfigAudit,
} from "../services/reporting-config-service.js";
import {
  TURN_WORK_ORDER_REPORTING_MODES,
  type TurnWorkOrderReportingMode,
} from "@workspace/db/schema";

const router: IRouter = Router();

router.get("/reporting-config", async (req, res) => {
  try {
    const active = await getActiveReportingConfig();
    res.json({
      mode: active.mode,
      source: active.config.source,
      isDefault: active.isDefault,
      organizationId: active.config.organizationId,
      propertyId: active.config.propertyId,
      configuredByUserId: active.config.configuredByUserId,
      configuredAt: active.config.configuredAt,
      updatedAt: active.config.updatedAt,
      notes: active.config.notes,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load reporting config");
    res.status(500).json({ error: "Failed to load reporting config" });
  }
});

function parsePutBody(body: unknown): {
  ok: true;
  data: { mode: TurnWorkOrderReportingMode; userId?: string; notes?: string; reason?: string };
} | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.mode !== "string" || !(TURN_WORK_ORDER_REPORTING_MODES as readonly string[]).includes(b.mode)) {
    return {
      ok: false,
      error: `mode must be one of: ${TURN_WORK_ORDER_REPORTING_MODES.join(", ")}`,
    };
  }
  const stringOpt = (key: string, max: number): string | undefined => {
    const v = b[key];
    if (v == null) return undefined;
    if (typeof v !== "string" || v.length > max) return undefined;
    return v;
  };
  return {
    ok: true,
    data: {
      mode: b.mode as TurnWorkOrderReportingMode,
      userId: stringOpt("userId", 200),
      notes: stringOpt("notes", 1000),
      reason: stringOpt("reason", 500),
    },
  };
}

router.put("/reporting-config", async (req, res) => {
  const parsed = parsePutBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const active = await setReportingMode(parsed.data);
    res.json({
      mode: active.mode,
      source: active.config.source,
      isDefault: active.isDefault,
      configuredAt: active.config.configuredAt,
      updatedAt: active.config.updatedAt,
      notes: active.config.notes,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update reporting config");
    res.status(500).json({ error: "Failed to update reporting config" });
  }
});

router.get("/reporting-config/audit", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50) || 50, 200));
  try {
    const entries = await getReportingConfigAudit({ limit });
    res.json({ entries, count: entries.length });
  } catch (err) {
    req.log.error({ err }, "Failed to load reporting config audit");
    res.status(500).json({ error: "Failed to load audit" });
  }
});

export default router;
