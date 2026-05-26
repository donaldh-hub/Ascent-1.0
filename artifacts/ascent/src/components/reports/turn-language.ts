/**
 * Ascent 7.4 — Turn language helper
 *
 * One source of truth for the exact phrasing every turn-related visual on
 * /reports, /control-tower, and /turns must show, indexed by the active
 * reporting mode from Build 7.2.1. The addendum requires the literal
 * sentences below; do not rephrase them inside individual components.
 */

import type { ReportingModeValue } from "./use-reporting-mode";

export type TurnSignalSource = "turn_records" | "linked_work_orders" | "unknown";

export const TURN_MODE_PHRASING: Record<ReportingModeValue, string> = {
  separate_turns_and_work_orders:
    "Turn performance is based on dedicated turn/make-ready records.",
  work_orders_measure_turn_progress:
    "Turn performance is being measured through work orders linked to the turn process.",
  hybrid_or_unknown:
    "Turn reporting mode has not been confirmed yet. Confirm whether your organization tracks turns separately or uses work orders to measure turn progress.",
};

export const TURN_SIGNAL_SOURCE: Record<ReportingModeValue, TurnSignalSource> = {
  separate_turns_and_work_orders: "turn_records",
  work_orders_measure_turn_progress: "linked_work_orders",
  hybrid_or_unknown: "unknown",
};

export const TURN_PERFORMANCE_LABEL: Record<ReportingModeValue, string> = {
  separate_turns_and_work_orders: "Turn Performance",
  work_orders_measure_turn_progress: "Turn Performance (via linked work orders)",
  hybrid_or_unknown: "Turn Performance (mode not confirmed)",
};

/**
 * Build 7.4 gating rule: when reporting mode is unknown, confident turn
 * conclusions (score, KPI counts, drill signals) must be suppressed and
 * replaced with configuration guidance.
 */
export function gateTurnConfidentSignals(
  mode: ReportingModeValue | null | undefined,
): boolean {
  return !mode || mode === "hybrid_or_unknown";
}
