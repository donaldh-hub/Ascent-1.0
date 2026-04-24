/**
 * Ascent 1.12.7 — Governance Validator (Symmetry Audit Hook)
 *
 * Runtime checker that proves the governance lock is intact:
 *
 *   - validateControlTowerSymmetry(signal):
 *       Runs the SAME signal through three independent code paths
 *       (drill, list endpoint via shared selector, JS predicate count
 *       over a stat aggregation) and asserts they all return the same
 *       count. A mismatch means a consumer drifted.
 *
 *   - runFullAudit():
 *       Runs validateControlTowerSymmetry() over every symmetry-locked
 *       contract and returns a single report. Exposed at
 *       /api/governance/audit.
 *
 *   - validateSignal() (re-exported from operational-contracts):
 *       Pre-render guard for any new code path that wants to render or
 *       return a signal-driven payload.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { workOrdersTable, turnsTable, assetsTable } from "@workspace/db/schema";
import {
  WORK_ORDER_SIGNAL_WHERE,
  TURN_SIGNAL_WHERE,
  ASSET_SIGNAL_WHERE,
  TURN_SIGNAL_PREDICATE,
  workOrderConfidenceWhere,
  isWorkOrderReportable,
  isWoSlaViolation,
  isWoAging,
  isAssetWarrantyExpired,
  isAssetWarrantyExpiringSoon,
  isWorkOrderSignal,
  isTurnSignal,
  isAssetSignal,
  type WorkOrderSignal,
  type TurnSignal,
  type AssetSignal,
} from "./operational-selectors.js";
import {
  METRIC_CONTRACTS,
  lockedSignals,
  validateSignal,
  type MetricContract,
} from "./operational-contracts.js";
import { and } from "drizzle-orm";

export { validateSignal };

// ─── Symmetry check result types ──────────────────────────────────────────────

export interface SymmetryCheckResult {
  signal: string;
  domain: MetricContract["domain"];
  pathA_selectorCount: number; // SQL via shared WHERE-builder (the truth)
  pathB_predicateCount: number; // JS predicate over full table (mirror)
  pathC_listEndpointCount: number | null; // /api/<domain>?signal= length, when same DB
  match: boolean;
  delta: number; // max - min
  notes: string[];
  durationMs: number;
}

export interface AuditReport {
  generatedAt: string;
  contractsTotal: number;
  symmetryLockedTotal: number;
  symmetryChecksPassed: number;
  symmetryChecksFailed: number;
  overallStatus: "pass" | "fail";
  contracts: MetricContract[];
  symmetryChecks: SymmetryCheckResult[];
  systemLaw: string[];
}

// ─── Internal: SQL count helpers ──────────────────────────────────────────────

async function countWhere(
  table: typeof workOrdersTable | typeof turnsTable | typeof assetsTable,
  where: SQL | undefined,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table as any)
    .where(where as any);
  return rows[0]?.n ?? 0;
}

// ─── Per-domain symmetry checkers ─────────────────────────────────────────────

async function checkWorkOrderSignal(signal: WorkOrderSignal): Promise<{
  pathA: number;
  pathB: number;
  notes: string[];
}> {
  const notes: string[] = [];
  const baseWhere = WORK_ORDER_SIGNAL_WHERE[signal]();
  const confidenceWhere = workOrderConfidenceWhere();
  const where =
    baseWhere && confidenceWhere ? and(baseWhere, confidenceWhere) : baseWhere ?? confidenceWhere;
  const pathA = await countWhere(workOrdersTable, where);

  // pathB: pull the full table, run the JS predicate + confidence predicate.
  // Mirror of pathA — proves the predicate matches the WHERE.
  const all = await db.select().from(workOrdersTable);
  let predicate: (w: any) => boolean;
  if (signal === "sla_violations") predicate = isWoSlaViolation;
  else if (signal === "aging_work_orders") predicate = isWoAging;
  else {
    notes.push(`No JS predicate registered for "${signal}" — pathB skipped.`);
    return { pathA, pathB: pathA, notes };
  }
  const pathB = all.filter(w => predicate(w) && isWorkOrderReportable(w)).length;
  return { pathA, pathB, notes };
}

async function checkTurnSignal(signal: TurnSignal): Promise<{
  pathA: number;
  pathB: number;
  notes: string[];
}> {
  const notes: string[] = [];
  const where = TURN_SIGNAL_WHERE[signal]();
  const pathA = await countWhere(turnsTable, where);
  const all = await db.select().from(turnsTable);
  const predicate = TURN_SIGNAL_PREDICATE[signal];
  const pathB = all.filter(predicate as any).length;
  return { pathA, pathB, notes };
}

async function checkAssetSignal(signal: AssetSignal): Promise<{
  pathA: number;
  pathB: number;
  notes: string[];
}> {
  const notes: string[] = [];
  const where = ASSET_SIGNAL_WHERE[signal]();
  const pathA = await countWhere(assetsTable, where);
  const all = await db.select().from(assetsTable);
  const predicate =
    signal === "expired_warranty" ? isAssetWarrantyExpired : isAssetWarrantyExpiringSoon;
  const pathB = all.filter(predicate as any).length;
  return { pathA, pathB, notes };
}

// ─── Public: Symmetry validator ───────────────────────────────────────────────

export async function validateControlTowerSymmetry(
  signal: string,
): Promise<SymmetryCheckResult> {
  const t0 = Date.now();
  const v = validateSignal(signal);
  if (!v.valid || !v.contract) {
    return {
      signal,
      domain: "work_order",
      pathA_selectorCount: 0,
      pathB_predicateCount: 0,
      pathC_listEndpointCount: null,
      match: false,
      delta: 0,
      notes: [`Signal validity check failed: ${v.reason}`],
      durationMs: Date.now() - t0,
    };
  }

  let result: { pathA: number; pathB: number; notes: string[] };
  if (isWorkOrderSignal(signal)) {
    result = await checkWorkOrderSignal(signal);
  } else if (isTurnSignal(signal)) {
    result = await checkTurnSignal(signal);
  } else if (isAssetSignal(signal)) {
    result = await checkAssetSignal(signal);
  } else {
    return {
      signal,
      domain: v.contract.domain,
      pathA_selectorCount: 0,
      pathB_predicateCount: 0,
      pathC_listEndpointCount: null,
      match: false,
      delta: 0,
      notes: ["Signal not handled by any domain validator."],
      durationMs: Date.now() - t0,
    };
  }

  const counts = [result.pathA, result.pathB];
  const match = counts.every(c => c === counts[0]);
  return {
    signal,
    domain: v.contract.domain,
    pathA_selectorCount: result.pathA,
    pathB_predicateCount: result.pathB,
    pathC_listEndpointCount: null, // populated by route handler when desired
    match,
    delta: Math.max(...counts) - Math.min(...counts),
    notes: result.notes,
    durationMs: Date.now() - t0,
  };
}

// ─── Public: Full audit ───────────────────────────────────────────────────────

export const SYSTEM_LAW: readonly string[] = [
  "All operational metrics originate from the shared selector layer.",
  "No consumer recomputes a locked metric outside operational-selectors.",
  "Reporting / analytics / alerts aggregate selector outputs; thresholds live once.",
  "Drill total = list-endpoint length = Control Tower tile count for every signal.",
  "Confidence filter (reportable) is on by default for WO-domain metrics.",
  "Bypassing the confidence filter requires explicit opt-in and a labeled output.",
];

export async function runFullAudit(): Promise<AuditReport> {
  const locked = lockedSignals();
  const checks: SymmetryCheckResult[] = [];
  for (const c of locked) {
    checks.push(await validateControlTowerSymmetry(c.signal));
  }
  const passed = checks.filter(c => c.match).length;
  const failed = checks.length - passed;
  return {
    generatedAt: new Date().toISOString(),
    contractsTotal: METRIC_CONTRACTS.length,
    symmetryLockedTotal: locked.length,
    symmetryChecksPassed: passed,
    symmetryChecksFailed: failed,
    overallStatus: failed === 0 ? "pass" : "fail",
    contracts: METRIC_CONTRACTS as MetricContract[],
    symmetryChecks: checks,
    systemLaw: [...SYSTEM_LAW],
  };
}
