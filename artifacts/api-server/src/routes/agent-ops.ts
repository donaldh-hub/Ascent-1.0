/**
 * Minimal read/write surface for the agent runtime — the seed of the
 * "Founder Control Center" the spec calls for (job/exception visibility),
 * plus the manual test harness for the platform self-test agent since
 * this environment has no live database to run an automated end-to-end
 * test against (see PR description for the exact curl sequence).
 *
 * Gating note: gated by requireUser for now, same as every other
 * authenticated route. The spec's job descriptions assume a distinct
 * "founder" identity distinct from any hub user — this codebase's access
 * model doesn't have that concept yet. Left as an explicit open item
 * rather than inventing a new auth role unprompted.
 */
import { Router, type IRouter } from "express";
import { requireUser } from "../middleware/user-auth.js";
import { db } from "@workspace/db";
import { agentJobsTable, agentJobAttemptsTable, agentExceptionsTable, agentIncidentsTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { enqueueJob } from "../services/agent-runtime/job-store.js";
import { runDueJobs } from "../services/agent-runtime/orchestrator.js";
import { resolveException, listOpenExceptions } from "../services/agent-runtime/audit.js";
import { SELFTEST_AGENT_ID, type SelfTestMode } from "../services/agent-runtime/selftest-agent.js";
import { getOperatingHealth, getFounderBriefing, recordFounderDecision } from "../services/agent-runtime/agents/chief-operating-agent.js";

const router: IRouter = Router();

router.post("/agent-ops/selftest", requireUser, async (req, res) => {
  try {
    const mode = String(req.body?.mode ?? "succeed") as SelfTestMode;
    if (!["succeed", "fail_then_succeed", "always_fail", "policy_violation"].includes(mode)) {
      res.status(400).json({ error: "mode must be one of: succeed, fail_then_succeed, always_fail, policy_violation" });
      return;
    }
    const job = await enqueueJob({
      agentId: SELFTEST_AGENT_ID,
      triggerEvent: "manual.selftest_requested",
      payload: { mode },
      authorizedUserId: req.user!.id,
    });
    res.status(201).json({ job });
  } catch (err) {
    req.log.error({ err }, "Failed to enqueue self-test job");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Manual tick, since this environment has no live process running the
// setInterval loop during a request-response test cycle — lets a tester
// step the orchestrator forward without waiting for the next poll tick.
router.post("/agent-ops/tick", requireUser, async (req, res) => {
  try {
    const result = await runDueJobs();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to run orchestrator tick");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/agent-ops/jobs", requireUser, async (_req, res) => {
  const jobs = await db.select().from(agentJobsTable).orderBy(desc(agentJobsTable.id)).limit(50);
  res.json({ jobs });
});

router.get("/agent-ops/jobs/:id", requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }
  const [job] = await db.select().from(agentJobsTable).where(eq(agentJobsTable.id, id)).limit(1);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const attempts = await db.select().from(agentJobAttemptsTable).where(eq(agentJobAttemptsTable.jobId, id)).orderBy(agentJobAttemptsTable.id);
  res.json({ job, attempts });
});

router.get("/agent-ops/exceptions", requireUser, async (req, res) => {
  const openOnly = req.query.status !== "all";
  const exceptions = openOnly ? await listOpenExceptions() : await db.select().from(agentExceptionsTable).orderBy(desc(agentExceptionsTable.id));
  res.json({ exceptions });
});

router.post("/agent-ops/exceptions/:id/resolve", requireUser, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid exception id" }); return; }
    const decision = String(req.body?.decision ?? "").trim();
    if (!decision) { res.status(400).json({ error: "decision is required" }); return; }
    const updated = await resolveException(id, decision);
    if (!updated) { res.status(404).json({ error: "Exception not found" }); return; }
    res.json({ exception: updated });
  } catch (err) {
    req.log.error({ err }, "Failed to resolve exception");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Founder Control Center (spec: "Minimum Control Center") ────────────────

router.get("/agent-ops/health", requireUser, async (req, res) => {
  try {
    const health = await getOperatingHealth();
    res.json(health);
  } catch (err) {
    req.log.error({ err }, "Failed to compute operating health");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/agent-ops/briefing", requireUser, async (req, res) => {
  try {
    const briefing = await getFounderBriefing();
    res.json(briefing);
  } catch (err) {
    req.log.error({ err }, "Failed to generate founder briefing");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/agent-ops/incidents", requireUser, async (req, res) => {
  const openOnly = req.query.status !== "all";
  const incidents = openOnly
    ? await db.select().from(agentIncidentsTable).where(eq(agentIncidentsTable.status, "open")).orderBy(desc(agentIncidentsTable.id))
    : await db.select().from(agentIncidentsTable).orderBy(desc(agentIncidentsTable.id));
  res.json({ incidents });
});

router.post("/agent-ops/founder-decisions", requireUser, async (req, res) => {
  try {
    const exceptionId = Number(req.body?.exceptionId);
    const decision = String(req.body?.decision ?? "").trim();
    if (!Number.isFinite(exceptionId) || !decision) {
      res.status(400).json({ error: "exceptionId and decision are required" });
      return;
    }
    const { record, exception } = await recordFounderDecision({ exceptionId, decision, decidedByUserId: req.user!.id });
    if (!exception) {
      res.status(404).json({ error: "Exception not found" });
      return;
    }
    res.json({ record, exception });
  } catch (err) {
    req.log.error({ err }, "Failed to record founder decision");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
