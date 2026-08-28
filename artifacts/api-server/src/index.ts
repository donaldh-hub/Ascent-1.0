import app from "./app";
import { logger } from "./lib/logger";
import { evaluateAlerts } from "./engine/alerts";
import { startOrchestratorLoop } from "./services/agent-runtime/orchestrator";
import { registerSelfTestAgent } from "./services/agent-runtime/selftest-agent";

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
  registerSelfTestAgent()
    .then(() => {
      startOrchestratorLoop();
      logger.info("Agent runtime orchestrator started");
    })
    .catch((agentErr) => logger.warn({ agentErr }, "Agent runtime startup failed (non-fatal)"));
});
