import type { Request, RequestHandler, Response } from "express";
import { sdk } from "./_core/sdk";
import { listDueMemoryExtractionJobReferences } from "./db";
import { processMemoryExtractionJob } from "./chat-context";

export const MEMORY_EXTRACTION_SWEEP_BATCH = 8;

/** Project-level Heartbeat callback for persisted, text-free extraction retries. */
export function createMemoryExtractionScheduleHandler(): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron) {
        res.status(403).json({ error: "cron-only" });
        return;
      }
      const references = await listDueMemoryExtractionJobReferences(MEMORY_EXTRACTION_SWEEP_BATCH);
      let processed = 0;
      let failed = 0;
      for (const reference of references) {
        try {
          await processMemoryExtractionJob(reference.userId, reference.assistantMessageId);
          processed += 1;
        } catch {
          failed += 1;
        }
      }
      res.json({ ok: true, scanned: references.length, processed, failed });
    } catch {
      res.status(500).json({ error: "memory-extraction-sweep-failed", context: { path: "/api/scheduled/memory-extraction" }, timestamp: new Date().toISOString() });
    }
  };
}

export function registerMemoryExtractionScheduleRoute(app: { post: (path: string, handler: RequestHandler) => unknown }) {
  app.post("/api/scheduled/memory-extraction", createMemoryExtractionScheduleHandler());
}
