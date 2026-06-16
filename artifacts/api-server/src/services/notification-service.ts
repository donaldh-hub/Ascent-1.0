import { db } from "@workspace/db";
import { assetsTable, workOrdersTable } from "@workspace/db/schema";
import { sql, isNotNull } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface Notification {
  notificationId: string;
  type: "warranty_expiring" | "high_risk_asset" | "coach_insight" | "upload_reminder" | "data_gap";
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
  createdAt: string;
  dismissed?: boolean;
}

export async function getActiveNotifications(): Promise<Notification[]> {
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const notifications: Notification[] = [];

  // ── Warranty expiring within 30 days ────────────────────────────────────
  const expiringAssets = await db
    .select({ id: assetsTable.id, name: assetsTable.name, warrantyExpiration: assetsTable.warrantyExpiration })
    .from(assetsTable)
    .where(sql`${assetsTable.warrantyExpiration} is not null`);

  const expiringSoon = expiringAssets.filter((a) => {
    if (!a.warrantyExpiration) return false;
    const exp = new Date(a.warrantyExpiration);
    return !isNaN(exp.getTime()) && exp >= now && exp <= thirtyDaysOut;
  });

  if (expiringSoon.length > 0) {
    const names = expiringSoon
      .slice(0, 3)
      .map((a) => a.name)
      .join(", ");
    const extra = expiringSoon.length > 3 ? ` and ${expiringSoon.length - 3} more` : "";
    notifications.push({
      notificationId: randomUUID(),
      type: "warranty_expiring",
      severity: "warning",
      title: `${expiringSoon.length} warranty${expiringSoon.length > 1 ? "ies" : "y"} expiring within 30 days`,
      body: `${names}${extra} — file claims before expiry to protect your investment.`,
      actionLabel: "View Assets",
      actionHref: "/assets",
      createdAt: now.toISOString(),
    });
  }

  // ── High-risk assets ─────────────────────────────────────────────────────
  const highRiskAssets = await db
    .select({ id: assetsTable.id, name: assetsTable.name, stoplight: assetsTable.stoplight, healthScore: assetsTable.healthScore })
    .from(assetsTable)
    .where(sql`${assetsTable.stoplight} = 'red' or ${assetsTable.healthScore} < 30`);

  if (highRiskAssets.length > 0) {
    const names = highRiskAssets
      .slice(0, 3)
      .map((a) => a.name)
      .join(", ");
    const extra = highRiskAssets.length > 3 ? ` and ${highRiskAssets.length - 3} more` : "";
    notifications.push({
      notificationId: randomUUID(),
      type: "high_risk_asset",
      severity: "critical",
      title: `${highRiskAssets.length} high-risk asset${highRiskAssets.length > 1 ? "s" : ""} need attention`,
      body: `${names}${extra} — red stoplight or health score below 30. Immediate review recommended.`,
      actionLabel: "View Assets",
      actionHref: "/assets",
      createdAt: now.toISOString(),
    });
  }

  // ── Upload reminder — no WOs in last 14 days ─────────────────────────────
  const [recentUploadRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.importedAt} >= ${fourteenDaysAgo.toISOString()}`);

  const recentUploads = recentUploadRow?.count ?? 0;

  if (recentUploads === 0) {
    notifications.push({
      notificationId: randomUUID(),
      type: "upload_reminder",
      severity: "info",
      title: "No work order data uploaded in 14 days",
      body: "Weekly uploads keep your Operations Coach and analytics current. Upload your latest work order export to stay on top of trends.",
      actionLabel: "Upload Data",
      actionHref: "/upload",
      createdAt: now.toISOString(),
    });
  }

  // ── Data gap — very few WOs ───────────────────────────────────────────────
  const [totalCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable);

  const totalWOs = totalCountRow?.count ?? 0;

  if (totalWOs < 10) {
    notifications.push({
      notificationId: randomUUID(),
      type: "data_gap",
      severity: "warning",
      title: "Insufficient data for reliable analysis",
      body: `Only ${totalWOs} work order${totalWOs !== 1 ? "s" : ""} in the system. Upload at least 50 to unlock the Operations Coach and full analytics.`,
      actionLabel: "Upload Data",
      actionHref: "/upload",
      createdAt: now.toISOString(),
    });
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  notifications.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return notifications;
}
