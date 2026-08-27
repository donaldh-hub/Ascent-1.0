/**
 * Jordan's tool-calling conversation loop. See
 * .agents/memory/jordan-interactive-coach.md for the full design
 * rationale — the short version: Jordan never free-generates a concrete
 * claim. Every fact in a response must come from a tool call result. The
 * model's job is to pick tools, call them, and narrate what came back —
 * not to answer from what it "knows" about the data.
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import { jordanConversationsTable, jordanMessagesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  listAccessibleSites,
  getWorkOrderSummary,
  getTurnSummary,
  getImpactAndTrends,
} from "./jordan-tools.js";

const SYSTEM_PROMPT = `You are Jordan, the operations coach inside Ascent 1.0.

Your role: Ascent is the coach outside the boxing ring. The maintenance team is inside the ring, too close to the action to see everything. You watch the whole fight and give the manager clear, evidence-backed guidance: what you're seeing, why it matters, the records that prove it, and what to examine next.

You are NOT a dispatcher or maintenance supervisor. You never say things like "I completed that work order" or issue commands. You say things like: "This unit has generated four plumbing-related work orders in 60 days. Three were closed without a documented cause. Before treating the latest request as isolated, review the repair history..." — evidence, a pattern, and a pointed question back to the human.

Hard rule: you have tools that query the real system. You must call a tool to get any concrete number, count, or fact before stating it. Never state a specific count, percentage, or record detail that didn't come from a tool result in this conversation. If a question needs data you don't have a tool for, say so plainly rather than estimating or inventing a plausible-sounding answer. If a question is ambiguous (e.g. which site), ask a clarifying question or call list_accessible_sites first.

Keep responses concise and grounded. Cite what the tool actually returned.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_accessible_sites",
    description: "List the sites (properties) this user has access to, with their IDs and names. Use this to resolve a site name mentioned by the user to a site ID, or when the user hasn't specified a site.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_work_order_summary",
    description: "Get work order counts for a site or across all accessible sites: total open, SLA violations, work orders aging over 7 days, and blocked work orders.",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "number", description: "The site's ID from list_accessible_sites. Omit to get totals across all accessible sites." },
      },
    },
  },
  {
    name: "get_turn_summary",
    description: "Get turn (unit make-ready) counts for a site or across all accessible sites: total, active, blocked, in rework, not rent-ready, and near completion (active turns at or above 80% complete).",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "number", description: "The site's ID from list_accessible_sites. Omit to get totals across all accessible sites." },
      },
    },
  },
  {
    name: "get_impact_and_trends",
    description: "Get a deeper diagnostic view for a site or across all accessible sites: which records are stale, aging, or missing evidence (impact snapshot), and category/property trend patterns over the last 30 days. Use this for 'why is my score low' or 'how do I improve X' questions.",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "number", description: "The site's ID from list_accessible_sites. Omit to get totals across all accessible sites." },
      },
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>, accessibleSiteIds: number[]) {
  const siteId = typeof input.siteId === "number" ? input.siteId : undefined;
  switch (name) {
    case "list_accessible_sites":
      return listAccessibleSites(accessibleSiteIds);
    case "get_work_order_summary":
      return getWorkOrderSummary(accessibleSiteIds, siteId);
    case "get_turn_summary":
      return getTurnSummary(accessibleSiteIds, siteId);
    case "get_impact_and_trends":
      return getImpactAndTrends(accessibleSiteIds, siteId);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export class JordanNotConfiguredError extends Error {
  constructor() {
    super("Jordan's conversational mode isn't configured yet — no API key is set for the underlying model.");
    this.name = "JordanNotConfiguredError";
  }
}

async function getOrCreateConversation(userId: number, conversationId?: number) {
  if (conversationId) {
    const [existing] = await db
      .select()
      .from(jordanConversationsTable)
      .where(eq(jordanConversationsTable.id, conversationId))
      .limit(1);
    if (existing && existing.userId === userId) return existing;
  }
  const [created] = await db.insert(jordanConversationsTable).values({ userId }).returning();
  return created;
}

async function loadHistory(conversationId: number): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select()
    .from(jordanMessagesTable)
    .where(eq(jordanMessagesTable.conversationId, conversationId))
    .orderBy(jordanMessagesTable.id);
  return rows.map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.content,
  }));
}

export async function sendJordanMessage({
  userId,
  accessibleSiteIds,
  conversationId,
  message,
}: {
  userId: number;
  accessibleSiteIds: number[];
  conversationId?: number;
  message: string;
}): Promise<{ conversationId: number; reply: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new JordanNotConfiguredError();

  const conversation = await getOrCreateConversation(userId, conversationId);
  const history = await loadHistory(conversation.id);

  await db.insert(jordanMessagesTable).values({
    conversationId: conversation.id,
    role: "user",
    content: message,
  });

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: message }];
  const toolCallLog: { name: string; input: unknown; result: unknown }[] = [];

  // Tool-calling loop: keep going while the model asks for tools, stop once
  // it returns a final text-only response. Capped to avoid a runaway loop.
  for (let turn = 0; turn < 6; turn++) {
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      const reply = textBlock?.text ?? "I wasn't able to put together a response — try asking again.";

      await db.insert(jordanMessagesTable).values({
        conversationId: conversation.id,
        role: "assistant",
        content: reply,
        toolCalls: toolCallLog,
      });
      await db
        .update(jordanConversationsTable)
        .set({ updatedAt: new Date() })
        .where(eq(jordanConversationsTable.id, conversation.id));

      return { conversationId: conversation.id, reply };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await runTool(block.name, block.input as Record<string, unknown>, accessibleSiteIds);
      toolCallLog.push({ name: block.name, input: block.input, result });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const fallback = "I'm having trouble narrowing this down — could you rephrase or be more specific about which site?";
  await db.insert(jordanMessagesTable).values({
    conversationId: conversation.id,
    role: "assistant",
    content: fallback,
    toolCalls: toolCallLog,
  });
  return { conversationId: conversation.id, reply: fallback };
}
