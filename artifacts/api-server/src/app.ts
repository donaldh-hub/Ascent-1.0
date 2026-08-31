import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./middleware/session";
import { userAuthMiddleware } from "./middleware/user-auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Express's own default (100kb) is too small for this app's real workload —
// a single real-world work order report easily produces a JSON body over
// that (confirmed: a 269-row real customer report is ~120kb) — silently
// rejected before ever reaching a route's own error handling, surfacing to
// the client as an unparseable non-JSON response instead of a clear error.
// inbound-email.ts already carries its own even larger route-specific
// override for the same reason; this raises the shared default so every
// JSON-body route (starting with /work-orders/import) isn't tripped by the
// same limit as new, larger customer data comes through.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(userAuthMiddleware);

app.use("/api", router);

// Last-resort error handler: without this, an error raised before a route's
// own try/catch runs (e.g. a body-parsing failure) falls through to
// Express's default HTML error page — unparseable by any client expecting
// JSON, which is exactly what silently turned a too-large request body into
// a generic "Unknown error" toast instead of a clear message. This ensures
// every error response from this API is valid JSON.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; statusCode?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? err.statusCode ?? 500;
  req.log?.error({ err }, "Unhandled error");
  res.status(status).json({ error: err.message || "Internal server error" });
});

export default app;
