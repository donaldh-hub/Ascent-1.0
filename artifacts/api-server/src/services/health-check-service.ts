import { db } from "@workspace/db";
import { workOrdersTable, assetsTable, propertiesTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface ServiceCheck {
  service: string;
  status: "ok" | "degraded" | "down";
  latencyMs?: number;
  detail?: string;
}

export interface HealthReport {
  status: "healthy" | "degraded" | "down";
  checkedAt: string;
  version: string;
  services: ServiceCheck[];
  databaseConnected: boolean;
  workOrderCount: number;
  assetCount: number;
  propertyCount: number;
}

function readVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
    return pkg.version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}

export async function runHealthCheck(): Promise<HealthReport> {
  const checkedAt = new Date().toISOString();
  const version = readVersion();
  const services: ServiceCheck[] = [];

  let databaseConnected = false;
  let workOrderCount = 0;
  let assetCount = 0;
  let propertyCount = 0;
  let dbStatus: "ok" | "degraded" | "down" = "down";
  let dbLatencyMs: number | undefined;

  try {
    const start = Date.now();
    const [[woRow], [assetRow], [propRow]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable),
      db.select({ count: sql<number>`count(*)::int` }).from(assetsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable),
    ]);
    dbLatencyMs = Date.now() - start;

    workOrderCount = woRow?.count ?? 0;
    assetCount = assetRow?.count ?? 0;
    propertyCount = propRow?.count ?? 0;
    databaseConnected = true;

    if (dbLatencyMs < 200) {
      dbStatus = "ok";
    } else if (dbLatencyMs <= 1000) {
      dbStatus = "degraded";
    } else {
      dbStatus = "degraded";
    }
  } catch (err) {
    dbStatus = "down";
    services.push({
      service: "postgresql",
      status: "down",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  if (databaseConnected) {
    services.push({
      service: "postgresql",
      status: dbStatus,
      latencyMs: dbLatencyMs,
      detail: `work_orders=${workOrderCount}, assets=${assetCount}, properties=${propertyCount}`,
    });
  }

  const overallStatus: "healthy" | "degraded" | "down" =
    !databaseConnected
      ? "down"
      : dbStatus === "ok"
      ? "healthy"
      : "degraded";

  return {
    status: overallStatus,
    checkedAt,
    version,
    services,
    databaseConnected,
    workOrderCount,
    assetCount,
    propertyCount,
  };
}
