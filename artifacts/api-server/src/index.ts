import app from "./app";
import { logger } from "./lib/logger";
import { evaluateAlerts } from "./engine/alerts";

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
});
