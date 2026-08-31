/**
 * Jordan's one-shot summary of a report upload. This is not the
 * interactive conversation (see jordan-chat-service.ts) — it's a single
 * grounded synthesis, generated automatically right after an upload
 * finishes ingesting, so the customer gets more than numbers moving on
 * the Control Tower cards: a plain-language explanation of what the
 * upload reveals and the top three things to look at first.
 *
 * Grounding works the same way as the interactive coach: the model never
 * invents a number. It's handed the exact tool results jordan-tools.ts
 * already produces for the properties this batch touched, and asked to
 * explain and prioritize — not to fetch anything itself.
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import { jordanIngestionSummariesTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { getWorkOrderSummary, getTurnSummary, getImpactAndTrends } from "./jordan-tools.js";

export class IngestionSummaryNotConfiguredError extends Error {
  constructor() {
    super("Jordan's ingestion summary isn't configured yet — no API key is set for the underlying model.");
    this.name = "IngestionSummaryNotConfiguredError";
  }
}

export interface JordanIngestionSummaryResult {
  headline: string;
  recommendations: string[];
}

const SYSTEM_PROMPT = `You are Jordan, the operations coach inside Ascent 1.0.

Your role: Ascent is the coach outside the boxing ring. The maintenance team is inside the ring, too close to the action to see everything. You watch the whole fight and give the manager clear, evidence-backed guidance.

A customer just uploaded a report. You're being given the real, grounded results of that upload — work order counts, turn counts, and impact/trend data pulled directly from the system. Your job is to explain what this upload reveals in plain language a property manager or maintenance supervisor can understand without being a data analyst, a software engineer, or a reporting specialist. Don't just restate the numbers — say what they mean and why it matters.

Hard rule: only use the numbers and facts given to you in this message. Never invent, estimate, or round a figure that wasn't in the data provided.

You are NOT a dispatcher or maintenance supervisor. Never say things like "I completed that work order" or issue commands. Point to evidence, name the pattern, and hand back a question or a next step for the human to examine — coaching through intelligence, not task management.

Call record_ingestion_summary exactly once with your headline and exactly three recommendations.`;

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_ingestion_summary",
  description: "Record the headline explanation and top three recommendations for this upload.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "1-3 sentences of plain-language explanation of what this upload reveals overall, for someone who isn't a data analyst.",
      },
      recommendations: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
        description: "Exactly three evidence-backed recommendations, each naming what to examine and why, in Jordan's coaching voice.",
      },
    },
    required: ["headline", "recommendations"],
  },
};

export async function generateIngestionSummary(params: {
  batchId: string;
  propertyIds: number[];
}): Promise<JordanIngestionSummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new IngestionSummaryNotConfiguredError();

  const scope = params.propertyIds;
  const [workOrders, turns, impactAndTrends] = await Promise.all([
    getWorkOrderSummary(scope),
    getTurnSummary(scope),
    getImpactAndTrends(scope),
  ]);

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool", name: "record_ingestion_summary" },
    messages: [
      {
        role: "user",
        content: `Grounded data from the report just uploaded, scoped to the properties it touched:\n\nWork orders: ${JSON.stringify(workOrders)}\n\nTurns: ${JSON.stringify(turns)}\n\nImpact & trends: ${JSON.stringify(impactAndTrends)}`,
      },
    ],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Jordan did not return a summary for this upload.");

  const input = toolUse.input as { headline: string; recommendations: string[] };

  const [saved] = await db
    .insert(jordanIngestionSummariesTable)
    .values({
      batchId: params.batchId,
      propertyIds: params.propertyIds,
      headline: input.headline,
      recommendations: input.recommendations,
    })
    .returning();

  return { headline: saved.headline, recommendations: saved.recommendations as string[] };
}

export async function getLatestIngestionSummary() {
  const rows = await db
    .select()
    .from(jordanIngestionSummariesTable)
    .orderBy(desc(jordanIngestionSummariesTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
