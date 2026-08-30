/**
 * Customer-support case intake — opens a support_cases row and enqueues
 * the Customer-Support Agent to work it. See customer-support-agent.ts
 * for what's actually automated today (login-link resend, upload-failure
 * diagnostics) versus escalated to a human.
 */
import { Router, type IRouter } from "express";
import { requireUser } from "../middleware/user-auth.js";
import { db } from "@workspace/db";
import { supportCasesTable, SUPPORT_CASE_CATEGORIES } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { enqueueJob } from "../services/agent-runtime/job-store.js";
import { CUSTOMER_SUPPORT_AGENT_ID } from "../services/agent-runtime/agents/customer-support-agent.js";

const router: IRouter = Router();

router.post("/support/cases", requireUser, async (req, res) => {
  try {
    const category = String(req.body?.category ?? "other");
    const description = String(req.body?.description ?? "").trim();
    if (!description) {
      res.status(400).json({ error: "description is required" });
      return;
    }
    if (!(SUPPORT_CASE_CATEGORIES as readonly string[]).includes(category)) {
      res.status(400).json({ error: `category must be one of: ${SUPPORT_CASE_CATEGORIES.join(", ")}` });
      return;
    }

    const [supportCase] = await db
      .insert(supportCasesTable)
      .values({ userId: req.user!.id, category, description })
      .returning();

    await enqueueJob({
      agentId: CUSTOMER_SUPPORT_AGENT_ID,
      triggerEvent: "support_request_submitted",
      payload: { caseId: supportCase.id },
      authorizedUserId: req.user!.id,
      organizationId: req.user!.hubId,
    });

    res.status(201).json({ case: supportCase });
  } catch (err) {
    req.log.error({ err }, "Failed to open support case");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/support/cases", requireUser, async (req, res) => {
  const cases = await db
    .select()
    .from(supportCasesTable)
    .where(eq(supportCasesTable.userId, req.user!.id))
    .orderBy(desc(supportCasesTable.id));
  res.json({ cases });
});

export default router;
