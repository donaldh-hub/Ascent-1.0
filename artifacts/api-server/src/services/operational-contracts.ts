/**
 * Ascent 1.12.7 — Operational Metric Contracts (Governance Enforcement Layer)
 *
 * Every operational metric in the system is described here as a strict
 * contract. The contracts are the public-facing authority for the truth
 * layer: they name the metric, declare its inputs and rules, point at the
 * one shared selector that produces it, and enumerate the allowed
 * consumers. Anything else is a governance violation.
 *
 * This file is intentionally declarative — the actual logic lives in
 * `operational-selectors.ts`. The contracts are what the audit endpoint
 * (/api/governance/audit) reads to validate Control Tower symmetry.
 *
 * RULES (system law):
 *   1. ALL operational metrics MUST originate from the shared selector
 *      registered in the contract's `selector` field.
 *   2. NO consumer may recompute a metric outside the selector layer.
 *   3. Reporting / analytics / alerts MUST aggregate selector outputs;
 *      they may NOT redefine thresholds or invent their own SQL.
 *   4. Detail-page filtered count, drill total, and Control Tower tile
 *      count for the same signal MUST always match (Symmetry contract).
 *   5. Confidence filter ("reportable") is on by default for every
 *      WO-domain metric. Bypass requires explicit confidence="all" and
 *      a labeled output (admin-only review queues).
 */

import {
  type ConfidenceMode,
  DEFAULT_CONFIDENCE_MODE,
  isWorkOrderSignal,
  isTurnSignal,
  isAssetSignal,
} from "./operational-selectors.js";

export type MetricDomain = "work_order" | "turn" | "asset";

export type AllowedConsumer =
  | "control_tower"
  | "priority_actions"
  | "drill_endpoint"
  | "list_endpoint"
  | "detail_page"
  | "reporting"
  | "alert_engine";

export interface MetricContract {
  /** Stable signal id used across the API + UI. */
  signal: string;
  /** Domain the metric operates on. */
  domain: MetricDomain;
  /** Human-readable metric name. */
  name: string;
  /** Source tables / columns this metric reads from. */
  inputs: readonly string[];
  /** Plain-language calculation rule (must mirror the selector). */
  rule: string;
  /** Output shape produced by the shared selector. */
  output: "count" | "count+rows" | "count+rows+cost";
  /**
   * Names of the shared selector(s) this contract is bound to. Anything
   * computing this metric must call one of these — no exceptions.
   */
  selectors: readonly string[];
  /** Surfaces allowed to read this metric. */
  allowedConsumers: readonly AllowedConsumer[];
  /** Default confidence mode; `null` for non-WO domains where N/A. */
  confidence: ConfidenceMode | null;
  /**
   * Whether this signal is part of the locked Control Tower symmetry
   * invariant (drill total = list endpoint length = tile count).
   */
  symmetryLocked: boolean;
}

// ─── Contract Registry ────────────────────────────────────────────────────────

export const METRIC_CONTRACTS: readonly MetricContract[] = [
  {
    signal: "sla_violations",
    domain: "work_order",
    name: "SLA Violations",
    inputs: ["work_orders.sla_status", "work_orders.available_for_property_rollup"],
    rule: "sla_status = 'missed' AND record is reportable",
    output: "count+rows",
    selectors: ["slaViolationsWhere", "isWoSlaViolation"],
    allowedConsumers: [
      "control_tower",
      "priority_actions",
      "drill_endpoint",
      "list_endpoint",
      "detail_page",
      "reporting",
      "alert_engine",
    ],
    confidence: DEFAULT_CONFIDENCE_MODE,
    symmetryLocked: true,
  },
  {
    signal: "aging_work_orders",
    domain: "work_order",
    name: "Aging Work Orders",
    inputs: [
      "work_orders.status",
      "work_orders.created_date",
      "work_orders.available_for_property_rollup",
    ],
    rule: "status = 'in_progress' AND created_date < now - 7d AND record is reportable",
    output: "count+rows",
    selectors: ["agingWorkOrdersWhere", "isWoAging"],
    allowedConsumers: [
      "control_tower",
      "priority_actions",
      "drill_endpoint",
      "list_endpoint",
      "detail_page",
      "reporting",
      "alert_engine",
    ],
    confidence: DEFAULT_CONFIDENCE_MODE,
    symmetryLocked: true,
  },
  {
    signal: "blocked_turns",
    domain: "turn",
    name: "Blocked Turns",
    inputs: ["turns.is_blocked", "turns.turn_status", "turns.days_in_stage"],
    rule:
      "turn_status != 'completed' AND (is_blocked = true OR days_in_stage > 7)",
    output: "count+rows",
    selectors: ["blockedTurnsWhere", "isTurnBlocked"],
    allowedConsumers: [
      "control_tower",
      "priority_actions",
      "drill_endpoint",
      "list_endpoint",
      "detail_page",
      "reporting",
    ],
    confidence: null,
    symmetryLocked: true,
  },
  {
    signal: "rework_loop",
    domain: "turn",
    name: "Rework Loop",
    inputs: ["turns.rework_required", "turns.turn_status"],
    rule: "rework_required = true OR turn_status = 'in_rework'",
    output: "count+rows",
    selectors: ["reworkTurnsWhere", "isTurnRework"],
    allowedConsumers: [
      "control_tower",
      "drill_endpoint",
      "list_endpoint",
      "detail_page",
      "reporting",
    ],
    confidence: null,
    symmetryLocked: false,
  },
  {
    signal: "not_rent_ready",
    domain: "turn",
    name: "Not Rent Ready",
    inputs: ["turns.rent_ready", "turns.turn_status"],
    rule: "rent_ready = false AND turn_status != 'completed'",
    output: "count+rows",
    selectors: ["notRentReadyWhere", "isTurnNotRentReady"],
    allowedConsumers: [
      "control_tower",
      "drill_endpoint",
      "list_endpoint",
      "detail_page",
      "reporting",
    ],
    confidence: null,
    symmetryLocked: false,
  },
  {
    signal: "expired_warranty",
    domain: "asset",
    name: "Expired Warranties",
    inputs: ["assets.warranty_expiration"],
    rule: "warranty_expiration IS NOT NULL AND warranty_expiration < today",
    output: "count+rows+cost",
    selectors: ["expiredWarrantyWhere", "isAssetWarrantyExpired"],
    allowedConsumers: [
      "control_tower",
      "drill_endpoint",
      "list_endpoint",
      "detail_page",
      "reporting",
    ],
    confidence: null,
    symmetryLocked: true,
  },
  {
    signal: "expiring_soon",
    domain: "asset",
    name: "Expiring Soon",
    inputs: ["assets.warranty_expiration"],
    rule:
      "warranty_expiration IS NOT NULL AND today <= warranty_expiration <= today+90d",
    output: "count+rows+cost",
    selectors: ["expiringSoonWhere", "isAssetWarrantyExpiringSoon"],
    allowedConsumers: [
      "control_tower",
      "drill_endpoint",
      "list_endpoint",
      "detail_page",
      "reporting",
    ],
    confidence: null,
    symmetryLocked: false,
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export function getContract(signal: string): MetricContract | null {
  return METRIC_CONTRACTS.find(c => c.signal === signal) ?? null;
}

export function lockedSignals(): readonly MetricContract[] {
  return METRIC_CONTRACTS.filter(c => c.symmetryLocked);
}

/**
 * validateSignal — confirms a signal exists in the contract registry AND is
 * served by the shared selector layer. Used by routes and the audit hook
 * before rendering or returning a signal-driven payload.
 */
export function validateSignal(signal: string): {
  valid: boolean;
  reason?: string;
  contract?: MetricContract;
} {
  const contract = getContract(signal);
  if (!contract) {
    return { valid: false, reason: `Signal "${signal}" is not registered in METRIC_CONTRACTS.` };
  }
  const knownToSelectorLayer =
    isWorkOrderSignal(signal) || isTurnSignal(signal) || isAssetSignal(signal);
  if (!knownToSelectorLayer) {
    return {
      valid: false,
      reason: `Signal "${signal}" is in the contract but no shared selector serves it.`,
      contract,
    };
  }
  return { valid: true, contract };
}
