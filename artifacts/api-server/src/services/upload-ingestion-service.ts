import { db } from "@workspace/db";
import { workOrdersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export interface IngestionResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  propertyId?: number;
}

const COLUMN_MAP: Record<string, string> = {
  "work order #": "externalId",
  "work order": "externalId",
  "wo number": "externalId",
  "wo #": "externalId",
  "id": "externalId",
  "order id": "externalId",
  "status": "status",
  "priority": "priority",
  "description": "description",
  "issue": "description",
  "summary": "description",
  "property": "propertyName",
  "building": "propertyName",
  "property name": "propertyName",
  "unit": "unitNumber",
  "unit #": "unitNumber",
  "unit number": "unitNumber",
  "created": "createdAt",
  "date created": "createdAt",
  "open date": "createdAt",
  "created date": "createdAt",
  "create date": "createdAt",
  "closed": "closedAt",
  "completed date": "closedAt",
  "close date": "closedAt",
  "closed date": "closedAt",
  "completion date": "closedAt",
  "category": "category",
  "type": "category",
  "work type": "category",
  "assigned to": "assignedTo",
  "assignee": "assignedTo",
  "technician": "assignedTo",
  "notes": "notes",
  "vendor": "vendor",
};

function parseCSV(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let inQuote = false;
    let current = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === "," && !inQuote) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const rawHeaders = parseRow(lines[0]);
  const headers = rawHeaders.map((h) => h.replace(/^"|"$/g, "").trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }

  return { headers, rows };
}

function mapColumns(headers: string[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const header of headers) {
    const key = header.toLowerCase().trim();
    const field = COLUMN_MAP[key];
    if (field) {
      mapping.set(header, field);
    }
  }
  return mapping;
}

function parseDate(value: string): Date | null {
  if (!value || value.trim() === "") return null;
  const d = new Date(value.trim());
  return isNaN(d.getTime()) ? null : d;
}

function normalizeStatus(value: string): string {
  const v = value.toLowerCase().trim();
  if (v === "completed" || v === "complete" || v === "done" || v === "closed") return "completed";
  if (v === "in progress" || v === "in_progress" || v === "open" || v === "active") return "in_progress";
  if (v === "submitted" || v === "new" || v === "pending") return "submitted";
  if (v === "assigned") return "assigned";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  return "submitted";
}

function normalizePriority(value: string): string {
  const v = value.toLowerCase().trim();
  if (v === "critical" || v === "emergency" || v === "urgent") return "critical";
  if (v === "high") return "high";
  if (v === "medium" || v === "normal" || v === "med") return "medium";
  if (v === "low") return "low";
  return "medium";
}

export async function ingestUploadedFile(
  fileContent: string,
  fileName: string,
  propertyId?: number,
): Promise<IngestionResult> {
  const result: IngestionResult = {
    totalRows: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    propertyId,
  };

  if (!fileContent || fileContent.trim().length === 0) {
    result.errors.push("File is empty.");
    return result;
  }

  const { headers, rows } = parseCSV(fileContent);

  if (headers.length === 0 || rows.length === 0) {
    result.errors.push("No data rows found in file.");
    return result;
  }

  const mapping = mapColumns(headers);

  if (mapping.size === 0) {
    result.errors.push(
      `No recognized columns found. Expected columns like: Work Order #, Status, Priority, Description, Category, Property, Unit, Created, Closed.`,
    );
    return result;
  }

  result.totalRows = rows.length;
  const importBatchId = `upload-${Date.now()}`;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    try {
      const mapped: Record<string, string> = {};
      for (const [header, field] of mapping.entries()) {
        mapped[field] = row[header] ?? "";
      }

      if (Object.values(row).every((v) => v.trim() === "")) {
        result.skipped++;
        continue;
      }

      const externalId = mapped["externalId"] ? mapped["externalId"].trim() : null;

      const workOrderData = {
        externalId,
        propertyId: propertyId ?? null,
        category: mapped["category"] ? mapped["category"].trim() : null,
        description: mapped["description"] ? mapped["description"].trim() : null,
        priority: mapped["priority"] ? normalizePriority(mapped["priority"]) : "medium",
        status: mapped["status"] ? normalizeStatus(mapped["status"]) : "submitted",
        assignedTo: mapped["assignedTo"] ? mapped["assignedTo"].trim() : null,
        notes: mapped["notes"] ? mapped["notes"].trim() : null,
        vendor: mapped["vendor"] ? mapped["vendor"].trim() : null,
        propertyNameRaw: mapped["propertyName"] ? mapped["propertyName"].trim() : null,
        unitNumberRaw: mapped["unitNumber"] ? mapped["unitNumber"].trim() : null,
        createdDate: parseDate(mapped["createdAt"] ?? ""),
        completedDate: parseDate(mapped["closedAt"] ?? ""),
        rawData: row,
        importBatchId,
        sourceFileName: fileName,
        sourceRowIndex: i + 1,
        importedAt: new Date(),
        updatedAt: new Date(),
      };

      if (externalId) {
        const existing = await db
          .select({ id: workOrdersTable.id })
          .from(workOrdersTable)
          .where(eq(workOrdersTable.externalId, externalId))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(workOrdersTable)
            .set({ ...workOrderData, updatedAt: new Date() })
            .where(eq(workOrdersTable.externalId, externalId));
          result.updated++;
        } else {
          await db.insert(workOrdersTable).values(workOrderData);
          result.inserted++;
        }
      } else {
        await db.insert(workOrdersTable).values(workOrderData);
        result.inserted++;
      }
    } catch (err) {
      result.errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped++;
    }
  }

  return result;
}
