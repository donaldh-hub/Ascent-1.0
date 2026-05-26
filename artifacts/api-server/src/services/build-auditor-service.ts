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

export interface VisualProof {
  id: string;
  screenshotNeeded: string;
  pageOrRoute: string;
  mustBeVisible: string;
  whyItMatters: string;
  passCriteria: string;
  failCriteria: string;
}

export interface ExecutiveFeedback {
  status: BuildAuditStatus;
  judgement: string;
  criticalCount: number;
  highRiskCount: number;
  manualVerificationCount: number;
  recommendedNextAction: string;
  safeToContinue: boolean;
}

export type GoNoGoDecision =
  | "yes_safe"
  | "yes_with_caution"
  | "no_repair_required"
  | "needs_manual_verification";

export interface GoNoGo {
  decision: GoNoGoDecision;
  rationale: string;
  blockingChecks: string[]; // check IDs that drove the decision
}

export interface TopIssue {
  rank: 1 | 2 | 3;
  checkId: string;
  title: string;
  location: string;
  whyItMatters: string;
  requiredFix: string;
  verificationMethod: string;
  severity: CheckSeverity;
  status: CheckStatus;
}

export interface AuditBundle {
  buildLabel: string;
  generatedAt: string;
  status: BuildAuditStatus;
  summary: string;
  counts: { pass: number; partial: number; fail: number; manual: number };
  checks: CheckResult[];
  manualTests: ManualTest[];
  visualProofs: VisualProof[];
  executive: ExecutiveFeedback;
  goNoGo: GoNoGo;
  topIssues: TopIssue[];
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
      // Spec (Build 7.1): reportingMode must be exposed clearly at the
      // top level of the analysis payload, not only buried inside a
      // nested config object.
      if (typeof j.reportingMode !== "string" || j.reportingMode.length === 0) {
        return {
          status: "partial",
          observed: `response missing top-level scalar reportingMode (got ${typeof j.reportingMode})`,
        };
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
    id: "build.7_5.pm_mapping_layer",
    title: "Build 7.5 — PM Data Mapping Layer produces mapped records",
    build: "7.5",
    severity: "high",
    expected:
      "GET /api/reporting-analysis/all → bundle.pm[0] is a real PM mapping readiness analysis " +
      "with sourceCategory 'preventative_maintenance', a non-empty supportingRecordIds list " +
      "(or insufficient_data when no PM-style records exist), and PM-only language in its title.",
    evaluate: async (ctx) => {
      const p = ctx.probes.get("/api/reporting-analysis/all");
      if (!p?.ok || !isObject(p.rawJson)) {
        return { status: "fail", observed: "no analysis payload" };
      }
      const pm = (p.rawJson.pm as unknown[]) ?? [];
      if (pm.length === 0) {
        return { status: "fail", observed: "bundle.pm is empty (engine did not emit an analysis)" };
      }
      const a = pm[0];
      if (!isObject(a)) {
        return { status: "fail", observed: "bundle.pm[0] is not an object" };
      }
      if (a.sourceCategory !== "preventative_maintenance") {
        return {
          status: "fail",
          observed: `bundle.pm[0].sourceCategory='${String(a.sourceCategory)}' (expected 'preventative_maintenance')`,
        };
      }
      const supportingIds = Array.isArray(a.supportingRecordIds) ? a.supportingRecordIds : [];
      const title = String(a.title ?? "");
      const summaryText = String(a.summary ?? "");
      const factors = Array.isArray(a.contributingFactors) ? a.contributingFactors : [];
      const factorLabels = factors
        .map((f) => (isObject(f) ? String(f.label ?? "") : ""))
        .filter((s) => s.length > 0);
      // PM language rule (spec §15): PM-facing copy must not call PM records
      // turns or work orders. Check title, summary, and contributingFactor
      // labels — any future copy change anywhere in that surface trips this.
      const mixesVocab = (s: string) =>
        /\bturn(s)?\b/i.test(s) || /\bwork[ -]?order(s)?\b/i.test(s);
      if (mixesVocab(title)) {
        return { status: "fail", observed: `PM title mixes WO/turn vocabulary: '${title}'` };
      }
      if (mixesVocab(summaryText)) {
        return { status: "fail", observed: `PM summary mixes WO/turn vocabulary: '${summaryText}'` };
      }
      const badLabel = factorLabels.find(mixesVocab);
      if (badLabel) {
        return {
          status: "fail",
          observed: `PM contributingFactor label mixes WO/turn vocabulary: '${badLabel}'`,
        };
      }
      // Every PM supporting id (at the analysis level AND in each factor)
      // must use the PM namespace so drill-downs route to PM, not WO.
      const allPmIds: unknown[] = [
        ...supportingIds,
        ...factors.flatMap((f) =>
          isObject(f) && Array.isArray(f.supportingRecordIds) ? f.supportingRecordIds : [],
        ),
      ];
      const badNs = allPmIds.filter(
        (id) => typeof id !== "string" || !id.startsWith("preventative_maintenance:"),
      );
      if (badNs.length > 0) {
        return {
          status: "fail",
          observed: `${badNs.length} PM supporting id(s) do not use the 'preventative_maintenance:' namespace`,
        };
      }
      if (supportingIds.length === 0) {
        return {
          status: "pass",
          observed: `PM mapping readiness reachable; 0 PM records mapped (low-data state correctly surfaced)`,
        };
      }
      return {
        status: "pass",
        observed: `bundle.pm[0]: ${supportingIds.length} mapped PM record(s); fully=${a.fullyReportableRecordCount} partially=${a.partiallyReportableRecordCount} excluded=${a.excludedRecordCount}`,
      };
    },
  },
  {
    id: "build.7_5.pm_mapping_summary_traceable",
    title: "Build 7.5 — PM mapping summary counts are traceable to records",
    build: "7.5",
    severity: "high",
    expected:
      "bundle.pm[0].supportingRecordCount equals the length of supportingRecordIds, " +
      "and (fullyReportable + partiallyReportable + excluded) equals supportingRecordCount. " +
      "Spec §wiring: every PM count must trace back to real PM records.",
    evaluate: async (ctx) => {
      const p = ctx.probes.get("/api/reporting-analysis/all");
      if (!p?.ok || !isObject(p.rawJson)) {
        return { status: "fail", observed: "no analysis payload" };
      }
      const pm = (p.rawJson.pm as unknown[]) ?? [];
      const a = pm[0];
      if (!isObject(a)) return { status: "fail", observed: "bundle.pm[0] missing" };
      const ids = Array.isArray(a.supportingRecordIds) ? a.supportingRecordIds : [];
      const supCount = Number(a.supportingRecordCount ?? 0);
      const fully = Number(a.fullyReportableRecordCount ?? 0);
      const partial = Number(a.partiallyReportableRecordCount ?? 0);
      const excl = Number(a.excludedRecordCount ?? 0);
      if (supCount !== ids.length) {
        return {
          status: "fail",
          observed: `supportingRecordCount=${supCount} but supportingRecordIds.length=${ids.length}`,
        };
      }
      if (fully + partial + excl !== supCount) {
        return {
          status: "fail",
          observed: `eligibility tiers (fully=${fully} + partial=${partial} + excluded=${excl}) do not equal supportingRecordCount=${supCount}`,
        };
      }
      return {
        status: "pass",
        observed: `PM mapping counts traceable: ${supCount} record(s); tiers sum to total`,
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

// ─── Visual proof checklist (always emitted) ──────────────────────────────────

const VISUAL_PROOFS: VisualProof[] = [
  {
    id: "proof.control_tower",
    screenshotNeeded: "Full /control-tower page",
    pageOrRoute: "/control-tower",
    mustBeVisible:
      "Priority Actions list, Operational Focus layer, and stoplight (R/Y/G) scores — none blank.",
    whyItMatters:
      "Control Tower is the single entry point; if it renders empty the customer sees nothing operational.",
    passCriteria: "All three regions render with data; no error toast or empty placeholder",
    failCriteria: "Any region blank, console errors, or stoplight not rendered",
  },
  {
    id: "proof.reports_cards",
    screenshotNeeded: "/reports analysis cards above the fold",
    pageOrRoute: "/reports",
    mustBeVisible:
      "Confidence badge (Fully supported / Partially supported / Directional only / Not enough data), supporting record counts, and the 'View N supporting records' button.",
    whyItMatters:
      "Reports is where ingestion → intelligence is verified; missing badges or counts means the analysis layer isn't visible to the user.",
    passCriteria: "Every visible card shows a badge, a record count, and a working drill button",
    failCriteria: "Any card missing badge, missing count, or button does nothing",
  },
  {
    id: "proof.reports_drill",
    screenshotNeeded: "Drill-through sheet after clicking 'View N supporting records'",
    pageOrRoute: "/reports → side sheet",
    mustBeVisible: "Side sheet opens, lists records, and the count matches the card",
    whyItMatters:
      "Drill-through is the proof every insight links back to records — core to the Ascent promise.",
    passCriteria: "Sheet opens with ≥1 record and the count matches the originating card",
    failCriteria: "Sheet empty, errors out, or count mismatch",
  },
  {
    id: "proof.narrative_section",
    screenshotNeeded: "Narrative Insights section with readiness summary",
    pageOrRoute: "/reports (bottom section)",
    mustBeVisible:
      "Bordered Build 7.3 header card, subtitle, and 4-stat readiness summary (Fully / Partially / Directional / Blocked).",
    whyItMatters:
      "The narrative layer is the operator-friendly translation; if hidden, the build is visually incomplete.",
    passCriteria: "Header card visible, readiness counts equal the sum of insight cards below",
    failCriteria: "Missing header, mismatched counts, or section absent",
  },
  {
    id: "proof.reporting_mode_toggle",
    screenshotNeeded: "Before/after of one Turn-affected card across a mode change",
    pageOrRoute: "/reports → Change → save",
    mustBeVisible: "Card copy and badges visibly change after the mode is saved",
    whyItMatters:
      "Proves the mode is wired through to analysis output, not just a stored setting.",
    passCriteria: "Card copy changes (e.g. 'Turn (turn-progress…)' ↔ 'Turn (imported…)')",
    failCriteria: "Identical copy after save",
  },
  {
    id: "proof.work_orders_list",
    screenshotNeeded: "/work-orders list page",
    pageOrRoute: "/work-orders",
    mustBeVisible: "At least one row with status, property, and an action affordance",
    whyItMatters: "Confirms WO data flows from ingestion to operator views",
    passCriteria: "Rows render; clicking a row opens detail or sheet",
    failCriteria: "Empty list with no empty-state message, or rows missing required columns",
  },
  {
    id: "proof.turns_list",
    screenshotNeeded: "/turns list page",
    pageOrRoute: "/turns",
    mustBeVisible: "Turn rows with stage and unit context",
    whyItMatters: "Confirms turn data flows from ingestion to operator views",
    passCriteria: "Rows render with stage column populated",
    failCriteria: "No data, no empty-state copy, or stage column blank",
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
    const hasPayload = wos.length + turns.length > 0;
    wiringChecks.push({
      id: "wiring.analysis_payload_present",
      category: "wiring",
      title: "Reports — analysis payload is reachable (backend wiring)",
      status: hasPayload ? "pass" : "partial",
      severity: "high",
      expected: "At least one WO or turn analysis returned by /api/reporting-analysis/all",
      observed: `${wos.length} WO + ${turns.length} turn analyses returned`,
      notes:
        "Backend reachability only. Whether the Reports page actually renders these cards, the badges show, and the drill button opens the side sheet must be confirmed by the Visual Proof Checklist below.",
    });
    wiringChecks.push({
      id: "wiring.analysis_rendered_on_reports",
      category: "wiring",
      title: "Reports — cards render and drill-through works (user-facing)",
      status: "manual",
      severity: "high",
      expected:
        "On /reports: cards visible, confidence badge visible, supporting record count shown, 'View N supporting records' opens the drill sheet",
      observed:
        "Automated probe cannot observe rendered DOM, button clicks, or sheet behaviour — Visual Proof required.",
      notes: "See Visual Proof Checklist: proof.reports_cards + proof.reports_drill.",
    });
  }
  // ── Ascent 7.4 — Turn visuals must carry the active reporting mode ────────
  // Both the dashboard summary and the turn stats endpoint must echo the
  // active reporting mode so the client banner + gating logic can label
  // and gate turn-related visuals consistently across surfaces.
  const turnStatsProbe = await probe("/api/turns/stats");
  const dashboardSummaryProbe = probes.get("/api/dashboard/summary");
  {
    const dashHasMode =
      dashboardSummaryProbe?.ok &&
      isObject(dashboardSummaryProbe.rawJson) &&
      typeof dashboardSummaryProbe.rawJson["reportingMode"] === "string" &&
      typeof dashboardSummaryProbe.rawJson["turnSignalSource"] === "string";
    const turnsHasMode =
      turnStatsProbe.ok &&
      isObject(turnStatsProbe.rawJson) &&
      typeof turnStatsProbe.rawJson["reportingMode"] === "string" &&
      typeof turnStatsProbe.rawJson["turnSignalSource"] === "string";
    const bothEcho = dashHasMode && turnsHasMode;
    wiringChecks.push({
      id: "wiring.turn_visuals_carry_mode_language",
      category: "wiring",
      title: "Turn visuals carry the active reporting mode (backend wiring)",
      status: bothEcho ? "pass" : "fail",
      severity: "high",
      expected:
        "/api/dashboard/summary and /api/turns/stats both return reportingMode + turnSignalSource so client banners can label turn visuals.",
      observed: bothEcho
        ? `dashboard.reportingMode=${(dashboardSummaryProbe!.rawJson as Record<string, unknown>)["reportingMode"]}; turns.reportingMode=${(turnStatsProbe.rawJson as Record<string, unknown>)["reportingMode"]}`
        : `dashboard echo=${dashHasMode}; turns echo=${turnsHasMode}`,
      notes:
        "Renders the addendum phrasing on /control-tower and /turns. Visual proof checklist confirms the banner appears in the DOM.",
    });
  }

  // ── Ascent 7.4 — Supporting records must surface inclusionReason ──────────
  // Drill from /api/reporting-analysis/all to find a turn analysis that
  // carries recordInclusionMetadata, then call /supporting-records and
  // verify the per-record inclusionReason field is plumbed through.
  {
    let observed = "no turn analysis with recordInclusionMetadata found";
    let status: CheckStatus = "manual";
    if (analysis?.ok && isObject(analysis.rawJson)) {
      const turns = (analysis.rawJson["turns"] as unknown[]) ?? [];
      const candidate = turns.find(
        (a) =>
          isObject(a) &&
          isObject(a["recordInclusionMetadata"]) &&
          Object.keys(a["recordInclusionMetadata"] as object).length > 0,
      );
      if (isObject(candidate) && typeof candidate["analysisId"] === "string") {
        const drill = await probe(
          `/api/reporting-analysis/supporting-records?analysisId=${encodeURIComponent(
            candidate["analysisId"],
          )}`,
        );
        if (drill.ok && isObject(drill.rawJson)) {
          const records = (drill.rawJson["records"] as unknown[]) ?? [];
          const withReason = records.filter(
            (r) => isObject(r) && typeof r["inclusionReason"] === "string" && r["inclusionReason"].length > 0,
          );
          observed = `${withReason.length}/${records.length} supporting record(s) carry inclusionReason on analysisId=${candidate["analysisId"]}`;
          status =
            records.length > 0 && withReason.length === records.length
              ? "pass"
              : records.length > 0 && withReason.length > 0
              ? "partial"
              : "fail";
        } else {
          observed = `supporting-records probe failed (status=${drill.status})`;
          status = "fail";
        }
      } else {
        // No turn analysis advertises inclusion metadata yet — likely a
        // legacy or non-turn dataset. Surface as manual rather than fail.
        observed =
          "No turn analysis advertised recordInclusionMetadata in /reporting-analysis/all (legacy or non-turn dataset). Check manually after a turn analysis runs under MEASURE mode.";
        status = "manual";
      }
    } else {
      observed = "reporting-analysis/all unreachable";
      status = "fail";
    }
    wiringChecks.push({
      id: "wiring.supporting_records_inclusion_reason_rendered",
      category: "wiring",
      title: "Supporting records carry per-record inclusionReason (backend wiring)",
      status,
      severity: "high",
      expected:
        "For a turn analysis with recordInclusionMetadata, /supporting-records returns inclusionReason on each record so the drill sheet can explain why each record was included.",
      observed,
      notes:
        "The Reports drill-down sheet renders the inclusion reason under each record. Visual proof checklist confirms the row text appears.",
    });
  }

  const narrative = probes.get("/api/narrative-insights");
  if (narrative?.ok && isObject(narrative.rawJson)) {
    const insights = (narrative.rawJson.insights as unknown[]) ?? [];
    wiringChecks.push({
      id: "wiring.narrative_payload_present",
      category: "wiring",
      title: "Narrative Insights — payload is reachable (backend wiring)",
      status: "pass",
      severity: "medium",
      expected: "Insights endpoint reachable and returns an insights array (possibly empty)",
      observed: `${insights.length} insight(s) returned`,
    });
    wiringChecks.push({
      id: "wiring.narrative_rendered",
      category: "wiring",
      title: "Narrative Insights — section renders on /reports (user-facing)",
      status: "manual",
      severity: "medium",
      expected:
        "Bordered Build 7.3 header card, 4-stat readiness summary, and insight cards (or correct empty-state copy) all visibly render on /reports",
      observed: "Automated probe cannot inspect DOM rendering — Visual Proof required.",
      notes: "See Visual Proof Checklist: proof.narrative_section.",
    });
  }

  // 5) Product-promise checks (does the build help managers act?)
  //
  // Spec (Build 7.3): every narrative insight that makes an operational
  // claim must either (a) carry ≥1 supportingRecordId or (b) be clearly
  // labelled as an empty-state/readiness insight that does not require
  // supporting records. The engine now exposes `requiresSupportingRecords`
  // (false for readiness, true for operational) so this check can exempt
  // readiness insights instead of treating them as failures.
  const promiseChecks: CheckResult[] = [
    {
      id: "promise.records_back_insights",
      category: "product_promise",
      title: "Every operational insight links back to supporting records",
      status: (() => {
        if (!narrative?.ok || !isObject(narrative.rawJson)) return "fail";
        const insights = (narrative.rawJson.insights as unknown[]) ?? [];
        if (insights.length === 0) return "manual";
        const operational = insights.filter(
          (i) =>
            isObject(i) &&
            // Treat missing flag as operational for backward compat.
            (i.requiresSupportingRecords === undefined ||
              i.requiresSupportingRecords === true) &&
            String(i.insightCategory ?? "") !== "data_quality_reporting_readiness" &&
            String(i.dataSupportLevel ?? "") !== "not_enough_data",
        );
        if (operational.length === 0) return "manual"; // only readiness items present
        const withRecords = operational.filter(
          (i) => isObject(i) && Array.isArray(i.supportingRecordIds) && i.supportingRecordIds.length > 0,
        );
        if (withRecords.length === operational.length) return "pass";
        if (withRecords.length === 0) return "fail";
        return "partial";
      })(),
      severity: "high",
      expected:
        "Each operational insight carries ≥1 supportingRecordId; readiness insights (data_quality_reporting_readiness / not_enough_data) are exempt.",
      observed: (() => {
        if (!narrative?.ok || !isObject(narrative.rawJson)) return "narrative endpoint unreachable";
        const insights = (narrative.rawJson.insights as unknown[]) ?? [];
        if (insights.length === 0) return "no insights to evaluate";
        const operational = insights.filter(
          (i) =>
            isObject(i) &&
            (i.requiresSupportingRecords === undefined ||
              i.requiresSupportingRecords === true) &&
            String(i.insightCategory ?? "") !== "data_quality_reporting_readiness" &&
            String(i.dataSupportLevel ?? "") !== "not_enough_data",
        );
        const readiness = insights.length - operational.length;
        if (operational.length === 0) {
          return `0 operational insights, ${readiness} readiness insights (no operational claims to verify)`;
        }
        const withRecords = operational.filter(
          (i) => isObject(i) && Array.isArray(i.supportingRecordIds) && i.supportingRecordIds.length > 0,
        ).length;
        return `${withRecords}/${operational.length} operational insights backed by records (${readiness} readiness insights exempt)`;
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

  // 7) Executive feedback, Go/No-Go, Top 3
  const executive = computeExecutive(status, checks, counts);
  const goNoGo = computeGoNoGo(status, checks);
  const topIssues = computeTopIssues(checks);

  const reportMarkdown = buildReportMarkdown({
    buildLabel,
    generatedAt,
    status,
    summary,
    counts,
    checks,
    executive,
    goNoGo,
    topIssues,
  });
  const nextPromptMarkdown = buildNextPrompt({ buildLabel, checks, topIssues, goNoGo });

  return {
    buildLabel,
    generatedAt,
    status,
    summary,
    counts,
    checks,
    manualTests: MANUAL_TESTS,
    visualProofs: VISUAL_PROOFS,
    executive,
    goNoGo,
    topIssues,
    reportMarkdown,
    nextPromptMarkdown,
  };
}

// ─── Executive / Go-No-Go / Top issues ────────────────────────────────────────

const CRITICAL_DOMAINS = [
  "routing",
  "reporting",
  "upload",
  "dashboard",
  "data_flow",
] as const;

function isCriticalDomainCheck(c: CheckResult): boolean {
  const id = c.id.toLowerCase();
  const title = c.title.toLowerCase();
  if (c.category === "route_integrity") return true; // routing
  if (c.category === "data_flow") return true;
  if (id.includes("dashboard") || title.includes("dashboard")) return true;
  if (id.includes("reporting") || title.includes("report")) return true;
  if (id.includes("upload") || title.includes("upload") || title.includes("document"))
    return true;
  return false;
}

function computeExecutive(
  status: BuildAuditStatus,
  checks: CheckResult[],
  counts: { pass: number; partial: number; fail: number; manual: number },
): ExecutiveFeedback {
  const criticalCount = checks.filter(
    (c) => c.status === "fail" && c.severity === "critical",
  ).length;
  const highRiskCount = checks.filter(
    (c) =>
      (c.status === "fail" || c.status === "partial") &&
      (c.severity === "high" || c.severity === "critical"),
  ).length;
  const manualVerificationCount = counts.manual;

  let judgement: string;
  let recommendedNextAction: string;
  let safeToContinue: boolean;
  switch (status) {
    case "pass":
      judgement =
        manualVerificationCount > 0
          ? "All automated checks passed; visual proofs remain to be confirmed."
          : "All automated checks passed.";
      recommendedNextAction =
        manualVerificationCount > 0
          ? "Capture the Visual Proof Checklist screenshots, then promote the build."
          : "Promote the build and start the next planned layer.";
      safeToContinue = true;
      break;
    case "partial":
      judgement = `${counts.fail} hard failure(s) and ${counts.partial} partial finding(s) detected. Build is incomplete but not broken.`;
      recommendedNextAction =
        "Resolve the Top 3 Issues below, capture Visual Proof, then re-run the auditor.";
      safeToContinue = highRiskCount === 0;
      break;
    case "fail":
      judgement = `Critical or high-severity failures detected (${criticalCount} critical, ${highRiskCount} high-risk). Build is not safe to ship.`;
      recommendedNextAction =
        "Fix the #1 issue below first, re-run the auditor, then address the remainder.";
      safeToContinue = false;
      break;
    case "needs_manual_verification":
      judgement =
        "Automated checks could not produce a definitive result. Human visual confirmation required.";
      recommendedNextAction = "Complete the Visual Proof Checklist before promoting.";
      safeToContinue = false;
      break;
  }

  return {
    status,
    judgement,
    criticalCount,
    highRiskCount,
    manualVerificationCount,
    recommendedNextAction,
    safeToContinue,
  };
}

function computeGoNoGo(status: BuildAuditStatus, checks: CheckResult[]): GoNoGo {
  const criticalDomainBlockers = checks.filter(
    (c) => (c.status === "fail" || c.status === "partial") && isCriticalDomainCheck(c) &&
      (c.severity === "high" || c.severity === "critical"),
  );

  if (criticalDomainBlockers.length > 0 || status === "fail") {
    return {
      decision: "no_repair_required",
      rationale: `Blocking ${criticalDomainBlockers.length || 1} issue(s) in critical domains (routing, reporting, upload, dashboard, or data flow). Repair before next build.`,
      blockingChecks: criticalDomainBlockers.map((c) => c.id),
    };
  }
  if (status === "needs_manual_verification") {
    return {
      decision: "needs_manual_verification",
      rationale:
        "Automated checks cannot confirm user-facing behaviour. Run the Visual Proof Checklist before deciding.",
      blockingChecks: checks.filter((c) => c.status === "manual").map((c) => c.id),
    };
  }
  if (status === "partial") {
    return {
      decision: "yes_with_caution",
      rationale: `${checks.filter((c) => c.status === "partial").length} partial finding(s) remain; none in critical domains. Note them and proceed.`,
      blockingChecks: [],
    };
  }
  // pass
  const manualOpen = checks.filter((c) => c.status === "manual");
  if (manualOpen.length > 0) {
    return {
      decision: "yes_with_caution",
      rationale: `All automated checks passed; ${manualOpen.length} item(s) still need visual confirmation.`,
      blockingChecks: manualOpen.map((c) => c.id),
    };
  }
  return {
    decision: "yes_safe",
    rationale: "All automated checks passed and no manual items are open.",
    blockingChecks: [],
  };
}

function computeTopIssues(checks: CheckResult[]): TopIssue[] {
  const candidates = checks.filter((c) => c.status === "fail" || c.status === "partial");
  if (candidates.length === 0) return [];
  const productRisk = (c: CheckResult): number => (isCriticalDomainCheck(c) ? 1 : 0);
  const statusRank = (s: CheckStatus): number => (s === "fail" ? 2 : 1);
  const sorted = [...candidates].sort((a, b) => {
    const sa = sevRank(b.severity) - sevRank(a.severity);
    if (sa !== 0) return sa;
    const pr = productRisk(b) - productRisk(a);
    if (pr !== 0) return pr;
    return statusRank(b.status) - statusRank(a.status);
  });
  return sorted.slice(0, 3).map((c, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    checkId: c.id,
    title: c.title,
    location: locationFor(c),
    whyItMatters: whyItMatters(c),
    requiredFix: requiredFix(c),
    verificationMethod: verificationMethod(c),
    severity: c.severity,
    status: c.status,
  }));
}

function locationFor(c: CheckResult): string {
  if (c.category === "route_integrity") return `API route: ${c.title.replace(/^GET\s+/, "")}`;
  if (c.category === "data_flow") return `Database table referenced by: ${c.title}`;
  if (c.category === "wiring") return `Cross-layer wiring: ${c.id}`;
  if (c.category === "build_checklist") return `Build checklist item: ${c.id}`;
  return `Product promise check: ${c.id}`;
}

function whyItMatters(c: CheckResult): string {
  if (c.category === "route_integrity")
    return "If this route is broken, every dependent UI surface (page, card, drill-through) silently fails for the user.";
  if (c.category === "data_flow")
    return "Missing or unexpected data here makes downstream analyses misleading or empty.";
  if (c.category === "wiring")
    return "A reachable backend without rendered UI means the user cannot see or act on this signal.";
  if (c.category === "build_checklist")
    return "This is a contracted build requirement — leaving it partial means the layer is not actually shipped.";
  return "This is a core Ascent promise — operators need to trust every insight links back to records.";
}

function requiredFix(c: CheckResult): string {
  if (c.status === "fail" && c.category === "route_integrity")
    return `Restore the route so the probe receives a 2xx response. Observed: ${c.observed}`;
  if (c.status === "partial" && c.category === "route_integrity")
    return `Route responds but the shape is wrong — adjust the handler so the response matches the expected contract. Observed: ${c.observed}`;
  if (c.category === "data_flow")
    return `Investigate the table referenced by '${c.id}'. Either seed data, fix the query, or correct the predicate. Observed: ${c.observed}`;
  if (c.category === "wiring")
    return `Trace the payload through to the rendering component and confirm the UI is wired and visible. Observed: ${c.observed}`;
  if (c.category === "build_checklist")
    return `Re-open the build checklist for '${c.id}' and complete the unfinished portion. Observed: ${c.observed}`;
  return `Make every insight carry ≥1 supportingRecordId so drill-through always lands somewhere. Observed: ${c.observed}`;
}

function verificationMethod(c: CheckResult): string {
  if (c.category === "route_integrity")
    return `Re-run the auditor; the '${c.id}' route check must move to Pass.`;
  if (c.category === "data_flow")
    return `Re-run the auditor; the '${c.id}' data-flow check must move to Pass.`;
  if (c.category === "wiring")
    return `Re-run the auditor AND capture the matching Visual Proof screenshot (see Visual Proof Checklist).`;
  if (c.category === "build_checklist")
    return `Re-run the auditor; the build-checklist row for '${c.id}' must move to Pass.`;
  return `Re-run the auditor; the product-promise check must move to Pass; spot-check 3 insights in the UI to confirm drill-through.`;
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

function goNoGoLabel(d: GoNoGoDecision): string {
  switch (d) {
    case "yes_safe": return "YES — safe to move forward";
    case "yes_with_caution": return "YES, WITH CAUTION — minor issues remain";
    case "no_repair_required": return "NO — repair required before next build";
    case "needs_manual_verification": return "NEEDS MANUAL VERIFICATION — cannot decide until user confirms behaviour";
  }
}

function buildReportMarkdown(args: {
  buildLabel: string;
  generatedAt: string;
  status: BuildAuditStatus;
  summary: string;
  counts: { pass: number; partial: number; fail: number; manual: number };
  checks: CheckResult[];
  executive: ExecutiveFeedback;
  goNoGo: GoNoGo;
  topIssues: TopIssue[];
}): string {
  const { buildLabel, generatedAt, status, summary, counts, checks, executive, goNoGo, topIssues } = args;
  const byCategory = <C extends CheckResult["category"]>(c: C) => checks.filter((x) => x.category === c);

  const lines: string[] = [];
  lines.push(`# Ascent Build Auditor — ${buildLabel}`);
  lines.push(`_Generated ${generatedAt}_`);
  lines.push("");

  // 0. Executive feedback (new)
  lines.push(`## 0. Executive Build Feedback`);
  lines.push(`- **Overall status:** ${statusLabel(executive.status)}`);
  lines.push(`- **Judgement:** ${executive.judgement}`);
  lines.push(`- **Critical issues:** ${executive.criticalCount}`);
  lines.push(`- **High-risk issues:** ${executive.highRiskCount}`);
  lines.push(`- **Manual verification items:** ${executive.manualVerificationCount}`);
  lines.push(`- **Recommended next action:** ${executive.recommendedNextAction}`);
  lines.push(`- **Safe to continue from this build:** ${executive.safeToContinue ? "Yes" : "No — repair first"}`);
  lines.push("");

  // 0a. Go / No-Go
  lines.push(`## 0a. Can We Move Forward?`);
  lines.push(`**${goNoGoLabel(goNoGo.decision)}**`);
  lines.push("");
  lines.push(goNoGo.rationale);
  if (goNoGo.blockingChecks.length > 0) {
    lines.push("");
    lines.push(`Blocking checks: ${goNoGo.blockingChecks.map((id) => `\`${id}\``).join(", ")}`);
  }
  lines.push("");

  // 0b. Top 3 issues
  lines.push(`## 0b. Top 3 Issues To Fix First`);
  if (topIssues.length === 0) {
    lines.push("_No outstanding issues from automated checks._");
  } else {
    for (const t of topIssues) {
      lines.push("");
      lines.push(`### #${t.rank} — ${t.title} (${t.severity}, ${checkStatusLabel(t.status)})`);
      lines.push(`- **Location:** ${t.location}`);
      lines.push(`- **Why it matters:** ${t.whyItMatters}`);
      lines.push(`- **Required fix:** ${t.requiredFix}`);
      lines.push(`- **Verification:** ${t.verificationMethod}`);
    }
  }
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

  lines.push(`## 8a. Visual Proof Checklist`);
  lines.push(
    "_Automated probes cannot verify rendered DOM, click behaviour, or user workflows. Capture these screenshots after every build._",
  );
  for (const p of VISUAL_PROOFS) {
    lines.push("");
    lines.push(`### ${p.screenshotNeeded}`);
    lines.push(`- **Page/route:** ${p.pageOrRoute}`);
    lines.push(`- **What must be visible:** ${p.mustBeVisible}`);
    lines.push(`- **Why it matters:** ${p.whyItMatters}`);
    lines.push(`- **Pass:** ${p.passCriteria}`);
    lines.push(`- **Fail:** ${p.failCriteria}`);
  }
  lines.push("");

  lines.push(`## 8b. Manual Test Plan (Click-through Evidence)`);
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

function buildNextPrompt(args: {
  buildLabel: string;
  checks: CheckResult[];
  topIssues: TopIssue[];
  goNoGo: GoNoGo;
}): string {
  const { buildLabel, checks, topIssues, goNoGo } = args;
  const failures = checks.filter((c) => c.status === "fail" || c.status === "partial");

  const lines: string[] = [];
  lines.push(`Ascent 1.0 — follow-up pass after "${buildLabel}".`);
  lines.push("");
  lines.push(`Auditor decision: ${goNoGoLabel(goNoGo.decision)}.`);
  lines.push("");

  if (failures.length === 0) {
    lines.push(
      "The automated auditor returned no failures. Capture the Visual Proof Checklist screenshots (Section 8a of the report) for /control-tower, /reports analysis cards, /reports drill-through, and the Narrative Insights section. If everything passes visually, mark this build complete.",
    );
  } else if (topIssues.length > 0) {
    const top = topIssues[0]!;
    lines.push(`## Priority #1 (fix first): ${top.title}`);
    lines.push(`- **Location:** ${top.location}`);
    lines.push(`- **Why it matters:** ${top.whyItMatters}`);
    lines.push(`- **What to fix:** ${top.requiredFix}`);
    lines.push(`- **Expected behaviour after fix:** Auditor check \`${top.checkId}\` moves to Pass.`);
    lines.push(`- **Validation:** ${top.verificationMethod}`);
    lines.push("");

    if (topIssues.length > 1) {
      lines.push(`## Then address (in order):`);
      for (const t of topIssues.slice(1)) {
        lines.push(`- #${t.rank} **${t.title}** (${t.severity}) — ${t.requiredFix}`);
      }
      lines.push("");
    }

    const remaining = failures.filter((f) => !topIssues.some((t) => t.checkId === f.id));
    if (remaining.length > 0) {
      lines.push(`## Remaining auditor findings:`);
      for (const f of remaining.sort((a, b) => sevRank(b.severity) - sevRank(a.severity))) {
        lines.push(
          `- ${f.title} (${f.severity}, ${checkStatusLabel(f.status)}) — observed: ${f.observed}`,
        );
      }
      lines.push("");
    }
  }

  lines.push(`## What NOT to break (preserve these working systems):`);
  lines.push("- All customer routes: /control-tower, /reports, /work-orders, /turns, /assets, /properties, /analytics, /alerts, /governance, /documents, /assignments, /workflows, /setup.");
  lines.push("- The build_audits table and /api/build-auditor/{run,history,:id} endpoints.");
  lines.push("- The reporting-analysis service, narrative insights service, and supporting-record drill-through wiring.");
  lines.push("- The auditor page itself at /dev/build-auditor (extend, do not rewrite).");
  lines.push("");

  lines.push(`## Files / routes / components to inspect first:`);
  const surfaces = new Set<string>();
  for (const t of topIssues) surfaces.add(t.location);
  if (surfaces.size === 0) surfaces.add("artifacts/ascent/src/pages/reports.tsx (Visual Proof confirmation)");
  for (const s of surfaces) lines.push(`- ${s}`);
  lines.push("");

  lines.push(`## Validation requirements:`);
  lines.push("- Inspect the current implementation before changing it; preserve working logic.");
  lines.push("- After each fix, re-run /dev/build-auditor and confirm the targeted check IDs move to Pass.");
  lines.push("- Capture the Visual Proof Checklist screenshots for any user-facing change.");
  lines.push("- Do not let backend route existence be treated as feature completion — separate 'route exists' from 'page renders' from 'workflow completes'.");
  lines.push("");

  lines.push(`## Required final report after completion:`);
  lines.push("- Files changed");
  lines.push("- Behaviour added / behaviour preserved");
  lines.push("- Tests performed (auditor run + visual proofs captured)");
  lines.push("- Anything still needing manual verification");
  lines.push("- Confirmation that the previous Top-3 issues now Pass");

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
      bundleExtras: {
        executive: bundle.executive,
        goNoGo: bundle.goNoGo,
        topIssues: bundle.topIssues,
        visualProofs: bundle.visualProofs,
        manualTests: bundle.manualTests,
      },
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
