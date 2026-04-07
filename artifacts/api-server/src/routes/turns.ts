/**
 * Build 1.10 — Turn Matrix Routes
 *
 * POST /api/turns/reset    — clear all turns
 * POST /api/turns/import   — CSV row ingestion
 * GET  /api/turns          — list with filters
 * GET  /api/turns/stats    — lightweight aggregate stats
 * GET  /api/turns/matrix   — full matrix analysis
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { turnsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  buildTurnMatrix,
  getTurnStats,
  getTurnStatsByProperty,
  resolvePropertyForTurn,
  resolveUnitForTurn,
  computeRentReady,
  computeIsBlocked,
  enrichTurn,
  STAGE_SEQUENCE,
} from "../services/turn-matrix-service";

const router = Router();

// ─── Helper: parse boolean from CSV string ────────────────────────────────────

function parseBoolField(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function parseIntField(v: string | undefined, fallback = 0): number {
  const n = parseInt(v ?? "", 10);
  return isNaN(n) ? fallback : n;
}

function parseFloatField(v: string | undefined, fallback = 0): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? fallback : n;
}

function normalizeStage(stage: string | undefined): string {
  if (!stage) return "Trash Out";
  const cleaned = stage.trim();
  // Find exact match in sequence
  const match = STAGE_SEQUENCE.find(
    s => s.toLowerCase() === cleaned.toLowerCase()
  );
  return match ?? cleaned;
}

function normalizeTurnStatus(status: string | undefined): "active" | "completed" | "in_rework" {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "completed" || s === "complete") return "completed";
  if (s === "in_rework" || s === "rework") return "in_rework";
  return "active";
}

// ─── POST /api/turns/reset ────────────────────────────────────────────────────

router.post("/turns/reset", async (req, res) => {
  try {
    await db.delete(turnsTable);
    res.json({ success: true, message: "All turns deleted." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Reset failed", detail: msg });
  }
});

// ─── POST /api/turns/import ───────────────────────────────────────────────────

router.post("/turns/import", async (req, res) => {
  try {
    const rows: Record<string, string>[] = req.body?.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "No rows provided" });
      return;
    }

    const batchId = randomUUID();
    const propertyCache = new Map<string, number | null>();
    const unitCache = new Map<string, number | null>();

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const turnId = row["turn_id"] ?? row["turnId"] ?? row["id"] ?? "";
        const propertyNameRaw = row["property_name"] ?? row["propertyName"] ?? row["property"] ?? "";
        const unitNumber = row["unit_id"] ?? row["unitId"] ?? row["unit"] ?? row["unit_number"] ?? "";
        const turnStatusRaw = row["turn_status"] ?? row["turnStatus"] ?? row["status"] ?? "active";
        const currentStageRaw = row["current_stage"] ?? row["currentStage"] ?? row["stage"] ?? "Trash Out";
        const completionPct = parseFloatField(row["completion_percentage"] ?? row["completion"] ?? row["pct"]);
        const rentReady = parseBoolField(row["rent_ready"] ?? row["rentReady"]);
        const inspectionPassed = parseBoolField(row["inspection_passed"] ?? row["inspectionPassed"] ?? row["inspection"]);
        const reworkRequired = parseBoolField(row["rework_required"] ?? row["reworkRequired"] ?? row["rework"]);
        const reworkCompleted = parseBoolField(row["rework_completed"] ?? row["reworkCompleted"]);
        const daysInStage = parseIntField(row["days_in_stage"] ?? row["daysInStage"] ?? row["days"]);
        const totalDaysOpen = parseIntField(row["total_days_open"] ?? row["totalDaysOpen"] ?? row["days_open"]);
        const isBlocked = parseBoolField(row["is_blocked"] ?? row["isBlocked"] ?? row["blocked"]);
        const blockedStage = row["blocked_stage"] ?? row["blockedStage"] ?? undefined;

        if (!propertyNameRaw) { skipped++; continue; }

        const turnStatus = normalizeTurnStatus(turnStatusRaw);
        const currentStage = normalizeStage(currentStageRaw);

        // Resolve property (fuzzy match or auto-create)
        const propertyId = await resolvePropertyForTurn(propertyNameRaw, propertyCache);

        // Resolve unit (auto-create if needed)
        const unitId = await resolveUnitForTurn(unitNumber, propertyId, unitCache);

        await db.insert(turnsTable).values({
          turnId: turnId || null,
          propertyId,
          propertyNameRaw: propertyNameRaw,
          unitId,
          unitNumber: unitNumber || null,
          turnStatus,
          currentStage,
          completionPercentage: completionPct,
          rentReady,
          inspectionPassed,
          reworkRequired,
          reworkCompleted,
          daysInStage,
          totalDaysOpen: totalDaysOpen || daysInStage,
          isBlocked,
          blockedStage: (blockedStage && blockedStage !== "") ? blockedStage : null,
          importBatchId: batchId,
          rawData: row,
        });

        imported++;
      } catch (rowErr: unknown) {
        const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
        errors.push(`Row ${imported + skipped + 1}: ${msg}`);
        skipped++;
      }
    }

    res.json({
      success: true,
      imported,
      skipped,
      batchId,
      errors: errors.slice(0, 10),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Import failed", detail: msg });
  }
});

// ─── GET /api/turns/stats ─────────────────────────────────────────────────────

router.get("/turns/stats", async (req, res) => {
  try {
    const { propertyId: propertyIdStr } = req.query as Record<string, string>;
    const propertyId = propertyIdStr ? parseInt(propertyIdStr, 10) : undefined;
    const stats = propertyId && !isNaN(propertyId)
      ? await getTurnStatsByProperty(propertyId)
      : await getTurnStats();
    res.json(stats);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to fetch turn stats", detail: msg });
  }
});

// ─── GET /api/turns/unit/:unitId ─────────────────────────────────────────────

router.get("/turns/unit/:unitId", async (req, res) => {
  try {
    const unitId = parseInt(req.params["unitId"] ?? "", 10);
    if (isNaN(unitId)) {
      res.status(400).json({ error: "Invalid unitId" });
      return;
    }

    const rawTurns = await db
      .select()
      .from(turnsTable)
      .where(eq(turnsTable.unitId, unitId))
      .limit(10);

    if (rawTurns.length === 0) {
      res.json({ hasData: false, turns: [], activeTurn: null });
      return;
    }

    const enriched = rawTurns.map(t => enrichTurn(t, t.propertyNameRaw ?? ""));
    const sortedByRecency = [...enriched].sort((a, b) => {
      if (!a.isCompleted && b.isCompleted) return -1;
      if (a.isCompleted && !b.isCompleted) return 1;
      return (b.daysInStage ?? 0) - (a.daysInStage ?? 0);
    });

    const activeTurn = sortedByRecency.find(t => !t.isCompleted) ?? sortedByRecency[0] ?? null;

    res.json({
      hasData: true,
      turns: sortedByRecency,
      activeTurn,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to fetch unit turns", detail: msg });
  }
});

// ─── GET /api/turns/matrix ────────────────────────────────────────────────────

router.get("/turns/matrix", async (req, res) => {
  try {
    const matrix = await buildTurnMatrix();
    // Don't return the full turns array in the matrix endpoint by default — too heavy
    const { turns: _turns, ...summary } = matrix;
    res.json(summary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to build turn matrix", detail: msg });
  }
});

// ─── GET /api/turns ───────────────────────────────────────────────────────────

router.get("/turns", async (req, res) => {
  try {
    const {
      status,
      isBlocked,
      propertyId,
      limit: limitStr,
    } = req.query as Record<string, string>;

    const limit = parseInt(limitStr ?? "200", 10);

    // Run matrix to get enriched turns
    const matrix = await buildTurnMatrix();
    let turns = matrix.turns;

    if (status) {
      turns = turns.filter(t => t.turnStatus === status);
    }
    if (isBlocked === "true") {
      turns = turns.filter(t => t.isBlockedCalc);
    }
    if (propertyId) {
      const pid = parseInt(propertyId, 10);
      turns = turns.filter(t => t.propertyId === pid);
    }

    res.json({
      turns: turns.slice(0, limit),
      total: turns.length,
      hasData: matrix.hasData,
      dataQuality: matrix.dataQuality,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to fetch turns", detail: msg });
  }
});

// ─── GET /api/turns/:id ───────────────────────────────────────────────────────

router.get("/turns/:id", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [turn] = await db
      .select()
      .from(turnsTable)
      .where(eq(turnsTable.id, id))
      .limit(1);

    if (!turn) { res.status(404).json({ error: "Turn not found" }); return; }
    res.json(turn);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to fetch turn", detail: msg });
  }
});

export default router;
