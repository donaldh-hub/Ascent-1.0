import { Router, type IRouter } from "express";
import { ingestUploadedFile } from "../services/upload-ingestion-service.js";

const router: IRouter = Router();

router.post("/upload/work-orders", async (req, res) => {
  try {
    const contentType = req.headers["content-type"] ?? "";

    let fileContent: string | undefined;
    let fileName = "upload.csv";
    let propertyId: number | undefined;

    if (contentType.includes("multipart/form-data")) {
      const boundary = contentType.split("boundary=")[1]?.trim();
      if (!boundary) {
        return res.status(400).json({ error: "Missing multipart boundary." });
      }

      const body = req.body as string | Buffer;
      const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);

      const parts = raw.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== "--");

      for (const part of parts) {
        const [headerSection, ...bodyParts] = part.split("\r\n\r\n");
        const partBody = bodyParts.join("\r\n\r\n").replace(/\r\n--$/, "").replace(/\r\n$/, "");

        if (!headerSection) continue;

        const nameMatch = headerSection.match(/name="([^"]+)"/);
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        const fieldName = nameMatch?.[1];

        if (fieldName === "file") {
          fileName = filenameMatch?.[1] ?? "upload.csv";
          fileContent = partBody;
        } else if (fieldName === "propertyId") {
          const pid = parseInt(partBody.trim(), 10);
          if (!isNaN(pid)) propertyId = pid;
        }
      }
    } else if (contentType.includes("application/json")) {
      const b = req.body as Record<string, unknown>;
      fileContent = typeof b.fileContent === "string" ? b.fileContent : undefined;
      fileName = typeof b.fileName === "string" ? b.fileName : "upload.csv";
      const pid = Number(b.propertyId);
      if (!isNaN(pid) && pid > 0) propertyId = pid;
    } else if (contentType.includes("text/")) {
      fileContent = req.body as string;
    }

    if (fileContent === undefined || fileContent === null) {
      return res.status(400).json({ error: "No file content provided. Send multipart/form-data with a 'file' field." });
    }

    const ingestionResult = await ingestUploadedFile(fileContent, fileName, propertyId);
    res.json(ingestionResult);
  } catch (err) {
    req.log.error({ err }, "upload/work-orders failed");
    res.status(500).json({
      error: "Upload failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
