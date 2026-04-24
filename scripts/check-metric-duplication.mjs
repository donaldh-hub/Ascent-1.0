#!/usr/bin/env node
/**
 * Ascent 1.12.7 — Metric Duplication Lint
 *
 * Static guard against re-implementing locked operational predicates outside
 * the shared selector layer. Walks the codebase and flags any file (other
 * than the allowlist) that contains the canonical thresholds or predicates.
 *
 * Run:   node scripts/check-metric-duplication.mjs
 * CI:    exits non-zero on violations.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

// Files that LEGITIMATELY define / consume the locked predicates inline.
// Everything else must call the shared selector.
const ALLOWLIST = new Set([
  "artifacts/api-server/src/services/operational-selectors.ts",
  "artifacts/api-server/src/services/operational-contracts.ts",
  "artifacts/api-server/src/services/governance-validator.ts",
  "artifacts/ascent/src/lib/operational-predicates.ts",
  // Lint script itself
  "scripts/check-metric-duplication.mjs",
]);

// Patterns that signal a metric is being recomputed inline.
// Each rule: { pattern: RegExp, why: string }
const RULES = [
  {
    pattern: /slaStatus\s*===\s*['"]missed['"]/,
    why: "SLA-violation predicate must come from isWoSlaViolation / slaViolationsWhere.",
  },
  {
    pattern: /AGING_DAYS\s*\*\s*86_?400_?000/,
    why: "Aging threshold math must come from operational-selectors (AGING_DAYS).",
  },
  {
    // Flag a fresh literal definition, not consumption of the shared constant.
    pattern: /BLOCK_THRESHOLD_DAYS\s*=\s*\d+/,
    why: "Block threshold must NOT be redefined inline; import BLOCK_THRESHOLD_DAYS from operational-selectors.",
  },
  {
    pattern: /WARRANTY_EXPIRING_DAYS\s*=\s*\d+/,
    why: "Warranty-expiring window must NOT be redefined inline; import WARRANTY_EXPIRING_DAYS from operational-selectors.",
  },
  {
    pattern: /warrantyExpiration\s*<\s*today/,
    why: "Expired-warranty predicate must come from isAssetWarrantyExpired.",
  },
];

const SCAN_ROOTS = [
  "artifacts/api-server/src",
  "artifacts/ascent/src",
];

const EXTS = new Set([".ts", ".tsx", ".mjs", ".js", ".jsx"]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (EXTS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

const violations = [];

for (const root of SCAN_ROOTS) {
  const abs = path.join(ROOT, root);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = path.relative(ROOT, file);
    if (ALLOWLIST.has(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const rule of RULES) {
      const lines = text.split("\n");
      lines.forEach((ln, i) => {
        if (rule.pattern.test(ln)) {
          violations.push({ file: rel, line: i + 1, snippet: ln.trim(), why: rule.why });
        }
      });
    }
  }
}

if (violations.length === 0) {
  console.log("✓ Metric duplication lint passed — every locked predicate is sourced from the shared selector layer.");
  process.exit(0);
}

console.error(`✗ Metric duplication lint FAILED — ${violations.length} violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    > ${v.snippet}`);
  console.error(`    ! ${v.why}\n`);
}
console.error("Fix: replace inline logic with a call to the shared selector in artifacts/api-server/src/services/operational-selectors.ts.");
process.exit(1);
