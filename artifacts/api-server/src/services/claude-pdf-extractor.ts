/**
 * AI-assisted work order extraction — the fallback path for a report PDF
 * that doesn't match any known, deterministic parser (see
 * pdf-report-registry.ts). A known format (Yardi today) always uses the
 * free, exact regex parser; this only runs when that recognizes nothing.
 *
 * Costs a small amount per call (a real Anthropic API request) — this
 * fallback is deliberately opt-in at the registry level, not silently
 * invoked, per the explicit go-ahead on that cost.
 *
 * Hard rule, matching every other agent in this build: never invent a
 * fact. The model is instructed to extract only what is literally present
 * in the text and to omit a field rather than guess it — this is
 * structured extraction, not summarization or inference.
 */
import Anthropic from "@anthropic-ai/sdk";

export class PdfExtractionNotConfiguredError extends Error {
  constructor() {
    super("AI-assisted report extraction isn't configured yet — no API key is set for the underlying model.");
    this.name = "PdfExtractionNotConfiguredError";
  }
}

const SYSTEM_PROMPT = `You extract structured work order records from property-management report text of an unfamiliar format. Extract ONLY information literally present in the text — never infer, guess, estimate, or fill in a value that is not stated. If a field is not present for a record, omit that field entirely rather than inventing a plausible value. Every work order must have at least a work order identifier and a property/site identifier (a name, code, or address that distinguishes it from other properties in the same report) — skip any record you cannot confidently attribute to a specific work order and a specific property.`;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_work_orders",
  description: "Record every distinct work order found in the report text.",
  input_schema: {
    type: "object",
    properties: {
      workOrders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            work_order_id: { type: "string", description: "The work order's own ID/number exactly as printed." },
            property_name: { type: "string", description: "The property/site name or code this work order belongs to, exactly as printed." },
            unit_number: { type: "string", description: "The unit/apartment number, if stated." },
            category: { type: "string", description: "The issue category or type, if stated." },
            description: { type: "string", description: "The reported problem, verbatim or near-verbatim from the text." },
            status: { type: "string", description: "The work order's status, if stated." },
            created_date: { type: "string", description: "When the work order was opened/called in, if stated." },
            scheduled_date: { type: "string", description: "When work was scheduled, if stated." },
            completed_date: { type: "string", description: "When the work order was completed/closed, if stated." },
            notes: { type: "string", description: "Resolution or technician notes, if stated." },
          },
          required: ["work_order_id", "property_name"],
        },
      },
    },
    required: ["workOrders"],
  },
};

interface RawExtractedWorkOrder {
  work_order_id?: unknown;
  property_name?: unknown;
  unit_number?: unknown;
  category?: unknown;
  description?: unknown;
  status?: unknown;
  created_date?: unknown;
  scheduled_date?: unknown;
  completed_date?: unknown;
  notes?: unknown;
}

const OPTIONAL_FIELDS = [
  "unit_number",
  "category",
  "description",
  "status",
  "created_date",
  "scheduled_date",
  "completed_date",
  "notes",
] as const;

export async function extractWorkOrdersWithClaude(documentText: string): Promise<{ rows: Record<string, string>[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new PdfExtractionNotConfiguredError();

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_work_orders" },
    messages: [
      {
        role: "user",
        content: `Extract every work order record from this report text:\n\n${documentText}`,
      },
    ],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const workOrders = (toolUse?.input as { workOrders?: RawExtractedWorkOrder[] } | undefined)?.workOrders ?? [];

  const rows: Record<string, string>[] = [];
  for (const wo of workOrders) {
    const workOrderId = typeof wo.work_order_id === "string" ? wo.work_order_id.trim() : "";
    const propertyName = typeof wo.property_name === "string" ? wo.property_name.trim() : "";
    if (!workOrderId || !propertyName) continue;

    const row: Record<string, string> = { work_order_id: workOrderId, property_name: propertyName };
    for (const field of OPTIONAL_FIELDS) {
      const value = wo[field];
      if (typeof value === "string" && value.trim()) row[field] = value.trim();
    }
    rows.push(row);
  }

  return { rows };
}
