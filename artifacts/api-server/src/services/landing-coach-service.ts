import Anthropic from "@anthropic-ai/sdk";
import { RIVERSIDE_COMMONS } from "../data/riverside-commons-mock.js";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const FALLBACK_ANSWER =
  "I'm not able to chat live right now, but here's what stands out in this demo: Unit A-12's turn has stalled for 9 days, and Unit B-07 has 3 HVAC service calls in 60 days with no warranty on file. Upload your own report to see what your data shows — it's free.";

function buildSystemPrompt(): string {
  return `You are the Ascent Operations Coach. You are showing a website visitor a demo site called "${RIVERSIDE_COMMONS.siteName}" — a manufactured, clearly-labeled example of a realistic 48-unit residential property. This is demo data, never a real customer's site — never claim otherwise.

Here is the full data you have access to for this demo site. Answer only from this data:

${JSON.stringify(RIVERSIDE_COMMONS, null, 2)}

Rules:
- Answer questions about this demo data honestly and specifically, citing the records you were given.
- If asked about the visitor's own site, or anything not present in the data above, do NOT invent an answer. Tell them the only way to know is to upload their own work order report — it's free, with no time limit on viewing results — and point them to /onboarding.
- Never present this mock data as belonging to a real customer.
- Keep responses short and conversational: 2-4 sentences, plain operational language, no jargon.`;
}

export async function askLandingCoach(
  question: string,
  history: ChatMessage[] = []
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return FALLBACK_ANSWER;
  }

  try {
    const client = new Anthropic({
      apiKey,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: buildSystemPrompt(),
      messages: [...history, { role: "user", content: question }],
    });

    const textBlock = response.content.find((block: { type: string }) => block.type === "text");
    return textBlock && "text" in textBlock ? textBlock.text : FALLBACK_ANSWER;
  } catch {
    return FALLBACK_ANSWER;
  }
}
