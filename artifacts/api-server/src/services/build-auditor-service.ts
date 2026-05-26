/**
 * Ascent Build Auditor — internal-only diagnostic service.
 *
 * Runs live checks against this running instance and produces the 10-section
 * markdown report defined by the auditor spec. No AI involved in this
 * lightweight pass; every claim comes from real probes against the API,
 * the database, and a hand-maintained Build Checklist.
 */

import { db } from "@workspace/db";
import {
  buildAuditsTable,
  type BuildAudit,
  type BuildAuditStatus,
} from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "partial" | "fail" | "manual";
export type CheckSeverity = "low" | "medium" | "high" | "critical";

export interface CheckResult {
  id: string;
  category:
    | "route_integrity"
    | "data_flow"
    | "build_checklist"
    | "wiring"
    | "product_promise";
  title: string;
  status: CheckStatus;
  severity: CheckSeverity;
  expected: string;
  observed: string;
  notes?: string;
}

export interface ManualTest {
  id: string;
  name: string;
  clickPath: string;
  expected: string;
  evidence: string;
  passCriteria: string;
  failCriteria: string;
}

export interface AuditBundle {
  buildLabel: string;
  generatedAt: string;
  status: BuildAuditStatus;
  summary: string;
  counts: { pass: number; partial: number; fail: number; manual: number };
  checks: CheckResult[];
  manualTests: ManualTest[];
  reportMarkdown: string;
  nextPromptMarkdown: string;
}

// ─── Live probes ──────────────────────────────────────────────────────────────

const API_BASE =
  process.env.AUDITOR_INTERNAL_API_BASE ?? `http://localhost:${process.env.PORT ?? 8080}`;

interface ProbeResult {
  ok: boolean;
  status: number;
  bodyShape: string;
  errorMessage?: string;
  rawJson?: unknown;
}

async function probe(path: string): Promise<ProbeResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: "GET" });
    const text = await res.text();
    let bodyShape = "non-json";
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(text);
      bodyShape = describeShape(parsed);
    } catch {
      bodyShape = `non-json (${text.length} chars)`;
    }
    return { ok: res.ok, status: res.status, bodyShape, rawJson: parsed };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      bodyShape: "n/a",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function describeShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).slice(0, 6);
    return `object{${keys.join(",")}${Object.keys(value as object).length > 6 ? ",…" : ""}}`;
  }
  return typeof value;
}

// ─── Critical API surface (probed on every audit) ─────────────────────────────

const CRITICAL_ROUTES: Array<{
  id: string;
  path: string;
  title: string;
  expectedShape: (json: unknown) => string | null; // null = ok, else reason
  severity: CheckSeverity;
}> = [
  {
    id: "route.healthz",
    path: "/api/healthz",
    title: "GET /api/healthz",
    severity: "critical",
    expectedShape: (j) =>
      isObject(j) && j.status === "ok" ? null : `expected {status:"ok"}, got ${describeShape(j)}`,
  },
  {
    id: "route.reporting_config",
    path: "/api/reporting-config",
    title: "GET /api/reporting-config",
    severity: "high",
    expectedShape: (j) =>
      isObject(j) && typeof j.mode === "string"
        ? null
        : `missing 'mode' string, got ${describeShape(j)}`,
  },
  {
    id: "route.reporting_analysis",
    path: "/api/reporting-analysis/all",
    title: "GET /api/reporting-analysis/all",
    severity: "high",
    expectedShape: (j) =>
      isObject(j) && Array.isArray(j.workOrders) && Array.isArray(j.turns)
        ? null
        : `expected {workOrders[],turns[]}, got ${describeShape(j)}`,
  },
  {
    id: "route.narrative_insights",
    path: "/api/narrative-insights",
    title: "GET /api/narrative-insights",
    severity: "high",
    expectedShape: (j) =>
      isObject(j) && Array.isArray(j.insights)
        ? null
        : `expected {insights[]}, got ${describeShape(j)}`,
  },
  {
    id: "route.dashboard_summary",
    path: "/api/dashboard/summary",
    title: "GET /api/dashboard/summary",
    severity: "high",
    expectedShape: (j) => (isObject(j) ? null : `expected object, got ${describeShape(j)}`),
  },
  {
    id: "route.work_orders",
    path: "/api/work-orders",
    title: "GET /api/work-orders",
    severity: "medium",
    expectedShape: (j) => (Array.isArray(j) || isObject(j) ? null : "expected array or object"),
  },
  {
    id: "route.turns",
    path: "/api/turns",
    title: "GET /api/turns",
    severity: "medium",
    expectedShape: (j) => (Array.isArray(j) || isObject(j) ? null : "expected array or object"),
  },
  {
    id: "route.assets",
    path: "/api/assets",
    title: "GET /api/assets",
    severity: "medium",
    expectedShape: (j) => (Array.isArray(j) || isObject(j) ? null : "expected array or object"),
  },
  {
    id: "route.alerts",
    path: "/api/alerts",
    title: "GET /api/alerts",
    severity: "medium",
    expectedShape: (j) => (Array.isArray(j) || isObject(j) ? null : "expected array or object"),
  },
  {
    id: "route.governance_contracts",
    path: "/api/governance/contracts",
    title: "GET /api/governance/contracts",
    severity: "medium",
    expectedShape: () => null,
  },
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─── Build checklist (Ascent 7.x deliverables) ───────────────────────────────

interface ChecklistEntry {
  id: string;
  title: string;
  build: string;
  severity: CheckSeverity;
  evaluate: (ctx: AuditContext) => Promise<{ status: CheckStatus; observed: string; notes?: string }>;
  expected: string;
}

interface AuditContext {
  probes: Map<string, ProbeResult>;
}

const BUILD_CHECKLIST: ChecklistEntry[] = [
  {
    id: "build.7_1.reporting_ingestion",
    title: "Build 7.1 — Reporting ingestion classifies records",
    build: "7.1",
    severity: "high",
    expected:
      "GET /api/reporting-analysis/all returns reportingMode and at least one fully or partially reportable category.",
    evaluate: async (ctx) => {
      const p = ctx.probes.get("/api/reporting-analysis/all");
      if (!p?.ok || !isObject(p.rawJson)) {
        return { status: "fail", observed: "reporting-analysis/all not reachable or non-object" };
      }
      const j = p.rawJson;
      if (typeof j.reportingMode !== "string") {
        return { status: "partial", observed: "response missing reportingMode" };
      }
      return { status: "pass", observed: `reportingMode=${String(j.reportingMode)}` };
    },
  },
  {
    id: "build.7_2.analysis_cards",
    title: "Build 7.2 — Analysis cards emit confidenceState",
    build: "7.2",
    severity: "high",
    expected:
      "Work-order analyses include confidenceState ∈ {confirmed_analysis, qualified_analysis, insufficient_data}.",
    evaluate: async (ctx) => {
      const p = ctx.probes.get("/api/reporting-analysis/all");
      if (!p?.ok || !isObject(p.rawJson)) return { status: "fail", observed: "no analysis payload" };
      const wos = (p.rawJson.workOrders as unknown[]) ?? [];
      if (wos.length === 0) return { status: "partial", observed: "no work-order analyses returned" };
      const valid = ["confirmed_analysis", "qualified_analysis", "insufficient_data"];
      const bad = wos.filter(
        (a) => !isObject(a) || !valid.includes(String(a.confidenceState)),
      );
      if (bad.length > 0)
        return { status: "fail", observed: `${bad.length}/${wos.length} analyses have invalid confidenceState` };
      return { status: "pass", observed: `${wos.length} WO analyses; all carry confidenceState` };
    },
  },
  {
    id: "build.7_2_1.reporting_mode",
    title: "Build 7.2.1 — Active reporting mode is set",
    build: "7.2.1",
    severity: "medium",
    expected: "GET /api/reporting-config returns one of the three known modes.",
    evaluate: async (ctx) => {
      const p = ctx.probes.get("/api/reporting-config");
      if (!p?.ok || !isObject(p.rawJson)) return { status: "fail", observed: "reporting-config not reachable" };
      const allowed = [
        "separate_turns_and_work_orders",
        "work_orders_measure_turn_progress",
        "hybrid_or_unknown",
      ];
      const m = String(p.rawJson.mode);
      if (!allowed.includes(m)) return { status: "fail", observed: `unknown mode '${m}'` };
      return {
        status: "pass",
        observed: `mode=${m}, source=${String(p.rawJson.source ?? "n/a")}`,
      };
    },
  },
  {
    id: "build.7_3.narrative_insights",
    title: "Build 7.3 — Narrative Insights engine produces output",
    build: "7.3",
    severity: "high",
    expected:
      "GET /api/narrative-insights returns insights[] where each carries dataSupportLevel + supportingRecordIds.",
    evaluate: async (ctx) => {
      const p = ctx.probes.get("/api/narrative-insights");
      if (!p?.ok || !isObject(p.rawJson)) return { status: "fail", observed: "narrative-insights not reachable" };
      const insights = (p.rawJson.insights as unknown[]) ?? [];
      if (insights.length === 0)
        return {
          status: "partial",
          observed: "endpoint reachable but no insights returned (may be valid empty-state)",
        };
      const allowed = ["fully_supported", "partially_supported", "directional_only", "not_enough_data"];
      const bad = insights.filter((i) => !isObject(i) || !allowed.includes(String(i.dataSupportLevel)));
      if (bad.length > 0)
        return { status: "fail", observed: `${bad.length}/${insights.length} missing/invalid dataSupportLevel` };
      const withRecords = insights.filter(
        (i) => isObject(i) && Array.isArray(i.supportingRecordIds),
      ).length;
      const notes = withRecords < insights.length
        ? `${insights.length - withRecords} insight(s) lack supportingRecordIds`
        : undefined;
      return {
        status: "pass",
        observed: `${insights.length} insights, all carry dataSupportLevel`,
        notes,
      };
    },
  },
  {
    id: "build.7_3_1.confidence_relabel",
    title: "Build 7.3.1 — Turn category clarified by mode",
    build: "7.3.1",
    severity: "medium",
    expected:
      "Top WO categories analysis labels Turn with a mode-aware suffix (e.g. 'Turn (turn-progress work orders)').",
    evaluate: async (ctx) => {
      const p = ctx.probes.get("/api/reporting-analysis/all");
      if (!p?.ok || !isObject(p.rawJson)) return { status: "fail", observed: "no analysis payload" };
      const wos = (p.rawJson.workOrders as unknown[]) ?? [];
      const top = wos.find(
        (a) => isObject(a) && String(a.analysisId ?? "").includes("top-categories"),
      ) as Record<string, unknown> | undefined;
      if (!top) return { status: "partial", observed: "no top-categories analysis found" };
      const factors = (top.contributingFactors as unknown[]) ?? [];
      const turnFactor = factors.find(
        (f) => isObject(f) && /^turn\b/i.test(String(f.label)),
      ) as Record<string, unknown> | undefined;
      if (!turnFactor) {
        return {
          status: "manual",
          observed: "no Turn-labelled factor present in current data — cannot verify suffix automatically",
        };
      }
      const label = String(turnFactor.label);
      const hasSuffix = /\(.+\)/.test(label);
      return hasSuffix
        ? { status: "pass", observed: `factor label = '${label}'` }
        : { status: "fail", observed: `Turn factor label '${label}' missing mode-aware suffix` };
    },
  },
];

// ─── Data flow checks (DB-side) ───────────────────────────────────────────────

async function runDataFlowChecks(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const tablesToProbe: Array<{ id: string; sql: string; title: string; minExpected: number; severity: CheckSeverity }> = [
    { id: "data.work_orders", sql: "SELECT COUNT(*)::int AS c FROM work_orders", title: "work_orders row count", minExpected: 1, severity: "high" },
    { id: "data.turns", sql: "SELECT COUNT(*)::int AS c FROM turns", title: "turns row count", minExpected: 1, severity: "high" },
    { id: "data.assets", sql: "SELECT COUNT(*)::int AS c FROM assets", title: "assets row count", minExpected: 1, severity: "medium" },
    { id: "data.properties", sql: "SELECT COUNT(*)::int AS c FROM properties", title: "properties row count", minExpected: 1, severity: "medium" },
    { id: "data.alerts", sql: "SELECT COUNT(*)::int AS c FROM alerts", title: "alerts row count", minExpected: 0, severity: "low" },
    { id: "data.reporting_config", sql: "SELECT COUNT(*)::int AS c FROM reporting_config", title: "reporting_config singleton present", minExpected: 1, severity: "high" },
  ];

  for (const t of tablesToProbe) {
    try {
      const rows = (await db.execute(t.sql as never)) as unknown as { rows: Array<{ c: number }> };
      const count = Array.isArray(rows.rows) && rows.rows[0] ? Number(rows.rows[0].c ?? 0) : 0;
      let status: CheckStatus = "pass";
      if (t.minExpected > 0 && count < t.minExpected) status = count === 0 ? "fail" : "partial";
      out.push({
        id: t.id,
        category: "data_flow",
        title: t.title,
        status,
        severity: t.severity,
        expected: t.minExpected > 0 ? `≥ ${t.minExpected} rows` : "queryable",
        observed: `${count} row(s)`,
      });
    } catch (err) {
      out.push({
        id: t.id,
        category: "data_flow",
        title: t.title,
        status: "fail",
        severity: t.severity,
        expected: `${t.minExpected} rows`,
        observed: `query error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return out;
}

// ─── Manual evidence checklist (always emitted) ───────────────────────────────

const MANUAL_TESTS: ManualTest[] = [
  {
    id: "manual.control_tower_loads",
    name: "Control Tower loads and renders priority actions",
    clickPath: "Navigate to /control-tower",
    expected: "Priority Actions, Operational Focus, and stoplight scores all render.",
    evidence: "Screenshot of /control-tower full page",
    passCriteria: "All sections render without console errors",
    failCriteria: "Any section blank, errors in console, or missing data",
  },
  {
    id: "manual.reports_drillthrough",
    name: "Reports — drill-through opens supporting records",
    clickPath: "/reports → click 'View N supporting records' on any analysis card",
    expected: "Side sheet opens with the listed records",
    evidence: "Screenshot of opened drill sheet",
    passCriteria: "Records list matches the count on the card",
    failCriteria: "Empty sheet, error, or count mismatch",
  },
  {
    id: "manual.reporting_mode_toggle",
    name: "Reporting mode change is reflected in analyses",
    clickPath: "/reports → 'Change' on the mode strip → pick a different mode → Save",
    expected: "Analysis cards re-render and turn-related copy changes accordingly",
    evidence: "Before/after screenshots of one Turn-affected card",
    passCriteria: "Card copy and badges visibly reflect the new mode",
    failCriteria: "Identical copy or stale data after refresh",
  },
  {
    id: "manual.narrative_insights",
    name: "Narrative Insights section renders with readiness summary",
    clickPath: "/reports → scroll to 'Narrative Insights — Build 7.3'",
    expected:
      "Bordered section header, subtitle, and 4-stat readiness summary visible; insight cards link back to supporting records",
    evidence: "Screenshot of section",
    passCriteria: "Readiness counts equal the sum of insight cards",
    failCriteria: "Missing summary, mismatched counts, or no drill-through",
  },
  {
    id: "manual.setup_gate",
    name: "Setup gate behaves correctly",
    clickPath: "Hard refresh while not on /setup",
    expected: "Either the app loads (setup complete) or redirects to /setup (incomplete)",
    evidence: "Note observed behaviour + screenshot",
    passCriteria: "Behaviour matches setup status",
    failCriteria: "Blank screen, loop, or wrong redirect",
  },
];

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runAudit(buildLabel: string): Promise<AuditBundle> {
  const generatedAt = new Date().toISOString();

  // 1) Probe routes
  const probes = new Map<string, ProbeResult>();
  const routeChecks: CheckResult[] = [];
  for (const r of CRITICAL_ROUTES) {
    const p = await probe(r.path);
    probes.set(r.path, p);
    if (!p.ok) {
      routeChecks.push({
        id: r.id,
        category: "route_integrity",
        title: r.title,
        status: "fail",
        severity: r.severity,
        expected: "HTTP 2xx",
        observed: p.errorMessage
          ? `network error: ${p.errorMessage}`
          : `HTTP ${p.status} body=${p.bodyShape}`,
      });
      continue;
    }
    const shapeReason = r.expectedShape(p.rawJson);
    routeChecks.push({
      id: r.id,
      category: "route_integrity",
      title: r.title,
      status: shapeReason ? "partial" : "pass",
      severity: r.severity,
      expected: "HTTP 2xx + expected JSON shape",
      observed: shapeReason ? `HTTP ${p.status} but ${shapeReason}` : `HTTP ${p.status} ${p.bodyShape}`,
    });
  }

  // 2) Build checklist
  const ctx: AuditContext = { probes };
  const checklistChecks: CheckResult[] = [];
  for (const c of BUILD_CHECKLIST) {
    try {
      const r = await c.evaluate(ctx);
      checklistChecks.push({
        id: c.id,
        category: "build_checklist",
        title: c.title,
        status: r.status,
        severity: c.severity,
        expected: c.expected,
        observed: r.observed,
        notes: r.notes,
      });
    } catch (err) {
      checklistChecks.push({
        id: c.id,
        category: "build_checklist",
        title: c.title,
        status: "fail",
        severity: c.severity,
        expected: c.expected,
        observed: `evaluator threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 3) Data flow
  const dataChecks = await runDataFlowChecks();

  // 4) Wiring inference — for each critical route that returned an empty array
  //    where we'd expect content, mark a partial wiring check.
  const wiringChecks: CheckResult[] = [];
  const analysis = probes.get("/api/reporting-analysis/all");
  if (analysis?.ok && isObject(analysis.rawJson)) {
    const wos = (analysis.rawJson.workOrders as unknown[]) ?? [];
    const turns = (analysis.rawJson.turns as unknown[]) ?? [];
    wiringChecks.push({
      id: "wiring.analysis_to_ui",
      category: "wiring",
      title: "Reports page → reporting-analysis payload",
      status: wos.length + turns.length > 0 ? "pass" : "partial",
      severity: "high",
      expected: "At least one WO or turn analysis available for the Reports page",
      observed: `${wos.length} WO + ${turns.length} turn analyses`,
    });
  }
  const narrative = probes.get("/api/narrative-insights");
  if (narrative?.ok && isObject(narrative.rawJson)) {
    const insights = (narrative.rawJson.insights as unknown[]) ?? [];
    wiringChecks.push({
      id: "wiring.narrative_to_ui",
      category: "wiring",
      title: "Narrative Insights section → narrative-insights payload",
      status: insights.length > 0 ? "pass" : "manual",
      severity: "medium",
      expected: "Insights array drives the Narrative Insights section",
      observed: `${insights.length} insight(s) returned`,
      notes:
        insights.length === 0
          ? "Empty insights may be a valid empty-state — verify visually that the section renders the empty-state copy."
          : undefined,
    });
  }

  // 5) Product-promise checks (does the build help managers act?)
  const promiseChecks: CheckResult[] = [
    {
      id: "promise.records_back_insights",
      category: "product_promise",
      title: "Every insight links back to supporting records",
      status: (() => {
        if (!narrative?.ok || !isObject(narrative.rawJson)) return "fail";
        const insights = (narrative.rawJson.insights as unknown[]) ?? [];
        if (insights.length === 0) return "manual";
        const withRecords = insights.filter(
          (i) => isObject(i) && Array.isArray(i.supportingRecordIds) && i.supportingRecordIds.length > 0,
        );
        if (withRecords.length === insights.length) return "pass";
        if (withRecords.length === 0) return "fail";
        return "partial";
      })(),
      severity: "high",
      expected: "Each narrative insight carries ≥1 supportingRecordId",
      observed: (() => {
        if (!narrative?.ok || !isObject(narrative.rawJson)) return "narrative endpoint unreachable";
        const insights = (narrative.rawJson.insights as unknown[]) ?? [];
        if (insights.length === 0) return "no insights to evaluate";
        const withRecords = insights.filter(
          (i) => isObject(i) && Array.isArray(i.supportingRecordIds) && i.supportingRecordIds.length > 0,
        ).length;
        return `${withRecords}/${insights.length} insights backed by records`;
      })(),
    },
  ];

  const checks: CheckResult[] = [...routeChecks, ...checklistChecks, ...dataChecks, ...wiringChecks, ...promiseChecks];

  // 6) Roll-up
  const counts = checks.reduce(
    (acc, c) => {
      if (c.status === "pass") acc.pass += 1;
      else if (c.status === "partial") acc.partial += 1;
      else if (c.status === "fail") acc.fail += 1;
      else acc.manual += 1;
      return acc;
    },
    { pass: 0, partial: 0, fail: 0, manual: 0 },
  );

  const hasCriticalFail = checks.some(
    (c) => c.status === "fail" && (c.severity === "critical" || c.severity === "high"),
  );
  const hasAnyFail = counts.fail > 0;
  const hasPartial = counts.partial > 0;

  let status: BuildAuditStatus;
  if (hasCriticalFail) status = "fail";
  else if (hasAnyFail || hasPartial) status = "partial";
  else if (counts.manual > 0 && counts.pass === 0) status = "needs_manual_verification";
  else status = "pass";

  const summary = `${counts.pass} pass · ${counts.partial} partial · ${counts.fail} fail · ${counts.manual} manual`;

  const reportMarkdown = buildReportMarkdown({ buildLabel, generatedAt, status, summary, counts, checks });
  const nextPromptMarkdown = buildNextPrompt({ buildLabel, checks });

  return {
    buildLabel,
    generatedAt,
    status,
    summary,
    counts,
    checks,
    manualTests: MANUAL_TESTS,
    reportMarkdown,
    nextPromptMarkdown,
  };
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

function statusLabel(s: BuildAuditStatus): string {
  switch (s) {
    case "pass": return "PASS";
    case "partial": return "PARTIAL";
    case "fail": return "FAIL";
    case "needs_manual_verification": return "NEEDS MANUAL VERIFICATION";
  }
}

function checkStatusLabel(s: CheckStatus): string {
  return s === "pass" ? "Pass" : s === "partial" ? "Partial" : s === "fail" ? "Fail" : "Manual";
}

function buildReportMarkdown(args: {
  buildLabel: string;
  generatedAt: string;
  status: BuildAuditStatus;
  summary: string;
  counts: { pass: number; partial: number; fail: number; manual: number };
  checks: CheckResult[];
}): string {
  const { buildLabel, generatedAt, status, summary, counts, checks } = args;
  const byCategory = <C extends CheckResult["category"]>(c: C) => checks.filter((x) => x.category === c);

  const lines: string[] = [];
  lines.push(`# Ascent Build Auditor — ${buildLabel}`);
  lines.push(`_Generated ${generatedAt}_`);
  lines.push("");
  lines.push(`## 1. Build Audit Status`);
  lines.push(`**${statusLabel(status)}** — ${summary}`);
  lines.push("");

  lines.push(`## 2. Build Summary`);
  lines.push(
    `Live audit against the running instance. ${counts.pass} checks passed, ${counts.partial} partial, ${counts.fail} failed, ${counts.manual} require manual verification.`,
  );
  lines.push("");

  lines.push(`## 3. Requirement Match (Build Checklist)`);
  for (const c of byCategory("build_checklist")) {
    lines.push(`- **${c.title}** — ${checkStatusLabel(c.status)} (${c.severity})`);
    lines.push(`  - Expected: ${c.expected}`);
    lines.push(`  - Observed: ${c.observed}`);
    if (c.notes) lines.push(`  - Notes: ${c.notes}`);
  }
  lines.push("");

  lines.push(`## 4. Wiring Validation`);
  const wiring = byCategory("wiring");
  if (wiring.length === 0) lines.push("_No wiring checks evaluated this run._");
  for (const c of wiring) {
    lines.push(`- **${c.title}** — ${checkStatusLabel(c.status)} (${c.severity})`);
    lines.push(`  - Expected: ${c.expected}`);
    lines.push(`  - Observed: ${c.observed}`);
    if (c.notes) lines.push(`  - Notes: ${c.notes}`);
  }
  lines.push("");

  lines.push(`## 5. Route Integrity`);
  for (const c of byCategory("route_integrity")) {
    lines.push(`- **${c.title}** — ${checkStatusLabel(c.status)} (${c.severity}) — ${c.observed}`);
  }
  lines.push("");

  lines.push(`## 6. Data Flow Verification`);
  for (const c of byCategory("data_flow")) {
    lines.push(`- **${c.title}** — ${checkStatusLabel(c.status)} (${c.severity}) — ${c.observed}`);
  }
  lines.push("");

  lines.push(`## 7. Ascent Product Promise Check`);
  for (const c of byCategory("product_promise")) {
    lines.push(`- **${c.title}** — ${checkStatusLabel(c.status)} (${c.severity})`);
    lines.push(`  - Expected: ${c.expected}`);
    lines.push(`  - Observed: ${c.observed}`);
  }
  lines.push("");

  lines.push(`## 8. Screenshot / Manual Evidence Needed`);
  for (const t of MANUAL_TESTS) {
    lines.push(`### ${t.name}`);
    lines.push(`- Click path: ${t.clickPath}`);
    lines.push(`- Expected: ${t.expected}`);
    lines.push(`- Evidence: ${t.evidence}`);
    lines.push(`- Pass: ${t.passCriteria}`);
    lines.push(`- Fail: ${t.failCriteria}`);
    lines.push("");
  }

  lines.push(`## 9. Problems Found`);
  const problems = checks.filter((c) => c.status === "fail" || c.status === "partial");
  if (problems.length === 0) {
    lines.push("_No problems detected by the automated checks. Confirm via the manual test plan above._");
  } else {
    for (const p of problems) {
      lines.push(`- **${p.title}** — ${checkStatusLabel(p.status)} (${p.severity})`);
      lines.push(`  - Where: \`${p.id}\``);
      lines.push(`  - Why it matters: ${p.expected}`);
      lines.push(`  - Observed: ${p.observed}`);
    }
  }
  lines.push("");

  lines.push(`## 10. Next Replit Prompt`);
  lines.push("_See the dedicated Next Prompt block in the audit page._");

  return lines.join("\n");
}

function buildNextPrompt(args: { buildLabel: string; checks: CheckResult[] }): string {
  const { buildLabel, checks } = args;
  const failures = checks.filter((c) => c.status === "fail" || c.status === "partial");

  const lines: string[] = [];
  lines.push(`Ascent 1.0 — follow-up pass after ${buildLabel}.`);
  lines.push("");

  if (failures.length === 0) {
    lines.push(
      "The automated auditor returned no failures. Run the manual evidence checklist (Section 8) and capture screenshots; if everything passes visually, mark this build complete and move to the next planned layer.",
    );
  } else {
    lines.push("Fix the following auditor findings in priority order:");
    const sorted = [...failures].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
    for (const f of sorted) {
      lines.push("");
      lines.push(`- **${f.title}** (${f.severity}, ${checkStatusLabel(f.status)})`);
      lines.push(`  - Expected: ${f.expected}`);
      lines.push(`  - Observed: ${f.observed}`);
    }
  }

  lines.push("");
  lines.push("Constraints:");
  lines.push(
    "- Do not replace working systems unnecessarily. Inspect the current implementation first, preserve working logic, and only modify what is required to complete the requested fix.",
  );
  lines.push(
    "- After completing the work, provide a final report listing files changed, behavior added, behavior preserved, tests performed, and anything still needing manual verification.",
  );
  lines.push("- Re-run the Ascent Build Auditor (/dev/build-auditor) and confirm the previously-failing checks now pass.");

  return lines.join("\n");
}

function sevRank(s: CheckSeverity): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function saveAudit(bundle: AuditBundle): Promise<BuildAudit> {
  const [row] = await db
    .insert(buildAuditsTable)
    .values({
      buildLabel: bundle.buildLabel,
      status: bundle.status,
      passCount: bundle.counts.pass,
      partialCount: bundle.counts.partial,
      failCount: bundle.counts.fail,
      manualCount: bundle.counts.manual,
      summary: bundle.summary,
      reportMarkdown: bundle.reportMarkdown,
      nextPromptMarkdown: bundle.nextPromptMarkdown,
      checkResults: bundle.checks,
    })
    .returning();
  return row;
}

export async function listRecentAudits(limit = 20): Promise<BuildAudit[]> {
  return db.select().from(buildAuditsTable).orderBy(desc(buildAuditsTable.createdAt)).limit(limit);
}

export async function getAuditById(id: number): Promise<BuildAudit | null> {
  const [row] = await db.select().from(buildAuditsTable).where(eq(buildAuditsTable.id, id)).limit(1);
  return row ?? null;
}
