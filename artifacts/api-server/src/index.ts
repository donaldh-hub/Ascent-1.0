import app from "./app";
import { logger } from "./lib/logger";
import { evaluateAlerts } from "./engine/alerts";
import { startOrchestratorLoop } from "./services/agent-runtime/orchestrator";
import { registerSelfTestAgent } from "./services/agent-runtime/selftest-agent";
import { registerDataIngestionAgent } from "./services/agent-runtime/agents/data-ingestion-agent";
import { registerIntelligenceQualityAgent } from "./services/agent-runtime/agents/intelligence-quality-agent";
import { registerOnboardingAgent } from "./services/agent-runtime/agents/onboarding-agent";
import { registerBillingAgent } from "./services/agent-runtime/agents/billing-agent";
import { registerJordanAgent } from "./services/agent-runtime/agents/jordan-agent";
import { registerCustomerSupportAgent } from "./services/agent-runtime/agents/customer-support-agent";
import { registerInfrastructureAgent, scheduleInitialHealthCheck } from "./services/agent-runtime/agents/infrastructure-agent";
import { registerSecurityAccessAgent, scheduleInitialGrantReview } from "./services/agent-runtime/agents/security-access-agent";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run alert evaluation on startup (non-blocking)
  evaluateAlerts()
    .then((result) => logger.info(result, "Initial alert evaluation complete"))
    .catch((evalErr) => logger.warn({ evalErr }, "Initial alert evaluation failed (non-fatal)"));

  // Register the platform self-test agent and start the shared agent-runtime
  // orchestrator's poll loop (non-blocking) — see .agents/memory or the PR
  // description for the "Ascent 1.0 — Executable Agent Build Specifications"
  // this implements Build-Sequence steps 1-3 of.
  Promise.all([
    registerSelfTestAgent(),
    registerDataIngestionAgent(),
    registerIntelligenceQualityAgent(),
    registerOnboardingAgent(),
    registerBillingAgent(),
    registerJordanAgent(),
    registerCustomerSupportAgent(),
    registerInfrastructureAgent(),
    registerSecurityAccessAgent(),
  ])
    .then(async () => {
      startOrchestratorLoop();
      // Recurring self-scheduling monitors — idempotent against restarts,
      // see each agent's scheduleInitial*() doc comment.
      await Promise.all([scheduleInitialHealthCheck(), scheduleInitialGrantReview()]);
      logger.info(
        "Agent runtime orchestrator started (self-test, data-ingestion, intelligence-quality, onboarding, billing, jordan, customer-support, infrastructure, security-access)",
      );
    })
    .catch((agentErr) => logger.warn({ agentErr }, "Agent runtime startup failed (non-fatal)"));
});
