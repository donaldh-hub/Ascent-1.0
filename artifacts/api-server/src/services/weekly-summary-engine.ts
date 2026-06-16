import { db } from "@workspace/db";
import { workOrdersTable, coachWeeklySummariesTable } from "@workspace/db/schema";
import { sql, desc } from "drizzle-orm";
import { scoreConvergence } from "./convergence-scorer.js";
import { getOrCreatePreferences } from "./coach-preference-service.js";

export interface DataGapPrompt {
  gapType: string;
  prompt: string;
  benefit: string;
}

export interface PatternWatchItem {
  patternId: string;
  description: string;
  weeksSeen: number;
  trend: "increasing" | "stable" | "decreasing";
}

export interface WatchListItem {
  itemId: string;
  description: string;
  pillar: string;
}

export interface WeeklySummary {
  coachName: string;
  communicationStyle: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  workOrderCount: number;
  convergenceFlags: object[];
  pillarSummaries: {
    work_orders: { totalOpen: number; openedThisWeek: number; closedThisWeek: number; aging: number; topCategory: string | null; narrative: string };
    turns: { narrative: string };
    compliance: { narrative: string };
    pm_warranty: { repeatIssueAssets: number; narrative: string };
  };
  patternWatch: PatternWatchItem[];
  oneRecommendation: string;
  watchList: WatchListItem[];
  dataGapPrompts: DataGapPrompt[];
  openingStatement: string;
  closingQuestion: string;
}

export async function generateWeeklySummary(): Promise<WeeklySummary> {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [prefs, convergence] = await Promise.all([getOrCreatePreferences(), scoreConvergence()]);
  const coachName = prefs.coachName;
  const style = prefs.communicationStyle;

  const [[totalRow], [openRow], [openedRow], [closedRow], [agingRow]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable),
    db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable).where(sql`status in ('submitted','assigned','in_progress')`),
    db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable).where(sql`${workOrdersTable.createdAt} >= ${sevenDaysAgo.toISOString()}::timestamp`),
    db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable).where(sql`status = 'completed' and ${workOrdersTable.updatedAt} >= ${sevenDaysAgo.toISOString()}::timestamp`),
    db.select({ count: sql<number>`count(*)::int` }).from(workOrdersTable).where(sql`status in ('submitted','assigned','in_progress') and ${workOrdersTable.createdAt} < ${fourteenDaysAgo.toISOString()}::timestamp`),
  ]);

  const workOrderCount = totalRow?.count ?? 0;
  const totalOpen = openRow?.count ?? 0;
  const openedThisWeek = openedRow?.count ?? 0;
  const closedThisWeek = closedRow?.count ?? 0;
  const aging = agingRow?.count ?? 0;

  const categoryRows = await db
    .select({ category: workOrdersTable.category, count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`category is not null`)
    .groupBy(workOrdersTable.category)
    .orderBy(sql`count(*) desc`)
    .limit(1);
  const topCategory = categoryRows[0]?.category ?? null;

  const repeatAssetRows = await db
    .select({ assetId: workOrdersTable.assetId, count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.assetId} is not null`)
    .groupBy(workOrdersTable.assetId)
    .having(sql`count(*) >= 3`);
  const repeatIssueAssets = repeatAssetRows.length;

  const [closedNoNotesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`status = 'completed' and (notes is null or notes = '')`);
  const closedNoNotes = closedNoNotesRow?.count ?? 0;

  // WO narrative — speaks like a person, not a report
  let woNarrative: string;
  if (workOrderCount === 0) {
    woNarrative = "I don't have any work orders to work with yet. Upload your export and I'll have a full picture for you.";
  } else if (style === "narrative") {
    woNarrative = `You have ${totalOpen} work orders open right now. ${openedThisWeek} came in this week and ${closedThisWeek} were closed. ${aging > 0 ? `${aging} have been open more than 14 days — those need attention before they become a bigger conversation.` : "Nothing is aging past 14 days, which is good."} ${topCategory ? `${topCategory.charAt(0).toUpperCase() + topCategory.slice(1)} is your highest-volume category.` : ""}`.trim();
  } else {
    woNarrative = [
      `${totalOpen} open`,
      `${openedThisWeek} new this week · ${closedThisWeek} closed`,
      aging > 0 ? `${aging} aging past 14 days` : "None aging past 14 days",
      topCategory ? `Top category: ${topCategory}` : null,
    ].filter(Boolean).join("\n");
  }

  const pmNarrative = repeatIssueAssets === 0
    ? "No repeat issue patterns detected yet."
    : style === "narrative"
    ? `I'm seeing ${repeatIssueAssets} asset${repeatIssueAssets > 1 ? "s" : ""} with three or more work orders on record. That's the kind of pattern that typically means you're repairing when you should be replacing — or the asset is telling you something the work orders haven't fully explained yet.`
    : `${repeatIssueAssets} asset(s) with 3+ work orders — potential repeat issue pattern`;

  // Data gap prompts — coaching, not criticism
  const dataGapPrompts: DataGapPrompt[] = [];
  if (closedNoNotes >= 3) {
    dataGapPrompts.push({
      gapType: "missing_closure_notes",
      prompt: `${closedNoNotes} completed work orders don't have resolution notes.`,
      benefit: "The more detail your team adds before closing a WO — what was done, what was found, what parts were used — the better I can spot when a recurring issue is becoming a system failure.",
    });
  }
  if (repeatIssueAssets > 0) {
    dataGapPrompts.push({
      gapType: "warranty_records",
      prompt: "Upload warranty documents for assets with repeat work orders.",
      benefit: "I'll be able to tell you whether future repair calls should go to the manufacturer first — and flag when a repair cost has exceeded what replacement would cost.",
    });
  }

  // One recommendation — highest impact, not a list
  let oneRecommendation: string;
  if (convergence.flags.length > 0) {
    const top = convergence.flags[0];
    oneRecommendation = `Review ${top.propertyName ? `the situation at ${top.propertyName}` : "the flagged unit above"} before your next contractor dispatch. It's showing up across multiple operational areas at once and a coordinated response will cost less than three separate calls.`;
  } else if (aging >= 3) {
    oneRecommendation = `Chase down the ${aging} work orders that have been open more than 14 days. Pick up the phone on those before they become a tenant complaint or an owner question.`;
  } else if (closedNoNotes >= 10) {
    oneRecommendation = `Ask your team to add resolution notes to the ${closedNoNotes} completed work orders that are currently blank. I'll be able to give you much sharper pattern analysis once those records are complete.`;
  } else if (workOrderCount === 0) {
    oneRecommendation = "Upload your latest work order data. That's the one thing that unlocks everything else.";
  } else {
    oneRecommendation = "Your operational picture looks stable this week. Keep the upload cadence going — the picture gets sharper every week.";
  }

  const patternWatch: PatternWatchItem[] = [];
  if (repeatIssueAssets >= 2) {
    patternWatch.push({ patternId: "repeat_asset_issues", description: `${repeatIssueAssets} assets with 3+ work orders — I'm watching whether this is isolated or spreading across the portfolio.`, weeksSeen: 1, trend: "stable" });
  }

  const watchList: WatchListItem[] = [];
  if (aging > 0) watchList.push({ itemId: "aging_work_orders", description: `${aging} work order(s) aging past 14 days`, pillar: "work_orders" });
  if (repeatIssueAssets > 0) watchList.push({ itemId: "repeat_assets", description: `${repeatIssueAssets} asset(s) with 3+ work orders`, pillar: "pm_warranty" });

  const openingStatement = workOrderCount === 0
    ? `Here's your weekly summary from ${coachName}. I'm working from a clean slate right now — upload your first data and I'll have something real to show you.`
    : `Here's your weekly summary from ${coachName}. I'm working from ${workOrderCount} work orders across your properties.${convergence.flags.length > 0 ? " Before I get into the full breakdown, I need to flag something that cuts across multiple areas." : ""}`;

  const summary: WeeklySummary = {
    coachName,
    communicationStyle: style,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    generatedAt: now.toISOString(),
    workOrderCount,
    convergenceFlags: convergence.flags,
    pillarSummaries: {
      work_orders: { totalOpen, openedThisWeek, closedThisWeek, aging, topCategory, narrative: woNarrative },
      turns: { narrative: "Turn data activates when make-ready records are uploaded. Upload your turn history to see vacancy timelines and delay patterns." },
      compliance: { narrative: "Compliance tracking activates when inspection and certification records are uploaded." },
      pm_warranty: { repeatIssueAssets, narrative: pmNarrative },
    },
    patternWatch,
    oneRecommendation,
    watchList: watchList.slice(0, 3),
    dataGapPrompts,
    openingStatement,
    closingQuestion: "Does any of this match what you've been seeing on the ground? And is there anything you want me to dig into further?",
  };

  try {
    await db.insert(coachWeeklySummariesTable).values({
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      convergenceFlags: convergence.flags,
      pillarSummaries: summary.pillarSummaries as object,
      patternWatch,
      oneRecommendation,
      watchList: watchList as object[],
      workOrderCount,
      dataGapPrompts,
      rawSummaryJson: summary as unknown as object,
    });
  } catch {
    // persistence failure doesn't break the summary
  }

  return summary;
}

export async function getLastWeeklySummary() {
  const rows = await db.select().from(coachWeeklySummariesTable).orderBy(desc(coachWeeklySummariesTable.generatedAt)).limit(1);
  return rows[0] ?? null;
}
