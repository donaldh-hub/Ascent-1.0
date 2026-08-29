/**
 * Lead intake + manual conversion. See sales-agent.ts for what's
 * automated (qualification, quoting) versus deliberately not (checkout/
 * conversion — no real payment processor exists yet).
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { requireUser } from "../middleware/user-auth.js";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { enqueueJob } from "../services/agent-runtime/job-store.js";
import { SALES_AGENT_ID } from "../services/agent-runtime/agents/sales-agent.js";
import { logAgentAction } from "../services/agent-runtime/audit.js";
import { subscribe } from "../services/account-status-service.js";

const router: IRouter = Router();

// Unauthenticated by design — a lead, by definition, doesn't have an
// account yet. Matches the existing pre-account trial pattern
// (/onboarding, /work-orders/import) rather than inventing a new
// no-login-required convention.
router.post("/sales/leads", async (req, res) => {
  try {
    const organizationName = String(req.body?.organizationName ?? "").trim();
    const contactEmail = String(req.body?.contactEmail ?? "").trim().toLowerCase();
    const siteCount = Number(req.body?.siteCount ?? 0);
    if (!organizationName || !contactEmail) {
      res.status(400).json({ error: "organizationName and contactEmail are required" });
      return;
    }

    const [lead] = await db
      .insert(leadsTable)
      .values({
        organizationName,
        contactName: req.body?.contactName ? String(req.body.contactName) : null,
        contactEmail,
        siteCount: Number.isFinite(siteCount) ? siteCount : 0,
        reportAvailability: req.body?.reportAvailability ? String(req.body.reportAvailability) : null,
        painDescription: req.body?.painDescription ? String(req.body.painDescription) : null,
        decisionRole: req.body?.decisionRole ? String(req.body.decisionRole) : null,
      })
      .returning();

    await enqueueJob({
      agentId: SALES_AGENT_ID,
      triggerEvent: "lead.submitted",
      payload: { leadId: lead.id },
    });

    res.status(201).json({ lead });
  } catch (err) {
    req.log.error({ err }, "Failed to create lead");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/sales/leads", requireUser, async (req, res) => {
  if (!req.user!.canManageAccess) {
    res.status(403).json({ error: "You do not have permission to view leads." });
    return;
  }
  const leads = await db.select().from(leadsTable).orderBy(desc(leadsTable.id));
  res.json({ leads });
});

// Manual, explicit, human-triggered conversion — the Sales Agent never
// calls this itself. Gated by canManageAccess as the closest existing
// proxy for "founder/admin" (this access model has no distinct founder
// role yet — same open item flagged elsewhere in this build).
router.post("/sales/leads/:id/convert", requireUser, async (req, res) => {
  try {
    if (!req.user!.canManageAccess) {
      res.status(403).json({ error: "You do not have permission to convert leads." });
      return;
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lead id" });
      return;
    }
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id)).limit(1);
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (lead.status !== "quoted") {
      res.status(400).json({ error: `Lead must be in "quoted" status to convert (current: "${lead.status}")` });
      return;
    }

    const updatedAccount = await subscribe();
    const [updatedLead] = await db
      .update(leadsTable)
      .set({ status: "converted", convertedAt: new Date() })
      .where(eq(leadsTable.id, id))
      .returning();

    await logAgentAction({
      agentId: SALES_AGENT_ID,
      correlationId: randomUUID(),
      action: "subscription.converted",
      input: { leadId: id, convertedByUserId: req.user!.id },
      output: { accountStatusId: updatedAccount.id },
    });

    res.json({ lead: updatedLead });
  } catch (err) {
    req.log.error({ err }, "Failed to convert lead");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
