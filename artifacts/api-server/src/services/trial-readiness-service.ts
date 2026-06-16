import { db } from "@workspace/db";
import { workOrdersTable, propertiesTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

export interface TrialReadinessReport {
  dataScore: number;
  uploadCount: number;
  workOrderCount: number;
  propertyCount: number;
  hasEnoughData: boolean;
  recommendation: string;
  nextStep: "upload_more" | "explore_reports" | "ready_to_convert";
  coachUnlockThreshold: number;
  coachUnlocked: boolean;
}

export async function assessTrialReadiness(): Promise<TrialReadinessReport> {
  const [woResult, propResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable),
    db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable),
  ]);

  const workOrderCount = woResult[0]?.count ?? 0;
  const propertyCount = propResult[0]?.count ?? 0;

  const COACH_THRESHOLD = 50;
  const coachUnlocked = workOrderCount >= COACH_THRESHOLD;

  // Score: 0-100 based on data volume
  const dataScore = Math.min(100, Math.round((workOrderCount / 200) * 100));
  const hasEnoughData = workOrderCount >= 30;

  let nextStep: "upload_more" | "explore_reports" | "ready_to_convert";
  let recommendation: string;

  if (workOrderCount === 0) {
    nextStep = "upload_more";
    recommendation = "Upload your first work order report to get started. A CSV export from your work order system works best.";
  } else if (workOrderCount < 30) {
    nextStep = "upload_more";
    recommendation = `You have ${workOrderCount} work orders. Upload at least 30 to unlock your first analysis. Weekly uploads build the most accurate picture.`;
  } else if (!coachUnlocked) {
    nextStep = "explore_reports";
    recommendation = `You have enough data to explore reports. Upload ${COACH_THRESHOLD - workOrderCount} more work orders to unlock the Operations Coach.`;
  } else {
    nextStep = "ready_to_convert";
    recommendation = "Your Operations Coach is active. Upgrade to compare across hubs and unlock advanced portfolio insights.";
  }

  return {
    dataScore,
    uploadCount: 0, // import_runs tracking not yet wired
    workOrderCount,
    propertyCount,
    hasEnoughData,
    recommendation,
    nextStep,
    coachUnlockThreshold: COACH_THRESHOLD,
    coachUnlocked,
  };
}
