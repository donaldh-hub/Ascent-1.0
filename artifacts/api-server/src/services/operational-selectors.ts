/**
 * Ascent 1.12.6 — Operational Selectors (Single Source of Truth)
 *
 * One file, one definition per operational signal. Every consumer
 * (Control Tower tiles, Priority Actions, /api/drill, list endpoints,
 * detail-page filters) MUST go through here so the same row never
 * contributes a different count to two different surfaces.
 *
 * For each signal we expose:
 *   - <name>Where(propertyId?)  — Drizzle WHERE expression for SQL queries
 *   - is<Name>(row)             — JS predicate that mirrors the SQL exactly,
 *                                 used for in-memory filtering (turn matrix,
 *                                 work-order stats aggregation, asset list).
 *
 * If a predicate ever needs to change, change it ONCE here. Anything else
 * is a governance violation.
 */

import { sql, eq, and, or, ne, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { workOrdersTable, turnsTable, assetsTable } from "@workspace/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

export const AGING_DAYS = 7;
export const BLOCK_THRESHOLD_DAYS = 7;
export const WARRANTY_EXPIRING_DAYS = 90;

// ─── Confidence Filter (Ascent 1.12.7 — data-confidence governance) ──────────
//
// Operational metrics may only be driven by records the import governance
// layer marked as reportable. This single function is the gate; any consumer
// that wants to bypass it must do so explicitly with mode = "all" and is
// expected to label its output as such (e.g. admin-only review queues).
//
// Modes:
//   "reportable"     — excludes resolutionStatus = "unresolved"
//                      (default for every operational metric)
//   "fully_resolved" — excludes resolutionStatus != "fully_resolved"
//                      (strict mode: future builds with import data that
//                      reaches the fully_resolved tier)
//   "all"            — no confidence gate (admin-only, must be labeled)

export type ConfidenceMode = "reportable" | "fully_resolved" | "all";

export const DEFAULT_CONFIDENCE_MODE: ConfidenceMode = "reportable";

export function workOrderConfidenceWhere(mode: ConfidenceMode = DEFAULT_CONFIDENCE_MODE): SQL | undefined {
  if (mode === "all") return undefined;
  if (mode === "fully_resolved") return eq(workOrdersTable.availableForUnitRollup, true);
  return eq(workOrdersTable.availableForPropertyRollup, true);
}

export function isWorkOrderReportable(
  w: { availableForPropertyRollup: boolean | null; availableForUnitRollup: boolean | null },
  mode: ConfidenceMode = DEFAULT_CONFIDENCE_MODE,
): boolean {
  if (mode === "all") return true;
  if (mode === "fully_resolved") return w.availableForUnitRollup === true;
  return w.availableForPropertyRollup === true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agingThresholdDate(): Date {
  return new Date(Date.now() - AGING_DAYS * 86_400_000);
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]!;
}

function expiringSoonStr(): string {
  return new Date(Date.now() + WARRANTY_EXPIRING_DAYS * 86_400_000)
    .toISOString()
    .split("T")[0]!;
}

// ─── Work Order WHERE-builders ────────────────────────────────────────────────

// Ascent 1.12.7 — every WO WHERE-builder applies the confidence filter
// (DEFAULT_CONFIDENCE_MODE = "reportable") by default. Pass mode="all" to
// opt out for explicitly-labeled debug/admin views only.

export function slaViolationsWhere(
  propertyId?: number,
  mode: ConfidenceMode = DEFAULT_CONFIDENCE_MODE,
): SQL | undefined {
  const c: SQL[] = [eq(workOrdersTable.slaStatus, "missed")];
  if (propertyId) c.push(eq(workOrdersTable.propertyId, propertyId));
  const conf = workOrderConfidenceWhere(mode);
  if (conf) c.push(conf);
  return and(...c);
}

export function agingWorkOrdersWhere(
  propertyId?: number,
  mode: ConfidenceMode = DEFAULT_CONFIDENCE_MODE,
): SQL | undefined {
  const c: SQL[] = [
    eq(workOrdersTable.status, "in_progress"),
    lt(workOrdersTable.createdDate, agingThresholdDate()),
  ];
  if (propertyId) c.push(eq(workOrdersTable.propertyId, propertyId));
  const conf = workOrderConfidenceWhere(mode);
  if (conf) c.push(conf);
  return and(...c);
}

export function blockedWorkOrdersWhere(
  propertyId?: number,
  mode: ConfidenceMode = DEFAULT_CONFIDENCE_MODE,
): SQL | undefined {
  const c: SQL[] = [
    eq(workOrdersTable.isBlocked, true),
    ne(workOrdersTable.status, "completed"),
  ];
  if (propertyId) c.push(eq(workOrdersTable.propertyId, propertyId));
  const conf = workOrderConfidenceWhere(mode);
  if (conf) c.push(conf);
  return and(...c);
}

// ─── Turn WHERE-builders ──────────────────────────────────────────────────────

export function blockedTurnsWhere(propertyId?: number): SQL | undefined {
  // Symmetry with turn-matrix-service.computeIsBlocked: completed turns are
  // never considered blocked, even if the isBlocked flag is true.
  const c: SQL[] = [
    ne(turnsTable.turnStatus, "completed"),
    or(
      eq(turnsTable.isBlocked, true),
      sql`${turnsTable.daysInStage} > ${BLOCK_THRESHOLD_DAYS}`,
    )!,
  ];
  if (propertyId) c.push(eq(turnsTable.propertyId, propertyId));
  return and(...c);
}

export function reworkTurnsWhere(propertyId?: number): SQL | undefined {
  const c: SQL[] = [
    or(eq(turnsTable.reworkRequired, true), eq(turnsTable.turnStatus, "in_rework"))!,
  ];
  if (propertyId) c.push(eq(turnsTable.propertyId, propertyId));
  return and(...c);
}

export function notRentReadyWhere(propertyId?: number): SQL | undefined {
  const c: SQL[] = [
    eq(turnsTable.rentReady, false),
    ne(turnsTable.turnStatus, "completed"),
  ];
  if (propertyId) c.push(eq(turnsTable.propertyId, propertyId));
  return and(...c);
}

// ─── Asset WHERE-builders (warrantyExpiration is text YYYY-MM-DD, lex-comparable) ─

export function expiredWarrantyWhere(propertyId?: number): SQL | undefined {
  const today = todayStr();
  const c: SQL[] = [
    sql`${assetsTable.warrantyExpiration} IS NOT NULL AND ${assetsTable.warrantyExpiration} < ${today}`,
  ];
  if (propertyId) c.push(eq(assetsTable.propertyId, propertyId));
  return and(...c);
}

export function expiringSoonWhere(propertyId?: number): SQL | undefined {
  const today = todayStr();
  const ninety = expiringSoonStr();
  const c: SQL[] = [
    sql`${assetsTable.warrantyExpiration} IS NOT NULL AND ${assetsTable.warrantyExpiration} >= ${today} AND ${assetsTable.warrantyExpiration} <= ${ninety}`,
  ];
  if (propertyId) c.push(eq(assetsTable.propertyId, propertyId));
  return and(...c);
}

// ─── JS predicates (mirror the SQL exactly) ──────────────────────────────────
// These are the source of truth when you already have a row in memory and
// can't go back to SQL (turn matrix, work-order stats aggregation, etc.).

export function isWoSlaViolation(w: { slaStatus: string }): boolean {
  return w.slaStatus === "missed";
}

export function isWoAging(w: { status: string; createdDate: Date | null }): boolean {
  if (w.status !== "in_progress" || !w.createdDate) return false;
  return w.createdDate < agingThresholdDate();
}

export function isWoBlocked(w: { isBlocked: boolean; status: string }): boolean {
  return w.isBlocked && w.status !== "completed";
}

/**
 * Mirror of computeIsBlocked() in turn-matrix-service.ts. Use the calc field
 * if available (already enriched), otherwise compute.
 */
export function isTurnBlocked(t: {
  isBlocked: boolean;
  turnStatus: string;
  daysInStage: number;
  isBlockedCalc?: boolean;
}): boolean {
  // Ascent 1.12.7 — match blockedTurnsWhere() exactly: a completed turn is
  // NEVER blocked, even if isBlocked=true or isBlockedCalc=true. This closes
  // the latent SQL/JS divergence flagged by the symmetry audit.
  if (t.turnStatus === "completed") return false;
  if (typeof t.isBlockedCalc === "boolean") return t.isBlockedCalc;
  return t.isBlocked || t.daysInStage > BLOCK_THRESHOLD_DAYS;
}

export function isTurnRework(t: {
  reworkRequired: boolean;
  turnStatus: string;
}): boolean {
  return t.reworkRequired || t.turnStatus === "in_rework";
}

export function isTurnNotRentReady(t: {
  rentReady: boolean;
  turnStatus: string;
}): boolean {
  return !t.rentReady && t.turnStatus !== "completed";
}

export function isAssetWarrantyExpired(a: {
  warrantyExpiration: string | null;
}): boolean {
  if (!a.warrantyExpiration) return false;
  return a.warrantyExpiration < todayStr();
}

export function isAssetWarrantyExpiringSoon(a: {
  warrantyExpiration: string | null;
}): boolean {
  if (!a.warrantyExpiration) return false;
  const today = todayStr();
  const ninety = expiringSoonStr();
  return a.warrantyExpiration >= today && a.warrantyExpiration <= ninety;
}

// ─── Signal registries ───────────────────────────────────────────────────────

export type WorkOrderSignal = "sla_violations" | "aging_work_orders" | "blocked_work_orders";
export type TurnSignal = "blocked_turns" | "rework_loop" | "not_rent_ready";
export type AssetSignal = "expired_warranty" | "expiring_soon";

export const WORK_ORDER_SIGNAL_WHERE: Record<WorkOrderSignal, (p?: number) => SQL | undefined> = {
  sla_violations: slaViolationsWhere,
  aging_work_orders: agingWorkOrdersWhere,
  blocked_work_orders: blockedWorkOrdersWhere,
};

export const TURN_SIGNAL_WHERE: Record<TurnSignal, (p?: number) => SQL | undefined> = {
  blocked_turns: blockedTurnsWhere,
  rework_loop: reworkTurnsWhere,
  not_rent_ready: notRentReadyWhere,
};

export const TURN_SIGNAL_PREDICATE: Record<
  TurnSignal,
  (t: {
    isBlocked: boolean;
    turnStatus: string;
    daysInStage: number;
    isBlockedCalc?: boolean;
    reworkRequired: boolean;
    rentReady: boolean;
  }) => boolean
> = {
  blocked_turns: isTurnBlocked,
  rework_loop: isTurnRework,
  not_rent_ready: isTurnNotRentReady,
};

export const ASSET_SIGNAL_WHERE: Record<AssetSignal, (p?: number) => SQL | undefined> = {
  expired_warranty: expiredWarrantyWhere,
  expiring_soon: expiringSoonWhere,
};

export function isWorkOrderSignal(s: string): s is WorkOrderSignal {
  return s in WORK_ORDER_SIGNAL_WHERE;
}

export function isTurnSignal(s: string): s is TurnSignal {
  return s in TURN_SIGNAL_WHERE;
}

export function isAssetSignal(s: string): s is AssetSignal {
  return s in ASSET_SIGNAL_WHERE;
}
