/**
 * Ascent 1.12.6 — Client-side mirror of operational-selectors.ts
 *
 * The SERVER's operational-selectors.ts is the source of truth. This file
 * exists ONLY because the assets list page filters its already-fetched
 * dataset client-side. Predicates here MUST stay in lockstep with the
 * server-side `is*` predicates. If you change one, change both.
 */

export const WARRANTY_EXPIRING_DAYS = 90;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function expiringSoonStr(): string {
  return new Date(Date.now() + WARRANTY_EXPIRING_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
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

export type AssetSignal = "expired_warranty" | "expiring_soon";

export function applyAssetSignal<T extends { warrantyExpiration: string | null }>(
  rows: T[],
  signal: string | null,
): T[] {
  if (!signal) return rows;
  if (signal === "expired_warranty") return rows.filter(isAssetWarrantyExpired);
  if (signal === "expiring_soon") return rows.filter(isAssetWarrantyExpiringSoon);
  return rows;
}

export const ASSET_SIGNAL_LABELS: Record<AssetSignal, string> = {
  expired_warranty: "Expired Warranties",
  expiring_soon: "Warranties Expiring ≤ 90 days",
};

export const WORK_ORDER_SIGNAL_LABELS: Record<string, string> = {
  sla_violations: "SLA Violations (past 24h response window)",
  aging_work_orders: "Aging Work Orders (in progress 7+ days)",
  blocked_work_orders: "Blocked Work Orders",
  category_spike: "Top Work Order Category",
};

export const TURN_SIGNAL_LABELS: Record<string, string> = {
  blocked_turns: "Blocked Turns (≥ 7 days in stage)",
  rework_loop: "Turns in Rework Loop",
  not_rent_ready: "Turns Not Rent-Ready",
  stage_congestion: "Stage Congestion",
};
