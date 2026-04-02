/**
 * Phase 1 – Build 6.6: Signal Strength + Language Layer
 *
 * Centralized evidence language system.
 * All evidence-related copy MUST come from here — never hardcode text in components.
 */

// ─── Label constants ──────────────────────────────────────────────────────────

export const EVIDENCE = {
  MISSING_CRITICAL: "⚠ Missing documentation",
  MISSING: "No documents",
  DOCS: (count: number) => `📎 ${count}`,
  DOCS_VERBOSE: (count: number) =>
    `📎 ${count} doc${count !== 1 ? "s" : ""}`,
  DOCS_ATTACHED: (count: number) =>
    `📎 ${count} document${count !== 1 ? "s" : ""} attached`,
  DOCS_SUPPORTED: (count: number) =>
    `Supported by ${count} document${count !== 1 ? "s" : ""}`,
  NO_DOCS_RISK: "No documentation linked — verification risk",
  MISSING_ITEMS: (n: number) =>
    `⚠ Missing documentation (${n} item${n !== 1 ? "s" : ""})`,
  MISSING_ITEMS_COUNT: (n: number) =>
    `${n} critical item${n !== 1 ? "s" : ""} missing documentation`,
} as const;

// ─── Evidence state type + helper ────────────────────────────────────────────

export type EvidenceState = "missing_critical" | "missing" | "has_docs";

export function getEvidenceState(
  count: number,
  isCritical: boolean
): EvidenceState {
  if (count > 0) return "has_docs";
  if (isCritical) return "missing_critical";
  return "missing";
}

// ─── Rule-key helpers ─────────────────────────────────────────────────────────

/** Returns true for alerts produced by Rule 7 (missing docs on critical items). */
export function isDocMissingAlert(alert: { ruleKey?: string | null }): boolean {
  return !!alert.ruleKey?.startsWith("missing_docs_critical");
}
